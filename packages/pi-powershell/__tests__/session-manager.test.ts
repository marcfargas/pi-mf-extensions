/**
 * Tests for PowerShell Session Manager
 */

import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import { PowerShellSessionManager } from "../src/session/session-manager.js";

describe("PowerShell Session Manager", () => {
	let sessionManager: PowerShellSessionManager;
	let isPowerShellAvailable = false;

	beforeAll(async () => {
		// Test if PowerShell is available
		try {
			const { spawn } = await import("child_process");
			const testProcess = spawn('pwsh', ['-Command', '$PSVersionTable.PSVersion.Major'], { 
				stdio: 'pipe',
				timeout: 5000 
			});
			
			let output = '';
			testProcess.stdout?.on('data', (data) => {
				output += data.toString();
			});
			
			await new Promise((resolve) => {
				testProcess.on('close', (code) => {
					isPowerShellAvailable = code === 0 && output.trim().length > 0;
					resolve(code);
				});
			});
		} catch {
			isPowerShellAvailable = false;
		}
	});

	beforeEach(() => {
		sessionManager = new PowerShellSessionManager();
	});

	afterEach(async () => {
		if (isPowerShellAvailable) {
			// Clean up any test sessions
			await sessionManager.closeAllSessions();
		}
	});

	describe("Local Session Management", () => {
		it("should create a local session", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			const sessionInfo = await sessionManager.createSession('test-local');

			expect(sessionInfo).toBeDefined();
			expect(sessionInfo.name).toBe('test-local');
			expect(sessionInfo.isLocal).toBe(true);
			expect(sessionInfo.state).toBe('Connected');
			expect(sessionInfo.computerName).toBe('localhost');
		}, 15000);

		it("should execute commands in local session", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await sessionManager.createSession('test-exec');
			
			// Test basic command
			const result1 = await sessionManager.executeInSession('test-exec', 'Write-Output "Hello World"');
			
			expect(result1.success).toBe(true);
			expect(result1.stdout).toContain('Hello World');

			// Test state persistence - set a variable
			const result2 = await sessionManager.executeInSession('test-exec', '$testVar = 42; Write-Output "Variable set"');
			expect(result2.success).toBe(true);
			
			// Test state persistence - use the variable
			const result3 = await sessionManager.executeInSession('test-exec', 'Write-Output "Value: $testVar"');
			expect(result3.success).toBe(true);
			expect(result3.stdout).toContain('Value: 42');
		}, 20000);

		it("should handle command errors in local session", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await sessionManager.createSession('test-error');
			
			const result = await sessionManager.executeInSession('test-error', 'Get-NonExistentCommand');
			
			expect(result.success).toBe(false);
			expect(result.stderr).toBeTruthy();
		}, 15000);

		it("should list sessions", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await sessionManager.createSession('test-list-1');
			await sessionManager.createSession('test-list-2');
			
			const sessions = sessionManager.listSessions();
			
			expect(sessions).toHaveLength(2);
			expect(sessions.map(s => s.name)).toContain('test-list-1');
			expect(sessions.map(s => s.name)).toContain('test-list-2');
		}, 20000);

		it("should get specific session info", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await sessionManager.createSession('test-get');
			
			const sessionInfo = sessionManager.getSession('test-get');
			
			expect(sessionInfo).toBeDefined();
			expect(sessionInfo!.name).toBe('test-get');
			expect(sessionInfo!.isLocal).toBe(true);
		}, 15000);

		it("should close sessions", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await sessionManager.createSession('test-close');
			
			// Verify session exists
			let sessionInfo = sessionManager.getSession('test-close');
			expect(sessionInfo).toBeDefined();
			
			// Close session
			await sessionManager.closeSession('test-close');
			
			// Verify session no longer exists
			sessionInfo = sessionManager.getSession('test-close');
			expect(sessionInfo).toBeUndefined();
		}, 15000);
	});

	describe("Session State Management", () => {
		it("should maintain module imports across commands", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await sessionManager.createSession('test-modules');
			
			// Import a module
			const result1 = await sessionManager.executeInSession('test-modules', 'Import-Module Microsoft.PowerShell.Utility -Force; Write-Output "Module imported"');
			expect(result1.success).toBe(true);
			
			// Use module functionality 
			const result2 = await sessionManager.executeInSession('test-modules', 'ConvertTo-Json @{test="value"}');
			expect(result2.success).toBe(true);
			expect(result2.stdout).toContain('"test"');
		}, 20000);

		it("should maintain functions across commands", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await sessionManager.createSession('test-functions');
			
			// Define a function
			const result1 = await sessionManager.executeInSession('test-functions', `
				function Test-CustomFunction {
					param($Message)
					return "Custom: $Message"
				}
				Write-Output "Function defined"
			`);
			expect(result1.success).toBe(true);
			
			// Use the function
			const result2 = await sessionManager.executeInSession('test-functions', 'Test-CustomFunction -Message "Hello"');
			expect(result2.success).toBe(true);
			expect(result2.stdout).toContain('Custom: Hello');
		}, 20000);
	});

	describe("Error Handling", () => {
		it("should handle duplicate session names", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await sessionManager.createSession('test-duplicate');
			
			await expect(sessionManager.createSession('test-duplicate')).rejects.toThrow(/already exists/);
		}, 15000);

		it("should handle non-existent session execution", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await expect(sessionManager.executeInSession('non-existent', 'Write-Output "test"')).rejects.toThrow(/not found/);
		});

		it("should handle command timeout", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			await sessionManager.createSession('test-timeout');
			
			const promise = sessionManager.executeInSession('test-timeout', 'Start-Sleep -Seconds 3', 1000);
			await expect(promise).rejects.toThrow(/timed out/);
		}, 15000);
	});

	describe("Remote Session Options", () => {
		it("should create remote session configuration (without actually connecting)", async () => {
			// This test verifies the session creation without actually connecting to a remote machine
			const sessionInfo = await sessionManager.createSession('test-remote', {
				computerName: 'remote-server.example.com',
				credential: 'domain\\user',
				authentication: 'Kerberos',
				port: 5986,
				useSSL: true
			});

			expect(sessionInfo).toBeDefined();
			expect(sessionInfo.name).toBe('test-remote');
			expect(sessionInfo.isLocal).toBe(false);
			expect(sessionInfo.computerName).toBe('remote-server.example.com');
			expect(sessionInfo.options?.credential).toBe('domain\\user');
			expect(sessionInfo.options?.authentication).toBe('Kerberos');
			expect(sessionInfo.options?.port).toBe(5986);
			expect(sessionInfo.options?.useSSL).toBe(true);
		});
	});

	describe("Session Lifecycle Events", () => {
		it("should emit session events", async () => {
			if (!isPowerShellAvailable) {
				console.log("Skipping test: PowerShell not available");
				return;
			}

			const events: string[] = [];
			
			sessionManager.on('sessionCreated', (info) => {
				events.push(`created:${info.name}`);
			});
			
			sessionManager.on('sessionClosed', (info) => {
				events.push(`closed:${info.name}`);
			});

			await sessionManager.createSession('test-events');
			await sessionManager.closeSession('test-events');
			
			expect(events).toContain('created:test-events');
			expect(events).toContain('closed:test-events');
		}, 15000);
	});
});