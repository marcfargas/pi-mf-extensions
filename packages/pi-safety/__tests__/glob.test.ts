import { describe, it, expect } from "vitest";
import { globMatch } from "../src/glob.js";

describe("globMatch", () => {
	describe("exact matches", () => {
		it("matches identical strings", () => {
			expect(globMatch("npx go-gmail list", "npx go-gmail list")).toBe(true);
		});

		it("rejects different strings", () => {
			expect(globMatch("npx go-gmail list", "npx go-gmail send")).toBe(false);
		});
	});

	describe("wildcard matching", () => {
		it("matches * at the end", () => {
			expect(globMatch("npx go-gmail *", "npx go-gmail marc@blegal.eu search invoice")).toBe(true);
		});

		it("matches * in the middle", () => {
			expect(globMatch("npx go-gmail * search *", "npx go-gmail marc@blegal.eu search invoice")).toBe(true);
		});

		it("matches multiple wildcards", () => {
			expect(globMatch("gcloud * list *", "gcloud compute instances list --format=json")).toBe(true);
		});

		it("matches * as empty string", () => {
			expect(globMatch("gcloud * list*", "gcloud compute instances list")).toBe(true);
		});

		it("matches leading wildcard", () => {
			// Should fail validation (patterns must start with tool name), but glob itself works
			expect(globMatch("* search *", "npx go-gmail marc search query")).toBe(true);
		});
	});

	describe("real-world patterns", () => {
		// go-easy Gmail
		it("matches go-gmail search", () => {
			expect(globMatch(
				"npx go-gmail * search *",
				"npx go-gmail marc@blegal.eu search \"from:client is:unread\"",
			)).toBe(true);
		});

		it("matches go-gmail get", () => {
			expect(globMatch(
				"npx go-gmail * get *",
				"npx go-gmail marc@blegal.eu get abc123",
			)).toBe(true);
		});

		it("matches go-gmail thread", () => {
			expect(globMatch(
				"npx go-gmail * thread *",
				"npx go-gmail marc@blegal.eu thread 1234567890",
			)).toBe(true);
		});

		it("matches go-gmail send", () => {
			expect(globMatch(
				"npx go-gmail * send *",
				"npx go-gmail marc@blegal.eu send --to=test@example.com --subject=hello --confirm",
			)).toBe(true);
		});

		// gcloud
		it("matches gcloud list", () => {
			expect(globMatch(
				"gcloud * list *",
				"gcloud compute instances list --format=json",
			)).toBe(true);
		});

		it("matches gcloud describe", () => {
			expect(globMatch(
				"gcloud * describe *",
				"gcloud run services describe my-service --region=europe-west1 --format=json",
			)).toBe(true);
		});

		it("matches gcloud delete", () => {
			expect(globMatch(
				"gcloud * delete *",
				"gcloud run services delete my-service --region=europe-west1",
			)).toBe(true);
		});

		// Azure CLI
		it("matches az list", () => {
			expect(globMatch(
				"az * list *",
				"az vm list --output json",
			)).toBe(true);
		});

		it("matches az show", () => {
			expect(globMatch(
				"az * show *",
				"az webapp show --name myapp --resource-group myrg --output json",
			)).toBe(true);
		});
	});

	describe("non-matches", () => {
		it("doesn't match when tool name differs", () => {
			expect(globMatch("npx go-gmail * search *", "npx go-drive marc list")).toBe(false);
		});

		it("doesn't match partial tool name", () => {
			expect(globMatch("gcloud * list *", "gcloudx compute list")).toBe(false);
		});

		it("doesn't match when operation differs", () => {
			expect(globMatch("npx go-gmail * search *", "npx go-gmail marc send --to=x")).toBe(false);
		});
	});

	describe("regex special characters", () => {
		it("handles dots in commands", () => {
			expect(globMatch("npx go-gmail * search *", "npx go-gmail marc@blegal.eu search q")).toBe(true);
		});

		it("handles parentheses in patterns", () => {
			expect(globMatch("cmd (test) *", "cmd (test) arg")).toBe(true);
		});

		it("handles brackets in patterns", () => {
			expect(globMatch("cmd [flag] *", "cmd [flag] value")).toBe(true);
		});
	});

	describe("whitespace handling", () => {
		it("trims command before matching", () => {
			expect(globMatch("gcloud * list *", "  gcloud compute list --format=json  ")).toBe(true);
		});
	});
});
