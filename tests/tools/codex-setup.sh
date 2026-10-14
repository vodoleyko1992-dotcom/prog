#!/bin/bash
# 14.10: установка среды для ChatGPT/Codex (облачная среда, скрипт установки).
# Node-тестам установка не нужна. Для браузерных смоуков — Playwright (Node и Python) и Chromium.
# Всё ставится в папку пользователя (без /opt и sudo): $L2_TOOLS (по умолчанию ~/.local/l2tools).
# Пути пишутся в $L2_TOOLS/env.sh — его подхватывает tests/tools/smokes.sh.
# Chromium качается с серверов Playwright: в сети среды нужен доступ к
# cdn.playwright.dev, playwright.download.prss.microsoft.com, playwright.azureedge.net (или «All» на время установки).
set -e
T="${L2_TOOLS:-$HOME/.local/l2tools}"; mkdir -p "$T/node" "$T/browsers"
node --version
npm --prefix "$T/node" install --no-audit --no-fund playwright
PLAYWRIGHT_BROWSERS_PATH="$T/browsers" "$T/node/node_modules/.bin/playwright" install chromium
bin=$(ls -d "$T"/browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)
[ -n "$bin" ] || { echo "Chromium не скачался — проверь доступ к сети (см. начало скрипта)"; exit 1; }
python3 -c 'import playwright' 2>/dev/null || python3 -m pip install -q playwright || echo "Python Playwright не встал — Python-смоуки будут пропущены"
printf 'export PLAYWRIGHT_NODE=%q\nexport CHROMIUM=%q\n' "$T/node/node_modules/playwright" "$bin" > "$T/env.sh"
echo "Готово ($T/env.sh). Проверка: node tests/run-all.cjs; смоуки: bash tests/tools/smokes.sh"
echo "Если Chromium не запускается (нет системных библиотек): $T/node/node_modules/.bin/playwright install-deps chromium — нужен root."
