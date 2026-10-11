---
name: l2-build
description: Сборка новой версии L2wap Bot — поднять версию, CHANGELOG, CLAUDE.md, все проверки (тесты, node --check, геттеры, браузерные смоуки), zip без tests/.git/.claude, загрузка zip в Chromium, отправка игроку. Использовать, когда правки по логу/просьбе закончены или игрок пишет «сборка»/«собирай».
---

# Сборка L2wap Bot

Правило игрока (11.10, заменяет прежнее «сразу собрать»): закончили правки → **спросить, нужна ли сборка**; собирать только по команде («сборка»/«собирай»). Идёт разработка 9.0 — версию поднимать только при сборке. Посреди незаконченной работы не собирать. Стандартно — **только Chrome** (основная версия). Firefox (ПК/Android) — **только по явной просьбе игрока** («сборка фаерфокс модели ток по моему запросу»). Нумерация последовательная (8.0.3 → 8.0.4 → …). Если игрок торопится — собрать готовое, остальное вынести в следующую версию и честно сказать.

## Шаги
1. **Версия** (строка проверяется тестами!):
   - `manifest.json`: `version`, `version_name`, `description` («L2wap Bot X.Y.Z — суть»);
   - `content.js` строка 1 (`// ===== L2wap Bot vX.Y.Z — …`);
   - `tests/stage1.test.js`, `tests/stage3.test.js`, `tests/ios-fishing.test.js`, `tests/v71-ui.test.js`, `tests/v6-core.test.js`.
2. **CHANGELOG-X.Y.Z.md**: что было (с логом/временем) → что сделано; «Проверено / не проверено в живой игре».
3. **CLAUDE.md**: «Текущая версия», число PASS (2 места), строка в «Последние версии», «Известные ограничения/что дальше».
4. **Проверки** (все должны пройти):
   ```
   node tests/run-all.cjs                      # exit 0, все PASS
   for f in content.js background.js popup.js engine-core.js hook.js battle-cooldown.js ui-v7.js modules/*.js; do node --check $f; done
   node tests/tools/envcheck.cjs .             # все модули «ok» (геттеры env.X)
   grep -ci 'passw\|"auth"' base-profile.json  # 0
   tests/tools/smokes.sh                       # браузерные смоуки (battle-dom/mage-dom требуют снимков 09.10 из /mnt/data — без них не запускаются, так и написать)
   ```
5. **Zip**:
   ```
   rm -f l2wap-bot-vX.Y.Z.zip
   zip -qr l2wap-bot-vX.Y.Z.zip . -x 'tests/*' 'kb/*' '*.orig' '.git/*' '.claude/*' '*.zip' '__pycache__/*'
   unzip -l l2wap-bot-vX.Y.Z.zip | grep -c "tests/\|kb/\|\.git/\|\.claude/"   # 0
   ```
6. **Загрузка zip в Chromium**: распаковать во временную папку scratchpad и
   `NODE_PATH=$(npm root -g) node tests/tools/zipload.cjs <папка>` → версия, 0 ошибок консоли, ключевые значения cfg.
7. **Коммит и push** в рабочую ветку (тексты по-русски, подписи Co-Authored-By/Claude-Session из инструкций сессии, без id модели). Проверить, что дерево чистое.
8. **Отправить** zip игроку (SendUserFile, attach) с подписью: «Распакуй поверх в ту же папку и нажми ↻» (иначе Chrome сотрёт память бота).

## Ответ игроку
Коротко: главное в версии (простыми словами, с цифрами из логов), что проверено (PASS, смоуки, zip в Chromium), что НЕ проверено в живой игре, какой лог прислать дальше.

## Firefox (ПК и Android) — только по запросу игрока
- `node tests/tools/firefox-build.cjs <папка>` → `l2wap-bot-vX.Y.Z-firefox.zip` (фоновая страница, gecko id `l2wap-bot@local`, gecko + gecko_android 128+, без полей Chrome).
- Проверка: `npx web-ext lint -s <распакованная папка>` (0 ошибок); смоук в настоящем Firefox — скачать Firefox ESR (download.mozilla.org, product=firefox-esr-latest-ssl) и geckodriver (github mozilla/geckodriver), `npm i selenium-webdriver` в scratchpad, затем `FIREFOX=… GECKODRIVER=… NODE_PATH=… node tests/tools/firefox-smoke.cjs <zip>` и с `--android`.
- Новый вызов chrome.* в background/popup — проверить, есть ли он в Firefox для Android (нет: commands, notifications, значок action, captureVisibleTab) → `?.` и try.
