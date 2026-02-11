# Plan Mode — Vision v2

> Post-review revision. Incorporates feedback from 4-reviewer design sprint (2 arch, 2 impl).
> See `reviews/synthesis.md` for full analysis.

> Persistent, auditable plan-then-execute workflow for pi agents.
> Composable pi package: works in TUI, chat-agents, pi-dashboard, anywhere.
> Independent repository with its own testing, releases, and documentation.

## What Changed from v1

| Area | v1 | v2 (post-review) |
|------|-----|-------------------|
| Frontmatter | 15+ fields | 10 fields — cut `risk_level`, `reversible`, `supersedes`, `feedback` |
| Phase order | A→B(executor)→C(TUI) | A→B(TUI)→C(executor) — validate UX before executor complexity |
| Phase B estimate | 1 week | 4-5 weeks (reviewers unanimous: underestimated) |
| pi-subagents | Open question | Decided: required peer dependency |
| Tool scoping | "Executor gets ONLY those tools" | Specified: prompt + tool_call logging (Phase A), enforcement (Phase C) |
| Context flow | Unspecified | Structured schema: tool_outputs + notes, 50KB cap |
| Crash recovery | "STOP and report" | Step checkpointing + stalled detection + documented limitations |
| Event durability | Implied reliable | Explicit: events are optimizations, plan file is source of truth |
| Concurrency | Not addressed | Allow concurrent execution, optimistic locking via version field |
| `guardedTools` | Vague | Precise: exact tool names, off by default, logging-only in Phase A |

## Decisions Made

### 1. pi-subagents is a required peer dependency

pi-subagents is published (v0.8.1), stable, and already handles model selection, agent configs, and lifecycle. Declaring it as a peer dep is cleaner than vendoring.

```json
{
  "peerDependencies": {
    "pi-subagents": ">=0.8.0"
  }
}
```

If not installed, the extension loads but executor spawning fails with a clear error. Plan CRUD, propose, approve/reject all work without it.

### 2. Tool scoping: prompt-only in Phase A, enforcement in Phase C

**Phase A**: Executor system prompt says "you ONLY have [tools list]." `tool_call` hook **logs** out-of-scope tool attempts but does not block. This generates training data for tuning.

**Phase C**: `tool_call` hook enforces — rejects calls to tools not in `tools_required` with: "Tool not available in plan scope. Only [list] are available."

Bash is always excluded from executor agents unless explicitly listed in `tools_required`.

### 3. Context schema is structured

```yaml
# In plan body (markdown)
## Context

### Tool Outputs
```json
{
  "odoo_read_invoice_123": {
    "tool": "odoo-toolbox",
    "operation": "read",
    "data": { "id": 123, "partner_id": 456, "amount_total": 1500.00 }
  }
}
```

### Notes
User mentioned payment should go through bank account XYZ.

### Artifacts
- invoice-2024-0847.pdf → .pi/plans/artifacts/PLAN-abc123/
```

Size cap: 50KB inline context. Larger data goes to `.pi/plans/artifacts/<plan-id>/`.

## Architecture

Unchanged from v1. Three layers: UI (pluggable) → Package (plan-mode) → pi session.

```
┌─────────────────────────────────────────────────┐
│  UI Layer (pluggable)                           │
│  TUI (/plan, select) │ Chat GW (Cards) │ Dash  │
├─────────────────────────────────────────────────┤
│  @marcfargas/pi-plan-mode                       │
│  Plan persistence │ Plan tools │ Mode switching │
│  Executor spawn │ Events (convenience, not SoT) │
├─────────────────────────────────────────────────┤
│  pi Agent Session                               │
└─────────────────────────────────────────────────┘
```

**Events are convenience, not source of truth.** The plan file on disk is authoritative. If a `plans:proposed` event is lost (crash, no subscriber), the plan still exists in `.pi/plans/` and will be found by polling or `/plans` command.

## Plan Storage

```
{project}/.pi/plans/
├── PLAN-a1b2c3d4.md
├── PLAN-e5f6g7h8.md
├── sessions/              # Executor session logs
│   └── PLAN-a1b2c3d4.jsonl
├── artifacts/             # Large context data
│   └── PLAN-a1b2c3d4/
└── archive/               # Completed/rejected after retention
```

