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
    // 20.54 (прогон смоуков 23.10): с 20.51 (PR #358, 86cbe91 «Крафт до цели») выбор — отдельная вкладка «Крафт ресурсов»:
    // в списке заглушка + рецепты по имени (RU · EN), а выход/уровень/MP/«закрыт» показывают карточки каталога и строка рецепта.
    await until(() => p.evaluate(() => document.querySelectorAll('#craftPick option').length === 3));
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#craftPick option')].map(o => o.value)), ['', 'steel', 'cord']);
    assert.match(await p.textContent('#craftPick'), /Шнур · Cord/);
    assert.match(await p.textContent('#craftCatalog [data-craftpick="cord"]'), /Шнур[\s\S]*Cord[\s\S]*Create Item 2 · нужен навык · 20 MP/);
    assert.doesNotMatch(await p.textContent('#craftCatalog [data-craftpick="steel"]'), /нужен навык/);
    await p.evaluate(() => { const s = document.getElementById('craftPick'); s.value = 'cord'; s.dispatchEvent(new Event('change')); });
    assert.match(await p.textContent('#craftRecipeDetails'), /Выход за изготовление: 20 шт\.[\s\S]*Create Item 2[\s\S]*20 MP/);
    assert.match(await p.textContent('#craftBox'), /Фоновый крафт выключен[\s\S]*Create Item ур\. 1[\s\S]*нужен Create Item ур\. 2/);
    await p.evaluate(() => { const s = document.getElementById('craftPick'); s.value = 'steel'; s.dispatchEvent(new Event('change')); document.getElementById('craftN').value = '50'; document.getElementById('craftN').dispatchEvent(new Event('input')); document.getElementById('craftAdd').click(); });
    const q = await until(async () => (await read()).rt.craftQueue?.[0]);
    assert.equal(q.code, 'steel'); assert.equal(q.n, 50); assert.equal(q.item, 1880);
    await sw.evaluate(async id => { const s = await chrome.storage.local.get(null), k = s['rt@CraftHero'] ? 'rt@CraftHero' : 'rt'; await chrome.storage.local.set({ [k]: { ...s[k], craftMade: { [id]: 20 } } }); }, q.id);
    // 20.54: строка цели — «Сталь … Изготовлено 20 из 50» (PR #358), вместо прежнего «Steel — 20/50»
    await until(() => p.evaluate(() => /Сталь[\s\S]*Изготовлено 20 из 50/.test(document.getElementById('craftList').textContent)));
    // ревью 21.10: настоящий клик оставляет фокус на ✕ — строка всё равно исчезает; craftMade меню не переписывает (его пишет бот)
    await p.evaluate(() => { const b = document.querySelector('#craftList [data-craftdel]'); b.focus(); b.click(); });   // раздел скрыт вкладкой — клик из страницы
    await until(async () => { const r = (await read()).rt; return (r.craftQueue || []).length === 0; });
    await until(() => p.evaluate(() => !document.querySelector('#craftList [data-craftdel]')));
    assert.equal((await read()).rt.craftMade?.[q.id], 20, 'прогресс бота меню не трогает');
    // «Передать основному сейчас» остаётся в карточке «Сабклассы», а не в карточке крафта
    assert.doesNotMatch(await p.evaluate(() => document.getElementById('subHandNow').closest('.card')?.dataset.key || ''), /Свой крафт/);
    // галка и запас MP — обычные поля настроек
    await p.evaluate(() => { document.getElementById('craftAuto').click(); });
    await until(async () => (await read()).cfg.craftAuto === true);
    // 20.43 (John 21.10 13:44): набор крафтера — по умолчанию ВКЛ, галка пишет cfg.crafterKit
    assert.equal(await p.evaluate(() => document.getElementById('crafterKit').checked), true, 'набор крафтера по умолчанию включён');
    await p.evaluate(() => { document.getElementById('crafterKit').click(); });
    await until(async () => (await read()).cfg.crafterKit === false);
    // другой герой без книги — в выборе снова заглушка, а не рецепты прошлого героя
    await sw.evaluate(async () => { const s = await chrome.storage.local.get(null), k = s['rt@CraftHero'] ? 'rt@CraftHero' : 'rt'; const r = { ...s[k] }; delete r.craftBook; await chrome.storage.local.set({ [k]: r }); });
    await until(() => p.evaluate(() => document.querySelectorAll('#craftPick option').length === 1 && document.getElementById('craftPick').value === ''));
    assert.deepEqual(errors, []);
    console.log('PASS: меню «Свой крафт материалов» — выбор рецепта из книги, список с прогрессом и удалением, галки в настройках, 0 ошибок JS');
  } finally { await ctx.close(); }
})().catch(e => { console.error(e); process.exit(1); });
