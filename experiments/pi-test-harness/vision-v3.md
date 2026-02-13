# pi-test-harness — Vision v3

## Core Concept

A test harness for pi extensions. The playbook IS the model — it scripts what
the model decides to do (tool calls, text). Extensions execute for real (tools,
hooks, events). Environmental tools (bash, read, write) are mocked. UI calls
are intercepted and responded to via mocks.

The harness drives a real `AgentSession` with no LLM, no API keys, and
deterministic behavior.

## API

### conversation script

```typescript
import { createTestSession, when, call, say } from "@marcfargas/pi-test-harness";

it("plan lifecycle: propose → approve", async () => {
  let planId: string;

  const t = await createTestSession({
    // Extension(s) under test — loaded for real
    extensions: ["../pi-planner/src/index.ts"],

    // Environmental tools — mocked (not under test)
    // Extension-registered tools (plan_propose, etc.) execute for real.
    mockTools: {
      bash: (params) => `$ ${params.command}\nok`,
      read: (params) => `contents of ${params.path}`,
      write: () => "written",
    },

    // UI mocks — extensions call ctx.ui.* during execution
    mockUI: {
      confirm: true,                      // auto-approve all confirms
      select: (title, items) => items[0], // pick first item
      notify: "collect",                  // just collect, no-op (default)
    },
  });

  await t.run(
    // when(text, actions) — sends `text` as the user prompt,
    // then feeds `actions` to the streamFn as model responses
    when("Enter plan mode and propose a plan", [
      call("plan_mode", { enable: true }),
      call("plan_propose", {
        title: "Cook omelette",
        steps: [{ description: "Crack eggs", tool: "kitchen", operation: "crack" }],
      }).then(result => {
        // .then() fires after tool execution (real, since plan_propose is extension tool)
        planId = result.text.match(/PLAN-[0-9a-f]+/)![0];
      }),
      say("Plan created, awaiting approval."),
    ]),

    when("Approve it", [
      // Late-bound params via function — resolved at execution time
      call("plan_approve", () => ({ id: planId })),
      say("Plan approved."),
    ]),
  );

  // Assertions on collected events
  expect(t.events.toolCallsFor("plan_propose")).toHaveLength(1);
  expect(t.events.toolResultsFor("plan_propose")[0].isError).toBe(false);
  expect(planId).toMatch(/^PLAN-/);

  t.dispose();
});
```

### `when(text, actions)`

Defines one user→model turn:
1. Harness calls `session.prompt(text)` — the text is the actual user prompt
2. Agent loop starts, calls `streamFn`
3. Playbook feeds `actions` one at a time as streamFn responses
4. Agent loop executes tools, collects results, calls streamFn again
5. When a `say()` action is reached (stopReason: stop), the agent loop ends
6. Harness moves to the next `when()`

### `call(tool, params)`

Model makes a tool call. The agent loop:
1. Fires `tool_call` event → extension hooks can block
2. If blocked → error result, mock never runs; streamFn called again for next action
3. If not blocked → tool executes:
   - Extension-registered tool → **real execution**
   - Tool in `mockTools` → **mocked response**
   - Built-in tool not mocked → **real execution** (careful!)
4. Tool result added to context
5. streamFn called again → next action dequeued

Params can be:
- **Static object**: `call("plan_mode", { enable: true })`
- **Function** (late-bound): `call("plan_approve", () => ({ id: planId }))`

Chainable:
- **`.then(result => ...)`**: Callback after execution. `result` has
  `{ text, content, details, isError }`. Use for capturing dynamic values.

### `say(text)`

Model emits text. streamFn returns with `stopReason: "stop"`. Agent loop ends
for this turn.

### `mockTools`

Replaces execution of specific tools. Extension hooks still fire before execution.

