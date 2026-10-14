'use strict';
// 14.10: battle.js → battleNavigationFlow.goToMap() сначала await api.leave(revision), потом routing.navigate.
// defeat-tocity вызывает returnToTown, victory-continue — goToMap, нижняя ссылка города — leaveToCity.
// Прямая смена URL из sdms_ пропускала закрытие серверного боя (публичный battle-navigation-flow.js).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'modules/navigation.js'), 'utf8');
const dungeon = '/dungeon.html?dungeonId=necropolis_of_devotion';
function make({ ids = ['battle-back-map'], textBack = false, city = false, destination = dungeon, rejected = false, stopWaiting = false, off = false, hidden = [] } = {}) {
  const loc = { pathname: '/battle.html', search: '?spawnId=sdms_necropolis_of_devotion_078', href: '' };
  const nodes = Object.fromEntries(ids.map(id => [id, { id, hidden: hidden.includes(id) }]));
  const alt = textBack ? { id: 'text-back' } : null, cityLink = city ? { id: 'city-link' } : null;
  const S = { serverBattle: true, clicks: [], statuses: [], waits: [], leaveDone: false, pending: null };
  const sb = { console, Date, URLSearchParams, location: loc, document: { querySelector: () => null, querySelectorAll: () => [] } }; sb.globalThis = sb;
  vm.runInNewContext(src, sb);
  const env = { cfg: { catMode: true }, rt: {}, on: !off,
    $q: s => s.includes('a[href="/city.html"]') ? cityLink : nodes[s.slice(1)] || null,
    shown: el => !!el && !el.hidden,
    fire: el => { S.clicks.push(el.id); S.pending = async () => { if (rejected) return; S.serverBattle = false; S.leaveDone = true; assert.equal(S.leaveDone, true, 'игровой маршрут следует за ответом leave'); loc.pathname = destination.split('?')[0]; loc.href = destination; }; },
    heroAt: () => ({ dung: 'necropolis_of_devotion' }), setStatus: s => S.statuses.push(s), sleep: async () => {},
    byText: () => alt, BACK: /Назад/, waitFor: async (f, ms) => { S.waits.push(ms); if (stopWaiting) env.on = false; if (S.pending) { await S.pending(); S.pending = null; } return f() || null; },
  };
  return { N: sb.L2V7Factories.navigation(env), env, S, loc };
}
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
check('отход от чемпиона / на TvT закрывает бой и ждёт возврат в подземелье', async () => {
  const { N, S, loc } = make(); await N.toMap();
  assert.equal(S.serverBattle, false); assert.deepEqual(S.clicks, ['battle-back-map']);
  assert.equal(loc.href, dungeon); assert.deepEqual(S.waits, [3000, 8000]);
});
check('альтернативная кнопка по тексту тоже закрывает бой', async () => {
  const { N, S, loc } = make({ ids: [], textBack: true }); await N.toMap();
  assert.equal(S.serverBattle, false); assert.deepEqual(S.clicks, ['text-back']); assert.equal(loc.href, dungeon);
});
check('победа: видимая continue при скрытой back не запускает новый бой', async () => {
  const { N, S, loc } = make({ ids: ['battle-back-map', 'battle-victory-continue'], hidden: ['battle-back-map'] }); await N.toMap();
  assert.deepEqual(S.clicks, ['battle-victory-continue']); assert.equal(loc.href, dungeon);
});
check('поражение: игровой returnToTown не заменяется подземельем', async () => {
  const { N, S, loc } = make({ ids: ['battle-back-map', 'battle-defeat-tocity'], destination: '/city.html' }); await N.toMap();
  assert.deepEqual(S.clicks, ['battle-defeat-tocity']); assert.equal(loc.href, '/city.html');
});
check('без кнопок боя нижняя ссылка города использует игровой leaveToCity', async () => {
  const { N, S, loc } = make({ ids: [], city: true, destination: '/city.html' }); await N.toMap();
  assert.equal(S.serverBattle, false); assert.deepEqual(S.clicks, ['city-link']); assert.equal(loc.href, '/city.html');
});
check('без доступного выхода незаконченный бой остаётся на экране', async () => {
  const { N, S, loc } = make({ ids: [] }); await N.toMap();
  assert.equal(S.serverBattle, true); assert.deepEqual(S.clicks, []); assert.equal(loc.href, ''); assert.equal(loc.pathname, '/battle.html');
  assert.equal(S.statuses.at(-1), 'Выход из боя не завершён');
});
check('неуспешный leave не маскируется прямым переходом', async () => {
  const { N, S, loc } = make({ rejected: true }); await N.toMap();
  assert.equal(S.serverBattle, true); assert.equal(S.clicks.length, 1); assert.equal(loc.href, ''); assert.equal(loc.pathname, '/battle.html');
});
check('стоп до или во время ожидания не нажимает выход', async () => {
  for (const opts of [{ off: true }, { stopWaiting: true }]) { const { N, S, loc } = make(opts); await N.toMap(); assert.deepEqual(S.clicks, []); assert.equal(loc.href, ''); }
});
(async () => { let fail = 0; for (const [name, fn] of checks) { try { await fn(); console.log('PASS:', name); } catch (e) { fail++; console.error('FAIL:', name, e.message); } } if (fail) process.exitCode = 1; })();
