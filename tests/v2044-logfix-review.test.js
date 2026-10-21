'use strict';
// 20.44 (итоговая проверка сведённых правок по логам 21.10 13:21/13:30): два подтверждённых замечания.
//  1) Спойл выбирал Spoil Crush по устаревшей записи «надето» (оружие сменили вне этой вкладки), хотя игра (свой GET /character,
//     rt.weaponAug.w) уже показывала пику: каждый бой — отказ Crush, и ожидание Festival у пики не работало. Теперь спойл берёт
//     оружие через combat.combatWeaponLive — то же правило, что запрет умений по виду оружия (weaponBarred).
//  2) Повышение профессии (Bounty Hunter → Fortune Seeker) после запоздалого ответа /character со старой профессией: «смена класса»
//     убрала настоящую память в тайник, а следующее повышение её не возвращало. Теперь возвращает (своё в тайнике важнее).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const plain = o => JSON.parse(JSON.stringify(o));

function combat(rt) {
  const box = { console, Date, document: { querySelectorAll: () => [] }, location: { search: '?spawnId=one' } };
  vm.runInNewContext(read('modules/combat.js'), box);
  return box.L2V7Factories.combat({ rt, cfg: {} });
}
test('combatWeaponLive: игра показывает в руке другое и не раньше записи — оружие неизвестно; иначе — запись', () => {
  const rec = { id: 2503, inst: 'eq:l1', ench: 4, where: 'надето', wt: 'двуруч. дубина' };
  const rt = { weaponsT: 5, weapons: [rec] }, C = combat(rt);
  assert.equal(C.combatWeaponLive().id, 2503, 'живой руки нет — запись');
  rt.weaponAug = { w: 2503, t: 10 }; assert.equal(C.combatWeaponLive().id, 2503, 'рука = записи');
  rt.weaponAug = { w: 299, t: 10 }; assert.equal(C.combatWeaponLive(), null, 'в руке пика новее записи');
  rt.weaponAug = { w: 299, t: 1 }; assert.equal(C.combatWeaponLive().id, 2503, 'рука старше записи (своё надевание) — запись');
  assert.equal(C.combatWeapon().id, 2503, 'combatWeapon не изменился');
});
test('спойл и запрет умений по виду оружия берут одно и то же «живое» оружие', () => {
  const content = read('content.js'), combatSrc = read('modules/combat.js');
  assert.match(content, /L2V7Modules\.loot = L2V7Factories\.loot\(\{ get weaponNow\(\)\{return \(\)=>L2V7Modules\.combat\?\.combatWeaponLive\?\.\(\)\}/);
  const wb = combatSrc.slice(combatSrc.indexOf('function weaponBarred(b)'), combatSrc.indexOf('function refreshWeaponBlocks'));
  assert.match(wb, /const w = combatWeaponLive\(\);/);
});
test('оружие неизвестно (запись устарела): Crush не первым и без ожидания Crush, пика ждёт Festival', async () => {
  const names = s => String(s || '').toLowerCase().split(/[,|]/).map(x => x.trim()).filter(Boolean);
  const cleanTitle = t => (t || '').split(/\s+[—–-]\s+|\s*\(/)[0].trim();
  const solo = { title: 'Spoil', id: 'l2_254', cd: 0 }, crush = { title: 'Spoil Crush', id: 'l2_348', cd: 0 }, mass = { title: 'Spoil Festival', id: 'l2_302', cd: 0.6 };
  const slots = [solo, crush, mass], calls = [], lines = [];
  const slotsBy = str => { const alts = names(str); return slots.filter(b => alts.some(a => b.title.toLowerCase().startsWith(a))); };
  const env = { cfg: { nSpoil: 'Spoil', nSpoilMass: 'Spoil Festival' }, rt: { char: 'FS' }, weaponNow: () => null, roleNow: () => 'spoiler',
    names, slotsBy, cleanTitle, extraMobs: () => [], ready: b => !(b.cd > 0), cdLeft: b => b.cd > 0 ? b.cd : 0,
    sleep: async ms => { for (const b of slots) b.cd = Math.max(0, +(b.cd - ms / 1000).toFixed(3)); },
    meMp: () => ({ cur: 2000, max: 2060 }), skillMp: n => /festival/i.test(n) ? 194 : 67, logLines: () => lines.slice(), newLines: (a, b) => b.slice(a.length),
    mobSpoiled: () => false, nameLike: () => false, SPOIL_OK: /успіх|успіш/i, SPOIL_FAIL: /не вдав/i, SPOIL_LOOT: /^Спойл\s*:?\s*(.+?)\s*×\s*(\d+)/i,
    waitFor: async fn => fn(), noticeText: () => '', rec() {}, setRt: async p => Object.assign(env.rt, p), $q: () => null };
  const box = { console, URLSearchParams, Date, Math, location: { search: '?spawnId=dense_1' }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  vm.runInNewContext(read('modules/loot.js'), box);
  const L = box.L2V7Factories.loot(env), ctx = { block: {}, name: 'Buffalo', max: 3000 }, mob = { cur: 3000, max: 3000 };
  const act = async b => { calls.push(b.id); b.cd = 2; lines.push(b === mass ? 'Spoil Festival: Buffalo: успіх (100%)' : 'Спойл успішний'); return true; };
  assert.equal(L.crushFirst(ctx, mob), false);
  for (let i = 0; i < 40 && !calls.length; i++) await L.spoilStep(ctx, act, mob);
  assert.deepEqual(calls, ['l2_302'], 'подождали Festival, Crush не жали');
});

function story(rt) {
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, isFinite, location: { pathname: '/map.html', href: '' }, sessionStorage: { setItem() {} } };
  sb.globalThis = sb; vm.runInNewContext(read('modules/story.js'), sb);
  const recs = [], env = { rt: { ...rt }, cfg: {}, recs, setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus() {}, sleep: async () => {},
    waitX: async fn => fn(), fire: () => true, $q: () => null, isBattle: () => false, fishNow: () => false, autonomyMode: () => 'hunt', awayFree: () => true, classSwitched() {},
    gameGet: async () => ({ ok: false, status: 401, json: async () => ({}) }) };
  return { env, S: sb.L2V7Factories.story(env) };
}
const ch = (prof, active, slots) => ({ name: 'Warlock', level: 76, l2Profession: prof, classBranch: 'fighter',
  classSlots: { activeSlot: active, slots: [0, 1, 2, 3].map(i => ({ slot: i, owned: !!slots[i], active: i === active, profession: slots[i] || null, race: null, level: slots[i] ? 76 : null })) } });
test('запоздалый ответ со старой профессией и снова новая: память Fortune Seeker возвращается из тайника', () => {
  const fs = { skills: { whirlwind: { n: 1200, dmg: 9.1e6, dmgN: 900 } }, zoneStat: { forsaken: { 75: { exp: 9e6 } } }, rbDps: 2400, rbDpsOwner: 'dwarf_fortune_seeker' };
  const { env, S } = story({ char: 'Warlock', classCur: { prof: 'dwarf_fortune_seeker', slot: 1, t: 1 }, classStash: { human_arcana_lord: { skills: { blaze: { n: 900 } }, t: 1 } }, ...fs });
  S.charNote(ch('dwarf_bounty_hunter', 1, ['human_arcana_lord', 'dwarf_bounty_hunter']));     // запоздалый ответ: на миг «Bounty Hunter»
  assert.equal(env.rt.classCur.prof, 'dwarf_bounty_hunter');
  assert.ok(env.rt.classStash.dwarf_fortune_seeker?.skills?.whirlwind, 'смена класса убрала память FS в тайник');
  env.rt.skills = { ...(env.rt.skills || {}), 'spoil festival': { n: 3 } };                   // пара боёв «на старой профессии»
  S.charNote(ch('dwarf_fortune_seeker', 1, ['human_arcana_lord', 'dwarf_fortune_seeker']));    // свежий ответ: снова Fortune Seeker
  assert.equal(env.rt.classCur.prof, 'dwarf_fortune_seeker');
  assert.equal(env.rt.skills.whirlwind.n, 1200, 'замеры FS снова живые');
  assert.equal(env.rt.skills['spoil festival'].n, 3, 'новое из промежутка не потеряно');
  assert.equal(env.rt.zoneStat.forsaken[75].exp, 9e6);
  assert.equal(env.rt.rbDps, 2400); assert.equal(env.rt.rbDpsOwner, 'dwarf_fortune_seeker');
  assert.equal('dwarf_fortune_seeker' in env.rt.classStash, false, 'тайник FS опустел');
  assert.ok(env.rt.classStash.human_arcana_lord, 'чужие классы в тайнике не трогаем');
  assert.ok(env.recs.some(r => /профессия: Bounty Hunter → Fortune Seeker/.test(r)), env.recs.join('\n'));
});
test('обычное повышение без памяти в тайнике — как раньше (тайник не трогаем)', () => {
  const { env, S } = story({ char: 'Warlock', classCur: { prof: 'dwarf_bounty_hunter', slot: 1, t: 1 }, classStash: { human_arcana_lord: { t: 1 } }, skills: { whirlwind: { n: 5 } } });
  S.charNote(ch('dwarf_fortune_seeker', 1, ['human_arcana_lord', 'dwarf_fortune_seeker']));
  assert.equal(env.rt.skills.whirlwind.n, 5);
  assert.deepEqual(plain(env.rt.classStash), { human_arcana_lord: { t: 1 } });
});
