/* L2wap v7: isolated epics feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.epics = function create_epics(env) {
const location = env.routeLocation || root.location;
// 8.0.3 (эпики, разбор 11.10 — логи 4ee00a04/d089c7e2, снимок 75dac78f): сначала безопасность. Coin of Luck (предмет 4037) — ценная
// валюта (донат, немного падает из Old Box и за TvT): «0» = не тратить никогда; любая трата CoL — только через epicPayGate
// (свежий список с сервера, жив, игра пускает, цифры босса и вердикт «по силам», известная цена, лимиты). Путь: эпик на этой карте —
// без телепорта → логово за адену (только с вердиктом «по силам») → «Телепорт» за CoL, не больше epicCoinPerBoss раз на одно появление
const H = 3600000, MIN = 60000, COL_ID = 4037;
const isEpicPage = () => location.pathname === env.EPIC_URL;

const epicOn = () => !!env.cfg.epicMode;

const epicNum = id => +((String(id || '').match(/_rb_(\d+)$/) || [])[1] || 0);

const epicById = id => { const n = epicNum(id); return n ? env.EPICS.find(e => e.ids.includes(n)) || null : null; };

const epicByName = nm => { const t = String(nm || '').split(/[·•(]/)[0].trim(); return t ? env.EPICS.find(e => e.re.test(t)) || null : null; };

const epicOf = k => env.EPICS.find(e => e.k === k) || null;

const epicWant = () => String(env.cfg.epicList ?? '').split(',').map(s => s.trim()).filter(k => epicOf(k));

const epicIdOf = k => (env.rt.epicDb || {})[k]?.id || (epicOf(k) ? 'l2dop_rb_' + epicOf(k).ids[0] : '');

// время для журнала и меню: «20:58», дальше суток — «13.10 20:58»
const when = t => { if (!(t > 0)) return '?'; const d = new Date(t), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return Math.abs(t - Date.now()) > 20 * H ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${hm}` : hm; };

function epicPins() {
  const ids = env.aroundSig().ids;
  return [...document.querySelectorAll('.l2-map-mob-pin[data-spawn-id]')].map(b => {
    const t = b.getAttribute('title') || b.getAttribute('aria-label') || '', m = t.match(env.LV_RE), id = b.dataset.spawnId;
    const e = /--epic(?!_)/.test(b.className) || /эпик-босс|epic boss/i.test(t) ? (epicById(id) || epicByName(m ? m[2] : t)) : epicById(id);
    return e && !/--epic_guard/.test(b.className) ? { id, k: e.k, name: m ? m[2].trim() : e.nm, lvl: m ? +m[3] : 0, idx: ids.indexOf(id) } : null;
  }).filter(Boolean);
}

function epicGuards() {                             // миньоны зоны эпика: метки l2-map-mob-pin--epic_guard
  const ids = env.aroundSig().ids;
  return [...document.querySelectorAll('.l2-map-mob-pin--epic_guard[data-spawn-id]')].map(b => {
    const t = b.getAttribute('title') || b.getAttribute('aria-label') || '', m = t.match(env.LV_RE);
    return { id: b.dataset.spawnId, name: m ? m[2].trim() : t, lvl: m ? +m[3] : 0, idx: ids.indexOf(b.dataset.spawnId) };
  });
}

// 8.0.3 (снимок 75dac78f): строка списка — .l2-rb-row. Раньше closest('[class*="row"]') останавливался на .l2-rb-row__top, и подсказка
// «Недоступно: Epic Boss нижче дозволеного рівня.» (соседний .l2-rb-row__actions) не читалась, а имя бралось всей кнопкой
// («Королева Муравьев · рів. 40 · Убит · респ. 12 год»). Поля — точными селекторами, широкий разбор — запасной
const rowOf = n => n.closest?.('.l2-rb-row') || n.parentElement?.closest('li, tr, article, [class*="row"]:not(button):not(a), [class*="card"], [class*="item"]') || n.parentElement;
const txtOf = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const vis = el => !!el && !el.hidden && !el.closest?.('[hidden]');
// единица цены: Coin of Luck / адена; иначе '' — неизвестно (= отказ платить)
const unitOf = t => /coin|luck|монет|удач|\bcol\b/i.test(t || '') ? 'Coin of Luck' : /аден|adena/i.test(t || '') ? 'аден' : '';

function epicRowRead(e, row, id, btn) {
  const txt = txtOf(row);
  const st = row.querySelector('.l2-rb-row__status') || row.querySelector('[class*="status"]');
  const stT = txtOf(st).replace(/^[·•]\s*/, '');
  const dead = st ? !(/--alive/.test(st.className) || (/жив|alive/i.test(stT) && !/--dead/.test(st.className))) && /--dead|--respawn|мертв|мёртв|вбит|убит|dead|killed|респ|відрод|возрожд|через/i.test(st.className + ' ' + stT)
                  : /(мертв|мёртв|вбит|убит|dead|killed|респаун|відродж|возрожд)/i.test(txt) && !/жив|alive/i.test(txt);
  const hintEl = row.querySelector('.l2-rb-row__attack-hint') || row.querySelector('[class*="hint"], [class*="reason"]');
  const hint = vis(hintEl) ? txtOf(hintEl) : '';                    // скрытая подсказка — не запрет
  const pr = row.querySelector('.l2-rb-row__price') || row.querySelector('[class*="price"]'), prT = txtOf(pr);
  const lbl = row.querySelector('.l2-rb-row__label') || row.querySelector('[class*="label"], [class*="name"], [class*="title"]');
  const lvT = txtOf(row.querySelector('.l2-rb-row__level')) || txt, rsT = txtOf(row.querySelector('.l2-rb-row__respawn'));
  return { k: e.k, id: id || '', name: (txtOf(lbl).split(/\s+[·•]\s+/)[0] || e.nm).slice(0, 40),
    lvl: +((lvT.match(/(?:ур\.?|lv\.?|level|рів\.?)\s*(\d+)/i) || [])[1] || 0), alive: !dead, status: (stT || (dead ? 'мёртв' : '')).slice(0, 60),
    respH: +((rsT.match(/(\d+)\s*(?:год|ч|h)/i) || [])[1] || 0),
    deny: /недоступ|unavailable/i.test(hint) ? hint.replace(/^Недоступно:\s*/i, '').slice(0, 80) : '',
    priceKnown: !!pr && /\d/.test(prT), price: +(prT.replace(/\D/g, '') || 0), priceText: prT.slice(0, 40), priceUnit: unitOf(prT),
    tp: !!btn, page: +(new URLSearchParams(location.search).get('page') || 1), t: Date.now() };
}

function epicRowsParse() {
  const out = {};
  const put = (e, row, id, btn) => { if (e && row && !out[e.k]) out[e.k] = epicRowRead(e, row, id, btn); };
  const tpOf = (n, row) => [...(row?.querySelectorAll('.l2-rb-row__tp, button, a[href]') || []), n].find(b => /телепорт|teleport/i.test(txtOf(b)) && !b.disabled);
  for (const n of document.querySelectorAll('[data-spawn-id]')) {
    const row = rowOf(n), e = epicById(n.dataset.spawnId) || epicByName(txtOf(row?.querySelector('.l2-rb-row__label, [class*="label"], [class*="name"]')));
    put(e, row, n.dataset.spawnId, tpOf(n, row));
  }
  for (const b of document.querySelectorAll('button, a')) {      // запасной разбор: «Телепорт» рядом с именем эпика
    if (!/телепорт|teleport/i.test(b.textContent || '')) continue;
    const row = rowOf(b); if (!row) continue;
    const e = epicByName(txtOf(row.querySelector('.l2-rb-row__label, [class*="label"], [class*="name"], [class*="title"]'))) || env.EPICS.find(x => x.re.test(((row.innerText || '').split(/[·•\n]/)[0] || '').trim()));
    put(e, row, b.dataset?.spawnId || '', b);
  }
  return out;
}

function epicTpBtn(k) {                             // кнопка «Телепорт» нужного эпика на странице «Эпик боссы»
  const e = epicOf(k); if (!e) return null;
  const valid = b => b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && /телепорт|teleport/i.test(txtOf(b));
  // Название босса тоже button[data-spawn-id]; клик по нему НЕ телепортирует. Сначала .l2-rb-row__tp нужного spawnId
  for (const b of document.querySelectorAll('.l2-rb-row__tp[data-spawn-id]')) if (epicById(b.dataset.spawnId) === e && valid(b)) return b;
  for (const n of document.querySelectorAll('[data-spawn-id]')) {
    if (epicById(n.dataset.spawnId) !== e) continue;
    const row = rowOf(n), b = [...(row?.querySelectorAll('button, a[href]') || []), n].find(valid);
    if (b) return b;
  }
  for (const b of document.querySelectorAll('button, a')) {
    if (!valid(b)) continue;
    const row = rowOf(b);
    if (row && (epicByName(txtOf(row.querySelector('.l2-rb-row__label, [class*="label"], [class*="name"], [class*="title"]'))) === e || e.re.test(((row.innerText || '').split(/[·•\n]/)[0] || '').trim()))) return b;
  }
  return null;
}

// ---- состояние эпика: жив/мёртв, окно появления ----
// Времени смерти сервер не отдаёт (во всяком случае в первых 800 знаках ответа). Окно — [последний раз жив + N ч, впервые мёртв + N ч];
// не видели живым — известна только верхняя граница. Убит при нас (бот) или сервер прислал время — точно
function epicUntil(d, now = Date.now()) {
  if (!d || d.alive !== false) return null;
  if (d.respAt) return { lo: d.respAt, hi: d.respAt, exact: true, late: now > d.respAt };
  const h = (d.respH || 0) * H; if (!h) return null;
  if (d.killT) return { lo: d.killT + h, hi: d.killT + h, exact: true, late: now > d.killT + h };
  const dead = d.deadT || now, hi = dead + h, lo = d.aliveT && d.aliveT < dead ? d.aliveT + h : 0;
  return { lo, hi, exact: false, late: now > hi };
}
const epicUntilTxt = u => !u ? 'когда — неизвестно' : u.late ? `окно прошло (${when(u.hi)}) — проверяю` : u.exact ? `ровно в ${when(u.hi)}` : u.lo ? `между ${when(u.lo)} и ${when(u.hi)}` : `не позже ${when(u.hi)}`;

// новые сведения о эпике (сервер или страница): жив — запомнить время; впервые мёртв — время, платные заходы этой «жизни» обнуляются.
// 8.0.3 (эпики, ревью): lifeT — с какого момента знаем эту «жизнь» живой (HP прошлых заходов до неё — не про него)
function epicSeen(p, x, now = Date.now()) {
  p = p || {};
  const d = { ...p, ...x, seenT: now };
  if (x.alive === true) Object.assign(d, { aliveT: now, deadT: 0, killT: 0, respAt: 0, ...(p.alive !== true || !p.lifeT ? { lifeT: now } : {}) });
  else if (x.alive === false) Object.assign(d, { deadT: p.alive === false && p.deadT ? p.deadT : now, paidN: 0, deathsLife: 0, ...(p.alive !== false ? { retreatsLife: 0 } : {}) });
  d.until = epicUntil(d, now);
  return d;
}
// 8.0.3 (эпики, ревью): у эпика сменилась «жизнь» (впервые мёртв или снова жив) — HP прошлого захода (rt.rbWound, rt.rb[id].hpAfter)
// больше не про него: стираем, иначе вердикт через дни считал свежего босса недобитым (10 % вместо 100 %) и пускал платить
function lifeResetPatch(ids) {
  const W = { ...(env.rt.rbWound || {}) }, R = { ...(env.rt.rb || {}) }; let ch = false;
  for (const id of ids) { if (id && W[id]) { delete W[id]; ch = true; } if (id && R[id]) { delete R[id]; ch = true; } }
  return ch ? { rbWound: W, rb: R } : {};
}
const lifeTurn = (p, x) => x.alive !== undefined && (p?.alive ?? null) !== x.alive;

