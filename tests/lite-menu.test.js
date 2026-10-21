'use strict';
// Lite 1.2.1 (21.10, тред «Упрошенка под Дестра», John: «нет даже меню вызова, загрузка в фаерфокс ни к чему не приводит»):
// Firefox прятал кнопку Lite в меню «Расширения». Теперь кнопка закреплена на панели (сборка Firefox, lite-manifest.test.js),
// а язычок «Lite» на странице игры открывает меню во вкладке через фон: открытая вкладка меню не плодится.
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
  await t('язычок «Lite»: меню во вкладке рядом с игрой; повторно — показать ту же; закрыли — новая', async () => {
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
  await t('язычок на странице: свой div в shadow DOM, рисуется в каждом круге (и у вкладки не-хозяина), клик — команда фону', () => {
    const bot = read('lite/bot.js');
    assert.match(bot, /async function tick\(\) \{\n\s+pillPaint\(\);\n\s+if \(!ready \|\| dead\)/);
    assert.match(bot, /host\.id = 'l2lite-pill';/);
    assert.match(bot, /host\.attachShadow\(\{ mode: 'open' \}\)/);
    assert.match(bot, /chrome\.runtime\.sendMessage\(\{ cmd: 'menu' \}/);
    assert.match(bot, /pill\.el\.textContent = on \? 'Lite ▶' : 'Lite';/);
    // язычок — не кнопка и не ссылка: поиск бота по тексту ('a,button') его не находит
    const code = bot.slice(bot.indexOf('function pillPaint'), bot.indexOf('// ---------- главный цикл'));
    assert.ok(!/createElement\('(?:a|button)'\)|<(?:a|button)[\s>]/.test(code));
  });
  await t('меню во вкладке по центру', () => {
    assert.match(read('lite/popup.js'), /if \(location\.hash === '#tab'\) document\.documentElement\.classList\.add\('tab'\);/);
    assert.match(read('lite/popup.css'), /html\.tab body \{ margin: 0 auto; \}/);
  });
  console.log(`lite-menu: ${n} PASS`);
})().catch(e => { console.error(e); process.exit(1); });
