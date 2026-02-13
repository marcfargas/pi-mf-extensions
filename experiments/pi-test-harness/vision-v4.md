# pi-test-harness — Vision v4 (Final)

## Core Principle

**Let pi be pi.** The harness replaces exactly ONE thing: the model (via
`streamFn`). Everything else — extension loading, tool registration, hooks,
event lifecycle, session state, file I/O — runs for real. The environment is
prepared beforehand (temp dir, files, whatever the test needs). The less we
fake, the more real the test.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Real pi environment                        │
│  ┌───────────────┐  ┌──────────────────┐    │
│  │  Extensions    │  │  Built-in tools  │    │
│  │  (loaded real) │  │  (real registry) │    │
│  └───────┬───────┘  └────────┬─────────┘    │
│          │                   │              │
│  ┌───────▼───────────────────▼─────────┐    │
│  │  Agent loop                         │    │
│  │  ┌─────────┐  ┌──────────────────┐  │    │
│  │  │streamFn │  │ tool.execute()   │  │    │
│  │  │REPLACED │  │ INTERCEPTED if   │  │    │
│  │  │by       │  │ mockTool exists  │  │    │
│  │  │playbook │  │ else real        │  │    │
│  │  └─────────┘  └──────────────────┘  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  UI calls → intercepted by mockUI   │    │
│  │  (collected for assertions)         │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

Two substitution points, both at the boundary:
1. **`streamFn`** — replaced by playbook (what the model "decides")
2. **`tool.execute()`** — optionally intercepted by `mockTools` (what tools "return")
3. **UI methods** — intercepted by `mockUI` (what the user "answers")

Pi's internal machinery (tool registry, hooks, events, session) is untouched.

## API

### Full example

```typescript
import { createTestSession, when, call, say } from "@marcfargas/pi-test-harness";
import { describe, it, expect } from "vitest";

describe("pi-planner", () => {
  it("plan lifecycle: propose → approve", async () => {
    let planId: string;

    const t = await createTestSession({
      // Real pi environment
      extensions: ["../pi-planner/src/index.ts"],
      cwd: undefined, // auto temp dir, cleaned on dispose

      // Intercept tool execution (NOT tool registration)
      mockTools: {
        bash: (params) => `$ ${params.command}\nok`,
        read: (params) => `contents of ${params.path}`,
        write: () => "written",
      },

      // Intercept UI calls
      mockUI: {
        confirm: true,
        select: (title, items) => items[0],
      },
    });

    await t.run(
      when("Enter plan mode and propose a plan", [
        call("plan_mode", { enable: true }),
        call("plan_propose", {
          title: "Cook omelette",
          steps: [{ description: "Crack eggs", tool: "kitchen", operation: "crack" }],
        }).then(result => {
          planId = result.text.match(/PLAN-[0-9a-f]+/)![0];
        }),
        say("Plan created, awaiting approval."),
      ]),

      when("Approve it", [
        call("plan_approve", () => ({ id: planId })),
        say("Plan approved."),
      ]),
    );

    expect(t.events.toolCallsFor("plan_propose")).toHaveLength(1);
    expect(t.events.toolResultsFor("plan_propose")[0].isError).toBe(false);
    expect(planId).toMatch(/^PLAN-/);

    t.dispose();
  });
});
```

### `when(text, actions)`

One user→model turn:
1. Harness calls `session.prompt(text)` — the actual user prompt
2. Agent loop starts, calls `streamFn`
3. Playbook feeds `actions` one at a time:
   - `call()` → streamFn returns `toolUse` → agent loop executes tool → streamFn called again
   - `say()` → streamFn returns `stop` → agent loop ends
4. Harness moves to next `when()`

### `call(tool, params)`

The playbook says "the model calls this tool." The agent loop then:
1. Fires `tool_call` event (extension hooks run — can block, modify, log)
2. If blocked by hook → error result, mock/real never runs
3. If not blocked → looks up tool in pi's registry, calls `execute()`:
   - If tool is in `mockTools` → intercepts, returns mock response
   - If tool is NOT in `mockTools` → real execution
4. Tool result added to context, `.then()` callback fires
5. streamFn called again for next action

**Params**:
- Static: `call("plan_mode", { enable: true })`
- Late-bound: `call("plan_approve", () => ({ id: planId }))`

**Chaining**:
- `.then(result => ...)` — fires after execution with `{ text, content, details, isError }`

### `say(text)`

