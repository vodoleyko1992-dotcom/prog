'use strict';
// 20.43 (разбор логов John 21.10 13:21/13:30, v20.42.2):
// 1) повышение профессии в том же слоте (Bounty Hunter → Fortune Seeker, слот 1; Warlock → Arcana Lord, слот 0) — не смена класса:
//    память класса остаётся, мёртвые записи прежних профессий в classStash сливаются с наследником (once classPromo2043);
// 2) роль «Спойл» (cfg.nSpoil — одна на ник) не делает Arcana Lord спойлером: canSpoil/mammon.spoilOn смотрят на текущий класс;
// 3) строка «состояние размер …» — раз в 30 мин на вкладку, а не на каждой загрузке страницы (метка в sessionStorage).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const plain = o => JSON.parse(JSON.stringify(o));
const storySrc = read('modules/story.js'), csrc = read('content.js');

const mkStory = (rt = {}) => {
  const recs = [], sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, isFinite, location: { pathname: '/map.html', href: '' }, sessionStorage: { setItem() {} } };
  sb.globalThis = sb; vm.runInNewContext(storySrc, sb);
  let sw = 0;
  const env = { rt: { ...rt }, cfg: {}, recs, setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus() {}, sleep: async () => {},
    waitX: async fn => fn(), fire: () => true, $q: () => null, isBattle: () => false, fishNow: () => false, autonomyMode: () => 'hunt', awayFree: () => true,
    classSwitched: () => { sw++; }, gameGet: async () => ({ ok: false, status: 401, json: async () => ({}) }) };
  return { env, S: sb.L2V7Factories.story(env), sw: () => sw };
};
// ответ /character, как в логе 21.10 (classSlots: activeSlot + slots[{slot, owned, active, profession, race, level}])
const ch = (prof, active, slots, level = 76) => ({ name: 'Warlock', level, l2Profession: prof, classBranch: 'fighter',
  classSlots: { activeSlot: active, slots: [0, 1, 2, 3].map(i => ({ slot: i, owned: !!slots[i], active: i === active, profession: slots[i] || null, race: null, level: slots[i] ? level : null })) } });
const NOW = Date.now();
// реалистичная память Bounty Hunter (слот 1): замеры скиллов, память боя, ДПС по РБ своего класса, квест профессии, пачки
const bhMem = () => ({
  skills: { 'spoil festival': { n: 412, dmg: 0, dmgN: 0, mp: 79, cd: 4.1 }, whirlwind: { n: 1200, dmg: 9.1e6, dmgN: 900, spl: 4.4e6, splN: 300 }, 'spoil crush': { n: 40, dmg: 5.2e5, dmgN: 38 } },
  skillDb: { spoil: { name: 'Spoil', mp: 32, rank: '10/10' }, 'spoil festival': { name: 'Spoil Festival', mp: 79 } },
  fightMem: { 'm:buffalo': { t: NOW - 3600000, n: 30, a: { whirlwind: { s: [9000, 9500] } } }, 'rb:l2dop_rb_25202': { t: NOW - 7200000, n: 2 } },
  zoneStat: { forsaken: { 75: { exp: 9e6, t: NOW - 3600000 } } }, mobVal: { buffalo: { s: 4.2, n: 50 } },
  rbDb: { l2dop_rb_25202: { dps: 2100, dpsLvl: 75 } }, rbDps: 2400, rbDpsContext: null, rbDpsOwner: 'dwarf_bounty_hunter', rbLossK: 0.012, rbLossKOwner: 'dwarf_bounty_hunter',
  hardMobs: { 'giant shadow': { t: NOW - 600000 } }, profQuest: { sig: 'x', t: NOW - 60000, title: 'Fortune', stage: 'hunt', open: ['grave robber'] },
  packLab: { v: 1, samples: [{ mode: 'provoke', win: true }] },
});
const arcanaMem = () => ({ skills: { blaze: { n: 900, dmg: 8e5, dmgN: 800 }, 'aura burn': { n: 300 } }, petStat: { 'kai the cat': { hits: 4000 } }, zoneStat: { swamp: { 78: { exp: 1e7 } } }, t: NOW - 86400000 });
const warlockMem = () => ({ skills: { blaze: { n: 10, dmg: 1, dmgN: 1 }, 'vampiric touch': { n: 77, dmg: 6.5e4, dmgN: 70 } }, petStat: { 'kai the cat': { hits: 1 }, 'mew the cat': { hits: 300 } },
  zoneStat: { swamp: { 60: { exp: 4e6 } } }, debuffStat: { 'curse chaos': { n: 5 } }, t: NOW - 5 * 86400000 });

