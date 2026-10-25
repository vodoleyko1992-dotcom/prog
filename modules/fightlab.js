/* L2wap 9.2: анализатор боя («лаборатория»). Бой — ход за ходом по ответам сервера (hook.js, поле bt), а не по странице через 0,9 с.
   Что было не так (разбор 11.10): урон помнился один на скилл для всех целей сразу (Blaze по мобу 50 ур. и по РБ 60 ур. — одно среднее),
   окна замера соседних ходов перекрывались (лог 11.10 00:49:23: «Blaze: урон 3062 · HP +420» — это банка; 09.10: «Summon Kat» получил
   урон Vampiric Touch), а про РБ помнились только спецудар, сильный удар и вердикт. Здесь:
   • журнал хода: что нажато (action), свой урон (строка лога этого ответа; без неё — падение HP моба минус удары кота, не на РБ), кот,
     удары по нам, спецудары, банка; — точные цифры отдаются и обычному замеру скилла (content.observeSlot);
   • память на цель rt.fightMem (своя у каждого класса — story.CLASS_KEYS): РБ — по spawnId, мобы и чемпионы — по имени; урон каждого
     скилла именно по ней (последние 12), ДПС, время боя, удары по нам (P90), спецудар и паузы между ними, банки, победы/смерти;
   • подсказки бою: урон скилла по этой цели, вероятность добить с одного удара (по замерам, а не по среднему), когда ждать спецудар РБ;
   • профиль класса (саммонер, нюкер, спойлер, Дестр…) — для журнала и выбора правил. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.fightlab = function create_fightlab(env) {
const location = env.routeLocation || root.location;
const MEM_MAX = 80, SAMPLES = 12, HITS = 30, GAPS = 6, FLUSH_MS = 30000, EVIDENCE = 2, GROUP_EVIDENCE = 1;
const num = s => +String(s).replace(/[\s  ]/g, '');
const low = s => String(s || '').trim().toLowerCase();
const ew = (old, v, a = 0.3) => old > 0 ? Math.round((old * (1 - a) + v * a) * 10) / 10 : Math.round(v * 10) / 10;
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]; };

// ---------- профиль класса ----------
// В бою уже есть «маг/воин» (content.combatProfileKind) и спойл/Frenzy. Профиль уточняет роль: по ней — подсказки и журнал
const ROLES = [
  ['summoner', 'саммонер', /warlock|arcana lord|elemental (?:summoner|master)|phantom summoner|spectral master/, { mage: 1, pet: 1 }],
  ['nuker', 'нюкер', /sorcer|archmage|spellsinger|mystic muse|spellhowler|storm screamer|necromancer|soultaker|wizard|dark mage|human mage|elven mage|mystic/, { mage: 1 }],
  ['healer', 'лекарь/бафер', /bishop|cardinal|elder|saint|prophet|hierophant|oracle|cleric|shaman|overlord|warcryer|dominator|doomcryer/, { mage: 1 }],
  ['spoiler', 'спойлер', /scavenger|bounty hunter|fortune seeker|dwarven fighter|dwarf fighter/, { spoil: 1 }],
  ['destroyer', 'Дестр', /destroyer|titan|berserker/, { frenzy: 1 }],
  ['tyrant', 'Тиран', /tyrant|grand khavatari|monk|orc raider|orc fighter/, { force: 1 }],
  ['dagger', 'даггер', /treasure hunter|adventurer|plains walker|wind rider|abyss walker|ghost hunter|rogue|assassin/, {}],
  ['archer', 'лучник', /hawkeye|sagittarius|silver ranger|moonlight sentinel|phantom ranger|ghost sentinel/, {}],
  ['tank', 'танк', /paladin|phoenix knight|dark avenger|hell knight|temple knight|eva'?s templar|shillien knight|shillien templar|knight/, {}],
  ['fighter', 'воин', /gladiator|duelist|warlord|dreadnought|warsmith|maestro|warrior|fighter|artisan/, {}],
];
function role(prof) {
  const p = low(prof ?? env.rt.classCur?.prof ?? env.rt.prof).replace(/^(?:human|elf|elven|dark_elf|dark elf|orc|dwarf|kamael)[_\s]+/, '').replace(/[_-]+/g, ' ');
  for (const [id, label, re, f] of ROLES) if (re.test(p)) return { id, label, prof: p, mage: !!f.mage, pet: !!f.pet, spoil: !!f.spoil, frenzy: !!f.frenzy, force: !!f.force };
  return { id: 'fighter', label: 'воин', prof: p, mage: false, pet: false, spoil: false, frenzy: false, force: false };
}

// ---------- разбор лога одного ответа ----------
// Строки игры (лог 11.10, 12.10; серверные — всегда по-украински): «Енергетична блискавка 2579», «Полум’я · КРИТ 6975»,
// «Verfa · Гідроудар 1995» (спецудар), «[Verfa] ударив тебе −180 HP.», «Слуга [Kai the Cat] атакує [Verfa] 2 263 урону.»,
// «Слуга [Kai the Cat] завдає критичного удару [X] 5 721 урону.», «… промахнувся», «Зілля +600 HP», «HP +12 (зцілення).»
const RE_PET = /^Слуга\s*\[(.+?)\]\s*(атакує|завдає критичного удару)\s*\[(.+?)\]\s*:?\s*([\d\s  ]+?)\s*урону/i;
const RE_PET_MISS = /^Слуга\s*\[.+?\].*промахну/i;
// 14.10: сервер и компактный DOM используют разные глаголы и убирают скобки вокруг имени в отображении.
const RE_IN = /^(Крит!\s*)?(?:\[([^\]]+)\]|(.+?))\s*(?:ударив тебе|вдарив тебе|ударил тебя|завдав тобі|нан[её]с тебе)\s*:?\s*(\(крит!\)\s*)?(?:[—–]\s*)?[−-]\s*([\d\s  ]+)\s*HP/i;
const RE_ACTOR_HIT = /^\[([^\]]+)\]\s*(?:(—\s*крит!|критичний\s+удар!)\s*)?[−-]\s*([\d\s  ]+)\s*HP/i;
const RE_POT = /^(?:Зілля|Зелье)\s*\+\s*([\d\s]+)\s*HP/i;
const RE_SELF = /^HP\s*\+\s*([\d\s]+)/i;
const RE_DOT = /^(.+?)\s*·\s*(.+?)\s+([\d][\d\s  ]*)\s*(?:HP|урона|урону|шкоди)?\.?\s*$/i;
const RE_PLAIN = /^([^\[\d+×:][^+×:]*?)\s+([\d][\d\s  ]*)\.?\s*$/;
const RE_PHYSICAL = /^(Крит!\s*)?(?:Ти|Ты|Вы)\s+(?:завдав|завдали|нан[её]с(?:ли)?)\s*(?:\[[^\]]+\]\s*)?([\d][\d\s  ]*)\s*(?:урона|урону|шкоди)\.?$/i;
const RE_SKIP = /^(?:Бой начат|Бій розпочато|Победа|Перемога|аден|адена|SP\b|EXP\b|Випав|Выпал|Спойл|Spoil)|×\s*\d/i;
// Лог20.10 10:43UTC: native skills содержат power/число целей перед фактическим уроном.
// Берём только последний damage с единицей; ID-префикс должен соответствовать имени, splash идёт отдельной строкой.
const RE_NATIVE_POWER = /^(?:\u2060(\d{1,6})\u200b)?(Вихор|Whirlwind|Дикий розмах|Wild Sweep)\s*:\s*power\s+\d+(?:\s*;\s*до\s+\d+\s+ціл(?:ей|і|ь)\s*\(головна\s*\+\s*\d+\s+поруч\))?\s*[—–-]\s*(\d+(?:[ \u00a0\u202f]\d{3})*)\s*урон[ау]\.?$/i;
// 20.43 (лог 21.10 23:22:04, Warsmith на РБ): своё умение с пояснением — «(ID-префикс 260)Скрушний молот: удар пройшов; оглушення не діє на РБ/епіків —
// 11955 урона». RE_PLAIN не берёт двоеточие, RE_DOT — только «кто · что»: удар не считался, на РБ ход был «урон не измерен», и замер
// забирал строку босса «Gwindorr · Удар вітру — 66». Свой — по ID-префиксу игры, без «·» и без [имени] в строке
const RE_OWN_NOTE = /^\u2060\d{1,6}\u200b([^·\[\]:]{2,40}):[^·\[\]]*?[—–-]\s*(\d+(?:[ \u00a0\u202f]\d{3})*)\s*урон[ау]\.?$/i;
function parseLog(lines, mob, actor = '') {
  const player = low(actor);
  const m = low(mob).replace(/\s*·.*$/, '');
  const r = { own: 0, ownN: 0, crit: 0, pet: 0, petN: 0, petCrit: 0, petMiss: 0, hits: [], spikes: [], splash: [], extraKills: [], rewards: { exp: 0, sp: 0 }, pot: 0, selfHeal: 0, resist: 0, miss: 0 };
  for (const raw of lines || []) {
    const source = String(raw || '').replace(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\]\s*/, '').trim(), native = source.match(RE_NATIVE_POWER);
    if (native) {
      const id = /^(?:Вихор|Whirlwind)$/i.test(native[2]) ? '36' : '245', damage = num(native[3]);
      if ((!native[1] || native[1] === id) && Number.isSafeInteger(damage) && damage >= 0) { r.own += damage; r.ownN++; }
      continue;
    }
    // 14.10 (живой бой Changed Creation 74): «\u20601220\u200bПолум’я — 5002 урона» раньше давало ноль, особенно на добивании без mobHp.
    const l = String(raw || '').replace(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\]\s*/, '').replace(/\u2060\d+\u200b/g, '').replace(/\s+[—–-]\s*([\d][\d\s  ]*)\s*(?:урона|урону|шкоди)\.?$/i, ' $1').trim(); if (!l) continue;
    let x;
    if ((x = l.match(RE_PET))) { r.pet += num(x[4]); r.petN++; if (/критич/i.test(x[2])) r.petCrit++; continue; }
    if (RE_PET_MISS.test(l)) { r.petMiss++; continue; }
    if ((x = l.match(RE_IN))) {
      // 15.10, лог11:11: игра переименовывает [герой] в «Ты нанёс» только при отрисовке.
      if (player && low(x[2] || x[3]) === player) { r.own += num(x[5]); r.ownN++; if (x[1] || x[4]) r.crit++; continue; }
      r.hits.push({ who: (x[2] || x[3]).trim(), dmg: num(x[5]), crit: !!(x[1] || x[4]) }); continue; }
    // Краткий серверный формат неоднозначен: Actor бывает героем. Без явного глагола входящим считаем только текущего моба.
    if ((x = l.match(RE_ACTOR_HIT))) { if (player && low(x[1]) === player) { r.own += num(x[3]); r.ownN++; if (x[2]) r.crit++; } else if (m && low(x[1]) === m) r.hits.push({ who: x[1].trim(), dmg: num(x[3]), crit: !!x[2] }); continue; }
    if ((x = l.match(RE_POT))) { r.pot += num(x[1]); continue; }
    if ((x = l.match(RE_SELF))) { r.selfHeal += num(x[1]); continue; }
    if (/опирається ефекту|сопротивл|resist/i.test(l)) { r.resist++; continue; }
    if ((player && (x = l.match(/^\[([^\]]+)\]\s*промахнувся\.?$/i)) && low(x[1]) === player) || /^(?:Ти|Вы|Ты)\s+промахну|промахнулись|промах[!.]?$/i.test(l)) { r.miss++; continue; }
    const splash = l.match(/(?:поруч\s*:|додаткові цілі\s*[—–:-])\s*(.+)$/i);
    if (splash) { for (const hit of splash[1].matchAll(/(?:^|,)\s*(.+?)\s*[−-]\s*(\d[\d\s  ]*)/g)) r.splash.push({ name: hit[1].trim(), damage: num(hit[2]) }); continue; }
    const extra = l.match(/^(?:Додаткова ціль повалена|Дополнительная цель повержена)\s*:\s*(.+?)\.?$/i);
    if (extra) { r.extraKills.push(extra[1]); continue; }
    const reward = l.match(/^(EXP|SP)\s*\+\s*[\d\s  ]+[.!]?$/i);
    if (reward) { r.rewards[low(reward[1])]++; continue; }
    if (RE_SKIP.test(l)) continue;
    if ((x = source.match(RE_OWN_NOTE)) && low(x[1]) !== m) { r.own += num(x[2]); r.ownN++; continue; }
    if ((x = l.match(RE_PHYSICAL))) { r.own += num(x[2]); r.ownN++; if (x[1]) r.crit++; continue; }
    if ((x = l.match(RE_DOT))) {
      const a = low(x[1]), b = x[2].trim();
      if (/^(?:КРИТ|КРИТИЧНО|CRIT)/i.test(b)) { r.own += num(x[3]); r.ownN++; r.crit++; continue; }
      if (m && (a === m || a.startsWith(m) || m.startsWith(a))) { r.spikes.push({ name: b, dmg: num(x[3]) }); continue; }
      continue;                                    // «чужое · что-то N» — не наш урон
    }
    if ((x = l.match(RE_PLAIN)) && low(x[1]) !== m) { r.own += num(x[2]); r.ownN++; }
  }
  return r;
}

