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
// 10.0.7 (игрок 13.10 02:38, скрин: «Кристал: ранг D · нет в фарме», «кристаллы покупаются в магазине»): сырьё, которое продаёт
// gm-shop (Розхідники › грейд › Ресурси; kb/data/game-shop-drops.json, снимок 11.10): [грейд, цена за штуку в адене — ориентир, в магазине
// бот читает цену со строки]. Такое сырьё не «нет в фарме», а «магазин»: бот докупает его за адену в обычной закупке (cfg.mmShopBuy)
const MM_SHOP = { 1458: ['D', 650], 1459: ['C', 3000], 1460: ['B', 9000], 1461: ['A', 15000], 1462: ['S', 25000],
  2130: ['D', 1000], 2131: ['C', 3000], 2132: ['B', 10000], 2133: ['A', 30000], 2134: ['S', 100000], 1785: ['NG', 250], 3031: ['NG', 300] };
const MM_SHOP_UK = { 1458: 'Кристал: ранг D', 1459: 'Кристал: ранг C', 1460: 'Кристал: ранг B', 1461: 'Кристал: ранг A', 1462: 'Кристал: ранг S',
  2130: 'Самоцвіт: ранг D', 2131: 'Самоцвіт: ранг C', 2132: 'Самоцвіт: ранг B', 2133: 'Самоцвіт: ранг A', 2134: 'Самоцвіт: ранг S', 1785: 'Soul Ore', 3031: 'Spirit Ore' };
