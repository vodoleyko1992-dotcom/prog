'use strict';
// 9.0 (катакомбы): браузерный смоук с НАСТОЯЩИМ кодом страницы подземелья игры (dungeon.js + dungeon-mob-list-click.js, берутся с l2wap.com
// при запуске; нет сети — пропуск) и живым ответом /game/dungeon/view (Catacomb of the Witch, 190 мобов, снят 11.10, без чужих героев).
// hook.js в мире страницы отдаёт весь список (поле dm), модуль dungeons выбирает моба для героя 66 ур. (страница 8 из 13), листает «›»
// пейджер игры, жмёт свежую ссылку — игра шлёт POST /game/battle/start с этим spawnId. Плюс alert() на странице подземелья не блокирует.
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const view = read('tests/fixtures-dungeon-view-90.json');
const BODY = `<div id="l2-hud-legacy-lvl">66</div><p class="err" id="dungeon-load-err" hidden></p><div id="dungeon-content" hidden><h1 id="dungeon-title">—</h1><p id="dungeon-sub"></p>
<div id="dungeon-mob-pager" hidden><button type="button" id="dungeon-mob-page-prev">‹</button><span id="dungeon-mob-page-ind"></span><button type="button" id="dungeon-mob-page-next">›</button></div>
<ul id="dungeon-mob-list"></ul><section id="dungeon-hero-section" hidden><ul id="dungeon-hero-list"></ul></section></div>
<button id="dungeon-refresh" type="button">Обновить</button><div id="dungeon-mob-modal" hidden><a id="dungeon-mob-modal-battle" href="#">У бій</a></div>`;
// заглушка общего кода игры (common.js): токен, снимок персонажа, authFetch = fetch, переход — запоминаем
const L2STUB = `window.L2 = { tr: (k, f) => f, token: () => 'x', lastSnapshot: () => ({ revision: 7, level: 66 }), authFetch: (u, o) => fetch(u, o),
  playerMessageOr: (j, f) => (j && (j.messageUk || j.error)) || f, navigateToPage: u => { window.__nav = u; return true; }, applyCharacterSnapshot() {}, resyncCharacterWhenRequired: async () => null };
window.L2DungeonMobModalDrops = { kindModalUk: k => k, renderDropList() {} };`;
async function gameJs(f) { try { const r = await fetch('https://l2wap.com/' + f); return r.ok ? await r.text() : null; } catch (e) { return null; } }
(async () => {
  const [dj, cj] = await Promise.all([gameJs('dungeon.js'), gameJs('dungeon-mob-list-click.js')]);
  if (!dj || !cj) { console.log('SKIP: game JS (dungeon.js) unavailable — no network'); return; }
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errors = [], starts = []; p.on('pageerror', e => errors.push(String(e)));
  await p.route('**/*', async r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/game/dungeon/view') return r.fulfill({ contentType: 'application/json', body: view });
    if (u.pathname === '/game/battle/start') { starts.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    if (u.pathname === '/dungeon.html') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><script>${read('hook.js')}</script></head><body>${BODY}<script>${L2STUB}</script><script>${cj}</script><script>${dj}</script></body></html>` });
    return r.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await p.goto('https://l2wap.com/dungeon.html?dungeonId=catacomb_of_the_witch');
  await p.waitForSelector('#dungeon-mob-list a', { timeout: 10000 });
  const res = await p.evaluate(async src => {
    // как content.js: сообщения hook.js → список подземелья; alert на этой странице → сообщение
    let N = null, A = null;
    addEventListener('message', e => { if (e.data?.__l2bot === 'net' && e.data.dm) N = { ...e.data.dm, t: Date.now() }; if (e.data?.__l2bot === 'alert') A = e.data.text; });
    // 20.6: актуальный dungeon.js больше не опрашивает view каждые5с; запрос через native Refresh.
    document.getElementById('dungeon-refresh').click();
    const t0 = Date.now(); while (!N && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 100));   // ждём ответ явного обновления
    (0, eval)(src);
    const rt = {}, fired = [], logs = [];
    const sleep = ms => new Promise(r => setTimeout(r, Math.min(ms, 300)));
    const waitX = async (f, ms = 3000, step = 100) => { const e = Date.now() + ms; for (;;) { const v = f(); if (v || Date.now() > e) return v || null; await sleep(step); } };
    const env = { CAT_URL: '/catacombs.html', CAT_LIST: { catacomb_of_the_witch: ['Catacomb of the Witch', 60, 72] }, cfg: { catDungeon: 'auto', lvlBelow: 3, lvlAbove: 99 }, rt, on: true,
      heroLvl: () => 66, isMap: () => false, isBattle: () => !!window.__nav && /battle/.test(window.__nav), setStatus() {}, sleep, pause: async () => {}, rec: (...a) => logs.push(a.slice(1).join(' ')),
      setRt: async x => Object.assign(rt, x), idle: async () => {}, shown: el => !!el && !el.hidden && !el.closest('[hidden]'), noticeText: () => '', NET_ERR: { t: 0 },
      waitX, waitFor: waitX, $q: s => document.querySelector(s), dungNet: () => N,
      fire: el => { fired.push(el.id || el.getAttribute('href') || el.tagName); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; } };
    const M = globalThis.L2V7Factories.dungeons(env);
    await M.catHunt('catacomb_of_the_witch');
    await sleep(300);
    alert('Тест окна'); await sleep(200);
    return { n: N?.mobs?.length, id: N?.id, fired, nav: window.__nav, catLv: rt.catLv, page: document.getElementById('dungeon-mob-page-ind').textContent, alert: A, logs };
  }, read('modules/dungeons.js'));
  await b.close();
  const sid = starts[0]?.spawnId || '', mob = JSON.parse(view).dungeon.mobs.find(m => m.id === sid);
  const ok = res.n === 190 && res.id === 'catacomb_of_the_witch' && mob && mob.level === 67 && starts.length === 1 && res.fired.filter(x => x === 'dungeon-mob-page-next').length >= 7
    && /^\/battle\.html\?spawnId=/.test(res.nav || '') && res.catLv?.catacomb_of_the_witch?.lo === 60 && res.catLv.catacomb_of_the_witch.hi === 72 && res.alert === 'Тест окна' && !errors.length;
  console.log((ok ? 'PASS' : 'FAIL') + ': real game dungeon page — full list via hook (190), hero 66 → level-67 mob on page 8: paged with the game pager, game sent battle/start for it; alert() does not block'
    + (ok ? ` (${mob.name} ${sid}, ${res.page})` : ' ' + JSON.stringify({ res, starts, errors })));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
