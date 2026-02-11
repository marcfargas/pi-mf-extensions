/**
 * pi-planner — Persistent, auditable plan-then-execute workflow for pi agents.
 *
 * Extension entry point. Registers plan tools, commands, and event hooks.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPlanTools } from "./tools/index.js";
import { PlanStore } from "./persistence/plan-store.js";
import { loadConfig } from "./persistence/config.js";
import { registerModeHooks } from "./mode/hooks.js";

export default function activate(pi: ExtensionAPI): void {
	// Store and config are initialized lazily on first event (need cwd from ctx)
	let store: PlanStore | undefined;
	let configLoaded = false;
	let guardedTools: string[] = [];

	function ensureStore(cwd: string): PlanStore {
		if (!store) {
			store = new PlanStore(cwd);
			if (!configLoaded) {
				const config = loadConfig(cwd);
				guardedTools = config.guardedTools;
				configLoaded = true;
			}
		}
		return store;
	}

	// Register plan tools
	registerPlanTools(pi, ensureStore);

	// Register mode hooks (before_agent_start, tool_call logging)
	registerModeHooks(pi, ensureStore, () => guardedTools);

	// /plan — toggle plan mode
	pi.registerCommand("plan", {
		description: "Toggle plan mode (plan tools only, no writes)",
		handler: async (_args, ctx) => {
			// Phase B: full mode switching via setActiveTools
			// For now, show pending plans as a useful entry point
			const s = ensureStore(ctx.cwd);
			const plans = await s.list({ status: "proposed" });
			if (plans.length === 0) {
				ctx.ui.notify("No pending plans. Use plan_propose to create one.", "info");
			} else {
				const items = plans.map((p) => `${p.id}: ${p.title}`);
				const choice = await ctx.ui.select("Pending plans — select to view:", items);
				if (choice) {
					const id = choice.split(":")[0].trim();
					const plan = await s.get(id);
					if (plan) {
						const action = await ctx.ui.select(`${plan.title} [${plan.status}]`, [
							"Approve",
							"Reject",
							"Cancel",
						]);
						if (action === "Approve") {
							await s.approve(plan.id);
							ctx.ui.notify(`Plan ${plan.id} approved.`, "info");
						} else if (action === "Reject") {
							await s.reject(plan.id, "Rejected via /plan command");
							ctx.ui.notify(`Plan ${plan.id} rejected.`, "info");
						}
					}
				}
			}
		},
	});

	// /plans — list pending plans
	pi.registerCommand("plans", {
		description: "List all plans",
		handler: async (_args, ctx) => {
			const s = ensureStore(ctx.cwd);
			const plans = await s.list();
			if (plans.length === 0) {
				ctx.ui.notify("No plans found.", "info");
			} else {
				const lines = plans.map((p) => `${p.id} [${p.status}] ${p.title} (v${p.version})`);
				ctx.ui.notify(lines.join("\n"), "info");
			}
		},
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		ensureStore(ctx.cwd);
	});
}
