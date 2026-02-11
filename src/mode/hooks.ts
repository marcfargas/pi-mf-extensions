/**
 * Mode switching and tool_call hooks.
 *
 * Phase A: logging-only (log guarded tool calls without blocking).
 * Phase C: enforcement (reject out-of-scope tools in executor).
 */

import type { PiExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PlanStore } from "../persistence/plan-store.js";

export function registerModeHooks(ctx: PiExtensionContext, _store: PlanStore): void {
	// before_agent_start: inject plan-mode context into agent prompt
	ctx.on?.("before_agent_start", (event) => {
		// Only inject if plan tools are available
		// The SKILL.md provides the primary guidance; this adds runtime context
		return event;
	});

	// tool_call: Phase A logging-only hook
	// When guardedTools is configured, log (but don't block) calls to guarded tools
	// that happen outside an approved plan.
	//
	// Phase C will upgrade this to enforcement mode.
	ctx.on?.("tool_call", (_event) => {
		// Phase A: no-op. Logging infrastructure TBD.
		// Will read guardedTools from .pi/plans.json and log violations.
		return undefined; // Allow all tool calls
	});
}
