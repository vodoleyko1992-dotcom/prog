'use strict';
// 20.77 (ревизия 28.10, группа r2-bg): фон background.js.
// 1) Импорт настроек терял флаги разовых миграций (cfgImportClean отбрасывал их как «неизвестные ключи»): cfg@Ник, созданный импортом
//    (Firefox после перезапуска, новая папка Chrome), был без флагов, и при входе героя все once() из content.js заново ложились поверх
//    импортированных значений — pvpAll2054 добавлял 'pvp' и enemyHunt, actionDelay2059 возвращал 500 мс, champAuto1005, zone7128… Теперь
//    меню отделяет флаги (значение 1, имя на цифру/«Mig», не настройка) и шлёт их списком, фон ставит только недостающие.
//    Цепочка целиком: пустое хранилище → applyBaseProfile → настоящий обработчик файла меню → cfgImport фона → switchCharacter → блок once.
// 2) Команда 'alert' (капча, блок PvE, автовход, нехватка для крафта) всегда передавала requireInteraction — Firefox отвергает это поле
//    даже со значением false, ошибку глотал catch, уведомления не было. Теперь через общий notify (поле только у sticky, повтор без него).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const bgSrc = read('background.js'), content = read('content.js'), popup = read('popup.js'), clone = x => x === undefined ? undefined : structuredClone(x);
const D = require(path.join(root, 'defaults.js')), EC = require(path.join(root, 'engine-core.js'));
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const ev = () => { const l = []; return { addListener: f => l.push(f), removeListener() {}, hasListener: () => false, l }; };
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, 'нет фрагмента ' + a); return src.slice(i, j); };

// Фон целиком в vm (как tests/v2043-notify-stop.test.js); notifications: chrome | firefox (отказ синхронно) | firefoxAsync (отказ промисом)
function load(initial = {}, opts = {}) {
  const state = clone(initial), notes = [], badges = [];
  const local = {
    get: async keys => { const ks = keys == null ? Object.keys(state) : Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (Object.hasOwn(state, k)) o[k] = clone(state[k]); return o; },
    set: async patch => { Object.assign(state, clone(patch)); },
    remove: async keys => { for (const k of [].concat(keys)) delete state[k]; },
  };
  const session = {}, storage = { local, onChanged: ev(), session: { get: async k => (Object.hasOwn(session, k) ? { [k]: clone(session[k]) } : {}), set: async p => { Object.assign(session, clone(p)); } } };
  const ff = opts.browser === 'firefox' || opts.browser === 'firefoxAsync', bad = o => 'requireInteraction' in o;
  const chrome = {
    runtime: { id: 'test', onMessage: ev(), onInstalled: ev(), onStartup: ev(), getManifest: () => ({ version: 'x' }), getURL: p => 'chrome-extension://test/' + p, lastError: null },
    storage,
    tabs: { query: async () => [], get: async id => ({ id, url: 'https://l2wap.com/map.html' }), reload: async () => {}, update: async () => {}, sendMessage: async () => {}, onRemoved: ev() },
    alarms: { get: async () => ({ name: 'l2watch' }), create: async () => {}, onAlarm: ev() }, permissions: { contains: async () => false },
    commands: { onCommand: ev() },
    notifications: {
      create(id, o) {
        if (ff && bad(o)) { const e = new Error('Type error for parameter options (Unexpected property "requireInteraction") for notifications.create.'); if (opts.browser === 'firefox') throw e; return Promise.reject(e); }
        notes.push({ id, ...o }); return Promise.resolve(id);
      }, clear: async () => true },
    action: { setBadgeText: async o => { badges.push(o.text); }, setBadgeBackgroundColor: async () => {} },
  };
  const base = read('base-profile.json');
  const fetch = async url => String(url).endsWith('base-profile.json') ? { ok: true, status: 200, json: async () => JSON.parse(base) } : { ok: false, status: 503, headers: { get: () => 'text/html' } };
  const unref = t => (t?.unref?.(), t);
  const sb = { chrome, console: { log() {}, warn() {}, error() {} }, setTimeout: (...a) => unref(setTimeout(...a)), clearTimeout, setInterval: (...a) => unref(setInterval(...a)), clearInterval, setImmediate, Date, Math, JSON, Promise, URL,
    structuredClone, fetch, indexedDB: undefined, self: {}, AbortController, crypto: { randomUUID: () => 'uuid' }, L2EngineCore: EC };
  sb.globalThis = sb;
  vm.createContext(sb); vm.runInContext(bgSrc, sb);
  const [onMessage] = chrome.runtime.onMessage.l;
  const send = (m, sender) => new Promise(res => { if (onMessage(m, sender, res) !== true) tick().then(() => res(undefined)); });
  return { state, notes, badges, send, ctx: sb, ST: EC.hotStore(() => local), popup: { id: 'test', url: 'chrome-extension://test/popup.html' },
    game: { id: 'test', frameId: 0, url: 'https://l2wap.com/map.html', tab: { id: 1 } } };
}