const shopBuyOn = () => env.cfg.mmShopBuy !== false;
let GEAR = null, gearLoading = null, goalT = 0, busy = null;
// 9.2.2 (лог 12.10 07:22: «заказ торговца не получен: HTTP 429» ×92): метки опроса жили в переменных модуля и обнулялись при каждой
// загрузке страницы — при частых переходах бот спрашивал заказ на каждой странице. Теперь метки — в sessionStorage вкладки
const ssNum = k => { try { return +sessionStorage.getItem(k) || 0; } catch (e) { return 0; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, String(v)); } catch (e) {} };
let pollT = ssNum('l2bot-mmPollT'), npcT = ssNum('l2bot-mmNpcT');
let pollRetryAt = ssNum('l2bot-mmPollRetryAt'), npcRetryAt = ssNum('l2bot-mmNpcRetryAt');
// 9.2.5 (игрок 12.10: «ник кланового крафтера Skye — отправлять ему ресурсы для очередного / всех повышений вещи у Маммона, а он вернёт
// улучшенные ресурсы почтой; учитывать ресурсы, полученные по почте, и проверять, что в рюкзаке по факту»): почта и сумка
const MAIL_POLL = 10 * 60000, INV_EVERY = 5 * 60000, SEND_MAX = 8 * 60000, CLAIM_MAX = 30, PAGE_TR = '/item-transfer.html', PAGE_MAIL = '/mail.html', PAGE_MC = '/mail-compose.html', NOTE_MAX = 990;
let mailT = ssNum('l2bot-mmMailT'), invT = ssNum('l2bot-mmInvT');
const crafter = () => String(env.cfg.mmCrafter ?? 'Skye').trim();
const atC = () => env.rt.mmCraft?.at || {};      // что лежит у крафтера: отправили, он ещё не вернул (сырьё и промежуточное)
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
async function orderPoll(strict = false, active = () => true) {
  const { ok, status, j } = await getJson('/game/mammon/merchant/request');
  if (!active()) return null;
  if (!ok) { if (strict) throw Error(`заказ торговца: HTTP ${status}`); if (status !== 401) env.rec('B', 'Маммон', `заказ торговца не получен: HTTP ${status}`); return null; }
  return orderNote(j?.request);
}
async function npcPoll(strict = false, active = () => true) {
  const out = { ...(env.rt.mmNpc || {}) };
  for (const k of ['order', 'smith']) {
    const { ok, status, j } = await getJson(STATE[k][0]);
    if (!active()) return null;
    if (!ok && strict) throw Error(`положение ${k}: HTTP ${status}`);
    const s = ok && j?.[STATE[k][1]];
    if (s?.current) out[k] = { loc: s.current.labelEn || s.current.id, id: s.current.id, x: +s.current.worldX, y: +s.current.worldY,
      next: s.next?.labelEn || s.next?.id || '', at: +s.rotatesAtMs || 0, price: j.teleport?.vipFreeApplied ? 0 : +(j.teleport?.adenaCost ?? 500000) };
  }
  out.t = Date.now();
  if (!active()) return null;
  await env.setRt({ mmNpc: out });
  return out;
}
// 9.0: фоновый опрос (только GET): заказ раз в 90 с, где стоят NPC — раз в 30 мин и после смены места
async function mmTick() {
  if (busy) return busy;
  const char = env.rt.char, active = () => env.on !== false && env.tabOwner !== false && env.rt.char === char;
  const now = Date.now(), np = env.rt.mmNpc;
  const wantNpc = now >= npcRetryAt && (now - npcT > NPC_POLL || (np?.order?.at && now > np.order.at + 5000 && now - npcT > (now - np.order.at < 10 * 60000 ? 60000 : 5 * 60000)) || env.rt.mmPollReq);
  const wantOrder = now >= pollRetryAt && (env.cfg.mmOrders !== false || env.rt.mmPollReq) && now - pollT > POLL;
  // 9.2.5: сумка по факту — своим GET /character, если ответов игры с сумкой не было > 5 мин (бот считает план по сумке); почта — раз в 10 мин
  const wantInv = !!env.cfg.mmGoalItem && env.invQty(0) == null && now - invT > INV_EVERY && !!env.invRefresh;
  const wantMail = (env.cfg.mmMailClaim !== false || !!env.rt.mmCraft) && now - mailT > MAIL_POLL;
  if (!wantNpc && !wantOrder && !wantInv && !wantMail) return null;
  busy = (async () => {
    try {
      if (wantInv && active()) { invT = Date.now(); ssSet('l2bot-mmInvT', invT); await env.invRefresh(); }
      if (wantMail && active()) await mailPoll();
      if (wantOrder && active()) {
        try { await orderPoll(true, active); if (active()) { pollT = Date.now(); ssSet('l2bot-mmPollT', pollT); pollRetryAt = 0; ssSet('l2bot-mmPollRetryAt', 0); } }
        catch (e) { if (active()) { pollRetryAt = Date.now() + POLL; ssSet('l2bot-mmPollRetryAt', pollRetryAt); env.rec('B', 'Маммон', `опрос заказа: ${String(e?.message || e).slice(0, 100)} — повтор через 90 с`); } }
      }
      if (wantNpc && active()) {
        try { await npcPoll(true, active); if (active()) { npcT = Date.now(); ssSet('l2bot-mmNpcT', npcT); npcRetryAt = 0; ssSet('l2bot-mmNpcRetryAt', 0); } }
        catch (e) { if (active()) { npcRetryAt = Date.now() + 60000; ssSet('l2bot-mmNpcRetryAt', npcRetryAt); env.rec('B', 'Маммон', `опрос положения NPC: ${String(e?.message || e).slice(0, 100)} — повтор через 60 с`); } }
      }
      if (active() && env.rt.mmPollReq && !npcRetryAt && !pollRetryAt && (!wantNpc || npcT >= now) && (!wantOrder || pollT >= now)) await env.setRt({ mmPollReq: null });
    } catch (e) { if (active()) env.rec('B', 'Маммон', `фоновый опрос: ${String(e?.message || e).slice(0, 100)}`); } finally { busy = null; }
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
  // 10.0.14: ручной апгрейд между запусками не должен проигрывать вчерашнему списку кузнеца.
  if (JSON.stringify(old) !== JSON.stringify(out) || !(env.rt.mmEqT > (env.rt.mmGearT || 0))) env.setRt({ mmEq: out, mmEqT: Date.now() });
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
  // 9.2.5 (лог 12.10 11:56–12:00): кузнец сам пишет, хватает ли всего (canAfford, owned у материалов) — это точнее сумки бота
  const g = upItem(items, +env.cfg.mmGoalItem);
  env.setRt({ mmCost: cost, mmGear: gear, mmGearT: Date.now(), ...(g ? { mmSmithOk: { id: +g.itemId, lvl: +g.level || 0, ok: !!g.canAfford, t: Date.now() } } : {}) });
  return gear.length;
}
const costOf = (id, lvl) => env.rt.mmCost?.[`${id}:${lvl}`] || MM_KNOWN[`${id}:${lvl}`] || null;
function gearLvl(id) {                            // уровень вещи: из списка кузнеца (точный) или из экипировки
  const gs = (env.rt.mmGear || []).filter(x => x.id === id), g = gs.find(x => x.eq) || gs[0];
  const e = Object.values(env.rt.mmEq || {}).find(x => x[0] === id);
  if (e && (!g || env.rt.mmEqT > 0 && env.rt.mmEqT >= (env.rt.mmGearT || 0))) return e[1];
  if (g) return g.lvl;
  return e ? e[1] : 0;
}
const owned = id => (env.rt.mmGear || []).some(x => x.id === id) || Object.values(env.rt.mmEq || {}).some(x => x[0] === id);
const nameEn = id => env.ITEMS?.[id]?.n || '';
const itNm = id => nameEn(+id) || MM_RNAME[id] || MM_INAME[id] || `#${id}`;
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
// 10.0.2 (лог 12.10 17:47 «у крафтера ещё #1868 700, #1869 255»): сырьё из рецептов — тоже по имени (Thread, Iron Ore…)
const MM_INAME = Object.fromEntries(Object.values(MM_RECIPES).flatMap(R => R[1].map(([iid, inm]) => [iid, inm])));
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
  // сумка расходуется один раз на весь план: сначала готовые материалы, затем промежуточные (Сталь в сумке не надо крафтить), затем сырьё.
  // 9.2.5 (крафтер): то, что уже лежит у крафтера (rt.mmCraft.at — отправили, он ещё не вернул), идёт только на крафт (depth ≥ 1) и раньше
  // сумки; сырьё на крафт, взятое из сумки, — «отправить крафтеру» (snd); недостача сырья на крафт — cmiss; готовое от крафтера — ret
  const stock = {}, unknownHave = new Set(), cst = { ...atC() }, snd = new Map(), ret = new Map();
  let cmiss = 0;
  const take = (mid, n, depth) => {
    if (!(mid in stock)) { const h = haveOf(mid); if (h == null) unknownHave.add(mid); stock[mid] = h || 0; }
    let left = n;
    if (depth > 0 && cst[mid] > 0) { const c = Math.min(cst[mid], left); cst[mid] -= c; left -= c; }
    const u = Math.min(stock[mid], left); stock[mid] -= u;
    if (depth > 0 && u) snd.set(mid, (snd.get(mid) || 0) + u);
    return left - u;
  };
  const raw = new Map(), craft = new Map();
  const addRaw = (mid, nm, n, gross, L) => { const r = raw.get(mid) || { id: mid, nm: nameEn(mid) || nm, need: 0, miss: 0, lv: L }; r.need += gross; r.miss += n; raw.set(mid, r); };
  const expand = (mid, nm, n, L, depth = 0) => {           // n — сколько нужно; возвращает недостачу, разложенную до сырья
    const left = take(mid, n, depth), R = MM_RECIPES[mid];
    if (!R || depth > 6) { addRaw(mid, nm, left, n, L); if (depth > 0) cmiss += left; return; }
    if (!left) return;
    const k = Math.ceil(left / R[0]), cr = craft.get(mid) || { id: mid, nm: MM_RNAME[mid] || nameEn(mid) || nm, qty: 0, runs: 0, rec: R[1].map(x => `${x[2]} ${x[1]}`).join(' + ') + (R[0] > 1 ? ` (выход ${R[0]})` : '') };
    cr.qty += left; cr.runs += k; craft.set(mid, cr);
    if (!depth) ret.set(mid, (ret.get(mid) || 0) + left);
    for (const [iid, inm, q] of R[1]) expand(iid, inm, q * k, L, depth + 1);
  };
  const tl = [...tot.values()].sort((x, y) => x.lv - y.lv);
  for (const t of tl) { t.have = haveOf(t.id); t.miss = t.have == null ? t.need : Math.max(0, t.need - t.have); }
  for (const t of tl) expand(t.id, t.nm, t.need, t.lv);
  // 10.0.7 (скрин 13.10: «Залізна руда · нет в фарме» при «iron ore» в базе): справочник предметов есть не на каждой странице — имя сырья
  // могло быть украинским, а база фарма — по английским именам. Ищем источник по всем известным именам предмета
  const farmOf = r => [nameEn(r.id), MM_INAME[r.id], MM_RNAME[r.id], r.nm].filter(Boolean).some(n => env.FARM?.res?.[String(n).toLowerCase()]);
  const rl = [...raw.values()].sort((x, y) => x.lv - y.lv).map(r => ({ ...r, have: unknownHave.has(r.id) ? null : haveOf(r.id), farm: farmOf(r), shop: MM_SHOP[r.id] ? { g: MM_SHOP[r.id][0], a: MM_SHOP[r.id][1] } : null }));
  const nmOf = mid => nameEn(mid) || MM_RNAME[mid] || raw.get(mid)?.nm || `#${mid}`;
  return { id, name, lvl, to, a, col, lv, unk, tot: tl, raw: rl, craft: [...craft.values()].reverse(), est: lv.some(x => x.est), ready: !unk.length && tl.every(t => t.have != null && t.miss === 0),
    snd: [...snd].map(([mid, q]) => ({ id: mid, nm: nmOf(mid), q })), cmiss, ret: Object.fromEntries(ret) };
}
// цель фарма для content.farmGoal. 9.2: по всему плану до цели (наперёд), крафтовое — его сырьём; сначала сырьё ближайшего уровня,
// затем остальное: первое недостающее сырьё, у которого есть источник в базе фарма форума (дроп/спойл)
function mmFarmGoal() {
  if (env.cfg.mmGoalFarm === false) return null;
  if (env.cfg.mmFarmDrop === false && !spoilOn()) return null;
  const p = goalAll(); if (!p?.raw) return null;
  const fit = x => x.miss > 0 && x.farm && !(x.shop && shopBuyOn());   // 10.0.7: продаётся в магазине и докупка включена — не фармим, купим
  if (env.cfg.mmFarmBest !== false) { const b = farmPlanPt(p); if (b) return b.goal; }   // 10.0.7: точка по всем недостающим сразу
  const n = p.lvl + 1 < p.to ? goalAll(p.lvl + 1) : null, rn = n?.raw?.find(fit);   // сначала то, что нужно на ближайший уровень
  const first = rn ? p.raw.find(x => x.id === rn.id) : null;
  // 10.0.14: простой режим тоже учитывает язык /upgrades и выбранные дроп/спойл. Иначе content.farmPick возвращал отключённые источники.
  for (const r of [...(first ? [first] : []), ...p.raw.filter(x => x !== first && fit(x))]) {
    const b = farmPlanPt(p, [r]);
    if (b) return { ...b.goal, why: `Маммон: ${p.name} до Lv.${p.to} (по одному ресурсу)` };
  }
  return null;
}
// 10.0.7 (игрок 13.10: «автофарм расходников на апрейд выбранного снаряжения… выбор оптимальных локаций, учитывать дроп и спойл»):
// раньше бот добывал ОДИН недостающий ресурс и летел к лучшей точке по нему, а соседние нужные ресурсы с тех же мобов не учитывал.
// Теперь точка выбирается по всем недостающим материалам цели сразу: для каждого ресурса — зоны-источники (content.farmZones:
// шт./бой по дропу + спойлу × шанс пометки, окно уровней), затем по точкам телепорта — сколько «боёв в другом месте» экономят 50 боёв
// здесь: Σ min(шт./бой × 50, недостача) × (боёв на 1 шт. в лучшей точке этого ресурса). Так редкое сырьё (Mithril Ore 7 % дроп / 42 % спойл)
// весит больше, чем Iron Ore (16 %), а точка, где падает и то и другое, побеждает. Дроп и спойл — по галочкам cfg.mmFarmDrop / mmFarmSpoil
const spoilOn = () => env.cfg.mmFarmSpoil === 'on' || (env.cfg.mmFarmSpoil !== 'off' && !!env.canSpoil?.());
const resKeys = r => [...new Set([r.nm, nameEn(r.id), MM_INAME[r.id], MM_RNAME[r.id]].filter(Boolean).map(n => String(n).toLowerCase()))];
const resOf = r => { for (const k of resKeys(r)) { const x = env.FARM?.res?.[k]; if (x && (x.drop?.length || x.sp?.length)) return { key: k, res: x }; } return null; };
function farmPlanPt(P, raws) {
  const L = +env.heroLvl?.() || 0; if (!L || !env.farmZones) return null;
  const list = (raws || (P?.raw || []).filter(x => x.miss > 0 && x.farm && !(x.shop && shopBuyOn()))).map(r => ({ r, src: resOf(r) })).filter(x => x.src);
  if (!list.length) return null;
  const N = 50, spK = +env.spoilK?.() || 0.8, useD = env.cfg.mmFarmDrop !== false, useS = spoilOn();
  if (!useD && !useS) return null;
  const pts = new Map(), best = {};
  for (const { r, src } of list) {
    const zones = env.farmZones(useD ? src.res.drop || [] : [], L, env.cfg.lvlAbove ?? 6, useS ? src.res.sp || [] : [], spK);
    for (const z of zones) {
      if (!(z.e > 0)) continue;
      best[src.key] = Math.max(best[src.key] || 0, z.e);
      const pt = pts.get(z.tp) || { tp: z.tp, loc: z.loc, mobs: {}, res: [], inWin: false };
      for (const [nm, m] of Object.entries(z.mobs)) { const o = pt.mobs[nm] || { lvl: m.lvl, e: 0, ch: 0, spCh: 0 }; o.e += m.e; o.ch = Math.max(o.ch, m.ch || 0); o.spCh = Math.max(o.spCh, m.spCh || 0); pt.mobs[nm] = o; }
      pt.res.push({ key: src.key, nm: r.nm, id: r.id, e: z.e, miss: r.miss, need: r.need, fit: z.e > 0 ? z.score / z.e : 1, inWin: !!z.inWin });
      pt.inWin = pt.inWin || !!z.inWin;
      pts.set(z.tp, pt);
    }
  }
  if (!pts.size) return null;
  const out = [...pts.values()].map(pt => {
    pt.score = pt.res.reduce((a, x) => a + Math.min(x.e * N, x.miss) / best[x.key] * x.fit, 0) * (pt.inWin ? 1.3 : 1);
    pt.e = pt.res.reduce((a, x) => a + x.e, 0);
    pt.fights = Math.max(...pt.res.map(x => Math.ceil(x.miss / x.e)));   // боёв, чтобы закрыть всё, что тут падает
    pt.res.sort((a, b) => b.miss / b.e - a.miss / a.e);   // первым — ресурс, который тут закрывать дольше всех (он и «цель» для журнала)
    return pt;
  }).sort((a, b) => b.score - a.score);
  const b = out[0], main = b.res[0], names = Object.keys(b.mobs);
  const pick = { tp: b.tp, loc: b.loc, mobs: b.mobs, e: b.e, score: b.score, inWin: b.inWin, names, res: b.res, fights: b.fights, all: out.length };
  const why = `Маммон: ${P?.name || 'цель'}${P?.to ? ` до Lv.${P.to}` : ''} — точка по всем материалам (${b.res.map(x => `${x.nm} ≈${x.e.toFixed(2)}/бой`).join(', ')})`;
  return { goal: { key: main.key, name: env.FARM.res[main.key]?.name || main.nm, left: main.miss, why, pick }, pts: out, best };
}
// план точки для меню (rt.mmGoalPlan.pt): первые 3 точки — локация, мобы, шт./бой по ресурсам, боёв до закрытия
const ptOut = (B, n = 3) => !B ? null : { d: env.cfg.mmFarmDrop !== false ? 1 : 0, s: spoilOn() ? 1 : 0, sk: Math.round((+env.spoilK?.() || 0.8) * 100),
  pts: B.pts.slice(0, n).map(pt => ({ tp: pt.tp, loc: pt.loc, f: pt.fights, w: pt.inWin ? 1 : 0, sc: Math.round(pt.score * 100) / 100,
    m: Object.entries(pt.mobs).slice(0, 4).map(([nm, m]) => [nm, m.lvl, m.ch || 0, m.spCh || 0]), r: pt.res.map(x => [x.nm, Math.round(x.e * 100) / 100, x.miss]) })) };
// 10.0.7: что из недостающего сырья бот докупит в магазине и во сколько это обойдётся (ориентир по kb-ценам)
const shopNote = miss => { const s = miss.filter(r => r.shop); if (!s.length) return '';
  return ` · ${shopBuyOn() ? 'докуплю в магазине' : 'продаётся в магазине (докупка выключена)'}: ${s.map(r => `${r.nm} ${fmtA(r.miss)} ≈ ${fmtA(r.miss * r.shop.a)} аден`).join(', ')}`; };
// 10.0.7: позиции для обычной закупки (economy.shopPlan): недостающее сырьё цели, которое продаёт gm-shop. mm = [нужно всего, нужно всего] —
// закупка берёт «до максимума», т.е. ровно недостачу; грейд — вкладка магазина, подраздел «Ресурси»
function mmShopWant() {
  if (!shopBuyOn() || !+env.cfg.mmGoalItem) return [];
  let P = null; try { P = goalAll(); } catch (e) { return []; }
  return (P?.raw || []).filter(r => r.shop && r.miss > 0).map(r => ({ key: `mm${r.id}`, label: `${MM_SHOP_UK[r.id] || r.nm} (Маммон)`, ids: [r.id], grade: r.shop.g, sub: 'resources',
    name: new RegExp(`^(?:${[MM_SHOP_UK[r.id], nameEn(r.id), r.nm].filter(Boolean).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'i'), mm: [r.need, r.need], unit: r.shop.a }));
}
const short = (l, n = 8) => l.slice(0, n).map(m => `${m.nm} ${fmtA(m.miss)}`).join(', ') + (l.length > n ? ` и ещё ${l.length - n}` : '');
function planOut(P) {                             // компактный план для меню (rt.mmGoalPlan): popup модуль не загружает
  if (!P || P.done) return null;
  return { id: P.id, n: P.name, lvl: P.lvl, to: P.to, a: P.a, c: P.col, unk: P.unk,
    lv: P.lv.map(x => x.unk ? { L: x.L, unk: 1 } : { L: x.L, e: x.est, a: x.a, c: x.c, m: x.m.map(m => [m[1], m[2]]) }),
    tot: P.tot.map(t => [t.nm, t.need, t.have, t.miss]), raw: P.raw.map(r => [r.nm, r.need, r.have, r.miss, r.farm ? 1 : 0, r.shop?.g || '', r.shop?.a || 0]),
    lk: owned(P.id) ? 1 : 0, cr: P.craft.map(c => [c.nm, c.qty, c.runs, c.rec]), snd: (P.snd || []).map(x => [x.nm, x.q]), cm: P.cmiss || 0,
    pt: env.cfg.mmGoalFarm !== false && env.cfg.mmFarmBest !== false ? ptOut(farmPlanPt(P)) : null };   // 10.0.7: точка по всем материалам
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
      : !miss.length ? `${p.name} до Lv.${P.to}: сырьё есть${P.craft.length ? ', осталось скрафтить: ' + P.craft.map(c => `${c.nm} ${fmtA(c.qty)}`).join(', ') + (Object.values(atC()).some(v => v > 0) ? ` (сырьё у крафтера ${crafter()}, жду письмо)` : '') : ''}`
      : `${p.name} Lv.${p.lvl} → Lv.${P.to}: наперёд не хватает ${short(miss)}` + (f ? ` · добываю ${f.name}` : '') + shopNote(miss) + (f || miss.some(r => r.shop) ? '' : ' · в базе фарма источников нет'))
      + (P.est ? ' · ≈ часть цен — оценка' : '') + (P.unk.length ? ` · цены Lv.${P.unk.map(L => L + 1).join(', ')} неизвестны` : '');
  }
  const plan = planOut(P), ps = JSON.stringify(plan);
  // 9.2.5 (лог 12.10 11:18–12:01): имя материала скачет между страницами («Кристал: ранг D» ↔ «Crystal: D-Grade» — справочник предметов
  // есть не везде) → строка писалась в журнал раз в полминуты. В журнал — только когда меняется суть (имена заменены на id)
  const sig = [...(P?.raw || []), ...(P?.tot || []), ...(p?.mats || [])].reduce((a, r) => [r.nm, r.uk].filter(Boolean).reduce((x, n) => x.split(n).join('#' + r.id), a), st);
  const stNew = st !== (env.rt.mmGoalSt || ''), sigNew = sig !== (env.rt.mmGoalSig ?? null);
  if (stNew || ps !== JSON.stringify(env.rt.mmGoalPlan || null)) { env.setRt({ mmGoalSt: st, mmGoalPlan: plan, mmGoalSig: sig }); if (sigNew && st) env.rec('B', 'Маммон', st); }
  return p;
}
// ---- поход к NPC ----
function modeFree(afterWin = false, allowEnchant = false) {             // можно ли отлучиться: не в бою, не в походе, не в туре РБ/эпиков/РБ-сессии, не перед TvT
  if (env.cfg.enchantMode === true && !allowEnchant) return false; // 15.10: отдельная заточка запрещает новые служебные походы.
  const r = env.rt;                               // afterWin — 10.0: экран победы в цепочке (страница боя, но бой окончен)
  if ((!afterWin && env.isBattle()) || r.shop || r.rbGo || r.zoneGo || r.revive || r.tbuff || r.magister || r.invScan || r.fishSvc) return false;
  if (r.rbSess?.on || (r.epic?.step && r.epic.step !== 'pick')) return false;
  if (['epic', 'raid'].includes(env.autonomyMode())) return false;
  if (env.cfg.tvtOn && env.tvtSoon?.()) return false;
  if (env.isFishing() && env.fishState()) return false;          // рыба на крючке — сначала вываживаем
  return true;
}
// 9.2.5 (игрок 12.10: «добавь кнопку — идти улучшить / выполнить задание у Маммона»): кнопки меню ставят rt.mmGoReq {kind:'order'|'up', t}.
// Разовая команда игрока: летим сразу, без автоматических условий (галочки «сам», пауза 30 мин после неудачи, «уже пробовал»).
// Остаются проверки игры: заказ открыт и ресурса хватает по сумке; улучшение — вещь-цель выбрана, цель не достигнута, «хватает» — у кузнеца
// 10.0.9 (игрок 13.10 07:22, скрин: «где отметил красным, добавь кнопку — открыть Маммона/прийти к Маммону — на выбор торговец или кузнец»):
// kind 'visit' {npc:'order'|'smith'} — просто прийти к NPC (телепорт за адену, как у задач), открыть его страницу и встать на паузу,
// чтобы игрок сделал своё; никаких проверок заказа/вещи-цели
function goReq(now = Date.now()) {
  const R = env.rt.mmGoReq; if (!R?.kind) return null;
  if (now - (R.t || 0) > 30 * 60000) return { drop: 'команда устарела (30 мин)' };
  if (R.kind === 'visit') { const k = R.npc === 'smith' ? 'smith' : 'order'; return { kind: k, visit: true, cmd: true, why: `по кнопке: прийти к ${NPC_NAME[k]} Маммона` }; }
  if (R.kind === 'order') {
    const o = env.rt.mmOrder;
    if (!o || o.st !== 'OPEN' || !(o.exp - now > 60000)) return { drop: `открытого заказа нет${o?.st === 'CLAIMED' ? ` (забрал ${o.win || 'другой игрок'})` : ''}` };
    if (!(o.have >= o.qty)) return { drop: `для заказа ${o.res} ×${o.qty} в сумке ${o.have ?? 0} — не хватает` };
    return { kind: 'order', id: o.id, cmd: true, why: `по кнопке: заказ ${o.res} ×${o.qty}` };
  }
  const p = env.cfg.mmGoalItem ? goalPlan() : null;
  if (!p) return { drop: 'вещь-цель не выбрана в меню' };
  if (p.done) return { drop: `${p.name} уже на уровне цели` };
  return { kind: 'smith', up: true, cmd: true, id: `up:${p.id}:${p.lvl}`, why: `по кнопке: улучшить ${p.name} Lv.${p.lvl} → ${p.lvl + 1}` };
}
function want() {
  const g = goReq(); if (g && !g.drop) return g;
  const o = env.rt.mmOrder, now = Date.now(), tried = env.rt.mmTried || {};
  if (env.cfg.mmOrders !== false && o?.st === 'OPEN' && o.qty > 0 && o.have >= o.qty && !tried[o.id] && o.exp - now > 60000)
    return { kind: 'order', id: o.id, why: `заказ ${o.res} ×${o.qty}` };
  const cw = craftWant(now); if (cw?.cmd && !cw.drop) return cw;
  const hw = env.handWant?.(now); if (hw && !hw.drop) return hw;   // 10.0.7: «📤 Передать основному сейчас» (modules/subclass.js)
  // 10.0 (аудит): вложение не забирается (инвентарь полон, кнопки нет) — не ходить на почту раз в 10 мин: повтор, когда почта изменилась, или раз в 2 ч
  const uncSig = (env.rt.mmMail?.unc || []).map(a => a.a).join(','), cf = env.rt.mmClaimFail;
  if (env.rt.mmMail?.unc?.length && env.cfg.mmMailClaim !== false && now - (env.rt.mmClaimT || 0) > UP_RETRY / 3 && !(cf?.sig === uncSig && now - (cf.t || 0) < 2 * 3600000))
    return { kind: 'claim', why: `в почте предметов: ${env.rt.mmMail.unc.length} (${env.rt.mmMail.unc.slice(0, 3).map(a => `${a.n} ×${fmtA(a.q)} от ${a.s}`).join(', ')})` };
  if (cw && !cw.drop) return cw;
  if (env.rt.mmSmithReq) return { kind: 'smith', why: 'узнать цены у кузнеца (по кнопке)' };
  const p = env.cfg.mmGoalItem ? goalPlan() : null;
  // 9.2.5: всё на следующий уровень собрано (материалы по сумке, Coin of Luck — если сумка его знает) — летим улучшать. После неудачи — не чаще раза в 30 мин
  // Адена — не предмет сумки (character.adena), её проверяет кузнец (canAfford). Сумка не видит всего (лог 12.10: ресурсы с почты) —
  // свежий ответ кузнеца «хватает» (mmSmithOk, ≤ 30 мин, тот же уровень) тоже готовность
  const colHave = haveOf(COL_ID), so = env.rt.mmSmithOk, smithOk = !!(p && so?.ok && so.id === p.id && so.lvl === p.lvl && now - (so.t || 0) < 30 * 60000);
  // 10.0 (аудит): две неудачи на этом уровне (карточки нет, кнопка недоступна, уровень не вырос) — не платить за телепорт раз в 30 мин без конца:
  // ждём 6 ч или кнопку игрока; кузнец недавно ответил «не хватает» на этом уровне — по сумке (p.ready) не летим, адену видит только кузнец
  const uf = env.rt.mmUpFail, upKey = p ? `${p.id}:${p.lvl}` : '', failStop = !!(uf && uf.k === upKey && uf.n >= 2 && now - (uf.t || 0) < 6 * 3600000);
  const smithNo = !!(p && so && so.ok === false && so.id === p.id && so.lvl === p.lvl && now - (so.t || 0) < 2 * 3600000);
  if (p && !p.done && !failStop && (smithOk || (p.ready && !smithNo && (colHave == null || colHave >= (p.col || 0)))) && env.cfg.mmUpgrade !== false && now - (env.rt.mmUpT || 0) > UP_RETRY)
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
const KIND = { order: 'заказ', send: 'крафтеру', claim: 'почта' };
const NPC_NAME = { order: 'торговцу', smith: 'кузнецу' };
async function finish(J, ok, why) {
  const log = [{ kind: J.kind, id: J.id || '', ok: !!ok, why: String(why || '').slice(0, 120), t: Date.now() }, ...(env.rt.mmLog || [])].slice(0, 20);
  env.rec('B', 'Маммон', `${KIND[J.kind] || (J.up ? 'улучшение' : 'кузнец')}: ${ok ? '✓' : '✗'} ${why}${J.home ? ' · возвращаюсь на точку' : ''}`);
  const back = J.home && !env.fishNow() ? { zoneGo: { id: J.home, t: Date.now(), why: 'Маммон: обратно на точку' }, zoneGoT: 0 } : {};
  // 10.0 (аудит): счётчик неудач улучшения на уровне (want: после 2 — пауза 6 ч), отметка «почта не забирается», недосланный остаток партии крафтеру
  const extra = {};
  if (J.up && !J.cancelled) { const k = String(J.id || '').replace(/^up:/, ''), uf = env.rt.mmUpFail; extra.mmUpFail = ok ? null : { k, n: (uf?.k === k ? uf.n || 0 : 0) + 1, t: Date.now() }; }
  if (J.kind === 'claim') extra.mmClaimFail = ok && (J.got || []).length ? null : { sig: (env.rt.mmMail?.unc || []).map(a => a.a).join(','), t: Date.now() };
  if (J.kind === 'send' && env.rt.mmCraft) {
    const pn = J.pendJob ? (env.rt.mmCraft.pendN || 0) + (J.cancelled ? 0 : 1) : 0;   // отмена игроком не считается неудачной досылкой
    const pend = !ok && ((J.done || []).length || J.pendJob) && (J.items || []).length && pn < 3 ? J.items : null;
    if (!ok && J.pendJob && !pend) env.rec('B', 'Маммон', `остаток партии крафтеру не ушёл 3 раза — бросаю: ${J.items.map(x => `${x[2]} ${fmtA(x[1])}`).join(', ')}`);
    if (pend || env.rt.mmCraft.pend) extra.mmCraft = { ...env.rt.mmCraft, pend, pendN: pend ? pn : 0, pendNote: pend && J.note ? { ...J.note, prev: [...(J.note.prev || []), ...(J.done || []).map(x => [x[0], x[1]])] } : null };
  }
  await env.setRt({ mmJob: null, mmLog: log, ...(J.kind === 'smith' ? { mmSmithReq: null, mmSmithT: Date.now() } : {}), ...(J.up ? { mmUpT: ok || J.cancelled ? 0 : Date.now() } : {}),
    ...(J.kind === 'send' ? { mmSendT: ok || J.cancelled ? 0 : Date.now() } : {}), ...(J.kind === 'claim' ? { mmClaimT: Date.now() } : {}), ...extra, ...back });
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
// 10.0.9: «прийти к Маммону» — NPC рядом: открываем его страницу и ставим бота на паузу (игрок жмёт ▶ Продолжить, когда закончит)
async function visit(J) {
  const page = PAGE[J.kind];
  if (location.pathname !== page) { env.setStatus(`Маммон: открываю ${NPC_NAME[J.kind]}`); location.href = page; await env.sleep(4000); return; }
  const log = [{ kind: 'visit', id: J.kind, ok: true, why: `пришёл к ${NPC_NAME[J.kind]}`, t: Date.now() }, ...(env.rt.mmLog || [])].slice(0, 20);
  await env.setRt({ mmJob: null, mmLog: log });
  await env.pauseBot(`пришёл к ${NPC_NAME[J.kind]} Маммона (по кнопке в окне бота) — жду команды: ▶ Продолжить в меню`);
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
  const n = smithNote(r.j?.items), items = Array.isArray(r.j?.items) ? r.j.items : [];
  // 9.2.5: у кузнеца, а вещь-цель уже можно улучшить (игра пишет «хватает») — улучшаем в этот же заход, без второго телепорта
  const g = upItem(items, +env.cfg.mmGoalItem || 0), to = Math.min(5, Math.max(1, +env.cfg.mmGoalLvl || 5));
  if (g && g.canAfford && !g.max && (+g.level || 0) < to && env.cfg.mmUpgrade !== false) {
    const U = { ...J, up: true, why: `улучшить ${g.nameUk} Lv.${g.level} → ${+g.level + 1}` };
    await env.setRt({ mmJob: U }); env.rec('B', 'Маммон', `кузнец: на ${g.nameUk} Lv.${+g.level + 1} всего хватает — улучшаю сразу`);
    return upgrade(U, items);
  }
  const mat = m => `${m.nameUk} ${m.owned != null ? `${fmtA(m.owned)}/` : ''}${fmtA(m.required)}`;
  return finish(J, true, `цены прочитаны: вещей ${n}${items.filter(i => !i.max && i.cost).map(i => ` · ${i.nameUk} Lv.${i.level}→${i.level + 1}${i.canAfford ? ' ✅ хватает' : ''}: ${fmtA(i.cost.adena)} адены, ${i.cost.coinOfLuck} CoL, ${(i.cost.materials || []).map(mat).join(', ')}`).join('')}`);
}
// 9.2.5 (игрок 12.10: «полностью разрешаю функцию прокачки ЛВЛ вещей, выбранных в настройках у мамона, не смотря на цену в колах»):
// улучшение вещи-цели у кузнеца — кнопкой «Покращити до Lv.N» на его странице (как игрок; ревизию берёт сама страница). Только вещь из
// настроек (cfg.mmGoalItem), только до выбранного уровня (cfg.mmGoalLvl), по одному уровню за поход, только если игра пишет «хватает»
// (canAfford). Coin of Luck тратится только здесь
// 10.0 (аудит): две одинаковые вещи (надета и в сумке) — улучшаем надетую
const upItem = (items, id) => { const l = (Array.isArray(items) ? items : []).filter(i => +i.itemId === id);
  return l.find(i => /одягн|одет|надет|equip/i.test(String(i.locationLabelUk || ''))) || l[0] || null; };
const upMiss = i => [...(+i.cost?.adenaOwned < +i.cost?.adena ? [`адены ${fmtA(i.cost.adena - i.cost.adenaOwned)}`] : []),
  ...(+i.cost?.coinOfLuckOwned < +i.cost?.coinOfLuck ? [`Coin of Luck ${i.cost.coinOfLuck - i.cost.coinOfLuckOwned}`] : []),
  ...(i.cost?.materials || []).filter(m => m.enough === false || +m.owned < +m.required).map(m => `${m.nameUk} ${(+m.required || 0) - (+m.owned || 0)}`)].join(', ');
async function upgrade(J, items) {
  smithNote(items);
  const id = +env.cfg.mmGoalItem || 0, to = Math.min(5, Math.max(1, +env.cfg.mmGoalLvl || 5));
  const chosen = list => J.target ? (Array.isArray(list) ? list : []).find(i => +i.itemId === id && i.targetInstanceId === J.target) : upItem(list, id);
  const it = chosen(items);
  if (!id || (env.cfg.mmUpgrade === false && !J.cmd)) return finish(J, false, 'улучшение выключено');   // 9.2.5: кнопка «улучшить сейчас» — команда игрока
  if (!it) return finish(J, false, 'вещи-цели нет у кузнеца в списке (не в сумке и не надета?)');
  const L = +it.level || 0, nm = String(it.nameUk || `#${id}`);
  if (J.clicked != null && L > J.clicked) return finish(J, true, `${nm}: Lv.${J.clicked} → Lv.${L} (Coin of Luck ${J.col ?? '?'})`);
  if (it.max || L >= to) return finish(J, true, `${nm} уже Lv.${L} — цель Lv.${to} достигнута`);
  if (J.clicked != null && J.clicked === L && J.tries >= 2) return finish(J, false, `${nm}: после нажатия уровень не вырос (Lv.${L}) ${(env.$q('#mammon-blacksmith-upgrade-msg')?.textContent || '').trim().slice(0, 80)}`);
  if (!it.canAfford) return finish(J, false, `${nm} Lv.${L} → ${L + 1}: не хватает ${upMiss(it) || 'чего-то (игра пишет «не хватает»)'}`);
  if (location.pathname !== PAGE.smith) { env.setStatus(`Маммон: улучшаю ${nm} у кузнеца`); location.href = PAGE.smith; await env.sleep(4000); return; }
  // 10.0.13 (аудит 14.10): одинаковые имя и уровень не определяют экземпляр. Страница связывает кнопку с targetInstanceId,
  // а в карточке показывает место (надето/сумка). Неоднозначную карточку не нажимаем: иначе CoL уходили на дубликат из сумки.
  const card = await env.waitX(() => {
    const cards = [...document.querySelectorAll('.l2-mammon-upgrade-card')].filter(c =>
      (c.querySelector('.l2-mammon-upgrade-card__name')?.textContent || '').trim() === nm && new RegExp(`Lv\\.?\\s*${L}\\b`).test(c.querySelector('.l2-mammon-upgrade-card__level')?.textContent || ''));
    const place = String(it.locationLabelUk || '').trim(), meta = c => (c.querySelector('.l2-mammon-upgrade-card__meta')?.textContent || '').split('·').pop().trim();
    const exact = place ? cards.filter(c => meta(c) === place) : [];
    return exact.length === 1 ? exact[0] : cards.length === 1 && (!place || !meta(cards[0])) ? cards[0] : null;
  }, 10000, 200);
  const btn = card?.querySelector('.l2-mammon-upgrade-card__btn');
  if (!btn) return finish(J, false, `${nm} Lv.${L}: карточки улучшения на странице кузнеца нет`);
  if (btn.disabled || !new RegExp(`Lv\\.?\\s*${L + 1}\\b`).test(btn.textContent || '')) return finish(J, false, `${nm}: кнопка «${(btn.textContent || '').trim().slice(0, 40)}» недоступна`);
  const col = +it.cost?.coinOfLuck || 0, a = +it.cost?.adena || 0;
  const allowed = () => +env.cfg.mmGoalItem === id && (env.cfg.mmUpgrade !== false || J.cmd) && L < Math.min(5, Math.max(1, +env.cfg.mmGoalLvl || 5));
  if (!allowed()) return finish({ ...J, cancelled: true }, false, 'улучшение отменено: настройка или цель изменена');
  J = { ...J, target: it.targetInstanceId || J.target };
  await env.setRt({ mmJob: { ...J, clicked: L, col, tries: (J.tries || 0) + 1, t: J.t } });
  if (!allowed()) return finish({ ...J, cancelled: true }, false, 'улучшение отменено: настройка или цель изменена');
  env.rec('B', 'Маммон', `улучшение: жму «${(btn.textContent || '').trim()}» — ${nm}, ${fmtA(a)} адены + ${col} Coin of Luck + ${(it.cost?.materials || []).map(m => `${m.nameUk} ${m.required}`).join(', ')}`);
  try { document.documentElement.dataset.l2botConfirm = String(Date.now()); } catch (e) {}   // окно «точно?» игры — «да» (hook.js, 5 с)
  env.fire(btn);
  await env.waitX(() => (env.$q('#mammon-blacksmith-upgrade-msg')?.textContent || '').trim() || null, 6000, 200);
  await env.sleep(500);
  const r2 = await getJson('/game/mammon/blacksmith/upgrades'), it2 = r2.ok ? chosen(r2.j?.items) : null;
  if (it2 && +it2.level > L) {
    smithNote(r2.j?.items);
    // 10.0 (аудит): цель выше и на следующий уровень игра пишет «хватает» — улучшаем в этот же заход (раньше: домой и снова телепорт за 500 000)
    if (it2.canAfford && !it2.max && +it2.level < to) {
      env.rec('B', 'Маммон', `улучшение: ${nm} Lv.${L} → Lv.${it2.level} (${fmtA(a)} адены, ${col} Coin of Luck) · на Lv.${+it2.level + 1} тоже хватает — продолжаю`);
      await env.setRt({ mmJob: { ...J, id: `up:${id}:${+it2.level}`, clicked: null, tries: 0, t: Date.now(), why: `улучшить ${nm} Lv.${it2.level} → ${+it2.level + 1}` }, mmUpFail: null });
      return;
    }
    return finish({ ...J, clicked: L }, true, `${nm}: Lv.${L} → Lv.${it2.level} (${fmtA(a)} адены, ${col} Coin of Luck)`);
  }
  // уровень не подтвердился — следующий круг цикла перечитает список (J.clicked) и решит: вырос / ещё попытка / неудача
}
// 9.2.5 (лог 12.10 11:56: ресурсы на улучшение пришли почтой, «Забрати» → сумка бота их не показала, бот так и не пошёл): забрали
// вложение из почты, а вещь-цель по сумке ещё не готова → спросить кузнеца (он видит всё, что есть у героя); не чаще раза в 2 ч
function mailNote() {
  if (!env.cfg.mmGoalItem || env.cfg.mmUpgrade === false || env.rt.mmSmithReq) return false;
  const p = goalPlan(); if (!p || p.done || p.ready || !owned(p.id)) return false;
  // 10.0 (аудит): не любое письмо — только от крафтера или с материалом/сырьём вещи-цели (иначе платный полёт к кузнецу за чужую посылку)
  const P = goalAll(), ids = new Set([...(p.mats || []), ...(P?.raw || []), ...(P?.tot || [])].map(m => +m.id)), cr = crafter().toLowerCase();
  if (!(env.rt.mmMail?.unc || []).some(a => ids.has(+a.id) || (cr && a.s.trim().toLowerCase() === cr))) return false;
  if (Date.now() - (env.rt.mmMailT || 0) < 2 * 3600000) return false;
  env.setRt({ mmSmithReq: Date.now(), mmMailT: Date.now(), mmUpT: 0 });
  env.rec('B', 'Маммон', `забрал вложение из почты — проверю у кузнеца, хватает ли на ${p.name} Lv.${p.lvl + 1}`);
  return true;
}
// ---- 9.2.5: клановый крафтер (cfg.mmCrafter, по умолчанию Skye) ----
// Передача предметов в игре — страница /item-transfer.html (письмом: строка предмета → «Кількість», «Отримувач (нік)» → «Надіслати» →
// окно «Підтвердження передачі» → «Підтвердити»; комиссия 5 % от стоимости предмета в адене). Пришедшее — /mail.html, вкладка «Предмети»,
// кнопка «Забрати» (GET /game/item-transfer/received: attachments[{attachmentId, senderName, itemId, name, qty, createdAt, claimedAt}]).
// Что крафтеру: сырьё (и промежуточное из сумки) на крафтовые материалы вещи-цели — на следующий уровень или до цели (cfg.mmCraftScope).
// Сам бот шлёт только полный набор (cmiss = 0) и одну партию за раз; кнопка «отправить сейчас» шлёт то, что есть. Отправленное лежит
// «у крафтера» (rt.mmCraft.at) и считается в плане как своё — бот не фармит его заново; вернулось письмом от крафтера — списываем по рецептам
function craftPlan(scope = env.cfg.mmCraftScope) {
  const p = env.cfg.mmGoalItem ? goalPlan() : null; if (!p || p.done) return p;
  return goalAll(scope === 'all' ? 0 : p.lvl + 1);
}
function craftWant(now = Date.now()) {
  const R = env.rt.mmCraftReq, cmd = !!R?.t, to = crafter();
  if (cmd && now - R.t > 30 * 60000) return { drop: 'команда устарела (30 мин)' };
  if (!to) return cmd ? { drop: 'ник крафтера не задан в меню' } : null;
  if (!env.cfg.mmGoalItem) return cmd ? { drop: 'вещь-цель не выбрана в меню' } : null;
  if (env.craftSelf?.()) return cmd ? { drop: 'активный класс крафтит сам (саб крафтера, раздел «Сабклассы») — крафтеру не шлю' } : null;   // 10.0.7
  // 10.0 (аудит): партия ушла не вся (строки нет, форма не открылась) — досылаем остаток, иначе у крафтера неполный набор и автоотправка стоит навсегда
  const active = env.rt.mmCraft, pend = active?.pend;
  // 10.0.14: настройка нового крафтера относится к следующей партии; текущую не делим между людьми.
  if (cmd && active?.to && active.to.toLowerCase() !== to.toLowerCase() && (pend?.length || Object.values(atC()).some(v => v > 0)))
    return { drop: `незавершённая партия у ${active.to} — сначала дождись возврата или закончи её учёт` };
  if (!cmd && pend?.length && env.cfg.mmCraftSend !== false && now - (env.rt.mmSendT || 0) >= UP_RETRY)
    return { kind: 'send', cmd: false, pendJob: true, to: active.to || to, items: pend, ret: {}, retDone: true, note: env.cfg.mmCraftNote !== false ? env.rt.mmCraft?.pendNote || null : null, why: `досылаю остаток партии: ${pend.slice(0, 6).map(x => `${x[2]} ${fmtA(x[1])}`).join(', ')}` };
  // у крафтера лежит отправленное > 48 ч и ничего не вернулось — пишем в журнал раз в сутки (вдруг он не получил)
  if (!cmd && Object.values(atC()).some(v => v > 0) && now - (env.rt.mmCraft?.gotT || env.rt.mmCraft?.t || now) > 48 * 3600000 && now - (env.rt.mmCraftWarnT || 0) > 86400000) {
    env.setRt({ mmCraftWarnT: now }); env.rec('B', 'Маммон', `${to}: отправленное лежит у крафтера больше 48 ч — проверь почту «Відправлені» или нажми «↺ Забыть, что у крафтера»`);
  }
  if (!cmd && (env.cfg.mmCraftSend === false || Object.values(atC()).some(v => v > 0) || now - (env.rt.mmSendT || 0) < UP_RETRY)) return null;   // одна партия за раз
  // 10.0 (аудит): сам — только когда уровень вещи виден (надета или кузнец показывал); иначе план от Lv.0 и лишнее сырьё уходит крафтеру
  const gid = +env.cfg.mmGoalItem;
  if (!cmd && !((env.rt.mmGear || []).some(x => x.id === gid) || Object.values(env.rt.mmEq || {}).some(x => x[0] === gid))) return null;
  if (env.invQty(0) == null) return null;         // сумка не свежая — сначала проверка (mmTick), команда подождёт
  const P = craftPlan();
  if (!P || P.done) return cmd ? { drop: 'вещь-цель уже на уровне цели' } : null;
  const items = (P.snd || []).filter(x => x.q > 0);
  // 10.0 (лог 12.10 17:30/17:38: кнопка сразу после отправки — «крафтить нечего») — пишем, что именно уже лежит у крафтера
  const atTxt = () => Object.entries(atC()).filter(([, n]) => n > 0).slice(0, 6).map(([mid, n]) => `${itNm(mid)} ${fmtA(n)}`).join(', ');
  if (!items.length) return cmd ? { drop: P.cmiss ? `в сумке нет сырья на крафт (не хватает ${short(P.raw.filter(r => r.miss > 0))})` : atTxt() ? `сырьё уже у крафтера ${to} (${atTxt()}) — жду готовое письмом` : 'крафтить нечего — крафтовое уже есть' } : null;
  if (!cmd && P.cmiss > 0) return null;           // сам — только полный набор, чтобы крафтер скрафтил всё сразу
  // 9.2.5 (игрок 12.10: «нужно не на все 5 уровней, а на все недостающие»): план и так считается от текущего уровня вещи (goalAll: L = lvl … to−1) —
  // в журнале пишем, на какие именно уровни
  // 10.0 (лог 12.10 17:27–17:37): пояс Lv.1 → 5 — Steel на Lv.3–4 оценён по Lv.0, а кузнец на Lv.3 попросил Durable Metal Plate → вторая партия
  const eL = P.lv.find(x => x.est || x.unk);
  const n = P.to - P.lvl, scope = n > 1 ? `${P.name} Lv.${P.lvl} → ${P.to} (недостающие ${n} ур.)` : `${P.name} Lv.${P.lvl} → ${P.lvl + 1}`;
  return { kind: 'send', cmd, to, items: items.map(x => [x.id, x.q, x.nm]), ret: P.ret, note: env.cfg.mmCraftNote !== false ? noteOf(P, `${P.name} Lv.${P.lvl} → ${P.to}`) : null,
    why: `${cmd ? 'по кнопке: ' : ''}сырьё на крафт для ${scope}: ${items.slice(0, 6).map(x => `${x.nm} ${fmtA(x.q)}`).join(', ')}${items.length > 6 ? ` и ещё ${items.length - 6}` : ''}${P.cmiss ? ' (набор неполный)' : ''}${eL ? ` · цены с Lv.${eL.L} → ${eL.L + 1} — оценка: кузнец показывает только следующий уровень, на дальних может понадобиться другой материал и ещё партия` : ''}` };
}
// вернулось от крафтера: id × q — то же, что отправили (не пригодилось), или скрафченное — списываем его сырьё по рецепту
function unsend(at, id, q, depth = 0) {
  if (!(q > 0) || depth > 6) return;
  if (at[id] > 0) { const u = Math.min(at[id], q); at[id] -= u; q -= u; }
  const R = MM_RECIPES[id]; if (!q || !R) return;
  const runs = Math.ceil(q / R[0]);
  for (const [iid, , n] of R[1]) unsend(at, iid, n * runs, depth + 1);
}
function mailList(list) {
  if (!Array.isArray(list)) return null;
  const unc = list.filter(a => a && a.attachmentId != null && a.claimedAt == null)
    .map(a => ({ a: String(a.attachmentId), s: String(a.senderName || ''), id: +a.itemId || 0, n: String(a.name || `#${a.itemId}`), q: +a.qty || 0 }));
  const patch = {}, C = env.rt.mmCraft, to = String(C?.to || crafter()).trim().toLowerCase();
  if (JSON.stringify(unc) !== JSON.stringify(env.rt.mmMail?.unc || [])) {
    const old = new Set((env.rt.mmMail?.unc || []).map(a => a.a)), fresh = unc.filter(a => !old.has(a.a));
    if (fresh.length) env.rec('B', 'Маммон', `почта: пришло ${fresh.map(a => `${a.n} ×${fmtA(a.q)} от ${a.s || '?'}`).join(', ')}`);
  }
  patch.mmMail = { t: Date.now(), unc };
  // учёт возврата: письма от крафтера после отправки, уже забранные в сумку (claimedAt) — кто бы ни нажал «Забрати», бот или игрок
  if (C?.at && to) {
    const seen = new Set(C.seen || []), at = { ...C.at }, got = [], odd = [], want = new Set();
    const tree = (id, d = 0) => { if (want.has(id) || d > 6) return; want.add(id); for (const [iid] of MM_RECIPES[id]?.[1] || []) tree(iid, d + 1); };
    for (const k of Object.keys(C.ret || {})) tree(+k);   // ждём готовое и его промежуточное
    for (const a of list) {
      if (!a || a.claimedAt == null || String(a.senderName || '').trim().toLowerCase() !== to) continue;
      const k = String(a.attachmentId), t = Date.parse(a.createdAt) || Date.now();
      if (seen.has(k) || t < (C.t0 || 0) - 60000) continue;
      const before = JSON.stringify(at), expected = !want.size || want.has(+a.itemId) || at[a.itemId] > 0;
      seen.add(k);
      // 10.0.13 (аудит 14.10): сначала проверяем возврат. Чужой рецепт мог списать общее сырьё (Steel Mold съедал Iron Ore
      // из партии на Durable Metal Plate), хотя следующая строка журнала обещала оставить всё сырьё у крафтера.
      if (expected) unsend(at, +a.itemId, +a.qty || 0);
      got.push(`${a.name || '#' + a.itemId} ×${fmtA(a.qty)}`);
      // 10.0.2 (лог 12.10 17:47: отправили сырьё на Durable Metal Plate, Skye вернул Steel Mold ×19 — рецепты бота совпадают с игрой,
      // /game/craft/materials): вернулось то, что из отправленного не делается, — «у крафтера» не списываем и пишем, чего ждали
      if (!expected || (!want.size && JSON.stringify(at) === before)) odd.push(`${a.name || itNm(a.itemId)} ×${fmtA(a.qty)}`);
    }
    if (got.length) {
      for (const k of Object.keys(at)) if (!(at[k] > 0)) delete at[k];
      const left = Object.keys(at).length;
      if (odd.length) env.rec('B', 'Маммон', `${C.to || crafter()} вернул не то, что нужно: ${odd.join(', ')} — из отправленного это не делается${C.want?.length ? `; ждём: ${C.want.map(([n, q]) => `${n} ×${fmtA(q)}`).join(', ')}` : ''}. Сырьё считаю ещё у крафтера — напиши ему или нажми «↺ Забыть, что у крафтера»`);
      env.rec('B', 'Маммон', `${C.to || crafter()} вернул: ${got.join(', ')}${left ? ` · у крафтера ещё ${Object.entries(at).map(([id, n]) => `${itNm(id)} ${fmtA(n)}`).join(', ')}` : ' · всё отправленное вернулось'}`);
      patch.mmCraft = left ? { ...C, at, seen: [...seen], gotT: Date.now() } : null;   // вся активная партия: повторный опрос страниц не списывает старые возвраты снова
      goalT = 0;
    }
  }
  env.setRt(patch);
  return unc;
}
async function mailPoll() {
  mailT = Date.now(); ssSet('l2bot-mmMailT', mailT);
  // 10.0.13: API возвращает историю вместе с уже забранными вещами; новые/ожидаемые вложения могут быть дальше первой страницы.
  const all = [];
  for (let pg = 1, total = 1; pg <= Math.min(total, 30); pg++) {
    const { ok, j } = await getJson(`/game/item-transfer/received?page=${pg}`);
    if (!ok || !Array.isArray(j?.attachments)) return null;
    all.push(...j.attachments); total = Math.max(1, +j.totalPages || 1);
    if (pg < Math.min(total, 30)) await env.sleep(350);
  }
  return mailList(all);
}
function mailSeen() { mailT = 0; ssSet('l2bot-mmMailT', 0); }   // игрок/бот забрал вложение — перечитать почту на следующем круге
// строки «Передачі предмета» (GET /game/item-transfer/candidates — по 20 на страницу): itemKey нужен, чтобы найти строку на странице
async function candFind(id) {
  for (let pg = 1, tp = 1; pg <= Math.min(tp, 30); pg++) {
    const { ok, status, j } = await getJson(`/game/item-transfer/candidates?category=all&page=${pg}&pageSize=20`);
    if (!ok) return { err: `список предметов не получен (HTTP ${status})` };
    tp = Math.max(1, +j?.totalPages || 1);
    const c = (Array.isArray(j?.candidates) ? j.candidates : []).find(x => +x.itemId === id && x.currencyKind !== 'adena' && !(+x.enchant > 0));
    if (c) return { key: String(c.itemKey), avail: +c.availableQty || 0, unit: +c.transferValueUnitAdena || 0, stack: !!c.stackable, page: pg };
    if (pg < tp) await env.sleep(350);             // 10.0 (аудит): до 30 страниц подряд — с паузой, иначе 429
  }
  return null;
}
const pgNow = () => { const active = document.querySelector('#item-transfer-pagination [aria-current="page"]'); if (active && /^\d+$/.test(active.textContent.trim())) return [+active.textContent.trim(), 0]; const m = (document.querySelector('#item-transfer-pagination .l2-item-transfer-page-label')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/); return m ? [+m[1], +m[2]] : null; };
async function pageGo(target) {                   // листать список «Передача предмета» прямо к странице target; ждём смену подписи, не таймаут
  for (let i = 0; i < 30; i++) {
    const p = pgNow(); if (!p) return false;
    if (p[0] === target) return true;
    // 10.0.13: общий игровой pager — номера и переходы между группами по пять.
    const compact = [...document.querySelectorAll('#item-transfer-pagination .l2-compact-pages__btn')];
    const bs = compact.length ? compact : [...document.querySelectorAll('#item-transfer-pagination .l2-item-transfer-page-btn')];
    const b = compact.length ? (bs.find(x => x.textContent.trim() === String(target)) || bs.find(x => x.textContent.trim() === (p[0] > target ? '<<' : '>>'))) : (p[0] > target ? bs[0] : bs[bs.length - 1]);
    if (!b || b.disabled || bs.length < 2) return false;
    env.fire(b);
    if (!await env.waitX(() => { const q = pgNow(); return q && q[0] !== p[0] ? q : null; }, 4000, 100)) return false;
  }
  return false;
}
const setVal = (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
const shownTxt = el => el && !el.hidden ? (el.textContent || '').trim() : '';
// 10.0.2: письмо крафтеру после партии — что скрафтить и что вернуть (/mail-compose.html: «Кому», «Повідомлення» до 1000 знаков,
// POST /game/mail/send {text, recipientName}). Язык — украинский, как интерфейс игры у клана
function noteOf(P, goal) {
  const nm = itNm;
  return { goal, part: (P.cmiss || 0) > 0, craft: (P.craft || []).filter(c => c.qty > 0).map(c => [c.nm, c.qty]),
    ret: Object.entries(P.ret || {}).filter(([, q]) => q > 0).map(([id, q]) => [nm(id), q]) };
}
function noteText(N, sent, me) {         // → письма по ≤ NOTE_MAX знаков (длинное делится по строкам, строка — по пунктам)
  const ls = l => l.map(([n, q]) => `${n} ×${fmtA(q)}`);
  const same = JSON.stringify(N.craft) === JSON.stringify(N.ret);
  const parts = [[`Привіт! Надіслав ресурси на крафт${N.goal ? ` (${N.goal})` : ''}:`, ls(sent)]];
  if (N.craft.length) parts.push([same ? 'Скрафти, будь ласка, і поверни поштою' + (me ? ` на ${me}` : '') + ':' : 'Скрафти, будь ласка:', ls(N.craft)]);
  if (N.ret.length && !same) parts.push([`Поверни поштою${me ? ` на ${me}` : ''}:`, ls(N.ret)]);
  const tail = [N.part ? 'Частину сировини ще збираю — дошлю пізніше.' : '', 'Дякую!'].filter(Boolean);
  const out = []; let cur = '';
  const put = t => { if (cur && cur.length + 1 + t.length > NOTE_MAX) { out.push(cur); cur = ''; } cur = cur ? cur + '\n' + t : t; };
  for (const [h, l] of parts) {
    const line = `${h} ${l.join(', ')}.`;
    if (line.length <= NOTE_MAX) { put(line); continue; }
    let acc = h;
    for (const x of l) { if (acc.length + 2 + x.length > NOTE_MAX) { put(acc); acc = h; } acc += (acc === h ? ' ' : ', ') + x; }
    put(acc + '.');
  }
  for (const t of tail) put(t);
  if (cur) out.push(cur);
  return out;
}
async function noteStep(J) {
  const to = J.to || crafter();
  const left = J.notes || noteText(J.note, [...(J.note.prev || []), ...(J.done || []).map(x => [x[0], x[1]])], String(env.heroNick?.() || '').trim());
  const end = why => env.setRt({ mmJob: { ...J, notes: null, noteCur: null, noteEnd: why } });   // итог — в строку «отправил …» (finish)
  if (!left.length) return end('письмо с заданием отправил');
  // прошлое нажатие «Надіслати» без ответа (страница перезагрузилась) — считаем ушедшим: лучше без одного письма, чем два одинаковых
  if (J.noteCur) { await env.setRt({ mmJob: { ...J, notes: left.slice(1), noteCur: null } }); return; }
  if (location.pathname !== PAGE_MC) { await env.setRt({ mmJob: { ...J, notes: left } }); env.setStatus(`Почта: письмо крафтеру ${to}`); location.href = PAGE_MC; await env.sleep(4000); return; }
  const form = await env.waitX(() => document.getElementById('mail-compose-form') || null, 10000, 200);
  if (!form) return end('страница письма не открылась — письмо не ушло');
  if (form.hidden) { location.href = PAGE_MC; await env.sleep(4000); return; }      // после «надіслано» форма скрыта — следующее письмо с новой страницы
  const toIn = document.getElementById('mail-compose-to'), tx = document.getElementById('mail-compose-text'), btn = document.getElementById('mail-compose-submit');
  if (!toIn || !tx || !btn) return end('форма письма не найдена — письмо не ушло');
  if (!toIn.readOnly) setVal(toIn, to);
  setVal(tx, left[0]);
  for (const eid of ['mail-compose-success', 'mail-compose-err']) { const el = document.getElementById(eid); if (el) { el.textContent = ''; el.hidden = true; } }
  await env.setRt({ mmJob: { ...J, notes: left, noteCur: Date.now() } });
  env.setStatus(`Почта: письмо крафтеру ${to}`);
  env.fire(btn);
  const res = await env.waitX(() => shownTxt(document.getElementById('mail-compose-success')) ? 'ok' : shownTxt(document.getElementById('mail-compose-err')) ? 'err' : null, 10000, 200);
  if (res === 'ok') { env.rec('B', 'Маммон', `письмо крафтеру ${to}: ${left[0].replace(/\s+/g, ' ').slice(0, 160)}`); await env.setRt({ mmJob: { ...J, notes: left.slice(1), noteCur: null } }); return; }
  if (res === 'err') return end(`письмо не ушло (${shownTxt(document.getElementById('mail-compose-err')).slice(0, 80)})`);
  // ответа нет — следующий круг считает письмо ушедшим (noteCur)
}
async function sentOk(J, cur) {
  if (J.hand) { await env.setRt({ mmJob: { ...J, cur: null, items: J.items.slice(1), done: [...(J.done || []), [cur.nm, cur.q, cur.fee || 0]] } }); env.rec('B', 'саб', `основному ${J.to}: отправил ${cur.nm} ×${fmtA(cur.q)}${cur.fee ? ` (комиссия ${fmtA(cur.fee)} адены)` : ''}`); return; }   // 10.0.7
  const C = env.rt.mmCraft || {}, at = { ...(C.at || {}) };
  at[cur.id] = (at[cur.id] || 0) + cur.q;
  const ret = { ...(C.ret || {}) }; for (const [k, n] of Object.entries(J.ret || {})) if (!J.retDone) ret[k] = (ret[k] || 0) + n;
  const done = [...(J.done || []), [cur.nm, cur.q, cur.fee || 0]];
  const want = J.note?.ret?.length ? J.note.ret : Object.entries(ret).map(([k, n]) => [itNm(k), n]);
  await env.setRt({ mmCraft: { to: J.to, t0: C.t0 || Date.now(), t: Date.now(), at, ret, want, seen: C.seen || [] }, mmJob: { ...J, cur: null, retDone: true, items: J.items.slice(1), done } });
  env.rec('B', 'Маммон', `крафтеру ${J.to}: отправил ${cur.nm} ×${fmtA(cur.q)}${cur.fee ? ` (комиссия ${fmtA(cur.fee)} адены)` : ''}`);
}
async function sendStep(J) {
  const to = J.to || crafter();
  const allowed = () => J.cmd || J.hand || env.cfg.mmCraftSend !== false;
  if (!allowed() && !J.cur) return finish({ ...J, cancelled: true }, false, 'автоотправка крафтеру выключена');
  // 10.0.2 (игрок 12.10: «приписывать последним письмом … какие ресурсы нам нужны на крафт и сколько, чтобы игрок знал что делать и что возвращать»)
  if (!J.items?.length && !J.cur && (J.done || []).length && J.note && !J.noteEnd) return noteStep(J);
  if (location.pathname !== PAGE_TR && (J.items?.length || J.cur)) { env.setStatus(`Почта: отправляю сырьё крафтеру ${to}`); location.href = PAGE_TR; await env.sleep(4000); return; }
  // прошлое нажатие без ответа (страница перезагрузилась, письмо могло уйти) — правда у сервера: сумка уменьшилась → ушло, иначе шлём снова
  if (J.cur) {
    const m = await env.invRefresh?.(), h = m ? m[J.cur.id] || 0 : null;
    if (h == null) return finish(J, false, `сумка не прочиталась — не знаю, ушло ли ${J.cur.nm} ×${J.cur.q}; проверь почту «Відправлені»`);
    if (h <= J.cur.before - J.cur.q) return sentOk(J, J.cur);
    J = { ...J, cur: null }; await env.setRt({ mmJob: J });
  }
  if (!J.items?.length) {
    const d = J.done || [], fee = d.reduce((a, x) => a + (x[2] || 0), 0);
    return finish(J, d.length > 0, d.length ? `отправил ${to}: ${d.map(x => `${x[0]} ${fmtA(x[1])}`).join(', ')}${fee ? ` · комиссия ${fmtA(fee)} адены` : ''}${J.noteEnd ? ` · ${J.noteEnd}` : ''}${J.hand ? ' — пусть заберёт в «Пошта → Предмети»' : ' — жду готовое письмом'}` : 'отправлять нечего');
  }
  const [id, want, nm] = J.items[0];
  const m = J.inv ? null : await env.invRefresh?.();    // сумка по факту — один раз на поход
  if (m) J = { ...J, inv: 1 };
  const have = env.invQty(id), q = Math.min(want, have ?? 0);
  if (!(q > 0)) { env.rec('B', 'Маммон', `крафтеру: ${nm} в сумке нет — пропускаю`); await env.setRt({ mmJob: { ...J, items: J.items.slice(1) } }); return; }
  const c = await candFind(id);
  if (!c || c.err) return finish(J, false, c?.err || `${nm}: нет в списке «Передача предмета»`);
  const n = c.stack ? Math.min(q, c.avail || q) : 1;
  const rowOf = () => [...document.querySelectorAll('.l2-item-transfer-row-wrap')].find(w => w.dataset.itemKey === c.key) || null;
  await env.waitX(() => document.querySelector('.l2-item-transfer-row-wrap') || null, 10000, 200);
  // строка на другой странице: после передачи игра остаётся на той же странице списка — сначала «« Назад» до первой, затем «Вперед »»
  // 10.0 (лог 12.10 17:28–17:38): листали «« Назад» до первой страницы и потом вперёд, ожидая строку 3 с на каждой — Thread со стр. 6
  // после Iron Ore со стр. 5: 9 страниц ≈ 34 с. Номер страницы строки уже известен (candFind) → листаем прямо к ней по подписи «Страница N / M»
  let wrap = rowOf();
  if (!wrap && c.page) { await pageGo(c.page); wrap = await env.waitX(rowOf, 1500, 100); }
  // запасной путь (подписи нет, список сдвинулся): «« Назад» до первой, затем «Вперед »»
  for (const dir of [0, 1]) for (let i = 0; !wrap && i < 30; i++) {
    const bs = [...document.querySelectorAll('#item-transfer-pagination .l2-item-transfer-page-btn')], nx = dir ? bs[bs.length - 1] : bs[0];
    if (!nx || nx.disabled || bs.length < 2) break;
    env.fire(nx); await env.sleep(700); wrap = await env.waitX(rowOf, 3000, 200);
  }
  if (!wrap) return finish(J, false, `${nm}: строки на странице передачи нет`);
  if (!wrap.querySelector('form')) { env.fire(wrap.querySelector('.l2-item-transfer-row')); }
  const form = await env.waitX(() => wrap.querySelector('form.l2-item-transfer-form') || null, 4000, 100);
  const qIn = form?.querySelector('input[type="number"]'), nIn = form?.querySelector('input[type="text"]'), btn = form?.querySelector('button[type="submit"]');
  if (!nIn || !btn || (c.stack && !qIn)) return finish(J, false, `${nm}: форма передачи не открылась`);
  if (qIn) setVal(qIn, n);
  setVal(nIn, to);
  const fee = c.unit * n > 0 ? Math.max(1, Math.ceil(c.unit * n * 5 / 100)) : 0, cur = { id, q: n, nm, fee, before: have, t: Date.now() };
  await env.setRt({ mmJob: { ...J, cur } });
  if (!allowed()) return finish({ ...J, cur: null, cancelled: true }, false, 'автоотправка крафтеру выключена');
  env.setStatus(`Почта: ${nm} ×${fmtA(n)} → ${to}`);
  env.fire(btn);
  const modal = await env.waitX(() => { const md = document.getElementById('item-transfer-confirm-modal'); return md && !md.hidden ? md : null; }, 5000, 100);
  if (!modal) { await env.setRt({ mmJob: { ...J, cur: null } }); return finish(J, false, `${nm}: ${shownTxt(document.getElementById('item-transfer-err')) || 'окно подтверждения не открылось'}`); }
  // окно игры: «Надіслати «предмет» гравцю «ник»?», «Кількість: N» — жмём «Підтвердити» только если там наш крафтер и наше количество
  const body = (modal.querySelector('#item-transfer-confirm-body')?.textContent || ''), nums = (body.match(/\d[\d\s ]*/g) || []).map(x => +x.replace(/\D/g, ''));
  const okBtn = modal.querySelector('.l2-item-transfer-confirm-actions .l2-item-transfer-form__btn:not(.l2-item-transfer-form__btn--ghost)');
  if (!body.includes(`«${to}»`) || (c.stack && !nums.includes(n)) || !okBtn) {
    env.fire(modal.querySelector('.l2-item-transfer-form__btn--ghost')); await env.setRt({ mmJob: { ...J, cur: null } });
    return finish(J, false, `${nm}: в окне подтверждения не тот получатель или количество (${body.replace(/\s+/g, ' ').slice(0, 80)}) — отменил`);
  }
  if (!allowed()) { env.fire(modal.querySelector('.l2-item-transfer-form__btn--ghost')); return finish({ ...J, cur: null, cancelled: true }, false, 'автоотправка крафтеру выключена'); }
  // 10.0 (аудит): старое «успешно» от прошлого предмета не должно засчитать этот — очищаем сообщения перед нажатием
  for (const eid of ['item-transfer-success', 'item-transfer-err']) { const el = document.getElementById(eid); if (el) el.textContent = ''; }
  env.fire(okBtn);
  const res = await env.waitX(() => shownTxt(document.getElementById('item-transfer-success')) ? 'ok' : shownTxt(document.getElementById('item-transfer-err')) ? 'err' : null, 10000, 200);
  if (res === 'ok') return sentOk({ ...J, cur: null }, cur);
  if (res === 'err') { await env.setRt({ mmJob: { ...J, cur: null } }); return finish(J, false, `${nm}: ${shownTxt(document.getElementById('item-transfer-err')).slice(0, 100)}`); }
  // ответа нет — следующий круг проверит сумку (J.cur): ушло или нет
}
async function claimStep(J) {
  if (location.pathname !== PAGE_MAIL) { env.setStatus('Почта: забираю предметы'); location.href = PAGE_MAIL; await env.sleep(4000); return; }
  const tab = await env.waitX(() => document.querySelector('#mail-tabs [data-mail-tab="items"]') || null, 8000, 200);
  if (!tab) return finish(J, false, 'вкладки «Предмети» в почте нет');
  if (!tab.classList.contains('is-active')) { env.fire(tab); await env.sleep(800); }
  const pane = '#mail-tab-items';
  // 10.0.14: игрок мог оставить почту на странице истории. Начинаем с первой, затем продолжаем вперёд по сохранённому заданию.
  if (!J.mailStarted) {
    const label = () => document.querySelector(`${pane} .l2-mail-page-label`)?.textContent || '', before = label();
    const prev = [...document.querySelectorAll(`${pane} .l2-mail-page-btn`)][0];
    if (+before.match(/^\s*(\d+)/)?.[1] > 1 && prev && !prev.disabled) {
      env.fire(prev);
      if (!await env.waitX(() => label() !== before, 4000, 100)) return finish(J, false, 'первая страница почты не открылась');
      return;
    }
    J = { ...J, mailStarted: true }; await env.setRt({ mmJob: J });
  }
  const b = await env.waitX(() => document.querySelector(`${pane} .l2-mail-item__claim:not([disabled])`) || (document.querySelector(`${pane} .l2-mail-item, ${pane} .l2-mail-empty, ${pane} .err`) ? 'none' : null), 8000, 200);
  const got = J.got || [];
  if (b === 'none' && got.length < CLAIM_MAX) {
    const label = () => document.querySelector(`${pane} .l2-mail-page-label`)?.textContent || '';
    const pages = [...document.querySelectorAll(`${pane} .l2-mail-page-btn`)], next = pages[pages.length - 1], before = label();
    if (pages.length >= 2 && next && !next.disabled) {
      env.fire(next);
      if (await env.waitX(() => label() !== before, 4000, 100)) return;
      await mailPoll(); return finish(J, false, 'следующая страница почты не открылась');
    }
  }
  if (!b || b === 'none' || got.length >= CLAIM_MAX) { await mailPoll(); return finish(J, true, got.length ? `забрал: ${got.join(', ')}` : 'забирать нечего'); }
  // 10.0 (лог 12.10 17:37 «✓ забрал: ? от Skye»): игра красит имя предмета (L2.decorateItemNameEl) и заменяет его класс
  // .l2-mail-item-transfer__name на l2-item-name → имя и число берём из списка почты по attachmentId, иначе из строки «Ви отримали»
  const card = b.closest('.l2-mail-item'), aid = String(card?.dataset?.attachmentId ?? ''), a = aid ? (env.rt.mmMail?.unc || []).find(x => x.a === aid) : null;
  const what = a ? `${a.n} ×${fmtA(a.q)}` : (card?.querySelector('.l2-mail-item-transfer__loot')?.textContent || card?.querySelector('.l2-mail-item-transfer__name')?.textContent || '?').trim();
  const from = (a?.s || card?.querySelector('.l2-mail-item__sender')?.textContent || '').trim();
  const msgEl = () => document.querySelector(`${pane} .l2-mail-items-msg`);
  if (msgEl()) msgEl().textContent = '';
  env.fire(b);
  const msg = await env.waitX(() => shownTxt(msgEl()) || null, 6000, 200);
  if (/переповн|переполн/i.test(msg || '')) { await mailPoll(); return finish(J, false, `инвентарь переполнен — ${what} от ${from} осталось в почте`); }
  // 10.0.13: ошибка ревизии/сети — не успешное получение. Без сообщения перепроверяем вложение по полному списку сервера.
  let ok = /предмет\s+(?:у\s+сумці|в\s+сумке|в\s+инвентаре)|item.*(?:bag|inventory)/i.test(msg || '');
  if (!ok && !msg && aid) { const left = await mailPoll(); ok = !!left && !left.some(a => a.a === aid); }
  if (!ok) return finish(J, false, `не забрал ${what}: ${String(msg || 'нет подтверждения игры').slice(0, 80)}`);
  await env.setRt({ mmJob: { ...J, got: [...got, `${what}${from ? ' от ' + from : ''}`] } });
  await env.sleep(600);
}
// 9.0: шаг в главном цикле. true — занят Маммоном (цикл идёт на следующий круг)
async function mmStep() {
  const J = env.rt.mmJob;
  if (J) {
    if (env.isBattle()) return false;
    const mx = J.kind === 'send' ? SEND_MAX : JOB_MAX;
    if (Date.now() - (J.t || 0) > mx) { await finish(J, false, `не уложился в ${mx / 60000} мин`); return true; }
    if (J.kind === 'send') { await sendStep(J); return true; }
    if (J.kind === 'claim') { await claimStep(J); return true; }
    if (J.step === 'go') {
      if (await isNear(J.kind)) await env.setRt({ mmJob: { ...J, step: 'act' } });
      else await teleport(J);
      return true;
    }
    if (J.visit) await visit(J); else if (J.kind === 'order') await claim(J); else await smith(J);
    return true;
  }
  if (env.cfg.mmGoalItem && Date.now() - goalT > 30000) { goalT = Date.now(); await gearDb(); env.itemsDb?.().catch?.(() => {}); goalNote(); }
  const g = goReq();
  const cw = craftWant();
  if (cw?.drop) { env.rec('B', 'Маммон', `кнопка «отправить крафтеру сейчас»: ${cw.drop}`); await env.setRt({ mmCraftReq: null, mmCraftSay: { t: Date.now(), why: cw.drop } }); return false; }
  const hw = env.handWant?.();
  if (hw?.drop) { env.rec('B', 'саб', `кнопка «передать основному сейчас»: ${hw.drop}`); await env.setRt({ subHandReq: null, subHandSay: { t: Date.now(), why: hw.drop } }); return false; }
  if (g?.drop) { env.rec('B', 'Маммон', `кнопка «${env.rt.mmGoReq.kind === 'order' ? 'сдать заказ' : env.rt.mmGoReq.kind === 'visit' ? `прийти к ${NPC_NAME[env.rt.mmGoReq.npc] || 'торговцу'}` : 'улучшить'} сейчас»: ${g.drop} — не лечу`); await env.setRt({ mmGoReq: null, mmGoSay: { t: Date.now(), why: g.drop } }); return false; }
  const w = want();
  if (!w) return false;
  if (!modeFree()) { if (w.cmd) env.setStatus('Маммон: по кнопке полечу, как только закончу бой/тур/поход'); return false; }
  // точка возврата: зона охоты (рыбалка, катакомбы и туры возвращаются сами)
  // почта и передача предметов — без телепорта, со своей страницы игры (после — на карту, точка та же)
  const mail = w.kind === 'send' || w.kind === 'claim';
  // 10.0 (лог 12.10 12:00:05–12:00:13): перелёт в новую зону ещё в пути (zonePend, 2 мин) — возвращаемся туда, а не в старую rt.zone
  const zp = env.rt.zonePend && Date.now() - (env.rt.zonePend.t || 0) < 120000 ? env.rt.zonePend.id : null;
  const home = !mail && !w.visit && !env.fishNow() && env.autonomyMode() !== 'cat' ? zp || env.rt.zone || null : null;   // 10.0.9: визит кончается паузой — домой не летим
  await env.setRt({ mmJob: { ...w, step: mail ? 'act' : 'go', home, t: Date.now() }, ...(w.cmd ? (w.hand ? { subHandReq: null, subHandSay: null } : w.kind === 'send' ? { mmCraftReq: null, mmCraftSay: null } : { mmGoReq: null, mmGoSay: null }) : {}), ...(w.id ? { mmTried: { ...Object.fromEntries(Object.entries(env.rt.mmTried || {}).filter(([, t]) => Date.now() - t < 86400000)), [w.id]: Date.now() } } : {}) });
  env.rec('B', 'Маммон', mail ? `${w.kind === 'send' ? `отправляю крафтеру ${w.to}` : 'забираю почту'}: ${w.why}` : `иду к ${NPC_NAME[w.kind]}: ${w.why}`);
  return true;
}
// 10.0 (лог 12.10 12:01:20 «новый заказ … до 14:00» — сдан только в 12:20, когда игрок сам открыл карту): цепочка «Охотиться дальше» не уходит
// со страницы боя, а mmStep работает только вне боя. После победы: есть дело у Маммона/почты — разово на карту, дальше mmStep
function chainWant() { const g = goReq(); if (g?.drop) return null; const w = want(); return w && modeFree(true) ? w : null; }
return { farmPlanPt, spoilOn, mmShopWant, MM_SHOP, shopNote, chainWant, noteOf, noteText, noteStep, mailNote, mailSeen, goReq, craftWant, craftPlan, mailPoll, mailList, unsend, sendStep, claimStep, candFind, pageGo, upgrade, upItem, upMiss, MM_KNOWN, MM_CRAFT, MM_RECIPES, levelCost, goalAll, gearDb, orderNote, orderPoll, npcPoll, mmTick, eqNote, smithNote, costOf, gearLvl, goalPlan, mmFarmGoal, goalNote, modeFree, want, isNear, finish, teleport, visit, claim, smith, mmStep };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
