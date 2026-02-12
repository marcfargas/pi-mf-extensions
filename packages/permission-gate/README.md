# @marcfargas/permission-gate

Tool permission enforcement for pi agents — gates tool calls based on safety classifications.

> **Status**: Skeleton. Full implementation will be extracted from `@marcfargas/pi-planner` in a future iteration.

## Planned Features

- `plan_skill_safety` tool for agents to register skill safety levels
- Bash command filtering based on READ/WRITE classifications
- `/safety` command for inspecting the registry
- Configurable enforcement modes (log, warn, block)

## Relationship to Other Packages

- **@marcfargas/pi-safety** — Core safety registry (types, glob matching, classification)
- **@marcfargas/permission-gate** — Pi extension that enforces safety classifications (this package)
- **@marcfargas/pi-planner** — Plan workflow that uses both for plan-mode enforcement
