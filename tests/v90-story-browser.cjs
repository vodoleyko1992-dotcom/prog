'use strict';
// 9.0 (квесты сабкласса/Noblesse): браузерный смоук (node tests/v90-story-browser.cjs; CHROMIUM=…). Настоящие скрипты расширения
// на подставной https://l2wap.com: 1) свой GET /game/story-quests/* с токеном страницы → rt.story, часть готова → поход;
// 2) страница квеста далеко от NPC — цена телепорта из /game/teleport/locations, кнопка «Телепорт» нажата; 3) у NPC — «Завершить
// частью» нажата, поход закрыт, возврат на точку; 4) меню: «Цели» → «Сабкласс и Noblesse» на 760 и 375 px без горизонтальной прокрутки
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mf = JSON.parse(read('manifest.json')), scripts = mf.content_scripts.find(e => e.js.includes('content.js')).js;
const py = read('tests/v715-ui-browser.py');
let mock = py.slice(py.indexOf('mock=r"""') + 9); mock = mock.slice(0, mock.indexOf('"""'));
const quest = { part: 1, totalParts: 4, completed: false, active: true, subclassLevel: 52, minLevel: 50, atNpc: false,
  npc: { id: 'noblesse_virgil', name: 'Virgil', teleportId: 'rune' }, targets: [{ name: 'Vanor Silenos Chieftain', level: 50, have: 100, need: 100, teleportId: 'coliseum' }, { name: 'Varnish', have: 100, need: 100 }],
  actions: { canAccept: false, canAdvance: true } };
const coreMock = `(() => { const data = { on: false, cfg: { rec: false, autoLearn: false }, rt: { char: 'Warlock' } };
  window.chrome = { runtime: { id: 'mock', lastError: null, getManifest: () => ({ version: '${mf.version}' }), getURL: p => 'https://l2wap.com/__ext/' + (p || ''), onMessage: { addListener() {} },
    sendMessage(msg, cb) { let reply = null; if (msg.cmd === 'tabId') reply = 3; if (msg.cmd === 'statePatch') { Object.assign(data.rt, msg.patch || {}); Object.assign(data.cfg, msg.cfgPatch || {}); reply = { ok: true }; }
      if (typeof cb === 'function') { queueMicrotask(() => cb(reply)); return; } return Promise.resolve(reply); } },
    storage: { onChanged: { addListener() {} }, local: { get: async keys => Object.fromEntries([].concat(keys).map(k => [k, data[k]])), set: async v => Object.assign(data, v) } } };
  localStorage.setItem('token', 'tok-123'); })();`;
const HUD = '<div id="l2-hud-legacy-name"><span class="l2-player-identity__nick">Warlock</span></div>';
// разметка страницы квеста — как у /noblesse-quest.html игры (ids и data-атрибуты из /noblesse-quest.js 11.10)
const QPAGE = btn => `<html><body>${HUD}<main id="noblesse-quest-main"><h2 id="noblesse-quest-title">Possessor of a Precious Soul · 1/4</h2><div id="noblesse-quest-body"></div>
  <p id="noblesse-quest-err" hidden></p><div id="noblesse-quest-actions">${btn}</div></main></body></html>`;
