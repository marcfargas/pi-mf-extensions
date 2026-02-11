/**
 * Minimal glob matching for safety command patterns.
 *
 * Only supports `*` as a wildcard matching any sequence of characters (including empty).
 * Patterns are matched against the full bash command string.
 *
 * Examples:
 *   "npx go-gmail * search *" matches "npx go-gmail marc@blegal.eu search 'invoice'"
 *   "gcloud * list *" matches "gcloud compute instances list --format=json"
 */

/**
 * Match a glob pattern against a command string.
 * Case-sensitive. `*` matches any sequence of characters (including empty).
 */
export function globMatch(pattern: string, command: string): boolean {
	// Escape regex special chars, then replace * with .*
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`).test(command.trim());
}
