---
"@marcfargas/pi-powershell": major
---

Add PowerShell tool extension for Windows system integration

New `@marcfargas/pi-powershell` extension provides a PowerShell tool that solves Windows Git Bash limitations:

- **Background processes**: Use PowerShell jobs instead of hanging `&` operator
- **Process management**: Clean process control and cleanup  
- **Windows integration**: Native Windows services, registry, networking
- **System operations**: All Windows-specific tasks that cause Git Bash issues

The extension adds a single `powershell` tool that complements the existing `bash` tool - use Bash for familiar Unix operations, PowerShell for Windows system tasks.

Features:
- Proper error handling and output formatting
- Timeout support (default 30s)
- Output truncation for large results
- Background job management via PowerShell jobs
- Windows process and service control

This solves the daily pain point of frozen Git Bash sessions caused by background processes.