'use strict';
// Лог 15.10 18:35–18:37: настоящий MV3/main, локальная игра с редиректом Ashen.
// Подменяются только HTML и ответы сервера. Функции расширения выполняются штатно.
const assert = require('node:assert/strict');
const path = require('node:path');
const { journey, bosses, until, delay } = require(path.join(process.env.L2_TEST_ROOT || path.join(__dirname, '..'), 'tests/v1024-journey-fixture.cjs'));

async function fixture(kind) {
  const f = await journey({ travel: true });
  const A = { cityId: 'ashen_bastion', cityPosts: 0, ashenReads: 0, cityReads: 0, mapRedirects: 0, heldRead: false, paths: [], events: [] };
  let releaseCity, releaseRead;
  const cityGate = new Promise(resolve => { releaseCity = resolve; });
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  const expires = Date.now() + 5 * 3600000;
  f.S.shots = 1000;
  f.S.heroBuffs = [{ skillId: 1059, level: 3, expiresAtMs: expires }];
  f.S.petBuffs = Array.from({ length: 26 }, (_, i) => ({ skillId: 1200 + i, level: 2, expiresAtMs: expires }));
  const character = () => ({ ...f.char(), cityId: A.cityId });
  const common = () => `<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><div id="character-profession">Human Warlock</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">10000</span><span id="l2-hud-hp-max">10000</span><span id="l2-hud-mp-cur">1000</span><span id="l2-hud-mp-max">1000</span><div id="l2-hud-active-buffs"><span class="l2-hud-active-buff" data-skill-id="1059" data-expires-at="${expires}" title="Empower Lv.3"></span></div>`;
  function page(p) {
    const body = p === '/ashen-bastion.html'
      ? '<h1>Ashen Bastion</h1><a id="ashen-exit-city" href="/city.html">Вийти в місто (Aden) →</a>'
      : p === '/city.html'
        ? '<div class="l2-town-miru" data-city-enter-busy="1"><div id="city-services" data-city-enter-busy="1" aria-busy="true"></div><div id="city-load-err" hidden></div></div>'
        : '<div id="map-mob-list"></div>';
    return `<!doctype html><meta charset="utf-8">${common()}${body}<script>
      localStorage.setItem('token','fixture');
      (async()=>{
        while(!window.__l2botHook) await new Promise(resolve=>setTimeout(resolve,20));
        const c=(await(await fetch('/character')).json()).character;
        await fetch('/game/tvt');
        if(location.pathname==='/map.html' && c.cityId==='ashen_bastion') { location.href='/ashen-bastion.html'; return; }
        if(location.pathname==='/city.html') {
          const response=await fetch('/game/world/enter-city',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:c.revision})});
          const result=await response.json();
          if(result.character?.cityId==='l2dop_aden') {
            document.querySelector('.l2-town-miru').removeAttribute('data-city-enter-busy');
            document.getElementById('city-services').removeAttribute('data-city-enter-busy');
            document.getElementById('city-services').setAttribute('aria-busy','false');
          }
        }
      })().catch(error=>{throw error;});
    </script>`;
  }
  await f.h.ctx.route('https://l2wap.com/**', async r => {
    try {
      const req = r.request(), p = new URL(req.url()).pathname;
      const json = j => r.fulfill({ contentType: 'application/json', body: JSON.stringify(j) }).catch(() => {});
      if (p === '/ashen-bastion.html' || p === '/city.html' || p === '/map.html' && A.cityId === 'ashen_bastion') {
        A.paths.push(p);
        if (p === '/map.html') A.mapRedirects++;
        return r.fulfill({ contentType: 'text/html; charset=utf-8', body: page(p) });
      }
      if (p === '/character') {
        const ownRead = !!req.headers().authorization;
        const inCity = req.frame().url().includes('/city.html');
        if (inCity && ownRead) {
          A.cityReads++;
          if (A.cityId === 'ashen_bastion') A.ashenReads++;
          if (kind !== 'full' && !A.heldRead) { A.heldRead = true; await readGate; }
        }
        return json({ character: character() });
      }
      if (p === '/game/world/enter-city') {
        const body = req.postDataJSON();
        assert.equal(body.expectedRevision, f.S.revision);
        A.cityPosts++;
        assert.equal(A.cityPosts, 1, 'повторный запрос входа в город');
        const state = (await f.h.get(['rt'])).rt;
        assert.equal(state.rbHunt.step, 'exit', 'выход начат без сохранённого этапа');
        assert.equal(state.rbHunt.id, bosses[0].id, 'потеряна выбранная цель');
        assert.equal(state.actionOwner?.key, 'rbHunt', 'выход не получил владельца маршрута');
        assert.ok(state.rbHunt.exitClickAt > 0, 'нажатие выхода не сохранено до перехода');
        A.events.push('city-request');
        await cityGate;
        A.cityId = 'l2dop_aden';
        f.S.city = true;
        f.S.revision++;
        A.events.push('city-accepted');
        return json({ character: character() });
      }
      if (p === '/game/raid-boss/teleport') {
        assert.equal(A.cityId, 'l2dop_aden', 'оплата до подтверждённого выхода из Ashen');
        A.events.push('teleport');
      }
      return r.fallback();
    } catch (error) {
      f.routeErrors.push(error);
      return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_assertion', message: error.message }) }).catch(() => {});
    }
  });
  await f.h.sw.evaluate(async expires => {
    const { rt } = await chrome.storage.local.get(['rt']);
    await chrome.storage.local.set({ rt: { ...rt, petFull: { status: 'active', expiresAt: expires, nextCheckAt: 0 }, adenaSeen: { v: 30000000, t: Date.now() } } });
  }, expires);
  await f.h.g.p.goto('https://l2wap.com/ashen-bastion.html');
  await until(() => f.h.g.core('!!L2V7Modules.warlock'));
  await f.h.popup.reload();
  return { ...f, A, releaseCity, releaseRead, close: async () => { releaseCity(); releaseRead(); await f.close(); } };
}

