/**
 * Executor runner — orchestrates plan execution via pi-subagents.
 *
 * Flow:
 * 1. Pre-flight validation
 * 2. Mark plan as executing
 * 3. Spawn executor subagent with scoped tools
 * 4. Track progress via checkpoint logger
 * 5. Update plan status (completed/failed)
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PlanStore } from "../persistence/plan-store.js";
import type { Plan } from "../persistence/types.js";
import { validatePreflight } from "./preflight.js";
import { CheckpointLogger } from "./checkpoint.js";
import { buildExecutorPrompt, renderPlanForExecutor } from "./spawn.js";

export interface ExecutionResult {
	ok: boolean;
	error?: string;
	planId: string;
}

/**
 * Execute an approved plan.
 *
 * This is an async operation — call without awaiting for background execution.
 * Updates plan status and widget as execution progresses.
 */
export async function executePlan(
	plan: Plan,
	store: PlanStore,
	projectRoot: string,
	availableTools: string[],
	ctx: ExtensionContext,
	onStatusUpdate?: () => Promise<void>,
): Promise<ExecutionResult> {
	// Pre-flight validation
	const preflight = validatePreflight(plan, plan.version, availableTools);
	if (!preflight.ok) {
		return { ok: false, error: preflight.error, planId: plan.id };
	}

	// Mark as executing
	try {
		await store.markExecuting(plan.id);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Failed to mark plan as executing: ${msg}`, planId: plan.id };
	}

	// Setup checkpoint logger
	const checkpoint = new CheckpointLogger(projectRoot, plan.id);
	checkpoint.logStart(plan.id);

	// Notify widget
	if (onStatusUpdate) await onStatusUpdate();

	try {
		// Import pi-subagents dynamically (peer dependency)
		const { runSync } = await import("pi-subagents/execution.js");
		const { discoverAgents } = await import("pi-subagents/agents.js");

		// Build executor agent config
		const systemPrompt = buildExecutorPrompt(plan);
		const task = renderPlanForExecutor(plan);

		// Discover existing agents to get the tools array
		const { agents } = discoverAgents(projectRoot, "both");

		// Create a temporary executor agent config
		const executorAgent = {
			name: `plan-executor-${plan.id}`,
			description: `Executor for plan ${plan.id}`,
			tools: plan.tools_required,
			model: plan.executor_model,
			systemPrompt,
			source: "project" as const,
			filePath: "",
		};

		// Add the executor agent to the array
		const allAgents = [...agents, executorAgent];

		// Generate a run ID
		const runId = `plan-${plan.id}-${Date.now()}`;

		// Run the executor
		const result = await runSync(projectRoot, allAgents, executorAgent.name, task, {
			runId,
			cwd: projectRoot,
			share: false,
		});

		// Log step results from the execution
		// Parse the output to extract step completion info
		const output = result.messages
			.filter((m: any) => m.role === "assistant")
			.map((m: any) => {
				if (typeof m.content === "string") return m.content;
				if (Array.isArray(m.content)) {
					return m.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("\n");
				}
				return "";
			})
			.join("\n");

		if (result.exitCode === 0 && !result.error) {
			// Success
			checkpoint.logEnd(plan.id, "completed", output.slice(0, 500));
			await store.markCompleted(plan.id, output.slice(0, 500) || "Execution completed successfully.");
			if (onStatusUpdate) await onStatusUpdate();

			return { ok: true, planId: plan.id };
		} else {
			// Failure
			const errorMsg = result.error || `Executor exited with code ${result.exitCode}`;
			checkpoint.logEnd(plan.id, "failed", errorMsg);
			await store.markFailed(plan.id, errorMsg);
			if (onStatusUpdate) await onStatusUpdate();

			return { ok: false, error: errorMsg, planId: plan.id };
		}
	} catch (err) {
		// Handle missing pi-subagents or other errors
		const msg = err instanceof Error ? err.message : String(err);
		const isModuleError = msg.includes("Cannot find module") || msg.includes("ERR_MODULE_NOT_FOUND");

		const errorMsg = isModuleError
			? "pi-subagents not installed. Install it to enable plan execution: npm install pi-subagents"
			: `Executor error: ${msg}`;

		checkpoint.logEnd(plan.id, "failed", errorMsg);

		try {
			await store.markFailed(plan.id, errorMsg);
		} catch {
			// Plan may have been modified concurrently
		}

		if (onStatusUpdate) await onStatusUpdate();
		return { ok: false, error: errorMsg, planId: plan.id };
	}
}
