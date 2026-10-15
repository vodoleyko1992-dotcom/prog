/* L2wap 10.0: магазин TvT (Shil Coins) — счётчик монет, цель «копить на вещь», покупка по галочке.
   Игрок 12.10: «Да, добавь все. Монеток шоу». Зависимости только через env, действия — под замком вкладки в content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.tvtshop = function create_tvtshop(env) {
const location = env.routeLocation || root.location;
// Shil Coins — предмет 920030 в сумке (/character inventory.stacks), 2 за победу в TvT (kb/raw/tvt-result-latest.json)
const SHIL_ID = 920030, SHOP_URL = '/tvt-shop.html';
// Каталог /game/tvt/shop/catalog (снят 12.10, все вещи S-grade с 70 ур.; расходники не цель). Живой каталог (shopNote) важнее встроенного
const TS_KNOWN = [
  { id: 920035, n: 'Bauen Blade', cat: 'weapon', price: 200, lvl: 70, w: 'bigsword', mode: 'phys', pa: 445, ma: 165 },
  { id: 920036, n: 'Icarus Fists', cat: 'weapon', price: 200, lvl: 70, w: 'fist', mode: 'phys', pa: 420, ma: 155 },
  { id: 920037, n: 'Icarus Spitter', cat: 'weapon', price: 200, lvl: 70, w: 'bow', mode: 'phys', pa: 660, ma: 155 },
  { id: 920038, n: 'Icarus Trident', cat: 'weapon', price: 200, lvl: 70, w: 'pole', mode: 'phys', pa: 345, ma: 155 },
  { id: 920039, n: 'Plenitas', cat: 'weapon', price: 200, lvl: 70, w: 'sword', mode: 'phys', pa: 335, ma: 150 },
  { id: 920040, n: 'Dual Blades of Glory', cat: 'weapon', price: 200, lvl: 70, w: 'dual', mode: 'phys', pa: 450, ma: 155 },
  { id: 920041, n: 'Stampede', cat: 'weapon', price: 200, lvl: 70, w: 'dagger', mode: 'phys', pa: 320, ma: 160 },
  { id: 920042, n: 'Vesper Retributer', cat: 'weapon', price: 200, lvl: 70, w: 'bigblunt', mode: 'phys', pa: 445, ma: 165 },
  { id: 920043, n: 'Vesper Singer', cat: 'weapon', price: 200, lvl: 70, w: 'bigblunt', mode: 'magic', pa: 300, ma: 255 },
  { id: 920031, n: 'Эмблема Величия', cat: 'accessory', price: 240, lvl: 70, st: '+400 CP, +180 P/M.Def, +1 % урона умений' },
  { id: 920032, n: 'Пояс Судьбы', cat: 'belt', price: 180, lvl: 70, st: '+700 HP, +10 % урона физ./маг. крита, бег +6' },
  { id: 920033, n: 'Тату Души', cat: 'tattoo', price: 260, lvl: 70, st: '+850 P.Atk, +978 M.Atk, скорость атаки/каста +2 %' },
  { id: 920034, n: 'Плащ Героя', cat: 'cloak', price: 230, lvl: 70, st: '+700 HP, +180 P/M.Def, уклонение +1' },
];
const CAT_RU = { weapon: 'оружие', accessory: 'украшение', belt: 'пояс', tattoo: 'тату', cloak: 'плащ', consumable: 'расходник' };
// каталог: живой из ответов игры (rt.tsCat, не старше 7 дней) поверх встроенного
function catalog() {
  const live = env.rt.tsCat?.items, fresh = live && Date.now() - (env.rt.tsCat.t || 0) < 7 * 86400000;
  const m = new Map(TS_KNOWN.map(x => [x.id, x]));
  if (fresh) for (const x of live) m.set(x.id, { ...(m.get(x.id) || {}), ...x });
  return [...m.values()];
}
const itemOf = id => catalog().find(x => x.id === +id) || null;
// ответ /game/tvt/shop/catalog (страница магазина или свой GET) → rt.tsCat
function shopNote(res) {
  if (!Array.isArray(res?.categories)) return false;
  const items = [];
  for (const c of res.categories) for (const it of c.items || []) {
    if (!it?.itemId || c.key === 'consumable') continue;
    items.push({ id: +it.itemId, n: it.nameRu || it.nameUk || it.nameEn || '#' + it.itemId, cat: c.key, price: +it.priceShil || 0, lvl: +it.requiredLevel || 0,
      w: it.weaponType || undefined, mode: it.weaponMode || undefined, pa: it.pAtk, ma: it.mAtk, st: it.equipStats ? statsText(it.equipStats) : undefined });
  }
  if (!items.length) return false;
  const sig = items.map(x => `${x.id}:${x.price}:${x.lvl}`).join(',');
  if (env.rt.tsCat?.sig === sig && JSON.stringify(env.rt.tsCat.items) === JSON.stringify(items) && Date.now() - (env.rt.tsCat.t || 0) < 86400000) return true;
  env.setRt({ tsCat: { items, sig, t: Date.now() } });
  env.rec('B', 'TvT-магазин', `каталог прочитан: ${items.length} вещей`);
  return true;
}
const ST_RU = { equipFlatMaxHp: 'HP', equipFlatMaxCp: 'CP', equipFlatPAtk: 'P.Atk', equipFlatMAtk: 'M.Atk', equipFlatPDef: 'P.Def', equipFlatMDef: 'M.Def',
  equipPhysicalCritDamagePct: '% урона физ. крита', equipMagicCritDamagePct: '% урона маг. крита', equipAttackSpeedPct: '% скорости атаки', equipCastSpeedPct: '% скорости каста',
  equipOutgoingPhysicalSkillDamagePct: '% урона физ. умений', equipOutgoingMagicalSkillDamagePct: '% урона маг. умений', cloakMaxHp: 'HP', cloakPDefFlat: 'P.Def', cloakMDefFlat: 'M.Def', equipEvasionFlat: 'уклонение', equipFinalRunSpeedFlat: 'бег' };
function statsText(s) { return Object.entries(s || {}).map(([k, v]) => `+${v}${/Pct$/.test(k) ? ' ' : ' '}${ST_RU[k] || k}`).join(', '); }
// монеты: по сумке из ответов игры (hook inv → content.invQty); null — сумка ещё не читалась
function shil() { const q = env.invQty?.(SHIL_ID); return q == null ? (env.rt.tsShil?.n ?? null) : q; }
function shilNote() {                                  // вызывается ядром при каждом снимке сумки → rt.tsShil
  const q = env.invQty?.(SHIL_ID); if (q == null) return;
  const was = env.rt.tsShil?.n;
  if (was === q) return;
  env.setRt({ tsShil: { n: q, t: Date.now() } });
  if (was != null && q > was) env.rec('B', 'TvT-магазин', `Shil Coins: ${was} → ${q} (+${q - was})`);
  readyNote();
}
// цель: что копим, сколько не хватает, сколько побед (2 Shil за победу)
function plan() {
  const id = +env.cfg.tsGoalItem || 0, it = id && itemOf(id); if (!it) return null;
  const have = shil(), need = it.price || 0, lack = have == null ? null : Math.max(0, need - have), lvl = +env.heroLevel?.() || +env.rt.lvl || 0;
  return { it, have, need, lack, wins: lack == null ? null : Math.ceil(lack / 2), lvlOk: !it.lvl || lvl >= it.lvl, lvl };
}
function line() {
  const p = plan(); if (!p) return 'Цели нет';
  const h = p.have == null ? 'монеты ещё не считал (нужен снимок сумки)' : `есть ${p.have} Shil`;
  if (p.lack === 0) return `✔ Готово: ${p.it.n} · ${p.need} Shil · ${h} — хватает${p.lvlOk ? ', можно покупать в «TvT Магазин»' : `, но нужен ${p.it.lvl} ур. (сейчас ${p.lvl})`}`;
  return `${p.it.n} · ${p.need} Shil · ${h}${p.lack != null ? `, не хватает ${p.lack} (≈${p.wins} побед в TvT)` : ''}${p.lvlOk ? '' : ` · нужен ${p.it.lvl} ур.`}`;
}
// 10.0 (игрок 12.10: «не ставь автопокупку, пусть появляется отметка ОК»): монет на цель хватило → rt.tsReady {id,t} + одна запись в журнал
function readyNote() {
  const p = plan(); if (!p || p.have == null) { if (env.rt.tsReady) env.setRt({ tsReady: null }); return false; }
  if (p.lack !== 0) { if (env.rt.tsReady) env.setRt({ tsReady: null }); return false; }
  if (env.rt.tsReady?.id === p.it.id) return true;
  env.setRt({ tsReady: { id: p.it.id, t: Date.now() } });
  env.rec('B', 'TvT-магазин', `✔ Готово: на ${p.it.n} хватает Shil (${p.have}/${p.need})${p.lvlOk ? '' : `, но нужен ${p.it.lvl} ур.`}${env.cfg.tsBuy ? '' : ' — покупай сам в «TvT Магазин»'}`);
  return true;
}
// покупка: галочка, монет хватает, уровень есть, не куплено, не чаще раза в час (ошибка игры — через час снова)
function want() {
  if (!env.cfg.tsBuy || env.payments?.pending()) return null;
  const p = plan(); if (!p || p.have == null || p.lack !== 0 || !p.lvlOk) return null;
  if ((env.rt.tsLog || []).some(x => x.id === p.it.id && x.ok)) return null;
  if (Date.now() - (env.rt.tsTryT || 0) < 3600000) return null;
  return { kind: 'buy', it: p.it, why: `${p.it.n} за ${p.need} Shil (есть ${p.have})` };
}
const token = () => ({ char: env.rt.char, kick: +env.rt.manualKickAt || 0 });
const active = T => env.on !== false && env.tabOwner !== false && T.char === env.rt.char && T.kick === (+env.rt.manualKickAt || 0) && !env.tvtHold?.();
const sameJob = J => !!J && env.rt.tsJob?.t === J.t && +env.rt.tsJob?.it?.id === +J.it.id;
const isShop = () => location.pathname === SHOP_URL;
const purchaseAllowed = J => !!env.cfg.tsBuy && +env.cfg.tsGoalItem === +J.it.id;
async function cancelPurchase(J) {
  if (!sameJob(J)) return;
  env.rec('B', 'TvT-магазин', `${J.it.n}: покупка отменена — настройка или цель изменена`);
  await env.setRt({ tsJob: null, tsTryT: 0 });
}
let armedPayment = null;
const pending = () => { const p = env.payments?.pending(); return p?.kind === 'tvt-shop' ? p : null; };
const own = ch => ch && String(ch.name || '').toLowerCase() === String(env.rt.char || '').toLowerCase() && Number.isSafeInteger(ch.revision);
const amount = (ch, id) => {
  if (!Array.isArray(ch?.inventory?.stacks)) return null;
  const qty = x => +x?.itemId === +id ? (x.qty == null ? 1 : Math.max(0, +x.qty || 0)) : 0;
  return ch.inventory.stacks.reduce((n,x) => n + qty(x), 0) + Object.values(ch.inventory.eq || {}).reduce((n,x) => n + (typeof x === 'number' ? +(x === +id) : qty(x)), 0);
};
async function json(path) { try { const r = await env.gameGet(path); return r?.ok ? await r.json() : null; } catch (_) { return null; } }
// Квитанция именно нашей команды. Текст страницы не доказывает покупку: catch игры показывает тот же текст при потере ответа.
function onNet(path, d) {
  const p = pending(), ch = d.res?.character;
  if (!p || p.char !== (env.rt.char || '') || d.paymentId !== p.id || armedPayment !== p.id || path !== '/game/tvt/shop/purchase' || d.method !== 'POST' || +d.req?.itemId !== p.itemId || !Number.isSafeInteger(d.req?.expectedRevision)) return;
  if (d.status >= 200 && d.status < 300 && !d.res?.error && own(ch) && String(ch.id || '') === p.heroId && ch.revision > d.req.expectedRevision)
    env.setRt({ tsReceipt: { id: p.id, revision: ch.revision, outcome: 'purchased', t: Date.now() } });
  else if (d.status >= 400 && d.status < 500 && d.status !== 408 && (!ch || own(ch) && String(ch.id || '') === p.heroId) && env.rt.tsReceipt?.id !== p.id)
    env.setRt({ tsReceipt: { id: p.id, outcome: 'rejected', why: String(d.res?.error || 'HTTP ' + d.status).slice(0,100), t: Date.now() } });
}
let reconciling = false, reconcileReadId = '', reconcileReadAt = 0;
async function paymentReconcile() {
  const p = pending(); if (!p || reconciling || p.char !== (env.rt.char || '') || env.tabOwner === false) return false;
  reconciling = true;
  const lease = env.leaseEpoch;
  const same = () => pending()?.id === p.id && p.char === (env.rt.char || '') && env.tabOwner !== false && env.leaseEpoch === lease;
  try {
    let receipt = env.rt.tsReceipt?.id === p.id ? env.rt.tsReceipt : null;
    if (!receipt) {
      if (reconcileReadId === p.id && Date.now() - reconcileReadAt < 5000) return false;
      reconcileReadId = p.id; reconcileReadAt = Date.now();
      const j = await json('/character'), ch = j?.character || j;
      if (!same() || !own(ch) || String(ch.id || '') !== p.heroId || ch.revision <= p.revision) return false;
      // Сумка + надетое: экипировка купленной вещи между ответами не разрешает вторую покупку.
      if (amount(ch, p.itemId) > p.before) receipt = { outcome: 'satisfied', revision: ch.revision };
    }
    if (!receipt || !same()) return false;
    const ok = receipt.outcome !== 'rejected', J = env.rt.tsJob;
    const log = [{ t: Date.now(), payment: p.id, id: p.itemId, n: p.name, price: p.quote.amount, ok, why: ok ? 'покупка подтверждена' : receipt.why }, ...(env.rt.tsLog || []).filter(x => x.payment !== p.id)].slice(0,20);
    const saved = await env.setRt({ tsLog: log, ...(ok ? { tsGoalDone: { id: p.itemId, t: Date.now() } } : {}),
      ...(J?.t === p.jobT && +J.it?.id === p.itemId ? { tsJob: null } : {}) });
    if (!same() || saved?.ok !== true || await env.rtCommit() !== true || !same()) return false;
    return await env.payments.confirm(p, { kind: receipt.outcome === 'satisfied' ? 'item-satisfied' : 'server-' + receipt.outcome, revision: receipt.revision, why: receipt.why });
  } finally { reconciling = false; }
}
async function shopStep() {
  if (pending()) { await paymentReconcile(); return true; }
  const T0 = token(); if (!active(T0)) return false;
  const J = env.rt.tsJob;
  if (J) {
    if (!purchaseAllowed(J)) { await cancelPurchase(J); return true; }
    if (env.isBattle()) return false;
    if (Date.now() - (J.t || 0) > 4 * 60000) { await finish(J, false, 'не уложился в 4 мин'); return true; }
    if (!isShop()) { env.setStatus(`TvT-магазин: иду покупать ${J.it.n}`); location.href = SHOP_URL; await env.sleep(4000); return true; }
    await buy(J); return true;
  }
  const w = want(); if (!w || !env.awayFree?.()) return false;
  await env.setRt({ tsJob: { ...w, t: Date.now() }, tsTryT: Date.now() });
  if (active(T0)) env.rec('B', 'TvT-магазин', `иду покупать: ${w.why}`);
  return true;
}
function chainWant() { const w = want(); return w && env.awayFree?.(true) ? w : null; }
function rowOf(it) {
  const rows = [...document.querySelectorAll('.l2-tvt-shop-row')];
  return rows.find(r => (r.querySelector('.l2-tvt-shop-row__name')?.textContent || '').trim() === it.n) || null;
}
async function buy(J) {
  const T0 = token(), allowed = () => active(T0) && sameJob(J);
  if (!allowed()) return;
  if (!purchaseAllowed(J)) return cancelPurchase(J);
  if (pending()) return paymentReconcile();
  const it = J.it, row = await env.waitX(() => rowOf(it), 8000, 250);
  if (!allowed()) return;
  if (!row) return finish(J, false, `в магазине нет строки «${it.n}»`);
  const tab = row.closest('.l2-tvt-shop-cat-panel');
  if (tab && tab.hidden !== false && !env.shown(row)) { const tb = env.$q(`.l2-tvt-shop-cat-tab[data-cat="${tab.id.replace('tvt-shop-panel-', '')}"]`); if (tb) { env.fire(tb); await env.sleep(400); } }
  if (!allowed()) return;
  const bal = +(env.$q('#tvt-shop-shil-balance')?.textContent || '').replace(/\D/g, '');
  if (bal < (it.price || 0)) return finish(J, false, `на странице ${bal} Shil, нужно ${it.price}`);
  const btn = row.querySelector('.l2-tvt-shop-row__buy');
  if (!btn || btn.disabled) return finish(J, false, 'кнопки «Купити» нет');
  await env.pause?.();
  if (!allowed()) return;
  if (!purchaseAllowed(J)) return cancelPurchase(J);
  if (!env.payments || !env.gameGet) return finish(J, false, 'защита оплаты недоступна');
  const cat = await json('/game/tvt/shop/catalog');
  if (!allowed()) return;
  const live = (cat?.categories || []).flatMap(c => c.key === 'consumable' ? [] : c.items || []).find(x => +x.itemId === +it.id);
  const price = Number(live?.priceShil), pagePrice = Number((row.querySelector('.l2-tvt-shop-row__price')?.textContent || '').trim());
  if (!live || !Number.isSafeInteger(price) || price <= 0 || price !== it.price || pagePrice !== price)
    return finish(J, false, 'цена цели или строка магазина изменилась — обнови цель');
  const j = await json('/character'), ch = j?.character || j;
  if (!allowed() || !purchaseAllowed(J)) return;
  if (!own(ch) || !ch.id || amount(ch, SHIL_ID) < price || amount(ch, it.id) == null) return finish(J, false, 'сумка или монеты героя не подтверждены');
  const p = await env.payments.prepare({ kind: 'tvt-shop', key: 'tvt-shop:' + it.id, itemId: it.id, name: it.n, jobT: J.t,
    heroId: String(ch.id), revision: ch.revision, before: amount(ch, it.id), quote: { amount: price, currency: 'Shil' } });
  if (!p) return;
  if (!allowed() || !purchaseAllowed(J) || btn.disabled || !env.shown(btn)) { await env.payments.cancel(p); return; }
  if (!env.payments.sent(p)) { await env.payments.cancel(p); return; }
  armedPayment = p.id;
  const clicked = env.fire(btn); // между permit и платным кликом нет await
  if (clicked === false) { await env.payments.cancel(p, { notSent: true }); return; }
  await env.waitX(() => env.rt.tsReceipt?.id === p.id, 12000, 250);
  const confirmed = await paymentReconcile();
  if (!confirmed) { if (active(T0)) env.setStatus('TvT-магазин: исход покупки неизвестен — проверяю сумку, повтор запрещён'); return; }
  if (active(T0) && isShop() && !env.rt.tsJob) { location.href = env.fishNow?.() ? '/fishing.html' : '/map.html'; await env.sleep(3000); }
}
async function finish(J, ok, why) {
  const T0 = token(); if (!active(T0) || !sameJob(J)) return;
  const log = [{ t: Date.now(), id: J.it.id, n: J.it.n, price: J.it.price, ok, why: String(why).slice(0, 120) }, ...(env.rt.tsLog || [])].slice(0, 20);
  env.rec(ok ? 'B' : 'S', 'TvT-магазин', `${J.it.n}: ${ok ? '✓ куплено' : '✗ ' + why}`);
  await env.setRt({ tsJob: null, tsLog: log, ...(ok ? { tsGoalDone: { id: J.it.id, t: Date.now() } } : {}) });
  if (active(T0) && isShop() && !env.rt.tsJob) { location.href = env.fishNow?.() ? '/fishing.html' : '/map.html'; await env.sleep(3000); }
}
return { SHIL_ID, SHOP_URL, TS_KNOWN, CAT_RU, catalog, itemOf, shopNote, statsText, shil, shilNote, readyNote, plan, line, want, shopStep, chainWant, buy, finish, isShop, onNet, paymentReconcile };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
