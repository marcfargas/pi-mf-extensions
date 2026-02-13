# Synthesis: pi-test-harness Vision v3 Reviews

**Review Status**: 2 of 4 reviews completed successfully
- ✅ Architecture Review (Claude) - Complete
- ❌ Architecture Review (Gemini) - Failed (API quota exceeded)
- ✅ Implementation Review (Claude) - Complete  
- ❌ Implementation Review (Gemini) - Failed (API quota exceeded)

This synthesis is based on the two completed Claude reviews (architecture + implementation).

---

## Unanimous Verdicts

Both reviewers agree on the following:

**The Core Concept is Sound**  
The "playbook as model" approach elegantly solves the deterministic testing problem for stateful, UI-heavy extensions. It addresses a genuine gap in the pi ecosystem and represents a clean abstraction that makes tests readable.

**The Design is Technically Feasible**  
The layered architecture with clear separation of concerns (extension code real, environmental tools mocked) is well-conceived. The implementation is achievable, with Phase 1 being a realistic MVP target in 2-3 weeks.

**Extensions Execute for Real**  
Preserving real extension execution while mocking only environmental concerns is the right design choice. This catches actual bugs in extension logic rather than testing mocks.

**Mock Boundary Needs Explicit Control**  
Both reviewers independently identify that the line between extension tools (real) and environmental tools (mocked) is the most critical complexity. Users need explicit mechanisms to control which tools execute for real vs mocked.

## Key Divergences

The reviews complement rather than contradict each other:

- **Architecture review** focuses on *user experience and API design* — how to make the mock boundary manageable, improve error messages, and extend capabilities (stateful UI mocks, timing assertions, snapshot testing)

- **Implementation review** focuses on *technical feasibility and execution risk* — hard problems like `PlaybookStreamFn` implementation, extension loading, and what will break first in real usage

Both perspectives are valuable. Architecture review provides the "what should we build" lens, while implementation review provides the "what will be hard" lens.

## Critical Issues (Must Address)

### 1. Tool Precedence & Mock Boundary
**Blocker**: When an extension registers a tool that conflicts with `mockTools`, which executes?

**Architecture concern**: Users will be confused without explicit control  
**Implementation concern**: Extension loading happens after mock registration, so extensions will override mocks by default, breaking the design

**Solution required**: Implement explicit tool mode control:
```typescript
const t = await createTestSession({
  extensions: ["./my-ext.ts"],
  toolMode: {
    bash: "mock",           // Force mock
    my_tool: "real",        // Force extension
  },
  mode: "strict",           // Error on ambiguous cases
});
```

### 2. Playbook Error Diagnostics
**Blocker**: Cryptic errors when playbook diverges from execution will make debugging impossible.

**Architecture concern**: "playbook not fully consumed: N actions remaining" is not actionable  
**Implementation concern**: This will be the #1 source of frustration in real usage

**Solution required**: 
- Log each playbook action as consumed
- On mismatch, show expected vs actual tool call with diff
- On early termination, show remaining playbook actions with context

### 3. Late-Bound Parameter Resolution
**Blocker**: The `call("tool", () => ({ id: planId }))` pattern's execution timing is unclear.

**Architecture concern**: Variables may be stale or undefined when function executes  
**Implementation concern**: No specification for how closure capture and timing work

**Solution required**: Define clear semantics for when late-bound functions execute and what context they receive. Consider dependency tracking to validate captured variables exist.

### 4. `PlaybookStreamFn` Implementation Complexity
**Blocker**: Faking the entire LLM streaming protocol is the hardest piece.

**Implementation concern**: Must properly implement `AssistantMessageEventStream` async iterator, emit correct start/delta/end events, and map `call()`/`say()` to appropriate message types

**Solution required**: This is the critical path item — must work before anything else can be tested. Build incrementally: simple text message → tool use → streaming deltas.

## Suggestions (Should Address)

### High Priority

1. **Playbook Validation** (Architecture)  
   Validate playbook structure before execution to catch errors early: unknown tools, missing mocks, unreachable actions, circular dependencies.

2. **Extension Context Mocking** (Implementation)  
   Define how to mock `ExtensionContext` properties (`cwd`, `sessionManager`, `settings`) that extensions depend on during initialization.

3. **Debug Mode** (Architecture)  
   Add `debug: "verbose"` option that logs each action as consumed and pauses on errors for debugging.

4. **Error Recovery Strategy** (Implementation)  
   Define what happens when a tool call fails: abort test, skip to next `when()`, or continue? Need explicit error handling strategies.

