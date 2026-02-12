# pi-mf-extensions

[Pi](https://github.com/mariozechner/pi-coding-agent) extensions by Marc Fargas.

Small, focused extensions for the pi coding agent — published independently via npm, developed together in this monorepo.

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

### [@marcfargas/permission-gate](packages/permission-gate/) _(skeleton)_

Standalone tool permission enforcement — gates tool calls based on safety classifications. Usable without the full plan workflow.

→ [Documentation](packages/permission-gate/README.md)

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

## Development

```bash
npm install               # Install all workspaces
npm test                  # Run all tests
npm run typecheck         # Typecheck all packages
```

Packages are independently versioned with [changesets](https://github.com/changesets/changesets):

```bash
npx changeset             # Create a changeset
npx changeset version     # Bump versions
npx changeset publish     # Publish to npm
```

## License

MIT
