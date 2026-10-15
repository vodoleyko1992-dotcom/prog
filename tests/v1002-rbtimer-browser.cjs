'use strict';
// 10.0.17: время следующего дня допускает дату, как фактический индикатор.
// 10.0.17: тест загружает фактические зависимости popup, включая новые разделы, как расширение.
// 10.0.2 «⏱ Таймеры боссов»: браузерный смоук (node tests/v1002-rbtimer-browser.cjs; CHROMIUM=…). Настоящие hook.js и скрипты расширения на
// подставной https://l2wap.com: 1) страница игры запрашивает /game/raid-bosses (15 РБ — больше предела обрезки hook) → все 15 в rt.rbTimer
// и rt.rbList; 2) следующий ответ — РБ убит → окно смерти; 3) свой опрос (modules/rbtimer.tick, GET с токеном) — страницы окна уровней
// и эпики; 4) меню «👑 РБ» → «⏱ Таймеры боссов» на 760 и 375 px без горизонтальной прокрутки
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mf = JSON.parse(read('manifest.json')), scripts = mf.content_scripts.find(e => e.js.includes('content.js')).js;
const py = read('tests/v715-ui-browser.py');
let mock = py.slice(py.indexOf('mock=r"""') + 9); mock = mock.slice(0, mock.indexOf('"""'));
const coreMock = `(() => { const data = { on: false, cfg: { rec: false, autoLearn: false }, rt: { char: 'Warlock', lvl: 65 } };
  window.chrome = { runtime: { id: 'mock', lastError: null, getManifest: () => ({ version: '${mf.version}' }), getURL: p => 'https://l2wap.com/__ext/' + (p || ''), onMessage: { addListener() {} },
    sendMessage(msg, cb) { let reply = null; if (msg.cmd === 'tabId') reply = 3; if (msg.cmd === 'rbtImport') { data.rt.rbTimer = msg.rbTimer; window.__rbtImp = msg.rbTimer; reply = { ok: true }; } if (msg.cmd === 'statePatch') { Object.assign(data.rt, msg.patch || {}); Object.assign(data.cfg, msg.cfgPatch || {}); reply = { ok: true }; }
      if (typeof cb === 'function') { queueMicrotask(() => cb(reply)); return; } return Promise.resolve(reply); } },
    storage: { onChanged: { addListener() {} }, local: { get: async keys => Object.fromEntries([].concat(keys).map(k => [k, data[k]])), set: async v => Object.assign(data, v) } } };
  localStorage.setItem('token', 'tok-123'); })();`;
const page5 = alive => ({ page: 5, pageSize: 15, total: 197, totalPages: 14, characterLevel: 65, minRaidBossLevel: 56,
  bosses: Array.from({ length: 15 }, (_, i) => ({ spawnId: 'l2dop_rb_' + (25100 + i), name: 'Boss ' + i, level: 55 + i, bossType: 'raid', isAlive: i === 3 ? alive : true, adenaCost: 100000, canAttack: true })) });