### Medium Priority

5. **Stateful UI Mocks** (Architecture)  
   Support UI interactions that depend on previous state (wizards, multi-step flows) via call counting or conditional returns.

6. **Extension Hook Timing** (Implementation)  
   Clarify how mocked tools interact with extension hooks that fire before/after tool execution, especially for blocking behavior.

7. **Snapshot Testing** (Architecture)  
   Support `toMatchToolSnapshot()` for complex tool results to avoid brittle assertions.

8. **Performance Targets** (Implementation)  
   Define acceptable test execution times and optimization strategies (parallel tests, shared test environments).

### Lower Priority

9. **Timing Assertions** (Architecture)  
   Support testing tool execution sequences and performance constraints.

10. **Session Persistence Testing** (Architecture)  
    Handle extensions that persist state across session restarts.

## Open Questions

These need human decisions before proceeding:

1. **Streaming behavior**: How to handle extensions that depend on streaming semantics (partial vs complete tool results)?

2. **Concurrent test execution**: Can multiple test sessions run in parallel? What isolation is needed (temp dirs, ports)?

3. **Extension dependencies**: How to test extensions that depend on other extensions being loaded?

4. **Error propagation**: When a real extension tool throws, should it fail the test or be captured as `isError: true`?

5. **Path resolution**: How to handle extensions that assume specific file structures when running in temporary test directories?

6. **TypeScript compilation**: Should the harness compile `.ts` extensions on-the-fly or require pre-compiled `.js` files?

7. **Vitest integration**: How deeply should this integrate with Vitest's parallel execution, watch mode, and snapshot features?

8. **Parallel tool calls**: The design doesn't address parallel tool execution — is this needed for v1?

## Concrete Next Actions

### Pre-Implementation (1-2 days)

1. **Resolve tool precedence decision** (Critical Issue #1)  
   Choose: explicit `toolMode` control OR precedence rules. Write spec with examples.

2. **Define `PlaybookStreamFn` contract** (Critical Issue #4)  
   Document the async iterator protocol, event types, and message mapping. This is the foundation.

3. **Specify late-bound parameter semantics** (Critical Issue #3)  
   Write examples showing when functions execute, what they capture, and error cases.

4. **Answer open questions #1, #4, #6**  
   Streaming behavior, error propagation, and TypeScript handling affect Phase 1 implementation.

### Phase 1 MVP (2-3 weeks)

**Week 1: Core Infrastructure**
1. Implement `PlaybookStreamFn` with minimal test (simple text message)
2. Build `TestSession` orchestration  
3. Implement `MockToolRegistry` with explicit tool mode control
4. Write 1st validation test: simple tool call sequence without extension

**Week 2: Extension Integration**
5. Implement `MockUIContext` (confirm/select only)
6. Verify extension loading from arbitrary paths works
7. Implement event collection and basic assertions
8. Write 2nd validation test: pi-planner plan_mode toggle (no UI)

**Week 3: Real-World Testing**
9. Implement enhanced error diagnostics (Critical Issue #2)
10. Write 3rd validation test: plan proposal with UI mocks
11. Write 4th validation test: full plan lifecycle
12. Document API and write README with examples

### MVP Scope Cuts (Implementation Review)

Defer to post-MVP:
- Parallel tool calls support
- Advanced playbook mismatch reporting with diffs
- Stateful UI mock scenarios
- Snapshot testing integration
- Timing assertions
- Phase 2 sandbox install verification

### Validation Criteria

MVP is ready when:
- ✅ pi-planner plan_mode toggle test passes
- ✅ Plan proposal with UI mocks test passes  
- ✅ Full plan lifecycle test passes
- ✅ Error messages clearly identify playbook mismatches
- ✅ Tool precedence works as specified
- ✅ Documentation includes 3+ real examples

---

## Risk Assessment

**High confidence**:  
- Core concept validity
- Phase 1 technical feasibility
- 2-3 week timeline for MVP

**Medium confidence**:  
- Error diagnostic quality (depends on execution)
- Extension loading path resolution (may hit pi internals issues)

**Low confidence**:  
- Test execution speed (may be slow, needs measurement)
- Session state isolation effectiveness (will need iteration)

**Recommendation**: Proceed with Phase 1 after resolving the 4 critical issues and answering open questions #1, #4, #6. Start with the simplest working version (`PlaybookStreamFn` + basic test) and iterate based on real integration challenges with pi-planner.
