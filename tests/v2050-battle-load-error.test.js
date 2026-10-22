'use strict';
// Лог 23.10 00:20:43–00:21:04: семь безуспешных выходов; ссылка ошибки без ID сработала вручную.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(process.env.L2_NAV_SOURCE || path.join(__dirname, '../modules/navigation.js'), 'utf8');
function make({ catMode = true, spawn = 'sdms_catacomb_of_the_branded_128', error = true, hidden = false, late = false, outside = false, href = '/map.html', stopped = false, stopWaiting = false, blocked = false, native = false, disappear = false } = {}) {
  const loc = { pathname: '/battle.html', search: '?spawnId=' + spawn, href: '' };
  const link = { className: 'l2-battle-back-map', href, textContent: 'Повернутися на карту' };
  const normal = { id: 'battle-back-map' };
  const S = { clicks: [], waits: [], statuses: [], serverBattle: native, leaves: 0, tried: 0 };
  let painted = !late;
  const env = { on: !stopped, cfg: { catMode }, rt: {}, BACK: /^(Назад на карту|Назад на мапу)$/i,
    $q: s => {
      if (s === '#battle-back-map') return native ? normal : null;
      if (s === '#battle-load-err a.l2-battle-back-map[href="/map.html"]') return painted && error && !outside && href === '/map.html' ? link : null;
      return null;
    },
    shown: el => el !== link || !hidden,
    byText: re => painted && error && !hidden && re.test(link.textContent) ? link : null,
    setStatus: s => S.statuses.push(s), sleep: async () => {},
    waitFor: async (fn, ms) => {
      S.waits.push(ms);
      if (stopWaiting) env.on = false;
      let value = fn();
      if (!value && !painted) { painted = true; value = fn(); }
      if (value && disappear) error = false;
      return value || null;
    },
    fire: el => {
      S.tried++;
      if (!env.on || blocked) return false;
      S.clicks.push(el);
      if (el === normal) { S.leaves++; S.serverBattle = false; loc.pathname = '/dungeon.html'; loc.href = '/dungeon.html?dungeonId=catacomb_of_the_branded'; }
      else { loc.pathname = '/map.html'; loc.href = '/map.html'; }
      return true;
    },
  };
  const sb = { location: loc, document: { querySelector: () => null, querySelectorAll: () => [] }, console, Date, URLSearchParams };
  sb.globalThis = sb; vm.runInNewContext(src, sb);
  return { N: sb.L2V7Factories.navigation(env), env, S, loc, link };
}
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
check('исходные семь попыток заменяются одним кликом игровой ссылки', async () => {
  const { N, S, loc, link } = make();
  for (let i = 0; i < 7 && loc.pathname === '/battle.html'; i++) await N.toMap();
  assert.equal(loc.pathname, '/map.html'); assert.deepEqual(S.clicks, [link]);
  assert.equal(S.statuses.includes('Выход из боя не завершён'), false);
});
check('поздняя ссылка замечается в ожидании', async () => {
  const { N, S, loc, link } = make({ late: true }); await N.toMap();
  assert.equal(loc.pathname, '/map.html'); assert.deepEqual(S.clicks, [link]);
});
check('обычный бой и выключенный режим катакомб используют тот же игровой клик', async () => {
  for (const opts of [{ catMode: false }, { spawn: 'dense_25957' }]) {
    const { N, S, loc, link } = make(opts); await N.toMap();
    assert.equal(loc.pathname, '/map.html'); assert.deepEqual(S.clicks, [link]);
  }
});
check('скрытая ошибка, чужой контейнер и иной адрес не подменяют выход', async () => {
  for (const opts of [{ hidden: true }, { error: false }, { outside: true }, { href: '/battle.html?spawnId=other' }]) {
    const { N, S, loc } = make(opts); await N.toMap();
    assert.equal(loc.pathname, '/battle.html'); assert.equal(loc.href, ''); assert.deepEqual(S.clicks, []);
  }
});
check('отказ fire не обходится сменой адреса ни в одном режиме', async () => {
  for (const catMode of [true, false]) {
    const { N, S, loc } = make({ catMode, blocked: true }); await N.toMap();
    assert.equal(S.tried, 1); assert.deepEqual(S.clicks, []); assert.equal(loc.pathname, '/battle.html'); assert.equal(loc.href, '');
  }
});
check('перерисовка ошибки после ожидания не включает прямой fallback', async () => {
  const { N, S, loc } = make({ catMode: false, blocked: true, disappear: true }); await N.toMap();
  assert.equal(S.tried, 1); assert.deepEqual(S.clicks, []); assert.equal(loc.href, '');
});
check('Stop до вызова или в ожидании отменяет клик и переход', async () => {
  for (const catMode of [true, false]) for (const opts of [{ stopped: true }, { stopWaiting: true }]) {
    const { N, S, loc } = make({ catMode, ...opts }); await N.toMap();
    assert.deepEqual(S.clicks, []); assert.equal(loc.pathname, '/battle.html'); assert.equal(loc.href, '');
  }
});
check('обычный выход закрывает серверный бой штатной кнопкой', async () => {
  const { N, S, loc } = make({ error: false, native: true }); await N.toMap();
  assert.equal(S.leaves, 1); assert.equal(S.serverBattle, false);
  assert.equal(S.clicks[0].id, 'battle-back-map'); assert.equal(loc.pathname, '/dungeon.html');
});
(async () => {
  let fail = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log('PASS:', name); }
    catch (e) { fail++; console.error('FAIL:', name, e.message); }
  }
  console.log(`battle-load-error: ${checks.length - fail} PASS / ${fail} FAIL`);
  if (fail) process.exitCode = 1;
})();
