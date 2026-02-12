/**
 * Safety classification types for the skill safety registry.
 *
 * pi-planner collapses all skill-side safety levels into a binary:
 * - READ: allow in plan mode (pure queries, no side effects)
 * - WRITE: block in plan mode (everything else — must go into a plan)
 */

export type SafetyLevel = "READ" | "WRITE";

export interface SafetyEntry {
	/** Glob patterns mapped to safety levels. Checked in order, first match wins. */
	commands: Array<{ pattern: string; level: SafetyLevel }>;
	/** Fallback level when no pattern matches. Defaults to WRITE. */
	default: SafetyLevel;
}
