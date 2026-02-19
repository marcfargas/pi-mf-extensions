---
name: pi-powershell
description: >-
  PowerShell tools for Windows — background processes, system operations, remote management.
  Use when: starting background dev servers, managing Windows processes/services, killing by port,
  running .cmd/.bat files, any task where Git Bash hangs or lacks Windows integration.
  Triggers: background process, start server, Windows service, kill process, PowerShell, pwsh,
  batch file, .cmd, npm run dev in background, port in use, Get-Process, Stop-Process.
---

# PowerShell Tools

6 tools for Windows system operations and background processes. Complements the built-in `bash` tool.

## Tools

| Tool | Purpose |
|------|---------|
| `powershell` | Execute a PowerShell command. Process dies after execution, like `bash`. |
| `pwsh-start-job` | Start a background OS process (detached, persists across tool calls) |
| `pwsh-get-job` | Check job status by name, or list all tracked jobs |
| `pwsh-stop-job` | Stop a background job by name |
| `pwsh-remove-job` | Remove job tracking + clean up log files |
| `pwsh-get-job-output` | Read captured stdout/stderr from a job |

## When to Use PowerShell vs Bash

| Task | Tool | Why |
|------|------|-----|
| `ls`, `grep`, `find`, `git` | `bash` | Works fine in Git Bash |
| `npm install`, `npm test` | `bash` | Works fine in Git Bash |
| **Background dev servers** | `pwsh-start-job` | `&` hangs Git Bash |
| **Kill process by port** | `powershell` | Needs `Get-NetTCPConnection` |
| **Windows services** | `powershell` | Needs `Get-Service` / `Start-Service` |
| **Process management** | `powershell` | Needs `Get-Process` / `Stop-Process` |

## Common Patterns

### Background Dev Server

```
pwsh-start-job name="dev" command="npm run dev" workingDirectory="C:/dev/myapp"
```

Then check with `pwsh-get-job name="dev"`, read output with `pwsh-get-job-output name="dev"`, stop with `pwsh-stop-job name="dev"`.

### Kill by Port

```
powershell "Get-NetTCPConnection -LocalPort 5173 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
```

### Check Running Node Processes

```
powershell "Get-Process | Where-Object {$_.ProcessName -like '*node*'} | Select-Object Id, ProcessName, CPU"
```

## Quoting Rules

PowerShell quoting differs from bash:

- **Single quotes** `'text'` — literal string. Escape with `''` (double single-quote).
- **Double quotes** `"text"` — variable expansion. `$var` is interpolated.
- **Backtick** `` ` `` is the escape character, not backslash.
- **Env vars**: `$env:NODE_ENV` (not `$NODE_ENV`).

For detailed quoting patterns and gotchas, see [references/quoting.md](references/quoting.md).

## Background Jobs — Output Capture

By default, stdout and stderr are merged into one temp log file (PowerShell `*>` — all streams).
You can control this with `stdout` and `stderr` parameters on `pwsh-start-job`:

- `stdout`: file path, or `"null"` to discard. Default: temp file.
- `stderr`: file path, `"stdout"` to merge, or `"null"` to discard. Default: `"stdout"` (merged).

For full job lifecycle and advanced output options, see [references/background-processes.md](references/background-processes.md).

## Batch Files (.cmd / .bat)

`npm`, `yarn`, `pnpm` are `.cmd` batch files on Windows. The `powershell` tool auto-detects failures
and retries with `cmd /c`. You can also wrap explicitly:

```
powershell "cmd /c 'npm run build'"
```

The `pwsh-start-job` tool handles batch files automatically.

## PSSessions (Remote Management)

A **PSSession** is a persistent PowerShell connection to a remote Windows machine. Use it when you need to:

- Execute commands on a remote server (deploy, manage IIS, check services)
- Maintain state across multiple remote commands (imported modules, variables)
- Manage multiple remote machines in a workflow

PSSessions are **only for remote connections** — never use them as a local persistent shell
(that would break pi's `/tree` and `/fork` behavior).

Tools: `pwsh-create-session` (with `computerName` + credentials) and `pwsh-close-session`.

For setup, authentication options, and remote management patterns, see [references/psession.md](references/psession.md).
