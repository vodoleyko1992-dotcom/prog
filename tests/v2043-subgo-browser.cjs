'use strict';
// 20.43 (John 21.10 13:37): вкладка «Сабкласс» в настоящем меню расширения (Chromium, без игры): слоты из памяти героя,
// «▶ Старт» пишет команду rt.subGo с выбранным классом/оружием/щитом и запускает бота; ответ шага показывается в окне вкладки.
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const assert = require('node:assert/strict'), root = require('node:path').join(__dirname, '..');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 10000) { const end = Date.now() + ms; let last; do { try { last = await fn(); if (last) return last; } catch (e) {} await delay(100); } while (Date.now() < end); throw Error('timeout ' + last); }
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', `--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  try {
    await ctx.route('https://**/*', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 }), id = new URL(sw.url()).host;
    await until(() => sw.evaluate(async () => { const s = await chrome.storage.local.get(['cfg', 'rt']); return !!s.cfg && !!s.rt; })); await delay(300);
    await sw.evaluate(async () => { const { rt = {} } = await chrome.storage.local.get('rt');
      await chrome.storage.local.set({ on: false, rt: { ...rt, char: 'SubHero', lvl: 49, subSlots: [{ slot: 0, prof: 'human_arcana_lord', lvl: 78, on: false }, { slot: 1, prof: 'dwarf_fortune_seeker', lvl: 76, on: false }, { slot: 2, prof: 'dwarf_warsmith', lvl: 49, on: true }] } }); });
    const p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.goto(`chrome-extension://${id}/popup.html`); await until(() => p.evaluate(() => !!document.querySelector('#start')?.onclick && formChar === 'SubHero'));
    await p.evaluate(() => showTab('sub'));
    assert.equal(await p.locator('button[data-tab="sub"]').count(), 1);
    const opts = await until(() => p.evaluate(() => { const o = [...document.querySelectorAll('#subGoSlot option')].map(x => x.value + '|' + x.textContent); return o.length === 3 && o; }));
    assert.match(opts[1], /^1\|1: Fortune Seeker 76/); assert.match(opts[2], /Warsmith 49 — сейчас/);
    assert.equal(await p.locator('#subGoSlot').inputValue(), '0', 'по умолчанию — первый не активный класс');
    await p.selectOption('#subGoSlot', '1'); await p.selectOption('#subGoWt', 'blunt'); await p.selectOption('#subGoShield', 'on');
    await p.click('#subGoStart');
    const st = await until(() => sw.evaluate(async () => { const s = await chrome.storage.local.get(['rt', 'on']); return s.rt?.subGo && s; }));
    assert.equal(st.rt.subGo.slot, 1); assert.equal(st.rt.subGo.wt, 'blunt'); assert.equal(st.rt.subGo.shield, 'on'); assert.equal(st.rt.subGo.gearOnly, false);
    // 20.54 (прогон смоуков 23.10): subGoSend пишет команду (menuPatch), и только после её подтверждения жмёт «Старт» — on появляется позже
    // rt.subGo; прежняя проверка в том же снимке падала через раз (2 из 3 одиночных прогонов). Ждём включения, а не читаем сразу.
    const on = await until(() => sw.evaluate(async () => (await chrome.storage.local.get('on')).on === true)).catch(() => false);
    assert.equal(on, true, 'Старт вкладки запускает бота');
    await until(() => p.locator('#subGoBox').textContent().then(s => /меняю класс на слот 1/.test(s)));
    // итог шага — в окне вкладки
    await sw.evaluate(async () => { const { rt } = await chrome.storage.local.get('rt'); await chrome.storage.local.set({ rt: { ...rt, subGo: null, subGoSay: { t: Date.now(), ok: true, why: 'Fortune Seeker 76: надето 9 вещ.', worn: ['оружие: Елізій A-grade.'] } } }); });
    await until(() => p.locator('#subGoBox').textContent().then(s => /✓ .*надето 9 вещ\.\nоружие: Елізій/.test(s)));
    assert.deepEqual(errors, []);
    console.log('PASS v2043-subgo-browser: вкладка «Сабкласс» — слоты, Старт пишет команду и запускает бота, итог виден');
  } finally { await ctx.close(); }
})().catch(e => { console.error(e); process.exit(1); });
