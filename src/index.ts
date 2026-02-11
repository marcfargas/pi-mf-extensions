/**
 * pi-planner — Persistent, auditable plan-then-execute workflow for pi agents.
 *
 * Extension entry point. Registers plan tools, commands, and event hooks.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { registerPlanTools } from "./tools/index.js";
import { PlanStore } from "./persistence/plan-store.js";
import { loadConfig } from "./persistence/config.js";
import { registerModeHooks, type PlannerMode } from "./mode/hooks.js";
import { executePlan } from "./executor/runner.js";
import { findStalledPlans, formatStalledPlanMessage } from "./executor/stalled.js";
import { countCompletedSteps } from "./executor/checkpoint.js";
import { DEFAULT_CONFIG, type Plan, type PlannerConfig } from "./persistence/types.js";

// Read-only tools allowed in plan mode (plus plan CRUD tools added dynamically)
const PLAN_MODE_READONLY = new Set([
	"read", "bash", "grep", "find", "ls",
	"plan_propose", "plan_list", "plan_get", "plan_approve", "plan_reject",
]);

/** State persisted across sessions via appendEntry. */
export interface PlannerState {
	planMode: boolean;
}

const ENTRY_TYPE = "pi-planner";

export default function activate(pi: ExtensionAPI): void {
	// Store and config are initialized lazily on first event (need cwd from ctx)
	let store: PlanStore | undefined;
	let config: PlannerConfig | undefined;
	let configLoaded = false;
	let guardedTools: string[] = [];

	// Extension state
	let planMode = false;
	let allToolNames: string[] | undefined; // snapshot of all tools before entering plan mode

	// Track active executions to avoid duplicates
	const activeExecutions = new Set<string>();

	function ensureStore(cwd: string): PlanStore {
		if (!store) {
			store = new PlanStore(cwd);
			if (!configLoaded) {
				config = loadConfig(cwd);
				guardedTools = config.guardedTools;
				configLoaded = true;
			}
		}
		return store;
	}

	function getConfig(): PlannerConfig {
		return config ?? DEFAULT_CONFIG;
	}

	function getMode(): PlannerMode {
		return planMode ? "plan" : "normal";
	}

	function persistState(): void {
		const data: PlannerState = { planMode };
		pi.appendEntry(ENTRY_TYPE, data);
	}

	function applyMode(ctx: ExtensionContext): void {
		if (planMode) {
			// Snapshot all tools before restricting (if not already captured)
			if (!allToolNames) {
				allToolNames = pi.getActiveTools();
			}
			// Filter to read-only tools only
			const planTools = allToolNames.filter((t) => PLAN_MODE_READONLY.has(t));
			pi.setActiveTools(planTools);
		} else if (allToolNames) {
			// Restore the full tool set from snapshot
			pi.setActiveTools(allToolNames);
			allToolNames = undefined;
		}
		// If planMode is false and no snapshot exists, don't touch tools at all —
		// this avoids wiping other extensions' tools on session_start.
		updateStatus(ctx);
	}

	async function updateStatus(ctx: ExtensionContext): Promise<void> {
		// Footer status
		if (planMode) {
			ctx.ui.setStatus("pi-planner", "⏸ plan");
		} else {
			ctx.ui.setStatus("pi-planner", undefined);
		}

		// Widget showing pending plans + execution progress
		try {
			const s = store;
			if (!s) return;

			const proposed = await s.list({ status: "proposed" });
			const executing = await s.list({ status: "executing" });

			if (proposed.length > 0 || executing.length > 0) {
				const lines: string[] = [];
				if (proposed.length > 0) {
					lines.push(`📋 ${proposed.length} pending`);
					for (const p of proposed.slice(0, 3)) {
						lines.push(`  ${p.id}: ${p.title}`);
					}
					if (proposed.length > 3) {
						lines.push(`  ... +${proposed.length - 3} more`);
					}
				}
				if (executing.length > 0) {
					for (const p of executing) {
						const completed = countCompletedSteps(ctx.cwd, p.id);
						lines.push(`▶ ${p.id}: ${p.title} (${completed}/${p.steps.length} steps)`);
					}
				}
				ctx.ui.setWidget("pi-planner", lines);
			} else {
				ctx.ui.setWidget("pi-planner", undefined);
			}
		} catch {
			// Don't crash on widget update failure
		}
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planMode = !planMode;

		if (planMode) {
			ctx.ui.notify("Plan mode enabled. Read-only exploration + plan tools.", "info");
		} else {
			ctx.ui.notify("Plan mode disabled. Full tool access restored.", "info");
		}

		applyMode(ctx);
		persistState();
	}

	/**
	 * Start plan execution in the background.
	 * Called after approval (from tool or command).
	 */
	async function startExecution(planId: string, ctx: ExtensionContext): Promise<void> {
		if (activeExecutions.has(planId)) return;

		const s = store;
		if (!s) return;

		const plan = await s.get(planId);
		if (!plan || plan.status !== "approved") return;

		const availableToolNames = pi.getAllTools().map((t) => t.name);
		activeExecutions.add(planId);

		// Execute in background — don't await
		executePlan(plan, s, ctx.cwd, availableToolNames, ctx, () => updateStatus(ctx))
			.then((result) => {
				activeExecutions.delete(planId);
				if (result.ok) {
					ctx.ui.notify(`Plan ${planId} completed successfully.`, "info");
				} else {
					ctx.ui.notify(`Plan ${planId} failed: ${result.error}`, "error");
				}
				updateStatus(ctx);
			})
			.catch((err) => {
				activeExecutions.delete(planId);
				ctx.ui.notify(`Plan ${planId} execution error: ${err}`, "error");
				updateStatus(ctx);
			});
	}

	// Register plan tools (with execution callback)
	registerPlanTools(pi, ensureStore, startExecution);

	// Register mode hooks (before_agent_start, tool_call logging/blocking)
	registerModeHooks(pi, ensureStore, () => guardedTools, getMode);

	// /plan — toggle plan mode + manage pending plans
	pi.registerCommand("plan", {
		description: "Toggle plan mode or manage pending plans",
		handler: async (_args, ctx) => {
			const s = ensureStore(ctx.cwd);
			const proposed = await s.list({ status: "proposed" });

			if (proposed.length === 0) {
				togglePlanMode(ctx);
				return;
			}

			const choices = [
				planMode ? "Exit plan mode (restore full access)" : "Enter plan mode (read-only)",
				...proposed.map((p) => `Review: ${p.id} — ${p.title}`),
			];

			const choice = await ctx.ui.select("Plan mode:", choices);
			if (!choice) return;

			if (choice.startsWith("Enter plan mode") || choice.startsWith("Exit plan mode")) {
				togglePlanMode(ctx);
				return;
			}

			const planId = choice.match(/PLAN-[0-9a-f]+/)?.[0];
			if (!planId) return;

			const plan = await s.get(planId);
			if (!plan) return;

			await reviewPlan(plan, s, ctx, startExecution);
			await updateStatus(ctx);
		},
	});

	// /plans — interactive plan browser
	pi.registerCommand("plans", {
		description: "Browse and manage all plans",
		handler: async (_args, ctx) => {
			const s = ensureStore(ctx.cwd);
			const plans = await s.list();

			if (plans.length === 0) {
				ctx.ui.notify("No plans found. Use plan_propose to create one.", "info");
				return;
			}

			const byStatus = new Map<string, Plan[]>();
			for (const p of plans) {
				const group = byStatus.get(p.status) ?? [];
				group.push(p);
				byStatus.set(p.status, group);
			}

			const statusOrder = ["proposed", "approved", "executing", "completed", "failed", "rejected", "cancelled", "stalled"];
			const statusEmoji: Record<string, string> = {
				proposed: "📋", approved: "✅", executing: "▶",
				completed: "✓", failed: "✗", rejected: "⊘",
				cancelled: "—", stalled: "⚠",
			};

			const items: string[] = [];
			for (const status of statusOrder) {
				const group = byStatus.get(status);
				if (!group) continue;
				for (const p of group) {
					const emoji = statusEmoji[p.status] ?? "?";
					items.push(`${emoji} [${p.status}] ${p.id} — ${p.title} (v${p.version})`);
				}
			}

			const choice = await ctx.ui.select(`Plans (${plans.length} total):`, items);
			if (!choice) return;

			const planId = choice.match(/PLAN-[0-9a-f]+/)?.[0];
			if (!planId) return;

			const plan = await s.get(planId);
			if (!plan) return;

			await viewPlanDetail(plan, s, ctx, startExecution);
			await updateStatus(ctx);
		},
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		ensureStore(ctx.cwd);

		// Restore persisted state
		const entries = ctx.sessionManager.getEntries();
		const plannerEntry = entries
			.filter((e) => e.type === "custom" && (e as any).customType === ENTRY_TYPE)
			.pop() as { data?: PlannerState } | undefined;

		if (plannerEntry?.data) {
			planMode = plannerEntry.data.planMode ?? false;
		}

		applyMode(ctx);

		// Check for stalled plans (crash recovery)
		const s = store;
		if (s) {
			const executing = await s.list({ status: "executing" });
			if (executing.length > 0) {
				const cfg = getConfig();
				const stalled = findStalledPlans(executing, cfg.executor_timeout_minutes);

				for (const plan of stalled) {
					await s.update(plan.id, (p) => { p.status = "stalled"; });
					const msg = formatStalledPlanMessage(plan);
					ctx.ui.notify(`⚠ Stalled: ${msg}`, "warning");
				}

				// Plans still executing (not stalled) — notify
				const stillExecuting = executing.filter((p) => !stalled.some((s) => s.id === p.id));
				for (const plan of stillExecuting) {
					ctx.ui.notify(
						`Plan ${plan.id} "${plan.title}" was executing when session ended. Mark as failed? Use /plans to manage.`,
						"warning",
					);
				}
			}
		}
	});

	// Update widget after each agent turn
	pi.on("agent_end", async (_event, ctx) => {
		await updateStatus(ctx);
	});
}