test('дерево профессий: повышение той же ветки той же расы, без понижения и без чужих веток', () => {
  const { S } = mkStory();
  assert.equal(S.profUp('dwarf_bounty_hunter', 'dwarf_fortune_seeker'), 1);
  assert.equal(S.profUp('human_warlock', 'human_arcana_lord'), 1);
  assert.equal(S.profUp('dwarf_scavenger', 'dwarf_fortune_seeker'), 2);
  assert.equal(S.profUp('dwarf_warsmith', 'dwarf_maestro'), 1);
  assert.equal(S.profUp('human_warrior', 'human_warlord'), 1);
  assert.equal(S.profUp('orc_raider', 'orc_titan'), 2);
  assert.equal(S.profUp('elf_elven_elder', 'elf_evas_saint'), 1, 'elven elder → eva’s saint');
  assert.equal(S.profUp('elf_elven_oracle', 'elf_eva_saint'), 2);
  assert.equal(S.profUp('dark_elf_dark_wizard', 'dark_elf_spellhowler'), 1);
  assert.equal(S.profUp('human_mage', 'human_arcana_lord'), 3, 'mage = mystic');
  assert.equal(S.profUp('dwarf_fortune_seeker', 'dwarf_bounty_hunter'), 0, 'вниз профессия не меняется');
  assert.equal(S.profUp('dwarf_bounty_hunter', 'dwarf_maestro'), 0, 'другая ветка гнома');
  assert.equal(S.profUp('dwarf_bounty_hunter', 'dwarf_warsmith'), 0);
  assert.equal(S.profUp('human_warlock', 'dwarf_bounty_hunter'), 0, 'другая раса');
  assert.equal(S.profUp('elf_knight', 'human_paladin'), 0, 'одинаковое имя узла у другой расы');
  assert.equal(S.profUp('human_warlock', 'human_warlock'), 0);
  assert.equal(S.profUp('custom_class', 'human_warlock'), 0);
  assert.equal(S.profUp('human_unknown', 'human_arcana_lord'), 0, 'незнакомая профессия — не предок');
});

test('лог 21.10 22:01–22:03: Bounty Hunter → Fortune Seeker в слоте 1 — память класса остаётся, в тайник не уходит', () => {
  const { env, S, sw } = mkStory({ classCur: { prof: 'dwarf_bounty_hunter', slot: 1, t: NOW - 3600000 }, ...bhMem(), classStash: { human_arcana_lord: arcanaMem() }, spawns: { s: 1 }, zone: 'forsaken', faSnap: { t: 1 } });
  const before = plain(bhMem());
  S.charNote(ch('dwarf_fortune_seeker', 1, ['human_arcana_lord', 'dwarf_fortune_seeker']));
  assert.equal(env.rt.classCur.prof, 'dwarf_fortune_seeker'); assert.equal(env.rt.classCur.slot, 1);
  for (const k of ['skills', 'skillDb', 'fightMem', 'zoneStat', 'mobVal', 'rbDb', 'hardMobs', 'packLab']) assert.deepEqual(plain(env.rt[k]), before[k], k + ' сохранено');
  assert.equal(env.rt.rbDps, 2400); assert.equal(env.rt.rbDpsOwner, 'dwarf_fortune_seeker', 'свой ДПС по РБ остаётся своим (raid.rbOwnerOk)');
  assert.equal(env.rt.rbLossKOwner, 'dwarf_fortune_seeker');
  assert.equal(env.rt.profQuest, null, 'квест прошлой профессии пройден — его ★-цели не ищем');
  assert.ok(!env.rt.classStash.dwarf_bounty_hunter, 'в тайнике нет мёртвой записи');
  assert.deepEqual(Object.keys(env.rt.classStash), ['human_arcana_lord'], 'память других классов — на месте');
  assert.equal(env.rt.faSnap, null); assert.equal(env.rt.zone, 'forsaken', 'герой стоит, где стоял');
  assert.ok(env.rt.classSwT > 0); assert.equal(sw(), 1);
  assert.ok(env.recs.some(r => /профессия: Bounty Hunter → Fortune Seeker 76 ур\. \(тот же класс, слот 1\).*сохранены/.test(r)), env.recs.join('\n'));
  assert.ok(!env.recs.some(r => /смена класса/.test(r)));
  // дальше FS(1) → Warsmith(2) — смена класса по-прежнему: память FS уходит в тайник и возвращается
  S.charNote(ch('dwarf_warsmith', 2, ['human_arcana_lord', 'dwarf_fortune_seeker', 'dwarf_warsmith'], 43));
  assert.equal(env.rt.classCur.prof, 'dwarf_warsmith'); assert.equal(env.rt.skills, null); assert.equal(env.rt.fightMem, null);
  assert.deepEqual(plain(env.rt.classStash.dwarf_fortune_seeker.skills), before.skills);
  assert.ok(env.recs.some(r => /смена класса: Fortune Seeker → Warsmith 43 ур\..*с нуля/.test(r)));
  S.charNote(ch('dwarf_fortune_seeker', 1, ['human_arcana_lord', 'dwarf_fortune_seeker', 'dwarf_warsmith']));
  assert.deepEqual(plain(env.rt.fightMem), before.fightMem, 'FS вернулся со своей памятью');
});

