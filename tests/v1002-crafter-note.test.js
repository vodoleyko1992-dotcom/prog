'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 10.0.2 (игрок 12.10: «приписывать последним письмом при отправке ресурсов — письмо, какие ресурсы нам нужны на крафт и сколько, чтобы игрок
// знал что делать и что возвращать»): после партии сырья — письмо крафтеру на /mail-compose.html (что отправил, что скрафтить, что вернуть)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/mammon.js');
// мини-страница «Нове повідомлення» (mail-compose.html игры)
function composePage({ err = '' } = {}) {
  const el = (o = {}) => ({ hidden: false, readOnly: false, textContent: '', value: '', events: [], dispatchEvent(ev) { this.events.push(ev.type); }, ...o });
  const P = { fired: [], form: el(), to: el(), text: el(), submit: el(), ok: el({ hidden: true }), err: el({ hidden: true }) };
  P.click = e => { P.fired.push(e); if (e !== P.submit) return;
    if (err) { P.err.hidden = false; P.err.textContent = err; } else { P.form.hidden = true; P.ok.hidden = false; P.ok.textContent = 'Повідомлення надіслано.'; P.sent = { to: P.to.value, text: P.text.value }; } };
  P.doc = { querySelector: () => null, querySelectorAll: () => [],
    getElementById: id => ({ 'mail-compose-form': P.form, 'mail-compose-to': P.to, 'mail-compose-text': P.text, 'mail-compose-submit': P.submit, 'mail-compose-success': P.ok, 'mail-compose-err': P.err })[id] || null };
  return P;
}
const mk = ({ rt = {}, cfg = {}, inv = {}, pn = '/map.html', doc = null, click = null, received = [] } = {}) => {
  const recs = [], loc = { pathname: pn, href: '' };
  class Event { constructor(t) { this.type = t; } }
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Event, location: loc, document: doc || { querySelectorAll: () => [], querySelector: () => null, getElementById: () => null },
    sessionStorage: { getItem: () => null, setItem: () => {} } };
  sb.globalThis = sb; vm.runInNewContext(src, sb);
  const env = { rt: { mmEq: { belt: [920018, 0] }, ...rt }, cfg: { mmGoalItem: 920018, mmGoalLvl: 1, ...cfg }, recs,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {}, waitX: async fn => fn(),
    fire: e => { click?.(e); return true; }, $q: () => null, isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false,
    autonomyMode: () => 'hunt', tvtSoon: () => false, heroNick: () => 'Warlock', invQty: id => inv[id] ?? (Object.keys(inv).length ? 0 : null), ITEMS: {}, FARM: { res: {} },
    invRefresh: async () => ({ ...inv }), gameGet: async p => ({ ok: true, status: 200, json: async () => /received/.test(p) ? { attachments: received } : {} }) };
  return { env, M: sb.L2V7Factories.mammon(env), loc, recs };
};
// пояс D Lv.0 → 1: Steel 3 = 15 Iron Ore + 15 Varnish (как в v925-mammon-crafter)
const INV = { 1458: 100, 1869: 115, 1876: 100, 1865: 20 };
(async () => {
  // 1. задание в партии: что скрафтить и что вернуть; 17.10.2026: текст письма по-русски, ник героя, без лишнего
  { const { M } = mk({ inv: INV }); const w = M.craftWant();
    assert.equal(JSON.stringify(w.note.craft), JSON.stringify([['Steel', 3]])); assert.equal(JSON.stringify(w.note.ret), JSON.stringify([['Steel', 3]])); assert.equal(w.note.part, false);
    const t = M.noteText(w.note, [['Iron Ore', 15], ['Varnish', 15]], 'Warlock');
    assert.equal(t.length, 1);
    assert.match(t[0], /^Привет! Отправил ресурсы на крафт \(.*Lv\.0 → 1\): Iron Ore ×15, Varnish ×15\.\nСкрафти, пожалуйста, и верни почтой на Warlock: Steel ×3\.\nСпасибо!$/);
    assert.ok(!/бот|bot|скрипт/i.test(t[0])); }
  // скрафтить ≠ вернуть (промежуточное): две строки; неполный набор — приписка
  { const { M } = mk(); const t = M.noteText({ goal: 'Belt Lv.1 → 2', part: true, craft: [['Steel', 6], ['Mithril Alloy', 3]], ret: [['Mithril Alloy', 3]] }, [['Iron Ore', 30]], 'Warlock')[0];
    assert.match(t, /Скрафти, пожалуйста: Steel ×6, Mithril Alloy ×3\.\nВерни почтой на Warlock: Mithril Alloy ×3\.\nЧасть сырья ещё собираю — дошлю позже\.\nСпасибо!/); }
  // длинное письмо (игра: до 1000 знаков) — делится, каждый кусок ≤ 990, ничего не потеряно
  { const { M } = mk(); const many = Array.from({ length: 80 }, (_, i) => [`Very Long Material Name Number ${i}`, 1000 + i]);
    const t = M.noteText({ goal: 'X', part: false, craft: many, ret: many.slice(0, 40) }, many, 'Warlock');
    assert.ok(t.length >= 3, 'split into ' + t.length); assert.ok(t.every(x => x.length <= 990));
    for (const [n] of many) assert.ok(t.join('\n').includes(n)); assert.match(t[t.length - 1], /Спасибо!$/); }
  // галка выключена — без письма
  assert.equal(mk({ inv: INV, cfg: { mmCraftNote: false } }).M.craftWant().note, null);
  // 2. партия ушла → переход на «Нове повідомлення» → «Кому» и текст → «Надіслати» → «надіслано» → итог «письмо с заданием отправил»
  { const P = composePage(); const { env, M, loc, recs } = mk({ inv: INV, pn: '/item-transfer.html', doc: P.doc, click: P.click });
    const w = M.craftWant(); env.rt.mmJob = { ...w, step: 'act', t: Date.now(), items: [], done: [['Iron Ore', 15, 8], ['Varnish', 15, 9]] };
    await M.sendStep(env.rt.mmJob); assert.equal(loc.href, '/mail-compose.html'); assert.equal(P.fired.length, 0);
    loc.pathname = '/mail-compose.html';
    await M.sendStep(env.rt.mmJob);
    assert.equal(P.fired.length, 1); assert.equal(P.sent.to, 'Skye'); assert.match(P.sent.text, /Iron Ore ×15, Varnish ×15[\s\S]*верни почтой на Warlock: Steel ×3/);
    assert.ok(P.text.events.includes('input')); assert.match(recs.join('\n'), /письмо крафтеру Skye: Привет!/);
    await M.sendStep(env.rt.mmJob); await M.sendStep(env.rt.mmJob);
    assert.equal(env.rt.mmJob, null); assert.equal(env.rt.mmLog[0].ok, true); assert.match(env.rt.mmLog[0].why, /отправил Skye: Iron Ore 15, Varnish 15 · комиссия 17 адены · письмо с заданием отправил — жду готовое/);
    assert.equal(P.fired.length, 1, 'one letter'); }
  // ошибка игры — партия всё равно засчитана, в итоге «письмо не ушло (…)»
  { const P = composePage({ err: 'Гравця не знайдено.' }); const { env, M } = mk({ inv: INV, pn: '/mail-compose.html', doc: P.doc, click: P.click });
    env.rt.mmJob = { ...M.craftWant(), step: 'act', t: Date.now(), items: [], done: [['Iron Ore', 15, 8]] };
    for (let i = 0; i < 3 && env.rt.mmJob; i++) await M.sendStep(env.rt.mmJob);
    assert.equal(env.rt.mmJob, null); assert.equal(env.rt.mmLog[0].ok, true); assert.match(env.rt.mmLog[0].why, /письмо не ушло \(Гравця не знайдено\.\)/); }
  // нажали «Надіслати», ответа не видели (перезагрузка) — второй раз не шлём
  { const P = composePage(); const { env, M } = mk({ inv: INV, pn: '/mail-compose.html', doc: P.doc, click: P.click });
    env.rt.mmJob = { ...M.craftWant(), step: 'act', t: Date.now(), items: [], done: [['Iron Ore', 15, 8]], notes: ['Привет!'], noteCur: Date.now() };
    for (let i = 0; i < 3 && env.rt.mmJob; i++) await M.sendStep(env.rt.mmJob);
    assert.equal(P.fired.length, 0, 'no double letter'); assert.equal(env.rt.mmJob, null); }
  // партия ушла не вся — письмо уходит с досылкой и перечисляет всё отправленное
  { const { env, M } = mk({ inv: INV, rt: { mmCraft: { to: 'Skye', at: { 1869: 15 }, t0: Date.now() } } });
    const w = M.craftWant() || { kind: 'send', to: 'Skye', items: [[1865, 15, 'Varnish']], note: { goal: 'Belt Lv.0 → 1', part: false, craft: [['Steel', 3]], ret: [['Steel', 3]] } };
    await M.finish({ ...w, done: [['Iron Ore', 15, 8]], items: [[1865, 15, 'Varnish']] }, false, 'строки нет');
    assert.equal(JSON.stringify(env.rt.mmCraft.pendNote.prev), JSON.stringify([['Iron Ore', 15]]));
    env.rt.mmSendT = 0; const p = M.craftWant(); assert.equal(p.pendJob, true);
    const t = M.noteText(p.note, [...p.note.prev, ['Varnish', 15]], 'Warlock')[0]; assert.match(t, /Iron Ore ×15, Varnish ×15/); }
  // лог 12.10 17:47: сырьё на Durable Metal Plate (Thread 700, Iron Ore 255, Mithril Ore 70) — Skye вернул Steel Mold ×19 (его из отправленного
  // не сделать: Braided Hemp + Coal + Iron Ore). «У крафтера» не списываем, пишем «вернул не то» и чего ждём; имена сырья — не «#1868»
  { const now = Date.now(), iso = new Date(now).toISOString();
    const { env, M, recs } = mk({ received: [{ attachmentId: 'a1', senderName: 'Skye', itemId: 1883, name: 'Steel Mold', qty: 19, createdAt: iso, claimedAt: iso }],
      rt: { mmCraft: { to: 'Skye', at: { 1868: 700, 1869: 255, 1876: 70 }, t0: now - 1000, ret: { 5550: 14 }, want: [['Durable Metal Plate', 14]] } } });
    await M.mailPoll();
    const r = recs.join('\n');
    assert.match(r, /Skye вернул не то, что нужно: Steel Mold ×19 — из отправленного это не делается; ждём: Durable Metal Plate ×14/);
    assert.match(r, /у крафтера ещё Thread 700, Iron Ore \d+, Mithril Ore 70/); assert.equal(env.rt.mmCraft.at[1868], 700); }
  // нужное вернулось — списано, без «не то»
  { const now = Date.now(), iso = new Date(now).toISOString();
    const { env, M, recs } = mk({ received: [{ attachmentId: 'a2', senderName: 'Skye', itemId: 5550, name: 'Durable Metal Plate', qty: 14, createdAt: iso, claimedAt: iso }],
      rt: { mmCraft: { to: 'Skye', at: { 1868: 700, 1869: 350, 1876: 70 }, t0: now - 1000, ret: { 5550: 14 } } } });
    await M.mailPoll(); assert.ok(!recs.some(x => /не то/.test(x))); assert.equal(env.rt.mmCraft, null, 'plates write off all the raw'); }
  // меню и настройки
  const html = read('popup.html'), pj = (read('defaults.js') + '\n' + read('popup.js')), c = (read('defaults.js') + '\n' + read('content.js'));
  assert.ok(!html.includes('id="mmCraftNote"')); assert.doesNotMatch(pj, /'mmCraftNote'/); // 20.7: управление отправкой удалено; ниже проверяется совместимость старых профилей.
  assert.match(pj, /mmCraftNote: true/); assert.match(c, /mmCraftNote: true/);
  console.log('PASS: 10.0.2 crafter letter — after a batch the crafter gets a letter (what was sent, what to craft and how many, what to return to whom), split at 1000 chars, no double letter, partial batch carried over, menu toggle');
})().catch(e => { console.error(e); process.exit(1); });
