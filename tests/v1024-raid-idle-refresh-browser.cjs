'use strict';
// Журнал 15.10 18:59: настоящий MV3/main, старая очередь РБ и пустая точка охоты.
// Подменяются только HTML и серверные ответы; методы расширения исполняются штатно.
const assert = require('node:assert/strict');
const path = require('node:path');
const { journey, bosses, until, delay } = require(path.join(process.env.L2_TEST_ROOT || path.join(__dirname, '..'), 'tests/v1024-journey-fixture.cjs'));

// 20.54 (прогон смоуков 23.10): с 20.30 (0521983, #296) каждый Старт отбрасывает старый снимок и сначала заново читает весь список
// РБ на /rb-bosses.html. Модель сервера согласована: страница списка и /game/raid-bosses показывают одно и то же; при Старте все РБ
// мертвы, «воскрешение» сервер показывает с первого фонового опроса тура на карте. Проверки ожидания считаются от этого опроса.
const revives = kind => ['revived', 'stop'].includes(kind);
async function fixture(kind) {
  const A = { listReads: 0, scanReads: 0, held: false, mapLoads: 0, paths: [], polls: [], mapAtPoll: null, pathsAtPoll: null };
  const alive = (index, S) => index === 0 && revives(kind) && A.listReads > 0 && !S.wins.includes(bosses[0].id);
  const f = await journey({ travel: true, rbAlive: (b, S) => alive(bosses.indexOf(b), S) });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const expires = Date.now() + 5 * 3600000;
  f.S.shots = 1000;
  f.S.heroBuffs = [{ skillId: 1059, level: 3, expiresAtMs: expires }];
  f.S.petBuffs = Array.from({ length: 26 }, (_, i) => ({ skillId: 1200 + i, level: 2, expiresAtMs: expires }));
  const page = `<!doctype html><meta charset="utf-8"><h1>Empty raid camp</h1>
    <div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div>
    <div id="character-profession">Human Warlock</div><div id="l2-nav-bottom"></div>
    <span id="l2-hud-hp-cur">10000</span><span id="l2-hud-hp-max">10000</span>
    <span id="l2-hud-mp-cur">1000</span><span id="l2-hud-mp-max">1000</span>
    <div id="l2-hud-active-buffs"><span class="l2-hud-active-buff" data-skill-id="1059" data-expires-at="${expires}" title="Empower Lv.3"></span></div>
    <div id="map-mob-page-ind">1 / 1 (0)</div><div id="map-mob-list" data-l2-around-sig="empty-raid-camp"></div>
    <button class="l2-map-mob-pin l2-map-mob-pin--raid" data-spawn-id="l2dop_rb_91000" title="Empty Camp Boss · ур. 75 · рейд-босс">Empty Camp Boss</button>
    <script>localStorage.setItem('token','fixture');(async()=>{while(!window.__l2botHook)await new Promise(resolve=>setTimeout(resolve,20));await fetch('/character');await fetch('/game/tvt');})();</script>`;

  await f.h.ctx.route('https://l2wap.com/**', async r => {
    try {
      const req = r.request(), u = new URL(req.url()), p = u.pathname;
      if (p.endsWith('.html')) A.paths.push(p);
      if (p === '/map.html' && !f.S.near) {
        A.mapLoads++;
        return r.fulfill({ contentType: 'text/html; charset=utf-8', body: page });
      }
      if (p === '/game/raid-bosses' && new URL(req.frame().url()).pathname === '/rb-bosses.html') {
        // Свежий обход списка при Старте (цены страниц и первая проверка пустой очереди) идёт со страницы списка — это ещё
        // не фоновый опрос ожидания на карте.
        A.scanReads++;
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ page: 1, pageSize: 15, total: bosses.length, totalPages: 1,
          baseAdenaCost: 100000, adenaCost: 100000, characterLevel: 75, minRaidBossLevel: 63,
          bosses: bosses.map((b, index) => ({ spawnId: b.id, name: b.name, level: b.lvl, bossType: 'raid', isAlive: alive(index, f.S), adenaCost: 100000, canAttack: true })) }) }).catch(() => {});
      }
      if (p === '/game/raid-bosses') {
        assert.equal(req.method(), 'GET');
        if (A.mapAtPoll === null) { A.mapAtPoll = A.mapLoads; A.pathsAtPoll = A.paths.length; }
        A.listReads++;
        A.polls.push(u.pathname + u.search);
        assert.equal(new URL(req.frame().url()).pathname, '/map.html', 'список обновляется только после ручного открытия страницы');
        const before = (await f.h.get(['rt'])).rt;
        if (A.listReads === 1) {
          assert.ok(before.rbHuntIdle > Date.now(), 'сценарий начал опрос уже после истечения простоя');
          // 20.54: старый снимок (≥3 мин) Старт отбрасывает; опрос идёт по полному списку, прочитанному этим Стартом.
          assert.ok(before.rbListStartRequired && before.rbListReadStart === before.rbListStartRequired && before.rbListVerifiedAt > 0, 'опрос до полного свежего списка Старта');
        }
        if (kind === 'stop' && !A.held) { A.held = true; await gate; }
        if (kind === 'error') return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_unavailable' }) }).catch(() => {});
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ page: 1, pageSize: 15, total: bosses.length, totalPages: 1,
          baseAdenaCost: 100000, adenaCost: 100000, characterLevel: 75, minRaidBossLevel: 63,
          bosses: bosses.map((b, index) => ({ spawnId: b.id, name: b.name, level: b.lvl, bossType: 'raid', isAlive: index === 0 && revives(kind) && !f.S.wins.includes(b.id), adenaCost: 100000, canAttack: true })) }) }).catch(() => {});
      }
      return r.fallback();
    } catch (error) {
      f.routeErrors.push(error);
      return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_assertion', message: error.message }) }).catch(() => {});
    }
  });
  await f.h.sw.evaluate(async ({ expires, bosses }) => {
    const { cfg, rt } = await chrome.storage.local.get(['cfg', 'rt']);
    const now = Date.now(), old = now - 3 * 60000;
    await chrome.storage.local.set({ cfg: { ...cfg, rbTimers: false, rbTimerMin: 10, rec: true }, rt: { ...rt,
      rbHunt: { step: 'pick', phase: 'wait', next: 'подходящих РБ нет — по последнему снимку все убиты; фармлю мобов, повторная оценка через 5 мин' },
      rbList: Object.fromEntries(bosses.map(b => [b.id, { ...b, alive: false, page: 1, price: 100000, unit: 'аден', t: old }])), rbListT: old,
      rbTimer: { pg: { 1: [74, 75] }, b: Object.fromEntries(bosses.map(b => [b.id, { n: b.name, l: b.lvl, al: false, ls: old, ch: now - 8 * 3600000, dl: now - 8 * 3600000, dh: now - 8 * 3600000, pg: 1 }])) },
      rbHuntIdle: now + 5 * 60000, rbIdleMark: { lvl: 75, pots: 1000000, t: now, sampleT: 0, kills: 0, adena: 30000000 },
      rbDpsSample: null, shopT: 0, adenaSeen: { v: 30000000, t: now }, petFull: { status: 'active', expiresAt: expires, nextCheckAt: 0 }, actionOwner: null,
    } });
  }, { expires, bosses });
  await f.h.g.p.reload();
  await until(() => f.h.g.core('!!L2V7Modules.raid && !!L2V7Modules.rbtimer'));
  await f.h.popup.reload();
  await f.h.g.p.bringToFront();
  return { ...f, A, release, close: async () => { release(); await f.close(); } };
}

