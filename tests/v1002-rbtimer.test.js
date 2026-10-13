'use strict';
// 10.0.7: после rbrun.js в manifest идёт modules/subclass.js (заготовка под сабы) — регулярка ниже допускает его
// 10.0.2 «⏱ Таймеры боссов» (modules/rbtimer.js): игра у РБ отдаёт только isAlive (у эпиков ещё respawnHours) — время смерти бот
// узнаёт сам (свой килл точно, чужой — окном между опросами), учит длительность респа, показывает таймеры и будит «Тур РБ»
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const H = 3600000, M = 60000;
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
let NOW = Date.UTC(2026, 9, 12, 10, 0);
function make({ rt = {}, cfg = {}, lvl = 65, lists = {} } = {}) {
  const recs = [], gets = [];
  const ctx = { Date: class extends Date { static now() { return NOW; } }, Math, Object, String, Number, Array, Set, JSON, console, sessionStorage: { getItem: () => null, setItem() {} } };
  ctx.globalThis = ctx; vm.runInNewContext(read('modules/rbtimer.js'), ctx);
  const env = { rt, cfg, RB_WIN: 15, heroLevel: () => lvl, sleep: () => Promise.resolve(), rec: (...a) => recs.push(a.join(' ')),
    setRt: p => { Object.assign(env.rt, p); return Promise.resolve(); },
    gameGet: async p => { gets.push(p); const j = lists[p]; return j ? { ok: true, json: async () => j } : { ok: false }; } };
  return { T: ctx.L2V7Factories.rbtimer(env), env, recs, gets };
}
const boss = (id, lvl, alive, extra = {}) => ({ spawnId: 'l2dop_rb_' + id, name: 'RB' + id, level: lvl, bossType: 'raid', isAlive: alive, adenaCost: 100000, canAttack: true, ...extra });