test('слот неизвестен (нет classSlots) — повышение узнаётся по дереву; другая ветка в том же слоте — смена класса', () => {
  const a = mkStory({ classCur: { prof: 'human_warlock', slot: 0 }, skills: { blaze: { n: 5 } }, petStat: { kai: 1 } });
  a.S.charNote({ name: 'Warlock', level: 76, l2Profession: 'human_arcana_lord' });
  assert.equal(a.env.rt.classCur.prof, 'human_arcana_lord'); assert.equal(a.env.rt.classCur.slot, 0, 'слот прежний');
  assert.equal(a.env.rt.skills.blaze.n, 5); assert.equal(a.env.rt.classStash, undefined);
  // BH(1) → Warsmith(1): не предок — прежнее поведение (память BH в тайнике, у нового — с нуля)
  const b = mkStory({ classCur: { prof: 'dwarf_bounty_hunter', slot: 1 }, skills: { whirlwind: { n: 1 } } });
  b.S.charNote(ch('dwarf_warsmith', 1, ['human_arcana_lord', 'dwarf_warsmith']));
  assert.equal(b.env.rt.skills, null); assert.equal(b.env.rt.classStash.dwarf_bounty_hunter.skills.whirlwind.n, 1);
  assert.ok(b.env.recs.some(r => /смена класса: Bounty Hunter → Warsmith/.test(r)));
  // предок, но слот другой (BH в слоте 1, FS в слоте 2) — не повышение: смена класса
  const c = mkStory({ classCur: { prof: 'dwarf_bounty_hunter', slot: 1 }, skills: { whirlwind: { n: 1 } } });
  c.S.charNote(ch('dwarf_fortune_seeker', 2, ['human_arcana_lord', 'dwarf_bounty_hunter', 'dwarf_fortune_seeker']));
  assert.equal(c.env.rt.skills, null); assert.equal(c.env.rt.classStash.dwarf_bounty_hunter.skills.whirlwind.n, 1, 'BH живой в слоте 1 — его память у него');
});

test('повысили, пока был активен другой класс: при переходе на слот память прежней профессии — новой', () => {
  const { env, S } = mkStory({ classCur: { prof: 'human_arcana_lord', slot: 0 }, ...arcanaMem(), classStash: { dwarf_bounty_hunter: { ...bhMem(), t: NOW - 7200000 } } });
  S.charNote(ch('dwarf_fortune_seeker', 1, ['human_arcana_lord', 'dwarf_fortune_seeker']));
  assert.equal(env.rt.classCur.prof, 'dwarf_fortune_seeker');
  assert.deepEqual(plain(env.rt.skills), plain(bhMem().skills)); assert.deepEqual(plain(env.rt.fightMem), plain(bhMem().fightMem));
  assert.equal(env.rt.rbDpsOwner, 'dwarf_fortune_seeker'); assert.equal(env.rt.profQuest, null, 'квест BH не переносим');
  assert.deepEqual(Object.keys(env.rt.classStash).sort(), ['human_arcana_lord']);
  assert.equal(env.rt.classStash.human_arcana_lord.skills.blaze.n, 900);
  assert.ok(env.recs.some(r => /смена класса: Arcana Lord → Fortune Seeker.*прежней профессии \(Bounty Hunter\)/.test(r)), env.recs.join('\n'));
  // запись BH, когда BH по слотам ещё жив (другой слот) — не трогаем
  const b = mkStory({ classCur: { prof: 'human_arcana_lord', slot: 0 }, classStash: { dwarf_bounty_hunter: { skills: { x: { n: 1 } }, t: 1 } } });
  b.S.charNote(ch('dwarf_fortune_seeker', 2, ['human_arcana_lord', 'dwarf_bounty_hunter', 'dwarf_fortune_seeker']));
  assert.equal(b.env.rt.skills, null); assert.ok(b.env.rt.classStash.dwarf_bounty_hunter);
});

