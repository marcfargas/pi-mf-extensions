# Implementation Review: pi-test-harness Vision v3

## Summary Verdict

This design is technically feasible and well-architected. The core concept of using a "playbook as model" approach is sound and addresses the fundamental challenge of testing stateful, UI-heavy extensions deterministically. However, there are several hard implementation problems around LLM lifecycle mocking, extension loading isolation, and error handling that will require careful design. The scope is substantial but achievable in phases, with Phase 1 being a realistic MVP target.

## Hard Problems

### **LLM Lifecycle Mocking**
**What's hard:** The `streamFn` interface expects to return an `AssistantMessageEventStream`, but the playbook needs to return different message types (tool use vs text) and handle complex streaming semantics.

**Why it's hard:** The real `streamFn` handles model reasoning, context windows, retries, and streaming protocols. The playbook must fake all of this while maintaining compatibility with the agent loop's expectations.

**Approach:** Build `PlaybookStreamFn` as a proper `AssistantMessageEventStream` implementation with queued actions. Handle the async iterator protocol correctly and emit appropriate start/delta/end events. Map `call()` actions to `toolUse` message types and `say()` actions to `text` with `stop` reason.

### **Extension Tool vs Mock Tool Precedence**
**What's hard:** When an extension registers a tool that conflicts with `mockTools`, determining which executes requires understanding pi's tool registry internals.

**Why it's hard:** The extension loading happens after mock tool registration, so extension tools will likely override mocks. This breaks the "mock environmental, execute extension" principle.

**Approach:** Register mocks with a lower priority or namespace them differently. Alternative: modify the tool resolution logic in the test session to explicitly prefer extension-registered tools over mocks for tools under test.

### **Extension Loading Path Resolution**
**What's hard:** `DefaultResourceLoader` expects specific directory structures and may not handle arbitrary file paths for test extensions.

**Why it's hard:** The loader was designed for installed extensions, not test scenarios with relative paths and TypeScript files.

**Approach:** Use `additionalExtensionPaths` option or create a custom `ResourceLoader` implementation for testing. May need to handle TypeScript compilation on-the-fly or require pre-compiled JS files.

### **Session State Isolation**
**What's hard:** Extensions can modify global state, persist data, and affect subsequent tests.

**Why it's hard:** Extensions like pi-planner write to disk, modify session state via `appendEntry`, and maintain in-memory state across agent turns.

**Approach:** Use temporary directories per test, implement proper cleanup in `dispose()`, and consider process isolation for truly independent tests. Mock or intercept persistent operations where possible.

## What Will Break First

1. **Mock UI expectations mismatch** - Extensions calling UI methods with different signatures than the mocks expect, especially with complex selection options or dynamic content.

2. **Tool execution order dependencies** - If extension hooks depend on tool execution happening in a specific order, the playbook's sequential approach may break async tool scenarios.

3. **Extension state cleanup** - Extensions that don't properly reset state between sessions will cause test pollution and flaky results.

4. **Path resolution in temporary directories** - Extension code that assumes specific file structures or relative paths will break when running in temporary test directories.

## Scope Reality Check

**Phase 1 (Core harness)** is achievable in 2-3 weeks with the right focus:
- PlaybookStreamFn is the most complex piece but has a clear interface contract
- MockToolRegistry and MockUIContext are straightforward mapping layers  
- TestSession orchestration follows existing SDK patterns
- 3-5 real pi-planner tests will surface integration issues early

**Phase 2 (Sandbox install)** adds significant complexity:
- npm pack/install automation is reliable but slow (~10 seconds per test)
- DefaultResourceLoader verification requires understanding extension discovery internals
- This phase could double the timeline

**For MVP, cut:**
- Parallel tool calls support (mentioned in open questions)
- Advanced error diagnostics and playbook mismatch reporting
- Complex UI mock scenarios - start with simple confirm/select patterns

**Critical path items:**
1. Get PlaybookStreamFn working with a minimal test case
2. Verify extension loading from arbitrary paths works
3. Test pi-planner's plan_mode tool early (it's a simple, self-contained feature)

## Implementation Sequence

1. **PlaybookStreamFn + basic TestSession** - Core streaming fake, minimal orchestration
2. **MockToolRegistry integration** - Environmental tool mocking  
3. **MockUIContext** - Extension UI interaction mocking
4. **Event collection and assertions** - Testing utilities
5. **pi-planner integration tests** - Real extension validation
6. **Error handling and diagnostics** - Developer experience improvements
7. **SandboxInstall** (Phase 2) - Package verification

**Validation milestones:**
- Test 1: Simple tool call sequence without extension
- Test 2: pi-planner plan_mode toggle (no UI, simple state change)
- Test 3: Plan proposal with UI mocks (confirm/select interactions)
- Test 4: Full plan lifecycle (propose → approve → execute)

## Missing from the Design

### **Extension Context Mocking**
The design doesn't specify how to mock `ExtensionContext` properties like `cwd`, `sessionManager`, and `settings`. Extensions often depend on these for initialization.

**Need:** Define TestContext factory with realistic defaults and override capabilities.

### **Tool Parameter Late-Binding Implementation**
The `call("tool", () => ({ id: planId }))` syntax is mentioned but not detailed. This requires careful handling of closure capture and execution timing.

**Need:** Specify how late-bound functions are resolved and what context they receive.

### **Error Recovery and Partial Playbook Execution**
If a tool call fails or is blocked, how does the playbook handle the remaining actions? Should it continue, skip to the next `when()`, or abort?

**Need:** Define error handling strategies and test assertions for failure scenarios.

### **Extension Hook Timing**
Some extension hooks fire before tool execution (can block), others after. The design doesn't clarify how mocked tools interact with these hooks.

**Need:** Specify mock execution order relative to extension hooks and how to test blocking behavior.

### **Performance Considerations**
No mention of test execution speed or resource usage. Extension loading, temporary directory creation, and real tool execution could make tests slow.

**Need:** Define performance targets and optimization strategies (test parallelization, shared test environments).

The design is solid overall, but these implementation details will need resolution during Phase 1 development. Start with the simplest possible working version and iterate based on real integration challenges with pi-planner.
