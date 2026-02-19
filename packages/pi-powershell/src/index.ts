/**
 * pi-powershell — PowerShell tool for Windows system integration and background processes.
 *
 * Extension entry point. Registers PowerShell tools, job management helpers, and session management.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPowerShellTool } from "./tools/powershell.js";
import { registerJobHelpers } from "./tools/job-helpers.js";
import { registerPSessionTools } from "./tools/psession-tools.js";
import { sessionManager } from "./session/session-manager.js";

export default function activate(pi: ExtensionAPI): void {
	registerPowerShellTool(pi);
	registerJobHelpers(pi);
	registerPSessionTools(pi);
	
	// Handle extension cleanup
	process.on('SIGINT', async () => {
		await sessionManager.closeAllSessions();
	});
	
	process.on('SIGTERM', async () => {
		await sessionManager.closeAllSessions();
	});
}