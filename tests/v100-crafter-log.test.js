'use strict';
// 10.0 (лог игрока 12.10 17:26–17:38, 9.2.5, «нормально не работает отправка ресурсов крафтеру»):
// 1) страница «Передача предмета»: Thread на стр. 6 после Iron Ore на стр. 5 — бот листал «« Назад» до 1-й и вперёд до 6-й, по 3 с на каждой
//    (≈34 с на предмет). Теперь листаем прямо к странице из candidates по подписи «Страница N / M».
// 2) почта: «✓ забрал: ? от Skye» — игра заменяет класс имени предмета (L2.decorateItemNameEl) → имя из списка почты по attachmentId.
// 3) кнопка «отправить крафтеру сейчас» после отправки: «крафтить нечего» → пишет, что сырьё уже у крафтера; в журнале отправки — какие уровни по оценке.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'modules/mammon.js'), 'utf8');
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const el = (o = {}) => { const e = { hidden: false, disabled: false, textContent: '', value: '', dataset: {}, classList: { contains: c => (e.cls || []).includes(c) }, kids: {}, events: [], ...o };
  e.querySelector = s => e.kids[s] || null; e.dispatchEvent = ev => e.events.push(ev.type); e.closest = () => e.parent || null; return e; };
const mk = ({ rt = {}, cfg = {}, inv = {}, pn = '/map.html', doc = null, click = null, cand = null } = {}) => {
  const recs = [], fired = [], loc = { pathname: pn, href: '' };
  class Event { constructor(t) { this.type = t; } }
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Event, location: loc, document: doc || { querySelectorAll: () => [], querySelector: () => null, getElementById: () => null },
    sessionStorage: { getItem: () => null, setItem: () => {} } };
  sb.globalThis = sb; vm.runInNewContext(src, sb);
  const bag = { ...inv };
  const env = { rt: { mmEq: { belt: [920018, 0] }, ...rt }, cfg: { mmGoalItem: 920018, mmGoalLvl: 1, ...cfg }, recs, fired,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {}, waitX: async fn => fn(),
    fire: e => { fired.push(e); click?.(e); return true; }, $q: () => null, isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false,
    autonomyMode: () => 'hunt', tvtSoon: () => false, heroNick: () => 'Warlock', invQty: id => bag[id] ?? (Object.keys(bag).length ? 0 : null), ITEMS: {}, FARM: { res: {} },
    invRefresh: async () => ({ ...bag }),
    gameGet: async p => { const pg = +(/page=(\d+)/.exec(p) || [])[1] || 1; const j = /candidates/.test(p) ? cand(pg) : {}; return { ok: true, status: 200, json: async () => j }; } };
  return { env, M: sb.L2V7Factories.mammon(env), fired, recs };
};
(async () => {
  // 1. листание: стоим на стр. 5 из 6, Thread (1868) на стр. 6 → одно нажатие «Вперед »», отправлено
  { let cur = 5; const total = 6;
    const cand = pg => ({ candidates: pg === 6 ? [{ itemKey: 'bag:1868:0', itemId: 1868, stackable: true, availableQty: 4254, transferValueUnitAdena: 498 }] : [{ itemKey: `bag:${900 + pg}:0`, itemId: 900 + pg, stackable: true, availableQty: 1 }], page: pg, totalPages: total });
    const label = el(), prev = el(), next = el(), qIn = el(), nIn = el(), submit = el(), ok = el(), cancel = el(), body = el(), success = el({ hidden: true }), errEl = el({ hidden: true });
    const form = el({ kids: { 'input[type="number"]': qIn, 'input[type="text"]': nIn, 'button[type="submit"]': submit } });
    const rowBtn = el(), wrap = el({ dataset: { itemKey: 'bag:1868:0' }, kids: { '.l2-item-transfer-row': rowBtn } }), other = el({ dataset: { itemKey: 'bag:905:0' } });
    const modal = el({ hidden: true, kids: { '#item-transfer-confirm-body': body, '.l2-item-transfer-confirm-actions .l2-item-transfer-form__btn:not(.l2-item-transfer-form__btn--ghost)': ok, '.l2-item-transfer-form__btn--ghost': cancel } });
    const sync = () => { label.textContent = `Страница ${cur} / ${total}`; prev.disabled = cur <= 1; next.disabled = cur >= total; };
    sync();
    const rows = () => cur === 6 ? [wrap] : [other];
    const doc = { querySelector: s => s === '.l2-item-transfer-row-wrap' ? rows()[0] : s === '#item-transfer-pagination .l2-item-transfer-page-label' ? label : null,
      querySelectorAll: s => s === '.l2-item-transfer-row-wrap' ? rows() : s === '#item-transfer-pagination .l2-item-transfer-page-btn' ? [prev, next] : [],
      getElementById: id => ({ 'item-transfer-confirm-modal': modal, 'item-transfer-success': success, 'item-transfer-err': errEl })[id] || null };
    const click = e => {
      if (e === next) { cur++; sync(); } if (e === prev) { cur--; sync(); }
      if (e === rowBtn) wrap.kids['form.l2-item-transfer-form'] = form;
      if (e === submit) { modal.hidden = false; body.textContent = `Надіслати «Thread» гравцю «Skye»?\nКількість: 700`; }
      if (e === ok) { modal.hidden = true; success.hidden = false; success.textContent = 'Предмет надіслано.'; } };
    const { env, M, fired } = mk({ inv: { 1868: 4254 }, pn: '/item-transfer.html', doc, click, cand });
    env.rt.mmJob = { kind: 'send', to: 'Skye', step: 'act', items: [[1868, 700, 'Thread']], t: Date.now(), inv: 1 };
    await M.sendStep(env.rt.mmJob);
    assert.equal(fired.filter(e => e === next || e === prev).length, 1, 'straight to page 6: one «Вперед»');
    assert.ok(fired.includes(ok), 'sent'); same(env.rt.mmCraft.at, { 1868: 700 });
    // со стр. 6 к стр. 2 — четыре «Назад», без захода на 1-ю
    cur = 6; sync(); env.rt.mmJob = null; fired.length = 0;
    assert.equal(await M.pageGo(2), true); assert.equal(cur, 2); assert.equal(fired.filter(e => e === prev).length, 4); assert.equal(fired.filter(e => e === next).length, 0);
  }
  // 2. почта: имени с классом .l2-mail-item-transfer__name нет (игра его перекрасила) → имя и число из списка почты по attachmentId
  { const msg = el({ hidden: true }), claim = el(), tab = el({ cls: ['is-active'] });
    const card = el({ dataset: { attachmentId: 'cmv4xo29o003tpi5naoeku15i' }, kids: { '.l2-mail-item__sender': el({ textContent: 'Skye' }), '.l2-mail-item-transfer__loot': el({ textContent: 'Сталь ×50' }) } });
    claim.parent = card; let left = 1;
    const doc = { querySelector: s => s === '#mail-tabs [data-mail-tab="items"]' ? tab : /__claim/.test(s) ? (left ? claim : null) : /l2-mail-items-msg/.test(s) ? msg : /l2-mail-empty/.test(s) ? (left ? null : {}) : null,
      querySelectorAll: () => [], getElementById: () => null };
    const { env, M } = mk({ pn: '/mail.html', doc, click: e => { if (e === claim) { left = 0; msg.hidden = false; msg.textContent = 'Предмет у сумці.'; } },
      rt: { mmMail: { t: Date.now(), unc: [{ a: 'cmv4xo29o003tpi5naoeku15i', s: 'Skye', id: 1880, n: 'Steel', q: 50 }] } } });
    env.rt.mmJob = { kind: 'claim', step: 'act', t: Date.now() };
    await M.claimStep(env.rt.mmJob); same(env.rt.mmJob.got, ['Steel ×50 от Skye']);
    // нет в списке почты — строка «Ви отримали» карточки
    card.dataset.attachmentId = 'other'; left = 1; env.rt.mmJob = { kind: 'claim', step: 'act', t: Date.now() };
    await M.claimStep(env.rt.mmJob); same(env.rt.mmJob.got, ['Сталь ×50 от Skye']); }
  // 3. кнопка сразу после отправки: что лежит у крафтера; в журнале отправки — с какого уровня цены по оценке
  { const INV = { 1458: 100, 1869: 100, 1876: 100 };
    const { env, M } = mk({ inv: INV, rt: { mmCraftReq: { t: Date.now() }, mmCraft: { to: 'Skye', at: { 1869: 15, 1865: 15 }, t0: Date.now() } } });
    assert.equal(await M.mmStep(), false); assert.match(env.rt.mmCraftSay.why, /сырьё уже у крафтера Skye \(.*15.*\) — жду готовое письмом/); }
  { const { M } = mk({ inv: { 1458: 1000, 1869: 1000, 1876: 1000, 1865: 1000 }, cfg: { mmGoalLvl: 3, mmCraftScope: 'all' } });
    const w = M.craftWant(); assert.equal(w.kind, 'send'); assert.match(w.why, /цены с Lv\.1 → 2 — оценка/); }
  { const { M } = mk({ inv: { 1458: 100, 1869: 115, 1876: 100, 1865: 20 } });
    assert.doesNotMatch(M.craftWant().why, /оценка/, 'known price (Lv.0 → 1) — no note'); }
  console.log('PASS: 10.0 crafter (log 12.10 17:26–17:38) — transfer list paged straight to the item\'s page, mail claim names the item, «send now» says what is at the crafter, estimated levels noted');
})().catch(e => { console.error(e); process.exit(1); });
