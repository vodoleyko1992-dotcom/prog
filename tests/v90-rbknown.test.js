'use strict';
// 9.0 (база знаний kb/, снято с игры 11.10): встроенные цифры RB_KNOWN — все 197 РБ из kb/data/game-raid-bosses.json (было 33),
// 5 неточных записей 8.0.3 (РБ 60–66) заменены ответами игры; эпики, кроме Ядра и Орфена, по-прежнему спрашиваются у игры
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const load = (extra = {}) => { const sb = { console, Date, Math, JSON, CSS: { escape: s => s }, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/rb-bosses.html', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(read('modules/raid.js'), sb); return sb; };
const kb = JSON.parse(read('kb/data/game-raid-bosses.json'));
(async () => {
  const calls = [];
  const env = { cfg: {}, rt: { rbStats: {}, rbDb: {} }, heroLvl: () => 56, setRt: async p => Object.assign(env.rt, p), rec: () => {} };
  const R = load({ fetch: async u => { calls.push(u); throw new Error('net'); }, AbortController, setTimeout, clearTimeout }).L2V7Factories.raid(env);
  // 1. каждый РБ из базы знаний известен без памяти и без запроса, цифры совпадают с ответом игры
  assert.equal(kb.length, 197);
  for (const b of kb) { const k = R.rbKnown(b.spawnId), s = b.stats;
    assert.ok(k, 'known ' + b.spawnId);
    assert.equal(JSON.stringify([k.hp, k.patk, k.pdef, k.matk, k.mdef, k.src]), JSON.stringify([s.maxHp, s.pAtk, s.pDef, s.mAtk, s.mDef, 'api']), b.name); }
  // 2. 5 РБ 60–66 с неточными цифрами 8.0.3 — теперь как отвечает игра (/game/spawn/<id>/info, kb/raw/spawn-info-bosses.json)
  assert.equal(JSON.stringify([R.rbKnown('l2dop_rb_25140').hp, R.rbKnown('l2dop_rb_25140').matk]), JSON.stringify([3384041, 5941]), 'Hekaton Prime');
  assert.equal(R.rbKnown('l2dop_rb_25322').hp, 2409850, 'Falston'); assert.equal(R.rbKnown('l2dop_rb_25423').hp, 1877023, 'Timiniel');
  assert.equal(R.rbKnown('l2dop_rb_25226').matk, 4339, 'Kastor'); assert.equal(R.rbKnown('l2dop_rb_25234').matk, 5625, 'Ancient Weird Drake');
  // 3. раньше незнакомый РБ (Discarded Guardian 20) — цифры сразу, запроса к игре нет
  const st = await R.rbInfo('l2dop_rb_25372');
  assert.equal(JSON.stringify([st.hp, st.matk, calls.length]), JSON.stringify([175392, 62, 0]));
  // 4. эпики: Ядро и Орфен встроены, Закен — нет (его цифры бот спрашивает сам)
  assert.ok(R.rbKnown('l2dop_rb_29006') && R.rbKnown('l2dop_rb_29014')); assert.equal(R.rbKnown('l2dop_rb_29022'), null);
  console.log('PASS: 9.0 built-in RB numbers — all 197 RBs from the knowledge base (was 33), 5 inaccurate 60–66 entries fixed from game answers, no request for a known RB, epics unchanged');
})().catch(e => { console.error(e); process.exit(1); });
