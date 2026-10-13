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
const MEM_MAX = 80, SAMPLES = 12, HITS = 30, GAPS = 6, FLUSH_MS = 30000;
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
const RE_PET = /^Слуга\s*\[(.+?)\]\s*(атакує|завдає критичного удару)\s*\[(.+?)\]\s*([\d\s  ]+?)\s*урону/i;
const RE_PET_MISS = /^Слуга\s*\[.+?\].*промахну/i;
const RE_IN = /^\[(.+?)\]\s*ударив тебе\s*(\(крит!\)\s*)?[−-]\s*([\d\s  ]+)\s*HP/i;
const RE_POT = /^(?:Зілля|Зелье)\s*\+\s*([\d\s]+)\s*HP/i;
const RE_SELF = /^HP\s*\+\s*([\d\s]+)/i;
const RE_DOT = /^(.+?)\s*·\s*(.+?)\s+([\d][\d\s  ]*)\s*(?:HP|урона|урону|шкоди)?\.?\s*$/i;
const RE_PLAIN = /^([^\[\d+×:][^+×:]*?)\s+([\d][\d\s  ]*)\.?\s*$/;
const RE_SKIP = /^(?:Бой начат|Бій розпочато|Победа|Перемога|аден|адена|SP\b|EXP\b|Випав|Выпал|Спойл|Spoil)|×\s*\d/i;
function parseLog(lines, mob) {
  const m = low(mob).replace(/\s*·.*$/, '');
  const r = { own: 0, ownN: 0, crit: 0, pet: 0, petN: 0, petCrit: 0, petMiss: 0, hits: [], spikes: [], pot: 0, selfHeal: 0, resist: 0, miss: 0 };
  for (const raw of lines || []) {
    const l = String(raw || '').trim(); if (!l) continue;
    let x;
    if ((x = l.match(RE_PET))) { r.pet += num(x[4]); r.petN++; if (/критич/i.test(x[2])) r.petCrit++; continue; }
    if (RE_PET_MISS.test(l)) { r.petMiss++; continue; }
    if ((x = l.match(RE_IN))) { r.hits.push({ who: x[1].trim(), dmg: num(x[3]), crit: !!x[2] }); continue; }
    if ((x = l.match(RE_POT))) { r.pot += num(x[1]); continue; }
    if ((x = l.match(RE_SELF))) { r.selfHeal += num(x[1]); continue; }
    if (/опирається ефекту|сопротивл|resist/i.test(l)) { r.resist++; continue; }
    if (/^(?:Ти|Вы|Ты)\s+промахну|промахнулись|промах[!.]?$/i.test(l)) { r.miss++; continue; }
    if (RE_SKIP.test(l)) continue;
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
let F = null, last = null, cache = null, cacheCls = '', dirty = false, flushT = 0, lastFight = null;
function mem() {
  const cls = env.rt.classCur?.prof || '';
  if (!cache || cacheCls !== cls || (!dirty && cache.__src !== env.rt.fightMem)) {
    cache = { ...(env.rt.fightMem || {}) }; cacheCls = cls;
    Object.defineProperty(cache, '__src', { value: env.rt.fightMem, enumerable: false, writable: true });
  }
  return cache;
}
function keyOf(o) {
  if (/^l2dop_rb_|^l2dop_eg_/i.test(o.spawn || '') || o.kind === 'raid' || o.kind === 'epic') return 'rb:' + (o.spawn || low(o.name));
  const n = low(o.name); if (!n) return '';
  return (o.champ ? 'ch:' : 'm:') + n;
}
function begin(bt, spawn, now) {
  const title = env.mobTitle?.() || '';
  const name = bt.name || title.split('·')[0].trim();
  const lvl = bt.lvl || +(title.match(/ур\.?\s*(\d+)/i)?.[1] || 0) || 0;
  const champ = /champ/i.test(bt.kind || '') || !!(title && env.isChamp?.(title));
  const rb = /^l2dop_(?:rb|eg)_/i.test(spawn) || /raid|epic|boss/i.test(bt.kind || '') || !!(title && env.isBoss?.(title));
  F = { key: '', spawn, name, lvl, champ, rb, t0: now, tl: now, mob: bt.mob, mob0: bt.mob, mobMax: bt.mobMax, me: bt.hp, mp: bt.mp, seq: bt.seq ?? -1,
        turns: 0, dealt: 0, petDmg: 0, a: {}, hits: [], sp: [], pots: 0, lost: 0, done: false };
  F.key = keyOf({ spawn, name, champ, kind: rb ? 'raid' : '' });
  return F;
}
// новые строки полного лога: прошлый ответ кончался на prev, новый — cur; cur = prev.slice(k) + новое (лог игры растёт, старое уходит)
function newLines(F, cur) {
  const prev = F.logPrev || [], c = Array.isArray(cur) ? cur.map(x => String(x ?? '')) : [];
  let k = 0;
  for (; k < prev.length; k++) { const n = prev.length - k; if (n <= c.length && prev.slice(k).every((s, i) => s === c[i])) break; }
  F.logPrev = c.slice(-40);
  return c.slice(prev.length - k);
}
const urlSpawn = () => { try { return new URLSearchParams(location.search).get('spawnId') || ''; } catch (e) { return ''; } };
// бой открыт со страницы карты (POST /game/battle/start ушёл ещё там) — на странице боя первый ответ придёт только после хода;
// подсказка нужна до него: бой по заголовку страницы
function ensure() {
  if (F && !F.done) return F;
  const title = env.mobTitle?.() || ''; if (!title) return null;
  const spawn = urlSpawn();
  if (F?.done && spawn && spawn === F.spawn) return null;
  return begin({}, spawn, Date.now());
}
function onNet(path, d) {
  const bt = d?.bt; if (!bt || typeof bt !== 'object') return null;
  const now = Date.now(), act = path === '/game/battle/action', fresh = /\/(?:start|hunt-continue)$/.test(path);
  const ok = d.status >= 200 && d.status < 300 && !d.res?.error;
  if (!ok) { if (act && F && !F.done) F.lost++; return null; }
  // spawnId боя — из самого боя (начало, GET /game/battle); в ходе цепочки «Охотиться дальше» игра шлёт battleSpawnId первого боя
  // (7.2.1), поэтому у хода он не повод начинать новый бой
  const spawnB = String(bt.spawn || '');
  const spawn = spawnB || (F && !F.done ? F.spawn : '') || String(d.req?.battleSpawnId || urlSpawn() || '');
  if (!fresh && F?.done && (!spawn || spawn === F.spawn)) return null;   // ответ о бое, который уже подведён (GET /game/battle после победы)
  if (fresh || !F || F.done || (spawnB && F.spawn && spawnB !== F.spawn)) {
    if (F && !F.done && F.turns) finish('left', now);
    if (bt.mob == null && !act) return null;      // ответ без моба (сторонний sync) — боя не начинаем
    begin(bt, spawn, now);
    if (!act) { if (bt.end) finish(bt.win ? 'win' : bt.lose ? 'lose' : 'end', now); return F; }
  }
  // 9.2 (лог 12.10 02:31–02:56, 242 хода): игра отвечает на ход почти всегда `kind:'full'` (225 из 242) — там `battle.log` —
  // ВЕСЬ лог боя с начала (battle-log-session.getActiveLines), а не хвост; `delta.logTail` (17 ответов) — только новые строки.
  // Полный лог режем по уже виденным строкам (наложение хвоста прошлого ответа на начало нового), иначе каждый ход считался бы заново
  const lines = bt.full || bt.seq == null ? newLines(F, bt.log) : bt.seq > (F.seq ?? -1) ? bt.log : [];
  // 10.0 (аудит боя): хвост delta тоже «виден» — иначе следующий полный лог отдал бы его второй раз (урон в чужой ход, ≈7 % ходов)
  if (!(bt.full || bt.seq == null) && lines.length) F.logPrev = [...(F.logPrev || []), ...lines.map(x => String(x ?? ''))].slice(-40);
  const L = parseLog(lines, F.name);
  if (bt.seq != null) F.seq = Math.max(F.seq ?? -1, bt.seq);
  if (bt.mobMax) F.mobMax = bt.mobMax;
  for (const h of L.hits) { F.hits.push(h.dmg); if (F.hits.length > HITS) F.hits.shift(); }
  for (const s of L.spikes) F.sp.push({ t: now, dmg: s.dmg, name: s.name });
  F.petDmg += L.pet;
  let turn = null;
  if (act) {
    const action = String(d.req?.action || ''), name = env.actName?.(action) || action;
    // банка — по нашему же нажатию: строки «Зілля +600 HP» идут импульсами каждую секунду (снимок боя с Verfa 12.10 00:47), это не «ещё банка»
    if (/^battle_potion/.test(action)) F.pots++;
    const drop = F.mob != null && bt.mob != null ? Math.max(0, F.mob - bt.mob) : 0;
    let own = L.own;
    if (!own && !F.rb && drop > L.pet) own = drop - L.pet;           // строки урона нет (атака) — по HP моба; на РБ бьют и другие игроки
    if (/^battle_potion|_toggle$/.test(action)) own = 0;
    const mpd = F.mp != null && bt.mp != null ? F.mp - bt.mp : null;
    turn = { t: now, action, name, own, crit: L.crit, pet: L.pet, petMiss: L.petMiss, hitIn: L.hits.reduce((s, h) => s + h.dmg, 0),
             spike: L.spikes[0]?.dmg || 0, pot: L.pot, selfHeal: L.selfHeal, mpd, mob: bt.mob, me: bt.hp };
    F.turns++; F.tl = now; F.dealt += own;
    if (name && !/^battle_potion|_toggle$/.test(action)) {
      const a = (F.a[low(name)] ||= { n: 0, s: [], z: 0 });
      a.n++; if (own > 0) { a.s.push(own); if (a.s.length > SAMPLES) a.s.shift(); } else a.z++;
    }
    last = turn;
    // 10.0.7 (ценность баффов): доля критов заклинаний под текущими крит-баффами → content.critNote (rt.critStat)
    if (L.ownN > 0 && !/^battle_potion|_toggle$|^attack$/.test(action)) try { env.critNote?.(L.ownN, Math.min(L.ownN, L.crit)); } catch (e) {}
  }
  if (bt.mob != null) F.mob = bt.mob;
  if (bt.hp != null) F.me = bt.hp;
  if (bt.mp != null) F.mp = bt.mp;
  if (bt.end) finish(bt.win || (bt.mob === 0 && !bt.lose) ? 'win' : bt.lose ? 'lose' : 'end', now);
  return turn;
}
// точный замер последнего хода этим скиллом (для content.observeSlot): ход ушёл не раньше since − 0,3 с
function turnFor(name, since) {
  const t = last; if (!t || low(t.name) !== low(name) || t.t < since - 300 || Date.now() - t.t > 5000) return null;
  return t;
}

// ---------- итог боя → память на цель ----------
function finish(outcome, now = Date.now()) {
  if (!F || F.done) return null;
  F.done = true;
  try { env.critFlush?.(); } catch (e) {}     // 10.0.7: замер крита — в память по концу боя
  const sec = Math.max(0.1, (F.tl - F.t0) / 1000);
  const sum = { key: F.key, name: F.name, lvl: F.lvl, rb: F.rb, champ: F.champ, outcome, sec: Math.round(sec * 10) / 10, turns: F.turns,
    dealt: F.dealt, pet: F.petDmg, pots: F.pots, lost: F.lost, dps: F.dealt + F.petDmg > 0 && sec >= 1 ? Math.round((F.dealt + F.petDmg) / sec) : 0, t: now };
  lastFight = sum;
  if (!F.key || (!F.turns && outcome !== 'lose')) return sum;
  const M = mem(), m = M[F.key] ? { ...M[F.key], a: { ...(M[F.key].a || {}) } } : { nm: F.name, k: F.rb ? 'rb' : F.champ ? 'ch' : 'm', n: 0, w: 0, l: 0, a: {} };
  m.nm = F.name || m.nm; if (F.lvl) m.lv = F.lvl; if (F.mobMax) m.hp = F.mobMax;
  m.n++; if (outcome === 'win') m.w++; if (outcome === 'lose') m.l = (m.l || 0) + 1; m.t = now;
  if (outcome === 'win' && F.mob0 === F.mobMax) { m.sec = ew(m.sec, sec); m.tu = ew(m.tu, F.turns); }   // время — только целого боя
  if (sum.dps > 0 && sec >= 2) m.dps = ew(m.dps, sum.dps);
  for (const [k, a] of Object.entries(F.a)) {
    const o = { ...(m.a[k] || { n: 0, s: [] }) };
    o.n += a.n; o.s = [...(o.s || []), ...a.s].slice(-SAMPLES); o.z = (o.z || 0) + a.z;
    m.a[k] = o;
  }
  if (F.hits.length) m.h = [...(m.h || []), ...F.hits].slice(-HITS);
  if (F.sp.length) {
    const g = F.sp.slice(1).map((s, i) => Math.round((s.t - F.sp[i].t) / 100) / 10).filter(x => x > 0.5);
    m.sp = { mx: Math.max(m.sp?.mx || 0, ...F.sp.map(s => s.dmg)), nm: F.sp[F.sp.length - 1].name, g: [...(m.sp?.g || []), ...g].slice(-GAPS), n: (m.sp?.n || 0) + F.sp.length };
  }
  if (F.rb || F.champ) m.pot = ew(m.pot, F.pots, 0.4);
  M[F.key] = m;
  const keys = Object.keys(M);
  if (keys.length > MEM_MAX) keys.sort((a, b) => (M[a].t || 0) - (M[b].t || 0)).slice(0, keys.length - MEM_MAX).forEach(k => delete M[k]);
  dirty = true;
  if (F.rb || outcome === 'lose' || now - flushT > FLUSH_MS) flush();
  if (F.rb) env.rec?.('B', 'анализ', `${F.name}: ${outcome === 'win' ? 'победа' : outcome === 'lose' ? 'смерть' : 'бой окончен'} за ${env.fmtT ? env.fmtT(sec) : Math.round(sec) + ' с'}, ходов ${F.turns}`
    + `, урон ${F.dealt}${F.petDmg ? ' + кот ' + F.petDmg : ''} (≈${sum.dps}/с), банок ${F.pots}${F.sp.length ? `, спецударов ${F.sp.length} (макс. ${Math.max(...F.sp.map(s => s.dmg))})` : ''}`
    + `${m.sp?.g?.length >= 3 ? `, пауза между спецударами ≈${median(m.sp.g)} с` : ''} · боёв с ним ${m.n}`);
  return sum;
}
function flush() {
  if (!dirty || !cache) return;
  dirty = false; flushT = Date.now();
  const out = { ...cache };
  cache.__src = out;
  try { env.setRt({ fightMem: out, fightLast: lastFight })?.catch?.(() => {}); } catch (e) {}   // 9.2: последний бой — в меню «Память боя"
}

// ---------- подсказки бою ----------
function samplesOn(name) {
  if (!ensure()) return null;
  const k = low(name), m = mem()[F.key]?.a?.[k], f = F.a[k];
  const s = [...(m?.s || []), ...(f?.s || [])].slice(-SAMPLES);
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
  const g = [...(m?.sp?.g || []), ...own].slice(-GAPS);
  if (g.length < 3) return null;
  const med = median(g), dev = Math.max(...g.map(x => Math.abs(x - med))) / med;
  if (!(med > 0) || dev > 0.3) return null;
  const lastT = F.sp.length ? F.sp[F.sp.length - 1].t : F.t0;
  return { gap: Math.round(med * 10) / 10, eta: Math.round((med - (now - lastT) / 1000) * 10) / 10, minGap: Math.min(...g) };
}
const fight = () => F;
const recall = key => mem()[key] || null;
const lastSum = () => lastFight;
// для меню и журнала: что бот знает о цели одной строкой
function brief(key) {
  const m = mem()[key]; if (!m) return '';
  const top = Object.entries(m.a || {}).filter(([, a]) => a.s?.length >= 3).map(([k, a]) => [k, Math.round(median(a.s))]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `${m.nm}: боёв ${m.n} (побед ${m.w}${m.l ? ', смертей ' + m.l : ''})${m.dps ? `, ДПС ≈${m.dps}` : ''}${m.sec ? `, бой ≈${m.sec} с` : ''}`
    + `${top.length ? ' · ' + top.map(([k, v]) => `${k} ≈${v}`).join(', ') : ''}${m.h?.length >= 3 ? ` · бьёт ≈${q(m.h, 0.9)} (P90)` : ''}`
    + `${m.sp ? ` · спецудар до ${m.sp.mx}${m.sp.g?.length >= 3 ? ` раз в ≈${median(m.sp.g)} с` : ''}` : ''}`;
}
return { ROLES, role, parseLog, ensure, onNet, turnFor, finish, flush, dmgOn, killP, spikeEta, fight, recall, lastSum, brief, keyOf, mem };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
