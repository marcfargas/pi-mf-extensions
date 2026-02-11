# pi-planner

Persistent, auditable plan-then-execute workflow for [pi](https://github.com/nicholasgasior/pi-coding-agent) agents.

Agent proposes a plan → human reviews → approves or rejects → executor runs.

```
┌─────────────────────────────────────────────────┐
│  UI Layer (pluggable)                           │
│  TUI (/plan, /plans)  │  Chat gateway  │  SDK   │
├─────────────────────────────────────────────────┤
│  @marcfargas/pi-planner                         │
│  Plan tools │ Mode switching │ Persistence      │
├─────────────────────────────────────────────────┤
│  pi Agent Session                               │
└─────────────────────────────────────────────────┘
```

## Why

AI agents that write to external systems (ERP, email, calendars) need guardrails. Confirmation per tool call doesn't work — you can't assess a 5-step workflow one click at a time.

pi-planner lets the agent propose the full sequence, the human review it as a unit, and approve once. Plans persist on disk as markdown files — auditable, diffable, survives crashes.

See [MOTIVATION.md](MOTIVATION.md) for the full rationale.

## Install

```bash
npm install @marcfargas/pi-planner
```

Add to your pi config:

```json
{
  "pi": {
    "extensions": ["@marcfargas/pi-planner"]
  }
}
```

### Peer dependencies

- `@mariozechner/pi-coding-agent` >= 0.50.0
- `pi-subagents` >= 0.8.0 (optional — needed for plan execution)

## Agent tools

The extension registers 6 tools the agent can call:

| Tool | Description |
|------|-------------|
| `plan_mode` | Enter/exit plan mode (read-only + plan tools) |
| `plan_propose` | Propose a plan with title, steps, and context |
| `plan_list` | List plans, optionally filtered by status |
| `plan_get` | Get full details of a plan by ID |
| `plan_approve` | Approve a proposed plan |
| `plan_reject` | Reject a plan with optional feedback |

### When to plan

Plans are for **consequential external actions** — Odoo writes, email sends, calendar changes, deployments, anything irreversible or on behalf of others.

**Not** for file edits, git, build/test, or reading from systems. Those are normal dev work — just do them.

The [SKILL.md](SKILL.md) file guides the agent on when to enter plan mode and when to propose.

## TUI commands

| Command | What it does |
|---------|-------------|
| `/plan` | Toggle plan mode, or review pending plans if any exist |
| `/plans` | Browse all plans — approve, reject, delete, cancel, view details |

## Plan mode

When the agent enters plan mode (`plan_mode(enable: true)`):

- **Allowed**: `read`, safe `bash` (ls, cat, grep, git status…), all `plan_*` tools
- **Blocked**: `write`, `edit`, destructive bash (rm, git push, npm install…)

This prevents accidental side effects while the agent researches and builds the plan.

## Plan storage

Plans are markdown files with YAML frontmatter, stored in the project:

```
{project}/.pi/plans/
├── PLAN-a1b2c3d4.md        # Plan files
├── sessions/                # Executor step logs
│   └── PLAN-a1b2c3d4.jsonl
└── artifacts/               # Large context data
    └── PLAN-a1b2c3d4/
```

Example plan file:

```markdown
---
id: PLAN-a1b2c3d4
title: "Send invoice reminder to Acme Corp"
status: proposed
version: 1
created_at: 2026-02-11T12:00:00Z
updated_at: 2026-02-11T12:00:00Z
tools_required:
  - odoo-toolbox
  - go-easy
---

## Steps
1. Query overdue invoices for Acme Corp (odoo-toolbox: search → account.move)
2. Send payment reminder email (go-easy: send → billing@acme.com)
3. Log reminder activity on invoice (odoo-toolbox: write → account.move)

## Context
Invoice INV-2024-0847 is 30 days overdue. Amount: €1,500.
```

## Plan lifecycle

```
proposed ──┬──► approved ──► executing ──┬──► completed
           │                             ├──► failed
           ├──► rejected                 └──► stalled (timeout)
           └──► cancelled
```

- **Optimistic locking**: version increments on every write — concurrent edits are detected
- **Crash recovery**: plans stuck in `executing` past the timeout are marked `stalled`
- **Atomic writes**: temp file + rename to prevent corruption

## Configuration

Optional. Create `.pi/plans.json` in your project:

```json
{
  "guardedTools": [],
  "stale_after_days": 30,
  "executor_timeout_minutes": 30
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `guardedTools` | `[]` | Tool names that log a warning when called without an active plan. Empty = no guards. |
| `stale_after_days` | `30` | Days before a proposed plan is considered stale |
| `executor_timeout_minutes` | `30` | Minutes before an executing plan is marked stalled |

## Architecture

```
src/
  index.ts                  Entry point — mode switching, TUI commands, session lifecycle
  tools/index.ts            Plan tools (propose, list, get, approve, reject)
  mode/hooks.ts             Hooks — before_agent_start, tool_call blocking, bash safety
  persistence/
    plan-store.ts           CRUD, atomic writes, optimistic locking, cache
    types.ts                Plan, PlanStep, PlanStatus, PlannerConfig
    config.ts               Reads .pi/plans.json
  executor/
    runner.ts               Plan execution orchestration
    spawn.ts                Subagent spawning via pi-subagents
    checkpoint.ts           Step checkpointing (JSONL)
    preflight.ts            Pre-flight validation (tools exist, plan is approved)
    stalled.ts              Stalled detection + timeout
```

### Extension hooks

- **`before_agent_start`**: injects plan-mode context — pending plans, executing plans, guarded tools list
- **`tool_call`**: blocks write/edit/destructive-bash in plan mode; logs guarded tool calls without a plan
- **`session_start`**: restores plan mode state, detects stalled plans from previous session
- **`context`**: filters stale plan-mode messages when not in plan mode

## Development

```bash
npm test            # vitest (166 tests)
npm run typecheck   # tsc --noEmit
```

## Status

Phase A (core) is ~95% complete. See [VISION.md](VISION.md) for the full design document and roadmap.

## License

MIT
