# @marcfargas/pi-test-harness

## 0.3.0

### Minor Changes

- Rename DSL: `call()` → `calls()`, `say()` → `says()`.

  The new names read more naturally as playbook declarations:
  `when("Deploy", [calls("bash", ...), says("Done.")])` reads as
  "when prompted 'Deploy', the model calls bash then says 'Done.'"

  The old `call()` and `say()` are kept as deprecated aliases (removal in v0.4).

## 0.2.0

### Minor Changes

- Initial release.

  - Playbook DSL (`when`, `call`, `say`) for scripting agent conversations without LLM calls
  - `createTestSession()` — creates real pi `AgentSession` with extension loading, hooks, and events
  - Mock tool execution — intercept `tool.execute()` per-tool with static, dynamic, or full result handlers
  - Mock UI context — configurable responses for `confirm`, `select`, `input`, `editor` with call recording
  - Event collection — query helpers for tool calls, tool results, blocked calls, UI interactions, and messages
  - Late-bound params and `.then()` callbacks for dynamic multi-step tool flows
  - Playbook diagnostics — clear error messages on exhausted/unconsumed actions with step-level detail
  - Error propagation control — abort on real tool throw (default) or capture as error results
  - `verifySandboxInstall()` — npm pack → temp install → verify extensions and tools load correctly

### Patch Changes

- Fix mocked tools bypassing extension hooks (tool_call/tool_result).

  - Mocked tools now fire `emitToolCall`/`emitToolResult` via the extension runner,
    so extension blocking (e.g., plan mode) works correctly in tests
  - Blocked tool results are recorded in `toolResults` before throwing
  - `wrapForCollection` now propagates `isError` from real tool results (was hardcoded `false`)
  - Hook-blocked tools no longer treated as test failures with `propagateErrors: true`
