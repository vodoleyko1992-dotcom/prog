/* L2wap v7: isolated buffs feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.buffs = function create_buffs(env) {
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
  const arr = [...new Set([...env.names(env.cfg.nBuffs), ...keys])].map(bn => ({ bn, b: env.slotsBy(bn)[0] }));
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

function hudBuffs() {                              // skillId → истекает (мс); null — шапки с баффами нет
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
function townBuffNeed() {                          // что взять: { set, fa: [id…] } или null
  const set = env.cfg.townBuffSet || 'basic';
  const H = hudBuffs();
  if (!H || set === 'off' && !(env.cfg.faBuffs || '').trim()) return null;
  const soon = id => !H[id] || H[id] - Date.now() < 10 * 60000;
  // v5.3: набор учим по факту — какие баффы появились/обновились после «Применить» (rt.tbSetIds). Раньше проверялись
  // 4 «ключевых» ID, и если слетал любой другой из ~10 баффов набора, бот этого не замечал (скрин 08.10 14:46)
  const ids = [...new Set([...(env.TB_KEYS[set] || env.TB_KEYS.basic), ...(env.rt.tbSetIds?.[set] || [])])];
  // и общий сторож: любой «длинный» бафф (осталось > 25 мин, не из списка Fast Aden), который мы видели у шапки, пропал
  // или кончается — значит, слетел городской набор (по нему и идём к бафферу, даже если набор ещё не выучен)
  const now = Date.now(), L = { ...(env.rt.hudLong || {}) }, faIds = (env.cfg.faBuffs || '').split(/[,\s]+/).map(Number);
  let ch = false;
  // 8.0.3 (лог 11.10 09:05: баффы за FA — на 3 ч, городской набор — на 24 ч): платные FA-баффы (куплены руками или РБ-сессией) не «городские»:
  // когда кончатся, к бесплатному бафферу за ними не ходим — новый «длинный» бафф только с запасом > 3,2 ч
  const sessIds = faIdsOf(env.cfg.rbSessBuffs);
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
  const fa = faWanted().filter(id => !H[id] || H[id] - Date.now() < 60000);
  return needSet || fa.length ? { set: needSet ? set : null, fa } : null;
}

const faIdsOf = v => String(v || '').split(/[,\s]+/).map(x => +x).filter(x => x > 0);
function faWanted() {
  const now = Date.now(), gone = env.rt.faGone || {};
  if (env.rt.faSkipUntil && now < env.rt.faSkipUntil) return [];
  // 7.2.1: РБ-сессия — её баффы покупаются один раз в начале; потом (после смерти) — только Noblesse Blessing (остальное он сохранил).
  // За 5 мин до конца сессии её баффы не нужны (иначе бот докупил бы их на новые 3 ч)
  const S = env.rt.rbSess, sess = S?.on && !(S.until && now > S.until - 5 * 60000) ? faIdsOf(env.cfg.rbSessBuffs) : [];
  const sessWant = S?.bought ? sess.filter(id => id === 1323 && env.cfg.rbSessNob !== false) : sess;
  // 8.0 (аудит РБ B3: 23:18 баффы FA висели, а Noblesse ушёл на прошлой смерти — следующая смерть сняла все 8 баффов): на РБ
  // с платными баффами (FA Greater, 5 FA) Noblesse Blessing докупается и без РБ-сессии — он 1 FA, а бережёт баффы на сотни FA
  let H = {}; if (env.cfg.rbMode || env.cfg.rbHuntMode) try { H = hudBuffs() || {}; } catch (e) {}
  const paidUp = Object.keys(H).some(id => +id !== 1323 && (env.FA_KNOWN?.[id]?.[1] || 0) >= 5 && H[id] - now > 10 * 60000);
  const nob = paidUp && (env.cfg.rbMode || env.cfg.rbHuntMode) && env.cfg.rbSessNob !== false ? [1323] : [];
  let ids = [...new Set([...faIdsOf(env.cfg.faBuffs), ...sessWant, ...nob])].filter(id => id > 0 && now - (gone[id] || 0) > 6 * 3600000);
  const bal = env.rt.faBal && now - env.rt.faBal.t < 6 * 3600000 ? env.rt.faBal.v : null;
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
  if (!isNaN(bal)) { patch.faBal = { v: bal, t: Date.now() }; if (env.rt.faSkipUntil && env.rt.faBal && bal > env.rt.faBal.v) patch.faSkipUntil = 0; }   // FA пополнили — снова можно
  if (Object.keys(patch).length) env.setRt(patch);
  return n;
}

async function townBuffStart(why, urgent) {         // urgent — перед РБ: не ждём 10 мин с прошлого похода (только 1 мин)
  const n = townBuffNeed();
  if (!n) { if (env.rt.tbFail) env.setRt({ tbFail: 0 }); return false; }
  // v5.5: после баффера баффов в шапке так и нет (скрин 08.10 15:29: остался один, бот «не видит») — раньше «наложен» по
  // сообщению баффера = 10 мин тишины. Теперь: прошло ≥ 40 с после баффера, а нужное всё ещё не висит — поход не удался,
  // повтор через 1 мин; 3 таких подряд — пауза 10 мин и запись в журнал (чтобы не бегать к бафферу по кругу)
  const since = Date.now() - (env.rt.tbT || 0);
  let wait = env.rt.tbOk === false || urgent ? 60000 : 10 * 60000;
  if (env.rt.tbT && since > 40000 && since < 15 * 60000 && env.rt.tbChk !== env.rt.tbT) {
    const fails = (env.rt.tbFail || 0) + 1;
    await env.setRt({ tbChk: env.rt.tbT, tbOk: false, tbFail: fails });
    env.rec('B', 'бафф', `после баффера баффы так и не появились в шапке (${fails}/3)${fails >= 3 ? ' — пауза 10 мин, проверьте набор баффа в меню' : ' — повторю через 1 мин'}`);
    wait = fails >= 3 ? 10 * 60000 : 60000;
    if (fails >= 3) await env.setRt({ tbFail: 0, tbOk: true, tbPauseUntil: Date.now() + 10 * 60000 });   // v5.6: пауза и для «срочных» (перед РБ) — раньше они шли каждую минуту
  }
  if ((env.rt.tbPauseUntil || 0) > Date.now()) return false;
  if (since < wait) { if (env.rt.tbWaitSaid !== env.rt.tbT) { await env.setRt({ tbWaitSaid: env.rt.tbT }); env.rec('B', 'бафф', `баффы слетели (${why}), к бафферу через ${Math.ceil((wait - since) / 1000)} с`); } return false; }
  const H = hudBuffs() || {}, miss = [...(n.set ? [...new Set([...(env.TB_KEYS[n.set] || []), ...(env.rt.tbSetIds?.[n.set] || [])])] : []), ...n.fa].filter(id => !H[id] || H[id] - Date.now() < 10 * 60000);
  if (miss.length) why += ` (нет/кончается: ${miss.slice(0, 6).map(id => env.IL[id]?.n || env.rt.faCat?.[id]?.name || id).join(', ')})`;
  await env.setRt({ tbuff: { ...n, t: Date.now(), step: n.set ? 'town' : 'fa' }, tbT: Date.now() });
  env.rec('B', 'бафф', `${why}: ${n.set ? 'городской «' + n.set + '»' : ''}${n.set && n.fa.length ? ' + ' : ''}${n.fa.length ? 'FA ' + n.fa.join(', ') : ''}`);
  location.href = n.set ? '/town-buffer.html' : '/fast-aden-buffer.html'; await env.sleep(4000);
  return true;
}

async function townBuffStep() {
  const st = env.rt.tbuff;
  const done = async msg => {
    env.rec('B', 'бафф', msg);
    if (st.then) { await env.setRt({ tbuff: { ...st.then, t: Date.now() } }); return; }   // бафф был перед «Восстановить» — теперь восстановление
    await env.setRt({ tbuff: null }); location.href = env.autonomyMode() === 'fish' ? '/fishing.html' : '/map.html'; await env.sleep(4000);
  };
  if (st.step === 'restore') {
    if (!/\/town-buffer\.html/.test(location.pathname)) { location.href = '/town-buffer.html'; await env.sleep(4000); return; }
    // v4.34: сначала бафф (после смерти он слетел, а с ним и часть макс. HP), потом «Восстановить» — до нового максимума.
    // Раньше было наоборот: восстановили до 5164, бафф поднял максимум до 6326 — и снова 19 %
    const n = !st.buffDone && townBuffNeed();
    if (n && (n.set || n.fa.length)) { await env.setRt({ tbuff: { ...n, t: Date.now(), step: n.set ? 'town' : 'fa', reviveTried: st.reviveTried, then: { ...st, buffDone: true } }, tbT: Date.now() }); return; }
    env.setStatus('Восстановление: баффер «Восстановить HP|MP|CP»');
    const rb = await env.waitX(() => env.$q('#town-buffer-restore-btn'), 10000, 200);
    const hpPct = () => env.meHp()?.pct ?? 0, msg = () => (env.$q('#town-buffer-msg')?.textContent || '').trim();
    let ok = false;
    if (rb) {
      const hp0 = hpPct() | 0;
      await env.sleep(env.rnd(1300, 1800));                 // кнопка появляется раньше, чем страница готова: ранний клик → «Не удалось восстановить»
      // v4.36: сразу после боя/смерти/отхода игра восстановление не даёт («Не удалось…» или молчит) — по журналам
      // все неудачи были через 1–6 с после боя. Повторяем с растущей паузой: ≈1 мин на всё
      const waits = [0, 5000, 8000, 12000, 15000];
      for (let i = 1; i <= waits.length && env.on && !ok; i++) {
        const w = waits[i - 1];
        for (let t0 = Date.now(); w && env.on && Date.now() - t0 < w;) { env.setRt({ status: `Восстановление: игра пока не даёт (после боя) — попытка ${i}/${waits.length} через ${Math.ceil((w - (Date.now() - t0)) / 1000)} с` }); env.draw(); await env.sleep(1000); }
        if (!env.on) break;
        const m = env.$q('#town-buffer-msg'); if (m) m.textContent = '';
        env.fire(rb);
        await env.waitX(() => hpPct() >= 99 || /не удалось|не вдалося|failed|восстановлен[оыа]|відновлен[оі]|restored/i.test(msg()), 7000, 200);
        if (hpPct() < 90) await env.waitX(() => hpPct() >= 99, 3000, 250);
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
    location.href = st.back || '/map.html'; await env.sleep(4000); return;
  }
  if (st.step === 'town') {
    if (!/\/town-buffer\.html/.test(location.pathname)) { location.href = '/town-buffer.html'; await env.sleep(4000); return; }
    env.setStatus(`Бафф: городской баффер (${st.set})`);
    const btn = await env.waitX(() => env.$q(`#town-buffer-sets .l2-town-buffer-set-apply[data-set-id="${st.set}"]`), 10000, 200);
    if (!btn) return done(`баффер не открылся (${env.shown(env.$q('#town-buffer-load-err')) ? env.$q('#town-buffer-load-err').textContent.trim().slice(0, 80) : 'нет кнопки'})`);
    if (st.set !== 'basic' && !['warrior', 'mage'].includes(env.cfg.townBuffSet)) return done('платный бафф не выбран в меню — пропускаю');
    tbLevelsNote();
    const dn = tbDowngrade(st.set, hudBuffs() || {});
    if (dn.length) return done(`городской набор «${st.set}» не наложен — понизил бы ${dn.length} бафф(ов) (Lv.${dn[0].have}→${dn[0].give})`);   // 7.2.2
    const H0 = hudBuffs() || {};
    await env.pause(); env.fire(btn);
    const res = () => (env.$q('#town-buffer-result-title')?.textContent || '') + ' ' + (env.$q('#town-buffer-result-text')?.textContent || '');
    const ok = await env.waitX(() => /накладено|наложен|applied/i.test(res()), 6000, 200);
    if (ok) {                                       // v5.3: запоминаем, какие баффы даёт набор (новые и обновлённые в шапке)
      await env.waitX(() => Object.keys(hudBuffs() || {}).some(id => !(id in H0) || (hudBuffs()[id] || 0) > (H0[id] || 0) + 60000), 3000, 200);
      const H1 = hudBuffs() || {}, got = Object.keys(H1).map(Number).filter(id => H1[id] !== Infinity && (!(id in H0) || H1[id] > (H0[id] || 0) + 60000) && !faWanted().includes(id));
      await env.setRt({ hudLong: {} });
      if (got.length) await env.setRt({ tbSetIds: { ...(env.rt.tbSetIds || {}), [st.set]: [...new Set([...(env.rt.tbSetIds?.[st.set] || []), ...got])] } });
    }
    const fail = !ok && res().replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!ok && (env.DEAD_RE.test(res()) || env.DEAD_RE.test(env.$q('#town-buffer-msg')?.textContent || '') || !res().trim())) {
      // «без подтверждения» у баффера = скорее всего «без сознания» (лог 01:33): сначала воскрешение
      if (!st.reviveTried) { env.rec('B', 'бафф', 'баффер не отвечает — похоже, персонаж «без сознания»: сначала «Вернуться в город»'); await env.setRt({ tbuff: null, revive: { t: Date.now(), url: env.rt.lastBattle } }); return; }
    }
    const cl = env.$q('#town-buffer-result-overlay [class*="close"], #town-buffer-result-overlay');   // закрыть окно результата
    if (ok && cl) { try { env.fire(cl); } catch (e) {} }
    env.rec('B', 'бафф', ok ? `городской «${st.set}» — наложен` : `городской «${st.set}»: ${fail || 'без подтверждения'}`);
    await env.setRt({ tbOk: !!ok });
    if (st.fa?.length) { await env.setRt({ tbuff: { ...st, step: 'fa' } }); location.href = '/fast-aden-buffer.html'; await env.sleep(4000); return; }
    return done('готово — возвращаюсь');
  }
  if (st.step === 'fa') {
    if (!/\/fast-aden-buffer\.html/.test(location.pathname)) { location.href = '/fast-aden-buffer.html'; await env.sleep(4000); return; }
    env.setStatus('Бафф: Fast Aden');
    await env.waitX(() => env.$q('.l2-fa-buy[data-skill-id]'), 10000, 200);
    await env.waitX(() => /\d/.test(env.$q('#fast-aden-balance')?.textContent || ''), 4000, 200);   // баланс дорисовывается позже кнопок
    faCatalogNote();
    const balNow = () => +((env.$q('#fast-aden-balance')?.textContent || '0').replace(/\D/g, '') || 0);
    const nm = id => env.rt.faCat?.[id]?.name || env.FA_KNOWN[id]?.[0] || id;
    const got = [], gone = { ...(env.rt.faGone || {}) };
    let bought = 0, short = 0;
    for (const id of st.fa || []) {
      if (!env.on) break;
      const bal = balNow(), b = env.$q(`.l2-fa-buy[data-skill-id="${id}"]`);
      if (!b) { got.push(`${nm(id)}: нет у баффера — пропускаю 6 ч`); gone[id] = Date.now(); continue; }
      if (b.disabled) { got.push(`${nm(id)}: кнопка недоступна`); continue; }
      const cost = +(b.dataset.cost || 1);
      if (bal < cost) { got.push(`${nm(id)}: не хватает FA (${bal}/${cost})`); short++; continue; }   // дальше — те, что по карману
      await env.pause(); env.fire(b);
      const ok = await env.waitX(() => balNow() < bal, 5000, 200);
      if (ok) bought++;
      got.push(`${nm(id)}: ${ok ? '−' + cost + ' FA' : 'без подтверждения'}`);
      await env.sleep(env.rnd(250, 450));
    }
    const left = balNow();
    const patch = { faGone: gone, faBal: { v: left, t: Date.now() } };
    if (short && !bought) { patch.faSkipUntil = Date.now() + 60 * 60000; got.push('FA не хватает — к бафферу FA не хожу 60 мин (или пока баланс не вырастет)'); }
    await env.setRt(patch);
    return done(`Fast Aden (баланс ${left} FA): ${got.join(' · ') || 'нечего брать'}`);
  }
  await env.setRt({ tbuff: null });
}
 return { hudLevels, tbLevelsNote, tbDowngrade, faIdsOf, activeBuffs, buffDur, ownBuffLeft, buffWaitBeforeRb, buffActive, buffAudit, buffAuditStep, buffList, totemSlots, totemActive, totemPick, totemNote, hudBuffs, townBuffNeed, faWanted, faCatalogNote, townBuffStart, townBuffStep };
 };
})(globalThis);
