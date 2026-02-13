# Architecture Review - Claude

## Summary Verdict

This design is **fundamentally sound** but suffers from **feature creep and complexity debt**. The core problem (testing extension loading and tool interactions beyond unit tests) is real and important. However, the solution attempts to solve too many edge cases up front, creating a complex playbook system and heavyweight sandbox infrastructure that may never be used. The architecture will work but risks becoming a maintenance burden that's harder to use than the problems it solves.

## Strengths

- **Identifies a genuine gap**: Extension loading, tool chain execution, and multi-extension composition are impossible to test with unit tests alone
- **Leverages existing SDK**: Smart reuse of `createAgentSession()` and `streamFn` interface rather than reimplementing agent logic
- **Realistic test environment**: Using actual `AgentSession` with mocked model gives high fidelity without LLM costs
- **Clear phases**: Phased approach recognizes that sandbox testing is expensive and can be separate from core functionality
- **Concrete examples**: The code samples show exactly what the API would look like in practice

## Critical Issues

### 1. Playbook Over-Engineering
**Problem**: The playbook system is complex for what most tests need. Most extension tests just want "call this tool, get success/error" not multi-turn conversations with conditional responses.

**Why it matters**: Complex APIs lead to low adoption. If writing a test takes 20 lines of playbook setup, developers will skip testing.

**Alternative**: Start with a simple mock that returns success for any tool call. Add playbook complexity only when someone actually needs it:
```typescript
// MVP: tool always succeeds
const t = await createTestSession({ extensions: ["./src/index.ts"] });
await t.callTool("plan_propose", { title: "test" });
expect(t.events.toolCalls).toHaveLength(1);

// Advanced: scripted responses (add later)
const t = await createTestSession({ 
  extensions: ["./src/index.ts"],
  playbook: [...] 
});
```

### 2. Sandbox Infrastructure Premature
**Problem**: The npm pack + temp install flow is 5-10 seconds per test and solves packaging issues that may not exist yet.

**Why it matters**: Slow tests kill development velocity. You're building infrastructure for problems you haven't encountered.

**Alternative**: Start with direct extension loading via file paths. Add sandbox testing only when you actually ship a broken package:
```typescript
// MVP: direct file loading
const t = await createTestSession({ extensions: ["./src/index.ts"] });

// Later: sandbox testing (separate test suite)
await verifySandboxInstall({ packageDir: "./pi-planner" });
```

### 3. Missing Test Isolation Strategy
**Problem**: No mention of how tests avoid interfering with each other (temp directories, parallel execution, cleanup).

**Why it matters**: Flaky tests due to file system conflicts will make the harness unusable.

**Fix**: Document temp directory strategy and cleanup guarantees upfront.

## Suggestions

### Simplify the Initial API
Start with the minimal API that solves 80% of use cases:
```typescript
// Phase 1: Just verify tools work
const session = await createTestSession({ extensions: ["./src/index.ts"] });
await session.callTool("plan_propose", { title: "test" });
expect(session.lastToolResult.isError).toBe(false);

// Phase 2: Add playbooks for complex scenarios
const session = await createTestSession({ 
  extensions: ["./src/index.ts"],
  mockResponses: { plan_propose: { success: true, result: {...} } }
});
```

### Address Extension UI Calls Early
Extension UI calls (`ctx.ui.confirm`, `ctx.ui.select`) will break tests immediately. Design the mock strategy now:
```typescript
const session = await createTestSession({
  extensions: ["./src/index.ts"],
  mockUI: { 
    confirm: true,  // auto-approve
    select: 0,      // select first option
  }
});
```

### Make Event Collection Optional
Not every test needs full event collection. Provide simple assertions by default:
```typescript
// Simple API
await session.callTool("bash", { command: "ls" });
expect(session.lastToolCall).toMatchObject({ name: "bash", blocked: false });

// Advanced API
expect(session.events.toolCallsFor("bash")).toHaveLength(1);
```

## Questions for the Author

1. **What specific extension failures have you encountered?** The design assumes complex multi-turn scenarios, but are your actual test needs simpler?

2. **How will you handle extension UI calls?** This will break immediately in test environments.

3. **What's your test isolation strategy?** How do you prevent tests from interfering with each other's file system state?

4. **Is the playbook complexity justified?** Would simple success/error mocking cover 90% of your test cases?

5. **Why build sandbox testing now?** Have you shipped broken packages that would have been caught by this, or is this premature optimization?

6. **How will you handle pi SDK changes?** Your design is tightly coupled to `streamFn` internals - what's your upgrade strategy?
