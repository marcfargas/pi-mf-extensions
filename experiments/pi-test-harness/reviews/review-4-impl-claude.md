# Implementation Review - Claude

## Summary Verdict

This is **buildable as described** but ambitious. The design correctly identifies the key technical seam (`streamFn` override) and leverages existing pi SDK primitives. However, the complexity of agent session lifecycle, extension loading, and npm package sandbox testing is substantial. The scope is realistic for a foundational tool but will require several iterations to handle edge cases robustly.

## Hard Problems

### 1. Agent Session Lifecycle Mocking
**Challenge**: `createAgentSession()` does heavy initialization (file discovery, extension loading, event setup). Mocking this cleanly while preserving realistic behavior is complex.

**Why it's hard**: The session startup sequence touches filesystem, runs extension code, loads skills, and sets up event subscriptions. Any of these can fail in unexpected ways.

**Approach**: Start with a minimal `AgentSession` construction path that skips file discovery (`createTestResourceLoader()` pattern from pi-mono). Build up complexity incrementally rather than trying to mock the full `createAgentSession()` path.

### 2. Extension Loading in Test Context  
**Challenge**: Extensions expect real filesystem paths and can have complex import dependencies. Loading them in test without the full pi environment is fragile.

**Why it's hard**: Extensions may import skills, reference relative paths, or assume certain directory structures exist. The `DefaultResourceLoader` discovery logic is intricate.

**Approach**: Provide both file-path loading (for development) and factory function loading (for controlled test scenarios). Use temporary directories that mimic real pi project structure.

### 3. Playbook State Management
**Challenge**: Multi-turn agent loops with tool calls create complex state. A playbook entry might trigger multiple `streamFn` calls (initial response → tool execution → follow-up response).

**Why it's hard**: The agent loop's control flow depends on tool results, which affects subsequent playbook consumption. Getting the turn sequencing right requires deep understanding of the agent loop.

**Approach**: Design playbooks as state machines, not just sequences. Allow conditional responses based on tool results. Start with simple sequential playbooks, add branching logic later.

### 4. npm Pack Sandbox Testing
**Challenge**: Simulating `pi install npm:package` requires complex npm dependency resolution, file structure setup, and extension discovery in a clean environment.

**Why it's hard**: This replicates pi's entire package discovery and loading pipeline in a sandbox. Dependency conflicts, missing peer deps, and ESM module resolution failures are common.

**Approach**: Build this as a separate, slower test suite. Start with basic "does it pack and install" verification before adding full playbook execution in sandbox.

## What Will Break First

### 1. **Extension Import Failures**
When test suites try to load extensions with relative imports or missing dependencies. Extensions expect to run in their package context.

**Mitigation**: Provide clear error messages and fallback to factory functions when file loading fails.

### 2. **Event Subscription Timing**  
`AgentSession` event hooks fire in specific order during session lifecycle. Test setup might miss critical initialization events or fire them out of sequence.

**Mitigation**: Explicitly document required event sequence in test session setup. Provide utilities to manually trigger key lifecycle events.

### 3. **Tool Result Format Mismatches**
Real tools return complex `AgentToolResult` objects. Mock tool results in tests might not match expected structure, breaking agent loop assumptions.

**Mitigation**: Provide typed factories for common tool result patterns. Validate tool results against expected schema.

### 4. **Playbook Consumption Bugs**
Agent makes unexpected additional `streamFn` calls (retries, error handling) that exhaust the playbook prematurely.

**Mitigation**: Add playbook debugging (log actual vs expected calls). Provide "infinite" playbook entries for fallback.

## Scope Reality Check

**Phase 1** (PlaybookModel + TestSession) is achievable in **2-3 weeks** for a competent developer familiar with the pi codebase. The basic mocking patterns exist in pi-mono.

**Phase 2** (Sandbox testing) adds **1-2 weeks** due to npm ecosystem complexity.

**Phase 3** (Advanced features) is open-ended and should be driven by actual test writing experience.

**Cut for MVP**: Skip sandbox testing initially. Focus on getting basic session mocking + simple playbooks working for the existing pi-planner/pi-safety tests.

## Implementation Sequence

### 1. **Study pi-mono Test Patterns** (2 days)
Clone pi-mono, understand their `MockAssistantStream` and `createTestSession` implementation. This is the reference implementation.

### 2. **Build PlaybookModel** (3-4 days)  
Start with the `streamFn` replacement. Test with simple single-turn scenarios before multi-turn.

```typescript
// Validate this works before building the rest
const agent = new Agent({ streamFn: playbook.streamFn });
await agent.prompt("hello");
```

### 3. **Create Minimal TestSession** (3-4 days)
Focus on `AgentSession` creation with mocked agent. No extension loading yet - just verify the agent loop works with playbooks.

### 4. **Add Extension Loading** (4-5 days)
Support loading extensions from file paths. Start with the pi-planner extension since it's in this monorepo.

### 5. **Event Collection System** (2-3 days)
Implement the `CollectedEvents` interface. This provides the assertion surface for tests.

### 6. **Package Interface** (1-2 days)  
Create clean API and package it. Add Vitest helpers.

### 7. **Write Actual Tests** (ongoing)
Use the harness to write tests for pi-planner and pi-safety. This will reveal gaps and drive iteration.

**Later**: Sandbox testing (Phase 2), advanced playbook features (Phase 3).

## Missing from the Design

### 1. **Error Handling Strategy**
How should the test harness behave when extensions throw, tools fail, or the agent loop crashes? The design doesn't specify cleanup or error recovery.

**Needed**: Clear error boundaries, automatic cleanup on test failure, helpful debugging output.

### 2. **Tool Result Validation**  
Real tools can return malformed results. Tests should validate tool results match expected schema to catch regressions.

**Needed**: Schema validation utilities, common tool result patterns.

### 3. **Extension UI Mocking**
Extensions call `ctx.ui.notify()`, `ctx.ui.select()`, `ctx.ui.confirm()`. Tests need controllable responses for these.

**Needed**: UI mock system with configurable responses.

### 4. **Performance Constraints**
No guidance on test execution time. Creating full agent sessions could be slow.

**Needed**: Benchmark targets (tests should run in <100ms), optimization strategies.

### 5. **Assertion Helpers**
The design shows basic event inspection but lacks common assertion patterns developers will need.

**Needed**: 
```typescript
expect(session).toHaveCalledTool("plan_propose", { title: "..." });
expect(session).toHaveBlockedTool("bash", { reason: "plan mode" });
expect(session.events.messages).toContainText("Plan created successfully");
```

### 6. **Concurrent Test Isolation**
Multiple test sessions running simultaneously could interfere through shared filesystem or global state.

**Needed**: Test isolation strategy, unique temp directories, proper cleanup.

The vision is solid and addresses a real need. Start small with PlaybookModel + TestSession for existing packages, then expand based on actual usage patterns.