const PAGES = {
  '/map.html': `<html><body>${HUD}</body></html>`,
  far: QPAGE('<button type="button" class="l2-town-btn" data-noblesse-action="teleport" data-noblesse-target="rune" onclick="window.__tp=(window.__tp||0)+1">Телепорт до NPC</button>'),
  near: QPAGE('<button type="button" class="l2-town-btn" data-noblesse-action="advance" onclick="window.__adv=(window.__adv||0)+1;this.remove()">Завершити частину</button>'),
};
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const auth = [];
  const run = async (pagePath, html, fn) => {
    const p = await b.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.route('https://l2wap.com/**', async r => {
      const u = new URL(r.request().url());
      if (u.pathname.startsWith('/__ext/')) return r.fulfill({ status: 200, contentType: 'application/json', body: read(u.pathname.slice(7)) });
      if (u.pathname.startsWith('/game/') || u.pathname === '/character') {
        auth.push([u.pathname, r.request().headers().authorization || '']);
        const body = u.pathname === '/game/story-quests/noblesse' ? { quest } : u.pathname === '/game/story-quests/subclass' ? { quest: { stage: 'completed', completed: true, bosses: [], actions: {} } }
          : u.pathname === '/game/teleport/locations' ? { locations: [{ teleportId: 'rune', labelEn: 'Rune Township', adenaCost: 20000, baseAdenaCost: 20000, vipFreeApplied: false }] } : {};
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      return r.fulfill({ status: 200, contentType: 'text/html', body: html || PAGES['/map.html'] });
    });
    await p.goto('https://l2wap.com' + pagePath);
    await p.evaluate(coreMock);
    for (const s of scripts) await p.addScriptTag({ content: read(s) });
    const res = await p.evaluate(fn);
    await p.close();
    return { res, errors };
  };
  // 1. опрос квестов — с токеном страницы; часть готова → поход к NPC
  const r1 = await run('/map.html', null, async () => { on = true; tabOwner = true; leaseEpoch = 'e'; await L2V7Modules.story.storyTick(true);
    const busy = await L2V7Modules.story.storyStep(); return { st: rt.story, busy, job: rt.storyJob }; });
  const hdr = auth.filter(a => /^\/game\/story-quests\//.test(a[0]));
  if (!(r1.res.st?.noblesse?.ready === true && r1.res.st.subclass?.completed === true && r1.res.busy === true && r1.res.job?.kind === 'noblesse' && hdr.length === 2 && hdr.every(a => a[1] === 'Bearer tok-123') && !r1.errors.length)) {
    console.error('FAIL 1', JSON.stringify({ r1, auth })); process.exit(1); }
  console.log('PASS browser: story quests polled with the page token (Bearer), part 1 ready → trip to the NPC');
  // 2. страница квеста, NPC не рядом: цена Rune 20 000 ≤ лимита 100 000 → «Телепорт» нажат один раз
  const r2 = await run('/noblesse-quest.html', PAGES.far, async () => { on = true; tabOwner = true; leaseEpoch = 'e';
    await setRt({ storyJob: { kind: 'noblesse', key: 'noblesse:1', why: 'часть 1/4', home: 'coliseum', t: Date.now() } });
    await L2V7Modules.story.storyStep(); return { tp: window.__tp || 0, job: rt.storyJob }; });
  if (!(r2.res.tp === 1 && r2.res.job?.tpT && !r2.errors.length)) { console.error('FAIL 2', JSON.stringify(r2)); process.exit(1); }
  console.log('PASS browser: far from Virgil → teleport price read (Rune 20 000 within the limit), «Телепорт» pressed once');
  // 3. у NPC: «Завершити частину» нажата, поход закрыт, обратно на точку
  const r3 = await run('/noblesse-quest.html', PAGES.near, async () => { on = true; tabOwner = true; leaseEpoch = 'e';
    await setRt({ storyJob: { kind: 'noblesse', key: 'noblesse:1', why: 'часть 1/4', home: 'coliseum', t: Date.now(), tpT: Date.now() } });
    await L2V7Modules.story.storyStep(); return { adv: window.__adv || 0, job: rt.storyJob, log: rt.storyLog, zoneGo: rt.zoneGo }; });
  if (!(r3.res.adv === 1 && r3.res.job === null && r3.res.log?.[0]?.ok === true && r3.res.zoneGo?.id === 'coliseum' && !r3.errors.length)) { console.error('FAIL 3', JSON.stringify(r3)); process.exit(1); }
  console.log('PASS browser: at Virgil — «Завершити частину» pressed, trip closed, back to the hunting spot');
  // 4. меню: «Цели» — блок «Сабкласс и Noblesse» на 760 и 375 px без горизонтальной прокрутки
  const rtMenu = { char: 'Warlock', lvl: 61, classCur: { prof: 'human_warlock', slot: 0 }, story: { noblesse: { part: 1, of: 4, active: true, targets: [{ name: 'Vanor Silenos Chieftain', have: 37, need: 100 }], npc: 'Virgil' },
    subclass: { stage: 'hunt_bosses', active: true, bosses: [{ name: 'Shilen\'s Messenger Cabrio', lvl: 70, done: true }, { name: 'Kernon', lvl: 75, done: false }], npc: 'Maestro Reorin' } } };
  const m = mock.replace("rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}}", `rt:${JSON.stringify(rtMenu)}`);
  if (m === mock) { console.error('FAIL 4: popup mock not patched'); process.exit(1); }
  for (const w of [760, 375]) {
    const page = await b.newPage({ viewport: { width: w, height: 1100 } }); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('about:blank');
    await page.evaluate(m);
    const html = read('popup.html').replace(/<link rel="stylesheet" href="[^"]+">/g, '').replace(/<script src="[^"]+"><\/script>/g, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const c of ['ui-v7.css', 'ui-game.css']) await page.addStyleTag({ content: read(c) });
    for (const j of ['popup.js', 'ui-v7.js']) await page.addScriptTag({ content: read(j) });
    await page.evaluate(() => document.querySelector('nav button[data-tab="hunt"]').click());
    await page.waitForTimeout(1000);
    const t = await page.$eval('#storyBox', e => e.innerText), on = await page.$eval('#storyTurnIn', e => e.checked), max = await page.$eval('#storyTpMax', e => e.value);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const ok = /Класс: warlock/.test(t) && /✓ Shilen's Messenger Cabrio 70, ★ Kernon 75/.test(t) && /часть 1\/4: ★ Vanor Silenos Chieftain 37\/100/.test(t) && on === true && max === '100000' && !overflow && !errs.length;
    if (!ok) { console.error('FAIL 4', JSON.stringify({ w, t, on, max, overflow, errs })); process.exit(1); }
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-' + w + '.png', fullPage: true });
    console.log(`PASS browser ${w}px: «Цели» — «Сабкласс и Noblesse» (class, quest RBs ✓/★, Noblesse part 1/4), turn-in on, teleport limit 100 000, no sideways scroll`);
    await page.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