// ---------- текущий бой ----------
const seenRequests = new Set();
let F = null, last = null, cache = null, cacheCls = '', dirty = false, flushT = 0, lastFight = null, owner = '', ownerAwaiting = false, cacheRev = null;
// 20.41 (ревью 2): «Сбросить память боя» в меню (метка menuKeyRev.fightMem) сбрасывает и кэш модуля с ещё не записанными боями —
// иначе rebase/flush вернули бы в хранилище всю прежнюю память поверх сброса.
function menuReset() {
  const rev = +(env.rt.menuKeyRev?.fightMem || 0);
  if (cacheRev === null) cacheRev = rev;
  else if (rev !== cacheRev) { cacheRev = rev; cache = null; cacheCls = ''; dirty = false; lastFight = null; }
}
// 15.10, аудит: класс/персонаж сменился без reload — незавершённый старый бой не пишется в новую память.
function syncOwner() {
  const current = groupOwner(); if (owner === current) return;
  ownerAwaiting = !!owner; owner = current; F = null; last = null; cache = null; cacheCls = ''; dirty = false; lastFight = null; flushT = 0;
}
// 20.65 (жалоба John 25.10 «бот грузит ЦП и память»; журналы 25.10: fightMem 273–318 КБ — больше трети памяти героя): контекст замера
// (состав героя: экипировка, баффы, заряды — строка 1,2–2,1 КБ) лежал целиком в каждой строке умения каждой цели, а нужен только для
// сравнения «тот же состав». В память боя пишется его отпечаток (тот же packHash, что у пачек), сравнение сводит к отпечатку обе стороны —
// старые полные строки (прежняя память, другие классы, импорт) совпадают как раньше. В текущем бою контекст полный, как был.
// Ревью 20.65: чтобы выгрузка памяти не теряла, при каком составе сняты замеры, последние составы (отпечаток → полная строка, до 6)
// пишутся рядом в rt.fightCtx той же записью, что и память боя (только при новом составе).
const CTX_MAX = 64, CTX_KEEP = 6;
let ctxIn = null, ctxOut = null, ctxNew = false;
const ctxSeen = new Map();
const ctxId = s => { if (typeof s !== 'string' || s.length <= CTX_MAX) return s;
  if (s !== ctxIn) { ctxIn = s; ctxOut = packHash(s); if (!ctxSeen.delete(ctxOut)) ctxNew = true; ctxSeen.set(ctxOut, s);
    while (ctxSeen.size > CTX_KEEP) ctxSeen.delete(ctxSeen.keys().next().value); }
  return ctxOut; };
