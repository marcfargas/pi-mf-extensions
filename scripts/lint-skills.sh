#!/usr/bin/env bash
# Validate all SKILL.md files using skills-ref
set -euo pipefail

FAILED=0
CHECKED=0

while IFS= read -r skill_md; do
  skill_dir=$(dirname "$skill_md")
  CHECKED=$((CHECKED + 1))
  echo "Validating: $skill_dir"
  if ! uvx --from "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref" skills-ref validate "$skill_dir"; then
    FAILED=$((FAILED + 1))
  fi
done < <(find packages -name SKILL.md -not -path '*/node_modules/*')

echo ""
echo "Checked $CHECKED skill(s), $FAILED failed."
[ "$FAILED" -eq 0 ]
