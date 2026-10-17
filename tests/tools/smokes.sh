#!/bin/bash
# 9.2: снимки страниц игры 12.10 (бой с Verfa, панель Warlock 61) — для смоуков боя по настоящему DOM; свои снимки — через L2_PAGES / L2_PAGES_MAGE
SNAP=/mnt/project-files/snapshots/l2wap-pages-2026-10-11-16-57.html; [ -f "$SNAP" ] && export L2_PAGES="${L2_PAGES:-$SNAP}" L2_PAGES_MAGE="${L2_PAGES_MAGE:-$SNAP}"
cd "$(dirname "$0")/../.."
# 10.0.17: Node24 fetch использует настроенный облачный прокси для публичных JS игры.
if [ -n "${HTTPS_PROXY:-${HTTP_PROXY:-}}" ]; then export NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}"; fi
# 14.10: среда Codex — пути из env.sh (tests/tools/codex-setup.sh), иначе ищем сами
for d in "$L2_TOOLS" "$HOME/.local/l2tools" /workspace/.local/l2tools; do [ -n "$d" ] && [ -f "$d/env.sh" ] && { . "$d/env.sh"; break; }; done
if [ -z "$PLAYWRIGHT_NODE" ] && [ ! -d /opt/node-tools/node_modules/playwright ]; then
  for p in "$L2_TOOLS/node/node_modules/playwright" "$HOME/.local/l2tools/node/node_modules/playwright" /workspace/.local/node-tools/node_modules/playwright "$(npm root -g 2>/dev/null)/playwright"; do [ -d "$p" ] && { export PLAYWRIGHT_NODE="$p"; break; }; done
fi
if [ -z "$CHROMIUM" ]; then
  if [ -x /opt/pw-browsers/chromium ]; then CHROMIUM=/opt/pw-browsers/chromium
  else CHROMIUM=$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)
    [ -z "$CHROMIUM" ] && CHROMIUM=$(command -v chromium || command -v chromium-browser || command -v google-chrome || true); fi
fi
export CHROMIUM; echo "CHROMIUM=$CHROMIUM PLAYWRIGHT_NODE=${PLAYWRIGHT_NODE:-/opt/node-tools/node_modules/playwright}"
FAIL=0; SKIP=0
LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/l2bot-smokes.XXXXXX")
echo "Полные журналы: $LOG_DIR"
run_smoke() {
  local file=$1; shift
  local log="$LOG_DIR/$(basename "$file").log"
  "$@" >"$log" 2>&1; local result=$?
  tail -4 "$log"
  echo "exit=$result log=$log"
  [ "$result" = 0 ] || FAIL=$((FAIL+1))
}
for t in tests/browser-smoke.py tests/v7-chromium-runtime.py tests/v715-ui-browser.py tests/v718-ui-browser.py tests/v719-fishing-toggle-browser.py tests/v715-mage-dom-browser.py tests/battle-dom-smoke.py; do
  case $t in *mage-dom*) need="$L2_PAGES_MAGE";; *battle-dom*) need="$L2_PAGES";; *) need=;; esac
  if [[ $t == *dom* ]] && [ ! -f "$need" ]; then echo "== $t: пропущен (нет снимка страниц игры, L2_PAGES)"; SKIP=$((SKIP+1)); continue; fi
  echo "== $t"; run_smoke "$t" timeout 300 python3 "$t"