// ---------- 1) импорт настроек и флаги once ----------
const FLAGS = [...new Set([...content.matchAll(/once\('([A-Za-z0-9_]+)'/g)].map(x => x[1]))];
// Настоящий обработчик выбора файла меню (popup.js) — работает и со старым кодом (без cfgImportMsg), поэтому тест ловит сам дефект
function popupImport(f, file) {
  const els = {}, $ = id => (els[id] ||= { textContent: '', hidden: true, click() {} });
  const sb = { DEF: D.CFG, Object, JSON, Number, Array, Date, Error, $, toast: () => {}, load: () => {},
    chrome: { storage: { local: { get: async k => f.ST.get(k) } }, runtime: { sendMessage: m => { sb.sent = clone(m); return f.send(clone(m), f.popup); } } } };
  vm.createContext(sb);
  vm.runInContext(slice(popup, 'const CFG_IMPORT_EXTRA', "$('cfgImport').onclick") + slice(popup, "$('cfgFile').onchange", '\n// 8.0.3 (эпики, ревью)'), sb);
  return els.cfgFile.onchange({ target: { value: 'x', files: [{ text: async () => JSON.stringify(file) }] } }).then(() => ({ note: els.cfgNote.textContent, sent: sb.sent }));
}
// Блок разовых миграций content.js (от «const cf = {}, rf = {}» до записи cf) над cfg/rt из хранилища — как при загрузке страницы
function onceBlock(cfg0, rt0) {
  const block = slice(content, '  const cf = {}, rf = {};\n  if (rt.engineRecoveryEpoch', '  if (Object.keys(cf).length) {\n    cfg = withRb(');
  const ctx = { rt: { ...rt0 }, cfg: { ...D.CFG, ...EC.rawTaskConfig(cfg0) }, L2EngineCore: EC, DAILY_KILL_DEF: D.DAILY_KILL_DEF, DAILY_FISH_DEF: D.DAILY_FISH_DEF, DAILY_RANGE: D.DAILY_RANGE,
    names: s => String(s || '').split(',').map(x => x.trim()).filter(Boolean), isChargeName: () => false, isForceName: () => false,
    pair: (v, d) => String(v || d).split('/').map(Number), rec() {}, pavelFix() {}, L2V7Modules: {}, console, setTimeout: () => 0 };
  const P = new Proxy(ctx, { has: (t, k) => k in t || !(k in globalThis), get: (t, k) => k in t ? t[k] : (k === Symbol.unscopables ? undefined : (() => undefined)) });
  const sb = { P, JSON, Object, Array, Number, String, Math, Date, RegExp, Set, Map, Symbol }; vm.createContext(sb);
  return vm.runInContext('with (P) { (function(){ ' + block + '\n return { cf, rf }; })() }', sb);
}
const SPOIL = { autoTasks: ['farm', 'tvt'], enemyHunt: false, actionDelayMs: 0, searchChamp: false, zoneAuto: true, lvlAbove: 8, lvlBelow: 2, deepEvery: 0, autoMagister: false };

test('все имена флагов once() узнаются меню как флаги (иначе новая миграция снова потеряется при импорте)', () => {
  assert.ok(FLAGS.length > 50, 'флаги once найдены: ' + FLAGS.length);
  const re = new RegExp(slice(popup, 'const CFG_FLAG_RE = /', '/;').slice('const CFG_FLAG_RE = /'.length));
  const bgRe = /\/\^\[a-z\]\[A-Za-z0-9_\]\{0,62\}\(\?:\\d\|Mig\)\$\//;
  assert.match(bgSrc, bgRe, 'фон проверяет имена тем же правилом');
  assert.deepEqual(FLAGS.filter(f => !re.test(f) || Object.hasOwn(D.CFG, f)), [], 'флаг не подходит под CFG_FLAG_RE или совпал с настройкой');
});

test('импорт cfg@Ник без rt@ → вход героя: once() не переписывает импортированные настройки', async () => {
  const f = load(); await f.ctx.applyBaseProfile('установка');
  assert.equal(f.state.rt?.char, 'Warlock', 'базовый профиль создал Warlock'); assert.ok(!f.state['cfg@Спойлер'] && !f.state['rt@Спойлер']);
  const flagObj = Object.fromEntries(FLAGS.map(k => [k, 1]));
  const file = { l2botCfg: 1, v: '20.76', t: 1, data: { cfg: { ...D.CFG, ...flagObj }, 'cfg@Спойлер': { ...D.CFG, ...flagObj, ...SPOIL } } };
  const r = await popupImport(f, file);
  assert.match(r.note, /^✅ Импортировано/, r.note);
  const sw = await f.ctx.switchCharacter({ nick: 'Спойлер', vis: true, src: 'tab1', roles: [], defRt: {} }, { tab: { id: 1, active: true } });
  assert.ok(sw.ok && sw.changed && sw.old === 'Warlock', JSON.stringify(sw).slice(0, 200));
  const { cfg, rt } = await f.ST.get(['cfg', 'rt']);
  const out = onceBlock(cfg, rt), again = Object.keys(out.cf).filter(k => FLAGS.includes(k));
  assert.deepEqual(again, [], 'миграции не запускаются повторно');
  const changed = Object.keys(SPOIL).filter(k => Object.hasOwn(out.cf, k) && JSON.stringify(out.cf[k]) !== JSON.stringify(SPOIL[k]));
  assert.deepEqual(changed, [], 'импортированные значения не перезаписаны: ' + changed.map(k => `${k} → ${JSON.stringify(out.cf[k])}`).join(', '));
  const eff = { ...cfg, ...out.cf };
  assert.equal(eff.enemyHunt, false); assert.equal(eff.actionDelayMs, 0); assert.ok(!eff.autoTasks.includes('pvp'), 'нападение на игроков не включено');
  assert.ok(!/deep25|pvpAll2054/.test(r.note), 'флаги не числятся «пропущенными неизвестными»: ' + r.note);
  assert.deepEqual(FLAGS.filter(x => cfg[x] !== 1), [], 'все флаги файла у активного героя');
  assert.deepEqual(FLAGS.filter(x => f.state['cfg@Warlock']?.[x] !== 1), [], 'и в сохранённых настройках прежнего героя (общий cfg файла)');
});

test('старый файл без флагов: миграции, как и раньше, обновляют его значения у нового героя', async () => {
  const f = load(); await f.ctx.applyBaseProfile('установка');
  const r = await popupImport(f, { l2botCfg: 1, data: { cfg: { searchChamp: false }, 'cfg@Спойлер': { ...SPOIL } } });
  assert.match(r.note, /^✅/); assert.ok(!r.sent.flags?.['cfg@Спойлер'], 'флагов в файле нет — нечего переносить');
  await f.ctx.switchCharacter({ nick: 'Спойлер', vis: true, src: 'tab1', roles: [], defRt: {} }, { tab: { id: 1, active: true } });
  const { cfg, rt } = await f.ST.get(['cfg', 'rt']);
  assert.ok(Object.keys(onceBlock(cfg, rt).cf).some(k => FLAGS.includes(k)), 'миграции старого файла выполняются');
});

test('фон: флаги только из меню, только для импортируемых ключей, только 1 и только недостающие', async () => {
  const f = load({ cfg: { nPower: 'Blaze', deep25: 0 }, 'cfg@Hero': { a: 1 } });
  assert.ok(!(await f.send({ cmd: 'cfgImport', cfg: { shopReserve: 5 }, flags: { cfg: ['pvpAll2054'] } }, f.game))?.ok, 'не из меню — отказ');
  assert.equal((await f.send({ cmd: 'cfgImport', cfg: { shopReserve: 5 }, flags: { cfg: ['nPower'] } }, f.popup))?.reason, 'invalid', 'имя не флага');
  assert.equal((await f.send({ cmd: 'cfgImport', cfg: { shopReserve: 5 }, flags: { 'cfg@Other': ['pvpAll2054'] } }, f.popup))?.reason, 'invalid', 'ключа нет в импорте');
  assert.equal((await f.send({ cmd: 'cfgImport', cfg: { shopReserve: 5 }, flags: { cfg: 'pvpAll2054' } }, f.popup))?.reason, 'invalid', 'не список');
  assert.equal(f.state.cfg.shopReserve, undefined, 'отклонённый импорт ничего не пишет');
  assert.ok((await f.send({ cmd: 'cfgImport', cfg: { shopReserve: 5 }, perChar: { 'cfg@Hero': { b: 2 } }, flags: { cfg: ['pvpAll2054', 'deep25'], 'cfg@Hero': ['ffDmgMig'] } }, f.popup))?.ok);
  assert.deepEqual(clone(f.state.cfg), { nPower: 'Blaze', deep25: 0, shopReserve: 5, pvpAll2054: 1 }, 'существующий ключ не перекрыт');
  assert.deepEqual(clone(f.state['cfg@Hero']), { a: 1, b: 2, ffDmgMig: 1 });
  assert.ok((await f.send({ cmd: 'cfgImport', cfg: { shopReserve: 6 } }, f.popup))?.ok, 'без флагов — прежний формат');
});

test('меню: флаги отделяются от настроек, настройки по-прежнему проверяются по типу', () => {
  const b = { Object, JSON, Number, Array, DEF: { shopReserve: 200000, nPower: 'x', lvlMin: 0 } }; vm.createContext(b);
  vm.runInContext(slice(popup, 'const CFG_IMPORT_EXTRA', "$('cfgImport').onclick") + ';this.clean=cfgImportClean;this.msg=cfgImportMsg;', b);
  const r = b.clean({ shopReserve: 7, deep25: 1, ffDmgMig: 1, evil: 1, deep20: 2, lvlMin: 1, stopHp1: 'x', rbExpValue: 1 });
  assert.equal(JSON.stringify(r.clean), '{"shopReserve":7,"lvlMin":1,"rbExpValue":1}', 'настройки меню и ядра со значением 1 остаются настройками');
  assert.equal(JSON.stringify(r.flags), '["deep25","ffDmgMig"]');
  assert.equal(JSON.stringify(r.skipped), '["evil","deep20","stopHp1"]', 'не 1 / не имя флага — пропуск');
  const m = b.msg({ cfg: { shopReserve: 1, deep25: 1 }, 'cfg@A': { nPower: 'B', ffDmgMig: 1 }, 'cfg@B': { deep25: 1 } });
  assert.equal(JSON.stringify(m.flags), '{"cfg":["deep25"],"cfg@A":["ffDmgMig"]}', 'герой без настроек в файле не создаётся и флагов не получает');
  assert.equal(JSON.stringify(m.perChar), '{"cfg@A":{"nPower":"B"}}');
});

// ---------- 2) уведомление 'alert' в Firefox ----------
const running = () => { const now = Date.now(); return { on: true, lock: { k: 'tab1', tab: 1, epoch: 'one', t: now }, hbBg: { tab: 1, t: now, page: '/map.html' }, wdog: [], wdDown: null, rt: { char: 'Hero', manualKickAt: 1 }, cfg: {} }; };

test('alert: Firefox показывает уведомление о капче и о нехватке для крафта', async () => {
  for (const browser of ['firefox', 'firefoxAsync']) for (const sticky of [true, false]) {
    const f = load(running(), { browser }); await tick();
    await f.send({ cmd: 'alert', id: sticky ? 'ab' : 'craft-missing', title: 'Проверка активности', text: 'x', sticky }, f.game); await tick();
    assert.equal(f.notes.length, 1, `${browser} sticky=${sticky}: одно уведомление`);
    assert.equal(f.notes[0].id, sticky ? 'l2bot-ab' : 'l2bot-craft-missing'); assert.equal(f.notes[0].title, 'Проверка активности'); assert.equal(f.notes[0].message, 'x');
    assert.ok(!('requireInteraction' in f.notes[0])); assert.equal(f.badges.at(-1), '!', 'значок «!» как раньше');
  }
});

test('alert: Chrome — капча висит до действия игрока, обычное уведомление без поля', async () => {
  const f = load(running()); await tick();
  await f.send({ cmd: 'alert', id: 'ab', title: 't', text: 'y', sticky: true }, f.game);
  await f.send({ cmd: 'alert', id: 'pve' }, f.game); await tick();
  assert.equal(f.notes.length, 2);
  assert.equal(f.notes[0].requireInteraction, true); assert.equal(f.notes[0].id, 'l2bot-ab');
  assert.ok(!('requireInteraction' in f.notes[1])); assert.equal(f.notes[1].title, 'L2wap Bot'); assert.equal(f.notes[1].message, '');
  assert.equal(f.badges.at(-1), '!');
});
