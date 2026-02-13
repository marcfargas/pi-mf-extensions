/**
 * Executor runner — orchestrates plan execution in-session.
 *
 * Instead of spawning a subagent, this uses pi.sendUserMessage() to instruct
 * the current agent to execute the plan, with pi.setActiveTools() to scope
 * the available tools and a temporary plan_run_script tool for step reporting.
 *
 * Flow:
 * 1. Pre-flight validation
 * 2. Mark plan as executing, initialize scripts
 * 3. Save current tools, restrict to plan tools + plan_run_script
 * 4. Send executor prompt via pi.sendUserMessage()
 * 5. Agent executes steps, reports via plan_run_script
 * 6. On completion/failure, restore tools (via agent_end hook in index.ts)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PlanStore } from "../persistence/plan-store.js";
import type { Plan, PlanScript } from "../persistence/types.js";
import { validatePreflight } from "./preflight.js";
import { CheckpointLogger } from "./checkpoint.js";

export interface ExecutionResult {
	ok: boolean;
	error?: string;
	planId: string;
}

/**
 * Mutable state for an active plan execution.
 * Stored in the extension closure (index.ts) — one execution at a time.
 */
export interface ExecutionState {
	planId: string;
	savedTools: string[];
	checkpoint: CheckpointLogger;
	store: PlanStore;
	totalSteps: number;
	done: boolean;
	result?: ExecutionResult;
	onStatusUpdate?: () => Promise<void>;
}

/**
 * Build the executor prompt that instructs the agent to follow the plan.
 * Includes plan_run_script reporting protocol.
 */
export function buildExecutorPrompt(plan: Plan): string {
	const toolList = plan.tools_required.join(", ");
	const stepList = plan.steps
		.map((s, i) => `${i + 1}. ${s.description} (${s.tool}: ${s.operation}${s.target ? ` → ${s.target}` : ""})`)
		.join("\n");

	return `You are now executing an approved plan. Follow the steps exactly.

## Plan: ${plan.title}
## ID: ${plan.id}

## Available Tools
${toolList}

## Steps
${stepList}

${plan.context ? `## Context\n${plan.context}\n` : ""}
## Execution Protocol
After completing each step, report the outcome using plan_run_script:

1. After each successful step:
   plan_run_script({ action: "step_complete", step: <step_number>, summary: "what was done" })

2. If a step fails:
   plan_run_script({ action: "step_failed", step: <step_number>, summary: "what went wrong" })
   Then immediately:
   plan_run_script({ action: "plan_failed", summary: "Step N failed: reason" })

3. After ALL steps succeed:
   plan_run_script({ action: "plan_complete", summary: "brief summary of all results" })

## Rules
- Follow the plan steps in order
- If a step fails, STOP immediately and report the failure
- Do NOT improvise beyond the plan scope
- Do NOT use bash to work around missing tools
- Report EVERY step outcome via plan_run_script
- Always end with exactly one plan_complete or plan_failed call
- If real-world state doesn't match the plan's assumptions, STOP and report via plan_failed
- If a step references an entity without a unique identifier, STOP and report "ambiguous step"
- Do NOT attempt to undo previous steps unless the plan explicitly includes rollback steps`;
}

/**
 * Render plan as executor task string (used in sendUserMessage).
 */
export function renderPlanForExecutor(plan: Plan): string {
	return `Execute approved plan ${plan.id}: "${plan.title}"

Follow the steps in order. Report each step's outcome via plan_run_script.`;
}

/**
 * Start plan execution in-session.
 *
 * Sets up execution state, restricts tools, and sends the executor prompt.
 * The actual execution happens asynchronously as the agent processes the message.
 * Completion is detected via plan_run_script tool calls.
 *
 * Returns immediately with either an error or the execution state.
 */
export async function executePlan(
	plan: Plan,
	store: PlanStore,
	projectRoot: string,
	availableTools: string[],
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	onStatusUpdate?: () => Promise<void>,
): Promise<{ ok: boolean; error?: string; state?: ExecutionState }> {
	// Pre-flight validation
	const preflight = validatePreflight(plan, plan.version, availableTools);
	if (!preflight.ok) {
		return { ok: false, error: preflight.error };
	}

	// Mark as executing
	try {
		await store.markExecuting(plan.id);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Failed to mark plan as executing: ${msg}` };
	}

	// Initialize step scripts
	const scripts: PlanScript[] = plan.steps.map((_, i) => ({
		stepIndex: i,
		status: "pending" as const,
	}));
	try {
		await store.update(plan.id, (p) => { p.scripts = scripts; });
	} catch {
		// Non-fatal — scripts tracking is nice-to-have
	}

	// Setup checkpoint logger
	const checkpoint = new CheckpointLogger(projectRoot, plan.id);
	checkpoint.logStart(plan.id);

	// Notify widget
	if (onStatusUpdate) await onStatusUpdate();

	// Save current tools and set execution tools
	const savedTools = pi.getActiveTools();
	const allToolNames = pi.getAllTools().map((t) => t.name);

	// During execution: all available tools + plan_run_script
	// We use ALL tools (not just plan.tools_required) because tool names
	// in the plan are semantic (e.g., "odoo-toolbox") while actual pi tools
	// may differ (e.g., "bash" for CLI tools, "odoo" for registered tools).
	const executionTools = [...new Set([...allToolNames, "plan_run_script"])];
	pi.setActiveTools(executionTools);

	// Build executor prompt and send as user message
	const prompt = buildExecutorPrompt(plan);
	pi.sendUserMessage(prompt, { deliverAs: "followUp" });

	const state: ExecutionState = {
		planId: plan.id,
		savedTools,
		checkpoint,
		store,
		totalSteps: plan.steps.length,
		done: false,
		onStatusUpdate,
	};

	return { ok: true, state };
}

/**
 * Finish an active execution — restore tools and update plan status.
 * Called from plan_run_script when plan_complete or plan_failed is reported.
 */
export async function finishExecution(
	state: ExecutionState,
	result: ExecutionResult,
	pi: ExtensionAPI,
	_ctx: ExtensionContext,
): Promise<void> {
	state.done = true;
	state.result = result;

	// Restore previous tools
	pi.setActiveTools(state.savedTools);

	// Update plan status
	try {
		if (result.ok) {
			state.checkpoint.logEnd(state.planId, "completed", result.error || "Completed successfully");
			await state.store.markCompleted(state.planId, result.error || "Execution completed successfully.");
		} else {
			state.checkpoint.logEnd(state.planId, "failed", result.error || "Failed");
			await state.store.markFailed(state.planId, result.error || "Unknown error");
		}
	} catch {
		// Plan may have been modified concurrently
	}

	if (state.onStatusUpdate) await state.onStatusUpdate();
}
