/**
 * Repo-level E2E test — configure all pi packages via settings.packages,
 * verify pi loads and sees all extensions, tools, and skills.
 *
 * Uses local paths (no npm pack/install needed — that's tested per-package
 * by verifySandboxInstall). This test verifies all packages work together.
 *
 * Fully sandboxed: uses temp dir + SettingsManager.inMemory().
 * NEVER touches ~/.pi or any real pi config.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DefaultResourceLoader, SettingsManager } from "@mariozechner/pi-coding-agent";

const REPO_ROOT = path.resolve(__dirname, "..");

/** All pi packages (have pi manifest in package.json) */
const PI_PACKAGES = [
	"packages/permission-gate",
	"packages/pi-planner",
	"packages/pi-powershell",
];

/** Expected tools from all packages combined */
const EXPECTED_TOOLS = [
	// pi-planner
	"plan_mode",
	"plan_propose",
	"plan_approve",
	"plan_reject",
	"plan_list",
	"plan_get",
	"plan_run_script",
	"plan_skill_safety",
	// pi-powershell
	"powershell",
	"pwsh-start-job",
	"pwsh-get-job",
	"pwsh-stop-job",
	"pwsh-remove-job",
	"pwsh-get-job-output",
	"pwsh-create-session",
	"pwsh-close-session",
	// permission-gate: hook-only, no tools
];

/** Expected skill names */
const EXPECTED_SKILLS = ["pi-powershell"];

describe("repo e2e: all packages load in pi", () => {
	let sandboxDir: string;
	let toolNames: string[] = [];
	let skillNames: string[] = [];
	let extensionCount = 0;
	let extensionErrors: string[] = [];

	beforeAll(async () => {
		sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-"));

		// Point settings.packages at the local package dirs (absolute paths)
		const packagePaths = PI_PACKAGES.map(rel => path.resolve(REPO_ROOT, rel));

		const settingsManager = SettingsManager.inMemory();
		settingsManager.setPackages(packagePaths);

		const loader = new DefaultResourceLoader({
			cwd: sandboxDir,
			agentDir: sandboxDir,
			settingsManager,
		});
		await loader.reload();

		const extResult = loader.getExtensions();
		const skillResult = loader.getSkills();

		extensionCount = extResult.extensions.length;
		extensionErrors = extResult.errors.map(e => `${e.path}: ${e.error}`);
		skillNames = skillResult.skills.map((s: any) => s.name);

		for (const ext of extResult.extensions) {
			for (const [name] of (ext as any).tools ?? new Map()) {
				toolNames.push(name);
			}
		}
	}, 30_000);

	afterAll(() => {
		if (sandboxDir && fs.existsSync(sandboxDir)) {
			try {
				fs.rmSync(sandboxDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
			} catch { /* best-effort */ }
		}
	});

	it("loads all extensions without errors", () => {
		expect(extensionErrors).toEqual([]);
		expect(extensionCount).toBe(PI_PACKAGES.length);
	});

	it("registers all expected tools", () => {
		for (const tool of EXPECTED_TOOLS) {
			expect(toolNames, `missing tool: ${tool}`).toContain(tool);
		}
	});

	it("discovers all expected skills", () => {
		for (const skill of EXPECTED_SKILLS) {
			expect(skillNames, `missing skill: ${skill}`).toContain(skill);
		}
	});

	it("has no unexpected extension count drift", () => {
		expect(extensionCount).toBe(PI_PACKAGES.length);
	});
});
