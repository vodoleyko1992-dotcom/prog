/* L2wap 9.0: сюжетные квесты сабкласса (Fate's Whisper / Mimir's Elixir) и Noblesse (Possessor of a Precious Soul) + смена класса.
   Прогресс — из ответов игры (страницы карты и квестов сами опрашивают /game/story-quests/*) и своим GET раз в 10 мин.
   Бот сам только СДАЁТ готовую часть у NPC (кнопка «Завершити частину» / «Завершити квест», телепорт к NPC за адену в пределах лимита).
   Взять квест, выбрать или переключить сабкласс — только игрок (kb/quest-noblesse.md). FA и Coin of Luck не тратятся. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.story = function create_story(env) {
const location = env.routeLocation || root.location;
// 9.0 (новости игры 11.10, API 11.10 14:30): POST <root>/<accept|advance|complete|teleport> {expectedRevision, targetId} — жмём кнопки страницы,
// как игрок; ★ квестовых мобов на карте игра ставит сама (map-profession-quest-markers.js опрашивает и noblesse, и subclass)
const Q = {
  noblesse: { root: '/game/story-quests/noblesse', page: '/noblesse-quest.html', act: 'noblesse', name: 'Noblesse', done: 'advance' },
  subclass: { root: '/game/story-quests/subclass', page: '/subclass-quest.html', act: 'subclass', name: 'сабкласс', done: 'complete' },
};
const POLL = 10 * 60000, JOB_MAX = 4 * 60000, RETRY = 30 * 60000;
// 9.0: всё, что зависит от класса (скиллы и их замеры, кот, дебаффы, EXP/ч зон, вердикты РБ «по силам») — у каждого класса своё.
// При переключении класса эти ключи памяти уходят в rt.classStash[<старый класс>] и возвращаются из stash нового (или пустые)
const CLASS_KEYS = ['skills', 'skillDb', 'petStat', 'petAdvice', 'petLast', 'petBuffAt', 'petResummon', 'debuffStat', 'debuffGain', 'debuffEvidence', 'critStat', 'debuffImmune',
  'zoneStat', 'mobVal', 'rbDb', 'rbK', 'rbDpsSample', 'rbDps', 'rbDpsContext', 'rbDpsOwner', 'rbLossK', 'rbLossKOwner', 'rbGapK',   // 20.41: общий ДПС/потери по РБ — свои у класса
  'hardMobs', 'profQuest', 'fightMem', 'fightLast', 'fightGroups', 'packLab'];   // 20.10: сравнение пачек тоже принадлежит классу
// 10.0 (аудит ядра): метка опроса — в sessionStorage, иначе 2 GET на каждой загрузке страницы (как Маммон в 9.2.2)
const ssNum = k => { try { return +sessionStorage.getItem(k) || 0; } catch (e) { return 0; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, String(v)); } catch (e) {} };
const pollKey = () => 'l2bot-storyPollT@' + (env.rt.char || '');
let pollChar = env.rt.char, pollT = ssNum(pollKey());
const token = () => ({ char: env.rt.char, kick: +env.rt.manualKickAt || 0 });
const same = T => env.rt.char === T.char && (+env.rt.manualKickAt || 0) === T.kick;
const active = T => same(T) && env.on !== false && env.tabOwner !== false;
const sameJob = J => !!J && !!env.rt.storyJob && env.rt.storyJob?.key === J.key && env.rt.storyJob?.t === J.t && (J.char == null || J.char === env.rt.char) && (J.kick == null || J.kick === (+env.rt.manualKickAt || 0));
const withinBudget = price => { const max = Number(env.cfg.storyTpMax ?? 100000); return Number.isFinite(max) && max >= 0 && price <= max; };
const fmtA = n => Math.round(+n || 0).toLocaleString('ru');
const low = s => String(s || '').trim().toLowerCase();
// ответ игры → короткая запись rt.story[kind]
function norm(kind, q) {
  if (!q || typeof q !== 'object') return null;
  if (kind === 'noblesse') {
    const tg = (Array.isArray(q.targets) ? q.targets : []).filter(t => t?.name).map(t => ({ name: String(t.name), lvl: +t.level || 0, have: +t.have || 0, need: +t.need || 0, tp: t.teleportId || '' }));
    // 14.10 (полный аудит, noblesse-quest.js): canAdvance включает близость NPC. Готовую часть надо сначала отвезти к нему;
    // на основном/слабом сабе не едем. Пустой список нормален только у финальной беседы (часть 4).
    const readyAway = +q.part > 0 && !q.completed && q.subclassLevel != null && +q.subclassLevel >= (+q.minLevel || 50)
      && (tg.length > 0 || +q.part === 4) && tg.every(t => t.need > 0 && t.have >= t.need);
    return { part: +q.part || 0, of: +q.totalParts || 4, active: !!q.active || +q.part > 0, completed: !!q.completed, sub: q.subclassLevel ?? null, min: +q.minLevel || 0,
      targets: tg, ready: !!q.actions?.canAdvance || readyAway, canAccept: !!q.actions?.canAccept, atNpc: !!q.atNpc, npc: q.npc?.name || '', npcTp: q.npc?.teleportId || '' };
  }
  const bosses = (Array.isArray(q.bosses) ? q.bosses : []).filter(b => b?.spawnId).map(b => ({ id: String(b.spawnId), name: String(b.name || b.spawnId), lvl: +b.level || 0, done: !!b.done }));
  const st = String(q.stage || ''), ret = st === 'return_to_ladd';
  return { stage: st, active: !!st && st !== 'not_started', completed: !!q.completed || st === 'completed', min: +q.minLevel || 0, bosses,
    ready: !!q.actions?.canComplete || ret, canAccept: !!q.actions?.canAccept, atNpc: ret ? !!q.location?.atLadd : !!q.location?.atReorin,
    npc: ret ? q.npc?.ladd?.name || 'Magister Ladd' : q.npc?.reorin?.name || 'Maestro Reorin', npcTp: (ret ? q.npc?.ladd?.teleportId : q.npc?.reorin?.teleportId) || '' };
}
const sigOf = s => JSON.stringify([s.part, s.stage, s.completed, s.ready, s.canAccept, s.atNpc, (s.targets || []).map(t => `${t.name}:${t.have}/${t.need}`), (s.bosses || []).map(b => b.id + (b.done ? '+' : ''))]);
const line = (kind, s) => kind === 'noblesse'
  ? (s.completed ? 'квест Noblesse пройден 👑' : !s.active ? `не взят${s.canAccept ? ' (можно взять у Virgil в Rune)' : ''}` : `часть ${s.part}/${s.of}: ${s.targets.map(t => `${t.name} ${t.have}/${t.need}`).join(', ') || 'поговорить с ' + s.npc}${s.ready ? ' — готово, сдать ' + s.npc : ''}`)
  : (s.completed ? 'квест сабкласса пройден — выбери класс в «Персонаж → Сабклассы»' : !s.active ? `не взят${s.canAccept ? ' (можно взять у Maestro Reorin)' : ` (нужен ${s.min || 75} ур.)`}`
    : s.stage === 'hunt_bosses' ? `РБ: ${s.bosses.map(b => `${b.done ? '✓' : '★'} ${b.name} ${b.lvl}`).join(', ')}` : `вернуться к ${s.npc}${s.ready ? ' — готово' : ''}`);
// ★-цели квеста (имена в нижнем регистре): ★ на карте снимать нельзя, пока квест их ждёт
function openNames() {
  const n = env.rt.story?.noblesse;
  return n?.active && !n.completed ? n.targets.filter(t => t.have < t.need).map(t => low(t.name)) : [];
}
// РБ квестов (spawnId), которые ещё нужны: 4 босса сабкласса и РБ части Noblesse (имя → rbList)
function rbIds() {
  const S = env.rt.story || {}, out = new Set();
  if (S.subclass?.stage === 'hunt_bosses') for (const b of S.subclass.bosses) if (!b.done) out.add(b.id);
  const names = openNames();
  if (names.length) for (const [id, x] of Object.entries(env.rt.rbList || {})) if (names.includes(low(x.name))) out.add(id);
  return [...out];
}
function qNote(kind, q) {
  if (!Q[kind]) return null;
  const s = norm(kind, q);
  if (!s) return null;
  const now = Date.now(), prev = env.rt.story?.[kind], sig = sigOf(s);
  if (prev?.sig === sig && now - (prev.t || 0) < POLL) return s;   // игра опрашивает часто — пишем при изменении или раз в 10 мин
  env.setRt({ story: { ...(env.rt.story || {}), [kind]: { ...s, sig, t: now } } });
  if (prev?.sig !== sig) env.rec('B', 'квест', `${Q[kind].name}: ${line(kind, s)}`);
  return s;
}
// /character: свой Noblesse (скилл 1323 на всех классах) и активный класс
function charNote(ch) {
  if (!ch || typeof ch !== 'object' || ch.name && env.rt.char && low(ch.name) !== low(env.rt.char)) return;
  if ('noblesse' in ch && !!ch.noblesse !== !!env.rt.story?.nobleOwn) {
    env.setRt({ story: { ...(env.rt.story || {}), nobleOwn: !!ch.noblesse } });
    if (ch.noblesse) env.rec('B', 'квест', 'статус Noblesse получен 👑: Noblesse Blessing (1323) свой — за FA больше не покупаю; поставь его на панель боя, бот будет держать его как бафф');
  }
  // 9.2: ветка класса (mystic/fighter) — профиль боя незнакомой профессии (content.combatProfileKind)
  if (ch.classBranch && String(ch.classBranch) !== env.rt.classBranch) env.setRt({ classBranch: String(ch.classBranch).slice(0, 20) });
  const cs = ch.classSlots, slot = cs && Number.isFinite(+cs.activeSlot) ? +cs.activeSlot : null;
  const prof = ch.l2Profession || (slot != null && cs.slots?.find?.(x => +x?.slot === slot)?.profession) || '';
  const slotProfs = Array.isArray(cs?.slots) ? cs.slots.map(x => x?.profession).filter(Boolean).map(String) : null;
  if (prof) classNote(String(prof), slot, +ch.level || 0, slotProfs);
}
const profName = p => String(p || '?').replace(/^(human|elf|dark_elf|orc|dwarf)_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
// 20.43 (лог 21.10 22:01–22:03: John повысил Bounty Hunter → Fortune Seeker в слоте 1): память класса ключуется профессией, и повышение
// в том же слоте считалось сменой класса — замеры BH (358 КБ) ушли в classStash[dwarf_bounty_hunter] навсегда (вниз профессия не
// меняется), Fortune Seeker начал с нуля; так же лежал human_warlock после Warlock → Arcana Lord. Повышение узнаём по дереву профессий
// Interlude («профессия:предыдущая», имя без расы и разделителей): память класса остаётся. Другая ветка/раса — смена класса, как раньше
const PROF_TREE = {
  human: 'warrior:fighter knight:fighter rogue:fighter gladiator:warrior warlord:warrior paladin:knight darkavenger:knight treasurehunter:rogue hawkeye:rogue duelist:gladiator '
    + 'dreadnought:warlord phoenixknight:paladin hellknight:darkavenger adventurer:treasurehunter sagittarius:hawkeye wizard:mystic cleric:mystic sorcerer:wizard '
    + 'necromancer:wizard warlock:wizard bishop:cleric prophet:cleric archmage:sorcerer soultaker:necromancer arcanalord:warlock cardinal:bishop hierophant:prophet',
  elf: 'knight:fighter scout:fighter templeknight:knight swordsinger:knight plainswalker:scout silverranger:scout evatemplar:templeknight swordmuse:swordsinger '
    + 'windrider:plainswalker moonlightsentinel:silverranger wizard:mystic oracle:mystic spellsinger:wizard elementalsummoner:wizard elder:oracle mysticmuse:spellsinger '
    + 'elementalmaster:elementalsummoner evasaint:elder',
  dark_elf: 'palusknight:fighter assassin:fighter shillienknight:palusknight bladedancer:palusknight abysswalker:assassin phantomranger:assassin shillientemplar:shillienknight '
    + 'spectraldancer:bladedancer ghosthunter:abysswalker ghostsentinel:phantomranger wizard:mystic shillienoracle:mystic spellhowler:wizard phantomsummoner:wizard '
    + 'shillienelder:shillienoracle stormscreamer:spellhowler spectralmaster:phantomsummoner shilliensaint:shillienelder',
  orc: 'raider:fighter monk:fighter destroyer:raider tyrant:monk titan:destroyer grandkhavatari:tyrant shaman:mystic overlord:shaman warcryer:shaman dominator:overlord doomcryer:warcryer',
  dwarf: 'scavenger:fighter artisan:fighter bountyhunter:scavenger warsmith:artisan fortuneseeker:bountyhunter maestro:warsmith',
};
const PROF_UP = Object.fromEntries(Object.entries(PROF_TREE).map(([r, s]) => [r, Object.fromEntries(s.split(' ').map(x => x.split(':')))]));
const PROF_NODE = Object.fromEntries(Object.entries(PROF_UP).map(([r, up]) => [r, new Set([...Object.keys(up), ...Object.values(up)])]));
const RACE_ADJ = { elf: /^elven/, dark_elf: /^dark/, orc: /^orc/, dwarf: /^dwar(?:f|ven)/ };
// 'dwarf_fortune_seeker' → { race: 'dwarf', n: 'fortuneseeker' }; «Elven Elder», «Dark Wizard», «Orc Raider», «Eva's Templar», «Mage» — к узлам дерева
function profKey(p) {
  const m = String(p || '').toLowerCase().match(/^(dark_elf|human|elf|orc|dwarf)_(.+)$/); if (!m) return null;
  const race = m[1], node = s => ({ mage: 'mystic', evastemplar: 'evatemplar', evassaint: 'evasaint' })[s] || s;
  let n = node(m[2].replace(/[^a-z]/g, ''));
  if (!PROF_NODE[race].has(n) && RACE_ADJ[race]?.test(n)) n = node(n.replace(RACE_ADJ[race], ''));
  return { race, n };
}
// from — предок to в дереве той же расы: глубина 1…4, иначе 0
function profUp(from, to) {
  const a = profKey(from), b = profKey(to);
  if (!a || !b || a.race !== b.race || a.n === b.n) return 0;
  for (let n = PROF_UP[b.race][b.n], d = 1; n && d <= 4; n = PROF_UP[b.race][n], d++) if (n === a.n) return d;
  return 0;
}
// Память двух профессий одного класса: своё у новой (newer) важнее, из старой — только то, чего у новой нет (словари — по ключам).
// Замер РБ и его владелец — из одного источника; владелец-старая профессия → новая (raid.rbOwnerOk сравнивает с classCur.prof).
// Квест профессии старой — пройден (иначе ★-цели прошлого квеста): не переносим. Память боя — не больше 80 целей (fightlab MEM_MAX)
function memMerge(newer, older, from, to) {
  const n = newer || {}, o = older || {}, out = {};
  for (const k of CLASS_KEYS) {
    const a = n[k], b = k === 'profQuest' ? null : o[k];
    out[k] = a == null ? b ?? null : b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b) ? { ...b, ...a } : a;
  }
  for (const g of [['rbDps', 'rbDpsContext', 'rbDpsOwner'], ['rbLossK', 'rbLossKOwner']]) { const s = n[g[0]] != null || o[g[0]] == null ? n : o; for (const k of g) out[k] = s[k] ?? null; }
  for (const k of ['rbDpsOwner', 'rbLossKOwner']) if (from && out[k] === from) out[k] = to;
  const fm = out.fightMem;
  if (fm && fm !== n.fightMem && typeof fm === 'object' && Object.keys(fm).length > 80)
    out.fightMem = Object.fromEntries(Object.entries(fm).sort((x, y) => (y[1]?.t || 0) - (x[1]?.t || 0)).slice(0, 80));
  return out;
}
const packed = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
// Записи тайника — прежние профессии классов, которые есть сейчас (предки активной или, если слоты известны, профессии слота):
// ближние первыми. Профессия, которая сама стоит в слоте, и запись с двумя возможными наследниками — не трогаем
function deadOf(stash, cur, slots) {
  const heirs = [...new Set([cur, ...(slots || [])].filter(Boolean))], out = [];
  for (const P of Object.keys(stash || {})) {
    if (!stash[P] || typeof stash[P] !== 'object' || P === cur || slots?.includes(P)) continue;
    const qs = heirs.map(Q => [Q, profUp(P, Q)]).filter(x => x[1] > 0);
    if (qs.length === 1) out.push({ P, Q: qs[0][0], d: qs[0][1] });
  }
  return out.sort((x, y) => x.d - y.d);
}
// 20.43: разовая чистка (content.js once classPromo2043) по снимку rt: { stash, active: {ключ класса: значение}, moved: [[старая, новая]] }
// или null. Слоты неизвестны (rt.subSlots нет) — только предки активной профессии
function stashPromote(src) {
  const st = src?.classStash; if (!st || typeof st !== 'object' || Array.isArray(st)) return null;
  const cur = String(src.classCur?.prof || ''), slots = Array.isArray(src.subSlots) && src.subSlots.length ? src.subSlots.map(x => String(x?.prof || '')).filter(Boolean) : null;
  const stash = { ...st }, mine = {}, active = {}, moved = [];
  for (const k of CLASS_KEYS) mine[k] = src[k] ?? null;
  let live = mine;
  for (const { P, Q } of deadOf(st, cur, slots)) {
    if (Q === cur) live = memMerge(live, st[P], P, Q);
    else stash[Q] = { ...(stash[Q] || {}), ...packed(memMerge(stash[Q], st[P], P, Q)), t: Math.max(+stash[Q]?.t || 0, +st[P].t || 0) };
    delete stash[P]; moved.push([P, Q]);
  }
  for (const k of CLASS_KEYS) if (live[k] !== mine[k]) active[k] = live[k];
  return moved.length ? { stash, active, moved } : null;
}
function classNote(prof, slot, lvl, slotProfs) {
  const cur = env.rt.classCur;
  if (cur?.prof === prof) { if (slot != null && cur.slot !== slot) env.setRt({ classCur: { ...cur, slot } }); return false; }
  if (!cur?.prof) { env.setRt({ classCur: { prof, slot, t: Date.now() } }); return false; }   // первый раз — просто запоминаем
  // 20.43: повышение профессии (тот же слот или слот неизвестен) — не смена класса: замеры остаются, квест прошлой профессии пройден
  if (profUp(cur.prof, prof) && (slot == null || cur.slot == null || slot === cur.slot)) {
    const patch = { classCur: { prof, slot: slot ?? cur.slot ?? null, t: Date.now() }, classSwT: Date.now(), faSnap: null, hudLong: {}, profQuest: null };
    for (const k of ['rbDpsOwner', 'rbLossKOwner']) if (env.rt[k] === cur.prof) patch[k] = prof;
    env.setRt(patch);
    env.classSwitched?.();
    env.rec('B', 'класс', `профессия: ${profName(cur.prof)} → ${profName(prof)}${lvl ? ' ' + lvl + ' ур.' : ''} (тот же класс${slot != null ? ', слот ' + slot : ''}) · замеры скиллов, кота, зон и РБ сохранены; новые умения поставь на панель боя`);
    return true;
  }
  const stash = { ...(env.rt.classStash || {}) }, mine = {};
  for (const k of CLASS_KEYS) if (env.rt[k] != null) mine[k] = env.rt[k];
  stash[cur.prof] = { ...mine, t: Date.now() };
  // 20.43: профессию повысили, пока активным был другой класс или бот был выключен: память прежней профессии этого класса — новой
  let back = stash[prof] || {}; const prev = [];
  for (const { P, Q } of deadOf(stash, prof, slotProfs)) if (Q === prof && P !== cur.prof) { back = { ...memMerge(back, stash[P], P, prof), t: Math.max(+back.t || 0, +stash[P].t || 0) }; delete stash[P]; prev.push(profName(P)); }
  const patch = {};
  for (const k of CLASS_KEYS) patch[k] = back[k] ?? null;
  delete stash[prof];
  // баффы сняты и кот отозван сменой класса, а не смертью: снимок платных баффов и «длинные» баффы шапки — заново (не «смерть сняла…»)
  Object.assign(patch, { classStash: stash, classCur: { prof, slot, t: Date.now() }, classSwT: Date.now(), faSnap: null, hudLong: {}, zone: null, zonePend: null });
  env.setRt(patch);
  try { sessionStorage.setItem('l2bot.classSw', String(Date.now())); } catch (e) {}
  env.classSwitched?.();
  env.rec('B', 'класс', `смена класса: ${profName(cur.prof)} → ${profName(prof)}${lvl ? ' ' + lvl + ' ур.' : ''} · баффы сняты, кот отозван (игра) · замеры скиллов, кота, зон и РБ — ${prev.length ? 'прежней профессии (' + prev.join(', ') + ')' : back.t ? 'свои с прошлого раза' : 'с нуля'}; панель боя проверь под этот класс`);
  return true;
}
async function getJson(path) {
  const r = await env.gameGet(path);
  let j = null; try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, j };
}
// фоновый опрос (только GET): прогресс обоих квестов раз в 10 мин
async function storyTick(force) {
  const T0 = token();
  if (pollChar !== env.rt.char) { pollChar = env.rt.char; pollT = ssNum(pollKey()); }
  if (!force && Date.now() - pollT < POLL) return;
  pollT = Date.now(); ssSet(pollKey(), pollT);
  for (const kind of Object.keys(Q)) {
    const S = env.rt.story?.[kind];
    if (!force && S?.completed && Date.now() - (S.t || 0) < 24 * 3600000) continue;   // пройденный — раз в сутки
    // 20.43 (разбор 21.10): сбой сети по-прежнему тихо (повтор через 10 мин), ошибка кода разбора квеста — в журнал
    try { const r = await getJson(Q[kind].root); if (!same(T0)) return; if (r.ok && r.j?.quest) qNote(kind, r.j.quest); } catch (e) { env.quietErr?.('квесты: прогресс', e, true); }
  }
}
// ---- сдача готовой части ----
function want() {
  if (env.cfg.storyTurnIn === false) return null;
  const S = env.rt.story || {}, tried = env.rt.storyTried || {}, now = Date.now();
  for (const kind of Object.keys(Q)) {
    const s = S[kind];
    if (!s?.ready || s.completed) continue;
    const key = `${kind}:${s.part ?? s.stage}`;
    if (now - (tried[key] || 0) < RETRY) continue;
    return { kind, key, why: line(kind, s) };
  }
  return null;
}
async function finish(J, ok, why) {
  const T0 = token();
  if (!active(T0) || !sameJob(J)) return;
  const log = [{ kind: J.kind, ok: !!ok, why: String(why || '').slice(0, 140), t: Date.now() }, ...(env.rt.storyLog || [])].slice(0, 20);
  env.rec('B', 'квест', `${Q[J.kind].name}: ${ok ? '✓' : '✗'} ${why}${J.home ? ' · возвращаюсь на точку' : ''}`);
  const back = J.home && !env.fishNow() ? { zoneGo: { id: J.home, t: Date.now(), why: 'квест сдан: обратно на точку' }, zoneGoT: 0 } : {};
  await env.setRt({ storyJob: null, storyLog: log, ...back });
  if (!active(T0) || env.rt.storyJob) return;
  storyTick(true).catch(() => {});
  if (!back.zoneGo && env.on !== false) { location.href = env.fishNow() ? '/fishing.html' : '/map.html'; await env.sleep(3000); }
}
async function tpPrice(tp) {                      // цена телепорта к точке NPC (с учётом VIP) или null
  const r = await getJson('/game/teleport/locations');
  const x = r.ok && (r.j?.locations || []).find(l => l?.teleportId === tp);
  return x ? +(x.vipFreeApplied ? 0 : x.adenaCost ?? x.baseAdenaCost ?? NaN) : null;
}
let armedPayment = null;
const paymentPending = () => { const p = env.payments?.pending(); return p?.kind === 'story-teleport' ? p : null; };
const ownCharacter = ch => ch?.name === env.rt.char && !!ch.id && Number.isSafeInteger(ch.revision);
function onNet(path, d) {
  const p = paymentPending(), ch = d.res?.character;
  if (!p || p.char !== (env.rt.char || '') || d.paymentId !== p.id || armedPayment !== p.id || path !== Q[p.questKind]?.root + '/teleport' || d.method !== 'POST' ||
      d.req?.targetId !== p.target || !Number.isSafeInteger(d.req?.expectedRevision)) return;
  if (d.status >= 200 && d.status < 300 && !d.error && !d.res?.error && ownCharacter(ch) && String(ch.id) === p.heroId && ch.revision > d.req.expectedRevision)
    env.setRt({ storyTpReceipt: { id: p.id, outcome: 'arrived', revision: ch.revision } });
  // Native UI после первого 409 сама повторяет один запрос с новой revision: это ещё не окончательный отказ.
  else if (d.status >= 400 && d.status < 500 && d.status!==408&&(d.status!==409||d.retryOf>0) && (!ch || ownCharacter(ch) && String(ch.id) === p.heroId) && env.rt.storyTpReceipt?.id !== p.id)
    env.setRt({ storyTpReceipt: { id: p.id, outcome: 'rejected', why: String(d.res?.error || 'HTTP ' + d.status).slice(0,100) } });
}
let reconciling = false, reconcileAt = 0, reconcileId = '';
async function paymentReconcile() {
  const p = paymentPending(); if (!p || reconciling || p.char !== (env.rt.char || '') || env.tabOwner === false) return false;
  const lease = env.leaseEpoch, current = () => paymentPending()?.id === p.id && p.char === (env.rt.char || '') && env.tabOwner !== false && env.leaseEpoch === lease;
  reconciling = true;
  try {
    let receipt = env.rt.storyTpReceipt?.id === p.id ? env.rt.storyTpReceipt : null;
    if (!receipt) {
      if (reconcileId === p.id && Date.now() - reconcileAt < 5000) return false;
      reconcileId = p.id; reconcileAt = Date.now();
      const r = await getJson(Q[p.questKind].root), ch = r.j?.character, q = norm(p.questKind, r.j?.quest);
      if (!current() || !r.ok || !ownCharacter(ch) || String(ch.id) !== p.heroId || ch.revision <= p.revision || !q) return false;
      const key = `${p.questKind}:${q.part ?? q.stage}`;
      if (q.completed || q.atNpc && q.npcTp === p.target && key === p.jobKey) receipt = { outcome: 'arrived', revision: ch.revision };
    }
    if (!receipt || !current()) return false;
    const J = env.rt.storyJob;
    if (J?.t === p.jobT && J.key === p.jobKey && env.payments.matchesContext(p)) {
      const w = await env.setRt({ storyJob: receipt.outcome === 'arrived' ? { ...J, tpT: Date.now(), tpId: p.target } : null });
      if (!current() || w?.ok !== true || await env.rtCommit() !== true || !current()) return false;
    }
    return env.payments.confirm(p, { kind: receipt.outcome === 'arrived' ? 'npc-arrival' : 'server-rejected', revision: receipt.revision, why: receipt.why });
  } finally { reconciling = false; }
}
async function teleport(J, tp, target, price, allowed) {
  if (!env.payments) { env.setStatus('Квест: защита оплаты недоступна'); return false; }
  const r = await getJson('/character'), ch = r.j?.character || r.j;
  if (!allowed() || env.cfg.storyTurnIn === false || !withinBudget(price) || !r.ok || !ownCharacter(ch)) return false;
  const p = await env.payments.prepare({ kind: 'story-teleport', key: 'story:' + J.key + ':' + target, questKind: J.kind, target,
    jobKey: J.key, jobT: J.t, heroId: String(ch.id), revision: ch.revision, quote: { amount: price, currency: 'Adena' } });
  if (!p) return false;
  if (!allowed() || env.cfg.storyTurnIn === false || !withinBudget(price) || tp.disabled || !env.payments.sent(p)) { await env.payments.cancel(p); if (allowed() && env.cfg.storyTurnIn === false) await cancel(J); return false; }
  // durable prepare завершён; одноразовый permit и native click идут без await.
  armedPayment = p.id;
  if (env.fire(tp) === false) { await env.payments.cancel(p, { notSent: true }); return false; }
  await env.waitX(() => env.rt.storyTpReceipt?.id === p.id || !allowed(), 8000, 200);
  const ok = await paymentReconcile();
  if (!ok && allowed()) env.setStatus('Квест: исход телепорта неизвестен — проверяю NPC, повторная оплата запрещена');
  return ok;
}
async function cancel(J) {
  if (!sameJob(J)) return;
  const tried = { ...(env.rt.storyTried || {}) }; delete tried[J.key];
  env.rec('B', 'квест', `${Q[J.kind].name}: поход отменён — автосдача выключена`);
  await env.setRt({ storyJob: null, storyTried: tried });
}
async function step(J) {
  const T0 = token(), allowed = () => active(T0) && sameJob(J);
  if (!allowed()) return;
  if (paymentPending()) { await paymentReconcile(); return; }
  if (env.cfg.storyTurnIn === false) return cancel(J);
  const P = Q[J.kind];
  if (location.pathname !== P.page) { env.setStatus(`Квест ${P.name}: иду сдавать часть`); location.href = P.page; await env.sleep(4000); return; }
  const box = await env.waitX(() => { const a = env.$q(`#${P.act}-quest-actions`); return a && a.children.length ? a : null; }, 10000, 200);
  if (!allowed()) return;              // 14.10: остановили бота, пока страница загружала кнопки.
  if (env.cfg.storyTurnIn === false) return cancel(J);
  const err = () => (env.$q(`#${P.act}-quest-err`)?.textContent || '').trim();
  if (!box) return finish(J, false, err() || 'кнопок квеста нет (страница не загрузилась или часть уже сдана)');
  const btn = a => box.querySelector(`[data-${P.act}-action="${a}"]`);
  const done = btn(P.done);
  if (done) {
    env.fire(done);
    await env.waitX(() => !btn(P.done) || err() || null, 8000, 200);
    if (!allowed()) return;
    const e = err();
    return finish(J, !e && !btn(P.done), e ? `игра отказала: ${e.slice(0, 80)}` : `часть сдана (${J.why})`);
  }
  const tp = btn('teleport');
  if (!tp) return finish(J, false, 'кнопки «Завершить» нет — условия части ещё не выполнены');
  if (J.tpT) return finish(J, false, 'после телепорта NPC всё ещё не рядом');
  const id = tp.dataset[`${P.act}Target`] || '';
  const price = await tpPrice(id), max = env.cfg.storyTpMax ?? 100000;
  if (!allowed()) return;              // цена пришла после «Стоп» — платный переход уже не нужен.
  if (env.cfg.storyTurnIn === false) return cancel(J);
  if (price == null || !isFinite(price)) return finish(J, false, `цена телепорта к ${id || 'NPC'} неизвестна — не лечу вслепую`);
  if (!withinBudget(price)) return finish(J, false, `телепорт к NPC ${fmtA(price)} адены дороже лимита ${fmtA(max)}`);
  await teleport(J, tp, id, price, allowed);
}
// шаг в главном цикле. true — занят квестом (цикл идёт на следующий круг)
async function storyStep() {
  if (paymentPending()) { await paymentReconcile(); return true; }
  if (env.on === false || env.tabOwner === false) return false;
  const J = env.rt.storyJob;
  if (J) {
    if (env.cfg.storyTurnIn === false) { await cancel(J); return true; }
    if (env.isBattle()) return false;
    if (Date.now() - (J.t || 0) > JOB_MAX) { await finish(J, false, 'не уложился в 4 мин'); return true; }
    await step(J); return true;
  }
  const w = want();
  if (!w || !env.awayFree()) return false;
  const home = !env.fishNow() && env.autonomyMode() !== 'cat' ? env.rt.zone || null : null;
  // 10.0 (аудит): «стоять там, где оставили» — точка неизвестна (после телепорта к РБ/смерти) или найдена только по мобам (out:…, телепорта туда нет) —
  // бот не вернулся бы; сдаём, когда точка снова определится по карте
  // 10.0: без режима (только задачи) бот стоит, где стоял — точка возврата не нужна
  if (!env.fishNow() && !['cat', 'tasks'].includes(env.autonomyMode()) && (!home || /^out:/.test(home))) return false;
  const tried = Object.fromEntries(Object.entries(env.rt.storyTried || {}).filter(([, t]) => Date.now() - t < 86400000));
  await env.setRt({ storyJob: { ...w, home, char: env.rt.char, kick: +env.rt.manualKickAt || 0, t: Date.now() }, storyTried: { ...tried, [w.key]: Date.now() } });
  env.rec('B', 'квест', `${Q[w.kind].name}: иду сдавать — ${w.why}`);
  return true;
}
// 10.0 (лог 12.10 12:01: заказ Маммона висел, пока шла цепочка): готовую часть есть смысл сдать — цепочку прерываем после боя
function chainWant() { const w = want(); if (!w || !env.awayFree(true)) return null; const z = env.rt.zone; return z && !/^out:/.test(z) ? w : null; }
return { chainWant, Q, CLASS_KEYS, profUp, stashPromote, norm, qNote, charNote, classNote, openNames, rbIds, storyTick, want, finish, tpPrice, step, storyStep, line, onNet, paymentReconcile };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