// словарь для записи: прежние составы из rt.fightCtx, затем увиденные этой вкладкой (новые — последними), не больше CTX_KEEP
function ctxDict() {
  const old = env.rt.fightCtx && typeof env.rt.fightCtx === 'object' && !Array.isArray(env.rt.fightCtx) ? env.rt.fightCtx : {};
  return Object.fromEntries([...Object.entries(old).filter(([h, v]) => typeof v === 'string' && !ctxSeen.has(h)), ...ctxSeen].slice(-CTX_KEEP));
}
// Прежняя память с полными строками — облегчённая копия (запишется со следующим сохранением памяти боя); без полных строк — тот же объект
function slimMem(src) {
  if (!src || typeof src !== 'object') return src;
  let out = null;
  for (const [k, m] of Object.entries(src)) {
    const a = m?.a; if (!a || typeof a !== 'object') continue;
    let na = null;
    for (const [n, o] of Object.entries(a)) if (typeof o?.context === 'string' && o.context.length > CTX_MAX) (na ||= { ...a })[n] = { ...o, context: ctxId(o.context) };
    if (na) (out ||= { ...src })[k] = { ...m, a: na };
  }
  return out || src;
}
function mem() {
  syncOwner(); menuReset();
  const cls = env.rt.classCur?.prof || '';
  if (!cache || cacheCls !== cls || (!dirty && cache.__src !== env.rt.fightMem)) {
    cache = { ...(slimMem(env.rt.fightMem) || {}) }; cacheCls = cls;
    Object.defineProperty(cache, '__src', { value: env.rt.fightMem, enumerable: false, writable: true });
  } else rebase();
  return cache;
}
// 20.13 (ревизия 17.10, шаг 5, quality, ревью): пока dirty (в т.ч. повтор после отказа записи), rt могли перечитать
// из хранилища с памятью боя другой вкладки. Не затираем её старым снимком: берём хранилище и поверх — свои записи,
// которые новее по t (или которых там нет). dirty остаётся — следующий flush допишет объединённую память.
function rebase() {
  const ext = env.rt.fightMem;
  if (!dirty || !cache || cache.__src === ext || !ext || typeof ext !== 'object') return;
  const merged = { ...slimMem(ext) };
  for (const [k, v] of Object.entries(cache)) if (!ext[k] || (v?.t || 0) > (ext[k]?.t || 0)) merged[k] = v;
  cache = merged;
  Object.defineProperty(cache, '__src', { value: ext, enumerable: false, writable: true });
}
function keyOf(o) {
  if (/^l2dop_rb_|^l2dop_eg_/i.test(o.spawn || '') || o.kind === 'raid' || o.kind === 'epic') return 'rb:' + (o.spawn || low(o.name));
  const n = low(o.name); if (!n) return '';
  return (o.champ ? 'ch:' : 'm:') + n;
}
// 15.10, лог 04:36: панель соседей может отсутствовать, хотя АОЕ выдаёт две дополнительные добычи.
// Предсказываем выгоду по принятым ходам в этой зоне/режиме; это ожидание, а не выдуманные живые цели.
const groupPage = Date.now(); // неизвестная зона: не переносим прогноз через перезагрузку/телепорт
function groupScope() { return env.cfg?.catMode ? 'cat:' + (env.rt.catIn || env.cfg.catDungeon || 'auto') : 'map:' + (env.rt.zone || 'page-' + groupPage); }
const groupOwner = () => JSON.stringify([env.rt.char || '', env.rt.classCur?.prof || '', env.rt.classCur?.slot ?? '']);
function groupNote(name, parsed, mainMax, now) {
  const skill = low(name), old = env.rt.skills?.[skill];
  if (F.rb || F.groupOwner !== groupOwner() || !(mainMax > 0) || !(parsed.own > 0) || !(parsed.splash.length || old?.aoe)) return;
  const key = F.groupScope + '|' + skill, groups = { ...(env.rt.fightGroups || {}) };
  const rewarded = Math.max(0, parsed.rewards.exp - 1, parsed.rewards.sp - 1);
  const samples = [...(groups[key]?.evidence === GROUP_EVIDENCE ? groups[key].samples || [] : []), { t: now, hp: mainMax, kills: Math.max(parsed.extraKills.length, parsed.splash.length ? rewarded : 0),
    targets: parsed.splash.length, damage: parsed.splash.length ? parsed.splash.reduce((s, x) => s + x.damage, 0) / parsed.splash.length : 0 }].slice(-SAMPLES);
  groups[key] = { ...groups[key], legacySamples: groups[key]?.evidence === GROUP_EVIDENCE ? groups[key].legacySamples : groups[key]?.samples, evidence: GROUP_EVIDENCE, t: now, samples };
  const recent = Object.fromEntries(Object.entries(groups).filter(([, g]) => now - g.t < 300000).sort((a, b) => b[1].t - a[1].t).slice(0, 24));
  (env.setRtSoon || env.setRt)({ fightGroups: recent })?.catch?.(() => {});   // 20.41 (лог 20.10 21:09): статистика AoE-ходов — отложенной записью
}
function groupOn(name, hp) {
  const g = env.rt.fightGroups?.[groupScope() + '|' + low(name)], now = Date.now();
  const s = (g?.evidence === GROUP_EVIDENCE ? g.samples || [] : []).filter(x => now - x.t < 300000 && x.hp > 0 && hp >= x.hp * .5 && hp <= x.hp * 2);
  if (!s.length) return null;
  const mean = k => s.reduce((n, x) => n + x[k], 0) / s.length;
  return { n: s.length, kills: mean('kills'), targets: mean('targets'), damage: mean('damage'), t: g.t };
}
// 20.10: сравнение агро по полным наблюдаемым циклам, отдельно от старой модели силы удара.
// Неизвестные начало/награда/экипировка, смена баффов и зависание сервера не обучают ротацию.
const PACK_MAX = 64, PACK_AGE = 24 * 3600000, PACK_EVIDENCE = 2;
let packDirty=null,packSerial=0,packAck=0,packWarnAt=0;
const packPending=new Set();
const packHash = s => { let a=2166136261,b=5381; for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}return (a>>>0).toString(36)+':'+(b>>>0).toString(36)+':'+s.length; };
function packIdentity(name, max) {
  const snapshot=env.recoveryContext?.(),setup = typeof snapshot==='string'?snapshot:'', scope = groupScope(), owner = groupOwner();
  const target=packHash(JSON.stringify([owner,scope,env.rt.lvl || 0,low(name),max])),frame=packHash(JSON.stringify([owner,scope,env.rt.lvl||0,setup]));
  return { owner, scope, target, frame, setup: packHash(setup), known: !!setup && !scope.includes('page-') && !scope.endsWith(':auto'),key: packHash(target+'|'+setup) };
}
function packRows() { return (env.rt.packLab?.samples || []).filter(x=>[1,PACK_EVIDENCE].includes(x.v) && x.owner===groupOwner() && Date.now()-x.t>=0 && Date.now()-x.t<PACK_AGE); }
function packSave(active, samples = env.rt.packLab?.samples || [], totals=env.rt.packLab?.totals) {
  const snapshot=active?{...active,extras:active.extras.map(x=>({...x})),seen:[...active.seen],skills:Object.fromEntries(Object.entries(active.skills).map(([k,v])=>[k,{...v}]))}:null;
  const seq=++packSerial,write=groupPage+':'+seq,patch = { packLab: { v:1, write, active:snapshot, samples:samples.slice(-PACK_MAX),totals } };
  packDirty={seq,owner:groupOwner(),patch,before:env.rt.packLab};packWrite(packDirty);
}
function packWrite(op) {
  if(packPending.has(op.seq))return;packPending.add(op.seq);
  let result;try{result=env.setRt(op.patch);}catch(e){result=Promise.reject(e);}
  Promise.resolve(result).then(r=>{
    if(r?.ok===false)throw Error('write_rejected');
    if(op.owner!==groupOwner())return;
    packAck=Math.max(packAck,op.seq);if(packDirty?.seq<=packAck)packDirty=null;
  }).catch(()=>{if(op.owner===groupOwner()&&op.seq>packAck&&(!packWarnAt||Date.now()-packWarnAt>=600000)){packWarnAt=Date.now();try{env.rec?.('B','ошибки','Не удалось сохранить замеры пачек — повторю при следующей сверке');}catch(_){}}}).finally(()=>packPending.delete(op.seq));
}
function packFlush() {
  const op=packDirty;if(!op)return;
  // Reset/новый владелец не воскрешают старую незаписанную статистику.
  if(op.owner!==groupOwner()||env.rt.packLab!==op.before&&env.rt.packLab?.write!==op.patch.packLab.write){packDirty=null;return;}
  packWrite(op);
}
function packRejected(path,d,unchanged=false) {
  const p=F?.pack;if(path!=='/game/battle/action'||!p||p.done||p.owner!==groupOwner())return;
  if(!env.rt.packLab){F.pack=null;return;}
  if(d.bt?.actor&&low(d.bt.actor)!==low(env.rt.char))return;
  if(d.req?.expectedRevision!=null&&p.rev!=null&&d.req.expectedRevision!==p.rev)return;
  const id=d.rid==null?'':groupPage+':'+d.rid;if(id&&p.seen.includes(id))return;
  if(id)p.seen=[...p.seen,id].slice(-128);p.attempts++;if(unchanged)p.unchanged=(p.unchanged||0)+1;else p.rejected++;
  if(['provoke','howl'].includes(d.req?.action))p.tried=true;
  if(d.error||d.ms>5000)p.slow=true;
  packSave(p);
}
function packRewards(be) {
  const reward={};
  for(const [k,label] of [['adena','аден(?:а|и|ы)?'],['sp','SP'],['exp','EXP']]) {
    const direct=be.reward?.[k]??be.reward?.['reward'+k[0].toUpperCase()+k.slice(1)];
    if(Number.isFinite(direct)&&direct>=0){reward[k]=direct;continue;}
    const log=be.finalLog||be.log;if(!log||log.omitted||log.shortened)continue;
    const re=new RegExp('^(?:'+label+'\\s*\\+\\s*([\\d\\s  ]+)|\\+?\\s*([\\d\\s  ]+)\\s*'+label+')[.!]?$','i');
    const values=log.lines.map(s=>String(s).replace(/^\\[\\d{1,2}:\\d{2}(?::\\d{2})?\\]\\s*/, '').trim().match(re)).filter(Boolean).map(m=>num(m[1]||m[2]));
    if(values.length)reward[k]=values.reduce((a,b)=>a+b,0);
  }return reward;
}
function packObserve(path,d,bt,now,observedLines=null,aligned=false) {
  const be=d.be;if(be?.schema!==1||!F||F.rb||F.champ||F.groupOwner!==groupOwner())return;
  if(bt.actor&&env.rt.char&&low(bt.actor)!==low(env.rt.char)||bt.prof&&env.rt.classCur?.prof&&bt.prof!==env.rt.classCur.prof||bt.slot!=null&&env.rt.classCur?.slot!=null&&bt.slot!==env.rt.classCur.slot)return;
  const act=path==='/game/battle/action',fresh=/\/(?:start|hunt-continue)$/.test(path), identity=packIdentity(F.name,be.mobMax??F.mobMax);
  if(F.pack&&!env.rt.packLab)F.pack=null;
  let p=F.pack;
  if(!p){
    const saved=env.rt.packLab?.active;
    const restore=saved?.v===PACK_EVIDENCE&&saved.owner===identity.owner&&saved.spawn===F.spawn&&saved.target===identity.target&&(saved.key===identity.key||!identity.known)&&now-saved.t>=0&&now-saved.t<15*60000&&!(fresh&&be.revision!==saved.startRev);
    const start=now-Math.max(0,Math.min(30000,+d.ms||0));
    const complete=!act&&(fresh||(!saved||saved.v===PACK_EVIDENCE)&&be.log?.source==='battle.log'&&be.log.total<=1&&be.log.lines.some(x=>/^(?:Бой начат|Бій розпочато)/i.test(x)))&&be.mobHp===be.mobMax;
    p=F.pack=restore?{...saved,seen:[...(saved.seen||[])],skills:{...saved.skills},extras:(saved.extras||[]).map(x=>({...x}))}:{...identity,v:PACK_EVIDENCE,uid:packHash(identity.owner+'|'+F.spawn+'|'+be.revision+'|'+start),spawn:F.spawn,name:F.name,start,startRev:be.revision,
      t:now,rev:be.revision,seq:be.seq,session:env.rt.sessT0||0,run:env.rt.manualKickAt||0,complete,changed:false,slow:false,attempts:0,accepted:0,rejected:0,unchanged:0,repeat:0,tried:false,mode:'none',peak:1,hpMin:100,hpLoss:0,mpDelta:0,raw:0,useful:0,damageUnknown:0,
      startHp:be.hpMax>0?100*be.hp/be.hpMax:null,startMp:be.mpMax>0?100*be.mp/be.mpMax:null,
      pullAt:null,collectMs:null,skills:{},seen:[],mob:be.mobHp,hp:be.hp,mp:be.mp,extras:[]};
  }
  if(p.done||be.revision!=null&&p.rev!=null&&be.revision<p.rev)return;
  const rid=d.rid==null?'':groupPage+':'+d.rid;
  if(act&&rid&&p.seen.includes(rid))return;
  if(!act&&!fresh&&p.t!==now&&p.rev===be.revision&&p.seq===be.seq&&p.hp===be.hp&&p.mp===be.mp&&!be.end)return;
  if(identity.known&&identity.key!==p.key||act&&!identity.known||p.run!==(env.rt.manualKickAt||0)||p.session!==(env.rt.sessT0||0))p.changed=true;
  if(d.ms>5000)p.slow=true;
  const extras=Array.isArray(be.extras)?be.extras:null,alive=(extras||[]).filter(x=>x.hp>0).length;
  p.peak=Math.max(p.peak,1+alive);
  if(be.hpMax>0&&be.hp!=null)p.hpMin=Math.min(p.hpMin,100*be.hp/be.hpMax);
  if(be.cut?.extras)p.damageUnknown++;
  if(act){
    if(rid)p.seen=[...p.seen,rid].slice(-128);p.attempts++;p.accepted++;
    if(d.req?.expectedRevision!=null&&p.rev!=null&&d.req.expectedRevision!==p.rev)p.complete=false;
    const requested=String(d.req?.action||''),action=/^[a-z][a-z0-9_]{0,79}$/i.test(requested)&&!['constructor','prototype'].includes(requested)?requested:'unknown',pull=['provoke','howl'].includes(action);
    if(pull){p.tried=true;if(p.mode!=='none')p.repeat++;p.mode=p.mode==='none'||p.mode===action?action:'mixed';p.pullAt=Math.max(p.start,now-(+d.ms||0));}
    if(p.hp!=null&&be.hp!=null)p.hpLoss+=Math.max(0,p.hp-be.hp);
    if(p.mp!=null&&be.mp!=null)p.mpDelta+=p.mp-be.mp;
    const log=be.log,delta=be.seq!=null&&p.seq!=null?be.seq-p.seq:null;
    // 20.49: полный victory безlogSeq уже разрезан onNet по принятому POST/rid и предыдущему журналу.
    // Используем только совпавший хвост безопасного полного лога; GET/повтор/обрезка не создают новый урон.
    const observed=aligned&&Array.isArray(observedLines)&&log&&!log.omitted&&!log.shortened&&observedLines.length<=log.lines.length
      &&observedLines.every((s,i)=>String(s)===String(log.lines[log.lines.length-observedLines.length+i]).slice(0,200));
    const lines=log&&delta>0?log.lines.slice(-Math.min(delta,log.lines.length)):delta==null&&observed&&observedLines.length?log.lines.slice(-observedLines.length):[];
    const missing=delta==null?!observed:delta>0&&delta>(log?.lines.length||0);
    if(log&&(log.omitted||log.shortened)||missing)p.damageUnknown++;
    const L=parseLog(lines,F.name,bt.actor),raw=L.own+L.splash.reduce((s,x)=>s+x.damage,0);
    let useful=0,unknown=!!(log?.shortened||missing);
    if(raw>0){
      if(p.collectMs==null&&p.pullAt!=null)p.collectMs=now-p.pullAt;
      if(L.own>0){if(p.mob!=null)useful+=Math.min(p.mob,L.own);else unknown=true;}
      const used=new Set();
      for(const hit of L.splash){const a=p.extras.map((x,i)=>({...x,i})).filter(x=>!used.has(x.i)&&low(x.name)===low(hit.name)&&x.hp!=null);
        if(a.length===1||a.length&&a.every(x=>x.hp===a[0].hp)){useful+=Math.min(Math.max(0,a[0].hp),hit.damage);used.add(a[0].i);}else unknown=true;}
      if(unknown)p.damageUnknown++;
      const skill=p.skills[action]||{name:String(env.actName?.(action)||action).slice(0,80),n:0,raw:0,useful:0,known:0};
      skill.n++;skill.raw+=raw;if(!unknown){skill.useful+=useful;skill.known++;p.useful+=useful;}p.raw+=raw;
      if(Object.keys(p.skills).length<12||p.skills[action])p.skills[action]=skill;
    }
  }else if(!fresh&&p.seq!=null&&be.seq!=null&&be.seq>p.seq)p.complete=false; // ход пришёл вне наблюдаемого POST
  p.t=now;if(be.revision!=null)p.rev=be.revision;if(be.seq!=null)p.seq=be.seq;
  if(be.mobHp!=null)p.mob=be.mobHp;if(be.hp!=null)p.hp=be.hp;if(be.mp!=null)p.mp=be.mp;
  if(extras)p.extras=extras.map(x=>({...x}));
  if(!be.end){packSave(p);return;}
  p.done=true;
  const samples=env.rt.packLab?.samples||[];
  if(samples.some(x=>x.uid===p.uid||x.owner===p.owner&&x.spawn===p.spawn&&p.rev!=null&&x.endRev===p.rev))return;
  const mode=p.mode==='none'&&p.tried?'failed':p.mode,prev=samples.at(-1),gap=prev&&p.start-prev.t;
  const quality=!!(p.complete&&p.known&&!p.changed&&!p.slow),ms=Math.max(1,now-p.start);
  // Наблюдаемый темп включает переход к текущему бою и допускает чередование навыков/целей.
  // Выбор агро по-прежнему требует одного способа и цели: разные входные КД не являются честным A/B.
  const observedCycle=!!(quality&&prev?.v===PACK_EVIDENCE&&prev.quality&&prev.win&&prev.owner===p.owner&&prev.frame===p.frame&&prev.session===p.session&&prev.run===p.run
    &&Number.isFinite(gap)&&gap>=0&&gap<=30000&&Number.isFinite(now-p.start)&&now>p.start);
  const cycle=observedCycle&&prev.mode===mode&&prev.key===p.key;
  const row={v:PACK_EVIDENCE,uid:p.uid,owner:p.owner,key:p.key,frame:p.frame,scope:p.scope,spawn:p.spawn,name:p.name,t:now,start:p.start,endRev:p.rev,session:p.session,run:p.run,startHp:p.startHp,startMp:p.startMp,
    quality,partial:!p.complete,changed:p.changed,slow:p.slow,cycle,observedCycle,ms,cycleMs:cycle?ms+gap:null,observedCycleMs:observedCycle?ms+gap:null,mode,win:!!be.win,lose:!!be.lose,peak:p.peak,hpMin:Math.round(p.hpMin),hpLoss:p.hpLoss,mpDelta:p.mpDelta,
    attempts:p.attempts,accepted:p.accepted,rejected:p.rejected,unchanged:p.unchanged||0,repeat:p.repeat,collectMs:p.collectMs,raw:p.raw,useful:p.useful,damageUnknown:p.damageUnknown,skills:p.skills,reward:packRewards(be)};
  const old=env.rt.packLab?.totals,totals=old?.owner===row.owner&&old.session===row.session?{...old}:{owner:row.owner,session:row.session,first:row.start,n:0,w:0,l:0,adena:0,sp:0,adenaN:0,spN:0,rejected:0,unchanged:0,repeat:0};
  totals.n++;totals.w+=Number(row.win);totals.l+=Number(row.lose);totals.last=row.t;totals.rejected+=row.rejected;totals.unchanged+=row.unchanged;totals.repeat+=row.repeat;
  for(const k of ['adena','sp'])if(Number.isFinite(row.reward[k])){totals[k]+=row.reward[k];totals[k+'N']++;}
  packSave(null,[...samples,row],totals);
  env.rec?.('B','пачка',`${p.name}: ${row.mode==='none'?'без агро':row.mode}, целей до ${p.peak}, ${Math.round(ms/100)/10} с, ${row.win?'победа':row.lose?'смерть':'конец'}${quality?'':' · неполный замер'}`,{data:{pack:row}});
}
function packStats(rows,observed=false) {
  const duration=observed?'observedCycleMs':'cycleMs',complete=observed?'observedCycle':'cycle';
  const rate=k=>{const r=rows.filter(x=>x.v===PACK_EVIDENCE&&x.quality&&x[complete]&&Number.isFinite(x[duration])&&x[duration]>0&&Number.isFinite(x.reward?.[k]));const ms=r.reduce((s,x)=>s+x[duration],0);return {n:r.length,ms,value:ms>0?r.reduce((s,x)=>s+x.reward[k],0)*60000/ms:null};};
  return {n:rows.length,deaths:rows.filter(x=>x.lose).length,adena:rate('adena'),sp:rate('sp'),peak:rows.length?Math.max(...rows.map(x=>x.peak)):0};
}
function packAdvice(name,max,resources={}) {
  const id=packIdentity(name,max);if(!id.known)return {blocked:[],minHp:75,reason:'нужен свежий контекст экипировки/баффов и зона'};
  const bin=(hp,mp)=>Number.isFinite(hp)&&Number.isFinite(mp)?Math.min(9,Math.floor(hp/10))+':'+Math.min(9,Math.floor(mp/10)):'';
  const wanted=bin(resources.hp,resources.mp),rows=packRows().filter(x=>x.v===PACK_EVIDENCE&&x.key===id.key&&x.quality&&Date.now()-x.t<=30*60000),baseline=rows.filter(x=>x.mode==='none'),blocked=[];let preferred='',best=0,minHp=75;
  for(const mode of ['provoke','howl']){
    const r=rows.filter(x=>x.mode===mode).slice(-12),safety=packStats(r),buckets=new Set(r.map(x=>bin(x.startHp,x.startMp)).filter(x=>x&&(!wanted||x===wanted)));
    const matched=baseline.filter(x=>buckets.has(bin(x.startHp,x.startMp))),common=new Set(matched.map(x=>bin(x.startHp,x.startMp))),arm=r.filter(x=>common.has(bin(x.startHp,x.startMp))),s=packStats(arm),base=packStats(matched);
    const enough=k=>!!wanted&&base[k].n>=6&&s[k].n>=6&&base[k].ms>=60000&&s[k].ms>=60000&&base[k].value>0&&[matched,arm].every(a=>a.filter(x=>x.cycle||x.lose).every(x=>Number.isFinite(x.reward[k])));
    if(r.length>=6&&safety.deaths>=3){blocked.push(mode);continue;}
    if(enough('adena')&&enough('sp')){
      const gain=Math.min(s.adena.value/base.adena.value,s.sp.value/base.sp.value);
      if(Math.max(s.adena.value/base.adena.value,s.sp.value/base.sp.value)<.85&&s.deaths/Math.max(1,s.n)>=base.deaths/Math.max(1,base.n)){blocked.push(mode);continue;}
      if(gain>1.1&&gain>best){best=gain;preferred=mode;}
    }
  }
  const safe=rows.filter(x=>x.mode===(preferred||'provoke')&&x.win).slice(-12);
  if(safe.length>=5)minHp=Math.min(100,Math.max(75,q(safe.map(x=>100-x.hpMin),.9)+(+env.cfg.stopHp||25)+10));
  return {blocked,preferred,minHp,reason:blocked.length?'по подтверждённым потерям/темпу наград':'по полным циклам; расходники в награду не вычтены'};
}
function packReport() {
  const rows=packRows(),session=rows.filter(x=>x.session===(env.rt.sessT0||0)),out=[];
  if(!rows.length&&!env.rt.packLab?.totals?.n)return 'Пачки: замеров ещё нет. Нужны полные ответы боя; агро сравнивается после 6 циклов каждого варианта и минуты наблюдений.';
  const by={};for(const r of session){const a=by[r.mode]||=[];a.push(r);}
  const totals=env.rt.packLab?.totals;
  if(totals?.owner===groupOwner()&&totals.session===(env.rt.sessT0||0)){
    out.push(`Сессия: боёв ${totals.n}, побед ${totals.w}, смертей ${totals.l}, отказов ${totals.rejected}, без новой ревизии ${totals.unchanged}, повторных агро ${totals.repeat}.`);
    out.push(`Подтверждённые награды: ${totals.adena} адены (${totals.adenaN}/${totals.n} боёв), ${totals.sp} SP (${totals.spN}/${totals.n}).`);
    const elapsed=Date.now()-totals.first;if(elapsed>=120000)out.push(`С начала наблюдений, включая простои: ≈${Math.round(totals.adena*60000/elapsed)} адены/мин, ${Math.round(totals.sp*60000/elapsed)} SP/мин.`);
  }
  out.push('Последние замеры сессии (до 64 боёв; награды без стоимости расходников):');
  for(const [mode,r]of Object.entries(by)){const s=packStats(r),label=mode==='none'?'Без агро':mode==='failed'?'Агро отклонено':mode;
    out.push(`${label}: боёв ${s.n}, смертей ${s.deaths}, целей до ${s.peak}, отказов ${r.reduce((n,x)=>n+x.rejected,0)}, без новой ревизии ${r.reduce((n,x)=>n+(x.unchanged||0),0)}, повторных агро ${r.reduce((n,x)=>n+x.repeat,0)}, неполных ${r.filter(x=>!x.quality).length}`);
    const collect=r.filter(x=>x.collectMs!=null);if(collect.length)out.push(`  Агро → первый урон: ≈${Math.round(collect.reduce((n,x)=>n+x.collectMs,0)/collect.length/100)/10} с; изменение MP суммарно ${r.reduce((n,x)=>n+x.mpDelta,0)} (с регеном).`);}
  const groups=new Map();for(const r of rows){if(!groups.has(r.key))groups.set(r.key,[]);groups.get(r.key).push(r);}
  for(const r of [...groups.values()].slice(-4)){
    out.push(`${r.at(-1).name} · ${r.at(-1).scope}:`);
    for(const mode of ['none','provoke','howl']){const arm=r.filter(x=>x.mode===mode),s=packStats(arm,true),selection=packStats(arm);if(!s.n)continue;
      out.push(`  ${mode==='none'?'Без агро':mode}: адена/мин ${s.adena.value==null?'нет полного цикла':Math.round(s.adena.value)}, SP/мин ${s.sp.value==null?'нет полного цикла':Math.round(s.sp.value)} · наблюдаемых циклов ${s.adena.n}, сопоставимых для выбора ${selection.adena.n}`);}
  }
  const frame=rows.at(-1)?.frame,leaders=[];
  for(const r of groups.values())if(r.at(-1).frame===frame)for(const mode of ['none','provoke','howl']){const s=packStats(r.filter(x=>x.mode===mode));if(s.adena.n>=6&&s.adena.ms>=60000)leaders.push({name:r.at(-1).name,mode,...s});}
  if(leaders.length)out.push('Лучший наблюдаемый темп в условиях последнего замера:\n'+leaders.sort((a,b)=>b.adena.value-a.adena.value).slice(0,3).map(x=>`• ${x.name}, ${x.mode==='none'?'без агро':x.mode}: ≈${Math.round(x.adena.value)} адены/мин${x.sp.value!=null?', '+Math.round(x.sp.value)+' SP/мин':''}`).join('\n'));
  const skills={};for(const r of session)for(const [k,x]of Object.entries(r.skills||{})){const s=skills[k]||={name:x.name,n:0,raw:0,useful:0,known:0};s.n+=x.n;s.raw+=x.raw;s.useful+=x.useful;s.known+=x.known;}
  for(const s of Object.values(skills).sort((a,b)=>b.n-a.n).slice(0,5))out.push(`${s.name}: принятых ударов ${s.n}, полезный урон ${s.known===s.n?s.useful:'не полностью измерен'}${s.known===s.n&&s.raw>0?', лишний '+Math.round((s.raw-s.useful)/s.raw*100)+'%':''}`);
  out.push('Наблюдаемый темп: время текущего боя и переход к нему до 30 с; чередование агро и целей допустимо, длинные паузы исключены. Это темп смешанной ротации, а не доказательство преимущества одного агро.');
  out.push('Для выбора ротации нужны 6 сопоставимых циклов каждого варианта и ≥60 с, одинаковые цель, состав и начальные диапазоны HP/MP, контекст не старше 30 мин. Исторические замеры v1 не обучают новый выбор.');
  return out.join('\n');
}
function begin(bt, spawn, now) {
  const title = env.mobTitle?.() || '';
  const name = bt.name || title.split('·')[0].trim();
  const lvl = bt.lvl || +(title.match(/ур\.?\s*(\d+)/i)?.[1] || 0) || 0;
  const champ = /champ/i.test(bt.kind || '') || !!(title && env.isChamp?.(title));
  const rb = /^l2dop_(?:rb|eg)_/i.test(spawn) || /raid|epic|boss/i.test(bt.kind || '') || !!(title && env.isBoss?.(title));
  F = { key: '', spawn, name, lvl, champ, rb, t0: now, tl: now, mob: bt.mob, mob0: bt.mob, mobMax: bt.mobMax, me: bt.hp, mp: bt.mp, seq: bt.seq ?? -1,
        actor: bt.actor || '', actorId: bt.actorId || '', rev: bt.rev, extras: (bt.extras || []).map(x => ({...x})), removed: 0, sideRemoved: 0, unknownSides: 0,
        turns: 0, dealt: 0, petDmg: 0, a: {}, hits: [], sp: [], pots: 0, lost: 0, done: false, groupOwner: groupOwner(), groupScope: groupScope() };
  F.key = keyOf({ spawn, name, champ, kind: rb ? 'raid' : '' });
  return F;
}
// 18.10, автофарм: подтверждения смертей — отдельно от модели урона и последних40 строк.
// Полный журнал задаёт нижнюю границу количества каждого имени; свежий delta добавляет
// отдельные события по абсолютному logSeq. Повтор GET/full/хвоста не убивает мобов заново.
function killNote(bt, d, now, fresh = false) {
  if (!F || F.groupOwner !== groupOwner()) return;
  if (bt.actor && env.rt.char && low(bt.actor) !== low(env.rt.char)) return;
  if (bt.prof && env.rt.classCur?.prof && low(bt.prof) !== low(env.rt.classCur.prof)) return;
  if (bt.slot != null && env.rt.classCur?.slot != null && bt.slot !== env.rt.classCur.slot) return;
  const k = F.killProof ||= { t: 0, win: false, lose: false, extras: [], fullSeq: -1, fullRev: null, fullUnknown: false, rev: null, seqs: new Set(), rids: new Set() };
  if (bt.rev != null && k.rev != null && bt.rev < k.rev) return;
  const proof = bt.killEvidence, full = Array.isArray(proof?.full) ? proof.full : null;
  const append = name => { if (typeof name === 'string' && name.trim() && k.extras.length < 200) k.extras.push(name.trim().slice(0, 80)); };
  const ridFresh = d.rid != null && !k.rids.has(d.rid);
  let confirmed = false, usedRid = false;
  const stream = proof?.stream;
  if (Number.isSafeInteger(stream?.seq) && stream.seq >= 0) {
    const s = k.stream ||= { seq: 0, deaths: [], rev: bt.rev };
    if (stream.seq >= s.seq) {
      const deaths = new Set([...s.deaths, ...(Array.isArray(stream.deaths) ? stream.deaths : []).filter(x=>Number.isSafeInteger(x)&&x>0&&x<=stream.seq)]);
      s.deaths = [...deaths].sort((a,b)=>a-b).slice(-4096); s.seq = stream.seq; if (bt.rev != null) s.rev = bt.rev;
      if (Number.isSafeInteger(stream.fullN) && stream.fullN >= 0 && stream.fullN <= stream.fullSeq && Number.isSafeInteger(stream.fullSeq) && stream.fullSeq <= s.seq && stream.fullSeq >= (s.fullSeq ?? -1)) { s.fullN = stream.fullN; s.fullSeq = stream.fullSeq; }
      if (fresh && bt.rev != null) { s.start = 'rev:' + bt.rev; if(s.seq===0){s.fullN=0;s.fullSeq=0;} }
      s.t = now;
    }
  }
  if (full) {
    const seen = new Map(), have = new Map();
    for (const name of k.extras) have.set(low(name), (have.get(low(name)) || 0) + 1);
    for (const name of full.slice(0, 200)) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const key = low(name), count = (seen.get(key) || 0) + 1; seen.set(key, count);
      if (count > (have.get(key) || 0)) append(name);
    }
    k.fullUnknown = !(Number.isSafeInteger(proof.fullSeq) && proof.fullSeq >= 0);
    if (!k.fullUnknown) k.fullSeq = Math.max(k.fullSeq, proof.fullSeq);
    k.fullRev = bt.rev ?? null;
    confirmed = true;
  }
  for (const event of Array.isArray(proof?.tail) ? proof.tail.slice(0, 200) : []) {
    const seq = Number.isSafeInteger(event?.seq) && event.seq >= 0 ? event.seq : null;
    // Полный ответ без logSeq покрывает свой delta; без сравнимой ревизии новый
    // хвост после такого снимка неоднозначен — ждём следующее полное подтверждение.
    if (k.fullUnknown && (full || bt.rev == null || k.fullRev == null || bt.rev <= k.fullRev)) {
      if (seq != null && k.seqs.size < 400) k.seqs.add(seq);
      continue;
    }
    if (seq != null ? seq <= k.fullSeq || k.seqs.has(seq) : !ridFresh || full || (k.fullRev != null && (bt.rev == null || bt.rev <= k.fullRev))) continue;
    append(event?.name); confirmed = true;
    if (seq != null && k.seqs.size < 400) k.seqs.add(seq);
    if (seq == null) usedRid = true;
  }
  if (usedRid && k.rids.size < 200) k.rids.add(d.rid);
  if (bt.win === true) { k.win = true; confirmed = true; }
  if (bt.lose === true) { k.lose = true; confirmed = true; }
  if (confirmed) { k.t = now; if (bt.rev != null) k.rev = bt.rev; }
}
// новые строки полного лога: прошлый ответ кончался на prev, новый — cur; cur = prev.slice(k) + новое (лог игры растёт, старое уходит)
function newLines(F, cur) {
  const prev = F.logPrev || [], c = Array.isArray(cur) ? cur.map(x => String(x ?? '')) : [];
  // 16.10, лог23:10: после подключения к бою delta может не содержать его начало,
  // а финальный full возвращает этот старший префикс. Ищем виденный хвост внутри
  // полного окна; одинаковые новые удары после него сохраняем, по тексту не дедупим.
  let end = 0;
  outer: for (let k = 0; k < prev.length; k++) {
    const n = prev.length - k;
    for (let start = 0; start + n <= c.length; start++) {
      if (prev.slice(k).every((s, i) => s === c[start + i])) { end = start + n; break outer; }
    }
  }
  F.linesAligned = end > 0 || !prev.length && F.logOriginKnown === true;
  F.logPrev = c.slice(-40);
  return c.slice(end);
}
const urlSpawn = () => { try { return new URLSearchParams(location.search).get('spawnId') || ''; } catch (e) { return ''; } };
// бой открыт со страницы карты (POST /game/battle/start ушёл ещё там) — на странице боя первый ответ придёт только после хода;
// подсказка нужна до него: бой по заголовку страницы
function ensure() {
  syncOwner();
  if (F && !F.done) return F;
  const title = env.mobTitle?.() || ''; if (!title) return null;
  const spawn = urlSpawn();
  if (F?.done && spawn && spawn === F.spawn) return null;
  return begin({}, spawn, Date.now());
}
function onNet(path, d) {
  syncOwner();
  if (env.pvpPending?.() || d?.pv?.defeat) { F = null; last = null; return null; } // чужой PvP-урон не принадлежит окну PvE
  const bt = d?.bt || (d?.be ? {} : null); if (!bt || typeof bt !== 'object') return null;
  if (bt.actor&&env.rt.char&&low(bt.actor)!==low(env.rt.char)||bt.prof&&env.rt.classCur?.prof&&bt.prof!==env.rt.classCur.prof||bt.slot!=null&&env.rt.classCur?.slot!=null&&bt.slot!==env.rt.classCur.slot) return null;
  const now = Date.now(), act = path === '/game/battle/action', fresh = /\/(?:start|hunt-continue)$/.test(path);
  // Native /sync часто содержит только serverNowMs. Это не снимок боя:
  // иначе следующий action заменял logPrev пустым журналом и итоговый fullLog
  // повторно начислял уже учтённые удары, лечение и спецудары (Olkuth 15.10).
  if (!act && !fresh && bt.mob == null && bt.mobMax == null && bt.hp == null && bt.mp == null
      && bt.seq == null && !bt.log?.length && !bt.end) return null;
  // После смены класса нужен старт/снимок нового боя; запоздалый ход старого класса не открывает его.
  if (ownerAwaiting && act) return null;
  const ok = !d.error && d.status >= 200 && d.status < 300 && !d.res?.error && d.res?.ok !== false;
  if (!ok || d.res?.blockedBy) { packRejected(path,d); if (act && F && !F.done) F.lost++; return null; }
  if (!act) ownerAwaiting = false;
  if (d.rid != null) { if (seenRequests.has(d.rid)) return null; seenRequests.add(d.rid); if (seenRequests.size > 128) seenRequests.delete(seenRequests.values().next().value); }
  // spawnId боя — из самого боя (начало, GET /game/battle); в ходе цепочки «Охотиться дальше» игра шлёт battleSpawnId первого боя
  // (7.2.1), поэтому у хода он не повод начинать новый бой
  const spawnB = String(bt.spawn || '');
  // Старый ответ прошлого боя/героя не начинает новый бой и не обучает текущий.
  if (F && (!bt.actorId || !F.actorId || bt.actorId === F.actorId) && bt.rev != null && F.rev != null && bt.rev < F.rev) return null;
  if (!fresh && F && ((bt.actorId && F.actorId && bt.actorId !== F.actorId) || (bt.rev != null && F.rev != null && bt.rev < F.rev)
      || (act && spawnB && F.spawn && spawnB !== F.spawn))) return null;
  if (act && F && bt.rev != null && F.rev != null && bt.rev === F.rev) { packRejected(path,d,true); return null; }
  if (!act && !fresh && F && (!spawnB || spawnB === F.spawn)) {
    // GET может обогнать ответ нашего хода. Сохраняем отдельно: та же ревизия принадлежит
    // этому action, более ранняя — исходное состояние следующего action (в том числе чужой урон).
    if (F.mob == null && !F.turns) { begin(bt, spawnB || F.spawn, now); F.logPrev = (bt.log || []).slice(-40); }
    else if (!F.pendingSnapshot || (bt.rev != null && bt.rev >= (F.pendingSnapshot.rev ?? -1))) { F.pendingSnapshot = bt; F.pendingPack = { be:d.be, ms:d.ms }; }
    killNote(bt, d, now, fresh);
    if (!F.pack) packObserve(path,d,bt,now); // снимок мог обогнать POST того же хода; active не продвигаем до его ответа
    return null;
  }
  const spawn = spawnB || (F && !F.done ? F.spawn : '') || String(d.req?.battleSpawnId || urlSpawn() || '');
  if (!fresh && F?.done && (!spawn || spawn === F.spawn)) return null;   // ответ о бое, который уже подведён (GET /game/battle после победы)
  if (fresh || !F || F.done || (spawnB && F.spawn && spawnB !== F.spawn)) {
    if (F && !F.done && F.turns) finish('left', now);
    if (bt.mob == null && !act) return null;      // ответ без моба (сторонний sync) — боя не начинаем
    begin(bt, spawn, now);
    if (!act) {
      // 14.10: стартовый лог — уже виденная часть. Иначе после delta финальный fullLog повторно засчитывает первый удар и кота.
      F.logPrev = (bt.log || []).map(x => String(x ?? '')).slice(-40);
      F.logOriginKnown = bt.mob > 0 && bt.mob === bt.mobMax && (fresh || F.logPrev.length <= 1 && F.logPrev.some(x=>/^(?:Бой начат|Бій розпочато)/i.test(x)));
      killNote(bt, d, now, fresh);
      packObserve(path,d,bt,now);
      if (bt.end) finish(bt.win ? 'win' : bt.lose ? 'lose' : 'end', now); return F;
    }
  }
  killNote(bt, d, now, fresh);
  const snapshot = F.pendingSnapshot;
  if (act && snapshot && (bt.rev == null || snapshot.rev == null || snapshot.rev < bt.rev)) {
    // GET старше ответа POST задаёт его исходные HP/MP/seq и для пачки. GET той же ревизии остаётся результатом этого POST.
    if (F.pendingPack) packObserve('/game/battle',F.pendingPack,snapshot,now);
    if (F.pack && (bt.rev == null || snapshot.rev == null)) F.pack.complete = false;
    if (snapshot.mob != null) F.mob = snapshot.mob;
    if (snapshot.mp != null) F.mp = snapshot.mp;
    if (snapshot.hp != null) F.me = snapshot.hp;
    if (Array.isArray(snapshot.extras)) F.extras = snapshot.extras.map(x => ({...x}));
    F.logPrev = (snapshot.log || []).map(x => String(x ?? '')).slice(-40);
    if (snapshot.seq != null) F.seq = Math.max(F.seq ?? -1, snapshot.seq);
    F.pendingSnapshot = null; F.pendingPack = null;
  } else if (act && snapshot && bt.rev != null && snapshot.rev === bt.rev) { F.pendingSnapshot = null; F.pendingPack = null; }
  // 9.2 (лог 12.10 02:31–02:56, 242 хода): игра отвечает на ход почти всегда `kind:'full'` (225 из 242) — там `battle.log` —
  // ВЕСЬ лог боя с начала (battle-log-session.getActiveLines), а не хвост; `delta.logTail` (17 ответов) — только новые строки.
  // Полный лог режем по уже виденным строкам (наложение хвоста прошлого ответа на начало нового), иначе каждый ход считался бы заново
  // 20.60 (логи 24.10 20:43:47, 21:17:16): на ходе с поражением delta.logTail несёт весь лог боя (seq 21→27, а строк 27) — весь бой
  // засчитывался урону последнего действия («Атака: 52460»). seq — номер последней строки (как у hook killEvidence): лишние строки
  // в начале хвоста отрезаем, только если они дословно совпадают с уже виденным хвостом лога
  const tailLines = () => {
    const log = bt.log, step = F.seq != null && F.seq >= 0 ? bt.seq - F.seq : Infinity, extra = Array.isArray(log) ? log.length - step : 0;
    if (!(extra > 0)) return log;
    const prev = F.logPrev || [], m = Math.min(extra, prev.length);
    return m > 0 && prev.slice(-m).every((x, i) => x === String(log[extra - m + i] ?? '')) ? log.slice(extra) : log;
  };
  const lines = bt.full || bt.seq == null ? newLines(F, bt.log) : bt.seq > (F.seq ?? -1) ? tailLines() : [];
  // 10.0 (аудит боя): хвост delta тоже «виден» — иначе следующий полный лог отдал бы его второй раз (урон в чужой ход, ≈7 % ходов)
  if (!(bt.full || bt.seq == null) && lines.length) F.logPrev = [...(F.logPrev || []), ...lines.map(x => String(x ?? ''))].slice(-40);
  F.actor = bt.actor || F.actor; F.actorId = bt.actorId || F.actorId;
  const L = parseLog(lines, F.name, F.actor);
  if (bt.seq != null) F.seq = Math.max(F.seq ?? -1, bt.seq);
  if (bt.mobMax) F.mobMax = bt.mobMax;
  for (const h of L.hits) { F.hits.push(h.dmg); if (F.hits.length > HITS) F.hits.shift(); }
  for (const s of L.spikes) F.sp.push({ t: now, dmg: s.dmg, name: s.name });
  F.petDmg += L.pet;
  let turn = null;
  if (act) {
    const action = String(d.req?.action || ''), name = env.actName?.(action) || action;
    if (lines.length && name && !/^battle_potion|_toggle$/.test(action)) groupNote(name, L, F.mobMax, now);
    // банка — по нашему же нажатию: строки «Зілля +600 HP» идут импульсами каждую секунду (снимок боя с Verfa 12.10 00:47), это не «ещё банка»
    if (/^battle_potion/.test(action)) F.pots++;
    const drop = F.mob != null && bt.mob != null ? Math.max(0, F.mob - bt.mob) : 0;
    let own = L.own;
    if (!own && !F.rb && drop > L.pet) own = drop - L.pet;           // строки урона нет (атака) — по HP моба; на РБ бьют и другие игроки
    if (/^battle_potion|_toggle$/.test(action)) own = 0;
    const ownKnown = !!(L.ownN || L.miss || (!F.rb && drop > L.pet) || /^battle_potion|_toggle$/.test(action));
    // Снятые HP отдельно от силы удара: 12024 по соседу с1668HP — это1668, не12024.
    F.removed += drop;
    const used = new Set();
    for (const hit of L.splash) {
      const candidates = (F.extras || []).map((x,i) => ({...x,i})).filter(x => !used.has(x.i) && low(x.name) === low(hit.name) && x.hp != null);
      const sameHp = candidates.length && candidates.every(x => x.hp === candidates[0].hp);
      if (candidates.length === 1 || sameHp) { const x = candidates[0]; used.add(x.i); const removed = Math.min(Math.max(0,x.hp),hit.damage); F.sideRemoved += removed; F.extras[x.i].hp -= removed; }
      else F.unknownSides++;
    }
    const mpd = F.mp != null && bt.mp != null ? F.mp - bt.mp : null;
    turn = { t: now, action, name, own, ownKnown, rid: d.rid, spawn: F.spawn, crit: L.crit, pet: L.pet, petMiss: L.petMiss, hitIn: L.hits.reduce((s, h) => s + h.dmg, 0),
             spike: L.spikes[0]?.dmg || 0, pot: L.pot, selfHeal: L.selfHeal, mpd, mob: bt.mob, me: bt.hp };
    F.turns++; F.tl = now; F.dealt += own;
    if (name && !/^battle_potion|_toggle$/.test(action)) {
      const a = (F.a[low(name)] ||= { n: 0, s: [], z: 0 });
      // Реальное восстановление героя из журнала принятого хода; урон по нам учитывается отдельно.
      const recovery = env.recoveryContext?.();
      if (a.recovery !== recovery) { a.heals = []; a.recovery = recovery; }
      if (recovery && L.selfHeal > 0) { (a.heals ||= []).push({hp:L.selfHeal,t:now}); if (a.heals.length > SAMPLES) a.heals.shift(); }
      // 15.10, аудит: промах — наблюдаемый ноль, неизвестный ответ не входит в вероятность добивания.
      if (own > 0 || L.miss) {
        const context = rollContext();
        if (a.context !== context) { a.context = context; a.rolls = []; }
        (a.rolls ||= []).push(own); if (a.rolls.length > SAMPLES) a.rolls.shift();
      }
      a.n++; if (own > 0) { a.s.push(own); if (a.s.length > SAMPLES) a.s.shift(); } else if (ownKnown) a.z++; else a.unknown = (a.unknown || 0) + 1;
    }
    last = turn;
    // 10.0.7 (ценность баффов): доля критов заклинаний под текущими крит-баффами → content.critNote (rt.critStat)
    if (L.ownN > 0 && !/^battle_potion|_toggle$|^attack$/.test(action)) try { env.critNote?.(L.ownN, Math.min(L.ownN, L.crit)); } catch (e) {}
  }
  packObserve(path,d,bt,now,lines,bt.full||bt.seq==null?F.linesAligned:true);
  if (bt.rev != null) F.rev = bt.rev;
  if (Array.isArray(bt.extras)) F.extras = bt.extras.map(x => ({...x}));
  if (bt.mob != null) F.mob = bt.mob;
  if (bt.hp != null) F.me = bt.hp;
  if (bt.mp != null) F.mp = bt.mp;
  if (bt.end) finish(bt.win || (bt.mob === 0 && !bt.lose) ? 'win' : bt.lose ? 'lose' : 'end', now);
  return turn;
}
// точный замер последнего хода этим скиллом (для content.observeSlot): ход ушёл не раньше since − 0,3 с
function healOn(name) {
  syncOwner();
  // Только текущий бой: чужой ранг, цель и прошлые бафы не обещают столько же лечения.
  const a = F && !F.done ? F.a[low(name)] : null, recovery = env.recoveryContext?.();
  const h = recovery && a?.recovery === recovery ? (a.heals || []).filter(x => Date.now()-x.t <= 15000).map(x => x.hp) : [];
  return h.length ? { n: h.length, mean: Math.round(h.reduce((x,y) => x+y,0)/h.length), p20: q(h,0.2) } : null;
}
function turnFor(name, since, action, rid) {
  syncOwner();
  const t = last; if (!t || (action && t.action !== action) || (rid != null && t.rid !== rid) || low(t.name) !== low(name) || t.t < since - 300 || Date.now() - t.t > 5000) return null;
  return t;
}

