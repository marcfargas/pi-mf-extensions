/**
 * PowerShell job management helpers - high-level API for common background job operations.
 */

import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { executePowerShell } from "./powershell.js";

export interface JobInfo {
	id: number;
	name: string;
	state: 'Running' | 'Completed' | 'Failed' | 'Stopped' | 'Blocked' | 'Suspended' | 'Disconnected';
	hasMoreData: boolean;
	location: string;
	command: string;
}

function createJobResult<T = unknown>(text: string, details: T, isError = false): AgentToolResult<T> {
	return {
		content: [{ type: "text", text }],
		details,
		...(isError ? { isError: true } : {}),
	};
}

/**
 * Escape PowerShell string for safe execution
 */
function escapeForPowerShell(str: string): string {
	return str.replace(/'/g, "''").replace(/`/g, "``");
}

/**
 * Parse job output into structured data
 */
function parseJobInfo(output: string): JobInfo[] {
	try {
		const jobs = JSON.parse(output);
		return Array.isArray(jobs) ? jobs : [jobs];
	} catch {
		// Fallback parsing if JSON fails
		return [];
	}
}

/**
 * Register PowerShell job management helper tools
 */
export function registerJobHelpers(pi: ExtensionAPI): void {
	
	// pwsh-start-job - Start a background PowerShell job
	pi.registerTool({
		name: "pwsh-start-job",
		label: "PowerShell Start Job", 
		description: "Start a PowerShell background job. Use this instead of & operator which hangs Git Bash. Jobs run in separate PowerShell processes and can be monitored/controlled.",
		parameters: Type.Object({
			name: Type.String({ description: "Unique name for the job (for later reference)" }),
			command: Type.String({ description: "Command to run in the background job" }),
			workingDirectory: Type.Optional(Type.String({ description: "Working directory for the job (default: current directory)" })),
		}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, command, workingDirectory } = params;
			const escapedName = escapeForPowerShell(name);
			const escapedCommand = escapeForPowerShell(command);
			const workDir = workingDirectory || ctx.cwd;
			const escapedWorkDir = escapeForPowerShell(workDir);

			const powerShellScript = `
				$job = Start-Job -Name '${escapedName}' -ScriptBlock {
					Set-Location '${escapedWorkDir}'
					${escapedCommand}
				}
				$job | Select-Object Id, Name, State, HasMoreData, Location, Command | ConvertTo-Json
			`;

			const result = await executePowerShell({
				command: powerShellScript.trim(),
				workingDirectory: ctx.cwd,
			});

			if (!result.success) {
				return createJobResult(
					`Failed to start job '${name}': ${result.stderr || result.stdout}`,
					{ name, command, error: result.stderr },
					true
				);
			}

			const jobs = parseJobInfo(result.stdout);
			const job = jobs[0];

			return createJobResult(
				`Started job '${name}' (ID: ${job?.id || 'unknown'})${job?.state ? ` - Status: ${job.state}` : ''}`,
				{ 
					name, 
					command, 
					workingDirectory: workDir,
					job: job || { name, command }
				}
			);
		}
	});

	// pwsh-get-job - Get job status and information
	pi.registerTool({
		name: "pwsh-get-job",
		label: "PowerShell Get Job",
		description: "Get status and information about a PowerShell background job. Shows current state, output, and other details.",
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Job name to get info for (omit to list all jobs)" })),
			includeOutput: Type.Optional(Type.Boolean({ description: "Include job output in response (default: false)" })),
		}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, includeOutput = false } = params;
			
			let command = "Get-Job";
			if (name) {
				const escapedName = escapeForPowerShell(name);
				command = `Get-Job -Name '${escapedName}' -ErrorAction SilentlyContinue`;
			}
			
			command += " | Select-Object Id, Name, State, HasMoreData, Location, Command | ConvertTo-Json";

			const result = await executePowerShell({
				command,
				workingDirectory: ctx.cwd,
			});

			if (!result.success) {
				return createJobResult(
					name ? `Job '${name}' not found or error: ${result.stderr}` : `Failed to list jobs: ${result.stderr}`,
					{ name, error: result.stderr },
					true
				);
			}

			const jobs = parseJobInfo(result.stdout);
			
			if (jobs.length === 0) {
				return createJobResult(
					name ? `Job '${name}' not found` : "No jobs found",
					{ name, jobs: [] }
				);
			}

			let output = "";
			if (name && jobs.length === 1) {
				const job = jobs[0];
				output = `Job '${job.name}' (ID: ${job.id})\nState: ${job.state}\nLocation: ${job.location}\nCommand: ${job.command}`;
				
				if (includeOutput && job.hasMoreData) {
					const outputResult = await executePowerShell({
						command: `Receive-Job -Name '${escapeForPowerShell(name)}' -Keep`,
						workingDirectory: ctx.cwd,
					});
					if (outputResult.success && outputResult.stdout.trim()) {
						output += `\n\nOutput:\n${outputResult.stdout}`;
					}
				}
			} else {
				output = `Found ${jobs.length} job(s):\n` + 
					jobs.map(job => `• ${job.name} (ID: ${job.id}) - ${job.state}`).join('\n');
			}

			return createJobResult(output, { name, jobs });
		}
	});

	// pwsh-stop-job - Stop a running PowerShell job
	pi.registerTool({
		name: "pwsh-stop-job",
		label: "PowerShell Stop Job",
		description: "Stop a running PowerShell background job. The job will be terminated but not removed (use remove_job to clean up).",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the job to stop" }),
		}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name } = params;
			const escapedName = escapeForPowerShell(name);

			const result = await executePowerShell({
				command: `Stop-Job -Name '${escapedName}' -ErrorAction SilentlyContinue; Get-Job -Name '${escapedName}' -ErrorAction SilentlyContinue | Select-Object Name, State | ConvertTo-Json`,
				workingDirectory: ctx.cwd,
			});

			if (!result.success || !result.stdout.trim()) {
				return createJobResult(
					`Job '${name}' not found or already stopped`,
					{ name, error: result.stderr }
				);
			}

			const jobs = parseJobInfo(result.stdout);
			const job = jobs[0];

			return createJobResult(
				`Stopped job '${name}' - Status: ${job?.state || 'Unknown'}`,
				{ name, job }
			);
		}
	});

	// pwsh-remove-job - Remove a PowerShell job (cleanup)
	pi.registerTool({
		name: "pwsh-remove-job", 
		label: "PowerShell Remove Job",
		description: "Remove a PowerShell background job. This cleans up the job from the job list. Stop the job first if it's still running.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the job to remove" }),
			force: Type.Optional(Type.Boolean({ description: "Force removal even if job is running (default: false)" })),
		}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, force = false } = params;
			const escapedName = escapeForPowerShell(name);
			
			let command = `Remove-Job -Name '${escapedName}' -ErrorAction SilentlyContinue`;
			if (force) {
				command = `Stop-Job -Name '${escapedName}' -ErrorAction SilentlyContinue; ${command} -Force`;
			}

			const result = await executePowerShell({
				command,
				workingDirectory: ctx.cwd,
			});

			// Remove-Job doesn't return output on success, so check if it succeeded
			const checkResult = await executePowerShell({
				command: `Get-Job -Name '${escapedName}' -ErrorAction SilentlyContinue`,
				workingDirectory: ctx.cwd,
			});

			const stillExists = checkResult.success && checkResult.stdout.trim();
			
			if (stillExists) {
				return createJobResult(
					`Failed to remove job '${name}' - may still be running (use force: true to stop and remove)`,
					{ name, error: "Job still exists" },
					true
				);
			}

			return createJobResult(
				`Removed job '${name}'`,
				{ name, removed: true }
			);
		}
	});

	// pwsh-get-job-output - Get output from a PowerShell job
	pi.registerTool({
		name: "pwsh-get-job-output",
		label: "PowerShell Get Job Output",
		description: "Receive output from a PowerShell background job. Use 'keep' to preserve output for future calls, or 'consume' to read and clear it.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the job to get output from" }),
			keep: Type.Optional(Type.Boolean({ description: "Keep output for future calls (default: true)" })),
		}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, keep = true } = params;
			const escapedName = escapeForPowerShell(name);
			
			const command = keep 
				? `Receive-Job -Name '${escapedName}' -Keep -ErrorAction SilentlyContinue`
				: `Receive-Job -Name '${escapedName}' -ErrorAction SilentlyContinue`;

			const result = await executePowerShell({
				command,
				workingDirectory: ctx.cwd,
			});

			if (!result.success) {
				return createJobResult(
					`Failed to get output from job '${name}': ${result.stderr}`,
					{ name, error: result.stderr },
					true
				);
			}

			const output = result.stdout || "(no output)";
			const hasOutput = result.stdout.trim().length > 0;

			return createJobResult(
				hasOutput ? output : `Job '${name}' has no output yet`,
				{ name, hasOutput, output: result.stdout, kept: keep }
			);
		}
	});
}