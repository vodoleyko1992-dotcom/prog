#!/bin/bash
# Установка среды для ChatGPT/Codex (облачная среда, поле «Setup script»): bash tools/codex-setup.sh
# Тестам нужны Node.js 20+ и Playwright с Chromium. Chromium качается с серверов Playwright:
# в сети среды нужен доступ к cdn.playwright.dev и playwright.download.prss.microsoft.com (или «All» на время установки).
set -e
node --version
npm install -g --no-audit --no-fund playwright
npx -y playwright install --with-deps chromium || npx -y playwright install chromium || echo "Chromium не скачался — проверь доступ к сети"
echo "export NODE_PATH=$(npm root -g)" >> ~/.bashrc
echo "Готово. Проверка: NODE_PATH=\$(npm root -g) node tests/run-all.js"
