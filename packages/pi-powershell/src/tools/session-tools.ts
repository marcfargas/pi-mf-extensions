/**
 * PowerShell Session Management Tools
 */

import type { ExtensionAPI, ExtensionContext, AgentToolResult, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { sessionManager, PSSessionOptions } from "../session/session-manager.js";

interface SessionDetails {
	name?: string;
	success: boolean;
	error?: string;
	[key: string]: unknown;
}

function result(text: string, details: SessionDetails): AgentToolResult<SessionDetails> {
	return { content: [{ type: "text", text }], details };
}

function sessionRenderCall(args: Record<string, unknown>, theme: Theme) {
	const name = args.name as string | undefined;
	const label = name ? theme.fg("accent", name) : theme.fg("muted", "all");
	return new Text(theme.fg("toolTitle", theme.bold("pwsh-session ")) + label, 0, 0);
}

function sessionRenderResult(res: AgentToolResult<SessionDetails>, options: ToolRenderResultOptions, theme: Theme) {
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

export function registerSessionTools(pi: ExtensionAPI): void {

	pi.registerTool({
		name: "pwsh-create-session",
		label: "PowerShell Create Session",
		description: "Create a persistent PowerShell session for local or remote execution. Sessions maintain state (variables, modules, functions) across multiple commands.",
		parameters: Type.Object({
			name: Type.String({ description: "Unique name for the session" }),
			computerName: Type.Optional(Type.String({ description: "Remote computer name (omit for local session)" })),
			credential: Type.Optional(Type.String({ description: "Username for remote authentication (e.g., 'domain\\user')" })),
			authentication: Type.Optional(Type.String({
				description: "Authentication method: Default, Kerberos, Certificate, Basic, Negotiate",
				enum: ["Default", "Kerberos", "Certificate", "Basic", "Negotiate"]
			})),
			port: Type.Optional(Type.Number({ description: "Remote port (default: 5985 for HTTP, 5986 for HTTPS)" })),
			useSSL: Type.Optional(Type.Boolean({ description: "Use SSL/HTTPS for remote connection" })),
			timeout: Type.Optional(Type.Number({ description: "Connection timeout in seconds (default: 30)" })),
		}),
		renderCall: (args, theme) => new Text(
			theme.fg("toolTitle", theme.bold("pwsh-create-session ")) +
			theme.fg("accent", args.name) +
			(args.computerName ? theme.fg("muted", ` → ${args.computerName}`) : theme.fg("muted", " (local)")),
			0, 0
		),
		renderResult: sessionRenderResult,

		async execute(_id, params, _signal, _onUpdate, _ctx: ExtensionContext) {
			const { name, computerName, credential, authentication, port, useSSL, timeout } = params;
			try {
				const info = await sessionManager.createSession(name, {
					computerName, credential, authentication: authentication as any, port, useSSL,
					timeout: timeout ? timeout * 1000 : undefined
				});
				const type = info.isLocal ? 'local' : 'remote';
				const target = info.isLocal ? 'localhost' : info.computerName;
				return result(`Created ${type} session '${name}' on ${target}\nState: ${info.state}`, { name, success: true, sessionInfo: info });
			} catch (error) {
				return result(`Failed to create session '${name}': ${error instanceof Error ? error.message : String(error)}`, { name, success: false, error: String(error) });
			}
		}
	});

	pi.registerTool({
		name: "pwsh-list-sessions",
		label: "PowerShell List Sessions",
		description: "List all active PowerShell sessions with their status and information.",
		parameters: Type.Object({
			verbose: Type.Optional(Type.Boolean({ description: "Include detailed session information (default: false)" })),
		}),
		renderCall: sessionRenderCall,
		renderResult: sessionRenderResult,

		async execute(_id, params, _signal, _onUpdate, _ctx: ExtensionContext) {
			const sessions = sessionManager.listSessions();
			if (sessions.length === 0) return result("No active sessions", { success: true, count: 0 });

			const lines = sessions.map(s => {
				const type = s.isLocal ? 'Local' : 'Remote';
				const ago = Math.floor((Date.now() - s.lastUsed.getTime()) / 1000);
				let line = `• ${s.name} (${type}) — ${s.state}, last used ${ago}s ago`;
				if (params.verbose) line += `\n  ID: ${s.id}, target: ${s.computerName}`;
				return line;
			});
			return result(`${sessions.length} session(s):\n${lines.join('\n')}`, { success: true, count: sessions.length });
		}
	});

	pi.registerTool({
		name: "pwsh-get-session",
		label: "PowerShell Get Session",
		description: "Get detailed information about a specific PowerShell session.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the session to inspect" }),
		}),
		renderCall: sessionRenderCall,
		renderResult: sessionRenderResult,

		async execute(_id, params, _signal, _onUpdate, _ctx: ExtensionContext) {
			const { name } = params;
			const s = sessionManager.getSession(name);
			if (!s) return result(`Session '${name}' not found`, { name, success: false });

			const type = s.isLocal ? 'Local' : 'Remote';
			const ago = Math.floor((Date.now() - s.lastUsed.getTime()) / 1000);
			return result(
				`Session: ${s.name}\nType: ${type}\nTarget: ${s.computerName}\nState: ${s.state}\nID: ${s.id}\nLast used: ${ago}s ago`,
				{ name, success: true, session: s }
			);
		}
	});

	pi.registerTool({
		name: "pwsh-test-session",
		label: "PowerShell Test Session",
		description: "Test connectivity and functionality of a PowerShell session by executing a simple command.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the session to test" }),
		}),
		renderCall: sessionRenderCall,
		renderResult: sessionRenderResult,

		async execute(_id, params, _signal, _onUpdate, _ctx: ExtensionContext) {
			const { name } = params;
			try {
				const r = await sessionManager.executeInSession(name, '$PSVersionTable.PSVersion.ToString()', 10000);
				if (r.success) return result(`Session '${name}' OK — PowerShell ${r.stdout.trim()}`, { name, success: true, psVersion: r.stdout.trim() });
				return result(`Session '${name}' test failed: ${r.stderr}`, { name, success: false, error: r.stderr });
			} catch (error) {
				return result(`Session '${name}' error: ${error instanceof Error ? error.message : String(error)}`, { name, success: false, error: String(error) });
			}
		}
	});

	pi.registerTool({
		name: "pwsh-close-session",
		label: "PowerShell Close Session",
		description: "Close a PowerShell session and clean up its resources. For remote sessions, this removes the PSSession on the target machine.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the session to close" }),
		}),
		renderCall: sessionRenderCall,
		renderResult: sessionRenderResult,

		async execute(_id, params, _signal, _onUpdate, _ctx: ExtensionContext) {
			const { name } = params;
			const s = sessionManager.getSession(name);
			if (!s) return result(`Session '${name}' not found`, { name, success: true });
			try {
				await sessionManager.closeSession(name);
				return result(`Closed session '${name}'`, { name, success: true });
			} catch (error) {
				return result(`Failed to close '${name}': ${error instanceof Error ? error.message : String(error)}`, { name, success: false, error: String(error) });
			}
		}
	});

	pi.registerTool({
		name: "pwsh-close-all-sessions",
		label: "PowerShell Close All Sessions",
		description: "Close all active PowerShell sessions and clean up resources. Useful for session cleanup and resource management.",
		parameters: Type.Object({}),
		renderCall: (_args, theme) => new Text(theme.fg("toolTitle", theme.bold("pwsh-close-all-sessions")), 0, 0),
		renderResult: sessionRenderResult,

		async execute(_id, _params, _signal, _onUpdate, _ctx: ExtensionContext) {
			const sessions = sessionManager.listSessions();
			if (sessions.length === 0) return result("No sessions to close", { success: true });
			try {
				await sessionManager.closeAllSessions();
				return result(`Closed ${sessions.length} session(s)`, { success: true, closed: sessions.length });
			} catch (error) {
				return result(`Failed: ${error instanceof Error ? error.message : String(error)}`, { success: false, error: String(error) });
			}
		}
	});
}
