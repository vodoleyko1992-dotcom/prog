/* L2wap 9.0: Маммон — заказы торговца и цель «копить на улучшение у кузнеца».
   Все действия в игре — нажатиями на страницах игры (как у игрока); свои запросы — только GET (env.gameGet, с токеном страницы).
   Coin of Luck бот не тратит никогда: само улучшение у кузнеца жмёт игрок. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.mammon = function create_mammon(env) {
// 9.0 (разбор кузнеца 11.10, kb/mammon.md): торговец и кузнец Маммона кочуют по катакомбам/некрополям (смена раз в 4 ч), телепорт —
// страница /mammon-<npc>-loc.html (500 000 адены, с VIP бесплатно). Заказ торговца (GET /game/mammon/merchant/request): ресурс × N,
// награда 1 Coin of Luck + 1 500 000 адены, достаётся первому, кто сдаст (кнопка «Здати» на /mammon-merchant.html, только рядом с NPC).
// Список улучшений кузнеца (GET /game/mammon/blacksmith/upgrades) сервер отдаёт только рядом с ним, иначе 403 mammon_blacksmith_not_nearby
const NEAR = 12000 * 0.9;                       // радиус NPC с карты (mapRadii.npcInteractionRadius 12000), с запасом
const POLL = 90000, NPC_POLL = 30 * 60000, JOB_MAX = 4 * 60000, SMITH_EVERY = 6 * 3600000;
const PAGE = { order: '/mammon-merchant.html', smith: '/mammon-blacksmith.html' };
const LOC = { order: '/mammon-merchant-loc.html', smith: '/mammon-blacksmith-loc.html' };
const STATE = { order: ['/game/mammon/merchant', 'mammonMerchant'], smith: ['/game/mammon/blacksmith', 'mammonBlacksmith'] };
// 9.0: цена Lv.0 → Lv.1 Пояса першопрохідця D — со скриншота игрока 11.10 (у кузнеца). Остальные цены бот узнаёт у кузнеца сам
const MM_KNOWN = { '920018:0': { a: 250000, c: 1, m: [[1458, 'Crystal: D-Grade', 100], [1869, 'Iron Ore', 100], [1876, 'Mithril Ore', 100], [1880, 'Steel', 3]], src: 'скриншот 11.10' } };
// 9.0 (GET /game/craft/materials 11.10): материалы крафтятся только у Artisan/Warsmith/Maestro (у Warlock и спойлера крафта нет) —
// для таких материалов бот подсказывает рецепт, а добыть их можно только дропом/спойлом или у игроков
const MM_CRAFT = { 1878: 'Braided Hemp = 5 Stem', 1879: 'Cokes = 3 Charcoal + 3 Coal', 1880: 'Steel = 5 Iron Ore + 5 Varnish', 1881: 'Coarse Bone Powder = 10 Animal Bone',
  1882: 'Leather = 6 Animal Skin', 1884: 'Cord ×20 = 2 Steel + 25 Thread', 1885: 'High Grade Suede = 1 Coarse Bone Powder + 3 Suede', 1887: 'Varnish of Purity = 1 Stone of Purity + 3 Coarse Bone Powder + 3 Varnish',
  1888: 'Synthetic Cokes = 1 Oriharukon Ore + 3 Cokes', 1889: 'Compound Braid = 5 Braided Hemp + 5 Thread', 1890: 'Mithril Alloy = 1 Mithril Ore + 1 Varnish of Purity + 2 Steel',
  1893: 'Oriharukon = 1 Synthetic Cokes + 4 Oriharukon Ore + 12 Silver Nugget', 5549: 'Metallic Thread = 5 Iron Ore + 10 Thread' };
let GEAR = null, gearLoading = null, pollT = 0, npcT = 0, goalT = 0, busy = null;
async function gearDb() {                        // справочник улучшаемых вещей (mammon-gear.json: имя, грейд, слот, бонусы Lv.0–5)
  if (GEAR) return GEAR;
  if (!gearLoading) gearLoading = (async () => { try { const r = await fetch(chrome.runtime.getURL('mammon-gear.json')); GEAR = r.ok ? await r.json() : {}; } catch (e) { GEAR = {}; } return GEAR; })();
  return gearLoading;
}
const fmtA = n => Math.round(+n || 0).toLocaleString('ru');
const hhmm = t => { const d = new Date(+t || 0); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
async function getJson(path) {
  const r = await env.gameGet(path);
  let j = null; try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, j };
}
// ---- заказ торговца ----
function orderNote(req) {
  if (!req || !req.requestId) return null;
  const o = { id: String(req.requestId), st: String(req.status || ''), rid: +req.resourceItemId || 0, res: String(req.resourceNameEn || ''), qty: +req.quantity || 0,
    have: +req.playerHaveQty || 0, adena: +req.reward?.adena || 0, col: +req.reward?.coinOfLuck || 0, exp: Date.parse(req.expiresAt) || 0,
    win: String(req.winnerName || req.winner?.name || ''), t: Date.now() };
  const p = env.rt.mmOrder;
  if (!p || p.id !== o.id || p.st !== o.st || p.have !== o.have || p.win !== o.win) {
    env.setRt({ mmOrder: o });
    if (o.st === 'OPEN' && (!p || p.id !== o.id)) env.rec('B', 'Маммон', `новый заказ: ${o.res} ×${o.qty} (в сумке ${o.have}) → ${o.col} Coin of Luck + ${fmtA(o.adena)} адены, до ${hhmm(o.exp)}`);
  }
  return o;
}
async function orderPoll() {
  const { ok, status, j } = await getJson('/game/mammon/merchant/request');
  if (!ok) { if (status !== 401) env.rec('B', 'Маммон', `заказ торговца не получен: HTTP ${status}`); return null; }
  return orderNote(j?.request);
}
async function npcPoll() {
  const out = { ...(env.rt.mmNpc || {}) };
  for (const k of ['order', 'smith']) {
    const { ok, j } = await getJson(STATE[k][0]);
    const s = ok && j?.[STATE[k][1]];
    if (s?.current) out[k] = { loc: s.current.labelEn || s.current.id, id: s.current.id, x: +s.current.worldX, y: +s.current.worldY,
      next: s.next?.labelEn || s.next?.id || '', at: +s.rotatesAtMs || 0, price: j.teleport?.vipFreeApplied ? 0 : +(j.teleport?.adenaCost ?? 500000) };
  }
  out.t = Date.now();
  await env.setRt({ mmNpc: out });
  return out;
}
// 9.0: фоновый опрос (только GET): заказ раз в 90 с, где стоят NPC — раз в 30 мин и после смены места
async function mmTick() {
  if (busy) return busy;
  const now = Date.now(), np = env.rt.mmNpc;
  const wantNpc = now - npcT > NPC_POLL || (np?.order?.at && now > np.order.at + 5000 && now - npcT > 60000) || env.rt.mmPollReq;
  const wantOrder = (env.cfg.mmOrders !== false || env.rt.mmPollReq) && now - pollT > POLL;
  if (!wantNpc && !wantOrder) return null;
  busy = (async () => {
    try {
      if (wantOrder) { pollT = Date.now(); await orderPoll(); }
      if (wantNpc) { npcT = Date.now(); await npcPoll(); }
      if (env.rt.mmPollReq) await env.setRt({ mmPollReq: null });
    } catch (e) {} finally { busy = null; }
  })();
  return busy;
}
// ---- снаряжение и цены улучшения ----
// из ответов игры /character (character.inventory.eq: belt/cloak/tattoo/… — число или {itemId, specialGearLevel})
function eqNote(eq) {
  if (!eq || typeof eq !== 'object') return;
  const out = {};
  for (const [slot, v] of Object.entries(eq)) {
    const id = +(v && typeof v === 'object' ? v.itemId : v) || 0;
    if (id < 910618) continue;                     // улучшаемые вещи — 9106xx/9200xx (mammon-gear.json); прочее не нужно
    const lvl = v && typeof v === 'object' ? +(v.specialGearLevel ?? v.level ?? 0) || 0 : 0;
    out[slot] = [id, lvl];
  }
  const old = env.rt.mmEq || {};
  if (JSON.stringify(old) !== JSON.stringify(out)) env.setRt({ mmEq: out });
}
function smithNote(items) {                      // ответ /upgrades: уровни вещей и цена следующего уровня
  if (!Array.isArray(items)) return 0;
  const cost = { ...(env.rt.mmCost || {}) }, gear = [];
  for (const i of items) {
    const id = +i.itemId; if (!id) continue;
    gear.push({ id, n: String(i.nameUk || ''), g: String(i.grade || ''), lvl: +i.level || 0, max: !!i.max, eq: /одягн|одет|надет|equip/i.test(String(i.locationLabelUk || '')) });
    if (!i.max && i.cost) cost[`${id}:${+i.level || 0}`] = { a: +i.cost.adena || 0, c: +i.cost.coinOfLuck || 0,
      m: (i.cost.materials || []).map(x => [+x.itemId, String(x.nameUk || ''), +x.required || 0]), t: Date.now() };
  }
  env.setRt({ mmCost: cost, mmGear: gear, mmGearT: Date.now() });
  return gear.length;
}
const costOf = (id, lvl) => env.rt.mmCost?.[`${id}:${lvl}`] || MM_KNOWN[`${id}:${lvl}`] || null;
function gearLvl(id) {                            // уровень вещи: из списка кузнеца (точный) или из экипировки
  const g = (env.rt.mmGear || []).find(x => x.id === id);
  if (g) return g.lvl;
  const e = Object.values(env.rt.mmEq || {}).find(x => x[0] === id);
  return e ? e[1] : 0;
}
const owned = id => (env.rt.mmGear || []).some(x => x.id === id) || Object.values(env.rt.mmEq || {}).some(x => x[0] === id);
const nameEn = id => env.ITEMS?.[id]?.n || '';
const haveOf = (id, snap) => { const q = env.invQty(id); return q != null ? q : snap ?? null; };
// 9.0 (игрок 11.10: «копить на определённую задачу и последовательно идти её делать»): что нужно до цели, по порядку
function goalPlan() {
  const id = +env.cfg.mmGoalItem || 0; if (!id) return null;
  const to = Math.min(5, Math.max(1, +env.cfg.mmGoalLvl || 5)), lvl = gearLvl(id), name = GEAR?.[id]?.n || (env.rt.mmGear || []).find(x => x.id === id)?.n || `#${id}`;
  if (lvl >= to) return { id, name, lvl, to, done: true };
  const c = costOf(id, lvl);
  if (!c) return { id, name, lvl, to, noCost: true, owned: owned(id) };
  const mats = c.m.map(([mid, nm, need]) => { const have = haveOf(mid); const en = nameEn(mid) || nm;
    return { id: mid, nm: en, uk: nm, need, have, miss: have == null ? need : Math.max(0, need - have), craft: MM_CRAFT[mid] || '' }; });
  return { id, name, lvl, to, a: c.a, col: c.c, mats, ready: mats.every(m => m.have != null && m.miss === 0) };
}
// цель фарма для content.farmGoal: первый недостающий материал, который есть в базе фарма форума (дроп/спойл)
function mmFarmGoal() {
  if (env.cfg.mmGoalFarm === false) return null;
  const p = goalPlan(); if (!p?.mats) return null;
  for (const m of p.mats) {
    if (!(m.miss > 0)) continue;
    const k = m.nm.toLowerCase();
    if (env.FARM?.res?.[k]) return { key: k, name: env.FARM.res[k].name || m.nm, left: m.miss, why: `Маммон: ${p.name} Lv.${p.lvl + 1}` };
  }
  return null;
}
function goalNote() {                             // раз на изменение: что дальше по цели (журнал + rt.mmGoalSt для меню)
  const p = goalPlan();
  let st = '';
  if (!p) st = '';
  else if (p.done) st = `✅ ${p.name}: уже Lv.${p.lvl} (цель Lv.${p.to})`;
  else if (p.noCost) st = p.owned ? `${p.name} Lv.${p.lvl} → Lv.${p.lvl + 1}: цены неизвестны — узнаю у кузнеца` : `${p.name}: у героя этой вещи не вижу — кузнец покажет цены, только когда она будет в сумке или надета`;
  else if (p.ready) st = `✅ всё собрано на ${p.name} Lv.${p.lvl + 1}: ${fmtA(p.a)} адены + ${p.col} Coin of Luck — улучшение жмёшь сам у кузнеца`;
  else {
    const f = mmFarmGoal(), miss = p.mats.filter(m => m.miss > 0);
    st = `${p.name} Lv.${p.lvl + 1}: не хватает ${miss.map(m => `${m.nm} ${m.miss}`).join(', ')}` + (f ? ` · добываю ${f.name}` : miss.some(m => m.craft) ? ' · крафт только у гнома-ремесленника' : ' · в базе фарма источников нет');
  }
  if (st !== (env.rt.mmGoalSt || '')) { env.setRt({ mmGoalSt: st }); if (st) env.rec('B', 'Маммон', st); }
  return p;
}
// ---- поход к NPC ----
function modeFree() {                             // можно ли отлучиться: не в бою, не в походе, не в туре РБ/эпиков/РБ-сессии, не перед TvT
  const r = env.rt;
  if (env.isBattle() || r.shop || r.rbGo || r.zoneGo || r.revive || r.tbuff || r.magister || r.invScan || r.fishSvc) return false;
  if (r.rbSess?.on || (r.epic?.step && r.epic.step !== 'pick')) return false;
  if (['epic', 'raid'].includes(env.autonomyMode())) return false;
  if (env.cfg.tvtOn && env.tvtSoon?.()) return false;
  if (env.isFishing() && env.fishState()) return false;          // рыба на крючке — сначала вываживаем
  return true;
}
function want() {
  const o = env.rt.mmOrder, now = Date.now(), tried = env.rt.mmTried || {};
  if (env.cfg.mmOrders !== false && o?.st === 'OPEN' && o.qty > 0 && o.have >= o.qty && !tried[o.id] && o.exp - now > 60000)
    return { kind: 'order', id: o.id, why: `заказ ${o.res} ×${o.qty}` };
  if (env.rt.mmSmithReq) return { kind: 'smith', why: 'узнать цены у кузнеца (по кнопке)' };
  const p = env.cfg.mmGoalItem ? goalPlan() : null;
  if (p?.noCost && p.owned && env.cfg.mmSmithAuto !== false && now - (env.rt.mmSmithT || 0) > SMITH_EVERY) return { kind: 'smith', why: `цены ${p.name} Lv.${p.lvl} → ${p.lvl + 1}` };
  return null;
}
async function heroXY() { const { ok, j } = await getJson('/character'); const c = ok && (j?.character || j); return c && Number.isFinite(+c.worldX) ? { x: +c.worldX, y: +c.worldY } : null; }
async function isNear(kind) {
  if (kind === 'smith') { const r = await getJson('/game/mammon/blacksmith/upgrades'); if (r.ok) smithNote(r.j?.items); return r.ok; }
  const [me, n] = [await heroXY(), (await npcPoll())[kind]];
  return !!(me && n && Number.isFinite(n.x) && Math.hypot(me.x - n.x, me.y - n.y) <= NEAR);
}
async function finish(J, ok, why) {
  const log = [{ kind: J.kind, id: J.id || '', ok: !!ok, why: String(why || '').slice(0, 120), t: Date.now() }, ...(env.rt.mmLog || [])].slice(0, 20);
  env.rec('B', 'Маммон', `${J.kind === 'order' ? 'заказ' : 'кузнец'}: ${ok ? '✓' : '✗'} ${why}${J.home ? ' · возвращаюсь на точку' : ''}`);
  const back = J.home && !env.fishNow() ? { zoneGo: { id: J.home, t: Date.now(), why: 'Маммон: обратно на точку' }, zoneGoT: 0 } : {};
  await env.setRt({ mmJob: null, mmLog: log, ...(J.kind === 'smith' ? { mmSmithReq: null, mmSmithT: Date.now() } : {}), ...back });
  if (!back.zoneGo) { location.href = env.fishNow() ? '/fishing.html' : '/map.html'; await env.sleep(3000); }
}
async function teleport(J) {                      // страница телепорта к NPC: цена → кнопка → карта
  if (location.pathname !== LOC[J.kind]) { env.setStatus(`Маммон: телепорт к ${J.kind === 'order' ? 'торговцу' : 'кузнецу'}`); location.href = LOC[J.kind]; await env.sleep(4000); return; }
  const btn = await env.waitX(() => { const b = env.$q('#mammon-loc-teleport-btn'); const c = env.$q('#mammon-loc-cost')?.textContent || ''; return b && !b.disabled && /\d|безкошт|бесплат|free/i.test(c) ? b : null; }, 10000, 200);
  const cost = env.$q('#mammon-loc-cost')?.textContent || '';
  if (!btn) return finish(J, false, 'страница телепорта не загрузилась');
  if (/coin|luck|удач/i.test(cost)) return finish(J, false, `телепорт не за адену (${cost.trim().slice(0, 60)}) — Coin of Luck бот не тратит`);
  const price = /безкошт|бесплат|free/i.test(cost) ? 0 : +(cost.replace(/\D/g, '') || 0);
  const max = env.cfg.mmTpMax ?? 500000;
  if (price > max) return finish(J, false, `телепорт ${fmtA(price)} адены дороже лимита ${fmtA(max)}`);
  await env.setRt({ mmJob: { ...J, step: 'act', tpT: Date.now() } });
  env.rec('B', 'Маммон', `телепорт к ${J.kind === 'order' ? 'торговцу' : 'кузнецу'}: ${price ? fmtA(price) + ' адены' : 'бесплатно'} · ${J.why}`);
  env.fire(btn);
  await env.waitX(() => location.pathname !== LOC[J.kind] || null, 8000, 200);
  if (location.pathname === LOC[J.kind]) {
    const err = (env.$q('#mammon-loc-err')?.textContent || '').trim();
    if (err) return finish({ ...J, home: null }, false, `не улетели: ${err.slice(0, 80)}`);
  }
}
async function claim(J) {
  if (location.pathname !== PAGE.order) { env.setStatus('Маммон: сдаю заказ'); location.href = PAGE.order; await env.sleep(4000); return; }
  const btn = await env.waitX(() => env.$q('.l2-mammon-order-submit'), 10000, 200);
  if (!btn) { const o = await orderPoll(); return finish(J, false, o?.st === 'CLAIMED' ? `заказ уже забрал ${o.win || 'другой игрок'}` : 'кнопки «Здати» нет'); }
  if (btn.dataset.requestId && btn.dataset.requestId !== J.id) return finish(J, false, 'заказ сменился, пока летели');
  if (btn.disabled) return finish(J, false, (btn.textContent || 'кнопка недоступна').trim().slice(0, 60));
  env.fire(btn);
  await env.waitX(() => (env.$q('#mammon-merchant-shop-msg')?.textContent || '').trim() || null, 6000, 200);
  const msg = (env.$q('#mammon-merchant-shop-msg')?.textContent || '').trim();
  await env.sleep(500);
  const o = await orderPoll(), me = env.heroNick?.() || env.rt.char || '';
  const won = o?.id === J.id && o.st === 'CLAIMED' && (!me || o.win === me);
  return finish(J, won, won ? `сдал ${o.res} ×${o.qty} → +${o.col} Coin of Luck, +${fmtA(o.adena)} адены` : o?.st === 'CLAIMED' && o.win ? `опередил ${o.win}` : msg.slice(0, 80) || 'ответа нет');
}
async function smith(J) {
  const r = await getJson('/game/mammon/blacksmith/upgrades');
  if (!r.ok) return finish(J, false, r.status === 403 ? 'кузнец не рядом' : `список улучшений не получен (HTTP ${r.status})`);
  const n = smithNote(r.j?.items);
  return finish(J, true, `цены прочитаны: вещей ${n}${(r.j?.items || []).filter(i => !i.max && i.cost).map(i => ` · ${i.nameUk} Lv.${i.level}→${i.level + 1}: ${fmtA(i.cost.adena)} адены, ${i.cost.coinOfLuck} CoL, ${(i.cost.materials || []).map(m => `${m.nameUk} ${m.required}`).join(', ')}`).join('')}`);
}
// 9.0: шаг в главном цикле. true — занят Маммоном (цикл идёт на следующий круг)
async function mmStep() {
  const J = env.rt.mmJob;
  if (J) {
    if (env.isBattle()) return false;
    if (Date.now() - (J.t || 0) > JOB_MAX) { await finish(J, false, 'не уложился в 4 мин'); return true; }
    if (J.step === 'go') {
      if (await isNear(J.kind)) await env.setRt({ mmJob: { ...J, step: 'act' } });
      else await teleport(J);
      return true;
    }
    if (J.kind === 'order') await claim(J); else await smith(J);
    return true;
  }
  if (env.cfg.mmGoalItem && Date.now() - goalT > 30000) { goalT = Date.now(); await gearDb(); env.itemsDb?.().catch?.(() => {}); goalNote(); }
  const w = want();
  if (!w || !modeFree()) return false;
  // точка возврата: зона охоты (рыбалка, катакомбы и туры возвращаются сами)
  const home = !env.fishNow() && env.autonomyMode() !== 'cat' ? env.rt.zone || null : null;
  await env.setRt({ mmJob: { ...w, step: 'go', home, t: Date.now() }, ...(w.id ? { mmTried: { ...Object.fromEntries(Object.entries(env.rt.mmTried || {}).filter(([, t]) => Date.now() - t < 86400000)), [w.id]: Date.now() } } : {}) });
  env.rec('B', 'Маммон', `иду к ${w.kind === 'order' ? 'торговцу' : 'кузнецу'}: ${w.why}`);
  return true;
}
return { MM_KNOWN, MM_CRAFT, gearDb, orderNote, orderPoll, npcPoll, mmTick, eqNote, smithNote, costOf, gearLvl, goalPlan, mmFarmGoal, goalNote, modeFree, want, isNear, finish, teleport, claim, smith, mmStep };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
