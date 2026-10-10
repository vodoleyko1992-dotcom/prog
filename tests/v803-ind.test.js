'use strict';
// 8.0.3 (игрок 11.10: «бывает полоска с перемоткой, она раздражает, надо решить»; скрин: крупное окно-индикатор с полосой прокрутки)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = read('content.js');
const css = content.match(/uiCss\.textContent = `([^`]+)`/)[1];
assert.match(css, /#l2bot-ind\{[^}]*pointer-events:none/, 'the window is not clickable — a scrollbar there is useless');
assert.doesNotMatch(css, /overflow:(auto|scroll)/, 'no scrollbar in any layout');
assert.match(css, /#l2bot-ind\.wide\{[^}]*overflow:hidden;[^}]*display:flex;flex-direction:column\}/);
assert.match(css, /#l2bot-ind\.wide \.r\{flex:1 1 auto;min-height:0;overflow:hidden;[^}]*mask-image:linear-gradient/, 'history is clipped at the bottom with a fade (newest lines are on top)');
// значки Emoji 12+ на Windows игрока — пустые квадраты («▯ Изменение HP» на скрине)
const files = ['content.js', 'popup.js', 'popup.html', 'modules/combat.js'];
for (const f of files) {
  const visible = read(f).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(visible, /[\u{1FA70}-\u{1FAFF}\u{1F7E0}-\u{1F7EB}]/u, `${f}: no Emoji 12+ glyphs in visible text`);
}
assert.match(content, /L\.push\(`📉 Изменение HP /);
console.log('PASS: 8.0.3 indicator never shows a scrollbar (history clipped with a fade), no Emoji 12+ glyphs that render as empty boxes');
