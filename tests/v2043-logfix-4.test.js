'use strict';
// 20.43: разбор логов John 21.10 13:21/13:30 (v20.42.2), рабочий 4 — заряды после смены грейда, урон Hammer Crush на РБ,
// ложная «гильдия временно не ответила», двойная загрузка списка РБ, отчёт обучения (номера спавнов, запросы при загрузке),
// окно TvT на странице победы.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), test = require('node:test'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const cut = (a, b) => { const i = content.indexOf(a), j = content.indexOf(b, i); assert.ok(i >= 0 && j > i, a + ' … ' + b); return content.slice(i, j); };
// чужой тест-файл как модуль: его test() не запускаются
function load(file, exports) {
  const box = { console, URLSearchParams, setTimeout, clearTimeout, process, __dirname: root + '/tests', module: { exports: {} },
    require: n => n === 'node:test' ? () => {} : require(n) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports=' + exports, box); return box.module.exports;
}

// ---------- confirmed1: заряды после смены грейда (лог 21.10 22:06:19 → 22:08:19) ----------
function shots(o = {}) {
  let modal = false, tab = '', now = 1800000000000;
  const calls = [], recs = [];
  const img = g => ({ getAttribute: () => '/icons/Etc_spell_shot_' + { A: 'silver', S: 'gold' }[g] + '_i01_0.jpg' });
  const slot = (id, g, q) => ({ title: `#${id} — Заряд душі воїна ×${q}`, isConnected: true, classList: { contains: n => n === 'l2-hotbar-shot--disabled' }, querySelector: s => s === 'img' ? img(g) : null });
  const S = slot(1467, 'S', 9999), A = slot(1466, 'A', 5000), slots = [S];
  const empty = { title: 'empty' }, consumable = { title: 'consumable', classList: { contains: () => false } }, close = { title: 'close' };
  const pickA = { title: 'Заряд душі воїна ×5000', querySelector: s => s === 'img' ? img('A') : null };
  const doc = { querySelectorAll: s => s === '.l2-hotbar-shot--enabled, .l2-hotbar-shot--disabled' ? slots
      : s === '.l2-battle-hotbar-slot--empty' ? [empty] : s === '.l2-battle-hotbar-pick' ? (modal && tab === 'consumable' && o.stock !== false ? [pickA] : []) : [],
    querySelector: s => s === '.l2-battle-hotbar-pick' && modal ? pickA : null };
  const env = { on: true, tabOwner: true, cfg: {}, rt: { weaponsT: 1, ...o.rt }, shotGrade: () => ({ g: 'A' }), shotsMage: () => false, shotSlot: () => S,
    shotsOn: () => false, qty: () => 1000, lastShotTry: 0, rec: (...s) => recs.push(s.join(' ')), setRt: async p => Object.assign(env.rt, p), sleep: async () => {},
    shown: x => !!x, waitFor: async fn => fn(), setStatus() {}, TAG: 'fixture',
    $q: s => s === '.l2-battle-hotbar-modal #l2-bh-modal-tabs' && modal ? {} : s.includes('data-tab-key="consumable"') ? consumable : s === '#l2-bh-modal-close' && modal ? close : null,
    fire: b => { calls.push(b); if (b === empty) modal = true; else if (b === consumable) tab = 'consumable'; else if (b === pickA) { slots.push(A); modal = false; } else if (b === close) modal = false; return true; } };
  const box = { document: doc, Date: class extends Date { static now() { return now; } }, console: { log() {}, info() {} }, Math };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/resources.js'), 'utf8'), box);
  return { env, A, S, empty, pickA, calls, recs, now: () => now, api: box.L2V7Factories.resources(env) };
}
test('лог 22:06–22:08: удачная замена B→S 30 с назад не держит замену S→A после смены оружия — заряды A встают и включаются сразу', async () => {
  const f = shots({ rt: { shotSwapT: 1800000000000 - 30000, shotSwapG: 'S' } });
  await f.api.keepShots();
  assert.ok(f.calls.includes(f.pickA), 'A-заряды поставлены на панель');
  assert.equal(f.calls.filter(x => x === f.A).length, 1, 'новый слот A включён в том же проходе');
  assert.equal(f.env.rt.shotSwapG, 'A');
  assert.match(f.recs.join('\n'), /заряды души A, на панели другие заряды S — поставил подходящие \(×5000\)/);
});
test('тот же грейд после неудачной попытки (A ещё не куплены) ждёт 2 мин, а после похода в магазин — сразу', async () => {
  const f = shots({ stock: false });
  await f.api.keepShots();
  assert.ok(f.calls.includes(f.empty), 'первая попытка открывает окно слота');
  assert.equal(f.calls.filter(x => x === f.A || x === f.S).length, 0, 'S при оружии A не включаем');
  const g = shots({ rt: { shotSwapT: f.env.rt.shotSwapT, shotSwapG: 'A', shopT: f.env.rt.shotSwapT - 1000 } });
  await g.api.keepShots();
  assert.equal(g.calls.length, 0, 'повтор того же грейда раньше 2 мин — без окна');
  const h = shots({ rt: { shotSwapT: f.env.rt.shotSwapT, shotSwapG: 'A', shopT: f.env.rt.shotSwapT + 10000 } });
  await h.api.keepShots();
  assert.ok(h.calls.includes(h.pickA), 'после закупки — сразу');
  assert.equal(h.calls.filter(x => x === h.A).length, 1);
});
test('старая метка без грейда (до обновления) держит паузу, как раньше', async () => {
  const f = shots({ rt: { shotSwapT: 1800000000000 - 30000 } });
  await f.api.keepShots();
  assert.equal(f.calls.length, 0);
});

// ---------- confirmed11: Hammer Crush на РБ (лог 21.10 23:22:04) ----------
function damageCore(rt = {}) {
  const na = content.indexOf('const NAME_ALIAS ='), nb = content.indexOf('for (const [a, b] of Object.entries(NAME_ALIAS))', na);
  const ba = content.indexOf('const BUFF_RE ='), bb = content.indexOf('\n', ba);
  const box = { rt, setRt(p) { box.learned = p; } };
  vm.runInNewContext(content.slice(na, nb) + content.slice(ba, bb) + '\n' + cut('const splashDmg =', 'const cdWatch =') + ';globalThis.api={dmgFromLog};', box);
  return { dmgFromLog: box.api.dmgFromLog, box };
}
const HC_DOM = ['Слуга [Mechanic Golem] промахнулся.', 'Скрушний молот: удар пройшов; оглушёння не діє на РБ/епіків 11955', 'Gwindorr · Удар вітру 66', 'Ты нанёс [ Gwindorr ] 4110 урона.'];
test('23:22:04: Hammer Crush читается по «Скрушний молот: …» — 11955, а не 66 из строки РБ; алиас не учится', () => {
  const c = damageCore();
  assert.equal(c.dmgFromLog('Hammer Crush', HC_DOM, true), 11955);
  assert.equal(c.dmgFromLog('Hammer Crush', HC_DOM, false), 11955);
  assert.equal(c.box.learned, undefined);
});
test('выученный старыми версиями алиас «gwindorr · удар вітру» игнорируется', () => {
  const c = damageCore({ logAlias: { 'hammer crush': 'gwindorr · удар вітру' } });
  assert.equal(c.dmgFromLog('Hammer Crush', HC_DOM, false), 11955);
  assert.equal(c.dmgFromLog('Hammer Crush', ['Gwindorr · Удар вітру 66'], false), 0);
});
test('запасной путь: строка «кто · что N» — не наш удар; «Имя · КРИТ N» и «Имя: пояснение N» — наш, алиас по имени', () => {
  let c = damageCore();
  assert.equal(c.dmgFromLog('Mystery Skill', ['Gwindorr · Удар вітру 66'], true), 0);
  assert.equal(c.box.learned, undefined, 'строку РБ алиасом не запоминаем');
  c = damageCore();
  assert.equal(c.dmgFromLog('Mystery Skill', ['Таємний удар · КРИТ 6975'], true), 6975);
  assert.equal(c.box.learned.logAlias['mystery skill'], 'таємний удар');
  c = damageCore();
  assert.equal(c.dmgFromLog('Other Skill', ['Gwindorr · Удар вітру 66', 'Удар землі: оглушення не діє на РБ/епіків 7777'], true), 7777);
  assert.equal(c.box.learned.logAlias['other skill'], 'удар землі');
});
test('fightlab: «(ID 260)Скрушний молот: …; … — 11955 урона» — свой урон хода, строка РБ — спецудар', () => {
  const box = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/fightlab.js'), 'utf8'), box);
  const F = box.L2V7Factories.fightlab({ rt: {}, cfg: {} });
  const L = F.parseLog(['\u20601177\u200bGwindorr · Удар вітру — 66 урона.', '\u2060260\u200bСкрушний молот: удар пройшов; оглушення не діє на РБ/епіків — 11955 урона', 'Слуга [Mechanic Golem] промахнувся.'], 'Gwindorr', 'Warlock');
  assert.equal(L.own, 11955); assert.equal(L.ownN, 1); assert.deepEqual(JSON.parse(JSON.stringify(L.spikes)), [{ name: 'Удар вітру', dmg: 66 }]);
  const W = F.parseLog(['\u2060260\u200bGwindorr: удар — 66 урона', 'Vamp clan armor: +265 HP.', 'Додаткова ціль повалена: X.'], 'Gwindorr', 'Warlock');
  assert.equal(W.own, 0, 'строка с именем цели и чужие строки — не наш урон');
});
function aliasMigration(rt) {
  const fa = content.indexOf('const ALIAS_FOREIGN ='), fb = content.indexOf('\n', fa);
  const box = { rt, rf: {}, cf: {}, cfg: {}, S: { ...(rt.skills || {}) }, sk: false };
  vm.runInNewContext(content.slice(fa, fb) + "\nconst once=(flag,fn)=>{if(!rt[flag]&&!rf[flag]&&!cfg[flag]&&!cf[flag]){rf[flag]=1;cf[flag]=1;fn();}};"
    + cut("once('aliasDot2043'", "const ha = S['hurricane assault'];") + ';globalThis.out={S,sk};', box);
  return { rf: box.rf, S: box.out.S, sk: box.out.sk };
}
test('aliasDot2043: алиасы «кто · что» стираются, урон этих умений — заново (и в памяти другого класса); прочее не трогаем', () => {
  const hc = { name: 'Hammer Crush', uses: 6, dmg: 10533, dmgN: 2, mp: 90, mpN: 2, cd: 3.7, damageEvidence: { v: 1, dmg: 10533, dmgN: 2, uses: 6, unknown: 4 } };
  const rt = { logAlias: { 'hammer crush': 'gwindorr · удар вітру', 'mystery': 'таємний удар', 'crit': 'щось · крит' }, skills: { 'hammer crush': hc, blaze: { dmg: 900, dmgN: 1 } },
    classStash: { human_warlock: { skills: { blaze: { dmg: 1, dmgN: 1 } } }, dwarf_warsmith: { skills: { 'hammer crush': hc } } } };
  const { rf, S, sk } = aliasMigration(rt);
  assert.equal(rf.aliasDot2043, 1); assert.equal(sk, true);
  assert.deepEqual(JSON.parse(JSON.stringify(rf.logAlias)), { mystery: 'таємний удар', crit: 'щось · крит' });
  assert.equal(S['hammer crush'].dmgN, 0); assert.equal(S['hammer crush'].damageEvidence, undefined);
  assert.equal(S['hammer crush'].mpN, 2); assert.equal(S['hammer crush'].cd, 3.7); assert.equal(S['hammer crush'].uses, 6);
  assert.equal(S.blaze, rt.skills.blaze);
  assert.equal(rf.classStash.dwarf_warsmith.skills['hammer crush'].dmgN, 0);
  assert.equal(rf.classStash.human_warlock, rt.classStash.human_warlock);
  assert.equal(rt.skills['hammer crush'].dmgN, 2, 'исходное rt не мутируется');
  const clean = aliasMigration({ logAlias: { mystery: 'таємний удар' }, skills: {} });
  assert.equal(clean.sk, false); assert.equal(Object.keys(clean.rf).join(), 'aliasDot2043');
});

// ---------- confirmed13: магистр (лог 21.10 21:46–23:23) ----------
const { fixture: magFixture } = load(path.join(root, 'tests/v1015-magister.test.js'), '{fixture}');
const tick = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
test('переход к учителю ждёт смены страницы под magBusy: второй проход не начинает свой GET', async () => {
  const f = magFixture({ path: '/map.html' }), sleeps = []; let release;
  f.ctx.sleep = ms => { sleeps.push(ms); return new Promise(r => { release = r; }); };
  const p = f.step(); await tick();
  assert.equal(f.ctx.location.href, '/magister.html?npcId=30344'); assert.deepEqual(sleeps, [3000]);
  const gets = f.gets.length; await f.step(); assert.equal(f.gets.length, gets, 'параллельный magisterStep ничего не читает');
  release(); await p;
  assert.equal(f.ctx.rt.magRetry, undefined); assert.ok(f.ctx.rt.magister, 'поход не снят');
});
test('обрыв запроса уходом со страницы — без «гильдия временно не ответила», без паузы и без возврата на карту', async () => {
  const f = magFixture({ path: '/map.html' }), recs = [];
  f.ctx.rec = (...a) => recs.push(a.join(' '));
  f.ctx.gameGet = async () => { f.ctx.pageLeaving = true; throw new TypeError('Failed to fetch'); };
  await f.step();
  assert.doesNotMatch(recs.join('\n'), /гильдия временно не ответила/); assert.equal(f.ctx.rt.magRetry, undefined);
  assert.equal(f.ctx.location.href, ''); assert.ok(f.ctx.rt.magister);
  const g = magFixture({ path: '/map.html' }); g.ctx.gameGet = async () => { g.ctx.pageGone = true; throw new DOMException('aborted', 'AbortError'); };
  await g.step(); assert.equal(g.ctx.rt.magRetry, undefined);
});
test('настоящая ошибка (HTTP 500, или сеть без ухода со страницы) — пауза, как раньше', async () => {
  for (const leaving of [true, false]) {
    const f = magFixture({ path: '/map.html' }), recs = [];
    f.ctx.rec = (...a) => recs.push(a.join(' ')); f.ctx.pageLeaving = leaving;
    f.ctx.gameGet = leaving ? async () => ({ ok: false, status: 500, json: async () => ({ error: 'x' }) }) : async () => { throw new TypeError('Failed to fetch'); };
    await f.step();
    assert.match(recs.join('\n'), /гильдия временно не ответила/); assert.ok(f.ctx.rt.magRetry?.until > 0);
  }
});

// ---------- confirmed15: старт тура РБ — список открывается один раз (лог 21.10 23:14:43/23:14:47) ----------
const { fixture: raidFixture } = load(path.join(root, 'tests/v2029-raid-free-fresh.test.js'), '{fixture}');
test('discover с карты: переход записывает rbScan этого документа — новая страница списка читается без второй загрузки', async () => {
  const f = raidFixture(); f.rt.rbScan = null; f.loc.pathname = '/map.html'; f.rt.rbHunt = { step: 'pick' };
  await f.R.rbHuntStep();
  assert.equal(f.loc.href, '/rb-bosses.html?page=1'); assert.equal(f.rt.rbScan.start, '10:20'); assert.equal(f.rt.rbScan.document, 1);
  f.reload(); f.loc.pathname = '/rb-bosses.html'; f.loc.href = '';
  await f.R.rbHuntStep();
  assert.equal(f.loc.href, '', 'второй загрузки той же страницы нет'); assert.equal(f.rt.rbListReadStart, '10:20'); assert.equal(f.rt.rbScan, null);
  assert.ok(f.rt.rbList.tiphon);
});
test('Start на уже открытой странице списка по-прежнему её перезагружает', async () => {
  const f = raidFixture(); f.rt.rbScan = null; f.rt.rbHunt = { step: 'pick' };
  await f.R.rbHuntStep();
  assert.equal(f.loc.href, '/rb-bosses.html?page=1'); assert.equal(f.rt.rbListReadStart, 'old');
});

// ---------- confirmed16/17: отчёт обучения ----------
function learnCore(stored) {
  const ctx = { console, Date, Math, JSON, Object, Array, String, Number, cfg: {}, learnPk: () => 'craft', learnChange() {}, learnSaveSoon() {},
    sessionStorage: { getItem: () => null }, chrome: { storage: { local: { get: async () => ({ learn: stored }) } } } };
  vm.createContext(ctx);
  vm.runInContext(cut('let LEARN = null', 'const learnSave =') + cut('const apiPath =', 'const netSeen =')
    + '\nthis.api={learnLoad,learnApi,learnKey,apiPath,early:LEARN_EARLY,get L(){return LEARN}};', ctx);
  return ctx.api;
}
test('ключ обучения сворачивает номер спавна/боя; apiPath прежний — rbInfoNote узнаёт РБ', () => {
  const c = learnCore();
  assert.equal(c.learnKey('GET /game/spawn/l2dop_rb_25063/info'), 'GET /game/spawn/:id/info');
  assert.equal(c.learnKey('GET /game/spawn/sdms_witch_012/info'), 'GET /game/spawn/:id/info');
  assert.equal(c.learnKey('GET /game/siege/l2dop_dion/state'), 'GET /game/siege/l2dop_dion/state');
  assert.equal(c.learnKey('GET /character/profession-quest/dwarf_artisan/status'), 'GET /character/profession-quest/dwarf_artisan/status');
  assert.equal(c.learnKey('POST /game/battle/action'), 'POST /game/battle/action');
  const p = c.apiPath('/game/spawn/l2dop_rb_25063/info?x=1');
  assert.equal(p, '/game/spawn/l2dop_rb_25063/info'); assert.match(p, /^\/game\/spawn\/(l2dop_rb_\d+)\/info$/);
});
test('learnLoad: старые ключи со спавнами слиты, их «новый запрос API» убран; ранние запросы страницы дописаны (23:29:46 /game/craft/*)', async () => {
  const e = { keys: {}, forms: {}, st: { 200: 1 } };
  const c = learnCore({ v: 1, t0: 1, sel: {}, pages: {}, api: { 'GET /game/spawn/l2dop_rb_1/info': { ...e, n: 3, first: 5, last: 10 }, 'GET /game/spawn/l2dop_rb_2/info': { ...e, n: 2, first: 3, last: 20 }, 'GET /character': { ...e, n: 1, first: 1, last: 1 } },
    changes: [{ kind: 'новый запрос API', what: 'GET /game/spawn/l2dop_rb_2/info (со страницы «map»)' }, { kind: 'новый запрос API', what: 'POST /game/mammon/teleport (со страницы «mammon»)' }, { kind: 'ответ API изменился', what: 'GET /character: новые поля x' }] });
  c.early.push(['GET /game/craft/materials', { status: 200, res: { materials: [] } }], ['GET /game/spawn/l2dop_rb_7/info', { status: 200, res: {} }]);
  await c.learnLoad();
  const A = c.L.api;
  assert.deepEqual(Object.keys(A).sort(), ['GET /character', 'GET /game/craft/materials', 'GET /game/spawn/:id/info']);
  assert.equal(A['GET /game/spawn/:id/info'].n, 6); assert.equal(A['GET /game/spawn/:id/info'].first, 3);
  assert.deepEqual(c.L.changes.map(x => x.what), ['POST /game/mammon/teleport (со страницы «mammon»)', 'GET /character: новые поля x']);
  assert.equal(c.early.length, 0);
  c.learnApi('GET /game/spawn/l2dop_rb_9/info', { status: 200, res: {} });
  assert.equal(A['GET /game/spawn/:id/info'].n, 7);
});
test('сетевой обработчик копит события до загрузки обучения (не больше 50); выключенное обучение копилку чистит', () => {
  assert.match(content, /if \(LEARN\) try \{ learnApi\(key, secret \? \{\} : d\); \} catch \(er\) \{\}\n\s*else if \(LEARN_EARLY\.length < 50\) LEARN_EARLY\.push\(\[key, secret \? \{\} : d\]\);/);
  assert.match(cut('function learnStart()', 'learnLoad().then'), /cfg\.autoLearn === false\) \{ LEARN_EARLY\.length = 0; return; \}/);
});

