'use strict';
// Lite 1.2.1 (21.10, тред «Упрошенка под Дестра», John: «нет даже меню вызова, загрузка в фаерфокс ни к чему не приводит»):
// Firefox прятал кнопку Lite в меню «Расширения». Теперь кнопка закреплена на панели (сборка Firefox, lite-manifest.test.js),
// а язычок «Lite» на странице игры открывает меню во вкладке через фон: открытая вкладка меню не плодится.
// Lite 1.4 (John: «кнопка сворачивающая окно бота… как плавающая кнопка»): язычок заменён окном меню на странице игры,
// которое сворачивается в плавающую кнопку; «⧉» в его шапке открывает ту же вкладку меню.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));   // объекты из vm — другой realm
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

function bg() {
  let onMsg = null, nextId = 100;
  const tabs = new Map(), calls = [];
  const ev = () => ({ addListener() {} });
  const chrome = {
    runtime: { onMessage: { addListener: f => { onMsg = f; } }, onInstalled: ev(), onStartup: ev(), getURL: p => 'chrome-extension://lite/' + p },
    storage: { local: { get: async () => ({}) }, session: { get: async () => ({}), set: async () => {} }, onChanged: ev() },
    tabs: { onRemoved: ev(),
      get: async id => { if (!tabs.has(id)) throw new Error('No tab with id: ' + id); return tabs.get(id); },
      update: async (id, o) => { calls.push(['update', id, o]); return tabs.get(id); },
      create: async o => { const tab = { id: nextId++, ...o }; tabs.set(tab.id, tab); calls.push(['create', o]); return tab; } },
    alarms: { create() {}, onAlarm: ev() }, action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  };
  vm.runInNewContext(read('lite/background.js'), { chrome, console, setTimeout, clearTimeout, Promise, Date });
  const send = (m, sender) => new Promise(res => { const r = onMsg(m, sender, res); assert.equal(r, true, 'ответ асинхронный'); });
  return { send, tabs, calls };
}

