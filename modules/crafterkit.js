/* L2wap 20.43–20.44 (John 21.10 12:48: «Крафтом на Рб буду ходить с булавой и щитом, а фарм с пикой»; 13:05 голем «Только на РБ»;
   13:13 «на фарм и в каты с пикой»; 13:44 «Весь тур — набор РБ»): набор крафтера (Artisan/Warsmith/Maestro).
   РБ — тур РБ (вместе с его паузами на мобах, «одним РБ» и РБ-сессией), эпики и бой с РБ ради ресурса (фарм ресурса с РБ, rt.farmRb,
   когда этот РБ жив на карте): одноручная дубина + щит + голем (Summon Mechanic Golem l2_25: вне боя POST /character/skills/cast
   {battleId, expectedRevision}; кристаллы — по рангу из learnedBattleSkillsDetail: ранги 1–2 Crystal D, дальше Crystal C).
   Фарм — автофарм, фарм на месте, катакомбы, кампания, «Только задачи» с целью фарма: пика (древковое), щит снят, голем отозван
   (−15 % EXP; POST /character/companion/dismiss {expectedRevision, characterId} — как кнопка «Відкликати слугу» в окне слуги).
   Рыбалка, TvT, заточка, задачи без фарма — набор не трогаем. Выключатель — cfg.crafterKit (по умолчанию ВКЛ).
   Вещи — сильнейшие из сумки GET /character, которые разрешают уровень и грейд (тип — по каталогу игры, иначе по справочнику;
   магические дубины — не булава воина). Клановые, с Life Stone, перерождённые и неизвестные вещи бот сам не выбирает и надетые
   не снимает (обратно надеть их он не сможет), надетое подходящего типа не хуже лучшего — не трогаем. Щит — только поверх уже надетого
   одноручного оружия. Одно действие за шаг (снять щит / надеть / отозвать / призвать), ответ игры (character) — новое состояние,
   409 — перечитать. Отказ игры — это действие пропускается 30 мин. Неизвестный исход призыва (тратит кристаллы и MP) — сверка, повтор
   того же запроса с прежней revision (из двух сервер примет один, как в крафте). Главный цикл набор держит только после своего
   запроса; сбой чтения героя — не держит. Фаза ≤ 2 мин (паузы дольше 10 с — бой, TvT, Стоп — не в счёт): не уложились — набор ждёт
   10 мин, задача идёт как есть. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.crafterkit = function create_crafterkit(env) {
const GOLEM = 'l2_25', GOLEM_KEY = /mechanic_golem/i, CRYSTAL_D = 1458, CRYSTAL_C = 1459, CRYSTAL_MIN = 10, MP_NEED = 150;
const RECHECK = 60000, BUSY = 800, FAIL_SKIP = 30 * 60000, PHASE_MS = 2 * 60000, PHASE_GAP = 10000, PHASE_SKIP = 10 * 60000, PEND_WAIT = 15000, NOTE_EVERY = 10 * 60000;
const SHOP_BACKOFF = 60 * 60000, CRYSTAL_KEEP = [30, 100];
const GR = { NG: 0, D: 1, C: 2, B: 3, A: 4, S: 5 }, KIND_RU = { rb: 'РБ (булава + щит + голем)', farm: 'фарм (пика, без голема)' };
// Паузы, отказы и неизвестный призыв — в sessionStorage вкладки: фабрика создаётся заново на каждой странице игры
const SS = 'l2bot-kit';
let mem = (() => { try { return JSON.parse(root.sessionStorage?.getItem(SS) || 'null') || {}; } catch (e) { return {}; } })();
const S = () => { const c = env.rt.char || ''; if (mem.char !== c) mem = { char: c, nextT: 0, holdT: 0, kind: '', need: false, fails: {}, phase: null, skip: {}, pend: null, noteAt: {}, idle: null, golem: null }; mem.fails ||= {}; mem.skip ||= {}; mem.noteAt ||= {}; return mem; };
const save = () => { try { root.sessionStorage?.setItem(SS, JSON.stringify(mem)); } catch (e) {} };
// журнал: каждая причина — не чаще раза в 10 мин (своя метка на причину, две чередующиеся строки друг друга не сбрасывают)
const note = (key, txt) => {
  const s = S(), now = Date.now();
  if (now - (+s.noteAt[key] || 0) < NOTE_EVERY) return;
  for (const k of Object.keys(s.noteAt)) if (now - s.noteAt[k] >= NOTE_EVERY) delete s.noteAt[k];
  s.noteAt[key] = now; save(); env.rec('B', 'набор', txt);
};
const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const holds = () => env.cfg.crafterKit !== false && env.role?.() === 'crafter';
// фарм ресурса с РБ (rt.farmRb): прилетели к этому РБ и он жив на карте — нужен набор РБ (до боя, шаг набора идёт раньше карты)
function farmRbNow() {
  const id = env.rt.rbWant;
  if (!id || !env.farmRbOn?.() || id !== env.rt.farmRb?.id) return false;
  try { return (env.rbCandidates?.() || []).some(r => r?.id === id); } catch (e) { return false; }
}
// какой набор нужен сейчас: 'rb' | 'farm' | null (не трогаем)
function want() {
  if (!holds()) return null;
  const m = env.mode?.();
  if (m === 'raid' || m === 'epic') return 'rb';
  if (m === 'farm' || m === 'cat' || m === 'campaign' || m === 'tasks' && env.lootGoal?.()) return farmRbNow() ? 'rb' : 'farm';
  return null;
}
// голем — только на РБ: в бою с обычным мобом на фарме combat не призывает его; в бою с любым РБ (rb) — можно
const noSummon = rb => holds() && !rb && want() !== 'rb';

// магическое оружие — правило economy.weaponIsMage: режим каталога игры, иначе M.Atk/P.Atk ≥ 0,7 у грейдовой одноручной
function mage(it) {
  if (!it) return false;
  if (it.weaponMode === 'magic' || it.weaponMode === 'phys') return it.weaponMode === 'magic';
  const pa = +it.pa || 0, ma = +it.ma || 0;
  return !!(pa >= 30 && ma > 0 && it.g && !/^(NG|—)$/i.test(it.g) && ma / pa >= (it.two ? 0.6 : 0.7));
}
const isShield = it => it?.wt === '—' || it?.slot === 'lhand';
const isMace = it => it?.k === 'W' && it.wt === 'дубина' && !it.two && !mage(it), isPike = it => it?.k === 'W' && it.wt === 'древковое';
const slotId = v => +(v && typeof v === 'object' ? v.itemId : v) || 0;
const golemOf = c => { const s = c?.activeSummon; return s && GOLEM_KEY.test(String(s.key || '')) ? s : null; };
const crystals = (c, id) => (c?.inventory?.stacks || []).reduce((n, x) => n + (+x?.itemId === id ? +x.qty || 0 : 0), 0);
const prof = c => String(c?.l2Profession || '').replace(/_/g, ' ');
// ранг голема — из навыков героя; без списка навыков — по профессии (Warsmith/Maestro учат ранг 3+ уже на 40)
function golemInfo(c) {
  const L = c?.learnedBattleSkillsDetail;
  if (Array.isArray(L)) { const r = +L.find(x => String(x?.battleId) === GOLEM)?.level || 0; return { rank: r, id: r <= 0 ? 0 : r <= 2 ? CRYSTAL_D : CRYSTAL_C }; }
  return /\b(?:warsmith|maestro)\b/i.test(prof(c)) ? { rank: 3, id: CRYSTAL_C, guess: 1 } : { rank: 0, id: 0, guess: 1 };
}
const crystalName = id => id === CRYSTAL_D ? 'Crystal D' : 'Crystal C';
// вещь по каталогу игры (тип, двуручность, уровень, магическое; щиты каталога — slot lhand) поверх справочника (грейд, цена, P.Def)
function itemFor(id) {
  const il = env.itemOf?.(id) || null, cat = env.weaponItem?.(id) || null;
  if (!cat || cat === il) return il;
  if (!il) return cat;
  if (cat.k !== 'W') return { ...il, slot: cat.slot };
  const o = { ...il }; for (const [k, v] of Object.entries(cat)) if (v != null) o[k] = v; return o;
}
function rows(c) {
  const eq = c?.inventory?.eq || {}, out = [], row = (v, where) => {
    const id = slotId(v); if (!id || where === 'bag' && !(+v.qty > 0)) return;
    const o = v && typeof v === 'object' ? v : {};
    out.push({ id, ench: +o.enchant || 0, pb: +o.enchantPAtkBonus || 0, mb: +o.enchantMAtkBonus || 0, it: itemFor(id), where, raw: o });
  };
  row(eq.l1, 'l1'); row(eq.l2, 'l2');
  for (const s of c?.inventory?.stacks || []) row(s, 'bag');
  return out;
}
// бот выбирает и снимает только обычные вещи: у клановых, с Life Stone и «перерождённых» свой токен экземпляра, неизвестные не проверить
const plain = x => x.it?.k === 'W' && !x.raw.clanWeaponUid && !x.raw.clanShieldUid && !x.raw.augmentation && !(+x.raw.rebirthWeaponAttack > 0);
const fixed = x => !!x && !plain(x);
// почему не снимаем: оружие — «клановое», щит — «клановый»
const fixedWhy = (x, he) => { const e = he ? 'ый' : 'ое'; return x.raw.augmentation ? 'с Life Stone' : x.raw.clanWeaponUid || x.raw.clanShieldUid ? 'кланов' + e : +x.raw.rebirthWeaponAttack > 0 ? 'перерождённ' + e : 'неизвестн' + e; };
const atk = x => (+x.it?.pa || 0) + x.pb;
// skip — пропущенные после отказа игры надевания: берём следующую вещь того же типа; off — лучшая, но отложенная (для журнала)
function pick(kind, c, skip = {}) {
  const now = Date.now(), lvl = +c?.level || +env.heroLevel?.() || 0, all = rows(c), gl = env.GRADE_LV || {};
  const okLvl = x => lvl >= Math.max(gl[x.it?.g || 'NG'] ?? 0, +x.it?.requiredLevel || 0);
  const off = {}, best = (f, score, tag) => {
    const l = all.filter(x => x.where === 'bag' && plain(x) && okLvl(x) && f(x.it)).sort((a, b) => score(b) - score(a));
    const ok = l.find(x => !((skip['equip:' + x.id] || 0) > now)) || null;
    if (l[0] && l[0] !== ok) off[tag] = { x: l[0], until: +skip['equip:' + l[0].id] };
    return ok;
  };
  const type = kind === 'rb' ? isMace : isPike, w1 = all.find(x => x.where === 'l1') || null, w2 = all.find(x => x.where === 'l2') || null;
  let weapon = best(type, atk, 'weapon');
  if (w1?.it && type(w1.it) && (fixed(w1) || !weapon || atk(w1) >= atk(weapon))) weapon = w1;
  let shield = null;
  if (kind === 'rb') shield = w2 && (fixed(w2) || isShield(w2.it)) ? w2 : best(isShield, x => (GR[x.it.g] || 0) * 1e9 + (+x.it.pr || 0), 'shield');
  return { weapon, shield, lvl, w1, w2, off };
}
const nameOf = x => x?.it?.n || '#' + (x?.id || '?');
// токен экземпляра как у страницы /char.html: bag:<id>:<заточка>, у заточенного оружия ещё :<P-бонус>:<M-бонус> (Yaksa +4: bag:2503:4:16:0)
const token = x => x.raw.targetInstanceId || `bag:${x.id}:${x.ench}` + (x.pb || x.mb ? `:${x.pb}:${x.mb}` : '');
function equipBody(x) {
  const b = { action: 'equip', itemId: x.id, enchant: x.ench, targetInstanceId: token(x) };
  if (!isShield(x.it)) { b.enchantPAtkBonus = x.pb; b.enchantMAtkBonus = x.mb; }
  return b;
}
const W = (k, t) => ({ k, t });
const offWhy = (o, what) => `${what} «${nameOf(o.x)}» игра не дала надеть — повторю после ${hhmm(o.until)}`;
// план на этот снимок героя: список действий по порядку, первое выполняем; why — что сделать нельзя (в журнал)
function plan(kind, c, skip = {}) {
  const P = pick(kind, c, skip), eq = c?.inventory?.eq || {}, ops = [], why = [], g = golemOf(c), { w1, w2 } = P;
  if (kind === 'farm') {
    if (g) ops.push({ op: 'dismiss', key: 'dismiss' });
    if (fixed(w1) && !isPike(w1.it)) why.push(W('hold1', `надето ${fixedWhy(w1)} оружие «${nameOf(w1)}» — набор его не снимает (обратно надеть не сможет), пику наденьте вручную`));
    else if (!P.weapon) why.push(P.off.weapon ? W('offPike', offWhy(P.off.weapon, 'пику')) : W('noPike', 'пики в сумке нет (или не по уровню) — оружие не меняю'));
    else if (P.weapon.where === 'bag') {
      if (fixed(w2)) why.push(W('hold2', `надет ${fixedWhy(w2, 1)} щит «${nameOf(w2)}» — двуручную пику не надеваю (щит обратно надеть не смогу)`));
      else if (slotId(eq.l2)) ops.push({ op: 'unequip', slot: 'l2', key: 'unequip:l2' });   // пика двуручная — щит снимаем сами, не надеясь на игру
      else ops.push({ op: 'equip', x: P.weapon, key: 'equip:' + P.weapon.id });
    }
    return { ops, why, P };
  }
  if (fixed(w1) && !isMace(w1.it)) why.push(W('hold1', `надето ${fixedWhy(w1)} оружие «${nameOf(w1)}» — набор его не снимает (обратно надеть не сможет), булаву наденьте вручную`));
  else if (!P.weapon) why.push(P.off.weapon ? W('offMace', offWhy(P.off.weapon, 'булаву')) : W('noMace', 'одноручной дубины в сумке нет (или не по уровню) — оружие не меняю'));
  else if (P.weapon.where === 'bag') ops.push({ op: 'equip', x: P.weapon, key: 'equip:' + P.weapon.id });
  // щит — только поверх уже надетого одноручного оружия (или пустой руки): булава встанет — щит следующим шагом
  const oneHand = !w1 || !!w1.it && w1.it.k === 'W' && !w1.it.two && !isShield(w1.it);
  if (!P.shield) why.push(P.off.shield ? W('offShield', offWhy(P.off.shield, 'щит')) : W('noShield', 'щита в сумке нет (или не по уровню)'));
  else if (P.shield.where === 'bag' && oneHand) ops.push({ op: 'equip', x: P.shield, key: 'equip:' + P.shield.id });
  const G = golemInfo(c); P.golem = G;
  if (!g || !(+g.hp > 0)) {
    if (!G.rank) why.push(W('noGolem', G.guess ? 'навыки героя не прочитаны — голема вне боя не призываю (в бою с РБ его призовёт бой)' : 'Summon Mechanic Golem не выучен — иду без голема'));
    else if (crystals(c, G.id) < CRYSTAL_MIN) why.push(W('crystal', `для голема нужен ${crystalName(G.id)} (есть ${crystals(c, G.id)}, нужно от ${CRYSTAL_MIN}) — иду без голема, докупит закупка`));
    else ops.push({ op: 'summon', key: 'summon' });
  }
  return { ops, why, P };
}

async function readChar() {
  try { const r = await env.gameGet('/character'); if (!r?.ok) return { err: r?.status || 'сеть' }; const j = await r.json().catch(() => null); return { c: j?.character || j }; }
  catch (e) { return { err: e?.name === 'AbortError' ? 'нет ответа' : e?.message || 'сеть' }; }
}
const NOT_SENT = /^(?:bot_inactive|action_cancelled|pvp_defeat_pending|payment_unconfirmed|lifestone_session_active)$/;
// later — когда шагу снова смотреть; wait — то же, но главный цикл держим (только после своего запроса: игра ещё обрабатывает действие)
const later = ms => { S().nextT = Date.now() + ms; save(); };
const wait = ms => { const s = S(); s.nextT = s.holdT = Date.now() + ms; save(); };
// два сбоя подряд (5xx, обрыв, призыв без голема) — это действие пропускаем 30 мин; отказ игры (4xx) — сразу
function failed(key, txt) {
  const s = S(), n = (+s.fails[key] || 0) + 1;
  if (n >= 2) { delete s.fails[key]; s.skip[key] = Date.now() + FAIL_SKIP; save(); note('fail:' + key, `${txt} — второй раз подряд, это действие пропускаю 30 мин`); return; }
  s.fails[key] = n; save(); note('err:' + key, `${txt} — перечитаю героя и попробую ещё раз`);
}
// неизвестный исход призыва: не больше трёх сверок, потом призыв ждёт 30 мин (кристаллы и MP зря не тратим)
function pendSet(rev, why) {
  const s = S(), tries = (+s.pend?.tries || 0) + 1;
  if (tries > 3) { s.pend = null; s.skip.summon = Date.now() + FAIL_SKIP; save(); note('pendEnd', `голем: ${why} — исход неизвестен после трёх сверок, призыв жду 30 мин`); return true; }
  s.pend = { rev, t: Date.now(), tries }; save(); note('pend', `голем: ${why} — результат неизвестен, сверю по герою, новый призыв не шлю`); return true;
}
// неизвестный призыв: голем появился — готово; та же revision — повтор того же запроса с прежней revision; ушла вперёд — не прошёл.
// Первые 15 с цикл держим (бой мог бы призвать второго голема поверх неизвестного), сбой чтения героя — не держит
async function reconcile(char) {
  const s = S(), p = s.pend, now = Date.now();
  if (now - p.t < PEND_WAIT) { s.nextT = s.holdT = p.t + PEND_WAIT; save(); return true; }
  s.phase ||= { t: now, last: now };
  const R = await readChar(), c = R.c;
  if (env.rt.char !== char || !env.on || S().pend !== p) return false;
  if (!c?.revision || c.name !== char) { later(30000); note('pendRead', `голем: сверка призыва — герой не прочитан (${R.err || 'нет revision'}), новый призыв не шлю`); return false; }
  if (golemOf(c)) { s.pend = null; delete s.fails.summon; save(); env.petNote?.(c); env.rec('B', 'набор', 'голем: призыв подтверждён сверкой'); later(BUSY); return false; }
  if (c.revision !== p.rev) { s.pend = null; failed('summon', 'голем: призыв не прошёл (revision героя ушла вперёд, голема нет)'); later(BUSY); return false; }
  return send({ op: 'summon', key: 'summon' }, c, char, p.rev);
}
// одно действие; rev — revision для повтора неизвестного призыва
async function send(o, c, char, rev = c.revision) {
  const s = S();
  let path, body, what;
  if (o.op === 'equip') { path = '/character/equip'; body = { ...equipBody(o.x), expectedRevision: rev }; what = `надеваю «${nameOf(o.x)}»${o.x.ench ? ' +' + o.x.ench : ''}`; }
  else if (o.op === 'unequip') { path = '/character/equip'; body = { action: 'unequip', slot: o.slot, expectedRevision: rev }; what = 'снимаю щит (пика двуручная)'; }
  else if (o.op === 'dismiss') { path = '/character/companion/dismiss'; body = { expectedRevision: rev, characterId: c.id }; what = 'отзываю голема (на фарме он режет EXP на 15 %)'; }
  else { path = '/character/skills/cast'; body = { battleId: GOLEM, expectedRevision: rev }; what = 'призываю голема (Summon Mechanic Golem)';
    // MP мало — цикл не держим: задача идёт, призыв — когда MP наберётся (в бою на РБ голема призовёт и бой, combat.petStep)
    if ((+c.mp || 0) < MP_NEED) { S().need = false; later(20000); note('mp', `голем: мало MP (${+c.mp || 0}, нужно от ${MP_NEED}) — призову позже`); return false; } }
  if (env.canAct?.() === false || !env.tabOwner || !env.on) return false;
  let r = null, j = null;
  try { r = await env.gamePost(path, body); j = await r.json().catch(() => null); }
  catch (e) {
    if (NOT_SENT.test(e?.message || '')) { later(BUSY); return false; }
    if (o.op === 'summon') return pendSet(rev, `ответ на призыв не пришёл (${e?.name === 'AbortError' ? 'нет ответа' : e?.message || e})`);
    failed(o.key, `${what}: обрыв (${e?.name === 'AbortError' ? 'нет ответа' : e?.message || e})`); wait(5000); return true;
  }
  if (env.rt.char !== char) return false;
  if (r.status === 409) { if (o.op === 'summon' && s.pend) { s.pend = { ...s.pend, t: Date.now() - PEND_WAIT }; save(); } wait(BUSY); return true; }
  if (r.status >= 500) {
    if (o.op === 'summon') return pendSet(rev, `HTTP ${r.status} на призыв`);
    failed(o.key, `${what}: HTTP ${r.status}`); wait(5000); return true;
  }
  if (o.op === 'summon') s.pend = null;
  if (!r.ok) {
    const msg = j?.messageRu || j?.messageUk || j?.error || `HTTP ${r.status}`;
    s.skip[o.key] = Date.now() + FAIL_SKIP; save(); wait(BUSY);
    note('fail:' + o.key, `${what}: игра отказала — ${msg}; это действие пропускаю 30 мин`); return true;
  }
  delete s.fails[o.key]; s.idle = null; save();
  const ch = j?.character;
  if (o.op === 'equip' && !isShield(o.x.it)) await env.equipNote?.(body);   // как ответ на клик игры: оружие, грейд зарядов, тип для спойла
  if ((o.op === 'summon' || o.op === 'dismiss') && ch) env.petNote?.(ch);
  env.rec('B', 'набор', `${what} — готово${o.op === 'summon' && ch && !golemOf(ch) ? ' (голема в ответе нет — проверю)' : ''}`);
  // ответ годится вместо GET, только если в нём сумка, надетое и слуга (иначе план по нему мог бы призвать второго голема)
  mem.last = ch && ch.name === char && ch.revision && ch.inventory?.eq && Array.isArray(ch.inventory.stacks) && 'activeSummon' in ch ? { c: ch, t: Date.now() } : null; save();
  wait(BUSY); return true;
}
const opText = o => o.op === 'equip' ? '«' + nameOf(o.x) + '»' : o.op === 'unequip' ? 'снять щит' : o.op === 'dismiss' ? 'отозвать голема' : 'призвать голема';
// шаг главного цикла (вне боя, до задач): true — набор занят (цикл ждёт), false — работать дальше
async function step() {
  const kind = want(), s = S(), now = Date.now();
  if (!kind) { if (s.kind || s.need || s.phase) { s.kind = ''; s.need = false; s.phase = null; s.idle = null; save(); } return false; }
  if (!env.on || !env.tabOwner || env.isBattle?.() || env.busy?.() || env.canAct?.() === false || env.gearBusy?.()) return false;
  if (s.kind !== kind) { s.kind = kind; s.need = false; s.phase = null; s.idle = null; s.nextT = s.holdT = 0; mem.last = null; save(); }
  if ((s.skip['kind:' + kind] || 0) > now) return false;
  // время фазы идёт, только пока набор может действовать: перерыв дольше 10 с (бой, TvT, Стоп, капча) сдвигает её начало
  if (s.phase) { const gap = now - (+s.phase.last || s.phase.t); s.phase.last = now; if (gap > PHASE_GAP) { s.phase.t += gap; save(); } }
  if (now < (+s.nextT || 0)) return now < (+s.holdT || 0);
  if (s.phase && now - s.phase.t > PHASE_MS) {
    s.skip['kind:' + kind] = now + PHASE_SKIP; s.need = false; s.phase = null; save();
    env.rec('B', 'набор', `набор ${KIND_RU[kind]} не собрался за 2 мин — задача идёт как есть, снова попробую через 10 мин`); return false;
  }
  const char = env.rt.char;
  if (s.pend) return reconcile(char);
  // свежий ответ своего действия (≤ 3 с) заменяет GET; иначе — перечитать героя
  let c = mem.last && now - mem.last.t < 3000 ? mem.last.c : null;
  if (!c) { const R = await readChar(); if (env.rt.char !== char || !env.on) return false; c = R.c;
    if (!c?.revision) { later(s.phase ? 10000 : RECHECK); note('get', `не прочитан герой (${R.err || 'нет revision'}) — повторю ${s.phase ? 'через 10 с' : 'через минуту'}`); return false; } }
  mem.last = null;
  if (c.name !== char || !/\b(?:artisan|warsmith|maestro)\b/i.test(prof(c))) { later(RECHECK); s.need = false; s.phase = null; save(); return false; }
  if (c.inBattle === true) { later(5000); return false; }
  const db = await env.itemsDb?.();
  if (env.rt.char !== char || !env.on) return false;
  if (!db) { later(30000); return false; }   // справочник предметов не загрузился — без него типы оружия не узнать
  // надетое, которого нет в справочнике (клановое, из каталога игры), — узнать по каталогу, чтобы не снять по ошибке
  for (const v of [c.inventory?.eq?.l1, c.inventory?.eq?.l2]) { const id = slotId(v); if (id && !itemFor(id)) { try { await env.resolveItem?.(id); } catch (e) {} } }
  if (env.rt.char !== char || !env.on) return false;
  const P = plan(kind, c, s.skip), ops = P.ops.filter(o => !((s.skip[o.key] || 0) > now));
  s.checkT = now; if (P.P.golem) s.golem = { rank: P.P.golem.rank, id: P.P.golem.id };
  for (const w of P.why) note(`why:${kind}:${w.k}`, `набор ${KIND_RU[kind]}: ${w.t}`);
  if (!ops.length) {
    // отложенные после отказа действия — набор не собран, а не готов; проверка без дела — в память для chainWant
    const off = P.ops.filter(o => (s.skip[o.key] || 0) > now).map(o => ({ t: opText(o), until: +s.skip[o.key] }));
    for (const [k, o] of Object.entries(P.P.off)) if (!P.P[k]) off.push({ t: '«' + nameOf(o.x) + '»', until: o.until });   // лучшей вещи отказали, замены нет
    if (s.need) env.rec('B', 'набор', off.length ? `набор ${KIND_RU[kind]} не собран: ${off.map(o => `${o.t} — после отказа игры, повторю после ${hhmm(o.until)}`).join('; ')}` : `набор ${KIND_RU[kind]} готов`);
    const until = Math.min(...off.map(o => o.until), ...Object.values(P.P.off).map(o => o.until));
    s.need = false; s.phase = null; s.idle = { kind, wT: +env.rt.weaponsT || 0, w: slotId(c.inventory?.eq?.l1), until: Number.isFinite(until) ? until : 0 }; save(); later(RECHECK); return false;
  }
  s.idle = null;
  if (!s.phase) { s.phase = { t: now, last: now }; env.rec('B', 'набор', `крафтер: набор ${KIND_RU[kind]} — ${ops.map(opText).join(' → ')}`); }
  s.need = true; save();
  env.setStatus?.(`Набор крафтера: ${KIND_RU[kind]}`);
  return send(ops[0], c, char);
}
// после победы в цепочке «Охотиться дальше»: нужен другой набор — уйти на карту (там шаг переоденет), без своего GET.
// Повод: задача сменилась после последней проверки, проверка нашла несделанное, или (не чаще раза в 10 мин) по памяти вкладки
// надето не то / на фарме висит голем. Последняя проверка нашла, что менять нечего, и сумка/надетое с тех пор не менялись — не уводим.
// Ушли, а шаг так и не проверил (пауза, TvT, запрет) — 10 мин больше не уводим.
function chainWant() {
  const kind = want(), s = S(), now = Date.now();
  if (!kind || (s.skip['kind:' + kind] || 0) > now || s.pend) return false;
  if ((+s.chainT || 0) > (+s.checkT || 0) && now - s.chainT < 10 * 60000) return false;
  let go = s.kind !== kind || !!s.need;
  if (!go && now - (+s.checkT || 0) > 10 * 60000) {
    if (kind === 'farm' && env.petHas?.(GOLEM_KEY) && !((s.skip.dismiss || 0) > now)) go = true;
    const w = env.weaponNow?.(), lvl = +env.heroLevel?.() || 0, I = s.idle;
    const same = !!I && I.kind === kind && I.wT === (+env.rt.weaponsT || 0) && I.w === (+w?.id || 0) && !(I.until && now >= I.until);
    const known = w?.wt && !same ? (env.rt.weapons || []).filter(x => x.where !== 'надето' && lvl >= (env.GRADE_LV?.[x.g || 'NG'] ?? 0)) : [];
    if (kind === 'farm' && w?.wt && w.wt !== 'древковое' && known.some(x => x.wt === 'древковое')) go = true;
    if (kind === 'rb' && w?.wt && !isMace({ ...w, k: 'W' }) && known.some(x => isMace({ ...x, k: 'W' }))) go = true;
  }
  if (go) { s.chainT = now; save(); env.rec('B', 'набор', `крафтер: после этого моба — на карту сменить набор на ${KIND_RU[kind]}`); }
  return go;
}
// закупка (economy.shopPlan): в туре РБ держим запас кристаллов голему (по его рангу) — поверх нужды Маммона в том же кристалле.
// Прошлая закупка не смогла его купить (сумка полна, нет в магазине) — час не добавляем: строка сама гоняла бы бота в магазин
function shopRows(list) {
  if (!Array.isArray(list) || want() !== 'rb') return list;
  const id = +S().golem?.id || 0, key = 'mm' + id;
  if (!id) return list;
  const f = env.rt.shopFail;
  if (Array.isArray(f?.keys) && f.keys.includes(key) && Date.now() - (+f.t || 0) < SHOP_BACKOFF) return list;
  const i = list.findIndex(r => r.key === key);
  let base = i >= 0 ? +list[i].mm?.[1] || 0 : 0;
  if (i < 0) { const g = env.mmNeed?.(id); if (g && +g.need > 0 && +g.have >= +g.need) base = +g.need; }   // цель Маммона уже собрана — её кристаллы голему не отдаём
  const mm = [base + CRYSTAL_KEEP[0], base + CRYSTAL_KEEP[1]];
  if (i >= 0) { list[i] = { ...list[i], mm, label: String(list[i].label).replace(/\)$/, ' + голем)') }; return list; }
  const row = env.shopRow?.(id, mm, 'голем'); if (row) list.push(row);
  return list;
}
function text() {
  if (env.role?.() !== 'crafter') return '';
  if (env.cfg.crafterKit === false) return 'Набор крафтера выключен: бот оружие и голема крафтера не трогает';
  const k = want();
  return k ? `Набор крафтера сейчас: ${KIND_RU[k]}` : 'Набор крафтера: в этой задаче не меняю (только тур РБ/эпики и фарм/катакомбы)';
}
return { want, holds, noSummon, pick, plan, step, chainWant, shopRows, text, token, reset() { mem = {}; save(); } };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
