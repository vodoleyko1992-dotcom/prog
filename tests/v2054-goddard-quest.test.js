'use strict';
// 20.54 (John 23.10 14:56: «логи где я иду по новому квесту на А плащ, изучи и запомни, автоматизируй»): квест «Слід Океану Полум'я»
// (Cloak of Goddard Guardian) — прогресс из ответов игры, РБ Ashakiel первым в туре, охота мобами не ниже героя, сдача у Scout Adrian /
// Captain Andrei перелётом и кнопкой страницы. Стадии и кнопки — из кода страниц игры (kb/quest-goddard.md)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/story.js');
const RAW = JSON.parse(read('kb/raw/sq-goddard.json')).data.quest;
const mk = (rt = {}, cfg = {}, over = {}) => {
  const recs = [], fired = [], els = over.els || {}, loc = over.location || { pathname: '/map.html', href: '' };
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, isFinite, location: loc, sessionStorage: { setItem() {} } }; sb.globalThis = sb;
  vm.runInNewContext(src, sb);
  const env = { rt: { char: 'Warlock', ...rt }, cfg: { storyTurnIn: true, storyTpMax: 100000, ...cfg }, recs, fired,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {},
    waitX: async fn => fn(), fire: el => { fired.push(el); el.onFire?.(); return true; }, $q: s => els[s] ?? null, isBattle: () => false, fishNow: () => false,
    autonomyMode: () => 'hunt', awayFree: () => true, awayIdle: () => false, classSwitched: () => {},
    gameGet: over.gameGet || (async () => ({ ok: false, status: 401, json: async () => ({}) })), ...over.env };
  return { env, S: sb.L2V7Factories.story(env), loc };
};
const Q = (o = {}) => ({ ...RAW, effectiveLevel: 73, ...o, location: { ...RAW.location, ...(o.location || {}) }, actions: { ...RAW.actions, ...(o.actions || {}) } });
const answer = q => async p => ({ ok: p === '/game/story-quests/goddard-ocean-flame', status: 200, json: async () => ({ quest: q }) });
(async () => {
  // 1. сохранённый ответ (не взят): запись, строка в журнал, сдавать нечего; повтор не пишет
  { const { env, S } = mk();
    const s = S.qNote('goddard', RAW);
    assert.equal(s.stage, 'not_started'); assert.equal(s.active, false); assert.equal(s.ready, false); assert.equal(s.rb, 'l2dop_rb_25205'); assert.equal(s.npcTp, 'goddard');
    assert.ok(env.recs.some(r => /плащ Goddard: не взят/.test(r)));
    const n = env.recs.length; S.qNote('goddard', RAW); assert.equal(env.recs.length, n);
    assert.equal(S.want(), null); assert.equal(S.rbIds().length, 0); assert.equal(S.huntUp(), false); }
  // 2. припасы: все есть → сдать Adrian (Варка); не все → нет
  { const { S } = mk();
    S.qNote('goddard', Q({ stage: 'collect_supplies', supplies: RAW.supplies.map((r, i) => ({ ...r, have: i ? r.need : 5 })) }));
    assert.equal(S.want(), null, 'not all supplies');
    S.qNote('goddard', Q({ stage: 'collect_supplies' }));
    const w = S.want(); assert.equal(w.kind, 'goddard'); assert.equal(w.act, 'turn-in-supplies'); assert.equal(w.npc, 'adrian'); }
  // 3. стадия Ashakiel (как в логе 23.10): РБ первым в туре, пока ткани нет; с тканью — сдать, РБ больше не нужен
  { const { env, S } = mk();
    S.qNote('goddard', Q({ stage: 'kill_ashakiel' }));
    assert.deepEqual([...S.rbFirst()], ['l2dop_rb_25205']); assert.ok(S.rbIds().includes('l2dop_rb_25205')); assert.equal(S.want(), null);
    env.cfg.goddardQuest = false; assert.equal(S.rbFirst().length, 0, 'switched off'); env.cfg.goddardQuest = true;
    S.qNote('goddard', Q({ stage: 'kill_ashakiel', ashakiel: { ...RAW.ashakiel, clothHave: 1 } }));
    assert.equal(S.rbFirst().length, 0); assert.equal(S.want().act, 'turn-in-cloth'); }
  // 4. охота 150: мобы не ниже героя; журнал раз в 25, а не на каждое убийство; 150/150 → доложить
  { const { env, S } = mk();
    S.qNote('goddard', Q({ stage: 'kill_equal_level_mobs', hunt: { have: 0, need: 150 } }));
    assert.equal(S.huntUp(), true); const n = env.recs.length;
    for (let h = 1; h < 25; h++) S.qNote('goddard', Q({ stage: 'kill_equal_level_mobs', hunt: { have: h, need: 150 } }));
    assert.equal(env.recs.length, n, 'no line per kill');
    S.qNote('goddard', Q({ stage: 'kill_equal_level_mobs', hunt: { have: 25, need: 150 } })); assert.equal(env.recs.length, n + 1);
    S.qNote('goddard', Q({ stage: 'kill_equal_level_mobs', hunt: { have: 150, need: 150 } }));
    assert.equal(S.huntUp(), false); assert.equal(S.want().act, 'report-hunt');
    S.qNote('goddard', Q({ stage: 'return_to_andrei' })); const w = S.want(); assert.equal(w.act, 'claim-reward'); assert.equal(w.npc, 'andrei');
    S.qNote('goddard', Q({ stage: 'completed', completed: true })); assert.equal(S.want(), null); }
  // 5. свой выключатель: без задачи «Квесты» (only) и при выключенной сдаче Noblesse — Goddard идёт, Noblesse нет
  { const { env, S } = mk({}, { storyTurnIn: false });
    env.rt.story = { noblesse: { part: 1, ready: true, completed: false } };
    S.qNote('goddard', Q({ stage: 'return_to_andrei' }));
    assert.equal(S.want('goddard').kind, 'goddard'); assert.equal(S.want().kind, 'goddard');
    env.cfg.storyTurnIn = true; assert.equal(S.want().kind, 'noblesse'); assert.equal(S.want('goddard').kind, 'goddard', 'only: noblesse skipped');
    env.cfg.goddardQuest = false; assert.equal(S.want('goddard'), null); }
  // 6. тур РБ: отлучаемся только на простое тура (awayIdle), точка возврата не нужна; бой/занятость — нет
  { const { env, S } = mk({}, {}, { env: { autonomyMode: () => 'raid', awayFree: () => false, awayIdle: () => false } });
    S.qNote('goddard', Q({ stage: 'kill_ashakiel', ashakiel: { ...RAW.ashakiel, clothHave: 1 } }));
    assert.equal(await S.storyStep('goddard'), false, 'tour busy');
    env.awayIdle = () => true;
    assert.equal(await S.storyStep('goddard'), true); assert.equal(env.rt.storyJob.kind, 'goddard'); assert.equal(env.rt.storyJob.home, null);
    // чужая задача (Noblesse) при only='goddard' не исполняется этим вызовом
    env.rt.storyJob = { kind: 'noblesse', key: 'noblesse:1', t: Date.now() }; assert.equal(await S.storyStep('goddard'), false); }
  // 7. сдача: NPC далеко → перелёт в Варку (zoneGo служба quests); рядом → страница; кнопка → клик и готово
  { let q = Q({ stage: 'kill_ashakiel', ashakiel: { ...RAW.ashakiel, clothHave: 1 } });
    const loc = { pathname: '/map.html', href: '' };
    const { env, S } = mk({}, {}, { location: loc, gameGet: async p => answer(q)(p) });
    S.qNote('goddard', q);
    const w = S.want(); env.rt.storyJob = { ...w, t: Date.now(), char: 'Warlock', kick: 0 };
    await S.step(env.rt.storyJob);
    assert.equal(env.rt.zoneGo.id, 'varka_silenos_stronghold'); assert.equal(env.rt.zoneGo.svc, 'quests'); assert.ok(env.rt.storyJob.tpT);
    env.rt.zoneGo = null; q = Q({ ...q, location: { atScoutAdrian: true } });
    await S.step(env.rt.storyJob); assert.equal(loc.href, '/scout-adrian.html');
    loc.pathname = '/scout-adrian.html';
    const btn = { disabled: false, onFire() { box.btn = null; } }, box = { btn, children: [1], querySelector: s => s === 'button[data-action="turn-in-cloth"]' ? box.btn : null };
    env.$q = s => s === '#scout-adrian-quest-actions' ? box : s === '#scout-adrian-err' ? { textContent: '' } : null;
    await S.step(env.rt.storyJob);
    assert.equal(env.fired.length, 1); assert.equal(env.rt.storyJob, null); assert.ok(env.rt.storyLog[0].ok); assert.ok(env.recs.some(r => /Cloth of Ocean Flame: готово/.test(r))); }
  // 8. после перелёта NPC всё ещё не рядом — честный отказ (повтор через 30 мин), второй платный перелёт не заказываем
  { const q = Q({ stage: 'return_to_andrei' });
    const { env, S } = mk({}, {}, { gameGet: answer(q) });
    S.qNote('goddard', q); env.rt.storyJob = { ...S.want(), t: Date.now(), tpT: Date.now() - 1000, char: 'Warlock', kick: 0 };
    await S.step(env.rt.storyJob);
    assert.equal(env.rt.storyJob, null); assert.equal(env.rt.zoneGo, undefined); assert.equal(env.rt.storyLog[0].ok, false); assert.match(env.rt.storyLog[0].why, /Captain Andrei не рядом/); }
  // 9. проводка: опросы игры, тур, карта, умолчание, меню, задача без «Квестов»
  { const c = read('content.js'), core = read('engine-core.js');
    assert.match(c, /goddard-ocean-flame\(\?:\\\/\[\\w-\]\+\)\?\$\/\.test\(path\) && d\.res\.quest\) L2V7Modules\.story\.qNote\('goddard'/);
    assert.match(c, /get storyRbFirst\(\)/); assert.match(c, /get storyHuntUp\(\)/); assert.match(c, /get awayIdle\(\)/); assert.match(c, /storyStep\(gOnly\)/);
    assert.match(read('modules/raid.js'), /first\.includes\(b\.id\) - first\.includes\(a\.id\)/);
    assert.match(read('modules/mobfarm.js'), /up\(b\) - up\(a\)/);
    assert.match(read('defaults.js'), /goddardQuest: true/); assert.match(read('popup.html'), /id="goddardQuest"/); assert.match(read('popup.js'), /'goddardQuest'/);
    assert.match(core, /key === 'storyJob' && rt\.storyJob\?\.kind === 'goddard' && c\.goddardQuest !== false/); }
  console.log('v2054-goddard-quest: PASS');
})().catch(e => { console.error(e); process.exit(1); });
