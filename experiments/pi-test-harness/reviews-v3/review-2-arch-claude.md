# Architecture Review: pi-test-harness Vision v3

## Summary Verdict

This is a well-conceived design for a critical missing piece in the pi ecosystem. The core concept of "playbook as model" is elegant and addresses the real need for deterministic extension testing. The layered architecture is sound with clear separation of concerns. However, there are several critical issues around complexity management, error handling, and the mocking boundary that need resolution before implementation.

## Strengths

- **Addresses real pain**: Testing pi extensions currently requires manual verification or complex API mocking. This fills a genuine gap.
- **Elegant core concept**: "The playbook IS the model" is a clean abstraction that makes tests readable and maintainable.
- **Preserves reality**: Extensions execute for real while only environmental concerns are mocked. This catches actual bugs in extension logic.
- **Good boundary design**: Clear separation between extension code (real), environmental tools (mocked), and infrastructure (harness).
- **Comprehensive event collection**: The events API provides rich assertion surface without requiring test writers to instrument everything.
- **Practical API**: The `when()/call()/say()` DSL reads naturally and maps clearly to agent execution flow.
- **Sandbox verification**: The `verifySandboxInstall` utility addresses the common "works on my machine" problem for package distribution.

## Critical Issues

### 1. Mock Boundary Complexity

**Problem**: The line between "extension tools" (real) and "environmental tools" (mocked) will be confusing and error-prone. Users must understand pi's internal tool architecture to write tests correctly.

**Evidence**: The design assumes users know which tools are built-in vs extension-registered. The question "If an extension registers `bash` and `mockTools` also has `bash`, which wins?" exposes this complexity.

**Solution**: Provide explicit control mechanisms:
```typescript
const t = await createTestSession({
  extensions: ["./my-extension.ts"],
  realTools: ["my_extension_tool"], // Force these to execute for real
  mockTools: {
    bash: "mocked", // Force this to be mocked even if extension overrides it
  },
  mode: "strict", // Error on ambiguous tool calls instead of guessing
});
```

### 2. Playbook Consumption Error Handling

**Problem**: When the playbook and actual execution diverge, error messages will be cryptic. A typo in a tool name or unexpected tool call will cause confusing failures.

**Evidence**: "playbook not fully consumed: N actions remaining" doesn't tell you *which* actions or *why* they weren't consumed.

**Solution**: Enhanced diagnostics with execution tracing:
- Log each playbook action as it's consumed
- On mismatch, show: expected vs actual tool call
- On early termination, show: remaining playbook actions
- Consider diffing expected vs actual execution flow

### 3. Late-Bound Parameter Resolution Timing

**Problem**: The `call("tool", () => ({ id: planId }))` pattern is fragile. The function executes when the action is dequeued, but captured variables might be stale or undefined.

**Evidence**: The example captures `planId` in a `.then()` callback, but it's unclear when that callback executes relative to when the late-bound function is called.

**Solution**: Make timing explicit:
```typescript
call("plan_approve", { 
  params: () => ({ id: planId }),
  dependencies: ["planId"], // Validate these exist when called
}).after(previous => {
  // Explicit sequencing
  planId = previous.extractId();
})
```

### 4. UI Mock State Management

**Problem**: UI mocks are stateless functions, but real UI interactions often depend on previous state. How do you test a wizard that remembers previous answers?

**Evidence**: No mechanism for stateful UI interactions or testing UI sequences.

**Solution**: Support stateful UI mocks:
```typescript
mockUI: {
  select: new StatefulMock()
    .onCall(0).return("Step 1")
    .onCall(1).return("Step 2")
    .onCall(call => call.title.includes("Final")).return("Done")
}
```

## Suggestions

### 1. Simplify the Tool Mocking Model

Instead of trying to distinguish built-in vs extension tools, make tool execution mode explicit:

```typescript
const t = await createTestSession({
  extensions: ["./my-ext.ts"],
  toolMode: {
    // Explicit control for each tool that might be called
    bash: "mock",
    read: "mock", 
    write: "mock",
    my_extension_tool: "real",
    plan_propose: "real",
  },
  mockImplementations: {
    bash: (params) => `$ ${params.command}\nok`,
    read: (params) => `contents of ${params.path}`,
  }
});
```

This removes the guesswork and makes test intent clear.

### 2. Add Playbook Validation

Validate the playbook structure before execution:

```typescript
// Add to createTestSession
validatePlaybook: true, // Default true, errors on:
// - Unknown tools in call()
// - Missing mock implementations  
// - Unreachable actions
// - Circular dependencies in late-bound params
```

### 3. Provide Debug Modes

```typescript
createTestSession({ 
  debug: "verbose", // Logs each action as consumed
  pauseOnError: true, // Stop execution on first mismatch for debugging
})
```

### 4. Consider Snapshot Testing

For complex tool results:

```typescript
expect(t.events.toolResultsFor("plan_propose")[0])
  .toMatchToolSnapshot("plan_propose_result.json");
```

### 5. Add Timing Assertions

Some extensions care about execution timing:

```typescript
// Assert that plan_approve happened after plan_propose
expect(t.events.sequenceOf(["plan_propose", "plan_approve"])).toBe(true);

// Assert maximum execution time for performance-sensitive extensions
expect(t.timing.toolDuration("expensive_tool")).toBeLessThan(1000);
```

## Questions for the Author

1. **Tool precedence**: How should tool resolution work when both extensions and mocks define the same tool? Should this be an error, or should there be a clear precedence rule?

2. **Streaming simulation**: How will you handle extensions that depend on streaming behavior? Some extensions react differently to partial vs complete tool results.

3. **Session persistence**: Do you need to test extensions that persist state across session restarts? How would the harness handle session files?

4. **Error propagation**: When a real tool (like an extension tool) throws an error, should it fail the test or be captured as a tool result with `isError: true`?

5. **Concurrent tests**: Can multiple test sessions run in parallel, or do they need isolation (separate temp dirs, different ports, etc.)?

6. **Extension dependencies**: How will you handle extensions that depend on other extensions being loaded? Should the harness support loading multiple extensions with dependency resolution?

7. **Performance expectations**: What's the target execution time for a typical test? Should there be timeouts on tool execution or playbook consumption?

8. **Vitest integration**: Will this integrate with Vitest's parallel execution, watch mode, and snapshot features? Are there any constraints that affect how tests can be structured?