(async () => {
  await t('«⧉» в окне (язычок 1.2.1): меню во вкладке рядом с игрой; повторно — показать ту же; закрыли — новая', async () => {
    const b = bg(), game = { tab: { id: 7, index: 2, windowId: 3, url: 'https://l2wap.com/map.html' }, url: 'https://l2wap.com/map.html' };
    assert.deepEqual(plain(await b.send({ cmd: 'menu' }, game)), { ok: true });
    assert.deepEqual(plain(b.calls[0]), ['create', { url: 'chrome-extension://lite/popup.html#tab', active: true, index: 3, windowId: 3 }]);
    await b.send({ cmd: 'menu' }, game);
    assert.deepEqual(plain(b.calls[1]), ['update', 100, { active: true }]);
    assert.equal(b.calls.filter(c => c[0] === 'create').length, 1);
    b.tabs.delete(100);
    await b.send({ cmd: 'menu' }, game);
    assert.equal(b.calls[2][0], 'create');
  });
  await t('окно на странице (1.4): свой shadow DOM, рисуется в каждом круге (и у вкладки не-хозяина), «—» сворачивает в кнопку', () => {
    const bot = read('lite/bot.js');
    assert.match(bot, /async function tick\(\) \{\n\s+dockPaint\(\);\n\s+if \(!ready \|\| dead\)/);
    assert.ok(!/pillPaint|l2lite-pill/.test(bot), 'язычок 1.2.1 заменён окном');
    assert.match(bot, /host\.id = 'l2lite-dock';/);
    assert.match(bot, /host\.attachShadow\(\{ mode: 'open' \}\)/);
    assert.match(bot, /fr\.src = chrome\.runtime\.getURL\('popup\.html#dock'\);/);
    assert.match(bot, /d\.fab\.textContent = on \? 'Lite ▶' : 'Lite';/);
    assert.match(bot, /chrome\.runtime\.sendMessage\(\{ cmd: 'menu' \}/);                      // «⧉» и подсказка — меню во вкладке
    assert.match(bot, /open: typeof m\.open === 'boolean' \? m\.open : vpW\(\) >= 900/);       // выбор игрока; телефон — свёрнуто
    assert.match(bot, /if \(dead\) \{ if \(dock\) dock\.host\.remove\(\); dock = null; return; \}/);
    // окно и кнопка — не кнопки и не ссылки: поиск бота по тексту ('a,button') их не находит
    const code = bot.slice(bot.indexOf('// ---------- окно Lite на странице игры (1.4)'), bot.indexOf('// ---------- главный цикл'));
    assert.ok(!/createElement\('(?:a|button)'\)|<(?:a|button)[\s>]/.test(code));
    // «готово» от меню принимается только от своего расширения; капча на экране — окно свёрнуто, выбор игрока не трогаем
    assert.match(code, /if \(e\.origin !== EXT_ORIGIN && !\/\^\(\?:chrome\|moz\)-extension:\\\/\\\/\/\.test\(String\(e\.origin\)\)\) return;/);
    assert.match(code, /d\.cap = !!abLayer\(\);/);
    assert.match(code, /const d = dock, m = dockMem\(\), open = d\.open && !d\.cap;/);
    assert.ok(!/dockSave\(\{[^}]*open[^}]*\}\)[^\n]*cap/.test(code));
  });
  await t('положение окна и кнопки: в пределах экрана, сохранённое поджимается', () => {
    const bot = read('lite/bot.js'), a = bot.indexOf('  const vpW = () =>'), b = bot.indexOf('  // Перетаскивание:');
    const box = { document: { documentElement: { clientWidth: 1280, clientHeight: 720 } }, innerWidth: 1280, innerHeight: 720, Math, Number };
    vm.createContext(box); vm.runInContext(bot.slice(a, b) + '\nthis.dockPos = dockPos;', box);
    const def = { x: 880, y: 8 };
    assert.deepEqual(plain(box.dockPos(undefined, 392, 640, def)), { x: 880, y: 8 });
    assert.deepEqual(plain(box.dockPos({ x: 100, y: 50 }, 392, 640, def)), { x: 100, y: 50 });
    assert.deepEqual(plain(box.dockPos({ x: 1200, y: 600 }, 392, 640, def)), { x: 888, y: 80 }, 'за правым/нижним краем');
    assert.deepEqual(plain(box.dockPos({ x: -50, y: -9 }, 64, 32, def)), { x: 0, y: 0 });
    assert.deepEqual(plain(box.dockPos({ x: 'x', y: null }, 64, 32, def)), { x: 880, y: 8 }, 'мусор в памяти — место по умолчанию');
    box.document.documentElement.clientWidth = 360;                       // окно уже экрана — прижато к левому краю
    assert.deepEqual(plain(box.dockPos({ x: 300, y: 8 }, 392, 640, def)), { x: 0, y: 8 });
  });
  await t('меню в окне: во всю ширину, сообщает странице «готово»', () => {
    const pj = read('lite/popup.js'), css = read('lite/popup.css');
    assert.match(pj, /if \(location\.hash === '#dock'\) \{ document\.documentElement\.classList\.add\('dock'\); try \{ parent\.postMessage\(\{ __l2liteDock: 'ready' \}, '\*'\); \} catch \(e\) \{\} \}/);
    assert.match(css, /html\.dock body \{ width: auto; \}/);
  });
  await t('меню во вкладке по центру', () => {
    assert.match(read('lite/popup.js'), /if \(location\.hash === '#tab'\) document\.documentElement\.classList\.add\('tab'\);/);
    assert.match(read('lite/popup.css'), /html\.tab body \{ margin: 0 auto; \}/);
  });
  console.log(`lite-menu: ${n} PASS`);
})().catch(e => { console.error(e); process.exit(1); });