test('stashPromote: тайник из лога 21.10 (Warsmith активен) — BH → FS, Warlock → Arcana Lord, своё у наследника важнее', () => {
  const { S } = mkStory();
  const fsOwn = { skills: { 'spoil festival': { n: 30, mp: 80 }, 'lucky strike': { n: 3 } }, fightMem: { 'm:buffalo': { t: NOW, n: 2 } }, t: NOW - 1800000 };
  const src = { classCur: { prof: 'dwarf_warsmith', slot: 2, t: NOW }, skills: { 'hammer crush': { n: 9 } }, fightMem: { 'm:x': { t: NOW } },
    subSlots: [{ slot: 0, prof: 'human_arcana_lord', lvl: 78, on: false }, { slot: 1, prof: 'dwarf_fortune_seeker', lvl: 76, on: false }, { slot: 2, prof: 'dwarf_warsmith', lvl: 43, on: true }],
    classStash: { human_arcana_lord: arcanaMem(), human_warlock: warlockMem(), dwarf_bounty_hunter: { ...bhMem(), t: NOW - 3 * 3600000 }, dwarf_fortune_seeker: fsOwn } };
  const snap = plain(src);
  const P = S.stashPromote(src);
  assert.deepEqual(plain(src), snap, 'снимок rt не меняется');
  assert.deepEqual(plain(P.moved.map(x => x.join('>')).sort()), ['dwarf_bounty_hunter>dwarf_fortune_seeker', 'human_warlock>human_arcana_lord']);
  assert.deepEqual(Object.keys(P.stash).sort(), ['dwarf_fortune_seeker', 'human_arcana_lord']);
  assert.deepEqual(plain(P.active), {}, 'память активного Warsmith не трогаем');
  const al = P.stash.human_arcana_lord, fs_ = P.stash.dwarf_fortune_seeker;
  assert.equal(al.skills.blaze.n, 900, 'у Arcana Lord своё важнее'); assert.equal(al.skills['vampiric touch'].n, 77, 'недостающее — от Warlock');
  assert.equal(al.petStat['kai the cat'].hits, 4000); assert.equal(al.petStat['mew the cat'].hits, 300);
  assert.equal(al.zoneStat.swamp[78].exp, 1e7, 'словарь зон — по ключам, свой ключ целиком у наследника');
  assert.equal(al.debuffStat['curse chaos'].n, 5); assert.equal(al.t, NOW - 86400000);
  assert.equal(fs_.skills['spoil festival'].n, 30, 'у FS своё'); assert.equal(fs_.skills.whirlwind.n, 1200, 'замеры BH — FS');
  assert.equal(fs_.skills['lucky strike'].n, 3);
  assert.equal(fs_.fightMem['m:buffalo'].t, NOW); assert.ok(fs_.fightMem['rb:l2dop_rb_25202']);
  assert.equal(fs_.rbDps, 2400); assert.equal(fs_.rbDpsOwner, 'dwarf_fortune_seeker'); assert.equal(fs_.rbLossKOwner, 'dwarf_fortune_seeker');
  assert.equal(fs_.profQuest, undefined, 'квест BH не переносим'); assert.equal(fs_.t, NOW - 1800000);
  assert.ok(!Object.values(fs_).includes(null), 'в тайнике без пустых ключей');
  // наследник — активный класс: недостающее приходит в живую память (active), тайник без BH
  const A = S.stashPromote({ classCur: { prof: 'dwarf_fortune_seeker', slot: 1 }, skills: { 'spoil festival': { n: 30 } }, rbDps: null, profQuest: { open: ['own'] },
    subSlots: [{ slot: 0, prof: 'human_arcana_lord' }, { slot: 1, prof: 'dwarf_fortune_seeker' }], classStash: { human_arcana_lord: arcanaMem(), dwarf_bounty_hunter: bhMem() } });
  assert.deepEqual(Object.keys(A.stash), ['human_arcana_lord']);
  assert.equal(A.active.skills['spoil festival'].n, 30); assert.equal(A.active.skills.whirlwind.n, 1200);
  assert.equal(A.active.rbDps, 2400); assert.equal(A.active.rbDpsOwner, 'dwarf_fortune_seeker');
  assert.ok(!('profQuest' in A.active), 'свой квест FS не меняем');
  // fightMem при слиянии — не больше 80 целей (свежие)
  const big = Object.fromEntries(Array.from({ length: 70 }, (_, i) => ['m:old' + i, { t: NOW - 1e6 - i }]));
  const own = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['m:new' + i, { t: NOW - i }]));
  const C = S.stashPromote({ classCur: { prof: 'dwarf_fortune_seeker', slot: 1 }, fightMem: own, classStash: { dwarf_bounty_hunter: { fightMem: big } } });
  assert.equal(Object.keys(C.active.fightMem).length, 80); assert.ok(Object.keys(own).every(k => C.active.fightMem[k]));
});

test('stashPromote: не уверены — запись остаётся', () => {
  const { S } = mkStory();
  // слоты неизвестны и наследник не активен
  assert.equal(S.stashPromote({ classCur: { prof: 'dwarf_warsmith', slot: 2 }, classStash: { dwarf_bounty_hunter: bhMem(), dwarf_fortune_seeker: { skills: {} } } }), null);
  // BH по слотам ещё стоит в слоте — живой
  assert.equal(S.stashPromote({ classCur: { prof: 'human_arcana_lord', slot: 0 }, subSlots: [{ slot: 0, prof: 'human_arcana_lord' }, { slot: 1, prof: 'dwarf_bounty_hunter' }], classStash: { dwarf_bounty_hunter: bhMem() } }), null);
  // два возможных наследника (базовый гном → Fortune Seeker и Warsmith)
  assert.equal(S.stashPromote({ classCur: { prof: 'dwarf_warsmith', slot: 2 }, subSlots: [{ slot: 1, prof: 'dwarf_fortune_seeker' }, { slot: 2, prof: 'dwarf_warsmith' }], classStash: { dwarf_fighter: { skills: { a: 1 } } } }), null);
  // чужая раса/ветка, пустой и испорченный тайник
  assert.equal(S.stashPromote({ classCur: { prof: 'human_arcana_lord', slot: 0 }, classStash: { dwarf_bounty_hunter: bhMem() } }), null);
  assert.equal(S.stashPromote({ classCur: { prof: 'human_arcana_lord' } }), null);
  assert.equal(S.stashPromote({ classCur: { prof: 'human_arcana_lord' }, classStash: [] }), null);
  assert.equal(S.stashPromote({ classCur: { prof: 'human_arcana_lord' }, classStash: { human_warlock: null } }), null);
});

