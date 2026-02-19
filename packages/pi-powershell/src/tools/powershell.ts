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
 * Direct PowerShell execution without any wrapping or error recovery.
 */
async function executePowerShellDirect(options: PowerShellOptions): Promise<PowerShellResult> {
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

		child.stdout?.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			if (timeoutId) clearTimeout(timeoutId);
			resolve({
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				exitCode: code ?? 0,
				success: (code ?? 0) === 0,
			});
		});

		child.on('error', (err) => {
			if (timeoutId) clearTimeout(timeoutId);
			resolve({
				stdout: stdout,
				stderr: `Failed to start PowerShell: ${err.message}`,
				exitCode: -1,
				success: false,
			});
		});
	});
}

/**
 * Check if a command needs batch file wrapping using Get-Command.
 */
async function needsBatchWrapping(command: string): Promise<boolean> {
	const trimmed = command.trim();
	const firstWord = trimmed.split(/\s+/)[0];
	
	if (!firstWord) return false;
	
	try {
		const result = await executePowerShellDirect({
			command: `Get-Command '${firstWord}' -ErrorAction SilentlyContinue | Select-Object CommandType | ConvertTo-Json`,
			timeout: 3000
		});
		
		if (result.success && result.stdout) {
			const cmdInfo = JSON.parse(result.stdout);
			// ExternalScript typically means .cmd, .bat files
			return cmdInfo.CommandType === 'ExternalScript';
		}
	} catch {
		// If we can't determine, err on the side of caution
	}
	
	return false;
}

/**
 * Execute PowerShell command with smart batch file handling and error recovery.
 * Uses try-first-then-wrap approach for maximum reliability.
 */
export async function executePowerShell(options: PowerShellOptions): Promise<PowerShellResult> {
	const { command, timeout = 30000, workingDirectory } = options;
	
	// First try: execute command as-is
	const firstResult = await executePowerShellDirect({
		command,
		timeout,
		workingDirectory
	});
	
	// Check for Win32 batch file error
	const isWin32Error = firstResult.stderr.includes('no es una aplicación Win32 válida') ||
						firstResult.stderr.includes('is not a valid Win32 application') ||
						firstResult.stderr.includes('cannot run due to the error');
	
	if (!firstResult.success && isWin32Error) {
		// Second try: wrap with cmd /c for batch files
		const wrappedCommand = `cmd /c "${command}"`;
		return await executePowerShellDirect({
			command: wrappedCommand,
			timeout,
			workingDirectory
		});
	}
	
	return firstResult;
}

/**
 * Execute PowerShell command with pre-emptive batch file detection.
 * Uses Get-Command to detect batch files before execution.
 */
export async function executePowerShellWithBatchDetection(options: PowerShellOptions): Promise<PowerShellResult> {
	const { command, timeout = 30000, workingDirectory } = options;
	
	// Smart detection: check if command needs batch wrapping
	const needsWrapping = await needsBatchWrapping(command);
	const finalCommand = needsWrapping ? `cmd /c "${command}"` : command;
	
	return await executePowerShellDirect({
		command: finalCommand,
		timeout,
		workingDirectory
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
 * Register PowerShell tools with pi agent.
 */
export function registerPowerShellTool(pi: ExtensionAPI): void {
	// Main PowerShell tool with error recovery
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

	// pwsh-run tool with pre-emptive batch detection
	pi.registerTool({
		name: "pwsh-run",
		label: "PowerShell Run",
		description: "Execute commands with smart batch file detection. Like powershell tool but with pre-emptive Get-Command checking for more reliable batch file handling.",
		parameters: Type.Object({
			command: Type.String({ description: "Command to execute with smart batch file wrapping" }),
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
				const result = await executePowerShellWithBatchDetection({
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

				// Truncate large outputs
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