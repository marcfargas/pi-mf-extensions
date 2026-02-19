# @marcfargas/pi-powershell

[![npm](https://img.shields.io/npm/v/@marcfargas/pi-powershell)](https://www.npmjs.com/package/@marcfargas/pi-powershell)

PowerShell tool for pi agents — Windows system integration, background processes, and persistent session management.

## Problem Solved

Windows Git Bash has significant limitations when used by AI agents:
- **Session hangs** with background processes (`npm run dev &`)
- **Orphaned processes** that require manual cleanup
- **Poor Windows integration** for system operations
- **Daily frozen sessions** requiring manual process termination

## Solution

This extension adds a `powershell` tool that complements the existing `bash` tool:
- **Bash**: For familiar Unix operations (`ls`, `grep`, `git`, `npm`)
- **PowerShell**: For Windows system operations and background processes

## Installation

```bash
npm install @marcfargas/pi-powershell
```

```json
{
  "pi": {
    "extensions": ["@marcfargas/pi-powershell"]
  }
}
```

## Usage

### Background Processes

Instead of hanging Git Bash with `&`, use PowerShell jobs:

```javascript
// ❌ This hangs Git Bash sessions
await tools.bash("npm run dev &");

// ✅ Using job helpers (recommended) - batch commands handled automatically
await tools['pwsh-start-job']({
    name: 'dev-server',
    command: 'npm run dev'
});

// ✅ Using general PowerShell tool - batch commands wrapped automatically
await tools.powershell(`
$job = Start-Job -Name 'dev-server' -ScriptBlock { 
    Set-Location '${process.cwd()}'
    npm run dev
}
Get-Job -Name 'dev-server'
`);
```

### Synchronous Commands with Batch File Support

For non-background commands that need reliable batch file handling:

```javascript
// ✅ Smart batch detection (checks with Get-Command first)
await tools['pwsh-run']({ command: 'npm --version' });

// ✅ Error recovery (tries command, retries with cmd /c if Win32 error)
await tools.powershell({ command: 'npm install' });
```

**Batch Command Handling**: The extension automatically detects and properly wraps batch commands using two strategies:
- **Error Recovery** (`powershell` tool): Try command first, wrap with `cmd /c` if Win32 error occurs
- **Pre-emptive Detection** (`pwsh-run` tool): Use `Get-Command` to detect batch files before execution

### Persistent PowerShell Sessions

Create persistent sessions that maintain state (variables, modules, functions) across multiple commands:

```javascript
// Create a local persistent session
await tools['pwsh-create-session']({ name: 'mywork' });

// Commands run in the same PowerShell process - state persists
await tools.powershell({ command: '$project = "MyApp"', session: 'mywork' });
await tools.powershell({ command: 'Set-Location "C:\\Projects\\$project"', session: 'mywork' });
await tools.powershell({ command: 'Get-Location', session: 'mywork' }); 
// Output: C:\Projects\MyApp

// Import modules once, use everywhere
await tools.powershell({ command: 'Import-Module ActiveDirectory', session: 'mywork' });
await tools.powershell({ command: 'Get-ADUser -Filter "Name -like \'John*\'"', session: 'mywork' });
```

### Remote PowerShell Management

Manage remote Windows systems with persistent remote sessions:

```javascript
// Create remote session to production server
await tools['pwsh-create-session']({
    name: 'prod-web01',
    computerName: 'web01.company.com',
    credential: 'domain\\admin',
    authentication: 'Kerberos'
});

// Execute commands on remote server
await tools.powershell({ 
    command: 'Get-Service IIS', 
    session: 'prod-web01' 
});

await tools.powershell({ 
    command: 'Restart-Service IIS -Force', 
    session: 'prod-web01' 
});

// Check multiple servers
const servers = ['web01', 'web02', 'db01'];
for (const server of servers) {
    await tools['pwsh-create-session']({
        name: server,
        computerName: `${server}.company.com`,
        credential: 'domain\\admin'
    });
    
    await tools.powershell({ 
        command: 'Get-Process | Measure-Object WorkingSet -Sum', 
        session: server 
    });
}
```

### Process Management

Clean up processes without manual intervention:

```javascript
// Kill specific processes
await tools.powershell(`
Get-Process | Where-Object {$_.ProcessName -like '*node*'} | Stop-Process -Force
`);

// Check process status
await tools.powershell(`
Get-Process | Where-Object {$_.ProcessName -eq 'node'} | Select-Object Id, ProcessName, CPU
`);
```

### Windows Services

Manage Windows services natively:

```javascript
// Check service status
await tools.powershell(`
Get-Service | Where-Object {$_.Name -like '*docker*'}
`);

// Start/stop services
await tools.powershell(`
Start-Service -Name 'Docker Desktop Service'
`);
```

### Job Management

**Using Job Helpers:**
```javascript
// List all jobs
await tools['pwsh-get-job']();

// Get specific job info and output
await tools['pwsh-get-job']({ name: 'dev-server', includeOutput: true });

// Stop and remove jobs
await tools['pwsh-stop-job']({ name: 'dev-server' });
await tools['pwsh-remove-job']({ name: 'dev-server' });
```

**Using General PowerShell Tool:**
```javascript
// List all jobs
await tools.powershell("Get-Job");

// Get specific job output
await tools.powershell("Receive-Job -Name 'dev-server' -Keep");

// Stop and remove jobs
await tools.powershell(`
Stop-Job -Name 'dev-server'
Remove-Job -Name 'dev-server'
`);
```

### Network Operations

Windows-specific networking tasks:

```javascript
// Test connections
await tools.powershell(`
Test-NetConnection -ComputerName 'google.com' -Port 443
`);

// Find processes using specific ports
await tools.powershell(`
Get-NetTCPConnection -LocalPort 5173 | ForEach-Object { 
    Get-Process -Id $_.OwningProcess | Select-Object Id, ProcessName 
}
`);
```

## API Reference

### Tool: `powershell`

Execute PowerShell commands with error recovery for batch files.

**Parameters:**
- `command` (string): PowerShell command or script to execute
- `timeout` (number, optional): Timeout in seconds (default: 30)
- `session` (string, optional): PowerShell session name to execute in (maintains state across commands)

**Returns:**
- `content`: Command output (stdout + stderr, truncated if large)
- `details.exitCode`: Process exit code
- `details.success`: Boolean indicating success/failure
- `details.command`: The executed command
- `details.session`: Session name (if used)
- `details.sessionInfo`: Session information (if used)

**Batch File Handling**: Uses try-first-then-wrap strategy. Executes command as-is, then retries with `cmd /c` wrapper if Win32 application error occurs.

### Tool: `pwsh-run`

Execute commands with pre-emptive batch file detection using Get-Command.

**Parameters:**
- `command` (string): Command to execute with smart batch file wrapping
- `timeout` (number, optional): Timeout in seconds (default: 30)
- `session` (string, optional): PowerShell session name to execute in (maintains state across commands)

**Returns:**
- `content`: Command output (stdout + stderr, truncated if large)
- `details.exitCode`: Process exit code
- `details.success`: Boolean indicating success/failure
- `details.command`: The executed command
- `details.session`: Session name (if used)
- `details.sessionInfo`: Session information (if used)

**Batch File Handling**: Uses `Get-Command` to detect if the command is a batch file (CommandType: ExternalScript) and pre-emptively wraps with `cmd /c` if needed.

### Job Management Helpers

Simplified tools for PowerShell background job management.

#### Tool: `pwsh-start-job`

Start a PowerShell background job.

**Parameters:**
- `name` (string): Unique name for the job
- `command` (string): Command to run in the background job
- `workingDirectory` (string, optional): Working directory for the job

#### Tool: `pwsh-get-job`

Get status and information about PowerShell background jobs.

**Parameters:**
- `name` (string, optional): Job name to get info for (omit to list all jobs)
- `includeOutput` (boolean, optional): Include job output in response

#### Tool: `pwsh-stop-job`

Stop a running PowerShell background job.

**Parameters:**
- `name` (string): Name of the job to stop

#### Tool: `pwsh-remove-job`

Remove a PowerShell background job (cleanup).

**Parameters:**
- `name` (string): Name of the job to remove
- `force` (boolean, optional): Force removal even if job is running

#### Tool: `pwsh-get-job-output`

Get output from a PowerShell background job.

**Parameters:**
- `name` (string): Name of the job to get output from
- `keep` (boolean, optional): Keep output for future calls (default: true)

### Session Management Tools

Persistent PowerShell sessions for state management and remote execution.

#### Tool: `pwsh-create-session`

Create a new persistent PowerShell session.

**Parameters:**
- `name` (string): Unique name for the session
- `computerName` (string, optional): Remote computer name (omit for local session)
- `credential` (string, optional): Username for remote authentication (e.g., 'domain\\user')
- `authentication` (string, optional): Authentication method (Default, Kerberos, Certificate, Basic, Negotiate)
- `port` (number, optional): Remote port (default: 5985 for HTTP, 5986 for HTTPS)
- `useSSL` (boolean, optional): Use SSL/HTTPS for remote connection
- `timeout` (number, optional): Connection timeout in seconds (default: 30)

#### Tool: `pwsh-list-sessions`

List all active PowerShell sessions.

**Parameters:**
- `verbose` (boolean, optional): Include detailed session information (default: false)

#### Tool: `pwsh-get-session`

Get detailed information about a specific PowerShell session.

**Parameters:**
- `name` (string): Name of the session to inspect

#### Tool: `pwsh-test-session`

Test connectivity and functionality of a PowerShell session.

**Parameters:**
- `name` (string): Name of the session to test

#### Tool: `pwsh-close-session`

Close a PowerShell session and clean up its resources.

**Parameters:**
- `name` (string): Name of the session to close

#### Tool: `pwsh-close-all-sessions`

Close all active PowerShell sessions and clean up resources.

**Parameters:** None

## Platform Detection

This extension automatically detects the platform:
- **Windows host**: Tool is available and recommended for system operations
- **Devcontainers**: Tool is available but may have limited functionality
- **Non-Windows**: Tool registers but may not function

## Best Practices

### When to Use PowerShell vs Bash

| Task | Tool | Reason |
|------|------|---------|
| File operations (`ls`, `grep`, `find`) | `bash` | Familiar Unix syntax |
| Git operations | `bash` | Git Bash optimized |
| npm/node operations | `bash` | Works fine in Git Bash |
| **Background servers** | `powershell` | Prevents session hangs |
| **Process management** | `powershell` | Native Windows integration |
| **System services** | `powershell` | Windows service control |
| **Network diagnostics** | `powershell` | Windows networking tools |

### Session Management Patterns

**Development Workflow with Local Sessions:**
```javascript
// Create a development session
await tools['pwsh-create-session']({ name: 'dev' });

// Set up environment once
await tools.powershell({ 
    command: `
        $env:NODE_ENV = 'development'
        Set-Location 'C:\\Projects\\MyApp'
        Import-Module powershell-yaml
    `, 
    session: 'dev' 
});

// Use throughout development
await tools.powershell({ command: 'npm test', session: 'dev' });
await tools.powershell({ command: 'npm run build', session: 'dev' });
await tools.powershell({ command: 'Get-ChildItem dist', session: 'dev' });

// Clean up when done
await tools['pwsh-close-session']({ name: 'dev' });
```

**Infrastructure Management with Remote Sessions:**
```javascript
// Set up remote management sessions
const servers = [
    { name: 'web01', host: 'web01.company.com' },
    { name: 'web02', host: 'web02.company.com' },
    { name: 'db01', host: 'db01.company.com' }
];

for (const server of servers) {
    await tools['pwsh-create-session']({
        name: server.name,
        computerName: server.host,
        credential: 'domain\\admin',
        authentication: 'Kerberos'
    });
}

// Deploy to all web servers
for (const server of ['web01', 'web02']) {
    await tools.powershell({
        command: 'Stop-Service IIS',
        session: server
    });
    
    await tools.powershell({
        command: 'Copy-Item "\\\\deploy\\app\\*" "C:\\inetpub\\wwwroot\\" -Recurse -Force',
        session: server
    });
    
    await tools.powershell({
        command: 'Start-Service IIS',
        session: server
    });
}

// Check database server
await tools.powershell({
    command: 'Get-Service MSSQLSERVER | Format-Table Name, Status, StartType',
    session: 'db01'
});

// Clean up all sessions
await tools['pwsh-close-all-sessions']();
```

**Session State Persistence:**
```javascript
// Create session and import modules
await tools['pwsh-create-session']({ name: 'analysis' });

await tools.powershell({
    command: 'Import-Module ActiveDirectory, ExchangeOnlineManagement',
    session: 'analysis'
});

// Define custom functions that persist
await tools.powershell({
    command: `
        function Get-UserReport {
            param($Department)
            Get-ADUser -Filter "Department -eq '$Department'" | 
                Select-Object Name, EmailAddress, LastLogonDate
        }
    `,
    session: 'analysis'
});

// Use throughout the session
await tools.powershell({
    command: 'Get-UserReport -Department "Engineering"',
    session: 'analysis'
});

await tools.powershell({
    command: 'Get-UserReport -Department "Marketing"',
    session: 'analysis'
});
```

### Background Process Pattern

**Using Job Helper Tools (Recommended):**
```javascript
// Start a background service
await tools['pwsh-start-job']({
    name: 'my-service',
    command: 'npm run dev',
    workingDirectory: process.cwd()
});

// Later: check status
await tools['pwsh-get-job']({ name: 'my-service' });

// Later: get output
await tools['pwsh-get-job-output']({ name: 'my-service', keep: true });

// When done: cleanup
await tools['pwsh-stop-job']({ name: 'my-service' });
await tools['pwsh-remove-job']({ name: 'my-service' });
```

**Using General PowerShell Tool:**
```javascript
// Start a background service
await tools.powershell(`
$job = Start-Job -Name 'my-service' -ScriptBlock { 
    Set-Location '${process.cwd()}'
    npm run dev
}
"Started job: $($job.Name) (ID: $($job.Id))"
`);

// Later: check status and get output
await tools.powershell("Get-Job -Name 'my-service'; Receive-Job -Name 'my-service' -Keep");
```

## Integration with Other Extensions

This tool works alongside other pi extensions:
- **pi-planner**: PowerShell operations can be planned and audited
- **permission-gate**: PowerShell commands can be gated by safety rules

## Troubleshooting

### PowerShell Not Found
```
Failed to start PowerShell: spawn pwsh ENOENT
```
Install PowerShell 7+: [Installation Guide](https://docs.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows)

### Batch Command Errors (Fixed)
```
Start-Process: This command cannot be run due to the error: %1 no es una aplicación Win32 válida
```
This error occurred with npm/yarn commands because they're batch files, not executables. **Fixed in v2.0+**: The extension now automatically wraps batch commands with `cmd /c`.

### Job Management Issues (Fixed)
```
Job 'my-job' not found or error
```
Previous versions had race conditions in job creation. **Fixed in v2.0+**: Added proper timing and retry logic for job registration.

### Execution Policy Errors
This extension uses `-ExecutionPolicy Bypass` to avoid policy restrictions, but system policies may still interfere. To check:

```powershell
Get-ExecutionPolicy -List
```

### Permission Errors
Some operations require elevated permissions. The agent will report these as regular errors — the user can run the pi agent as Administrator if needed.

## Development

This package is part of the [pi-mf-extensions](https://github.com/marcfargas/pi-mf-extensions) monorepo.

```bash
# Run tests
npm test

# Typecheck
npm run typecheck
```

## License

MIT