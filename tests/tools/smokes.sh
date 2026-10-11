#!/bin/bash
cd "$(dirname "$0")/../.."
export CHROMIUM=/opt/pw-browsers/chromium
for t in tests/browser-smoke.py tests/v7-chromium-runtime.py tests/v715-ui-browser.py tests/v718-ui-browser.py tests/v719-fishing-toggle-browser.py tests/v715-mage-dom-browser.py tests/battle-dom-smoke.py; do
  echo "== $t"; timeout 300 python3 $t 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
done
for t in tests/v721-tree-browser.cjs tests/v803-epic-dom-browser.cjs tests/v807-tablet-browser.cjs tests/v90-catacombs-browser.cjs; do
  echo "== $t"; timeout 300 node $t 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
done
# 8.0.6: пакет Firefox в настоящем Firefox (нужны FIREFOX, GECKODRIVER и selenium-webdriver в NODE_PATH; иначе пропуск)
if [ -n "$FIREFOX" ] && [ -n "$GECKODRIVER" ]; then
  ff=$(node tests/tools/firefox-build.cjs "${TMPDIR:-/tmp}" | head -1)
  for a in "" --android; do echo "== firefox-smoke $a"; timeout 300 node tests/tools/firefox-smoke.cjs "$ff" $a 2>&1 | tail -2; done
else echo "== firefox-smoke: пропущен (нет FIREFOX/GECKODRIVER)"; fi
