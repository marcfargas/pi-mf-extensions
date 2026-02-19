/**
 * PSSession lifecycle tools — create/close persistent PowerShell sessions.
 * 
 * PSSessions persist state (variables, modules, functions) across powershell tool calls.
 * Without these tools, each `powershell` invocation is a fresh process.
 * 
 * Flow:
 *   pwsh-create-session name="work" → creates persistent PS process
 *   powershell command="$x = 42" session="work" → runs in session
 *   powershell command="$x" session="work" → returns 42 (state persisted)
 *   pwsh-close-session name="work" → cleanup
 */

import type { ExtensionAPI, ExtensionContext, AgentToolResult, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { sessionManager } from "../session/session-manager.js";

interface SessionDetails { name: string; success: boolean; error?: string; [key: string]: unknown; }

function result(text: string, details: SessionDetails): AgentToolResult<SessionDetails> {
	return { content: [{ type: "text", text }], details };
}

function renderResult(res: AgentToolResult<SessionDetails>, options: ToolRenderResultOptions, theme: Theme) {
	const text = res.content[0]?.type === "text" ? res.content[0].text : "";
	if (!res.details?.success) return new Text(theme.fg("error", text), 0, 0);
	return new Text(theme.fg("toolOutput", text), 0, 0);
}

export function registerPSessionTools(pi: ExtensionAPI): void {

	pi.registerTool({
		name: "pwsh-create-session",
		label: "Create PSSession",
		description: "Create a persistent PSSession for remote PowerShell execution. The session maintains state (variables, modules) across commands on the remote machine. Use session='name' on the powershell tool to run commands in it.",
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
		renderResult,

		async execute(_id, params, _signal, _onUpdate, _ctx: ExtensionContext) {
			const { name, computerName, credential, authentication, port, useSSL, timeout } = params;
			try {
				const info = await sessionManager.createSession(name, {
					computerName, credential, authentication: authentication as any, port, useSSL,
					timeout: timeout ? timeout * 1000 : undefined
				});
				const type = info.isLocal ? 'local' : 'remote';
				const target = info.isLocal ? 'localhost' : info.computerName;
				return result(`Created ${type} PSSession '${name}' on ${target} — use session="${name}" in powershell tool`, { name, success: true });
			} catch (error) {
				return result(`Failed to create PSSession '${name}': ${error instanceof Error ? error.message : String(error)}`, { name, success: false, error: String(error) });
			}
		}
	});

	pi.registerTool({
		name: "pwsh-close-session",
		label: "Close PSSession",
		description: "Close a PowerShell session and clean up its resources. For remote sessions, this removes the PSSession on the target machine.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the session to close" }),
		}),
		renderCall: (args, theme) => new Text(
			theme.fg("toolTitle", theme.bold("pwsh-close-session ")) + theme.fg("accent", args.name),
			0, 0
		),
		renderResult,

		async execute(_id, params, _signal, _onUpdate, _ctx: ExtensionContext) {
			const { name } = params;
			try {
				await sessionManager.closeSession(name);
				return result(`Closed PSSession '${name}'`, { name, success: true });
			} catch (error) {
				return result(`Failed to close '${name}': ${error instanceof Error ? error.message : String(error)}`, { name, success: false, error: String(error) });
			}
		}
	});
}
