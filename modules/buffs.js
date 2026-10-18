/* L2wap v7: isolated buffs feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.buffs = function create_buffs(env) {
const location = env.routeLocation || root.location;
function contextGuard() {
  const char=env.rt.char,lease=env.leaseEpoch,kick=env.rt.manualKickAt;
  const same=()=>env.tabOwner!==false&&env.rt.char===char&&env.leaseEpoch===lease&&env.rt.manualKickAt===kick;
  const active=()=>env.on!==false&&same();active.same=same;return active;
}
function activeBuffs() {
  return [...document.querySelectorAll('#l2-hud-active-buffs [data-skill-id]')]
    .map(e => ({ id: +e.dataset.skillId, title: e.getAttribute('title') || '', exp: +(e.dataset.expiresAt || 0) }));
}

function buffDur(il, title) {                    // длительность баффа, с: справочник Interlude или «на 120 с» из подсказки
  return il?.dur || +((title || '').match(/на\s*(\d+)\s*с(?![а-яa-z])/i)?.[1] || 0) || env.cfg.buffSec || 118;
}

function ownBuffLeft(name, il, title) {          // сколько мс бафф ещё висит по нашему времени нажатия (0 — не знаем / вышел)
  const at = env.rt.buffAt?.[name];
  return at ? at + buffDur(il, title) * 1000 - Date.now() : 0;
}

function buffWaitBeforeRb() {
  let w = 0, who = '';
  for (const bn of env.names(env.cfg.nBuffs)) {
    const until = env.rt.cdUntil?.[bn] || 0, left = (until - Date.now()) / 1000;
    if (left <= 0 || left > 60) continue;                      // готов или ждать слишком долго
    if (ownBuffLeft(bn, env.IL[env.IL_BY_NAME[bn]], '') > 30000) continue;   // ещё висит — бой начнём с ним
    if (left > w) { w = left; who = bn; }
  }
  return w ? { s: Math.ceil(w), who } : null;
}

function buffActive(name, b) {                // есть ли бафф в строке активных баффов у шапки
  const il = b && env.ilOf(b);
  if (il) {
    const act = activeBuffs(), a = act.find(x => x.id === il.id);
    if (a) {
      if (!a.exp) return true;
      if (a.exp - Date.now() > 4000) return true;
      // v4.41: значок в шапке «просрочен» — раньше при опоздании >60 с бот считал «часы сдвинуты, бафф висит» и больше
      // не обновлял тотем до конца боя (в долгом бою с РБ страница не перезагружается, значок остаётся). Теперь сверяемся
      // со своим временем баффа: длительность — из справочника или из подсказки игры («на 120 с»)
      return false; // HUD expiry is authoritative when server provides expiresAt; stale local timestamps cannot keep it alive.
    }
    if (act.length) return false;               // строка видна, нашего ID нет — баффа нет
  }
  const box = env.$q('#l2-hud-active-buffs');
  if (!box) return false;
  const txt = [box.textContent, ...[...box.querySelectorAll('[title],[alt],[aria-label]')]
    .map(e => e.getAttribute('title') || e.getAttribute('alt') || e.getAttribute('aria-label'))].join(' ').toLowerCase();
  return txt.includes(name);
}

function buffAudit(ctx, me) {
  const list = buffList(ctx), act = activeBuffs(), out = [];
  for (const bn of env.names(env.cfg.nToggles)) {          // v5.3: постоянные баффы
    const b = env.slotsBy(bn)[0], st = b ? env.toggleState(bn, b) : null;
    out.push({ bn: b ? env.cleanTitle(b.title) : bn, key: 'tgl:' + bn, st: !b ? 'bad' : st === true ? 'ok' : env.rt.toggleOff?.[bn] ? 'info' : st === false ? 'miss' : 'info',
      why: !b ? 'нет на панели боя' : st === true ? 'постоянный — включён' : env.rt.toggleOff?.[bn] ? `выключен из-за MP — включу при MP ≥ ${env.cfg.toggleMpOn ?? 30}%` : st === false ? 'постоянный — выключен, включаю' : 'постоянный — состояние не видно, держу по памяти' });
  }
  for (const bn of [...new Set([...env.names(env.cfg.nBuffs), ...env.names(env.cfg.nKeyBuffs)])]) {
    const b = env.slotsBy(bn)[0], il = b && env.ilOf(b), blk = ctx?.block?.['buff:' + bn] || 0;
    let st = 'ok', why = '';
    if (!b) { st = 'bad'; why = 'нет на панели боя — перетащите скилл на панель или проверьте название'; }
    else if (il?.pc?.hp) { st = buffActive(bn, b) ? 'ok' : 'info'; why = buffActive(bn, b) ? 'аварийный — висит' : `аварийный — только при HP ≤ ${il.pc.hp}%${il.id === 420 ? ' (с РБ — на добивании ≤15 %: режет лечение)' : ''}`; }
    else if (!list.includes(bn) && env.names(env.cfg.nKeyBuffs).includes(bn) && !env.names(env.cfg.nBuffs).includes(bn)) { st = 'info'; why = 'важный — ставлю в бою с РБ и чемпионами'; }
    else if (!list.includes(bn)) {
      if (env.isTotem(b)) { st = 'info'; why = `тотем: сейчас ставится ${totemPick() || 'другой'} (висит только один)`; }
      else { const tw = env.names(env.cfg.nBuffs).find(x => x !== bn && list.includes(x) && env.ilOf(env.slotsBy(x)[0])?.st === il?.st); st = 'info'; why = `не стакается с «${tw || '?'}» (тот же тип) — ставится сильнейший`; }
    }
    else if (blk === Infinity) { st = 'bad'; why = 'недоступен с текущим оружием (до конца боя)'; }
    else if (buffActive(bn, b)) { const a = il && act.find(x => x.id === il.id), left = a?.exp ? Math.round((a.exp - Date.now()) / 1000) : Math.round(ownBuffLeft(bn, il, b.title) / 1000); why = left > 0 ? `висит, ещё ${left} с` : 'висит'; }
    else if (!env.ready(b)) { st = 'wait'; why = `на откате ${Math.ceil(Math.max(env.memLeft(b), parseFloat(env.slotCd(b)?.textContent || 0) || 0))} с`; }
    else { st = 'miss'; why = 'не висит — должен ставиться'; }
    out.push({ bn: b ? env.cleanTitle(b.title) : bn, key: bn, st, why });
  }
  return out;
}

async function buffAuditStep(ctx, me) {
  const out = buffAudit(ctx, me), now = Date.now(), prev = env.rt.buffAudit?.list || [];
  const fix = {}, notes = [];
  for (const x of out) {
    const was = prev.find(p => p.key === x.key);
    if (x.st === 'bad' && (!was || was.why !== x.why)) notes.push(`${x.bn}: ${x.why}`);
    if (x.st !== 'miss') continue;
    const since = now - (env.rt.buffAt?.[x.key] || 0);
    if (env.rt.buffSeen?.[x.key] && since > 20000 && since < 3 * 3600000) {
      fix[x.key] = 0; ctx.block['buff:' + x.key] = 0;
      const left = Math.round(((env.ilOf(env.slotsBy(x.key)[0])?.dur || env.cfg.buffSec || 118) * 1000 - since) / 1000);
      if (now - (env.rt.buffFixT?.[x.key] || 0) > 180000) notes.push(`${x.bn}: ${left > 0 ? `пропал из строки баффов раньше времени (таймер считал ещё ${left} с)` : 'кончился'} — ставлю заново`);
    }
  }
  const patch = { buffAudit: { t: now, list: out } };
  if (Object.keys(fix).length) { patch.buffAt = { ...(env.rt.buffAt || {}), ...fix }; patch.buffFixT = { ...(env.rt.buffFixT || {}), ...Object.fromEntries(Object.keys(fix).map(k => [k, now])) }; }
  await env.setRt(patch);
  if (notes.length) env.rec('S', 'проверка баффов', notes.join(' · '));
}

function buffList(ctx = env.BUFF_CTX) {
  const keys = ctx && (ctx.rb || ctx.champ || env.cfg.keyBuffBoss === false) ? env.names(env.cfg.nKeyBuffs) : [];
  // 9.0: свой Noblesse Blessing (статус Noblesse) — бафф, если он на панели боя (уходит со смертью, держит остальные баффы)
  const nob = env.rt.story?.nobleOwn && env.slotsBy('noblesse blessing')[0] ? ['noblesse blessing'] : [];
  const arr = [...new Set([...env.names(env.cfg.nBuffs), ...keys, ...nob])].map(bn => ({ bn, b: env.slotsBy(bn)[0] }))
    .filter(x => !x.b || env.ilOf(x.b)?.autoUse !== false); // 20.3: ручные эффекты не исполняем из старой ошибочной роли.
  const tot = arr.filter(x => x.b && env.isTotem(x.b));
  const pick = tot.length ? totemPick() : null;   // тотемы: висит только один — какой ставить сейчас, решает замер
  const best = {};
  for (const x of arr) {
    if (tot.includes(x)) continue;
    const il = x.b && env.ilOf(x.b);
    if (!il?.st) continue;
    if (!best[il.st] || (il.sc || 0) > (env.ilOf(best[il.st].b)?.sc || 0)) best[il.st] = x;
  }
  return arr.filter(x => { if (tot.includes(x)) return x.bn === pick; const st = x.b && env.ilOf(x.b)?.st; return !st || best[st] === x; }).map(x => x.bn);
}

function totemSlots() { return env.names(env.cfg.nBuffs).map(bn => ({ bn, b: env.slotsBy(bn)[0] })).filter(x => x.b && env.isTotem(x.b)); }

function totemActive(list = totemSlots()) { return list.find(x => buffActive(x.bn, x.b)) || null; }

function totemPick() {
  const all = totemSlots();
  if (all.length < 2) return all[0]?.bn || null;           // один тотем — как раньше
  // «недоступен» (не то оружие) последние 30 мин — не выбираем, иначе бот ждал бы его вечно
  const list = all.filter(x => Date.now() - (env.rt.skills?.[x.bn]?.unavailT || 0) > 1800000);
  const E = env.rt.buffEff || {}, n = x => E[x.bn]?.n || 0, act = totemActive(all);
  // 1) замер: незамеренный готовый тотем пробуем, когда висящий уже замерен (или тотема нет)
  const raw = list.filter(x => n(x) < env.TOTEM_MIN && env.ready(x.b)).sort((a, b) => n(a) - n(b))[0];
  if (raw && (!act || n(act) >= env.TOTEM_MIN)) return raw.bn;
  if (act && n(act) < env.TOTEM_MIN) return null;              // идёт замер висящего — не трогаем
  // 2) лучший по замеру; на откате — держим висящий, а если тотема нет — следующий готовый
  const meas = list.filter(x => n(x) >= env.TOTEM_MIN).sort((a, b) => E[b.bn].r - E[a.bn].r);
  const top = meas[0];
  if (!top) return null;
  if ((act && act.bn === top.bn) || env.ready(top.b)) return top.bn;          // висит — цикл баффов пропустит; откатился — ставим поверх запасного
  if (act) return null;
  const none = E['—'];
  return meas.slice(1).find(x => env.ready(x.b) && (!none || none.n < env.TOTEM_MIN || E[x.bn].r > none.r))?.bn || null;
}

async function totemNote(ctx, dps) {
  const all = Object.values(ctx.tot).reduce((a, b) => a + b, 0);
  const [k, ms] = Object.entries(ctx.tot).sort((a, b) => b[1] - a[1])[0] || [];
  if (!k || !all || ms / all < 0.7 || !dps) return;
  const mob = ctx.name.toLowerCase(), T = { ...(env.rt.totemDps || {}) }, m = { ...(T[mob] || {}) }, e = m[k] || { n: 0, dps: 0 };
  m[k] = { n: e.n + 1, dps: Math.round(e.dps + (dps - e.dps) / Math.min(e.n + 1, 30)) };
  T[mob] = m;
  if (Object.keys(T).length > 300) delete T[Object.keys(T)[0]];
  const S = {};                                    // сводка: n — боёв, r — скорость к среднему (1.10 = на 10 % быстрее)
  for (const mm of Object.values(T)) {
    const keys = Object.keys(mm).filter(x => mm[x].n >= 2);
    for (const x of Object.keys(mm)) (S[x] ||= { n: 0, w: 0, rs: 0 }).n += mm[x].n;
    if (keys.length < 2) continue;
    const avg = keys.reduce((a, x) => a + mm[x].dps, 0) / keys.length;
    for (const x of keys) { const w = Math.min(mm[x].n, ...keys.map(y => mm[y].n)); S[x].w += w; S[x].rs += w * mm[x].dps / avg; }
  }
  const eff = Object.fromEntries(Object.entries(S).map(([x, v]) => [x, { n: v.n, r: v.w ? +(v.rs / v.w).toFixed(3) : 1,
    name: x === '—' ? 'без тотема' : env.cleanTitle(env.slotsBy(x)[0]?.title || '') || x }]));
  if (eff[k].n === env.TOTEM_MIN) env.rec('B', 'тотем', `${eff[k].name}: замер готов (${env.TOTEM_MIN} боёв) · скорость убийства ${eff[k].r >= 1 ? '+' : ''}${Math.round((eff[k].r - 1) * 100)} % к среднему`);
  await env.setRt({ totemDps: T, buffEff: eff });
}

let planningSnapshot = null;
function hudBuffs() {                              // skillId → истекает (мс); null — шапки с баффами нет
  if(planningSnapshot)return planningSnapshot.H;
  const box = env.$q('#l2-hud-active-buffs');
  if (!box) return null;
  const m = {};
  box.querySelectorAll('.l2-hud-active-buff[data-skill-id]').forEach(b => { m[+b.dataset.skillId] = +b.dataset.expiresAt || Infinity; });
  return m;
}

// 7.2.2 (игрок 10.10 23:18: «автобафф снёс мне более качественный бафф за FA»): у баффера FA и в платных наборах есть те же баффы,
// что в городском, но выше уровнем (Щит Lv.3, Кмітливість Lv.3…). Городской набор, наложенный поверх, понижает их до своих уровней
// (и ставит 24 ч). Теперь: набор не берём, если он понизит хоть один активный бафф (уровень — из подсказки «· Lv.N» на панели игры,
// уровни набора — со страницы баффера, «Щит — lvl 2»; заводские — по снимку 10.10)
const TB_LVL_DEF = { basic: { 1036: 1, 1040: 2, 1045: 5, 1048: 5, 1059: 2, 1062: 1, 1068: 2, 1077: 2, 1085: 2, 1086: 1, 1240: 2, 1242: 2, 1268: 3 } };
function hudLevels() {                             // skillId → уровень (из подсказки «… · Lv.3»)
  if(planningSnapshot)return planningSnapshot.levels;
  const m = {};
  env.$q('#l2-hud-active-buffs')?.querySelectorAll('.l2-hud-active-buff[data-skill-id]').forEach(b => { const l = (b.getAttribute('title') || '').match(/Lv\.?\s*(\d+)/i); if (l) m[+b.dataset.skillId] = +l[1]; });
  return m;
}
function tbLevelsNote() {                          // страница городского баффера: уровни баффов каждого набора
  if (!/\/town-buffer\.html/.test(location.pathname)) return 0;
  const out = {};
  for (const btn of document.querySelectorAll('.l2-town-buffer-set-apply[data-set-id]')) {
    const card = btn.closest('section, article, li, [class*="set-card"], [class*="town-buffer-set"]') || btn.parentElement;
    const L = {};
    card?.querySelectorAll('img[src*="skill-icon/"]').forEach(img => { const id = +(img.getAttribute('src').match(/skill-icon\/(\d+)/) || [])[1], l = (img.getAttribute('title') || '').match(/lvl\s*(\d+)/i); if (id && l) L[id] = +l[1]; });
    if (Object.keys(L).length) out[btn.dataset.setId] = L;
  }
  if (Object.keys(out).length && JSON.stringify(out) !== JSON.stringify(env.rt.tbLvl || {})) env.setRt({ tbLvl: out });
  return Object.keys(out).length;
}
function tbDowngrade(set, H) {                     // какие активные баффы набор понизит: [{ id, have, give }]
  const L = env.rt.tbLvl?.[set] || TB_LVL_DEF[set] || {}, lv = hudLevels(), now = Date.now();
  return Object.entries(L).map(([id, give]) => ({ id: +id, have: lv[id], give })).filter(x => H[x.id] && H[x.id] - now > 30 * 60000 && x.have > x.give);
}
let tbDownLogT = 0;
// 20.13 (ревизия 17.10, шаг 7, raid/BF-4): два порога «кончается» были разбросаны числами по модулю. Значения прежние:
// FA_RENEW_MS — когда бафф за FA покупать заново (townBuffNeed, очередь шага fa); BUFF_LOW_MS — «кончается» для городского набора и строки
// «нет/кончается» в журнале (та же 10-минутная граница у raid.rbBuffShortage). Порог «перед РБ» по длительности боя — отдельное решение
const FA_RENEW_MS = 60000, BUFF_LOW_MS = 10 * 60000;
function townBuffNeed() {                          // что взять: { set, fa: [id…] } или null
  let set = env.cfg.townBuffSet || 'basic';
  // 8.0.3 (эпики): платный «Повний баф» (15 Coin of Luck) во время эпика — только в пределах лимита Coin of Luck на эпиков, иначе
  // бесплатный «Звичайний баф». Признак — состояние эпика (rt.epic), поэтому и в «Восстановить», и после смерти; для РБ выбор не меняется
  // 8.0.3 (ревью): в режиме эпиков — всегда (и между эпиками), и только когда сам заход разрешён (epics.epicBuffWhy)
  if ((set === 'warrior' || set === 'mage') && env.epicBuffCol?.() === false) set = 'basic';
  const H = hudBuffs();
  if (H) try { faDeathNote(H); } catch (e) {}       // 8.0.3: что смерть сделала с баффами за FA — в журнал
  // 8.0.3: городской набор выключен и своего списка FA нет — Noblesse при платных баффах (и РБ-сессия) всё равно докупается
  if (!H || set === 'off' && !(env.cfg.faBuffs || '').trim() && !faWanted().length) return null;
  const soon = id => !H[id] || H[id] - Date.now() < BUFF_LOW_MS;
  // v5.3: набор учим по факту — какие баффы появились/обновились после «Применить» (rt.tbSetIds). Раньше проверялись
  // 4 «ключевых» ID, и если слетал любой другой из ~10 баффов набора, бот этого не замечал (скрин 08.10 14:46)
  const ids = [...new Set([...(env.TB_KEYS[set] || env.TB_KEYS.basic), ...(env.rt.tbSetIds?.[set] || [])])];
  // и общий сторож: любой «длинный» бафф (осталось > 25 мин, не из списка Fast Aden), который мы видели у шапки, пропал
  // или кончается — значит, слетел городской набор (по нему и идём к бафферу, даже если набор ещё не выучен)
  const now = Date.now(), L = { ...(env.rt.hudLong || {}) }, faIds = (env.cfg.faBuffs || '').split(/[,\s]+/).map(Number);
  let ch = false;
  // 8.0.3 (лог 11.10 09:05: баффы за FA — на 3 ч, городской набор — на 24 ч): платные FA-баффы (куплены руками или РБ-сессией) не «городские»:
  // когда кончатся, к бесплатному бафферу за ними не ходим — новый «длинный» бафф только с запасом > 3,2 ч
  const sessIds = faFullIds();
  for (const [k, e] of Object.entries(H)) { const id = +k; if (e !== Infinity && (L[id] ? e - now > 25 * 60000 : e - now > 3.2 * 3600000) && !faIds.includes(id) && !sessIds.includes(id) && L[id] !== e) { L[id] = e; ch = true; } }
  for (const k of Object.keys(L)) if (L[k] < now - 3600000) { delete L[k]; ch = true; }
  if (ch) env.setRt({ hudLong: L });
  const lost = Object.keys(L).map(Number).filter(id => soon(id) && L[id] > now - 3600000);
  let needSet = set !== 'off' && (ids.some(soon) || lost.length > 0);
  const down = needSet ? tbDowngrade(set, H) : [];
  if (down.length) {                                 // 7.2.2: набор понизил бы баффы — не берём
    needSet = false;
    if (Date.now() - tbDownLogT > 1800000) { tbDownLogT = Date.now(); env.rec('B', 'бафф', `городской набор «${set}» не беру — он понизит ваши баффы: ${down.map(x => `${env.FA_KNOWN?.[x.id]?.[0] || env.rt.faCat?.[x.id]?.name || 'skill ' + x.id} Lv.${x.have}→${x.give}`).join(', ')}`); }
  }
  const fa = faWanted().filter(id => !H[id] || H[id] - Date.now() < FA_RENEW_MS || (id === 1323 && nobGone(H)) || faLow(id));
  return needSet || fa.length ? { set: needSet ? set : null, fa } : null;
}

const faIdsOf = v => String(v || '').split(/[,\s]+/).map(x => +x).filter(x => x > 0);
// 9.2.5 (игрок 12.10: «фулл баф на РБ и эпиков за ФА»): список «баффы РБ-сессии» = фулл бафф и для РБ-сессии, и для эпиков.
// «auto» (по умолчанию) — готовый набор под класс из fa-full.js (маг/воин); из пары баффов, что снимают друг друга (rt.faClash —
// замечено при покупке), остаётся тот, что раньше в списке
// 9.2.5: в шапке этот номер, но уровнем ниже, чем у баффера FA (городской Empower Lv.2 против FA Lv.3) — для фулл баффа его нет
function faLow(id, lv = hudLevels()) { const up = root.L2FaFull?.UP?.[id]; return !!(up && lv[id] && lv[id] < up); }
function faFullIds() {
  const F = root.L2FaFull, v = env.cfg.rbSessBuffs;
  if (!F) return faIdsOf(v);
  let role = null, S = null; try { role = env.heroRole?.() || null; } catch (e) {}
  try { S = env.heroStatsFor?.() || null; } catch (e) {}   // 10.0.7: порядок набора «auto» — по ценности для ДПС (buff-value.js)
  let ids = F.resolve(v, role, S);
  // 10.0.23 (лог15.10 07:10): смена оценки Magnus/Water не повод снимать действующий
  // бафф за FA. Автонабор пересматривает конфликтующую пару только после истечения.
  // 15.10: уже купленного Greater от ПП достаточно и танку; не меняем его на орочий за5FA.
  // Явный список игрока сохраняет приоритет; класс определяет новый выбор после истечения.
  if (F.isAuto(v)) {
    const H = hudBuffs() || {}, now = Date.now(), C = env.rt.faClash || {};
    const clashes = (a, b) => a === b || (F.GROUP.includes(a) && F.GROUP.includes(b)) || (C[a] || []).includes(b) || (C[b] || []).includes(a);
    const keep = [...new Set([...F.SETS[F.kind(role)].map(x => x[0]), ...F.GROUP])].filter(id => H[id] > now + 60000 && !faLow(id) && ids.some(k => clashes(id, k)));
    ids = [...keep, ...ids.filter(id => !keep.includes(id))];
  }
  return F.dropClash(ids, env.rt.faClash);
}
// 8.0.3 (лог 11.10 09:05–10:32): платные баффы за FA на герое — куплены у баффера Fast Aden (цена есть в его каталоге rt.faCat или в
// FA_KNOWN), действуют 3 ч; те же id у городского баффера (набор на 24 ч: 1059, 1085, 1303 …) не считаем → { id: время конца }
const FA_DUR = 3 * 3600000;
function faPaidOn(H, now = Date.now()) {
  const town = new Set([...Object.values(env.TB_KEYS || {}).flat(), ...Object.values(env.rt.tbSetIds || {}).flat(), ...Object.values(TB_LVL_DEF).flatMap(o => Object.keys(o))].map(Number));
  const out = {};
  for (const [k, e] of Object.entries(H || {})) { const id = +k; if (e !== Infinity && e > now && e - now <= FA_DUR * 1.1 && !town.has(id) && (env.rt.faCat?.[id] || env.FA_KNOWN?.[id])) out[id] = e; }
  return out;
}
const faCostOf = id => +(env.rt.faCat?.[id]?.cost || env.FA_KNOWN?.[id]?.[1] || 1);
const lastDeath = () => Math.max(0, ...(env.rt.deathLog || []), ...(env.rt.deaths || []));
const hhmm = t => new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
// 8.0.3: Noblesse Blessing уходит со смертью (сберегая остальные баффы). Страховка от старой шапки сразу после воскрешения: Noblesse,
// купленный до последней смерти (своя отметка nobBuyT и срок −3 ч: в шапке 09:39 он на 3 ч, как и баффы за 1 FA), считаем ушедшим
function nobGone(H, now = Date.now()) {
  if (!H?.[1323]) return true;
  const d = lastDeath();
  return d > 0 && now - d < FA_DUR && d > Math.max(env.rt.nobBuyT || 0, H[1323] - FA_DUR);
}
// 8.0.3 (лог 11.10 10:00:09 и 10:32:18): что смерть сделала с баффами за FA — в журнал (раньше ни строки: ушёл Noblesse, потом все 9
// баффов, макс. HP 6178 → 4151). Снимок платных баффов — при каждом их изменении; после смерти сравниваем со свежей шапкой (≥ 20 с, не у баффера)
function faDeathNote(H, now = Date.now()) {
  const d = lastDeath(), S = env.rt.faSnap, paid = faPaidOn(H, now);
  if (S?.ids && d > (S.t || 0) && d !== env.rt.faDeathSaid) {          // смерть после снимка — снимок не трогаем, пока не сравним
    if (now - d < 20000 || /town-buffer/.test(location.pathname)) return;
    const was = Object.entries(S.ids).map(([id, e]) => [+id, +e]).filter(([, e]) => e > now + 60000), had = was.filter(([id]) => id !== 1323);
    const lost = had.filter(([id]) => !H[id]), nob = (S.ids[1323] || 0) > d;
    const nm = id => env.rt.faCat?.[id]?.name || env.FA_KNOWN?.[id]?.[0] || 'skill ' + id;
    if (lost.length) env.rec('B', 'бафф', `смерть ${hhmm(d)} сняла ${lost.length} бафф(ов) за FA: ${lost.map(([id]) => nm(id)).join(', ')} (им оставалось до ≈${Math.round(Math.max(...lost.map(([, e]) => e - now)) / 60000)} мин)${nob ? '' : ' — Noblesse Blessing не было'}`);
    else if (had.length && nob) env.rec('B', 'бафф', `смерть ${hhmm(d)}: Noblesse Blessing сберёг ${had.length} бафф(ов) за FA и ушёл — докупаю его`);
    env.setRt({ faDeathSaid: d, faSnap: { t: now, sig: faSig(paid), ids: paid } });
    return;
  }
  const sig = faSig(paid);
  if (sig !== (S?.sig ?? '')) env.setRt({ faSnap: { t: now, sig, ids: paid } });
}
const faSig = P => Object.entries(P).map(([id, e]) => `${id}:${Math.round(e / 60000)}`).sort().join(',');
// 20.12 (ревизия 17.10): одно правило «нужен ли туру РБ фулл бафф за FA» — для покупки (faWanted) и для проверок тура в raid
// (нехватка FA, ожидание баффов, проверка перед перелётом). Тур по дейлику «Убей 1 РБ» — без FA (решение игрока 17.10 10:55: «бафф за FA только при туре на РБ»)
// 20.13 (ревизия 17.10, шаг 5, RB-3): баланс FA известен только по странице баффера. После записи с мобов могли упасть FA
// (rt.faDrop, loot.faNote) — тогда прежний «0» уже не доказывает нехватку: баланс неизвестен (null), его уточнит поход к бафферу.
function faDropSum(D = env.rt.faDrop) { return Object.values(D?.f || {}).reduce((a, x) => a + (+x || 0), 0); }
function faBalOf(now = Date.now()) {
  const B = env.rt.faBal;
  if (!B || !(now - B.t < 6 * 3600000)) return null;
  if (Number.isFinite(B.d) && faDropSum() > B.d) return null;
  return B.v;
}
function tourFaWanted() {
  return env.cfg.rbFaFull !== false && !env.rt.dailyRb;
}
function faWanted() {
  const now = Date.now(), gone = env.rt.faGone || {};
  if (env.rt.faSkipUntil && now < env.rt.faSkipUntil) return [];
  // 7.2.1: РБ-сессия — её баффы покупаются один раз в начале; потом (после смерти) — только Noblesse Blessing (остальное он сохранил).
  // За 5 мин до конца сессии её баффы не нужны (иначе бот докупил бы их на новые 3 ч)
  const S = env.rt.rbSess, sess = S?.on && !(S.until && now > S.until - 5 * 60000) ? faFullIds() : [];
  const sessWant = S?.bought ? sess.filter(id => id === 1323 && env.cfg.rbSessNob !== false) : sess;
  // 9.2.5: эпик — тот же фулл бафф за FA (вместо платного городского набора за 15 Coin of Luck), когда заход на эпика уже разрешён
  // (epics.epicFaOk: по силам, жив по свежему ответу, < 2 смертей за час, дорога выбрана). Берётся только то, чего нет или что кончается
  // 20.13 (ревизия 17.10, шаг 5, EP-2): решение «перед эпиком покупаем набор» фиксируется в rt.tbuff.epicFa при старте похода —
  // шаг FA у баффера не пересчитывает свежесть ответа сервера (3 мин) и не обрывает набор на середине после задержки/перезагрузки
  const epicPrep = env.rt.tbuff?.epicFa && now - (env.rt.tbuff.t || 0) < 15 * 60000 && !!env.rt.epic?.k && env.rt.epic.step !== 'pick';
  const epicWant = env.cfg.epicFaFull !== false && (epicPrep || env.epicFaOk?.()) ? faFullIds() : [];
  // 10.0.1 (лог 12.10 18:10–18:12, игрок: «не срабатывает автобафф под РБ перед рейдом»): фулл бафф брался только по кнопке
  // «🔥 Начать РБ-сессию» — обычный «Тур РБ» летел к трём РБ без единого баффа за FA. Теперь и тур берёт тот же набор (cfg.rbFaFull),
  // но только перед вылетом к выбранному РБ (townBuffStart «перед РБ …», шаг тура go/fight, rbGo), а не пока тур фармит мобов
  const RH = env.rt.rbHunt || {};
  const tourPrep = env.rt.tbuff?.rbTour && now - (env.rt.tbuff.t || 0) < 15 * 60000;
  // 20.12 (ревизия 17.10): тур, запущенный дейликом «Убей 1 РБ», сам набор за FA не покупает (решение игрока 17.10)
  const tourWant = tourFaWanted() && env.cfg.rbHuntMode && !S?.on && (now - rbAskT < 60000 || tourPrep || RH.step === 'go' || RH.step === 'fight' || !!env.rt.rbGo) ? faFullIds() : [];
  // 8.0 (аудит РБ B3: 23:18 баффы FA висели, а Noblesse ушёл на прошлой смерти — следующая смерть сняла все 8 баффов): на РБ
  // с платными баффами (FA Greater, 5 FA) Noblesse Blessing докупается и без РБ-сессии — он 1 FA, а бережёт баффы на сотни FA
  // 8.0.3: и в бою с эпиком (начатый эпик: rt.epic.k, шаг не «выбор») — смерть на эпике не должна снимать платные баффы FA
  const bossOn = !!(env.cfg.rbMode || env.cfg.rbHuntMode || (env.cfg.epicMode && env.rt.epic?.k && env.rt.epic.step !== 'pick'));
  let H = {}; if (bossOn) try { H = hudBuffs() || {}; } catch (e) {}
  // 8.0.3 (лог 11.10: игрок купил 9 баффов по 1 FA и Noblesse за 5 FA; после смерти в 10:00:09 Noblesse ушёл и за 32 мин и 7 РБ не
  // докупался — условие ждало бафф ценой ≥ 5 FA, а их нет; смерть в 10:32:18 сняла все 9, ≈1,5 ч оставалось): платные баффы с запасом
  // > 10 мин в сумме стоят не меньше Noblesse — он нужен
  const atRisk = Object.entries(faPaidOn(H, now)).filter(([id, e]) => +id !== 1323 && e - now > 10 * 60000).reduce((a, [id]) => a + faCostOf(id), 0);
  const paidUp = atRisk > 0 && atRisk >= (env.faCost ? env.faCost(1323) : 5);
  const nob = paidUp && bossOn && env.cfg.rbSessNob !== false ? [1323] : [];
  let ids = [...new Set([...faIdsOf(env.cfg.faBuffs), ...sessWant, ...epicWant, ...tourWant, ...nob])].filter(id => id > 0 && now - (gone[id] || 0) > 6 * 3600000);
  // Общий явный список имеет приоритет над автонабором; проверка и покупка требуют одну совместимую комбинацию.
  if (root.L2FaFull) ids = root.L2FaFull.dropClash(ids, env.rt.faClash);
  // 9.0 (квест Noblesse): статус Noblesse — скилл 1323 свой (на всех классах), за FA его не покупаем
  if (env.rt.story?.nobleOwn) ids = ids.filter(id => id !== 1323);
  const bal = faBalOf(now);
  if (bal != null && ids.length && bal < Math.min(...ids.map(env.faCost))) return [];   // FA точно не хватит ни на один — не ходим
  return ids;
}

function faCatalogNote() {                        // страница /fast-aden-buffer.html: что продаётся, почём, баланс
  if (!/\/fast-aden-buffer\.html/.test(location.pathname)) return;
  const bal = +((env.$q('#fast-aden-balance')?.textContent || '').replace(/\D/g, '') || NaN);
  const cat = { ...(env.rt.faCat || {}) };
  let n = 0;
  for (const b of document.querySelectorAll('.l2-fa-buy[data-skill-id]')) {
    const id = +b.dataset.skillId, row = b.closest('li, tr, [class*="row"], [class*="item"], [class*="card"]') || b.parentElement;
    const nm = (row?.querySelector('[class*="name"], [class*="title"], b, strong')?.textContent || row?.textContent || '').replace(/\s+/g, ' ').replace(/Купити|Купить|Buy|\d+\s*FA/gi, '').trim().slice(0, 40);
    cat[id] = { name: nm || env.FA_KNOWN[id]?.[0] || 'skill ' + id, cost: +(b.dataset.cost || 1), t: Date.now() }; n++;
  }
  const patch = {};
  if (n) patch.faCat = cat;
  if (!isNaN(bal)) { patch.faBal = { v: bal, t: Date.now(), d: faDropSum() }; if (env.rt.faSkipUntil && env.rt.faBal && bal > env.rt.faBal.v) patch.faSkipUntil = 0; }   // FA пополнили — снова можно
  if (Object.keys(patch).length) env.setRt(patch);
  return n;
}

// Только свежий полный снимок своего персонажа пригоден для перепланирования оплат.
async function freshBuffPlan(){
  const active=contextGuard(),char=env.rt.char;
  try{const r=await env.gameGet('/character'),d=r.ok?await r.json():null,ch=d?.character||d;
    if(!active() || ch?.name!==char || !Array.isArray(ch.activeBuffs))return null;
    const H={},levels={};
    // 20.13 (ревизия 17.10, шаг 5, BF-2): эффект без срока (тоггл/постоянный; поля срока нет или null) — бессрочный, как в шапке
    // (hudBuffs: Infinity), а не повод забраковать весь снимок. Явно испорченный срок по-прежнему делает снимок непригодным.
    for(const b of ch.activeBuffs){const id=+b.skillId,raw=b.expiresAtMs??b.expiresAt,exp=raw==null?Infinity:raw;if(!(id>0)||!(Number.isFinite(exp)||exp===Infinity))return null;H[id]=exp;if(+b.level>0)levels[id]=+b.level;}
    return {H,levels};
  }catch(_){return null;}
}
function planWith(snapshot){try{planningSnapshot=snapshot;return townBuffNeed();}finally{planningSnapshot=null;}}

const TB_INTERRUPT_MS = 3 * 60000;
let rbAskT = 0;                                     // 10.0.1: когда тур РБ последний раз спрашивал «баффы перед РБ …» (faWanted → tourWant)
async function townBuffStart(why, urgent) {         // urgent — перед РБ: не ждём 10 мин с прошлого похода (только 1 мин)
  const active=contextGuard();if(!active())return false;
  if (urgent && /^перед РБ/.test(why)) rbAskT = Date.now();
  // Отмена маршрута не равна неудачной покупке. Перед новым планом читаем сервер:
  // HUD после ответа/перезагрузки может ещё не показывать уже оплаченные эффекты.
  let interrupted=env.rt.tbInterrupted;
  let snapshot=null;
  // 20.13 (ревизия 17.10, шаг 5, BF-2): режим «после отмены» ограничен 3 мин. Сервер так и не дал пригодного снимка или шапка
  // не догнала эффекты — снимаем отметку и решаем по обычным правилам (повторную покупку по-прежнему стережёт payments)
  if(interrupted && !(Date.now()-(+interrupted.t||0)<TB_INTERRUPT_MS) && !env.payments?.blocked()){
    await env.setRt({tbInterrupted:null});if(!active())return false;
    env.rec?.('B','бафф','после отмены маршрута сверка эффектов не завершилась за 3 мин — решаю по обычным правилам');
    interrupted=null;
  }
  if(interrupted){
    if(env.payments?.blocked())return true;
    snapshot=await freshBuffPlan();
    if(!active())return false;
    if(env.payments?.blocked())return true;
    if(!snapshot){env.setStatus?.('Бафф: после отмены сверяю эффекты с сервером; повторно не покупаю');await env.sleep(3000);return true;}
  }
  const n=planWith(snapshot);
  if (!n) {
    if(interrupted && townBuffNeed()){
      env.setStatus?.('Бафф: сервер подтвердил эффекты, жду обновления шапки; повторно не покупаю');
      await env.sleep(3000);return true;
    }
    if(interrupted)await env.setRt({tbInterrupted:null,tbWaitUntil:0});
    if(env.rt.tbFail)env.setRt({tbFail:0});return false;
  }
  // v5.5: после баффера баффов в шапке так и нет (скрин 08.10 15:29: остался один, бот «не видит») — раньше «наложен» по
  // сообщению баффера = 10 мин тишины. Теперь: прошло ≥ 40 с после баффера, а нужное всё ещё не висит — поход не удался,
  // повтор через 1 мин; 3 таких подряд — пауза 10 мин и запись в журнал (чтобы не бегать к бафферу по кругу)
  const since = Date.now() - (env.rt.tbT || 0);
  // 10.0.7: баффы снял моб (cancelNote после последнего похода) — это не «поход не удался» и не повод ждать 10 мин: идём сразу
  const cancelled = (env.rt.tbCancelT || 0) > (env.rt.tbT || 0);
  let wait = cancelled || interrupted ? 0 : env.rt.tbOk === false || urgent ? 60000 : 10 * 60000;
  if (cancelled) why += ' — сняты мобом';
  // 20.14.1 (лог 18.10 18:32–18:33): сторож взял городской «basic», через 30 с тур РБ попросил полный набор FA — бот записал
  // «после баффера баффы так и не появились (1/3)» и ждал баффера 24 с, хотя прошлый поход удался: просто теперь нужны ДРУГИЕ баффы.
  // Прошлый поход помнит, за чем шёл (rt.tbWant); всё это висит в шапке — поход удался, новые баффы берём сразу, без счёта неудач.
  const wantOf = p => [...(p.set ? [...(env.TB_KEYS[p.set] || []), ...(env.rt.tbSetIds?.[p.set] || [])] : []), ...(p.fa || [])].map(Number);
  const Hp = hudBuffs(), prevW = Array.isArray(env.rt.tbWant) ? env.rt.tbWant : null;
  if (!interrupted && !cancelled && Hp && prevW?.length && env.rt.tbT && since < 15 * 60000 && prevW.every(id => Hp[id])) {
    const prevS = new Set(prevW), fresh = wantOf(n).filter(id => !prevS.has(id) && !Hp[id]);
    if (env.rt.tbChk !== env.rt.tbT) { await env.setRt({ tbChk: env.rt.tbT, tbOk: true, tbFail: 0 }); if(!active())return false; }
    if (fresh.length) wait = 0;
  }
  if (!interrupted && !cancelled && env.rt.tbT && since > 40000 && since < 15 * 60000 && env.rt.tbChk !== env.rt.tbT) {
    const fails = (env.rt.tbFail || 0) + 1;
    await env.setRt({ tbChk: env.rt.tbT, tbOk: false, tbFail: fails });
    if(!active())return false;
    env.rec('B', 'бафф', `после баффера баффы так и не появились в шапке (${fails}/3)${fails >= 3 ? ' — пауза 10 мин, проверьте набор баффа в меню' : ' — повторю через 1 мин'}`);
    wait = fails >= 3 ? 10 * 60000 : 60000;
    if (fails >= 3) await env.setRt({ tbFail: 0, tbOk: true, tbPauseUntil: Date.now() + 10 * 60000 });   // v5.6: пауза и для «срочных» (перед РБ) — раньше они шли каждую минуту
  }
  if(!active())return false;
  if ((env.rt.tbPauseUntil || 0) > Date.now()) return false;
  if (since < wait) { if (env.rt.tbWaitSaid !== env.rt.tbT) { await env.setRt({ tbWaitSaid: env.rt.tbT, tbWaitUntil:(env.rt.tbT||0)+wait }); env.rec('B', 'бафф', `баффы слетели (${why}), к бафферу через ${Math.ceil((wait - since) / 1000)} с`); } return false; }
  const H = hudBuffs() || {}, miss = [...(n.set ? [...new Set([...(env.TB_KEYS[n.set] || []), ...(env.rt.tbSetIds?.[n.set] || [])])] : []), ...n.fa].filter(id => !H[id] || H[id] - Date.now() < BUFF_LOW_MS);
  if (miss.length) why += ` (нет/кончается: ${miss.slice(0, 6).map(id => env.IL[id]?.n || env.rt.faCat?.[id]?.name || id).join(', ')})`;
  await env.setRt({ tbuff: { ...n, t: Date.now(), step: n.set ? 'town' : 'fa', rbTour: !!(urgent && /^перед РБ/.test(why) && env.cfg.rbHuntMode), epicFa: !!(urgent && /^перед эпиком/.test(why) && env.cfg.epicFaFull !== false && env.epicFaOk?.()) }, tbT: Date.now(), tbWant: wantOf(n), tbInterrupted:null, tbWaitUntil:0 });
  if(!active())return false;
  env.rec('B', 'бафф', `${why}: ${n.set ? 'городской «' + n.set + '»' : ''}${n.set && n.fa.length ? ' + ' : ''}${n.fa.length ? 'FA ' + n.fa.join(', ') : ''}`);
  location.href = n.set ? '/town-buffer.html' : '/fast-aden-buffer.html'; await env.sleep(4000);
  return true;
}

// 9.2.5: игра не пишет, какие баффы FA не стакаются (Greater: Magnus' Chant / Prophecy of Water …). Учимся по факту: свежий бафф
// появился на панели (≈3 ч), а другой бафф, которому оставалось > 2 мин, с панели пропал — покупка его сняла → rt.faClash { новый: [снятые] }.
// Панель не обновилась — ничего не решаем (нет ложных пар). Тот же номер (FA Lv.3 поверх городского Lv.2) — не пара
async function faClashNote(id, H0, now = Date.now()) {
  const active=contextGuard();if(!active())return [];
  const fresh = () => { const H = hudBuffs(); return H && H[id] > now + 2 * 3600000 ? H : null; };
  if (!(await env.waitX(fresh, 3000, 200))) return [];
  if(!active())return [];
  const H1 = fresh() || {};
  const lost = Object.entries(H0).map(([k, e]) => [+k, e]).filter(([k, e]) => k !== id && e !== Infinity && e - now > 2 * 60000 && !(k in H1)).map(([k]) => k);
  if (lost.length) {
    const C = { ...(env.rt.faClash || {}) };
    C[id] = [...new Set([...(C[id] || []), ...lost])];
    await env.setRt({ faClash: C });
    env.rec('B', 'бафф', `покупка ${id} сняла с панели ${lost.join(', ')} — эти баффы вместе не держатся, впредь из пары беру того, кто раньше в списке`);
  }
  return lost;
}

// 16.10, журнал22:29: срок/уровень эффекта не заменяет квитанцию конкретной покупки.
function paymentNote(path,d) {
  const P=env.payments?.pending(),E=P?.evidence||{},q=d?.req,ch=d?.res?.character;
  if(P?.kind!=='fa-buff'||P.char!==env.rt.char||env.tabOwner===false||path!=='/character/town/fast-aden-buffer/apply'||d.method!=='POST'||d.paymentId!==P.id||d.error||d.status<200||d.status>=300||!Number.isInteger(d.status)||d.res?.error||d.res?.ok===false)return;
  if(P.quote?.currency!=='FA'||!E.set||q?.set!==E.set||E.ids?.length!==1||q.skillId!==E.ids[0]||q.expectedCostFastAden!==P.quote.amount||!Number.isSafeInteger(q.expectedRevision)||q.expectedRevision<0||ch?.name!==P.char||!Number.isSafeInteger(ch.revision)||ch.revision<=q.expectedRevision)return;
  if(d.res.skillId!==q.skillId||d.res.set!==q.set||d.res.costFastAden!==P.quote.amount||!Number.isSafeInteger(E.balance)||d.res.fastAdenBalance!==E.balance-P.quote.amount)return;
  const receipt={paymentId:P.id,char:P.char,skillId:q.skillId,set:q.set,spent:q.expectedCostFastAden,requestRevision:q.expectedRevision,revision:ch.revision};
  try{root.sessionStorage?.setItem('l2bot.faBuffReceipt',JSON.stringify(receipt));}catch(_){}
  env.setRt({faBuffReceipt:receipt});
}
let journalCheck=null;
async function paymentReconcile() {
  const P=env.payments?.pending();if(!P || !['fa-buff','town-buff'].includes(P.kind))return !P;
  const lease=env.leaseEpoch, char=env.rt.char;
  const valid=()=>env.tabOwner!==false && env.leaseEpoch===lease && env.rt.char===char && char===P.char && env.payments.pending()?.id===P.id;
  if(!valid())return false;
  const E=P.evidence || {},ids=E.ids||[];let H=hudBuffs(),levels=null,proof=null,receipt=env.rt.faBuffReceipt;
  try{const r=JSON.parse(root.sessionStorage?.getItem('l2bot.faBuffReceipt')||'null');if(r?.paymentId===P.id)receipt=r;}catch(_){}
  if(P.kind==='fa-buff'&&receipt?.paymentId===P.id&&receipt.char===P.char&&ids.length===1&&receipt.skillId===ids[0]&&receipt.set===E.set&&receipt.spent===P.quote.amount&&Number.isSafeInteger(receipt.requestRevision)&&Number.isSafeInteger(receipt.revision)&&receipt.revision>receipt.requestRevision)proof={kind:'server-receipt',revision:receipt.revision,spent:receipt.spent};
  if(!proof&&env.gameGet)try {const r=await env.gameGet('/character'),d=r.ok?await r.json():null,ch=d?.character||d;
    if(ch?.name===P.char && Array.isArray(ch.activeBuffs)){H=Object.fromEntries(ch.activeBuffs.map(x=>[+x.skillId,Number.isFinite(x.expiresAtMs)?x.expiresAtMs:x.expiresAt]).filter(([,exp])=>Number.isFinite(exp)));levels=Object.fromEntries(ch.activeBuffs.filter(x=>+x.level>0).map(x=>[+x.skillId,+x.level]));}
  }catch(_){}
  if(!valid())return false;
  const fresh=H && ids.length && ids.every(id=>Number.isFinite(H[id]) && H[id]>Date.now()+60000)
    && ids.some(id=>!E.before?.[id] || H[id]>E.before[id]+60000 || (Number.isFinite(E.beforeLevels?.[id]) && E.expectedLevels?.[id]>E.beforeLevels[id] && levels?.[id]>=E.expectedLevels[id]));
  if(!proof&&fresh)proof={kind:'effects-satisfied',ids,expires:Math.min(...ids.map(id=>H[id]))};
  // Старый успешный платёж восстанавливаем даже после истечения баффа, но только
  // по однозначному запросу и новому сообщению о списании в том же SID журнала.
  if(!proof&&P.kind==='fa-buff'&&env.faBuffEvidence&&(!journalCheck||journalCheck.id!==P.id||Date.now()-journalCheck.t>=30000)){
    journalCheck={id:P.id,t:Date.now()};const r=await env.faBuffEvidence(P);if(!valid())return false;
    if(r?.kind==='journal-receipt'&&r.spent===P.quote.amount&&r.balance===E.balance-P.quote.amount&&Number.isSafeInteger(r.requestRevision)&&typeof r.eventKey==='string')proof=r;
  }
  if(!proof){env.setStatus?.('Бафф: исход оплаты неизвестен; повтор запрещён, сверяю эффекты');return false;}
  const current=env.rt.tbuff, S=current && Number.isFinite(E.jobT) && current.t===E.jobT && (+env.rt.manualKickAt||0)===P.kick ? current : null, patch={};
  if(P.kind==='fa-buff') {
    if(S)patch.tbuff={...S,fa:(S.fa||[]).filter(id=>!ids.includes(id))};
    if(ids.includes(1323))patch.nobBuyT=P.at;
  }else if(S?.step==='town' && S.set===E.set){patch.tbuff=S.fa?.length?{...S,step:'fa'}:S.then?{...S.then,t:Date.now()}:null;patch.tbOk=true;}
  if(Object.keys(patch).length && ((await env.setRt(patch))?.ok!==true || !valid()))return false;
  return env.payments.confirm(P,proof);
}
async function townBuffStep() {
  if(env.payments?.blocked()){await paymentReconcile();return;}
  const active=contextGuard();if(!active())return;
  const st = env.rt.tbuff;
  if(!st)return;
  const done = async msg => {
    if(!active())return;
    env.rec('B', 'бафф', msg);
    if (st.then) { await env.setRt({ tbuff: { ...st.then, t: Date.now() } }); return; }   // бафф был перед «Восстановить» — теперь восстановление
    await env.setRt({ tbuff: null });if(!active())return;location.href = env.autonomyMode() === 'fish' ? '/fishing.html' : '/map.html';await env.sleep(4000);
  };
  if (st.step === 'restore') {
    if (!/\/town-buffer\.html/.test(location.pathname)) { location.href = '/town-buffer.html'; await env.sleep(4000); return; }
    // v4.34: сначала бафф (после смерти он слетел, а с ним и часть макс. HP), потом «Восстановить» — до нового максимума.
    // Раньше было наоборот: восстановили до 5164, бафф поднял максимум до 6326 — и снова 19 %
    const n = !st.buffDone && townBuffNeed();
    if (n && (n.set || n.fa.length)) { await env.setRt({ tbuff: { ...n, t: Date.now(), step: n.set ? 'town' : 'fa', reviveTried: st.reviveTried, then: { ...st, buffDone: true } }, tbT: Date.now() }); return; }
    env.setStatus('Восстановление: баффер «Восстановить HP|MP|CP»');
    const rb = await env.waitX(() => env.$q('#town-buffer-restore-btn'), 10000, 200);
    if(!active())return;
    const hpPct = () => env.meHp()?.pct ?? 0, msg = () => (env.$q('#town-buffer-msg')?.textContent || '').trim();
    let ok = false;
    if (rb) {
      const hp0 = hpPct() | 0;
      await env.sleep(env.rnd(1300, 1800));                 // кнопка появляется раньше, чем страница готова: ранний клик → «Не удалось восстановить»
      if(!active())return;
      // v4.36: сразу после боя/смерти/отхода игра восстановление не даёт («Не удалось…» или молчит) — по журналам
      // все неудачи были через 1–6 с после боя. Повторяем с растущей паузой: ≈1 мин на всё
      const waits = [0, 5000, 8000, 12000, 15000];
      for (let i = 1; i <= waits.length && active() && !ok; i++) {
        const w = waits[i - 1];
        for (let t0 = Date.now(); w && active() && Date.now() - t0 < w;) { env.setRt({ status: `Восстановление: игра пока не даёт (после боя) — попытка ${i}/${waits.length} через ${Math.ceil((w - (Date.now() - t0)) / 1000)} с` }); env.draw(); await env.sleep(1000); }
        if (!active()) return;
        const m = env.$q('#town-buffer-msg'); if (m) m.textContent = '';
        env.fire(rb);
        await env.waitX(() => hpPct() >= 99 || /не удалось|не вдалося|failed|восстановлен[оыа]|відновлен[оі]|restored/i.test(msg()), 7000, 200);
        if(!active())return;
        if (hpPct() < 90) await env.waitX(() => hpPct() >= 99, 3000, 250);
        if(!active())return;
        ok = hpPct() >= 90;
        if (!ok) env.rec('B', 'восстановление', `попытка ${i}/${waits.length}: ${msg() || 'игра не ответила'} (HP ${hpPct() | 0}%)`);
        if (!ok && env.DEAD_RE.test(msg()) && !st.reviveTried) {   // «Ти знепритомнів. Сначала натисни «В город»» — сначала воскрешение, потом сюда же
          env.rec('B', 'восстановление', 'персонаж «без сознания» — сначала город и магическая статуя, потом снова «Восстановить»');
          await env.setRt({ revive: { t: Date.now(), url: env.rt.lastBattle }, tbuff: { ...st, t: Date.now() + 60000 } });
          return;
        }
      }
      env.rec('B', 'восстановление', ok ? `HP ${hp0}% → ${hpPct() | 0}%` : `не удалось за ${waits.length} попыток (HP ${hpPct() | 0}%) — лечусь на мобах, к бафферу снова через 3 мин`);
    } else env.rec('B', 'восстановление', 'нет кнопки «Восстановить» — баффер не открылся');
    await env.setRt({ tbuff: null, restoreRes: { t: Date.now(), ok } });
    if(!active())return;
    location.href = st.back || '/map.html'; await env.sleep(4000); return;
  }
  if (st.step === 'town') {
    if (!/\/town-buffer\.html/.test(location.pathname)) { location.href = '/town-buffer.html'; await env.sleep(4000); return; }
    if (st.set !== 'basic' && !['warrior', 'mage'].includes(env.cfg.townBuffSet)) return done('платный бафф не выбран в меню — пропускаю');
    // 8.0.3 (эпики): платный набор в режиме эпиков — в пределах лимита Coin of Luck; не разрешён — бесплатный «basic».
    // 8.0.3 (ревью): сначала только проверка (epicBuffCol, без резерва); резерв — прямо перед нажатием, после кнопки и проверки «не
    // понизит ли баффы» (раньше резерв до них съедал суточный лимит впустую — «баффер не открылся» каждую минуту → телепорт запрещён)
    let set = st.set;
    if (set !== 'basic' && env.epicBuffCol?.() === false) set = 'basic';
    env.setStatus(`Бафф: городской баффер (${set})`);
    const btn = await env.waitX(() => env.$q(`#town-buffer-sets .l2-town-buffer-set-apply[data-set-id="${set}"]`), 10000, 200);
    if(!active())return;
    if (!btn) return done(`баффер не открылся (${env.shown(env.$q('#town-buffer-load-err')) ? env.$q('#town-buffer-load-err').textContent.trim().slice(0, 80) : 'нет кнопки'})`);
    tbLevelsNote();
    const dn = tbDowngrade(set, hudBuffs() || {});
    if (dn.length) return done(`городской набор «${set}» не наложен — понизил бы ${dn.length} бафф(ов) (Lv.${dn[0].have}→${dn[0].give})`);   // 7.2.2
    let payAt = 0, paidSet=null;
    const releaseUnsent=async()=>{if(payAt&&active.same())await env.epicBuffRelease?.(payAt,'покупка не отправлена');};
    if(set!=='basic' && env.payments)try {
      const r=await env.gameGet('/character/town/buffer/catalog'),d=r.ok?await r.json():null;
      if(!active())return;
      paidSet=d?.sets?.find(x=>x.id===set);
      if(!paidSet || +paidSet.feeAdena!==0 || +paidSet.feeCoinOfLuck!==15 || !paidSet.skills?.length)return done('цена платного набора не подтверждена — не оплачиваю');
    }catch(_){return done('каталог платного набора не получен — не оплачиваю');}
    if (set !== 'basic') { const p = await env.epicBuffPay?.(set); if (p === false) return done(`«${set}» за Coin of Luck не разрешён — в следующий раз бесплатный «basic»`); if (typeof p === 'number') payAt = p; }
    if(!active()){await releaseUnsent();return;}
    const H0 = hudBuffs() || {};
    await env.pause();
    if(!active()){await releaseUnsent();return;}
    const P=paidSet?await env.payments.prepare({key:`town:${set}`,kind:'town-buff',quote:{amount:+paidSet.feeCoinOfLuck,currency:'Coin of Luck'},
      evidence:{jobT:st.t,set,ids:[...new Set(env.TB_KEYS[set]||[])],before:H0}}):null;
    if(paidSet && (!P || !active() || !env.payments.sent(P))){if(P)await env.payments.cancel(P);await releaseUnsent();return;}
    const clicked=env.fire(btn);
    if(clicked===false){if(P)await env.payments.cancel(P,{notSent:true});await releaseUnsent();return done(`городской «${set}»: кнопка не нажалась`);}
    const res = () => (env.$q('#town-buffer-result-title')?.textContent || '') + ' ' + (env.$q('#town-buffer-result-text')?.textContent || '');
    const ok = await env.waitX(() => /накладено|наложен|applied/i.test(res()), 6000, 200);
    if(!active()){if(P)await paymentReconcile();return;}
    if (ok) {                                       // v5.3: запоминаем, какие баффы даёт набор (новые и обновлённые в шапке)
      await env.waitX(() => Object.keys(hudBuffs() || {}).some(id => !(id in H0) || (hudBuffs()[id] || 0) > (H0[id] || 0) + 60000), 3000, 200);
      if(!active()){if(P)await paymentReconcile();return;}
      const H1 = hudBuffs() || {}, got = Object.keys(H1).map(Number).filter(id => H1[id] !== Infinity && (!(id in H0) || H1[id] > (H0[id] || 0) + 60000) && !faWanted().includes(id));
      await env.setRt({ hudLong: {} });
      if(!active())return;
      if (got.length) await env.setRt({ tbSetIds: { ...(env.rt.tbSetIds || {}), [set]: [...new Set([...(env.rt.tbSetIds?.[set] || []), ...got])] } });
      if(!active())return;
    }
    const fail = !ok && res().replace(/\s+/g, ' ').trim().slice(0, 100);
    if(P && !await paymentReconcile())return;
    if(!active())return;
    if (!ok && (env.DEAD_RE.test(res()) || env.DEAD_RE.test(env.$q('#town-buffer-msg')?.textContent || '') || !res().trim())) {
      // «без подтверждения» у баффера = скорее всего «без сознания» (лог 01:33): сначала воскрешение
      if (!st.reviveTried) { env.rec('B', 'бафф', 'баффер не отвечает — похоже, персонаж «без сознания»: сначала «Вернуться в город»'); await env.setRt({ tbuff: null, revive: { t: Date.now(), url: env.rt.lastBattle } }); return; }
    }
    // явный отказ баффера (текст есть, не «наложено», не «без сознания») — 15 CoL не списаны: резерв снимаем; без ответа — оставляем
    if (payAt && !ok && fail && !env.DEAD_RE.test(res())) await env.epicBuffRelease?.(payAt, fail);
    if(!active())return;
    const cl = env.$q('#town-buffer-result-overlay [class*="close"], #town-buffer-result-overlay');   // закрыть окно результата
    if (ok && cl) { try { env.fire(cl); } catch (e) {} }
    env.rec('B', 'бафф', ok ? `городской «${set}» — наложен` : `городской «${set}»: ${fail || 'без подтверждения'}`);
    await env.setRt({ tbOk: !!ok });
    if(!active())return;
    if (st.fa?.length) { await env.setRt({ tbuff: { ...st, step: 'fa' } });if(!active())return;location.href = '/fast-aden-buffer.html';await env.sleep(4000);return; }
    return done('готово — возвращаюсь');
  }
  if (st.step === 'fa') {
    if (!/\/fast-aden-buffer\.html/.test(location.pathname)) { location.href = '/fast-aden-buffer.html'; await env.sleep(4000); return; }
    env.setStatus('Бафф: Fast Aden');
    await env.waitX(() => env.$q('.l2-fa-buy[data-skill-id]'), 10000, 200);
    if(!active())return;
    await env.waitX(() => /\d/.test(env.$q('#fast-aden-balance')?.textContent || ''), 4000, 200);   // баланс дорисовывается позже кнопок
    if(!active())return;
    faCatalogNote();
    const balNow = () => +((env.$q('#fast-aden-balance')?.textContent || '0').replace(/\D/g, '') || 0);
    const nm = id => env.rt.faCat?.[id]?.name || env.FA_KNOWN[id]?.[0] || id;
    const got = [], gone = { ...(env.rt.faGone || {}) };
    let bought = 0, short = 0, nobT = 0;
    // 10.0.14: сохранённая очередь переживает reload и ручную покупку; перед каждым списанием проверяем актуальные HUD и выбор.
    const needed = id => { const H = hudBuffs(); return H && faWanted().includes(id) && (!H[id] || H[id] - Date.now() < FA_RENEW_MS || id === 1323 && nobGone(H) || faLow(id)); };
    for (const id of st.fa || []) {
      if (!active()) return;
      if (!needed(id)) continue;
      const bal = balNow(); let b = env.$q(`.l2-fa-buy[data-skill-id="${id}"]`);
      if (!b) { got.push(`${nm(id)}: нет у баффера — пропускаю 6 ч`); gone[id] = Date.now(); continue; }
      const cost = +(b.dataset.cost || 1);
      if (bal < cost) { got.push(`${nm(id)}: не хватает FA (${bal}/${cost})`); short++; continue; }   // дальше — те, что по карману
      // 20.13 (ревизия 17.10, шаг 5, BF-1): FA хватает, а кнопка недоступна (уровень, ограничение сервера) — как «нет у баффера»:
      // 6 ч не просим (faWanted/townBuffNeed его не хотят), иначе тур ждал баффера по кругу
      // ревью: кнопка может быть погашена на время ответа на прошлую покупку/перерисовки — сначала коротко ждём, потом метим
      if (b.disabled) { await env.waitX(() => !env.$q(`.l2-fa-buy[data-skill-id="${id}"]`)?.disabled, 2000, 200); if (!active()) return; b = env.$q(`.l2-fa-buy[data-skill-id="${id}"]`) || b; }
      if (b.disabled) { got.push(`${nm(id)}: кнопка недоступна — пропускаю 6 ч`); gone[id] = Date.now(); continue; }
      const H0 = hudBuffs() || {};
      await env.pause();
      if (!active())return;
      if (!needed(id)) continue;
      const P=env.payments?await env.payments.prepare({key:`fa:${id}`,kind:'fa-buff',quote:{amount:cost,currency:'FA'},evidence:{jobT:st.t,set:b.dataset.setId||'',ids:[id],before:H0,beforeLevels:hudLevels(),expectedLevels:{[id]:root.L2FaFull?.UP?.[id]||0},balance:bal}}):null;
      if(env.payments && (!P || !active() || !needed(id) || +(b.dataset.cost||1)!==cost || balNow()!==bal || !env.payments.sent(P))){if(P)await env.payments.cancel(P);return;}
      const clicked=env.fire(b);if(P && clicked===false){await env.payments.cancel(P,{notSent:true});return;}
      const ok = await env.waitX(() => balNow() < bal, 5000, 200);
      if(P && !await paymentReconcile())return;
      if(!active())return;
      if (ok) bought++;
      if (ok) { const lost = await faClashNote(id, H0); if (lost.length) got.push(`${nm(id)} снял ${lost.map(nm).join(', ')} — вместе не держатся, пару больше не беру`); }
      if(!active())return;
      if (ok && id === 1323) nobT = Date.now();   // 8.0.3: свой Noblesse — куплен после последней смерти (nobGone)
      if (ok) await env.setRt({ tbuff: { ...env.rt.tbuff, fa: (env.rt.tbuff?.fa || []).filter(x => x !== id) }, ...(nobT ? { nobBuyT: nobT } : {}) });
      if(!active())return;
      got.push(`${nm(id)}: ${ok ? '−' + cost + ' FA' : 'без подтверждения'}`);
      await env.sleep(env.rnd(250, 450));
    }
    if(!active())return;
    const left = balNow();
    const patch = { faGone: gone, faBal: { v: left, t: Date.now(), d: faDropSum() }, ...(nobT ? { nobBuyT: nobT } : {}) };
    if (short && !bought) { patch.faSkipUntil = Date.now() + 60 * 60000; got.push('FA не хватает — к бафферу FA не хожу 60 мин (или пока баланс не вырастет)'); }
    await env.setRt(patch);
    if(!active())return;
    // Набор мог измениться/дойти до порога обновления во время покупки. Новые ID
    // добавляем в этот же визит один раз; прежние/неподтверждённые не повторяем.
    const snapshot=await freshBuffPlan();if(!active() || env.payments?.blocked())return;
    const considered=new Set([...(st.faConsidered||[]),...(st.fa||[])]);
    const more=snapshot && considered.size<64 ? [...new Set(planWith(snapshot)?.fa||[])].filter(id=>!considered.has(id)&&!gone[id]).slice(0,64-considered.size) : [];
    if(more.length && !short){
      await env.setRt({tbuff:{...env.rt.tbuff,fa:more,faConsidered:[...considered,...more]}});
      env.rec('B','бафф',`Fast Aden: текущий набор дополнен ${more.map(nm).join(', ')}; продолжаю у баффера без нового похода`);
      return;
    }
    return done(`Fast Aden (баланс ${left} FA): ${got.join(' · ') || 'нечего брать'}`);
  }
  await env.setRt({ tbuff: null });
}
// 10.0.7 (лог 13.10 13:03–13:12, игрок: «куда пропадал бафф в последних минутах боя?»): чемпионы Lost Yeti, Frost Tarantula, Ghost of
// Rebellion Soldier, Vanor Silenos Shaman, Buffalo, Canyon Antelope снимают баффы — строка боя «[Frost Tarantula] зняв з вас 3 бафи.»
// (50 раз за 9 мин). Игрок дважды купил баффы за FA (13:07 — 8 FA, 13:10 — 9 FA), и следующий же чемпион снял их за минуту. Бот этого
// не понимал: писал «после баффера баффы так и не появились в шапке (1/3)», а после снятия ждал к бафферу 10 мин («к бафферу через 571 с»).
// Теперь: снятие — в журнал и в память rt.buffCancel (по имени вида), к бесплатному бафферу — сразу после боя, не «поход не удался»;
// чемпион, который снимает баффы, при платных баффах за FA (> 10 мин) — не цель (cfg.champNoCancel, mobfarm)
const CANCEL_RE = /\[([^\]]+)\]\s*(?:зняв з вас|сн[яи]л с вас|cancell?ed)\s*(\d+)\s*(?:баф|buff)/i;
function cancelNote(lines, name, opt = {}) {         // после боя: сколько баффов сняла цель → журнал + rt.buffCancel; возвращает число
  let n = 0, who = '';
  for (const l of lines || []) { const m = CANCEL_RE.exec(l); if (m) { n += +m[2] || 0; who = who || m[1]; } }
  if (!n) return 0;
  // память по виду: чемпион и обычный моб того же вида — разные записи (снимают оранжевые/красные чемпионы, обычный Buffalo — нет)
  const key = cancelKey(name || who, opt.champ), C = { ...(env.rt.buffCancel || {}) }, o = C[key] || {};
  C[key] = { t: Date.now(), n: (o.n || 0) + n, k: (o.k || 0) + 1, name: name || who, champ: !!opt.champ, tier: opt.tier || '', dungeon: opt.dungeon || o.dungeon || '' };
  for (const k of Object.keys(C)) if (Date.now() - (C[k].t || 0) > 30 * 86400000) delete C[k];
  env.setRt({ buffCancel: C, tbCancelT: Date.now() });
  const paid = faPaidLeft(0), RULE_P = { blue: 3, orange: 5, red: 7 }, rule = opt.champ && RULE_P[opt.tier];   // 10.0.8: правило игры, не свойство вида
  const avoid = rule ? (env.cfg.champCancel || 'paid') !== 'always' : env.cfg.noCancelMobs !== false;
  env.rec('B', 'бафф', `${name || who}${opt.champ ? ' [чемп]' : ''} снял с вас ${n} бафф(ов) за бой${rule ? ` (правило игры: ${tierRuOf(opt.tier)} ${rule} % за удар)` : ''}${paid ? ` — платных за FA осталось ${paid}` : ''}; бесплатный набор возьму у баффера сразу${avoid ? (rule ? ', при платных баффах за FA чемпиона беру только если он стоит потери' : ', такого больше не выбираю') : ''}`);
  return n;
}
const tierRuOf = t => ({ blue: 'синий', orange: 'оранжевый', red: 'красный' })[t] || 'чемпион';
const cancelKey = (name, champ) => (champ ? 'ч:' : '') + String(name || '').toLowerCase().trim();
// снимает ли этот моб баффы: память (30 дней, по факту снятия; чемпион и обычный моб вида — отдельно) или список игрока cfg.cancelMobs (любой вид)
// 10.0.8 (анонсы 13.10): любой чемпион снимает баффы по правилу игры (синий 3 % раз в 30 с, оранжевый 5 %, красный 7 % за удар) — цену считает
// champs.judge (cfg.champCancel), память по виду чемпионам не нужна; обычные мобы — по памяти и списку, как прежде
function cancelRisk(name, champ, tier) {
  if (champ && tier) return null;
  const k = cancelKey(name, champ), o = env.rt.buffCancel?.[k];
  if (o && Date.now() - (o.t || 0) < 30 * 86400000) return o;
  const own = String(env.cfg.cancelMobs || '').split(/[,\n;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const nm = String(name || '').toLowerCase().trim();
  return nm && own.some(x => nm === x || nm.includes(x)) ? { n: 0, k: 0, name, own: true } : null;
}
function faPaidLeft(minMs = 10 * 60000) {           // сколько платных баффов за FA висит с запасом > minMs (кроме Noblesse)
  let H = null; try { H = hudBuffs(); } catch (e) {}
  if (!H) return 0;
  const now = Date.now();
  return Object.entries(faPaidOn(H, now)).filter(([id, e]) => +id !== 1323 && e - now > minMs).length;
}
 return { paymentNote, paymentReconcile, hudLevels, tbLevelsNote, tbDowngrade, faIdsOf, faFullIds, tourFaWanted, faBalOf, faDropSum, faClashNote, faLow, activeBuffs, buffDur, ownBuffLeft, buffWaitBeforeRb, buffActive, buffAudit, buffAuditStep, buffList, totemSlots, totemActive, totemPick, totemNote, hudBuffs, townBuffNeed, faWanted, faCatalogNote, townBuffStart, townBuffStep, cancelNote, cancelRisk, cancelKey, faPaidLeft, CANCEL_RE };
 };
})(globalThis);
