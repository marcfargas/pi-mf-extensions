# @marcfargas/pi-powershell

[![npm](https://img.shields.io/npm/v/@marcfargas/pi-powershell)](https://www.npmjs.com/package/@marcfargas/pi-powershell)

PowerShell tools for [pi](https://github.com/mariozechner/pi-coding-agent) agents on Windows — background processes, persistent sessions, and system integration.

## Problem

Windows Git Bash hangs when running background processes (`npm run dev &`), freezing the entire agent session. There's no reliable way to start a dev server, run tests, or manage processes in the background from a pi agent on Windows.

## Solution

8 tools that complement the built-in `bash` tool:

| Tool | Purpose |
|------|---------|
| `powershell` | Execute PowerShell commands (auto-retries batch files with `cmd /c`) |
| `pwsh-start-job` | Start background processes as real OS processes |
| `pwsh-get-job` | Check job status (by name or list all) |
| `pwsh-stop-job` | Stop a running job |
| `pwsh-remove-job` | Remove job and clean up log files |
| `pwsh-get-job-output` | Read captured stdout/stderr from a job |
| `pwsh-create-session` | Create persistent PowerShell session (state survives across calls) |
| `pwsh-close-session` | Close a persistent session |

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

## Background Processes

The main reason this extension exists. Jobs are real OS processes (via `Start-Process`), not PowerShell jobs — they persist across tool calls.

```javascript
// Start a dev server in the background
await tools['pwsh-start-job']({
  name: 'dev-server',
  command: 'npm run dev',
  workingDirectory: 'C:/dev/myapp'
});

// Check if it's running
await tools['pwsh-get-job']({ name: 'dev-server' });

// Read its output
await tools['pwsh-get-job-output']({ name: 'dev-server' });

// Clean up
await tools['pwsh-stop-job']({ name: 'dev-server' });
await tools['pwsh-remove-job']({ name: 'dev-server' });
```

### Output Capture

By default, stdout and stderr are merged into one temp log file (`*>` — all PowerShell streams). You can control this:

```javascript
// Default: merged to temp file
await tools['pwsh-start-job']({ name: 'srv', command: 'npm run dev' });

// Separate files
await tools['pwsh-start-job']({
  name: 'srv',
  command: 'npm run dev',
  stdout: 'C:/logs/out.log',
  stderr: 'C:/logs/err.log'
});

// Discard stderr
await tools['pwsh-start-job']({ name: 'srv', command: 'npm run dev', stderr: 'null' });

// Fire and forget (no output capture)
await tools['pwsh-start-job']({ name: 'srv', command: 'npm run dev', stdout: 'null', stderr: 'null' });
```

### Bash-Style Env Vars

Bash-style `VAR=value command` is auto-converted to PowerShell syntax:

```javascript
// This just works — converted to: $env:NODE_ENV = 'production'; npm start
await tools['pwsh-start-job']({ name: 'prod', command: 'NODE_ENV=production npm start' });
```

## PowerShell Commands

The `powershell` tool executes commands in a fresh `pwsh` process with:
- **UTF-8 output** — non-ASCII characters (accents, CJK) render correctly
- **Batch file auto-retry** — if a `.cmd`/`.bat` file fails, automatically retries with `cmd /c`
- **Output streaming** — partial output streams to the TUI as it arrives

```javascript
// Windows system operations
await tools.powershell('Get-Process | Where-Object {$_.ProcessName -like "*node*"}');
await tools.powershell('Get-Service docker*');
await tools.powershell('Get-NetTCPConnection -LocalPort 5173');

// Kill processes by port
await tools.powershell(`
  Get-NetTCPConnection -LocalPort 5173 | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force
  }
`);
```

### Quoting

PowerShell quoting is different from bash:
- Single quotes `'text'` — literal (escape with `''`)
- Double quotes `"text"` — variable expansion (`$var` is interpolated)
- Backtick `` ` `` is the escape character (not backslash)
- `$env:VAR` for environment variables (not `$VAR`)

## Persistent Sessions

Sessions keep a PowerShell process alive across tool calls — variables, imported modules, and custom functions persist. Local sessions are **auto-created on first use** — just pass `session`:

```javascript
// No setup needed — session 'dev' is created automatically
await tools.powershell({ command: '$x = 42', session: 'dev' });
await tools.powershell({ command: 'Write-Output $x', session: 'dev' }); // → 42

// Clean up when done
await tools['pwsh-close-session']({ name: 'dev' });
```

For **remote** sessions, use `pwsh-create-session` to specify connection details:

```javascript
await tools['pwsh-create-session']({
  name: 'prod',
  computerName: 'server.company.com',
  credential: 'domain\\admin',
  authentication: 'Kerberos'
});
await tools.powershell({ command: 'Get-Service IIS', session: 'prod' });
```

## When to Use What

| Task | Tool |
|------|------|
| File operations, git, npm | `bash` |
| Background dev servers | `pwsh-start-job` |
| Process/service management | `powershell` |
| Port checking, network diag | `powershell` |
| Stateful multi-step work | `powershell` + session |
| Remote server management | `powershell` + remote session |

## Design Decisions

- **OS processes, not PS jobs**: PowerShell jobs (`Start-Job`) die when the `pwsh` process exits. Since each `powershell` tool call is a fresh process, jobs would vanish between calls. `Start-Process -WindowStyle Hidden` creates real detached processes.
- **In-memory PID tracking**: Job name→PID map lives in extension memory (survives across tool calls within the same pi instance). Each pi instance gets a unique suffix on temp files to avoid cross-instance collisions.
- **`*>` redirection by default**: Merges all PowerShell streams (stdout, stderr, verbose, warning, debug, info) into one file. See [about_Redirection](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection).
- **Only 2 session tools**: `create` and `close`. Listing, testing, and inspecting sessions are just PowerShell commands the agent can run through the `powershell` tool.
- **UTF-8 forced**: Every command is prefixed with `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` to fix encoding on non-English Windows.

## Development

Part of [pi-mf-extensions](https://github.com/marcfargas/pi-mf-extensions).

```bash
npm test        # 50 tests
npm run typecheck
```

## License

MIT
