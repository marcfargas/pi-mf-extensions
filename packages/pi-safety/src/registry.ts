/**
 * Runtime safety registry.
 *
 * Populated by the agent calling plan_skill_safety after reading skill docs.
 * Queried by the tool_call hook to decide if a bash command is allowed in plan mode.
 */

import { globMatch } from "./glob.js";
import type { SafetyEntry, SafetyLevel } from "./types.js";

/** Validation result for a single command pattern. */
export interface PatternValidation {
	pattern: string;
	valid: boolean;
	reason?: string;
}

const VALID_LEVELS = new Set<string>(["READ", "WRITE"]);

export class SafetyRegistry {
	private entries = new Map<string, SafetyEntry>();

	/**
	 * Register safety patterns for a tool/CLI.
	 * Replaces any previous registration for the same tool.
	 *
	 * Returns validation results — invalid patterns are silently skipped.
	 */
	register(
		tool: string,
		commands: Record<string, string>,
		defaultLevel?: string,
	): { accepted: number; rejected: PatternValidation[] } {
		const validCommands: SafetyEntry["commands"] = [];
		const rejected: PatternValidation[] = [];

		for (const [pattern, level] of Object.entries(commands)) {
			const validation = validatePattern(tool, pattern, level);
			if (validation.valid) {
				validCommands.push({ pattern, level: level as SafetyLevel });
			} else {
				rejected.push(validation);
			}
		}

		const entry: SafetyEntry = {
			commands: validCommands,
			default: (defaultLevel && VALID_LEVELS.has(defaultLevel))
				? defaultLevel as SafetyLevel
				: "WRITE",
		};

		this.entries.set(tool, entry);

		return { accepted: validCommands.length, rejected };
	}

	/**
	 * Resolve a bash command to a safety level.
	 * Returns null if no registry entry matches (caller falls through to existing logic).
	 */
	resolve(command: string): SafetyLevel | null {
		const trimmed = command.trim();

		for (const [_tool, entry] of this.entries) {
			// Check specific patterns first (first match wins)
			for (const { pattern, level } of entry.commands) {
				if (globMatch(pattern, trimmed)) {
					return level;
				}
			}
		}

		// No pattern matched in any entry
		return null;
	}

	/** Get all registered tools and their pattern counts. */
	inspect(): Array<{ tool: string; patterns: number; default: SafetyLevel }> {
		const result: Array<{ tool: string; patterns: number; default: SafetyLevel }> = [];
		for (const [tool, entry] of this.entries) {
			result.push({ tool, patterns: entry.commands.length, default: entry.default });
		}
		return result;
	}

	/** Get detailed info for a specific tool. */
	inspectTool(tool: string): SafetyEntry | undefined {
		return this.entries.get(tool);
	}

	/** Number of registered tools. */
	get size(): number {
		return this.entries.size;
	}

	/** Clear all entries. */
	clear(): void {
		this.entries.clear();
	}
}

/**
 * Validate a command pattern before storing.
 *
 * Rules:
 * - Level must be READ or WRITE
 * - Pattern must not be empty or pure wildcards
 * - Pattern must start with the tool name (prevents overly broad matches)
 */
function validatePattern(tool: string, pattern: string, level: string): PatternValidation {
	if (!VALID_LEVELS.has(level)) {
		return { pattern, valid: false, reason: `invalid level "${level}" (must be READ or WRITE)` };
	}

	const trimmed = pattern.trim();
	if (!trimmed) {
		return { pattern, valid: false, reason: "empty pattern" };
	}

	// Must not be pure wildcards
	const stripped = trimmed.replace(/\*/g, "").replace(/\s+/g, "");
	if (!stripped) {
		return { pattern, valid: false, reason: "pattern is only wildcards" };
	}

	// Pattern must start with the tool name, optionally preceded by a known runner prefix
	// (npx, node, python, etc.). This prevents overly broad patterns.
	const RUNNER_PREFIXES = ["npx", "node", "python", "python3", "deno", "bun", "ruby", "java", "dotnet"];
	const parts = trimmed.split(/\s+/);
	const firstPart = parts[0];
	const secondPart = parts[1];

	const startsWithTool = firstPart === tool || firstPart.startsWith(tool);
	const startsWithRunner = RUNNER_PREFIXES.includes(firstPart)
		&& secondPart != null
		&& (secondPart === tool || secondPart.startsWith(tool));

	if (!startsWithTool && !startsWithRunner) {
		return { pattern, valid: false, reason: `pattern must start with tool name "${tool}" (or a runner prefix like "npx ${tool}")` };
	}

	return { pattern, valid: true };
}