test('once classPromo2043 в content.js: пишет rf.classStash/rf.<ключи класса>/S, разовая, после остальных правок памяти классов', () => {
  const a = csrc.indexOf("  once('classPromo2043'"), b = csrc.indexOf('\n  });\n', a);
  assert.ok(a > 0 && b > a);
  assert.ok(a > csrc.indexOf("once('nativeDmg2041'") && a > csrc.indexOf("once('dbfImm2043'"), 'после правок тайника 20.41/20.43');
  assert.ok(a < csrc.indexOf('  if (sk) rf.skills = S;'), 'до записи S в rf');
  const body = csrc.slice(a, b + 6);
  assert.doesNotMatch(body, /setRt\(|setCfg\(/, 'тело once() пишет только в rf/cf (20.13)');
  const { S: story } = mkStory();
  const mig = state => {
    const recs = [], m = { rt: state, rf: {}, cf: {}, S: { ...(state.skills || {}) }, sk: false, L2V7Modules: { story }, rec: (...x) => recs.push(x.join(' ')), Object, JSON };
    m.globalThis = m;
    vm.runInNewContext('const once = (flag, fn) => { if (!rt[flag] && !rf[flag]) { rf[flag] = 1; cf[flag] = 1; fn(); } };\n' + body + '\nglobalThis.__S = S; globalThis.__sk = sk;', m);
    return { rf: plain(m.rf), S: plain(m.__S), sk: m.__sk, recs };
  };
  const rt = { classCur: { prof: 'dwarf_fortune_seeker', slot: 1 }, skills: { 'spoil festival': { n: 30 } }, subSlots: [{ slot: 0, prof: 'human_arcana_lord' }, { slot: 1, prof: 'dwarf_fortune_seeker' }],
    classStash: { human_arcana_lord: arcanaMem(), human_warlock: warlockMem(), dwarf_bounty_hunter: bhMem() } };
  const r = mig(rt);
  assert.equal(r.rf.classPromo2043, 1);
  assert.deepEqual(Object.keys(r.rf.classStash), ['human_arcana_lord']);
  assert.equal(r.rf.classStash.human_arcana_lord.skills['vampiric touch'].n, 77);
  assert.equal(r.sk, true); assert.equal(r.S.whirlwind.n, 1200); assert.equal(r.S['spoil festival'].n, 30);
  assert.equal(r.rf.skills, undefined, 'скиллы — через S (как остальные миграции скиллов)');
  assert.ok(r.rf.fightMem['m:buffalo']); assert.equal(r.rf.rbDpsOwner, 'dwarf_fortune_seeker');
  assert.ok(r.recs.some(x => /dwarf_bounty_hunter → dwarf_fortune_seeker/.test(x) && /human_warlock → human_arcana_lord/.test(x)));
  assert.deepEqual(mig({ classCur: { prof: 'human_arcana_lord', slot: 0 }, classStash: { dwarf_bounty_hunter: bhMem() } }).rf, { classPromo2043: 1 }, 'нечего переносить — rt не пишем');
  assert.deepEqual(mig({ ...rt, classPromo2043: 1 }).rf, {}, 'разовая');
});

// --- canSpoil / mammon.spoilOn: полный content.js в песочнице (как v72-spoil-farm) ---
const loadCore = () => {
  const mf = JSON.parse(read('manifest.json'));
  const ctx = vm.createContext({ addEventListener() {}, removeEventListener() {}, console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, URL, URLSearchParams, Date, Math,
    crypto: { randomUUID: () => 'x' }, sessionStorage: { getItem: () => null, setItem() {} }, navigator: { userAgent: 'Chrome' },
    location: { pathname: '/map.html', search: '', href: 'https://l2wap.com/map.html', origin: 'https://l2wap.com' }, window: { addEventListener() {}, innerWidth: 1080 },
    document: { visibilityState: 'visible', prerendering: false, createElement() { return { style: {}, append() {}, querySelector() { return null; }, querySelectorAll() { return []; } }; },
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementsByTagName() { return []; }, hasFocus() { return true; },
      documentElement: { className: '', clientWidth: 1024, append() {} }, body: { className: '', querySelector() { return null; } } },
    chrome: { runtime: { sendMessage: async () => null, onMessage: { addListener() {} }, getManifest: () => mf, getURL: s => s }, storage: { onChanged: { addListener() {} }, local: { get: () => new Promise(() => {}), set: async () => {} } } } });
  ctx.window.window = ctx.window;
  for (const s of mf.content_scripts.find(x => x.js.includes('content.js')).js) vm.runInContext(read(s), ctx);
  return ctx;
};

test('Arcana Lord с ролью «Spoil» от спойлера — не спойлер: точки фарма Маммона без источников спойла', () => {
  const ctx = loadCore();
  ctx.__rt = { classCur: { prof: 'human_arcana_lord', slot: 0 }, prof: 'Arcana lord', spoilStat: { ok: 1287, fail: 502, chance: 72 },
    skills: { blaze: { n: 1 } }, skillDb: { blaze: { name: 'Blaze' } } };
  const run = (rt, cfg) => { ctx.__rt = rt; ctx.__cfg = cfg; return vm.runInContext('rt = { ...DEF_RT, ...__rt }; cfg = mergeCfg(__cfg); [canSpoil(), L2V7Modules.mammon.spoilOn()]', ctx); };
  const AL = ctx.__rt, SP = { nSpoil: 'Spoil', nSpoilMass: 'Spoil Festival', mmFarmSpoil: 'auto' };
  assert.deepEqual([...run(AL, SP)], [false, false], 'маг с чужой ролью «Spoil»');
  assert.deepEqual([...run(AL, { ...SP, mmFarmSpoil: 'on' })], [false, true], 'галка «спойл: вкл» — выбор игрока');
  assert.deepEqual([...run({ ...AL, skillDb: { spoil: { name: 'Spoil' } } }, SP)], [true, true], 'Spoil в памяти умений этого класса');
  const FS = { classCur: { prof: 'dwarf_fortune_seeker', slot: 1 }, prof: 'Arcana lord' };
  assert.deepEqual([...run(FS, SP)], [true, true], 'Fortune Seeker (rt.prof от основного класса не мешает)');
  assert.deepEqual([...run(FS, { mmFarmSpoil: 'auto' })], [true, true], 'спойлер и без роли');
  // 20.46 (John22.10): крафтер со своей ролью «Спойл» учитывает источники и с пикой. Чужая роль мага выше по-прежнему запрещена.
  const WS = { classCur: { prof: 'dwarf_warsmith', slot: 2 }, prof: 'Warsmith' }, loot = vm.runInContext('L2V7Modules.loot', ctx), pike = loot.crafterPike;
  try {
    loot.crafterPike = () => false;
    assert.deepEqual([...run(WS, SP)], [true, true], 'Warsmith с дубиной');
    assert.deepEqual([...run(WS, { mmFarmSpoil: 'auto' })], [false, false], 'Warsmith без роли «Спойл»');
    loot.crafterPike = () => true;
    assert.deepEqual([...run(WS, SP)], [true, true], 'Warsmith с пикой: новый запрет по виду оружия не вводится');
  } finally { loot.crafterPike = pike; }
  // класс ещё неизвестен (старый профиль) — по роли, как раньше
  assert.deepEqual([...run({}, SP)], [true, true]);
  assert.deepEqual([...run({}, { mmFarmSpoil: 'auto' })], [false, false]);
});

test('ревью: заглушка skills.spoil {cdNet, cdFloor} (миграция v5.5.5 spoilCdMig) — не знание Spoil: Arcana Lord после classPromo2043 не спойлер', () => {
  const ctx = loadCore();
  const run = (rt, cfg) => { ctx.__rt = rt; ctx.__cfg = cfg; return vm.runInContext('rt = { ...DEF_RT, ...__rt }; cfg = mergeCfg(__cfg); [canSpoil(), L2V7Modules.mammon.spoilOn()]', ctx); };
  const SP = { nSpoil: 'Spoil', mmFarmSpoil: 'auto' }, AL = { classCur: { prof: 'human_arcana_lord', slot: 0 }, prof: 'Arcana lord' };
  // миграция v5.5.5 пишет заглушку в первый класс любого rt без spoilCdMig (новый ник, установка без базового профиля)
  assert.match(csrc, /if \(rt\.spoilCdMig !== 2\) \{ rf\.spoilCdMig = 2; S\.spoil = \{ \.\.\.\(S\.spoil \|\| \{\}\), cdNet: 0\.3, cdFloor: 0 \}/);
  const ph = { cdNet: 0.3, cdFloor: 0 };
  assert.deepEqual([...run({ ...AL, skills: { blaze: { uses: 900 }, spoil: ph } }, SP)], [false, false], 'заглушка без нажатий');
  assert.deepEqual([...run({ ...AL, skills: { spoil: { ...ph, cdFloorAt: 1 } } }, SP)], [false, false]);
  assert.deepEqual([...run({ ...AL, skills: { spoil: { ...ph, uses: 0 } } }, SP)], [false, false]);
  assert.deepEqual([...run({ ...AL, skills: { spoil: { ...ph, name: 'Spoil', uses: 12, dmgN: 0 } } }, SP)], [true, true], 'Spoil нажимали этим классом');
  // путь из ревью: заглушка у Warlock → stashPromote переносит её Arcana Lord (у наследника нет своего «spoil»)
  const { S } = mkStory();
  const P = S.stashPromote({ classCur: { prof: 'human_arcana_lord', slot: 0 }, skills: { blaze: { uses: 900 } }, subSlots: [{ slot: 0, prof: 'human_arcana_lord' }],
    classStash: { human_warlock: { skills: { blaze: { uses: 10 }, spoil: ph }, t: 1 } } });
  assert.deepEqual(Object.keys(P.active.skills).sort(), ['blaze', 'spoil'], 'заглушка переехала вместе с памятью Warlock');
  assert.deepEqual([...run({ ...AL, skills: plain(P.active.skills) }, SP)], [false, false], 'и не делает мага спойлером');
});

test('ревью: повышение BH → FS — владелец замера потерь у РБ (rbStats[id].lossOwner) тоже новый, чужие замеры не трогаем', () => {
  const rbStats = () => ({ l2dop_rb_25202: { hp: 1e6, patk: 900, loss: 500, lossContext: null, lossOwner: 'dwarf_bounty_hunter' },
    l2dop_rb_25001: { hp: 5e5, patk: 700, loss: 320, lossContext: null, lossOwner: 'human_arcana_lord' }, l2dop_rb_25010: { hp: 3e5, loss: 210 }, l2dop_rb_25020: { hp: 2e5 } });
  // 1) повышение в том же слоте
  const a = mkStory({ classCur: { prof: 'dwarf_bounty_hunter', slot: 1 }, ...bhMem(), rbStats: rbStats() });
  const before = plain(rbStats());
  a.S.charNote(ch('dwarf_fortune_seeker', 1, ['human_arcana_lord', 'dwarf_fortune_seeker']));
  const st = a.env.rt.rbStats;
  assert.equal(st.l2dop_rb_25202.lossOwner, 'dwarf_fortune_seeker', 'свой замер — новой профессии');
  assert.equal(st.l2dop_rb_25202.loss, 500); assert.equal(st.l2dop_rb_25202.hp, 1e6, 'остальное в записи РБ — как было');
  assert.deepEqual(plain(st.l2dop_rb_25001), before.l2dop_rb_25001, 'замер Arcana Lord — его');
  assert.deepEqual(plain(st.l2dop_rb_25010), before.l2dop_rb_25010, 'замер без владельца (до 20.41) не трогаем');
  assert.deepEqual(plain(st.l2dop_rb_25020), before.l2dop_rb_25020);
  // нечего менять — rbStats в патч не попадает
  const b = mkStory({ classCur: { prof: 'human_warlock', slot: 0 }, rbStats: { x: { loss: 1, lossOwner: 'dwarf_bounty_hunter' } } });
  const sets = []; const set0 = b.env.setRt; b.env.setRt = async p => { sets.push(Object.keys(p)); return set0(p); };
  b.S.charNote(ch('human_arcana_lord', 0, ['human_arcana_lord', 'dwarf_bounty_hunter']));
  assert.equal(b.env.rt.classCur.prof, 'human_arcana_lord'); assert.ok(!sets.flat().includes('rbStats'));
  // 2) повысили, пока был активен другой класс: AL → FS, мёртвая запись BH в тайнике
  const c = mkStory({ classCur: { prof: 'human_arcana_lord', slot: 0 }, ...arcanaMem(), classStash: { dwarf_bounty_hunter: { ...bhMem(), t: NOW - 7200000 } }, rbStats: rbStats() });
  c.S.charNote(ch('dwarf_fortune_seeker', 1, ['human_arcana_lord', 'dwarf_fortune_seeker']));
  assert.equal(c.env.rt.classCur.prof, 'dwarf_fortune_seeker');
  assert.equal(c.env.rt.rbStats.l2dop_rb_25202.lossOwner, 'dwarf_fortune_seeker'); assert.equal(c.env.rt.rbStats.l2dop_rb_25001.lossOwner, 'human_arcana_lord');
  // обычная смена класса — владельцы замеров прежние
  const d = mkStory({ classCur: { prof: 'dwarf_fortune_seeker', slot: 1 }, rbStats: rbStats() });
  d.S.charNote(ch('human_arcana_lord', 0, ['human_arcana_lord', 'dwarf_fortune_seeker']));
  assert.deepEqual(plain(d.env.rt.rbStats), before);
  // 3) once classPromo2043 (stashPromote): тайник из лога 21.10 — BH → FS и Warlock → Arcana Lord
  const { S } = mkStory();
  const src = { classCur: { prof: 'dwarf_warsmith', slot: 2 }, subSlots: [{ slot: 0, prof: 'human_arcana_lord' }, { slot: 1, prof: 'dwarf_fortune_seeker' }, { slot: 2, prof: 'dwarf_warsmith' }],
    classStash: { human_arcana_lord: arcanaMem(), human_warlock: warlockMem(), dwarf_bounty_hunter: bhMem(), dwarf_fortune_seeker: { skills: {} } },
    rbStats: { ...rbStats(), l2dop_rb_25030: { loss: 90, lossOwner: 'human_warlock' }, l2dop_rb_25040: { loss: 80, lossOwner: 'dwarf_warsmith' } } };
  const snap = plain(src), P = S.stashPromote(src);
  assert.deepEqual(plain(src), snap, 'снимок rt не меняется');
  assert.equal(P.rbStats.l2dop_rb_25202.lossOwner, 'dwarf_fortune_seeker'); assert.equal(P.rbStats.l2dop_rb_25030.lossOwner, 'human_arcana_lord');
  assert.equal(P.rbStats.l2dop_rb_25001.lossOwner, 'human_arcana_lord'); assert.equal(P.rbStats.l2dop_rb_25040.lossOwner, 'dwarf_warsmith', 'активный Warsmith — его');
  assert.deepEqual(plain(P.rbStats.l2dop_rb_25010), before.l2dop_rb_25010);
  assert.ok(!('rbStats' in S.stashPromote({ ...src, rbStats: { x: { loss: 1, lossOwner: 'dwarf_warsmith' } } })), 'нечего менять — без rbStats');
  // content.js: тело once пишет P.rbStats в rf
  const a0 = csrc.indexOf("  once('classPromo2043'"), b0 = csrc.indexOf('\n  });\n', a0), body = csrc.slice(a0, b0 + 6);
  const m = { rt: src, rf: {}, cf: {}, S: {}, sk: false, L2V7Modules: { story: S }, rec() {}, Object, JSON };
  vm.runInNewContext('const once = (flag, fn) => { if (!rt[flag] && !rf[flag]) { rf[flag] = 1; cf[flag] = 1; fn(); } };\n' + body, m);
  assert.equal(m.rf.rbStats.l2dop_rb_25202.lossOwner, 'dwarf_fortune_seeker'); assert.equal(m.rf.rbStats.l2dop_rb_25030.lossOwner, 'human_arcana_lord');
  // rf.rbStats от более ранних миграций того же запуска (rbStats925 и др.) — основа: once видит { ...rt, ...rf }
  const m2 = { rt: src, rf: { rbStats: { y: { loss: 7, lossOwner: 'dwarf_bounty_hunter' } } }, cf: {}, S: {}, sk: false, L2V7Modules: { story: S }, rec() {}, Object, JSON };
  vm.runInNewContext('const once = (flag, fn) => { if (!rt[flag] && !rf[flag]) { rf[flag] = 1; cf[flag] = 1; fn(); } };\n' + body, m2);
  assert.deepEqual(plain(m2.rf.rbStats), { y: { loss: 7, lossOwner: 'dwarf_fortune_seeker' } });
});

test('журнал: «состояние размер …» — раз в 30 мин на вкладку, метка переживает загрузку страницы', () => {
  const ss = new Map(), store = { getItem: k => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)) };
  // объявление метки читается из sessionStorage
  const decl = csrc.match(/\nlet rtBigWarnT = [^\n]+/)[0], key = csrc.match(/const RT_BIG_SS = '([^']+)'/)[1];
  const page = () => { const c = { sessionStorage: store }; vm.runInNewContext("const RT_BIG_SS = '" + key + "';" + decl + '\nglobalThis.__t = rtBigWarnT;', c); return c.__t; };
  assert.equal(page(), 0, 'новая вкладка — строка сразу');
  ss.set(key, '1700000000000'); assert.equal(page(), 1700000000000, 'следующая страница помнит время строки');
  const broken = {}; Object.defineProperty(broken, 'sessionStorage', { get() { throw new Error('denied'); } });
  vm.runInNewContext("const RT_BIG_SS = 'k';" + decl + '\nglobalThis.__t = rtBigWarnT;', broken); assert.equal(broken.__t, 0, 'хранилище недоступно — 0, без падения');
  // setRt: строка ставит метку в sessionStorage; вторая «страница» (новый документ, та же вкладка) строку не пишет
  const a = csrc.indexOf('function setRt(p) {'), b = csrc.indexOf('\n}\n', a);
  const setRtSrc = csrc.slice(a, b + 2);
  const recs = [];
  const doc = () => {
    const c = { sessionStorage: store, RT_BIG_SS: key, rt: { char: 'Warlock', zoneStat: { big: 'x'.repeat(400000) } }   /* 20.62: classStash в размер rt больше не входит (ключ stash) — наполнитель другой */, rtSizeT: 0, RT_BULKY: ['spawns'], RT_STAT_SOON: new Set(), tabIdle: false, document: {},
      rec: (...x) => recs.push(x.join(' ')), rtSizeTop: () => '', rtWriter: { enqueue: async () => ({ ok: true }), defer: async () => ({ ok: true }) }, Date, JSON, Object, Math, Promise };
    vm.runInNewContext(decl.replace(/^\nlet /, 'var ') + '\n' + setRtSrc + '\nsetRt({ x: 1 });', c); return c;
  };
  ss.clear(); doc(); assert.equal(recs.filter(x => /размер \d+ КБ/.test(x)).length, 1, 'первая загрузка — строка');
  assert.ok(+ss.get(key) > 0, 'время строки — в sessionStorage');
  doc(); doc(); assert.equal(recs.filter(x => /размер \d+ КБ/.test(x)).length, 1, 'следующие страницы в течение 30 мин — без строки');
  ss.set(key, String(Date.now() - 31 * 60000)); doc(); assert.equal(recs.filter(x => /размер \d+ КБ/.test(x)).length, 2, 'через 30 мин — снова');
});
