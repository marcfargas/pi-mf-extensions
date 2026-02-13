# pi-test-harness — Vision

## Problem — What exists and why it's not good enough

We have a monorepo (`pi-mf-extensions`) with multiple pi extension packages (`pi-planner`, `pi-safety`, `permission-gate`). Our current tests are:

- **Unit tests**: Test our own logic (PlanStore CRUD, glob matching, config parsing, executor prompts)
- **Integration tests**: Test component interaction within our code (plan lifecycle with real file I/O)

What we're **NOT** testing:

1. **Extension loading** — Does our extension actually load in a pi session? Do the tools register? Do event hooks fire?
2. **Tool interactions** — When the LLM calls `plan_propose`, does the full chain work: tool receives params → extension processes → state updates → correct result returned to LLM?
3. **Event hook behavior** — Does our `tool_call` hook actually block destructive commands in plan mode? Does `before_agent_start` inject the right context?
4. **Multi-extension composition** — Do `pi-planner` + `pi-safety` + `permission-gate` work together without conflicts?
5. **Package installation** — Can a user `pi install npm:@marcfargas/pi-planner` and have it work? Does the `pi.extensions` manifest resolve correctly?

**pi-mono's approach**: They have `MockAssistantStream` + custom `streamFn` for unit tests of the agent loop, and real LLM e2e tests (skipIf no API key). But there's no reusable test harness — each test file rebuilds its own mock infrastructure.

**The ecosystem**: Based on npm search and pi-mono's own tests, nobody has built a reusable test kit for pi extensions. Everyone YOLOs it.

## Goal — What we're building and for whom

A **test harness package** (`@marcfargas/pi-test-harness`) that makes it trivial for any pi extension to:

1. **Spin up a real pi `AgentSession`** with mocked model (no API keys, no LLM costs, deterministic)
2. **Script model responses via playbooks** (request → expected tool calls → response)
3. **Assert on session events, tool calls, tool results, hook behavior**
4. **Verify npm package installation** in a clean sandbox

**Target users**: Ourselves (pi-mf-extensions packages) and any pi extension author.

**Key constraint**: Low development friction. A test should be ~10-20 lines of setup, not 100.

## Current State — What exists

### pi SDK surface (from `@mariozechner/pi-coding-agent`)
- `createAgentSession()` — Full session factory with extensions, tools, events
- `SessionManager.inMemory()` — No file persistence
- `SettingsManager.inMemory()` — No file I/O  
- `DefaultResourceLoader` — Discovers extensions/skills with override hooks
- `AgentSession.subscribe(event => ...)` — Full event stream
- `AgentSession.prompt("text")` — Send prompt and wait for completion

### pi-ai SDK (`@mariozechner/pi-ai`)
- `EventStream<T, R>` / `AssistantMessageEventStream` — Exported, can be instantiated
- `streamSimple()` signature: `(model, context, options?) => AssistantMessageEventStream`
- `Agent({ streamFn })` — **The key seam**: accepts custom `streamFn` that replaces the real LLM

### pi-agent-core (`@mariozechner/pi-agent-core`)
- `Agent` class:
  - `streamFn` is a **public writable** property: `agent.streamFn = myMock`
  - `getApiKey` is also public writable
  - Constructor accepts `streamFn` in `AgentOptions`
- `agentLoop` resolves `getApiKey` before calling `streamFn` — so even with a mock streamFn, the loop will call `getApiKey`. Need a fake getApiKey that returns a dummy string.

### Accessing from `createAgentSession`
- `createAgentSession()` creates `Agent` internally — we can't pass `streamFn` through it
- But `session.agent` is `readonly` (reference) and `session.agent.streamFn` is public writable
- **Strategy**: Create session normally, then override: `session.agent.streamFn = playbackFn; session.agent.getApiKey = () => "test-key";`

### pi packages / sandbox install
- `pi install npm:@scope/pkg` or `settings.json` `"packages": ["npm:@scope/pkg"]`
- `npm pack` produces a tarball; can install locally with `npm install ./tarball.tgz`
- `DefaultResourceLoader` discovers extensions from packages
- `pi.extensions` in package.json declares extension entry points
- Global installs use `npm install -g`, project installs go to `.pi/npm/`

### pi-mono test patterns (from their repo)
- `MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage>` — Manually push events
- `streamFn` callback: Inspect `callIndex`, return different responses per turn
- `createTestResourceLoader()` — Returns no-op resource loader (no extensions, no skills, no prompts)
- `createTestSession()` — Wires Agent + AgentSession + temp dirs + cleanup
- E2E tests use `describe.skipIf(!API_KEY)` to gate real LLM tests
- Tests use `agent.prompt("text")` and assert on `agent.state.messages`

