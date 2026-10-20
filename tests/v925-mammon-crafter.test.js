'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 9.2.5 (игрок 12.10: «ник кланового крафтера Skye — отправлять ему ресурсы для очередного / всех повышений вещи у Маммона, он вернёт
// улучшенные ресурсы почтой; учитывать ресурсы, полученные по почте, и проверять, что в рюкзаке по факту»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/mammon.js');
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);   // объекты из vm — сравнение по JSON
// мини-DOM страницы «Передача предмета» и почты (как в item-transfer-ui.js / mail-item-render.js игры)
const el = (o = {}) => { const e = { hidden: false, disabled: false, textContent: '', value: '', dataset: {}, classList: { contains: c => (e.cls || []).includes(c) }, kids: {}, events: [], ...o };
  e.querySelector = s => e.kids[s] || null; e.dispatchEvent = ev => e.events.push(ev.type); e.closest = () => e.parent || null; return e; };
function transferPage({ to = 'Skye', qtyShown = null, err = '' } = {}) {
  const P = { fired: [] }, qIn = el(), nIn = el(), submit = el(), ok = el(), cancel = el(), body = el(), success = el({ hidden: true }), errEl = el({ hidden: true });
  const form = el({ kids: { 'input[type="number"]': qIn, 'input[type="text"]': nIn, 'button[type="submit"]': submit } });
  const rowBtn = el(), wrap = el({ dataset: { itemKey: 'stk:1869' }, kids: { '.l2-item-transfer-row': rowBtn } });
  const other = el({ dataset: { itemKey: 'stk:1458' } });
  const modal = el({ hidden: true, kids: { '#item-transfer-confirm-body': body, '.l2-item-transfer-confirm-actions .l2-item-transfer-form__btn:not(.l2-item-transfer-form__btn--ghost)': ok, '.l2-item-transfer-form__btn--ghost': cancel } });
  P.click = e => { P.fired.push(e);
    if (e === rowBtn) wrap.kids['form.l2-item-transfer-form'] = wrap.kids.form = form;
    if (e === submit) { modal.hidden = false; body.textContent = `Надіслати «Iron Ore» гравцю «${to}»?\nКількість: ${String(qtyShown ?? qIn.value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}\nКомісія: 8 аден`; }
    if (e === ok) { modal.hidden = true; if (err) { errEl.hidden = false; errEl.textContent = err; } else { success.hidden = false; success.textContent = 'Предмет надіслано.'; } }
    if (e === cancel) modal.hidden = true; };
  P.doc = { querySelector: s => s === '.l2-item-transfer-row-wrap' ? other : null, querySelectorAll: s => s === '.l2-item-transfer-row-wrap' ? [other, wrap] : [],
    getElementById: id => ({ 'item-transfer-confirm-modal': modal, 'item-transfer-success': success, 'item-transfer-err': errEl })[id] || null };
  Object.assign(P, { qIn, nIn, submit, ok, cancel, rowBtn, modal });
  return P;
}
const CAND = { candidates: [{ itemKey: 'stk:1458', itemId: 1458, stackable: true, availableQty: 100, transferValueUnitAdena: 10 }, { itemKey: 'stk:1869', itemId: 1869, stackable: true, availableQty: 115, transferValueUnitAdena: 10 }], page: 1, totalPages: 1 };
const mk = ({ rt = {}, cfg = {}, inv = {}, pn = '/map.html', doc = null, click = null, received = [], invAfter = null } = {}) => {
  const recs = [], fired = [], loc = { pathname: pn, href: '' }, gets = [];
  class Event { constructor(t) { this.type = t; } }
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Event, location: loc, document: doc || { querySelectorAll: () => [], querySelector: () => null, getElementById: () => null },
    sessionStorage: { getItem: () => null, setItem: () => {} } };
  sb.globalThis = sb; vm.runInNewContext(src, sb);
  const bag = { ...inv };
  const env = { rt: { mmEq: { belt: [920018, 0] }, ...rt }, cfg: { mmGoalItem: 920018, mmGoalLvl: 1, ...cfg }, recs, fired,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {}, waitX: async fn => fn(),
    fire: e => { fired.push(e); click?.(e); return true; }, $q: () => null, isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false,
    autonomyMode: () => 'hunt', tvtSoon: () => false, heroNick: () => 'Warlock', invQty: id => bag[id] ?? (Object.keys(bag).length ? 0 : null), ITEMS: {}, FARM: { res: {} },
    invRefresh: async () => { if (invAfter) Object.assign(bag, invAfter); return { ...bag }; },
    gameGet: async p => { gets.push(p); const j = /candidates/.test(p) ? CAND : /received/.test(p) ? { attachments: received } : {}; return { ok: true, status: 200, json: async () => j }; } };
  return { env, M: sb.L2V7Factories.mammon(env), loc, fired, recs, bag, gets };
};
// пояс D Lv.0 → 1 (MM_KNOWN): Кристалл D 100, Iron Ore 100, Mithril Ore 100, Steel 3; Steel = 5 Iron Ore + 5 Varnish → крафтеру 15 Iron Ore + 15 Varnish
const INV = { 1458: 100, 1869: 115, 1876: 100, 1865: 20 };
(async () => {
  // 1. план: что из сумки крафтеру (сырьё на крафт), что вернётся (Steel 3), набор полный; руда на кузнеца не уходит
  { const { M } = mk({ inv: INV }); const P = M.goalAll();
    same(P.snd.map(x => [x.id, x.q]).sort(), [[1865, 15], [1869, 15]]); assert.equal(P.cmiss, 0); same(P.ret, { 1880: 3 }); }
  { const { M } = mk({ inv: { ...INV, 1865: 6 } }); const P = M.goalAll(); assert.equal(P.cmiss, 9, 'varnish short 9'); }
  // 2. сам — только полный набор и одна партия за раз; выключено / нет ника — нет
  { const { M } = mk({ inv: INV }); const w = M.craftWant(); assert.equal(w.kind, 'send'); assert.equal(w.to, 'Skye'); assert.equal(w.cmd, false);
    same(w.items.map(x => [x[0], x[1]]).sort(), [[1865, 15], [1869, 15]]); assert.match(w.why, /Iron Ore 15/); }
  assert.equal(mk({ inv: { ...INV, 1865: 6 } }).M.craftWant(), null, 'incomplete set — wait');
  assert.equal(mk({ inv: INV, cfg: { mmCraftSend: false } }).M.craftWant(), null);
  assert.equal(mk({ inv: INV, cfg: { mmCrafter: '' } }).M.craftWant(), null);
  assert.equal(mk({ inv: INV, rt: { mmCraft: { at: { 1869: 5 } } } }).M.craftWant(), null, 'previous batch still at the crafter');
  assert.equal(mk({ inv: {} }).M.craftWant(), null, 'bag unknown — check it first');
  // кнопка: неполный набор всё равно уходит; нечего — отказ с причиной
  { const { M } = mk({ inv: { ...INV, 1865: 6 }, rt: { mmCraftReq: { t: Date.now() } } }); const w = M.craftWant(); assert.equal(w.cmd, true); assert.match(w.why, /по кнопке.*неполный/); }
  { const { env, M } = mk({ inv: { 1458: 100, 1869: 100, 1876: 100 }, rt: { mmCraftReq: { t: Date.now() } } });
    assert.equal(await M.mmStep(), false); assert.equal(env.rt.mmCraftReq, null); assert.match(env.rt.mmCraftSay.why, /Отправка ресурсов крафтеру удалена/); }
  // 3. то, что у крафтера, — своё: план не просит слать и фармить его снова
  { const { M } = mk({ inv: { 1458: 100, 1869: 100, 1876: 100, 1865: 5 }, rt: { mmCraft: { at: { 1869: 15, 1865: 15 }, t0: Date.now() } } });
    const P = M.goalAll(); assert.equal(P.snd.length, 0); assert.equal(P.cmiss, 0); assert.ok(P.raw.every(r => r.miss === 0), 'nothing to farm'); }
  // 4. поход: страница передачи — строка, количество и ник, «Надіслати», в окне наш крафтер и количество → «Підтвердити»
  { const T = transferPage();
    const { env, M, recs } = mk({ inv: INV, pn: '/item-transfer.html', doc: T.doc, click: T.click, cfg: { mmCraftNote: false } });   // письмо крафтеру — v1002-crafter-note
    const w = M.craftWant(); env.rt.mmJob = { ...w, step: 'act', t: Date.now() };
    env.rt.mmJob.items = [[1869, 15, 'Iron Ore']];
    await M.sendStep(env.rt.mmJob);
    assert.equal(T.fired.length, 3); assert.ok(T.fired[0] === T.rowBtn && T.fired[1] === T.submit && T.fired[2] === T.ok, 'row → send → confirm'); assert.equal(T.qIn.value, '15'); assert.equal(T.nIn.value, 'Skye'); assert.ok(T.qIn.events.includes('input'));
    same(env.rt.mmCraft.at, { 1869: 15 }); same(env.rt.mmCraft.ret, { 1880: 3 }); assert.equal(env.rt.mmJob.items.length, 0);
    assert.match(recs.join('\n'), /крафтеру Skye: отправил Iron Ore ×15 \(комиссия 8 адены\)/);
    await M.sendStep(env.rt.mmJob); assert.equal(env.rt.mmJob, null); assert.equal(env.rt.mmLog[0].kind, 'send'); assert.equal(env.rt.mmLog[0].ok, true);
    assert.match(env.rt.mmLog[0].why, /отправил Skye: Iron Ore 15 · комиссия 8 адены — жду готовое/); }
  // в окне подтверждения чужой ник или другое количество — «Скасувати», ничего не ушло
  for (const o of [{ to: 'Dremia' }, { qtyShown: 1500 }]) {
    const T = transferPage(o); const { env, M } = mk({ inv: INV, pn: '/item-transfer.html', doc: T.doc, click: T.click });
    env.rt.mmJob = { kind: 'send', to: 'Skye', step: 'act', items: [[1869, 15, 'Iron Ore']], t: Date.now() };
    await M.sendStep(env.rt.mmJob);
    assert.ok(!T.fired.includes(T.ok), 'not confirmed'); assert.ok(T.fired.includes(T.cancel)); assert.equal(env.rt.mmCraft, undefined); assert.equal(env.rt.mmLog[0].ok, false); }
  // ошибка игры — в журнал, «у крафтера» не пишем
  { const T = transferPage({ err: 'Гравця не знайдено.' }); const { env, M } = mk({ inv: INV, pn: '/item-transfer.html', doc: T.doc, click: T.click });
    env.rt.mmJob = { kind: 'send', to: 'Skye', step: 'act', items: [[1869, 15, 'Iron Ore']], t: Date.now() };
    await M.sendStep(env.rt.mmJob); assert.match(env.rt.mmLog[0].why, /Гравця не знайдено/); assert.equal(env.rt.mmCraft, undefined); }
  // 5. нажали, ответа не видели (страница перезагрузилась): по сумке ушло → засчитали без второго нажатия; не ушло → шлём снова
  { const T = transferPage(); const { env, M } = mk({ inv: INV, pn: '/item-transfer.html', doc: T.doc, click: T.click, invAfter: { 1869: 100 } });
    env.rt.mmJob = { kind: 'send', to: 'Skye', step: 'act', items: [[1869, 15, 'Iron Ore']], cur: { id: 1869, q: 15, nm: 'Iron Ore', before: 115 }, t: Date.now() };
    await M.sendStep(env.rt.mmJob); assert.equal(T.fired.length, 0, 'no double send'); same(env.rt.mmCraft.at, { 1869: 15 }); }
  { const T = transferPage(); const { env, M } = mk({ inv: INV, pn: '/item-transfer.html', doc: T.doc, click: T.click });
    env.rt.mmJob = { kind: 'send', to: 'Skye', step: 'act', items: [[1869, 15, 'Iron Ore']], cur: { id: 1869, q: 15, nm: 'Iron Ore', before: 115 }, t: Date.now() };
    await M.sendStep(env.rt.mmJob); assert.ok(T.fired.includes(T.ok), 'not sent → sent now'); }
  // 6. почта: непрочитанные вложения → в журнал и поход «Забрати»; письмо от крафтера, забранное в сумку, списывает «у крафтера» по рецепту
  { const now = Date.now(), iso = t => new Date(t).toISOString();
    const received = [{ attachmentId: 7, senderName: 'skye', itemId: 1880, name: 'Steel', qty: 3, createdAt: iso(now), claimedAt: iso(now) },
      { attachmentId: 8, senderName: 'Skye', itemId: 1458, name: 'Crystal: D-Grade', qty: 50, createdAt: iso(now), claimedAt: null }];
    const { env, M, recs } = mk({ inv: INV, received, rt: { mmCraft: { to: 'Skye', at: { 1869: 15, 1865: 15 }, t0: now - 1000 } } });
    await M.mailPoll();
    assert.equal(env.rt.mmCraft, null, 'all returned'); assert.match(recs.join('\n'), /Skye вернул: Steel ×3 · всё отправленное вернулось/);
    assert.equal(env.rt.mmMail.unc.length, 1); assert.match(recs.join('\n'), /почта: пришло Crystal: D-Grade ×50 от Skye/);
    const w = M.want(); assert.equal(w.kind, 'claim');
    await M.mailPoll(); assert.equal(recs.filter(r => /пришло/.test(r)).length, 1, 'logged once'); }
  { const now = Date.now(), at = { 1869: 30, 1865: 30 };
    const { env, M } = mk({ received: [{ attachmentId: 9, senderName: 'Skye', itemId: 1880, name: 'Steel', qty: 3, createdAt: new Date(now).toISOString(), claimedAt: new Date(now).toISOString() }], rt: { mmCraft: { to: 'Skye', at, t0: now - 1000 } } });
    await M.mailPoll(); same(env.rt.mmCraft.at, { 1869: 15, 1865: 15 }, 'partly returned'); await M.mailPoll(); same(env.rt.mmCraft.at, { 1869: 15, 1865: 15 }, 'counted once'); }
  { const old = Date.now() - 86400000;      // старое письмо (до отправки) и чужое — не считаются
    const { env, M } = mk({ received: [{ attachmentId: 1, senderName: 'Skye', itemId: 1880, qty: 3, createdAt: new Date(old).toISOString(), claimedAt: 'x' }, { attachmentId: 2, senderName: 'Bob', itemId: 1880, qty: 3, createdAt: new Date().toISOString(), claimedAt: 'x' }],
      rt: { mmCraft: { to: 'Skye', at: { 1869: 15, 1865: 15 }, t0: Date.now() - 1000 } } });
    await M.mailPoll(); same(env.rt.mmCraft.at, { 1869: 15, 1865: 15 }); }
  // 7. «Забрати» на вкладке «Предмети»; переполненный инвентарь — стоп
  for (const full of [false, true]) {
    const msg = el({ hidden: true }), claim = el(), card = el({ kids: { '.l2-mail-item-transfer__name': el({ textContent: 'Steel ×3' }), '.l2-mail-item__sender': el({ textContent: 'Skye' }) } }), tab = el({ cls: [] });
    claim.parent = card; let left = 1;
    const doc = { querySelector: s => s === '#mail-tabs [data-mail-tab="items"]' ? tab : /__claim/.test(s) ? (left ? claim : null) : /l2-mail-items-msg/.test(s) ? msg : /l2-mail-empty/.test(s) ? (left ? null : {}) : null,
      querySelectorAll: () => [], getElementById: () => null };
    const { env, M, fired } = mk({ pn: '/mail.html', doc, click: e => { if (e === claim) { left = 0; msg.hidden = false; msg.textContent = full ? 'Ваш інвентар переповнений!' : 'Предмет у сумці.'; if (full) left = 1; } } });
    env.rt.mmJob = { kind: 'claim', step: 'act', t: Date.now() };
    await M.claimStep(env.rt.mmJob); assert.equal(fired.length, 2); assert.ok(fired[0] === tab && fired[1] === claim);
    if (full) { assert.equal(env.rt.mmLog[0].ok, false); assert.match(env.rt.mmLog[0].why, /переполнен/); continue; }
    same(env.rt.mmJob.got, ['Steel ×3 от Skye']);
    await M.claimStep(env.rt.mmJob); assert.equal(env.rt.mmJob, null); assert.match(env.rt.mmLog[0].why, /забрал: Steel ×3 от Skye/); assert.equal(env.rt.mmClaimT > 0, true); }
  // 8. сумка по факту: ответов с сумкой > 5 мин не было → свой GET /character (раз в 5 мин); почта — раз в 10 мин
  { const { env, M, gets } = mk({ rt: { char: 'Warlock' } }); let n = 0;
    // 20.23: автоматический анализ требует владельца, аренду и разрешённую задачу.
    Object.assign(env, { on: true, tabOwner: true, leaseEpoch: 'test-lease', bagAllowed: () => true,
      setRt: async p => { Object.assign(env.rt, p); return { ok: true }; } });
    env.invRefresh = async () => { n++; return {}; };
    await M.mmTick(); assert.equal(n, 1); assert.ok(gets.some(g => /item-transfer\/received/.test(g)));
    await M.mmTick(); assert.equal(n, 1, 'not every loop'); }
  // 10. игрок 12.10: «нужно не на все 5 уровней, а на все недостающие» — вещь Lv.2, цель Lv.5: сырьё только на Lv.2→3, 3→4, 4→5
  { const c = (st) => ({ a: 1, c: 1, m: [[1880, 'Steel', st]], t: Date.now() });
    const mmCost = { '920018:0': c(100), '920018:1': c(100), '920018:2': c(3), '920018:3': c(3), '920018:4': c(3) };
    const { M, env } = mk({ inv: { 1869: 1000, 1865: 1000 }, cfg: { mmGoalLvl: 5, mmCraftScope: 'all' }, rt: { mmEq: { belt: [920018, 2] }, mmCost } });
    const P = M.craftPlan(); same(P.lv.map(x => x.L), [2, 3, 4]);
    same(P.snd.map(x => [x.id, x.q]).sort(), [[1865, 45], [1869, 45]], '3 levels × Steel 3 × 5 — not from Lv.0');
    assert.match(M.craftWant().why, /Lv\.2 → 5 \(недостающие 3 ур\.\)/);
    env.cfg.mmCraftScope = 'next'; same(M.craftPlan().snd.map(x => [x.id, x.q]).sort(), [[1865, 15], [1869, 15]], 'next level only'); }
  assert.ok(!read('popup.html').includes('id="mmCraftScope"'), '20.7: выбор объёма удалённой отправки убран');
  // 9. меню, настройки, ядро
  const html = read('popup.html'), pj = (read('defaults.js') + '\n' + read('popup.js')), c = (read('defaults.js') + '\n' + read('content.js'));
  for (const id of ['mmMailClaim', 'mmCraftBox', 'mmCraftForget']) assert.ok(html.includes(`id="${id}"`), id);
  // 20.7: поля передачи удалены; старые ключи профилей остаются совместимыми.
  assert.doesNotMatch(pj, /const TXT {2}= \[[^\]]*'mmCrafter'/); assert.doesNotMatch(pj, /const BOOL = \[[^\]]*'mmCraftSend'/);
  assert.match(pj, /mmCrafter: 'Skye', mmCraftScope: 'next', mmCraftSend: true, (mmCraftNote: true, )?mmMailClaim: true/); assert.match(c, /mmCrafter: 'Skye', mmCraftScope: 'next', mmCraftSend: true, (mmCraftNote: true, )?mmMailClaim: true/);
  // 20.23: анализ передаёт invRefresh guard; успешное письмо дополнительно обновляет рюкзак.
  // 20.32: проверки контекста перед GET стали длиннее; контракт сумки проверяем в границах функции, без лимита400символов.
  const invStart=c.indexOf('async function invRefresh('),invBody=c.slice(invStart,c.indexOf('async function inventoryReady(',invStart));
  assert.match(c, /get invRefresh\(\) \{ return invRefresh; \}/); assert.ok(invStart>0);assert.match(invBody,/await gameGet\('\/character'\)/);assert.match(invBody,/inventory\?\.stacks/);
  assert.match(c, /item-transfer\/claim' && d\.status === 200[^\n]*\) \{\s*L2V7Modules\.mammon\.mailNote\(\); L2V7Modules\.mammon\.mailSeen\(\);\s*L2V7Modules\.mammon\.bagAfterClaim\(d\.req\?\.attachmentId \|\| d\.res\.attachmentId\)/);
  console.log('PASS: 9.2.5 crafter — raw for crafting sent to Skye by «Передача предмета» (full set, one batch, recipient/qty checked in the confirm window, no double send), returns from mail written off by recipe, mail items claimed, bag checked by GET /character');
})().catch(e => { console.error(e); process.exit(1); });