async function epicListScan() {                    // запасной путь (сервер 3 раза не ответил): страница «Эпик боссы»
  env.setStatus('Эпики: читаю список (Меню → Эпик боссы)');
  await env.waitX(() => document.querySelector('[data-spawn-id], .l2-rb-row') || [...document.querySelectorAll('button')].some(b => /телепорт|teleport/i.test(b.textContent)), 10000, 200);
  await env.sleep(600);
  let all = epicRowsParse();
  for (let i = 0; i < 5 && env.on; i++) {                 // вдруг список в несколько страниц (как у РБ)
    const nx = env.$q('#epic-pager-next, #rb-pager-next');
    const pg = nx?.closest?.('.l2-rb-pager, [id$="-pager"]') || nx?.parentElement, ind = txtOf(env.$q('#epic-pager-ind, #rb-pager-ind')).match(/(\d+)\s*\/\s*(\d+)/);
    if (!nx || nx.disabled || !env.shown(pg) || !env.shown(nx) || (ind && +ind[1] >= +ind[2])) break;   // 8.0.3: скрытый пейджер («1 / 1», [hidden]) не нажимаем
    const sig = document.body.innerText.length; env.fire(nx);
    if (!(await env.waitX(() => document.body.innerText.length !== sig, 4000, 150))) break;
    all = { ...epicRowsParse(), ...all };
  }
  const n = Object.values(all), now = Date.now(), db = { ...(env.rt.epicDb || {}) }, turn = [];
  for (const x of n) { const id = x.id || db[x.k]?.id || ''; if (lifeTurn(db[x.k], x)) turn.push(id || epicIdOf(x.k));
    db[x.k] = epicSeen(db[x.k], { id, name: x.name, lvl: x.lvl || db[x.k]?.lvl || 0, alive: x.alive, status: x.status, deny: x.deny,
    respH: x.respH || db[x.k]?.respH || 0, price: x.price, priceUnit: x.priceUnit, priceText: x.priceText, page: x.page, tp: x.tp, domT: now }, now); }
  await env.setRt({ epicDb: db, epicListT: now, epicPageOk: n.length > 0, ...lifeResetPatch(turn) });
  // 15.10: при ручном открытии страницы обновляем и часы «Респ эпиков», даже если сетевой hook пропустил ответ.
  if (n.length) await env.rbTimerListNote?.({ bosses: n.filter(x => x.id).map(x => ({ spawnId:x.id, name:x.name, level:x.lvl, isAlive:x.alive, bossType:'epic', respawnHours:x.respH })) }, 'страница DOM');
  if (!n.length) {
    // разметку не узнали — пишем кусок страницы в журнал (по нему разметку доучим)
    const main = ((['main', '#app', '.l2-page'].map(x => env.$q(x)).find(Boolean) || document.body)?.innerHTML || '').replace(/\s+/g, ' ').slice(0, 1500);   // v5.6: раньше всегда body (шапка и меню)
    env.rec('B', 'эпики', `страница «Эпик боссы»: эпиков не нашёл. Разметка: ${main}`);
  } else env.rec('B', 'эпики', `список (страница): ${n.map(x => `${x.name}${x.lvl ? ' ' + x.lvl : ''} ${x.alive ? '✅ жив' : '💀 ' + (x.status || 'мёртв')}${x.deny ? ' (' + x.deny + ')' : ''}`).join(' · ')}`);
}

async function epicSet(p) { await env.setRt({ epic: { ...(env.rt.epic || {}), ...p, t: Date.now() } }); }

async function epicDbSet(k, p) { await env.setRt({ epicDb: { ...(env.rt.epicDb || {}), [k]: { ...((env.rt.epicDb || {})[k] || {}), ...p } } }); }

// ---- список с сервера: GET /game/epic-bosses (тот же запрос, что шлёт страница) ----
// Лог 4ee00a04 09:03:37: {characterLevel:54, minRaidBossLevel:45, coinOfLuckCost:1, adenaCost:0, vipFreeApplied:false, total:8,
// bosses:[{spawnId, name, level, isAlive, coinOfLuckCost, adenaCost, canAttack, attackBlockedReasonUk, respawnHours, …}]}.
// Сервер пускает к боссам не ниже «уровень героя − 9» (54 → 45; 53 → 44 в списке РБ)
const tsOf = v => { if (v == null || v === '') return 0; const n = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? +v : Date.parse(v); return n > 1e12 ? n : n > 1e9 ? n * 1000 : 0; };
const num = v => v == null || v === '' || !Number.isFinite(+v) ? null : +v;
function epicApiOk(j) {                            // полный список: все элементы — объекты (hook.js режет массивы >8: «…ещё N» — строка)
  return !!j && Array.isArray(j.bosses) && j.bosses.length > 0 && j.bosses.every(b => b && typeof b === 'object' && !Array.isArray(b))
    && (j.total == null || j.bosses.length === +j.total || +j.totalPages > 1);
}
async function epicApiNote(j, src = 'api', now = Date.now()) {
  if (!epicApiOk(j)) return null;
  const db = { ...(env.rt.epicDb || {}) }, seen = [], fresh = [], ch = [], turn = [];
  for (const b of j.bosses) {
    if (!b.spawnId) continue;
    const e = epicById(b.spawnId); if (!e) { fresh.push(`${String(b.name || b.spawnId).slice(0, 30)} (${+b.level || '?'})`); continue; }
    const p = db[e.k] || {}, alive = b.isAlive === true ? true : b.isAlive === false ? false : undefined;
    const col = num(b.coinOfLuckCost) ?? num(j.coinOfLuckCost), ad = num(b.adenaCost) ?? num(j.adenaCost);
    const x = { id: b.spawnId, name: String(b.name || p.name || e.nm).slice(0, 40), lvl: +b.level || p.lvl || e.lvl, respH: +b.respawnHours || p.respH || 0,
      canAttack: b.canAttack !== false, deny: b.canAttack === false ? String(b.attackBlockedReasonUk || 'игра не пускает').replace(/^Недоступно:\s*/i, '').slice(0, 80) : '',
      apiLvl: +j.characterLevel || 0, col, adena: ad, vipFree: !!(b.vipFreeApplied ?? j.vipFreeApplied), apiT: now, src };
    if (alive !== undefined) x.alive = alive;
    if (alive === false) {                          // время от сервера, если вдруг пришлёт (имена полей — догадка)
      const ra = tsOf(b.respawnAt ?? b.nextRespawnAt ?? b.respawnAtMs ?? b.nextSpawnAt), kt = tsOf(b.killedAt ?? b.diedAt ?? b.deathAt ?? b.lastKilledAt);
      if (ra) x.respAt = ra; if (kt) x.killT = kt;
    }
    if (lifeTurn(p, x)) turn.push(b.spawnId);
    db[e.k] = epicSeen(p, x, now);
    if (alive === true && p.alive !== true) ch.push(`🐉 ${e.nm} появился`);
    if (alive === false && p.alive === true) ch.push(`${e.nm} убит — появится ${epicUntilTxt(db[e.k].until)}`);
    seen.push(e.k);
  }
  const A0 = env.rt.epicApi || {}, keys = Object.keys(j.bosses[0] || {}).sort().join(','), fr = fresh.join(', ');
  const bal = env.invQty?.(COL_ID);
  await env.setRt({ epicDb: db, epicListT: now, epicApi: { t: now, src, minLvl: +j.minRaidBossLevel || 0, charLvl: +j.characterLevel || 0, col: num(j.coinOfLuckCost), adena: num(j.adenaCost),
    vipFree: !!j.vipFreeApplied, keys, fresh: fr, n: seen.length }, ...(bal != null ? { colBal: { v: bal, t: now } } : {}), ...lifeResetPatch(turn) });
  if (keys !== A0.keys) env.rec('B', 'эпики', `ответ /game/epic-bosses: поля эпика ${keys}`);   // вдруг сервер начнёт слать время смерти
  if (fr && fr !== A0.fresh) env.rec('B', 'эпики', `в списке игры незнакомые эпики: ${fr}`);
  for (const c of ch) env.rec('B', 'эпики', c);
  return { seen, fresh, keys };
}

let apiBusy = null, scanBusy = null, vAllT = 0;
const epicApiDown = () => (env.rt.epicApiFail?.n || 0) >= 3 && Date.now() - (env.rt.epicApiFail.t || 0) < 6 * H;
async function epicApiScan(why) {                  // свой запрос (GET, как у игры); ошибка — пауза 5, 10, 20… мин; 3 подряд — запасной путь через страницу
  if (apiBusy) return apiBusy;
  apiBusy = (async () => {
    try {
      const c = new AbortController(), tm = setTimeout(() => c.abort(), 6000);
      // 9.0: с токеном страницы (без него сервер отвечает 401 — см. content.gameAuth)
      // 20.76+ (ревизия 28.10): дедлайн охватывает и тело ответа (как gameGet 20.46) — таймер снимается после r.json(), а не после заголовков:
      // зависшее тело держало apiBusy, и epicStep/epicPayGate ждали без срока до перезагрузки сторожем
      let r, j; try { r = await fetch('/game/epic-bosses?page=1', { credentials: 'include', cache: 'no-store', headers: env.gameAuth?.() || {}, signal: c.signal }); j = r.ok ? await r.json() : null; } finally { clearTimeout(tm); }
      const res = await epicApiNote(j, 'api');
      if (!res) throw new Error(r.ok ? 'в ответе нет полного списка bosses' : 'HTTP ' + r.status);
      if (env.rt.epicApiFail) await env.setRt({ epicApiFail: null });
      return res;
    } catch (e) {
      const n = (env.rt.epicApiFail?.n || 0) + 1;
      await env.setRt({ epicApiFail: { t: Date.now(), n, why: String(e?.message || e).slice(0, 80) } });
      if (n === 1 || n === 3) env.rec('B', 'эпики', `список эпиков с сервера не получен (${why}: ${String(e?.message || e).slice(0, 80)})${n >= 3 ? ' — 3 раза подряд: дальше страница «Эпик боссы» не чаще раза в 30 мин' : ''}`);
      return null;
    } finally { apiBusy = null; }
  })();
  return apiBusy;
}

// когда спрашивать список снова: до окна появления — не спрашиваем; в окне раз в 3 мин (1 мин при точном времени, 15 мин — если
// нижняя граница неизвестна); после окна — 10 мин; жив — 10 мин; подходящих эпиков нет — раз в 2 ч
function epicApiNext(now = Date.now()) {
  const last = env.rt.epicApi?.t || 0, F = env.rt.epicApiFail, db = env.rt.epicDb || {};
  const failT = F?.n ? (F.t || 0) + Math.min(60, 5 * 2 ** (F.n - 1)) * MIN : 0;
  if (!last) return failT;
  let best = last + 2 * H;
  for (const k of epicWant()) {
    const d = db[k] || {};
    if (epicLvlWhy(k) || ['strong', 'level', 'slow'].includes(d.verdict?.v)) continue;
    const u = d.alive === false ? epicUntil(d, now) : null;
    let t;
    if (!u) t = last + 10 * MIN;
    else if (u.lo && now < u.lo - 5 * MIN) t = u.lo - 5 * MIN;
    else if (now <= u.hi) t = last + (u.exact ? 1 : u.lo ? 3 : 15) * MIN;
    else t = last + 10 * MIN;
    best = Math.min(best, Math.max(t, last + MIN));
  }
  return Math.max(best, failT);
}
const epicApiDue = (now = Date.now()) => now >= epicApiNext(now);

async function epicPollTick() {                    // главный цикл, режим «Эпики»: фоном, без await и без переходов
  if (apiBusy || scanBusy || !epicApiDue()) return false;
  const r = await epicApiScan('по расписанию');
  if (r) await epicVerdictAll();
  return !!r;
}

// «🔄 Проверить эпиков (бесплатно)»: список + цифры босса для каждого (GET /game/spawn/<id>/info, пауза 0,7 с) → вердикты → итог в журнал
async function epicScanAll(why = 'по кнопке') {
  if (scanBusy) return scanBusy;
  scanBusy = (async () => {
    try {
      env.setStatus('Эпики: читаю список и цифры боссов с сервера (только чтение)');
      await epicApiScan(why);
      let n = 0;
      for (const e of env.EPICS) {
        const id = epicIdOf(e.k), st = env.rt.rbStats?.[id];
        if (n >= 8 || (st?.hp > 0 && st?.matk > 0)) continue;
        if (n++) await env.sleep(700);
        await env.rbInfo(id);
      }
      await epicVerdictAll();
      const db = env.rt.epicDb || {}, A = env.rt.epicApi || {};
      env.rec('B', 'эпики', `проверка ${why}: ${env.EPICS.map(e => { const d = db[e.k] || {}, v = d.verdict || {};
        return `${e.nm.split(' (')[0]} ${d.lvl || e.lvl}: ${d.alive === true ? 'жив' : d.alive === false ? 'мёртв, ' + epicUntilTxt(d.until) : 'статус ?'} · ${VLBL[v.v] || '❔'}${v.spPct ? ' (спецудар ' + v.spPct + ' %)' : ''}`; }).join(' · ')}${A.minLvl ? ` · игра пускает к боссам от ${A.minLvl} ур.` : ''}`);
    } finally {
      await env.setRt({ epicScanReq: null, epicScanT: Date.now() });
      scanBusy = null;
    }
  })();
  return scanBusy;
}

const epicLvl = k => (env.rt.epicDb || {})[k]?.lvl || epicOf(k)?.lvl || 0;

