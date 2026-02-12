# pi-planner

Monorepo for plan-then-execute workflow and safety tools for [pi](https://github.com/mariozechner/pi-coding-agent) agents.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@marcfargas/pi-planner`](packages/pi-planner/) | 0.2.0 | Persistent, auditable plan-then-execute workflow — propose → review → approve → execute |
| [`@marcfargas/pi-safety`](packages/pi-safety/) | 0.1.0 | Safety classification registry — glob-based READ/WRITE command matching |
| [`@marcfargas/permission-gate`](packages/permission-gate/) | 0.1.0 | Tool permission enforcement extension _(skeleton)_ |

## Development

```bash
# Install all workspaces
npm install

# Run all tests
npm test

# Typecheck all packages
npm run typecheck

# Run tests for a specific package
cd packages/pi-planner && npm test
```

## Changesets

Each package is independently versioned using [changesets](https://github.com/changesets/changesets).

```bash
# Create a changeset
npx changeset

# Version packages
npx changeset version

# Publish
npx changeset publish
```

## Architecture

```
@marcfargas/pi-safety          ← Core: glob matching, safety registry, types
     ↑                ↑
@marcfargas/pi-planner    @marcfargas/permission-gate
(plan workflow)            (tool gating, skeleton)
```

**pi-safety** provides the safety classification primitives. **pi-planner** uses them for plan-mode enforcement. **permission-gate** will provide standalone tool permission enforcement usable without the full plan workflow.
