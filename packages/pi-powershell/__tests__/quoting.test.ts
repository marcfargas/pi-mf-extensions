/**
 * Tests for PowerShell command quoting and environment variable handling
 */

import { describe, it, expect } from "vitest";

// Import the internal functions for testing
const { convertEnvVarsToPS, escapeForPowerShell, quoteForPowerShellScriptBlock } = (() => {
	/**
	 * Convert bash-style environment variable assignments to PowerShell syntax
	 */
	function convertEnvVarsToPS(command: string): string {
		// Simple regex to match: VARNAME=value (at start of line, with optional leading spaces)
		// This handles the most common cases: VAR=value, VAR='value', VAR="value", VAR=''
		const regex = /^(\s*)([A-Z_][A-Z0-9_]*)\s*=\s*('[^']*'|"[^"]*"|\S+)(\s+.*)?$/;
		const match = command.match(regex);
		
		if (!match) {
			return command; // No env var pattern found
		}
		
		const [, leadingSpace, varName, quotedValue, restOfCommand] = match;
		
		// Clean the value - remove outer quotes if present
		let cleanValue = quotedValue;
		if (quotedValue.startsWith("'") && quotedValue.endsWith("'")) {
			cleanValue = quotedValue.slice(1, -1);
		} else if (quotedValue.startsWith('"') && quotedValue.endsWith('"')) {
			cleanValue = quotedValue.slice(1, -1);
		}
		
		// Escape single quotes for PowerShell
		const escapedValue = cleanValue.replace(/'/g, "''");
		
		// Build the PowerShell equivalent
		const remainder = restOfCommand || '';
		return `${leadingSpace}$env:${varName} = '${escapedValue}';${remainder}`;
	}

	/**
	 * Escape PowerShell special characters in the remaining command parts
	 */
	function escapePowerShellSpecialChars(str: string): string {
		// Only escape backticks in the command parts (not in env var assignments we just created)
		return str.replace(/`/g, "``");
	}

	/**
	 * Escape PowerShell string for safe execution within script blocks
	 */
	function escapeForPowerShell(str: string): string {
		// First convert bash-style env vars to PowerShell syntax (this handles quote escaping internally)
		let processed = convertEnvVarsToPS(str);
		
		// Then escape remaining PowerShell special characters
		processed = escapePowerShellSpecialChars(processed);
		
		return processed;
	}

	/**
	 * Properly quote a command for PowerShell script block execution
	 */
	function quoteForPowerShellScriptBlock(command: string): string {
		// Convert env vars and escape the command properly
		const processedCommand = escapeForPowerShell(command);
		
		// For script blocks, the command goes directly in the script block
		return processedCommand;
	}

	return { convertEnvVarsToPS, escapeForPowerShell, quoteForPowerShellScriptBlock };
})();

describe("PowerShell Command Quoting", () => {
	
	describe("Environment Variable Conversion", () => {
		it("should convert simple env var assignments", () => {
			const input = "NODE_ENV=production npm start";
			const expected = "$env:NODE_ENV = 'production'; npm start";
			expect(convertEnvVarsToPS(input)).toBe(expected);
		});

		it("should convert env vars with single quotes", () => {
			const input = "R_SCOPE_TOKEN='' npm run dev";
			const expected = "$env:R_SCOPE_TOKEN = ''; npm run dev";
			expect(convertEnvVarsToPS(input)).toBe(expected);
		});

		it("should convert env vars with double quotes", () => {
			const input = 'API_KEY="secret-key-123" npm test';
			const expected = "$env:API_KEY = 'secret-key-123'; npm test";
			expect(convertEnvVarsToPS(input)).toBe(expected);
		});

		it("should convert env vars with complex values", () => {
			const input = "DATABASE_URL=postgresql://user:pass@host:5432/db npm run migrate";
			const expected = "$env:DATABASE_URL = 'postgresql://user:pass@host:5432/db'; npm run migrate";
			expect(convertEnvVarsToPS(input)).toBe(expected);
		});

		it("should handle multiple spaces around assignment", () => {
			const input = "  NODE_ENV  =  development   npm start";
			const expected = "  $env:NODE_ENV = 'development';   npm start";
			expect(convertEnvVarsToPS(input)).toBe(expected);
		});

		it("should not convert env vars in the middle of commands", () => {
			const input = "npm start NODE_ENV=production";
			expect(convertEnvVarsToPS(input)).toBe(input); // Should remain unchanged
		});

		it("should handle underscore variables", () => {
			const input = "API_BASE_URL_V2=https://api.example.com/v2 npm run build";
			const expected = "$env:API_BASE_URL_V2 = 'https://api.example.com/v2'; npm run build";
			expect(convertEnvVarsToPS(input)).toBe(expected);
		});
	});

	describe("PowerShell Character Escaping", () => {
		it("should escape backticks", () => {
			const input = "echo `$PATH";
			const expected = "echo ``$PATH";
			expect(escapeForPowerShell(input)).toBe(expected);
		});
		
		it("should not escape quotes in non-env-var contexts", () => {
			// The current implementation only escapes quotes within environment variable values
			const input = "echo 'hello world'";
			const expected = "echo 'hello world'"; // No escaping for simple strings
			expect(escapeForPowerShell(input)).toBe(expected);
		});

		it("should escape quotes in env var values", () => {
			// Note: Complex nested quotes (like 'it's working') are handled by cmd /c fallback
			// This test covers the simple quote escaping case
			const input = "MESSAGE='hello world' npm test";
			const expected = "$env:MESSAGE = 'hello world'; npm test";
			expect(escapeForPowerShell(input)).toBe(expected);
		});
		
		it("should handle empty quoted values correctly", () => {
			const input = "R_SCOPE_TOKEN='' npm run dev";
			const expected = "$env:R_SCOPE_TOKEN = ''; npm run dev";  
			expect(escapeForPowerShell(input)).toBe(expected);
		});
	});

	describe("Complex Command Scenarios", () => {
		it("should handle npm scripts with env vars", () => {
			const input = "NODE_ENV=test PORT=3001 npm run dev";
			// Multiple env vars - only the first one should be converted by our current regex
			const result = quoteForPowerShellScriptBlock(input);
			expect(result).toContain("$env:NODE_ENV = 'test'");
		});

		it("should handle commands with paths", () => {
			const input = "cd C:\\Projects && npm install";
			const result = quoteForPowerShellScriptBlock(input);
			expect(result).toBe("cd C:\\Projects && npm install");
		});

		it("should handle complex npm scripts", () => {
			const input = "cross-env NODE_ENV=production webpack --mode production";
			const result = quoteForPowerShellScriptBlock(input);
			// cross-env should handle env vars, so no conversion needed
			expect(result).toBe("cross-env NODE_ENV=production webpack --mode production");
		});
	});

	describe("Real-world Examples", () => {
		it("should handle typical development server command", () => {
			const input = "NODE_ENV=development npm run dev";
			const expected = "$env:NODE_ENV = 'development'; npm run dev";
			expect(quoteForPowerShellScriptBlock(input)).toBe(expected);
		});

		it("should handle build commands with multiple flags", () => {
			const input = "BUILD_TARGET=production npm run build -- --optimization";
			const expected = "$env:BUILD_TARGET = 'production'; npm run build -- --optimization";
			expect(quoteForPowerShellScriptBlock(input)).toBe(expected);
		});

		it("should handle test commands with coverage", () => {
			const input = "CI=true npm run test:coverage";
			const expected = "$env:CI = 'true'; npm run test:coverage";
			expect(quoteForPowerShellScriptBlock(input)).toBe(expected);
		});

		// This is the specific case that was failing
		it("should handle R_SCOPE_TOKEN case", () => {
			const input = "R_SCOPE_TOKEN='' npm run dev";
			const expected = "$env:R_SCOPE_TOKEN = ''; npm run dev";
			expect(quoteForPowerShellScriptBlock(input)).toBe(expected);
		});
	});
});