// уровень: сначала сервер (canAttack при том же уровне героя), иначе его правило «босс не ниже героя − 9» (minRaidBossLevel со сдвигом
// на рост героя), иначе герой − 9. Сверху — предохранитель бота: эпик не выше героя на 10
function epicLvlWhy(k) {
  const L = epicLvl(k), h = env.heroLvl(), d = (env.rt.epicDb || {})[k] || {}, A = env.rt.epicApi || {};
  if (d.canAttack === false && d.apiLvl && (!h || d.apiLvl === h)) return `игра не пускает: ${d.deny || 'по уровню'}`;
  if (!L || !h) return '';
  if (L > h + 10) return `эпик ${L} ур. — выше героя (${h}) больше чем на 10`;
  const lo = A.minLvl && A.charLvl ? A.minLvl + (h - A.charLvl) : h - 9;
  if (L < lo) return `эпик ${L} ур. — игра пускает к боссам от ${lo} ур.${A.minLvl ? '' : ' (оценка: герой − 9)'}`;
  return '';
}

// ---- цена телепорта со страницы: свежий ответ сервера главнее, разметка — проверка; не согласны — берём дороже ----
function epicPrice(k, row, now = Date.now(), maxAge = 10 * MIN) {
  const d = (env.rt.epicDb || {})[k] || {}, api = d.apiT > 0 && now - d.apiT < maxAge;
  if (row?.priceKnown && !row.priceUnit) return { known: false, why: `подпись цены не распознана: «${row.priceText || row.price}»` };
  const domCol = row?.priceKnown && row.priceUnit === 'Coin of Luck' ? +row.price || 0 : null, domAd = row?.priceKnown && row.priceUnit === 'аден' ? +row.price || 0 : null;
  const apiCol = api && Number.isFinite(d.col) ? d.col : null, apiAd = api && Number.isFinite(d.adena) ? d.adena : null;
  if (apiCol == null && domCol == null && domAd == null) return { known: false, why: 'цена телепорта неизвестна' };
  const col = Math.max(apiCol || 0, domCol || 0), adena = Math.max(apiAd || 0, domAd || 0);
  return { known: true, col, adena, free: !col && !adena, vip: !!d.vipFree };
}

// ---- бюджет: Coin of Luck — 0 = не тратить никогда; N — не больше N за 24 ч; на одно появление эпика не больше epicCoinPerBoss
// платных заходов; неизвестная цена/единица — отказ. Адена: 0 — без лимита (как раньше). kind: 'tp' | 'lair' | 'buff' (бафф 15 CoL)
function epicTpBudgetQuote(price, k, opt = {}) {
  const now = opt.now || Date.now(), kind = opt.kind || 'tp';
  // 8.0.3 (ревью): запись «из будущего» (часы перевели назад) тоже считается — раньше x.t <= now выкидывал её из лимита
  const records = (env.rt.epicTpBudget || []).filter(x => x && Number.isFinite(x.t) && x.t > now - 86400000);
  const p = price && typeof price === 'object' && 'known' in price ? price : epicPrice(k, price, now);   // старый вызов строкой {priceKnown, price, priceUnit}
  if (!p || !p.known) return { ok: false, why: p?.why || 'цена телепорта неизвестна', records, unknown: true };
  const colLim = Math.max(0, Math.floor(+env.cfg.epicCoinDailyMax || 0)), adLim = Math.max(0, +env.cfg.epicAdenaDailyMax || 0);
  const used = u => records.filter(x => x.unit === u).reduce((a, x) => a + (+x.cost || 0), 0), usedC = used('Coin of Luck'), usedA = used('аден');
  if (p.col > 0) {
    if (!colLim) return { ok: false, why: `нужно ${p.col} Coin of Luck, а лимит Coin of Luck = 0 (не тратить)`, records, col0: true };
    if (usedC + p.col > colLim) return { ok: false, why: `Coin of Luck: за 24 ч уже ${usedC}/${colLim}, нужно ещё ${p.col}`, records };
    if (kind !== 'buff') {
      const per = Math.max(0, Math.floor(+(env.cfg.epicCoinPerBoss ?? 1) || 0)), paid = (env.rt.epicDb || {})[k]?.paidN || 0;
      if (paid >= per) return { ok: false, why: `к этому эпику уже ${paid} платн. заход за это его появление (предел ${per})`, records };
    }
    const keep = Math.max(0, +env.cfg.epicCoinKeep || 0);
    if (keep > 0) {
      const bal = env.invQty?.(COL_ID);
      if (bal == null) return { ok: false, why: `баланс Coin of Luck неизвестен, а задан запас ${keep}`, records };
      if (bal - p.col < keep) return { ok: false, why: `Coin of Luck: баланс ${bal}, запас ${keep} — не трачу`, records };
    }
  }
  if (p.adena > 0 && adLim && usedA + p.adena > adLim) return { ok: false, why: `адена: за 24 ч ${usedA}/${adLim}, телепорт ${p.adena}`, records };
  const unit = p.col > 0 ? 'Coin of Luck' : p.adena > 0 ? 'аден' : '';
  return { ok: true, records, cost: p.col > 0 ? p.col : p.adena, unit, limit: unit === 'Coin of Luck' ? colLim : adLim, used: unit === 'Coin of Luck' ? usedC : usedA, price: p, kind };
}

// резерв — до нажатия (ошибка/перезагрузка не даст превысить лимит); платный заход CoL — +1 к paidN этого появления эпика
async function epicTpBudgetReserve(k, price, opt = {}) {
  const q = epicTpBudgetQuote(price, k, opt);
  if (!q.ok) return q;
  if (q.cost > 0) {
    const at = Date.now();
    q.reservationAt = at;
    const db = env.rt.epicDb || {};
    await env.setRt({ epicTpBudget: [...q.records, { t: at, k, cost: q.cost, unit: q.unit, kind: q.kind }],
      ...(q.unit === 'Coin of Luck' && q.kind !== 'buff' ? { epicDb: { ...db, [k]: { ...db[k], paidN: (db[k]?.paidN || 0) + 1, paidT: at } } } : {}) });
    env.rec('B', 'эпики', `бюджет: резерв ${q.cost} ${q.unit}${q.kind === 'buff' ? ' (платный городской бафф)' : q.kind === 'lair' ? ' (логово)' : ''}${q.limit ? ` · за 24 ч ${q.used + q.cost}/${q.limit}` : ''}`);
  }
  return q;
}

// снять резерв — только когда точно не потратили: кнопка не нажалась или сервер явно отказал
async function epicTpBudgetRelease(k, reservedAt, why) {
  if (!reservedAt) return;
  const L = env.rt.epicTpBudget || [], r = L.find(x => x && x.k === k && x.t === reservedAt);
  const db = env.rt.epicDb || {};
  await env.setRt({ epicTpBudget: L.filter(x => x !== r),
    ...(r?.unit === 'Coin of Luck' && r.kind !== 'buff' ? { epicDb: { ...db, [k]: { ...db[k], paidN: Math.max(0, (db[k]?.paidN || 0) - 1) } } } : {}) });
  env.rec('B', 'эпики', `телепорт к ${k} не состоялся (${why || 'нет подтверждения'}) — резерв бюджета снят`);
}

// ---- вердикт «по силам»: те же правила, что у РБ в 8.0 (спецудар ≈ M.Atk × rbSpM, комбинация, банки), плюс длительность боя ----
const VLBL = { ok: '✅ по силам', strong: '❌ не по силам', pots: '⚠ мало банок', slow: '⏳ бой слишком долгий', level: '⛔ игра не пускает', unknown: '❔ нет цифр' };
function epicHeroMax(now = Date.now()) {          // макс. HP героя: шапка; нет — свежий (30 мин) из прошлого вердикта того же уровня; иначе 0 = неизвестно
  const m = env.meHp?.()?.max; if (m > 0) return m;
  const h = env.heroLvl(), c = Object.values(env.rt.epicDb || {}).map(d => d.verdict).filter(v => v?.heroMax > 0 && v.heroLvl === h && now - (v.t || 0) < 30 * MIN).sort((a, b) => b.t - a.t)[0];
  return c?.heroMax || 0;
}
// ДПС по эпику до первого замера на нём: по РБ, убитым при нас (rbStats.hp / rbDb.fightS), с поправкой ∝ 1/M.Def и с запасом
// (25-й процентиль; линейная поправка завышает на тяжёлых: Крейвен 3254 при M.Def 747 → Селяну 2690, реально 1241). Своих замеров
// нет — половина среднего ДПС по РБ (сырое rbDps — слишком оптимистично)
function epicDps(id, st) {
  const D = env.rt.rbDb || {}, S = env.rt.rbStats || {}, own = D[id] || {};
  if (own.dps > 0) return { dps: Math.round(own.dps), how: 'замер на нём' };
  const M = st?.mdef || 0;
  const xs = Object.entries(D).map(([i, d]) => { const s = S[i]; return d?.kills > 0 && d.fightS > 10 && s?.hp > 0 && s.mdef > 0 && s.hp / d.fightS < 20000 ? s.hp / d.fightS * Math.min(1, s.mdef / (M || s.mdef)) : 0; }).filter(x => x > 0).sort((a, b) => a - b);
  if (xs.length && M > 0) return { dps: Math.max(1, Math.round(xs[Math.floor(xs.length * 0.25)])), how: `по ${xs.length} РБ с поправкой на M.Def ${M}, осторожно` };
  return { dps: Math.max(1, Math.round((env.rt.rbDps || 1150) * 0.5)), how: 'замеров нет — половина среднего ДПС по РБ' };
}
// 8.0.3 (эпики, ревью): HP эпика с прошлого захода (rbWound — раз в 8 с в бою, rb[id].hpAfter — при отходе) — только свежее (30 мин,
// как rbWounded) и из этой «жизни» (позже lifeT / смерти). Раньше бралось без срока: через 3 дня Орфен на 10 % — «по силам» вместо «долго»
function epicWoundHp(id, d, now = Date.now()) {
  const w = env.rt.rbWound?.[id], r = env.rt.rb?.[id], from = Math.max(d?.lifeT || 0, d?.deadT || 0, d?.killT || 0);
  const xs = [w && { cur: +w.cur, t: +w.t || 0 }, r?.hpAfter > 0 && { cur: +r.hpAfter, t: +r.t || 0 }].filter(x => x && x.cur > 0 && now - x.t < 30 * MIN && x.t > from);
  return xs.length ? Math.min(...xs.map(x => x.cur)) : 0;
}
function epicVerdict(k, now = Date.now()) {
  const d = (env.rt.epicDb || {})[k] || {}, id = epicIdOf(k), h = env.heroLvl(), heroMax = epicHeroMax(now);
  const base = { k, id, heroLvl: h, heroMax, t: now };
  const lw = epicLvlWhy(k); if (lw) return { ...base, v: 'level', why: lw };
  const so = d.scoutNo;                              // «не полезу» по окну на месте — держится до нового уровня или заметного роста HP
  if (so && so.heroLvl >= h && heroMax && heroMax <= (so.heroMax || 0) * 1.05) return { ...base, v: so.v || 'strong', why: 'на месте: ' + (so.why || 'не по силам') };
  const st = env.rt.rbStats?.[id];
  if (!(st?.hp > 0 && st?.matk > 0 && st?.patk > 0)) return { ...base, v: 'unknown', why: 'нет цифр босса (HP, P.Atk, M.Atk) — бот спросит у игры' };
  if (!heroMax) return { ...base, v: 'unknown', why: 'макс. HP героя неизвестно' };
  const D = epicDps(id, st), dps = D.dps, curHp = Math.min(st.hp, epicWoundHp(id, d, now) || st.hp);
  // потеря HP в бою: базовый профиль учился на слабых РБ (rbLossK ≈0,013 × P.Atk); единственный тяжёлый замер — Селян (P.Atk 2894,
  // ≈171 HP/с = 0,059 × P.Atk, один РБ!). Берём большее — осторожно
  const loss = Math.round(Math.max(st.loss || 0, (env.rt.rbLossK || 0) * st.patk, 0.059 * st.patk));
  const chk = env.rbPreCheck(id, { ...st, hp: curHp, hpExact: true, loss, est: false }, 1, dps, heroMax);   // hpExact: rb[id].hpAfter второй раз не применять
  const out = { ...base, sp: chk.sp, spPct: chk.spPct, tKill: Math.round(curHp / dps), dps, dpsHow: D.how, need: chk.need, pool: chk.pool };
  if (!chk.ok) return { ...out, v: chk.kind === 'pots' ? 'pots' : 'strong', why: chk.why };
  // 10.0.5 (игрок 13.10 01:10: «для эпиков лимит по времени не нужен»): 0 / пусто — без предела; своё число игрока работает как прежде (≥ 5 мин)
  const lim = +env.cfg.epicMaxFightMin || 0, maxS = Math.max(300, lim * 60);
  if (lim > 0 && out.tKill > maxS) return { ...out, v: 'slow', why: `бой ≈${Math.round(out.tKill / 60)} мин > ${Math.round(maxS / 60)} мин (ДПС ≈${dps}: ${D.how})` };
  return { ...out, v: 'ok', why: chk.why };
}
const vPack = v => ({ v: v.v, why: String(v.why || '').slice(0, 220), sp: v.sp || 0, spPct: v.spPct || 0, tKill: v.tKill || 0, dps: v.dps || 0, heroLvl: v.heroLvl || 0, heroMax: v.heroMax || 0, t: v.t || Date.now() });
const vSig = v => [v?.v, v?.heroLvl, Math.round((v?.heroMax || 0) / 100), v?.sp || 0].join('|');
// вердикт пишем при смене (вид | уровень | HP героя | спецудар) или раз в 30 мин (HP героя из него — запасное, когда шапки нет)
async function epicVerdictSave(k, v) {
  const o = (env.rt.epicDb || {})[k]?.verdict;
  if (o && vSig(o) === vSig(v) && Date.now() - (o.t || 0) < 30 * MIN) return false;
  await epicDbSet(k, { verdict: vPack(v) });
  if (o?.v !== v.v && epicWant().includes(k)) env.rec('B', 'эпики', `${epicOf(k)?.nm || k}: ${VLBL[v.v] || v.v} — ${String(v.why || '').slice(0, 200)}`);
  return true;
}
async function epicVerdictAll() {                  // все 8 (для таблицы в меню), одной записью
  const db = { ...(env.rt.epicDb || {}) }, now = Date.now(), logs = [];
  let ch = false;
  for (const e of env.EPICS) {
    const v = epicVerdict(e.k, now), o = db[e.k]?.verdict;
    if (o && vSig(o) === vSig(v) && now - (o.t || 0) < 30 * MIN) continue;
    db[e.k] = { ...(db[e.k] || {}), verdict: vPack(v) }; ch = true;
    if (o?.v !== v.v && epicWant().includes(e.k) && (o || v.v !== 'unknown')) logs.push(`${e.nm}: ${VLBL[v.v] || v.v} — ${String(v.why || '').slice(0, 160)}`);
  }
  if (ch) await env.setRt({ epicDb: db });
  for (const l of logs) env.rec('B', 'эпики', l);
  return db;
}

