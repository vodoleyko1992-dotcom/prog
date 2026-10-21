'use strict';
// 20.43 (разбор 21.10): настоящее меню расширения в Chromium (без игры и без сети). ПК: пояснения из title — прежние подсказки
// при наведении, «i» из title скрыта; «Катакомбы» из «Задач бота» не пишут «Выключено»; «Лимиты» показывают сброс по Владивостоку;
// поиск находит поле по пояснению и открывает подраздел другого класса; Alt+6 — по-прежнему «Рыбалка».
// Android-вкладка (html.tabbed): «i» из title видна и раскрывает пояснение, галка при этом не переключается.
// 20.43 (ревью меню): «i» из title — первый «labelable» потомок label, клик по тексту подписи уходил в неё (галка не переключалась, под
// подписью открывалось пояснение, на ПК — со скрытой «i»). Теперь подпись привязана к своему полю: клик по тексту на ПК и на Android
// переключает галку / ставит фокус в поле и пояснения не открывает; нажатие на саму «i» — по-прежнему пояснение без переключения.
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const assert = require('node:assert/strict'), root = require('node:path').join(__dirname, '..');
const AND = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const delay = ms => new Promise(r => setTimeout(r, ms));
// точка внутри текста подписи поля (не на «i» и не на самом поле) — туда кликает игрок
const labelText = (P, id) => P.evaluate(id => {
  const lab = document.getElementById(id).closest('label'), w = document.createTreeWalker(lab, NodeFilter.SHOW_TEXT, { acceptNode: n => n.textContent.trim() && !n.parentElement.closest('button') ? 1 : 3 });
  const r = document.createRange(); r.selectNodeContents(w.nextNode()); const b = r.getBoundingClientRect(); return { x: b.left + Math.min(10, b.width / 2), y: b.top + b.height / 2 };
}, id);
const helpState = P => P.evaluate(() => ({ boxes: document.querySelectorAll('.field-help').length, open: document.querySelectorAll('.field-help.open').length, expanded: document.querySelectorAll('.inline-info[aria-expanded=true]').length }));
async function until(fn, ms = 10000) { const end = Date.now() + ms; let last; do { try { last = await fn(); if (last) return last; } catch (e) {} await delay(100); } while (Date.now() < end); throw Error('timeout ' + last); }
async function open(ua) {
  const ctx = await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', ...(ua ? { userAgent: ua } : {}),
    args: ['--no-sandbox', `--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const requests = []; await ctx.route('https://**/*', r => { requests.push(r.request().method() + ' ' + r.request().url()); return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' }); });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 }), id = new URL(sw.url()).host;
  await until(() => sw.evaluate(async () => { const s = await chrome.storage.local.get(['cfg', 'rt']); return !!s.cfg && !!s.rt; })); await delay(300);
  await sw.evaluate(async () => { const { cfg = {}, rt = {} } = await chrome.storage.local.get(['cfg', 'rt']);
    await chrome.storage.local.set({ on: false, cfg: { ...cfg, autoTasks: ['cat', 'tvt'], catMode: false, fishMode: false, zoneAuto: false, combatProfile: 'mage_summoner', dailyKillLimit: 100 },
      rt: { ...rt, char: 'MenuHero', lvl: 60, dailyQuota: null } }); });
  const p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(String(e)));
  await p.setViewportSize({ width: 1100, height: 850 });
  await p.goto(`chrome-extension://${id}/popup.html`); await until(() => p.evaluate(() => !!document.querySelector('#start')?.onclick && formChar === 'MenuHero'));
  return { ctx, p, sw, errors, requests };
}
(async () => {
  let h = await open();
  try {
    const P = h.p;
    const pc = await P.evaluate(() => {
      const auto = [...document.querySelectorAll('.inline-info.auto-info')], help = [...document.querySelectorAll('.inline-info:not(.auto-info)')];
      const lab = document.getElementById('catNoFa').closest('label');
      return { auto: auto.length, autoShown: auto.filter(b => getComputedStyle(b).display !== 'none').length, help: help.length,
        helpHidden: help.filter(b => getComputedStyle(b).display === 'none' && b.closest('section.act')).length, title: lab.getAttribute('title'), hasTip: !!lab.querySelector('.auto-info'),
        hover: matchMedia('(hover:none)').matches, tabbed: document.documentElement.classList.contains('tabbed'),
        boxes: document.querySelectorAll('.field-help').length, rowLast: [...document.querySelectorAll('.champ-row')].filter(r => r.lastElementChild?.tagName === 'LABEL').length, rows: document.querySelectorAll('.champ-row').length };
    });
    assert.equal(pc.tabbed, false); assert.equal(pc.hover, false);
    assert.ok(pc.auto >= 30, 'у подписанных полей есть «i»: ' + pc.auto); assert.equal(pc.autoShown, 0, 'на ПК «i» из title скрыта');
    assert.ok(pc.help > 50); assert.equal(pc.helpHidden, 0, 'прежние «i» из HELP на ПК видны как раньше');
    assert.match(pc.title, /FA/); assert.equal(pc.hasTip, true);
    // на ПК соседи label прежние: блоки пояснений только у HELP, ряды чемпионов заканчиваются своим label (.champ-row>label:last-child)
    assert.equal(pc.boxes, pc.help); assert.ok(pc.rows > 0); assert.equal(pc.rowLast, pc.rows);
    // 20.43 (ревью меню): ни одна подпись не управляет кнопкой «i» из title; клик по тексту подписи — галка/поле, а не пояснение
    const stolen = await P.evaluate(() => [...document.querySelectorAll('label')].filter(l => l.control?.classList?.contains('auto-info')).map(l => l.textContent.trim().slice(0, 30)));
    assert.deepEqual(stolen, [], 'label.control у подписей с «i» из title — их поле');
    await P.evaluate(() => showTab('hunt')); await P.locator('#catNoFa').scrollIntoViewIfNeeded();
    const help0 = await helpState(P), was = await P.locator('#catNoFa').isChecked();
    let at = await labelText(P, 'catNoFa'); await P.mouse.click(at.x, at.y); await delay(200);
    assert.equal(await P.locator('#catNoFa').isChecked(), !was, 'ПК: клик по тексту подписи переключает галку');
    assert.deepEqual(await helpState(P), help0, 'ПК: пояснение не вставлено и не открыто');
    await P.mouse.click(at.x, at.y); await delay(200); assert.equal(await P.locator('#catNoFa').isChecked(), was, 'второй клик — обратно');
    await P.locator('#champCancel').scrollIntoViewIfNeeded(); at = await labelText(P, 'champCancel'); await P.mouse.click(at.x, at.y); await delay(150);
    assert.equal(await P.evaluate(() => document.activeElement?.id), 'champCancel', 'ПК: клик по подписи списка ставит фокус в список');
    assert.deepEqual(await helpState(P), help0);
    // «Катакомбы» выбраны в «Задачах бота», флага catMode нет — раздел не пишет «Выключено»
    await P.evaluate(() => showTab('dungeon')); await until(() => P.locator('#catBox').textContent().then(s => s.length > 0));
    assert.doesNotMatch(await P.locator('#catBox').textContent(), /^Выключено/); assert.equal(await P.locator('#catMode').isChecked(), true);
    // «Лимиты»: сброс по часам игрока
    await P.evaluate(() => showTab('limits'));
    assert.match(await P.locator('#dailyLimitsDay').textContent(), /время сервера · сброс в \d\d:\d\d по Владивостоку \(через [^)]+\)/);
    assert.doesNotMatch(await P.locator('#tab-limits').innerText(), /8434|9119/);
    // поиск: по пояснению (слово только в title) и ниже совпадений по названию
    await P.locator('#uiSearch').fill('покращити'); await until(() => P.locator('#uiResults [data-i]').count());
    assert.match(await P.locator('#uiResults [data-i]').first().innerText(), /Улучшать вещь-цель у кузнеца[\s\S]*по пояснению/);
    await P.locator('#uiResults [data-i]').first().click(); await delay(400);
    assert.equal(await P.locator('section.act').getAttribute('id'), 'tab-mammon'); assert.equal(await P.locator('#mmUpgrade').isVisible(), true);
    await P.locator('#uiSearch').fill('coin luck'); await until(() => P.locator('#uiResults [data-i]').count());
    const coin = await P.locator('#uiResults [data-i]').allInnerTexts(), firstHelp = coin.findIndex(t => /по пояснению/.test(t));
    assert.ok(coin.length >= 3); assert.ok(firstHelp < 0 || coin.slice(firstHelp).every(t => /по пояснению/.test(t)), 'совпадения по названию — выше');
    await P.keyboard.press('Escape'); await delay(300);   // blur прячет список через 150 мс — не гоняемся с ним
    // поиск по скрытому подразделу воина у мага: пометка и переход с «показать все классы»
    assert.equal(await P.evaluate(() => document.documentElement.classList.contains('cls-mage') && !document.documentElement.classList.contains('show-all')), true);
    await P.locator('#uiSearch').fill('Станы (чемп'); await until(() => P.locator('#uiResults [data-i]').count());
    assert.match(await P.locator('#uiResults [data-i]').first().innerText(), /\(для другого класса\)/);
    assert.equal(await P.locator('#nStun').isVisible(), false);
    await P.locator('#uiResults [data-i]').first().click(); await until(() => P.locator('#nStun').isVisible());
    assert.equal(await P.evaluate(() => document.documentElement.classList.contains('show-all')), true);
    assert.equal(await P.locator('section.act').getAttribute('id'), 'tab-panel');
    await P.locator('#uiSearch').fill('Станы (чемп'); await until(() => P.locator('#uiResults [data-i]').count());
    assert.doesNotMatch(await P.locator('#uiResults [data-i]').first().innerText(), /другого класса/, 'все классы показаны — пометки нет');
    await P.keyboard.press('Escape'); await delay(300); await P.locator('#showAllCls').click(); await until(() => P.evaluate(() => !document.documentElement.classList.contains('show-all')));
    // горячие клавиши не изменились: Alt+6 — Рыбалка (как в подсказке кнопки), Alt+0 — Сервис
    await P.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await P.keyboard.press('Alt+6'); assert.equal(await P.locator('section.act').getAttribute('id'), 'tab-fish');
    await P.keyboard.press('Alt+0'); assert.equal(await P.locator('section.act').getAttribute('id'), 'tab-svc');
    assert.equal((await h.sw.evaluate(() => chrome.storage.local.get('on'))).on, false);
    assert.deepEqual(h.errors, []); assert.ok(h.requests.every(r => r.startsWith('GET ')), JSON.stringify(h.requests));
    console.log('PASS ПК: «i» из title скрыта (' + pc.auto + ' полей), клик по подписи — поле, а не пояснение, HELP как раньше, катакомбы из задач, сброс по Владивостоку, поиск по пояснению/другому классу, Alt+6/0');
  } finally { await h.ctx.close(); }
  h = await open(AND);
  try {
    const P = h.p;
    await until(() => P.evaluate(() => document.documentElement.classList.contains('tabbed')));
    await P.evaluate(() => showTab('hunt'));
    const tip = P.locator('#catNoFa').locator('xpath=ancestor::label').locator('.auto-info');
    await tip.scrollIntoViewIfNeeded(); assert.equal(await tip.isVisible(), true, 'во вкладке Android «i» из title видна');
    const before = await P.locator('#catNoFa').isChecked();
    await tip.click(); await delay(200);
    const box = await P.evaluate(() => { const lab = document.getElementById('catNoFa').closest('label'); let n = lab.nextElementSibling; while (n && !n.classList.contains('field-help')) n = n.nextElementSibling;
      return { text: n?.textContent || '', open: !!n?.classList.contains('open'), expanded: lab.querySelector('.auto-info').getAttribute('aria-expanded') }; });
    assert.match(box.text, /FA/); assert.equal(box.open, true); assert.equal(box.expanded, 'true');
    assert.equal(await P.locator('#catNoFa').isChecked(), before, 'нажатие «i» не переключает галку');
    // 20.43 (ревью меню): нажатие на текст подписи на Android — галка, а не пояснение (открытое пояснение остаётся как было)
    const at = await labelText(P, 'catNoFa'), help1 = await helpState(P); await P.mouse.click(at.x, at.y); await delay(200);
    assert.equal(await P.locator('#catNoFa').isChecked(), !before, 'Android: нажатие на текст подписи переключает галку');
    assert.deepEqual(await helpState(P), help1, 'пояснение не переключилось');
    await P.mouse.click(at.x, at.y); await delay(200); assert.equal(await P.locator('#catNoFa').isChecked(), before);
    const row = await P.evaluate(() => { const lab = document.getElementById('champCancel').closest('label'), tip = lab.querySelector('.auto-info'); tip.click();
      const r = lab.parentElement, n = r.nextElementSibling; return { inRow: r.matches('.champ-row'), last: r.lastElementChild === lab, open: !!n?.classList.contains('field-help') && n.classList.contains('open') }; });
    assert.deepEqual(row, { inRow: true, last: true, open: true }, 'пояснение ряда — после ряда, label остаётся последним');
    const shown = await P.evaluate(() => [...document.querySelectorAll('section.act .inline-info.auto-info')].filter(b => getComputedStyle(b).display !== 'none').length);
    assert.ok(shown >= 3, 'в разделе видны «i» из title: ' + shown);
    assert.deepEqual(h.errors, []);
    console.log('PASS Android-вкладка: «i» из title видна, раскрывает пояснение, галку не трогает; нажатие на подпись — галка');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