```typescript
mockTools: {
  // String shorthand — becomes { content: [{ type: "text", text }], details: {} }
  write: "written",
  
  // Function — receives tool params, returns string or full result
  bash: (params) => `$ ${params.command}\noutput here`,
  
  // Function returning full result object
  read: (params) => ({
    content: [{ type: "text", text: `file contents of ${params.path}` }],
    details: { path: params.path, language: "text" },
  }),
  
  // Static full result
  edit: { content: [{ type: "text", text: "edited" }], details: {} },
}
```

If a tool is not in `mockTools` and not registered by any extension, the
harness throws an error during the run (unknown tool).

### `mockUI`

Replaces the interactive UI that extensions call via `ctx.ui.*`. All calls are
collected in `t.events.ui` for assertions regardless of the mock configuration.

```typescript
mockUI: {
  // confirm(title, message) → boolean
  confirm: true,                              // always approve
  confirm: false,                             // always deny
  confirm: (title, msg) => !msg.includes("Delete"),  // conditional

  // select(title, items) → string | undefined
  select: 0,                                  // index of item to pick
  select: "Approve",                          // pick item by value
  select: (title, items) => items[0],         // dynamic

  // input(title, placeholder?) → string | undefined
  input: "test value",                        // always return this
  input: (title) => title === "Name:" ? "Marc" : "",

  // editor(title, prefilled?) → string | undefined
  editor: "edited text",
  editor: (title, prefilled) => prefilled + "\nappended",

  // notify(message, level) — fire-and-forget, always just collected
  // setStatus(key, value) — fire-and-forget, always just collected
  // setWidget(key, lines) — fire-and-forget, always just collected
}
```

**Defaults** (when no mock provided):
- `confirm` → `true`
- `select` → first item
- `input` → `""`
- `editor` → `""`
- Fire-and-forget methods → collected silently

### Events

The primary assertion surface. Collected passively during the run.

```typescript
interface TestEvents {
  // All raw AgentSessionEvents
  all: AgentSessionEvent[];

  // Tool calls (blocked or not)
  toolCalls: ToolCallRecord[];
  toolCallsFor(name: string): ToolCallRecord[];
  blockedCalls(): ToolCallRecord[];

  // Tool results (from real execution or mocks)
  toolResults: ToolResultRecord[];
  toolResultsFor(name: string): ToolResultRecord[];

  // Messages (user, assistant, custom)
  messages: AgentMessage[];

  // UI calls
  ui: UICallRecord[];
  uiCallsFor(method: string): UICallRecord[];
}

interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  blocked: boolean;
  blockReason?: string;
}

interface ToolResultRecord {
  toolName: string;
  toolCallId: string;
  text: string;            // convenience: first text content joined
  content: ContentBlock[];
  isError: boolean;
  details?: unknown;
  mocked: boolean;         // was this from mockTools or real execution?
}

interface UICallRecord {
  method: "confirm" | "select" | "input" | "editor" | "notify" | "setStatus" | "setWidget";
  args: unknown[];
  returnValue?: unknown;   // what the mock returned (for interactive methods)
}
```

### Automatic assertions

After `run()` completes, the harness auto-checks:
- **Playbook fully consumed**: all `when()` turns were executed, all actions dequeued.
  Remaining actions → error with "playbook not fully consumed: N actions remaining".
- **No extension load errors**: if extensions failed to load, error immediately.
- **No unhandled tool errors**: if a non-mocked, non-extension tool was called
  (and no mock provided), the harness warns/errors.

These can be disabled: `createTestSession({ autoAssert: false })`.

### `createTestSession` options

