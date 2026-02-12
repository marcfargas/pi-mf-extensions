## Summary Verdict

The design is **fundamentally sound** but **significantly over-engineered** for the problem scale. The LLM-as-parser approach is novel and appropriate for the agent ecosystem, but the implementation plan adds substantial complexity to solve what is essentially a whitelist expansion problem. The core insight (leveraging existing skill annotations via LLM parsing) is excellent, but the execution design needs simplification.

## Strengths

- **Novel approach**: LLM-as-parser for safety metadata is genuinely innovative and fits perfectly in an agent-native architecture
- **Zero adoption cost**: Works with existing skill annotations without requiring schema changes
- **Safe defaults**: Unknown operations default to DESTRUCTIVE (blocked) 
- **Leverages existing work**: Skills already have safety classifications for human guidance
- **Addresses real pain**: Plan mode currently blocks ALL external tools, making research impossible

## Critical Issues

### 1. **Complexity explosion for marginal benefit**

The proposed architecture adds 4 new components (prompt injection, safety tool, registry, resolution logic) plus new types and substantial test surface to solve what could be a simple allowlist expansion.

**Alternative**: Start with a hardcoded allowlist of READ operations for major tools:
```typescript
const PLAN_MODE_READ_COMMANDS = [
  /gcloud.*\s+(list|describe|get|show)/,
  /az.*\s+(list|show|get)/,
  /go-gmail\s+search/,
  // etc.
];
```
This solves 80% of the problem with 20 lines of code.

### 2. **LLM reliability as a dependency**

The entire system depends on the agent consistently calling `plan_skill_safety` when reading skills. The vision acknowledges this risk but underestimates its impact.

**Problem**: If the agent misses extraction 30% of the time, the feature provides inconsistent value. Users can't rely on READ operations being available.

**Alternative**: Hybrid approach - start with hardcoded patterns, add LLM extraction as an enhancement layer.

### 3. **Pattern matching complexity**

The vision mentions "simple glob" but then shows glob patterns that don't exist yet (`"gcloud * list"`). Glob libraries add dependencies. Command parsing for extracting CLI + operation adds brittle string manipulation.

**Simpler**: Regex patterns on full command strings, no parsing required.

### 4. **Runtime registry without persistence**

Building the registry fresh each session means the agent must read all skills again to populate it. This works against the goal of reliable plan mode access.

**Solution**: Either persist the registry or accept that most operations will fall through to hardcoded patterns anyway.

## Suggestions

### Start with Static, Evolve to Dynamic

1. **Phase 1**: Hardcoded READ patterns for top 3 tools (gcloud, az, go-easy)
2. **Phase 2**: Add LLM extraction as enhancement layer
3. **Phase 3**: Consider persistence if LLM reliability proves high

### Simplify the taxonomy

Six safety levels (READ/WRITE/DESTRUCTIVE/EXPENSIVE/SECURITY/FORBIDDEN) is over-designed. Two levels solve the immediate problem:
- **SAFE**: Allow in plan mode
- **GUARDED**: Block in plan mode, require plan

### Defer the tool registry

Focus on bash command filtering first. Most external tools are called via bash anyway. Tool-level safety (registered pi tools) can be Phase 2.

### Reduce prompt injection surface

Instead of always injecting the safety extraction instruction, only inject it when plan mode is active AND the agent reads a skill file. This reduces prompt pollution and makes the behavior more predictable.

## Questions for the Author

1. **What's the usage data?** How often do users actually need READ operations in plan mode? Is this solving a real bottleneck?

2. **Which tools matter most?** The vision mentions 3 skill families, but are there 2-3 specific operations (like `gcloud list` or `odoo search`) that would solve 80% of the pain?

3. **Why not allowlist expansion first?** Would adding 10-15 hardcoded patterns solve the immediate need while you validate the LLM-parsing approach?

4. **What's the failure mode?** When the agent needs to search Odoo in plan mode but the registry missed the classification, what's the user experience?

5. **How does this interact with guarded tools?** The vision mentions these are separate concerns, but they seem to overlap. Should they be unified?

The core insight is brilliant, but the implementation feels like building a cathedral when a chapel would suffice. Start simple, prove value, then evolve.