'use strict';
// Lite 1.3 (21.10, тред «Упрошенка под Дестра», John: «это сборка под БХ, а нужна под дестра»): Lite читал панель того класса,
// что открыт в игре, и у героя с активным сабклассом Bounty Hunter показывал скиллы БХ. Теперь бот ведёт только Дестра/Титана
// (Orc Fighter → Orc Raider → Destroyer → Titan): другой класс — ждёт и ничего не жмёт, панель для меню — только у Дестра.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const L = require('../lite/logic.js');
const plain = x => JSON.parse(JSON.stringify(x));   // объекты из vm — другой realm

const SLOTS = act => ({ activeSlot: act, slots: [
  { slot: 0, owned: true, active: act === 0, profession: 'human_arcana_lord', race: 'Human', level: 78 },
  { slot: 1, owned: true, active: act === 1, profession: 'dwarf_bounty_hunter', race: 'Dwarf', level: 70 },
  { slot: 2, owned: true, active: act === 2, profession: 'orc_titan', race: 'Orc', level: 76 },
  { slot: 3, owned: false, active: false, profession: null, race: null, level: null }] });

test('ветка Дестра: Orc Fighter → Orc Raider → Destroyer → Titan; другие классы — нет', () => {
  for (const p of ['orc_fighter', 'orc_raider', 'orc_destroyer', 'orc_titan', 'Orc Titan', 'Destroyer', 'ORC_TITAN']) assert.equal(L.isDestr(p), true, p);
  for (const p of ['dwarf_bounty_hunter', 'dwarf_scavenger', 'human_arcana_lord', 'orc_monk', 'orc_tyrant', 'orc_grand_khavatari', 'orc_overlord',
    'human_warlord', 'fighter', '', null, undefined]) assert.equal(L.isDestr(p), false, String(p));
  assert.equal(L.profName('dwarf_bounty_hunter'), 'Dwarf Bounty Hunter');
  assert.equal(L.profName('orc_titan'), 'Orc Titan');
  assert.equal(L.profName(''), '');
});

test('класс героя: БХ активен, Титан в слоте 2 — подсказка, какой слот переключить', () => {
  const slots = SLOTS(1).slots.filter(s => s.owned).map(s => ({ slot: s.slot, prof: s.profession, lvl: s.level }));
  assert.deepEqual(L.heroClass('dwarf_bounty_hunter', slots, 1), { ok: false, name: 'Dwarf Bounty Hunter', alt: { slot: 2, name: 'Orc Titan', lvl: 76 } });
  assert.deepEqual(L.heroClass('orc_titan', slots, 2), { ok: true, name: 'Orc Titan', alt: null });
  assert.deepEqual(L.heroClass('human_arcana_lord', [], 0), { ok: false, name: 'Human Arcana Lord', alt: null }, 'другой герой без Дестра');
  assert.equal(L.heroClass('', null, null).ok, null, 'профессия не прочитана — не мешаем');
  assert.equal(L.slotRu(0), 'основной класс'); assert.equal(L.slotRu(2), 'сабкласс 2'); assert.equal(L.slotRu(null), 'класс');
});

