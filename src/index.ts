/**
 * pi-planner — Persistent, auditable plan-then-execute workflow for pi agents.
 *
 * Extension entry point. Registers plan tools, commands, and event hooks.
 */

import type { PiExtensionContext } from "@mariozechner/pi-coding-agent";
import { registerPlanTools } from "./tools/index.js";
import { PlanStore } from "./persistence/plan-store.js";
import { registerModeHooks } from "./mode/hooks.js";

export default function activate(ctx: PiExtensionContext): void {
	const store = new PlanStore(ctx.cwd);

	registerPlanTools(ctx, store);
	registerModeHooks(ctx, store);

	// /plan — toggle plan mode
	ctx.registerCommand?.("plan", {
		description: "Toggle plan mode (read-only + plan tools)",
		execute: async () => {
			// Phase A: mode switching — adapt from pi plan-mode example
			// TODO: implement setActiveTools toggle
		},
	});

	// /plans — list pending plans
	ctx.registerCommand?.("plans", {
		description: "List pending plans",
		execute: async () => {
			const plans = await store.list({ status: "proposed" });
			if (plans.length === 0) {
				return "No pending plans.";
			}
			return plans
				.map((p) => `${p.id} [${p.status}] ${p.title}`)
				.join("\n");
		},
	});
}
