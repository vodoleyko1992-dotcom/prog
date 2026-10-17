/* 9.0 (игрок 11.10: «разработай полностью механизм автофарма (авто кач) исходя из КПД локации, от 1-х лвлов до хай лвла»).
   Модель КПД локации: сколько EXP в час даст зона герою уровня L ещё ДО первого боя там — по встроенной базе (zone-db.js, живая игра 11.10)
   и по своим замерам (rt.mobVal — EXP и время на каждый вид моба, rt.zoneMobs — мобы, увиденные на карте зоны).
   Чистые функции без DOM и без записи: navigation (выбор зоны), popup (таблица зон и маршрут кача) и тесты зовут их одинаково.

   Факты базы: у мобов L2WAP HP = 180 + 48·ур., M.Def = 12 + 7·ур., P.Def = 15 + 8·ур. — только от уровня (400 мобов, 11.10). Поэтому
   время на моба почти не зависит от вида (моб +15 ур. живёт ≈1,5× дольше), а EXP за моба различается в 2–3 раза даже на одном уровне
   (64 ур.: Past Knight 11,6 тыс., Plando 5 тыс.). КПД зоны = EXP за моба ÷ время на моба по мобам, которых бот там будет бить.
   Время на моба: t = s · (W + (1 − W)·k) · g(d), где s — своё время на моба своего уровня (замер), k — во сколько раз моб «толще»
   (HP × защита против моба уровня героя), W — доля хода/перехода цепочки, не зависящая от HP, g(d) — поправка за разницу уровней
   d = моб − герой (промахи/сопротивление; по умолчанию +5 %/ур., дальше — по своим замерам). Ниже героя больше чем на 5 ур. — штраф EXP
   Interlude (5/6)^(разница − 5). */
