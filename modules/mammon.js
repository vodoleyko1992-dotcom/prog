/* L2wap 9.0: Маммон — заказы торговца и цель «копить на улучшение у кузнеца».
   Все действия в игре — нажатиями на страницах игры (как у игрока); свои запросы — только GET (env.gameGet, с токеном страницы).
   Coin of Luck бот не тратит, кроме одного случая: 9.2.5 (игрок 12.10: «полностью разрешаю функцию прокачки ЛВЛ вещей, выбранных
   в настройках у Маммона, не смотря на цену в колах») — улучшение у кузнеца вещи-цели до выбранного уровня (cfg.mmUpgrade). */
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
const COL_ID = 4037, UP_RETRY = 30 * 60000;          // 9.2.5: Coin of Luck; повтор улучшения после неудачи
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
let GEAR = null, gearLoading = null, goalT = 0, busy = null;
// 9.2.2 (лог 12.10 07:22: «заказ торговца не получен: HTTP 429» ×92): метки опроса жили в переменных модуля и обнулялись при каждой
// загрузке страницы — при частых переходах бот спрашивал заказ на каждой странице. Теперь метки — в sessionStorage вкладки
const ssNum = k => { try { return +sessionStorage.getItem(k) || 0; } catch (e) { return 0; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, String(v)); } catch (e) {} };
let pollT = ssNum('l2bot-mmPollT'), npcT = ssNum('l2bot-mmNpcT');
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
      if (wantOrder) { pollT = Date.now(); ssSet('l2bot-mmPollT', pollT); await orderPoll(); }
      if (wantNpc) { npcT = Date.now(); ssSet('l2bot-mmNpcT', npcT); await npcPoll(); }
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
// 9.2 (игрок 11.10: «а если я хочу заранее собрать ВСЕ ресурсы наперёд? … учитывай, что надо собирать ресурсы, из которых крафтятся
// улучшенные ресурсы, их я передаю крафтеру письмом»): рецепты в разборе — [выход за крафт, [[id, имя, кол-во], …]] (GET /game/craft/materials 11.10)
const MM_RECIPES = { 1878: [1, [[1864, 'Stem', 5]]], 1879: [1, [[1871, 'Charcoal', 3], [1870, 'Coal', 3]]], 1880: [1, [[1869, 'Iron Ore', 5], [1865, 'Varnish', 5]]],
  1881: [1, [[1872, 'Animal Bone', 10]]], 1882: [1, [[1867, 'Animal Skin', 6]]], 1884: [20, [[1880, 'Steel', 2], [1868, 'Thread', 25]]],
  1885: [1, [[1881, 'Coarse Bone Powder', 1], [1866, 'Suede', 3]]], 1887: [1, [[1875, 'Stone of Purity', 1], [1881, 'Coarse Bone Powder', 3], [1865, 'Varnish', 3]]],
  1888: [1, [[1874, 'Oriharukon Ore', 1], [1879, 'Cokes', 3]]], 1889: [1, [[1878, 'Braided Hemp', 5], [1868, 'Thread', 5]]],
  1890: [1, [[1876, 'Mithril Ore', 1], [1887, 'Varnish of Purity', 1], [1880, 'Steel', 2]]], 1893: [1, [[1888, 'Synthetic Cokes', 1], [1874, 'Oriharukon Ore', 4], [1873, 'Silver Nugget', 12]]],
  5549: [1, [[1869, 'Iron Ore', 5], [1868, 'Thread', 10]]], 1883: [1, [[1878, 'Braided Hemp', 5], [1870, 'Coal', 5], [1869, 'Iron Ore', 5]]],
  1886: [1, [[1878, 'Braided Hemp', 5], [1879, 'Cokes', 5], [1873, 'Silver Nugget', 10]]], 1891: [1, [[1883, 'Steel Mold', 1], [1887, 'Varnish of Purity', 5], [1877, 'Adamantite Nugget', 10]]],
  1892: [1, [[1886, 'Silver Mold', 1], [1887, 'Varnish of Purity', 5], [1876, 'Mithril Ore', 10]]], 1894: [1, [[1870, 'Coal', 4], [1884, 'Cord', 4], [1882, 'Leather', 4]]],
  1895: [20, [[1873, 'Silver Nugget', 15], [1884, 'Cord', 20]]], 5550: [1, [[5549, 'Metallic Thread', 5], [1876, 'Mithril Ore', 5]]], 5220: [1, [[1864, 'Stem', 10], [1865, 'Varnish', 10], [1869, 'Iron Ore', 10]]] };
