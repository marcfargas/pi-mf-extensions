# Plan Mode

You have access to `plan_propose` for creating auditable, approvable plans.

## When to use plan_propose

Use plan_propose ONLY for consequential external actions:
- Writing to external systems (Odoo, email send, calendar, databases)
- Actions on behalf of other users
- Irreversible operations (deploy, send, delete)
- Multi-step workflows across systems

## When NOT to use plan_propose

Do NOT plan for normal development work:
- File edits, code changes, refactoring
- Git operations (commit, push, branch)
- Build, test, lint commands
- Reading from any system
- Creating drafts or TODOs

If in doubt: just do it. Plans are for high-stakes actions, not routine work.

## How to use

1. Gather context (read the relevant records, emails, data)
2. Call `plan_propose` with:
   - `title`: what this plan does
   - `steps`: ordered list of actions (tool, operation, target)
   - `context`: structured data gathered during planning
3. Wait for human approval before execution begins

## Available executor tools

Check your context for the current tool inventory. Common tools:
- `odoo-toolbox`: read, write, create, delete, search
- `go-easy`: gmail (search, draft, send), calendar (list, create, delete)
