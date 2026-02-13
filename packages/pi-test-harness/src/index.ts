/**
 * @marcfargas/pi-test-harness
 *
 * Test harness for pi extensions — playbook-based model mocking,
 * session testing, sandbox install verification.
 */

// DSL builders
export { when, call, say } from "./playbook.js";

// Session
export { createTestSession } from "./session.js";

// Sandbox
export { verifySandboxInstall } from "./sandbox.js";

// Types
export type {
	TestSession,
	TestSessionOptions,
	TestEvents,
	ToolCallRecord,
	ToolResultRecord,
	UICallRecord,
	MockToolHandler,
	MockUIConfig,
	SandboxOptions,
	SandboxResult,
	Turn,
	PlaybookAction,
} from "./types.js";