const MM_RNAME = { 1878: 'Braided Hemp', 1879: 'Cokes', 1880: 'Steel', 1881: 'Coarse Bone Powder', 1882: 'Leather', 1884: 'Cord', 1885: 'High Grade Suede', 1887: 'Varnish of Purity',
  1888: 'Synthetic Cokes', 1889: 'Compound Braid', 1890: 'Mithril Alloy', 1893: 'Oriharukon', 5549: 'Metallic Thread', 1883: 'Steel Mold', 1886: 'Silver Mold',
  1891: "Artisan's Frame", 1892: "Blacksmith's Frame", 1894: 'Crafted Leather', 1895: 'Metallic Fiber', 5550: 'Durable Metal Plate', 5220: 'Metal Hardener' };
// цена уровня L: известная (кузнец/скриншот) или оценка. Цены растут с уровнем линейно: Кристалл D 100 на Lv.0→1 (пояс), 200 на Lv.1→2 (тату,
// скриншот игрока 11.10) → цена уровня L ≈ цена уровня k × (L+1)/(k+1). Оценка — по ближайшей известной цене этой вещи, иначе той же грейда
function levelCost(id, L) {
  const c = costOf(id, L); if (c) return { ...c, est: 0 };
  const all = { ...MM_KNOWN, ...(env.rt.mmCost || {}) }, g = GEAR?.[id]?.g || (env.rt.mmGear || []).find(x => x.id === id)?.g || '';
  const pick = ks => ks.sort((x, y) => Math.abs(x[1] - L) - Math.abs(y[1] - L))[0];
  const keys = Object.keys(all).map(k => k.split(':').map(Number));
  const best = pick(keys.filter(([i]) => i === id)) || (g && pick(keys.filter(([i]) => (GEAR?.[i]?.g || '') === g)));
  if (!best) return null;
  const b = all[best.join(':')], f = (L + 1) / (best[1] + 1);
  return { a: Math.round(b.a * f), c: b.c, m: b.m.map(([mid, nm, n]) => [mid, nm, Math.ceil(n * f)]), est: best[0] === id ? 1 : 2 };
}
// весь план до цели: таблица по уровням, итог наперёд (минус сумка), разбор крафтового до сырья и список «передать крафтеру»
function goalAll(upTo) {                          // upTo — только до этого уровня (ближайший шаг для фарма)
  const id = +env.cfg.mmGoalItem || 0; if (!id) return null;
  const lvl = gearLvl(id), to = upTo || Math.min(5, Math.max(1, +env.cfg.mmGoalLvl || 5)), name = GEAR?.[id]?.n || (env.rt.mmGear || []).find(x => x.id === id)?.n || `#${id}`;
  if (lvl >= to) return { id, name, lvl, to, done: true, lv: [] };
  const lv = [], tot = new Map(), unk = [];
  let a = 0, col = 0;
  for (let L = lvl; L < to; L++) {
    const c = levelCost(id, L);
    if (!c) { unk.push(L); lv.push({ L, unk: true }); continue; }
    a += c.a; col += c.c;
    lv.push({ L, est: c.est, a: c.a, c: c.c, m: c.m.map(([mid, nm, n]) => [mid, nameEn(mid) || nm, n]) });
    for (const [mid, nm, n] of c.m) { const t = tot.get(mid) || { id: mid, nm: nameEn(mid) || nm, need: 0, lv: L }; t.need += n; tot.set(mid, t); }
  }
  // сумка расходуется один раз на весь план: сначала готовые материалы, затем промежуточные (Сталь в сумке не надо крафтить), затем сырьё
  const stock = {}, unknownHave = new Set();
  const take = (mid, n) => { if (!(mid in stock)) { const h = haveOf(mid); if (h == null) unknownHave.add(mid); stock[mid] = h || 0; } const u = Math.min(stock[mid], n); stock[mid] -= u; return n - u; };
  const raw = new Map(), craft = new Map();
  const addRaw = (mid, nm, n, gross, L) => { const r = raw.get(mid) || { id: mid, nm: nameEn(mid) || nm, need: 0, miss: 0, lv: L }; r.need += gross; r.miss += n; raw.set(mid, r); };
  const expand = (mid, nm, n, L, depth = 0) => {           // n — сколько нужно; возвращает недостачу, разложенную до сырья
    const left = take(mid, n), R = MM_RECIPES[mid];
    if (!R || depth > 6) { addRaw(mid, nm, left, n, L); return; }
    if (!left) return;
    const k = Math.ceil(left / R[0]), cr = craft.get(mid) || { id: mid, nm: MM_RNAME[mid] || nameEn(mid) || nm, qty: 0, runs: 0, rec: R[1].map(x => `${x[2]} ${x[1]}`).join(' + ') + (R[0] > 1 ? ` (выход ${R[0]})` : '') };
    cr.qty += left; cr.runs += k; craft.set(mid, cr);
    for (const [iid, inm, q] of R[1]) expand(iid, inm, q * k, L, depth + 1);
  };
  const tl = [...tot.values()].sort((x, y) => x.lv - y.lv);
  for (const t of tl) { t.have = haveOf(t.id); t.miss = t.have == null ? t.need : Math.max(0, t.need - t.have); }
  for (const t of tl) expand(t.id, t.nm, t.need, t.lv);
  const rl = [...raw.values()].sort((x, y) => x.lv - y.lv).map(r => ({ ...r, have: unknownHave.has(r.id) ? null : haveOf(r.id), farm: !!env.FARM?.res?.[r.nm.toLowerCase()] }));
  return { id, name, lvl, to, a, col, lv, unk, tot: tl, raw: rl, craft: [...craft.values()].reverse(), est: lv.some(x => x.est), ready: !unk.length && tl.every(t => t.have != null && t.miss === 0) };
}
// цель фарма для content.farmGoal. 9.2: по всему плану до цели (наперёд), крафтовое — его сырьём; сначала сырьё ближайшего уровня,
// затем остальное: первое недостающее сырьё, у которого есть источник в базе фарма форума (дроп/спойл)
function mmFarmGoal() {
  if (env.cfg.mmGoalFarm === false) return null;
  const p = goalAll(); if (!p?.raw) return null;
  const n = p.lvl + 1 < p.to ? goalAll(p.lvl + 1) : null, rn = n?.raw?.find(x => x.miss > 0 && x.farm);   // сначала то, что нужно на ближайший уровень
  const r = rn ? p.raw.find(x => x.id === rn.id) : p.raw.find(x => x.miss > 0 && x.farm);
  return r ? { key: r.nm.toLowerCase(), name: env.FARM.res[r.nm.toLowerCase()].name || r.nm, left: r.miss, why: `Маммон: ${p.name} до Lv.${p.to} (наперёд)` } : null;
}
const short = (l, n = 8) => l.slice(0, n).map(m => `${m.nm} ${fmtA(m.miss)}`).join(', ') + (l.length > n ? ` и ещё ${l.length - n}` : '');
function planOut(P) {                             // компактный план для меню (rt.mmGoalPlan): popup модуль не загружает
  if (!P || P.done) return null;
  return { id: P.id, n: P.name, lvl: P.lvl, to: P.to, a: P.a, c: P.col, unk: P.unk,
    lv: P.lv.map(x => x.unk ? { L: x.L, unk: 1 } : { L: x.L, e: x.est, a: x.a, c: x.c, m: x.m.map(m => [m[1], m[2]]) }),
    tot: P.tot.map(t => [t.nm, t.need, t.have, t.miss]), raw: P.raw.map(r => [r.nm, r.need, r.have, r.miss, r.farm ? 1 : 0]),
    cr: P.craft.map(c => [c.nm, c.qty, c.runs, c.rec]) };
}
function goalNote() {                             // раз на изменение: что дальше по цели (журнал + rt.mmGoalSt / rt.mmGoalPlan для меню)
  const p = goalPlan(), P = p && !p.done ? goalAll() : null;
  let st = '';
  if (!p) st = '';
  else if (p.done) st = `✅ ${p.name}: уже Lv.${p.lvl} (цель Lv.${p.to})`;
  else if (p.noCost && !P?.lv.some(x => !x.unk)) st = p.owned ? `${p.name} Lv.${p.lvl} → Lv.${p.lvl + 1}: цены неизвестны — узнаю у кузнеца` : `${p.name}: у героя этой вещи не вижу — кузнец покажет цены, только когда она будет в сумке или надета`;
  else {
    const miss = P.raw.filter(r => r.miss > 0), f = mmFarmGoal();
    const next = p.ready ? `✅ на Lv.${p.lvl + 1} всё собрано: ${fmtA(p.a)} адены + ${p.col} Coin of Luck — ${env.cfg.mmUpgrade !== false ? 'лечу к кузнецу улучшать' : 'улучшение жмёшь сам у кузнеца'}. ` : '';
    st = next + (P.ready ? `✅ наперёд до Lv.${P.to} собрано всё: ${fmtA(P.a)} адены + ${P.col} Coin of Luck`
      : !miss.length ? `${p.name} до Lv.${P.to}: сырьё есть${P.craft.length ? ', осталось скрафтить: ' + P.craft.map(c => `${c.nm} ${fmtA(c.qty)}`).join(', ') : ''}`
      : `${p.name} Lv.${p.lvl} → Lv.${P.to}: наперёд не хватает ${short(miss)}` + (f ? ` · добываю ${f.name}` : ' · в базе фарма источников нет'))
      + (P.est ? ' · ≈ часть цен — оценка' : '') + (P.unk.length ? ` · цены Lv.${P.unk.map(L => L + 1).join(', ')} неизвестны` : '');
  }
  const plan = planOut(P), ps = JSON.stringify(plan);
  const stNew = st !== (env.rt.mmGoalSt || '');
  if (stNew || ps !== JSON.stringify(env.rt.mmGoalPlan || null)) { env.setRt({ mmGoalSt: st, mmGoalPlan: plan }); if (stNew && st) env.rec('B', 'Маммон', st); }
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
  // 9.2.5: всё на следующий уровень собрано (материалы по сумке, Coin of Luck — если сумка его знает) — летим улучшать. После неудачи — не чаще раза в 30 мин
  const colHave = haveOf(COL_ID);
  if (p && !p.done && p.ready && env.cfg.mmUpgrade !== false && (colHave == null || colHave >= (p.col || 0)) && (haveOf(57) == null || haveOf(57) >= (p.a || 0)) && now - (env.rt.mmUpT || 0) > UP_RETRY)
    return { kind: 'smith', up: true, id: `up:${p.id}:${p.lvl}`, why: `улучшить ${p.name} Lv.${p.lvl} → ${p.lvl + 1}` };
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
  env.rec('B', 'Маммон', `${J.kind === 'order' ? 'заказ' : J.up ? 'улучшение' : 'кузнец'}: ${ok ? '✓' : '✗'} ${why}${J.home ? ' · возвращаюсь на точку' : ''}`);
  const back = J.home && !env.fishNow() ? { zoneGo: { id: J.home, t: Date.now(), why: 'Маммон: обратно на точку' }, zoneGoT: 0 } : {};
  await env.setRt({ mmJob: null, mmLog: log, ...(J.kind === 'smith' ? { mmSmithReq: null, mmSmithT: Date.now() } : {}), ...(J.up ? { mmUpT: ok ? 0 : Date.now() } : {}), ...back });
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
  if (J.up) return upgrade(J, r.j?.items);
  const n = smithNote(r.j?.items);
  return finish(J, true, `цены прочитаны: вещей ${n}${(r.j?.items || []).filter(i => !i.max && i.cost).map(i => ` · ${i.nameUk} Lv.${i.level}→${i.level + 1}: ${fmtA(i.cost.adena)} адены, ${i.cost.coinOfLuck} CoL, ${(i.cost.materials || []).map(m => `${m.nameUk} ${m.required}`).join(', ')}`).join('')}`);
}
// 9.2.5 (игрок 12.10: «полностью разрешаю функцию прокачки ЛВЛ вещей, выбранных в настройках у мамона, не смотря на цену в колах»):
// улучшение вещи-цели у кузнеца — кнопкой «Покращити до Lv.N» на его странице (как игрок; ревизию берёт сама страница). Только вещь из
// настроек (cfg.mmGoalItem), только до выбранного уровня (cfg.mmGoalLvl), по одному уровню за поход, только если игра пишет «хватает»
// (canAfford). Coin of Luck тратится только здесь
const upItem = (items, id) => (Array.isArray(items) ? items : []).find(i => +i.itemId === id) || null;
const upMiss = i => [...(+i.cost?.adenaOwned < +i.cost?.adena ? [`адены ${fmtA(i.cost.adena - i.cost.adenaOwned)}`] : []),
  ...(+i.cost?.coinOfLuckOwned < +i.cost?.coinOfLuck ? [`Coin of Luck ${i.cost.coinOfLuck - i.cost.coinOfLuckOwned}`] : []),
  ...(i.cost?.materials || []).filter(m => m.enough === false || +m.owned < +m.required).map(m => `${m.nameUk} ${(+m.required || 0) - (+m.owned || 0)}`)].join(', ');
