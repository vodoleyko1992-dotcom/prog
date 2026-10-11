'use strict';
// 8.0.6 (игрок: «собери пакет под фаерфокс, чтобы и на андроидном фаерфоксе работало»): в Firefox для Android нет
// chrome.commands / notifications / значка / снимка экрана — фоновый скрипт не должен падать (раньше падал на commands,
// и обработчик сообщений — замок, запись памяти — не регистрировался); меню, открытое отдельной вкладкой, находит вкладку игры
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const ev = () => { const l = []; return { addListener: f => l.push(f), removeListener() {}, hasListener: () => false, l }; };
const asyncNoop = () => Promise.resolve(undefined);
const mkChrome = full => {
  const c = {
    runtime: { onMessage: ev(), onInstalled: ev(), onStartup: ev(), getManifest: () => ({ version: 'x' }), getURL: s => s, lastError: null },
    storage: { local: { get: () => Promise.resolve({}), set: asyncNoop, remove: asyncNoop }, onChanged: ev() },
    tabs: { query: () => Promise.resolve([]), get: asyncNoop, reload: asyncNoop, update: asyncNoop, sendMessage: asyncNoop, onRemoved: ev() },
    alarms: { get: asyncNoop, create: asyncNoop, onAlarm: ev() }, permissions: { contains: () => Promise.resolve(false) },
  };
  if (full) Object.assign(c, { commands: { onCommand: ev() }, notifications: { create() {}, clear() {} }, action: { setBadgeText: asyncNoop, setBadgeBackgroundColor: asyncNoop } });
  return c;
};
for (const full of [true, false]) {
  const chrome = mkChrome(full), rej = [];
  const sb = { chrome, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, URL,
    fetch: () => Promise.reject(new Error('offline')), indexedDB: undefined, self: {}, AbortController };
  sb.globalThis = sb;
  process.on('unhandledRejection', e => rej.push(String(e)));
  assert.doesNotThrow(() => vm.runInNewContext(read('background.js'), sb), `background.js top level (${full ? 'Chrome/desktop' : 'Android'})`);
  assert.ok(chrome.runtime.onMessage.l.length >= 1, `message handler registered (${full ? 'desktop' : 'Android'})`);
}
const bg = read('background.js');
assert.match(bg, /chrome\.commands\?\.onCommand\.addListener/, 'hotkeys only where they exist');
assert.doesNotMatch(bg.replace(/\/\/[^\n]*/g, ''), /chrome\.(notifications|action)\.\w+\(/, 'notifications/badge calls guarded');
assert.match(bg, /if \(!chrome\.tabs\.captureVisibleTab \|\|/);
console.log('PASS: background.js starts and registers the message handler without hotkeys/badge/notifications (Firefox for Android)');

// меню отдельной вкладкой: активная вкладка — само меню → берём вкладку игры
const pj = read('popup.js'), src = pj.slice(pj.indexOf('async function activeTab()'), pj.indexOf('}', pj.indexOf('return g.find(x => x.active)')) + 1);
const tabs = [{ id: 1, url: 'moz-extension://u/popup.html', active: true }, { id: 7, url: 'https://l2wap.com/battle.html', active: false }];
const ps = { chrome: { tabs: { query: q => Promise.resolve(q.url ? tabs.filter(t => /l2wap/.test(t.url)) : tabs.filter(t => t.active)) } } };
vm.runInNewContext(src + ';globalThis.activeTab = activeTab;', ps);
ps.activeTab().then(t => {
  assert.equal(t.id, 7, 'menu opened as a tab (Android) → game tab');
  tabs[0].active = false; tabs[1].active = true;
  return ps.activeTab();
}).then(t => {
  assert.equal(t.id, 7, 'dock inside the game tab → the game tab');
  console.log('PASS: menu opened as its own tab (Firefox for Android) talks to the game tab');
  // пакет Firefox: фоновая страница, Android-совместимость, без полей Chrome
  assert.match(read('tests/tools/firefox-build.cjs'), /background: \{ scripts: \['background\.js'\] \}/);
  assert.match(read('tests/tools/firefox-build.cjs'), /gecko_android: \{ strict_min_version: '128\.0' \}/);
  assert.match(read('tests/tools/firefox-build.cjs'), /delete ff\.minimum_chrome_version; delete ff\.version_name;/);
  console.log('PASS: Firefox package recipe — background page, gecko + gecko_android 128, no Chrome-only keys');
});
