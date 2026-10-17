'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 10.0.7 (лог 13.10 13:03–13:12, игрок: «куда пропадал бафф в последних минутах боя?»): чемпионы снимают баффы («[Frost Tarantula] зняв з вас
// 3 бафи.»); бот писал «после баффера баффы так и не появились (1/3)» и ждал к бафферу 10 мин, а платные баффы за FA (8–9 FA) уходили за минуту
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
let hud = [];
const box = { querySelectorAll: () => hud.map(([id, exp]) => ({ dataset: { skillId: String(id), expiresAt: String(exp) }, getAttribute: () => '' })) };
const load = f => { const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html', href: '' } }; sb.globalThis = sb; vm.runInNewContext(fs.readFileSync(path.join(root, f), 'utf8'), sb); return sb; };
const recs = [];
const now = Date.now(), H3 = now + 3 * 3600000;
const env = { cfg: { townBuffSet: 'basic', faBuffs: '' }, rt: {}, $q: s => s === '#l2-hud-active-buffs' ? box : null, TB_KEYS: { basic: [1068, 1268, 1086, 1045] }, IL: {},
  setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), FA_KNOWN: { 1357: ['Prophecy of Water', 5], 365: ['Dance of Siren', 1] }, faCost: () => 1, sleep: async () => {} };
