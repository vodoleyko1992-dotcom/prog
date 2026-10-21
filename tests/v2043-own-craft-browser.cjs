'use strict';
// 20.43 (John 21.10: саб крафтера): настоящее меню расширения в Chromium — раздел «Свой крафт материалов». Книга рецептов из памяти
// (rt.craftBook) даёт выбор рецепта, «+» пишет rt.craftQueue через фон, прогресс rt.craftMade виден в строке, «✕» убирает строку
// и её прогресс; галки/MP-запас сохраняются в cfg. Игры и сети нет.
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
    await sw.evaluate(async () => { const { cfg = {}, rt = {} } = await chrome.storage.local.get(['cfg', 'rt']);
      await chrome.storage.local.set({ on: false, cfg: { ...cfg }, rt: { ...rt, char: 'CraftHero', lvl: 40, prof: 'Warsmith',
        craftBook: { t: Date.now(), lvl: 1, mp: 484, maxMp: 484, can: true, list: [['steel', 'Steel', 1880, 1, 1, 10], ['cord', 'Cord', 1884, 20, 2, 20]] },
        craftSay: { t: Date.now(), why: 'Cord: нужен Create Item ур. 2 (сейчас 1)' } } }); });
    const p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.goto(`chrome-extension://${id}/popup.html`); await until(() => p.evaluate(() => formChar === 'CraftHero'));
    const read = () => sw.evaluate(async () => { const s = await chrome.storage.local.get(null); return { rt: s['rt@CraftHero'] || s.rt, cfg: s['cfg@CraftHero'] || s.cfg }; });
    const f0 = await p.evaluate(() => [document.getElementById('craftAuto').checked, document.getElementById('craftMammon').checked, document.getElementById('craftMpKeep').value]);
    assert.deepEqual(f0, [false, true, '20'], 'умолчания: выключено, для Маммона, запас 20 %');
    await until(() => p.evaluate(() => document.querySelectorAll('#craftPick option').length === 2));
    assert.match(await p.textContent('#craftPick'), /Cord \(×20\) · ур\. 2 · 20 MP · закрыт/);
    assert.match(await p.textContent('#craftBox'), /Выключено[\s\S]*Create Item ур\. 1[\s\S]*нужен Create Item ур\. 2/);
    await p.evaluate(() => { const s = document.getElementById('craftPick'); s.value = 'steel'; document.getElementById('craftN').value = '50'; document.getElementById('craftAdd').click(); });
    const q = await until(async () => (await read()).rt.craftQueue?.[0]);
    assert.equal(q.code, 'steel'); assert.equal(q.n, 50); assert.equal(q.item, 1880);
    await sw.evaluate(async id => { const s = await chrome.storage.local.get(null), k = s['rt@CraftHero'] ? 'rt@CraftHero' : 'rt'; await chrome.storage.local.set({ [k]: { ...s[k], craftMade: { [id]: 20 } } }); }, q.id);
    await until(() => p.evaluate(() => /Steel — 20\/50/.test(document.getElementById('craftList').textContent)));
    await p.evaluate(() => document.querySelector('#craftList [data-craftdel]').click());   // раздел скрыт вкладкой — клик из страницы
    await until(async () => { const r = (await read()).rt; return (r.craftQueue || []).length === 0 && !r.craftMade?.[q.id]; });
    // галка и запас MP — обычные поля настроек
    await p.evaluate(() => { document.getElementById('craftAuto').click(); });
    await until(async () => (await read()).cfg.craftAuto === true);
    assert.deepEqual(errors, []);
    console.log('PASS: меню «Свой крафт материалов» — выбор рецепта из книги, список с прогрессом и удалением, галки в настройках, 0 ошибок JS');
  } finally { await ctx.close(); }
})().catch(e => { console.error(e); process.exit(1); });