test('hook: класс и занятые слоты героя из ответа игры (пустые слоты не передаём)', async () => {
  const posts = [];
  const fetch = async () => new Response(JSON.stringify({ character: { name: 'Dstr', level: 70, l2Profession: 'dwarf_bounty_hunter', classSlots: SLOTS(1) } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  const window = { fetch, postMessage: d => posts.push(d) };
  const box = { window, location: new URL('https://l2wap.com/map.html'), document: { documentElement: { dataset: {} } },
    XMLHttpRequest: function () {}, URL, Response, Headers, Date, console, Promise, JSON };
  box.XMLHttpRequest.prototype = { open() {}, send() {} };
  vm.createContext(box); vm.runInContext(read('lite/hook.js'), box);
  await window.fetch('/character');
  await new Promise(r => setTimeout(r, 5));
  const ch = plain(posts.find(x => x.__l2lite === 'end' && x.path === '/character').ch);
  assert.equal(ch.prof, 'dwarf_bounty_hunter'); assert.equal(ch.slot, 1);
  assert.deepEqual(ch.slots, [{ slot: 0, prof: 'human_arcana_lord', lvl: 78 }, { slot: 1, prof: 'dwarf_bounty_hunter', lvl: 70 }, { slot: 2, prof: 'orc_titan', lvl: 76 }]);
});

test('бот: другой класс проверяется до смерти/TvT/охоты; панель — только у Дестра; без данных героя — свой GET', () => {
  const bot = read('lite/bot.js');
  const tick = bot.slice(bot.indexOf('async function tick()'), bot.indexOf('async function loop()'));
  const at = s => { const i = tick.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('if (loginPage())') < at('const hc = heroCls();'));
  assert.ok(at('if (hc.ok === false) { clsWait(hc); progress(); await sleep(2000); return; }') < at('if (await deathStep(pg, g)) return;'));
  assert.ok(at("if (!hc) { status('Жду данные героя от игры'); progress(); await heroPull(); return; }") < at('if (await deathStep(pg, g)) return;'));
  assert.ok(at('if (await deathStep(pg, g)) return;') < at('if (TVT_ACT && await tvtStep(pg, g)) return;'));
  assert.match(bot, /if \(Array\.isArray\(ch\.bar\) && ch\.bar\.length && L\.heroClass\(ch\.prof\)\.ok !== false\) \{/);
  assert.match(bot, /setRt\(\{ bar, barCls: ch\.prof \|\| '' \}\)/);
  assert.match(bot, /function barFromDom\(\) \{\n\s+if \(!owner \|\| heroCls\(\)\?\.ok === false\) return;/);
  // свой GET /character тоже сообщает класс (страница без HUD, игра ещё не спрашивала героя)
  assert.match(bot, /if \(typeof c\.name === 'string'\) clsSet\(c\.name, c\.l2Profession, c\.classSlots\?\.activeSlot,/);
  // класс — из каждого ответа игры с героем, даже у вкладки не-хозяина (до проверки владельца)
  assert.match(bot, /SNAP = \{ \.\.\.ch, t: Date\.now\(\) \};\n\s+clsSet\(ch\.name, ch\.prof, ch\.slot, ch\.slots\);\n\s+if \(!owner\) return;/);
  // одна запись в журнал и одно уведомление на смену героя/класса; вернулся Дестр — «продолжаю»
  assert.match(bot, /if \(rt\.clsNote === sig\) return;/);
  assert.match(bot, /if \(rt\.clsNote\) \{ setRt\(\{ clsNote: '' \}\); log\(`активен \$\{hc\.name \|\| 'Дестр'\} \(\$\{CLS\.name\}\) — продолжаю`\); \}/);
});

test('меню: предупреждение о другом классе; панель БХ из памяти 1.2.1 не показывается', () => {
  const pj = read('lite/popup.js'), html = read('lite/popup.html');
  assert.match(html, /<div id="cls" class="warn" hidden><\/div>/);
  assert.match(pj, /w\.hidden = hc\?\.ok !== false;/);
  assert.match(pj, /const mine = L\.heroClass\(rt\.barCls \|\| rt\.char\?\.prof\)\.ok !== false;/);
  // память 1.2.1: панель без barCls у героя, последним виденного как БХ, — чужая; панель Титана при активном БХ — своя
  const mine = rt => L.heroClass(rt.barCls || rt.char?.prof).ok !== false;
  assert.equal(mine({ bar: [{ a: 'l2_254' }], char: { prof: 'dwarf_bounty_hunter' } }), false);
  assert.equal(mine({ bar: [{ a: 'l2_190' }], barCls: 'orc_titan', char: { prof: 'dwarf_bounty_hunter' } }), true);
  assert.equal(mine({ bar: [{ a: 'l2_190' }], barCls: '', char: { prof: '' } }), true);
});
