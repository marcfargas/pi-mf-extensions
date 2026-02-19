/**
 * PowerShell Session Manager - Persistent PSSession management for local and remote execution
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface PSSessionOptions {
	computerName?: string;
	credential?: string;
	authentication?: 'Default' | 'Kerberos' | 'Certificate' | 'Basic' | 'Negotiate';
	port?: number;
	useSSL?: boolean;
	timeout?: number;
}

export interface PSSessionInfo {
	name: string;
	id: string;
	state: 'Connected' | 'Disconnected' | 'Connecting' | 'Failed';
	computerName: string;
	runspaceId?: string;
	configurationName?: string;
	createdAt: Date;
	lastUsed: Date;
	isLocal: boolean;
	options?: PSSessionOptions;
}

export interface SessionResult {
	stdout: string;
	stderr: string;
	success: boolean;
	sessionInfo: PSSessionInfo;
}

/**
 * Manages persistent PowerShell sessions for local and remote execution
 */
export class PowerShellSessionManager extends EventEmitter {
	private sessions = new Map<string, {
		info: PSSessionInfo;
		process?: ChildProcess;
		connected: boolean;
		commandQueue: Array<{
			command: string;
			resolve: (result: SessionResult) => void;
			reject: (error: Error) => void;
		}>;
	}>();

	private commandId = 0;

	constructor() {
		super();
	}

	/**
	 * Create a new PowerShell session
	 */
	async createSession(name: string, options: PSSessionOptions = {}): Promise<PSSessionInfo> {
		if (this.sessions.has(name)) {
			throw new Error(`Session '${name}' already exists`);
		}

		const isLocal = !options.computerName;
		const sessionInfo: PSSessionInfo = {
			name,
			id: this.generateSessionId(),
			state: 'Connecting',
			computerName: options.computerName || 'localhost',
			createdAt: new Date(),
			lastUsed: new Date(),
			isLocal,
			options
		};

		if (isLocal) {
			// Create local persistent PowerShell process
			await this.createLocalSession(name, sessionInfo);
		} else {
			// Create remote PSSession
			await this.createRemoteSession(name, sessionInfo, options);
		}

		return sessionInfo;
	}

	/**
	 * Execute command in a specific session
	 */
	async executeInSession(sessionName: string, command: string, timeout: number = 30000): Promise<SessionResult> {
		const session = this.sessions.get(sessionName);
		if (!session) {
			throw new Error(`Session '${sessionName}' not found`);
		}

		session.info.lastUsed = new Date();

		if (session.info.isLocal) {
			return await this.executeInLocalSession(session, command, timeout);
		} else {
			return await this.executeInRemoteSession(session, command, timeout);
		}
	}

	/**
	 * Get session information
	 */
	getSession(name: string): PSSessionInfo | undefined {
		return this.sessions.get(name)?.info;
	}

	/**
	 * List all sessions
	 */
	listSessions(): PSSessionInfo[] {
		return Array.from(this.sessions.values()).map(s => ({ ...s.info }));
	}

	/**
	 * Close a session and clean up resources
	 */
	async closeSession(name: string): Promise<void> {
		const session = this.sessions.get(name);
		if (!session) {
			return;
		}

		if (session.process) {
			// Close local PowerShell process
			session.process.stdin?.write('exit\n');
			session.process.kill('SIGTERM');
		} else if (!session.info.isLocal) {
			// Close remote PSSession
			try {
				await this.executeInRemoteSession(session, `Remove-PSSession -Name '${name}' -ErrorAction SilentlyContinue`, 5000);
			} catch {
				// Ignore errors during cleanup
			}
		}

		this.sessions.delete(name);
		this.emit('sessionClosed', session.info);
	}

	/**
	 * Close all sessions
	 */
	async closeAllSessions(): Promise<void> {
		const sessionNames = Array.from(this.sessions.keys());
		await Promise.all(sessionNames.map(name => this.closeSession(name)));
	}

