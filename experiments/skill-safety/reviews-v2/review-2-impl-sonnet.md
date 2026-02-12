## Summary Verdict

This v2 design is **buildable but risky** as described. The core insight—having the agent generate glob patterns after reading CLI docs—is clever and addresses the LLM reliability concerns from v1. However, the implementation has several critical gaps that could lead to security vulnerabilities and unreliable behavior. The scope is realistic for an experienced team but needs significant hardening before production.

## Hard Problems

**1. Pattern Generation Quality Control**

The design assumes agents will generate good glob patterns, but this is the weakest link. Examples from the vision:
- `"npx go-gmail * search *"` - What if agent generates `"* search *"` (too broad) or `"npx go-gmail marc@example.com search invoice"` (too narrow)?
- Command complexity: `gcloud compute instances list --project=prod --filter="status:RUNNING" --format="json"` needs the pattern to handle flags, quotes, and ordering variations
- **Approach**: Implement pattern validation rules and a "safety review" step where the agent can see its generated patterns and refine them

**2. Glob Matching Edge Cases**

The simple glob implementation will break on:
- Quoted arguments: `go-gmail search "invoice overdue"`  
- Pipes and redirects: `gcloud list | jq '.[] | select(.status=="active")'`
- Complex flag handling: `--flag=value` vs `--flag value`
- **Approach**: Extend glob matcher to handle shell tokenization properly, or pre-process commands to normalize them

**3. Security Boundary Enforcement**

The current design has a fundamental security gap: if the LLM generates `"gcloud * delete *": "READ"`, users could delete production resources in plan mode. The vision mentions "CLI-level safety gates still exist" but doesn't detail how pi-planner validates generated classifications.
- **Approach**: Implement semantic validation - reject any pattern containing known destructive verbs (`delete`, `destroy`, `drop`, etc.) being classified as READ

## What Will Break First

**1. False Positives (READ classified as WRITE)**
Most likely failure mode. Agent reads a skill, misunderstands some operation as destructive, generates overly conservative patterns. User can't research in plan mode.
- Impact: Moderate - degrades to current behavior
- Detection: User feedback, usage metrics

**2. Agent Doesn't Call `plan_skill_safety`**  
Despite the prominent prompt, LLM instruction following isn't 100%. 
- Impact: High if user expects READ operations to work
- Detection: Registry empty after skill loading
- **Mitigation**: Add registry population status to plan mode context injection

**3. Pattern Conflicts**
Two skills register overlapping patterns with different classifications: `"gcloud * list *": "READ"` vs `"* list *": "WRITE"`
- Impact: Undefined behavior in resolution logic
- **Mitigation**: Pattern specificity scoring - longer patterns win

## Scope Reality Check

**3-week timeline is realistic** for an experienced TypeScript developer, but only if scope is tightly controlled:

**MVP (Week 1-2):**
- `plan_skill_safety` tool with basic validation
- Prompt injection in `before_agent_start`
- Simple glob matching in `tool_call` hook
- Registry with 3 core tools hardcoded as fallback

**Stretch (Week 3):**
- Pattern validation rules
- Debugging commands (`/safety inspect`)
- Error handling and logging

**Phase 2 (Later):**
- Complex bash parsing
- Pattern conflict resolution
- Registry persistence
- Security audit trail

## Implementation Sequence

**1. Safety Infrastructure (Days 1-3)**
Start with `src/safety/` module:
- `types.ts` - SafetyLevel, SafetyEntry interfaces  
- `registry.ts` - in-memory Map with register/resolve methods
- `glob.ts` - basic glob matcher (no shell parsing yet)

**2. Tool Registration (Days 4-5)**
- `src/tools/safety.ts` - `plan_skill_safety` tool
- Add to `PLAN_MODE_READONLY` in `index.ts`
- Basic parameter validation (only READ/WRITE levels allowed)

**3. Hook Integration (Days 6-8)**  
- Modify `tool_call` hook in `hooks.ts`
- Add `resolveFromRegistry()` before existing `isSafeBashCommand()`
- Registry resolution logging for debugging

**4. Prompt Injection (Days 9-10)**
- Add safety extraction instruction to `before_agent_start`
- Test with real skills to validate instruction following

**5. Hardcoded Fallbacks (Days 11-12)**
- Add hardcoded patterns for `gcloud`, `az`, `go-easy` as fallback
- Ensures basic functionality even with LLM failures

**6. Testing & Hardening (Days 13-15)**
- Pattern validation rules (destructive verb detection)
- Error handling for malformed patterns
- Registry inspection tools for debugging

**Rationale**: Build from the bottom up - infrastructure first, then tool integration, then user-facing features. This allows early testing of core glob matching before adding LLM complexity.

## Missing from the Design

**1. Pattern Validation Schema**
The vision mentions "Validates levels (only READ/WRITE accepted)" but doesn't specify pattern validation rules. Need:
- Destructive verb allowlist (`delete`, `destroy`, `purge`, `remove`, `drop`)
- Pattern specificity scoring for conflict resolution
- Syntax validation for glob patterns

**2. Error Recovery Mechanisms**
What happens when:
- Agent generates malformed glob patterns?  
- Registry is empty after skill loading?
- Pattern matching throws exceptions?
Need graceful degradation to existing hardcoded allowlist.

**3. Security Audit Trail**
For compliance and debugging:
- Log all pattern registrations with source skill
- Track resolution decisions (pattern matched, level applied)
- Alert on suspicious classifications (destructive ops as READ)

**4. Runtime Configuration**
How do users:
- Override misclassified operations?
- Disable LLM extraction and use hardcoded only?
- Clear/rebuild the registry mid-session?

**5. Cross-Session Persistence**
Should the registry persist between sessions? Current design rebuilds from scratch, which is safer but slower and requires skills to be reloaded each time.

**Recommendation**: Add a simple `.pi/safety-registry.json` cache that's cleared when skills change, with manual override capability.