(function (root) {
 'use strict';
 const W = 0.4, G_UP = 0.05, MIN_N = 3, CAL_AGE = 3 * 86400000, ABOVE_MAX = 15;
 const db = () => root.L2ZONE_DB || null;
 const lc = s => String(s || '').toLowerCase().trim();
 const med = xs => { const a = xs.filter(v => v > 0).sort((p, q) => p - q), m = a.length >> 1; return !a.length ? 0 : a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
 const lin = (ab, l, d) => ab ? ab[0] + ab[1] * l : d;
 let byLc = null, curve = null, curveDb = null;
 function index() {                                 // имя (в нижнем регистре) → [уровень, EXP]; кривая EXP по уровню (медиана базы)
  const D = db(); if (!D) return null;
  if (curveDb !== D) {
   byLc = {}; for (const [n, v] of Object.entries(D.mobs || {})) byLc[lc(n)] = v;
   const per = {}; for (const [l, e] of Object.values(D.mobs || {})) if (e > 0) (per[l] = per[l] || []).push(e);
   curve = Object.entries(per).map(([l, es]) => [+l, med(es)]).sort((a, b) => a[0] - b[0]); curveDb = D;
  }
  return byLc;
 }
 function expAt(l) {                                // EXP моба уровня l без своих цифр — по соседям из базы (между точками — линейно)
  if (!index() || !curve.length) return 0;
  if (l <= curve[0][0]) return curve[0][1] * Math.max(0.2, l / curve[0][0]);
  for (let i = 1; i < curve.length; i++) if (l <= curve[i][0]) { const [a, ea] = curve[i - 1], [b, eb] = curve[i]; return ea + (eb - ea) * (l - a) / (b - a); }
  return curve[curve.length - 1][1];
 }
 // уровень и EXP вида: база → кэш спавнов бота (rt.spawns: id → [имя, уровень]); EXP без цифр — по кривой со скидкой 10 % (est)
 function mobOf(name, o) {
  const I = index() || {}, k = lc(name), v = I[k];
  let lvl = v?.[0] || 0, exp = v?.[1] || 0;
  if (!lvl && o?.rt?.spawns) { if (!o._sp) { o._sp = {}; for (const s of Object.values(o.rt.spawns)) if (s && s[1]) (o._sp[lc(s[0])] = o._sp[lc(s[0])] || []).push(+s[1]); } lvl = med(o._sp[k] || []); }
  if (!lvl) return null;
  return exp > 0 ? { lvl, exp, est: false } : { lvl, exp: expAt(lvl) * 0.9, est: true };
 }
 function thick(l, L, mage) {                       // во сколько раз дольше бить моба уровня l, чем моба уровня героя (HP × защита)
  const D = db() || {}, df = mage === false ? D.pdef : D.mdef;
  const hp = x => lin(D.hp, x, 180 + 48 * x), de = x => lin(df, x, 12 + 7 * x);
  return Math.max(0.05, hp(Math.max(1, l)) * de(Math.max(1, l))) / Math.max(1, hp(Math.max(1, L)) * de(Math.max(1, L)));
 }
 const pen = (L, l) => L - l > 5 ? Math.pow(5 / 6, L - l - 5) : 1;
 const gPrior = d => 1 + G_UP * Math.max(0, d);
 // верх окна для выбора зоны: не выше героя + zoneAbove (меню, 10), у слабых — уже (1–11 ур.: +3, 20: +5, 40: +10)
 const aboveBase = (L, cfg) => Math.max(0, Math.min(+(cfg?.zoneAbove ?? 10), Math.max(3, Math.round(L / 4))));

 // обучение по своим замерам: s — секунд на моба уровня героя; g(d) — фактическая поправка за разницу уровней; above — до скольких
 // уровней выше себя герой реально бьёт мобов (≥5 боёв на виде без «не по зубам»); после 2+ смертей за час — на 3 ур. осторожнее
 function learn(o, L) {
  const V = o?.rt?.mobVal || {}, now = o?.now || Date.now(), mage = o?.mage, pts = [];
  for (const [k, v] of Object.entries(V)) {
   if (k.startsWith('ч:') || !v || !mine(v, o) || !(v.n >= MIN_N) || !(v.sec > 0) || !(v.exp > 0) || (v.t && now - v.t > CAL_AGE)) continue;
   const m = mobOf(k, o); if (!m) continue;
   const d = m.lvl - L, base = W + (1 - W) * thick(m.lvl, L, mage);
   pts.push({ k, d, n: v.n, sec: v.sec / v.n, base, hard: !!o.rt.hardMobs?.[k] });
  }
  const near = pts.filter(p => Math.abs(p.d) <= 2);
  const s = med((near.length ? near : pts).map(p => p.sec / (p.base * gPrior(p.d)))) || 0;
  const g = {};
  if (s) { const by = {}; for (const p of pts) if (p.d > 2) (by[p.d] = by[p.d] || []).push(p.sec / (p.base * s));
   for (const [d, xs] of Object.entries(by)) { const n = xs.length; g[d] = (n * Math.max(0.8, Math.min(4, med(xs))) + 3 * gPrior(+d)) / (n + 3); } }
  let above = aboveBase(L, o?.cfg);
  const ok = pts.filter(p => p.n >= 5 && !p.hard).map(p => p.d);
  if (ok.length) above = Math.max(above, Math.min(ABOVE_MAX, Math.max(...ok)));
  const deaths = [...new Set([...(o?.rt?.deathLog || []), ...(o?.rt?.deaths || [])])].filter(t => now - t < 3600000).length;
  if (deaths >= 2) above = Math.max(1, above - 3);
  // 20.13 (ревизия 17.10, шаг 5, farm/KPD-1): окно модели — не шире фильтра целей mobfarm: сверху не выше «выше героя» из меню (lvlAbove),
  // снизу не ниже героя −5 (правило игрока 13.10: FA с мобов ниже −5 не падает; как mobfarm.lowCap). Раньше зона оценивалась по мобам
  // +10…+15 и −3…−N, которых бот там не бьёт, — автофарм летел за прогнозом, который не сбывался
  const capA = +o?.cfg?.lvlAbove; if (o?.cfg?.lvlAbove != null && Number.isFinite(capA) && capA >= 0) above = Math.min(above, capA);
  const below = Math.min(+o?.cfg?.lvlBelow > 0 ? +o.cfg.lvlBelow : 5, 5);
  return { s: s || 5, sMeasured: !!s, g, above, below, n: pts.length, deaths };
 }
 const gOf = (cal, d) => cal?.g?.[d] ?? gPrior(d);
 // сабклассы (11.10): замер другого класса героя (метка c ≠ rt.prof) — не наш: другой уровень, скиллы и кот
 const mine = (v, o) => !v?.c || !o?.rt?.prof || v.c === o.rt.prof;

 // EXP/с одного вида моба у героя L: по базе, а если вид уже бит ≥3 раз — замер с весом боёв (база как 3 «виртуальных» боя)
 function mobEps(name, L, o, cal) {
  const m = mobOf(name, o); if (!m) return null;
  const d = m.lvl - L, t = cal.s * (W + (1 - W) * thick(m.lvl, L, o?.mage)) * gOf(cal, d);
  const pred = m.exp * pen(L, m.lvl) / t * (m.est ? 0.8 : 1);   // EXP без цифр — по кривой уровня: доверяем меньше
  const v = o?.rt?.mobVal?.[lc(name)];
  const meas = v && mine(v, o) && v.n >= MIN_N && v.sec > 0 && v.exp > 0 && !(v.t && (o.now || Date.now()) - v.t > CAL_AGE) ? v.exp / v.sec : 0;
  return { name, lvl: m.lvl, d, exp: m.exp, est: m.est, eps: meas ? (v.n * meas + 3 * pred) / (v.n + 3) : pred, meas: !!meas };
 }

 // оценка зоны: мобы точки из базы + мобы, которых бот сам видел в этой зоне (rt.zoneMobs); в окне [L − lvlBelow, L + above], без
 // «не по зубам» (rt.hardMobs); КПД = половина — среднее трёх лучших видов (карта бот выбирает сам), половина — среднее всех видов
 // окна (цепочка «Охотиться дальше» даёт случайного соседа); видов в окне меньше трёх — цепочка чаще уводит к чужим (× 0,73 / 0,87)
 function zoneEst(id, L, o) {
  if (!L || !index()) return null;
  const z = db().zones?.[id], cal = o?.cal || learn(o, L);
  const names = [...new Set([...(z?.m || []), ...((o?.rt?.zoneMobs?.[id]) || [])])];
  if (!names.length) return null;
  const lo = L - cal.below, hi = L + cal.above, hard = o?.rt?.hardMobs || {}, now = o?.now || Date.now();
  const list = names.map(n => mobEps(n, L, o, cal)).filter(x => x && x.lvl >= lo && x.lvl <= hi && !(hard[lc(x.name)] && now - (hard[lc(x.name)].t || 0) < 2 * 3600000))
   .sort((a, b) => b.eps - a.eps);
  if (!list.length) return { id, exp: 0, n: 0, mobs: [], why: `мобов ${lo}–${hi} ур. нет` };
  const avg = xs => xs.reduce((a, x) => a + x.eps, 0) / xs.length;
  const cov = list.length >= 3 ? 1 : 0.6 + 0.4 * list.length / 3;
  const eps = (0.5 * avg(list.slice(0, 3)) + 0.5 * avg(list)) * cov;
  const lv = list.map(x => x.lvl);
  const top = list.slice(0, 2).map(x => `${x.name} ${x.lvl}`).join(', ');
  return { id, exp: eps * 3600, n: list.length, lo: Math.min(...lv), hi: Math.max(...lv), mobs: list, price: z?.p || 0,
   why: `по базе: мобы ${Math.min(...lv)}–${Math.max(...lv)} ур. (${list.length} вид.${list.some(x => x.meas) ? ', есть свои замеры' : ''}), лучшие — ${top}` };
 }
 // каталог зон из базы — тем же видом, что rt.zoneCat из «Телепорта» (name/price/lo/hi), чтобы автофарм знал все зоны без чтения страницы
 function cat() {
  const D = db(), out = {}; if (!D) return out;
  for (const [id, z] of Object.entries(D.zones || {})) out[id] = { name: z.n, price: z.p, lo: z.lo, hi: z.hi, db: true };
  return out;
 }
 // зоны по КПД для героя L (лучшие первыми); skip — зоны, которые не рассматривать
 function rank(L, o, skip) {
  const cal = learn(o, L), oo = { ...o, cal };
  return Object.keys(db()?.zones || {}).filter(id => !skip?.(id)).map(id => zoneEst(id, L, oo)).filter(x => x && x.exp > 0).sort((a, b) => b.exp - a.exp);
 }
 // маршрут кача: лучшая зона по базе на каждом уровне from…to (без своих замеров), соседние уровни с той же зоной — одной строкой
 function route(o, from = 1, to = 80) {
  const out = [];
  const oo = { ...o, rt: { ...(o?.rt || {}), mobVal: {}, deathLog: [], deaths: [] } };
  for (let L = from; L <= to; L++) {
   const r = rank(L, oo), last = out[out.length - 1];
   const keep = last?.id && r.find(x => x.id === last.id);   // как автофарм: перелёт только ради +10 % и больше
   const b = keep && r[0] && keep.exp * 1.10 >= r[0].exp ? keep : r[0];
   if (last && b && last.id === b.id) { last.to = L; last.expTo = b.exp; continue; }
   out.push(b ? { from: L, to: L, id: b.id, name: db().zones[b.id].n, price: b.price, exp: b.exp, expTo: b.exp, mobs: `${b.lo}–${b.hi}` } : { from: L, to: L, id: null });
  }
  return out;
 }
 const ready = () => !!index();
 root.L2Kpd = { ready, expAt, mobOf, thick, pen, aboveBase, learn, mobEps, zoneEst, cat, rank, route };
})(globalThis);