async function upgrade(J, items) {
  smithNote(items);
  const id = +env.cfg.mmGoalItem || 0, to = Math.min(5, Math.max(1, +env.cfg.mmGoalLvl || 5)), it = upItem(items, id);
  if (!id || env.cfg.mmUpgrade === false) return finish(J, false, 'улучшение выключено');
  if (!it) return finish(J, false, 'вещи-цели нет у кузнеца в списке (не в сумке и не надета?)');
  const L = +it.level || 0, nm = String(it.nameUk || `#${id}`);
  if (J.clicked != null && L > J.clicked) return finish(J, true, `${nm}: Lv.${J.clicked} → Lv.${L} (Coin of Luck ${J.col ?? '?'})`);
  if (it.max || L >= to) return finish(J, true, `${nm} уже Lv.${L} — цель Lv.${to} достигнута`);
  if (J.clicked != null && J.clicked === L && J.tries >= 2) return finish(J, false, `${nm}: после нажатия уровень не вырос (Lv.${L}) ${(env.$q('#mammon-blacksmith-upgrade-msg')?.textContent || '').trim().slice(0, 80)}`);
  if (!it.canAfford) return finish(J, false, `${nm} Lv.${L} → ${L + 1}: не хватает ${upMiss(it) || 'чего-то (игра пишет «не хватает»)'}`);
  if (location.pathname !== PAGE.smith) { env.setStatus(`Маммон: улучшаю ${nm} у кузнеца`); location.href = PAGE.smith; await env.sleep(4000); return; }
  const card = await env.waitX(() => [...document.querySelectorAll('.l2-mammon-upgrade-card')].find(c =>
    (c.querySelector('.l2-mammon-upgrade-card__name')?.textContent || '').trim() === nm && new RegExp(`Lv\\.?\\s*${L}\\b`).test(c.querySelector('.l2-mammon-upgrade-card__level')?.textContent || '')) || null, 10000, 200);
  const btn = card?.querySelector('.l2-mammon-upgrade-card__btn');
  if (!btn) return finish(J, false, `${nm} Lv.${L}: карточки улучшения на странице кузнеца нет`);
  if (btn.disabled || !new RegExp(`Lv\\.?\\s*${L + 1}\\b`).test(btn.textContent || '')) return finish(J, false, `${nm}: кнопка «${(btn.textContent || '').trim().slice(0, 40)}» недоступна`);
  const col = +it.cost?.coinOfLuck || 0, a = +it.cost?.adena || 0;
  await env.setRt({ mmJob: { ...J, clicked: L, col, tries: (J.tries || 0) + 1, t: J.t } });
  env.rec('B', 'Маммон', `улучшение: жму «${(btn.textContent || '').trim()}» — ${nm}, ${fmtA(a)} адены + ${col} Coin of Luck + ${(it.cost?.materials || []).map(m => `${m.nameUk} ${m.required}`).join(', ')}`);
  try { document.documentElement.dataset.l2botConfirm = String(Date.now()); } catch (e) {}   // окно «точно?» игры — «да» (hook.js, 5 с)
  env.fire(btn);
  await env.waitX(() => (env.$q('#mammon-blacksmith-upgrade-msg')?.textContent || '').trim() || null, 6000, 200);
  await env.sleep(500);
  const r2 = await getJson('/game/mammon/blacksmith/upgrades'), it2 = r2.ok ? upItem(r2.j?.items, id) : null;
  if (it2 && +it2.level > L) { smithNote(r2.j?.items); return finish({ ...J, clicked: L }, true, `${nm}: Lv.${L} → Lv.${it2.level} (${fmtA(a)} адены, ${col} Coin of Luck)`); }
  // уровень не подтвердился — следующий круг цикла перечитает список (J.clicked) и решит: вырос / ещё попытка / неудача
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
return { upgrade, upItem, upMiss, MM_KNOWN, MM_CRAFT, MM_RECIPES, levelCost, goalAll, gearDb, orderNote, orderPoll, npcPoll, mmTick, eqNote, smithNote, costOf, gearLvl, goalPlan, mmFarmGoal, goalNote, modeFree, want, isNear, finish, teleport, claim, smith, mmStep };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
