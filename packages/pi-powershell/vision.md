# pi-powershell — Vision

## Problem — What exists and why it's not good enough

**Current State**: AI agents on Windows face critical limitations when trying to execute commands:

1. **Git Bash Limitations**:
   - Background processes (`npm run dev &`) hang sessions completely
   - Orphaned processes require manual cleanup
   - Daily frozen sessions disrupting AI workflows
   - Poor Windows system integration

2. **Batch File Compatibility Issues**:
   - npm, yarn, pnpm are `.cmd` batch files, not executables
   - PowerShell can't execute them directly: "no es una aplicación Win32 válida"
   - Existing workarounds are unreliable and fragile

3. **PowerShell Quoting Hell**:
   - Different quoting rules than Bash: `'` → `''`, `\` → `` ` ``
   - Environment variables: `VAR=value` vs `$env:VAR = 'value';`
   - Commands like `R_SCOPE_TOKEN='' npm run dev` cause parser errors

4. **No State Persistence**:
   - Each PowerShell command runs in isolation
   - No way to maintain environment, loaded modules, or custom functions
   - Inefficient for complex workflows

5. **Manual Remote Management**:
   - No built-in support for remote Windows systems
   - Infrastructure management requires manual PSSession juggling

**Business Impact**: Windows-based AI agents are unreliable and require constant human intervention, limiting their utility for DevOps, deployment, and infrastructure management.

## Goal — What we're building and for whom

**Target Users**: AI agents running on Windows that need reliable command execution and Windows infrastructure management.

**Primary Goals**:
- **Eliminate session hangs** from background processes
- **Seamless batch file execution** without workarounds
- **Automatic PowerShell quoting** conversion from Bash syntax
- **Persistent PowerShell sessions** for stateful workflows
- **Remote Windows management** capabilities

**Success Metrics**:
- Zero session hangs from background npm processes
- 100% success rate for common batch file commands (npm, yarn, pnpm)
- Automatic handling of all common environment variable patterns
- Ability to manage remote Windows infrastructure through AI agents

## Current State — What exists

**pi-powershell v2.0**: A comprehensive PowerShell extension for pi agents with:

### Core Tools
- `powershell` - Execute PowerShell commands with error recovery
- `pwsh-run` - Pre-emptive batch file detection using Get-Command
- Background job management suite (`pwsh-start-job`, `pwsh-get-job`, etc.)

### Session Management System
- `pwsh-create-session` - Local and remote persistent sessions
- Complete session lifecycle management (list, test, close)
- State persistence across commands (variables, modules, functions)
- Remote authentication support (Kerberos, certificates)

### Smart Quoting System
- Automatic bash→PowerShell environment variable conversion
- `VAR=value command` → `$env:VAR = 'value'; command`
- Proper PowerShell quote escaping
- Multi-layer fallback strategy (try direct → wrap with cmd /c)

### Quality & Documentation
- **50 tests passing** across 4 test suites
- Comprehensive documentation (README, quoting guide, examples)
- Real-world usage patterns and troubleshooting

## Architecture / Design — How it should work

### 1. Extension Architecture
```typescript
pi-powershell/
├── src/
│   ├── session/
│   │   └── session-manager.ts     # Persistent session management
│   └── tools/
│       ├── powershell.ts          # Core PowerShell execution
│       ├── job-helpers.ts         # Background job management
│       └── session-tools.ts       # Session management tools
├── __tests__/                     # Comprehensive test coverage
├── docs/                          # PowerShell quoting guide
└── examples/                      # Real-world usage patterns
```

### 2. Command Execution Flow
```
User Command
    ↓
Batch Detection? → (Get-Command check) → Wrap with cmd /c
    ↓
PowerShell Quoting? → (Env var conversion) → $env:VAR = 'value';
    ↓
Session Specified? → (Execute in persistent session) → State preserved
    ↓
Error Recovery? → (Win32 error) → Retry with cmd /c
    ↓
Success ✅
```

### 3. Session Management Architecture
- **Local Sessions**: Persistent PowerShell processes with stdin/stdout piping
- **Remote Sessions**: PSSession management with authentication handling
- **State Persistence**: Variables, modules, functions maintained across commands
- **Lifecycle Management**: Create → Use → Monitor → Cleanup

