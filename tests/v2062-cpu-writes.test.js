'use strict';
// 20.62 (жалоба John 25.10 «бот стал перегружать ЦП и память ПК»): память героя ≈1–1,4 МБ (журналы 23–24.10) переписывалась
// целиком почти на каждом ходе боя — откаты сервера (alignServerSkillCooldowns) шли обычной записью; окно бота на странице
// игры перерисовывалось на каждое действие и каждую запись памяти и каждый раз считало таймеры всех ≈200 РБ ради строки эпиков,
// а таймеры РБ (rbtimer.table) пересчитывали общий респ всех РБ для каждого РБ (O(n²)).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = read('content.js');
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, 'нет фрагмента ' + a); return src.slice(i, j); };
const H = 3600000, NOW = Date.UTC(2026, 9, 25, 0, 0);

// 1. Откаты сервера — отложенной записью (как combat.js rtSoon), память вкладки обновляется сразу
{
  const src = slice(content, 'function alignServerSkillCooldowns() {', 'const netSeen = new Map();');
  assert.match(src, /\(on \? setRtSoon : setRt\)\(\{ cdUntil: next \}\)/, 'откаты сервера у работающего бота — setRtSoon');
  const writes = [], soon = [], el = { closest: () => el };
  const ctx = { on: true, rt: { cdUntil: {} }, Date: { now: () => NOW }, Object, Math, Number, CSS: { escape: s => s }, console, TAG: 't', SLOT: '.s',
    isBattle: () => true, cdSpawn: () => 'sp', skKey: () => 'l2_1220', document: { querySelector: () => el },
    combatCooldown: { snapshot: () => ({ skillUntil: { l2_1220: NOW + 3000 } }), skillKnown: () => true },
    setRt: p => { writes.push(p); return Promise.resolve(); }, setRtSoon: p => { soon.push(p); ctx.rt = { ...ctx.rt, ...p }; return Promise.resolve(); } };
  vm.runInNewContext(src + ';this.align=alignServerSkillCooldowns;', ctx);
  for (let turn = 0; turn < 50; turn++) { ctx.combatCooldown.snapshot = () => ({ skillUntil: { l2_1220: NOW + 3000 + turn * 1000 } }); ctx.align(); }
  assert.equal(writes.length, 0, '50 ходов — ни одной обычной записи');
  assert.equal(soon.length, 50, 'каждое изменение — в отложенный пакет');
  assert.equal(ctx.rt.cdUntil.l2_1220, NOW + 3000 + 49 * 1000, 'память вкладки — свежий дедлайн');
  // бот выключен (игрок бьёт сам, замка нет — pagehide отложенное не дописал бы): обычной записью, как раньше
  ctx.on = false; ctx.combatCooldown.snapshot = () => ({ skillUntil: { l2_1220: NOW + 90000 } }); ctx.align();
  assert.equal(writes.length, 1); assert.equal(soon.length, 50);
}
// 1b. Прочие записи боя/победы — отложенным пакетом или только при изменении (финальное ревью 20.62)
{
  const soonSet = slice(content, 'const RT_STAT_SOON = new Set([', ']);');
  for (const k of ['force', 'pots', 'potInfo', 'zoneStat', 'tbWatchT']) assert.ok(soonSet.includes(`'${k}'`), 'отложенно: ' + k);
  assert.match(content, /if \(pi && \(rt\.potInfo\?\.name !== pi\.name/, 'сведения о банке — только новые');
  assert.match(read('modules/champs.js'), /return \(env\.setRtSoon \|\| env\.setRt\)\(\{champLearn:M\}\);/, 'урон состава после победы — отложенно');
  assert.match(content, /L2V7Modules\.champs = L2V7Factories\.champs\(\{[^\n]*get setRtSoon\(\) \{ return setRtSoon; \}/, 'геттер setRtSoon у champs');
  assert.match(read('modules/navigation.js'), /setRt\(\{ zoneStat: S, \.\.\.\(env\.rt\.lvl !== l \? \{ lvl: l \} : \{\}\) \}\)/, 'уровень — только новый');
  assert.match(read('modules/mobfarm.js'), /if \(qt\.join\('\|'\) !== \(env\.rt\.questTargets \|\| \[\]\)\.join\('\|'\)\) await env\.setRt\(\{ questTargets: qt \}\);/, 'список квестовых целей — только новый');
  assert.match(read('popup.js'), /finally \{ craftAdding = false; if \(secOpen\('craft'\)\) renderCraftPicker\(\); \}/, 'меню: добавление крафта после ухода из раздела не рисует пустой список');
}

// 2. Таймеры РБ: общий респ считается один раз на таблицу — результат тот же, что у прежнего расчёта по каждому РБ
{
  const ctx = { Date, Math, Object, String, Number, Array, Set, JSON, console, sessionStorage: { getItem: () => null, setItem() {} } };
  ctx.globalThis = ctx; vm.runInNewContext(read('modules/rbtimer.js'), ctx);
  const T = ctx.L2V7Factories.rbtimer({ rt: {}, cfg: {}, RB_WIN: 15, heroLevel: () => 70, setRt: async () => {}, rec() {}, sleep: async () => {} });
  const b = {};
  for (let i = 0; i < 200; i++) b['rb' + i] = { n: 'RB' + i, l: 40 + i % 40, al: i % 3 === 0, dl: NOW - 2 * H - i * 60000, dh: NOW - H - i * 60000, ch: NOW - H, ...(i < 30 ? { ob: [[8 * H - 600000 - i * 1000, 8 * H + 600000 + i * 1000]] } : {}) };
  for (const [id, l] of [['ak', 40], ['core', 50]]) b[id] = { n: id, l, e: true, al: false, dl: NOW - H, dh: NOW - H + 60000 };
  const S = { b };
  const old = Object.keys(b).map(id => T.timerOf(S, id, NOW, 8)).filter(Boolean);
  const t = T.table(S, NOW, { all: true, def: 8 });
  assert.equal(t.length, old.length);
  const byId = Object.fromEntries(old.map(x => [x.id, x]));
  for (const x of t) assert.deepEqual(JSON.parse(JSON.stringify(x)), JSON.parse(JSON.stringify(byId[x.id])), 'таймер ' + x.id + ' не изменился');
  assert.equal(t.find(x => x.id === 'rb100').R.src, 'all', 'РБ без своих замеров — по общему респу');
  const t0 = process.hrtime.bigint(); for (let k = 0; k < 20; k++) T.table(S, NOW, { all: true, def: 8 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  assert.ok(ms < 3, `таблица 200 РБ — ${ms.toFixed(2)} мс (прежний O(n²) — 6–15 мс)`);
}

// 3. Окно бота: строка эпиков — таблица только по эпикам; перерисовка от статуса и записей памяти — не чаще раза в 150 мс
{
  const ep = slice(content, 'function epicRespTxt(wide, now = Date.now()) {', 'const seen = new Set(E.map');
  assert.match(ep, /filter\(\(\[, x\]\) => x && x\.e\)/, 'в таблицу эпиков — только эпики');
  const st = slice(content, 'function setStatus(', '// Команда остановки сериализуется');
  assert.match(st, /drawSoon\(\);\n\}/, 'setStatus — drawSoon');
  const li = slice(content, "if (ch.cfg && on && tabOwner) L2V7Modules.mammon.bagAuto()", '// v5.5.9: игра заранее');
  assert.match(li, /if \(ch\.cfg \|\| ch\.rt \|\| ch\.hot \|\| ch\.on\) drawSoon\(\);/, 'запись памяти — drawSoon');   // 20.65: и hot
  const ds = slice(content, 'function drawSoon() {', 'function draw() {');
  const timers = []; let draws = 0;
  const ctx = { setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; }, draw: () => draws++ };
  vm.runInNewContext(ds + ';this.drawSoon=drawSoon;', ctx);
  for (let i = 0; i < 30; i++) ctx.drawSoon();
  assert.equal(timers.length, 1, '30 вызовов — одна перерисовка'); assert.equal(timers[0][1], 150);
  timers[0][0](); assert.equal(draws, 1); ctx.drawSoon(); assert.equal(timers.length, 2, 'после кадра — снова можно');
  const dr = slice(content, 'function draw() {', 'const L = [], now = Date.now();');
  assert.match(dr, /indMode \|\| 'full'\) === 'off'\) \{ if \(ui\) ui\.style\.display = 'none'; return; \}/, 'окно выключено — без сборки строк');
}
console.log('v2062-cpu-writes PASS');