// Только текущий подтверждённый бой: после reload прошлые HP не восстанавливаем из догадок.
function damageFor(name, spawn, since = 0) {
  syncOwner();
  if (!F || low(name) !== low(F.name) || (spawn && F.spawn && spawn !== F.spawn) || F.tl < since - 500) return null;
  return { removed: F.removed + F.sideRemoved, main: F.removed, side: F.sideRemoved, unknownSides: F.unknownSides };
}
// Только явные подтверждения текущего/завершённого боя, в том числе GET после reload.
function killsFor(spawn, since = 0) {
  syncOwner();
  if (env.pvpPending?.() || !F || !spawn || F.spawn !== spawn || F.groupOwner !== groupOwner()) return null;
  const k = F.killProof; if (!k?.t || k.t < since) return null;
  return { spawn: F.spawn, t: k.t, win: k.win, lose: k.lose, extras: [...k.extras] };
}
function raidKillsFor(spawn) {
  syncOwner();
  if(env.pvpPending?.()||!F||F.spawn!==spawn||F.groupOwner!==groupOwner())return null;
  const k=F.killProof,s=k?.stream;if(!s?.t)return null;
  return {spawn,t:s.t,win:k.win,lose:k.lose,stream:{...s,deaths:[...s.deaths]}};
}

