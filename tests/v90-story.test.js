'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 9.0 (новости игры 11.10: сабклассы и квест Noblesse; игрок: «делай»): прогресс квестов сабкласса и Noblesse из ответов игры, сдача готовой
// части у NPC (телепорт за адену в пределах лимита), РБ квеста — первыми в туре, свой Noblesse Blessing не покупается за FA, смена класса
// уносит замеры старого класса в rt.classStash
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/story.js');
const RAW_N = JSON.parse(read('kb/raw/sq-noblesse.json')).data.quest, RAW_S = JSON.parse(read('kb/raw/sq-subclass.json')).data.quest;
const mk = (rt = {}, cfg = {}, over = {}) => {
  const recs = [], fired = [], els = over.els || {}, loc = over.location || { pathname: '/map.html', href: '' };
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, isFinite, location: loc, sessionStorage: { setItem() {} } }; sb.globalThis = sb;
  vm.runInNewContext(src, sb);
  let sw = 0;
  const env = { rt: { ...rt }, cfg: { storyTurnIn: true, storyTpMax: 100000, ...cfg }, recs, fired,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {},
    // 10.0.14: как core.fire, успешный клик возвращает true; false откатывает резерв неподтверждённого телепорта.
    waitX: async fn => fn(), fire: el => { fired.push(el); el.onFire?.(); return true; }, $q: s => els[s] ?? null, isBattle: () => false, fishNow: () => false,
    autonomyMode: () => 'hunt', awayFree: () => true, classSwitched: () => { sw++; },
    gameGet: over.gameGet || (async () => ({ ok: false, status: 401, json: async () => ({}) })), ...over.env };
  return { env, S: sb.L2V7Factories.story(env), sw: () => sw, loc };
};
const active = (o = {}) => ({ ...RAW_N, part: 1, active: true, subclassLevel: 52, targets: [
  { name: 'Vanor Silenos Chieftain', level: 50, have: 37, need: 100, teleportId: 'coliseum' }, { name: 'Varnish', have: 100, need: 100, teleportId: '' }], ...o });
