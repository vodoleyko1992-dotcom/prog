#!/bin/sh
# SessionStart: включает навык task-observer и передаёт Claude абсолютный путь его журнала.
# Основа — шаблон автора навыка (.claude/skills/task-observer/references/environments.md,
# «A session-start hook»); путь вычисляется от корня репозитория, потому что облачный клон
# каждый раз в новом месте. Журнал живёт в docs/skill-observations/ и сохраняется только
# коммитом в PR (облачная сессия одноразовая).
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
ws="$root/docs"
skill="$root/.claude/skills/task-observer"
d="$ws/skill-observations"
open=$(find "$d/observation-log" -maxdepth 1 -name '*.md' -exec grep -l '^status: open$' {} + 2>/dev/null | wc -l | tr -d ' ')
last=$(tr -d '\r' 2>/dev/null < "$d/last-review-date.txt"); last=${last:-never}
msg="Task-observer workspace (pinned absolute path): $ws ; skill directory: $skill . Make the first tool call of this session one batched call that both lists $d and invokes the task-observer skill; then run its Session Start Protocol. Observation files are created only by: bash \"$skill/scripts/new-observation.sh\" <slug> \"$ws\" — never by copying a header. The clone is ephemeral: observation files survive only if committed and merged with this session's PR."
if [ "${open:-0}" -gt 0 ]; then
  msg="$msg $open open observations; last review: $last."
  cutoff=$(date -d '7 days ago' +%F 2>/dev/null || date -v-7d +%F)
  case "$last" in
    (never) msg="$msg Offer the review." ;;
    (*) [ "$(printf '%s\n%s\n' "$last" "$cutoff" | sort | head -1)" = "$last" ] && msg="$msg Offer the review." ;;
  esac
fi
msg=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037')
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
