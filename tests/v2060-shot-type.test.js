'use strict';
// 20.60 (лог 24.10 22:16, John: «На коте какого фига достал и активировал физические соски, хотя это маг»): после смены Maestro → Arcana Lord
// сабом в памяти осталось «надето: Клановий штормер» (пика) — бот убрал с панели благословенные заряды духа S и включил заряды души S.
// keepShots сверяет тип зарядов с сервером так же, как грейд (#373); подтверждённый ответ держит 60 с.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function resources({ mage, sync, title = '#3952 — Благословенний заряд духу ×4497' }) {
  const slot = { title, isConnected: true };
  const rt = { weaponsT: 1 }; let clicks = 0, syncs = 0; const recs = [];
  const st = { mage };
  const env = { rt, shotGrade: () => ({ g: 'S' }), shotsMage: () => st.mage, setRt: async p => Object.assign(rt, p), rec: (...a) => recs.push(a.join(' ')),
    syncShotWeapon: async force => { assert.equal(force, true); syncs++; return sync(st); }, shotSlot: () => slot, on: true, tabOwner: true,
    shotsOn: () => true, qty: () => 4497, fire: () => clicks++, $q: () => null, shown: () => false, waitFor: async () => null, sleep: async () => {} };
  const box = { document: { querySelectorAll: () => [] }, Date }; vm.createContext(box);
  vm.runInContext(fs.readFileSync(__dirname + '/../modules/resources.js', 'utf8'), box);
  const M = box.L2V7Factories.resources(env);
  return { run: () => M.keepShots(), clicks: () => clicks, syncs: () => syncs, recs, rt };
}
test('лог 22:16: память — пика, сервер — кастер: благословенные S остаются, физические не ставятся', async () => {
  const f = resources({ mage: false, sync: st => { st.mage = true; return true; } });
  await f.run();
  assert.equal(f.syncs(), 1, 'перед заменой типа — свежий GET /character');
  assert.equal(f.clicks(), 0, 'слот не трогаем');
  assert.ok(!f.recs.some(r => /поставил подходящие/.test(r)));
});
test('недоступный GET оружия не позволяет сменить тип по старой памяти', async () => {
  const f = resources({ mage: false, sync: () => false });
  await f.run(); assert.equal(f.clicks(), 0);
  assert.equal(f.rt.shotSwapT, undefined, 'замена не начиналась');
});
test('сервер подтвердил физическое оружие — замена идёт, повторная сверка не раньше 60 с', async () => {
  const f = resources({ mage: false, sync: () => true });
  await f.run();
  assert.equal(f.syncs(), 1); assert.ok(f.rt.shotSwapT > 0, 'замена начата после подтверждения');
  await f.run(); await f.run();
  assert.equal(f.syncs(), 1, 'каждый ход GET не повторяется');
});
test('правильный тип и грейд — без сверки', async () => {
  const f = resources({ mage: true, sync: () => true });
  await f.run(); assert.equal(f.syncs(), 0);
  const g = resources({ mage: false, title: '#1467 — Заряд душі воїна ×1289', sync: () => true });
  await g.run(); assert.equal(g.syncs(), 0);
});