(async () => {
  // 1. живой ответ 11.10 (квест не взят, сабкласса нет): запись, строка в журнал, повтор того же ответа не пишется
  { const { env, S } = mk();
    const s = S.qNote('noblesse', RAW_N);
    assert.equal(s.active, false); assert.equal(s.canAccept, false); assert.equal(s.npcTp, 'rune'); assert.equal(env.rt.story.noblesse.part, 0);
    assert.ok(env.recs.some(r => /Noblesse: не взят/.test(r)));
    const n = env.recs.length; S.qNote('noblesse', RAW_N); assert.equal(env.recs.length, n, 'same answer → no new line');
    const c = S.qNote('subclass', RAW_S);
    assert.equal(c.stage, 'not_started'); assert.equal(c.min, 75); assert.equal(c.bosses.length, 4); assert.equal(c.npcTp, 'oren');
    assert.ok(env.recs.some(r => /сабкласс: не взят \(нужен 75 ур\.\)/.test(r))); }
  // 2. часть 1: ★ цели квеста (не снимать), готово → сдать; уже пробовали / выключено / пройден → нет
  { const { env, S } = mk();
    S.qNote('noblesse', active());
    assert.equal(JSON.stringify(S.openNames()), JSON.stringify(['vanor silenos chieftain']));
    assert.equal(S.want(), null, 'not ready');
    S.qNote('noblesse', active({ targets: [{ name: 'Vanor Silenos Chieftain', have: 100, need: 100 }, { name: 'Varnish', have: 100, need: 100 }], actions: { canAccept: false, canAdvance: true } }));
    assert.equal(S.openNames().length, 0);
    const w = S.want(); assert.equal(w.kind, 'noblesse'); assert.equal(w.key, 'noblesse:1');
    env.cfg.storyTurnIn = false; assert.equal(S.want(), null, 'switched off'); env.cfg.storyTurnIn = true;
    env.rt.storyTried = { 'noblesse:1': Date.now() }; assert.equal(S.want(), null, 'tried 30 min ago'); env.rt.storyTried = {};
    // 10.0: точка возврата неизвестна или «out:…» — не сдаём (бот не вернулся бы), известна — идём
    assert.equal(await S.storyStep(), false, 'no home spot'); env.rt.zone = 'out:Vanor'; assert.equal(await S.storyStep(), false, 'out: spot has no teleport'); env.rt.zone = 'coliseum';
    assert.equal(S.chainWant()?.kind, 'noblesse', 'after a win in the chain — go to the map for it');
    assert.equal(await S.storyStep(), true); assert.equal(env.rt.storyJob.kind, 'noblesse'); assert.ok(env.rt.storyTried['noblesse:1']);
    env.rt.storyJob = null;
    const { env: e2, S: S2 } = mk(); S2.qNote('noblesse', active({ part: 4, completed: true, actions: { canAdvance: true } })); assert.equal(S2.want(), null, 'completed');
    const { S: S3, env: e3 } = mk(); e3.awayFree = () => false; S3.qNote('noblesse', active({ actions: { canAdvance: true } })); assert.equal(await S3.storyStep(), false, 'busy (battle/tour) → not now'); }
  // 3. РБ квестов: 4 босса сабкласса (не убитые) и РБ части Noblesse по имени из rbList
  { const { env, S } = mk({ rbList: { l2dop_rb_25325: { name: 'Flame of Splendor Barakiel', lvl: 70 }, l2dop_rb_1: { name: 'Other', lvl: 70 } } });
    S.qNote('subclass', { ...RAW_S, stage: 'hunt_bosses', bosses: RAW_S.bosses.map((b, i) => ({ ...b, done: i === 0 })) });
    assert.equal(JSON.stringify(S.rbIds().sort()), JSON.stringify(['l2dop_rb_25054', 'l2dop_rb_25126', 'l2dop_rb_25220']));
    S.qNote('noblesse', active({ part: 3, targets: [{ name: 'Flame of Splendor Barakiel', level: 70, have: 0, need: 1, teleportId: '' }] }));
    assert.ok(S.rbIds().includes('l2dop_rb_25325')); assert.ok(!S.rbIds().includes('l2dop_rb_1')); }
  // 4. смена класса: замеры старого — в stash, нового — из stash или пусто; назад — вернулись; кот/баффы не «смерть»
  { const { env, S, sw } = mk({ skills: { a: 1 }, petStat: { kai: 5 }, zoneStat: { z: 1 }, rbDb: { r: 1 }, spawns: { s: 1 }, faSnap: { t: 1 } });
    S.charNote({ l2Profession: 'human_warlock', classSlots: { activeSlot: 0 }, level: 61, noblesse: false });
    assert.equal(env.rt.classCur.prof, 'human_warlock'); assert.equal(sw(), 0, 'first sight — no switch');
    S.charNote({ l2Profession: 'dwarf_bounty_hunter', classSlots: { activeSlot: 1 }, level: 40 });
    assert.equal(sw(), 1); assert.equal(env.rt.classCur.prof, 'dwarf_bounty_hunter');
    assert.equal(env.rt.skills, null); assert.equal(env.rt.petStat, null); assert.equal(env.rt.rbDb, null); assert.equal(env.rt.faSnap, null);
    assert.equal(JSON.stringify(env.rt.spawns), JSON.stringify({ s: 1 }), 'shared world memory stays');
    assert.equal(JSON.stringify(env.rt.classStash.human_warlock.skills), JSON.stringify({ a: 1 }));
    assert.ok(env.recs.some(r => /смена класса: Warlock → Bounty Hunter 40 ур\..*с нуля/.test(r)));
    env.rt.skills = { b: 2 };
    S.charNote({ l2Profession: 'human_warlock', classSlots: { activeSlot: 0 }, level: 61 });
    assert.equal(JSON.stringify(env.rt.skills), JSON.stringify({ a: 1 })); assert.equal(JSON.stringify(env.rt.zoneStat), JSON.stringify({ z: 1 }));
    assert.equal(JSON.stringify(env.rt.classStash.dwarf_bounty_hunter.skills), JSON.stringify({ b: 2 })); assert.ok(!env.rt.classStash.human_warlock);
    assert.ok(env.recs.some(r => /свои с прошлого раза/.test(r)));
    S.charNote({ l2Profession: 'human_warlock', noblesse: true }); assert.equal(env.rt.story.nobleOwn, true);
    assert.ok(env.recs.some(r => /статус Noblesse получен/.test(r))); }
  // 5. сдача на странице квеста: «Завершить часть» → нажата; телепорт: цена известна и в лимите → летим; дороже / неизвестна — нет
  { const mkBtn = (attrs, onFire) => ({ dataset: attrs, onFire });
    const page = (btns) => { const box = { children: btns, querySelector: s => btns.find(b => s.includes(`"${b.act}"`)) || null };
      return { '#noblesse-quest-actions': box, '#noblesse-quest-err': { textContent: '' } }; };
    const loc = { pathname: '/noblesse-quest.html', href: '' };
    const adv = { act: 'advance', dataset: {} }, btns = [adv]; adv.onFire = () => btns.splice(0);
    const { env, S } = mk({}, {}, { location: loc, els: page(btns) });
    env.rt.storyJob = { kind: 'noblesse', why: 'часть 1', t: Date.now() }; await S.step(env.rt.storyJob);
    assert.equal(env.fired.length, 1); assert.ok(env.recs.some(r => /Noblesse: ✓ часть сдана/.test(r)));
    const tpCase = async (cost, max) => {
      const tp = { act: 'teleport', dataset: { noblesseTarget: 'rune' } };
      const gg = async p => ({ ok: p === '/game/teleport/locations' && cost != null, status: 200, json: async () => ({ locations: [{ teleportId: 'rune', adenaCost: cost, vipFreeApplied: false }] }) });
      const r = mk({}, { storyTpMax: max }, { location: { pathname: '/noblesse-quest.html' }, els: page([tp]), gameGet: gg });
      require('./helpers/story-payments.cjs')(r.env);
      r.env.rt.storyJob = { kind: 'noblesse', key:'noblesse:1', why: 'часть 1', t: Date.now() }; await r.S.step(r.env.rt.storyJob);
      return r; };
    let r = await tpCase(20000, 100000); assert.equal(r.env.fired.length, 1, 'price ok → teleport'); assert.ok(r.env.rt.storyJob?.tpT);
    r = await tpCase(200000, 100000); assert.equal(r.env.fired.length, 0, 'over the limit'); assert.ok(r.env.recs.some(x => /дороже лимита/.test(x)));
    r = await tpCase(null, 100000); assert.equal(r.env.fired.length, 0, 'unknown price'); assert.ok(r.env.recs.some(x => /неизвестна/.test(x))); }
  // 6. связка с ядром: модуль подключён до content.js, геттеры, ответы игры, шаг цикла, ★ не снимаются, FA-Noblesse, РБ квеста в туре
  { const mf = JSON.parse(read('manifest.json')), js = mf.content_scripts.find(s => s.js.includes('content.js')).js;
    assert.ok(js.indexOf('modules/story.js') >= 0 && js.indexOf('modules/story.js') < js.indexOf('content.js'));
    const c = (read('defaults.js') + '\n' + read('content.js')), b = read('modules/buffs.js'), rd = read('modules/raid.js');
    assert.match(c, /L2V7Modules\.story = L2V7Factories\.story\(/);
    assert.match(c, /story-quests\\\/\(noblesse\|subclass\)/); assert.match(c, /story-quests\\\/\[\\w-\]\+\(\?:\\\/\\w\+\)\?\)\$\/\.test\(path\)\) L2V7Modules\.story\.charNote\(ch\)/, 'own hero only (path-limited)');
    assert.match(c, /L2V7Modules\.story\.storyTick\(\)[\s\S]{0,200}L2V7Modules\.story\.storyStep\(\)/);
    assert.match(c, /rt\.story\?\.noblesse, open = \[\.\.\.\(rt\.profQuest\?\.open/);
    assert.match(c, /storyTurnIn: true, storyTpMax: 100000/); assert.match((read('defaults.js') + '\n' + read('popup.js')), /storyTurnIn: true, storyTpMax: 100000/);
    assert.match(read('base-profile.json'), /"storyTurnIn":true,"storyTpMax":100000/);
    assert.match(b, /if \(env\.rt\.story\?\.nobleOwn\) ids = ids\.filter\(id => id !== 1323\)/);
    assert.match(b, /env\.rt\.story\?\.nobleOwn && env\.slotsBy\('noblesse blessing'\)\[0\]/);
    // 14.10: квестовый приоритет теперь внутри одного уровня; поведение проверяет v1016-raid-tour-selection.
    assert.match(rd, /quests = env\.storyRbIds\?\.\(\) \|\| \[\]/);
    assert.match(rd, /quests\.includes\(id\) \? \{ quest: true \}/);
    assert.match(c, /get storyRbIds\(\) \{ return \(\) => L2V7Modules\.story\.rbIds\(\); \}/); }
  console.log('PASS: 9.0 story quests — subclass/Noblesse progress from game answers, ready part turned in at the NPC (teleport within the adena limit, unknown price refused), quest RBs tagged for same-level priority, own Noblesse not bought for FA, class switch stashes per-class memory');
})().catch(e => { console.error(e); process.exit(1); });
