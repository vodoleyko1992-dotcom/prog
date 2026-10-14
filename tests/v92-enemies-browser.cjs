'use strict';
// 9.2 «☠ Лист врагов»: браузерный смоук (node tests/v92-enemies-browser.cjs; CHROMIUM=…). Настоящие hook.js и скрипты расширения на подставной
// https://l2wap.com: 1) ответ /character с pvpDefeat (настоящий, Dremia 11.10 17:39) → враг в листе (через hook → content → modules/enemies);
// 2) /game/map/sync со списком игроков — Dremia на локации → бот жмёт его ник в списке игроков карты (кнопка игры «Атакувати»), уходит
// POST /game/battle/pvp/start; 3) меню «PvP» → «☠ Лист врагов» на 760 и 375 px без горизонтальной прокрутки
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mf = JSON.parse(read('manifest.json')), scripts = mf.content_scripts.find(e => e.js.includes('content.js')).js;
const py = read('tests/v715-ui-browser.py');
let mock = py.slice(py.indexOf('mock=r"""') + 9); mock = mock.slice(0, mock.indexOf('"""'));
const DID = '6f573aad-08ee-4713-9d76-33f5fd4afc93';
const DEFEAT = { killerName: 'Dremia', killerCharacterId: DID, deathEventId: 'e975b1c8-07c7-4991-8c40-aab130f2bbc6', scope: 'world', playerDied: true, messageUk: 'Вас вбив гравець [Dremia]!',
  fullLog: ['На вас напали: [Dremia].', '[Dremia] −2444 HP (Буря).', '[Dremia] −2996 HP (Вампірні кігті).', '[Dremia] −2340 HP (Іскра тіні).', 'Noblesse Blessing зберіг ваші бафи після смерті.', 'Вас вбив гравець [Dremia]!'] };
const coreMock = `(() => { const data = { on: false, cfg: { rec: false, autoLearn: false, enemyMinHits: 0 }, rt: { char: 'Warlock' } };
  window.chrome = { runtime: { id: 'mock', lastError: null, getManifest: () => ({ version: '${mf.version}' }), getURL: p => 'https://l2wap.com/__ext/' + (p || ''), onMessage: { addListener() {} },
    sendMessage(msg, cb) { let reply = null; if (msg.cmd === 'tabId') reply = 3; if (msg.cmd === 'statePatch') { Object.assign(data.rt, msg.patch || {}); Object.assign(data.cfg, msg.cfgPatch || {}); reply = { ok: true }; }
      if (typeof cb === 'function') { queueMicrotask(() => cb(reply)); return; } return Promise.resolve(reply); } },
    storage: { onChanged: { addListener() {} }, local: { get: async keys => Object.fromEntries([].concat(keys).map(k => [k, data[k]])), set: async v => Object.assign(data, v) } } };
  localStorage.setItem('token', 'tok-123'); })();`;
