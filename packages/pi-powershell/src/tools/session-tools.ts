/**
 * PowerShell Session Management Tools
 */

import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { sessionManager, PSSessionOptions } from "../session/session-manager.js";

function createSessionResult<T = unknown>(text: string, details: T, isError = false): AgentToolResult<T> {
	return {
		content: [{ type: "text", text }],
		details,
		...(isError ? { isError: true } : {}),
	};
}

/**
 * Register PowerShell session management tools
 */
export function registerSessionTools(pi: ExtensionAPI): void {
	
	// pwsh-create-session - Create a new persistent PowerShell session
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
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name, computerName, credential, authentication, port, useSSL, timeout } = params;
			
			try {
				const options: PSSessionOptions = {
					computerName,
					credential,
					authentication: authentication as any,
					port,
					useSSL,
					timeout: timeout ? timeout * 1000 : undefined
				};

				const sessionInfo = await sessionManager.createSession(name, options);
				
				const sessionType = sessionInfo.isLocal ? 'local' : 'remote';
				const target = sessionInfo.isLocal ? 'localhost' : sessionInfo.computerName;
				
				return createSessionResult(
					`Created ${sessionType} PowerShell session '${name}' on ${target}\nSession ID: ${sessionInfo.id}\nState: ${sessionInfo.state}`,
					{ 
						sessionInfo,
						created: true
					}
				);

			} catch (error) {
				return createSessionResult(
					`Failed to create session '${name}': ${error instanceof Error ? error.message : String(error)}`,
					{ 
						name, 
						error: String(error),
						created: false
					},
					true
				);
			}
		}
	});

	// pwsh-list-sessions - List all PowerShell sessions
	pi.registerTool({
		name: "pwsh-list-sessions",
		label: "PowerShell List Sessions",
		description: "List all active PowerShell sessions with their status and information.",
		parameters: Type.Object({
			verbose: Type.Optional(Type.Boolean({ description: "Include detailed session information (default: false)" })),
		}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { verbose = false } = params;
			
			const sessions = sessionManager.listSessions();
			
			if (sessions.length === 0) {
				return createSessionResult(
					"No active PowerShell sessions",
					{ sessions: [], count: 0 }
				);
			}

			let output = `Found ${sessions.length} active session(s):\n\n`;
			
			for (const session of sessions) {
				const sessionType = session.isLocal ? 'Local' : 'Remote';
				const lastUsedAgo = Math.floor((Date.now() - session.lastUsed.getTime()) / 1000);
				
				output += `• ${session.name} (${sessionType})\n`;
				output += `  Target: ${session.computerName}\n`;
				output += `  State: ${session.state}\n`;
				output += `  Last used: ${lastUsedAgo}s ago\n`;
				
				if (verbose) {
					output += `  Session ID: ${session.id}\n`;
					output += `  Runspace ID: ${session.runspaceId || 'N/A'}\n`;
					output += `  Created: ${session.createdAt.toISOString()}\n`;
					if (session.options?.credential) {
						output += `  Credential: ${session.options.credential}\n`;
					}
					if (session.options?.authentication) {
						output += `  Auth: ${session.options.authentication}\n`;
					}
				}
				output += '\n';
			}

			return createSessionResult(
				output.trim(),
				{ sessions, count: sessions.length, verbose }
			);
		}
	});

	// pwsh-get-session - Get detailed information about a specific session
	pi.registerTool({
		name: "pwsh-get-session",
		label: "PowerShell Get Session",
		description: "Get detailed information about a specific PowerShell session.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the session to inspect" }),
		}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name } = params;
			
			const session = sessionManager.getSession(name);
			
			if (!session) {
				return createSessionResult(
					`Session '${name}' not found`,
					{ name, found: false },
					true
				);
			}

			const sessionType = session.isLocal ? 'Local' : 'Remote';
			const createdAgo = Math.floor((Date.now() - session.createdAt.getTime()) / 1000);
			const lastUsedAgo = Math.floor((Date.now() - session.lastUsed.getTime()) / 1000);

			let output = `Session: ${session.name}\n`;
			output += `Type: ${sessionType}\n`;
			output += `Target: ${session.computerName}\n`;
			output += `State: ${session.state}\n`;
			output += `Session ID: ${session.id}\n`;
			output += `Runspace ID: ${session.runspaceId || 'N/A'}\n`;
			output += `Created: ${createdAgo}s ago (${session.createdAt.toISOString()})\n`;
			output += `Last used: ${lastUsedAgo}s ago (${session.lastUsed.toISOString()})\n`;

			if (session.options) {
				output += '\nConnection Options:\n';
				if (session.options.credential) {
					output += `  Credential: ${session.options.credential}\n`;
				}
				if (session.options.authentication) {
					output += `  Authentication: ${session.options.authentication}\n`;
				}
				if (session.options.port) {
					output += `  Port: ${session.options.port}\n`;
				}
				if (session.options.useSSL) {
					output += `  SSL: enabled\n`;
				}
			}

			return createSessionResult(
				output.trim(),
				{ session, found: true }
			);
		}
	});

	// pwsh-test-session - Test session connectivity
	pi.registerTool({
		name: "pwsh-test-session",
		label: "PowerShell Test Session",
		description: "Test connectivity and functionality of a PowerShell session by executing a simple command.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the session to test" }),
		}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name } = params;
			
			try {
				const testCommand = '$PSVersionTable.PSVersion.ToString(); "Session test successful"';
				const result = await sessionManager.executeInSession(name, testCommand, 10000);
				
				if (result.success) {
					return createSessionResult(
						`Session '${name}' test successful\nPowerShell Version: ${result.stdout.split('\n')[0]}\nResponse: ${result.stdout.split('\n').slice(1).join('\n')}`,
						{ 
							name,
							testResult: 'success',
							psVersion: result.stdout.split('\n')[0],
							sessionInfo: result.sessionInfo
						}
					);
				} else {
					return createSessionResult(
						`Session '${name}' test failed\nError: ${result.stderr}`,
						{ 
							name,
							testResult: 'failed',
							error: result.stderr,
							sessionInfo: result.sessionInfo
						},
						true
					);
				}

			} catch (error) {
				return createSessionResult(
					`Session '${name}' test error: ${error instanceof Error ? error.message : String(error)}`,
					{ 
						name,
						testResult: 'error',
						error: String(error)
					},
					true
				);
			}
		}
	});

	// pwsh-close-session - Close and cleanup a PowerShell session
	pi.registerTool({
		name: "pwsh-close-session",
		label: "PowerShell Close Session",
		description: "Close a PowerShell session and clean up its resources. For remote sessions, this removes the PSSession on the target machine.",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the session to close" }),
		}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name } = params;
			
			const session = sessionManager.getSession(name);
			if (!session) {
				return createSessionResult(
					`Session '${name}' not found (may already be closed)`,
					{ name, found: false }
				);
			}

			try {
				await sessionManager.closeSession(name);
				
				const sessionType = session.isLocal ? 'local' : 'remote';
				return createSessionResult(
					`Closed ${sessionType} PowerShell session '${name}' on ${session.computerName}`,
					{ 
						name,
						closed: true,
						sessionInfo: session
					}
				);

			} catch (error) {
				return createSessionResult(
					`Failed to close session '${name}': ${error instanceof Error ? error.message : String(error)}`,
					{ 
						name,
						closed: false,
						error: String(error)
					},
					true
				);
			}
		}
	});

	// pwsh-close-all-sessions - Close all PowerShell sessions
	pi.registerTool({
		name: "pwsh-close-all-sessions",
		label: "PowerShell Close All Sessions",
		description: "Close all active PowerShell sessions and clean up resources. Useful for session cleanup and resource management.",
		parameters: Type.Object({}),
		
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const sessions = sessionManager.listSessions();
			
			if (sessions.length === 0) {
				return createSessionResult(
					"No active sessions to close",
					{ closed: 0, sessions: [] }
				);
			}

			try {
				await sessionManager.closeAllSessions();
				
				return createSessionResult(
					`Closed ${sessions.length} PowerShell session(s)`,
					{ 
						closed: sessions.length,
						sessions: sessions.map(s => s.name)
					}
				);

			} catch (error) {
				return createSessionResult(
					`Failed to close all sessions: ${error instanceof Error ? error.message : String(error)}`,
					{ 
						closed: 0,
						error: String(error)
					},
					true
				);
			}
		}
	});
}