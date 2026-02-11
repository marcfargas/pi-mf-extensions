/**
 * Mode switching and tool_call hooks.
 *
 * - before_agent_start: injects plan-mode context (SKILL.md guidance + tool inventory)
 * - tool_call: Phase A logging-only — logs guarded tool calls without blocking
 *
 * Phase C will upgrade tool_call to enforcement mode for executor agents.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PlanStore } from "../persistence/plan-store.js";

export function registerModeHooks(
	pi: ExtensionAPI,
	getStore: (cwd: string) => PlanStore,
	getGuardedTools: () => string[],
): void {
	// before_agent_start: inject plan-mode awareness into agent prompt
	pi.on("before_agent_start", async (_event, ctx) => {
		const store = getStore(ctx.cwd);

		// Check for pending plans to surface
		const proposed = await store.list({ status: "proposed" });
		const executing = await store.list({ status: "executing" });

		const parts: string[] = [];

		if (proposed.length > 0) {
			parts.push(
				`[PLAN MODE] ${proposed.length} plan(s) awaiting approval:`,
				...proposed.map((p) => `  - ${p.id}: ${p.title}`),
			);
		}

		if (executing.length > 0) {
			parts.push(
				`[PLAN MODE] ${executing.length} plan(s) currently executing:`,
				...executing.map((p) => `  - ${p.id}: ${p.title} (started ${p.execution_started_at})`),
			);
		}

		// Check for stalled plans (executing > timeout)
		const guardedToolsList = getGuardedTools();
		if (guardedToolsList.length > 0) {
			parts.push(
				`[PLAN MODE] Guarded tools (require a plan): ${guardedToolsList.join(", ")}`,
			);
		}

		if (parts.length === 0) return;

		return {
			message: {
				customType: "plan-mode-context",
				content: parts.join("\n"),
				display: false,
			},
		};
	});

	// tool_call: Phase A logging-only hook
	// When guardedTools is configured, log (but don't block) calls to guarded tools
	// that happen outside an approved plan.
	pi.on("tool_call", async (event, ctx) => {
		const guardedToolsList = getGuardedTools();
		if (guardedToolsList.length === 0) return;

		// Check if this tool call matches a guarded tool
		const toolName = event.toolName;
		const isGuarded = guardedToolsList.some((g) => toolName === g || toolName.startsWith(`${g}_`));
		if (!isGuarded) return;

		// Phase A: log only, don't block
		// In Phase C, this will check for an active approved plan and block if none exists
		const store = getStore(ctx.cwd);
		const executingPlans = await store.list({ status: "executing" });
		const hasActivePlan = executingPlans.length > 0;

		if (!hasActivePlan) {
			// Log that a guarded tool was called without an active plan
			// This generates training data for tuning the SKILL.md guidance
			console.error(
				`[pi-planner] GUARDED TOOL CALL without plan: ${toolName} (input: ${JSON.stringify(event.input).slice(0, 200)})`,
			);
			// Phase C: return { block: true, reason: `Tool "${toolName}" requires an approved plan. Use plan_propose first.` };
		}

		return undefined; // Allow all tool calls in Phase A
	});
}
