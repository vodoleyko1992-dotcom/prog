const { chromium } = require(process.env.PLAYWRIGHT_NODE || 'playwright');
(async () => {
  const dir = process.argv[2];
  const ctx = await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = sw.url().split('/')[2];
  const errs = []; const p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`chrome-extension://${id}/popup.html`); await p.waitForTimeout(2500);
  // 20.13 (ревизия 17.10, шаг 7, defaults/D12): меню берёт умолчания из defaults.js — файл должен быть в пакете и загрузиться
  if (await p.evaluate(() => typeof L2Defaults === 'object' && !!L2Defaults.CFG) !== true) errs.push('defaults.js: L2Defaults.CFG нет в меню');
  const ver = await sw.evaluate(() => chrome.runtime.getManifest().version);
  const st = await sw.evaluate(() => chrome.storage.local.get(['cfg']));
  console.log('version', ver, 'cfg keys', Object.keys(st.cfg || {}).length, 'fishBuyPacks', st.cfg?.fishBuyPacks, 'epicCoinDailyMax', st.cfg?.epicCoinDailyMax, 'errors', errs.length, errs.slice(0,3));
  await ctx.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
