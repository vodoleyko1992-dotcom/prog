'use strict';
// 10.0.13 (аудит 14.10): контракт mammon-blacksmith.js, mail-item-attachments.js и mail-item-render.js.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../modules/mammon.js'), 'utf8');
function setup({ rt = {}, cfg = {}, cards = [], responses = {}, document = null } = {}) {
  const requests = [], clicks = [], recs = [];
  const doc = document || { documentElement: { dataset: {} }, querySelectorAll: () => cards, querySelector: () => null };
  const box = { document: doc, location: { pathname: '/mammon-blacksmith.html' }, console, sessionStorage: { getItem: () => null, setItem() {} } };
  vm.createContext(box); vm.runInContext(src, box);
  const env = { rt, cfg: { mmCrafter: 'Skye', mmGoalItem: 920018, mmGoalLvl: 1, ...cfg }, invQty: () => 0, ITEMS: {}, FARM: { res: {} },
    setRt: async p => Object.assign(env.rt, p), rec: (...x) => recs.push(x.join(' ')), waitX: async fn => fn(), sleep: async () => {}, setStatus() {}, $q: () => null,
    fishNow: () => false, fire: e => { clicks.push(e); e?.click?.(); }, gameGet: async url => { requests.push(url); return { ok: true, status: 200, json: async () => responses[url] || {} }; } };
  return { M: box.L2V7Factories.mammon(env), env, requests, clicks, recs, box };
}
function mail(itemId, qty, attachmentId = 'return1') { const t = new Date().toISOString(); return { itemId, qty, attachmentId, senderName: 'Skye', name: '#' + itemId, createdAt: t, claimedAt: t }; }
function batch() { return { to: 'Skye', at: { 1868: 700, 1869: 350, 1876: 70 }, ret: { 5550: 14 }, t0: Date.now() - 1000 }; }
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
check('неожиданный Steel Mold не списывает общее сырьё партии Durable Metal Plate', async () => {
  const original = batch(); const f = setup({ rt: { mmCraft: original } }); f.M.mailList([mail(1883, 19)]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.env.rt.mmCraft.at)), original.at, 'Iron Ore тоже должно остаться у крафтера');
});
check('ожидаемый результат списывает сырьё один раз', async () => {
  const f = setup({ rt: { mmCraft: batch() } }); f.M.mailList([mail(5550, 7)]); const left = JSON.stringify(f.env.rt.mmCraft.at);
  f.M.mailList([mail(5550, 7)]); assert.equal(JSON.stringify(f.env.rt.mmCraft.at), left);
  f.M.mailList([mail(5550, 7), mail(5550, 7, 'return2')]); assert.equal(f.env.rt.mmCraft, null);
});
check('больше 200 возвратов в одной партии не списываются повторно при опросе истории', async () => {
  const f = setup({ rt: { mmCraft: { to: 'Skye', at: { 1868: 50000, 1869: 25000, 1876: 5000 }, ret: { 5550: 1000 }, t0: Date.now() - 1000 } } });
  const rows = Array.from({ length: 201 }, (_, i) => mail(5550, 1, 'crafted-' + i));
  f.M.mailList(rows); const left = JSON.stringify(f.env.rt.mmCraft.at); f.M.mailList(rows);
  assert.equal(JSON.stringify(f.env.rt.mmCraft.at), left);
});
check('почта читает незабранное вложение за первой страницей истории', async () => {
  const f = setup({ responses: {
    '/game/item-transfer/received?page=1': { page: 1, totalPages: 2, attachments: [mail(1880, 1)] },
    '/game/item-transfer/received?page=2': { page: 2, totalPages: 2, attachments: [{ ...mail(5550, 14, 'older'), claimedAt: null }] }
  } }); await f.M.mailPoll();
  assert.deepEqual(f.requests, ['/game/item-transfer/received?page=1', '/game/item-transfer/received?page=2']);
  assert.equal(f.env.rt.mmMail.unc[0]?.a, 'older');
});
function smithItem(target, location) { return { itemId: 920018, nameUk: 'Пояс першопрохідця', level: 0, max: false, canAfford: true, targetInstanceId: target,
  locationLabelUk: location, grade: 'D', slotLabelUk: 'Пояс', cost: { adena: 250000, coinOfLuck: 1, materials: [], nextLevel: 1 } }; }
