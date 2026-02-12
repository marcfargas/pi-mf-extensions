/**
 * permission-gate — Tool permission enforcement for pi agents.
 *
 * Standalone pi extension that gates tool calls based on safety classifications
 * from @marcfargas/pi-safety. Can be used independently of pi-planner for
 * any pi project that needs tool-call safety enforcement.
 *
 * Features:
 * - Registers plan_skill_safety tool for agents to report skill safety levels
 * - Blocks WRITE-classified bash commands unless explicitly allowed
 * - Provides /safety command to inspect the registry
 *
 * TODO: Extract safety enforcement from pi-planner into this package.
 * Currently a skeleton — the full implementation will be migrated from
 * pi-planner's mode/hooks.ts and tools/safety.ts in a future iteration.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function activate(_pi: ExtensionAPI): void {
	// Skeleton — implementation will be extracted from pi-planner
}