The playbook says "the model emits text." streamFn returns `stopReason: "stop"`.
Agent loop ends for this turn.

### `mockTools`

Intercepts `tool.execute()` for specific tools. Pi's tool registry, hooks, and
events are unaffected — they still fire. The mock only replaces what happens
INSIDE execution.

```typescript
mockTools: {
  // String → { content: [{ type: "text", text }], details: {} }
  write: "written",

  // Function → receives params, returns string or full result
  bash: (params) => `$ ${params.command}\noutput`,

  // Full result object
  read: (params) => ({
    content: [{ type: "text", text: `file: ${params.path}` }],
    details: { path: params.path, language: "text" },
  }),
}
```

### `mockUI`

Intercepts `ctx.ui.*` calls from extensions. All calls collected in
`t.events.ui` regardless.

```typescript
mockUI: {
  confirm: true,                                // always approve
  confirm: (title, msg) => !msg.includes("Delete"),  // conditional

  select: 0,                                    // pick by index
  select: "Approve",                            // pick by value
  select: (title, items) => items[0],           // dynamic

  input: "value",                               // static
  input: (title) => "dynamic value",            // dynamic

  editor: "text",                               // static
}
```

**Defaults** (no mock configured):
- `confirm` → `true`
- `select` → first item
- `input` → `""`
- `editor` → `""`
- `notify/setStatus/setWidget` → collected silently

### Error handling

**Default: `propagateErrors: true`**

If a real tool throws (not `isError` in result, but an actual exception),
the test aborts with a clear message:

```
Error during tool execution at playbook step 3 (call "plan_approve"):
  TypeError: Cannot read property 'id' of undefined

This error was thrown by the real tool execution, not by the playbook.
To capture errors as tool results instead of aborting, set:
  createTestSession({ propagateErrors: false })
```

With `propagateErrors: false`, the exception is captured as an `isError: true`
tool result and the playbook continues. The test can then assert on the error.

### Playbook diagnostics

When the playbook diverges from actual execution, clear messages:

```
Playbook exhausted unexpectedly.
  Consumed 3 of 5 actions.
  Last consumed: call("plan_propose", {...}) at step 3
  Next expected: call("plan_approve", {...}) at step 4
  Remaining: 2 actions [call("plan_approve"), say("Done")]
  
  The agent loop called streamFn but no more playbook actions were available.
  This usually means a tool call produced an unexpected result that caused
  additional streamFn calls (retries, error handling).
```

```
Playbook not fully consumed after run() completed.
  Consumed 3 of 5 actions.
  Remaining: [call("plan_approve"), say("Done")]
  
  The agent loop ended before all playbook actions were used.
  This usually means a tool was blocked by a hook or returned early,
  causing fewer streamFn calls than expected.
```

### Events

```typescript
interface TestEvents {
  all: AgentSessionEvent[];

  toolCalls: ToolCallRecord[];
  toolCallsFor(name: string): ToolCallRecord[];
  blockedCalls(): ToolCallRecord[];

  toolResults: ToolResultRecord[];
  toolResultsFor(name: string): ToolResultRecord[];

  messages: AgentMessage[];

  ui: UICallRecord[];
  uiCallsFor(method: string): UICallRecord[];
}

interface ToolCallRecord {
  step: number;                    // playbook step index
  toolName: string;
  input: Record<string, unknown>;
  blocked: boolean;
  blockReason?: string;
}

interface ToolResultRecord {
  step: number;
  toolName: string;
  toolCallId: string;
  text: string;                    // first text content joined
  content: ContentBlock[];
  isError: boolean;
  details?: unknown;
  mocked: boolean;                 // was execution intercepted by mockTools?
}

interface UICallRecord {
  method: string;
  args: unknown[];
  returnValue?: unknown;
}
```

### `createTestSession`

```typescript
interface TestSessionOptions {
  // Real pi environment setup
  extensions?: string[];
  extensionFactories?: ExtensionFactory[];
  cwd?: string;                    // auto temp dir if omitted
  systemPrompt?: string;
  skills?: Skill[];
  settings?: Record<string, unknown>;

  // Execution intercepts
  mockTools?: Record<string, MockToolHandler>;
  mockUI?: MockUIConfig;

  // Error behavior
  propagateErrors?: boolean;       // default: true — abort on real tool throw
}

type MockToolHandler =
  | string
  | ((params: Record<string, unknown>) => string | ToolResult)
  | ToolResult;
```

