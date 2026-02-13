# Architecture Review — Claude Sonnet 4.5 (2026-02-13)

## Verdict: Sound design with execution risk in SDK coupling layer

### Strengths
1. Substitution boundary perfectly placed (streamFn, tool.execute, ctx.ui)
2. Playbook DSL production-ready — when/call/say reads naturally
3. Error diagnostics exceptional
4. Mock tools design pragmatic (per-tool opt-in)
5. Sandbox install addresses real gap
6. Event collection API intuitive
7. Mock UI complete

### Critical Issues
1. **SDK coupling time bomb** — monkey-patching _modelRegistry, streamFn, getApiKey
   - Recommendation: version guards, feature detection, upstream test hooks
2. **Type safety compromised** — too many `any` casts
3. **pendingCallbacks race condition** — keyed by toolName, second call overwrites first
4. **Playbook consumption on error** — not checked if run() throws early

### Suggestions
1. MockUI should support sequences (array of responses)
2. Add step metadata to UICallRecord
3. Missing primitive: wait()/delay()
4. Sandbox smoke should return session for more assertions
5. Ship custom vitest matchers (expectToolCall)
6. Playbook exhaustion diagnostic could show recent messages
7. README should show a failing test example

### Questions
1. How handle pi SDK major version bumps?
2. Playbook recording from real sessions — in scope?
3. Multi-turn with user responses — how scripted?
4. Should mockTools support regex patterns?
5. Event ordering — chronological guarantees?
