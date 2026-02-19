# PowerShell Quoting

PowerShell quoting is fundamentally different from bash. Getting it wrong is the #1 source of errors.

## Single Quotes (Literal)

Everything inside is literal — no expansion, no escaping:

```powershell
'Hello $world'        # → Hello $world (literal dollar sign)
'It''s here'          # → It's here (escape single quote by doubling)
```

## Double Quotes (Expanding)

Variables and subexpressions are expanded:

```powershell
"Hello $name"         # → Hello John
"Path: $($env:TEMP)"  # → Path: C:\Users\marc\AppData\Local\Temp
"Count: $(2+2)"       # → Count: 4
```

## Backtick Escape (not backslash)

```powershell
"Line1`nLine2"        # Newline
"Tab`there"           # Tab
"Literal `$dollar"    # Escape dollar sign in double quotes
```

## Common Gotchas

### Nested Quotes

When passing strings through multiple layers (e.g., Start-Process arguments):

```powershell
# BAD — inner quotes break
Start-Process pwsh -ArgumentList "-Command Write-Output 'hello'"

# GOOD — use escaped quotes or argument arrays
Start-Process pwsh -ArgumentList '-Command', "Write-Output 'hello'"
```

### Where-Object with Wildcards

```powershell
# GOOD — single quotes, no expansion needed
Get-Process | Where-Object {$_.ProcessName -like '*node*'}

# BAD — double quotes would try to expand $_ outside the block
```

### Paths with Spaces

```powershell
Set-Location 'C:\Program Files\nodejs'    # Single quotes — safe
Set-Location "C:\Program Files\nodejs"    # Double quotes — also works (no vars)
```

### Bash-Style Env Vars

The `pwsh-start-job` tool auto-converts bash syntax:

```
NODE_ENV=production npm start
→ $env:NODE_ENV = 'production'; npm start
```

But in the `powershell` tool, use PowerShell syntax directly:

```powershell
$env:NODE_ENV = 'production'; npm start
```

### Dollar Signs in Strings

```powershell
# Literal dollar sign — use single quotes
'Price: $42'

# Or escape in double quotes
"Price: `$42"
```

## Filter Patterns

```powershell
# -like uses * and ? wildcards (not regex)
Where-Object {$_.Name -like '*test*'}

# -match uses regex
Where-Object {$_.Name -match '^test\d+$'}

# -eq is exact match
Where-Object {$_.Status -eq 'Running'}
```
