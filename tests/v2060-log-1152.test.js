'use strict';
// 20.60 (логи 24.10 11:51–11:52 по времени выгрузки): четыре находки — запись заброса без revision, чемпион с полупустым HP,
// весь лог боя в delta хода с поражением и энергия силы после смерти.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const root = __dirname + '/../', read = f => fs.readFileSync(root + f, 'utf8');

test('champs.hpLow: новый чемпион только от cfg.champMinHp (70 по умолчанию, 0 — выкл)', () => {
  const ctx = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise }; ctx.globalThis = ctx;
  vm.runInNewContext(read('modules/champs.js'), ctx);
  const env = { cfg: {}, rt: {}, heroLvl: () => 59, farmRate: () => null, setRt: async p => Object.assign(env.rt, p) };
  const C = require('./champs-context-fixture.cjs').freshChamps(ctx.L2V7Factories.champs, env);
  const me = (cur, max = 7186) => ({ cur, max, pct: 100 * cur / max });
  // 20:43:41 — 3818/7186 (53 %), 20:46:37 — 2050/7186 (29 %), 20:51:11 — 4063/7186 (57 %): все три боя кончились смертью
  for (const hp of [3818, 2050, 4063]) assert.match(C.hpLow(me(hp)) || '', /нового чемпиона беру от 70 %/);
  assert.equal(C.hpLow(me(6205)), null, '86 % — можно');
  assert.equal(C.hpLow(null), null, 'HP неизвестно — не запрещаем');
  env.cfg.champMinHp = 0; assert.equal(C.hpLow(me(100)), null, '0 — проверка выключена');
  env.cfg.champMinHp = 90; assert.ok(C.hpLow(me(6205)));
});

test('mobfarm и цепочка combat спрашивают hpLow до нового чемпиона; низкоуровневый квестовый — исключение', () => {
  const mf = read('modules/mobfarm.js'), cb = read('modules/combat.js');
  assert.match(mf, /meNow = env\.meHp\?\.\(\)/);
  assert.match(mf, /tierOff\(r, true\) \|\| \(!\(lvl > 0 && hl - lvl >= 20\) && env\.champs\.hpLow\?\.\(meNow\)\)/);
  assert.match(cb, /env\.champs\?\.held\?\.\(ctx\)[^\n]*\n\s*\|\| \(!\(ctx\.lvl > 0 && hl - ctx\.lvl >= 20\) && env\.champs\?\.hpLow\?\.\(env\.meHp\?\.\(\)\)\)/);
  assert.match(read('defaults.js'), /champMinHp: 70/);
  assert.match(read('popup.html'), /id="champMinHp"/); assert.match(read('popup.js'), /'champMinHp',/);
});

test('fightlab: ход с поражением с полным логом в delta.logTail не засчитывает весь бой последнему действию', () => {
  const src = read('hook.js'), btOf = vm.runInNewContext(src.slice(src.indexOf('  const btOf = '), src.indexOf('  const pvOf =')) + ';btOf');
  const boss = 'Captain of Red Flag Shaka', spawn = 'l2dop_rb_25067';
  let now = 100000, rid = 0; const rt = { char: 'Hero', classCur: { prof: 'destroyer', slot: 0 } }, box = { Date: { now: () => now }, URLSearchParams };
  vm.runInNewContext(read('modules/fightlab.js'), box);
  const L = box.L2V7Factories.fightlab({ rt, cfg: {}, mobTitle: () => boss, routeLocation: { search: '?spawnId=' + spawn }, actName: x => x, setRt: async p => Object.assign(rt, p), rec() {} });
  const send = (path, data) => { now += 700; return L.onNet(path, { status: 200, rid: ++rid, req: { action: 'attack' }, res: data, bt: btOf({ pathname: path }, data) }); };
  const hit = n => `⁠255​Розгром — ${n} урона`;
  const log = ['Бій розпочато: [Captain of Red Flag Shaka] (ур. 52).'];
  send('/game/battle/start', { revision: 10, battle: { spawnId: spawn, mobName: boss, mobHp: 865238, mobMaxHp: 865238, logSeq: 1, log: [...log] } });
  let mob = 865238;
  for (const n of [5056, 5713, 5194, ...Array.from({ length: 45 }, (_, i) => 2500 + i)]) {   // 48 ходов: хвост длиннее памяти 40 строк
    log.push(hit(n)); mob -= n; const t = send('/game/battle/action', { revision: 10 + log.length, delta: { mobHp: mob, logSeq: log.length, logTail: [hit(n)] } }); assert.equal(t.own, n); }
  // поражение: сервер прислал весь лог (seq 49 → 50, строк 50)
  log.push(`[${boss}] ударив тебе (крит!) — −6064 HP.`);
  const last = send('/game/battle/action', { revision: 1000, delta: { logSeq: log.length, logTail: [...log] } });
  assert.equal(last.own, 0, 'новая строка — только удар босса; прежние удары второй раз не считаем');
});

test('рыбалка: запись без revision закрывается через LEGACY_CAST_MS по согласованному снимку без рыбы', () => {
  const s = read('modules/fishing.js');
  assert.match(s, /const LEGACY_CAST_MS=60000;/);
  assert.match(s, /known&&state\.target===null&&!Number\.isSafeInteger\(R\)&&Date\.now\(\)-p\.at>=LEGACY_CAST_MS/);
});

test('смерть сбрасывает память энергии силы', () => {
  assert.match(read('modules/survival.js'), /\.\.\.\(env\.rt\.force\?\.n > 0 \? \{ force: \{ \.\.\.env\.rt\.force, n: 0, t: now \} \} : \{\}\)/);
});
