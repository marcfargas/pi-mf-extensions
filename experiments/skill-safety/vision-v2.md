# Skill Safety Registry v2 — Vision

## Problem — What exists and why it's not good enough

pi-planner has a "plan mode" that restricts the agent to read-only operations while it researches and builds a plan for consequential actions (Odoo writes, email sends, deploys). The restriction is implemented via:

1. **`setActiveTools()`** — hides tools from the LLM prompt (only `read`, `bash`, `plan_*` tools visible)
2. **`tool_call` hook** — blocks `write`, `edit`, `todo` tools, and filters bash via hardcoded allowlist/denylist

The problem: **external tools are completely invisible in plan mode.** The agent can't search Odoo, list Gmail labels, check calendar availability, or query GCP resources while researching. It must exit plan mode to gather context, which defeats the purpose.

Meanwhile, skills already document safety levels for their operations — but only as human-readable markdown annotations that guide the agent's behavior. pi-planner can't see these classifications and treats all external tool invocations as dangerous.

### Current annotations in the wild

**go-easy (Gmail, Drive, Calendar, Tasks):**
```markdown
#### send ⚠️ DESTRUCTIVE
#### draft (WRITE — no --confirm needed)
#### search    ← implicitly READ (no annotation)
```

**gcloud (Google Cloud Platform):**
```markdown
# READ — list instances
# WRITE — deploy from container image
# ⚠️ DESTRUCTIVE
# ⚠️ EXPENSIVE — GKE clusters (~$70+/mo)
# ⚠️ SECURITY — exposes to public internet
```

**azcli (Azure):**
```markdown
| **READ** | Proceed autonomously | `list`, `show`, `get` |
| **WRITE** | Confirm with user | `create`, `deploy`, `update` |
| **DESTRUCTIVE** | Always confirm | `delete`, `purge` |
```

Three skill families, three annotation formats, same underlying taxonomy — but none of it is machine-readable to pi-planner.

## Goal — What we're building

**LLM-as-parser with agent-generated command patterns.** We don't parse commands. We don't hardcode tool knowledge. We don't ask skill authors to add metadata. Instead:

1. The agent reads a skill (it already does this)
2. A prompt instruction tells it to extract safety classifications and register them as **command-matching patterns**
3. The agent calls `plan_skill_safety` with patterns it generates — because it understands the CLI structure, having just read the docs
4. pi-planner stores the patterns and does trivial glob matching in the `tool_call` hook

**The agent does ALL the thinking.** pi-planner just stores and matches.

### What pi-planner cares about: READ vs WRITE

Skills use a rich taxonomy (READ, WRITE, DESTRUCTIVE, EXPENSIVE, SECURITY, FORBIDDEN). pi-planner doesn't need to understand the full taxonomy. It collapses everything into a binary decision:

| Skill-side level | pi-planner treatment | Plan mode behavior |
|---|---|---|
| **READ** | `READ` | ✅ Allow — agent is researching |
| Everything else (WRITE, DESTRUCTIVE, EXPENSIVE, SECURITY, FORBIDDEN) | `WRITE` | ❌ Block — must be in a plan |

Skills can use whatever taxonomy they want. pi-planner only asks: "is this a read-only operation, or does it change state?" That's the only question plan mode needs answered.

### Design principles

1. **Zero burden on skill authors** — skills don't need to change anything. No metadata files, no schemas, no conventions to adopt. The annotations they already write for human guidance are sufficient.
2. **Zero hardcoded tool knowledge** — pi-planner knows nothing about gcloud, go-gmail, or any specific CLI. All tool knowledge comes from the agent at runtime.
3. **The agent is the parser** — it reads the skill, understands the CLI structure, and generates patterns. pi-planner does dumb string matching.
4. **Safe defaults** — if the registry has no match, existing behavior applies (blocked in plan mode).

## What Makes This Unique

Most agent safety systems fall into two camps:
1. **Static metadata** — tools declare permissions in config files, schemas, or manifests. Requires every tool author to adopt a specific format. Chicken-and-egg: no enforcement without metadata, no metadata without enforcement.
2. **Hardcoded rules** — the orchestrator maintains an allowlist/denylist. Doesn't scale, breaks when new tools appear, requires constant maintenance.

This design is neither. It's **LLM-as-parser for safety metadata that already exists in natural language.**

Skills already document their safety levels — for the human reading the docs and for the agent following instructions. The annotations exist in multiple formats across multiple skill families, written independently. We don't ask skill authors to change anything. We don't parse markdown. We don't define a schema.

Instead, we tell the agent: *"you just read a skill doc — if it classifies operations by safety level, report what you found as command patterns."* The LLM extracts structure from natural language, understands the CLI invocation syntax, generates matching patterns, calls a tool, and the planner stores them. Any annotation format works. New skills get picked up automatically.

**The insight: in an agent system, the LLM is already the best parser you have.** It reads every skill doc anyway. It already understands CLI structure from the docs. Making it extract and report structured data is one prompt instruction and one tool — zero infrastructure, zero adoption cost.