// ── Plan Review & Detail Views ──────────────────────────────

type ExecutionStarter = (planId: string, ctx: ExtensionContext) => Promise<void>;

async function viewPlanDetail(
	plan: Plan,
	store: PlanStore,
	ctx: ExtensionContext,
	startExecution: ExecutionStarter,
): Promise<void> {
	const detail = formatPlanDetail(plan);

	const actions: string[] = [];
	switch (plan.status) {
		case "proposed":
			actions.push("Approve", "Approve & Execute", "Reject", "Back");
			break;
		case "approved":
			actions.push("Execute", "Cancel", "Back");
			break;
		case "stalled":
			actions.push("Mark as Failed", "Cancel", "Back");
			break;
		case "executing":
			actions.push("Back");
			break;
		default:
			actions.push("Back");
			break;
	}

	const action = await ctx.ui.select(detail, actions);

	if (action === "Approve") {
		await store.approve(plan.id);
		ctx.ui.notify(`Plan ${plan.id} approved.`, "info");
	} else if (action === "Approve & Execute") {
		await store.approve(plan.id);
		ctx.ui.notify(`Plan ${plan.id} approved. Starting execution...`, "info");
		await startExecution(plan.id, ctx);
	} else if (action === "Execute") {
		ctx.ui.notify(`Starting execution of ${plan.id}...`, "info");
		await startExecution(plan.id, ctx);
	} else if (action === "Reject") {
		const feedback = await ctx.ui.editor("Rejection feedback:", "");
		const reason = feedback?.trim() || "Rejected via /plans command";
		await store.reject(plan.id, reason);
		ctx.ui.notify(`Plan ${plan.id} rejected.`, "info");
	} else if (action === "Cancel") {
		const confirmed = await ctx.ui.confirm("Cancel plan?", `Cancel ${plan.id}: ${plan.title}`);
		if (confirmed) {
			await store.cancel(plan.id);
			ctx.ui.notify(`Plan ${plan.id} cancelled.`, "info");
		}
	} else if (action === "Mark as Failed") {
		await store.markFailed(plan.id, "Marked as failed after stalling");
		ctx.ui.notify(`Plan ${plan.id} marked as failed.`, "info");
	}
}