// ---- единые ворота перед ЛЮБОЙ тратой Coin of Luck: лимит → свежий список (≤2 мин) → жив → игра пускает → цифры босса →
// вердикт «по силам» → нет смертей подряд → цена известна и укладывается в лимиты ----
async function epicPayGate(k, row) {
  const colLim = Math.max(0, Math.floor(+env.cfg.epicCoinDailyMax || 0));
  let price = epicPrice(k, row);
  const col0 = p => p.known && p.col > 0 && !colLim;
  if (col0(price)) return { ok: false, why: `нужно ${price.col} Coin of Luck, а лимит Coin of Luck = 0 (не тратить)` };
  if (!(Date.now() - ((env.rt.epicDb || {})[k]?.apiT || 0) < 2 * MIN)) {
    if (!(await epicApiScan('перед оплатой'))) return { ok: false, why: 'список эпиков с сервера не получен — без него не плачу' };
    price = epicPrice(k, row);
    if (col0(price)) return { ok: false, why: `нужно ${price.col} Coin of Luck, а лимит Coin of Luck = 0 (не тратить)` };
  }
  const d = (env.rt.epicDb || {})[k] || {};
  if (d.alive !== true) return { ok: false, why: d.alive === false ? `мёртв (по серверу), появится ${epicUntilTxt(d.until)}` : 'сервер не подтвердил, что он жив' };
  if (d.canAttack === false) return { ok: false, why: `игра не пускает: ${d.deny || 'по уровню'}` };
  const lw = epicLvlWhy(k); if (lw) return { ok: false, why: lw };
  const id = epicIdOf(k), st = env.rt.rbStats?.[id];
  if (!(st?.hp > 0 && st?.matk > 0 && st?.patk > 0)) await env.rbInfo(id);
  const v = epicVerdict(k); await epicVerdictSave(k, v);
  if (v.v !== 'ok') return { ok: false, why: `${VLBL[v.v] || v.v}: ${v.why}`, v };
  const d1h = (env.rt.deaths1h || []).filter(t => Date.now() - t < H).length;
  if (d1h >= 2) return { ok: false, why: `${d1h} смерти за последний час — платно не захожу`, v };
  price = epicPrice(k, row);
  const q = epicTpBudgetQuote(price, k);
  if (!q.ok) return { ok: false, why: q.why, v };
  return { ok: true, price, q, v };
}

// логово за адену (телепорт локации): только известное (seenZone или таблица EPICS), не «не подтвердилось» за 6 ч, цена из каталога
function epicLair(k, now = Date.now()) {
  const e = epicOf(k), d = (env.rt.epicDb || {})[k] || {}, z = d.seenZone || e?.tp;
  if (!z) return { ok: false, why: 'логово не знаю' };
  if (d.lairBadT && now - d.lairBadT < 6 * H) return { ok: false, why: 'логово не подтвердилось (пауза 6 ч)' };
  const c = env.rt.zoneCat?.[z]; if (!c) return { ok: false, why: `телепорта «${z}» нет в каталоге локаций` };
  // 8.0.3 (эпики, ревью): валюта цены (navigation.zoneRows → cur/curT) — логово только за адену; Coin of Luck/непонятное — не здесь
  if (+c.price > 0 && c.curT != null && c.cur !== 'аден') return { ok: false, why: `логово «${z}» не за адену: ${(+c.price).toLocaleString('ru')} ${c.curT || '(валюта не подписана)'}` };
  const q = epicTpBudgetQuote({ known: true, col: 0, adena: +c.price || 0 }, k, { now, kind: 'lair' });
  return q.ok ? { ok: true, zone: z, price: +c.price || 0, q } : { ok: false, why: q.why };
}
// он на этой карте — бесплатно (метка эпика)
const epicHereNow = k => env.isMap() && epicPins().some(x => x.k === k);
// 20.43 (автономность, доводка 21.10): перелёт по локациям (rt.zoneGo) запрещён после циклов (actions: rt.actionBan, 2 ч; кнопки меню —
// urgent/manual/cmd — не запрещаются, у маршрута эпика их нет). since — запрет действовал уже тогда: созданный позже маршрут диспетчер
// снимает до запуска (actions.banDrop), телепорта не было
const zoneGoBan = (since, now = Date.now()) => { const b = env.rt.actionBan?.zoneGo; return b && +b.until > now && (since == null || +b.t <= since) ? b : null; };
// выбор «он на этой карте» ещё верен: после смерти герой в городе («Вернуться в город» → статуя), дорога снова логово или страница
const epicHereRoute = E => E?.route === 'here' && !E.deaths;
const lairBanWhy = (z, zb) => `перелёт в логово ${z} запрещён до ${when(+zb.until)} (${String(zb.why || 'цикл маршрута').slice(0, 80)}) — жду конца запрета, без резерва и без платной страницы`;
// как туда попасть (без сети, для выбора цели): 'here' | 'zone' | 'page' | '' (+ why)
function epicRoute(k, now = Date.now()) {
  if (epicHereNow(k)) return { via: 'here' };
  const d = (env.rt.epicDb || {})[k] || {};
  if (d.verdict?.v !== 'ok') return { via: '', why: d.verdict ? `${VLBL[d.verdict.v] || d.verdict.v}: ${d.verdict.why}` : '❔ нет оценки' };
  const lz = epicLair(k, now);
  // 20.43 (автономность, доводка 21.10, ревью fx/raid): дорога — логово, а перелёты запрещены (rt.actionBan.zoneGo) — эпика не выбираем до
  // конца запрета. Раньше выбор шёл дальше: подготовка покупала набор за FA или «Повний баф» за 15 Coin of Luck, и только шаг go видел
  // запрет и откладывал заход до 2 ч — баффы истекали без боя. Платной страницей вместо логова тоже не идём (правило R3)
  if (lz.ok) { const zb = zoneGoBan(null, now); return zb ? { via: '', ban: zb, why: lairBanWhy(lz.zone, zb) } : { via: 'zone', zone: lz.zone, price: lz.price }; }
  const q = epicTpBudgetQuote(epicPrice(k, null, now, 6 * H), k, { now });
  if (q.ok) return { via: 'page', q };
  return { via: '', why: `платно нельзя: ${q.why}${lz.why ? ' (логово: ' + lz.why + ')' : ''}` };
}

// почему этого эпика сейчас не берём ('' — берём)
function epicPickWhy(k, now = Date.now()) {
  const d = (env.rt.epicDb || {})[k] || {}, h = env.heroLvl();
  if (d.skipT > now) return `отложен до ${when(d.skipT)}${d.why ? ' (' + d.why + ')' : ''}`;
  if (d.leaveBadUntil > now) return `выход из боя не подтвердился, пауза ${Math.ceil((d.leaveBadUntil - now) / MIN)} мин`;
  const lw = epicLvlWhy(k); if (lw) return '⛔ ' + lw;
  if (d.deny && (!d.apiLvl || !h || d.apiLvl === h)) return '⛔ ' + d.deny;
  const fresh = now - Math.max(d.apiT || 0, d.domT || 0) < 15 * MIN;
  if (d.alive === false && (fresh || (d.until && now < d.until.hi))) return `💀 появится ${epicUntilTxt(d.until)}`;
  const v = d.verdict?.v, r = epicRoute(k, now);
  if (r.via === 'here') return ['strong', 'slow', 'level'].includes(v) || (v === 'pots' && env.cfg.epicCheck) ? `${VLBL[v]}: ${d.verdict.why}` : '';   // бесплатно: окно на месте решит
  if (d.alive !== true || !fresh) return '❔ сервер пока не подтвердил, что он жив';
  if (v !== 'ok') return d.verdict ? `${VLBL[v] || v}: ${d.verdict.why}` : '❔ нет оценки';
  return r.via ? '' : r.why;
}

// кого бить: начатого добиваем; дальше — по порядку списка. epicLvlUp — пожелание (мягкий приоритет), а не запрет
function epicPick() {
  const want = epicWant(), now = Date.now(), E = env.rt.epic || {};
  const okK = k => !epicPickWhy(k, now);
  if (E.k && want.includes(E.k) && okK(E.k)) return epicOf(E.k);
  const available = want.filter(okK);
  const preferred = available.filter(k => env.heroLvl() >= epicLvl(k) + Math.min(10, Math.max(0, +env.cfg.epicLvlUp || 0)));
  return epicOf((preferred[0] || available[0]) || '');
}

function epicWhyNone() {
  return epicWant().map(k => `${epicOf(k).nm}: ${(epicPickWhy(k) || '?').slice(0, 140)}`).join(' · ');
}

