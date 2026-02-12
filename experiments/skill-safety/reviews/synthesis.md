# Synthesis

## Unanimous Verdicts

**Both reviewers agree on the core assessment:**
- The LLM-as-parser concept is **genuinely innovative** and well-suited for the agent ecosystem
- The approach cleverly avoids chicken-and-egg adoption problems by leveraging existing skill annotations
- **LLM instruction reliability is the primary technical risk** - agents may inconsistently call `plan_skill_safety`
- The solution addresses a real limitation (plan mode blocking ALL external tools)
- **A hybrid approach is essential**: start with hardcoded patterns, add LLM extraction as enhancement
- Safe defaults (unknown operations = DESTRUCTIVE) are the right design choice

## Key Divergences

**Scale of solution vs. problem:**
- **Architecture reviewer (Sonnet):** Views this as "building a cathedral when a chapel would suffice" - suggests 20 lines of regex could solve 80% of the problem
- **Implementation reviewer (Sonnet):** Accepts the complexity as necessary and provides a detailed 3-week build plan

**Approach to validation:**
- **Architecture reviewer:** Questions whether the feature is needed at all - asks for usage data and real user pain points
- **Implementation reviewer:** Treats the requirement as validated and focuses on technical execution challenges

**Complexity tolerance:**
- **Architecture reviewer:** Advocates for drastic simplification (2 safety levels vs. 6, defer tool registry entirely)
- **Implementation reviewer:** Accepts the full design but recommends incremental building with careful scope management

## Critical Issues (Must Address)

### 1. **LLM Instruction Following Reliability**
**Severity: HIGH - Could make entire feature unreliable**
- Success rate unknown across models and contexts
- No guaranteed execution path for safety extraction
- If agent misses 30% of extractions, users can't rely on READ operations being available
- **Must test:** Instruction following rates across different models and context lengths

### 2. **Security Gap Risk**  
**Severity: HIGH - Could compromise safety**
- LLM might misclassify DESTRUCTIVE operations as READ, creating security holes
- Complex bash commands may fail parsing and bypass safety checks
- **Must implement:** Conservative defaults, validation rules, audit trail

### 3. **Over-Engineering for Problem Scale**
**Severity: MEDIUM - Affects development velocity**
- 4 new components (prompt injection, safety tool, registry, resolution logic) to solve what might be a simple allowlist expansion
- Pattern matching complexity when regex might suffice
- Runtime registry rebuilding each session vs. persistence

## Suggestions (Should Address)

### Start Simple, Evolve Incrementally
**Both reviewers converge on this approach:**
1. **Phase 1:** Hardcoded READ patterns for 3 core tools (`gcloud`, `az`, `go-easy`)
2. **Phase 2:** Add LLM extraction as enhancement layer  
3. **Phase 3:** Advanced pattern matching and full taxonomy

### Simplify Initial Taxonomy
- Start with 2 levels: SAFE (allow in plan mode) vs. GUARDED (block, require execution)
- The 6-level taxonomy can be added later if proven necessary

### Focus on Bash Command Filtering First
- Most external tools are called via bash anyway
- Tool-level safety (registered pi tools) can be Phase 2
- Regex patterns on full command strings vs. complex parsing

## Open Questions

### Usage Validation
1. **What's the usage data?** How often do users actually need READ operations in plan mode?
2. **Which tools matter most?** Are there 2-3 specific operations that would solve 80% of pain?
3. **What's the failure mode UX?** When registry misses classification, how does the user recover?

### Technical Specifications  
4. **What's the exact prompt injection text?** Needs writing and testing
5. **How will command parsing work?** Algorithm for extracting CLI + operation from `gcloud compute instances list --format=json`?
6. **Should the registry persist?** Between sessions for reliability?
7. **How do conflicts resolve?** When skills register overlapping patterns?

### Security & Testing
8. **What validation rules prevent malicious classifications?**
9. **What's the testing strategy for LLM reliability?** Success rates across models?
10. **How do humans override misclassifications?**

## Concrete Next Actions

### Immediate (Before Building)
1. **Gather usage data** - Survey/analyze how often users hit plan mode tool blocking
2. **Identify top 3 tools** - Which READ operations would solve 80% of user pain?
3. **Test LLM instruction reliability** - Success rate for safety extraction across models

### Build Phase 1 (Week 1)
4. **Start with hardcoded patterns** - Regex list for `gcloud list/describe/get`, `az list/show/get`, `go-gmail search`
5. **Integrate into existing tool_call hook** - Simple pattern matching before blocking
6. **Test with real workflows** - Validate that top user scenarios work

### Build Phase 2 (If Phase 1 proves valuable)
7. **Add basic `plan_skill_safety` tool** - Simple registry registration
8. **Implement prompt injection** - Safety extraction instruction in system prompt
9. **Create hybrid fallback** - Registry → hardcoded patterns → block

### Validation Gates
- **After Phase 1:** Does this solve the user problem? Usage metrics improvement?
- **After Phase 2:** What's the LLM extraction success rate? Security incidents?
- **Before Phase 3:** Is the added complexity justified by user value?

**Recommendation:** Start with the architecture reviewer's "chapel" approach - prove value with minimal complexity before building the "cathedral."