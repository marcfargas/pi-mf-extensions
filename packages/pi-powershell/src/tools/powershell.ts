/**
 * PowerShell tool for Windows system integration and background processes.
 */

import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";

export interface PowerShellOptions {
	command: string;
	timeout?: number;
	workingDirectory?: string;
}

export interface PowerShellResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	success: boolean;
}

export interface PowerShellToolResult {
	exitCode: number;
	success: boolean;
	command: string;
	error?: string;
}

/**
 * Execute PowerShell command with proper error handling and output formatting.
 */
export async function executePowerShell(options: PowerShellOptions): Promise<PowerShellResult> {
	const { command, timeout = 30000, workingDirectory } = options;

	return new Promise((resolve) => {
		const args = [
			'-NoProfile',
			'-NonInteractive', 
			'-ExecutionPolicy', 'Bypass',
			'-Command', command
		];

		const child = spawn('pwsh', args, {
			cwd: workingDirectory,
			stdio: 'pipe',
			shell: false,
		});

		let stdout = '';
		let stderr = '';
		let timeoutId: NodeJS.Timeout | null = null;

		// Set up timeout
		if (timeout > 0) {
			timeoutId = setTimeout(() => {
				child.kill('SIGTERM');
				resolve({
					stdout: stdout,
					stderr: stderr + `\nCommand timed out after ${timeout}ms`,
					exitCode: -1,
					success: false,
				});
			}, timeout);
		}

		// Collect output
		child.stdout?.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			
			resolve({
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				exitCode: code ?? 0,
				success: (code ?? 0) === 0,
			});
		});

		child.on('error', (err) => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			
			resolve({
				stdout: stdout,
				stderr: `Failed to start PowerShell: ${err.message}`,
				exitCode: -1,
				success: false,
			});
		});
	});
}

function createResult(text: string, details: PowerShellToolResult, isError = false): AgentToolResult<PowerShellToolResult> {
	return {
		content: [{ type: "text", text }],
		details,
		...(isError ? { isError: true } : {}),
	};
}

/**
 * Register PowerShell tool with pi agent.
 */
export function registerPowerShellTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "powershell",
		label: "PowerShell",
		description: "Execute PowerShell commands on Windows. Use for Windows system operations, background job management, process control, service management, registry operations, and any task where Git Bash limitations cause issues.",
		parameters: Type.Object({
			command: Type.String({ description: "PowerShell command or script to execute" }),
			timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30)" })),
		}),
		
		async execute(
			_toolCallId: string,
			params: { command: string; timeout?: number },
			_signal: AbortSignal | undefined,
			_onUpdate: any,
			ctx: ExtensionContext
		) {
			const { command, timeout = 30 } = params;
			const timeoutMs = timeout * 1000;
			const workingDirectory = ctx.cwd;

			try {
				const result = await executePowerShell({
					command,
					timeout: timeoutMs,
					workingDirectory,
				});

				// Format output similar to bash tool
				let output = '';
				
				if (result.stdout) {
					output += result.stdout;
				}
				
				if (result.stderr) {
					if (output) output += '\n';
					output += result.stderr;
				}

				// Truncate large outputs (similar to bash tool behavior)
				const maxLines = 2000;
				const maxBytes = 50 * 1024; // 50KB
				
				const lines = output.split('\n');
				let truncated = false;
				
				if (lines.length > maxLines) {
					output = lines.slice(0, maxLines).join('\n');
					truncated = true;
				}
				
				if (Buffer.byteLength(output, 'utf8') > maxBytes) {
					output = Buffer.from(output, 'utf8').subarray(0, maxBytes).toString('utf8');
					truncated = true;
				}
				
				if (truncated) {
					output += '\n... [Output truncated]';
				}

				return createResult(
					output || "(no output)",
					{
						exitCode: result.exitCode,
						success: result.success,
						command: command,
					}
				);

			} catch (error) {
				return createResult(
					`PowerShell execution failed: ${error instanceof Error ? error.message : String(error)}`,
					{
						exitCode: -1,
						success: false,
						command: command,
						error: String(error),
					},
					true
				);
			}
		}
	});
}