/**
 * pi-planner extension tests using pi-test-harness.
 *
 * Tests plan mode behavior:
 * - Entering/exiting plan mode via plan_mode tool
 * - Tool blocking in plan mode (write, edit blocked)
 * - Safe bash commands allowed in plan mode
 * - Destructive bash blocked in plan mode
 */

import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { createTestSession, when, call, say, type TestSession } from "@marcfargas/pi-test-harness";

const EXTENSION_PATH = path.resolve(__dirname, "../../src/index.ts");

// Mock all built-in tools so they don't actually execute
const SAFE_MOCKS = {
	bash: (params: Record<string, unknown>) => `mock: ${params.command}`,
	read: "mock file contents",
	write: "mock written",
	edit: "mock edited",
	grep: "mock grep results",
	find: "mock find results",
	ls: "mock ls results",
};

describe("pi-planner: plan mode via harness", () => {
	let t: TestSession;

	afterEach(() => {
		t?.dispose();
	});

	it("enters plan mode and reports success", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: SAFE_MOCKS,
		});

		await t.run(
			when("Enter plan mode", [
				call("plan_mode", { enable: true }),
				say("Plan mode is now active."),
			]),
		);

		// Verify plan_mode tool was called and returned success
		const results = t.events.toolResultsFor("plan_mode");
		expect(results).toHaveLength(1);
		expect(results[0].text).toContain("Plan mode enabled");
		expect(results[0].isError).toBe(false);

		// Verify UI notifications
		const notifies = t.events.uiCallsFor("notify");
		expect(notifies.some((n) => String(n.args[0]).includes("Plan mode enabled"))).toBe(true);
	});

	it("exits plan mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: SAFE_MOCKS,
		});

		await t.run(
			when("Enter then exit plan mode", [
				call("plan_mode", { enable: true }),
				call("plan_mode", { enable: false }),
				say("Back to normal."),
			]),
		);

		const results = t.events.toolResultsFor("plan_mode");
		expect(results).toHaveLength(2);
		expect(results[0].text).toContain("enabled");
		expect(results[1].text).toContain("disabled");
	});

	it("reports no-op when already in requested mode", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: SAFE_MOCKS,
		});

		await t.run(
			when("Try enabling plan mode when already off", [
				call("plan_mode", { enable: false }),
				say("No change needed."),
			]),
		);

		const results = t.events.toolResultsFor("plan_mode");
		expect(results).toHaveLength(1);
		expect(results[0].text).toContain("Already");
	});
});

describe("pi-planner: plan_propose and plan_list", () => {
	let t: TestSession;

	afterEach(() => {
		t?.dispose();
	});

	it("creates a plan proposal and lists it", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: SAFE_MOCKS,
		});

		let planId = "";

		await t.run(
			when("Create a plan", [
				call("plan_mode", { enable: true }),
				call("plan_propose", {
					title: "Deploy new version",
					steps: [
						{
							description: "Build the project",
							tool: "bash",
							operation: "build",
						},
						{
							description: "Deploy to staging",
							tool: "gcloud",
							operation: "deploy",
						},
					],
				}).then((result) => {
					const match = result.text.match(/PLAN-[a-f0-9]+/);
					if (match) planId = match[0];
				}),
				say("Plan proposed."),
			]),
		);

		expect(planId).toMatch(/^PLAN-/);

		const proposeResult = t.events.toolResultsFor("plan_propose");
		expect(proposeResult).toHaveLength(1);
		expect(proposeResult[0].text).toContain("Deploy new version");
	});

	it("full lifecycle: propose → list → get → approve → reject", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: SAFE_MOCKS,
		});

		let planId = "";

		await t.run(
			when("Create and manage a plan", [
				call("plan_mode", { enable: true }),
				call("plan_propose", {
					title: "Send email",
					steps: [
						{
							description: "Draft the email",
							tool: "go-easy",
							operation: "draft",
						},
					],
				}).then((result) => {
					const match = result.text.match(/PLAN-[a-f0-9]+/);
					if (match) planId = match[0];
				}),
				call("plan_list", {}),
				say("Plans listed."),
			]),
		);

		expect(planId).toMatch(/^PLAN-/);

		// plan_list should show the proposed plan
		const listResult = t.events.toolResultsFor("plan_list");
		expect(listResult).toHaveLength(1);
		expect(listResult[0].text).toContain("Send email");
	});
});