function card(item) {
  const button = { textContent: 'Покращити до Lv.1', target: item.targetInstanceId };
  const fields = { '.l2-mammon-upgrade-card__name': { textContent: item.nameUk }, '.l2-mammon-upgrade-card__level': { textContent: 'Lv.0' },
    '.l2-mammon-upgrade-card__meta': { textContent: 'D-grade · Пояс · ' + item.locationLabelUk }, '.l2-mammon-upgrade-card__btn': button };
  return { querySelector: s => fields[s] || null };
}
check('одинаковые вещи одного уровня: улучшается надетый экземпляр', async () => {
  const bag = smithItem('bag:0', 'У сумці'), equipped = smithItem('eq:belt', 'Одягнено');
  const f = setup({ cards: [card(bag), card(equipped)], responses: { '/game/mammon/blacksmith/upgrades': { items: [bag, equipped] } } });
  await f.M.upgrade({ kind: 'smith', up: true, t: Date.now() }, [bag, equipped]);
  assert.equal(f.clicks.length, 1); assert.equal(f.clicks[0].target, 'eq:belt', 'клик должен соответствовать экземпляру, выбранному upItem');
});
check('уровень цели берётся у надетой вещи, а не у дубликата из сумки', async () => {
  const bag = { ...smithItem('bag:0', 'У сумці'), level: 5, max: true }, equipped = smithItem('eq:belt', 'Одягнено');
  const f = setup(); f.M.smithNote([bag, equipped]); assert.equal(f.M.gearLvl(920018), 0); assert.equal(f.M.goalPlan().done, undefined);
});
function mailPage(conflict = false) {
  let page = 1, claimed = false; const msg = { textContent: '', hidden: false };
  const tab = { classList: { contains: () => true } }, card = { dataset: { attachmentId: 'older' }, querySelector: () => ({ textContent: 'Steel ×3' }) };
  const claim = { closest: () => card, click: () => { msg.textContent = conflict ? 'Стан оновлено — спробуй ще раз.' : 'Предмет у сумці.'; if (!conflict) claimed = true; } };
  const buttons = () => [{ disabled: page === 1, click: () => { page--; } }, { disabled: page === 2, click: () => { page++; } }];
  const document = { querySelectorAll: s => /l2-mail-page-btn/.test(s) ? buttons() : [], querySelector: s => {
    if (/data-mail-tab/.test(s)) return tab;
    if (/l2-mail-page-label/.test(s)) return { textContent: `${page} / 2` };
    if (/l2-mail-items-msg/.test(s)) return msg;
    if (/l2-mail-item__claim/.test(s)) return (page === 2 || conflict) && !claimed ? claim : null;
    if (/l2-mail-item/.test(s)) return card;
    return null;
  } };
  return { document, claim, get page() { return page; } };
}
check('страница почты переходит от забранной истории к следующей странице с вложением', async () => {
  const p = mailPage(); const f = setup({ document: p.document }); f.box.location.pathname = '/mail.html';
  const J = { kind: 'claim', t: Date.now() }; f.env.rt.mmJob = J;
  await f.M.claimStep(J); assert.equal(p.page, 2); assert.ok(f.env.rt.mmJob, 'поход не завершён на первой странице');
  await f.M.claimStep(f.env.rt.mmJob); assert.equal(f.clicks.filter(x => x === p.claim).length, 1); assert.equal(f.env.rt.mmJob.got.length, 1);
});
check('ошибка ревизии при получении не засчитывается как забранное вложение', async () => {
  const p = mailPage(true); const f = setup({ document: p.document }); f.box.location.pathname = '/mail.html';
  const J = { kind: 'claim', t: Date.now() }; f.env.rt.mmJob = J; await f.M.claimStep(J);
  assert.equal(f.env.rt.mmJob?.got?.length || 0, 0); assert.ok(!f.env.rt.mmLog?.some(x => x.ok));
});
(async () => { let failures = 0; for (const [name, fn] of checks) { try { await fn(); console.log('PASS:', name); } catch (e) { failures++; console.error('FAIL:', name, '\n' + e.message); } } if (failures) process.exitCode = 1; })();
