# @marcfargas/pi-safety

Safety classification registry for pi agent tool calls.

Provides glob-based command pattern matching to classify bash commands as `READ` (safe, no side effects) or `WRITE` (requires approval/planning).

## Usage

```typescript
import { SafetyRegistry, globMatch } from "@marcfargas/pi-safety";

const registry = new SafetyRegistry();

// Register safety patterns from a skill
// Tool name is the CLI name; patterns can include runner prefixes (npx, node, etc.)
registry.register("go-gmail", {
  "npx go-gmail * search *": "READ",
  "npx go-gmail * get *": "READ",
  "npx go-gmail * send *": "WRITE",
  "npx go-gmail * draft *": "WRITE",
}, "WRITE");

// Resolve a command
registry.resolve("npx go-gmail marc@example.com search 'invoice'");
// → "READ"

registry.resolve("npx go-gmail marc@example.com send --to bob@example.com");
// → "WRITE"

registry.resolve("curl https://example.com");
// → null (no matching registry entry)
```

### Pattern Validation

Patterns must start with the tool name, optionally preceded by a runner prefix:

```typescript
// ✅ Valid patterns for tool "go-gmail"
"go-gmail * search *"         // direct invocation
"npx go-gmail * search *"    // npx runner prefix

// ✅ Valid patterns for tool "gcloud"
"gcloud * list *"             // direct invocation

// ❌ Rejected patterns
"* search *"                  // wildcard before tool name
"search go-gmail"             // tool name not at start
```

Supported runner prefixes: `npx`, `node`, `python`, `python3`, `deno`, `bun`, `ruby`, `java`, `dotnet`.

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
