/**
 * Plan data types and schema.
 */

export type PlanStatus =
	| "proposed"
	| "approved"
	| "executing"
	| "completed"
	| "failed"
	| "rejected"
	| "cancelled"
	| "stalled"
	| "needs_review";

export interface PlanStep {
	description: string;
	tool: string;
	operation: string;
	target?: string;
}

export interface Plan {
	// Identity
	id: string;
	title: string;
	status: PlanStatus;
	version: number;

	// Timestamps
	created_at: string;
	updated_at: string;

	// Planning
	planner_model?: string;
	tools_required: string[];
	executor_model?: string;

	// Execution (filled when executor runs)
	execution_session?: string;
	execution_started_at?: string;
	execution_ended_at?: string;
	result_summary?: string;

	// Body content (markdown)
	steps: PlanStep[];
	context?: string;
	body?: string;
}

export interface PlanListOptions {
	status?: PlanStatus | PlanStatus[];
}
