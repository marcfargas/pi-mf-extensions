/**
 * pi-planner: tool blocking in plan mode via harness.
 *
 * Tests the tool_call hook that blocks destructive operations when plan mode is active.
 * The hook uses isSafeBashCommand() for bash and PLAN_MODE_BLOCKED_TOOLS for write/edit/todo.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { createTestSession, when, call, say, type TestSession } from "@marcfargas/pi-test-harness";

const EXTENSION_PATH = path.resolve(__dirname, "../../src/index.ts");

const MOCKS = {
	bash: (params: Record<string, unknown>) => `mock: ${params.command}`,
	read: "mock contents",
	write: "mock written",
	edit: "mock edited",
	grep: "mock grep",
	find: "mock find",
	ls: "mock ls",
	todo: "mock todo",
};

describe("pi-planner: tool blocking in plan mode", () => {
	let t: TestSession;

	afterEach(() => {
		t?.dispose();
	});

	it("blocks write tool in plan mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Enter plan mode then try to write", [
				call("plan_mode", { enable: true }),
				call("write", { path: "test.txt", content: "hello" }),
				say("Write was blocked."),
			]),
		);

		// write tool should have been called but blocked by the hook
		const writeResults = t.events.toolResultsFor("write");
		expect(writeResults).toHaveLength(1);
		expect(writeResults[0].isError).toBe(true);
		expect(writeResults[0].text).toContain("blocked");
	});

	it("blocks edit tool in plan mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Enter plan mode then try to edit", [
				call("plan_mode", { enable: true }),
				call("edit", { path: "test.txt", oldText: "a", newText: "b" }),
				say("Edit was blocked."),
			]),
		);

		const editResults = t.events.toolResultsFor("edit");
		expect(editResults).toHaveLength(1);
		expect(editResults[0].isError).toBe(true);
		expect(editResults[0].text).toContain("blocked");
	});

	it("allows safe bash commands in plan mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Run a safe command in plan mode", [
				call("plan_mode", { enable: true }),
				call("bash", { command: "ls -la" }),
				say("Listed files."),
			]),
		);

		const bashResults = t.events.toolResultsFor("bash");
		expect(bashResults).toHaveLength(1);
		expect(bashResults[0].isError).toBe(false);
		expect(bashResults[0].text).toContain("mock: ls -la");
	});

	it("blocks destructive bash in plan mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Try a destructive command in plan mode", [
				call("plan_mode", { enable: true }),
				call("bash", { command: "rm -rf /tmp/test" }),
				say("Command was blocked."),
			]),
		);

		const bashResults = t.events.toolResultsFor("bash");
		expect(bashResults).toHaveLength(1);
		expect(bashResults[0].isError).toBe(true);
		expect(bashResults[0].text).toContain("blocked");
	});

	it("blocks npm install in plan mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Try npm install in plan mode", [
				call("plan_mode", { enable: true }),
				call("bash", { command: "npm install lodash" }),
				say("npm was blocked."),
			]),
		);

		const bashResults = t.events.toolResultsFor("bash");
		expect(bashResults).toHaveLength(1);
		expect(bashResults[0].isError).toBe(true);
	});

	it("allows git status but blocks git push in plan mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Git operations in plan mode", [
				call("plan_mode", { enable: true }),
				call("bash", { command: "git status" }),
				call("bash", { command: "git push origin main" }),
				say("Git status worked, push blocked."),
			]),
		);

		const bashResults = t.events.toolResultsFor("bash");
		expect(bashResults).toHaveLength(2);
		// git status: allowed
		expect(bashResults[0].isError).toBe(false);
		// git push: blocked
		expect(bashResults[1].isError).toBe(true);
		expect(bashResults[1].text).toContain("blocked");
	});

	it("restores full tool access after exiting plan mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Enter, exit, then write", [
				call("plan_mode", { enable: true }),
				call("plan_mode", { enable: false }),
				call("write", { path: "test.txt", content: "hello" }),
				say("Write succeeded."),
			]),
		);

		const writeResults = t.events.toolResultsFor("write");
		expect(writeResults).toHaveLength(1);
		// After exiting plan mode, write should succeed (not blocked)
		expect(writeResults[0].isError).toBe(false);
	});
});