const EPIC_MAP_WAITS = [30000, 60000, 120000];   // 20.43 (автономность): ожидание карты после прилёта перед 1-й, 2-й и 3-й перезагрузкой
// 20.43 (ревью au/breather): метка «карта не подтверждена» (rt.mapBad) — бесплатная проверка карты (content.mapGate) до подготовки и дороги;
// не загрузилась — передышка режима эпиков (вид epicMap), без логова и телепорта
// 20.43 (автономность, доводка 21.10): перед этим — отложенный из-за незагрузившейся карты эпик снова на этой карте (epicMapSwitch)
const epicMapGate = async (active, E) => {
  if (E && await epicMapSwitch(E, active)) return true;
  return !!env.rt.mapBad?.at && typeof env.mapGate === 'function' && env.mapGate('epicMap', 'Эпики', active);
};
// 20.43 (автономность, доводка 21.10): отсрочка «карта не загрузилась» — про сломанную карту, а не про эпика. Перелёт уже оплачен (Coin of
// Luck со страницы или адена за логово) и мог состояться: карта снова показывает его метку здесь — отсрочку снимаем, а промах логова,
// записанный только из-за карты, откатываем (epicDb.mapFail хранит прежние lairMiss/lairBadT); бой — без телепорта (дорога «он на этой
// карте»). Раньше эпик ждал 30 мин или до следующего появления (второй платный заход в это появление запрещён), а режим платил за следующего
const EPIC_MAP_WHY = 'карта не загрузилась после 3 обновлений';
const epicMapFailMark = E => { const d = (env.rt.epicDb || {})[E.k] || {}; return { mapFail: { t: Date.now(), via: E.via || '', lairMiss: +d.lairMiss || 0, lairBadT: +d.lairBadT || 0 } }; };
async function epicMapRelease() {
  if (!env.isMap()) return [];
  const now = Date.now(), db = env.rt.epicDb || {}, pins = epicPins();
  if (!pins.length) return [];
  const here = new Set(pins.map(x => x.k));
  // 20.43 (доводка 21.10, ревью fx/raid): откат промаха логова — при любой следующей встрече на карте, а не только пока жива 30-минутная
  // отсрочка (её могла целиком съесть передышка epicMap, и пауза логова 6 ч оставалась). Отсрочку снимаем только свою, «карта не загрузилась»
  const marked = epicWant().filter(k => here.has(k) && db[k]?.mapFail);
  const ks = marked.filter(k => db[k].skipT > now && String(db[k].why || '').includes(EPIC_MAP_WHY));
  const back = marked.filter(k => !ks.includes(k) && db[k].mapFail.via === 'zone');
  for (const k of marked) {
    const mf = db[k].mapFail;
    await epicDbSet(k, { ...(ks.includes(k) ? { skipT: 0, why: '' } : {}), mapFail: null, ...(mf.via === 'zone' ? { lairMiss: +mf.lairMiss || 0, lairBadT: +mf.lairBadT || 0 } : {}) });
  }
  if (back.length) env.rec('B', 'эпики', `${back.map(k => epicOf(k)?.nm || k).join(', ')}: карта работает и показывает его здесь — промах логова из-за сбоя карты откатываю`);
  if (ks.length) env.rec('B', 'эпики', `${ks.map(k => epicOf(k)?.nm || k).join(', ')}: карта снова загружается и показывает его здесь — отсрочку «карта не загрузилась» снимаю, бой без телепорта`);
  return ks;
}
// Подготовка/дорога к другому эпику: отложенный из-за карты эпик нашёлся здесь — сначала он (бесплатно). Начатый заход (смерти, отходы,
// «только бесплатно или логово») не бросаем: его ограничения живут в rt.epic; снятый отложенный эпик подождёт своей очереди
async function epicMapSwitch(E, active) {
  const ks = await epicMapRelease();
  if (!ks.length || !active() || ks.includes(E.k) || E.deaths || E.retreats || E.noPay || E.lairOnly || E.tries) return false;
  const k = ks[0], nm = epicOf(k)?.nm || k;
  env.rec('B', 'эпики', `${nm} здесь, на этой карте — сначала он, без телепорта${E.k ? `; ${epicOf(E.k)?.nm || E.k} — после` : ''}`);
  await env.setRt({ epic: { step: 'pick', k, t: Date.now(), last: `${nm}: снова на карте после сбоя карты` }, rbCur: null, rbWant: null, target: null });
  return true;
}
async function epicGiveUp(k, min, why, extra = null) {
  const e = epicOf(k);
  await epicDbSet(k, { skipT: Date.now() + min * 60000, why, ...(extra || {}) });
  env.rec('B', 'эпики', `${e?.nm || k}: ${why} — откладываю на ${min >= 60 ? Math.round(min / 6) / 10 + ' ч' : min + ' мин'}, дальше следующий`);
  await env.setRt({ epic: { step: 'pick', t: Date.now(), last: `${e?.nm || k}: ${why}` }, rbCur: null, rbWant: null, target: null });
}
// до следующего появления: жив (мы погибли / не долетели) — следующее не раньше чем через респаун; мёртв — до начала окна
async function epicGiveUpNext(k, why, extra = null) {
  const d = (env.rt.epicDb || {})[k] || {}, now = Date.now();
  const until = d.alive === false ? (d.until?.lo || 0) : now + (d.respH || 12) * H;
  return epicGiveUp(k, Math.max(15, Math.ceil((until - now) / MIN)), why + ' — жду следующего появления', extra);
}

// 8.0.3 (P0-8): платный «Повний баф» (15 Coin of Luck) во время эпика — только в пределах того же лимита Coin of Luck.
// Признак — состояние эпика (rt.epic), поэтому действует и в подготовке, и в «Восстановить», и после смерти. null — режим эпиков выключен.
// 8.0.3 (ревью): (1) только когда сам заход уже разрешён — те же проверки, что у epicPayGate: вердикт «по силам» (пересчёт), жив по
// свежему ответу сервера (≤3 мин), игра пускает, смертей за час < 2, дорога выбрана. Было: 15 CoL на эпика «❔ нет цифр» (дорога «здесь»)
// и после двух смертей, когда ворота платить уже не давали. (2) Режим эпиков между заходами (выбор цели, фарм мобов) — тот же лимит
// Coin of Luck: «0 — не тратить никогда» значит никогда (было: платный набор после каждой смерти без лимита)
const epicFlow = () => epicOn() && !!env.rt.epic?.k && env.rt.epic.step !== 'pick';
const TB_COL = 15;
// 9.2.5 (игрок 12.10: «фулл баф на РБ и эпиков за ФА»): фулл бафф за FA включён и FA на него хватает — платный городской набор
// за Coin of Luck в режиме эпиков не берём (баффы FA те же и выше уровнем, на 3 ч). FA мало (баланс известен и меньше набора) — как раньше
function epicFaCovers() {
  if (env.cfg.epicFaFull === false) return false;
  const ids = env.faFullIds?.() || [], bal = env.rt.faBal && Date.now() - env.rt.faBal.t < 6 * H ? env.rt.faBal.v : null;
  if (!ids.length) return false;
  const need = ids.reduce((a, id) => a + (+(env.faCost?.(id)) || 1), 0);
  return bal == null || bal >= need;
}
function epicBuffWhy(now = Date.now(), noBudget = false) {
  const E = env.rt.epic || {}, k = epicFlow() ? E.k : '';
  if (!noBudget && epicFaCovers()) return 'фулл бафф берётся за FA';
  const q = noBudget ? { ok: true } : epicTpBudgetQuote({ known: true, col: TB_COL, adena: 0 }, k, { kind: 'buff', now });
  if (!q.ok) return q.why;
  if (!k) return noBudget ? 'эпик ещё не выбран' : '';
  const d = (env.rt.epicDb || {})[k] || {}, h = env.heroLvl(), lw = epicLvlWhy(k);
  if (lw) return lw;
  if (d.deny && (!d.apiLvl || !h || d.apiLvl === h)) return `игра не пускает: ${d.deny}`;
  if (d.alive !== true || !(now - (d.apiT || 0) < 3 * MIN)) return 'сервер не подтвердил (за 3 мин), что эпик жив';
  const v = epicVerdict(k, now); if (v.v !== 'ok') return `эпик ${VLBL[v.v] || v.v}`;
  const d1h = (env.rt.deaths1h || []).filter(t => now - t < H).length; if (d1h >= 2) return `${d1h} смерти за последний час`;
  if (!E.route) return 'дорога к эпику ещё не выбрана';
  // 20.43 (автономность, доводка 21.10, ревью fx/raid): дорога — логово, а перелёты по локациям запрещены (rt.actionBan.zoneGo) — шаг go
  // отложит заход до конца запрета (до 2 ч), набор за FA / 15 Coin of Luck истёк бы без боя. «Он на этой карте» (выбор 'here') — бесплатно,
  // запрет не мешает: баффер — страница, герой с места не уходит (после смерти — уже в городе)
  const lzOk = epicLair(k, now).ok, zb = lzOk && !epicHereRoute(E) && !epicHereNow(k) ? zoneGoBan(null, now) : null;
  if (zb) return `перелёт в логово запрещён до ${when(+zb.until)} — заход отложится до конца запрета`;
  // 20.12 (ревизия 17.10): после смерти/отхода (noPay) или «только логово» платный телепорт запрещён — без бесплатной дороги
  // (он на этой карте или логово за адену) шаг go сразу отменит заход, и набор за FA пропал бы зря
  if ((E.noPay || E.lairOnly) && !epicHereNow(k) && !lzOk) return 'после смерти/отхода — только бесплатно или через логово, а дороги нет';
  return '';
}
function epicBuffCol() { return epicOn() ? !epicBuffWhy() : null; }
// 9.2.5: фулл бафф за FA перед эпиком — те же проверки, что у платного набора (по силам, жив по свежему ответу, < 2 смертей за час,
// дорога выбрана), только без бюджета Coin of Luck: FA тратится только на заход, который точно будет
function epicFaOk() { return epicOn() && epicFlow() && !epicBuffWhy(Date.now(), true); }
async function epicBuffPay(set) {                  // прямо перед нажатием платного набора: резерв в бюджете CoL → время резерва; нельзя → false
  if (!epicOn()) return null;
  const why = epicBuffWhy();
  const q = why ? { ok: false, why } : await epicTpBudgetReserve(epicFlow() ? env.rt.epic.k : 'buff', { known: true, col: TB_COL, adena: 0 }, { kind: 'buff' });
  if (!q.ok) { env.rec('B', 'бафф', `«${set}» за ${TB_COL} Coin of Luck в режиме эпиков не разрешён: ${q.why} — беру бесплатный «basic»`); return false; }
  return q.reservationAt || true;
}
async function epicBuffRelease(at, why) {          // баффер явно отказал — 15 CoL не списаны, резерв снимаем
  const L = env.rt.epicTpBudget || [], r = at > 0 && L.find(x => x && x.kind === 'buff' && x.t === at);
  if (!r) return false;
  await env.setRt({ epicTpBudget: L.filter(x => x !== r) });
  env.rec('B', 'бафф', `платный набор не наложен (${String(why || 'отказ').slice(0, 80)}) — резерв ${r.cost} Coin of Luck снят`);
  return true;
}

// ответ сервера на телепорт со страницы эпиков (content.js пишет его в sessionStorage 'l2bot.epicTp' в 10 с после нажатия)
function epicTpAck(E) {
  try { const a = JSON.parse(sessionStorage.getItem('l2bot.epicTp') || 'null'); return a && a.t >= (E.tpT || 0) - 1000 ? a : null; } catch (er) { return null; }
}
// 8.0.3 (эпики, ревью): что ответил сервер на POST …/teleport. Отказ (ok:false → резерв снимается) — только ЯВНЫЙ: 4xx с телом ошибки
// или 2xx с error / ok:false / success:false. 5xx (502/504 прокси, перезапуск сервера), обрыв (status 0, «нет ответа»), 4xx без тела —
// ok:null «неизвестно»: CoL могли уже списать, резерв остаётся
function epicTpAckOf(d) {
  const s = +d?.status || 0, r = d?.res && typeof d.res === 'object' && !Array.isArray(d.res) ? d.res : null;
  const no2 = s >= 200 && s < 300 && !!r && !!(r.error || r.ok === false || r.success === false);
  const no4 = s >= 400 && s < 500 && !!r && !!(r.error || r.ok === false || r.success === false || r.messageRu || r.messageUk || r.message);
  return { ok: no2 || no4 ? false : s >= 200 && s < 300 && !d?.error ? true : null, status: s };
}
// запрос про этот эпик? Номер босса в теле или пути — должен совпасть; формат запроса ещё не видели — по времени (10 с после нажатия)
function epicTpReqFor(d, path, id) {
  const n = epicNum(id), q = d?.req && typeof d.req === 'object' ? d.req : {}, all = JSON.stringify(d?.req ?? '') + ' ' + (path || '');
  const ids = [...all.matchAll(/l2dop_[a-z]+_\d+/g)].map(m => m[0]);
  if (ids.length) return ids.includes(id);
  const sid = q.spawnId ?? q.battleSpawnId ?? q.bossSpawnId ?? q.bossId ?? q.npcId;
  if (sid != null && sid !== '') return String(sid) === String(id) || (+sid > 0 && +sid === n);
  const pm = String(path || '').match(/\/(\d{4,})(?:\/|$|\?)/); if (pm) return +pm[1] === n;
  return true;
}
// не долетели / на месте его нет. Страницей второй раз не идём (CoL); логово — только подтверждённое
// 20.43 (автономность, доводка 21.10): opt.map — карта не загрузилась (прилёт не подтверждён): метка mapFail, чтобы отсрочку и промах логова
// откатить, если карта снова покажет его здесь (epicMapRelease)
// 20.43 (автономность, доводка 21.10, ревью fx/raid): сбой карты — не довод, что логово неверное. Неподтверждённое логово (из таблицы EPICS)
// раньше сразу получало паузу 6 ч (lairBadT), а откат (epicMapRelease) жил только 30 мин отсрочки — их съедала передышка epicMap, если и
// бесплатная проверка карты падала. Дальше эпик, не видный с этой точки, шёл страницей за Coin of Luck вместо логова за адену. Теперь
// по сбою карты — только счёт промахов; пауза логова — со второго промаха подряд и у неподтверждённого. Прочие промахи — прежнее правило;
// opt.mapOk (карта загрузилась, а его в логове нет) — настоящий промах логова: прежняя метка mapFail снимается, чтобы откат не стёр его
async function epicArriveFail(E, e, why, opt = {}) {
  const d = (env.rt.epicDb || {})[E.k] || {}, now = Date.now();
  const mark = opt.map ? epicMapFailMark(E) : opt.mapOk && E.via === 'zone' && d.mapFail ? { mapFail: null } : null;
  if (E.via === 'zone') {
    const miss = (d.lairMiss || 0) + 1, bad = opt.map ? miss >= 2 : !d.lairOkT || miss >= 2;
    await epicDbSet(E.k, { lairMiss: miss, ...(bad ? { lairBadT: now } : {}) });
    return epicGiveUp(E.k, 30, `логово: ${why}`, mark);
  }
  if (E.via === 'page') {
    if (d.lairOkT && epicLair(E.k, now).ok) {
      env.rec('B', 'эпики', `${e.nm}: после платного телепорта ${why} — пробую подтверждённое логово (за адену), страницей второй раз не иду`);
      await epicSet({ step: 'go', noPay: true, mapChecked: true, lairOnly: true, at: now });
      return;
    }
    return epicGiveUpNext(E.k, `после платного телепорта ${why}`, mark);
  }
  return epicGiveUp(E.k, 15, `${why} (убит другими или ушёл)`, mark);
}

