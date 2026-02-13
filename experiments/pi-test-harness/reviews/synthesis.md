# Synthesis: pi-test-harness Design Review

**Review Status**: 2 of 4 reviews completed successfully (both Claude). Both Gemini reviews failed due to API quota exhaustion.

**Overall Verdict**: **Proceed with significant scope reduction**. The design is technically sound and addresses a real testing gap, but suffers from over-engineering that will hurt adoption and maintainability. Strip it down to an MVP focused on basic extension testing, then iterate based on actual usage.

---

## Unanimous Verdicts

Both the architecture and implementation reviews converge on these points:

### Core Strengths
- **Real problem, right approach**: Testing extension loading and tool interactions beyond unit tests is a genuine gap. Using `streamFn` override and `AgentSession` mocking is the correct technical strategy.
- **Buildable**: The design is technically feasible. The implementation correctly identifies the key seams (`streamFn`, `AgentSession`, extension loading).
- **Smart reuse**: Leveraging existing pi SDK primitives rather than reimplementing agent logic is the right call.

### Fatal Flaws
- **Playbook over-engineering**: The multi-turn conversation playbook system is complex for what most tests actually need (simple "call tool, verify result" scenarios).
- **Premature sandbox testing**: The npm pack + temp install flow adds 5-10 seconds per test and solves problems that haven't been encountered yet.
- **Missing critical details**: No strategy for test isolation, extension UI mocking, error handling, or performance constraints.

---

## Key Divergences

None. Both reviews are from the same model and strongly agree on diagnosis and recommendations. The architecture review focuses on *why* the design is over-engineered; the implementation review focuses on *what will break* when building it.

---

## Critical Issues (Must Address)

These will block or seriously compromise the project if not fixed:

### 1. **API Complexity Will Kill Adoption** (Architecture)
If writing a test requires 20 lines of playbook setup, developers will skip testing entirely. Complex APIs don't get used.

**Fix**: Start with a dead-simple mock that auto-succeeds all tool calls. Add playbook complexity only when someone actually needs it.

```typescript
// MVP: This should be the entire API for 90% of tests
const session = await createTestSession({ extensions: ["./src/index.ts"] });
await session.callTool("plan_propose", { title: "test" });
expect(session.lastToolResult.isError).toBe(false);
```

### 2. **Extension UI Calls Will Break Immediately** (Architecture)
Extensions call `ctx.ui.confirm()`, `ctx.ui.select()`, `ctx.ui.notify()`. These will throw in test environments. This isn't mentioned in the design but will surface in the first test you write.

**Fix**: Design UI mocking strategy now, before writing any code:
```typescript
const session = await createTestSession({
  extensions: ["./src/index.ts"],
  mockUI: { confirm: true, select: 0 }
});
```

### 3. **No Test Isolation Strategy** (Both)
Multiple tests running concurrently will collide on filesystem state, temp directories, and global variables. This creates flaky tests.

**Fix**: Document temp directory strategy, cleanup guarantees, and parallelization safety upfront. Use unique temp dirs per test, ensure cleanup on failure.

### 4. **Extension Loading Will Fail First** (Implementation)
Extensions expect to run in their package context with specific directory structures and relative imports. Loading them in test will break.

**Fix**: Provide both file-path loading (for local dev) and factory function loading (for controlled tests). Mimic real pi project structure in temp directories.

---

## Suggestions (Should Address)

Not blockers, but significantly improve the design:

### Simplify Phase 1 Scope
**Both reviews**: Skip sandbox testing entirely in Phase 1. Focus on basic session mocking + simple playbooks for pi-planner and pi-safety tests. Sandbox testing is a separate, slower test suite.

**Cut from MVP**:
- npm pack + temp install flow
- Complex multi-turn playbook state machines
- Conditional playbook responses
- Full event collection (start with simple assertions)

**MVP scope** (2-3 weeks):
1. PlaybookModel with single-turn support
2. TestSession with file-path extension loading
3. Basic event assertions (`session.lastToolCall`, `session.lastToolResult`)
4. UI mocking system

### Add Missing Infrastructure
**Implementation review identifies critical gaps**:

