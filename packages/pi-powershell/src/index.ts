/**
 * pi-powershell — PowerShell tool for Windows system integration and background processes.
 *
 * Extension entry point. Registers PowerShell tool and job management helpers.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPowerShellTool } from "./tools/powershell.js";
import { registerJobHelpers } from "./tools/job-helpers.js";

export default function activate(pi: ExtensionAPI): void {
	// Register the general PowerShell tool
	registerPowerShellTool(pi);
	
	// Register job management helpers
	registerJobHelpers(pi);
}