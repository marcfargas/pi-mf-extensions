/**
 * Plan tools: plan_propose, plan_list, plan_get, plan_approve, plan_reject.
 */

import type { PiExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PlanStore } from "../persistence/plan-store.js";

export function registerPlanTools(ctx: PiExtensionContext, store: PlanStore): void {
	// plan_propose
	ctx.registerTool?.({
		name: "plan_propose",
		description: `Propose a plan for consequential external actions that need user approval.
Use for: Odoo writes, email sends, calendar changes, deployments, cross-system workflows.
Do NOT use for: file edits, git ops, build/test commands, reading from systems.
The plan will be presented to the user for approval before execution.`,
		parameters: {
			type: "object",
			properties: {
				title: { type: "string", description: "Short description of what this plan does" },
				steps: {
					type: "array",
					items: {
						type: "object",
						properties: {
							description: { type: "string" },
							tool: { type: "string", description: "Tool needed (e.g., odoo-toolbox, go-easy)" },
							operation: { type: "string", description: "Specific operation (e.g., write, draft, send)" },
							target: { type: "string", description: "Target entity/record if known" },
						},
						required: ["description", "tool", "operation"],
					},
				},
				context: { type: "string", description: "Structured context gathered during planning (tool outputs, notes)" },
			},
			required: ["title", "steps"],
		},
		execute: async (params) => {
			const toolsRequired = [...new Set(params.steps.map((s: any) => s.tool))];
			const plan = await store.create({
				title: params.title,
				steps: params.steps,
				context: params.context,
				tools_required: toolsRequired,
			});

			// Emit event for UI
			ctx.events?.emit("plans:proposed", plan);

			return {
				content: [
					{
						type: "text",
						text: `Plan created: ${plan.id}\nTitle: ${plan.title}\nStatus: proposed\nSteps: ${plan.steps.length}\nTools: ${toolsRequired.join(", ")}\n\nAwaiting approval.`,
					},
				],
			};
		},
	});

	// plan_list
	ctx.registerTool?.({
		name: "plan_list",
		description: "List plans in the current project. Optionally filter by status.",
		parameters: {
			type: "object",
			properties: {
				status: { type: "string", description: "Filter by status (proposed, approved, executing, completed, failed, rejected, cancelled)" },
			},
		},
		execute: async (params) => {
			const plans = await store.list(params.status ? { status: params.status } : undefined);
			if (plans.length === 0) {
				return { content: [{ type: "text", text: "No plans found." }] };
			}
			const text = plans
				.map((p) => `${p.id} [${p.status}] ${p.title} (${p.steps.length} steps, v${p.version})`)
				.join("\n");
			return { content: [{ type: "text", text }] };
		},
	});

	// plan_get
	ctx.registerTool?.({
		name: "plan_get",
		description: "Get full details of a plan by ID.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "Plan ID (e.g., PLAN-a1b2c3d4)" },
			},
			required: ["id"],
		},
		execute: async (params) => {
			const plan = await store.get(params.id);
			if (!plan) {
				return { content: [{ type: "text", text: `Plan ${params.id} not found.` }], isError: true };
			}
			const lines = [
				`# ${plan.title}`,
				``,
				`- **ID**: ${plan.id}`,
				`- **Status**: ${plan.status}`,
				`- **Version**: ${plan.version}`,
				`- **Created**: ${plan.created_at}`,
				`- **Tools**: ${plan.tools_required.join(", ")}`,
				plan.executor_model ? `- **Executor model**: ${plan.executor_model}` : null,
				plan.result_summary ? `- **Result**: ${plan.result_summary}` : null,
				``,
				`## Steps`,
				...plan.steps.map((s, i) => `${i + 1}. ${s.description} (${s.tool}: ${s.operation}${s.target ? ` → ${s.target}` : ""})`),
			].filter(Boolean);

			if (plan.context) {
				lines.push("", "## Context", plan.context);
			}

			return { content: [{ type: "text", text: lines.join("\n") }] };
		},
	});

	// plan_approve
	ctx.registerTool?.({
		name: "plan_approve",
		description: "Approve a proposed plan for execution.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "Plan ID to approve" },
			},
			required: ["id"],
		},
		execute: async (params) => {
			try {
				const plan = await store.approve(params.id);
				ctx.events?.emit("plans:approved", plan);
				return { content: [{ type: "text", text: `Plan ${plan.id} approved. Status: ${plan.status}` }] };
			} catch (err: any) {
				return { content: [{ type: "text", text: `Failed to approve: ${err.message}` }], isError: true };
			}
		},
	});

	// plan_reject
	ctx.registerTool?.({
		name: "plan_reject",
		description: "Reject a proposed plan with optional feedback.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "Plan ID to reject" },
				feedback: { type: "string", description: "Rejection reason or feedback for re-planning" },
			},
			required: ["id"],
		},
		execute: async (params) => {
			try {
				const plan = await store.reject(params.id, params.feedback);
				ctx.events?.emit("plans:rejected", plan);
				return {
					content: [
						{
							type: "text",
							text: `Plan ${plan.id} rejected.${params.feedback ? ` Feedback: ${params.feedback}` : ""}`,
						},
					],
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: `Failed to reject: ${err.message}` }], isError: true };
			}
		},
	});
}
