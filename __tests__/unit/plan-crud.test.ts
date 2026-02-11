import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PlanStore, serializePlan, parsePlan } from "../../src/persistence/plan-store.js";

describe("PlanStore", () => {
	let tmpDir: string;
	let store: PlanStore;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-planner-test-"));
		store = new PlanStore(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("create", () => {
		it("creates a plan file on disk", async () => {
			const plan = await store.create({
				title: "Test plan",
				steps: [{ description: "Do thing", tool: "odoo-toolbox", operation: "write" }],
				tools_required: ["odoo-toolbox"],
			});

			expect(plan.id).toMatch(/^PLAN-[0-9a-f]{8}$/);
			expect(plan.status).toBe("proposed");
			expect(plan.version).toBe(1);
			expect(plan.steps).toHaveLength(1);
			expect(plan.tools_required).toEqual(["odoo-toolbox"]);

			// Verify file exists on disk
			const filePath = path.join(tmpDir, ".pi", "plans", `${plan.id}.md`);
			expect(fs.existsSync(filePath)).toBe(true);
		});

		it("generates unique IDs", async () => {
			const p1 = await store.create({ title: "A", steps: [], tools_required: [] });
			const p2 = await store.create({ title: "B", steps: [], tools_required: [] });
			expect(p1.id).not.toBe(p2.id);
		});
	});

	describe("get", () => {
		it("returns null for non-existent plan", async () => {
			expect(await store.get("PLAN-00000000")).toBeNull();
		});

		it("returns created plan", async () => {
			const created = await store.create({
				title: "Test",
				steps: [{ description: "Step 1", tool: "go-easy", operation: "send" }],
				tools_required: ["go-easy"],
			});
			const fetched = await store.get(created.id);
			expect(fetched).not.toBeNull();
			expect(fetched!.title).toBe("Test");
			expect(fetched!.steps[0].tool).toBe("go-easy");
		});

		it("reads from disk after cache invalidation", async () => {
			const created = await store.create({
				title: "Persistent",
				steps: [],
				tools_required: ["odoo-toolbox"],
			});

			store.invalidateCache();

			const fetched = await store.get(created.id);
			expect(fetched).not.toBeNull();
			expect(fetched!.title).toBe("Persistent");
		});
	});

	describe("list", () => {
		it("returns empty for no plans", async () => {
			const plans = await store.list();
			expect(plans).toEqual([]);
		});

		it("returns all plans", async () => {
			await store.create({ title: "A", steps: [], tools_required: [] });
			await store.create({ title: "B", steps: [], tools_required: [] });
			const plans = await store.list();
			expect(plans).toHaveLength(2);
		});

		it("filters by status", async () => {
			const p = await store.create({ title: "A", steps: [], tools_required: [] });
			await store.create({ title: "B", steps: [], tools_required: [] });
			await store.approve(p.id);

			const proposed = await store.list({ status: "proposed" });
			expect(proposed).toHaveLength(1);
			expect(proposed[0].title).toBe("B");

			const approved = await store.list({ status: "approved" });
			expect(approved).toHaveLength(1);
			expect(approved[0].title).toBe("A");
		});
	});

	describe("status transitions", () => {
		it("approve: proposed → approved", async () => {
			const p = await store.create({ title: "T", steps: [], tools_required: [] });
			const approved = await store.approve(p.id);
			expect(approved.status).toBe("approved");
			expect(approved.version).toBe(2);
		});

		it("reject: proposed → rejected with feedback", async () => {
			const p = await store.create({ title: "T", steps: [], tools_required: [] });
			const rejected = await store.reject(p.id, "Wrong invoice");
			expect(rejected.status).toBe("rejected");
			expect(rejected.body).toContain("Wrong invoice");
		});

		it("cannot approve already approved plan", async () => {
			const p = await store.create({ title: "T", steps: [], tools_required: [] });
			await store.approve(p.id);
			await expect(store.approve(p.id)).rejects.toThrow("Cannot approve");
		});

		it("markExecuting: approved → executing", async () => {
			const p = await store.create({ title: "T", steps: [], tools_required: [] });
			await store.approve(p.id);
			const executing = await store.markExecuting(p.id);
			expect(executing.status).toBe("executing");
			expect(executing.execution_started_at).toBeTruthy();
		});

		it("markCompleted: executing → completed", async () => {
			const p = await store.create({ title: "T", steps: [], tools_required: [] });
			await store.approve(p.id);
			await store.markExecuting(p.id);
			const completed = await store.markCompleted(p.id, "All done");
			expect(completed.status).toBe("completed");
			expect(completed.result_summary).toBe("All done");
		});

		it("markFailed: executing → failed", async () => {
			const p = await store.create({ title: "T", steps: [], tools_required: [] });
			await store.approve(p.id);
			await store.markExecuting(p.id);
			const failed = await store.markFailed(p.id, "Step 2 error");
			expect(failed.status).toBe("failed");
			expect(failed.result_summary).toBe("Step 2 error");
		});
	});

	describe("optimistic locking", () => {
		it("increments version on every update", async () => {
			const p = await store.create({ title: "T", steps: [], tools_required: [] });
			expect(p.version).toBe(1);

			const p2 = await store.approve(p.id);
			expect(p2.version).toBe(2);

			const p3 = await store.markExecuting(p.id);
			expect(p3.version).toBe(3);
		});
	});
});

describe("serialization", () => {
	it("roundtrips a plan through serialize/parse", () => {
		const plan = {
			id: "PLAN-deadbeef",
			title: "Send invoice reminder",
			status: "proposed" as const,
			version: 1,
			created_at: "2026-02-11T12:00:00.000Z",
			updated_at: "2026-02-11T12:00:00.000Z",
			planner_model: "claude-sonnet-4-5",
			tools_required: ["odoo-toolbox", "go-easy"],
			executor_model: "claude-haiku-4-5",
			steps: [
				{ description: "Read invoice", tool: "odoo-toolbox", operation: "read", target: "INV-2024-0847" },
				{ description: "Send reminder email", tool: "go-easy", operation: "send" },
			],
			context: "Invoice is overdue by 30 days.",
		};

		const serialized = serializePlan(plan);
		const parsed = parsePlan(serialized);

		expect(parsed.id).toBe(plan.id);
		expect(parsed.title).toBe(plan.title);
		expect(parsed.status).toBe(plan.status);
		expect(parsed.version).toBe(plan.version);
		expect(parsed.tools_required).toEqual(plan.tools_required);
		expect(parsed.steps).toHaveLength(2);
		expect(parsed.steps[0].target).toBe("INV-2024-0847");
		expect(parsed.context).toBe("Invoice is overdue by 30 days.");
	});
});