### `TestSession`

```typescript
interface TestSession {
  run(...turns: Turn[]): Promise<void>;
  session: AgentSession;           // real session underneath
  cwd: string;
  events: TestEvents;
  playbook: { consumed: number; remaining: number };
  dispose(): void;
}
```

## Sandbox Install Verification

Verifies a package works when installed from npm in a clean environment.

```typescript
import { verifySandboxInstall } from "@marcfargas/pi-test-harness";

it("pi-planner loads from npm pack", async () => {
  const result = await verifySandboxInstall({
    packageDir: path.resolve(__dirname, "../../pi-planner"),
    expect: {
      extensions: 1,
      tools: ["plan_propose", "plan_list", "plan_get",
              "plan_approve", "plan_reject", "plan_mode",
              "plan_run_script", "plan_skill_safety"],
    },
    // Optional smoke test in the sandbox
    smoke: {
      mockTools: { bash: "ok", read: "ok", write: "ok" },
      script: [
        when("List plans", [
          call("plan_list", {}),
          say("No plans found."),
        ]),
      ],
    },
  });

  expect(result.loaded.extensions).toBe(1);
  expect(result.loaded.extensionErrors).toHaveLength(0);
  expect(result.loaded.tools).toEqual(expect.arrayContaining(["plan_propose"]));
});
```

**Implementation**:
1. `npm pack` → tarball
2. `npm install` tarball in temp dir
3. `DefaultResourceLoader` on installed package
4. Verify: extensions load, tools register, no errors
5. Optional: run a playbook smoke test in the sandbox
6. Clean up

## Implementation layers

### Layer 1: PlaybookStreamFn
Queue of actions from `when()` turns. Implements `streamFn` signature.
Each dequeue returns `AssistantMessageEventStream` with appropriate content
and stop reason (`toolUse` for `call()`, `stop` for `say()`).
Tracks consumption, surfaces clear diagnostics on mismatch.

### Layer 2: Tool execution interceptor
Wraps pi's real tools. For each tool in `mockTools`, replaces `execute()`
with the mock handler. Extension hooks (`tool_call`, `tool_result`) still
fire on the original tool — only execution is swapped.

Implementation: after `createAgentSession` loads everything, iterate over
registered tools and wrap `execute()` for any in `mockTools`.

### Layer 3: UI interceptor
Provides a mock `ExtensionUIContext` with `ctx.hasUI = true`. Routes
interactive methods (confirm, select, input, editor) to mock handlers.
Collects all calls.

### Layer 4: TestSession
Orchestrates:
1. Create temp dir (if no cwd)
2. `createAgentSession` with extensions, `SessionManager.inMemory()`,
   `SettingsManager.inMemory()`
3. Override `session.agent.streamFn` with PlaybookStreamFn
4. Override `session.agent.getApiKey` with `() => "test-key"`
5. Wrap tool execute methods for mockTools
6. Inject mock UI context
7. Subscribe to events, collect in TestEvents
8. `run()`: iterate `when()` turns, call `session.prompt()` for each
9. After run: auto-assert playbook consumed
10. `dispose()`: cleanup temp dir, dispose session

### Layer 5: SandboxInstall
npm pack + temp install + DefaultResourceLoader + optional smoke test.

## Package structure

```
packages/pi-test-harness/
  src/
    index.ts              ← public exports: createTestSession, when, call, say,
                             verifySandboxInstall
    playbook.ts           ← PlaybookStreamFn, Turn/Action types, when/call/say
    mock-tools.ts         ← tool execution interceptor
    mock-ui.ts            ← UI interceptor
    session.ts            ← TestSession orchestration
    events.ts             ← TestEvents collection + query
    sandbox.ts            ← verifySandboxInstall
    diagnostics.ts        ← playbook mismatch error formatting
    types.ts              ← shared types
  __tests__/
    playbook.test.ts
    mock-tools.test.ts
    integration.test.ts   ← test with real pi-planner extension
  package.json
  tsconfig.json
  README.md
```

## Phases

### Phase 1 (2-3 weeks)
- PlaybookStreamFn + diagnostics
- Tool execution interceptor
- UI interceptor
- TestSession
- Event collection
- Error handling (propagateErrors)
- Sandbox install verification
- 5+ real tests for pi-planner
- README with examples

### Phase 2 (as needed)
- Vitest helpers/fixtures
- Better diagnostics based on real usage
- Publish to npm