Project-scoped. In chat-agents, each user workspace is a project → natural isolation.

### Plan Frontmatter (v2 — leaner)

```yaml
id: PLAN-a1b2c3d4
title: "Tramitar factura 2024-0847 de Fabbula en Odoo"
status: proposed        # proposed | approved | executing | completed | failed | rejected | cancelled | stalled
version: 1              # Incremented on every write (optimistic locking)
created_at: 2026-02-11T12:00:00Z
updated_at: 2026-02-11T12:05:00Z

# Planning
planner_model: claude-sonnet-4-5
tools_required:
  - odoo-toolbox
  - go-easy
executor_model: claude-haiku-4-5

# Execution (filled when executor runs)
execution_session: .pi/plans/sessions/PLAN-a1b2c3d4.jsonl
execution_started_at:
execution_ended_at:
result_summary:
```

**Cut from v1**: `risk_level`, `reversible` (per-step), `supersedes`, `feedback`. Add when consumers exist.

**Added**: `version` for optimistic locking, `stalled` status for crash detection.

### Plan Body Structure

```markdown
## Steps
1. Fetch invoice 2024-0847 from Odoo (odoo-toolbox: read)
2. Send payment reminder to client (go-easy: gmail send)
3. Update invoice status to "reminder sent" (odoo-toolbox: write)

## Context
[Structured tool outputs + notes + artifact refs — see schema above]

## Risks
- Client email might bounce (check contact before sending)
- Invoice might already be paid (check status before reminder)
```

### File Operations

Atomic write via temp file + rename:

```typescript
async function updatePlan(planId: string, updater: (plan: Plan) => void): Promise<void> {
  const planPath = `.pi/plans/PLAN-${planId}.md`;
  const tmpPath = `${planPath}.tmp-${Date.now()}`;
  
  const plan = parsePlan(await fs.readFile(planPath, 'utf-8'));
  const expectedVersion = plan.version;
  
  updater(plan);
  plan.version++;
  plan.updated_at = new Date().toISOString();
  
  await fs.writeFile(tmpPath, serializePlan(plan), 'utf-8');
  
  // Re-read and check version hasn't changed (optimistic lock)
  const current = parsePlan(await fs.readFile(planPath, 'utf-8'));
  if (current.version !== expectedVersion) {
    await fs.unlink(tmpPath);
    throw new Error(`Plan was modified concurrently (expected v${expectedVersion}, found v${current.version})`);
  }
  
  await fs.rename(tmpPath, planPath); // Atomic on all platforms
}
```

## When to Plan

Unchanged from v1 — all reviewers praised this section. See the decision tree and tables in v1.

**Addition from review feedback**: Phase A includes a dry-run logging mode where `tool_call` hook logs "would have blocked X" without blocking. This generates training data for tuning SKILL.md guidance before enabling enforcement in production.

## Plan Tools

### `plan_propose`

```typescript
{
  name: "plan_propose",
  parameters: Type.Object({
    title: Type.String(),
    steps: Type.Array(Type.Object({
      description: Type.String(),
      tool: Type.String(),
      operation: Type.String(),
      target: Type.Optional(Type.String()),
    })),
    context: Type.Optional(Type.String({ description: "Structured context (tool outputs, notes)" })),
  }),
}
```

**Simplified from v1**: Removed `risk_level` and `reversible` from tool params. The planner doesn't need to assess risk in v1 — that's a v2 feature.

### `plan_list` / `plan_get` / `plan_approve` / `plan_reject`

Standard CRUD. Both agent-callable and UI-callable.

`plan_approve` triggers executor spawning (Phase C+). Before Phase C, approval just sets status — execution is manual.

`plan_reject` accepts optional feedback string. Rejection history stored in plan body (not frontmatter).

## Executor (Phase C)

### Pre-flight Validation

Before spawning, validate:
1. All `tools_required` exist in the current environment
2. Plan status is `approved` (not stale, not already executing)
3. Plan version matches (no concurrent modification)

Fail with clear error if any check fails.

### Tool Scoping

Executor agent config loads ONLY the tools listed in `tools_required`. Bash is excluded unless explicitly listed.

**Phase A-B**: Prompt-only enforcement ("you only have [list]") + `tool_call` logging.
**Phase C**: `tool_call` hook rejects out-of-scope tools: "Tool X not available in plan scope."

