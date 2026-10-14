'use strict';
// 10.0.7 (игрок 13.10 03:20: «в катакомбах не работает кнопка охотиться дальше»; лог 13.10 13:21: «Возврат на карту» из боя
// sdms_necropolis_of_devotion_078 → /map.html → «назад в Necropolis of Devotion»): код игры battle.js — в подземелье отказ сервера на
// hunt-continue игра не показывает, а молча уводит на /dungeon.html; «Назад на карту» из боя в подземелье тоже ведёт на /dungeon.html.
// Бот: из боя в подземелье — сразу на страницу подземелья (не карта + 8 с ожидания), отказ «Охотиться дальше» — в журнал с ответом сервера,
// «авто» не уводит героя из подземелья, где он уже стоит; текст ошибки загрузки боя — в журнал
const assert = require('node:assert/strict');
const { vm, read } = require('./epic-harness.cjs');

const NAV = read('modules/navigation.js'), DUN = read('modules/dungeons.js'), MOB = read('modules/mobfarm.js'), COMBAT = read('modules/combat.js'), content = read('content.js');
const sandbox = (loc, extra = {}) => { const sb = { console, Date, Math, JSON, URLSearchParams, CSS: { escape: s => s }, location: loc, document: { querySelector: () => null, querySelectorAll: () => [] }, ...extra }; sb.globalThis = sb; return sb; };

