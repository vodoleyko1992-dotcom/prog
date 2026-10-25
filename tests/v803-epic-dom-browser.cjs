'use strict';
// 10.0.17: тест загружает фактические зависимости popup, включая новые разделы, как расширение.
// 8.0.3 (эпики): браузерный смоук (node tests/v803-epic-dom-browser.cjs; CHROMIUM=…). 1) Настоящий DOM: разбор строки .l2-rb-row на
// фрагменте страницы «Эпик боссы» (снимок 75dac78f) — «Недоступно» у Королевы, чистые имена, респаун, единица Coin of Luck, скрытый
// пейджер не нажимается, окно босса #rb-modal-stats. 2) Меню: таблица эпиков и кнопка «🔄 Проверить эпиков» (menuPatch epicScanReq)
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js');
const epicsLit = content.slice(content.indexOf('const EPICS = [') + 'const EPICS = '.length, content.indexOf('const EPIC_URL')).replace(/;\s*$/, '');
const fx = JSON.parse(read('tests/fixtures-epic-bosses-803.json'));
const py = read('tests/v715-ui-browser.py');
let mock = py.slice(py.indexOf('mock=r"""') + 9); mock = mock.slice(0, mock.indexOf('"""'));
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  // ---------- 1. разбор страницы эпиков ----------
  const p = await b.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
  await p.route('**/*', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await p.goto('https://l2wap.com/epic-bosses.html?page=1');
  await p.evaluate(h => { const s = document.createElement('section'); s.innerHTML = h; document.body.appendChild(s); }, read('tests/fixtures-epic-page-803.html'));
  const res = await p.evaluate(async ([epicsSrc, raidSrc, lit]) => {
    (0, eval)(epicsSrc); (0, eval)(raidSrc);
    const fires = [], rt = {};
    const env = { EPICS: (0, eval)('(' + lit + ')'), EPIC_URL: '/epic-bosses.html', on: true, cfg: {}, rt, $q: s => document.querySelector(s), fire: el => { fires.push(el.id || el.className); return true; },
      shown: el => !!el && !el.hidden && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none', waitX: async f => f() || null, sleep: async () => {}, setStatus() {}, rec() {},
      setRt: async x => Object.assign(rt, x) };
    const E = globalThis.L2V7Factories.epics(env), rows = E.epicRowsParse();
    await E.epicListScan();
    const st = globalThis.L2V7Factories.raid({ cfg: {}, rt: {} }).rbModalStats();
    return { rows, fires, tp: E.epicTpBtn('orfen')?.className, st, db: rt.epicDb };
  }, [read('modules/epics.js'), read('modules/raid.js'), epicsLit]);
  const R = res.rows, resp = ['ak', 'orfen', 'core', 'zaken', 'baium', 'antharas', 'valakas', 'frintezza'].map(k => R[k]?.respH).join();
  const ok1 = Object.keys(R).length === 8 && R.ak.deny === 'Epic Boss нижче дозволеного рівня.' && R.ak.name === 'Королева Муравьев' && !R.orfen.deny && resp === '12,12,12,36,60,72,240,60'
    && Object.values(R).every(r => r.priceUnit === 'Coin of Luck' && r.price === 1 && r.alive === false) && R.frintezza.lvl === 90 && res.tp === 'l2-rb-row__tp'
    && !res.fires.includes('rb-pager-next') && res.st?.hp === 429898 && res.st?.exp === 1179536 && res.db?.ak?.deny && !errors.length;
  if (!ok1) { console.error('FAIL', JSON.stringify({ R, resp, fires: res.fires, tp: res.tp, st: res.st, errors })); process.exit(1); }
  console.log('PASS browser: epic page row parse (deny, names, respawn, CoL unit), hidden pager not clicked, #rb-modal-stats');
  await p.close();
  // ---------- 2. меню: таблица эпиков ----------
  const sbx = { console, Date, Math, JSON, URLSearchParams, CSS: { escape: s => s }, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html', search: '' } }; sbx.globalThis = sbx;
  vm.runInNewContext(read('modules/epics.js'), sbx);
  const ert = {}; const E = sbx.L2V7Factories.epics({ EPICS: vm.runInNewContext('(' + epicsLit + ')'), cfg: {}, rt: ert, setRt: async x => Object.assign(ert, x), rec() {} });
  await E.epicApiNote(fx, 'api', Date.now());
  ert.epicDb.core.verdict = { v: 'strong', spPct: 48, why: 'спецудар 48 %' };
  mock = mock.replace("rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}}", `rt:${JSON.stringify({ char: 'Warlock', lvl: 54, epicDb: ert.epicDb, epicApi: ert.epicApi, epic: { step: 'pick' } })}`).replace("cfg:{fishGoal:''", "cfg:{epicCoinDailyMax:0,fishGoal:''");
  for (const [w, nm] of [[760, 'wide'], [375, 'dock']]) {
    const page = await b.newPage({ viewport: { width: w, height: 1100 } });
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.evaluate(mock);
    const html = read('popup.html').replace(/<link rel="stylesheet" href="[^"]+">/g, '').replace(/<script src="[^"]+"><\/script>/g, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const c of ['ui-v7.css', 'ui-game.css']) await page.addStyleTag({ content: read(c) });
    for (const j of [...require('fs').readFileSync(require('path').join(root, 'popup.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) await page.addScriptTag({ content: read(j) });
    // 20.62 (жалоба John 25.10 «бот грузит ЦП и память»): раздел «Эпики» рисуется, только когда открыт
    await page.waitForTimeout(300); await page.evaluate(() => showTab('epic'));
    await page.waitForTimeout(900);
    const t = await page.$eval('#epicTable', e => e.innerText), sum = await page.$eval('#epicSum', e => e.textContent);
    await page.evaluate(() => document.querySelector('#epicScan').click()); await page.waitForTimeout(300);
    const req = await page.evaluate(() => window.__mockState.rt.epicScanReq);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const ok = /⛔ игра не пускает/.test(t) && /❌ спецудар 48 %/.test(t) && /💀 до ~/.test(t) && /❔ нет цифр/.test(t) && /запрещено \(лимит 0\)/.test(t) && /лимит 0 — не тратить/.test(sum) && req > 0 && !overflow && !errs.length;
    if (!ok) { console.error('FAIL', JSON.stringify({ w, t: t.slice(0, 400), sum, req, overflow, errs })); process.exit(1); }
    console.log(`PASS browser ${w}px (${nm}): epic table (⛔ / ❌ / 💀 до ~ / ❔ / «запрещено (лимит 0)»), «лимит 0 — не тратить», scan button → epicScanReq`);
    await page.close();
  }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