// разметка списка игроков — как у mapHeroRowRender.js игры (11.10): li[data-character-id], кнопка ника .l2-map-hero-name-link--battle
const MAP = `<html><body><div id="l2-hud-legacy-name"><span class="l2-player-identity__nick">Warlock</span></div><span id="l2-hud-legacy-lvl">61</span>
  <span id="l2-hud-hp-cur">9000</span><span id="l2-hud-hp-max">9000</span>
  <section id="map-hero-section"><ul id="map-hero-list">
    <li class="l2-map-hero-item" data-character-id="c1"><div class="l2-map-hero-item__main"><div class="l2-map-hero-item__title"><span class="l2-map-hero-name-link">Peaceful</span><span class="l2-map-hero-level"> · ур. 60</span></div></div></li>
    <li class="l2-map-hero-item" data-character-id="${DID}"><div class="l2-map-hero-item__main"><div class="l2-map-hero-item__title"><button type="button" class="l2-map-hero-name-link--battle" title="Атакувати Dremia"
      onclick="window.__pvp=(window.__pvp||0)+1;fetch('/game/battle/pvp/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetCharacterId:'${DID}',expectedRevision:5})})"><span class="l2-pvp-nick--pk">Dremia</span></button><span class="l2-map-hero-level"> · ур. 61</span></div></div></li>
  </ul></section></body></html>`;
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const posts = [];
  {
    const p = await b.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.route('https://l2wap.com/**', async r => {
      const u = new URL(r.request().url());
      if (u.pathname.startsWith('/__ext/')) return r.fulfill({ status: 200, contentType: 'application/json', body: read(u.pathname.slice(7)) });
      if (r.request().method() === 'POST') posts.push([u.pathname, r.request().postData()]);
      const body = u.pathname === '/character' ? { character: { id: 'me', name: 'Warlock', revision: 5, hp: 1874, maxHp: 6220, pvpDefeat: DEFEAT, currentZoneNameUk: 'Монастир Тиші' }, pvpIncoming: [] }
        : u.pathname === '/game/map/sync' ? { changed: true, around: { nearestLabelUk: 'Монастир Тиші', nearbyHeroes: [
          { characterId: 'c1', name: 'Peaceful', level: 60, pvpNickColor: null, battleOnNameClick: false, showPkButton: false },
          { characterId: DID, name: 'Dremia', level: 61, pvpNickColor: 'pk', nickColor: '#e85840', battleOnNameClick: true, showPkButton: true }] }, pvpIncoming: [], pvpDefeat: null }
        : u.pathname === '/game/battle/return-to-town' ? { character: { id: 'me', name: 'Warlock', revision: 6, hp: 9000, maxHp: 9000 } }
        : u.pathname === '/game/battle/pvp/start' ? { ok: true, character: { id: 'me' } } : null;
      if (body) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return r.fulfill({ status: 200, contentType: 'text/html', body: MAP });
    });
    await p.goto('https://l2wap.com/map.html');
    await p.evaluate(coreMock);
    await p.addScriptTag({ content: read('hook.js') });
    for (const s of scripts) await p.addScriptTag({ content: read(s) });
    const res = await p.evaluate(async () => {
      on = true; tabOwner = true; leaseEpoch = 'e';
      const wait = async f => { for (let i = 0; i < 50 && !f(); i++) await new Promise(r => setTimeout(r, 50)); return f(); };
      await fetch('/character'); await wait(() => rt.enemies && Object.keys(rt.enemies).length);
      const after1 = JSON.parse(JSON.stringify(rt.enemies || {}));
      // Мировая смерть теперь блокирует обычную охоту до принятого игрой возврата.
      const blocked = L2V7Modules.pvp.pending();
      await fetch('/game/battle/return-to-town', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 5 }) });
      await wait(() => rt.pvpRecovery?.phase === 'returned');
      await L2V7Modules.pvp.recoveryStep();
      const closed = !L2V7Modules.pvp.pending() && rt.revive?.revived === true;
      // Здесь карта с уже полным HP; полный маршрут статуя/баффы/восстановление покрыт отдельным MV3 smoke.
      await setRt({ revive: null });
      await fetch('/game/map/sync'); await new Promise(r => setTimeout(r, 200));
      const acted = await L2V7Modules.enemies.step();
      await wait(() => rt.enemyHunt);
      await new Promise(r => setTimeout(r, 300));
      return { after1, blocked, closed, acted, pvp: window.__pvp || 0, hunt: rt.enemyHunt, e: rt.enemies };
    });
    const e1 = res.after1[DID], e2 = res.e?.[DID];
    const ok = res.blocked && res.closed && posts.some(x => x[0] === '/game/battle/return-to-town') && e1?.name === 'Dremia' && e1.kills === 1 && e1.hitMax === 2996 && res.acted === true && res.pvp === 1 && res.hunt?.id === DID && e2?.lvl === 61
      && posts.some(x => x[0] === '/game/battle/pvp/start' && x[1].includes(DID)) && !errors.length;
    if (!ok) { console.error('FAIL 1-2', JSON.stringify({ res, posts, errors })); process.exit(1); }
    console.log('PASS browser: pvpDefeat in /character → Dremia in the enemy list (3 hits, max 2996); Dremia in /game/map/sync → nick button pressed, POST /game/battle/pvp/start');
    await p.close();
  }
  // 3. меню
  const rtMenu = { char: 'Warlock', lvl: 61, classCur: { prof: 'human_warlock', slot: 0 }, classBranch: 'mystic',
    enemies: { [DID]: { id: DID, name: 'Dremia', lvl: 61, kills: 2, w: 1, l: 1, hitMax: 2996, lastKill: Date.now() - 600000, zone: 'Монастир Тиші', seenT: Date.now() - 120000 } } };
  for (const w of [760, 375]) {
    const page = await b.newPage({ viewport: { width: w, height: 1100 } }); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('about:blank');
    const m = mock.replace("rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}}", `rt:${JSON.stringify(rtMenu)}`);
    if (m === mock) { console.error('FAIL: popup mock not patched'); process.exit(1); }
    await page.evaluate(m);
    const html = read('popup.html').replace(/<link rel="stylesheet" href="[^"]+">/g, '').replace(/<script src="[^"]+"><\/script>/g, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const s of ['ui-v7.css', 'ui-game.css']) await page.addStyleTag({ content: read(s) });
    // 14.10: полные зависимости actual popup, враги перенесены в PvP.
    for (const j of [...read('popup.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1])) await page.addScriptTag({ content: read(j) });
    await page.evaluate(() => document.querySelector('nav button[data-tab="pvp"]').click());
    await page.waitForTimeout(1000);
    const t = await page.$eval('#enemyBox', e => e.innerText), on = await page.$eval('#enemyHunt', e => e.checked), flag = await page.$eval('#enemyFlagOnly', e => e.checked);
    const hits = await page.$eval('#enemyMinHits', e => e.value), vis = await page.$eval('#enemyBox', e => e.getBoundingClientRect().height > 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const ok = /Dremia \(61 ур\.\): убил нас 2×, последний раз 10 мин назад \(Монастир Тиші\) · ответ: побед 1, поражений 1 · удар до 2/.test(t) && /Не трогать/.test(t) && on && flag && hits === '3' && vis && !overflow && !errs.length;
    if (!ok) { console.error('FAIL 3', JSON.stringify({ w, t, on, flag, hits, vis, overflow, errs })); process.exit(1); }
    if (process.env.SHOT) { await page.$eval('#tab-enemies', e => e.scrollIntoView()); await page.screenshot({ path: process.env.SHOT + '-' + w + '.png' }); }
    console.log(`PASS browser ${w}px: «PvP» → «☠ Лист врагов»: Dremia (kills, wins/losses, max hit), buttons, settings on by default, no sideways scroll`);
    await page.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
