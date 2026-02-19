# PowerShell Quoting Rules for AI Agents

Understanding PowerShell quoting is crucial for reliable command execution. This guide explains the key differences from Bash and how pi-powershell handles them.

## The Problem

Bash-style commands often fail in PowerShell due to different quoting and syntax rules. For example:

```bash
# Bash (works in Git Bash)
NODE_ENV=production npm start

# PowerShell (fails with parser error)
NODE_ENV=production npm start
# ❌ ParserError: Unexpected token 'npm' in expression or statement
```

## Environment Variables

### Bash vs PowerShell Syntax

| Operation | Bash | PowerShell |
|-----------|------|------------|
| Set variable | `VAR=value` | `$env:VAR = 'value'` |
| Use variable | `$VAR` | `$env:VAR` |
| Inline assignment | `VAR=value command` | `$env:VAR = 'value'; command` |

### Examples

```bash
# Bash
NODE_ENV=development npm run dev
API_KEY="secret-123" npm start
R_SCOPE_TOKEN='' npm run build
```

```powershell
# PowerShell equivalent
$env:NODE_ENV = 'development'; npm run dev
$env:API_KEY = 'secret-123'; npm start
$env:R_SCOPE_TOKEN = ''; npm run build
```

## String Quoting

### Single Quotes (Literal Strings)

Both Bash and PowerShell treat single quotes as literal strings:

```bash
# Both Bash and PowerShell
echo 'Hello $USER'  # Output: Hello $USER (literal)
```

**Escaping single quotes:**
```bash
# Bash
echo 'It'\''s working'

# PowerShell  
echo 'It''s working'  # Double the single quote
```

### Double Quotes (Variable Expansion)

Both allow variable expansion, but with different syntax:

```bash
# Bash
echo "Hello $USER"

# PowerShell
echo "Hello $env:USER"
```

## Escape Characters

| Shell | Escape Character | Example |
|-------|------------------|---------|
| Bash | `\` (backslash) | `echo \$PATH` |
| PowerShell | `` ` `` (backtick) | ``echo `$PATH`` |

## How pi-powershell Handles This

The extension automatically converts common Bash patterns to PowerShell syntax:

### 1. Environment Variable Conversion

```javascript
// Your command (Bash-style)
await tools['pwsh-start-job']({
  name: 'dev-server',
  command: 'NODE_ENV=development npm run dev'
});

// Automatically converted to PowerShell
// $env:NODE_ENV = 'development'; npm run dev
```

### 2. Quote Escaping

```javascript
// Your command with quotes
await tools.powershell({
  command: "echo 'It's working'"
});

// Automatically escaped for PowerShell
// echo 'It''s working'
```

### 3. Fallback to cmd /c

If PowerShell syntax conversion fails, the extension falls back to `cmd /c`:

```javascript
// Complex bash command
await tools['pwsh-start-job']({
  command: 'CUSTOM_VAR=value && npm run complex-script'
});

// Falls back to: cmd /c "CUSTOM_VAR=value && npm run complex-script"
```

## Supported Patterns

### ✅ Automatically Converted

```bash
# Environment variables at command start
NODE_ENV=production npm start
API_KEY='secret' npm test
DATABASE_URL="postgresql://..." npm run migrate

# Simple quotes and escapes
echo 'hello world'
echo "hello $env:USER"
```

### ✅ Handled via Fallback

```bash
# Complex bash constructs
VAR1=a VAR2=b npm start
export NODE_ENV=prod && npm run build
npm start > output.log 2>&1
```

### ⚠️ Might Need Manual Conversion

```bash
# Complex piping and redirects
npm run test | grep "passing"
npm start && npm run build || npm run fallback
```

## Best Practices for AI Agents

### 1. Prefer PowerShell-native Commands

```javascript
// Good - PowerShell native
await tools.powershell({
  command: '$env:NODE_ENV = "production"; npm start'
});

// Less reliable - Bash-style (relies on conversion)
await tools.powershell({
  command: 'NODE_ENV=production npm start'
});
```

### 2. Use Sessions for Complex Environments

```javascript
// Create session with environment
await tools['pwsh-create-session']({ name: 'dev' });

await tools.powershell({
  command: '$env:NODE_ENV = "development"; $env:API_KEY = "secret-123"',
  session: 'dev'
});

// Now all commands in this session have the environment
await tools.powershell({
  command: 'npm start',
  session: 'dev'
});
```

### 3. Test Complex Commands

```javascript
// For complex commands, test first
await tools['pwsh-test-session']({ name: 'dev' });

await tools.powershell({
  command: 'Write-Output "Testing: NODE_ENV is $env:NODE_ENV"',
  session: 'dev'
});
```

## Common Issues and Solutions

### Issue: Parser Error with Environment Variables

```
❌ ParserError: Line 6: R_SCOPE_TOKEN=''
```

**Solution:** The command contains bash-style environment variable assignment. The extension now automatically converts these, but if you see this error with older versions:

```javascript
// Instead of
'R_SCOPE_TOKEN=\'\' npm run dev'

// Use PowerShell syntax
'$env:R_SCOPE_TOKEN = \'\'; npm run dev'
```

### Issue: Quote Escaping Problems

```
❌ ParserError: Unterminated string literal
```

**Solution:** PowerShell uses different quote escaping. Single quotes inside single quotes must be doubled:

```javascript
// Instead of
'echo \'hello\''

// Use
'echo ''hello'''
```

### Issue: Complex Bash Commands Failing

```
❌ Multiple environment variables or complex syntax
```

**Solution:** Use cmd /c fallback for complex bash commands:

```javascript
await tools.powershell({
  command: 'cmd /c "VAR1=a VAR2=b npm run complex-script"'
});
```

## Testing Your Commands

Use the PowerShell REPL to test commands before using in jobs:

```powershell
# Test environment variable syntax
PS> $env:NODE_ENV = 'test'; Write-Output "NODE_ENV is $env:NODE_ENV"

# Test quote escaping
PS> echo 'It''s working'

# Test complex commands
PS> $env:API_KEY = 'secret'; npm --version
```

## Summary

PowerShell quoting differs significantly from Bash:

1. **Environment variables**: Use `$env:VAR = 'value';` not `VAR=value`
2. **Quote escaping**: Double single quotes (`''`) instead of backslash (`\'`)
3. **Escape character**: Backtick (`` ` ``) instead of backslash (`\`)

The pi-powershell extension handles most common cases automatically, but understanding these rules helps when debugging complex command issues.