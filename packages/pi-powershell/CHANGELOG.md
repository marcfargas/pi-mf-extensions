# @marcfargas/pi-powershell

## 1.0.0

### Major Changes

- [`49e70d7`](https://github.com/marcfargas/pi-mf-extensions/commit/49e70d791d6ebda04e8318b45f3e18118d2a3a05) Thanks [@marcfargas](https://github.com/marcfargas)! - Add PowerShell tool extension for Windows system integration

  New `@marcfargas/pi-powershell` extension provides PowerShell tools that solve Windows Git Bash limitations:

  - **Background processes**: Use PowerShell jobs instead of hanging `&` operator
  - **Batch file support**: Smart detection and handling of npm/yarn/pnpm commands
  - **Process management**: Clean process control and cleanup
  - **Windows integration**: Native Windows services, registry, networking
  - **System operations**: All Windows-specific tasks that cause Git Bash issues

  The extension adds PowerShell tools that complement the existing `bash` tool - use Bash for familiar Unix operations, PowerShell for Windows system tasks.

  **Core Tools:**

  - `powershell` - Execute PowerShell commands with error recovery for batch files + session support
  - `pwsh-run` - Execute commands with pre-emptive batch file detection + session support
  - `pwsh-start-job` - Start background PowerShell jobs with batch file support
  - `pwsh-get-job`, `pwsh-stop-job`, etc. - Complete job management suite

  **Session Management Tools:**

  - `pwsh-create-session` - Create persistent local/remote PowerShell sessions
  - `pwsh-list-sessions` - List all active sessions with detailed status
  - `pwsh-get-session` - Get comprehensive session information
  - `pwsh-test-session` - Test session connectivity and health
  - `pwsh-close-session` - Close individual sessions with cleanup
  - `pwsh-close-all-sessions` - Clean up all active sessions

  **Smart Batch Handling:**

  - **Error Recovery**: Try command first, retry with `cmd /c` wrapper if Win32 error
  - **Pre-emptive Detection**: Use `Get-Command` to detect batch files before execution
  - **Background Jobs**: Automatic batch file handling in PowerShell jobs

  **Session Features:**

  - **State Persistence**: Variables, modules, functions maintained across commands
  - **Remote Management**: Connect to remote Windows systems with authentication
  - **Lifecycle Management**: Create, monitor, test, and cleanup sessions
  - **Event System**: Session lifecycle events for monitoring
  - **Auto-cleanup**: Automatic session cleanup on process exit

  **Core Features:**

  - Proper error handling and output formatting
  - Timeout support (default 30s)
  - Output truncation for large results
  - Comprehensive test coverage (31 tests passing)
  - No more workarounds needed for npm/yarn/pnpm commands

  **Use Cases:**

  - Windows infrastructure management and deployment
  - Development workflows with persistent PowerShell context
  - Multi-server orchestration and monitoring
  - Enterprise Windows administration with remote sessions

  This solves the daily pain point of frozen Git Bash sessions and enables powerful Windows infrastructure management through AI agents.
