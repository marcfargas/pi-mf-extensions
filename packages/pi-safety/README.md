# @marcfargas/pi-safety

Safety classification registry for pi agent tool calls.

Provides glob-based command pattern matching to classify bash commands as `READ` (safe, no side effects) or `WRITE` (requires approval/planning).

## Usage

```typescript
import { SafetyRegistry, globMatch } from "@marcfargas/pi-safety";

const registry = new SafetyRegistry();

// Register safety patterns from a skill
registry.register("go-gmail", {
  "npx go-gmail * search *": "READ",
  "npx go-gmail * send *": "WRITE",
}, "WRITE");

// Resolve a command
registry.resolve("npx go-gmail marc@example.com search 'invoice'");
// → "READ"

registry.resolve("npx go-gmail marc@example.com send --to bob@example.com");
// → "WRITE"

registry.resolve("curl https://example.com");
// → null (no matching registry entry)
```

## API

### `SafetyRegistry`

- `register(tool, commands, defaultLevel?)` — Register command patterns for a tool
- `resolve(command)` — Resolve a command to READ/WRITE/null
- `inspect()` — List registered tools
- `inspectTool(tool)` — Get patterns for a tool
- `size` — Number of registered tools
- `clear()` — Clear all entries

### `globMatch(pattern, command)`

Match a glob pattern against a command string. `*` matches any sequence of characters.

### Types

- `SafetyLevel` — `"READ" | "WRITE"`
- `SafetyEntry` — `{ commands: Array<{pattern, level}>, default: SafetyLevel }`