	/**
	 * Create local persistent PowerShell session
	 */
	private async createLocalSession(name: string, sessionInfo: PSSessionInfo): Promise<void> {
		return new Promise((resolve, reject) => {
			const process = spawn('pwsh', [
				'-NoProfile',
				'-NoLogo', 
				'-ExecutionPolicy', 'Bypass',
				'-Command', '-' // Read from stdin
			], {
				stdio: ['pipe', 'pipe', 'pipe'],
				shell: false
			});

			let initialized = false;

			const session = {
				info: sessionInfo,
				process,
				connected: false,
				commandQueue: []
			};

			// Send a test command to verify PowerShell is ready
			const initTest = () => {
				if (!initialized) {
					process.stdin?.write('Write-Host "PSREADY"\n');
				}
			};

			let readyCheckInterval: NodeJS.Timeout;

			process.stdout?.on('data', (data) => {
				const output = data.toString();
				
				if (!initialized && output.includes('PSREADY')) {
					// PowerShell is ready
					initialized = true;
					session.connected = true;
					sessionInfo.state = 'Connected';
					sessionInfo.runspaceId = this.generateRunspaceId();
					
					if (readyCheckInterval) clearInterval(readyCheckInterval);
					
					this.sessions.set(name, session);
					this.emit('sessionCreated', sessionInfo);
					resolve();
				}
			});

			process.stderr?.on('data', (data) => {
				const output = data.toString();
				// Ignore common PowerShell startup warnings
				if (!output.includes('WARNING:') && !initialized) {
					console.warn('PowerShell stderr during init:', output);
				}
			});

			process.on('error', (err) => {
				sessionInfo.state = 'Failed';
				if (readyCheckInterval) clearInterval(readyCheckInterval);
				if (!initialized) {
					reject(new Error(`Failed to start local PowerShell session: ${err.message}`));
				} else {
					this.emit('sessionError', sessionInfo, err);
				}
			});

			process.on('close', (code) => {
				sessionInfo.state = 'Disconnected';
				session.connected = false;
				if (readyCheckInterval) clearInterval(readyCheckInterval);
				this.emit('sessionDisconnected', sessionInfo);
			});

			// Wait a moment for process to start, then send ready test
			setTimeout(() => {
				if (!initialized) {
					initTest();
					// Retry the ready check every 500ms
					readyCheckInterval = setInterval(initTest, 500);
				}
			}, 100);

			// Set timeout for initialization
			setTimeout(() => {
				if (!initialized) {
					if (readyCheckInterval) clearInterval(readyCheckInterval);
					process.kill('SIGTERM');
					reject(new Error('Local PowerShell session initialization timed out'));
				}
			}, 10000);
		});
	}

	/**
	 * Create remote PowerShell session
	 */
	private async createRemoteSession(name: string, sessionInfo: PSSessionInfo, options: PSSessionOptions): Promise<void> {
		// For remote sessions, we'll create them on-demand during first command execution
		// This avoids keeping long-running connections when not needed
		sessionInfo.state = 'Connected';
		sessionInfo.runspaceId = this.generateRunspaceId();

		const session = {
			info: sessionInfo,
			connected: true,
			commandQueue: []
		};

		this.sessions.set(name, session);
		this.emit('sessionCreated', sessionInfo);
	}

