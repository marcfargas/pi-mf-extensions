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

	describe("Batch Command Handling - Error Recovery", () => {
		it("should handle npm commands with error recovery", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// Test that npm commands work via error recovery
			const result = await executePowerShell({
				command: "npm --version"
			});

			// Should not fail with "no es una aplicación Win32 válida" error
			expect(result.success).toBe(true);
			expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
		});

		it("should handle other batch commands with error recovery", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// Test other common batch commands
			const commands = ['npm --version', 'yarn --version'];
			
			for (const cmd of commands) {
				const result = await executePowerShell({
					command: cmd
				});
				
				// Should not fail with batch file errors
				if (!result.success) {
					// Only acceptable failure is command not found (English or Spanish)
					expect(result.stderr).toMatch(/(not recognized|not found|could not find|no se reconoce)/i);
				}
			}
		});
	});

	describe("Batch File Auto-Recovery", () => {
		it("should handle npm via cmd /c auto-retry on Win32 error", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// npm is a .cmd batch file — executePowerShell retries with cmd /c
			const result = await executePowerShell({
				command: "npm --version"
			});

			expect(result.success).toBe(true);
			expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
		});

		it("should handle explicit cmd /c wrapping for batch files", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// Explicit cmd /c wrapping (what the tool description tells agents to do)
			const result = await executePowerShell({
				command: 'cmd /c "npm --version"'
			});

			expect(result.success).toBe(true);
			expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
		});
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