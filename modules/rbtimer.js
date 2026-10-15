/* L2wap 10.0.2: «⏱ Таймеры боссов» — когда воскреснет РБ / эпик (игрок 12.10: «кулдаун респа боссов обычных вроде бы 8 часов…
   раздел с таймерами боссов исходя из того, когда их убили»).
   Что отдаёт игра (живые ответы 12.10 12:38, код teleport.js / разметка «Рейдовые боссы»):
   - GET /game/raid-bosses?page=N (15 на странице, 197 РБ, по возрастанию уровня) → bosses[] {spawnId, name, level, bossType:'raid',
     isAlive, adenaCost, canAttack, attackBlockedReasonUk}. **Ни времени смерти, ни времени респа у РБ нет**;
   - GET /game/epic-bosses → то же + respawnHours (АК/Ядро/Орфен 12, Закен 36, Баюм 60…), в строке игры «· респ. 12 ч»; времени смерти нет;
   - GET /game/spawn/<id>/info — цифры и дроп, времени тоже нет.
   Поэтому время смерти бот узнаёт сам: свой убитый РБ — точно (combat → kill), чужой — между «последний раз видел живым» и «впервые
   увидел мёртвым» (опрос списка раз в N мин, список «Рейдовые боссы» при туре, ответы игры через hook). Воскрес — то же окно; пара
   «умер в [a, b] → воскрес в [c, d]» даёт длительность респа в [c − b, d − a]. Свой респ у каждого РБ (ob), общий по всем РБ — медиана,
   иначе cfg.rbRespH (8 ч: замер 12.10 из облака — 11 РБ ур. 35–79, у всех респ 7,98–8,04 ч от смерти, т. е. ровно 8 ч). У эпиков — respawnHours игры.
   Память: rt.rbTimer = { b: { spawnId: { n имя, l ур., e эпик, rh респ игры ч, al жив, ls видел последний раз, ch впервые видел в этом
   состоянии, pv последний раз видел в прежнем, dl/dh окно смерти, k свой килл, ob [[lo, hi] мс]…, pg стр. списка } }, pg: { стр.: [мин ур., макс ур.] } } */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.rbtimer = function create_rbtimer(env) {
const H = 3600000, MIN = 60000;
const OB_MAX = 6;            // замеров респа на босса
const OB_WIDE = 3 * H;       // окно замера шире 3 ч — ничего не говорит о респе
const LAG_MS = 10 * MIN;     // «жив» через ≤10 мин после смерти — список игры отстал (РБ так быстро не встаёт)
const defH = () => { const v = +env.cfg?.rbRespH; return v > 0 && v < 200 ? v : 8; };
const state = () => env.rt?.rbTimer && typeof env.rt.rbTimer === 'object' ? env.rt.rbTimer : { b: {} };
const ssNum = k => { try { return +sessionStorage.getItem(k) || 0; } catch (e) { return 0; } };
let pollT = ssNum('l2bot-rbtT'), tourPollT = ssNum('l2bot-rbtTourT'), busy = false;
// Свой GET обходит hook: его персональные цены/доступность нельзя писать после смены героя или сабкласса.
const pollContext = () => JSON.stringify([env.rt?.char || '', env.rt?.classCur?.prof ?? null, env.rt?.classCur?.slot ?? null]);

// ---------- чистые функции (их же берёт меню) ----------
// новые сведения: rows [{id, n, l, al, e, rh, pg}] → { T, ev }. Своё состояние не трогает
function observe(T0, rows, now = Date.now()) {
  const B = { ...(T0?.b || {}) }, ev = [];
  for (const r of rows || []) {
    if (!r || !r.id || typeof r.al !== 'boolean') continue;
    const p = B[r.id], x = { ...(p || {}), n: String(r.n || p?.n || r.id).slice(0, 40), l: +r.l || p?.l || 0 };
    if (r.e) x.e = 1;
    if (+r.rh > 0) x.rh = +r.rh;
    if (+r.pg > 0) x.pg = +r.pg;
    if (!p || typeof p.al !== 'boolean') {
      Object.assign(x, { al: r.al, ch: now, pv: 0 });
      if (!r.al) Object.assign(x, { dl: 0, dh: now });   // мёртв с первого взгляда — когда убит, неизвестно (только «не позже»)
    } else if (p.al !== r.al && !r.al) {               // был жив → убит между «видел живым» и сейчас (свой килл — точно)
      const last = p.ls || now, k = p.k && p.k >= last - MIN && p.k <= now ? p.k : 0;
      Object.assign(x, { al: false, ch: now, pv: last, dl: k || last, dh: k || now });
      ev.push({ id: r.id, kind: 'dead', x });
    } else if (p.al !== r.al) {                         // был мёртв → воскрес
      if (p.k > 0 && now >= p.k && now - p.k < LAG_MS) continue;        // только что убит (свой килл), а список ещё «жив» — не верим
      const last = p.ls || now;
      if (p.dl > 0 && p.dh > 0) { const lo = Math.max(0, last - p.dh), hi = now - p.dl; if (hi > 0 && hi - lo <= OB_WIDE) x.ob = [...(p.ob || []), [lo, hi]].slice(-OB_MAX); }
      Object.assign(x, { al: true, ch: now, pv: last }); delete x.dl; delete x.dh; delete x.k;
      ev.push({ id: r.id, kind: 'alive', x });
    }
    x.ls = now; B[r.id] = x;
  }
  return { T: { ...(T0 || {}), b: B }, ev };
}
// свой убитый босс — время смерти точно
function killed(T0, id, now = Date.now(), n, l) {
  const B = { ...(T0?.b || {}) }, p = B[id] || {};
  B[id] = { ...p, n: String(n || p.n || id).slice(0, 40), l: +l || p.l || 0, al: false, ch: now, pv: p.al === false ? p.pv || 0 : p.ls || 0, dl: now, dh: now, k: now, ls: now };
  return { ...(T0 || {}), b: B };
}
// 10.0.2 (игрок 12.10: «как синхронизировать таймер на основном боте со слежкой?»): файл слежки из облака (снимки списка по строке:
// {t, st: {spawnId: [имя, ур., isAlive, bossType]}}) → таймеры, как если бы бот сам опрашивал список в эти моменты
function replay(snaps) {
  let T = { b: {} };
  for (const s of [...(snaps || [])].filter(x => x && +x.t > 0 && x.st && typeof x.st === 'object').sort((a, b) => a.t - b.t)) {
    const t = +s.t < 1e12 ? +s.t * 1000 : +s.t;
    T = observe(T, Object.entries(s.st).map(([id, v]) => Array.isArray(v) ? { id, n: v[0], l: +v[1] || 0, al: typeof v[2] === 'boolean' ? v[2] : null, e: v[3] === 'epic' } : null), t).T;
  }
  return T;
}
// чужие таймеры (файл слежки, другой персонаж) к своим: по каждому боссу — более свежее наблюдение, замеры респа — вместе
function merge(A, Bt) {
  const out = { ...(A || {}), b: { ...(A?.b || {}) } };
  for (const [id, y] of Object.entries(Bt?.b || {})) {
    const x = out.b[id];
    const fresh = !x || (y.ls || 0) > (x.ls || 0) ? { ...(x || {}), ...y } : { ...y, ...x };
    const ob = [...(x?.ob || []), ...(y.ob || [])].filter((o, i, a) => Array.isArray(o) && a.findIndex(z => z[0] === o[0] && z[1] === o[1]) === i).slice(-OB_MAX);
    if (ob.length) fresh.ob = ob; else delete fresh.ob;
    // Уточнять можно только пересекающиеся окна одной смерти. Старый точный
    // килл не заменяет более новое окно следующего цикла респа.
    if (x && x.al === false && y.al === false) {
      const overlap = x.dh > 0 && y.dh > 0 && Math.max(x.dl || 0, y.dl || 0) <= Math.min(x.dh, y.dh);
      const width = z => z.dl > 0 ? z.dh - z.dl : Infinity;
      const best = overlap ? (width(x) <= width(y) ? x : y) : ((y.ls || 0) > (x.ls || 0) ? y : x);
      for (const key of ['dl', 'dh', 'k']) { if (best[key] != null) fresh[key] = best[key]; else delete fresh[key]; }
    }
    if (fresh.al === true) { delete fresh.dl; delete fresh.dh; delete fresh.k; }
    out.b[id] = fresh;
  }
  return out;
}
// текст файла: таймеры бота (rt.rbTimer / { rbTimer }) или снимки слежки (JSON-массив или по строке)
function parseFile(txt) {
  const s = String(txt || '').trim(); if (!s) return null;
  try { const j = JSON.parse(s);
    if (j?.b && typeof j.b === 'object') return j;
    if (j?.rbTimer?.b) return j.rbTimer;
    if (j?.rt?.rbTimer?.b) return j.rt.rbTimer;
    if (Array.isArray(j)) return replay(j);
    if (j?.st) return replay([j]);
  } catch (e) {}
  const lines = s.split(/\r?\n/).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(x => x?.st);
  return lines.length ? replay(lines) : null;
}
// окно респа [lo, hi] мс по замерам: пересечение (респ ровный) или общий разброс (респ случайный, rnd)
function band(ob) {
  if (!Array.isArray(ob) || !ob.length) return null;
  let lo = 0, hi = Infinity;
  for (const [a, b] of ob) { lo = Math.max(lo, a); hi = Math.min(hi, b); }
  return lo <= hi ? { lo, hi } : { lo: Math.min(...ob.map(o => o[0])), hi: Math.max(...ob.map(o => o[1])), rnd: true };
}
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
// общий респ обычных РБ: медианы границ узких замеров всех РБ (≥ 3 замера)
function globalResp(T) {
  const all = Object.values(T?.b || {}).filter(x => !x.e && !(x.rh > 0)).flatMap(x => x.ob || []).filter(([a, b]) => b - a <= 2 * H);
  if (all.length < 3) return null;
  const lo = med(all.map(o => o[0])), hi = med(all.map(o => o[1]));
  return lo <= hi ? { lo, hi, n: all.length } : { lo: hi, hi: lo, n: all.length };
}
function respOf(T, id, def = defH()) {
  const x = T?.b?.[id] || {};
  if (x.rh > 0) return { lo: x.rh * H, hi: x.rh * H, src: 'game' };
  const own = band(x.ob);
  if (own) return { ...own, src: 'own', n: x.ob.length };
  const g = !x.e && globalResp(T);
  if (g) return { ...g, src: 'all' };
  return { lo: def * H, hi: def * H, src: 'guess' };
}
// таймер босса: жив / мёртв и когда воскреснет (at.lo — 0, если время смерти неизвестно: только «не позже at.hi»)
function timerOf(T, id, now = Date.now(), def = defH()) {
  const x = T?.b?.[id];
  if (!x || typeof x.al !== 'boolean') return null;
  const R = respOf(T, id, def);
  if (x.al) return { id, n: x.n, l: x.l, e: !!x.e, al: true, up: x.pv ? [x.pv, x.ch] : null, ls: x.ls, R };
  const dh = x.dh || x.ch || now, at = { lo: x.dl > 0 ? x.dl + R.lo : 0, hi: dh + R.hi };
  return { id, n: x.n, l: x.l, e: !!x.e, al: false, dl: x.dl || 0, dh, own: !!x.k, at, late: now > at.hi, soon: at.lo > 0 && now >= at.lo && now <= at.hi, R, ls: x.ls };
}
const pad = v => String(v).padStart(2, '0');
function hm(t, now = Date.now()) {
  if (!(t > 0)) return '?';
  const d = new Date(t), s = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return Math.abs(t - now) > 20 * H || new Date(now).getDate() !== d.getDate() ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${s}` : s;
}
function dur(ms) {
  if (!(ms > 0)) return '0 мин';
  const m = Math.round(ms / MIN), h = Math.floor(m / 60);
  return h ? `${h} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`;
}
const durH = (lo, hi) => Math.abs(hi - lo) < 15 * MIN ? `≈${dur((lo + hi) / 2)}` : `${dur(lo)}–${dur(hi)}`;
// «убит» и «воскреснет» словами
function deathTxt(tm, now = Date.now()) {
  if (!tm || tm.al) return '';
  return tm.own ? `убит мной в ${hm(tm.dl, now)}` : tm.dl > 0 ? (tm.dh - tm.dl < 2 * MIN ? `убит в ${hm(tm.dh, now)}` : `убит между ${hm(tm.dl, now)} и ${hm(tm.dh, now)}`) : `убит до ${hm(tm.dh, now)}`;
}
function upTxt(tm, now = Date.now()) {
  if (!tm) return '';
  if (tm.al) return tm.up ? `жив (воскрес между ${hm(tm.up[0], now)} и ${hm(tm.up[1], now)})` : 'жив';
  const a = tm.at;
  // 15.10: прогноз уже прошёл, но свежий список всё ещё показывает «убит». Сервер не отдаёт нового времени смерти/респа.
  if (tm.late) return tm.ls >= a.hi && now - tm.ls < 30 * MIN
    ? `всё ещё убит по списку игры (проверено ${hm(tm.ls, now)}); новый респ неизвестен`
    : `прогноз респа истёк (${hm(a.hi, now)}); жду свежий список${tm.ls ? `, проверено ${hm(tm.ls, now)}` : ''}`;
  if (!a.lo) return `не позже ${hm(a.hi, now)} (через ${dur(a.hi - now)})`;
  if (a.hi - a.lo < 15 * MIN) return `≈${hm(a.hi, now)} (через ${dur(a.hi - now)})`;
  return tm.soon ? `в любую минуту до ${hm(a.hi, now)}` : `${hm(a.lo, now)}–${hm(a.hi, now)} (через ${dur(a.lo - now)})`;
}
const SRC = { game: 'игра', own: 'мой замер', all: 'по всем РБ', guess: 'догадка' };
const respTxt = R => R ? `${durH(R.lo, R.hi)} · ${SRC[R.src] || R.src}${R.n ? ` (${R.n})` : ''}${R.rnd ? ', случайный' : ''}` : '';
// список для меню: сначала мёртвые по времени воскрешения, потом «уже должен», потом живые
function table(T, now = Date.now(), opt = {}) {
  const lo = opt.lo ?? -Infinity, hi = opt.hi ?? Infinity, def = opt.def ?? defH();
  const out = Object.keys(T?.b || {}).map(id => timerOf(T, id, now, def)).filter(t => t && (opt.all || t.e || (t.l >= lo && t.l <= hi)));
  const rank = t => t.al ? 2 : t.late ? 1 : 0;
  return out.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? (a.at.lo || a.at.hi) - (b.at.lo || b.at.hi) : rank(a) === 1 ? a.at.hi - b.at.hi : a.l - b.l));
}
// ближайший воскресающий мёртвый РБ в окне уровней (для строки тура)
function nextUp(lo, hi, now = Date.now()) {
  const t = table(state(), now, { lo, hi }).find(x => !x.al && !x.e && !x.late);
  return t ? { id: t.id, n: t.n, l: t.l, t: t.at.lo || t.at.hi, txt: upTxt(t, now) } : null;
}
// воскресшие после момента t (по опросу списка) — тур может не досиживать простой
const revivedSince = t => Object.entries(state().b || {}).filter(([, x]) => x.al === true && x.pv > 0 && x.ch > t).map(([id]) => id);

// ---------- запись ----------
const winOf = () => { const L = +env.heroLevel?.() || +env.rt?.lvl || 0, w = +env.RB_WIN || 15; return L ? [L - w, L + w] : [-Infinity, Infinity]; };
async function save(rows, src, extra = {}, meta = null) {
  const now = Date.now(), o = observe(state(), rows, now), T = meta ? { ...o.T, ...meta } : o.T, ev = o.ev;
  await env.setRt({ rbTimer: T, ...extra });
  const [lo, hi] = winOf();
  for (const e of ev) {
    const x = e.x; if (!x.e && (x.l < lo || x.l > hi)) continue;   // в журнал — только РБ своего окна и эпики
    const tm = timerOf(T, e.id, now);
    if (e.kind === 'dead') env.rec('B', 'таймеры', `${x.n} (${x.l}) ${deathTxt(tm, now)} — воскреснет ${upTxt(tm, now)} · респ ${respTxt(tm.R)} [${src}]`);
    else env.rec('B', 'таймеры', `${x.n} (${x.l}) воскрес между ${hm(x.pv, now)} и ${hm(x.ch, now)}${x.ob?.length && ev.length < 20 ? ` · респ по замерам ${respTxt(respOf(T, e.id))}` : ''} [${src}]`);
  }
  return ev;
}
// ответ игры /game/raid-bosses | /game/epic-bosses (свой опрос или запрос страницы через hook): строки + те же сведения в rt.rbList
function rowsOf(j) {
  const a = Array.isArray(j?.bosses) ? j.bosses.filter(b => b && typeof b === 'object' && b.spawnId) : [];
  return a.map(b => ({ id: String(b.spawnId), n: b.name, l: +b.level || 0, al: b.isAlive === true ? true : b.isAlive === false ? false : null,
    e: b.bossType === 'epic', rh: +b.respawnHours || 0, pg: b.bossType === 'epic' ? 0 : +j.page || 0, b }));
}
async function listNote(j, src = 'page') {
  const rows = rowsOf(j); if (!rows.length) return [];
  const T0 = state(), page = +j.page || 0, raid = rows.filter(r => !r.e);
  const extra = {}; let meta = null;
  if (raid.length && page) {
    const lv = raid.map(r => r.l).filter(Boolean);
    if (lv.length) meta = { pg: { ...(T0.pg || {}), [page]: [Math.min(...lv), Math.max(...lv)] }, tp: +j.totalPages || T0.tp || 0 };
    // тур выбирает по rt.rbList — освежаем «жив / убит» у тех же РБ (та же строка, что на странице «Рейдовые боссы»)
    const L = { ...(env.rt.rbList || {}) }, now = Date.now(); let ch = 0;
    raid.forEach((r, i) => { if (r.al == null) return; const p = L[r.id], b = r.b, ad = +b.adenaCost, col = +b.coinOfLuckCost > 0;
      // После недавнего убийства список игры может отставать: очередь и таймер верят одной смерти.
      const previous = T0.b?.[r.id], alive = r.al && previous?.al === false && previous.k > 0 && now >= previous.k && now - previous.k < LAG_MS ? false : r.al;
      L[r.id] = { ...(p || {}), name: String(b.name || p?.name || '').slice(0, 60), lvl: r.l || p?.lvl || 0, alive, status: alive ? 'Живой' : 'Убит',
        price: col ? +b.coinOfLuckCost : Number.isFinite(ad) ? ad : p?.price || 0, unit: col ? 'Coin of Luck' : 'аден', priceText: col ? `(${+b.coinOfLuckCost} Coin of Luck)` : Number.isFinite(ad) ? `(Аден ${ad})` : p?.priceText || '',
        deny: b.canAttack === false ? String(b.attackBlockedReasonUk || 'игра не пускает').replace(/^Недоступно:\s*/i, '').slice(0, 60) : '', page, ord: page * 1000 + i, t: now };
      ch++; });
    if (ch) extra.rbList = L;
  }
  return save(rows, src, extra, meta);
}
// строки страницы «Рейдовые боссы» (raid.rbRowsParse): { spawnId: {name, lvl, alive, page} }
function domNote(map, src = 'список') {
  const rows = Object.entries(map || {}).map(([id, x]) => ({ id, n: x.name, l: x.lvl, al: typeof x.alive === 'boolean' ? x.alive : null, pg: x.page }));
  return rows.length ? save(rows, src) : Promise.resolve([]);
}
async function kill(id, n, l) {
  if (!/^l2dop_rb_\d+$/.test(String(id || ''))) return;   // бой без spawnId (имя вместо id) — не босс списка
  const now = Date.now(), T = killed(state(), id, now, n, l), tm = timerOf(T, id, now);
  await env.setRt({ rbTimer: T });
  env.rec('B', 'таймеры', `${tm.n} (${tm.l}) убит мной в ${hm(now, now)} — воскреснет ${upTxt(tm, now)} · респ ${respTxt(tm.R)}`);
}

// ---------- опрос списка (только GET, страницы своего окна уровней + эпики) ----------
async function getJson(path, active) {
  try { const r = await env.gameGet(path); if (!active() || !r?.ok) return null; const j = await r.json(); return active() && Array.isArray(j?.bosses) ? j : null; } catch (e) { return null; }
}
// Пустая очередь тура проверяется чаще общего наблюдения: только страницы своего окна.
function tourPages() {
  const level = +env.heroLevel?.() || +env.rt?.lvl || 0, cap = +env.RB_WIN || 15;
  if (!(level > 0) || !Number.isFinite(level)) return [];
  const lo = level - Math.min(env.cfg.rbMaxBelow > 0 ? env.cfg.rbMaxBelow : cap, cap);
  const hi = level + Math.min(env.cfg.rbMaxAbove ?? cap, cap);
  const pageOf = value => Number.isInteger(+value) && +value > 0 ? +value : 0;
  let pages = Object.values(env.rt.rbList || {}).filter(row => row && +row.lvl >= lo && +row.lvl <= hi).map(row => pageOf(row.page)).filter(Boolean);
  if (!pages.length) pages = Object.entries(state().pg || {}).filter(([, range]) => Array.isArray(range) && Number.isFinite(+range[0]) && Number.isFinite(+range[1]) && +range[0] <= hi && +range[1] >= lo).map(([page]) => pageOf(page)).filter(Boolean);
  if (!pages.length) return [];
  const first = Math.min(...pages), last = Math.max(...pages);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
async function tourTick({ active: callerActive } = {}) {
  const context = pollContext(), active = () => pollContext() === context && !!callerActive?.();
  if (typeof callerActive !== 'function' || !active() || busy || Date.now() - tourPollT < 30000) return false;
  const pages = tourPages();
  if (!pages.length || !active()) return false;
  tourPollT = Date.now(); busy = true;
  try { sessionStorage.setItem('l2bot-rbtTourT', String(tourPollT)); } catch (e) {}
  let updated = false;
  try {
    for (const page of pages) {
      if (!active()) break;
      let response;
      try {
        const r = await env.gameGet(`/game/raid-bosses?page=${page}`);
        if (!active()) break;
        if (!r?.ok) continue;
        response = await r.json();
      } catch (e) { continue; }
      if (!active()) break;
      if (+response?.page !== page || !rowsOf(response).some(row => !row.e && typeof row.al === 'boolean')) continue;
      await listNote(response, 'тур');
      updated = true;
      if (!active()) break;
    }
  } finally {
    busy = false;
    if (!active()) { tourPollT = 0; try { sessionStorage.setItem('l2bot-rbtTourT', '0'); } catch (e) {} }
  }
  return updated;
}
async function tick() {
  if (env.cfg.rbTimers === false || busy) return false;
  const context = pollContext(), active = () => env.cfg.rbTimers !== false && pollContext() === context;
  const every = Math.max(5, +env.cfg.rbTimerMin || 10) * MIN;
  if (Date.now() - pollT < every) return false;
  pollT = Date.now(); busy = true; try { sessionStorage.setItem('l2bot-rbtT', String(pollT)); } catch (e) {}
  let pages = 0;
  try {
    const [lo, hi] = winOf(), pg = state().pg || {};
    // первая страница, где есть РБ не слабее окна (список игры — по возрастанию уровня); не знаем — с первой
    let p = +Object.keys(pg).map(Number).sort((a, b) => a - b).find(k => (pg[k]?.[1] || 0) >= lo) || 1;
    for (let i = 0; i < 16 && p && active(); i++) {
      const j = await getJson(`/game/raid-bosses?page=${p}`, active); if (!j || !active()) break;
      await listNote(j, 'опрос'); pages++;
      if (!active()) break;
      const lv = j.bosses.map(b => +b.level || 0).filter(Boolean);
      if (!lv.length || Math.max(...lv) > hi || p >= (+j.totalPages || p)) break;
      p++; await env.sleep(800 + Math.random() * 700);
    }
    const e = active() ? await getJson('/game/epic-bosses', active) : null;
    if (e && active()) { await listNote(e, 'опрос'); pages++; }
  } finally {
    busy = false;
    if (!active()) { pollT = 0; try { sessionStorage.setItem('l2bot-rbtT', '0'); } catch (e) {} }
  }
  return pages > 0;
}

return { replay, merge, parseFile, observe, killed, band, globalResp, respOf, timerOf, table, nextUp, revivedSince, hm, dur, deathTxt, upTxt, respTxt, rowsOf, listNote, domNote, kill, tick, tourTick, state };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
