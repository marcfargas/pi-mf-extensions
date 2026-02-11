# pi-planner — Agent Configuration

## Project Overview
Persistent, auditable plan-then-execute workflow for pi agents.
Pi extension: agent proposes a plan → human reviews → approves/rejects → executor runs.

**Package**: `@marcfargas/pi-planner`
**Type**: Pi extension (loaded via `pi.extensions` in package.json)
**Peer deps**: `@mariozechner/pi-coding-agent >=0.50.0`, `pi-subagents >=0.8.0`

## Architecture

```
src/
  index.ts              — Extension entry point, mode switching, commands, session lifecycle
  tools/
    index.ts            — 5 plan tools (propose, list, get, approve, reject)
    safety.ts           — plan_skill_safety tool (receives agent-extracted classifications)
  mode/hooks.ts         — before_agent_start, tool_call hooks, bash safety, safety registry integration
  safety/
    types.ts            — SafetyLevel, SafetyEntry types
    registry.ts         — Runtime safety registry (register, resolve, inspect)
    glob.ts             — Minimal glob matching for command patterns
    index.ts            — Re-exports
  persistence/
    plan-store.ts       — CRUD + atomic writes + optimistic locking (YAML frontmatter .md files)
    types.ts            — Plan, PlanStep, PlanStatus, PlannerConfig types
    config.ts           — Reads .pi/plans.json for project-level config
  executor/
    runner.ts           — Orchestrates plan execution (step-by-step)
    spawn.ts            — Spawns executor agent via pi-subagents
    checkpoint.ts       — Step checkpointing (.pi/plans/sessions/PLAN-{id}.jsonl)
    preflight.ts        — Pre-flight validation (tools exist, plan is approved)
    stalled.ts          — Stalled plan detection + timeout handling
```

### Key design decisions
- **Plans are .md files** with YAML frontmatter in `.pi/plans/`
- **Optimistic locking** via `version` field — prevents concurrent edit conflicts
- **`setActiveTools()`** hides tools from prompt in plan mode
- **`tool_call` hook** blocks write/edit/todo + destructive bash in plan mode
- **Safety registry** — LLM-as-parser: agent reads skills, extracts safety levels, reports via `plan_skill_safety` tool. Registry enables READ operations in plan mode. No hardcoded tool knowledge.
- **`before_agent_start` hook** injects plan awareness + skill safety extraction instruction
- **Events are convenience, file is source of truth** — crash recovery reads files, not events
- **Plans are for consequential external actions ONLY** — not file edits or dev work

## Plan lifecycle
`proposed` → `approved` → `executing` → `completed` | `failed`
`proposed` → `rejected`
`executing` → `stalled` (timeout detection)
Any → `cancelled`

## Development

```bash
npm test           # vitest run (162 tests)
npm run typecheck  # tsc --noEmit
```

### Testing strategy
- **Unit tests**: plan-store CRUD, parse roundtrip, config, mode-switching (bash safety), checkpoint, preflight, stalled, executor, session-state
- **Integration tests**: full lifecycle, multistep lifecycle, concurrency (optimistic locking)
- All tests use temp directories, no mocking of pi internals

## Current State (Phase A — ~95% complete)

### Done
- Plan CRUD + atomic writes + optimistic locking
- 7 agent-callable tools: plan_mode, plan_propose, plan_list, plan_get, plan_approve, plan_reject, plan_skill_safety
- Skill safety registry: LLM-as-parser for safety classifications (READ/WRITE)
- before_agent_start hook (plan awareness + skill safety extraction instruction)
- tool_call hook (blocks write/edit/todo/destructive-bash in plan mode, with registry-based READ passthrough)
- Config loading (.pi/plans.json)
- /plan, /plans, /safety TUI commands
- Session state persistence via appendEntry
- Stalled plan detection + crash recovery
- SKILL.md, MOTIVATION.md, README.md
- 240 tests passing, tsc clean

### Remaining
- Verify write/edit/todo blocking in fresh session (code committed, needs reload)
- /plan and /plans interactive TUI testing
- GitHub remote + first publish
- Phase B: TUI polish (widgets, notifications, status bar)
- Phase C: executor agent spawning via pi-subagents (4-5 weeks estimate)

## Style
- TypeScript, ESM, no default exports except `activate()`
- Vitest for tests, TypeBox for tool schemas
- Tabs for indentation, double quotes