async function test(kind) {
  const f = await fixture(kind);
  try {
    await f.start();
    await until(() => f.A.cityPosts === 1, 30000);
    if (kind === 'full') {
      await until(() => f.A.ashenReads > 0, 10000);
      assert.equal(f.S.teleports.length, 0, 'URL города принят за подтверждение входа');
      assert.equal(f.A.mapRedirects, 0, 'бот снова отправлен на карту из Ashen');
      assert.equal((await f.h.get(['rt'])).rt.rbHunt.step, 'exit');
      await delay(750);
      assert.equal(f.S.teleports.length, 0);
      f.releaseCity();
      await until(() => f.S.wins.length >= 1, 45000);
      await f.h.click('stop');
      assert.equal(f.S.teleports[0], bosses[0].id);
      assert.equal(f.S.wins[0], bosses[0].id);
      assert.equal(f.events.filter(x => x.kind === 'engage')[0].id, bosses[0].id);
      assert.ok(f.A.events.indexOf('city-accepted') < f.A.events.indexOf('teleport'));
      assert.equal(f.A.paths.filter(p => p === '/ashen-bastion.html').length, 1);
      assert.equal(f.A.paths.filter(p => p === '/city.html').length, 1);
    } else {
      await until(() => f.A.heldRead, 10000);
      if (kind === 'stop') {
        await f.h.click('stop');
        await until(() => f.h.g.core('!on'));
      } else {
        await f.h.click('tasksToggle');
        await until(() => f.h.g.core('autonomyMode()==="tasks"'));
      }
      f.releaseCity();
      f.releaseRead();
      await delay(2500);
      assert.equal(f.S.teleports.length, 0, 'устаревший ответ города запустил оплату');
      assert.equal(f.events.some(x => x.kind === 'engage'), false);
      assert.equal(f.A.mapRedirects, 0);
      if (kind === 'mode') await f.h.click('stop');
    }
    assert.deepEqual(f.routeErrors.map(error => error.message), []);
    assert.deepEqual(f.h.errors, []);
    console.log('PASS raid Ashen ' + kind, JSON.stringify({ cityPosts: f.A.cityPosts, ashenReads: f.A.ashenReads, cityReads: f.A.cityReads, mapRedirects: f.A.mapRedirects, paths: f.A.paths, events: f.A.events, raid: f.events }));
  } catch (error) {
    console.error('DIAG raid Ashen ' + kind, JSON.stringify({ ashen: f.A, journey: await f.diag() }));
    throw error;
  } finally { await f.close(); }
}
(async () => { for (const kind of (process.env.ASHEN_CASES || 'full,stop,mode').split(',')) await test(kind); })().catch(error => { console.error(error.stack); process.exitCode = 1; });
