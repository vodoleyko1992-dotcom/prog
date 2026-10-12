/* L2wap v7: isolated navigation feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.navigation = function create_navigation(env) {
const isMap = () => /\/map\.html/i.test(location.pathname);

// 8.0.3 (эпики, ревью): валюта цены телепорта (.l2-teleport-miru-price-currency, «аден»). Раньше читалось только число — логово за
// Coin of Luck оплатилось бы мимо лимита. curT — подпись как есть (нет элемента — undefined: старая разметка/каталог), cur — как epics.unitOf
const curOf = row => { const el = row?.querySelector('.l2-teleport-miru-price-currency'); if (!el) return {};
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

async function tpCitiesReady() {
  const cities = () => document.querySelectorAll('.l2-teleport-miru-city-btn[data-surroundings-key]').length;
  let n0 = -1, stable = 0;
  for (let t0 = Date.now(); Date.now() - t0 < 12000 && stable < 3; ) { const n = cities(); stable = n && n === n0 ? stable + 1 : 0; n0 = n; await env.sleep(250); }
  return cities();
}

async function zoneCatalogScan() {                // раскрыть все города и переписать их Окрестности (бесплатно)
  // v4.57: журнал 07:27 — скан занял 50 мс и нашёл 1 зону: список городов ещё дорисовывался скриптом страницы,
  // а Окрестности города подгружаются только по нажатию (и могут очищаться, когда раскрыт другой город).
  // Теперь: ждём, пока список городов перестанет меняться; раскрываем каждый город и читаем его зоны сразу.
  env.setStatus('Локации: составляю список зон телепорта');
  const cities = () => [...document.querySelectorAll('.l2-teleport-miru-city-btn[data-surroundings-key]')];
  await tpCitiesReady();
  const cat = { ...(env.rt.zoneCat || {}) };
  let opened = 0;
  for (const b of cities()) {
    if (!env.on) return;
    const key = b.dataset.surroundingsKey;
    const blk = b.closest('.l2-teleport-miru-city-block') || document.querySelector(`.l2-teleport-miru-city-block[data-surroundings-key="${key}"]`);
    const sur = () => blk?.querySelector('.l2-teleport-miru-surroundings');
    const rows = () => blk?.querySelectorAll('.l2-teleport-miru-surroundings-row [data-teleport-id]').length || 0;
    if (!rows() || sur()?.hidden) { env.fire(b); opened++; await env.waitX(() => rows() > 0 && !sur()?.hidden, 4000, 100); }
    Object.assign(cat, zoneRows());               // читаем после каждого города: раскрытие другого может их скрыть
    // v5.1: и сам город — тоже цель телепорта («Town of Giran», «Rune Township» — так их называет форум рецептов)
    const cr = blk?.querySelector('.l2-teleport-miru-city-row'), ctb = cr?.querySelector('.l2-teleport-miru-tp-btn[data-teleport-id]');
    const cl = (cr?.querySelector('.l2-teleport-miru-city-label')?.textContent || '').trim();
    if (ctb && cl) cat[ctb.dataset.teleportId] = { ...(cat[ctb.dataset.teleportId] || {}), name: cl, city: key, town: true, price: +((cr.querySelector('.l2-teleport-miru-price-num')?.textContent || '').replace(/\D/g, '') || 0), ...curOf(cr) };
    await env.sleep(env.rnd(120, 250));
  }
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
  const near = +(String(env.$q?.('#map-mob-page-ind')?.textContent || '').match(/(\d+)\s*\//)?.[1] || 1) <= 1;
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
  const lo = L - (env.cfg.lvlBelow ?? 3), hi = L + Math.min(env.cfg.lvlAbove ?? 15, 15);   // v4.59: окно из меню; для ВЫБОРА ЗОНЫ — не выше +15 (v5.3.1)
  const lv = env.pageItems().filter(i => !i.champ && i.lvl).map(i => i.lvl);
  if (!lv.length || lv.some(l => l >= lo && l <= hi)) return false;    // на этой странице есть свои — дело не в уровне
  if (Date.now() - (env.rt.zoneLvlT || 0) < 5 * 60000) return false;
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
  await env.setRt({ zoneGo: { id, t: Date.now(), why }, zoneGoT: 0 });
  location.href = '/teleport.html'; await env.sleep(4000);
  return true;
}

function zonePick() {
  const L = env.heroLvl(), cat = catAll(), cur = env.rt.zone, trial = Math.max(15, env.cfg.zoneTrial || 20);
  if (!L) return null;   // 7.1.30: уровень героя ещё не прочитан — не выбирать зону по окну −3…15
  const badZ = env.rt.zoneBad || {}, notBad = id => Date.now() - (badZ[id] || 0) > 6 * 3600000;   // 7.1.30: зона без кнопки/не по карману — 6 ч не пробуем
  const wLo = L - (env.cfg.lvlBelow ?? 3), wHi = L + Math.min(env.cfg.lvlAbove ?? 15, 15);   // v4.59: то же окно, что в меню (зона — не выше +15)
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

async function zoneGoStep() {                     // полёт: Телепорт → раскрыть город → «Телепорт» у нужной зоны
  const g = env.rt.zoneGo;
  // телепорта нет в «Телепорте», но есть кнопка на странице форума (как «Фарм ресурсов» → pavel_ruins)
  const viaUrl = g.url || (env.rt.zoneCat?.[g.id]?.forum && env.rt.zoneCat[g.id].url);
  if (viaUrl && (g.forum || !env.rt.zoneCat?.[g.id]?.city)) {
    if (location.pathname + location.search !== viaUrl) { env.setStatus(`Локации: лечу в ${zoneName(g.id)} (через форум)`); location.href = viaUrl; await env.sleep(4000); return; }
    let fb = await env.waitX(() => env.$q(`[data-teleport-id="${g.id}"]`), env.isFarmPage() ? 2000 : 8000, 200);
    if (!fb && env.isFarmPage()) {                     // кнопка — внутри строки ресурса: раскрываем нужную (или по очереди все)
      await env.waitX(() => env.$q('.l2-farm-row__toggle'), 15000, 300);
      const rows = [...document.querySelectorAll('.l2-farm-row')];
      const want = rows.filter(r => g.res && (r.querySelector('.l2-farm-row__name')?.textContent || '').trim().toLowerCase() === g.res.toLowerCase());
      for (const row of [...want, ...rows.filter(r => !want.includes(r))]) {
        const t = row.querySelector('.l2-farm-row__toggle');
        if (!row.querySelector('.l2-farm-source')) { env.fire(t); await env.waitX(() => row.querySelector('.l2-farm-source'), 4000, 100); }
        const r = env.farmRowParse(row); if (r) env.farmSave([r]).catch(() => {});
        fb = row.querySelector(`[data-teleport-id="${g.id}"]`);
        if (fb) break;
        env.fire(t); await env.sleep(150);
      }
    }
    await env.setRt({ zoneGoT: Date.now(), zoneTried: { ...(env.rt.zoneTried || {}), [g.id + ':' + env.heroLvl()]: Date.now() } });
    if (!fb) { env.rec('B', 'локации', `${zoneName(g.id)}: кнопки телепорта на форуме нет`); await env.setRt({ zoneGo: null, rbZoneVisit: { ...(env.rt.rbZoneVisit || {}), [g.id]: Date.now() } }); location.href = '/map.html'; await env.sleep(3000); return; }
    env.rec('B', 'локации', `телепорт с форума → ${zoneName(g.id)}${g.why ? ' · ' + g.why : ''}`);
    env.fire(fb);
    await env.waitX(() => !/\/forum/i.test(location.pathname), 6000, 200);
    if (/\/forum/i.test(location.pathname)) {      // страница не сменилась: ошибка рядом с кнопкой — не улетели; иначе — на карту
      const msg = [fb.closest('.l2-farm-source, li, [class*="row"]'), ...document.querySelectorAll('[role="alert"], [class*="toast"], [class*="notice"], [class*="-msg"]')]
        .map(x => x?.textContent || '').join(' ');
      if (/недостат|не хвата|not enough|помилк|ошибк/i.test(msg)) {
        env.rec('B', 'локации', `${zoneName(g.id)}: не улетели (${msg.match(/[^.]*(недостат|не хвата|not enough|помилк|ошибк)[^.]*/i)?.[0].trim().slice(0, 80) || 'ошибка'})`);
        await env.setRt({ zoneGo: null, zonePend: null, rbZoneVisit: { ...(env.rt.rbZoneVisit || {}), [g.id]: Date.now() } });
      } else await env.setRt({ zoneGo: null });
      location.href = '/map.html'; await env.sleep(3000);
    }
    return;
  }
  if (!isTeleport()) { env.setStatus(`Локации: лечу в ${zoneName(g.id)}`); location.href = '/teleport.html'; await env.sleep(4000); return; }
  await tpCitiesReady();                          // v4.58: раньше кнопку искали в недорисованном списке → «кнопки телепорта нет»
  const tpBtn = () => { const b = env.$q(`.l2-teleport-miru-tp-btn[data-teleport-id="${g.id}"]`); return env.shown(b) ? b : null; };
  let btn = tpBtn();
  if (!btn) {
    const city = g.city || env.rt.zoneCat?.[g.id]?.city;
    const keys = [city, ...[...document.querySelectorAll('.l2-teleport-miru-city-btn[data-surroundings-key]')].map(b => b.dataset.surroundingsKey)].filter((k, i, a) => k && a.indexOf(k) === i);
    for (const k of keys) {                        // сначала «свой» город, потом остальные — зона могла переехать
      const cb = env.$q(`.l2-teleport-miru-city-btn[data-surroundings-key="${k}"]`); if (!cb) continue;
      env.fire(cb);
      btn = await env.waitX(tpBtn, k === city ? 4000 : 2000, 100);
      if (btn) break;
    }
  }
  const tried = { ...(env.rt.zoneTried || {}), [g.id + ':' + env.heroLvl()]: Date.now() };
  if (!btn) { env.rec('B', 'локации', `${zoneName(g.id)}: кнопки телепорта нет — пробую следующую зону`); await env.setRt({ zoneGo: null, zoneTried: tried, zoneBad: { ...(env.rt.zoneBad || {}), [g.id]: Date.now() }, zoneLvlT: 0, rbZoneVisit: { ...(env.rt.rbZoneVisit || {}), [g.id]: Date.now() } }); location.href = '/map.html'; await env.sleep(3000); return; }
  // 8.0.3 (эпики, ревью): перед нажатием — валюта в строке. Явно не адена (Coin of Luck, значок 4037) — не летим; подпись есть, но
  // непонятная — тоже нет. Элемента валюты нет или он без подписи (старая разметка, значок) — как раньше (логово эпика строже: epicLair)
  const tr = btn.closest('.l2-teleport-miru-surroundings-row, .l2-teleport-miru-city-row'), tc = curOf(tr), tp = +((tr?.querySelector('.l2-teleport-miru-price-num')?.textContent || '').replace(/\D/g, '') || 0);
  if (tp > 0 && (tc.cur === 'Coin of Luck' || (tc.curT && tc.cur !== 'аден'))) {
    env.rec('B', 'локации', `${zoneName(g.id)}: телепорт не за адену (${tp.toLocaleString('ru')} ${tc.curT || 'валюта не подписана'}) — Coin of Luck бот не тратит`);
    await env.setRt({ zoneGo: null, zoneTried: tried, zoneBad: { ...(env.rt.zoneBad || {}), [g.id]: Date.now() }, zoneLvlT: 0, zoneCat: { ...(env.rt.zoneCat || {}), [g.id]: { ...(env.rt.zoneCat?.[g.id] || {}), price: tp, ...tc } } });
    location.href = '/map.html'; await env.sleep(3000); return;
  }
  await env.setRt({ zoneTried: tried, zoneGoT: Date.now() });
  env.rec('B', 'локации', `телепорт → ${zoneName(g.id)}${g.why ? ' · ' + g.why : ''}`);
  env.fire(btn);
  // 10.0 (аудит фарма): переход на карту бывает дольше 2,5 с — удачный платный полёт писался «не улетели» и зона «плохой» на 6 ч. Ждём до 8 с
  await env.waitX(() => !isTeleport() || /недостат|not enough/i.test(document.body.innerText.slice(-4000)) || null, 8000, 200);
  if (isTeleport()) {                              // остались на месте: не хватило адены или другая причина
    const msg = /недостат|not enough/i.test(document.body.innerText.slice(-4000)) ? 'не хватает адены' : 'не улетели';
    env.rec('B', 'локации', `${zoneName(g.id)}: ${msg}`);
    await env.setRt({ zoneGo: null, zonePend: null, zoneBad: { ...(env.rt.zoneBad || {}), [g.id]: Date.now() }, zoneLvlT: 0, rbZoneVisit: { ...(env.rt.rbZoneVisit || {}), [g.id]: Date.now() } });
    location.href = '/map.html'; await env.sleep(3000);
  }
}

async function toMap() {
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
 return { curOf, isMap, zoneRows, isTeleport, tpCitiesReady, zoneCatalogScan, zoneHere, zoneCatThin, zoneName, zoneTrack, zoneRate, kpdOf, catAll, zoneForLevel, zonePick, zoneGoStep, toMap, toOutskirts, zoneByLoc, goOutskirts, isCity };
 };
})(globalThis);