(async () => {
  // ---------- 1. toMap из боя в подземелье → страница подземелья, не карта ----------
  {
    const loc = { pathname: '/battle.html', search: '?spawnId=sdms_necropolis_of_devotion_078', href: '' };
    const sb = sandbox(loc); vm.runInNewContext(NAV, sb);
    // 10.0.13: игровая кнопка сначала закрывает бой, затем сама возвращает в подземелье.
    const st = [], env = { cfg: { catMode: true }, rt: {}, on: true, $q: s => s === '#battle-back-map' ? { id: 'battle-back-map' } : null, fire: el => { env.fired = el; if (env.cfg.catMode && /spawnId=sdms_/.test(loc.search)) { loc.pathname = '/dungeon.html'; loc.href = '/dungeon.html?dungeonId=necropolis_of_devotion'; } return true; }, setStatus: s => st.push(s), sleep: async () => {}, waitFor: async f => f() || null, byText: () => null, BACK: /x/, heroAt: () => ({ dung: 'necropolis_of_devotion', t: Date.now() }) };
    const M = sb.L2V7Factories.navigation(env);
    assert.equal(M.dungeonOfBattle(), 'necropolis_of_devotion', 'dungeon id from the spawnId');
    await M.toMap();
    assert.equal(loc.href, '/dungeon.html?dungeonId=necropolis_of_devotion', 'straight back to the dungeon page');
    assert.equal(env.fired?.id, 'battle-back-map', '«Назад на карту» closes the battle before returning'); assert.deepEqual(st, ['Возврат в подземелье']);
    // обычный бой (dense_…) — как прежде: кнопка «Назад на карту»
    loc.pathname = '/battle.html'; loc.search = '?spawnId=dense_25957'; loc.href = ''; env.fired = undefined;
    await M.toMap();
    assert.equal(env.fired?.id, 'battle-back-map', 'ordinary fight → the map button'); assert.equal(loc.href, '/map.html', 'map forced when the page did not change (isMap false in the test)');
    // катакомбы выключены — старое поведение даже при sdms_
    loc.search = '?spawnId=sdms_necropolis_of_devotion_078'; loc.href = ''; env.fired = undefined; env.cfg.catMode = false;
    await M.toMap(); assert.equal(env.fired?.id, 'battle-back-map', 'catMode off → old path');
  }
  // ---------- 2. catTarget «авто»: герой стоит в подземелье по уровню — остаёмся в нём ----------
  {
    const sb = sandbox({ pathname: '/battle.html', search: '', href: '' }); vm.runInNewContext(DUN, sb);
    const CAT_LIST = { necropolis_of_devotion: ['Necropolis of Devotion', 60, 70], necropolis_of_martyrdom: ['Necropolis of Martyrdom', 60, 70], catacomb_of_the_witch: ['Catacomb of the Witch', 60, 72], catacomb_of_dark_omens: ['Catacomb of Dark Omens', 70, 80] };
    const env = { CAT_URL: '/catacombs.html', CAT_LIST, cfg: { catDungeon: 'auto' }, rt: { catCur: 'necropolis_of_devotion' }, heroLvl: () => 67, heroAt: () => ({ dung: 'necropolis_of_martyrdom', t: Date.now() }) };
    const M = sb.L2V7Factories.dungeons(env);
    assert.equal(M.catTarget(), 'necropolis_of_martyrdom', 'the dungeon the hero is in wins among equals');
    env.heroAt = () => ({ dung: 'catacomb_of_dark_omens', t: Date.now() });
    assert.equal(M.catTarget(), 'necropolis_of_devotion', 'a dungeon out of the level window does not hold the hero');
    env.heroAt = () => null;
    assert.equal(M.catTarget(), 'necropolis_of_devotion', 'no snapshot → catCur as before');
    env.cfg.catDungeon = 'catacomb_of_the_witch'; env.heroAt = () => ({ dung: 'necropolis_of_martyrdom', t: Date.now() });
    assert.equal(M.catTarget(), 'catacomb_of_the_witch', 'a dungeon chosen by hand always wins');
  }
  // ---------- 3. nextFight в подземелье: игра увела на /dungeon.html после «Охотиться дальше» → журнал с ответом сервера, catGo ----------
  {
    const i0 = MOB.indexOf("  if (env.cfg.catMode && !env.campOn() && !env.huntOn()) {"), i1 = MOB.indexOf("  if (env.campOn() && env.rt.campaignDue) return env.goCampaign();", i0);
    assert.ok(i0 > 0 && i1 > i0, 'catacomb block of nextFight found');
    const block = MOB.slice(i0, i1);
    const loc = { pathname: '/battle.html', search: '?spawnId=sdms_necropolis_of_devotion_078', href: 'https://l2wap.com/battle.html?spawnId=sdms_necropolis_of_devotion_078' };
    const run = async ({ err, goesTo = 'dungeon' } = {}) => {
      const logs = [], env = { cfg: { catMode: true, chain: true }, rt: { catIn: 'necropolis_of_devotion' }, on: true, campOn: () => false, huntOn: () => false, $q: () => ({ id: 'battle-victory-hunt' }), shown: () => true,
        waitFor: async f => f() || null, setStatus() {}, setRt: p => Object.assign(env.rt, p), rec: (...a) => logs.push(a.slice(1).join(': ')), victory: () => true, mobHp: () => null, actNet: () => ({}),
        NET_ERR: err ? { t: Date.now() + 1000, err, path: '/game/battle/hunt-continue' } : { t: 0 }, catGo: async () => { env.cat = (env.cat || 0) + 1; return 'cat'; },
        fire: () => { if (goesTo === 'dungeon') { loc.pathname = '/dungeon.html'; loc.href = 'https://l2wap.com/dungeon.html?dungeonId=necropolis_of_devotion'; } else { loc.href = 'https://l2wap.com/battle.html?spawnId=sdms_necropolis_of_devotion_090'; } return true; } };
      const sb = { env, location: loc, Date, String, console }; sb.globalThis = sb;
      vm.runInNewContext(`this.nf = async () => {\n${block}\n return 'fallthrough'; };`, sb);
      const r = await sb.nf(); return { r, logs, env };
    };
    loc.pathname = '/battle.html';
    const a = await run({ err: 'battle_hunt_not_available_in_dungeon' });
    assert.equal(a.r, 'cat', 'game went to the dungeon page → next mob from the dungeon list (catGo)');
    assert.equal(a.logs.length, 1); assert.match(a.logs[0], /«Охотиться дальше» в подземелье не сработало \(сервер: battle_hunt_not_available_in_dungeon\)/);
    assert.ok(a.env.rt.catHuntNoteT > 0, 'note throttled');
    loc.pathname = '/battle.html';
    const b = await run({ goesTo: 'battle' });
    assert.equal(b.r, undefined, 'a new fight started → chain continues'); assert.equal(b.logs.length, 0);
  }
  // ---------- 4. combat: бой не открылся — текст ошибки игры в журнале; геттеры ----------
  assert.match(COMBAT, /if \(st === 'err'\) \{[\s\S]*?#battle-load-err[\s\S]*?бой не открылся: «\$\{txt\.slice\(0, 120\) \|\| 'без текста'\}»[\s\S]*?return env\.toMap\(\);/, 'load error text goes to the journal before toMap');
  assert.match(content, /L2V7Modules\.navigation = L2V7Factories\.navigation\(\{ get heroAt\(\) \{ return heroAt; \}/, 'navigation gets heroAt');
  // 10.0.15: Warlock lazy getters добавлены перед NET_ERR; принадлежность фабрике сохраняется.
  assert.match(content.match(/L2V7Modules\.mobfarm = L2V7Factories\.mobfarm\(\{([\s\S]*?)\}\);/)?.[1] || '', /get NET_ERR\(\) \{ return NET_ERR; \}/, 'mobfarm gets NET_ERR');
  console.log('v1007-catacomb-hunt: PASS');
})().catch(e => { console.error(e); process.exit(1); });
