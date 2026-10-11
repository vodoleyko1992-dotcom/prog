'use strict';
// 8.0.5 (игрок: «перед кейматами сделай ресурсы … с картинками как в игре»): в «Фарм ресурсов» меню разделы в порядке игры
// (Ресурсы → Кейматы → Шмот с РБ → Прочее), у предмета — иконка игры; раскрытая игроком строка не стирает раздел/иконку
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const cjs = read('content.js'), pjs = read('popup.js');

// ---------- content.farmIconOf: иконка строки, без картинок мобов из раскрытых источников ----------
const fnSrc = cjs.slice(cjs.indexOf('function farmIconOf(row)'), cjs.indexOf('// 8.0.5: иконки без полного перечитывания'));
const sb = {}; vm.runInNewContext(fnSrc + ';globalThis.farmIconOf = farmIconOf;', sb);
const img = (src, inSrc) => ({ getAttribute: () => src, closest: () => inSrc ? {} : null });
const row = imgs => ({ querySelectorAll: () => imgs });
assert.equal(sb.farmIconOf(row([img('/icons/resources/basic/coal.jpg')])), '/icons/resources/basic/coal.jpg');
assert.equal(sb.farmIconOf(row([img('/mobs/orc.png', true), img('https://l2wap.com/icons/drops/earring_b/accessary_ring_of_mana_i00.png')])),
  '/icons/drops/earring_b/accessary_ring_of_mana_i00.png', 'absolute game URL → path; mob picture inside sources skipped');
assert.equal(sb.farmIconOf(row([img('/mobs/orc.png')])), '', 'mob pictures are not item icons');
assert.equal(sb.farmIconOf(row([img('https://evil.example/x.png'), img('javascript:alert(1)'), img('/icons/a b".png')])), '', 'only game paths');
assert.equal(sb.farmIconOf(row([img('/game/item-icon/1864')])), '/game/item-icon/1864');
assert.match(cjs, /return \{ name, n: [^\n]*bosses, icon: farmIconOf\(row\) \};/, 'farmRowParse keeps the icon');
assert.match(cjs, /db\.res\[k\] = \{ \.\.\.r, cat: r\.cat \|\| old\.cat \|\| '', icon: r\.icon \|\| old\.icon \|\| '', t: Date\.now\(\) \};/, 'row opened by the player keeps old category/icon');
assert.match(cjs, /if \(r\) \{ r\.cat = farmCatOf\(row\); farmSave\(\[r\]\)/, 'row opened by the player gets its category');
assert.match(cjs, /await farmIcons\(\)\.catch\(\(\) => \{\}\);\n  const done/, 'base scan picks icons of all visible rows first');
console.log('PASS: farm DB — game icon per row (no mob pictures, game paths only), category/icon not wiped by a player click');

// ---------- popup: порядок разделов и иконки ----------
const a = pjs.indexOf('const BASIC_RES'), b = pjs.indexOf('function treeSources');
const ps = {}; vm.runInNewContext(pjs.slice(a, b).replace(/^const (\w+) =/gm, 'globalThis.$1 =') + ';globalThis.treeKey = treeKey;', ps);
const top = ['Шмот с РБ', 'Прочее', 'Кейматы', 'Ресурсы', 'Квесты'].sort((x, y) => (ps.treeRank(x) - ps.treeRank(y)) || x.localeCompare(y));
assert.equal(JSON.stringify(top), JSON.stringify(['Ресурсы', 'Кейматы', 'Шмот с РБ', 'Квесты', 'Прочее']), 'game order, unknown groups before «Прочее»');
assert.match(pjs, /\.sort\(\(\[a\], \[b\]\) => \(path \? 0 : treeRank\(a\) - treeRank\(b\)\) \|\| a\.localeCompare\(b\)\)/, 'only top level reordered');
assert.equal(ps.treePath('farm', { name: 'Oriharukon Ore', cat: '' })[0], 'Ресурсы', 'basic resource without category → «Ресурсы»');
assert.equal(ps.treePath('farm', { name: 'Avadon', cat: '' })[0], 'Прочее');
assert.equal(ps.treeIcon('farm', { name: 'Animal Bone', cat: 'Ресурсы' }), 'https://l2wap.com/icons/resources/basic/animal_bone.jpg', 'basic resource fallback = battle-log icon path');
assert.equal(ps.treeIcon('farm', { name: 'Avadon', cat: 'Кейматы › 🛡️ Броня', icon: '/icons/drops/item/avadon.png' }), 'https://l2wap.com/icons/drops/item/avadon.png');
assert.equal(ps.treeIcon('farm', { name: 'Avadon', cat: 'Кейматы › 🛡️ Броня' }), '', 'no icon known → none');
assert.equal(ps.treeIcon('farm', { name: 'X', cat: 'Кейматы', icon: '"><script>' }), '', 'stored icon must be a game path');
assert.match(pjs, /box\.addEventListener\('error', e => \{[^\n]*fr-ico none/, 'missing picture → blank square (no broken image)');
assert.equal(JSON.parse(read('base-profile.json')).farmDb.res['oriharukon ore'].cat, 'Ресурсы', 'base profile: Oriharukon Ore in «Ресурсы»');
console.log('PASS: farm tree — «Ресурсы» first, then Кейматы/Шмот с РБ, «Прочее» last; game icons with basic-resource fallback, safe paths only');