done
for t in tests/v209-core-control-browser.cjs tests/v209-control-workspace-browser.cjs tests/v209-ui-controls-browser.cjs tests/v209-combat-contract-browser.cjs tests/v208-captcha-hold-browser.cjs tests/v208-tyrant-weapon-browser.cjs tests/v208-account-login-block-browser.cjs tests/v207-no-crafter-browser.cjs tests/v207-warlord-weapon-proof-browser.cjs tests/v206-raid-arrival-payment-browser.cjs tests/v206-enchant-quick-browser.cjs tests/v204-extension-update-browser.cjs tests/v206-warlord-two-pulls-browser.cjs tests/v206-task-switch-frame-browser.cjs tests/v205-warlord-provoke-browser.cjs tests/v204-dock-layout-browser.cjs tests/v204-fa-buff-receipt-browser.cjs tests/v204-fishing-shop-repaint-browser.cjs tests/v203-warlord-native-skills-browser.cjs tests/v202-farm-local-quests-browser.cjs tests/v202-enchant-diagnostics-browser.cjs tests/v202-enchant-user-flow-browser.cjs tests/v202-popup-task-selection-browser.cjs tests/v202-raid-fishing-browser.cjs tests/v101-fishing-cast-recovery-browser.cjs tests/v101-champion-all-pages-browser.cjs tests/v1029-quest-champion-browser.cjs tests/v1029-raid-live-targets-browser.cjs tests/v1028-buff-interruption-browser.cjs tests/v1028-probe-exit-navigation-browser.cjs tests/v1027-enchant-selected-task-browser.cjs tests/v1027-auto-task-policy-browser.cjs tests/v1027-auto-task-selection-browser.cjs tests/v1027-enchant-simple-ui-browser.cjs tests/v721-tree-browser.cjs tests/v803-epic-dom-browser.cjs tests/v807-tablet-browser.cjs tests/v90-mammon-browser.cjs tests/v90-catacombs-browser.cjs tests/v90-autofarm-browser.cjs tests/v90-story-browser.cjs tests/v92-fightlab-browser.cjs tests/v1027-polearm-damage-browser.cjs tests/v92-combat-menu-browser.cjs tests/v92-enemies-browser.cjs tests/v925-crafter-browser.cjs tests/v100-tvtshop-browser.cjs tests/v1002-antibot-browser.cjs tests/v1002-rbtimer-browser.cjs tests/v1002-crafter-note-browser.cjs tests/v1005-ind-fit-browser.cjs tests/v1006-rbrun-browser.cjs tests/v1009-mammon-visit-browser.cjs tests/v1014-combat-public-browser.cjs tests/v1014-core-character-browser.cjs tests/v1014-core-inventory-browser.cjs tests/v1014-core-lifecycle-browser.cjs tests/v1014-core-modes-browser.cjs tests/v1014-core-off-controls-browser.cjs tests/v1014-core-settings-browser.cjs tests/v1014-fishing-public-browser.cjs tests/v1027-fishing-payments-browser.cjs tests/v1027-enchant-native-balance-browser.cjs tests/v1015-magister-browser.cjs tests/v1015-magister-mv3-browser.cjs tests/v1025-magister-max-rank-browser.cjs tests/v1026-attack-deadline-browser.cjs tests/v1027-campaign-transition-browser.cjs tests/v1027-campaign-location-browser.cjs tests/v1027-daily-campaign-browser.cjs tests/v1027-resource-teleport-browser.cjs tests/v1016-enchant-public-browser.cjs tests/v1016-enchant-public-independent.cjs tests/v1015-pvp-mv3-browser.cjs tests/v1015-pvp-ui-browser.cjs tests/v1015-clan-caster-mv3-browser.cjs tests/v1015-warlock-mv3-browser.cjs tests/v1015-warlock-ui-browser.cjs tests/v1023-panther-ui-browser.cjs tests/v1024-journey-browser.cjs tests/v1024-raid-ashen-browser.cjs tests/v1024-raid-idle-refresh-browser.cjs tests/v1016-enchant-core-ui-browser.cjs tests/v1016-enchant-core-public-browser.cjs tests/v1016-enchant-core-recovery-browser.cjs tests/v1016-enchant-ui-analytics-browser.cjs tests/v1016-raid-tour-ui-browser.cjs tests/v1016-enchant-mode-browser.cjs; do
  limit=300; [[ $t == *v1024-journey* ]] && limit=900
  echo "== $t"; run_smoke "$t" timeout "$limit" node "$t"
done
# 8.0.6: пакет Firefox в настоящем Firefox (нужны FIREFOX, GECKODRIVER и selenium-webdriver в NODE_PATH; иначе пропуск)
if [ -n "$FIREFOX" ] && [ -n "$GECKODRIVER" ]; then
  ff=$(node tests/tools/firefox-build.cjs "${TMPDIR:-/tmp}" | head -1)
  for a in "" --android; do echo "== firefox-smoke $a"; timeout 300 node tests/tools/firefox-smoke.cjs "$ff" $a 2>&1 | tail -2; done
else echo "== firefox-smoke: пропущен (нет FIREFOX/GECKODRIVER)"; fi
echo "== итог: упало $FAIL, пропущено $SKIP"; [ "$FAIL" = 0 ]