### Tool Inventory for Planner

The extension builds a tool manifest at startup:

```
Available executor tools:
- odoo-toolbox: read, write, create, delete, search
- go-easy: gmail (search, draft, send), calendar (list, create, delete)
```

Injected via `before_agent_start`. Planner uses this to populate `tools_required` accurately.

### Step Checkpointing

Executor logs each step result to `.pi/plans/sessions/PLAN-{id}.jsonl`:

```jsonl
{"step": 1, "tool": "odoo", "op": "read", "status": "success", "result_summary": "Invoice found"}
{"step": 2, "tool": "gmail", "op": "send", "status": "failed", "error": "Recipient not found"}
```

On crash recovery:
- Plan stays in `executing` status
- Next session: "Plan PLAN-abc is stuck in executing (started 3h ago). Steps 1/3 completed. Resume / Mark failed / Cancel?"
- If timeout exceeded (configurable, default 30min): status → `stalled`

### Partial Failure Policy

**v1: fail and report.** No automatic rollback.

Executor prompt includes:
> If a step fails, STOP immediately. Do NOT attempt to undo previous steps unless the plan explicitly includes rollback steps. Report: which steps succeeded, which failed, what state was left behind.

Documented limitation in MOTIVATION.md. Rollback is a v2 feature.

### Planner/Executor Patterns

Two patterns, explicitly defined:

**TUI (direct)**: `/plan` toggles mode on current session. Agent calls `plan_propose`. No subagent for planning. Executor is a subagent.

**Chat-agents (delegated)**: Gateway spawns short-lived planner subagent (read-only tools + plan_propose). Once plan is proposed, planner exits. Executor is a separate subagent.

## Plan Lifecycle

```
             ┌──────────────────────────┐
             │                          │
             ▼                          │
  proposed ──┬──► approved ──► executing ──┬──► completed
             │                             │
             ├──► rejected                 ├──► failed
             │       │                     │
             │       ▼ (feedback)          └──► stalled (timeout)
             │   proposed (v2, max 3)
             │       │
             │       ▼ (3rd rejection)
             │   needs_review             ← human must intervene
             │
             └──► cancelled               ← stale timeout or user cancel
```

**Stale timeout**: default 7 days (chat-agents), 30 days (TUI). Configurable in `.pi/plans.json`. Not silent — UI shows "plan expired" notification.

**Re-planning**: Max 3 versions. Full rejection history stored in plan body. Planner receives all prior feedback. After 3rd rejection → `needs_review` status (not auto-escalation — human sees it in their workflow).

## `guardedTools` Configuration

```json
// .pi/plans.json
{
  "guardedTools": [],              // TUI default: nothing guarded
  "stale_after_days": 30,          // TUI default
  "executor_timeout_minutes": 30
}
```

Syntax: exact tool operation names matching the tool registry. Examples:
- `"odoo_create"`, `"odoo_update"`, `"odoo_delete"`
- `"gmail_send"`
- `"calendar_create"`, `"calendar_delete"`

**Phase A**: logging-only (log when a guarded tool is called without a plan).
**Phase C+**: blocking (reject with helpful message directing to `plan_propose`).

## Failure Modes

### Over-planning (most likely failure)
Agent plans for trivial actions. User gets frustrated, disables the feature.
**Mitigation**: SKILL.md guidance, dry-run logging, iterative tuning. TUI has no guards by default.

### Under-planning (most dangerous failure)
Agent sends email or writes to Odoo without approval.
**Mitigation**: `guardedTools` in chat-agents blocks the action. Prompt drift is caught by the hook.

### Executor crash mid-plan
Leaves orphaned state (e.g., invoice created, email not sent).
**Mitigation**: Step checkpointing, stalled detection, documented "fail and report" policy. No auto-rollback in v1.

### Stale plan accumulation
Plans pile up in `proposed` status.
**Mitigation**: Configurable stale timeout → auto-cancel with notification. `/plans` shows pending count.

### Planner hallucination
Plan includes impossible steps or non-existent tools.
**Mitigation**: Pre-flight validation at approval time. Fail before spawning executor.

## Implementation Phases (revised)

### Phase A: Core Package (3 weeks)

New repo: `github.com/marcfargas/pi-plan-mode`