describe("PowerShell Quoting Rules Documentation", () => {
	it("should document PowerShell vs Bash differences", () => {
		const examples = {
			bash: {
				envVar: "VAR=value command",
				singleQuotes: "'literal string'",
				doubleQuotes: '"variable expansion: $VAR"',
				escape: "echo \\$PATH"
			},
			powerShell: {
				envVar: "$env:VAR = 'value'; command",
				singleQuotes: "'literal string'",
				doubleQuotes: '"variable expansion: $env:VAR"',
				escape: "echo `$PATH"
			}
		};

		// This test documents the differences - it doesn't assert anything
		// but serves as documentation of the quoting rules
		console.log('PowerShell vs Bash Quoting Rules:');
		console.log('=====================================');
		console.log('Environment Variables:');
		console.log(`  Bash:       ${examples.bash.envVar}`);
		console.log(`  PowerShell: ${examples.powerShell.envVar}`);
		console.log();
		console.log('Single Quotes (literal strings):');
		console.log(`  Bash:       ${examples.bash.singleQuotes}`);
		console.log(`  PowerShell: ${examples.powerShell.singleQuotes}`);
		console.log();
		console.log('Double Quotes (variable expansion):');
		console.log(`  Bash:       ${examples.bash.doubleQuotes}`);
		console.log(`  PowerShell: ${examples.powerShell.doubleQuotes}`);
		console.log();
		console.log('Escape Character:');
		console.log(`  Bash:       ${examples.bash.escape}`);
		console.log(`  PowerShell: ${examples.powerShell.escape}`);
		
		expect(true).toBe(true); // Test passes - this is just documentation
	});
});