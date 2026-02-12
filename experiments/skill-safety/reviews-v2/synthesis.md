# Synthesis

## Unanimous Verdicts

Both reviewers **agree the core LLM-as-parser concept is brilliant** — using the agent's existing skill-reading behavior to extract safety metadata is clever and avoids adoption friction. They also unanimously identify **LLM reliability as the fundamental risk** that could make the system unusable.

**Specific convergent points:**
- **Smart architectural approach**: Clean separation of concerns, zero skill author burden, builds on existing pi infrastructure
- **Simplified taxonomy works**: READ/WRITE binary removes complexity without losing functionality  
- **Security validation is critically missing**: Both flag the absence of pattern validation rules
- **Hardcoded fallbacks are essential**: Neither reviewer accepts eliminating them entirely
- **3-week timeline is realistic** with tight scope control and experienced developer

## Key Divergences

**Severity Assessment:**
- **Architecture reviewer (Sonnet)**: "Fundamentally flawed in its current form" — views LLM reliability risk as a show-stopper
- **Implementation reviewer (Sonnet)**: "Buildable but risky" — sees it as manageable with proper hardening

**Focus Areas:**
- **Architecture reviewer**: Emphasizes system-level reliability and fallback strategies  
- **Implementation reviewer**: Provides concrete technical details and step-by-step build approach

**Risk Tolerance:**
- **Architecture reviewer**: Demands "restoration of hardcoded fallbacks as backstop" before proceeding
- **Implementation reviewer**: Suggests building with "hardcoded patterns for gcloud, az, go-easy as fallback" as part of implementation

## Critical Issues (Must Address)

### 1. LLM Instruction Following Single Point of Failure
**Consensus**: If the agent fails to call `plan_skill_safety` for 30% of skills, those become unusable in plan mode. **Both reviewers demand hardcoded fallbacks as backstop**, not replacement.

**Priority**: Blocking — system unusable without this.

### 2. Security Gap in Pattern Validation  
**Consensus**: No validation prevents malicious/incorrect classifications like `"gcloud * delete *" → READ` or overly broad patterns like `"* list *" → READ` matching destructive commands.

**Required fixes** (both reviewers):
- Reject patterns not starting with tool name
- Denylist dangerous verbs (`delete`, `destroy`, `drop`, `remove`)  
- Limit wildcard usage
- Validate pattern specificity

### 3. No Recovery Mechanism for Misclassification
**Consensus**: Users need override capability when operations are incorrectly blocked or permitted.

**Required**: `/safety override <pattern> <level>` command plus audit logging.

## Suggestions (Should Address)

### Pattern Generation Quality Control
**Implementation reviewer focus**: Agents may generate patterns that are too broad (`"* search *"`) or too narrow (`"npx go-gmail marc@example.com search invoice"`).

**Solution**: Pattern validation rules + "safety review" step where agent refines generated patterns.

### Glob Matching Robustness  
**Implementation reviewer insight**: Simple glob will break on quoted arguments, pipes, and complex flags.

**Solution**: Extend glob matcher to handle shell tokenization or pre-process commands.

### Hybrid Architecture Approach
**Architecture reviewer emphasis**: Start with hardcoded patterns + LLM extraction, not LLM-only.

**Benefit**: Immediate user value while testing LLM reliability.

## Open Questions

1. **What are the acceptance criteria for LLM instruction reliability?** Both reviewers ask: if agent only calls `plan_skill_safety` for 70% of skills, is that acceptable?

2. **How to handle pattern conflicts?** Implementation reviewer flags: `"gcloud * list *": "READ"` vs `"* list *": "WRITE"` — which wins?

3. **Why eliminate hardcoded patterns entirely?** Architecture reviewer questions the decision to go LLM-only when v1 review suggested hybrid.

4. **Cross-session persistence strategy?** Implementation reviewer asks: should registry persist or rebuild each session?

5. **Security boundary enforcement?** Both ask: what prevents compromised skills from registering dangerous patterns?

## Concrete Next Actions

### Phase 1: Core Infrastructure (Week 1)
**Consensus priority order:**

1. **Build safety infrastructure** (`src/safety/` module with types, registry, basic glob)
2. **Implement `plan_skill_safety` tool** with pattern validation rules
3. **Add hardcoded fallback patterns** for `gcloud`, `az`, `go-easy` — **non-negotiable per both reviewers**
4. **Integrate tool_call hook** with registry resolution before existing `isSafeBashCommand()`

### Phase 2: LLM Integration (Week 2)  
5. **Add prompt injection** to `before_agent_start` for safety extraction
6. **Test instruction following** with real skills to measure reliability
7. **Implement pattern validation** (tool name prefix, dangerous verb detection, wildcard limits)
8. **Add debugging tools** (`/safety inspect`)

### Phase 3: Hardening (Week 3)
9. **Build override mechanism** (`/safety override <pattern> <level>`)
10. **Add audit logging** for all safety decisions  
11. **Implement pattern conflict resolution** (specificity scoring)
12. **Create error recovery** for malformed patterns and empty registry

### Immediate Decision Required
**Both reviewers demand clarity**: What is the minimum acceptable LLM instruction following rate? This drives whether to proceed with current architecture or redesign with different reliability assumptions.

**Recommendation**: Start with 80% target. Below that, the hybrid approach becomes mandatory rather than suggested.