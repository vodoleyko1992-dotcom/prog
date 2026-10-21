'use strict';
// 20.43 (автономность, доводка 21.10): подготовка кота перед РБ (warlock.raidPrepare). Сбой чтения /character (исключение: 429/5xx/HTML)
// и снимок не того героя / в бою / не того класса возвращали true без later(): loopGate спал 0,3 с и снова слал свой GET /character —
// 2–3 запроса в секунду всё время сбоя (при 429 это ещё и усиливало ограничение игры). Теперь растущая пауза 1,5 → 3 → 6 → 12 с,
// удачное чтение её сбрасывает. 20.43 (доводка 21.10, ревью): на Старте теперь тоже пауза (1,5 → 3 → 6 с) — tests/v2043-fx-rev-start-read.test.js.
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./warlock-fixture.cjs');
const wanted = 'Summon Feline Queen, Warrior Servitor, Final Servitor';
function setup(o = {}) {
  const state = { fail: o.fail || null };
  const f = fixture({ cfg: { petFullAuto: false, petAuto: true, petBuffAuto: true, nPetBuffs: wanted }, char: { mp: 5000, ...o.char },
    read: async (path, env, ch) => { if (path !== '/character' || !state.fail) return; if (state.fail === 'throw') throw Error('HTTP 429'); if (state.fail === 'battle') ch.inBattle = true; if (state.fail === 'other') ch.name = 'другой'; } });
  const e = f.env, fires = [], status = [];
  e.leaseEpoch = 'owner'; e.canRun = () => true; e.canAct = () => true; e.setCfg = async p => Object.assign(e.cfg, p); e.setStatus = t => status.push(t); e.rec = () => {};
  const row = (id, name) => ({ action: 'l2_' + id, skillId: id, effectId: id === 1331 ? 4699 : id, name, mp: 10, ready: true, button: { id } });
  const panel = { summon: row(1276, 'Summon Kai the Cat'), buffs: [row(1331, 'Summon Feline Queen'), row(1346, 'Warrior Servitor'), row(1349, 'Final Servitor')] };
  let page = '/map.html';
  e.nativePanel = () => panel; e.nativePanelPath = () => page; e.nativeReturnPath = () => page; e.nativePanelOpen = async () => {};
  e.nativeNavigate = p => { page = p; }; e.nativeFire = b => { fires.push(b.id); return true; };
  const chars = () => f.gets.filter(p => p === '/character').length, prep = () => f.api().raidPrepare();
  const loop = async ms => { const out = []; for (let t = 0; t < ms; t += 300) { out.push(await prep()); f.tick(300); } return out; };
  return { ...f, e, fires, status, chars, prep, loop, state };
}

for (const [kind, why] of [['throw', 'исключение чтения (429/5xx/HTML)'], ['battle', 'снимок «в бою»'], ['other', 'снимок другого героя']]) {
  test(`${why}: GET /character не каждые 0,3 с, а 1,5 → 3 → 6 → 12 с; тур ждёт (true), кликов нет`, async () => {
    const f = setup({ fail: kind });
    const res = await f.loop(60000), n = f.chars();
    assert.ok(n >= 6 && n <= 10, `за 60 с ${n} чтений (было бы ≈200)`);
    assert.ok(res.every(x => x === true), 'подготовка не пропускается и не завершается сама');
    assert.deepEqual(f.fires, []);
  });
}

test('удачное чтение сбрасывает паузу: следующий сбой — снова через 1,5 с, подготовка идёт дальше', async () => {
  const f = setup({ fail: 'throw' });
  await f.loop(30000); const before = f.chars();
  f.state.fail = null; await f.loop(13000);   // ближайшее разрешённое чтение (≤12 с) удачно — дальше обычный ход подготовки
  assert.ok(f.fires.includes(1331), 'после восстановления бафф кота ставится');
  assert.ok(f.chars() > before);
  // новый сбой — пауза снова начинается с 1,5 с, а не с 12 с
  f.state.fail = 'throw'; f.e.rt.petRaidPrep = null; f.tick(20000);
  const g0 = f.chars(); await f.prep(); const g1 = f.chars(); assert.equal(g1 - g0, 1);
  await f.loop(1200); assert.equal(f.chars(), g1, 'внутри 1,5 с не читает');
  await f.loop(600); assert.equal(f.chars(), g1 + 1, 'через 1,5 с — следующее чтение');
});