async function epicStep() {
  // Ожидания подготовки и карты могут пережить Stop, TvT или ручной выбор.
  // Central fire защищает клик; здесь защищаем также состояние старого маршрута.
  const context = () => JSON.stringify([env.rt.char, env.rt.manualKickAt, env.cfg.epicMode, env.cfg.epicList, env.rt.epic?.k]);
  const captured = context(), actor = env.rt.char, selected = env.rt.epic?.k;
  const active = () => env.on !== false && env.tabOwner !== false && env.cfg.epicMode !== false
    && env.canAct?.() !== false && env.canRun?.() !== false && context() === captured;
  const cancelUnsent = async res => { if (env.rt.char === actor) await epicTpBudgetRelease(selected, res?.reservationAt, 'маршрут отменён до нажатия'); };
  if (!active()) return;
  const E = env.rt.epic || { step: 'pick' }, e = E.k ? epicOf(E.k) : null, now = Date.now();
  if (!env.cfg.autoRevive && !E.warned) { env.rec('B', 'эпики', 'внимание: «После смерти — в город и продолжать» выключено — после первой смерти бот остановится'); await epicSet({ warned: true }); }
  if (!active()) return;
  if (E.step === 'retreatVerify' && e) {
    let ack = null;
    try { ack = JSON.parse(sessionStorage.getItem('l2bot.epicLeave') || 'null'); } catch (er) {}
    if (ack && ack.id === E.id && ack.at >= (E.retreatT || 0) && ack.at - E.retreatT < 30000) {
      try { sessionStorage.removeItem('l2bot.epicLeave'); } catch (er) {}
      if (!ack.ok) {
        await epicDbSet(E.k, { leaveBadUntil: Date.now() + 3600000 });
        return epicGiveUp(E.k, 60, 'сервер отказал в выходе из боя');
      }
      const a = E.retreatAttempt;
      const L = a ? [...(E.hpLog || []).slice(-9), a] : (E.hpLog || []);
      const d = (env.rt.epicDb || {})[E.k] || {}, retreats = (d.retreatsLife || 0) + 1;
      await epicDbSet(E.k, { leaveBadUntil: 0, retreatsLife: retreats });
      // 8.0.3: ДПС по этому эпику — по замеру захода (EMA): дальше вердикт считает время боя по нему, без поправки на M.Def
      if (a?.dps > 0 && E.id) { const r0 = env.rt.rbDb?.[E.id] || {}; await env.setRt({ rbDb: { ...(env.rt.rbDb || {}), [E.id]: { ...r0, dps: Math.round(r0.dps > 0 ? r0.dps * 0.6 + a.dps * 0.4 : a.dps) } } }); }
      if (retreats >= Math.max(1, +env.cfg.epicMaxRetreats || 8)) return epicGiveUpNext(E.k, `${retreats} отходов за это его появление`);
      env.rec('B', 'эпики', `${e.nm}: выход из боя подтверждён сервером — восстанавливаюсь (отход ${retreats}/${env.cfg.epicMaxRetreats || 8}); дальше — только бесплатно или логово`);
      await env.setRt({ epic: { ...E, step: 'prep', hpLog: L, retreats: (E.retreats || 0) + 1, noPay: true, mapChecked: false,
        retreatAttempt: null, leaveChecked: true, retreatT: 0, t: now }, rbCur: null, rbWant: null });
      return;
    }
    if (now - (E.retreatT || 0) < 12000) { await env.sleep(700); return; }
    await epicDbSet(E.k, { leaveBadUntil: Date.now() + 3600000 });
    return epicGiveUp(E.k, 60, 'нет подтверждения выхода из боя от сервера');
  }
  // ---- бой закончился (мы не на странице боя) — итог захода ----
  if (E.step === 'fight' && e) {
    const d = env.rt.rbDb?.[E.id] || {}, killed = (d.kills || 0) > (E.kills0 || 0);
    if (killed) {
      const tries = (E.deaths || 0) + 1, db0 = (env.rt.epicDb || {})[E.k] || {};
      const nx = db0.respH ? now + db0.respH * H : 0;
      env.rec('B', 'эпики', `🏆 ${e.nm} убит! Заходов: ${tries}, смертей: ${E.deaths || 0}${nx ? ` · следующее появление ровно в ${when(nx)}` : ''}`);
      await epicDbSet(E.k, { kills: (db0.kills || 0) + 1, alive: false, status: 'убит мной', seenT: now, deadT: now, killT: now, paidN: 0, deathsLife: 0, retreatsLife: 0, best: null,
        until: epicUntil({ ...db0, alive: false, killT: now, respAt: 0 }, now) });
      await env.setRt({ epic: { step: 'pick', t: now, last: `${e.nm} убит` }, rbCur: null, rbWant: null, epicListT: 0 });
      return;
    }
    if (!E.died) {                                  // бой закончился без победы и без смерти (бой не открылся / страница сменилась)
      if (E.retreatFailed) return epicGiveUp(E.k, 60, 'сервер не подтвердил выход из боя');
      await epicSet({ step: 'arrive', at: now, tries: (E.tries || 0) + 1 });
      return;
    }
    // погибли: смерть уже обработана (город → статуя → бафф → «Восстановить»); решаем — добивать или ждать следующего появления
    const deaths = (E.deaths || 0) + 1, L = [...(E.hpLog || [])];
    if (E.retreatFailed) return epicGiveUp(E.k, 60, 'не удалось завершить бой отступлением');
    const db0 = (env.rt.epicDb || {})[E.k] || {};
    await epicDbSet(E.k, { deaths: (db0.deaths || 0) + 1 });
    const last = L[L.length - 1];
    const pct = last?.max ? Math.round(last.cur / last.max * 1000) / 10 : null;
    // 8.0.3: заходами — только если подтверждено, что HP эпика между заходами сохраняется (замер на повторном входе, combat);
    // иначе ждём следующего появления: смерть стоит опыта и платных баффов, а второй платный заход за появление запрещён
    if (db0.persist !== true) return epicGiveUpNext(E.k, `смерть${pct != null ? ` (у него ${pct} %)` : ''}, а сохранение HP эпика между заходами не подтверждено`);
    if (deaths >= Math.max(1, +env.cfg.epicMaxDeaths || 5)) return epicGiveUpNext(E.k, `${deaths} смертей${pct != null ? `, у него осталось ${pct} %` : ''}`);
    const attemptChip = last?.cur != null && last?.max && E.startHp != null ? Math.max(0, E.startHp - last.cur) / last.max : null;
    if (attemptChip != null && attemptChip < 0.005) return epicGiveUpNext(E.k, `за последний заход снято только ${(attemptChip * 100).toFixed(2)} % HP эпика — повторять смерти нецелесообразно`);
    if (L.length >= 3) {
      const a = L[L.length - 3], b = last;
      if (a.max && b.max && a.cur - b.cur < a.max * 0.01) return epicGiveUpNext(E.k, `3 захода почти не снимают ему HP (${Math.round(a.cur / a.max * 100)} % → ${Math.round(b.cur / b.max * 100)} %) — отхиливается быстрее`);
    }
    if ((E.resetN || 0) >= 2) return epicGiveUpNext(E.k, 'HP эпика восстанавливается полностью после каждой смерти — заходами не добить');
    env.rec('B', 'эпики', `${e.nm}: смерть ${deaths}/${env.cfg.epicMaxDeaths || 5}${pct != null ? ` · у него ${pct} %` : ''} → хил, банки, бафф и снова к нему (только бесплатно или логово)`);
    await env.setRt({ epic: { ...E, step: 'prep', deaths, died: false, noPay: true, mapChecked: false, at: now, t: now }, rbCur: null, rbWant: null, target: null });
    return;
  }
  // ---- выбор цели ----
  if (E.step === 'pick' || !e) {
    // 8.0.3: список — из ответа сервера (фоном epicPollTick, по окнам появления); страницу «Эпик боссы» больше не открываем каждые
    // 10 мин (рвала цепочку «Охотиться дальше») — только если сервер 3 раза подряд не ответил, и не чаще раза в 30 мин
    if (epicApiDue()) await epicApiScan('выбор эпика');
    if (!active()) return;
    if (epicApiDown() && (!env.rt.epicListT || now - env.rt.epicListT > 30 * MIN) && !(env.isFishing() && env.fishState())) {
      if (!isEpicPage()) { env.setStatus('Эпики: открываю «Эпик боссы»'); location.href = env.EPIC_URL; await env.sleep(4000); return; }
      return epicListScan();
    }
    // цифры подходящих эпиков (по одному GET /game/spawn/<id>/info за шаг; ответ постоянный — спрашиваем раз) → вердикты
    const need = epicWant().find(k => { const d = (env.rt.epicDb || {})[k] || {}, st = env.rt.rbStats?.[epicIdOf(k)];
      return !epicLvlWhy(k) && d.alive !== false && !(st?.hp > 0 && st?.matk > 0) && Date.now() - ((env.rt.rbInfoFail || {})[epicIdOf(k)] || 0) > 6 * H; });
    if (need) await env.rbInfo(epicIdOf(need));
    if (!active()) return;
    if (need || now - vAllT > MIN) { vAllT = now; await epicVerdictAll(); }   // 8 вердиктов — не чаще раза в минуту (шаг выбора идёт каждый круг)
    if (!active()) return;
    // 20.43 (автономность, доводка 21.10): отложенный из-за незагрузившейся карты эпик снова на этой карте — отсрочку снимаем и берём его
    // первым (дорога «он на этой карте», бесплатно), а не платим за следующего
    const back = await epicMapRelease();
    if (!active()) return;
    if (back.length && E.k !== back[0]) { await epicSet({ step: 'pick', k: back[0] }); return; }
    const p = epicPick();
    if (!p) {
      if (!env.isMap() && !env.cfg.fishMode) { location.href = '/map.html'; await env.sleep(3000); return; }   // с рыбалкой — не на карту (было: карта ↔ рыбалка по кругу)
      // «мало банок» у живого эпика — докупить (потом вердикт пересчитается)
      const pots = epicWant().find(k => (env.rt.epicDb || {})[k]?.verdict?.v === 'pots' && (env.rt.epicDb || {})[k]?.alive === true);
      if (pots && await env.rbShopFirst(epicOf(pots).nm)) return;
      if (!active()) return;
      const why = epicWant().length ? `подходящих эпиков нет — ${epicWhyNone()}` : 'в меню не выбран ни один эпик';
      if (E.last !== why) { await epicSet({ last: why }); env.recBot(`Эпики: ${why} — ${env.cfg.fishMode ? 'рыбачу' : 'фармлю мобов'}, список проверяю по окнам появления`); }
      if (env.cfg.fishMode) {
        env.setStatus(`Эпики: ${why.slice(0, 120)} — рыбачу`);
        if (env.rt.fishService === 'cut') return env.isChar() ? env.fishCut() : (location.href = '/char.html', env.sleep(5000));
        if (env.rt.fishService === 'exchange') return env.isFishShop() ? env.fishExchange() : (location.href = '/fishing-shop.html', env.sleep(5000));
        if (env.rt.fishService === 'rod') return env.isChar() ? env.rodEnchant() : (location.href = '/char.html', env.sleep(5000));
        return env.isFishing() ? env.fishing() : env.goFishing();
      }
      env.setStatus(`Эпики: ${why.slice(0, 160)} — фармлю мобов`);
      return env.map();
    }
    const r = epicRoute(p.k), d = (env.rt.epicDb || {})[p.k] || {};
    env.rec('B', 'эпики', `цель: ${p.nm}${d.lvl ? ' (' + d.lvl + ')' : ''} · ${r.via === 'here' ? 'он на этой карте — без телепорта' : r.via === 'zone' ? `логово ${r.zone} за ${r.price} аден` : `телепорт со страницы (${r.q?.cost || 0} ${r.q?.unit || ''})`}${d.verdict?.v === 'ok' ? ' · ' + String(d.verdict.why || '').slice(0, 120) : ''}`);
    await env.setRt({ epic: { step: 'prep', k: p.k, id: d.id || epicIdOf(p.k), name: p.nm, deaths: 0, hpLog: [], tries: 0, at: now, t: now, route: r.via } });
    return;
  }
  // ---- подготовка: банки → бафф → хил (полные HP/MP) ----
  if (E.step === 'prep') {
    // 20.43 (ревью au/breather): карта не подтверждена после сбоя — ни подготовки (банки, платный бафф), ни дороги до бесплатной проверки
    if (await epicMapGate(active, E)) return;      // 20.43 (доводка 21.10): и отложенный из-за карты эпик, снова видный здесь, — первым
    if (!active()) return;
    // 20.43 (автономность, доводка 21.10, ревью fx/raid): дорога — логово, а перелёты запрещены (запрет появился уже после выбора) — не
    // готовимся (банки, набор за FA, «Повний баф» за Coin of Luck): сразу откладываем до конца запрета; проверка в шаге go — страховка
    { const lz = !epicHereRoute(E) && !epicHereNow(E.k) ? epicLair(E.k) : null, zb = lz?.ok ? zoneGoBan() : null;
      if (zb) return epicGiveUp(E.k, Math.max(1, Math.ceil((+zb.until - Date.now()) / MIN)), lairBanWhy(lz.zone, zb)); }
    if (await env.rbShopFirst(e.nm)) return;
    if (!active()) return;
    // 8.0.3 (ревью): платный набор разрешён только по свежему (≤3 мин) ответу сервера «жив» — спросим заранее (GET, бесплатно)
    // 20.13 (ревизия 17.10, шаг 5, EP-2): и фулл бафф за FA (epicFaFull) требует свежего «жив» — без опроса набор брался случайно
    const paidSet = ['warrior', 'mage'].includes(env.cfg.townBuffSet) && Math.floor(+env.cfg.epicCoinDailyMax || 0) >= TB_COL;
    const faSet = env.cfg.epicFaFull !== false && (env.faFullIds?.() || []).length > 0;
    if ((paidSet || faSet) && !(now - ((env.rt.epicDb || {})[E.k]?.apiT || 0) < 2 * MIN)
      && !epicApiDown() && now - (env.rt.epicApiFail?.t || 0) > MIN) await epicApiScan('перед платным баффом');
    if (!active()) return;
    if (await env.townBuffStart(`перед эпиком ${e.nm}`, true)) return;
    if (!active()) return;   // платный набор — через бюджет CoL (buffs: epicBuffCol/epicBuffPay)
    const me = env.meHp(), mp = env.meMp(), need = Math.max(90, env.cfg.rbRestHp || 95);
    if (me && (me.pct < need || (mp && mp.cur < mp.max * 0.8)) && await env.restoreVitals(`хил перед эпиком ${e.nm}: HP ${me.pct | 0}%`)) return;
    if (!active()) return;
    if (me && me.pct < 70) {                        // баффер не вылечил (откат) — подлечиваемся на мобах
      if (!env.isMap()) { location.href = '/map.html'; await env.sleep(3000); return; }
      env.setStatus(`Эпики: HP ${me.pct | 0}% — подлечиваюсь на мобах, потом ${e.nm}`);
      return env.map();
    }
    const L3 = (E.hpLog || []).slice(-3);
    if (L3.length >= 3 && L3[0].max && L3[0].cur - L3[2].cur < L3[0].max * 0.01) return epicGiveUpNext(E.k, `3 захода почти не снимают ему HP (${(L3[0].cur / L3[0].max * 100).toFixed(1)} % → ${(L3[2].cur / L3[2].max * 100).toFixed(1)} %) — отхиливается быстрее`);
    await epicSet({ step: 'go', at: now, via: null, mapChecked: false });
    return;
  }
  // ---- дорога: (1) он на этой карте → (2) логово за адену → (3) «Телепорт» за Coin of Luck через epicPayGate ----
  if (E.step === 'go') {
    if (await epicMapGate(active, E)) return;        // 20.43 (ревью au/breather): платная дорога — только после подтверждённой карты
    if (!active()) return;
    if (env.isMap()) {
      const here = await env.waitX(() => epicPins().find(x => x.k === E.k), 3000, 300);
      if (!active()) return;
      if (here) { env.rec('B', 'эпики', `${e.nm}: он здесь, на этой карте — без телепорта`); await epicSet({ step: 'arrive', at: Date.now(), via: 'here', mapChecked: true, seenSaved: false }); return; }
      if (!E.mapChecked) await epicSet({ mapChecked: true });
      if (!active()) return;
    } else if (!E.mapChecked) { env.setStatus(`Эпики: смотрю карту — вдруг ${e.nm} рядом (бесплатно)`); location.href = '/map.html'; await env.sleep(3000); return; }
    // перед любой дорогой (логово стоит адену, страница — Coin of Luck): жив ли он сейчас — свежий ответ сервера (≤3 мин), и по силам ли
    if (!(Date.now() - ((env.rt.epicDb || {})[E.k]?.apiT || 0) < 3 * MIN)) await epicApiScan('перед дорогой');
    if (!active()) return;
    const dz = (env.rt.epicDb || {})[E.k] || {};
    if (dz.alive === false) return epicGiveUpNext(E.k, `мёртв (по серверу), появится ${epicUntilTxt(dz.until)}`);
    if (dz.alive !== true) return epicGiveUp(E.k, 15, 'сервер не подтвердил, что он жив — в дорогу не иду');
    const v = epicVerdict(E.k); await epicVerdictSave(E.k, v);
    if (!active()) return;
    if (v.v !== 'ok') return epicGiveUp(E.k, 30, `в дорогу не иду — ${VLBL[v.v] || v.v}: ${v.why}`);
    const lz = epicLair(E.k);
    // 20.43 (автономность, доводка 21.10): перелёт по локациям запрещён после циклов (rt.actionBan.zoneGo, 2 ч) — диспетчер снял бы маршрут в
    // логово сразу после резерва адены, до телепорта, а прилёт через 25–90 с счёл бы это промахом логова (lairMiss, lairBadT на 6 ч) и дальше
    // выбрал бы платный «Телепорт» со страницы за Coin of Luck. Теперь эпик ждёт конца запрета: без резерва, без промаха логова и без страницы
    const zb = lz.ok && zoneGoBan();
    if (zb) return epicGiveUp(E.k, Math.max(1, Math.ceil((+zb.until - Date.now()) / MIN)), lairBanWhy(lz.zone, zb));
    if (lz.ok) {
      const res = await epicTpBudgetReserve(E.k, { known: true, col: 0, adena: lz.price }, { kind: 'lair' });
      if (!active()) { await cancelUnsent(res); return; }
      if (!res.ok) return epicGiveUp(E.k, 60, `логово: ${res.why}`);
      // 20.43 (доводка 21.10): lairT — когда создан маршрут, tpRes — время резерва адены: маршрут снят запретом до телепорта — резерв снимается на прилёте
      { const at = Date.now(); await epicSet({ step: 'arrive', at, via: 'zone', lair: lz.zone, lairT: at, tpRes: res.reservationAt || 0, seenSaved: false }); }   // lair — куда летим (rt.zone обновится только на карте)
      if (!active()) { await cancelUnsent(res); return; }
      await env.setRt({ zoneGo: { id: lz.zone, t: Date.now(), why: `эпик ${e.nm}` }, zoneGoT: 0 });
      if (!active()) { await cancelUnsent(res); return; }
      env.rec('B', 'эпики', `${e.nm}: лечу в логово ${lz.zone}${lz.price ? ' · ' + lz.price.toLocaleString('ru') + ' аден' : ''}`);
      location.href = '/teleport.html'; await env.sleep(4000);
      return;
    }
    if (E.noPay || E.lairOnly) return epicGiveUpNext(E.k, `после смерти/отхода/неудачного платного телепорта — только бесплатно или через логово, а ${lz.why}`);
    const pre = epicTpBudgetQuote(epicPrice(E.k, null, now, 6 * H), E.k);    // без сети: лимит 0 / предел на появление — сразу отказ
    if (!pre.ok && !pre.unknown) return epicGiveUp(E.k, 60, `платный телепорт не разрешён: ${pre.why}`);
    if (!isEpicPage()) { env.setStatus(`Эпики: к ${e.nm} — страница «Эпик боссы»`); location.href = env.EPIC_URL; await env.sleep(4000); return; }
    const b = await env.waitX(() => epicTpBtn(E.k), 8000, 200);
    if (!active()) return;
    const row = epicRowsParse()[E.k];
    if (row) { const db = { ...(env.rt.epicDb || {}) }, turn = lifeTurn(db[E.k], row) ? [row.id || db[E.k]?.id || E.id] : []; db[E.k] = epicSeen(db[E.k], { id: row.id || db[E.k]?.id || '', alive: row.alive, status: row.status, deny: row.deny, respH: row.respH || db[E.k]?.respH || 0, price: row.price, priceUnit: row.priceUnit, priceText: row.priceText, tp: row.tp, domT: now }, now); await env.setRt({ epicDb: db, ...lifeResetPatch(turn) }); }
    if (!active()) return;
    if (row && !row.alive) return epicGiveUpNext(E.k, `мёртв (${row.status || 'по списку'})`);
    if (row?.deny) return epicGiveUp(E.k, 60, row.deny);
    if (!b) return epicGiveUp(E.k, 60, 'кнопки «Телепорт» нет — платно не иду');
    // Не оплачиваем телепорт, если в известном запасе недостаточно лечебных банок (проверка включается игроком; данных нет — отказ)
    const minPots = Math.max(0, Math.floor(+env.cfg.epicMinHpPots || 0));
    if (minPots > 0) {
      const pots = env.potModel();
      if (!pots || pots.n < minPots) return epicGiveUp(E.k, 30, `до телепорта нужно ≥${minPots} банок HP сверх резерва, известно ${pots?.n ?? 'неизвестно'}`);
    }
    const gate = await epicPayGate(E.k, row);
    if (!active()) return;
    if (!gate.ok) return epicGiveUp(E.k, 60, `платный телепорт не разрешён: ${gate.why}`);
    const res = await epicTpBudgetReserve(E.k, gate.price);
    if (!active()) { await cancelUnsent(res); return; }
    if (!res.ok) return epicGiveUp(E.k, 60, `платный телепорт не разрешён: ${res.why}`);
    const tpT = Date.now();
    await epicSet({ step: 'arrive', at: tpT, via: 'page', id: row?.id || E.id, tpT, tpRes: res.reservationAt || 0, seenSaved: false });   // до нажатия: телепорт уводит со страницы
    if (!active()) { await cancelUnsent(res); return; }
    await env.setRt({ rbWant: row?.id || E.id || null, zoneGoT: Date.now() });
    if (!active()) { await cancelUnsent(res); return; }
    env.rec('B', 'эпики', `телепорт к ${e.nm}${res.cost ? ` · ${res.cost} ${res.unit}` : ' · бесплатно'} · ${String(gate.v?.why || '').slice(0, 120)}`);
    try { sessionStorage.removeItem('l2bot.epicTp'); } catch (er) {}
    await env.pause();
    if (!active()) { await cancelUnsent(res); return; }
    if (!env.fire(b)) { await epicTpBudgetRelease(E.k, res.reservationAt, 'кнопка не нажалась'); return epicGiveUp(E.k, 10, 'кнопка «Телепорт» не нажалась'); }
    env.transitionMonitor.expect('epicTp', location.pathname, 8000);
    if (await env.waitX(() => env.transitionMonitor.check('epicTp', location.pathname) === 'complete', 8000, 200)) return;
    if (!active()) return;
    env.transitionMonitor.clear('epicTp');
    const ack = epicTpAck({ tpT });
    if (ack && ack.ok === false) { await epicTpBudgetRelease(E.k, res.reservationAt, 'сервер отказал'); return epicGiveUp(E.k, 60, `сервер отказал в телепорте${ack.msg ? ': ' + ack.msg : ''}`); }
    // 8.0.3: таймаут перехода — НЕ отказ: CoL могли списать. Резерв остаётся, второй раз страницей не идём, карта покажет, долетели ли
    const msg = (env.$q('[role="alert"], [class*="toast"], [class*="err"]')?.textContent || '').trim().slice(0, 80);
    env.rec('B', 'эпики', `${e.nm}: переход после «Телепорт» не подтвердился${msg ? ' — ' + msg : ''} — резерв оставляю, смотрю карту`);
    return;
  }
  // ---- прилёт: ищем метку эпика, в бой ----
  if (E.step === 'arrive') {
    // 20.43 (автономность, доводка 21.10): маршрут в логово снял запрет перелётов, действовавший ещё до него (actions.banDrop снимает такой
    // zoneGo до запуска — телепорта и траты не было): не промах логова — резерв адены снимаем, эпика откладываем до конца запрета
    const zb = E.via === 'zone' && !E.seenSaved && +E.lairT > 0 && !env.rt.zoneGo && zoneGoBan(+E.lairT);
    if (zb) {
      await epicTpBudgetRelease(E.k, E.tpRes, 'маршрут в логово снят запретом перелётов до телепорта');
      if (!active()) return;
      return epicGiveUp(E.k, Math.max(1, Math.ceil((+zb.until - Date.now()) / MIN)), `маршрут в логово снят запретом перелётов до ${when(+zb.until)} — телепорта не было, это не промах логова; жду конца запрета`);
    }
    // 20.76+ (ревизия 28.10): навигация сама сняла маршрут без телепорта (адены нет сверх резерва, цена/валюта не прочитаны, кнопки нет,
    // персонаж не подтверждён, сверка «оплаты не было») — она пишет zoneBad этой зоне после создания маршрута. Раньше через 25 с это
    // считалось промахом логова (lairBadT на 6 ч, резерв адены висел), и дальше эпик шёл страницей за Coin of Luck. Не промах: резерв снят
    const nd = E.via === 'zone' && !E.seenSaved && +E.lairT > 0 && E.lair && !env.rt.zoneGo && !env.rt.travelCheck && +(env.rt.zoneBad || {})[E.lair] >= +E.lairT;
    if (nd) {
      await epicTpBudgetRelease(E.k, E.tpRes, 'перелёт в логово снят навигацией до оплаты');
      if (!active()) return;
      return epicGiveUp(E.k, 60, 'перелёт в логово не состоялся (адена сверх резерва / цена / кнопка / персонаж не подтверждены) — телепорта не было, это не промах логова');
    }
    if (E.via === 'page') {
      const ack = epicTpAck(E);
      if (ack && ack.ok === false) {
        try { sessionStorage.removeItem('l2bot.epicTp'); } catch (er) {}
        // 8.0.3 (ревью): «отказ», а метка эпика на этой карте — мы на месте: CoL, скорее всего, списан — резерв не снимаем
        if (env.isMap() && epicPins().some(x => x.k === E.k)) env.rec('B', 'эпики', `${e.nm}: сервер ответил отказом (${ack.status || '?'}${ack.msg ? ': ' + ack.msg : ''}), но он на карте — резерв оставляю`);
        else { await epicTpBudgetRelease(E.k, E.tpRes, 'сервер отказал'); return epicGiveUp(E.k, 60, `сервер отказал в телепорте${ack.msg ? ': ' + ack.msg : ''}`); }
      }
    }
    if (!env.isMap()) {
      if (now - (E.at || 0) > 90000) return epicArriveFail(E, e, 'карта не открылась');
      location.href = '/map.html'; await env.sleep(3000); return;
    }
    const ready = await env.mapReady(15000, `Эпики: ищу ${e.nm} на карте`);
    if (!active()) return;
    if (ready !== true) {
      const since = E.mapLoadT || Date.now();
      if (!E.mapLoadT) await epicSet({ mapLoadT: since });
      if (!active()) return;
      // 20.43 (автономность, разбор 21.10): одна перезагрузка и пауза до утра → 3 перезагрузки с растущей паузой (30 → 60 → 120 с), затем
      // этот эпик откладывается на 30 мин, режим идёт дальше. Второй платный заход в это появление по-прежнему не разрешён (paidN, лимит
      // Coin of Luck), неизвестный телепорт — отдельная сверка. Стоп с причиной — 4-я такая отсрочка за 6 ч (content.selfHoldStart)
      const reloads = +E.mapLoadReloads || 0;
      if (Date.now() - since < EPIC_MAP_WAITS[Math.min(reloads, EPIC_MAP_WAITS.length - 1)]) { env.setStatus?.(`Эпики: карта ещё не загружена — жду ${e.nm}${reloads ? ` (обновлений ${reloads}/3)` : ''}`); await env.sleep(1500); return; }
      if (reloads < 3) {
        await epicSet({ mapLoadT: Date.now(), mapLoadReloads: reloads + 1 });
        if (!active()) return;
        if (!reloads) env.rec('B', 'эпики', `${e.nm}: карта не загрузилась — обновляю страницу (до 3 раз с растущей паузой)`);
        location.reload(); await env.sleep(3000); return;
      }
      await epicSet({ mapLoadT: 0, mapLoadReloads: 0 });
      if (!active()) return;
      if (!env.selfHold) return env.pauseBot(`Эпики: карта не загрузилась после обновления; цель ${e.nm} сохранена. Проверь игру и продолжи`, { fault: true });   // 20.43: сервер лежит — ждём его
      const held = await env.selfHold('epicMap', `Эпики: карта не загрузилась после 3 обновлений (цель ${e.nm})`, { noWait: true });
      if (held !== 'defer' || !active()) return;
      // 20.43 (ревью au/breather): метка «карта не подтверждена» (rt.mapBad) — следующая платная дорога (логово/телепорт) только после
      // бесплатной проверки карты (content.mapGate), иначе при общем сбое карты режим платил бы за каждого следующего эпика
      await env.setRt({ mapBad: { at: Date.now(), why: `эпики, ${e.nm}`, loadAt: 0 } });
      if (!active()) return;
      // 20.43 (автономность, доводка 21.10): прилёт не подтверждён — общее правило epicArriveFail, а не отсрочка на 30 мин: после платного
      // телепорта со страницы второй раз страницей не идём (только подтверждённое логово или следующее появление), логово — учёт промаха
      // (lairMiss/lairBadT). Раньше через 30 мин эпик снова выбирался: при epicCoinPerBoss ≥ 2 — второй Coin of Luck на то же появление, а
      // логово за адену повторялось каждые 30 мин. Карта снова покажет его здесь — отсрочка и промах откатываются (epicMapRelease)
      if (E.via === 'page' || E.via === 'zone') return epicArriveFail(E, e, EPIC_MAP_WHY, { map: true });
      return epicGiveUp(E.k, 30, EPIC_MAP_WHY, epicMapFailMark(E));
    }
    if (E.mapLoadT || E.mapLoadReloads) { await epicSet({ mapLoadT: 0, mapLoadReloads: 0 }); if (!active()) return; }
    if (env.rt.mapBad) { await env.setRt({ mapBad: null }); if (!active()) return; }   // 20.43 (ревью): карта загрузилась — метка снята
    // 20.43 (автономность, доводка 21.10, ревью): и цепочка «отсрочка карты → проверка не прошла» прервана (content.selfHoldMapChain)
    { const ok = env.mapArriveOk?.('epicMap'); if (ok) { await ok; if (!active()) return; } }
    const r = await env.waitX(() => epicPins().find(x => x.k === E.k), 5000, 300);
    if (!active()) return;
    if (!r) {
      if (now - (E.at || 0) < 25000) { await env.sleep(1500); return; }
      return epicArriveFail(E, e, 'на карте его нет', { mapOk: true });
    }
    if (!E.seenSaved) {                             // на месте: запомнить локацию (бесплатный путь в следующий раз), логово подтверждено
      // 8.0.3 (ревью, probe1): rt.zone меняется только в zoneHere (фарм на карте) — сразу после телепорта там старая зона фарма, и
      // «логовом Орфена» записывался Blazing Swamp. Логово — то, куда летели (E.lair); страницей — не пишем (кнопка без data-teleport-id);
      // «он здесь» — rt.zone, только если перелёт не в пути (zonePend) и это настоящая точка телепорта
      const zp = env.rt.zonePend && now - (env.rt.zonePend.t || 0) < 120000, zh = E.via === 'here' && !zp ? env.rt.zone : '';
      const sz = E.via === 'zone' ? E.lair || '' : zh && env.rt.zoneCat?.[zh]?.city ? zh : '';
      // 20.43 (доводка 21.10, ревью fx/raid): он здесь и карта работает — метка «карта не загрузилась» больше не нужна; промах логова,
      // записанный только из-за карты, откатываем (логово подтверждено — счёт и так обнуляется)
      const mf = (env.rt.epicDb || {})[E.k]?.mapFail, mfBack = mf ? { mapFail: null, ...(mf.via === 'zone' && E.via !== 'zone' ? { lairMiss: +mf.lairMiss || 0, lairBadT: +mf.lairBadT || 0 } : {}) } : {};
      await epicDbSet(E.k, { id: r.id, ...(r.lvl ? { lvl: r.lvl } : {}), ...(sz ? { seenZone: sz } : {}), ...mfBack, ...(E.via === 'zone' ? { lairOkT: now, lairMiss: 0, lairBadT: 0 } : {}) });
      if (!active()) return;
      await epicSet({ seenSaved: true });
      if (!active()) return;
    }
    if ((E.tries || 0) >= 4) return epicGiveUp(E.k, 30, 'бой с ним 4 раза не открылся');
    // бой не открылся раньше — мешают миньоны зоны: бьём ближайшего и пробуем снова
    if ((E.tries || 0) >= 1 && E.guardT !== E.tries) {
      const g = epicGuards().filter(x => x.idx >= 0).sort((a, b) => a.idx - b.idx)[0] || epicGuards()[0];
      if (g) {
        await epicSet({ guardT: E.tries });
        if (!active()) return;
        env.rec('B', 'эпики', `${e.nm}: бой не открылся — бью миньона ${g.name} (${g.lvl})`);
        await env.setRt({ target: { name: g.name, champ: true, quest: false, rb: false }, mobClickAt: Date.now(), via: 'map' });
        if (!active()) return;
        if (g.idx >= 0 && await env.attackSpawn({ ...g, champ: true, rank: 0 }, () => `Эпики: миньон ${g.name}`, { active })) return;
        // attackSpawn мог завершиться из-за Stop/потери вкладки — прямой URL тоже начинает бой.
        if (!active()) return;
        location.href = '/battle.html?spawnId=' + encodeURIComponent(g.id); await env.sleep(4000); return;
      }
    }
    const bw = env.buffWaitBeforeRb();
    if (bw) { env.setStatus(`Эпики: жду откат «${bw.who}» ${bw.s} с, потом ${e.nm}`); await env.sleep(Math.min(bw.s, 10) * 1000); return; }
    const kills0 = env.rt.rbDb?.[r.id]?.kills || 0;
    await epicSet({ step: 'fight', id: r.id, kills0, died: false, retreatT: 0, leaveChecked: false });
    if (!active()) return;
    await env.setRt({ rbCur: r.id, rbWant: r.id });
    if (!active()) return;
    const res = await env.rbEngage(r, `Эпик: бой с ${e.nm}${E.deaths ? ` (заход ${E.deaths + 1})` : ''}`, { epic: true, active });
    if (!active()) return;
    if (res === 'skip') {                           // 8.0.3: окно на месте сказало «не полезу» — вердикт держится до нового уровня (а не 180 мин и снова платить)
      const ps = env.rt.rbPreSkip?.[r.id], so = { v: ps?.kind === 'pots' ? 'pots' : 'strong', why: String(env.rt.rbPlan?.why || env.rt.rbDb?.[r.id]?.note || 'оценка по окну босса').slice(0, 200), heroLvl: env.heroLvl(), heroMax: env.meHp()?.max || 0, t: now };
      await epicDbSet(E.k, { scoutNo: so });
      return epicGiveUp(E.k, 30, `оценка на месте: ${so.v === 'pots' ? 'мало банок' : 'не по силам'}`);
    }
    if (res) return;
    await epicSet({ step: 'arrive', at: Date.now() - 20000, tries: (E.tries || 0) + 1 });
    return;
  }
  await epicSet({ step: 'pick' });
}
 return { isEpicPage, epicOn, epicNum, epicById, epicByName, epicOf, epicWant, epicIdOf, epicPins, epicGuards, rowOf, unitOf, epicRowRead, epicRowsParse, epicTpBtn,
   epicUntil, epicUntilTxt, epicSeen, epicListScan, epicSet, epicDbSet, epicApiOk, epicApiNote, epicApiScan, epicApiDown, epicApiNext, epicApiDue, epicPollTick, epicScanAll,
   epicLvl, epicLvlWhy, epicPrice, epicTpBudgetQuote, epicTpBudgetReserve, epicTpBudgetRelease, VLBL, epicHeroMax, epicDps, epicVerdict, epicVerdictSave, epicVerdictAll,
   epicPayGate, epicLair, epicHereNow, epicRoute, epicPickWhy, epicPick, epicWhyNone, epicGiveUp, epicGiveUpNext, epicFlow, epicBuffWhy, epicBuffCol, epicFaOk, epicFaCovers, epicBuffPay, epicBuffRelease, epicTpAck, epicTpAckOf, epicTpReqFor,
   epicWoundHp, epicArriveFail, epicStep };
 };
})(globalThis);
