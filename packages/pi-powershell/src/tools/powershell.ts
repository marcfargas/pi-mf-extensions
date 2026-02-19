/**
 * PowerShell tool for Windows system integration and background processes.
 */

import type { ExtensionAPI, ExtensionContext, AgentToolResult, AgentToolUpdateCallback, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { sessionManager } from "../session/session-manager.js";

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
	session?: string;
	sessionInfo?: any;
}

/** Callback for streaming partial output */
type OnData = (text: string) => void;

/**
 * Direct PowerShell execution. Optionally streams output via onData callback.
 */
async function executePowerShellDirect(options: PowerShellOptions, onData?: OnData): Promise<PowerShellResult> {
	const { command, timeout = 30000, workingDirectory } = options;

	// Force UTF-8 output encoding so non-ASCII characters (accents, etc.) aren't mangled
	const utf8Prefix = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ';

	return new Promise((resolve) => {
		const child = spawn('pwsh', [
			'-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', utf8Prefix + command
		], {
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
				resolve({ stdout, stderr: stderr + `\nCommand timed out after ${timeout}ms`, exitCode: -1, success: false });
			}, timeout);
		}

		child.stdout?.on('data', (data) => {
			const chunk = data.toString();
			stdout += chunk;
			onData?.(stdout);
		});

		child.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			if (timeoutId) clearTimeout(timeoutId);
			resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0, success: (code ?? 0) === 0 });
		});

		child.on('error', (err) => {
			if (timeoutId) clearTimeout(timeoutId);
			resolve({ stdout, stderr: `Failed to start PowerShell: ${err.message}`, exitCode: -1, success: false });
		});
	});
}

/**
 * Execute PowerShell command with error recovery for batch files.
 */
export async function executePowerShell(options: PowerShellOptions, onData?: OnData): Promise<PowerShellResult> {
	const { command, timeout = 30000, workingDirectory } = options;
	
	const firstResult = await executePowerShellDirect({ command, timeout, workingDirectory }, onData);
	
	// Retry with cmd /c if batch file error
	const isWin32Error = firstResult.stderr.includes('no es una aplicación Win32 válida') ||
						firstResult.stderr.includes('is not a valid Win32 application') ||
						firstResult.stderr.includes('cannot run due to the error');
	
	if (!firstResult.success && isWin32Error) {
		return await executePowerShellDirect({ command: `cmd /c "${command}"`, timeout, workingDirectory }, onData);
	}
	
	return firstResult;
}

function createResult(text: string, details: PowerShellToolResult): AgentToolResult<PowerShellToolResult> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

/** Truncate output to reasonable limits */
function truncateOutput(text: string): string {
	if (!text) return "(no output)";
	const maxLines = 2000;
	const maxBytes = 50 * 1024;
	let output = text;
	let truncated = false;

	const lines = output.split('\n');
	if (lines.length > maxLines) {
		output = lines.slice(0, maxLines).join('\n');
		truncated = true;
	}
	if (Buffer.byteLength(output, 'utf8') > maxBytes) {
		output = Buffer.from(output, 'utf8').subarray(0, maxBytes).toString('utf8');
		truncated = true;
	}
	if (truncated) output += '\n... [Output truncated]';
	return output;
}

/** Execute command with streaming support, returning formatted result */
async function runCommand(
	command: string,
	timeoutMs: number,
	workingDirectory: string,
	session: string | undefined,
	executor: (opts: PowerShellOptions, onData?: OnData) => Promise<PowerShellResult>,
	onUpdate?: AgentToolUpdateCallback<PowerShellToolResult>,
): Promise<AgentToolResult<PowerShellToolResult>> {
	try {
		if (session) {
			const sessionResult = await sessionManager.executeInSession(session, command, timeoutMs);
			const output = [sessionResult.stdout, sessionResult.stderr].filter(Boolean).join('\n');
			return createResult(truncateOutput(output), {
				exitCode: sessionResult.success ? 0 : 1,
				success: sessionResult.success,
				command, session,
				sessionInfo: sessionResult.sessionInfo
			});
		}

		// Stream partial output via onUpdate
		const onData = onUpdate ? (partialStdout: string) => {
			onUpdate({
				content: [{ type: "text", text: truncateOutput(partialStdout) }],
				details: { exitCode: -1, success: true, command },
			});
		} : undefined;

		const result = await executor({ command, timeout: timeoutMs, workingDirectory }, onData);
		const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
		return createResult(truncateOutput(output), {
			exitCode: result.exitCode,
			success: result.success,
			command,
		});
	} catch (error) {
		return createResult(
			`PowerShell execution failed: ${error instanceof Error ? error.message : String(error)}`,
			{ exitCode: -1, success: false, command, error: String(error) },
		);
	}
}

/** Shared renderCall for PowerShell tools — shows command like bash does */
function psRenderCall(args: { command: string; session?: string }, theme: Theme) {
	const cmd = args.command.length > 120 ? args.command.slice(0, 117) + '...' : args.command;
	let text = theme.fg("toolTitle", theme.bold("PS> ")) + theme.fg("toolOutput", cmd);
	if (args.session) text += theme.fg("muted", ` [${args.session}]`);
	return new Text(text, 0, 0);
}

/** Shared renderResult for PowerShell tools — shows output with expand/collapse */
function psRenderResult(result: AgentToolResult<PowerShellToolResult>, options: ToolRenderResultOptions, theme: Theme) {
	const details = result.details;
	const textContent = result.content[0];
	const output = textContent?.type === "text" ? textContent.text : "";

	if (!details?.success) {
		return new Text(theme.fg("error", output || "Command failed"), 0, 0);
	}

	if (!output || output === "(no output)") {
		return new Text(theme.fg("muted", "(no output)"), 0, 0);
	}

	if (!options.expanded) {
		// Collapsed: show first line + line count
		const lines = output.split('\n');
		const firstLine = lines[0].slice(0, 100);
		const suffix = lines.length > 1 ? theme.fg("muted", ` (${lines.length} lines)`) : "";
		return new Text(theme.fg("toolOutput", firstLine) + suffix, 0, 0);
	}

	// Expanded: show full output
	return new Text(theme.fg("toolOutput", output), 0, 0);
}

const psParams = Type.Object({
	command: Type.String({ description: "PowerShell command or script to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30)" })),
	session: Type.Optional(Type.String({ description: "PSSession name for remote execution. Create with pwsh-create-session first." })),
});

/**
 * Register PowerShell tools with pi agent.
 */
export function registerPowerShellTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "powershell",
		label: "PowerShell",
		description: `Execute PowerShell commands on Windows. Use for Windows system operations, background job management, process control, service management, registry operations, and any task where Git Bash limitations cause issues.

QUOTING: PowerShell uses different quoting than bash. Single quotes are literal strings (escape with ''). Double quotes allow variable expansion. Backtick (\`) is the escape character, not backslash.

BATCH FILES: npm, yarn, pnpm are .cmd batch files on Windows. If a command fails with "not a valid Win32 application", the tool automatically retries with cmd /c. You can also wrap explicitly: cmd /c "npm run dev"

ENVIRONMENT VARIABLES: Use PowerShell syntax: $env:NODE_ENV = 'production'; npm start (NOT bash-style NODE_ENV=production).`,
		parameters: psParams,
		renderCall: psRenderCall,
		renderResult: psRenderResult,

		async execute(_toolCallId, params, _signal, onUpdate, ctx: ExtensionContext) {
			const { command, timeout = 30, session } = params;
			return runCommand(command, timeout * 1000, ctx.cwd, session, executePowerShell, onUpdate);
		}
	});

}