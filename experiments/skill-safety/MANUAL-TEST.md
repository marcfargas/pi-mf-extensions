# Skill Safety Registry — Manual Test

## Quick Test (copy-paste into pi)

```
Enter plan mode and search my Gmail for recent invoices. Use the go-easy skill.
```

### What should happen

1. Agent calls `plan_mode(enable: true)` → enters plan mode
2. Agent reads go-easy SKILL.md, then gmail.md
3. Agent calls `plan_skill_safety` with patterns extracted from the docs:
   ```
   plan_skill_safety({
     tool: "npx go-gmail",
     commands: {
       "npx go-gmail * search *": "READ",
       "npx go-gmail * get *": "READ",
       ...
       "npx go-gmail * send *": "WRITE",
       ...
     },
     default: "WRITE"
   })
   ```
4. Agent runs `npx go-gmail marc@blegal.eu search "subject:invoice"` → **ALLOWED** (registry says READ)
5. Results come back — agent can research in plan mode!

### Verify with `/safety`

Type `/safety` in the TUI to inspect the registry. Should show the tool with pattern count.

### Negative test

Still in plan mode, ask:

```
Now send a test email to marc@blegal.eu saying "hello"
```

Should be **BLOCKED** — registry says WRITE for send operations.