// 1. окно смерти и замер респа: жив в 10:00 → убит в 10:10 → воскрес в 18:10 (опросы раз в 10 мин) → респ в [7 ч 50 мин, 8 ч 10 мин]
{
  const { T } = make();
  let s = T.observe(null, [{ id: 'a', n: 'A', l: 60, al: true }], NOW).T;
  s = T.observe(s, [{ id: 'a', al: true }], NOW + 10 * M).T;
  let o = T.observe(s, [{ id: 'a', al: false }], NOW + 20 * M); s = o.T;
  assert.equal(o.ev[0].kind, 'dead'); assert.deepEqual([s.b.a.dl, s.b.a.dh], [NOW + 10 * M, NOW + 20 * M], 'убит между «видел живым» и «увидел мёртвым»');
  let tm = T.timerOf(s, 'a', NOW + 30 * M, 8);
  assert.equal(tm.R.src, 'guess'); assert.deepEqual([tm.at.lo, tm.at.hi], [NOW + 10 * M + 8 * H, NOW + 20 * M + 8 * H], 'догадка 8 ч, пока замеров нет');
  s = T.observe(s, [{ id: 'a', al: false }], NOW + 8 * H + 10 * M).T;
  o = T.observe(s, [{ id: 'a', al: true }], NOW + 8 * H + 20 * M); s = o.T;
  assert.equal(o.ev[0].kind, 'alive'); deq(s.b.a.ob[0], [8 * H - 10 * M, 8 * H + 10 * M], 'замер респа');
  assert.equal(T.respOf(s, 'a').src, 'own');
  assert.equal(s.b.a.dl, undefined, 'окно смерти стёрто');
}
// 2. мёртв с первого взгляда — только «не позже»; второй замер сужает окно
{
  const { T } = make();
  let s = T.observe(null, [{ id: 'b', l: 60, al: false }], NOW).T;
  let tm = T.timerOf(s, 'b', NOW, 8); assert.equal(tm.at.lo, 0); assert.equal(tm.at.hi, NOW + 8 * H); assert.match(T.upTxt(tm, NOW), /^не позже/);
  s = T.observe(s, [{ id: 'b', al: true }], NOW + 5 * H).T;
  assert.equal(s.b.b.ob, undefined, 'смерть неизвестна — респ не замерен');
  deq(T.band([[7 * H, 9 * H], [7.5 * H, 8.5 * H]]), { lo: 7.5 * H, hi: 8.5 * H });
  assert.equal(T.band([[1 * H, 2 * H], [5 * H, 6 * H]]).rnd, true, 'не пересекаются — случайный респ');
}
// 3. свой килл — точно; «жив» в списке через минуту после килла — отставание списка, не респ
{
  const { T } = make();
  let s = T.observe(null, [{ id: 'c', l: 60, al: true }], NOW).T;
  s = T.killed(s, 'c', NOW + 5 * M, 'C', 60);
  let o = T.observe(s, [{ id: 'c', al: true }], NOW + 6 * M);
  assert.equal(o.ev.length, 0); assert.equal(o.T.b.c.al, false, 'не верим «жив» сразу после килла');
  const tm = T.timerOf(o.T, 'c', NOW + 6 * M, 8);
  assert.equal(tm.own, true); assert.equal(tm.at.hi - tm.at.lo, 0); assert.match(T.deathTxt(tm, NOW), /убит мной/);
}
// 4. эпик — респ из игры; общий респ РБ — по замерам других РБ (≥ 3)
{
  const { T } = make();
  let s = T.observe(null, [{ id: 'e', l: 60, al: false, e: true, rh: 36 }], NOW).T;
  assert.equal(T.respOf(s, 'e').src, 'game'); assert.equal(T.respOf(s, 'e').lo, 36 * H);
  s = { b: { ...s.b, x1: { al: true, ob: [[7.8 * H, 8.2 * H]] }, x2: { al: true, ob: [[7.9 * H, 8.1 * H]] }, x3: { al: true, ob: [[7.7 * H, 8.3 * H]] }, n: { al: false, dh: NOW } } };
  const R = T.respOf(s, 'n', 8); assert.equal(R.src, 'all'); assert.ok(R.lo <= 8 * H && R.hi >= 8 * H);
}
// 4б. файл слежки из облака → таймеры (replay) и слияние с таймерами бота (merge): свежее наблюдение, замеры вместе, свой килл точнее
{
  const { T } = make();
  const t0 = NOW / 1000, snaps = [0, 600, 1200, 8 * 3600 + 1200, 8 * 3600 + 1800].map((dt, i) => ({ t: t0 + dt, st: { l2dop_rb_9: ['Lokness', 70, !(i >= 2 && i <= 3), 'raid'], l2dop_rb_29022: ['Zaken', 60, false, 'epic'] } }));
  const jsonl = snaps.map(x => JSON.stringify(x)).join('\n');
  const R = T.parseFile(jsonl);
  deq(R.b.l2dop_rb_9.ob, [[8 * H, 8 * H + 20 * M]], 'по строкам слежки — замер респа');
  assert.equal(R.b.l2dop_rb_29022.e, 1);
  assert.equal(T.parseFile(JSON.stringify(snaps)).b.l2dop_rb_9.al, true, 'и JSON-массивом');
  assert.equal(T.parseFile(JSON.stringify({ rbTimer: R })).b.l2dop_rb_9.ob.length, 1, 'и таймеры бота');
  assert.equal(T.parseFile('мусор'), null);
  const mine = { b: { l2dop_rb_9: { n: 'Lokness', l: 70, al: false, dl: NOW - H, dh: NOW - H, k: NOW - H, ls: NOW - H, ob: [[7.9 * H, 8.1 * H]] }, l2dop_rb_5: { n: 'X', l: 60, al: true, ls: NOW } } };
  const M2 = T.merge(mine, R);
  assert.equal(M2.b.l2dop_rb_9.al, true, 'свежее наблюдение слежки'); assert.equal(M2.b.l2dop_rb_9.ob.length, 2, 'замеры вместе'); assert.equal(M2.b.l2dop_rb_5.al, true, 'своё не теряется');
  const M3 = T.merge({ b: { a: { al: false, k: 5, dl: 5, dh: 5, ls: 10 } } }, { b: { a: { al: false, dl: 0, dh: 20, ls: 20 } } });
  assert.equal(M3.b.a.k, 5); assert.equal(M3.b.a.dl, 5, 'свой килл точнее чужого «не позже»');
  // реальный файл слежки (12.10, основной аккаунт), если есть
  const f = '/mnt/project-files/notes/rb-poll-states-main.jsonl';
  if (fs.existsSync(f)) { const RR = T.parseFile(fs.readFileSync(f, 'utf8')); assert.ok(Object.keys(RR.b).length >= 197, 'все РБ и эпики из настоящего файла'); }
}
// 5. ответ игры (опрос и hook): rbList освежается (тот же вид, что строка страницы), свой окно уровней, журнал только по окну
(async () => {
  const p1 = { page: 4, totalPages: 14, bosses: [boss(1, 40, true), boss(2, 52, false)] }, p5 = { page: 5, totalPages: 14, bosses: [boss(3, 60, true), boss(4, 85, true, { canAttack: false, attackBlockedReasonUk: 'Недоступно: x' })] };
  const ep = { total: 1, bosses: [{ spawnId: 'l2dop_rb_29001', name: 'Queen Ant', level: 40, bossType: 'epic', isAlive: false, respawnHours: 12 }] };
  const { T, env, recs, gets } = make({ rt: { rbTimer: { b: {}, pg: { 1: [20, 25], 4: [38, 52], 5: [60, 85] } } }, lists: { '/game/raid-bosses?page=4': p1, '/game/raid-bosses?page=5': p5, '/game/epic-bosses': ep } });
  assert.equal(await T.tick(), true);
  assert.deepEqual(gets, ['/game/raid-bosses?page=4', '/game/raid-bosses?page=5', '/game/epic-bosses'], 'страницы с окна 50–80 и эпики');
  assert.equal(env.rt.rbList.l2dop_rb_2.alive, false); assert.equal(env.rt.rbList.l2dop_rb_3.page, 5); assert.equal(env.rt.rbList.l2dop_rb_4.deny, 'x');
  assert.equal(env.rt.rbList.l2dop_rb_3.unit, 'аден'); assert.equal(env.rt.rbList['l2dop_rb_29001'], undefined, 'эпики не в списке тура');
  assert.equal(env.rt.rbTimer.b['l2dop_rb_29001'].rh, 12);
  assert.equal(await T.tick(), false, 'не чаще раза в 10 мин');
  NOW += 11 * M;
  const p1b = { ...p1, bosses: [boss(1, 40, true), boss(2, 52, true)] }, p5b = { ...p5, bosses: [boss(3, 60, false), boss(4, 85, true)] };
  await T.listNote(p1b, 'опрос'); await T.listNote(p5b, 'опрос');
  assert.ok(recs.some(r => /RB3 \(60\) убит между/.test(r)), 'убийство в окне — в журнал');
  assert.ok(recs.some(r => /RB2 \(52\) воскрес/.test(r)));
  deq(T.revivedSince(NOW - M), ['l2dop_rb_2']);
  const nx = T.nextUp(50, 80, NOW); assert.equal(nx.id, 'l2dop_rb_3'); assert.match(nx.txt, /через/);
  await T.kill('Тотем', 'x', 1); assert.equal(env.rt.rbTimer.b['Тотем'], undefined, 'бой без spawnId — не босс');
  const tab = T.table(env.rt.rbTimer, NOW, { lo: 50, hi: 80 });
  deq(tab.slice(0, 2).map(t => t.id), ['l2dop_rb_3', 'l2dop_rb_29001'], 'убитые первыми, по времени воскрешения (РБ 8 ч раньше эпика 12 ч)'); assert.ok(tab.every(t => t.e || (t.l >= 50 && t.l <= 80)));
  // 6. подключение: content, hook, raid, combat, меню
  const c = read('content.js'), raid = read('modules/raid.js');
  assert.match(c, /L2V7Modules\.rbtimer\.tick\(\)/); assert.match(c, /raid\|epic\)-bosses\$\/\.test\(path\) && Array\.isArray\(d\.eb\)/);
  assert.match(read('hook.js'), /\(\?:epic\|raid\)-bosses/); assert.match(read('modules/combat.js'), /env\.rbTimerKill\?\.\(ctx\.rb\.id/);
  assert.match(raid, /env\.rbTimer\?\.revivedSince/); assert.match(raid, /env\.rbTimer\?\.domNote\(all\)/); assert.match(raid, /первым воскреснет/);
  assert.match(read('popup.html'), /id="rbTimerTable"/); assert.match(read('popup.html'), /modules\/rbtimer\.js/); assert.match(read('popup.js'), /function renderRbTimer/); assert.match(read('popup.js'), /RT\.merge\(rt\.rbTimer/); assert.match(read('popup.html'), /id="rbtFile"/);
  assert.match(read('manifest.json'), /"modules\/rbtimer\.js",\s*(?:"modules\/rbrun\.js",\s*)?(?:"modules\/subclass\.js",\s*)?"content\.js"/);
  assert.match(c, /rbTimers: true, rbTimerMin: 10, rbRespH: 8/);
  assert.match(c, /const ep = epicRespTxt\(wide, now\); L\.push\(ep \|\| '— 🏛 маммон —'\)/, 'индикатор слева снизу: респ эпиков (10.0.9: блок есть всегда — кнопки Маммона)');
  console.log('PASS: 10.0.2 таймеры боссов — окно смерти, свой килл, замер респа (свой / по всем / догадка 8 ч / игра у эпиков), опрос окна уровней, rbList, журнал, тур');
})().catch(e => { console.error(e); process.exit(1); });