	/**
	 * Execute command in local session
	 */
	private async executeInLocalSession(session: any, command: string, timeout: number): Promise<SessionResult> {
		return new Promise((resolve, reject) => {
			if (!session.process || !session.connected) {
				reject(new Error('Local session is not connected'));
				return;
			}

			const cmdId = ++this.commandId;
			const startMarker = `---START-${cmdId}---`;
			const endMarker = `---END-${cmdId}---`;
			
			// Wrap command with markers for reliable output parsing
			const wrappedCommand = `
Write-Host "${startMarker}"
try {
	${command}
	Write-Host "${endMarker}:SUCCESS"
} catch {
	Write-Error $_.Exception.Message
	Write-Host "${endMarker}:ERROR"
}
`;

			let stdout = '';
			let stderr = '';
			let capturing = false;
			let completed = false;

			// Cleanup function
			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				session.process.stdout?.off('data', dataHandler);
				session.process.stderr?.off('data', errorHandler);
			};

			const dataHandler = (data: Buffer) => {
				const text = data.toString();
				
				if (text.includes(startMarker)) {
					capturing = true;
					stdout = '';
					stderr = '';
					return;
				}
				
				if (capturing) {
					if (text.includes(`${endMarker}:SUCCESS`)) {
						completed = true;
						const cleanOutput = stdout.replace(new RegExp(`${startMarker}\\s*`, 'g'), '').trim();
						cleanup();
						resolve({
							stdout: cleanOutput,
							stderr: stderr.trim(),
							success: true,
							sessionInfo: { ...session.info }
						});
					} else if (text.includes(`${endMarker}:ERROR`)) {
						completed = true;
						const cleanOutput = stdout.replace(new RegExp(`${startMarker}\\s*`, 'g'), '').trim();
						cleanup();
						resolve({
							stdout: cleanOutput,
							stderr: stderr.trim(),
							success: false,
							sessionInfo: { ...session.info }
						});
					} else {
						stdout += text;
					}
				}
			};

			const errorHandler = (data: Buffer) => {
				if (capturing) {
					stderr += data.toString();
				}
			};

			session.process.stdout?.on('data', dataHandler);
			session.process.stderr?.on('data', errorHandler);

			// Set timeout
			const timeoutId = setTimeout(() => {
				if (!completed) {
					completed = true;
					cleanup();
					reject(new Error(`Command timed out after ${timeout}ms`));
				}
			}, timeout);

			// Send command
			session.process.stdin?.write(wrappedCommand + '\n');
		});
	}

	/**
	 * Execute command in remote session
	 */
	private async executeInRemoteSession(session: any, command: string, timeout: number): Promise<SessionResult> {
		const options = session.info.options || {};
		
		// Build Invoke-Command with session management
		let invokeCommand = `
$session = Get-PSSession -Name '${session.info.name}' -ErrorAction SilentlyContinue
if (-not $session) {
	$sessionParams = @{
		Name = '${session.info.name}'
		ComputerName = '${session.info.computerName}'
	}
`;

		// Add authentication parameters
		if (options.credential) {
			invokeCommand += `	$sessionParams.Credential = Get-Credential -UserName '${options.credential}' -Message 'Enter credentials'\n`;
		}
		if (options.authentication) {
			invokeCommand += `	$sessionParams.Authentication = '${options.authentication}'\n`;
		}
		if (options.port) {
			invokeCommand += `	$sessionParams.Port = ${options.port}\n`;
		}
		if (options.useSSL) {
			invokeCommand += `	$sessionParams.UseSSL = $true\n`;
		}

		invokeCommand += `
	$session = New-PSSession @sessionParams
}

Invoke-Command -Session $session -ScriptBlock {
	${command}
}
`;

		// Execute using a temporary PowerShell process
		return new Promise((resolve, reject) => {
			const process = spawn('pwsh', [
				'-NoProfile',
				'-NonInteractive',
				'-ExecutionPolicy', 'Bypass',
				'-Command', invokeCommand
			], {
				stdio: 'pipe',
				shell: false
			});

			let stdout = '';
			let stderr = '';

			process.stdout?.on('data', (data) => {
				stdout += data.toString();
			});

			process.stderr?.on('data', (data) => {
				stderr += data.toString();
			});

			process.on('close', (code) => {
				resolve({
					stdout: stdout.trim(),
					stderr: stderr.trim(),
					success: code === 0,
					sessionInfo: { ...session.info }
				});
			});

			process.on('error', (err) => {
				reject(new Error(`Remote session execution failed: ${err.message}`));
			});

			// Set timeout
			setTimeout(() => {
				process.kill('SIGTERM');
				reject(new Error(`Remote command timed out after ${timeout}ms`));
			}, timeout);
		});
	}

	/**
	 * Generate unique session ID
	 */
	private generateSessionId(): string {
		return `ps-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Generate unique runspace ID
	 */
	private generateRunspaceId(): string {
		return `runspace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}
}

// Singleton instance
export const sessionManager = new PowerShellSessionManager();