// ---------- итог боя → память на цель ----------
function finish(outcome, now = Date.now()) {
  syncOwner();
  if (!F || F.done) return null;
  F.done = true;
  try { env.critFlush?.(); } catch (e) {}     // 10.0.7: замер крита — в память по концу боя
  const sec = Math.max(0.1, (F.tl - F.t0) / 1000);
  // 15.10 (логи 00:49/01:01): строки ударов кота не всегда попадают в компактный bt.log.
  // Падение HP РБ показывает полный темп боя, но может включать удары других игроков; не называем его личным уроном.
  const hpLoss = F.rb && Number.isFinite(F.mob0) && Number.isFinite(F.mob) ? Math.max(0, F.mob0 - F.mob) : 0;
  const sum = { key: F.key, name: F.name, lvl: F.lvl, rb: F.rb, champ: F.champ, outcome, sec: Math.round(sec * 10) / 10, turns: F.turns,
    dealt: F.dealt, pet: F.petDmg, hpLoss, hpDps: hpLoss > 0 && sec >= 1 ? Math.round(hpLoss / sec) : 0,
    pots: F.pots, lost: F.lost, dps: F.dealt + F.petDmg > 0 && sec >= 1 ? Math.round((F.dealt + F.petDmg) / sec) : 0, t: now };
  lastFight = sum;
  if (!F.key || (!F.turns && outcome !== 'lose')) return sum;
  const M = mem(), m = M[F.key] ? { ...M[F.key], a: { ...(M[F.key].a || {}) } } : { nm: F.name, k: F.rb ? 'rb' : F.champ ? 'ch' : 'm', n: 0, w: 0, l: 0, a: {} };
  m.nm = F.name || m.nm; if (F.lvl) m.lv = F.lvl; if (F.mobMax) m.hp = F.mobMax;
  m.n++; if (outcome === 'win') m.w++; if (outcome === 'lose') m.l = (m.l || 0) + 1; m.t = now;
  if (outcome === 'win' && F.mob0 === F.mobMax) { m.sec = ew(m.sec, sec); m.tu = ew(m.tu, F.turns); }   // время — только целого боя
  if (sum.dps > 0 && sec >= 2) m.dps = ew(m.dps, sum.dps);
  if (sum.hpDps > 0 && sec >= 2) m.hpDps = ew(m.hpDps, sum.hpDps);
  for (const [k, a] of Object.entries(F.a)) {
    const o = { ...(m.a[k] || { n: 0, s: [] }) };
    if (a.rolls?.length) {
      if (o.evidence !== EVIDENCE && o.rolls) o.legacyRolls = o.rolls;
      o.rolls = [...(o.evidence === EVIDENCE && ctxId(o.context ?? null) === ctxId(a.context) ? (o.rolls || []) : []), ...a.rolls].slice(-SAMPLES);
      o.evidence = EVIDENCE;
      o.context = ctxId(a.context);
    }
    o.n += a.n; o.s = [...(o.s || []), ...a.s].slice(-SAMPLES); o.z = (o.z || 0) + a.z; o.unknown = (o.unknown || 0) + (a.unknown || 0);
    m.a[k] = o;
  }
  if (F.hits.length) m.h = [...(m.h || []), ...F.hits].slice(-HITS);
  if (F.sp.length) {
    const g = F.sp.slice(1).map((s, i) => Math.round((s.t - F.sp[i].t) / 100) / 10).filter(x => x > 0.5);
    const prediction = { v: EVIDENCE, g: [...(m.sp?.prediction?.v === EVIDENCE ? m.sp.prediction.g || [] : []), ...g].slice(-GAPS) };
    m.sp = { prediction, mx: Math.max(m.sp?.mx || 0, ...F.sp.map(s => s.dmg)), nm: F.sp[F.sp.length - 1].name, g: [...(m.sp?.g || []), ...g].slice(-GAPS), n: (m.sp?.n || 0) + F.sp.length };
  }
  if (F.rb || F.champ) m.pot = ew(m.pot, F.pots, 0.4);
  M[F.key] = m;
  const keys = Object.keys(M);
  if (keys.length > MEM_MAX) keys.sort((a, b) => (M[a].t || 0) - (M[b].t || 0)).slice(0, keys.length - MEM_MAX).forEach(k => delete M[k]);
  dirty = true;
  if (F.rb || outcome === 'lose' || now - flushT > FLUSH_MS) flush();
  if (F.rb) env.rec?.('B', 'анализ', `${F.name}: ${outcome === 'win' ? 'победа' : outcome === 'lose' ? 'смерть' : 'бой окончен'} за ${env.fmtT ? env.fmtT(sec) : Math.round(sec) + ' с'}, ходов ${F.turns}`
    + `, распознано ударов ${F.dealt}${F.petDmg ? ' + кот ' + F.petDmg : ''} (≈${sum.dps}/с)`
    + `${sum.hpDps ? `, HP РБ уменьшилось на ${sum.hpLoss} (≈${sum.hpDps}/с, включая возможный урон других игроков)` : ''}, банок ${F.pots}${F.sp.length ? `, спецударов ${F.sp.length} (макс. ${Math.max(...F.sp.map(s => s.dmg))})` : ''}`
    + `${m.sp?.g?.length >= 3 ? `, пауза между спецударами ≈${median(m.sp.g)} с` : ''} · боёв с ним ${m.n}`);
  return sum;
}
function flush() {
  syncOwner(); menuReset();
  packFlush();
  if (!dirty || !cache) return;
  rebase();
  dirty = false; flushT = Date.now();
  const out = { ...cache };
  cache.__src = out;
  // 20.13 (ревизия 17.10, шаг 5, quality/L2): dirty снимаем оптимистично, но отказ записи (ok:false — ownership_lost,
  // character_changed — или исключение) возвращает dirty, пока кэш тот же: память боя допишется следующим flush,
  // а не потеряется до следующего боя. Сбой — одна строка в журнал раз в 10 мин.
  const src = cache, failed = e => { if (cache === src && cache.__src === out) dirty = true; if (e !== 'inactive') failNote(e); };   // ревью: неактивная вкладка — не ошибка
  const ctxW = ctxNew; ctxNew = false;
  const ctxFail = () => { if (ctxW) ctxNew = true; };   // словарь составов не записан — уйдёт следующей записью памяти боя
  try {
    const r = env.setRt({ fightMem: out, fightLast: lastFight, ...(ctxW ? { fightCtx: ctxDict() } : {}) });   // 9.2: последний бой — в меню «Память боя"
    if (r?.then) r.then(v => { if (v?.ok === false) { ctxFail(); failed(v.reason || 'запись отклонена'); } }, e => { ctxFail(); failed(e); });
    else if (r?.ok === false) { ctxFail(); failed(r.reason || 'запись отклонена'); }
  } catch (e) { ctxFail(); failed(e); }
}
let failNoteT = -Infinity;
function failNote(e) {
  if (Date.now() - failNoteT < 600000) return;
  failNoteT = Date.now();
  try { env.rec?.('S', 'ошибки', `анализ боя: память боя не сохранена (${String(e?.message || e).slice(0, 120)}), повторю`); } catch (_) {}
}