async function test(kind) {
  const f = await fixture(kind);
  try {
    assert.equal(await f.h.g.p.locator('.l2-map-mob-link').count(), 0, 'в исходной точке появились обычные мобы');
    assert.equal(await f.h.g.p.locator('.l2-map-mob-pin--raid').count(), 1);
    await f.start();
    // 20.54: сначала полный свежий обход при Старте, первый фоновый опрос — в обычном ритме тура (не чаще раза в 30 с).
    await until(() => f.A.listReads > 0, 60000);
    if (kind === 'revived') {
      await until(() => f.S.wins.length >= 1, 45000);
      await f.h.click('stop');
      assert.equal(f.S.teleports.length, 1, 'ожидается единственный перелёт к воскресшему РБ');
      assert.equal(f.S.teleports[0], bosses[0].id);
      assert.equal(f.S.wins[0], bosses[0].id);
      assert.equal(f.events.filter(event => event.kind === 'engage')[0]?.id, bosses[0].id);
      assert.equal(f.A.mapLoads, f.A.mapAtPoll, 'пустая карта перезагружалась вместо прямого опроса');
    } else if (kind === 'stop') {
      await until(() => f.A.held);
      await f.h.click('stop');
      await until(() => f.h.g.core('!on'));
      f.release();
      await delay(2500);
      assert.equal(await f.h.g.core('on'), false);
      assert.equal(f.A.mapLoads, f.A.mapAtPoll);
      assert.equal(f.A.paths.slice(f.A.pathsAtPoll).includes('/rb-bosses.html'), false, 'поздний ответ открыл маршрут после Stop');
    } else {
      await until(() => f.h.g.core('on && rt.rbHuntIdle > Date.now() && location.pathname === "/map.html"'));
      const mapWait = f.A.mapLoads, pathsWait = f.A.paths.length;   // 20.54: ожидание на пустой карте после свежего обхода
      await delay(3000);
      const state = await f.h.g.core('({on,status:rt.status,idle:rt.rbHuntIdle,list:rt.rbList})');
      assert.equal(state.on, true, 'ожидание само остановило бота');
      assert.ok(state.idle > Date.now(), 'ожидание снято без подходящего РБ');
      assert.doesNotMatch(state.status || '', /фармлю мобов/i, 'бот обещает фармить отсутствующих мобов');
      assert.equal(f.A.listReads, 1, 'нет ограничителя частоты фонового опроса');
      assert.equal(f.A.mapLoads, mapWait, 'пустая карта перезагружалась во время ожидания');
      assert.equal(f.A.paths.slice(pathsWait).includes('/rb-bosses.html'), false, 'неудачный опрос начал обход страниц');
      assert.equal(f.A.paths.slice(f.A.pathsAtPoll).includes('/rb-bosses.html'), false, 'опрос начал обход страниц');
      assert.equal(Object.values(state.list).some(b => b.alive), false);
      await f.h.click('stop');
    }
    if (kind !== 'revived') {
      assert.equal(f.S.teleports.length, 0, 'ожидание или отменённый запрос запустили оплату');
      assert.equal(f.events.some(event => event.kind === 'engage'), false);
    }
    assert.equal(f.S.buffPosts, 0, 'опрос РБ купил бафф суммона');
    assert.equal(f.S.buyPosts, 0, 'опрос РБ купил расходники');
    assert.equal(f.events.some(event => ['pet-buff', 'hero-buff', 'buy', 'city', 'restore'].includes(event.kind)), false, 'опрос начал постороннюю подготовку');
    assert.deepEqual(f.routeErrors.map(error => error.message), []);
    assert.deepEqual(f.h.errors, []);
    console.log('PASS raid idle refresh ' + kind, JSON.stringify({ polls: f.A.polls, mapLoads: f.A.mapLoads, paths: f.A.paths, events: f.events }));
  } catch (error) {
    console.error('DIAG raid idle refresh ' + kind, JSON.stringify({ idle: f.A, journey: await f.diag() }));
    throw error;
  } finally { await f.close(); }
}

(async () => { for (const kind of (process.env.RAID_IDLE_CASES || 'revived,dead,error,stop').split(',')) await test(kind); })().catch(error => { console.error(error.stack); process.exitCode = 1; });
