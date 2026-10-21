/* L2wap v7: isolated navigation feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.navigation = function create_navigation(env) {
const location = env.routeLocation || root.location;
const isMap = () => /\/map\.html/i.test(location.pathname);

// 8.0.3 (эпики, ревью): валюта цены телепорта (.l2-teleport-miru-price-currency, «аден»). Раньше читалось только число — логово за
// Coin of Luck оплатилось бы мимо лимита. curT — подпись как есть (нет элемента — undefined: старая разметка/каталог), cur — как epics.unitOf
const curOf = row => { const el = row?.querySelector?.('.l2-teleport-miru-price-currency'); if (!el) return {};
  const t = [el.textContent, ...[...(el.querySelectorAll?.('img, [title]') || [])].map(i => [i.getAttribute('alt'), i.getAttribute('title')].join(' '))].join(' ').replace(/\s+/g, ' ').trim();
  const src = [...(el.querySelectorAll?.('img') || [])].map(i => i.getAttribute('src') || '').join(' ');
  return { cur: /coin|luck|монет|удач|\bcol\b/i.test(t) || /(^|\D)4037(\D|$)|luck/i.test(src) ? 'Coin of Luck' : /аден|adena/i.test(t) ? 'аден' : '', curT: t.slice(0, 20) }; };
function zoneRows() {                             // видимые строки «Окрестности» на странице телепорта
  const cat = {};
  for (const r of document.querySelectorAll('.l2-teleport-miru-surroundings-row')) {
    const b = r.querySelector('[data-teleport-id]'); if (!b) continue;
    const lv = (r.querySelector('.l2-teleport-miru-mob-level')?.textContent || '').match(/(\d+)\s*[-–]\s*(\d+)/);
    cat[b.dataset.teleportId] = {
      name: (r.querySelector('.l2-teleport-miru-surroundings-label > span')?.textContent || b.dataset.teleportId).trim(),
      city: r.closest('[data-surroundings-key]')?.dataset.surroundingsKey || '',
      price: +((r.querySelector('.l2-teleport-miru-price-num')?.textContent || '').replace(/\D/g, '') || 0), ...curOf(r),
      lo: lv ? +lv[1] : 0, hi: lv ? +lv[2] : 0,
    };
  }
  return cat;
}

const isTeleport = () => /\/teleport\.html/i.test(location.pathname);
// Неизвестная цена/валюта не доказывает бесплатный переход: значок CoL часто идёт без числа.
function teleportCost(row) {
  const cur = curOf(row), raw = row?.querySelector?.('.l2-teleport-miru-price-num')?.textContent?.trim();
  const txt = (row?.textContent || '').replace(/\s+/g, ' ');
  const free = /бесплат|безкоштов|\bfree\b/i.test(txt);
  const price = raw != null && /^\s*[\d\s.,]+\s*$/.test(raw) ? Number(raw.replace(/\D/g, '')) : free ? 0 : null;
  return { price, cur: cur.cur, why: price == null ? 'цена не прочитана' : cur.cur === 'Coin of Luck' ? 'Coin of Luck бот не тратит'
    : price > 0 && cur.cur !== 'аден' ? 'валюта не подтверждена как адена' : price === 0 && !free && cur.cur !== 'аден' ? 'бесплатный переход не подтверждён' : '' };
}
function forumTeleportCost(button) {
  const base = button?.dataset?.baseAdenaCost, current = button?.dataset?.adenaCost, label = button?.textContent || '';
  if (!/^\d+$/.test(base || '') || !/^\d+$/.test(current || '')) return { price: null, why: 'цена телепорта с форума не подтверждена' };
  const price = Math.max(Number(base), Number(current));
  if (!Number.isSafeInteger(price)) return { price: null, why: 'цена телепорта с форума неверна' };
  if (/coin|luck|монет|удач|\bcol\b/i.test(label)) return { price, why: 'Coin of Luck бот не тратит' };
  if (price > 0 && !/аден|adena|безкоштов|бесплат|\bfree\b/i.test(label)) return { price, why: 'валюта телепорта с форума не подтверждена' };
  if (price === 0 && !/безкоштов|бесплат|\bfree\b|аден|adena/i.test(label)) return { price, why: 'бесплатный переход с форума не подтверждён' };
  return { price, why: '' };
}
async function teleportBudget(price, active, snapshot) {
  if (price === 0) return '';
  if (typeof env.gameGet !== 'function') return 'нет свежего запаса адены';
  let wallet;
  try {
    const response = snapshot ? null : await env.gameGet('/character'), ch = snapshot || (response.ok ? (await response.json())?.character : null);
    if (!active()) return 'задание отменено';
    const adena = typeof ch?.adena === 'string' && /^\d+$/.test(ch.adena) ? Number(ch.adena) : ch?.adena;
    if (!ch || ch.name !== env.rt.char || !Number.isSafeInteger(adena) || adena < 0) return 'запас адены не подтверждён';
    wallet = { v: adena, t: Date.now() }; await env.setRt({ adenaSeen: wallet });
  } catch (_) { return 'не удалось прочитать запас адены'; }
  if (!active()) return 'задание отменено';
  const reserve = Math.max(0, +env.cfg.shopReserve || 0), cap = +env.cfg.shopMaxSpend || 0;
  if (cap > 0 && price > cap) return `цена ${price} выше лимита ${cap}`;
  if (!Number.isSafeInteger(wallet.v) || wallet.v - price < reserve) return `на телепорт ${price} не хватает адены сверх резерва ${reserve}`;
  return '';
}

async function tpCitiesReady(active = () => true) {
  const cities = () => document.querySelectorAll('.l2-teleport-miru-city-btn[data-surroundings-key]').length;
  let n0 = -1, stable = 0;
  for (let t0 = Date.now(); active() && Date.now() - t0 < 12000 && stable < 3; ) { const n = cities(); stable = n && n === n0 ? stable + 1 : 0; n0 = n; await env.sleep(250); }
  return cities();
}

async function zoneCatalogScan() {                // раскрыть все города и переписать их Окрестности (бесплатно)
  // v4.57: журнал 07:27 — скан занял 50 мс и нашёл 1 зону: список городов ещё дорисовывался скриптом страницы,
  // а Окрестности города подгружаются только по нажатию (и могут очищаться, когда раскрыт другой город).
  // Теперь: ждём, пока список городов перестанет меняться; раскрываем каждый город и читаем его зоны сразу.
  const active = () => env.on && env.tabOwner !== false && env.canAct?.() !== false;
  if (!active()) return;
  env.setStatus('Локации: составляю список зон телепорта');
  const cities = () => [...document.querySelectorAll('.l2-teleport-miru-city-btn[data-surroundings-key]')];
  await tpCitiesReady(active);
  if (!active()) return;
  const cat = { ...(env.rt.zoneCat || {}) };
  let opened = 0;
  for (const b of cities()) {
    if (!active()) return;
    const key = b.dataset.surroundingsKey;
    const blk = b.closest('.l2-teleport-miru-city-block') || document.querySelector(`.l2-teleport-miru-city-block[data-surroundings-key="${key}"]`);
    const sur = () => blk?.querySelector('.l2-teleport-miru-surroundings');
    const rows = () => blk?.querySelectorAll('.l2-teleport-miru-surroundings-row [data-teleport-id]').length || 0;
    if (!rows() || sur()?.hidden) { env.fire(b); opened++; await env.waitX(() => !active() || rows() > 0 && !sur()?.hidden, 4000, 100); }
    if (!active()) return;
    Object.assign(cat, zoneRows());               // читаем после каждого города: раскрытие другого может их скрыть
    // v5.1: и сам город — тоже цель телепорта («Town of Giran», «Rune Township» — так их называет форум рецептов)
    const cr = blk?.querySelector('.l2-teleport-miru-city-row'), ctb = cr?.querySelector('.l2-teleport-miru-tp-btn[data-teleport-id]');
    const cl = (cr?.querySelector('.l2-teleport-miru-city-label')?.textContent || '').trim();
    if (ctb && cl) cat[ctb.dataset.teleportId] = { ...(cat[ctb.dataset.teleportId] || {}), name: cl, city: key, town: true, price: +((cr.querySelector('.l2-teleport-miru-price-num')?.textContent || '').replace(/\D/g, '') || 0), ...curOf(cr) };
    await env.sleep(env.rnd(120, 250));
  }
  if (!active()) return;
  const withLv = Object.values(cat).filter(c => c.lo && c.city).length;
  // мало зон — каталог неполный: не ставим отметку «прочитан», чтобы бот перечитал «Телепорт» позже
  await env.setRt({ zoneCat: cat, zoneCatT: withLv >= 5 ? Date.now() : 0, zoneScan: null, zoneCatFail: withLv >= 5 ? 0 : (env.rt.zoneCatFail || 0) + 1, zoneCatFailT: Date.now() });
  env.rec('B', 'локации', `зон в каталоге: ${Object.keys(cat).length} (с уровнями ${withLv}) · городов ${cities().length}, раскрыл ${opened}${withLv < 5 ? ' ⚠ мало — перечитаю позже' : ''}`);
}

// 8.0.3 (лог 11.10 10:32:55): после телепорта тура к Фальстону (66, у Годдарда; мобы 75–80) зона стала «Pavel Ruins» — в её списке
// были 2 общих имени (Spiked Stakato Shaman/Captain: дальние страницы списка Pavel Ruins), а хватало одного. 104 боя цепочки записались
// как «Pavel Ruins 56 ур. — 15,8 M EXP/ч» (настоящий Pavel Ruins — мобы 46–54, 2,2–3,9 M), автофарм полетел бы туда. Теперь зона — только
// по ближней (1-й) странице списка (он по расстоянию, дальние — соседние локации): своя — ≥3 общих имени (или все, если имён меньше) и
// уровни страницы в полосе зоны ±5 (уровни её мобов из кэша спавнов, иначе каталог «Телепорта»); чужая — ещё и не меньше половины имён
// страницы. Иначе — «Окрестности: …» (out:). Полоса уровней out-зоны — тоже только с ближней страницы
const ZONE_LV_PAD = 5;
const lvMid = xs => { const a = xs.filter(v => v > 0).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 0; };
function zoneHere() {                             // на карте: подтверждаем зону и запоминаем её мобов
  const items = env.pageItems().filter(i => !i.champ && !env.isRaidId(i.id));
  const names = [...new Set(items.map(i => i.name))];
  if (!names.length) return;
  const mobs = { ...(env.rt.zoneMobs || {}) };
  // 14.10: номера «1 2 3 4 5 >>» не содержат '/'. Дальние страницы берём из общего parser, не считаем их первой.
  const page = env.pagerInfo?.()?.cur ?? +(String(env.$q?.('#map-mob-page-ind')?.textContent || '').match(/(\d+)\s*\//)?.[1] || 0);
  const near = page === 1;
  const mid = lvMid(items.map(i => i.lvl));
  let lvOf = null;
  // 8.0.3 (ревью): полоса — не мин…макс всех спавнов (одно чужое имя 78–80 в списке Pavel Ruins растягивало её до [46,80] и пропускало
  // страницу Фальстона), а уровень каждого имени (медиана его спавнов) и сплошной кусок вокруг медианы зоны: разрыв > 2×ZONE_LV_PAD — чужие
  const band = z => {                              // [мин, макс] уровней мобов зоны или null (не знаем — не мешаем)
    if (!lvOf) { lvOf = {}; for (const v of Object.values(env.rt.spawns || {})) if (v && v[1]) (lvOf[v[0]] = lvOf[v[0]] || []).push(v[1]); }
    const ls = (mobs[z] || []).map(n => lvMid(lvOf[n] || [])).filter(v => v > 0).sort((p, q) => p - q);
    if (ls.length >= 3) {
      let a = ls.length >> 1, b = a;
      while (a > 0 && ls[a] - ls[a - 1] <= 2 * ZONE_LV_PAD) a--;
      while (b < ls.length - 1 && ls[b + 1] - ls[b] <= 2 * ZONE_LV_PAD) b++;
      return [ls[a], ls[b]];
    }
    const c = env.rt.zoneCat?.[z]; return c?.lo ? [c.lo, c.hi || c.lo] : null;
  };
  const fits = z => { const b = band(z); return !b || !mid || (mid >= b[0] - ZONE_LV_PAD && mid <= b[1] + ZONE_LV_PAD); };
  const ov = z => (mobs[z] || []).filter(n => names.includes(n)).length;
  const sure = z => ov(z) >= Math.min(3, names.length) && fits(z);
  const pend = !!env.rt.zonePend && Date.now() - env.rt.zonePend.t < 120000;
  let id = env.rt.zone || null;
  if (pend) id = env.rt.zonePend.id;
  else if (!near) { if (!id) return; }           // дальняя страница — зону не определяем (имена в полосе уровней — в список текущей)
  else if (!id || ((mobs[id] || []).length >= 3 && !sure(id))) {     // мобы не те — ищем зону с такими мобами
    const best = Object.keys(mobs).filter(z => sure(z) && ov(z) * 2 >= names.length).map(z => [z, ov(z)]).sort((a, b) => b[1] - a[1])[0];
    id = best ? best[0] : 'out:' + names.slice(0, 2).join(' / ');
  }
  // 8.0 (аудит фарма C5): в Pavel Ruins уже 31 имя (память 10.10 22:40); на больших локациях сверх 40 хвост списка выпадал бы
  // из «мобов зоны», и ★ цели / мобы из правил оттуда считались бы «не на этой локации». Храним до 80 имён
  // 8.0.3 (ревью): с дальней страницы (соседние локации) — только имена с уровнем в полосе текущей зоны ±5: раньше так в список
  // Pavel Ruins возвращались Spiked Stakato/Tomb (75–80) и после разовой чистки pavelZone803
  let add = names;
  if (!near && !pend) {
    const b = band(id), lvN = n => lvMid(items.filter(i => i.name === n).map(i => i.lvl));
    if (b) add = names.filter(n => { const l = lvN(n); return !l || (l >= b[0] - ZONE_LV_PAD && l <= b[1] + ZONE_LV_PAD); });
  }
  mobs[id] = [...new Set([...(mobs[id] || []), ...add])].slice(0, 80);
  const lv = items.filter(i => i.lvl).map(i => i.lvl);
  const cat = env.rt.zoneCat || {}, lo = lv.length ? Math.min(...lv) : 0, hi = lv.length ? Math.max(...lv) : 0;
  const patch = { zone: id, zonePend: null, zoneMobs: mobs, lvl: env.heroLvl() || env.rt.lvl };
  if (lv.length && (near || pend) && (!cat[id] || !cat[id].lo || (/^out:/.test(id) && (cat[id].lo !== lo || cat[id].hi !== hi)))) patch.zoneCat = { ...cat, [id]: { ...(cat[id] || { name: id.replace(/^out:/, 'Окрестности: ') }), lo, hi } };
  if (id !== env.rt.zone || env.rt.zonePend || patch.zoneCat || mobs[id].length !== (env.rt.zoneMobs?.[id] || []).length) {
    if (id !== env.rt.zone) env.rec('B', 'локации', `зона: ${zoneName(id)}`);
    return env.setRt(patch);
  }
}

const zoneCatThin = () => Object.values(env.rt.zoneCat || {}).filter(c => c.lo && c.city).length < 5;

const zoneName = id => (env.rt.zoneCat?.[id]?.name) || env.kpd?.cat?.()[id]?.name || String(id || '?').replace(/^out:/, 'Окрестности: ');   // 9.0: и зоны из базы

async function zoneTrack(exp, dt, pct) {
  const id = env.rt.zone, l = env.heroLvl();
  if (!id || !l) return;
  const S = { ...(env.rt.zoneStat || {}) }, z = { ...(S[id] || {}) }, e = { ...(z[l] || { n: 0, exp: 0, sec: 0, pct: 0, pn: 0 }) };
  e.n++; e.exp += exp; e.sec += dt;
  if (pct != null) { e.pct += pct; e.pn++; }
  z[l] = e; S[id] = z;
  await env.setRt({ zoneStat: S, lvl: l });
}

// 7.1.30 (симуляция автофарма, 10.10): раньше оценка зоны бралась только с уровня героя (±2, от 5 боёв), а на КАЖДОМ новом уровне
// все зоны считались «неизученными» и пробовались заново по 10+ мин — половина времени уходила на пробы (≈3,1 M EXP/ч против ≈6,1).
// Теперь: замеры соседних уровней (−3…+2) складываются с весами, оценка «сглаживается» к медиане зон (мало боёв — меньше доверия)
const ZW = { 0: 1, '-1': 0.8, 1: 0.6, '-2': 0.6, 2: 0.4, '-3': 0.4 };
// 8.0 (аудит фарма; переустановки 10.10 20:08/21:05/22:10/23:17 стирали замеры 51–52 ур.): n1 — бои на уровнях L−1…L+1 без весов. Оценка по-прежнему
// сглажена по −3…+2, но «изученной» для героя L зона считается только с боями рядом с L (zoneRated)
function zoneRate(id, L) {
  const z = env.rt.zoneStat?.[id] || {};
  let n = 0, sec = 0, exp = 0, near = true, n1 = 0;
  for (const [d, w] of Object.entries(ZW)) {
    const e = z[L + +d]; if (!e || !e.sec || !e.n) continue;
    n += e.n * w; sec += e.sec * w; exp += e.exp * w; if (+d === 0 && e.n >= 5) near = false;
    if (Math.abs(+d) <= 1) n1 += e.n;
  }
  if (n < 5 || !sec) { const e = z[L]; return e ? { n: e.n, n1, few: true } : (n ? { n, n1, few: true } : null); }
  return { n: Math.round(n), n1, exp: exp / sec * 3600, near, sec: sec / n };
}
function zoneScore(r, prior) { const K = 20; return r?.exp ? (r.n * r.exp + K * prior) / (r.n + K) : 0; }
// 8.0 (аудит фарма): после переустановки (базовый профиль без замеров 51–52 ур.; Pavel Ruins 52 ур.: 426 боёв в 21:46 → 3 в 22:10)
// у героя 53 Antharas' Lair «изучена» по 248 боям на 50 ур. с весом 0,4 (≈1,46 M EXP/ч — худшая из зон) — автофарм выбрал бы её
// (симуляция по базовому профилю, тест v80-farm). Теперь изученная = ≥ zoneTrial боёв с весами
// И не меньше половины zoneTrial боёв на уровнях L−1…L+1 (полный zoneTrial на ±1 отсёк бы Blazing Swamp: 18 боёв на 49 ур. при герое 50
// — а она и была лучшей, ≈5,8 M на 50 ур.). Остальные — «пробные»: их старая оценка годится только для порядка проб
const zoneRated = (r, trial) => !!r?.exp && r.n >= trial && (r.n1 || 0) >= Math.ceil(trial / 2);
const zoneMed = xs => { const a = xs.filter(v => v > 0).sort((p, q) => p - q), m = a.length >> 1; return !a.length ? 0 : a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// 9.0 (игрок 11.10: «автокач исходя из КПД локации, от 1-х лвлов до хай лвла»): оценка зоны по встроенной базе (zone-kpd.js, zone-db.js —
// мобы точки, их уровни и EXP из живой игры) — ДО первого боя там. Раньше зона без своих замеров была просто «неизвестной»: летели
// в ближайшую по уровню и тратили по 15–30 мин на пробу каждой. Теперь:
//  • каталог зон — база (90 точек) + прочитанный «Телепорт» (его цена и город важнее): автофарм работает и без чтения страницы;
//  • зона без замеров — по прогнозу КПД (EXP/ч), прогноз приведён к своим замерам: множитель = медиана «замер ÷ прогноз» по изученным зонам;
//  • изученная зона — замер, «подтянутый» к своему прогнозу (а не к медиане зон), пока боёв мало;
//  • проба новой зоны раз в час — только если её прогноз не хуже 0,9 лучшей известной (раньше — любая, по очереди).
// Без базы (env.kpd нет) всё как в 8.0
function kpdOf(L, ids) {
  const K = env.kpd; if (!K?.ready?.() || !L) return null;
  const o = { rt: env.rt, cfg: env.cfg, mage: env.kpdMage?.() ?? true };
  o.cal = K.learn(o, L);
  const raw = {}; for (const id of ids) { const e = K.zoneEst(id, L, o); if (e) raw[id] = e; }   // exp 0 — в окне уровня мобов нет
  const trial = Math.max(15, env.cfg.zoneTrial || 20);
  const ratios = Object.keys(raw).filter(id => raw[id].exp > 0).map(id => [zoneRate(id, L), raw[id].exp]).filter(([r]) => zoneRated(r, trial)).map(([r, e]) => r.exp / e);
  const k = ratios.length ? Math.max(0.25, Math.min(4, zoneMed(ratios))) : 1;
  const est = {}; for (const [id, e] of Object.entries(raw)) est[id] = { ...e, exp: e.exp * k, raw: e.exp };
  return { est, k, n: ratios.length, cal: o.cal };
}
// каталог: база + «Телепорт» (поля «Телепорта» — поверх базы; у городов из «Телепорта» нет уровней — берём из базы)
const catAll = () => { const db = env.kpd?.cat?.() || {}, cat = env.rt.zoneCat || {}, out = { ...db };
  for (const [id, c] of Object.entries(cat)) out[id] = { ...(db[id] || {}), ...c, lo: c.lo || db[id]?.lo || 0, hi: c.hi || db[id]?.hi || 0 };
  return out; };
const kExp = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : Math.round(n / 1e3) + ' тыс.';

async function zoneForLevel() {
  const L = env.heroLvl(); if (!L) return false;
  const lo = L - Math.min(+env.cfg.lvlBelow > 0 ? +env.cfg.lvlBelow : 5, 5), hi = L + Math.min(env.cfg.lvlAbove ?? 15, 15);   // v4.59: окно из меню; для ВЫБОРА ЗОНЫ — не выше +15 (v5.3.1)
  const lv = env.pageItems().filter(i => !i.champ && i.lvl).map(i => i.lvl);
  if (!lv.length || lv.some(l => l >= lo && l <= hi)) {    // на этой странице есть свои — дело не в уровне
    // 20.13 (шаг 5, farm/NAV-2): свои нашлись — перелёт удался, счёт неудачных перелётов с нуля.
    // Шаг 5 (ревью): пустая страница (карта не дорисована / одни чемпионы) — не доказательство: отметку перелёта не стираем, иначе
    // первый проход по недорисованной карте после прилёта гасил учёт и пинг-понг A ↔ B возвращался
    if (lv.length && (env.rt.zoneLvlMiss?.n || (env.rt.zoneLvlGo && env.rt.zoneLvlGo.id === env.rt.zone))) await env.setRt({ zoneLvlMiss: null, zoneLvlGo: null });
    return false;
  }
  if (Date.now() - (env.rt.zoneLvlT || 0) < 5 * 60000) return false;
  // 20.13 (ревизия 17.10, шаг 5, farm/NAV-2): пинг-понг A ↔ B — прилетели по уровню, а у точки снова не те мобы; зона прилёта не исключалась,
  // и через 5 мин бот платил за перелёт обратно. Теперь такая зона — «плохая» на 6 ч (zoneBad), а после двух неудачных перелётов подряд
  // остаёмся на 6 ч и бьём, что есть (дальше — обычное «мягкое окно» mobfarm)
  const H6 = 6 * 3600000, miss = env.rt.zoneLvlMiss && Date.now() - (env.rt.zoneLvlMiss.t || 0) < H6 ? env.rt.zoneLvlMiss : null;
  if (miss?.n >= 2) return false;
  const lg = env.rt.zoneLvlGo;
  if (lg?.id && lg.id === env.rt.zone && Date.now() - (lg.t || 0) < H6) {
    const n = (miss?.n || 0) + 1;
    await env.setRt({ zoneLvlGo: null, zoneLvlMiss: { n, t: Date.now() }, zoneBad: { ...(env.rt.zoneBad || {}), [lg.id]: Date.now() } });
    if (n >= 2) { env.rec('B', 'локации', `${zoneName(lg.id)}: прилетел по уровню, а мобов ${lo}–${hi} ур. у точки нет — ${n}-й перелёт подряд без своих мобов, остаюсь на 6 ч и бью, что есть`); return false; }
    env.rec('B', 'локации', `${zoneName(lg.id)}: прилетел по уровню, а мобов ${lo}–${hi} ур. у точки нет — зону 6 ч не выбираю`);
  }
  await env.setRt({ zoneLvlT: Date.now() });
  if ((!env.rt.zoneCatT || zoneCatThin()) && ((env.rt.zoneCatFail || 0) < 3 || Date.now() - (env.rt.zoneCatFailT || 0) > 3600000)) { env.rec('B', 'локации', `мобы тут ${Math.min(...lv)}–${Math.max(...lv)} ур., а герой ${L} — читаю «Телепорт», чтобы найти зону своего уровня`); await env.setRt({ zoneScan: true, zoneLvlT: 0 }); location.href = '/teleport.html'; await env.sleep(4000); return true; }   // после чтения — сразу выбор зоны
  const bad = env.rt.zoneBad || {};
  const mid = (lo + hi) / 2, inWin = c => (Math.min(c.hi, hi) - Math.max(c.lo, lo) + 1) / (c.hi - c.lo + 1);
  const fit = Object.entries(catAll()).filter(([id, c]) => id !== env.rt.zone && !/^out:|^rb:/.test(id) && c.lo && c.hi >= lo && c.lo <= hi && Date.now() - (bad[id] || 0) > 6 * 3600000)   // 7.1.30: не телепорт в ту же зону
    .sort((a, b) => (inWin(b[1]) >= 0.5) - (inWin(a[1]) >= 0.5) || Math.abs((a[1].lo + a[1].hi) / 2 - mid) - Math.abs((b[1].lo + b[1].hi) / 2 - mid) || (a[1].price || 0) - (b[1].price || 0));
  if (!fit.length) { env.rec('B', 'локации', `зон для ${lo}–${hi} ур. в «Телепорте» нет (в каталоге ${Object.keys(env.rt.zoneCat || {}).length}) — бью что есть`); return false; }
  // 7.1.31 (лог 10.10 19:35–19:39): мобы тут 15–35 ур. → улетал в ближайшую по уровню Enchanted Valley (≈1,6 M EXP/ч), а через 4 мин
  // автофарм перелетал в Blazing Swamp (≈5,8 M) — два платных телепорта и 4 мин в худшей зоне. Есть замеренная зона своего уровня —
  // сразу в лучшую по опыту (та же оценка, что у автофарма); замеров нет — как раньше, ближайшая по уровню
  const trial = Math.max(15, env.cfg.zoneTrial || 20);
  // 8.0 (аудит фарма): известная оценка ниже медианы подходящих зон — туда не летим; изученных нет — зона с лучшей старой оценкой
  // (замеры на 2–3 ур. от героя, со скидкой 15 %), и только потом — ближайшая по уровню
  const ev = fit.map(([zid, zc]) => [zid, zc, zoneRate(zid, L)]);
  const med = zoneMed(ev.map(x => x[2]?.exp || 0)), low = r => !!r?.exp && r.exp < med;
  const rated = ev.filter(x => zoneRated(x[2], trial) && !low(x[2]));
  const prior = rated.length ? rated.map(x => x[2].exp).sort((a, b) => a - b)[Math.floor(rated.length / 2)] : med;
  const sc = x => zoneRated(x[2], trial) ? zoneScore(x[2], prior) : zoneScore(x[2], prior) * 0.85;
  const known = ev.filter(x => x[2]?.exp && x[2].n >= 5 && !low(x[2])).sort((a, b) => sc(b) - sc(a));
  // 9.0: зоны без замеров — по прогнозу КПД (а не «ближайшая по уровню»); прогноз заметно лучше известной (×0,85 > ×1,10) — летим туда
  const kp = kpdOf(L, ev.map(x => x[0])), E = kp?.est || {};
  const guess = ev.filter(x => !zoneRated(x[2], trial) && E[x[0]]?.exp > 0).sort((a, b) => E[b[0]].exp - E[a[0]].exp)[0];
  const pickG = guess && (!known[0] || E[guess[0]].exp * 0.85 > sc(known[0]) * 1.10);
  const [id, c, rate] = pickG ? guess : known[0] || ev.find(x => !low(x[2])) || ev[0];
  const why = pickG ? `лучшая по КПД для ${L} ур.: ≈${kExp(E[id].exp)} EXP/ч (${E[id].why})`
    : rate?.exp ? `${zoneRated(rate, trial) ? 'лучшая по опыту для своего уровня' : 'лучшая по старым замерам'}: ≈${Math.round(rate.exp).toLocaleString('ru')} EXP/ч (${rate.n} боёв)` : `зона своего уровня (${c.lo}–${c.hi})`;
  env.rec('B', 'локации', `мобы тут ${Math.min(...lv)}–${Math.max(...lv)} ур., а герой ${L} → лечу в «${c.name || id}» (${c.lo}–${c.hi}) · ${why}`);
  await env.setRt({ zoneGo: { id, t: Date.now(), why }, zoneGoT: 0, zoneLvlGo: { id, t: Date.now() } });   // 20.13 (farm/NAV-2): куда летели по уровню
  location.href = '/teleport.html'; await env.sleep(4000);
  return true;
}

function zonePick() {
  const L = env.heroLvl(), cat = catAll(), cur = env.rt.zone, trial = Math.max(15, env.cfg.zoneTrial || 20);
  if (!L) return null;   // 7.1.30: уровень героя ещё не прочитан — не выбирать зону по окну −3…15
  const badZ = env.rt.zoneBad || {}, notBad = id => Date.now() - (badZ[id] || 0) > 6 * 3600000;   // 7.1.30: зона без кнопки/не по карману — 6 ч не пробуем
  const wLo = L - Math.min(+env.cfg.lvlBelow > 0 ? +env.cfg.lvlBelow : 5, 5), wHi = L + Math.min(env.cfg.lvlAbove ?? 15, 15);   // v4.59: то же окно, что в меню (зона — не выше +15)
  const fits = Object.entries(cat).filter(([id, c]) => !/^out:/.test(id) && c.lo && c.lo <= wHi && c.hi >= wLo && notBad(id));
  const adena = env.rt.adenaSeen && Date.now() - env.rt.adenaSeen.t < 3600000 ? env.rt.adenaSeen.v : null;   // из магазина/телепорта, если видели недавно
  const afford = c => adena == null || !c.price || adena - c.price >= Math.min(env.cfg.shopReserve ?? 200000, adena / 2);
  const tried = env.rt.zoneTried || {};
  const here = zoneRate(cur, L);
  const studying = !!cur && !/^out:/.test(cur) && !zoneRated(here, trial);
  if (studying && !(env.rt.zoneTrialT && Date.now() - env.rt.zoneTrialT > 30 * 60000)) return null;   // текущую ещё изучаем (не дольше 30 мин)
  // 8.0 (аудит фарма): оценки всех подходящих зон (и пробных, по соседним уровням) → медиана; зона с известной оценкой ниже медианы —
  // не цель ни перелёта, ни пробы (симуляция: герой 53 после переустановки из неизвестной зоны летел в Antharas' Lair ≈1,46 M, худшую)
  const all = fits.map(([id, c]) => [id, c, id === cur ? here : zoneRate(id, L)]);
  // 9.0: прогноз КПД всех подходящих зон (и текущей); E[id].exp — уже в масштабе своих замеров
  const kp = kpdOf(L, [...new Set([...all.map(x => x[0]), cur].filter(Boolean))]), E = kp?.est || {};
  const ex = (id, r) => r?.exp || E[id]?.exp || 0;     // старая оценка (соседние уровни), иначе прогноз
  const med = zoneMed([...all.map(x => x[2]?.exp || 0), ...(all.some(x => x[0] === cur) ? [] : [here?.exp || 0])]);
  const low = r => !!r?.exp && r.exp < med;
  const lowE = (id, r) => !r?.exp && !!E[id]?.exp && !!med && E[id].exp < med;   // 9.0: без замеров, но прогноз ниже медианы — не пробуем
  const rated = all.filter(x => zoneRated(x[2], trial) && afford(x[1]) && (x[0] === cur || Date.now() - (tried[x[0] + ':' + L] || 0) > 1800000));
  const prior = rated.length ? rated.map(x => x[2].exp).sort((a, b) => a - b)[Math.floor(rated.length / 2)] : 0;
  const pr = id => E[id]?.exp || prior;               // 9.0: замер «подтягивается» к своему прогнозу, а не к медиане зон
  rated.sort((a, b) => zoneScore(b[2], pr(b[0])) - zoneScore(a[2], pr(a[0])));
  const best = rated[0], bs = best ? zoneScore(best[2], pr(best[0])) : 0, hs = here?.exp ? zoneScore(here, pr(cur)) : 0;
  // проба новой зоны: если хороших замеров меньше двух — сразу, иначе не чаще раза в час (остальное время — лучшая известная)
  // 8.0: сначала пробные зоны с лучшей старой оценкой (замеры на 2–3 ур. от героя), потом неизвестные — ближе к окну уровня;
  // старая оценка (со скидкой 15 %) заметно лучше лучшей изученной и текущей — пробуем сразу, не через час (Den of Evil ≈6,5 M на 51 ур.)
  // 9.0: зоны с прогнозом КПД, но без старых замеров — сортируются по прогнозу; совсем без оценки — последними, ближе к окну уровня;
  // прогноз «зона пуста для этого уровня» (0 мобов в окне) — не проба
  const fresh = all.filter(([id, c, r]) => id !== cur && !zoneRated(r, trial) && !low(r) && !lowE(id, r) && !(E[id] && !E[id].exp) && !(kp && !r?.exp && !E[id]) && afford(c) && Date.now() - (tried[id + ':' + L] || 0) > 6 * 3600000)   // 7.1.30: не «пробовать» зону, в которой уже стоим
    .sort((a, b) => (b[2]?.exp || 0) - (a[2]?.exp || 0) || ex(b[0]) - ex(a[0]) || Math.abs((a[1].lo + a[1].hi) / 2 - (wLo + wHi) / 2) - Math.abs((b[1].lo + b[1].hi) / 2 - (wLo + wHi) / 2));
  const fx = fresh[0] ? fresh[0][2]?.exp ? zoneScore(fresh[0][2], E[fresh[0][0]]?.exp || prior || med) : ex(fresh[0][0]) : 0;
  const hot = fx > 0 && fx * 0.85 > Math.max(bs, hs) * 1.10;
  // 8.0: текущая зона на этом уровне не изучена, а проба давно кончилась (переустановка, скачок уровня): её старая оценка не хуже
  // остальных — меряем здесь (бесплатно), не летим пробовать другую; оценки нет совсем — одна проба здесь (до 30 мин) раньше платных
  if (studying && !low(here)) {
    const tk = cur + ':' + L;
    if (here?.exp && here.exp * 1.10 >= Math.max(fresh[0]?.[2]?.exp || 0, fx * 0.85, best ? best[2].exp : 0)) return null;   // 9.0: и прогноз КПД (со скидкой 15 %)
    // 9.0: замеров здесь нет, а по прогнозу КПД мобов своего уровня тут нет или зона хуже 0,85 лучшей альтернативы — бесплатную пробу пропускаем
    const alt = Math.max(fx, best ? best[2].exp : 0);
    if (!here?.exp && !tried[tk] && !(E[cur] && (!E[cur].exp || (alt && E[cur].exp < 0.85 * alt)))) {
      env.rt.zoneTrialT = Date.now(); env.rt.zoneTried = { ...tried, [tk]: Date.now() };
      env.setRt({ zoneTrialT: env.rt.zoneTrialT, zoneTried: env.rt.zoneTried });
      return null;
    }
  }
  // замеры уже есть — сначала лучшая известная зона, первая проба новой — через час
  if (!env.rt.zoneExploreT && rated.length >= 2) { env.rt.zoneExploreT = Date.now(); env.setRt({ zoneExploreT: env.rt.zoneExploreT }); }
  // 9.0: с прогнозом КПД — проба только если прогноз не хуже 0,9 лучшей известной (одна изученная — 0,8); без прогноза — как раньше
  const worth = !fresh.length ? false : !fx || fresh[0][2]?.exp ? true : fx >= (rated.length >= 2 ? 0.9 : rated.length ? 0.8 : 0) * Math.max(bs, hs);
  if (fresh.length && worth && (rated.length < 2 || hot || Date.now() - (env.rt.zoneExploreT || 0) > 3600000)) {
    const [fid, fc, fr] = fresh[0];
    env.rt.zoneExploreT = Date.now(); env.rt.zoneTrialT = Date.now(); env.setRt({ zoneExploreT: env.rt.zoneExploreT, zoneTrialT: env.rt.zoneTrialT });
    return { id: fid, name: fc.name, why: fr?.exp ? `пробую зону на ${L} ур. (${fc.lo}-${fc.hi}): по старым замерам ≈${Math.round(fr.exp).toLocaleString('ru')} EXP/ч (${fr.n} боёв)`
      : E[fid]?.exp ? `пробую зону по КПД для ${L} ур.: ≈${kExp(E[fid].exp)} EXP/ч (${E[fid].why})` : `пробую новую зону (${fc.lo}-${fc.hi})` };
  }
  if (best && best[0] !== cur && !low(best[2]) && (!hs || bs > hs * 1.10))
    return { id: best[0], name: best[1].name, why: `лучше по опыту: ≈${Math.round(best[2].exp).toLocaleString('ru')} EXP/ч (${best[2].n} боёв) против ${here?.exp ? '≈' + Math.round(here.exp).toLocaleString('ru') : '?'}` };
  return null;
}

// 15.10 (лог 11:39): форум пять раз списал по 50 000 — переход страницы не завершал zoneGo.
// Платёж помечается ДО клика. ACK привязан к персонажу, ревизии, маршруту и точному запросу.
const FORUM_TP_ACK = 'l2bot.forumTeleportAck';
const FORUM_CITY = { heine: 'l2dop_heine' }; // Подтверждено ответом resource-teleport; прочие города не угадываем.
function forumTargetReached(id, ch) {
  if (!ch || ch.inBattle || ch.activeDungeonId) return false;
  if (ch.currentZoneId) return ch.currentZoneId === id;
  return !!FORUM_CITY[id] && ch.cityId === FORUM_CITY[id];
}
function forumPendingFor(g) {
  const p = g?.forumTp;
  return !!p && p.char === env.rt.char && p.kick === env.rt.manualKickAt && p.id === g.id &&
    p.url === (g.url || env.rt.zoneCat?.[g.id]?.url);
}
function forumAck(g) {
  const p = g.forumTp; if (!forumPendingFor(g)) return null;
  if (p.ack) return p.ack;
  try { const a = JSON.parse(root.sessionStorage?.getItem(FORUM_TP_ACK) || 'null');
    return a?.nonce === p.nonce && a.charId === p.charId && a.id === g.id && a.url === p.url ? a.ack : null;
  } catch (_) { return null; }
}
// 15.10, ревизия: обычный телепорт тоже переживает unload без второй оплаты.
const nativeTargetReached=(id,ch)=>!!ch&&!ch.inBattle&&!ch.activeDungeonId&&ch.currentZoneId===id;
function nativeAck(g) {
  const p=g?.nativeTp;if(!p||p.char!==env.rt.char||p.kick!==env.rt.manualKickAt||p.id!==g.id)return null;
  if(p.ack)return p.ack;
  try{const a=JSON.parse(root.sessionStorage?.getItem('l2bot.nativeTeleportAck')||'null');return a?.nonce===p.nonce?a.ack:null;}catch(_){return null;}
}
// 20.43 (ревью au/travel): 409 (revision_conflict) и 401 на телепорт — не доказательство отказа: браузер сам повторяет оборванный
// POST, первый запрос мог уже пройти, повтор получает 409 (kb/lifestone.md, story.js); после 401 игра обновляет токен и шлёт запрос
// снова. Такой ответ — неизвестный исход (сверка по серверу), а не «отказ»
const TP_UNSURE = [401, 409];
function onNativeTeleportNet(path,d) {
  const g=travelOpen(),p=g?.nativeTp;
  if(!p||path!=='/game/teleport'||d.method!=='POST'||p.char!==env.rt.char||p.kick!==env.rt.manualKickAt||
    d.nativeNonce!==p.nonce||d.req?.teleportId!==p.id||d.req?.expectedAdenaCost!==p.cost||!Number.isSafeInteger(d.req?.expectedRevision)||d.req.expectedRevision<p.revision)return;
  if(nativeAck(g)?.ok)return;                     // 20.43 (ревью): подтверждённое прибытие поздним ответом другого запроса не затираем
  const ch=d.res?.character, good=d.status>=200&&d.status<300&&!d.error&&!d.res?.error&&d.res?.ok!==false;
  // 20.43 (автономность, разбор 21.10): явный отказ сервера на этот самый запрос (4xx из списка, 2xx с error/ok:false, 500 с кодом
  // «не хватает…» — общее правило L2PayOutcome.classify) — кроме 409/401 (TP_UNSURE). Это ещё не вывод: перелёт снимается только
  // после свежего GET /character с той же ревизией и аденой (travelVerify). 5xx/обрыв — неизвестно
  if(!good&&!TP_UNSURE.includes(+d.status)&&root.L2PayOutcome?.classify?.(d)==='rejected'&&(!ch||ch.name===p.char&&ch.id===p.charId)){
    p.ack={ok:false,refused:true,status:+d.status||0,t:Date.now()};
    try{root.sessionStorage?.setItem('l2bot.nativeTeleportAck',JSON.stringify({nonce:p.nonce,ack:p.ack}));}catch(_){}
    env.setRt(travelKeep(g)).catch(()=>{});return;
  }
  if(!good||!ch||ch.name!==p.char||ch.id!==p.charId||!Number.isSafeInteger(ch.revision)||ch.revision<=d.req.expectedRevision)return;
  p.ack={ok:true,t:Date.now()};
  try{root.sessionStorage?.setItem('l2bot.nativeTeleportAck',JSON.stringify({nonce:p.nonce,ack:p.ack}));}catch(_){}
  env.setRt(travelKeep(g)).catch(()=>{});
}
function onForumTeleportNet(path, d) {
  onNativeTeleportNet(path,d);
  const g = travelOpen(), p = g?.forumTp;
  if (!p || env.on === false || env.tabOwner === false || env.rt.char !== p.char || env.rt.manualKickAt !== p.kick ||
      path !== '/game/farm-guide/resource-teleport' || d.method !== 'POST' || d.req?.teleportId !== p.id ||
      d.req?.expectedRevision !== p.revision || d.req?.expectedAdenaCost !== p.cost ||
      g.id !== p.id || (g.url || env.rt.zoneCat?.[g.id]?.url) !== p.url || location.pathname + location.search !== p.url) return;
  if (forumAck(g)?.ok) return;                     // 20.43 (ревью): подтверждённое прибытие не затираем
  const ch = d.res?.character, good = !d.error && d.status >= 200 && d.status < 300 && d.res && !d.res.error && d.res.ok !== false;
  // Отказом считаем лишь явный ответ сервера. 5xx/обрыв не освобождает повторную оплату. 20.43: 409/401 — тоже неизвестно (TP_UNSURE)
  const refused = !d.error && d.res && (d.res.error || d.res.ok === false) && d.status >= 200 && d.status < 500 && !TP_UNSURE.includes(+d.status);
  if (good && (!ch || ch.name !== p.char || ch.id !== p.charId || !Number.isSafeInteger(ch.revision) || ch.revision <= p.revision)) return;
  if (ch && (ch.name !== p.char || ch.id !== p.charId)) return;
  if (!good && !refused) return;
  p.ack = { ok: good && forumTargetReached(p.id, ch), refused: !!refused, ...(refused ? { status: +d.status || 0 } : {}), t: Date.now() };
  try { root.sessionStorage?.setItem(FORUM_TP_ACK, JSON.stringify({ nonce: p.nonce, id: p.id, charId: p.charId, url: p.url, ack: p.ack })); } catch (_) {}
  // sessionStorage синхронен: native переход может выгрузить страницу раньше chrome.storage.
  env.setRt(travelKeep(g)).catch(() => {});
}
async function forumCharacter() {
  try { const r = await env.gameGet('/character'); return r.ok ? (await r.json())?.character : null; } catch (_) { return null; }
}
async function forumFinish(g, active, note = '') {
  if (!active()) return;
  await env.setRt({ ...travelClose(g), zonePend: null, zone: g.id, zoneGoT: Date.now(), lvlRelax: null, lvlRelaxDown: null });
  try { root.sessionStorage?.removeItem(FORUM_TP_ACK); if (travelReceipt(g)) root.sessionStorage?.removeItem(NATIVE_TP_ACK); } catch (_) {}
  env.rec('B', 'локации', `${zoneName(g.id)}: прибытие подтверждено сервером${note ? ` (${note})` : ''}`);
}
// 20.43 (автономность, доводка 21.10; ревью сверки): ответ — true, только если фон записал именно эту паузу (travelPauseSaved)
async function forumUncertain(why, active) {
  if (!active()) return false;
  env.rec('B', 'локации', `${why}; повторная оплата телепорта запрещена`);
  const msg = `Телепорт: ${why}. Проверьте положение героя`, t0 = Date.now();
  await env.pauseBot?.(msg, { fault: true });   // 20.43: сервер лежит — ждём его, не пауза
  return travelPauseSaved(msg, t0);
}
// 20.43 (автономность, доводка 21.10; ревью сверки, MV3: сервер лежит на 30-й минуте, игрок жмёт ⏹ Стоп в ожидании сервера): после
// pauseBot выключенная вкладка (on=false) — не доказательство паузы «Проверьте положение героя». Так же выглядят ⏹ Стоп / ⏸ Пауза игрока,
// пока pauseBot ждал сервер (serverWait выходит без перезагрузки, pauseBot возвращается без своей паузы), Стоп фона во время srvUp и
// три недошедшие попытки botControl (automationStop выключает вкладку сразу, до ответа фона). Раньше хватало on=false — метка gaveUp
// писалась, и следующий Старт игрока закрывал квитанцию «по решению игрока», хотя этой паузы он не видел: запрет платного снимался при
// неизвестном исходе клика, а через 3 мин farmStep/zonePick могли купить тот же телепорт. Доказательство — одна запись фона botControl
// в хранилище: on=false, paused и stopMeta с одним временем, не раньше начала паузы, источник 'content-pause', та же причина (фон режет
// её до 240 символов), «Продолжить» ещё не нажато. Нет доказательства (или хранилище не прочиталось) — метки нет: следующий Старт
// начинает новое окно сверки, как после Стопа
async function travelPauseSaved(msg, t0) {
  try {
    const s = await root.chrome?.storage?.local?.get?.(['on', 'paused', 'stopMeta']), m = s?.stopMeta, p = s?.paused;
    return !!m && !!p && s.on === false && m.source === 'content-pause' && !m.resumed && +m.t >= t0 && +p.t === +m.t && m.reason === String(msg).slice(0, 240);
  } catch (_) { return false; }
}

// 20.43 (автономность, разбор 21.10; docs/NIGHT-FARM-2026-10-17.md: 07:25:08 POST телепорта в Coliseum → 502, 07:25:16 пауза
// «прибытие не подтверждено» до утра, хотя уже в 07:25:46 GET /character вернул 200 и герой стоял в Aden): сбой перелёта больше
// не ставит бота на паузу.
//  (а) клика не было (не прочитался персонаж, квитанция не записалась до клика) или сервер явно отказал и свежий GET /character
//      показал ту же ревизию и адену — оплаты точно не было: перелёт снят, зона 6 ч «плохая» (как при нехватке адены), строка
//      в журнал, бот работает дальше (travelDrop);
//  (б) клик был, исход неизвестен — квитанция остаётся, платное запрещено (сверка держит круг, payments.prepare — через
//      externalPending ядра), раз в 30–60 с бесплатный GET /character (travelVerify). Пауза с причиной — только если сверить не удаётся
//      30 мин. Stop/другой герой — шаг выходит без оплаты, без паузы и без записи.
// 20.43 (ревью au/travel): квитанция с состоянием сверки живёт в отдельном ключе rt.travelCheck (копия маршрута + nativeTp/forumTp +
// check), а не внутри маршрута zoneGo: маршрут снимают диспетчер действий при смене режима/цели/Старта (actions.clear), список
// «Задачи бота» (loopTaskList), смена режима в меню и новые маршруты автофарма/Маммона/квестов — вместе с ним пропадала и квитанция,
// а с ней запрет платного, хотя исход клика не сверен. travelCheck пишет только этот модуль и снимает только по выводу сверки
// (прибыл / не прошёл / отказ, подтверждённый GET / перелёт состоялся) или по Старту игрока после паузы «Проверьте положение героя».
// Сверку ведёт ядро в любом режиме (content.loopTravel → travelStep), раньше списка задач и диспетчера.
const TRAVEL_GAP = 30000, TRAVEL_GAP_MAX = 60000, TRAVEL_GIVEUP = 30 * 60000, NATIVE_TP_ACK = 'l2bot.nativeTeleportAck';
const travelReceipt = g => g?.nativeTp || g?.forumTp || null;
// открытая квитанция: rt.travelCheck; запись старых версий — внутри zoneGo (travelStep переносит её в travelCheck)
const travelOpen = () => env.rt.travelCheck || (travelReceipt(env.rt.zoneGo) ? env.rt.zoneGo : null);
// ядро: незакрытая квитанция перелёта запрещает другие оплаты и не считается «нет прогресса» у сторожа
const travelPending = () => !!travelReceipt(travelOpen());
// запись / снятие той записи, где лежит квитанция (travelCheck или старый маршрут); новый маршрут zoneGo, созданный во время сверки, не трогаем
const travelIsCheck = g => !!g && (g === env.rt.travelCheck || !!travelReceipt(g)?.nonce && travelReceipt(g).nonce === travelReceipt(env.rt.travelCheck)?.nonce);
const travelKeep = g => travelIsCheck(g) ? { travelCheck: g } : { zoneGo: g };
const travelClose = g => travelIsCheck(g) ? { travelCheck: null } : { zoneGo: null };
const travelPlace = ch => ({ zone: ch?.currentZoneId ?? null, city: ch?.cityId ?? null });
const adenaOf = v => { const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v; return Number.isSafeInteger(n) && n >= 0 ? n : null; };
const travelRnd = (a, b) => typeof env.rnd === 'function' ? env.rnd(a, b) : a + Math.random() * (b - a);
// 20.43 (ревью au/travel): метка запроса для NET_CONTEXT ядра — только первые 30 с после клика бота. Раньше её получал любой POST
// /game/teleport, пока квитанция открыта (до 30 мин сверки), в том числе ручной клик игрока, и его ответ засчитывался клику бота
const NATIVE_NONCE_MS = 30000;
const nativeNonce = () => { const p = travelOpen()?.nativeTp; return p?.nonce && Date.now() - (+p.sentAt || 0) <= NATIVE_NONCE_MS ? p.nonce : ''; };
function travelForget() { try { root.sessionStorage?.removeItem(FORUM_TP_ACK); root.sessionStorage?.removeItem(NATIVE_TP_ACK); } catch (_) {} }
// (а): перелёт без оплаты — снять маршрут без паузы; toMap — со страницы телепорта на карту (как при нехватке адены).
// zoneGoT — «была попытка»: при сбоящем GET /character автофарм (10 мин) и цель ресурса (3 мин) не перебирают зоны подряд, помечая
// их все «плохими»; поэтому и zoneLvlT не сбрасываем (выбор зоны по уровню — не чаще раза в 5 мин)
async function travelDrop(g, why, active, toMap = false) {
  if (!active()) return;
  env.rec('B', 'локации', `${zoneName(g.id)}: ${why} — оплаты не было, перелёт снят, зону 6 ч не выбираю; работаю дальше без паузы`);
  await env.setRt({ ...travelClose(g), zoneGoT: Date.now(), zoneTried: { ...(env.rt.zoneTried || {}), [g.id + ':' + env.heroLvl()]: Date.now() },
    zoneBad: { ...(env.rt.zoneBad || {}), [g.id]: Date.now() } });
  travelForget();
  if (toMap && env.on !== false && env.tabOwner !== false) { location.href = '/map.html'; await env.sleep(3000); }
}
// Ревизия выросла, герой не в бою и уже не там, где стоял до клика, а адены убыло не меньше цены (или переход бесплатный), —
// перелёт состоялся, только currentZoneId не совпал с id телепорта. Ошибиться этот вывод может лишь в сторону «оплата прошла»
function travelMoved(p, ch) {
  const a = p.from, b = travelPlace(ch), cost = +p.cost || 0, adena = adenaOf(ch?.adena);
  if (!a || !ch || ch.inBattle || ch.activeDungeonId || (b.zone == null && b.city == null) || (a.zone === b.zone && a.city === b.city)) return false;
  return cost === 0 || (p.adena != null && adena != null && adena <= p.adena - cost);
}
// 20.43 (автономность, доводка 21.10; ревью сверки: ветка «ревизия выросла» кончалась 30 мин простоя и паузой, хотя исход доказуем по
// адене и месту). Платный телепорт, ревизия выросла, герой не в бою и не в подземелье:
//  travelPaid   — адены стало меньше хотя бы на цену телепорта (другие оплаты всё это время запрещены квитанцией) — плата списана, даже если
//                 место по ответу сервера прежнее; как и travelMoved, ошибиться этот вывод может лишь в сторону «оплата прошла»;
//  travelStayed — адена ровно та же, что до клика, и герой там же, где стоял (зона и город те же): следов телепорта нет, ревизию
//                 сдвинуло другое действие (TvT, бой, письмо). Запрос телепорта несёт expectedRevision (kb/repo-facts: 409 на
//                 /game/teleport) — после роста ревизии прежний запрос уже не применится. Вывод «не прошёл» — как для «ничего не
//                 изменилось»: две такие сверки с промежутком ≥ 30 с, первая не раньше 30 с после клика. Адена именно «та же», а не
//                 «не меньше»: во время сверки идёт TvT, а победа даёт 500 000 аден (kb/repo-facts) — с ней списанная плата за телепорт
//                 в мировую зону, где currentZoneId/cityId не меняются, выглядела бы как «не прошёл», и тот же телепорт оплачивался бы снова.
// Бесплатный переход, неизвестные или изменившиеся (но не на цену) адена или место — не доказательство: ждём до 30 мин, как раньше
const travelSettled = ch => !!ch && !ch.inBattle && !ch.activeDungeonId;
function travelPaid(p, ch) {
  const cost = +p.cost || 0, adena = adenaOf(ch?.adena);
  return cost > 0 && travelSettled(ch) && p.adena != null && adena != null && adena <= p.adena - cost;
}
function travelStayed(p, ch) {
  const a = p.from, b = travelPlace(ch), cost = +p.cost || 0, adena = adenaOf(ch?.adena);
  return cost > 0 && !!a && travelSettled(ch) && (b.zone != null || b.city != null) && a.zone === b.zone && a.city === b.city
    && p.adena != null && adena != null && adena === p.adena;
}
// 20.43 (автономность, доводка 21.10; ревью сверки): вывод «перелёт состоялся / оплата прошла» без совпадения id зоны раньше снимал
// квитанцию, не записав прибытия (только zoneGoT). Проверка перед следующим кликом (nativeTargetReached / forumTargetReached) не узнаёт
// цель по тому же несовпадающему id, и цель ресурса (farmStep: rt.zone ≠ точка, через 3 мин после zoneGoT), рецепт и автофарм
// покупали тот же телепорт ещё раз. Теперь прибытие записывается как у forumFinish (rt.zone = цель): повтора нет, зону уточнит карта по мобам
async function travelPaidFinish(g, active, line) {
  if (!active()) return;
  env.rec('B', 'локации', line);
  await env.setRt({ ...travelClose(g), zonePend: null, zone: g.id, zoneGoT: Date.now(), lvlRelax: null, lvlRelaxDown: null });
  travelForget();
}
// 20.43 (автономность, доводка 21.10; ревью сверки): одна форма статуса и для ожидания следующей сверки, и для её итога. setStatus ядра
// пишет строку «бот» в журнал (со снимком новых строк журнала игры) при каждой смене формы (цифры → #): две формы давали 2 строки
// на каждую сверку — ≈80 за 30 мин без вывода. Теперь строка — только когда меняется смысл («без изменений» / «следов перелёта нет»)
const travelStatus = (name, c, now) => `Телепорт в ${name}: исход не подтверждён — сверка ${c.n}${c.same ? ' (без изменений)' : c.stay ? ' (следов перелёта нет)' : ''}, следующая через ${Math.max(0, Math.ceil(((+c.next || 0) - now) / 1000))} с; платное не трачу`;
// (б): сверка исхода клика по серверу. Повтор оплаты допускается только после доказательства «телепорт не прошёл»:
// ревизия и адена героя те же, что до клика (L2PayOutcome.unchanged), в двух сверках подряд с промежутком ≥ 30 с, первая — не раньше
// 30 с после клика (поздний ответ сервера успеет изменить ревизию).
// 20.43 (ревью au/travel): явный отказ сервера на этот запрос (ack.refused) снимает перелёт только вместе со сверкой «ревизия и адена
// те же» — одной достаточно: на сам запрос сервер уже ответил. Раньше отказ сразу писал «оплаты не было» и ставил зоне zoneBad без GET:
// сервер применил телепорт и ответил 409 на повтор POST — герой уже в цели, адены −50 000, а журнал «оплаты не было», и зона, куда
// только что заплатили, выпадала на 6 ч. Теперь: ревизия выросла и герой в цели — прибытие; ничего не изменилось — отказ; иначе — сверка
async function travelVerify(g, active, why) {
  const p = travelReceipt(g); if (!p || !active()) return;
  const native = !!g.nativeTp, name = zoneName(g.id), kick = env.rt.manualKickAt, prev = g.check;
  let c = prev && prev.kick === kick ? prev : null;
  if (c && Date.now() < (+c.next || 0)) {
    env.setStatus(travelStatus(name, c, Date.now()));   // 20.43 (доводка 21.10): та же форма, что после сверки
    await env.sleep(1000); return;
  }
  // 20.43 (ревью au/travel): Старт / «Продолжить» игрока после паузы «Проверьте положение героя» (30 мин без вывода) — его решение:
  // следующая удачная сверка закрывает квитанцию (герой в цели — прибытие, иначе «закрыта по Старту игрока»), без нового окна
  // в 30 мин и новой паузы. Остальные Старты (Stop → Старт, смена режима) квитанцию не снимают — окно сверки начинается заново
  // 20.43 (автономность, доводка 21.10; ревью сверки): «решение игрока» — только настоящий Старт / «Продолжить» после настоящей паузы.
  // Раньше метка gaveUp писалась до pauseBot, а ackStart выводился из неё при любой смене manualKickAt: сервер лежит на 30-й минуте →
  // pauseBot ждёт его (serverWait, перезагрузка), паузы нет, бот включён — и первая же правка меню (задача, лимит, режим, дневной сброс)
  // закрывала квитанцию «по решению игрока», снимая запрет платного. Теперь метка пишется только после записанной паузы (ниже), в ней —
  // номер Старта rt.dailyStart (фон поднимает его только на Старт / «Продолжить» / горячую клавишу запуска, не на правку меню),
  // и квитанцию закрывает лишь более поздний Старт. Метка прежнего вида (без номера Старта) — новое окно сверки, не закрытие
  const acked = !!prev && (!!prev.ackStart || !!prev.gaveUp && Number.isSafeInteger(prev.gaveUpStart) && (+env.rt.dailyStart || 0) > prev.gaveUpStart);
  const fresh = !c; if (fresh) c = { kick, t0: Date.now(), at: 0, next: 0, n: 0, same: 0, sameAt: 0, why, ...(acked ? { ackStart: 1 } : {}) };
  const ch = await forumCharacter();
  if (!active()) return;                           // Stop / другой герой / новый Старт во время сверки — без оплаты, паузы и записи
  const now = Date.now(), mine = !!ch && p.char === env.rt.char && ch.name === p.char && (!p.charId || ch.id === p.charId) && Number.isSafeInteger(ch.revision);
  c = { ...c, at: now, next: now + travelRnd(TRAVEL_GAP, TRAVEL_GAP_MAX), n: c.n + 1 };
  if (mine && ch.revision > p.revision && (native ? nativeTargetReached(g.id, ch) : forumTargetReached(g.id, ch))) { await forumFinish(g, active, c.n > 1 ? `сверка ${c.n}` : ''); return; }
  const same = mine && root.L2PayOutcome?.unchanged?.({ revision: p.revision, adena: p.adena ?? null }, ch) === true, ack = native ? nativeAck(g) : forumAck(g);
  if (same && ack?.refused) { await travelDrop(g, `сервер отказал в телепорте${ack.status ? ' (HTTP ' + ack.status + ')' : ''}`, active, native && isTeleport()); return; }
  if (same && now - (+p.sentAt || 0) >= TRAVEL_GAP) {
    if (c.ackStart || c.same && now - c.sameAt >= TRAVEL_GAP) {
      env.rec('B', 'локации', c.ackStart ? `${name}: телепорт не прошёл — ревизия героя (${p.revision}) и адена не изменились (сверка после Старта игрока); оплаты не было, перелёт снят, работаю дальше`
        : `${name}: телепорт не прошёл — ревизия героя (${p.revision}) и адена не изменились в двух сверках с промежутком ${Math.round((now - c.sameAt) / 1000)} с; оплаты не было, перелёт снят, работаю дальше`);
      await env.setRt({ ...travelClose(g), zonePend: null }); travelForget(); return;
    }
    if (!c.same) c = { ...c, same: 1, sameAt: now };
  } else if (mine && ch.revision > p.revision) {
    c = { ...c, same: 0, sameAt: 0 };
    const a = p.from, b = travelPlace(ch), adena = adenaOf(ch.adena);
    // 20.43 (доводка 21.10): вывод «оплата прошла» записывает прибытие (travelPaidFinish) — иначе тот же телепорт покупался снова
    if (travelMoved(p, ch)) {
      await travelPaidFinish(g, active, `${name}: ответ телепорта не подтверждён, но герой уже в другом месте (было ${a.zone || a.city || '?'}, сейчас ${b.zone || b.city || '?'}) — перелёт состоялся, оплату считаю прошедшей; прибытие в «${name}» записано (зону уточнит карта), повтора нет`);
      return;
    }
    if (travelPaid(p, ch)) {
      await travelPaidFinish(g, active, `${name}: ответ телепорта не подтверждён, но адены убыло на цену телепорта (до клика ${p.adena}, сейчас ${adena}, цена ${p.cost}; другие оплаты всё это время запрещены) — оплату считаю прошедшей; прибытие в «${name}» записано (зону уточнит карта), повтора нет`);
      return;
    }
    if (travelStayed(p, ch) && now - (+p.sentAt || 0) >= TRAVEL_GAP) {
      if (c.ackStart || c.stay && now - c.stayAt >= TRAVEL_GAP) {
        env.rec('B', 'локации', `${name}: телепорт не прошёл — ревизия героя выросла (${p.revision} → ${ch.revision}) другим действием, а адена та же и герой там же (${a.zone || a.city}) ${c.ackStart ? '(сверка после Старта игрока)' : `в двух сверках с промежутком ${Math.round((now - c.stayAt) / 1000)} с`}; прежний запрос с той ревизией уже не применится — оплаты не было, перелёт снят, работаю дальше`);
        await env.setRt({ ...travelClose(g), zonePend: null }); travelForget(); return;
      }
      if (!c.stay) c = { ...c, stay: 1, stayAt: now };
    } else c = { ...c, stay: 0, stayAt: 0 };
  }
  if (c.ackStart && mine) {
    env.rec('B', 'локации', `${name}: после паузы «Проверьте положение героя» игрок нажал Старт — исход перелёта сервер так и не подтвердил (ревизия ${ch.revision}, до клика ${p.revision}); квитанцию закрываю по решению игрока, маршрут снят, повторного клика по ней не было`);
    await env.setRt({ ...travelClose(g), zonePend: null, zoneGoT: now }); travelForget(); return;
  }
  if (fresh) env.rec('B', 'локации', `${name}: ${why}; повторная оплата запрещена. На паузу не встаю: сверяю положение героя раз в 30–60 с (бесплатный GET /character), платное до итога не трачу`);
  if (now - c.t0 >= TRAVEL_GIVEUP && !(c.same && now - c.sameAt < 2 * TRAVEL_GAP_MAX) && !(c.stay && now - c.stayAt < 2 * TRAVEL_GAP_MAX)) {
    // 20.43 (доводка 21.10): сначала — сама сверка без метки; метка gaveUp — только когда пауза действительно записана
    g.check = c; await env.setRt(travelKeep(g)); if (!active()) return;
    const char = env.rt.char, start = +env.rt.dailyStart || 0;
    const saved = await forumUncertain(`${c.why || why}: исход перелёта в «${name}» не удалось сверить за 30 мин (${c.n} сверок)`, active);
    // пауза записана: фон записал эту паузу (saved — по хранилищу, а не по on=false вкладки), pauseBot выключил бота, а герой, запуск
    // (manualKickAt), номер Старта и квитанция — те же. gaveUp — была пауза «Проверьте положение героя»: квитанцию закроет только
    // следующий Старт игрока (ackStart выше, по rt.dailyStart). Перезагрузка во время ожидания сервера (serverWait), отказ фона в паузе
    // и ⏹ Стоп / ⏸ Пауза игрока, пока pauseBot ждал сервер, метку не ставят — правка меню и Старт квитанцию «по решению игрока» не закроют
    if (saved && env.on === false && env.rt.char === char && env.rt.manualKickAt === kick && (+env.rt.dailyStart || 0) === start && travelIsCheck(g)) {
      g.check = { ...c, gaveUp: Date.now(), gaveUpStart: start }; await env.setRt(travelKeep(g)); return;
    }
    // сервер лежал — pauseBot ждал его, а не встал на паузу (и метки gaveUp нет): ещё 5 мин сверки после его возвращения
    if (active()) { g.check = { ...c, t0: Date.now() - TRAVEL_GIVEUP + 5 * 60000 }; await env.setRt(travelKeep(g)); }
    return;
  }
  g.check = c; await env.setRt(travelKeep(g));
  env.setStatus(travelStatus(name, c, now));   // 20.43 (доводка 21.10): одна форма с ожиданием — одна строка журнала на смену смысла
}
// 20.43 (ревью au/travel): один шаг открытой квитанции перелёта — из ядра (loopTravel) в любом режиме и из zoneGoStep. Новых кликов
// нет: ACK своего запроса (тот же герой, Старт и маршрут) — прибытие, иначе сверка по серверу (travelVerify). Старая запись внутри
// zoneGo (до этой правки) сначала переносится в rt.travelCheck
async function travelStep() {
  const T = travelOpen(); if (!T) return;
  const kick = env.rt.manualKickAt, char = env.rt.char;
  const live = () => env.on !== false && env.tabOwner !== false && env.canAct?.() !== false && env.rt.manualKickAt === kick && env.rt.char === char;
  if (!live()) return;
  if (T !== env.rt.travelCheck) { await env.setRt({ travelCheck: T, zoneGo: null }); if (env.rt.travelCheck !== T) return; }
  const active = () => live() && env.rt.travelCheck === T;
  if (!active()) return;
  await travelSettle(T, active, T.nativeTp ? 'результат обычного телепорта не подтверждён' : forumPendingFor(T) ? 'прибытие не подтверждено' : 'квитанция телепорта с прошлого запуска не подтверждена');
}
// исход клика: ACK своего запроса — прибытие; явный отказ или нет ответа — сверка (отказ снимает перелёт только с подтверждением GET)
async function travelSettle(T, active, why) {
  const ack = T.nativeTp ? nativeAck(T) : forumAck(T);
  if (ack?.ok) await forumFinish(T, active);
  else await travelVerify(T, active, ack?.refused ? `сервер отказал в телепорте${ack.status ? ' (HTTP ' + ack.status + ')' : ''}` : why);
}

async function zoneGoStep() {                     // полёт: Телепорт → раскрыть город → «Телепорт» у нужной зоны
  // 20.43 (автономность, разбор 21.10; ревью au/travel): открыта квитанция перелёта (rt.travelCheck или старая внутри zoneGo) — клик
  // мог быть: новых кликов нет, ни этого маршрута, ни нового; вместо одной сверки и паузы — ACK этого запроса, иначе сверка по серверу
  if (travelOpen()) { await travelStep(); return; }
  const g = env.rt.zoneGo;
  if (!g) return;
  const kick = env.rt.manualKickAt, char = env.rt.char;
  const live = () => env.on !== false && env.tabOwner !== false && env.canAct?.() !== false && env.rt.manualKickAt === kick && env.rt.char === char;
  const active = () => live() && env.rt.zoneGo === g;
  if (!active()) return;
  // 10.0.22: после Маммона возвращаемся в Ashen, не считаем произвольную карту успешным возвратом.
  if (g.id === 'ashen_bastion' && g.returnPath === '/ashen-bastion.html') {
    const fail = async why => { if (active()) { env.rec('B', 'локации', `Ashen Bastion: ${why} — фарм в другой зоне остановлен`); await env.pauseBot(`Возврат в Ashen Bastion: ${why}`, { fault: true }); } };   // 20.43: сервер лежит — ждём его
    if (location.pathname === g.returnPath) { await env.setRt({ zoneGo: null, zonePend: null, zone: 'ashen_bastion' }); return; }
    if (g.sentAt) { await fail('результат телепорта не подтверждён; повторная оплата запрещена'); return; }
    if (!isTeleport()) { env.setStatus('Маммон: возвращаюсь в Ashen Bastion'); location.href = '/teleport.html'; await env.sleep(4000); return; }
    await tpCitiesReady(); if (!active()) return;
    const btn = await env.waitX(() => { const b = env.$q('.l2-teleport-miru-tp-btn[data-teleport-id="ashen_bastion"]'); return env.shown(b) && !b.disabled ? b : null; }, 8000, 100);
    if (!active()) return;
    if (!btn) { await fail('кнопка телепорта не найдена'); return; }
    const cost = teleportCost(btn.closest('.l2-teleport-miru-surroundings-row, .l2-teleport-miru-city-row'));
    const budget = !cost.why && await teleportBudget(cost.price, active); if (!active()) return;
    if (cost.why || budget) { await fail(cost.why || budget); return; }
    g.sentAt = Date.now(); const saved=await env.setRt({ zoneGo: g, ...(cost.price > 0 ? { adenaSeen: null } : {}) }); if(env.rtCommit?!(await env.rtCommit()):saved?.ok===false){await fail('не удалось сохранить оплату');return;} if (!active()) return;
    env.fire(btn);
    await env.waitX(() => location.pathname === g.returnPath, 8000, 100); if (!active()) return;
    if (location.pathname === g.returnPath) await env.setRt({ zoneGo: null, zonePend: null, zone: 'ashen_bastion' });
    else await fail('игра не подтвердила возвращение');
    return;
  }
  // телепорта нет в «Телепорте», но есть кнопка на странице форума (как «Фарм ресурсов» → pavel_ruins)
  const viaUrl = g.url || (env.rt.zoneCat?.[g.id]?.forum && env.rt.zoneCat[g.id].url);
  if (viaUrl && (g.forum || !env.rt.zoneCat?.[g.id]?.city)) {
    // 20.43 (автономность, разбор 21.10): квитанция есть — клик мог быть: ни нового клика, ни паузы — её ведёт travelStep (выше, в
    // начале шага; раньше квитанция с прошлого Старта/маршрута сразу ставила паузу)
    const snapshot = await forumCharacter();
    if (!active()) return;
    const mine = !!snapshot && !!char && snapshot.name === char;
    if (mine && forumTargetReached(g.id, snapshot)) { await forumFinish(g, active); return; }
    // 20.43: квитанции нет — клика не было (она пишется до клика): без паузы, перелёт снят (а)
    if (isMap() && g.t && env.rt.zoneGoT >= g.t) { await travelDrop(g, 'прошлая попытка перелёта прервана до оплаты', active); return; }
    if (!mine || !snapshot.id || !Number.isSafeInteger(snapshot.revision)) { await travelDrop(g, 'не удалось сверить персонажа и локацию перед оплатой', active); return; }
    if (location.pathname + location.search !== viaUrl) { env.setStatus(`Локации: лечу в ${zoneName(g.id)} (через форум)`); location.href = viaUrl; await env.sleep(4000); return; }
    let fb = await env.waitX(() => env.$q(`[data-teleport-id="${g.id}"]`), env.isFarmPage() ? 2000 : 8000, 200);
    if (!active()) return;
    if (!fb && env.isFarmPage()) {                     // кнопка — внутри строки ресурса: раскрываем нужную (или по очереди все)
      await env.waitX(() => env.$q('.l2-farm-row__toggle'), 15000, 300);
      if (!active()) return;
      const rows = [...document.querySelectorAll('.l2-farm-row')];
      const want = rows.filter(r => g.res && (r.querySelector('.l2-farm-row__name')?.textContent || '').trim().toLowerCase() === g.res.toLowerCase());
      for (const row of [...want, ...rows.filter(r => !want.includes(r))]) {
        if (!active()) return;
        const t = row.querySelector('.l2-farm-row__toggle');
        if (!row.querySelector('.l2-farm-source')) { env.fire(t); await env.waitX(() => row.querySelector('.l2-farm-source'), 4000, 100); if (!active()) return; }
        const r = env.farmRowParse(row); if (r) env.farmSave([r]).catch(() => {});
        fb = row.querySelector(`[data-teleport-id="${g.id}"]`);
        if (fb) break;
        env.fire(t); await env.sleep(150);
      }
    }
    if (!active()) return;
    await env.setRt({ zoneGoT: Date.now(), zoneTried: { ...(env.rt.zoneTried || {}), [g.id + ':' + env.heroLvl()]: Date.now() } });
    if (!fb) { env.rec('B', 'локации', `${zoneName(g.id)}: кнопки телепорта на форуме нет`); await env.setRt({ zoneGo: null, rbZoneVisit: { ...(env.rt.rbZoneVisit || {}), [g.id]: Date.now() } }); location.href = '/map.html'; await env.sleep(3000); return; }
    if (!active()) return;
    const beforePay = await forumCharacter(); if (!active()) return;
    if (!beforePay || beforePay.name !== char || beforePay.id !== snapshot.id || !Number.isSafeInteger(beforePay.revision)) { await travelDrop(g, 'персонаж перед оплатой не подтверждён', active); return; }
    if (forumTargetReached(g.id, beforePay)) { await forumFinish(g, active); return; }
    const cost = forumTeleportCost(fb);
    const budget = !cost.why && await teleportBudget(cost.price, active, beforePay);
    if (!active()) return;
    if (cost.why || budget) { env.rec('B', 'локации', `${zoneName(g.id)}: ${cost.why || budget} — не телепортируюсь`); await env.setRt({ zoneGo: null, zoneBad: { ...(env.rt.zoneBad || {}), [g.id]: Date.now() } }); return; }
    env.rec('B', 'локации', `телепорт с форума → ${zoneName(g.id)}${g.why ? ' · ' + g.why : ''}`);
    if (!active()) return;
    // 20.43: адена и место до клика — для сверки «ничего не изменилось» (L2PayOutcome.unchanged) и «герой уже в другом месте».
    // Ревью au/travel: квитанция — в отдельном rt.travelCheck (копия маршрута), маршрут zoneGo снят той же записью до клика
    const T = { ...g, forumTp: { id: g.id, url: viaUrl, char, charId: beforePay.id, revision: beforePay.revision, adena: adenaOf(beforePay.adena), from: travelPlace(beforePay),
      cost: Number(fb.dataset.adenaCost), sentAt: Date.now(), nonce: Date.now() + ':' + Math.random().toString(36).slice(2), kick } };
    const saved = await env.setRt({ zoneGo: null, travelCheck: T, ...(cost.price > 0 ? { adenaSeen: null } : {}) });
    const activeT = () => live() && env.rt.travelCheck === T;
    if (env.rtCommit ? !(await env.rtCommit()) : saved?.ok === false) { await travelDrop(T, 'не удалось сохранить квитанцию до клика', activeT); return; }
    if (!activeT()) return;
    env.fire(fb);
    await env.waitX(() => forumAck(T) || location.pathname + location.search !== viaUrl, 6000, 200);
    if (!activeT()) return;
    await travelSettle(T, activeT, 'прибытие не подтверждено');   // 20.43: первая сверка — сразу, без паузы; отказ — только с GET
    return;
  }
  if (!isTeleport()) { env.setStatus(`Локации: лечу в ${zoneName(g.id)}`); location.href = '/teleport.html'; await env.sleep(4000); return; }
  await tpCitiesReady();                          // v4.58: раньше кнопку искали в недорисованном списке → «кнопки телепорта нет»
  if (!active()) return;
  const tpBtn = () => { const b = env.$q(`.l2-teleport-miru-tp-btn[data-teleport-id="${g.id}"]`); return env.shown(b) ? b : null; };
  let btn = tpBtn();
  if (!btn) {
    const city = g.city || env.rt.zoneCat?.[g.id]?.city;
    const keys = [city, ...[...document.querySelectorAll('.l2-teleport-miru-city-btn[data-surroundings-key]')].map(b => b.dataset.surroundingsKey)].filter((k, i, a) => k && a.indexOf(k) === i);
    for (const k of keys) {                        // сначала «свой» город, потом остальные — зона могла переехать
      const cb = env.$q(`.l2-teleport-miru-city-btn[data-surroundings-key="${k}"]`); if (!cb) continue;
      env.fire(cb);
      btn = await env.waitX(tpBtn, k === city ? 4000 : 2000, 100);
      if (!active()) return;
      if (btn) break;
    }
  }
  const tried = { ...(env.rt.zoneTried || {}), [g.id + ':' + env.heroLvl()]: Date.now() };
  if (!btn) { env.rec('B', 'локации', `${zoneName(g.id)}: кнопки телепорта нет — пробую следующую зону`); await env.setRt({ zoneGo: null, zoneTried: tried, zoneBad: { ...(env.rt.zoneBad || {}), [g.id]: Date.now() }, zoneLvlT: 0, rbZoneVisit: { ...(env.rt.rbZoneVisit || {}), [g.id]: Date.now() } }); location.href = '/map.html'; await env.sleep(3000); return; }
  // 15.10: цена и валюта нужны из текущей строки перед кликом; отсутствие числа не означает бесплатный телепорт.
  const tr = btn.closest('.l2-teleport-miru-surroundings-row, .l2-teleport-miru-city-row'), tc = curOf(tr), cost = teleportCost(tr);
  const before=cost.why?null:await forumCharacter();if(!active())return;
  // 20.13 (ревизия 17.10, шаг 5, farm/NAV-1): «возврат» в зону, где герой уже стоит (story.finish после неудачи у NPC, раз в 30 мин),
  // оплачивался заново. Сервер подтверждает, что герой уже в этой зоне, — завершаем перелёт без клика и без оплаты
  if(before&&before.name===char&&nativeTargetReached(g.id,before)){await forumFinish(g,active);return;}
  const budget = !cost.why && await teleportBudget(cost.price, active, before);
  if (!active()) return;
  if (cost.why || budget) {
    env.rec('B', 'локации', `${zoneName(g.id)}: ${cost.why || budget} — не телепортируюсь`);
    await env.setRt({ zoneGo: null, zoneTried: tried, zoneBad: { ...(env.rt.zoneBad || {}), [g.id]: Date.now() }, zoneLvlT: 0, zoneCat: { ...(env.rt.zoneCat || {}), [g.id]: { ...(env.rt.zoneCat?.[g.id] || {}), price: cost.price, ...tc } } });
    location.href = '/map.html'; await env.sleep(3000); return;
  }
  // 20.43 (автономность, разбор 21.10): до клика оплаты не было — без паузы, перелёт снят (а); в квитанцию — адена и место до клика
  if(!before||before.name!==char||!before.id||!Number.isSafeInteger(before.revision)){await travelDrop(g,'персонаж перед телепортом не подтверждён',active,true);return;}
  // ревью au/travel: квитанция — в отдельном rt.travelCheck (копия маршрута), маршрут zoneGo снят той же записью до клика
  const T={...g,nativeTp:{id:g.id,char,charId:before.id,revision:before.revision,adena:adenaOf(before.adena),from:travelPlace(before),cost:cost.price,kick,sentAt:Date.now(),nonce:Date.now()+':'+Math.random().toString(36).slice(2)}};
  const saved=await env.setRt({zoneGo:null,travelCheck:T,zoneTried:tried,zoneGoT:Date.now(),...(cost.price>0?{adenaSeen:null}:{})});
  const activeT=()=>live()&&env.rt.travelCheck===T;
  if(env.rtCommit?!(await env.rtCommit()):saved?.ok===false){await travelDrop(T,'не удалось сохранить квитанцию до клика',activeT,true);return;}
  if (!activeT()) return;
  env.rec('B', 'локации', `телепорт → ${zoneName(g.id)}${g.why ? ' · ' + g.why : ''}`);
  env.fire(btn);
  // 10.0 (аудит фарма): переход на карту бывает дольше 2,5 с — удачный платный полёт писался «не улетели» и зона «плохой» на 6 ч. Ждём до 8 с
  await env.waitX(() => !isTeleport() || /недостат|not enough/i.test(document.body.innerText.slice(-4000)) || null, 8000, 200);
  if(!activeT())return;
  // 20.43: ACK этого запроса — прибытие; явный отказ или нет ответа — сверка по серверу (первая — сразу), бот не встаёт на паузу;
  // ревью au/travel: отказ снимает перелёт только вместе с GET «ревизия и адена те же»
  await travelSettle(T,activeT,'прибытие не подтверждено');
}

// 10.0.7 (лог 13.10 13:21, Necropolis of Devotion): бой в подземелье (spawnId sdms_<подземелье>_NNN) кончился не победой (ошибка загрузки,
// босс, «не по зубам») — бот шёл «на карту» (/map.html), а оттуда «назад в подземелье» (+2 страницы, ≈3–10 с, и риск входа заново).
// Код игры (battle.js resolveBattleReturnUrl): «Назад на карту» из боя в подземелье сама игра ведёт на /dungeon.html?dungeonId=…, карту
// бот бы ждал 8 с впустую. 10.0.13: прямой URL пропускал /game/battle/leave и оставлял незаконченный бой на сервере.
// Выходим через обработчик игры и ждём его маршрут: подземелье после отхода/победы, город после поражения.
const dungeonOfBattle = () => { const m = (location.search || '').match(/spawnId=sdms_(.+?)_\d+(?:&|$)/i); return m ? decodeURIComponent(m[1]) : (env.heroAt?.()?.dung || ''); };
async function toMap() {
  const dg = env.cfg.catMode && /spawnId=sdms_/i.test(location.search) ? dungeonOfBattle() : '';
  if (dg) {
    if (!env.on) return;
    env.setStatus('Возврат в подземелье');
    const back = await env.waitFor(() => ['#battle-defeat-tocity', '#battle-back-map', '#battle-victory-continue']
      .map(s => env.$q(s)).find(b => b && (!env.shown || env.shown(b))) || env.byText(env.BACK)
      || env.$q('#wap-bottom a[href="/city.html"], #l2-nav-bottom a[href="/city.html"]'), 3000);
    if (!env.on) return;
    if (back) {
      env.fire(back);
      if (await env.waitFor(() => !/\/battle\.html/i.test(location.pathname), 8000)) return;
    }
    // Не прячем незавершённый бой сменой URL: следующий тик повторит игровой выход.
    if (env.on) env.setStatus('Выход из боя не завершён');
    return;
  }
  env.setStatus('Возврат на карту');
  const back = env.$q('#battle-back-map') || await env.waitFor(() => env.byText(env.BACK), 3000);
  if (back) env.fire(back); else location.href = '/map.html';
  if (!(await env.waitFor(isMap, 8000)) && env.on) { location.href = '/map.html'; await env.sleep(3000); }
}

async function toOutskirts() {
  env.setStatus('Выход в Окрестности');
  const link = env.$q('#l2-nav-bottom a[data-nav-role="outskirts"]') || env.byText(/^Окрестности$/i, 'a,span');
  if (link) env.fire(link.closest('a') || link); else location.href = '/map.html';
  if (!(await env.waitFor(isMap, 8000)) && env.on) { location.href = '/map.html'; await env.sleep(3000); }
}

function zoneByLoc(loc) {
  const L = String(loc || '').toLowerCase().trim(), cat = env.rt.zoneCat || {};
  if (!L) return null;
  let e = Object.entries(cat).find(([, c]) => (c.name || '').toLowerCase() === L);
  if (!e) e = Object.entries(cat).find(([, c]) => { const n = (c.name || '').toLowerCase(); return n && (n.includes(L) || L.includes(n)) && n.length > 4; });
  return e ? e[0] : null;
}

async function goOutskirts() {                   // с любой страницы — в «Окрестности»
  const me = env.meHp();
  if (me && me.pct < 50 && await env.restoreVitals(`HP ${me.pct | 0}%`)) return;   // после смерти/в городе — сначала восстановиться
  env.setStatus('В Окрестности');
  const link = env.$q('#l2-nav-bottom a[data-nav-role="outskirts"], a[data-nav-role="outskirts"]');
  if (link) env.fire(link); else location.href = '/map.html';
  if (!(await env.waitFor(isMap, 8000)) && env.on) { location.href = '/map.html'; await env.sleep(3000); }
}

const isCity = () => /\/city\.html/i.test(location.pathname);
 return { onForumTeleportNet, travelPending, travelStep, nativeNonce, curOf, isMap, zoneRows, isTeleport, tpCitiesReady, zoneCatalogScan, zoneHere, zoneCatThin, zoneName, zoneTrack, zoneRate, kpdOf, catAll, zoneForLevel, zonePick, zoneGoStep, toMap, dungeonOfBattle, toOutskirts, zoneByLoc, goOutskirts, isCity };
 };
})(globalThis);