```typescript
interface TestSessionOptions {
  // Extension(s) under test — file paths
  extensions?: string[];

  // Extension factories (inline, for simple tests)
  extensionFactories?: ExtensionFactory[];

  // Mock tools (environmental tools not under test)
  mockTools?: Record<string, MockToolHandler>;

  // Mock UI responses
  mockUI?: MockUIConfig;

  // System prompt (default: minimal)
  systemPrompt?: string;

  // Working directory (auto temp dir if omitted, cleaned up on dispose)
  cwd?: string;

  // Skills to inject
  skills?: Skill[];

  // Settings overrides
  settings?: Record<string, unknown>;

  // Disable automatic post-run assertions
  autoAssert?: boolean;
}

// MockToolHandler: string | function | full result object
type MockToolHandler =
  | string
  | ((params: Record<string, unknown>) => string | ToolResult)
  | ToolResult;

interface MockUIConfig {
  confirm?: boolean | ((title: string, message: string) => boolean);
  select?: number | string | ((title: string, items: string[]) => string | undefined);
  input?: string | ((title: string, placeholder?: string) => string | undefined);
  editor?: string | ((title: string, prefilled?: string) => string | undefined);
}
```

### TestSession

```typescript
interface TestSession {
  // Run a conversation script
  run(...turns: Turn[]): Promise<void>;

  // The real session underneath (for advanced inspection)
  session: AgentSession;

  // Working directory (temp or provided)
  cwd: string;

  // Collected events
  events: TestEvents;

  // Playbook consumption state
  playbook: { consumed: number; remaining: number };

  // Cleanup (removes temp dir, disposes session)
  dispose(): void;
}
```

## Sandbox Install Verification

Separate utility. Verifies a package installs and loads correctly from a
clean environment, as a user would experience with `pi install npm:@scope/pkg`.

```typescript
import { verifySandboxInstall } from "@marcfargas/pi-test-harness";

it("pi-planner installs and loads from npm pack", async () => {
  const result = await verifySandboxInstall({
    // Package directory — runs `npm pack` to create tarball
    packageDir: path.resolve(__dirname, "../../pi-planner"),

    // What we expect after install
    expect: {
      extensions: 1,                       // count of extensions loaded
      tools: [                             // tool names registered
        "plan_propose", "plan_list", "plan_get",
        "plan_approve", "plan_reject",
        "plan_mode", "plan_run_script",
        "plan_skill_safety",
      ],
    },

    // Optional: run a quick smoke test in the sandbox
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

  // If smoke test was provided
  expect(result.smoke?.events.toolResultsFor("plan_list")[0].isError).toBe(false);
});
```

**Implementation**:
1. `npm pack --pack-destination $TEMP` in packageDir → tarball
2. Create temp dir with:
   ```
   temp-sandbox/
     package.json    ← { "dependencies": { "@marcfargas/pi-planner": "file:./tarball.tgz" } }
     node_modules/   ← after npm install
   ```
3. `npm install` in temp dir
4. `DefaultResourceLoader` pointed at installed package path
5. `loader.reload()` → discovers extensions, skills
6. Verify extensions loaded, tools registered, no errors
7. If `smoke` provided → `createTestSession` in sandbox, run script
8. Return results
9. Clean up temp dir

**What this catches**:
- Missing files in `"files"` array
- Broken `"pi"` manifest paths
- Missing/wrong dependencies
- Import resolution failures (ESM paths)
- Extension load errors at require time
- Tool registration failures

**Performance**: ~5-10 seconds (npm pack + install). Run in a separate
test suite or with a long timeout.

## How it maps to the agent loop

```
t.run(
  when("text", [call("A"), call("B"), say("done")]),
  when("more", [say("ok")]),
)
```

Execution:
```
1. session.prompt("text")
   ├─ streamFn #1 → dequeue call("A") → returns toolUse
   │  tool A executes (real or mock) → result in context
   │  .then() callback fires if present
   ├─ streamFn #2 → dequeue call("B") → returns toolUse
   │  tool B executes (real or mock) → result in context
   │  .then() callback fires if present
   └─ streamFn #3 → dequeue say("done") → returns stop
   agent loop ends

2. session.prompt("more")
   └─ streamFn #4 → dequeue say("ok") → returns stop
   agent loop ends
```