## Architecture / Design — How it should work

### Layer 1: PlaybookModel — The mock LLM

A `PlaybookModel` that replaces the real LLM with scripted responses. It implements the `streamFn` interface.

```typescript
// A single scripted turn response
interface PlaybookTurn {
  // What the model "says" — text and/or tool calls
  text?: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  // Optional: assert on what was sent TO the model
  assertPrompt?: (messages: Message[]) => void;
}

// The playbook is an ordered sequence of turns
type Playbook = PlaybookTurn[];
```

When the agent loop calls `streamFn`, the PlaybookModel:
1. Pops the next turn from the playbook
2. Optionally runs `assertPrompt` on the context messages (for input validation)
3. Returns an `AssistantMessageEventStream` with the scripted response
4. If playbook is exhausted, returns a stop response (or throws)

**Critical detail**: The agent loop calls `getApiKey()` BEFORE calling `streamFn`. `createAgentSession` sets up `getApiKey` to throw if no real key is found. The harness must override `session.agent.getApiKey = () => "test-key"` to avoid this.

**Important**: Tool calls cause the agent loop to execute the tool and call `streamFn` again. So a playbook for "call tool then respond" needs TWO entries:
```typescript
[
  { toolCalls: [{ name: "bash", arguments: { command: "ls" } }] },  // Turn 1: call tool
  { text: "Here are the files..." },                                  // Turn 2: respond after tool result
]
```

### Layer 2: TestSession — The harness

Wraps `createAgentSession()` or manual Agent+AgentSession construction with sensible defaults:

```typescript
interface TestSessionOptions {
  // Extension(s) under test — file paths or factory functions
  extensions?: Array<string | ExtensionFactory>;
  
  // Scripted model responses
  playbook?: Playbook;
  
  // Custom tools (beyond what extensions register)
  tools?: ToolDefinition[];
  
  // System prompt override
  systemPrompt?: string;
  
  // Working directory (defaults to temp dir)
  cwd?: string;
  
  // Skills to load
  skills?: Skill[];
  
  // Settings overrides
  settings?: Record<string, unknown>;
}

interface TestSession {
  session: AgentSession;
  
  // Collected events for assertions
  events: CollectedEvents;
  
  // Send prompt and wait for completion
  prompt(text: string): Promise<void>;
  
  // Cleanup
  dispose(): void;
}

interface CollectedEvents {
  all: AgentSessionEvent[];
  toolCalls: Array<{ toolName: string; input: any; blocked: boolean; blockReason?: string }>;
  toolResults: Array<{ toolName: string; content: any; isError: boolean }>;
  messages: AgentMessage[];
  // Filter helpers
  toolCallsFor(toolName: string): Array<{ input: any; blocked: boolean }>;
}
```

Usage in a test:

```typescript
import { createTestSession } from "@marcfargas/pi-test-harness";

it("plan_propose creates a plan file", async () => {
  const t = await createTestSession({
    extensions: ["../pi-planner/src/index.ts"],
    playbook: [
      { toolCalls: [{ name: "plan_propose", arguments: {
        title: "Send invoice",
        steps: [{ description: "Send email", tool: "go-easy", operation: "send" }],
      }}] },
      { text: "Plan proposed successfully." },
    ],
  });

  await t.prompt("Create a plan to send an invoice reminder");
  
  expect(t.events.toolCallsFor("plan_propose")).toHaveLength(1);
  expect(t.events.toolResults[0].isError).toBe(false);
  // Could also check the plan file was created in t.cwd
  
  t.dispose();
});
```

### Layer 3: Sandbox Installation Test

A separate test utility that verifies the npm package works when installed clean. This answers the question: "Can a user `pi install npm:@marcfargas/pi-planner` and have it actually work?"

```typescript
import { verifySandboxInstall } from "@marcfargas/pi-test-harness";

it("pi-planner installs and loads from npm pack", async () => {
  const result = await verifySandboxInstall({
    // Path to the package to test (runs npm pack)
    packageDir: "../pi-planner",
    // Or: tarball: "./marcfargas-pi-planner-0.2.0.tgz",
    
    // Verify these resources are discovered
    expect: {
      extensions: ["src/index.ts"],  // relative to package
      // skills: ["SKILL.md"],
    },
    
    // Optional: also run a playbook test in the sandbox
    playbook: [
      { toolCalls: [{ name: "plan_list", arguments: {} }] },
      { text: "No plans found." },
    ],
    prompt: "List all plans",
  });

  expect(result.extensionsLoaded).toHaveLength(1);
  expect(result.extensionErrors).toHaveLength(0);
  expect(result.toolsRegistered).toContain("plan_propose");
});
```