### Skills can help (but don't have to)

A skill author who is aware of pi-planner can optionally include a section guiding the agent on pattern generation:

```markdown
## Plan Mode Safety Patterns

When reporting safety classifications to pi-planner, use these command patterns:
- `npx go-gmail * search *` → READ
- `npx go-gmail * get *` → READ
- `npx go-gmail * thread *` → READ
- `npx go-gmail * send *` → DESTRUCTIVE
- `npx go-gmail * draft *` → WRITE
```

This is **optional**. It just makes the LLM's extraction more reliable. Skills without this section still work — the agent infers patterns from the command documentation.

## Architecture

### Core Mechanism

```
Agent reads skill (read tool on SKILL.md or sub-docs)
    ↓
Agent sees safety annotations + command syntax in markdown
    ↓
Injected prompt instruction: "extract & report as command patterns via plan_skill_safety"
    ↓
Agent calls: plan_skill_safety({
  tool: "go-gmail",
  commands: {
    "npx go-gmail * search *": "READ",
    "npx go-gmail * get *": "READ",
    "npx go-gmail * thread *": "READ",
    "npx go-gmail * send *": "WRITE",
    "npx go-gmail * draft *": "WRITE",
    "npx go-gmail * reply *": "WRITE"
  },
  default: "WRITE"
})
    ↓
pi-planner stores patterns in runtime Map
    ↓
tool_call hook: bash command comes in → glob match against stored patterns
    ↓
Matched READ → allow | Matched WRITE or no match → existing behavior (block in plan mode)
```

### Components

**1. Prompt injection** (in existing `before_agent_start` hook):

Always injected (not gated by plan mode) so the registry populates regardless of when skills are loaded relative to plan mode activation.

```
[SKILL SAFETY] When you read a skill that classifies operations with safety levels
(READ, WRITE, DESTRUCTIVE, etc.), call plan_skill_safety with command-matching patterns.

Use glob patterns that match how the CLI is actually invoked in bash:
- "npx go-gmail * search *" → READ (the * matches the account argument, trailing args)
- "gcloud * list *" → READ
- "gcloud * delete *" → WRITE

Collapse all non-READ levels (WRITE, DESTRUCTIVE, EXPENSIVE, SECURITY, FORBIDDEN) to WRITE.
Only READ and WRITE are valid levels.
If in doubt, classify as WRITE.
Call once per tool/CLI after reading its skill documentation.
```

**2. `plan_skill_safety` tool:**

```typescript
interface SkillSafetyParams {
  tool: string;                          // Tool/CLI name for grouping
  commands: Record<string, "READ" | "WRITE">;  // glob pattern → level
  default?: "READ" | "WRITE";           // fallback for unmatched (default: WRITE)
}
```

- Validates levels (only READ/WRITE accepted)
- Stores in runtime `Map<string, SafetyEntry>`
- Always visible to agent (in PLAN_MODE_READONLY set)

**3. Safety registry** (runtime state):

```typescript
type SafetyLevel = "READ" | "WRITE";

interface SafetyEntry {
  commands: Array<{ pattern: string; level: SafetyLevel }>;
  default: SafetyLevel;
}

const safetyRegistry = new Map<string, SafetyEntry>();
```

No persistence. Rebuilt each session as agent loads skills.

**4. Resolution in `tool_call` hook:**

For bash commands in plan mode:

```
1. For each registry entry, try glob matching against stored command patterns
2. First match wins → return its level
3. No match in any entry → null (fall through to existing logic)
```

If resolved level is READ → allow the command.
If resolved level is WRITE → block (plan mode).
If no resolution → existing hardcoded allowlist/denylist applies (unchanged behavior).

**5. Glob matching:**

Minimal implementation. `*` matches any sequence of non-empty characters. Patterns are matched against the full bash command string.

```typescript
function globMatch(pattern: string, command: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex specials
    .replace(/\*/g, '.*');                    // * → .*
  return new RegExp(`^${regex}$`).test(command.trim());
}
```

That's it. No CLI parsing, no subcommand extraction, no flag analysis.

### What changes in existing code

| File | Change |
|---|---|
| `src/mode/hooks.ts` | In `tool_call` handler for plan mode bash: try registry resolution first, before existing `isSafeBashCommand()`. Add `resolveFromRegistry()` function. |
| `src/index.ts` | Add `plan_skill_safety` to `PLAN_MODE_READONLY`. Add safety extraction prompt to `before_agent_start`. Register new tool. |
| New: `src/safety/registry.ts` | `SafetyLevel`, `SafetyEntry` types. `SafetyRegistry` class with `register()` and `resolve()`. |
| New: `src/safety/glob.ts` | `globMatch()` function. |
| New: `src/tools/safety.ts` | `plan_skill_safety` tool registration. |

### What does NOT change

- **Skills** — zero changes
- **pi core** — no API changes
- **Plan lifecycle** — unaffected
- **Existing bash allowlist/denylist** — remains as fallback for non-skill commands
- **Plan proposal/execution** — unaffected

