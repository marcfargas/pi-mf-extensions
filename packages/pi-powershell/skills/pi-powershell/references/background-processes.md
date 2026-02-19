# Background Processes

Jobs are real OS processes created via `Start-Process -WindowStyle Hidden`.
They persist across tool calls because PIDs are tracked in extension memory.

## Job Lifecycle

```
pwsh-start-job  →  creates detached OS process, tracks PID + log files
pwsh-get-job    →  checks if PID is alive via Get-Process
pwsh-stop-job   →  kills process via Stop-Process -Force
pwsh-remove-job →  removes tracking + deletes log files
```

## Output Capture Options

All output is captured via PowerShell stream redirection.

### Default: All Streams Merged

```
pwsh-start-job name="srv" command="npm run dev"
```

Uses `*>` — merges stdout, stderr, verbose, warning, debug, and info streams into one file.
This is usually what you want.

### Separate stdout and stderr

```
pwsh-start-job name="srv" command="npm run dev" stdout="C:/logs/out.log" stderr="C:/logs/err.log"
```

Uses `1>` for stdout and `2>` for stderr.

### Discard stderr

```
pwsh-start-job name="srv" command="npm run dev" stderr="null"
```

Stdout goes to temp file, stderr is discarded (`2>$null`).

### Fire and Forget

```
pwsh-start-job name="srv" command="npm run dev" stdout="null" stderr="null"
```

No output captured (`*>$null`). Use when you only care about the process running, not its output.

## Reading Output

```
pwsh-get-job-output name="srv"              # Last 100 lines, keeps output
pwsh-get-job-output name="srv" keep=false   # Read and clear the log
```

Or include output inline when checking status:

```
pwsh-get-job name="srv" includeOutput=true  # Status + last 50 lines
```

## Multiple Jobs

```
pwsh-get-job                                # List all tracked jobs with status
```

## Cleanup

Always clean up when done:

```
pwsh-stop-job name="srv"                    # Stop the process
pwsh-remove-job name="srv"                  # Remove tracking + log files
```

Or force-remove in one step:

```
pwsh-remove-job name="srv" force=true       # Stop + remove
```

## Cross-Instance Safety

Each pi instance gets a unique suffix on temp log files, so two pi instances
can both have a job named "dev" without log file collisions. However, job
names must be unique within a single pi instance.

## Bash-Style Env Var Conversion

The `pwsh-start-job` tool automatically converts bash-style environment variables:

```
NODE_ENV=production npm start
→ $env:NODE_ENV = 'production'; npm start
```

Only simple `VAR=value command` patterns are converted. For complex setups, use PowerShell syntax directly:

```
pwsh-start-job name="srv" command="$env:NODE_ENV = 'production'; $env:PORT = '3000'; npm start"
```