### 4. Safety & Reliability
- **Multi-layer fallback**: Direct → Batch detection → Error recovery → cmd /c
- **Proper cleanup**: Automatic session cleanup on process exit
- **Error handling**: Comprehensive timeout and error recovery
- **Testing**: 50 tests covering all scenarios and edge cases

## Phases / Priority — What to build first

### ✅ Phase 1: Core Foundation (COMPLETE)
- Basic PowerShell tool with timeout support
- Background job management
- Error handling and output formatting

### ✅ Phase 2: Batch File Compatibility (COMPLETE)
- Smart batch detection using Get-Command
- Error recovery with cmd /c fallback
- Support for npm, yarn, pnpm commands

### ✅ Phase 3: PowerShell Quoting (COMPLETE)  
- Automatic bash→PowerShell environment variable conversion
- Proper quote escaping (', `, $)
- Real-world command pattern support

### ✅ Phase 4: Session Management (COMPLETE)
- Persistent local PowerShell sessions
- Session lifecycle management
- State persistence across commands

### ✅ Phase 5: Remote Management (COMPLETE)
- Remote PSSession support
- Authentication handling (Kerberos, certificates)
- Multi-server orchestration capabilities

### 🎯 Phase 6: Production Readiness (IN PROGRESS)
- Performance optimization
- Advanced error handling
- Production deployment patterns
- Enterprise integration

## Constraints — Tech stack, budget, timeline

### Technical Constraints
- **Windows Only**: PowerShell is Windows-specific (though pwsh exists on Linux)
- **Node.js Integration**: Must work within pi's Node.js extension system
- **TypeScript**: All code must be properly typed
- **pi Extension APIs**: Limited to pi's extension API capabilities

### Compatibility Requirements
- **PowerShell 7+**: Modern PowerShell features required
- **Windows 10/11**: Primary target platforms
- **Git Bash Coexistence**: Must work alongside existing bash tools

### Quality Standards
- **100% Test Coverage**: All core functionality must be tested
- **TypeScript Strict**: No any types, proper error handling
- **Documentation**: Comprehensive docs for all features
- **Examples**: Real-world usage patterns documented

## Risks — What could go wrong

### Technical Risks
1. **PowerShell Version Compatibility**: Different PowerShell versions have subtle differences
   - *Mitigation*: Test against PowerShell 7+ (latest stable)

2. **Remote Authentication Complexity**: Enterprise environments have complex auth requirements
   - *Mitigation*: Support multiple auth methods, clear error messages

3. **Session Resource Leaks**: Persistent sessions could consume memory/resources
   - *Mitigation*: Automatic cleanup, session monitoring, resource limits

4. **Command Injection**: Improper quoting could enable command injection
   - *Mitigation*: Strict input validation, proper escaping, security tests

### Adoption Risks
1. **Learning Curve**: Users familiar with bash might struggle with PowerShell concepts
   - *Mitigation*: Clear documentation, examples, automatic conversion

2. **Platform Lock-in**: Windows-specific solution reduces portability
   - *Mitigation*: Clear documentation of limitations, graceful degradation

3. **Performance Impact**: Session management adds overhead
   - *Mitigation*: Performance monitoring, optional features, lazy loading

## Open Questions — What we don't know

### Architecture Questions
1. **Session Persistence Strategy**: How long should sessions live? Memory vs reliability trade-offs?
2. **Concurrency Model**: How many parallel sessions? Resource limits?
3. **Error Recovery Sophistication**: How smart should the fallback logic be?

### Integration Questions  
1. **pi Extension Lifecycle**: How does session cleanup integrate with pi's lifecycle?
2. **Cross-Extension Communication**: Should other extensions be able to use our sessions?
3. **Configuration Management**: How should users configure authentication and preferences?

### Production Questions
1. **Enterprise Deployment**: How does this work in locked-down corporate environments?
2. **Monitoring & Observability**: What telemetry do we need for production usage?
3. **Security Audit**: What security review is needed for enterprise adoption?

### Future Evolution
1. **Linux PowerShell Support**: Should we support pwsh on Linux?
2. **Azure Integration**: Direct Azure PowerShell module integration?
3. **DSC Integration**: PowerShell Desired State Configuration support?
4. **Performance Optimization**: Native PowerShell host integration?

---

**Status**: v2.0 shipped with core functionality. Focus now on production readiness, performance, and enterprise adoption.