async function reviewPlan(
	plan: Plan,
	store: PlanStore,
	ctx: ExtensionContext,
	startExecution: ExecutionStarter,
): Promise<void> {
	const detail = formatPlanDetail(plan);
	const action = await ctx.ui.select(detail, ["Approve", "Approve & Execute", "Reject", "Cancel"]);

	if (action === "Approve") {
		await store.approve(plan.id);
		ctx.ui.notify(`Plan ${plan.id} approved.`, "info");
	} else if (action === "Approve & Execute") {
		await store.approve(plan.id);
		ctx.ui.notify(`Plan ${plan.id} approved. Starting execution...`, "info");
		await startExecution(plan.id, ctx);
	} else if (action === "Reject") {
		const feedback = await ctx.ui.editor("Rejection feedback:", "");
		const reason = feedback?.trim() || "Rejected via /plan command";
		await store.reject(plan.id, reason);
		ctx.ui.notify(`Plan ${plan.id} rejected.`, "info");
	}
}

function formatPlanDetail(plan: Plan): string {
	const lines: string[] = [
		plan.title,
		"",
		`Status: ${plan.status}  |  Version: ${plan.version}  |  Tools: ${plan.tools_required.join(", ")}`,
		"",
		"Steps:",
	];

	for (let i = 0; i < plan.steps.length; i++) {
		const s = plan.steps[i];
		const target = s.target ? ` → ${s.target}` : "";
		lines.push(`  ${i + 1}. ${s.description} (${s.tool}: ${s.operation}${target})`);
	}

	if (plan.context) {
		lines.push("", "Context:", `  ${plan.context.slice(0, 200)}${plan.context.length > 200 ? "..." : ""}`);
	}

	if (plan.result_summary) {
		lines.push("", `Result: ${plan.result_summary}`);
	}

	return lines.join("\n");
}
