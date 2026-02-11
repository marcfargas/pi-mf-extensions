---
"@marcfargas/pi-planner": minor
---

Initial release.

- Plan-then-execute workflow: agent proposes → human reviews → approves → executor runs
- 7 agent tools: `plan_mode`, `plan_propose`, `plan_list`, `plan_get`, `plan_approve`, `plan_reject`, `plan_skill_safety`
- **Skill safety registry (LLM-as-parser)**: agent reads skill docs, extracts safety annotations, reports command patterns via `plan_skill_safety`. READ operations allowed in plan mode, WRITE operations blocked. Zero skill author burden, zero hardcoded tool knowledge.
- Plan mode with graduated bash filtering: safe commands allowlisted, skill operations classified by registry, everything else blocked
- Plans stored as markdown files with YAML frontmatter — auditable, diffable, crash-safe
- Optimistic locking, atomic writes, stalled plan detection
- TUI commands: `/plan`, `/plans`, `/safety`
- Session state persistence across restarts
- 240 tests, TypeScript strict mode
