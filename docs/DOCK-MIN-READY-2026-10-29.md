# Встроенное меню: ранний postMessage, 29.10.2026

Исправление: [PR #455](https://github.com/vodoleyko1992-dotcom/prog/pull/455).

John прислал строку `w.postMessage({ __l2dock: 'min', min: dockShownMin }, origin)` и снимок Chrome20.78. Контекст — `/rebirth-raid-lair.html`, `content.js:4790 (dockMinPost)`. Текст предупреждения: `The target origin provided ('chrome-extension://…') does not match the recipient window’s origin ('https://l2wap.com')`.

Первый `dock()` отправлял состояние сразу после добавления iframe. Пока страница расширения не загрузилась, начальное окно iframe имело origin страницы игры. Chrome отклонял сообщение и записывал предупреждение браузера; исключение JavaScript при этом не выбрасывается, поэтому `try/catch` его не скрывает. Предупреждение воспроизведено в настоящем Chrome156 с исходным расширением; [baseline.json](evidence/dock-min-ready-20261029/baseline.json).

Теперь отправка ждёт сигнала готовности от текущего iframe. Готовность привязана к его WindowProxy; пульс старой или посторонней панели не разрешает отправку и не освежает сторожа. После замены iframe новое окно ждёт свой сигнал. Точный extension-origin сохранён. Это исправление встроенного меню; игровые действия и оплаты не менялись.

Новый Node-тест до правки:5PASS/12FAIL, после:17PASS/0FAIL. Связанный аудит:38PASS/0FAIL. Полный Node-набор:716 файлов PASS/0FAIL; syntax5/env35/bash/diff PASS. Настоящий Chrome156:2/2PASS — Desktop и Android UA/узкая раскладка; готовность, переключения, пересоздание, пульс3с и посторонний источник. Предупреждений postMessage и ошибок JavaScript0. Независимое ревью без блокеров.

Квитанции — [validation.json](evidence/dock-min-ready-20261029/validation.json), [browser.json](evidence/dock-min-ready-20261029/browser.json), [node-baseline.json](evidence/dock-min-ready-20261029/node-baseline.json). Все HTTPS на стенде обслуживались локально. Живую игру, настоящий Firefox/Android и полный исторический браузерный набор не запускали. Версия20.78 и ZIP прежние; исправление только в исходниках, следующая сборка — по отдельной просьбе.
