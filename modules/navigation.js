/* L2wap v7: isolated navigation feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.navigation = function create_navigation(env) {
const isMap = () => /\/map\.html/i.test(location.pathname);

function zoneRows() {                             // видимые строки «Окрестности» на странице телепорта
  const cat = {};
  for (const r of document.querySelectorAll('.l2-teleport-miru-surroundings-row')) {
    const b = r.querySelector('[data-teleport-id]'); if (!b) continue;
    const lv = (r.querySelector('.l2-teleport-miru-mob-level')?.textContent || '').match(/(\d+)\s*[-–]\s*(\d+)/);
    cat[b.dataset.teleportId] = {
      name: (r.querySelector('.l2-teleport-miru-surroundings-label > span')?.textContent || b.dataset.teleportId).trim(),
      city: r.closest('[data-surroundings-key]')?.dataset.surroundingsKey || '',
      price: +((r.querySelector('.l2-teleport-miru-price-num')?.textContent || '').replace(/\D/g, '') || 0),
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
    if (ctb && cl) cat[ctb.dataset.teleportId] = { ...(cat[ctb.dataset.teleportId] || {}), name: cl, city: key, town: true, price: +((cr.querySelector('.l2-teleport-miru-price-num')?.textContent || '').replace(/\D/g, '') || 0) };
    await env.sleep(env.rnd(120, 250));
  }
  const withLv = Object.values(cat).filter(c => c.lo && c.city).length;
  // мало зон — каталог неполный: не ставим отметку «прочитан», чтобы бот перечитал «Телепорт» позже
  await env.setRt({ zoneCat: cat, zoneCatT: withLv >= 5 ? Date.now() : 0, zoneScan: null, zoneCatFail: withLv >= 5 ? 0 : (env.rt.zoneCatFail || 0) + 1, zoneCatFailT: Date.now() });
  env.rec('B', 'локации', `зон в каталоге: ${Object.keys(cat).length} (с уровнями ${withLv}) · городов ${cities().length}, раскрыл ${opened}${withLv < 5 ? ' ⚠ мало — перечитаю позже' : ''}`);
}

function zoneHere() {                             // на карте: подтверждаем зону и запоминаем её мобов
  const names = [...new Set(env.pageItems().filter(i => !i.champ && !env.isRaidId(i.id)).map(i => i.name))];
  if (!names.length) return;
  const mobs = { ...(env.rt.zoneMobs || {}) };
  let id = env.rt.zone || null;
  if (env.rt.zonePend && Date.now() - env.rt.zonePend.t < 120000) id = env.rt.zonePend.id;
  else {
    const ov = z => (mobs[z] || []).filter(n => names.includes(n)).length;
    if (!id || ((mobs[id] || []).length >= 3 && !ov(id))) {     // мобы не те — ищем зону с такими мобами
      const best = Object.keys(mobs).map(z => [z, ov(z)]).sort((a, b) => b[1] - a[1])[0];
      id = best && best[1] ? best[0] : 'out:' + names.slice(0, 2).join(' / ');
    }
  }
  mobs[id] = [...new Set([...(mobs[id] || []), ...names])].slice(0, 40);
  const lv = env.pageItems().filter(i => !i.champ && i.lvl).map(i => i.lvl);
  const cat = env.rt.zoneCat || {};
  const patch = { zone: id, zonePend: null, zoneMobs: mobs, lvl: env.heroLvl() || env.rt.lvl };
  if (lv.length && (!cat[id] || !cat[id].lo || /^out:/.test(id))) patch.zoneCat = { ...cat, [id]: { ...(cat[id] || { name: id.replace(/^out:/, 'Окрестности: ') }), lo: Math.min(...lv), hi: Math.max(...lv) } };
  if (id !== env.rt.zone || env.rt.zonePend || patch.zoneCat || mobs[id].length !== (env.rt.zoneMobs?.[id] || []).length) {
    if (id !== env.rt.zone) env.rec('B', 'локации', `зона: ${zoneName(id)}`);
    return env.setRt(patch);
  }
}

const zoneCatThin = () => Object.values(env.rt.zoneCat || {}).filter(c => c.lo && c.city).length < 5;

const zoneName = id => (env.rt.zoneCat?.[id]?.name) || String(id || '?').replace(/^out:/, 'Окрестности: ');

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
function zoneRate(id, L) {
  const z = env.rt.zoneStat?.[id] || {};
  let n = 0, sec = 0, exp = 0, near = true;
  for (const [d, w] of Object.entries(ZW)) {
    const e = z[L + +d]; if (!e || !e.sec || !e.n) continue;
    n += e.n * w; sec += e.sec * w; exp += e.exp * w; if (+d === 0 && e.n >= 5) near = false;
  }
  if (n < 5 || !sec) { const e = z[L]; return e ? { n: e.n, few: true } : (n ? { n, few: true } : null); }
  return { n: Math.round(n), exp: exp / sec * 3600, near, sec: sec / n };
}
function zoneScore(r, prior) { const K = 20; return r?.exp ? (r.n * r.exp + K * prior) / (r.n + K) : 0; }

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
  const fit = Object.entries(env.rt.zoneCat || {}).filter(([id, c]) => id !== env.rt.zone && !/^out:|^rb:/.test(id) && c.lo && c.hi >= lo && c.lo <= hi && Date.now() - (bad[id] || 0) > 6 * 3600000)   // 7.1.30: не телепорт в ту же зону
    .sort((a, b) => (inWin(b[1]) >= 0.5) - (inWin(a[1]) >= 0.5) || Math.abs((a[1].lo + a[1].hi) / 2 - mid) - Math.abs((b[1].lo + b[1].hi) / 2 - mid) || (a[1].price || 0) - (b[1].price || 0));
  if (!fit.length) { env.rec('B', 'локации', `зон для ${lo}–${hi} ур. в «Телепорте» нет (в каталоге ${Object.keys(env.rt.zoneCat || {}).length}) — бью что есть`); return false; }
  const [id, c] = fit[0];
  env.rec('B', 'локации', `мобы тут ${Math.min(...lv)}–${Math.max(...lv)} ур., а герой ${L} → лечу в «${c.name || id}» (${c.lo}–${c.hi})`);
  await env.setRt({ zoneGo: { id, t: Date.now(), why: `зона своего уровня (${c.lo}–${c.hi})` }, zoneGoT: 0 });
  location.href = '/teleport.html'; await env.sleep(4000);
  return true;
}

function zonePick() {
  const L = env.heroLvl(), cat = env.rt.zoneCat || {}, cur = env.rt.zone, trial = Math.max(15, env.cfg.zoneTrial || 20);
  if (!L) return null;   // 7.1.30: уровень героя ещё не прочитан — не выбирать зону по окну −3…15
  const badZ = env.rt.zoneBad || {}, notBad = id => Date.now() - (badZ[id] || 0) > 6 * 3600000;   // 7.1.30: зона без кнопки/не по карману — 6 ч не пробуем
  const wLo = L - (env.cfg.lvlBelow ?? 3), wHi = L + Math.min(env.cfg.lvlAbove ?? 15, 15);   // v4.59: то же окно, что в меню (зона — не выше +15)
  const fits = Object.entries(cat).filter(([id, c]) => !/^out:/.test(id) && c.lo && c.lo <= wHi && c.hi >= wLo && notBad(id));
  const adena = env.rt.adenaSeen && Date.now() - env.rt.adenaSeen.t < 3600000 ? env.rt.adenaSeen.v : null;   // из магазина/телепорта, если видели недавно
  const afford = c => adena == null || !c.price || adena - c.price >= Math.min(env.cfg.shopReserve ?? 200000, adena / 2);
  const tried = env.rt.zoneTried || {};
  const here = zoneRate(cur, L);
  if (cur && !/^out:/.test(cur) && (here?.n || 0) < trial && !(env.rt.zoneTrialT && Date.now() - env.rt.zoneTrialT > 30 * 60000)) return null;   // текущую ещё изучаем (не дольше 30 мин)
  const rated = fits.map(([id, c]) => [id, c, zoneRate(id, L)]).filter(x => x[2]?.exp && x[2].n >= trial && afford(x[1]) && (x[0] === cur || Date.now() - (tried[x[0] + ':' + L] || 0) > 1800000));
  const prior = rated.length ? rated.map(x => x[2].exp).sort((a, b) => a - b)[Math.floor(rated.length / 2)] : 0;
  rated.sort((a, b) => zoneScore(b[2], prior) - zoneScore(a[2], prior));
  // проба новой зоны: если хороших замеров меньше двух — сразу, иначе не чаще раза в час (остальное время — лучшая известная)
  const fresh = fits.filter(([id, c]) => id !== cur && (zoneRate(id, L)?.n || 0) < trial && afford(c) && Date.now() - (tried[id + ':' + L] || 0) > 6 * 3600000)   // 7.1.30: не «пробовать» зону, в которой уже стоим
    .sort((a, b) => Math.abs((a[1].lo + a[1].hi) / 2 - (wLo + wHi) / 2) - Math.abs((b[1].lo + b[1].hi) / 2 - (wLo + wHi) / 2));
  // замеры уже есть — сначала лучшая известная зона, первая проба новой — через час
  if (!env.rt.zoneExploreT && rated.length >= 2) { env.rt.zoneExploreT = Date.now(); env.setRt({ zoneExploreT: env.rt.zoneExploreT }); }
  if (fresh.length && (rated.length < 2 || Date.now() - (env.rt.zoneExploreT || 0) > 3600000)) {
    env.rt.zoneExploreT = Date.now(); env.rt.zoneTrialT = Date.now(); env.setRt({ zoneExploreT: env.rt.zoneExploreT, zoneTrialT: env.rt.zoneTrialT });
    return { id: fresh[0][0], name: fresh[0][1].name, why: `пробую новую зону (${fresh[0][1].lo}-${fresh[0][1].hi})` };
  }
  const best = rated[0], hs = here?.exp ? zoneScore(here, prior) : 0;
  if (best && best[0] !== cur && (!hs || zoneScore(best[2], prior) > hs * 1.10))
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
  await env.setRt({ zoneTried: tried, zoneGoT: Date.now() });
  env.rec('B', 'локации', `телепорт → ${zoneName(g.id)}${g.why ? ' · ' + g.why : ''}`);
  env.fire(btn);
  await env.sleep(2500);
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
 return { isMap, zoneRows, isTeleport, tpCitiesReady, zoneCatalogScan, zoneHere, zoneCatThin, zoneName, zoneTrack, zoneRate, zoneForLevel, zonePick, zoneGoStep, toMap, toOutskirts, zoneByLoc, goOutskirts, isCity };
 };
})(globalThis);