## Example Flows

### Agent researching in plan mode with Gmail

1. User: "let's plan sending invoice reminders to overdue clients"
2. Agent enters plan mode
3. Agent reads go-easy SKILL.md, then gmail.md
4. Agent sees safety annotations, calls:
   ```
   plan_skill_safety({
     tool: "go-gmail",
     commands: {
       "npx go-gmail * search *": "READ",
       "npx go-gmail * get *": "READ",
       "npx go-gmail * thread *": "READ",
       "npx go-gmail * labels": "READ",
       "npx go-gmail * profile": "READ",
       "npx go-gmail * send *": "WRITE",
       "npx go-gmail * reply *": "WRITE",
       "npx go-gmail * draft *": "WRITE",
       "npx go-gmail * forward *": "WRITE"
     },
     default: "WRITE"
   })
   ```
5. Agent runs `npx go-gmail marc@blegal.eu search "is:unread subject:invoice"` → registry matches READ → **allowed**
6. Agent runs `npx go-gmail marc@blegal.eu thread <id>` → READ → **allowed**
7. Agent has full context, proposes plan with send steps
8. **Before**: agent couldn't search at all in plan mode. Had to exit, search, re-enter.

### Agent researching with gcloud

1. Agent reads gcloud SKILL.md
2. Agent calls:
   ```
   plan_skill_safety({
     tool: "gcloud",
     commands: {
       "gcloud * list *": "READ",
       "gcloud * describe *": "READ",
       "gcloud * get *": "READ",
       "gcloud config *": "READ",
       "gcloud * create *": "WRITE",
       "gcloud * deploy *": "WRITE",
       "gcloud * delete *": "WRITE",
       "gcloud run deploy *": "WRITE"
     },
     default: "WRITE"
   })
   ```
3. Agent runs `gcloud run services list --format=json` → matches "gcloud * list *" → READ → **allowed**
4. Agent runs `gcloud run services describe my-svc --format=json` → matches "gcloud * describe *" → READ → **allowed**

### Unknown skill (no safety annotations)

1. Agent reads a skill with no safety annotations
2. Agent doesn't call `plan_skill_safety` (nothing to report)
3. Agent tries to run the tool's CLI in plan mode
4. Registry has no entry → falls through to existing `isSafeBashCommand()`
5. Not in safe bash allowlist → **blocked** (current behavior, unchanged)

## Risks

### Agent doesn't call plan_skill_safety

**Likelihood:** Moderate. LLM instruction following isn't 100%.
**Impact:** Low. Falls through to existing behavior (blocked). Feature is purely additive.
**Mitigation:** Prominent prompt instruction. "If in doubt, classify as WRITE."

### Agent generates bad patterns

**Likelihood:** Low-moderate. The agent just read the CLI docs and knows the syntax.
**Impact:** Low for over-classification (WRITE when should be READ — just means blocked, same as today). Medium for under-classification (READ when should be WRITE — allows a write operation in plan mode).
**Mitigation:**
1. Default is WRITE (safe)
2. CLI-level safety gates still exist (go-easy `--confirm`, gcloud prompts)
3. Skills that care can include pattern guidance
4. Prompt says "if in doubt, WRITE"

### Glob patterns too broad or too narrow

**Likelihood:** Moderate. `"gcloud * list *"` could match something unexpected.
**Impact:** Low. The worst case is allowing a READ-like command that has a side effect — but real CLIs don't have side-effecting `list` commands.
**Mitigation:** The patterns match common CLI conventions where verbs like `list`, `get`, `describe`, `search` are genuinely read-only.

### Prompt injection via skill content

**Likelihood:** Low. Skills are trusted content.
**Impact:** Medium. A malicious skill could instruct the agent to register all its operations as READ.
**Mitigation:** Same trust model as skills today. pi docs: "Review skill content before use." The CLI safety gates (`--confirm`) remain the real enforcement boundary.

## Constraints

- No pi core changes — must work with current ExtensionAPI
- No skill changes — must work with existing annotation formats
- No hardcoded tool/CLI knowledge in pi-planner
- Safe defaults — no registry match → existing behavior (blocked)
- TypeScript, ESM, vitest — match project conventions

## Open Questions

1. **Should WRITE-classified commands be loggable?** When the registry says WRITE and blocks in plan mode, should it say "blocked: WRITE operation per go-gmail safety registry" vs the generic "command blocked"? (Yes, probably — better UX.)

2. **Should the glob matching be case-sensitive?** CLI commands are typically lowercase, but should we normalize?

3. **Edge case: piped commands.** `npx go-gmail marc search "invoice" | jq .items` — should the glob match the full string or just the first command? Probably the full string, and the agent should generate patterns with trailing `*` to handle pipes.

4. **Should there be a `/safety` command** to inspect the current registry? Useful for debugging.

5. **How prominent should the prompt instruction be?** Part of the plan-mode-context injection? Separate system prompt section? The more prominent, the more reliable, but also more prompt pollution.
