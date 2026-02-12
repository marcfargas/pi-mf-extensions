## Summary Verdict

This v2 design is **fundamentally flawed in its current form** due to elimination of hardcoded fallbacks combined with high LLM reliability risk. While the individual components are well-designed, the architecture creates a brittle single point of failure that could make plan mode unusable when the LLM fails to register patterns. The design needs either: (a) restoration of hardcoded fallbacks as backstop, or (b) significant reliability guarantees that don't currently exist.

## Strengths

**Elegant LLM-as-parser concept** — Using the agent's existing skill-reading behavior to extract safety metadata is genuinely clever and avoids adoption friction.

**Clean separation of concerns** — pi-planner doing only glob matching while agent handles all CLI understanding is architecturally sound.

**Simplified taxonomy** — Collapsing everything to READ/write binary removes complexity without losing plan mode functionality.

**Zero skill author burden** — No metadata requirements or format conventions needed.

**Smart use of existing infrastructure** — Builds on pi's tool registration and hook system cleanly.

## Critical Issues

### Agent Instruction Following is Single Point of Failure

**Problem**: The design eliminates hardcoded fallbacks and places 100% reliability burden on LLM instruction following. Based on the v1 review data, LLM instruction success rates are unknown and likely inconsistent.

**Why it matters**: If the agent fails to call `plan_skill_safety` for 30% of skills, those tools become completely unusable in plan mode. Users would experience unpredictable blocking with no recovery path.

**Fix**: Restore minimal hardcoded patterns as fallback, not replacement. Pattern: agent extraction → hardcoded fallback → block. The 95% case gets the dynamic benefits, the 5% failure case still works.

### Security Gap Without Conservative Parsing

**Problem**: The glob matching approach `"gcloud * delete *" → WRITE` could miss complex command structures: `gcloud compute instances delete vm-1 --zone=us-central1-a --quiet` vs. `gcloud compute instances list --filter="status:RUNNING"` — both start with `gcloud compute instances` but have vastly different safety profiles.

**Why it matters**: A malicious skill could guide the agent to create overly broad read patterns: `"* list *" → READ` would match `rm -rf list-backup-files.sh`.

**Fix**: Add validation rules to the `plan_skill_safety` tool — reject patterns that don't start with the specific tool name, limit wildcard usage, maintain a denylist of dangerous verbs.

### No Recovery Mechanism for Misclassification

**Problem**: When the agent misclassifies an operation (reads as write, write as read, or misses entirely), there's no user override mechanism described.

**Why it matters**: Users hitting false blocks need an escape hatch. False permits (write classified as read) need auditability.

**Fix**: Add `/safety override <pattern> <level>` command for manual registry updates, plus audit logging of all safety decisions.

## Suggestions

### Start with Hybrid Architecture

Don't go full-LLM in v1. Build the registry system but populate it from both agent extraction AND hardcoded patterns:

```typescript
// Initialize with known-safe patterns
const DEFAULT_PATTERNS = {
  "gcloud": {
    "gcloud * list *": "READ",
    "gcloud * describe *": "READ", 
    "gcloud * get *": "READ"
  }
};
```

This gives immediate user value while testing LLM extraction reliability in parallel.

### Add Pattern Validation

The `plan_skill_safety` tool should validate patterns before storing:

```typescript
function validatePattern(tool: string, pattern: string): boolean {
  // Must start with tool name
  if (!pattern.startsWith(tool)) return false;
  // No wildcards in dangerous positions  
  if (pattern.match(/^\* /)) return false;
  // Reject overly broad patterns
  if (pattern === "*") return false;
  return true;
}
```

### Implement Incremental Registration

Instead of one-shot registration per tool, allow incremental updates:

```typescript
plan_skill_safety({
  tool: "gcloud",
  add: { "gcloud compute ssh *": "WRITE" },
  remove: ["gcloud * old-pattern *"]
})
```

This handles discovery of new patterns as the agent reads deeper into skill documentation.

## Questions for the Author

1. **What are the acceptance criteria for LLM instruction reliability?** If the agent only calls `plan_skill_safety` for 70% of skills, is that acceptable? What's the minimum threshold?

2. **How will you validate pattern quality?** What prevents the agent from registering `"* * *" → READ` that would match destructive commands?

3. **What's the debugging experience?** When a command is blocked unexpectedly, how does the user understand why and fix it?

4. **Why eliminate hardcoded patterns entirely?** The v1 review suggested hybrid (start hardcoded, add LLM enhancement). What drove the decision to go LLM-only?

5. **How do you handle skill evolution?** If a tool adds new operations between sessions, when does the agent re-register patterns?

6. **What's the security boundary?** If a skill is compromised and instructs the agent to register dangerous patterns, what prevents that?

The core insight (LLM-as-parser for existing annotations) remains brilliant, but the execution needs more defensive programming around LLM reliability and security validation.