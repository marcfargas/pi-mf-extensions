# @marcfargas/pi-powershell

[![npm](https://img.shields.io/npm/v/@marcfargas/pi-powershell)](https://www.npmjs.com/package/@marcfargas/pi-powershell)

PowerShell tools for [pi](https://github.com/mariozechner/pi-coding-agent) agents on Windows — background processes, system operations, and remote management.

## Problem

Windows Git Bash hangs when running background processes (`npm run dev &`), freezing the entire agent session. There's no reliable way to start a dev server, run tests, or manage processes in the background from a pi agent on Windows.

## Solution

A pi package bundling an **extension** (8 tools) and a **skill** (teaches agents when and how to use them).

| Tool | Purpose |
|------|---------|
| `powershell` | Execute PowerShell commands (stateless, like `bash`) |
| `pwsh-start-job` | Start background processes as real OS processes |
| `pwsh-get-job` | Check job status (by name or list all) |
| `pwsh-stop-job` | Stop a running job |
| `pwsh-remove-job` | Remove job and clean up log files |
| `pwsh-get-job-output` | Read captured stdout/stderr from a job |
| `pwsh-create-session` | Create PSSession to a remote machine |
| `pwsh-close-session` | Close a remote PSSession |

## Installation

```bash
pi install npm:@marcfargas/pi-powershell
```

The package registers both the extension (tools) and skill (agent documentation).

## Background Processes

The main reason this extension exists. Jobs are real OS processes (via `Start-Process -WindowStyle Hidden`), not PowerShell jobs — they persist across tool calls.

```javascript
await tools['pwsh-start-job']({
  name: 'dev-server',
  command: 'npm run dev',
  workingDirectory: 'C:/dev/myapp'
});

await tools['pwsh-get-job']({ name: 'dev-server' });
await tools['pwsh-get-job-output']({ name: 'dev-server' });

await tools['pwsh-stop-job']({ name: 'dev-server' });
await tools['pwsh-remove-job']({ name: 'dev-server' });
```

### Output Capture

By default, all PowerShell streams are merged into one temp log file (`*>`). Control with `stdout` and `stderr` params:

```javascript
// Separate files
await tools['pwsh-start-job']({ name: 's', command: 'npm run dev', stdout: 'C:/logs/out.log', stderr: 'C:/logs/err.log' });

// Discard stderr
await tools['pwsh-start-job']({ name: 's', command: 'npm run dev', stderr: 'null' });

// Fire and forget
await tools['pwsh-start-job']({ name: 's', command: 'npm run dev', stdout: 'null', stderr: 'null' });
```

## PowerShell Commands

Each `powershell` call spawns a fresh `pwsh` process that dies after execution — stateless, like `bash`.

- **UTF-8 output** — non-ASCII characters render correctly on any locale
- **Batch file auto-retry** — `.cmd`/`.bat` failures automatically retry with `cmd /c`
- **Output streaming** — partial output streams to the TUI as it arrives

## PSSessions (Remote Management)

PSSessions are persistent connections to **remote** Windows machines. They maintain state (variables, imported modules) across commands on the remote machine.

```javascript
await tools['pwsh-create-session']({
  name: 'prod', computerName: 'server.company.com',
  credential: 'domain\\admin', authentication: 'Kerberos'
});
await tools.powershell({ command: 'Get-Service IIS', session: 'prod' });
await tools['pwsh-close-session']({ name: 'prod' });
```

**Never** use PSSessions as a local persistent shell — breaks pi's `/tree` and `/fork` behavior.

## Design Decisions

- **OS processes, not PS jobs**: `Start-Job` dies when the `pwsh` process exits. `Start-Process -WindowStyle Hidden` creates real detached processes tracked by PID in extension memory.
- **`*>` redirection**: Merges all PowerShell streams into one file by default. See [about_Redirection](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection).
- **Extension + Skill**: Tools provide the capability; the bundled skill teaches agents when and how to use them (including advanced topics like PSSessions via progressive disclosure).
- **UTF-8 forced**: Every command prefixed with `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`.
- **Cross-instance safe**: Each pi instance gets a unique suffix on temp log files.

## Development

Part of [pi-mf-extensions](https://github.com/marcfargas/pi-mf-extensions).

```bash
npm test        # 50 tests
npm run typecheck
```

## License

MIT
