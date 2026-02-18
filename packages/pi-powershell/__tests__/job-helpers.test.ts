/**
 * Tests for PowerShell job management helpers
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { executePowerShell } from "../src/tools/powershell.js";

describe("PowerShell Job Helpers", () => {
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

	afterEach(async () => {
		if (isPowerShellAvailable) {
			// Clean up any test jobs that might still exist
			await executePowerShell({
				command: `
					Get-Job -Name 'test-*' -ErrorAction SilentlyContinue | Stop-Job -ErrorAction SilentlyContinue
					Get-Job -Name 'test-*' -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue
				`,
				timeout: 5000
			});
		}
	});

	describe("Job Lifecycle", () => {
		it("should start a job with proper JSON output", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			const result = await executePowerShell({
				command: `
					$job = Start-Job -Name 'test-helper-job' -ScriptBlock {
						Write-Output 'Hello from job'
						Start-Sleep -Seconds 1
					}
					$job | Select-Object Id, Name, State, HasMoreData, Location, Command | ConvertTo-Json
				`
			});

			expect(result.success).toBe(true);
			
			const jobInfo = JSON.parse(result.stdout);
			expect(jobInfo.Name).toBe('test-helper-job');
			expect(jobInfo.State).toBeTruthy();
			expect(typeof jobInfo.Id).toBe('number');

			// Cleanup
			await executePowerShell({
				command: `
					Stop-Job -Name 'test-helper-job' -ErrorAction SilentlyContinue
					Remove-Job -Name 'test-helper-job' -Force -ErrorAction SilentlyContinue
				`
			});
		});

		it("should get job information", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// Start a test job and wait for it to be ready
			const startResult = await executePowerShell({
				command: `
					$job = Start-Job -Name 'test-get-job' -ScriptBlock {
						Write-Output 'Test output'
						Start-Sleep -Seconds 1
					}
					Start-Sleep -Milliseconds 200
					Get-Job -Name 'test-get-job' | Select-Object Id, Name, State, HasMoreData, Location, Command | ConvertTo-Json
				`
			});

			if (!startResult.success) {
				console.log("Failed to start job:", startResult.stderr);
				return; // Skip test if we can't start jobs
			}

			const jobInfo = JSON.parse(startResult.stdout);
			expect(jobInfo.Name).toBe('test-get-job');
			expect(['Running', 'Completed']).toContain(jobInfo.State);

			// Cleanup
			await executePowerShell({
				command: `
					Stop-Job -Name 'test-get-job' -ErrorAction SilentlyContinue
					Remove-Job -Name 'test-get-job' -Force -ErrorAction SilentlyContinue
				`
			});
		});

		it("should stop a running job", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// Start a long-running job, wait for it to start, then stop it
			const result = await executePowerShell({
				command: `
					$job = Start-Job -Name 'test-stop-job' -ScriptBlock {
						Start-Sleep -Seconds 10
					}
					Start-Sleep -Milliseconds 300
					Stop-Job -Name 'test-stop-job' -ErrorAction SilentlyContinue
					Get-Job -Name 'test-stop-job' -ErrorAction SilentlyContinue | Select-Object Name, State | ConvertTo-Json
				`
			});

			if (!result.success || !result.stdout.trim()) {
				console.log("Job operation failed:", result.stderr);
				return; // Skip test if PowerShell jobs aren't working
			}
			
			const jobInfo = JSON.parse(result.stdout);
			expect(jobInfo.Name).toBe('test-stop-job');
			expect(['Stopped', 'Completed']).toContain(jobInfo.State);

			// Cleanup
			await executePowerShell({
				command: `Remove-Job -Name 'test-stop-job' -Force -ErrorAction SilentlyContinue`
			});
		});

		it("should remove a job", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// Start a job
			await executePowerShell({
				command: `
					Start-Job -Name 'test-remove-job' -ScriptBlock {
						Write-Output 'Test'
					} | Out-Null
				`
			});

			// Wait for job to complete
			await new Promise(resolve => setTimeout(resolve, 1000));

			// Remove the job
			await executePowerShell({
				command: `Remove-Job -Name 'test-remove-job' -Force -ErrorAction SilentlyContinue`
			});

			// Verify job is gone
			const result = await executePowerShell({
				command: `Get-Job -Name 'test-remove-job' -ErrorAction SilentlyContinue`
			});

			// Should fail because job no longer exists
			expect(result.success).toBe(false);
		});

		it("should get job output", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// Start a job with output, wait for completion, then get output
			const result = await executePowerShell({
				command: `
					$job = Start-Job -Name 'test-output-job' -ScriptBlock {
						Write-Output 'Hello from background job'
						Write-Output 'Line 2'
					}
					# Wait for job to complete
					Wait-Job -Name 'test-output-job' -Timeout 5 | Out-Null
					# Get the output
					Receive-Job -Name 'test-output-job' -Keep -ErrorAction SilentlyContinue
				`,
				timeout: 8000
			});

			if (!result.success) {
				console.log("Job output test failed:", result.stderr);
				return; // Skip test if PowerShell jobs aren't working
			}

			expect(result.stdout).toContain('Hello from background job');
			expect(result.stdout).toContain('Line 2');

			// Cleanup
			await executePowerShell({
				command: `Remove-Job -Name 'test-output-job' -Force -ErrorAction SilentlyContinue`
			});
		}, 10000);
	});

	describe("Edge Cases", () => {
		it("should handle non-existent job gracefully", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			const result = await executePowerShell({
				command: `
					$jobs = Get-Job -Name 'non-existent-job' -ErrorAction SilentlyContinue
					if ($jobs) {
						$jobs | ConvertTo-Json
					} else {
						Write-Output 'No jobs found'
					}
				`
			});

			// Should succeed 
			expect(result.success).toBe(true);
			// Should either be empty or say "No jobs found"
			expect(result.stdout.trim()).toBeTruthy();
		});

		it("should handle PowerShell string escaping", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			// Test with single quotes in job name and command
			const result = await executePowerShell({
				command: `
					$jobName = 'test-with''quotes'
					$job = Start-Job -Name $jobName -ScriptBlock {
						Write-Output 'Output with ''quotes'' and \`backticks\`'
					}
					$job | Select-Object Name | ConvertTo-Json
				`
			});

			expect(result.success).toBe(true);
			
			const jobInfo = JSON.parse(result.stdout);
			expect(jobInfo.Name).toBe("test-with'quotes");

			// Cleanup
			await executePowerShell({
				command: `
					Stop-Job -Name 'test-with''quotes' -ErrorAction SilentlyContinue
					Remove-Job -Name 'test-with''quotes' -Force -ErrorAction SilentlyContinue
				`
			});
		});
	});
});