Week 1: Plan CRUD + tests
- Frontmatter parsing, create/read/update/list
- Atomic writes with optimistic locking
- In-memory cache with write-through to disk
- Unit tests (CRUD, concurrent writes, file integrity)

Week 2: Tools + mode switching
- `plan_propose`, `plan_list`, `plan_get`, `plan_approve`, `plan_reject`
- `/plan` command (adapt from existing example)
- `before_agent_start` prompt injection
- `tool_call` hook (logging-only, dry-run mode)
- SKILL.md

Week 3: Events + docs + integration tests
- `pi.events` emission
- MOTIVATION.md (failure modes, comparisons to alternatives)
- Integration tests (mock ctx.ui, full plan lifecycle)

**Milestone**: Plans can be created, listed, approved, rejected. No execution yet.

### Phase B: TUI Integration (1 week)

- `ctx.ui.select` for plan approval
- Plan detail viewer
- `/plans` command
- Progress widget during execution (stub — no executor yet)

**Milestone**: TUI approval flow works end-to-end. Plan structure validated through real usage.

### Phase C: Executor (4-5 weeks)

Week 1: Agent config + tool scoping
- Executor config generation from plan
- Tool inventory manifest
- Tool whitelist enforcement via `tool_call` hook
- Pre-flight validation (tools exist, plan is approved)

Week 2: Subagent spawning + result capture
- Spawn via pi-subagents
- Result → plan status update
- Session linking

Week 3: Checkpointing + failure handling
- Step-level JSONL logging
- Stalled detection + timeout
- Crash recovery (resume/fail/cancel options)

Week 4: Testing + hardening
- Integration tests (mock pi-subagents)
- Concurrent execution tests
- Edge cases (plan modified during execution, tool unavailable at runtime)

Week 5: Buffer for inevitable surprises

**Milestone**: Full plan-then-execute loop with crash recovery.

### Phase D: Chat-Agents Integration (1-2 weeks)

- Event protocol documented
- `guardedTools` blocking mode
- Gateway integration examples
- Role-specific `before_agent_start` templates

### Phase E: Analytics + Pruning (defer post-launch)

- `/plan-stats` with tool gap detection
- Retention policy enforcement
- Archive cleanup

## Testing Strategy

```
tests/
├── unit/
│   ├── plan-crud.test.ts          # File I/O, parsing, validation, locking
│   ├── mode-switching.test.ts     # setActiveTools, tool_call hook
│   ├── tool-call-hook.test.ts     # guarded tools, logging vs blocking
│   └── event-emission.test.ts     # pi.events calls
├── integration/
│   ├── tui-flow.test.ts           # Mock ctx.ui, test approval/rejection handlers
│   ├── executor-spawn.test.ts     # Mock pi-subagents, test config generation
│   ├── full-lifecycle.test.ts     # Real file I/O, full plan lifecycle
│   └── concurrency.test.ts        # Parallel writers, file integrity
└── fixtures/
    └── sample-plans/              # Test data
```

Mocking strategy:
- `ctx.ui`: mock globally, test handler logic
- `pi-subagents`: mock at import level, inject test doubles
- File I/O: real files in temp directory, verify integrity
- Events: test with subscriber that throws — verify no corruption

## Open Questions (remaining)

1. **Naming**: `pi-plan-mode`? `pi-plans`? Needs to convey "persistent auditable plans," not just "show steps."

2. **Approval authority in chat-agents**: Who can approve? Requester only? Any user? Admin? Add `approval_required_from` field later if needed.

3. **Plan preview/simulation**: `/plan-simulate <id>` that shows what tools would be called without executing. Not v1, but valuable for complex plans.

4. **Executor model selection heuristic**: Plan says `executor_model: haiku`. What makes a plan suitable for Haiku vs Sonnet? Document guidance in SKILL.md.

## Relationship to Existing Work

| Existing | Relationship |
|----------|-------------|
| pi plan-mode example | Foundation for mode switching. Adapt setActiveTools, bash allowlist |
| pi-subagents | Required peer dependency. Executor spawning mechanism |
| TODOs extension | Inspiration for file persistence (frontmatter pattern) |
| chat-agents | Primary consumer. Plan mode = safe write operations |
| brain-graph | Planner reads for context. Independent composition |