// ---------- подсказки бою ----------
// 20.64 (лог 25.10 22:46–22:49): урон под Frenzy/Zealot по эпику в разы выше — такие замеры отдельная выборка (без лимита ключ прежний)
function rollContext() {
  const c = env.recoveryContext?.() || null, g = env.dmgBoostTag?.() || '';
  return c && g ? `${c}|boost:${g}` : c;
}
function samplesOn(name) {
  if (!ensure()) return null;
  const k = low(name), m = mem()[F.key]?.a?.[k], f = F.a[k];
  // Старый точный замер другой силы/баффов не перекрывает новый общий прогноз.
  // Положительные s и счётчики остаются общей аналитикой, rolls — последняя однородная выборка.
  const context = rollContext(), managed = typeof env.recoveryContext === 'function';
  if (managed && !context) return null;
  const compatible = a => !managed || ctxId(a?.context) === ctxId(context);
  const s = [...(m?.evidence === EVIDENCE && compatible(m) ? (m.rolls || []) : []), ...(compatible(f) ? (f?.rolls || []) : [])].slice(-SAMPLES);
  return s.length ? s : null;
}
// урон скилла по ЭТОЙ цели (замеры прошлых боёв с ней + этот бой); меньше 3 замеров — null (тогда общее среднее)
function dmgOn(name) {
  const s = samplesOn(name); if (!s || s.length < 3) return null;
  return { n: s.length, mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length), p20: q(s, 0.2), p50: median(s) };
}
// доля замеров по этой цели, которых хватило бы снять hp (≥ 4 замера), иначе null
function killP(name, hp) {
  const s = samplesOn(name); if (!s || s.length < 4 || !(hp > 0)) return null;
  return s.filter(x => x >= hp).length / s.length;
}
// РБ: ритм спецудара (паузы прошлых боёв и этого) — ровный (разброс ≤ 30 %, ≥ 3 пауз) → { gap, eta } в секундах, иначе null
function spikeEta(now = Date.now()) {
  if (!ensure() || !F.rb) return null;
  const m = mem()[F.key], own = F.sp.slice(1).map((s, i) => (s.t - F.sp[i].t) / 1000).filter(x => x > 0.5);
  const g = [...(m?.sp?.prediction?.v === EVIDENCE ? m.sp.prediction.g || [] : []), ...own].slice(-GAPS);
  if (g.length < 3) return null;
  const med = median(g), dev = Math.max(...g.map(x => Math.abs(x - med))) / med;
  if (!(med > 0) || dev > 0.3) return null;
  const lastT = F.sp.length ? F.sp[F.sp.length - 1].t : F.t0;
  return { gap: Math.round(med * 10) / 10, eta: Math.round((med - (now - lastT) / 1000) * 10) / 10, minGap: Math.min(...g) };
}
const fight = () => { syncOwner(); return F; };
const recall = key => mem()[key] || null;
const lastSum = () => { syncOwner(); return lastFight; };
// для меню и журнала: что бот знает о цели одной строкой
function brief(key) {
  const m = mem()[key]; if (!m) return '';
  const top = Object.entries(m.a || {}).filter(([, a]) => a.s?.length >= 3).map(([k, a]) => [k, Math.round(median(a.s))]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `${m.nm}: боёв ${m.n} (побед ${m.w}${m.l ? ', смертей ' + m.l : ''})${m.dps ? `, ДПС ≈${m.dps}` : ''}${m.sec ? `, бой ≈${m.sec} с` : ''}`
    + `${top.length ? ' · ' + top.map(([k, v]) => `${k} ≈${v}`).join(', ') : ''}${m.h?.length >= 3 ? ` · бьёт ≈${q(m.h, 0.9)} (P90)` : ''}`
    + `${m.sp ? ` · спецудар до ${m.sp.mx}${m.sp.g?.length >= 3 ? ` раз в ≈${median(m.sp.g)} с` : ''}` : ''}`;
}
return { ROLES, role, parseLog, ensure, onNet, turnFor, damageFor, killsFor, raidKillsFor, healOn, groupOn, packAdvice, packReport, packStats, finish, flush, dmgOn, killP, spikeEta, fight, recall, lastSum, brief, keyOf, mem, slimMem };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
