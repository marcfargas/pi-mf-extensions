/**
 * Executor spawning via pi-subagents.
 *
 * Phase C implementation. Generates ephemeral executor agent config from plan,
 * spawns via pi-subagents, captures result, updates plan status.
 */

import type { Plan } from "../persistence/types.js";

/**
 * Build executor system prompt from plan.
 */
export function buildExecutorPrompt(plan: Plan): string {
	const toolList = plan.tools_required.join(", ");
	const stepList = plan.steps
		.map((s, i) => `${i + 1}. ${s.description} (${s.tool}: ${s.operation}${s.target ? ` → ${s.target}` : ""})`)
		.join("\n");

	return `You are a plan executor. You follow a pre-approved plan exactly.

## Plan: ${plan.title}

## Available Tools
${toolList}

## Steps
${stepList}

${plan.context ? `## Context\n${plan.context}\n` : ""}

## Rules
- Follow the plan steps in order
- If a step fails, STOP immediately and report the failure
- Do NOT improvise beyond the plan scope
- Do NOT use bash to work around missing tools
- Report each step's outcome clearly
- If real-world state doesn't match the plan's assumptions, STOP and report
- If a step references an entity without a unique identifier, STOP and report "ambiguous step"
- Do NOT attempt to undo previous steps unless the plan explicitly includes rollback steps

You are NOT a general-purpose agent. You are a plan executor.`;
}

/**
 * Render plan as executor task string.
 */
export function renderPlanForExecutor(plan: Plan): string {
	return `Execute approved plan ${plan.id}: "${plan.title}"

Follow the steps in order. Report each step's outcome.`;
}
