'use strict';
// 8.0.6 (игрок: «собери пакет под фаерфокс, чтобы и на андроидном фаерфоксе работало»): в Firefox для Android нет
// chrome.commands / notifications / значка / снимка экрана — фоновый скрипт не должен падать (раньше падал на commands,
// и обработчик сообщений — замок, запись памяти — не регистрировался); меню, открытое отдельной вкладкой, находит вкладку игры
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), os = require('node:os');
const { execFileSync } = require('node:child_process');
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
  const chrome = mkChrome(full);
  const sb = { chrome, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, URL,
    fetch: () => Promise.reject(new Error('offline')), indexedDB: undefined, self: {}, AbortController };
  sb.globalThis = sb;
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
  // 20.51: фоновая страница загружает движок до background.js; прежняя regex-проверка устарела.
  assert.match(read('tests/tools/firefox-build.cjs'), /background: \{ scripts: \['engine-core\.js', 'background\.js'\] \}/);
  assert.match(read('tests/tools/firefox-build.cjs'), /gecko_android: \{ strict_min_version: '128\.0' \}/);
  assert.match(read('tests/tools/firefox-build.cjs'), /delete ff\.minimum_chrome_version; delete ff\.version_name;/);
  console.log('PASS: Firefox package recipe — background page, gecko + gecko_android 128, no Chrome-only keys');
  // Проверяем manifest настоящего ZIP из чистой тестовой папки, не упаковывая рабочий checkout.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-firefox-recipe-'));
  let builtTemp = '';
  try {
    const fixture = path.join(temp, 'source'), out = path.join(temp, 'out'), toolDir = path.join(fixture, 'tests', 'tools');
    fs.mkdirSync(toolDir, { recursive: true }); fs.mkdirSync(out);
    const manifest = { manifest_version: 3, name: 'Firefox recipe fixture', version: '1.2.3', version_name: 'fixture',
      minimum_chrome_version: '116', permissions: ['storage'], host_permissions: ['https://example.invalid/*'],
      background: { service_worker: 'background.js' },
      content_scripts: [{ matches: ['https://example.invalid/*'], js: ['hook.js'], run_at: 'document_start', world: 'MAIN' }] };
    fs.writeFileSync(path.join(fixture, 'manifest.json'), JSON.stringify(manifest));
    for (const file of ['engine-core.js', 'background.js', 'hook.js']) fs.writeFileSync(path.join(fixture, file), '// fixture\n');
    const tool = path.join(toolDir, 'firefox-build.cjs'); fs.writeFileSync(tool, read('tests/tools/firefox-build.cjs'));
    const result = execFileSync(process.execPath, [tool, out], { encoding: 'utf8' }).trim().split('\n');
    builtTemp = path.dirname(result[1]);
    const zip = path.join(out, 'l2wap-bot-v1.2.3-firefox.zip');
    const packed = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
    assert.deepEqual(packed.background, { scripts: ['engine-core.js', 'background.js'] });
    assert.equal(packed.version, manifest.version);
    assert.deepEqual(packed.permissions, manifest.permissions);
    assert.deepEqual(packed.host_permissions, manifest.host_permissions);
    assert.deepEqual(packed.content_scripts, manifest.content_scripts);
    assert.equal('minimum_chrome_version' in packed, false); assert.equal('version_name' in packed, false);
    assert.equal(packed.browser_specific_settings.gecko.id, 'l2wap-bot@local');
    assert.equal(packed.browser_specific_settings.gecko.strict_min_version, '128.0');
    assert.equal(packed.browser_specific_settings.gecko_android.strict_min_version, '128.0');
    assert.deepEqual(packed.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
    assert.equal(result[0], zip);
    console.log('PASS: built Firefox ZIP preserves manifest fields and loads engine-core before background');
  } finally { if (builtTemp) fs.rmSync(builtTemp, { recursive: true, force: true }); fs.rmSync(temp, { recursive: true, force: true }); }
}).catch(error => { console.error(error); process.exitCode = 1; });
