#!/usr/bin/env bash
# SessionStart: вводная Superpowers (obra/superpowers v7.0.1, MIT, .claude/superpowers/LICENSE).
# Перенос hooks/session-start плагина: облачные сессии не ставят плагины из enabledPlugins,
# поэтому навыки лежат в .claude/skills/, а этот хук подаёт using-superpowers в контекст.
set -euo pipefail
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
skill_md="$root/.claude/skills/using-superpowers/SKILL.md"
if [ -r "$skill_md" ]; then
  content="$(<"$skill_md")"
else
  content="Error reading using-superpowers skill"
fi
esc() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\r'/\\r}"; s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}
note="In this repository Superpowers is installed as project skills: a reference to superpowers:<name> means the project skill <name> (for example superpowers:brainstorming is the skill brainstorming). Project instructions in CLAUDE.md and AGENTS.md take precedence over these skills."
ctx="<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n$(esc "$note")\n\n**Below is the full content of your 'superpowers:using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n$(esc "$content")\n</EXTREMELY_IMPORTANT>"
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$ctx"