- **Error handling**: Automatic cleanup on test failure, clear error boundaries
- **Tool result validation**: Schema validation utilities, typed factories for common tool result patterns
- **Assertion helpers**: `expect(session).toHaveCalledTool()`, `.toHaveBlockedTool()`, `.toContainText()`
- **Performance benchmarks**: Target <100ms per test, measure and optimize
- **Playbook debugging**: Log actual vs expected `streamFn` calls to diagnose consumption bugs

### Study pi-mono First
**Implementation review**: Clone pi-mono and study their `MockAssistantStream` and `createTestSession` implementation. This is the reference implementation. Don't reinvent patterns that already exist.

---

## Open Questions

These need answers before proceeding:

1. **What are the actual test scenarios?** (Architecture) - The design assumes complex multi-turn scenarios, but what specific extension failures have you encountered? Would simple success/error mocking cover 90% of cases?

2. **Have you shipped broken packages?** (Architecture) - Is sandbox testing solving a real problem or premature optimization?

3. **What's the coupling to pi SDK internals?** (Architecture) - The design is tightly coupled to `streamFn` behavior. What's the upgrade strategy when pi SDK changes?

4. **What will break first in practice?** (Implementation) - Extension imports? Event timing? Tool result mismatches? Prioritize defenses for the most likely failures.

5. **What are the performance constraints?** (Implementation) - How slow is acceptable? Creating full `AgentSession` objects could be expensive.

---

## Concrete Next Actions

**Immediate (Before Writing Code)**:

1. **Answer the open questions above** - Don't start coding until you know what you're really testing and how complex it needs to be.

2. **Study pi-mono test infrastructure** (2 days) - Clone pi-mono, read their `MockAssistantStream` and test session creation. Reuse their patterns.

3. **Design UI mocking strategy** (1 day) - Spec out how `ctx.ui.*` calls will work in tests. This will break immediately otherwise.

4. **Write test isolation spec** (1 day) - Document temp directory strategy, cleanup, and parallelization safety. Get agreement before implementing.

**Phase 1 MVP (2-3 weeks)**:

5. **Build PlaybookModel** (3-4 days) - Start with single-turn `streamFn` override. Test with simple prompts before adding multi-turn.

6. **Create minimal TestSession** (3-4 days) - `AgentSession` with mocked agent, no extension loading yet. Verify agent loop works.

7. **Add extension file loading** (4-5 days) - Load extensions from file paths. Start with pi-planner (it's in the monorepo).

8. **Implement basic assertions** (2-3 days) - `session.lastToolCall`, `session.lastToolResult`, basic event inspection.

9. **Write actual tests** (ongoing) - Use the harness to test pi-planner and pi-safety. This will reveal what's missing.

**Phase 2 (Later, Driven by Need)**:

10. **Add playbook complexity** - Only if basic mocking proves insufficient.

11. **Build sandbox testing** - Only if you ship broken packages.

12. **Advanced features** - Driven by actual test writing experience, not speculation.

**Don't Build**:

- Complex playbook state machines (unless proven necessary)
- npm sandbox testing infrastructure (unless proven necessary)
- Full event collection system (start simple)

---

## Implementation Risk Assessment

**Feasibility**: ✅ Buildable as described

**Complexity**: ⚠️ High - agent session lifecycle, extension loading, playbook state management are all non-trivial

**Time Estimate**: 
- MVP (stripped down): 2-3 weeks
- Full design as written: 4-6 weeks
- Iteration to handle edge cases: Ongoing

**Recommended Approach**: Start with the simplest thing that could possibly work. Build MVP, write tests, iterate based on what breaks. Don't build infrastructure for problems you haven't encountered.

**Biggest Risk**: Over-engineering leads to a test harness that's harder to use than the problems it solves, killing adoption.

---

## Final Recommendation

**Proceed, but cut scope aggressively**. The design correctly identifies the technical approach (`streamFn` override + `AgentSession` mocking), but tries to solve too many edge cases up front.

**Build this first**:
```typescript
// The entire API for Phase 1
const session = await createTestSession({ 
  extensions: ["./src/index.ts"],
  mockUI: { confirm: true }
});

await session.callTool("plan_propose", { title: "test" });
expect(session.lastToolResult.isError).toBe(false);
expect(session.lastToolCall).toMatchObject({ name: "plan_propose" });
```

Everything else is a later phase. If this simple API doesn't meet your needs, you'll know what to add. If it does, you've saved weeks of work.
