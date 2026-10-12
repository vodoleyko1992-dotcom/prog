/* L2wap 9.2: «☠ Лист врагов» — игроки, которые убили нашего героя, и ответный PvP.
   Откуда данные (код игры map.js / common.js / mapHeroRowRender.js, живой ответ 11.10 17:39 — Warlock убит игроком Dremia в Монастир Тиші):
   - смерть от игрока: pvpDefeat {killerName, killerCharacterId, deathEventId, scope:'world', fullLog:["На вас напали: [Dremia].",
     "[Dremia] −2444 HP (Буря).", …, "Вас вбив гравець [Dremia]!"]} — в /character, /game/map/sync и в ответе боя;
   - игроки рядом: /game/map/sync → around.nearbyHeroes и /game/map/around → nearbyHeroes [{characterId, name, level, pvpNickColor
     ('pk' красный | 'aggressor' фиолетовый), battleOnNameClick/showPkButton (сервер разрешает напасть), pvpAllowed, pvpBlockedReasonUk,
     isPartyMember}]; на карте — #map-hero-list li[data-character-id] с кнопкой ника .l2-map-hero-name-link--battle («Атакувати <ник>»);
   - на нас напали: pvpIncoming [{attackerCharacterId, attackerName}] → в шапке #l2-pvp-incoming с кнопкой #l2-pvp-incoming-attack;
   - начало PvP — кнопкой игры (POST /game/battle/pvp/start {targetCharacterId}); ошибки pvp_target_safe/pvp_attacker_safe/
     pvp_location_mismatch = «игрок в городе», pvp_target_dead/offline.
   Бот жмёт только кнопки игры, как игрок; свой запрос — только GET /game/map/around (следить, не вернулся ли враг). */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.enemies = function create_enemies(env) {
const MIN = 60000;
const HERO = { t: 0, list: [], zone: '' };   // игроки на локации — последний ответ игры (или список на странице карты)
const INC = { t: 0, list: [] };              // кто напал на нас сейчас
const DONE = new Set();                       // разобранные смерти (deathEventId) во вкладке
// 10.0 (аудит ядра): метка своего GET /game/map/around — в sessionStorage (иначе запрос на каждой загрузке страницы боя)
const ssNum = k => { try { return +sessionStorage.getItem(k) || 0; } catch (e) { return 0; } };
let scanT = ssNum('l2bot-enScanT'), scanBusy = false;
const low = s => String(s || '').trim().toLowerCase();
const keyOf = (id, name) => id ? String(id) : 'n:' + low(name);
const fmtA = n => Math.round(+n || 0).toLocaleString('ru');
const heroLvl = () => +env.heroLevel?.() || +env.rt.lvl || 0;
const list = () => env.rt.enemies && typeof env.rt.enemies === 'object' ? env.rt.enemies : {};
// враг из листа по id или по имени (ник в игре уникален; id надёжнее — ник можно сменить)
function find(id, name) {
  const E = list();
  if (id && E[id]) return E[id];
  const n = low(name);
  return n ? Object.values(E).find(e => low(e.name) === n) || null : null;
}
// удары убийцы из лога смерти: «[Dremia] −2444 HP (Буря).»
function hitsOf(log, name) {
  const out = [], n = low(name);
  for (const l of Array.isArray(log) ? log : []) {
    const m = String(l || '').match(/^\[([^\]]+)\]\s*[−–-]\s*([\d\s ]+)\s*HP/);
    if (m && low(m[1]) === n) { const v = +m[2].replace(/\D/g, ''); if (v > 0) out.push(v); }
  }
  return out;
}
// ---------- смерть от игрока → в лист врагов ----------
async function noteDefeat(pd) {
  if (!pd || !pd.name) return;
  if (pd.arena || (pd.scope && pd.scope !== 'world') || /tvt|arena/i.test(location.pathname)) return;   // TvT, арена, осада — не враги
  const ev = pd.ev || `${pd.name}:${Math.floor(Date.now() / MIN)}`;
  if (DONE.has(ev) || (env.rt.enemyDeaths || []).includes(ev)) return;
  DONE.add(ev);
  const now = Date.now(), k = keyOf(pd.id, pd.name), E = { ...list() }, old = find(pd.id, pd.name);
  const okey = old ? keyOf(old.id, old.name) : k;
  const e = { ...(old || { add: now, kills: 0, w: 0, l: 0, streak: 0 }) };
  if (okey !== k) delete E[okey];
  e.id = pd.id || e.id || ''; e.name = pd.name; e.kills = (e.kills || 0) + 1; e.lastKill = now; e.zone = HERO.zone || e.zone || '';
  const hits = hitsOf(pd.log, pd.name);
  if (hits.length) { const n0 = e.hitN || 0; e.hitMax = Math.max(e.hitMax || 0, ...hits); e.hitAvg = Math.round(((e.hitAvg || 0) * n0 + hits.reduce((a, b) => a + b, 0)) / (n0 + hits.length)); e.hitN = Math.min(50, n0 + hits.length); }
  const hunt = env.rt.enemyHunt, revenge = hunt && Date.now() - (hunt.t || 0) < 15 * MIN && (hunt.id ? hunt.id === e.id : low(hunt.name) === low(e.name));
  const patch = { enemyDeaths: [...(env.rt.enemyDeaths || []), ev].slice(-30) };
  if (revenge) {
    e.l = (e.l || 0) + 1; e.streak = (e.streak || 0) + 1;
    e.skipT = now + 30 * MIN; e.skipWhy = 'проиграли ответный бой — пауза 30 мин';
    const maxL = Math.max(1, +env.cfg.enemyMaxLoss || 2);
    if (e.streak >= maxL) { e.blockLvl = heroLvl(); e.skipWhy = `проиграли ${e.streak} раза подряд — не трогаю до нового уровня`; }
    patch.enemyHunt = null;
  }
  E[keyOf(e.id, e.name)] = e;
  patch.enemies = E;
  await env.setRt(patch);
  const hit = hits.length ? ` · удары ${hits.map(fmtA).join(', ')}` : '';
  env.rec('B', 'враги', revenge ? `ответный бой с ${e.name} проигран (${e.l} пораж., ${e.w} побед)${hit} — ${e.skipWhy}`
    : `игрок ${e.name} убил нас${e.zone ? ` (${e.zone})` : ''} — в листе врагов, убийств ${e.kills}${hit}`);
}
// ---------- игроки на локации ----------
function noteHeroes(heroes, zone) {
  HERO.t = Date.now(); HERO.list = Array.isArray(heroes) ? heroes.filter(h => h && h.name) : []; if (zone) HERO.zone = zone;
  const E = list(); if (!Object.keys(E).length) return;
  let ch = null;
  for (const h of HERO.list) {
    const e = find(h.id, h.name); if (!e) continue;
    const k = keyOf(e.id, e.name), back = Date.now() - (e.seenT || 0) > 10 * MIN;
    if (back || (h.lvl && h.lvl !== e.lvl) || (h.id && !e.id) || Date.now() - (e.seenT || 0) > 2 * MIN) {
      ch = ch || { ...E };
      const ne = { ...e, id: e.id || h.id || '', lvl: h.lvl || e.lvl || 0, seenT: Date.now(), seenZone: HERO.zone || e.seenZone || '' };
      delete ch[k]; ch[keyOf(ne.id, ne.name)] = ne;
    }
    if (back) env.rec('B', 'враги', `враг ${e.name}${h.lvl ? ` (${h.lvl} ур.)` : ''} на локации${HERO.zone ? ` ${HERO.zone}` : ''}${verdict(e, h) ? ` — не нападаю: ${verdict(e, h)}` : ''}`);
  }
  if (ch) env.setRt({ enemies: ch });
}
// список на странице карты — если ответ игры не дошёл (бот запущен посреди страницы)
function domHeroes() {
  return [...document.querySelectorAll('#map-hero-list li[data-character-id]')].map(li => {
    const b = li.querySelector('.l2-map-hero-name-link--battle');
    const nm = (li.querySelector('.l2-map-hero-name-link--battle, .l2-map-hero-name-link, .l2-map-hero-name-link--support')?.textContent || '').trim();
    const col = li.querySelector('.l2-pvp-nick--pk') ? 'pk' : li.querySelector('.l2-pvp-nick--aggressor') ? 'aggressor' : '';
    return { id: li.dataset.characterId || '', name: nm, lvl: +(li.querySelector('.l2-map-hero-level')?.textContent.match(/\d+/)?.[0] || 0),
      col, atk: !!b, party: !!li.querySelector('.l2-map-hero-party-tag, .l2-map-hero-name-link--support') };
  }).filter(h => h.name);
}
// ---------- можно ли нападать ----------
// пусто — можно; иначе причина (для журнала и меню)
function verdict(e, h, me) {
  if (!e) return 'не в листе';
  if (env.cfg.enemyHunt === false) return 'нападение выключено в меню';
  if (e.ignore) return 'вы отметили «не трогать»';
  const L = heroLvl();
  if (e.blockLvl && L && L <= e.blockLvl) return e.skipWhy || 'проигрывали — жду нового уровня';
  if ((e.skipT || 0) > Date.now()) return e.skipWhy || 'пауза';
  h = h || {};
  if (h.party) return 'в одной группе с нами';
  if (h.atk === false) return h.why || 'игра не даёт напасть (нет кнопки атаки)';
  if (h.ok === false) return h.why || 'игра не даёт напасть';
  if (env.cfg.enemyFlagOnly !== false && h.col !== undefined && !['pk', 'aggressor'].includes(h.col)) return 'ник не красный и не фиолетовый — за нападение дадут карму';
  const lv = h.lvl || e.lvl || 0, above = env.cfg.enemyLvlAbove ?? 3;
  if (lv && L && lv - L > above) return `выше нас на ${lv - L} ур.`;
  me = me || env.meHp?.();
  const minHits = +(env.cfg.enemyMinHits ?? 3);
  if (minHits > 0 && e.hitMax && me?.max && me.max / e.hitMax < minHits) return `убивает нас за ${Math.max(1, Math.ceil(me.max / e.hitMax))} удара (удар до ${fmtA(e.hitMax)} при ${fmtA(me.max)} HP)`;
  if (me?.max && me.cur < me.max * 0.8) return 'HP ниже 80 % — сначала восстановиться';
  return '';
}
// враг на локации, на которого можно напасть (больше убийств — первым)
function pick() {
  if (Date.now() - HERO.t > 90000) return null;
  const me = env.meHp?.();
  return HERO.list.map(h => ({ h, e: find(h.id, h.name) })).filter(x => x.e && !verdict(x.e, x.h, me))
    .sort((a, b) => (b.e.kills || 0) - (a.e.kills || 0))[0] || null;
}
// бот занят тем, что прерывать нельзя (поход, тур РБ/эпиков, рыбалка, катакомбы, TvT скоро)
function busy() {
  const r = env.rt;
  if (r.shop || r.rbGo || r.zoneGo || r.revive || r.tbuff || r.magister || r.invScan || r.fishSvc) return true;
  if (r.rbSess?.on || (r.epic?.step && r.epic.step !== 'pick')) return true;
  if (['epic', 'raid', 'fish', 'cat'].includes(env.autonomyMode())) return true;
  if (env.fishNow()) return true;
  if (env.cfg.tvtOn && env.tvtSoon?.()) return true;
  return false;
}
const pvpPage = () => env.isBattle() && /[?&]pvpTargetId=/.test(location.search);
// ---------- ответы игры (hook.js → поле pv) ----------
function onNet(path, d) {
  const pv = d.pv;
  if (pv?.defeat) noteDefeat(pv.defeat).catch(() => {});
  if (pv?.heroes) noteHeroes(pv.heroes, pv.zone);
  if (pv?.incoming) { INC.t = Date.now(); INC.list = pv.incoming; }
  if (path === '/game/battle/pvp/start' && d.method === 'POST') onStart(d);
  // победа в ответном бою — ответ хода с victory на странице PvP с этим врагом
  if (d.bt?.win && pvpPage()) onWin(new URLSearchParams(location.search).get('pvpTargetId') || '');
}
async function onStart(d) {
  const tid = String(d.req?.targetCharacterId || ''), e = find(tid, '');
  if (d.status >= 200 && d.status < 300 && !d.res?.error) { if (e) env.rec('B', 'враги', `бой с ${e.name} начат`); return; }
  const code = String(d.res?.error || d.status || ''), now = Date.now();
  if (!e) return;
  const city = /pvp_target_safe|pvp_attacker_safe|pvp_location_mismatch/.test(code), gone = /pvp_target_dead|offline/.test(code);
  const why = city ? 'в городе / безопасной зоне' : gone ? 'не в игре или уже мёртв' : `игра отказала (${code})`;
  const E = { ...list() }; E[keyOf(e.id, e.name)] = { ...e, skipT: now + (city ? 10 : gone ? 5 : 15) * MIN, skipWhy: why };
  await env.setRt({ enemies: E, enemyHunt: null });
  env.rec('B', 'враги', `напасть на ${e.name} не вышло: ${why}`);
}
async function onWin(tid) {
  const hunt = env.rt.enemyHunt, e = find(tid || hunt?.id, hunt?.name);
  if (!e || !hunt || (e.lastWin || 0) > (hunt.t || 0)) return;
  const E = { ...list() }; E[keyOf(e.id, e.name)] = { ...e, w: (e.w || 0) + 1, streak: 0, blockLvl: 0, lastWin: Date.now(), skipT: 0, skipWhy: '' };
  await env.setRt({ enemies: E, enemyHunt: { ...hunt, won: Date.now() } });
  env.rec('B', 'враги', `🏆 победа над ${e.name} (побед ${(e.w || 0) + 1}, поражений ${e.l || 0}) — слежу, не вернётся ли`);
}
// ---------- следим за локацией (фоном, только GET) ----------
async function tick() {
  if (env.cfg.enemyHunt === false || scanBusy || !Object.keys(list()).length) return;
  const every = Math.max(15, +env.cfg.enemyScanS || 30) * 1000;
  if (Date.now() - scanT < every || Date.now() - HERO.t < every) return;   // на карте игра сама опрашивает /game/map/sync раз в 15 с
  if (busy() || /tvt|arena|dungeon|catacomb|city|town|fishing/i.test(location.pathname)) return;
  scanT = Date.now(); scanBusy = true; try { sessionStorage.setItem('l2bot-enScanT', String(scanT)); } catch (e) {}
  try {
    const r = await env.gameGet('/game/map/around');
    if (!r?.ok) return;
    const j = await r.json(), a = Array.isArray(j?.nearbyHeroes) ? j.nearbyHeroes : null;
    if (a) noteHeroes(a.map(h => ({ id: String(h.characterId || ''), name: String(h.name || ''), lvl: +h.level || 0, col: String(h.pvpNickColor || ''),
      atk: 'battleOnNameClick' in h || 'showPkButton' in h ? h.battleOnNameClick === true || h.showPkButton === true : null,
      ok: typeof h.pvpAllowed === 'boolean' ? h.pvpAllowed : null, why: String(h.pvpBlockedReasonUk || ''), party: !!h.isPartyMember })), String(j.nearestLabelUk || ''));
  } catch (e) {} finally { scanBusy = false; }
}
// ---------- шаг главного цикла: true — бот занят врагом ----------
async function step() {
  // конец ответного боя: экран итога PvP или поражение — на карту (там же и следим дальше)
  if (pvpPage()) {
    const res = env.$q('#battle-pvp-result-root');
    if (env.shown(res) || env.victory?.()) { await env.setRt({ enemyHunt: null }); env.setStatus('Враги: бой окончен — на карту'); await env.sleep(1500); await env.toMap(); return true; }
    return false;
  }
  if (env.cfg.enemyHunt === false || !Object.keys(list()).length) return false;
  // враг из листа напал на нас сейчас — отвечаем кнопкой игры «Атакувати»
  if (Date.now() - INC.t < 20000 && INC.list.length && !busy()) {
    for (const x of INC.list) {
      const e = find(x.id, x.name), h = HERO.list.find(y => (x.id && y.id === x.id) || low(y.name) === low(x.name));
      if (!e || verdict(e, h || {})) continue;
      const btn = env.$q('#l2-pvp-incoming-attack');
      if (!env.shown(btn) || btn.disabled) break;
      env.rec('B', 'враги', `${e.name} напал на нас — отвечаю (враг из листа, убивал нас ${e.kills} раз)`);
      await env.setRt({ enemyHunt: { id: e.id || x.id, name: e.name, t: Date.now(), via: 'incoming' } });
      env.fire(btn); INC.t = 0; await env.sleep(4000); return true;
    }
  }
  if (env.isMap() && Date.now() - HERO.t > 20000) { const dh = domHeroes(); if (dh.length) noteHeroes(dh, HERO.zone); }
  const p = pick(); if (!p || busy()) return false;
  if (env.isBattle()) {                                    // идёт бой с мобом — добиваем, на врага после победы
    if (!env.victory?.()) return false;
    env.rec('B', 'враги', `враг ${p.e.name} на локации — после победы иду на карту`);
    await env.toMap(); return true;
  }
  if (!env.isMap()) return false;                          // не на локации (город, магазин…) — обычный путь бота вернёт на карту
  const sel = `#map-hero-list li[data-character-id="${CSS.escape(p.h.id || p.e.id || '')}"] .l2-map-hero-name-link--battle`;
  const btn = (p.h.id || p.e.id) ? await env.waitX(() => { const b = env.$q(sel); return env.shown(b) ? b : null; }, 3000, 150) : null;
  if (!btn) {
    const E = { ...list() }; E[keyOf(p.e.id, p.e.name)] = { ...p.e, skipT: Date.now() + 2 * MIN, skipWhy: 'нет кнопки атаки в списке игроков' };
    await env.setRt({ enemies: E }); return false;
  }
  const lv = p.h.lvl || p.e.lvl;
  env.setStatus(`Враги: нападаю на ${p.e.name}`);
  env.rec('B', 'враги', `нападаю на ${p.e.name}${lv ? ` (${lv} ур.)` : ''} — убивал нас ${p.e.kills} раз, ответных побед ${p.e.w || 0}, поражений ${p.e.l || 0}`);
  // 10.0 (аудит): кнопка не запустила бой — не жать её каждые 4 с: этот враг 2 мин не выбирается (бой начался — неважно)
  const E2 = { ...list() }; E2[keyOf(p.e.id, p.e.name)] = { ...p.e, skipT: Date.now() + 2 * MIN, skipWhy: 'нажал «напасть», жду боя' };
  await env.setRt({ enemyHunt: { id: p.e.id || p.h.id, name: p.e.name, t: Date.now(), via: 'map' }, enemies: E2 });
  env.fire(btn);
  await env.sleep(4000);
  return true;
}
// для меню: строка о враге
function brief(e, now = Date.now()) {
  const ago = t => { const m = Math.round((now - t) / MIN); return m < 60 ? `${m} мин` : m < 1440 ? `${Math.round(m / 60)} ч` : `${Math.round(m / 1440)} дн`; };
  return `${e.name}${e.lvl ? ` (${e.lvl} ур.)` : ''}: убил нас ${e.kills || 0}×${e.lastKill ? `, последний раз ${ago(e.lastKill)} назад` : ''}${e.zone ? ` (${e.zone})` : ''}`
    + ` · ответ: побед ${e.w || 0}, поражений ${e.l || 0}${e.hitMax ? ` · удар до ${fmtA(e.hitMax)}` : ''}${e.seenT ? ` · видели ${ago(e.seenT)} назад` : ''}`
    + (e.ignore ? ' · не трогать' : e.blockLvl ? ` · ${e.skipWhy || 'ждёт нового уровня'}` : (e.skipT || 0) > now ? ` · пауза: ${e.skipWhy || ''}` : '');
}
 return { hitsOf, noteDefeat, noteHeroes, domHeroes, verdict, pick, busy, onNet, onStart, onWin, tick, step, brief, find, _state: { HERO, INC } };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
