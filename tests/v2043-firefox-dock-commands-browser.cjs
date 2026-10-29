'use strict';
// 20.43 (разбор 21.10): настоящее MV3 расширение, встроенное меню (iframe) на локальной странице игры; отсутствие chrome.tabs
// во встроенном меню Firefox моделируется явно (как в v2035-mammon-dock-browser). Старт, три кнопки Warlock и проверки панели
// идут через фон (dockGameCommand) только в родительскую вкладку. Сеть целиком локальная, аккаунт игры не используется.
const assert = require('node:assert/strict');
const { harness, until, delay } = require('./v1014-core-lifecycle-browser.cjs');
(async () => { const h = await harness({ withPopup: false }); try {
  const { p, core } = h.g;
  // 20.82: потолка цены набора больше нет — Start не уводит в город, потому что адены (9 999 999) меньше цены набора (10 000 000)
  const snapshot = { name: 'AuditHero', revision: 55, level: 75, l2Profession: 'human_warlock', classSlots: { activeSlot: 0 }, adena: 9999999, inBattle: false,
    activeSummon: { kind: 'servitor', key: 'kai_the_cat', hp: 100, maxHp: 100, summonSkillId: 1331, summonSkillLevel: 8, pAtk: 3000, accuracy: 150, critRate: 650, critDmgMul: 3.8, activeBuffs: [] } };
  await h.ctx.route('https://l2wap.com/character', r => r.fulfill({ json: { character: snapshot } }));
  await h.ctx.route('https://l2wap.com/character/town/buffer/catalog', r => r.fulfill({ json: { sets: [{ id: 'summon', feeAdena: 10000000, feeCoinOfLuck: 0, skills: [{ skillId: 1204, level: 2, durationSec: 18000 }] }] } }));
  await h.sw.evaluate(async () => { const { cfg, rt } = await chrome.storage.local.get(['cfg', 'rt']);
    // 20.60: общего бюджета набора суммона нет — бот не уходит в город, пока цена набора выше разрешённой
    await chrome.storage.local.set({ on: false, cfg: { ...cfg, dock: true, dockMin: false }, rt: { ...rt, _src: 'v2043-dock-fixture', petFull: { spent: 10000000, lifetimeSpent: 10000000, budgetEpoch: 123, purchases: 1 } } }); });
  await p.setViewportSize({ width: 1897, height: 953 });
  await core("cfg.dock=true;cfg.dockMin=false;localStorage.setItem('l2bot-dockWide','1');dock();true");
  const frame = p.frameLocator('#l2bot-dock iframe'), body = frame.locator('body');
  await until(() => frame.locator('#start').isVisible());
  // Firefox: у iframe меню есть runtime/storage, но нет tabs. Убираем после каждой перерисовки (панель не перезагружается, но на всякий случай).
  const noTabs = () => body.evaluate(() => { Object.defineProperty(chrome, 'tabs', { configurable: true, value: undefined }); return { docked: DOCKED, tabs: typeof chrome.tabs, runtime: typeof chrome.runtime.sendMessage, hero: formChar }; });
  await until(async () => (await noTabs()).hero === 'AuditHero');
  const capabilities = await noTabs(); assert.deepEqual(capabilities, { docked: true, tabs: 'undefined', runtime: 'function', hero: 'AuditHero' });
  const press = sel => frame.locator(sel).first().evaluate(e => e.click());
  const posts = () => h.requests.filter(x => x.method !== 'GET').map(x => x.path);

  console.log('CASE dock Start without chrome.tabs');
  // Итог запуска, который видит игрок (тост/строка предупреждения), — результат showWakeResult самого Старта.
  await body.evaluate(() => { const orig = showWakeResult; window.__wake = []; showWakeResult = async () => { const r = await orig(); window.__wake.push(r); return r; }; });
  await press('#start');
  await until(() => core('on && running && tabOwner'));
  await until(() => body.evaluate(() => window.__wake.length), 20000);
  const started = await body.evaluate(() => window.__wake[0]); assert.equal(started.ok, true, 'Старт во встроенном меню: ' + JSON.stringify(started));
  await delay(600);
  const warn = await body.evaluate(() => ({ hidden: document.getElementById('wakeWarn').hidden, text: document.getElementById('wakeWarn').textContent, stored: localStorage.getItem('l2bot-wakeWarn') }));
  assert.equal(warn.hidden, true, 'ложное «вкладка игры не отвечает» после Старта: ' + warn.text); assert.equal(warn.stored, null);
  const direct = await body.evaluate(() => wakeGame()); assert.equal(direct.ok, true, JSON.stringify(direct));
  console.log('PASS dock Start → background → parent kick ACK (running owner), no WAKE_NOTAB');
  await press('#stop'); await until(() => core('!on && !running')); await until(async () => !(await h.get(['lock'])).lock, 10000);

  console.log('CASE panel checks');
  await noTabs(); await press('#check');
  await until(() => frame.locator('#slots').textContent().then(t => /страницу боя/.test(t)));
  assert.doesNotMatch(await frame.locator('#slots').textContent(), /Откройте вкладку/);
  await press('#suggest'); await until(() => frame.locator('#slots').textContent().then(t => /^🤖 Предложение/.test(t)));
  assert.equal(await frame.locator('#applyRow').evaluate(e => e.hidden), false);
  await body.evaluate(() => { window.__dl = []; download = (n, t, ty) => window.__dl.push([n, String(t).length, ty]); });
  await press('#recDom'); await until(() => body.evaluate(() => window.__dl.length));
  const dl = await body.evaluate(() => window.__dl); assert.equal(dl.length, 1); assert.match(dl[0][0], /^l2wap-map-/); assert.ok(dl[0][1] > 100); assert.equal(dl[0][2], 'text/html');
  assert.equal((await h.get(['on'])).on, false); assert.deepEqual(posts(), []);
  console.log('PASS «Проверить», «Распознать», «Эта стр.» answer from parent game tab; no POST, bot stays OFF');

  console.log('CASE Warlock buttons');
  await body.evaluate(() => showTab('warlock')); await noTabs();
  await until(() => frame.locator('#warlockPanel [data-command="preview"]').count());
  await press('#warlockPanel [data-command="preview"]');
  await until(async () => (await h.get(['rt'])).rt.petFullPreview?.price === 10000000);
  assert.equal((await h.get(['rt'])).rt.warlockCommandAck?.ok, true); assert.equal((await h.get(['on'])).on, false); assert.deepEqual(posts(), []);
  await until(() => body.evaluate(() => !document.querySelector('#warlockPanel [data-reset]')?.disabled));
  await press('#warlockPanel [data-reset]'); await until(() => frame.locator('#warlockPanel [data-command="resetBudget"]').count());
  assert.equal((await h.get(['rt'])).rt.petFull.spent, 10000000);
  await press('#warlockPanel [data-command="resetBudget"]');
  await until(async () => (await h.get(['rt'])).rt.petFull.spent === 0);
  assert.equal((await h.get(['rt'])).rt.petFull.lifetimeSpent, 10000000); assert.equal((await h.get(['on'])).on, false);
  await until(() => core('!tabOwner'));
  await h.sw.evaluate(async () => { const { rt } = await chrome.storage.local.get('rt'); await chrome.storage.local.set({ rt: { ...rt, _src: 'v2043-dock-fixture', petFull: { spent: 0, lifetimeSpent: 10000000, budgetEpoch: 1000, status: 'unknown',
    pending: { id: 'local-unknown', phase: 'sent', at: Date.now(), char: 'AuditHero', classKey: '0:human_warlock', petKey: 'kai_the_cat', petLevel: 8, revision: 54, adena: 40000000, price: 10000000, skills: [{ id: 1204, level: 2, duration: 18000 }] } } } }); });
  await until(() => frame.locator('#warlockPanel [data-archive-begin]').count()); await noTabs();
  await press('#warlockPanel [data-archive-begin]'); await until(() => frame.locator('#warlockPanel [data-command="archiveUnknown"]').count());
  assert.ok((await h.get(['rt'])).rt.petFull.pending);
  await press('#warlockPanel [data-command="archiveUnknown"]');
  await until(async () => !(await h.get(['rt'])).rt.petFull.pending);
  const pf = (await h.get(['rt'])).rt.petFull; assert.equal(pf.pending, null); assert.equal((await h.get(['on'])).on, false); assert.deepEqual(posts(), []);
  console.log('PASS Warlock preview / budget reset / unknown outcome archived from dock without chrome.tabs; no POST or start');

  assert.equal((await noTabs()).tabs, 'undefined');
  assert.deepEqual(h.errors, []);
  console.log('PASS v2043 dock commands without chrome.tabs: ' + JSON.stringify({ capabilities, unknownReserved: pf.unknownReserved || 0 }));
} catch (e) {
  const s = await h.get(['rt', 'on']).catch(() => ({}));
  console.log('DEBUG', JSON.stringify({ on: s.on, petFull: s.rt?.petFull, ack: s.rt?.warlockCommandAck, errors: h.errors }));
  throw e;
} finally { await h.ctx.close(); } })().catch(e => { console.error('FAIL', e.stack); process.exitCode = 1; });