**Implementation approach — simulate `npm:` package install**:
1. Run `npm pack` in the package directory → produces tarball
2. Create a temp directory simulating a clean pi environment:
   ```
   temp/
     .pi/
       settings.json   ← { "packages": ["npm:@marcfargas/pi-planner"] }
     package.json      ← minimal, with the tarball as a dependency
     node_modules/     ← after npm install
   ```
3. Install the tarball: `npm install ./path-to-tarball.tgz`
4. Create a `DefaultResourceLoader` with `cwd` and `agentDir` pointing at the temp dir
5. Call `loader.reload()` — this triggers pi's package discovery
6. Verify: extensions load without errors, expected tools are registered, skills are found
7. Optionally: wire up a `createAgentSession` with the loader and run a playbook test
8. Clean up temp dir

**What this catches**:
- Missing files in `package.json` `"files"` array
- Broken `"pi"` manifest (wrong extension paths)
- Missing dependencies (not in `dependencies` or `peerDependencies`)
- Import resolution failures (ESM module paths wrong after pack)
- Extension load errors (syntax errors, missing exports)
- Tool registration failures

**Timing concern**: `npm pack` + `npm install` is ~5-10 seconds. These tests should be in a separate test suite (e.g., `vitest run --project sandbox`) not run on every `vitest run`.

### Layer 4: Vitest integration

Simple Vitest helpers, not a plugin:

```typescript
// vitest setup / fixtures
import { testSession, sandboxInstall } from "@marcfargas/pi-test-harness/vitest";

// Auto-cleanup via Vitest's afterEach
const t = testSession({
  extensions: ["./src/index.ts"],
  playbook: [...],
});

// Or use as a fixture factory
```

## Phases / Priority

### Phase 1: PlaybookModel + TestSession (core)
- PlaybookModel implementing streamFn
- TestSession wrapping createAgentSession with defaults
- Event collector
- Basic Vitest helpers
- Tests for the harness itself

### Phase 2: Sandbox Installation Verification
- npm pack + temp install flow
- Resource loader verification
- Optional playbook in sandbox

### Phase 3: Advanced playbook features
- Conditional responses (match on tool results)
- Playbook recording from real sessions (record once, replay forever)
- Assertion matchers for common patterns

## Constraints

- **TypeScript, ESM** — Same as the rest of the monorepo
- **Vitest** — Our test runner, but harness should be runner-agnostic at the core
- **Peer dep on `@mariozechner/pi-coding-agent`** — We use its SDK, not reinvent it
- **Peer dep on `@mariozechner/pi-ai`** — For EventStream, AssistantMessage types
- **Windows + Git Bash** — Must work on our dev environment
- **No real LLM calls in default tests** — Deterministic, fast, free
- **Published as `@marcfargas/pi-test-harness`** — Usable by other extension authors

## Risks

- **SDK internal changes** — `streamFn` interface or `Agent` constructor could change. Mitigation: pin peer dep version, test against latest in CI.
- **Extension loading complexity** — `DefaultResourceLoader` + `discoverAndLoadExtensions` have complex discovery logic. Mitigation: Use the SDK's own helpers, don't reimplement.
- **Sandbox npm pack timing** — npm pack + install is slow (~5-10s). Mitigation: Run sandbox tests in a separate test suite, not on every `vitest run`.
- **Playbook rigidity** — Playbooks are brittle to agent loop changes (number of turns, tool call ordering). Mitigation: Provide flexible matching, not just index-based.

## Open Questions

1. **Should the playbook support regex/glob matching on tool call arguments?** Or is exact match + custom assertPrompt enough?
2. **Should we support "dynamic" playbooks** where the response depends on what tools returned? (e.g., "if read tool returns X, respond with Y")
3. **How should we handle extension UI calls** (ctx.ui.confirm, ctx.ui.select)? Auto-approve? Configurable responses?
4. **Should the sandbox test actually run `pi install` CLI or simulate it programmatically?** The CLI approach is more realistic but slower and requires pi to be installed.
5. **Package name**: `@marcfargas/pi-test-harness` or `@marcfargas/pi-test-kit` or just include in each package?
