#!/bin/bash
# 14.10: установка среды для ChatGPT/Codex (облачная среда, скрипт установки).
# Ставит то, что нужно для проверок: Node-тесты работают без установки,
# для браузерных смоуков — Playwright (Node и Python) и Chromium по путям, которые ждут смоуки:
#   /opt/node-tools/node_modules/playwright  и  /opt/pw-browsers/chromium
set -e
SUDO=; [ "$(id -u)" != 0 ] && command -v sudo >/dev/null && SUDO=sudo
node --version
$SUDO mkdir -p /opt/node-tools /opt/pw-browsers && $SUDO chown -R "$(id -u)" /opt/node-tools /opt/pw-browsers
npm --prefix /opt/node-tools install --no-audit --no-fund playwright
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers $SUDO -E /opt/node-tools/node_modules/.bin/playwright install --with-deps chromium
bin=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)
[ -n "$bin" ] && ln -sf "$bin" /opt/pw-browsers/chromium
python3 -m pip install -q playwright || echo "pip playwright не встал — Python-смоуки будут пропущены"
echo "Готово: node tests/run-all.cjs; смоуки: bash tests/tools/smokes.sh"
