# PSSessions — Remote PowerShell Management

A **PSSession** is a persistent PowerShell Remoting connection to a remote Windows machine.
It maintains a PowerShell runspace on the target — variables, imported modules, and functions
survive across multiple commands sent to that session.

## When to Use

- Execute commands on a remote Windows server
- Deploy to IIS, manage services, check event logs on a remote machine
- Multi-step remote workflows where state needs to persist (imported AD modules, variables)
- Manage a fleet of Windows servers from one agent session

## When NOT to Use

- **Local commands** — just use the `powershell` tool directly
- **Local state persistence** — never use PSSessions as a persistent local shell.
  Each `powershell` call should be stateless. Persistent local shells break pi's
  `/tree` and `/fork` behavior.

## Tools

| Tool | Purpose |
|------|---------|
| `pwsh-create-session` | Create a PSSession to a remote machine |
| `pwsh-close-session` | Close a PSSession and free remote resources |

Once created, pass `session="name"` to the `powershell` tool to run commands on the remote machine.

## Create a Remote Session

```
pwsh-create-session name="web01" computerName="web01.company.com" credential="DOMAIN\admin" authentication="Kerberos"
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Unique name to reference this session |
| `computerName` | Yes (for remote) | Hostname or IP of the remote machine |
| `credential` | No | Username for authentication (`DOMAIN\user`) |
| `authentication` | No | Method: `Default`, `Kerberos`, `Certificate`, `Basic`, `Negotiate` |
| `port` | No | Remote port (default: 5985 HTTP, 5986 HTTPS) |
| `useSSL` | No | Use HTTPS for the connection |
| `timeout` | No | Connection timeout in seconds (default: 30) |

## Use the Session

```
powershell command="Get-Service IIS*" session="web01"
powershell command="Restart-Service W3SVC -Force" session="web01"
powershell command="Get-EventLog -LogName Application -Newest 10" session="web01"
```

State persists across calls to the same session:

```
powershell command="Import-Module ActiveDirectory" session="web01"
powershell command="Get-ADUser -Filter {Department -eq 'Engineering'}" session="web01"
```

## Multi-Server Pattern

```
pwsh-create-session name="web01" computerName="web01.company.com" credential="DOMAIN\admin"
pwsh-create-session name="web02" computerName="web02.company.com" credential="DOMAIN\admin"

powershell command="Stop-Service W3SVC" session="web01"
powershell command="Stop-Service W3SVC" session="web02"

# ... deploy ...

powershell command="Start-Service W3SVC" session="web01"
powershell command="Start-Service W3SVC" session="web02"

pwsh-close-session name="web01"
pwsh-close-session name="web02"
```

## Prerequisites

Remote machines must have PowerShell Remoting enabled:

```powershell
# On the remote machine (as admin):
Enable-PSRemoting -Force
```

For cross-domain or workgroup scenarios, the remote machine may need to be added to TrustedHosts:

```powershell
Set-Item WSMan:\localhost\Client\TrustedHosts -Value "server.company.com"
```

## Cleanup

Always close sessions when done — they hold resources on the remote machine:

```
pwsh-close-session name="web01"
```

Sessions are also cleaned up automatically when the pi process exits.
