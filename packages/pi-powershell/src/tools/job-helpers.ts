/**
 * PowerShell background job management tools.
 */

import type { ExtensionAPI, ExtensionContext, AgentToolResult, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { executePowerShell } from "./powershell.js";

interface JobDetails {
	name?: string;
	command?: string;
	output?: string;
	error?: string;
	success: boolean;
}

function result(text: string, details: JobDetails): AgentToolResult<JobDetails> {
	return { content: [{ type: "text", text }], details };
}

function jobRenderCall(args: Record<string, unknown>, theme: Theme) {
	const name = args.name as string | undefined;
	const label = name ? theme.fg("accent", name) : theme.fg("muted", "all");
	return new Text(theme.fg("toolTitle", theme.bold("pwsh-job ")) + label, 0, 0);
}

function jobRenderResult(res: AgentToolResult<JobDetails>, options: ToolRenderResultOptions, theme: Theme) {
	const text = res.content[0]?.type === "text" ? res.content[0].text : "";
	if (!res.details?.success) return new Text(theme.fg("error", text), 0, 0);
	if (!options.expanded) {
		const first = text.split('\n')[0].slice(0, 120);
		const lines = text.split('\n').length;
		const suffix = lines > 1 ? theme.fg("muted", ` (${lines} lines)`) : "";
		return new Text(theme.fg("toolOutput", first) + suffix, 0, 0);
	}
	return new Text(theme.fg("toolOutput", text), 0, 0);
}

/**
 * Convert bash-style `VAR=value command` to PowerShell `$env:VAR = 'value'; command`.
 * Handles: VAR=value, VAR='value', VAR="value", VAR=''
 */
function bashEnvToPS(command: string): string {
	const match = command.match(/^(\s*)([A-Z_][A-Z0-9_]*)\s*=\s*('[^']*'|"[^"]*"|\S*)(\s+.+)$/);
	if (!match) return command;
	const [, space, name, rawVal, rest] = match;
	const val = rawVal.replace(/^['"]|['"]$/g, '').replace(/'/g, "''");
	return `${space}$env:${name} = '${val}';${rest}`;
}

/** Run a PowerShell command and return formatted result */
async function run(command: string, cwd: string, timeout = 5000): Promise<{ stdout: string; stderr: string; success: boolean }> {
	return await executePowerShell({ command, workingDirectory: cwd, timeout });
}

export function registerJobHelpers(pi: ExtensionAPI): void {

	pi.registerTool({
		name: "pwsh-start-job",
		label: "PowerShell Start Job",
		description: `Start a PowerShell background job. Use this instead of & operator which hangs Git Bash. Jobs run in separate PowerShell processes and can be monitored/controlled.

Bash-style env vars (NODE_ENV=production npm start) are auto-converted to PowerShell syntax ($env:NODE_ENV = 'production'; npm start). Batch files (npm, yarn, pnpm) are handled automatically.`,
		parameters: Type.Object({
			name: Type.String({ description: "Unique name for the job (for later reference)" }),
			command: Type.String({ description: "Command to run in the background job" }),
			workingDirectory: Type.Optional(Type.String({ description: "Working directory for the job (default: current directory)" })),
		}),
		renderCall: (args, theme) => {
			return new Text(
				theme.fg("toolTitle", theme.bold("pwsh-start-job ")) +
				theme.fg("accent", args.name) + " " +
				theme.fg("muted", args.command.length > 80 ? args.command.slice(0, 77) + "..." : args.command),
				0, 0
			);
		},
		renderResult: jobRenderResult,

		async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, command, workingDirectory } = params;
			const workDir = workingDirectory || ctx.cwd;
			const psCommand = bashEnvToPS(command);
			const r = await run(
				`Start-Job -Name '${name}' -ScriptBlock { Set-Location '${workDir}'; ${psCommand} }; Get-Job -Name '${name}' | Select-Object Id, Name, State | ConvertTo-Json`,
				ctx.cwd
			);
			if (!r.success) return result(`Failed to start job '${name}': ${r.stderr}`, { name, command, error: r.stderr, success: false });
			return result(r.stdout || `Job '${name}' started`, { name, command, success: true });
		}
	});

	pi.registerTool({
		name: "pwsh-get-job",
		label: "PowerShell Get Job",
		description: "Get status and information about a PowerShell background job. Shows current state, output, and other details.",
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Job name to get info for (omit to list all jobs)" })),
			includeOutput: Type.Optional(Type.Boolean({ description: "Include job output in response (default: false)" })),
		}),
		renderCall: jobRenderCall,
		renderResult: jobRenderResult,

		async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, includeOutput = false } = params;
			const cmd = name
				? `Get-Job -Name '${name}' -ErrorAction SilentlyContinue | Select-Object Id, Name, State, HasMoreData | ConvertTo-Json`
				: `Get-Job | Select-Object Id, Name, State, HasMoreData | ConvertTo-Json`;

			const r = await run(cmd, ctx.cwd);
			if (!r.success) return result(name ? `Job '${name}' not found` : `No jobs: ${r.stderr}`, { name, error: r.stderr, success: false });

			let output = r.stdout || "No jobs found";

			if (includeOutput && name) {
				const out = await run(`Receive-Job -Name '${name}' -Keep -ErrorAction SilentlyContinue`, ctx.cwd);
				if (out.stdout) output += `\n\nOutput:\n${out.stdout}`;
			}

			return result(output, { name, output, success: true });
		}
	});

	pi.registerTool({
		name: "pwsh-stop-job",
		label: "PowerShell Stop Job",
		description: "Stop a running PowerShell background job. The job will be terminated but not removed (use remove_job to clean up).",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the job to stop" }),
		}),
		renderCall: jobRenderCall,
		renderResult: jobRenderResult,

		async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name } = params;
			const r = await run(`Stop-Job -Name '${name}' -ErrorAction SilentlyContinue; Get-Job -Name '${name}' -ErrorAction SilentlyContinue | Select-Object Name, State | ConvertTo-Json`, ctx.cwd);
			return result(r.stdout || `Stopped job '${name}'`, { name, success: r.success });
		}
	});

	pi.registerTool({
		name: "pwsh-remove-job",
		label: "PowerShell Remove Job",
		description: "Remove a PowerShell background job. This cleans up the job from the job list. Stop the job first if it's still running.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the job to remove" }),
			force: Type.Optional(Type.Boolean({ description: "Force removal even if job is running (default: false)" })),
		}),
		renderCall: jobRenderCall,
		renderResult: jobRenderResult,

		async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, force = false } = params;
			const cmd = force
				? `Stop-Job -Name '${name}' -ErrorAction SilentlyContinue; Remove-Job -Name '${name}' -Force -ErrorAction SilentlyContinue`
				: `Remove-Job -Name '${name}' -ErrorAction SilentlyContinue`;
			const r = await run(cmd, ctx.cwd);
			return result(r.stderr ? `Failed to remove '${name}': ${r.stderr}` : `Removed job '${name}'`, { name, success: !r.stderr });
		}
	});

	pi.registerTool({
		name: "pwsh-get-job-output",
		label: "PowerShell Get Job Output",
		description: "Receive output from a PowerShell background job. Use 'keep' to preserve output for future calls, or 'consume' to read and clear it.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the job to get output from" }),
			keep: Type.Optional(Type.Boolean({ description: "Keep output for future calls (default: true)" })),
		}),
		renderCall: jobRenderCall,
		renderResult: jobRenderResult,

		async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, keep = true } = params;
			const cmd = keep
				? `Receive-Job -Name '${name}' -Keep -ErrorAction SilentlyContinue`
				: `Receive-Job -Name '${name}' -ErrorAction SilentlyContinue`;
			const r = await run(cmd, ctx.cwd);
			if (!r.success) return result(`Failed to get output from '${name}': ${r.stderr}`, { name, error: r.stderr, success: false });
			return result(r.stdout || `No output from '${name}'`, { name, output: r.stdout, success: true });
		}
	});
}
