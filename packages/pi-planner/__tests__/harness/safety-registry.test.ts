/**
 * pi-planner: skill safety registry via harness.
 *
 * Tests plan_skill_safety tool + integration with plan mode bash filtering.
 * The safety registry allows READ operations in plan mode while blocking WRITE.
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
};

describe("pi-planner: safety registry via harness", () => {
	let t: TestSession;

	afterEach(() => {
		t?.dispose();
	});

	it("registers safety patterns via plan_skill_safety", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Register safety patterns", [
				call("plan_skill_safety", {
					tool: "go-gmail",
					commands: {
						"npx go-gmail * search *": "READ",
						"npx go-gmail * get *": "READ",
						"npx go-gmail * send *": "WRITE",
						"npx go-gmail * draft *": "WRITE",
					},
					default: "WRITE",
				}),
				say("Patterns registered."),
			]),
		);

		const result = t.events.toolResultsFor("plan_skill_safety");
		expect(result).toHaveLength(1);
		expect(result[0].text).toContain("Registered 4 safety pattern(s)");
		expect(result[0].text).toContain("go-gmail");
		expect(result[0].isError).toBe(false);
	});

	it("READ commands allowed in plan mode after safety registration", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Register safety then use READ in plan mode", [
				call("plan_skill_safety", {
					tool: "go-gmail",
					commands: {
						"npx go-gmail * search *": "READ",
						"npx go-gmail * send *": "WRITE",
					},
					default: "WRITE",
				}),
				call("plan_mode", { enable: true }),
				// This should be ALLOWED — it's a READ operation
				call("bash", { command: "npx go-gmail marc@test.com search 'invoice'" }),
				say("Search succeeded in plan mode."),
			]),
		);

		const bashResults = t.events.toolResultsFor("bash");
		expect(bashResults).toHaveLength(1);
		expect(bashResults[0].isError).toBe(false);
		expect(bashResults[0].text).toContain("npx go-gmail");
	});

	it("WRITE commands blocked in plan mode after safety registration", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Register safety then use WRITE in plan mode", [
				call("plan_skill_safety", {
					tool: "go-gmail",
					commands: {
						"npx go-gmail * search *": "READ",
						"npx go-gmail * send *": "WRITE",
					},
					default: "WRITE",
				}),
				call("plan_mode", { enable: true }),
				// This should be BLOCKED — it's a WRITE operation
				call("bash", { command: "npx go-gmail marc@test.com send --to bob@test.com" }),
				say("Send was blocked."),
			]),
		);

		const bashResults = t.events.toolResultsFor("bash");
		expect(bashResults).toHaveLength(1);
		expect(bashResults[0].isError).toBe(true);
		expect(bashResults[0].text).toContain("WRITE operation blocked");
	});

	it("multiple tool registrations work together", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Register multiple tools", [
				call("plan_skill_safety", {
					tool: "go-gmail",
					commands: { "npx go-gmail * search *": "READ" },
					default: "WRITE",
				}),
				call("plan_skill_safety", {
					tool: "gcloud",
					commands: { "gcloud * list *": "READ", "gcloud * describe *": "READ" },
					default: "WRITE",
				}),
				call("plan_mode", { enable: true }),
				// Gmail search: READ → allowed
				call("bash", { command: "npx go-gmail marc search 'test'" }),
				// gcloud list: READ → allowed (trailing flag needed for "* list *" glob)
				call("bash", { command: "gcloud compute instances list --format=json" }),
				say("Both READ operations worked."),
			]),
		);

		const bashResults = t.events.toolResultsFor("bash");
		expect(bashResults).toHaveLength(2);
		expect(bashResults[0].isError).toBe(false);
		expect(bashResults[1].isError).toBe(false);
	});

	it("unregistered command falls through to allowlist", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Register safety then run unregistered command", [
				call("plan_skill_safety", {
					tool: "go-gmail",
					commands: { "npx go-gmail * search *": "READ" },
					default: "WRITE",
				}),
				call("plan_mode", { enable: true }),
				// "ls" is not in the safety registry → falls through to allowlist → allowed
				call("bash", { command: "ls -la" }),
				// "curl" is in the allowlist → allowed
				call("bash", { command: "curl https://example.com" }),
				say("Unregistered commands handled by allowlist."),
			]),
		);

		const bashResults = t.events.toolResultsFor("bash");
		expect(bashResults).toHaveLength(2);
		expect(bashResults[0].isError).toBe(false); // ls allowed by allowlist
		expect(bashResults[1].isError).toBe(false); // curl allowed by allowlist
	});
});

describe("pi-planner: tool sequence verification", () => {
	let t: TestSession;

	afterEach(() => {
		t?.dispose();
	});

	it("full plan mode workflow has correct tool sequence", async () => {
		t = await createTestSession({
			extensions: [EXTENSION_PATH],
			mockTools: MOCKS,
		});

		await t.run(
			when("Full plan mode workflow", [
				call("plan_mode", { enable: true }),
				call("bash", { command: "ls" }),
				call("plan_propose", {
					title: "Test plan",
					steps: [{ description: "Do thing", tool: "bash", operation: "run" }],
				}),
				call("plan_list", {}),
				call("plan_mode", { enable: false }),
				say("Workflow complete."),
			]),
		);

		expect(t.events.toolSequence()).toEqual([
			"plan_mode",
			"bash",
			"plan_propose",
			"plan_list",
			"plan_mode",
		]);
	});
});