If a tool is blocked by a hook:
```
   ├─ streamFn #N → dequeue call("X") → returns toolUse
   │  tool_call hook → { block: true, reason: "..." }
   │  error result in context (tool never executes, mock never runs)
   │  .then() callback fires with error result
   ├─ streamFn #N+1 → dequeue next action
```

## Implementation Layers

### Layer 1: PlaybookStreamFn
- Holds a queue of actions (flattened from all `when()` turns)
- Implements `streamFn` signature: `(model, context, options?) => AssistantMessageEventStream`
- Each call dequeues the next action and returns it as an AssistantMessage
- Tracks consumption state

### Layer 2: MockToolRegistry
- Wraps `mockTools` config into proper `ToolDefinition` objects
- Handles string/function/object shorthand normalization
- Tags tool results as `mocked: true` in events

### Layer 3: MockUIContext
- Implements `ExtensionUIContext` (or wraps it)
- Routes `confirm/select/input/editor` to mock handlers
- Collects all calls in event log
- `notify/setStatus/setWidget` → collect only

### Layer 4: TestSession
- Orchestrates everything:
  - Creates temp dir
  - Creates `DefaultResourceLoader` with extension paths
  - Creates `AgentSession` via SDK or manual construction
  - Overrides `session.agent.streamFn` and `session.agent.getApiKey`
  - Injects mock UI context
  - Registers mock tools
  - Runs conversation script (sequential `session.prompt()` calls)
  - Collects events
  - Auto-asserts on completion
  - Cleans up on dispose

### Layer 5: SandboxInstall
- npm pack + temp install
- DefaultResourceLoader verification
- Optional smoke test via TestSession

## Phases

### Phase 1: Core harness
- PlaybookStreamFn
- MockToolRegistry
- MockUIContext
- TestSession
- Event collection
- Tests for the harness itself
- 3-5 real tests for pi-planner using the harness

### Phase 2: Sandbox install
- npm pack automation
- DefaultResourceLoader in sandbox
- Smoke test support
- Tests for pi-planner and pi-safety packages

### Phase 3: Polish
- Better error messages (playbook mismatch diagnostics)
- Vitest fixtures / helpers
- Documentation / README
- Publish as `@marcfargas/pi-test-harness`

## Package Structure

```
packages/pi-test-harness/
  src/
    index.ts              ← public API exports
    playbook.ts           ← PlaybookStreamFn, when/call/say builders
    mock-tools.ts         ← MockToolRegistry
    mock-ui.ts            ← MockUIContext
    test-session.ts       ← TestSession orchestration
    events.ts             ← Event collection + query helpers
    sandbox.ts            ← verifySandboxInstall
    types.ts              ← shared types
  __tests__/
    playbook.test.ts      ← unit tests for playbook mechanics
    mock-tools.test.ts    ← unit tests for tool mocking
    mock-ui.test.ts       ← unit tests for UI mocking
    integration.test.ts   ← test with a real extension
  package.json
  tsconfig.json
  README.md
```

## Open Questions (Remaining)

1. **Extension loading path**: `DefaultResourceLoader` discovers from
   `~/.pi/agent/extensions/` and `.pi/extensions/`. For test, we need to load
   from arbitrary paths. The `additionalExtensionPaths` option on
   `DefaultResourceLoader` should work. Need to verify.

2. **Mock tool + extension tool collision**: If an extension registers `bash`
   (overriding built-in) and `mockTools` also has `bash`, which wins? Probably:
   extension-registered tools always take precedence (they're under test).

3. **ctx.hasUI in test**: Should it be `true` or `false`? If `true`, extensions
   will call UI methods → our mocks must handle them. If `false`, extensions
   might skip UI calls entirely → we can't test UI-dependent flows. Probably
   `true` with mocks is correct.

4. **Parallel tool calls**: The model can return multiple tool calls in one
   assistant message. Our `call()` entries are sequential. Should we support
   `callParallel([call("A"), call("B")])`? Or is sequential sufficient for
   testing? Probably sequential is fine for v1.
