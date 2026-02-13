# Implementation Review — Claude Sonnet 4.5 (2026-02-13)

## Verdict: Buildable with caveats — 80% there

### Hard Problems
1. **Monkey-patching fragility** — no version guards, no fallback
2. **Tool interception loses object identity** — spread creates new object, breaks WeakMap refs
3. **pendingCallbacks race** — Map keyed by toolName, overwrites on same-tool calls
4. **Windows sandbox cleanup** — rmSync fails with EBUSY on open handles

### Bugs Found
1. session.ts:95 — extension load error doesn't dispose session → resource leak
2. mock-tools.ts:132 — .then() callback errors silently swallowed
3. playbook.ts:72 — resolveParams doesn't validate function return type

### Edge Cases Not Covered
1. Empty playbook — when("test", [])
2. Tool calls after say() in same turn
3. Concurrent tool execution from hooks
4. AbortSignal ignored in mocked tools
5. select with out-of-bounds index → undefined

### Missing Features
1. No timeout handling for run()
2. No session state reset between run() calls (appends by default)
3. No events.toolSequence() helper
4. No initial session state injection
5. Mock UI theme methods incomplete (underline, dim, etc.)

### Critical Fixes for 1.0
1. Fix .then() callback race (key by call ID not tool name)
2. Add Windows cleanup retry to sandbox.ts
3. Guard monkey-patches with feature detection
4. Fix resource leak on extension load failure
5. Add timeout support to run()