const B = load('modules/buffs.js').L2V7Factories.buffs(env);
(async () => {
  // 1. строки боя из лога 13.10 13:11:39–13:11:49: 3 + 1 бафф снял Frost Tarantula → журнал и память по виду; платные за FA посчитаны
  hud = [[1068, H3], [1268, H3], [1357, H3], [365, now + 5 * 60000]];
  const lines = ['[Frost Tarantula] зняв з вас 3 бафи.', '[Frost Tarantula] ударив тебе −33 HP.', 'Енергетична блискавка 2161', '[Frost Tarantula] зняв з вас 1 баф.'];
  assert.equal(B.cancelNote(lines, 'Frost Tarantula', { champ: true, tier: 'red' }), 4);
  assert.equal(env.rt.buffCancel['ч:frost tarantula'].n, 4); assert.equal(env.rt.buffCancel['ч:frost tarantula'].k, 1);
  assert.ok(env.rt.tbCancelT > 0);
  assert.match(recs.join('\n'), /Frost Tarantula \[чемп\] снял с вас 4 бафф\(ов\) за бой \(правило игры: красный 7 % за удар\) — платных за FA осталось 2; бесплатный набор возьму у баффера сразу, при платных баффах за FA чемпиона беру только если он стоит потери/);   // 10.0.8: красный — правило игры
  assert.equal(B.cancelNote(['Полум’я 2679', 'Победа!'], 'Frost Buffalo'), 0, 'no cancel line — nothing recorded');
  assert.ok(!env.rt.buffCancel['frost buffalo']);
  assert.ok(B.cancelRisk('Frost Tarantula', true) && !B.cancelRisk('Kookaburra', true)); assert.equal(B.cancelRisk('Frost Tarantula', true, 'red'), null, '10.0.8: red/orange — game rule, judged by champs');
  assert.equal(B.faPaidLeft(), 1, 'Prophecy of Water (3 h) counts, Dance of Siren with 5 min left does not, town buffs never');
  // 2. поход к бафферу сразу после снятия: без «так и не появились (1/3)» и без ожидания 10 мин (в логе: «к бафферу через 571 с»)
  hud = [[1357, H3]];                                   // городской набор снят целиком
  env.rt.tbT = now - 60000; env.rt.tbCancelT = now - 1000; env.rt.tbOk = true;
  recs.length = 0;
  assert.equal(await B.townBuffStart('баффы кончились'), true, 'goes to the town buffer right away');
  assert.ok(!env.rt.tbFail, 'a cancel is not a failed buffer visit');
  assert.match(recs.join('\n'), /баффы кончились — сняты мобом \(нет\/кончается: .*\): городской «basic»/);
  assert.doesNotMatch(recs.join('\n'), /так и не появились|к бафферу через/);
  // без снятия (tbCancelT раньше похода) — прежние правила: 10 мин ожидания
  env.rt.tbT = now - 60000; env.rt.tbCancelT = now - 120000; env.rt.tbChk = env.rt.tbT; delete env.rt.tbWaitSaid; recs.length = 0;
  assert.equal(await B.townBuffStart('баффы кончились'), false);
  assert.match(recs.join('\n'), /к бафферу через/);
  // 3. mobfarm (игрок 13.10 03:15: «некоторые мобы научились убивать бафф, таких избегаем»): моб из памяти снятий или из списка игрока — не цель всегда;
  // чемпион и обычный моб того же вида — отдельно; ★ квест — как прежде; галка выключена — как прежде
  assert.ok(B.cancelRisk('Frost Tarantula', true) && !B.cancelRisk('Frost Tarantula', false), 'champion remembered, plain mob of the species not');
  env.cfg.cancelMobs = 'Tomb Guard, Lost Yeti'; assert.ok(B.cancelRisk('Tomb Guard', false)?.own && B.cancelRisk('Lost Yeti', true)?.own);
  const mf = fs.readFileSync(path.join(root, 'modules/mobfarm.js'), 'utf8'), mrecs = [];
  const menv = { cfg: { priority: '[квест]\n[чемп]\n[все]', searchChamp: true, searchQuest: true, lvlBelow: 3, lvlAbove: 20, lvlMin: 1, lvlMax: 99 },
    rt: { spawns: { r1: ['Frost Tarantula', 67], b1: ['Buffalo', 70], m1: ['Tomb Guard', 68], q1: ['Lost Yeti', 66] }, lvl: 66 }, PAGE_SIZE: 15,
    champs: { judge: () => ({ ok: true, lim: 100 }) }, cancelRisk: (n, ch) => /tarantula/i.test(n) && ch ? { n: 4, k: 1 } : /tomb guard|lost yeti/i.test(n) ? { n: 0, k: 0, own: true } : null,
    NET_SPAWNS: { t: Date.now(), kind: { r1: 'champion', b1: 'champion', m1: 'mob', q1: 'mob' }, tier: { r1: 'red', b1: 'blue' }, hp: { r1: 124488, b1: 49560 }, exp: { r1: 250680, b1: 136815 } },
    heroLvl: () => 66, isRaidId: () => false, isBoss: () => false, isQuestName: n => /lost yeti/i.test(n),
    campActive: () => false, campChampOpen: () => false, campChampMin: () => 0, campMobOpen: () => [], farmRules: () => [], recipeRules: () => [],
    rec: (...a) => mrecs.push(a.join(' | ')), setRt: async p => Object.assign(menv.rt, p) };
  const ctxm = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise, CSS: { escape: s => s }, document: { querySelectorAll: () => [] } }; ctxm.globalThis = ctxm;
  vm.runInNewContext(mf, ctxm); const M = ctxm.L2V7Factories.mobfarm(menv);
  const pick = () => Array.from(M.candidates(M.parseRules(), { ids: ['r1', 'b1', 'm1', 'q1'], quest: ['Lost Yeti'] }, menv.NET_SPAWNS.kind, 99), x => x.id).sort();
  assert.deepEqual(pick(), ['b1', 'q1'], 'remembered champion and listed mob skipped; ★ quest mob kept even if listed');
  assert.ok(mrecs.some(r => /Frost Tarantula \(67, красный\): пропускаю — снимает баффы \(4 за 1 боёв\)/.test(r)), mrecs.join('\n'));
  assert.ok(mrecs.some(r => /Tomb Guard \(68\): пропускаю — снимает баффы \(ваш список\)/.test(r)));
  menv.cfg.noCancelMobs = false; assert.deepEqual(pick(), ['b1', 'm1', 'q1', 'r1'], 'checkbox off — as before');
  // 4. проводка: combat зовёт cancelNote после боя, геттеры в content.js, галка в меню
  const cb = fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), ct = (fs.readFileSync(path.join(root, 'content.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'defaults.js'), 'utf8'));
  assert.match(cb, /env\.cancelNote\?\.\(ctx\.cancelLines \|\| \[\], ctx\.name/); // 20.6: накопленные строки вместо вытесненного хвоста победы
  assert.match(ct, /get cancelNote\(\) \{ return \(\.\.\.a\) => L2V7Modules\.buffs\.cancelNote\(\.\.\.a\); \}/);
  assert.match(ct, /get cancelRisk\(\) \{ return \(\.\.\.a\) => L2V7Modules\.buffs\.cancelRisk\(\.\.\.a\); \}/);
  assert.match(ct, /noCancelMobs: true, cancelMobs: ''/); assert.match(ct, /once\('cancel1007'/);
  const ph = fs.readFileSync(path.join(root, 'popup.html'), 'utf8'), pj = (fs.readFileSync(path.join(root, 'popup.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'defaults.js'), 'utf8'));
  assert.match(ph, /id="noCancelMobs"/); assert.match(ph, /id="cancelMobs"/); assert.match(ph, /id="cancelList"/);
  assert.match(pj, /'noCancelMobs'/); assert.match(pj, /'cancelMobs'/); assert.match(pj, /renderCancelList\(rt\);/);
  console.log('PASS: 10.0.7 buff cancel — «зняв з вас N бафи» logged and remembered per mob, town buffer right after the fight (no fake «buffer failed», no 10-min wait), mobs that cancel buffs (learned or listed) are never targets, ★ quest mobs excepted');
})().catch(e => { console.error(e); process.exit(1); });
