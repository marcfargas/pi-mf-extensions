/**
 * Tests for PowerShell tool
 */

import { describe, it, expect, beforeAll } from "vitest";
import { executePowerShell } from "../src/tools/powershell.js";

describe("PowerShell Tool", () => {
	// Skip tests if PowerShell is not available
	let isPowerShellAvailable = false;

	beforeAll(async () => {
		try {
			const result = await executePowerShell({ command: "$PSVersionTable.PSVersion.Major", timeout: 5000 });
			isPowerShellAvailable = result.success;
		} catch {
			isPowerShellAvailable = false;
		}
	});

	describe("Basic Command Execution", () => {
		it("should execute simple commands", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			const result = await executePowerShell({
				command: "Write-Output 'Hello World'"
			});

			expect(result.success).toBe(true);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Hello World");
		});

		it("should handle commands with output", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			const result = await executePowerShell({
				command: "Get-Date -Format 'yyyy-MM-dd'"
			});

			expect(result.success).toBe(true);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});
	});

	describe("Error Handling", () => {
		it("should handle command errors", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			const result = await executePowerShell({
				command: "Get-NonExistentCommand"
			});

			expect(result.success).toBe(false);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toBeTruthy();
		});

		it("should handle timeout", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			const result = await executePowerShell({
				command: "Start-Sleep -Seconds 3",
				timeout: 1000 // 1 second timeout
			});

			expect(result.success).toBe(false);
			expect(result.exitCode).toBe(-1);
			expect(result.stderr).toContain("timed out");
		}, 10000);
	});

	describe("Background Jobs", () => {
		it("should be able to create background jobs", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// Start a simple background job
			const startResult = await executePowerShell({
				command: `
					$job = Start-Job -Name 'test-job' -ScriptBlock { 
						Start-Sleep -Seconds 1
						Write-Output 'Job completed'
					}
					Write-Output "Job started: $($job.Name) (ID: $($job.Id))"
				`
			});

			expect(startResult.success).toBe(true);
			expect(startResult.stdout).toContain("Job started: test-job");

			// Cleanup - don't fail the test if cleanup fails
			await executePowerShell({
				command: `
					Get-Job -Name 'test-job' -ErrorAction SilentlyContinue | Stop-Job -ErrorAction SilentlyContinue
					Get-Job -Name 'test-job' -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue
				`
			});
		}, 10000);
	});

	describe("Windows System Operations", () => {
		it("should be able to list processes", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			const result = await executePowerShell({
				command: "Get-Process | Select-Object -First 5 Id, ProcessName | ConvertTo-Json"
			});

			expect(result.success).toBe(true);
			expect(result.stdout).toBeTruthy();
		});

		it("should be able to check services (if running on Windows)", async () => {
			if (!isPowerShellAvailable || process.platform !== 'win32') {
				console.log("Skipping test: PowerShell not available or not on Windows");
				return;
			}

			const result = await executePowerShell({
				command: "Get-Service | Select-Object -First 3 Name, Status | ConvertTo-Json"
			});

			expect(result.success).toBe(true);
			expect(result.stdout).toBeTruthy();
		});
	});
});