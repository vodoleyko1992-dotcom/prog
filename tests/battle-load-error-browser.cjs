'use strict';
// 23.10.2026: локальная реконструкция ошибки из журнала 00:20:43–00:21:04.
// Настоящий Chromium, точные navigation/shown/byText/fire; окружение и игровой маршрут управляет стенд.
// PLAYWRIGHT_NODE/CHROMIUM переопределяют пути. BASELINE_NAV необязателен; REPORT — путь JSON-отчёта.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/workspace/.local/l2tools/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const current = fs.readFileSync(path.join(root, 'modules/navigation.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
function slice(from, to) {
  const a = content.indexOf(from), b = content.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `точная функция найдена: ${from}`);
  return content.slice(a, b);
}
const shown = slice('const visible = el =>', 'const isBattle =');
const byText = slice('function byText(re,', '// 20.12 (ревизия 17.10, аудит core-a/C2)');
const fire = slice('function fire(el) {', '// Single-writer settings update.');
const report = { scope: 'real Chromium; reconstructed local DOM; exact navigation/shown/byText/fire; controlled waitFor/route/actor',
  liveRequests: [], pageErrors: [], checks: [], source: { navigation: crypto.createHash('sha256').update(current).digest('hex'),
    fire: crypto.createHash('sha256').update(fire).digest('hex') } };
const errorHtml = '<section id="errorwrap"><p id="battle-load-err" class="err">Не вдалося завантажити бій. Спробуйте повернутися на карту. <a class="l2-battle-back-map" href="/map.html">Повернутися на карту</a></p></section>';

async function scenario(browser, nav, opts = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => report.pageErrors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://l2wap.test') { report.liveRequests.push(url.href); return route.abort(); }
    const html = '<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif}a,button{display:inline-block;padding:8px}</style>'
      + (opts.noError ? '' : errorHtml) + (opts.ordinaryButton ? '<button id="battle-back-map">Назад на карту</button>' : '');
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('https://l2wap.test/battle.html?spawnId=' + (opts.cat === false ? 'dense_123' : 'sdms_catacomb_of_the_branded_128'));
  await page.evaluate(({ opts }) => {
    const e = document.getElementById('errorwrap');
    if (e && (opts.hidden || opts.late)) e.hidden = true;
  }, { opts });
  const setup = `(() => {
    let on = true, tabOwner = true, invBusy = false, running = true;
    const rt = {}, S = {clicks: [], statuses: [], waitCalls: [], polls: 0, pointerEvents: [], routes: 0};
    const opts = ${JSON.stringify(opts)};
    const isBattle = () => /battle/i.test(location.pathname);
    const isMap = () => /\\/map\\.html/i.test(location.pathname);
    const loginPage = () => false, paymentFreeClick = () => false;
    const abHold = () => opts.block === 'captcha';
    const L2V7Modules = {actions:{canAct:()=>opts.block !== 'actions'}, payments:{blocked:()=>false}, pvp:{pending:()=>false}};
    ${shown}
    ${byText}
    ${fire}
    document.addEventListener('pointerdown', e => S.pointerEvents.push(e.target.tagName));
    document.addEventListener('click', e => {
      const a = e.target.closest('a.l2-battle-back-map, #battle-back-map');
      if (!a) return;
      e.preventDefault(); S.clicks.push(a.id || a.className);
      if (!opts.rejectRoute) { history.replaceState(null, '', '/map.html'); S.routes++; }
    });
    const env = {cfg:{catMode:opts.cat !== false}, rt, get on(){return on}, $q:s=>document.querySelector(s), shown, fire,
      byText, BACK:/^(Назад на карту|Назад на мапу)$/i, heroAt:()=>({dung:'catacomb_of_the_branded'}),
      setStatus:s=>S.statuses.push(s), sleep:async()=>{},
      waitFor:async(f,ms)=>{ S.waitCalls.push(ms);
        for(let i=0;i<6;i++) {
          if(!on || !tabOwner) return null;
          S.polls++;
          if(opts.late && S.polls===2) document.getElementById('errorwrap').hidden=false;
          const r=f();
          if(r) { if(opts.stopWaiting)on=false; if(opts.loseOwner)tabOwner=false; return r; }
          await new Promise(r=>setTimeout(r,1));
        }
        return null;
      }};
    ${nav}
    const N=globalThis.L2V7Factories.navigation(env);
    window.runRecovery=async()=>{for(let i=0;i<(opts.cycles||1);i++)await N.toMap();
      return {...S,pathname:location.pathname,href:location.href,on,tabOwner,shownError:shown(document.querySelector('#battle-load-err a'))};};
  })();`;
  try { await page.addScriptTag({ content: setup }); return await page.evaluate(() => window.runRecovery()); }
  finally { await ctx.close(); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  report.browser = browser.version();
  async function check(name, fn) { await fn(); report.checks.push({ name, ok: true }); console.log('PASS', name); }
  try {
    if (process.env.BASELINE_NAV) await check('исходник повторяет семь неудачных выходов', async () => {
      const r = await scenario(browser, fs.readFileSync(process.env.BASELINE_NAV, 'utf8'), { cycles: 7 });
      assert.equal(r.pathname, '/battle.html'); assert.equal(r.clicks.length, 0);
      assert.equal(r.statuses.filter(x => x === 'Выход из боя не завершён').length, 7);
      report.baseline = r;
    });
    for (const cat of [true, false]) {
      await check(`ссылка ошибки без ID возвращает на карту: cat=${cat}`, async () => {
        const r = await scenario(browser, current, { cat });
        assert.equal(r.pathname, '/map.html'); assert.deepEqual(r.clicks, ['l2-battle-back-map']);
        assert.equal(r.routes, 1); assert.deepEqual(r.pointerEvents, ['A']);
      });
      await check(`поздняя отрисовка ссылки: cat=${cat}`, async () => {
        const r = await scenario(browser, current, { cat, late: true });
        assert.equal(r.pathname, '/map.html'); assert.equal(r.clicks.length, 1); assert.ok(r.polls >= 2);
      });
      for (const flag of [{ block: 'captcha' }, { block: 'actions' }, { stopWaiting: true }, { loseOwner: true }, { rejectRoute: true }]) {
        await check(`запрет не подменяется прямым URL: cat=${cat} ${JSON.stringify(flag)}`, async () => {
          const r = await scenario(browser, current, { cat, ...flag });
          assert.equal(r.pathname, '/battle.html'); assert.equal(r.routes, 0);
          assert.equal(r.clicks.length, flag.rejectRoute ? 1 : 0);
        });
      }
    }
    await check('скрытый предок ошибки не вытесняет штатную кнопку', async () => {
      const r = await scenario(browser, current, { hidden: true, ordinaryButton: true });
      assert.equal(r.shownError, false); assert.equal(r.pathname, '/map.html'); assert.deepEqual(r.clicks, ['battle-back-map']);
    });
    await check('скрытая ошибка без штатной кнопки не нажимается', async () => {
      const r = await scenario(browser, current, { hidden: true });
      assert.equal(r.shownError, false); assert.equal(r.pathname, '/battle.html'); assert.deepEqual(r.clicks, []);
    });
    assert.deepEqual(report.liveRequests, []); assert.deepEqual(report.pageErrors, []);
    report.ok = true;
  } finally {
    await browser.close();
    if (process.env.REPORT) { fs.mkdirSync(path.dirname(process.env.REPORT), { recursive: true }); fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 2) + '\n'); }
  }
  console.log(`battle-load-error-browser: ${report.checks.length} PASS, 0 живых запросов`);
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
