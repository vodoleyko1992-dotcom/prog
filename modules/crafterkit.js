/* L2wap 20.43 (John 21.10 12:48: «Крафтом на Рб буду ходить с булавой и щитом, а фарм с пикой»; 13:05 голем «Только на РБ»;
   13:13 «на фарм и в каты с пикой»; 13:44 «Весь тур — набор РБ»): набор крафтера (Artisan/Warsmith/Maestro).
   РБ — тур РБ (вместе с его паузами на мобах, «одним РБ» и РБ-сессией) и эпики: одноручная дубина + щит + голем
   (Summon Mechanic Golem l2_25: вне боя POST /character/skills/cast {battleId, expectedRevision}, Crystal C на призыв и содержание).
   Фарм — автофарм, фарм на месте, катакомбы, кампания, «Только задачи» с целью фарма: пика (древковое), щит снят, голем отозван
   (−15 % EXP; POST /character/companion/dismiss {expectedRevision, characterId} — как кнопка «Відкликати слугу» в окне слуги).
   Рыбалка, TvT, заточка, задачи без фарма — набор не трогаем. Выключатель — cfg.crafterKit (по умолчанию ВКЛ).
   Вещи — сильнейшие из сумки GET /character, которые разрешает уровень (грейд). Клановые, с Life Stone и неизвестные вещи бот сам
   не выбирает, но надетые подходящего типа не снимает. Надетое подходящего типа не хуже лучшего — не трогаем.
   Одно действие за шаг (снять щит / надеть / отозвать / призвать), ответ игры (character) — новое состояние, 409 — перечитать.
   Отказ игры — это действие пропускается 30 мин. Неизвестный исход призыва (тратит кристаллы и MP) — сверка, повтор того же запроса
   с прежней revision (из двух сервер примет один, как в крафте). Фаза ≤ 2 мин: не уложились — набор ждёт 10 мин, задача идёт как есть. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.crafterkit = function create_crafterkit(env) {
const GOLEM = 'l2_25', GOLEM_KEY = /mechanic_golem/i, CRYSTAL_C = 1459, CRYSTAL_MIN = 10, MP_NEED = 150;
const RECHECK = 60000, BUSY = 800, FAIL_SKIP = 30 * 60000, PHASE_MS = 2 * 60000, PHASE_SKIP = 10 * 60000, PEND_WAIT = 15000, NOTE_EVERY = 10 * 60000;
const GR = { NG: 0, D: 1, C: 2, B: 3, A: 4, S: 5 }, KIND_RU = { rb: 'РБ (булава + щит + голем)', farm: 'фарм (пика, без голема)' };
// Паузы, отказы и неизвестный призыв — в sessionStorage вкладки: фабрика создаётся заново на каждой странице игры
const SS = 'l2bot-kit';
let mem = (() => { try { return JSON.parse(root.sessionStorage?.getItem(SS) || 'null') || {}; } catch (e) { return {}; } })();
const S = () => { const c = env.rt.char || ''; if (mem.char !== c) mem = { char: c, nextT: 0, kind: '', need: false, fails: {}, phase: null, skip: {}, pend: null, noteKey: '', noteT: 0 }; mem.fails ||= {}; mem.skip ||= {}; return mem; };
const save = () => { try { root.sessionStorage?.setItem(SS, JSON.stringify(mem)); } catch (e) {} };
const note = (key, txt) => { const s = S(), now = Date.now(); if (key === s.noteKey && now - s.noteT < NOTE_EVERY) return; s.noteKey = key; s.noteT = now; save(); env.rec('B', 'набор', txt); };

const holds = () => env.cfg.crafterKit !== false && env.role?.() === 'crafter';
// какой набор нужен сейчас: 'rb' | 'farm' | null (не трогаем)
function want() {
  if (!holds()) return null;
  const m = env.mode?.();
  if (m === 'raid' || m === 'epic') return 'rb';
  if (m === 'farm' || m === 'cat' || m === 'campaign' || m === 'tasks' && env.lootGoal?.()) return 'farm';
  return null;
}
// голем — только на РБ: в бою на фарме combat не призывает его (крафтер с выключенным набором — как раньше)
const noSummon = () => holds() && want() !== 'rb';

const isMace = it => it?.wt === 'дубина' && !it.two, isPike = it => it?.wt === 'древковое', isShield = it => it?.wt === '—';
const slotId = v => +(v && typeof v === 'object' ? v.itemId : v) || 0;
const golemOf = c => { const s = c?.activeSummon; return s && GOLEM_KEY.test(String(s.key || '')) ? s : null; };
const crystals = c => (c?.inventory?.stacks || []).reduce((n, x) => n + (+x?.itemId === CRYSTAL_C ? +x.qty || 0 : 0), 0);
function rows(c) {
  const eq = c?.inventory?.eq || {}, out = [], row = (v, where) => {
    const id = slotId(v); if (!id || where === 'bag' && !(+v.qty > 0)) return;
    const o = v && typeof v === 'object' ? v : {};
    out.push({ id, ench: +o.enchant || 0, pb: +o.enchantPAtkBonus || 0, mb: +o.enchantMAtkBonus || 0, it: env.itemOf?.(id) || null, where, raw: o });
  };
  row(eq.l1, 'l1'); row(eq.l2, 'l2');
  for (const s of c?.inventory?.stacks || []) row(s, 'bag');
  return out;
}
// бот выбирает только обычные вещи из справочника: у клановых, с Life Stone и «перерождённых» свой токен экземпляра
const plain = x => x.it?.k === 'W' && !x.raw.clanWeaponUid && !x.raw.clanShieldUid && !x.raw.augmentation && !(+x.raw.rebirthWeaponAttack > 0);
const atk = x => (+x.it?.pa || 0) + x.pb;
function pick(kind, c) {
  const lvl = +c?.level || +env.heroLevel?.() || 0, all = rows(c), gl = env.GRADE_LV || {};
  const okLvl = x => lvl >= (gl[x.it?.g || 'NG'] ?? 0);
  const best = (f, score) => all.filter(x => x.where === 'bag' && plain(x) && okLvl(x) && f(x.it)).sort((a, b) => score(b) - score(a))[0] || null;
  const type = kind === 'rb' ? isMace : isPike, worn = all.find(x => x.where === 'l1'), wornShield = all.find(x => x.where === 'l2');
  let weapon = best(type, atk);
  if (worn?.it && type(worn.it) && (!weapon || atk(worn) >= atk(weapon))) weapon = worn;
  let shield = null;
  if (kind === 'rb') shield = wornShield?.it && isShield(wornShield.it) ? wornShield : best(isShield, x => (GR[x.it.g] || 0) * 1e9 + (+x.it.pr || 0));
  return { weapon, shield, lvl };
}
const nameOf = x => x?.it?.n || '#' + (x?.id || '?');
// токен экземпляра как у страницы /char.html: bag:<id>:<заточка>, у заточенного оружия ещё :<P-бонус>:<M-бонус> (Yaksa +4: bag:2503:4:16:0)
const token = x => x.raw.targetInstanceId || `bag:${x.id}:${x.ench}` + (x.pb || x.mb ? `:${x.pb}:${x.mb}` : '');
function equipBody(x) {
  const b = { action: 'equip', itemId: x.id, enchant: x.ench, targetInstanceId: token(x) };
  if (!isShield(x.it)) { b.enchantPAtkBonus = x.pb; b.enchantMAtkBonus = x.mb; }
  return b;
}
// план на этот снимок героя: список действий по порядку, первое выполняем; why — что сделать нельзя (в журнал)
function plan(kind, c) {
  const P = pick(kind, c), eq = c?.inventory?.eq || {}, ops = [], why = [], g = golemOf(c);
  const wornIt = env.itemOf?.(slotId(eq.l1));
  if (kind === 'farm') {
    if (g) ops.push({ op: 'dismiss', key: 'dismiss' });
    if (!P.weapon) why.push('пики в сумке нет (или не по уровню) — оружие не меняю');
    else if (P.weapon.where === 'bag') {
      if (slotId(eq.l2)) ops.push({ op: 'unequip', slot: 'l2', key: 'unequip:l2' });   // пика двуручная — щит снимаем сами, не надеясь на игру
      else ops.push({ op: 'equip', x: P.weapon, key: 'equip:' + P.weapon.id });
    }
    return { ops, why, P };
  }
  if (!P.weapon) why.push('одноручной дубины в сумке нет (или не по уровню) — оружие не меняю');
  else if (P.weapon.where === 'bag') ops.push({ op: 'equip', x: P.weapon, key: 'equip:' + P.weapon.id });
  const oneHand = P.weapon ? true : !!wornIt && wornIt.k === 'W' && !wornIt.two && wornIt.wt !== '—';
  if (!P.shield) why.push('щита в сумке нет (или не по уровню)');
  else if (P.shield.where === 'bag' && oneHand) ops.push({ op: 'equip', x: P.shield, key: 'equip:' + P.shield.id });
  if (!g || !(+g.hp > 0)) {
    if (crystals(c) < CRYSTAL_MIN) why.push(`для голема нужен Crystal C (есть ${crystals(c)}, нужно от ${CRYSTAL_MIN}) — иду без голема, докупит закупка`);
    else ops.push({ op: 'summon', key: 'summon' });
  }
  return { ops, why, P };
}
async function readChar() {
  try { const r = await env.gameGet('/character'); if (!r?.ok) return { err: r?.status || 'сеть' }; const j = await r.json().catch(() => null); return { c: j?.character || j }; }
  catch (e) { return { err: e?.name === 'AbortError' ? 'нет ответа' : e?.message || 'сеть' }; }
}
const NOT_SENT = /^(?:bot_inactive|action_cancelled|pvp_defeat_pending|payment_unconfirmed|lifestone_session_active)$/;
const later = ms => { S().nextT = Date.now() + ms; save(); };
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
// неизвестный призыв: голем появился — готово; та же revision — повтор того же запроса с прежней revision; ушла вперёд — не прошёл
async function reconcile(char) {
  const s = S(), p = s.pend;
  if (Date.now() - p.t < PEND_WAIT) { s.nextT = p.t + PEND_WAIT; save(); return true; }
  const R = await readChar(), c = R.c;
  if (env.rt.char !== char || !env.on || S().pend !== p) return false;
  if (!c?.revision || c.name !== char) { later(30000); note('pend', `голем: сверка призыва — герой не прочитан (${R.err || 'нет revision'}), новый призыв не шлю`); return true; }
  if (golemOf(c)) { s.pend = null; delete s.fails.summon; save(); env.petNote?.(c); env.rec('B', 'набор', 'голем: призыв подтверждён сверкой'); later(BUSY); return true; }
  if (c.revision !== p.rev) { s.pend = null; failed('summon', 'голем: призыв не прошёл (revision героя ушла вперёд, голема нет)'); later(BUSY); return true; }
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
    failed(o.key, `${what}: обрыв (${e?.name === 'AbortError' ? 'нет ответа' : e?.message || e})`); later(5000); return true;
  }
  if (env.rt.char !== char) return false;
  if (r.status === 409) { if (o.op === 'summon' && s.pend) { s.pend = { ...s.pend, t: Date.now() - PEND_WAIT }; save(); } later(BUSY); return true; }
  if (r.status >= 500) {
    if (o.op === 'summon') return pendSet(rev, `HTTP ${r.status} на призыв`);
    failed(o.key, `${what}: HTTP ${r.status}`); later(5000); return true;
  }
  if (o.op === 'summon') s.pend = null;
  if (!r.ok) {
    const msg = j?.messageRu || j?.messageUk || j?.error || `HTTP ${r.status}`;
    s.skip[o.key] = Date.now() + FAIL_SKIP; save(); later(BUSY);
    note('fail:' + o.key, `${what}: игра отказала — ${msg}; это действие пропускаю 30 мин`); return true;
  }
  delete s.fails[o.key]; save();
  const ch = j?.character;
  if (o.op === 'equip' && !isShield(o.x.it)) await env.equipNote?.(body);   // как ответ на клик игры: оружие, грейд зарядов, тип для спойла
  if ((o.op === 'summon' || o.op === 'dismiss') && ch) env.petNote?.(ch);
  env.rec('B', 'набор', `${what} — готово${o.op === 'summon' && ch && !golemOf(ch) ? ' (голема в ответе нет — проверю)' : ''}`);
  // ответ годится вместо GET, только если в нём сумка, надетое и слуга (иначе план по нему мог бы призвать второго голема)
  mem.last = ch && ch.name === char && ch.revision && ch.inventory?.eq && Array.isArray(ch.inventory.stacks) && 'activeSummon' in ch ? { c: ch, t: Date.now() } : null; save();
  later(BUSY); return true;
}
// шаг главного цикла (вне боя, до задач): true — набор занят (цикл ждёт), false — работать дальше
async function step() {
  const kind = want(), s = S(), now = Date.now();
  if (!kind) { if (s.kind || s.need) { s.kind = ''; s.need = false; s.phase = null; save(); } return false; }
  if (!env.on || !env.tabOwner || env.isBattle?.() || env.busy?.() || env.canAct?.() === false || env.gearBusy?.()) return false;
  if (s.kind !== kind) { s.kind = kind; s.need = false; s.phase = null; s.nextT = 0; mem.last = null; save(); }
  if ((s.skip['kind:' + kind] || 0) > now) return false;
  if (now < (+s.nextT || 0)) return !!s.need;
  const char = env.rt.char;
  if (s.pend) return reconcile(char);
  // свежий ответ своего действия (≤ 3 с) заменяет GET; иначе — перечитать героя
  let c = mem.last && now - mem.last.t < 3000 ? mem.last.c : null;
  if (!c) { const R = await readChar(); if (env.rt.char !== char || !env.on) return false; c = R.c;
    if (!c?.revision) { later(RECHECK); note('get', `не прочитан герой (${R.err || 'нет revision'}) — повторю через минуту`); return false; } }
  mem.last = null;
  if (c.name !== char || !/\b(?:artisan|warsmith|maestro)\b/i.test(String(c.l2Profession || '').replace(/_/g, ' '))) { later(RECHECK); s.need = false; save(); return false; }
  if (c.inBattle === true) { later(5000); return false; }
  const db = await env.itemsDb?.();
  if (env.rt.char !== char || !env.on) return false;
  if (!db) { later(30000); return false; }   // справочник предметов не загрузился — без него типы оружия не узнать
  const P = plan(kind, c), ops = P.ops.filter(o => !((s.skip[o.key] || 0) > now));
  s.checkT = now;
  if (P.why.length) note('why:' + kind + P.why.join(), `набор ${KIND_RU[kind]}: ${P.why.join('; ')}`);
  if (!ops.length) {
    if (s.need) env.rec('B', 'набор', `набор ${KIND_RU[kind]} готов`);
    s.need = false; s.phase = null; save(); later(RECHECK); return false;
  }
  if (!s.phase) { s.phase = { t: now }; env.rec('B', 'набор', `крафтер: набор ${KIND_RU[kind]} — ${ops.map(o => o.op === 'equip' ? '«' + nameOf(o.x) + '»' : o.op === 'unequip' ? 'снять щит' : o.op === 'dismiss' ? 'отозвать голема' : 'призвать голема').join(' → ')}`); }
  else if (now - s.phase.t > PHASE_MS) {
    s.skip['kind:' + kind] = now + PHASE_SKIP; s.need = false; s.phase = null; save();
    env.rec('B', 'набор', `набор ${KIND_RU[kind]} не собрался за 2 мин — задача идёт как есть, снова попробую через 10 мин`); return false;
  }
  s.need = true; save();
  env.setStatus?.(`Набор крафтера: ${KIND_RU[kind]}`);
  return send(ops[0], c, char);
}
// после победы в цепочке «Охотиться дальше»: нужен другой набор — уйти на карту (там шаг переоденет), без своего GET.
// Повод: задача сменилась после последней проверки, проверка нашла несделанное, или (не чаще раза в 10 мин) по памяти вкладки
// надето не то / на фарме висит голем. Ушли, а шаг так и не проверил (пауза, TvT, запрет) — 10 мин больше не уводим.
function chainWant() {
  const kind = want(), s = S(), now = Date.now();
  if (!kind || (s.skip['kind:' + kind] || 0) > now || s.pend) return false;
  if ((+s.chainT || 0) > (+s.checkT || 0) && now - s.chainT < 10 * 60000) return false;
  let go = s.kind !== kind || !!s.need;
  if (!go && now - (+s.checkT || 0) > 10 * 60000) {
    if (kind === 'farm' && env.petHas?.(GOLEM_KEY) && !((s.skip.dismiss || 0) > now)) go = true;
    const w = env.weaponNow?.(), lvl = +env.heroLevel?.() || 0;
    const known = w?.wt ? (env.rt.weapons || []).filter(x => x.where !== 'надето' && lvl >= (env.GRADE_LV?.[x.g || 'NG'] ?? 0)) : [];
    if (kind === 'farm' && w?.wt && w.wt !== 'древковое' && known.some(x => x.wt === 'древковое')) go = true;
    if (kind === 'rb' && w?.wt && !(w.wt === 'дубина' && !w.two) && known.some(x => x.wt === 'дубина' && !x.two)) go = true;
  }
  if (go) { s.chainT = now; save(); env.rec('B', 'набор', `крафтер: после этого моба — на карту сменить набор на ${KIND_RU[kind]}`); }
  return go;
}
// закупка (economy.shopPlan): в туре РБ держим запас Crystal C голему — поверх нужды Маммона в том же кристалле
const CRYSTAL_KEEP = [30, 100];
function shopRows(list) {
  if (!Array.isArray(list) || want() !== 'rb') return list;
  const i = list.findIndex(r => r.key === 'mm' + CRYSTAL_C), base = i >= 0 ? +list[i].mm?.[1] || 0 : 0, mm = [base + CRYSTAL_KEEP[0], base + CRYSTAL_KEEP[1]];
  if (i >= 0) { list[i] = { ...list[i], mm, label: String(list[i].label).replace(/\)$/, ' + голем)') }; return list; }
  const row = env.shopRow?.(CRYSTAL_C, mm, 'голем'); if (row) list.push(row);
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
