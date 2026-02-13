# pi-test-harness — Vision v2 (Post-Review)

## Core Insight

There is no model. The **playbook IS the model**. The user prompt text is irrelevant — it just triggers the agent loop. The playbook dictates exactly what "the model responds with" (tool calls, text, stop reasons).

So the API should NOT pretend you're "prompting" an LLM. It should be explicit:

```typescript
// The agent loop: prompt → streamFn → playbook[0] → tool exec → streamFn → playbook[1] → ...
const t = await createTestSession({
  extensions: ["./src/index.ts"],
  playbook: [
    { toolCalls: [{ name: "plan_mode", arguments: { enable: true } }] },
    { text: "Plan mode enabled." },
  ],
});
await t.run();  // NOT "prompt" — just runs the playbook through the agent loop
```

## What Each Package Needs Tested

### pi-safety (library, no extension)
- SafetyRegistry is already well unit-tested
- **Session test**: Register safety patterns via `plan_skill_safety` tool → verify `resolve()` works in a real tool_call hook chain

### pi-planner (extension)
Multi-step sequences:
1. **Tool registration**: Extension loads → tools are registered → tools work
2. **Plan lifecycle**: propose → list → approve → execution starts
3. **Plan mode blocking**: enter plan mode → try `write`/`edit` → blocked; try safe `bash` → allowed; try destructive `bash` → blocked
4. **Safety registry integration**: register safety via tool → bash command matches → allowed/blocked correctly
5. **before_agent_start hook**: injects plan-mode context message
6. **Session state persistence**: plan mode state survives session restart (appendEntry → session_start restore)

### permission-gate (extension)
- tool_call hook blocks/allows based on safety classifications

### Sandbox install (all packages)
- `npm pack` → install in clean temp → `DefaultResourceLoader` discovers extensions → tools register → no errors

## Architecture

### Layer 1: PlaybookModel

```typescript
interface PlaybookTurn {
  // What the mock model returns
  text?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  
  // Optional: inspect what was sent TO the model this turn
  assertContext?: (messages: Message[]) => void;
}

type Playbook = PlaybookTurn[];
```

Implementation: A `streamFn` that pops turns from the playbook and returns `AssistantMessageEventStream`.

### Layer 2: TestSession

```typescript
interface TestSessionOptions {
  // Extension(s) to load — file paths
  extensions?: string[];
  
  // Extension factories (for inline/unit-style)
  extensionFactories?: ExtensionFactory[];
  
  // Scripted model responses
  playbook: Playbook;
  
  // Working directory (auto temp dir if omitted)
  cwd?: string;
  
  // System prompt override
  systemPrompt?: string;
  
  // UI mock responses
  ui?: {
    confirm?: boolean | ((title: string, message: string) => boolean);
    select?: number | string | ((title: string, items: string[]) => string | undefined);
    input?: string | ((title: string) => string | undefined);
    editor?: string | ((title: string) => string | undefined);
  };
}

interface TestSession {
  // The real session underneath
  session: AgentSession;
  cwd: string;
  
  // Run the playbook (triggers agent loop with dummy prompt)
  run(trigger?: string): Promise<void>;
  
  // Event inspection
  events: {
    all: AgentSessionEvent[];
    toolCalls: ToolCallRecord[];
    toolResults: ToolResultRecord[];
    messages: AgentMessage[];
    
    // Filtered access
    toolCallsFor(name: string): ToolCallRecord[];
    toolResultsFor(name: string): ToolResultRecord[];
    blockedCalls(): ToolCallRecord[];
  };
  
  // Playbook state
  playbook: {
    consumed: number;
    remaining: number;
  };
  
  // Cleanup
  dispose(): void;
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
  content: any[];
  isError: boolean;
  details?: unknown;
}
```

### Layer 3: Sandbox Install Verification

```typescript
interface SandboxOptions {
  // Package directory (runs npm pack)
  packageDir: string;
  
  // Expected resources after install
  expect?: {
    extensions?: number;  // expected count
    skills?: number;
    tools?: string[];     // expected tool names
  };
  
  // Optional: run a playbook in the sandbox
  playbook?: Playbook;
  trigger?: string;
}

interface SandboxResult {
  extensionsLoaded: number;
  extensionErrors: string[];
  toolsRegistered: string[];
  skillsLoaded: number;
  
  // If playbook was provided
  testResult?: TestSession;
}

async function verifySandboxInstall(options: SandboxOptions): Promise<SandboxResult>;
```

## Implementation Plan

### Phase 1: Core (1 week)
1. PlaybookModel (streamFn + AssistantMessageEventStream)
2. TestSession (createAgentSession wrapper + event collection + UI mocks)
3. Basic tests for the harness itself
4. Use it to write 3-5 real tests for pi-planner

### Phase 2: Sandbox (1 week)
1. npm pack + temp install
2. DefaultResourceLoader in sandbox
3. Extension verification
4. Optional playbook execution in sandbox

### Phase 3: Polish (ongoing)
- Vitest helpers / fixtures
- Better error messages when playbook doesn't match
- Session state inspection helpers