// ---------- split4: окно TvT на странице победы (лог 21.10 21:57:02–21:58:56) ----------
const { flowFixture } = require('./warlock-combat-fixture.cjs');
const fightCtx = { name: 'Forgotten Ancient People', killed: [], champ: false };
test('победа в окне TvT: новый бой не начинаем, но пишем «жду TvT» (раньше ≈2 мин молча)', async () => {
  const f = flowFixture('fighter'), e = f.env; f.setWon(true); let waits = 0;
  Object.assign(e, { magisterAfterWin: async () => false, magisterHold: () => true, tvtHoldWait: async () => { waits++; return true; } });
  await f.farm.nextFight(fightCtx);
  assert.equal(waits, 1); assert.equal(f.events.includes('hunt'), false);
  e.tvtHoldWait = async () => false; waits = 0;   // капча/проверка активности — по-прежнему тихо ждём
  await f.farm.nextFight(fightCtx); assert.equal(f.events.includes('hunt'), false);
});
test('townBuffStart в окне TvT: к бафферу не уходим, вызывающий ждёт (true)', async () => {
  const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/battle.html', href: '' } }; sb.globalThis = sb;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/buffs.js'), 'utf8'), sb);
  let hold = true, waits = 0, have = [];
  const hud = { querySelectorAll: () => have.map(id => ({ dataset: { skillId: String(id), expiresAt: String(Date.now() + 24 * 3600000) }, getAttribute: () => '' })) };
  const env = { cfg: { townBuffSet: 'basic', faBuffs: '' }, rt: {}, $q: s => s === '#l2-hud-active-buffs' ? hud : null, TB_KEYS: { basic: [1068, 1268, 1045] }, IL: {}, FA_KNOWN: {}, faCost: () => 1,
    setRt: async p => Object.assign(env.rt, p), rec() {}, setStatus() {}, sleep: async () => {}, tvtHoldWait: async () => { if (!hold) return false; waits++; return true; } };
  const B = sb.L2V7Factories.buffs(env);
  assert.equal(await B.townBuffStart('баффы кончились'), true);
  assert.equal(waits, 1); assert.equal(sb.location.href, ''); assert.equal(env.rt.tbuff, undefined, 'поход не записан');
  have = [1068, 1268, 1045];
  assert.equal(await B.townBuffStart('баффы кончились'), false, 'баффы на месте — окно TvT не мешает обычному решению');
  assert.equal(waits, 1);
  have = []; hold = false;
  assert.equal(await B.townBuffStart('баффы кончились'), true);
  assert.equal(sb.location.href, '/town-buffer.html', 'вне окна — как раньше');
});
