import { describe, it, expect, beforeEach } from "vitest";
import { SafetyRegistry } from "../src/registry.js";

describe("SafetyRegistry", () => {
	let registry: SafetyRegistry;

	beforeEach(() => {
		registry = new SafetyRegistry();
	});

	describe("register", () => {
		it("accepts valid READ/WRITE patterns", () => {
			const result = registry.register("go-gmail", {
				"go-gmail * search *": "READ",
				"go-gmail * send *": "WRITE",
			});
			expect(result.accepted).toBe(2);
			expect(result.rejected).toHaveLength(0);
		});

		it("rejects invalid safety levels", () => {
			const result = registry.register("go-gmail", {
				"go-gmail * search *": "SAFE",
				"go-gmail * send *": "DESTRUCTIVE",
			});
			expect(result.accepted).toBe(0);
			expect(result.rejected).toHaveLength(2);
			expect(result.rejected[0].reason).toContain("invalid level");
			expect(result.rejected[1].reason).toContain("invalid level");
		});

		it("rejects empty patterns", () => {
			const result = registry.register("go-gmail", {
				"": "READ",
				"   ": "READ",
			});
			expect(result.accepted).toBe(0);
			expect(result.rejected).toHaveLength(2);
		});

		it("rejects pure wildcard patterns", () => {
			const result = registry.register("go-gmail", {
				"*": "READ",
				"* *": "READ",
				"* * *": "READ",
			});
			expect(result.accepted).toBe(0);
			expect(result.rejected).toHaveLength(3);
			expect(result.rejected[0].reason).toContain("only wildcards");
		});

		it("rejects patterns that don't start with tool name", () => {
			const result = registry.register("go-gmail", {
				"npx go-calendar * list *": "READ",  // wrong tool name after npx
				"* search *": "READ",                 // wildcard before tool name
				"search go-gmail": "READ",            // tool name not at start
			});
			expect(result.accepted).toBe(0);
			expect(result.rejected).toHaveLength(3);
			expect(result.rejected[0].reason).toContain("must start with tool name");
		});

		it("accepts patterns starting with tool name", () => {
			const result = registry.register("go-gmail", {
				"go-gmail * search *": "READ",
				"go-gmail * send *": "WRITE",
			});
			expect(result.accepted).toBe(2);
		});

		it("accepts patterns with runner prefix (npx, node, etc.)", () => {
			const result = registry.register("go-gmail", {
				"npx go-gmail * search *": "READ",
				"npx go-gmail * send *": "WRITE",
			});
			expect(result.accepted).toBe(2);
			expect(result.rejected).toHaveLength(0);
		});

		it("replaces previous registration for same tool", () => {
			registry.register("gcloud", { "gcloud * list *": "READ" });
			expect(registry.size).toBe(1);

			registry.register("gcloud", { "gcloud * describe *": "READ" });
			expect(registry.size).toBe(1);

			// Old pattern should be gone
			expect(registry.resolve("gcloud compute instances list --format=json")).toBeNull();
			// New pattern should work
			expect(registry.resolve("gcloud run describe my-svc")).toBe("READ");
		});

		it("defaults to WRITE when default level is invalid", () => {
			registry.register("gcloud", { "gcloud * list *": "READ" }, "INVALID");
			const entry = registry.inspectTool("gcloud");
			expect(entry?.default).toBe("WRITE");
		});

		it("accepts valid default level", () => {
			registry.register("gcloud", { "gcloud * list *": "READ" }, "READ");
			const entry = registry.inspectTool("gcloud");
			expect(entry?.default).toBe("READ");
		});

		it("mixes accepted and rejected patterns", () => {
			const result = registry.register("gcloud", {
				"gcloud * list *": "READ",        // valid
				"* delete *": "WRITE",             // rejected: doesn't start with tool
				"gcloud * describe *": "READ",     // valid
				"gcloud * deploy *": "BANANA",     // rejected: invalid level
			});
			expect(result.accepted).toBe(2);
			expect(result.rejected).toHaveLength(2);
		});
	});

	describe("resolve", () => {
		beforeEach(() => {
			registry.register("go-gmail", {
				"npx go-gmail * search *": "READ",
				"npx go-gmail * get *": "READ",
				"npx go-gmail * thread *": "READ",
				"npx go-gmail * labels": "READ",
				"npx go-gmail * send *": "WRITE",
				"npx go-gmail * draft *": "WRITE",
				"npx go-gmail * reply *": "WRITE",
			});

			registry.register("gcloud", {
				"gcloud * list *": "READ",
				"gcloud * describe *": "READ",
				"gcloud * delete *": "WRITE",
				"gcloud * create *": "WRITE",
				"gcloud * deploy *": "WRITE",
			});
		});

		it("resolves READ operations", () => {
			expect(registry.resolve("npx go-gmail marc@blegal.eu search \"invoice\"")).toBe("READ");
			expect(registry.resolve("npx go-gmail marc@blegal.eu get msg123")).toBe("READ");
			expect(registry.resolve("npx go-gmail marc@blegal.eu thread thread123")).toBe("READ");
			expect(registry.resolve("gcloud compute instances list --format=json")).toBe("READ");
			expect(registry.resolve("gcloud run services describe my-svc --format=json")).toBe("READ");
		});

		it("resolves WRITE operations", () => {
			expect(registry.resolve("npx go-gmail marc@blegal.eu send --to=x --confirm")).toBe("WRITE");
			expect(registry.resolve("npx go-gmail marc@blegal.eu draft --to=x")).toBe("WRITE");
			expect(registry.resolve("npx go-gmail marc@blegal.eu reply msg123 --confirm")).toBe("WRITE");
			expect(registry.resolve("gcloud run services delete my-svc")).toBe("WRITE");
			expect(registry.resolve("gcloud run deploy my-svc --image=img")).toBe("WRITE");
		});

		it("returns null for unknown commands", () => {
			expect(registry.resolve("cat README.md")).toBeNull();
			expect(registry.resolve("ls -la")).toBeNull();
			expect(registry.resolve("npm test")).toBeNull();
		});

		it("returns null for commands from unregistered tools", () => {
			expect(registry.resolve("npx go-drive marc list")).toBeNull();
			expect(registry.resolve("az vm list")).toBeNull();
		});

		it("returns null for commands that don't match any pattern", () => {
			// go-gmail command but operation not in registry
			expect(registry.resolve("npx go-gmail marc@blegal.eu forward msg123")).toBeNull();
		});

		it("first match wins across tools", () => {
			// Both tools have patterns, but go-gmail is registered first
			expect(registry.resolve("npx go-gmail marc search x")).toBe("READ");
		});

		it("trims command whitespace", () => {
			expect(registry.resolve("  gcloud compute instances list --format=json  ")).toBe("READ");
		});
	});

	describe("inspect", () => {
		it("returns empty array when registry is empty", () => {
			expect(registry.inspect()).toEqual([]);
		});

		it("returns registered tools with pattern counts", () => {
			registry.register("go-gmail", {
				"go-gmail * search *": "READ",
				"go-gmail * send *": "WRITE",
			});
			registry.register("gcloud", {
				"gcloud * list *": "READ",
			});

			const entries = registry.inspect();
			expect(entries).toHaveLength(2);
			expect(entries).toContainEqual({ tool: "go-gmail", patterns: 2, default: "WRITE" });
			expect(entries).toContainEqual({ tool: "gcloud", patterns: 1, default: "WRITE" });
		});
	});

	describe("inspectTool", () => {
		it("returns undefined for unknown tool", () => {
			expect(registry.inspectTool("unknown")).toBeUndefined();
		});

		it("returns full entry for registered tool", () => {
			registry.register("gcloud", {
				"gcloud * list *": "READ",
				"gcloud * delete *": "WRITE",
			}, "WRITE");

			const entry = registry.inspectTool("gcloud");
			expect(entry).toBeDefined();
			expect(entry!.commands).toHaveLength(2);
			expect(entry!.default).toBe("WRITE");
		});
	});

	describe("clear", () => {
		it("removes all entries", () => {
			registry.register("gcloud", { "gcloud * list *": "READ" });
			registry.register("go-gmail", { "go-gmail * search *": "READ" });
			expect(registry.size).toBe(2);

			registry.clear();
			expect(registry.size).toBe(0);
			expect(registry.resolve("gcloud compute list")).toBeNull();
		});
	});

	describe("size", () => {
		it("reflects number of registered tools", () => {
			expect(registry.size).toBe(0);
			registry.register("gcloud", { "gcloud * list *": "READ" });
			expect(registry.size).toBe(1);
			registry.register("go-gmail", { "go-gmail * search *": "READ" });
			expect(registry.size).toBe(2);
		});
	});
});