const EPIC = { total: 1, bosses: [{ spawnId: 'l2dop_rb_29022', name: 'Zaken', level: 60, bossType: 'epic', isAlive: false, respawnHours: 36, coinOfLuckCost: 1 }] };
const MAP = '<html><body><span id="l2-hud-legacy-lvl">65</span></body></html>';
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let alive = true; const gets = [];
  {
    const p = await b.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.route('https://l2wap.com/**', async r => {
      const u = new URL(r.request().url());
      if (u.pathname.startsWith('/__ext/')) return r.fulfill({ status: 200, contentType: 'application/json', body: read(u.pathname.slice(7)) });
      if (/bosses/.test(u.pathname)) gets.push(u.pathname + u.search + ' ' + (r.request().headers().authorization || ''));
      const body = u.pathname === '/game/raid-bosses' ? (u.searchParams.get('page') === '5' ? page5(alive) : { page: +u.searchParams.get('page'), totalPages: 14, bosses: [] })
        : u.pathname === '/game/epic-bosses' ? EPIC : null;
      if (body) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return r.fulfill({ status: 200, contentType: 'text/html', body: MAP });
    });
    await p.goto('https://l2wap.com/map.html');
    await p.evaluate(coreMock);
    await p.addScriptTag({ content: read('hook.js') });
    for (const s of scripts) await p.addScriptTag({ content: read(s) });
    const res = await p.evaluate(async () => {
      // бот на паузе, таймеров ещё нет (скрин игрока 13.10 00:14): блок всё равно виден внизу окна; эпики из rt.epicDb
      ui.classList.add('wide'); draw(); const ind0 = ui.innerText;
      const ebox = ui.querySelector('.e'), wb = ui.getBoundingClientRect(), eb = ebox?.getBoundingClientRect();
      rt.epicDb = { zaken: { name: 'Zaken', lvl: 60, alive: false, until: { lo: 0, hi: Date.now() + 5 * 3600000 } }, core: { name: 'Core', lvl: 50, alive: true } };
      draw(); const ind1 = ui.innerText; rt.epicDb = {}; ui.classList.remove('wide');
      on = true; tabOwner = true; leaseEpoch = 'e';
      const wait = async f => { for (let i = 0; i < 60 && !f(); i++) await new Promise(r => setTimeout(r, 50)); return f(); };
      await fetch('/game/raid-bosses?page=5'); await wait(() => rt.rbTimer && Object.keys(rt.rbTimer.b || {}).length === 15);
      return { n1: Object.keys(rt.rbTimer?.b || {}).length, list1: Object.keys(rt.rbList || {}).length, ind0, ind1, low: !!eb && eb.bottom > wb.bottom - 40 && eb.top > wb.top + wb.height / 2 };
    });
    alive = false;
    const res2 = await p.evaluate(async () => {
      const wait = async f => { for (let i = 0; i < 60 && !f(); i++) await new Promise(r => setTimeout(r, 50)); return f(); };
      await new Promise(r => setTimeout(r, 30));
      await fetch('/game/raid-bosses?page=5'); await wait(() => rt.rbTimer?.b?.l2dop_rb_25103?.al === false);
      const x = rt.rbTimer.b.l2dop_rb_25103;
      // 15.10: фоновый tick выключен; эпики приходят из страницы самой игры.
      const polled = await L2V7Modules.rbtimer.tick();
      await fetch('/game/epic-bosses'); await wait(() => rt.rbTimer?.b?.l2dop_rb_29022);
      ui.classList.add('wide'); draw(); const ind = document.getElementById('l2bot-ind')?.innerText || '';
      ui.classList.remove('wide'); draw(); const ind2 = document.getElementById('l2bot-ind')?.innerText || '';
      return { al: x.al, win: x.dl > 0 && x.dh >= x.dl, listAlive: rt.rbList.l2dop_rb_25103.alive, polled, zaken: rt.rbTimer.b.l2dop_rb_29022, pg: rt.rbTimer.pg, ind, ind2 };
    });
    const ok = res.n1 === 15 && res.list1 === 15 && /🐉 Респ эпиков\s+данных пока нет/.test(res.ind0) && res.low && /💀 Zaken \(60\): не позже (?:\d\d\.\d\d )?\d\d:\d\d \(через [45] ч/.test(res.ind1) && /✅ живы: Core/.test(res.ind1) && res2.al === false && res2.win && res2.listAlive === false && res2.polled === false && res2.zaken?.rh === 36
      && /🐉 Респ эпиков\s+💀 Zaken \(60\): не позже/.test(res2.ind) && /🐉 Респ эпиков: Zaken \(60\): не позже [\d.: ]+$/.test(res2.ind2) && !gets.some(g => /Bearer/.test(g)) && !errors.length;
    if (!ok) { console.error('FAIL 1-3', JSON.stringify({ res, res2, gets, errors })); process.exit(1); }
    // 10.0.3: Alt+R на странице игры → окно выбора файла → таймеры героя (команда rbtImport в фон)
    {
      const t0 = Math.floor(Date.now() / 1000) - 3600, f = [0, 600].map((dt, i) => JSON.stringify({ t: t0 + dt, st: { l2dop_rb_9: ['Lokness', 70, i === 0, 'raid'] } })).join('\n');
      const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 5000 }), p.keyboard.press('Alt+KeyW')]);
      await fc.setFiles({ name: 'rb-poll.jsonl', mimeType: 'application/json', buffer: Buffer.from(f) });
      await p.waitForTimeout(500);
      const r3 = await p.evaluate(() => ({ sent: !!window.__rbtImp?.b?.l2dop_rb_9, keep: !!window.__rbtImp?.b?.l2dop_rb_25103, lok: rt.rbTimer?.b?.l2dop_rb_9?.al, say: document.getElementById('l2bot-rbt-say')?.innerText || '' }));
      if (!(r3.sent && r3.keep && r3.lok === false && /Таймеры загружены: 1 боссов/.test(r3.say))) { console.error('FAIL alt+r game', JSON.stringify(r3)); process.exit(1); }
      console.log('PASS browser: Alt+W on the game page → file picker → tracking file merged into the hero timers (old timers kept)');
    }
    console.log('PASS browser: game list via hook (all 15 RB, not cut to 8) → rbTimer + rbList; RB killed → death window; background polling disabled; native game page → epics; «🐉 Респ эпиков» in the in-game indicator (wide and narrow; bottom of the window, shown with no data, epics from epicDb while paused)');
    await p.close();
  }
  const now = Date.now(), H = 3600000;
  const rtMenu = { char: 'Warlock', lvl: 65, rbTimer: { b: {
    l2dop_rb_25051: { n: 'Rahha', l: 65, al: false, dl: now - 3 * H, dh: now - 3 * H, k: now - 3 * H, ch: now - 3 * H, ls: now },
    l2dop_rb_25052: { n: 'Hekaton Prime', l: 65, al: false, dl: now - 2 * H - 600000, dh: now - 2 * H, ch: now - 2 * H, ls: now },
    l2dop_rb_25053: { n: 'Tiphon', l: 65, al: true, pv: now - H, ch: now - H + 600000, ls: now },
    l2dop_rb_29022: { n: 'Zaken', l: 60, al: false, e: 1, rh: 36, dl: 0, dh: now - H, ch: now - H, ls: now },
    l2dop_rb_25001: { n: 'Far Low', l: 20, al: true, ls: now } } } };
  for (const w of [760, 375]) {
    const page = await b.newPage({ viewport: { width: w, height: 1100 } }); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('about:blank');
    const m = mock.replace("rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}}", `rt:${JSON.stringify(rtMenu)}`);
    if (m === mock) { console.error('FAIL: popup mock not patched'); process.exit(1); }
    await page.evaluate(m);
    const html = read('popup.html').replace(/<link rel="stylesheet" href="[^"]+">/g, '').replace(/<script src="[^"]+"><\/script>/g, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const s of ['ui-v7.css', 'ui-game.css']) await page.addStyleTag({ content: read(s) });
    for (const j of [...require('fs').readFileSync(require('path').join(root, 'popup.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) await page.addScriptTag({ content: read(j) });
    await page.evaluate(() => document.querySelector('nav button[data-tab="rb"]').click());
    await page.waitForTimeout(1000);
    const t = await page.$eval('#rbTimerTable', e => e.innerText), sum = await page.$eval('#rbTimerSum', e => e.innerText);
    const on = await page.$eval('#rbTimers', e => e.checked), resp = await page.$eval('#rbRespH', e => e.value), every = await page.$eval('#rbTimerMin', e => e.value);
    const vis = await page.$eval('#rbTimerTable', e => e.getBoundingClientRect().height > 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const rows = t.split('\n').filter(Boolean), at = re => rows.findIndex(r => re.test(r));
    // 10.0.5: после полуночи время убийства вчерашнее — с датой «12.10 21:04» (проверка падала с 00:00 до 03:00)
    const ok = /Rahha \(65\)\s+💀 убит мной в (?:\d\d\.\d\d )?\d\d:\d\d\s+≈[\d.: ]+ \(через 5 ч\)\s+≈8 ч · догадка/.test(t) && /Hekaton Prime/.test(t) && /Tiphon \(65\)\s+✅ жив/.test(t)
      && /🐉 Zaken \(60\)\s+💀 убит до [\d.: ]+\s+не позже .*36 ч · игра/.test(t) && !/Far Low/.test(t)
      && at(/Rahha/) < at(/Hekaton/) && at(/Hekaton/) < at(/Tiphon/)
      && /Знаю 5 боссов: живых 2, убитых 3/.test(sum) && /пока не замерен — беру 8 ч/.test(sum) && on && resp === '8' && every === '10' && vis && !overflow && !errs.length;
    if (!ok) { console.error('FAIL 4', JSON.stringify({ w, t, sum, on, resp, every, vis, overflow, errs })); process.exit(1); }
    // файл слежки из облака (по строке на опрос) → «📥 Загрузить таймеры из файла слежки» → таймеры героя
    if (w === 760) {
      const t0 = Math.floor(now / 1000) - 9 * 3600, snaps = [0, 600, 1200, 8 * 3600 + 1200, 8 * 3600 + 1800].map((dt, i) => JSON.stringify({ t: t0 + dt, st: { l2dop_rb_9: ['Lokness', 70, !(i >= 2 && i <= 3), 'raid'], l2dop_rb_25051: ['Rahha', 65, false, 'raid'] } })).join('\n');
      // 10.0.3: Alt+R в меню открывает то же окно загрузки, что кнопка «📥 Загрузить таймеры из файла слежки»
      await page.evaluate(() => document.querySelector('nav button[data-tab="overview"]')?.click());
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.keyboard.press('Alt+KeyW')]);
      const foot = await page.$eval('footer', e => e.innerText), rbTab = await page.$eval('#tab-rb', e => e.classList.contains('act'));
      if (!/Alt\+W\s*таймеры/.test(foot) || !rbTab) { console.error('FAIL alt+r menu', JSON.stringify({ foot, rbTab })); process.exit(1); }
      await fc.setFiles({ name: 'rb-poll.jsonl', mimeType: 'application/json', buffer: Buffer.from(snaps) });
      await page.waitForTimeout(800);
      const t2 = await page.$eval('#rbTimerTable', e => e.innerText);
      const ok2 = /Lokness \(70\)\s+✅ жив/.test(t2) && /8 ч–8 ч 20 мин · мой замер \(1\)/.test(t2) && /Rahha \(65\)\s+💀 убит мной/.test(t2);
      if (!ok2) { console.error('FAIL import', JSON.stringify({ t2 })); process.exit(1); }
      console.log('PASS browser: Alt+W in the menu (hint in the footer) → tracking file import — Lokness alive with respawn measured 8 h–8 h 20 min, own Rahha kill kept');
    }
    if (process.env.SHOT) { await page.$eval('#rbTimerTable', e => e.scrollIntoView()); await page.screenshot({ path: process.env.SHOT + '-' + w + '.png' }); }
    console.log(`PASS browser ${w}px: «👑 РБ» → «⏱ Таймеры боссов»: killed first by respawn time, epic by game hours, window 50–80, settings, no sideways scroll`);
    await page.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
