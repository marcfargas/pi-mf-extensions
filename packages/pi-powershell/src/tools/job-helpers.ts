/**
 * Background process management — uses OS-level processes, NOT PowerShell jobs.
 *
 * PowerShell jobs (Start-Job) die when the pwsh process exits. Since each `powershell`
 * tool call spawns a fresh process, jobs vanish between calls.
 *
 * Instead: Start-Process creates real detached OS processes, we track PIDs in
 * extension memory (persists across tool calls), and capture output via *> redirect
 * (all PowerShell streams to one file — see about_Redirection).
 */

import type { ExtensionAPI, ExtensionContext, AgentToolResult, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { executePowerShell } from "./powershell.js";

/** Short unique suffix to avoid temp file collisions across pi instances */
const instanceId = randomBytes(3).toString('hex');

interface TrackedJob {
	pid: number;
	name: string;
	command: string;
	workingDirectory: string;
	stdoutFile: string | null;
	stderrFile: string | null;  // null = merged with stdout
	startedAt: Date;
}

/** In-memory job registry — survives across tool calls because the extension stays loaded */
const jobs = new Map<string, TrackedJob>();

interface JobDetails { name?: string; command?: string; pid?: number; success: boolean; error?: string; }

function result(text: string, details: JobDetails): AgentToolResult<JobDetails> {
	return { content: [{ type: "text", text }], details };
}

function jobRenderCall(args: Record<string, unknown>, theme: Theme) {
	const name = args.name as string | undefined;
	return new Text(theme.fg("toolTitle", theme.bold("pwsh-job ")) + (name ? theme.fg("accent", name) : theme.fg("muted", "all")), 0, 0);
}

function jobRenderResult(res: AgentToolResult<JobDetails>, options: ToolRenderResultOptions, theme: Theme) {
	const text = res.content[0]?.type === "text" ? res.content[0].text : "";
	if (!res.details?.success) return new Text(theme.fg("error", text), 0, 0);
	if (!options.expanded) {
		const first = text.split('\n')[0].slice(0, 120);
		const n = text.split('\n').length;
		return new Text(theme.fg("toolOutput", first) + (n > 1 ? theme.fg("muted", ` (${n} lines)`) : ""), 0, 0);
	}
	return new Text(theme.fg("toolOutput", text), 0, 0);
}

async function run(command: string, cwd: string, timeout = 5000) {
	return await executePowerShell({ command, workingDirectory: cwd, timeout });
}

/** Convert bash-style `VAR=value cmd` to PowerShell `$env:VAR = 'value'; cmd` */
function bashEnvToPS(command: string): string {
	const m = command.match(/^(\s*)([A-Z_][A-Z0-9_]*)\s*=\s*('[^']*'|"[^"]*"|\S*)(\s+.+)$/);
	if (!m) return command;
	const val = m[3].replace(/^['"]|['"]$/g, '').replace(/'/g, "''");
	return `${m[1]}$env:${m[2]} = '${val}';${m[4]}`;
}

export function registerJobHelpers(pi: ExtensionAPI): void {

	pi.registerTool({
		name: "pwsh-start-job",
		label: "PowerShell Start Job",
		description: `Start a PowerShell background job. Use this instead of & operator which hangs Git Bash. Jobs run as real OS processes that persist across tool calls.

Bash-style env vars (NODE_ENV=production npm start) are auto-converted to PowerShell syntax ($env:NODE_ENV = 'production'; npm start). Batch files (npm, yarn, pnpm) are handled automatically.`,
		parameters: Type.Object({
			name: Type.String({ description: "Unique name for the job (for later reference)" }),
			command: Type.String({ description: "Command to run in the background job" }),
			workingDirectory: Type.Optional(Type.String({ description: "Working directory for the job (default: current directory)" })),
			stdout: Type.Optional(Type.String({ description: "Where to send stdout: file path, or 'null' to discard (default: temp log file)" })),
			stderr: Type.Optional(Type.String({ description: "Where to send stderr: file path, 'stdout' to merge with stdout, or 'null' to discard (default: 'stdout' — merged)" })),
		}),
		renderCall: (args, theme) => new Text(
			theme.fg("toolTitle", theme.bold("pwsh-start-job ")) +
			theme.fg("accent", args.name) + " " +
			theme.fg("muted", args.command.length > 80 ? args.command.slice(0, 77) + "..." : args.command),
			0, 0
		),
		renderResult: jobRenderResult,

		async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, command, workingDirectory, stdout, stderr } = params;

			if (jobs.has(name)) {
				return result(`Job '${name}' already exists (PID ${jobs.get(name)!.pid}). Stop it first.`, { name, success: false });
			}

			const workDir = workingDirectory || ctx.cwd;
			const psCommand = bashEnvToPS(command);

			// Resolve stdout/stderr targets
			const stdoutFile = stdout === 'null' ? null : (stdout || join(tmpdir(), `pi-job-${name}-${instanceId}-stdout.log`));
			const stderrTarget = stderr || 'stdout';  // default: merge with stdout
			const stderrFile = stderrTarget === 'null' ? null
				: stderrTarget === 'stdout' ? null     // null = merged
				: stderrTarget;                         // explicit file path

			// Build redirection: PowerShell stream redirection operators
			// 1> stdout, 2> stderr, *> all streams, 2>&1 merge stderr into stdout
			let redirect: string;
			if (stdoutFile && stderrTarget === 'stdout') {
				redirect = `*> ''${stdoutFile.replace(/'/g, "''")}'`; // all streams → one file
			} else if (stdoutFile && stderrFile) {
				redirect = `1> ''${stdoutFile.replace(/'/g, "''")}'' 2> ''${stderrFile.replace(/'/g, "''")}'`; // separate files
			} else if (stdoutFile && stderrTarget === 'null') {
				redirect = `2>$null 1> ''${stdoutFile.replace(/'/g, "''")}'`; // stdout to file, discard stderr
			} else if (!stdoutFile && stderrFile) {
				redirect = `1>$null 2> ''${stderrFile.replace(/'/g, "''")}'`; // discard stdout, stderr to file
			} else {
				redirect = `*>$null`; // discard everything
			}

			// Start-Process -WindowStyle Hidden: detached, doesn't block.
			// & { commands } redirect: captures output per configuration.
			const inner = `Set-Location ''${workDir.replace(/'/g, "''")}''`
				+ `; ${psCommand.replace(/'/g, "''")}`;
			const r = await run(
				`$p = Start-Process -FilePath 'pwsh' -ArgumentList '-NoProfile','-Command','& { ${inner} } ${redirect}' -WindowStyle Hidden -PassThru; $p.Id`,
				ctx.cwd, 10000
			);

			if (!r.success || !r.stdout.trim()) {
				return result(`Failed to start '${name}': ${r.stderr || r.stdout}`, { name, command, success: false, error: r.stderr });
			}

			const pid = parseInt(r.stdout.trim(), 10);
			if (isNaN(pid)) {
				return result(`Failed to parse PID for '${name}': ${r.stdout}`, { name, command, success: false });
			}

			jobs.set(name, { pid, name, command, workingDirectory: workDir, stdoutFile, stderrFile, startedAt: new Date() });

			const parts = [`Started '${name}' (PID ${pid})`];
			if (stdoutFile) parts.push(`stdout → ${stdoutFile}`);
			if (stderrFile) parts.push(`stderr → ${stderrFile}`);
			else if (stderrTarget === 'stdout') parts.push(`stderr → merged with stdout`);
			return result(parts.join('\n'), { name, command, pid, success: true });
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

			if (name) {
				const job = jobs.get(name);
				if (!job) return result(`Job '${name}' not found`, { name, success: false });

				const r = await run(`Get-Process -Id ${job.pid} -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, CPU, WorkingSet64 | ConvertTo-Json`, ctx.cwd);
				const running = r.success && r.stdout.trim();
				let text = `Job '${name}' (PID ${job.pid}) — ${running ? 'Running' : 'Stopped'}\nCommand: ${job.command}\nStarted: ${job.startedAt.toISOString()}`;

				if (includeOutput) {
					if (job.stdoutFile) {
						const out = await run(`Get-Content '${job.stdoutFile}' -Tail 50 -ErrorAction SilentlyContinue`, ctx.cwd);
						if (out.stdout) text += `\n\nStdout (last 50 lines):\n${out.stdout}`;
					}
					if (job.stderrFile) {
						const err = await run(`Get-Content '${job.stderrFile}' -Tail 20 -ErrorAction SilentlyContinue`, ctx.cwd);
						if (err.stdout) text += `\n\nStderr (last 20 lines):\n${err.stdout}`;
					}
				}

				return result(text, { name, pid: job.pid, success: true });
			}

			// List all
			if (jobs.size === 0) return result("No tracked jobs", { success: true });
			const lines: string[] = [];
			for (const [jn, job] of jobs) {
				const r = await run(`Get-Process -Id ${job.pid} -ErrorAction SilentlyContinue`, ctx.cwd);
				lines.push(`• ${jn} (PID ${job.pid}) — ${(r.success && r.stdout.trim()) ? 'Running' : 'Stopped'} — ${job.command}`);
			}
			return result(`${jobs.size} job(s):\n${lines.join('\n')}`, { success: true });
		}
	});

	pi.registerTool({
		name: "pwsh-stop-job",
		label: "PowerShell Stop Job",
		description: "Stop a running PowerShell background job. The job will be terminated but not removed (use remove_job to clean up).",
		parameters: Type.Object({ name: Type.String({ description: "Name of the job to stop" }) }),
		renderCall: jobRenderCall,
		renderResult: jobRenderResult,

		async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name } = params;
			const job = jobs.get(name);
			if (!job) return result(`Job '${name}' not found`, { name, success: false });
			await run(`Stop-Process -Id ${job.pid} -Force -ErrorAction SilentlyContinue`, ctx.cwd);
			return result(`Stopped '${name}' (PID ${job.pid})`, { name, pid: job.pid, success: true });
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
			const job = jobs.get(name);
			if (!job) return result(`Job '${name}' not found`, { name, success: false });
			if (force) await run(`Stop-Process -Id ${job.pid} -Force -ErrorAction SilentlyContinue`, ctx.cwd);
			const files = [job.stdoutFile, job.stderrFile].filter(Boolean).map(f => `'${f}'`).join(',');
			if (files) await run(`Remove-Item ${files} -Force -ErrorAction SilentlyContinue`, ctx.cwd);
			jobs.delete(name);
			return result(`Removed job '${name}'`, { name, pid: job.pid, success: true });
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
			const job = jobs.get(name);
			if (!job) return result(`Job '${name}' not found`, { name, success: false });

			let text = '';
			if (job.stdoutFile) {
				const out = await run(`Get-Content '${job.stdoutFile}' -Tail 100 -ErrorAction SilentlyContinue`, ctx.cwd);
				text = out.stdout || "(no output yet)";
			} else {
				text = "(stdout not captured)";
			}
			if (job.stderrFile) {
				const err = await run(`Get-Content '${job.stderrFile}' -Tail 50 -ErrorAction SilentlyContinue`, ctx.cwd);
				if (err.stdout) text += `\n\nStderr:\n${err.stdout}`;
			}

			if (!keep) {
				if (job.stdoutFile) await run(`'' | Set-Content '${job.stdoutFile}'`, ctx.cwd);
				if (job.stderrFile) await run(`'' | Set-Content '${job.stderrFile}'`, ctx.cwd);
			}
			return result(text, { name, pid: job.pid, success: true });
		}
	});
}
