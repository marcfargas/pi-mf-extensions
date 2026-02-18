# pi-mf-extensions

[![CI](https://github.com/marcfargas/pi-mf-extensions/actions/workflows/ci.yml/badge.svg)](https://github.com/marcfargas/pi-mf-extensions/actions/workflows/ci.yml)

[Pi](https://github.com/mariozechner/pi-coding-agent) extensions by Marc Fargas.

Small, focused extensions for the pi coding agent — published independently via npm, developed together in this monorepo.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@marcfargas/pi-planner](packages/pi-planner/) | Plan-then-execute workflow for agents | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-planner)](https://www.npmjs.com/package/@marcfargas/pi-planner) |
| [@marcfargas/pi-powershell](packages/pi-powershell/) | PowerShell tool for Windows system integration | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-powershell)](https://www.npmjs.com/package/@marcfargas/pi-powershell) |
| [@marcfargas/pi-safety](packages/pi-safety/) | Safety classification registry | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-safety)](https://www.npmjs.com/package/@marcfargas/pi-safety) |
| [@marcfargas/pi-test-harness](packages/pi-test-harness/) | Test harness for pi extensions | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-test-harness)](https://www.npmjs.com/package/@marcfargas/pi-test-harness) |
| [@marcfargas/permission-gate](packages/permission-gate/) | Tool permission enforcement _(skeleton)_ | — |

## Extensions

### [@marcfargas/pi-planner](packages/pi-planner/)

Plan-then-execute workflow for agents that touch external systems. Agent proposes a plan → human reviews → approves → agent executes in-session.

```bash
npm install @marcfargas/pi-planner
```

```json
{ "pi": { "extensions": ["@marcfargas/pi-planner"] } }
```

**Tools:** `plan_mode`, `plan_propose`, `plan_list`, `plan_get`, `plan_approve`, `plan_reject`, `plan_skill_safety`, `plan_run_script`
**Commands:** `/plan`, `/plans`, `/safety`

Plans persist as markdown in `.pi/plans/` — auditable, diffable, survives crashes. Includes plan mode (read-only tool restriction), skill safety registry (LLM-as-parser for READ/WRITE classification), retry/clone for failed plans, and crash recovery.

→ [Full documentation](packages/pi-planner/README.md)

### [@marcfargas/pi-powershell](packages/pi-powershell/)

PowerShell tool for Windows system integration and background processes. Solves Git Bash limitations that cause session hangs and orphaned processes.

```bash
npm install @marcfargas/pi-powershell
```

```json
{ "pi": { "extensions": ["@marcfargas/pi-powershell"] } }
```

**Tools:** `powershell`, `pwsh-start-job`, `pwsh-get-job`, `pwsh-stop-job`, `pwsh-remove-job`, `pwsh-get-job-output` — Execute PowerShell commands and manage background jobs with proper error handling.

Use PowerShell for Windows-specific operations while keeping Bash for familiar Unix commands. Includes both a general PowerShell tool and specialized job management helpers for background processes, process control, Windows services, and system integration tasks that cause issues in Git Bash.

→ [Full documentation](packages/pi-powershell/README.md)

## Libraries

### [@marcfargas/pi-safety](packages/pi-safety/)

Safety classification registry — glob-based READ/WRITE command matching. Used by pi-planner and permission-gate, but usable standalone in any pi extension.

```typescript
import { SafetyRegistry } from "@marcfargas/pi-safety";

const registry = new SafetyRegistry();
registry.register("go-gmail", {
  "npx go-gmail * search *": "READ",
  "npx go-gmail * send *": "WRITE",
}, "WRITE");

registry.resolve("npx go-gmail marc@acme.com search 'invoice'");
// → "READ"
```

→ [Full documentation](packages/pi-safety/README.md)

## Testing

### [@marcfargas/pi-test-harness](packages/pi-test-harness/)

Test harness for pi extensions — playbook-based model mocking with real extension execution. Tests run in real `AgentSession` environments with real extension loading, hooks, and tool wrapping — without LLM calls.

```bash
npm install --save-dev @marcfargas/pi-test-harness
```

```typescript
import { createTestSession, when, calls, says } from "@marcfargas/pi-test-harness";

const t = await createTestSession({
  extensions: ["./src/index.ts"],
  mockTools: { bash: "ok", read: "contents", write: "written", edit: "edited" },
});

await t.run(
  when("Enter plan mode", [
    calls("plan_mode", { enable: true }),
    says("Plan mode active."),
  ]),
);

expect(t.events.toolResultsFor("plan_mode")[0].text).toContain("enabled");
t.dispose();
```

Three substitution points — everything else runs for real:

| Substituted | With | Purpose |
|-------------|------|---------|
| `streamFn` | Playbook | Scripts what the model "decides" |
| `tool.execute()` | Mock handler | Controls what tools "return" (per-tool opt-in) |
| `ctx.ui.*` | Mock UI | Controls what the user "answers" |

→ [Full documentation](packages/pi-test-harness/README.md)

## Development

```bash
npm install               # Install all workspaces
npm test                  # Run all tests (286 tests across 21 files)
npm run typecheck         # Typecheck all packages
```

Packages are independently versioned with [changesets](https://github.com/changesets/changesets):

```bash
npx changeset             # Create a changeset
npx changeset version     # Bump versions
npx changeset publish     # Publish to npm
```

### Monorepo Structure

```
packages/
├── pi-planner/          # Plan-then-execute extension
├── pi-safety/           # Safety classification library
├── pi-test-harness/     # Extension test harness
├── permission-gate/     # Permission enforcement (skeleton)
experiments/
├── pi-test-harness/     # Design docs and reviews
```

## License

MIT
