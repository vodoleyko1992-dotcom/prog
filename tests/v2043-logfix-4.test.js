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
function learnCore(stored, o = {}) {
  const changes = [];
  const ctx = { console, Date, Math, JSON, Object, Array, String, Number, cfg: { ...(o.cfg || {}) }, learnPk: () => 'craft', learnSaveSoon() {},
    learnChange: (kind, what) => changes.push(kind + ': ' + what), learnPage() {}, learnSelectors() {}, setTimeout() {}, setInterval() {},
    sessionStorage: { getItem: () => null }, chrome: { storage: { local: { get: async () => { if (o.fail) throw new Error('storage'); return { learn: stored }; } } } } };
  vm.createContext(ctx);
  vm.runInContext(cut('let LEARN = null', 'const learnSave =') + cut('const apiPath =', 'const netSeen =') + cut('function learnStart()', '// ошибки скрипта бота')
    + '\nthis.api={learnLoad,learnApi,learnNet,learnStart,learnKey,apiPath,early:LEARN_EARLY,get boot(){return learnBoot},get L(){return LEARN}};', ctx);
  return Object.assign(ctx.api, { changes, cfg: ctx.cfg });
}
// поля ответа /game/spawn/<id>/info из отчёта обучения 21.10 13:30: у РБ свои, у катакомб и охраны эпика их нет
const SPAWN_BASE = ['aggressive', 'drops', 'dropsSynthetic', 'icon', 'kind', 'level', 'name', 'npcId', 'rewardExp', 'rewardExpSynthetic', 'rewardSp', 'spawnId', 'spoil', 'stats', 'templateId', 'viewerMaySeeSpoil'];
const RB_ONLY = ['canAttackRaidBoss', 'minRaidBossLevelForAttack', 'scrollDrops'];
const spawnRes = (extra = []) => ({ status: 200, res: Object.fromEntries([...SPAWN_BASE, ...extra].map(k => [k, 1])) });
const learnEmpty = () => ({ v: 1, t0: 1, sel: {}, pages: {}, api: {}, changes: [] });
test('ключ обучения сворачивает номер спавна, вид спавна остаётся; apiPath прежний — rbInfoNote узнаёт РБ', () => {
  const c = learnCore();
  assert.equal(c.learnKey('GET /game/spawn/l2dop_rb_25063/info'), 'GET /game/spawn/l2dop_rb_:n/info');
  assert.equal(c.learnKey('GET /game/spawn/sdms_saints_necropolis_012/info'), 'GET /game/spawn/sdms_saints_necropolis_:n/info');
  assert.equal(c.learnKey('GET /game/spawn/sdms_necropolis_of_martyrdom_015/info'), 'GET /game/spawn/sdms_necropolis_of_martyrdom_:n/info');
  assert.equal(c.learnKey('GET /game/spawn/l2dop_eg_29001_29002_0/info'), 'GET /game/spawn/l2dop_eg_:n/info');
  for (const k of ['GET /game/siege/l2dop_dion/state', 'GET /character/profession-quest/dwarf_artisan/status', 'POST /game/battle/action',
    'POST /game/news/7165a0e3-00fd-4e66-a8a1-267f7b49d476/read', 'GET /game/spawn/l2dop_rb_:n/info']) assert.equal(c.learnKey(k), k);
  const p = c.apiPath('/game/spawn/l2dop_rb_25063/info?x=1');
  assert.equal(p, '/game/spawn/l2dop_rb_25063/info'); assert.match(p, /^\/game\/spawn\/(l2dop_rb_\d+)\/info$/);
});
test('ревью: РБ×6, потом катакомбы и охрана эпика (и наоборот) — без ложного «ответ API изменился»', async () => {
  for (const order of ['rb-first', 'sdms-first']) {
    const c = learnCore(learnEmpty()); await c.learnLoad();
    const rb = i => c.learnApi(`GET /game/spawn/l2dop_rb_${25000 + i}/info`, spawnRes(RB_ONLY));
    const cat = i => c.learnApi(`GET /game/spawn/sdms_saints_necropolis_0${10 + i}/info`, spawnRes());
    if (order === 'rb-first') { for (let i = 0; i < 6; i++) rb(i); cat(1); c.learnApi('GET /game/spawn/l2dop_eg_29001_29002_0/info', spawnRes()); }
    else { for (let i = 0; i < 6; i++) cat(i); rb(1); }
    assert.deepEqual(c.changes.filter(x => /ответ API изменился/.test(x)), [], order);
    assert.ok(c.L.api['GET /game/spawn/l2dop_rb_:n/info'] && c.L.api['GET /game/spawn/sdms_saints_necropolis_:n/info'], order);
  }
  // настоящее изменение у РБ по-прежнему видно
  const c = learnCore(learnEmpty()); await c.learnLoad();
  for (let i = 0; i < 6; i++) c.learnApi(`GET /game/spawn/l2dop_rb_${25000 + i}/info`, spawnRes(RB_ONLY));
  c.learnApi('GET /game/spawn/l2dop_rb_25099/info', spawnRes(['canAttackRaidBoss']));
  assert.match(c.changes.join('\n'), /l2dop_rb_:n\/info: пропали поля minRaidBossLevelForAttack, scrollDrops/);
});
test('learnLoad: старые ключи спавнов слиты по виду вместе со схемами; «новый запрос API» по ним убран; ранние запросы страницы дописаны (23:29:46 /game/craft/*)', async () => {
  const rec = (n, keys, first, last) => ({ n, keys: Object.fromEntries(keys.map(k => [k, n])), forms: { success: { n, keys: Object.fromEntries(keys.map(k => [k, n])) } }, st: { 200: n }, first, last, page: 'map' });
  const blk = [...SPAWN_BASE, ...RB_ONLY, 'raidBossAttackBlockedReasonUk'];
  const c = learnCore({ v: 1, t0: 1, sel: {}, pages: {}, api: {
      // первым — РБ, у которого все 5 ответов с причиной запрета: схема одного РБ не должна стать схемой всех РБ
      'GET /game/spawn/l2dop_rb_25444/info': rec(5, blk, 5, 10),
      'GET /game/spawn/l2dop_rb_25032/info': rec(10, [...SPAWN_BASE, ...RB_ONLY], 3, 20),
      'GET /game/spawn/l2dop_rb_29056/info': rec(11, [...SPAWN_BASE, ...RB_ONLY], 4, 30),
      'GET /game/spawn/sdms_saints_necropolis_023/info': rec(3, SPAWN_BASE, 7, 8),
      'GET /character': { keys: {}, forms: {}, st: { 200: 1 }, n: 1, first: 1, last: 1 } },
    changes: [{ kind: 'новый запрос API', what: 'GET /game/spawn/l2dop_rb_25032/info (со страницы «map»)' }, { kind: 'новый запрос API', what: 'POST /game/mammon/teleport (со страницы «mammon»)' }, { kind: 'ответ API изменился', what: 'GET /character: новые поля x' }] });
  c.early.push(['GET /game/craft/materials', { status: 200, res: { materials: [] } }], ['GET /game/spawn/l2dop_rb_7/info', spawnRes(RB_ONLY)]);
  await c.learnLoad();
  const A = c.L.api, R = A['GET /game/spawn/l2dop_rb_:n/info'];
  assert.deepEqual(Object.keys(A).sort(), ['GET /character', 'GET /game/craft/materials', 'GET /game/spawn/l2dop_rb_:n/info', 'GET /game/spawn/sdms_saints_necropolis_:n/info']);
  assert.equal(R.n, 27); assert.equal(R.first, 3); assert.ok(R.last > 30, 'ранний запрос дописан'); assert.equal(R.st[200], 27);
  assert.equal(R.forms.success.n, 27); assert.equal(R.forms.success.keys.raidBossAttackBlockedReasonUk, 5); assert.equal(R.forms.success.keys.canAttackRaidBoss, 27);
  assert.deepEqual(c.L.changes.map(x => x.what), ['POST /game/mammon/teleport (со страницы «mammon»)', 'GET /character: новые поля x']);
  assert.equal(c.early.length, 0); assert.equal(c.boot, false);
  c.learnApi('GET /game/spawn/l2dop_rb_25999/info', spawnRes(RB_ONLY));
  c.learnApi('GET /game/spawn/l2dop_rb_25444/info', spawnRes([...RB_ONLY, 'raidBossAttackBlockedReasonUk']));
  assert.equal(R.n, 29); assert.deepEqual(c.changes, [], 'РБ без причины запрета и с ней — не изменение игры');
});
test('ревью: копилка только до первой загрузки — обучение выключено при открытии или хранилище не ответило — не копим', async () => {
  // обычный путь: до загрузки копим (не больше 50), загрузка дописывает, дальше — сразу в обучение
  let c = learnCore(learnEmpty());
  for (let i = 0; i < 60; i++) c.learnNet('GET /game/craft/materials', { status: 200, res: { a: 1 } });
  assert.equal(c.early.length, 50);
  c.learnStart(); await new Promise(r => setImmediate(r));
  assert.equal(c.L.api['GET /game/craft/materials'].n, 50); assert.equal(c.early.length, 0);
  c.learnNet('GET /game/craft/materials', { status: 200, res: { a: 1 } }); assert.equal(c.L.api['GET /game/craft/materials'].n, 51);
  // обучение выключено при открытии страницы, потом включено в меню без перезагрузки — ответы не копятся
  c = learnCore(learnEmpty(), { cfg: { autoLearn: false } });
  c.learnNet('GET /character', { status: 200, res: { a: 1 } }); assert.equal(c.early.length, 0);
  c.learnStart(); assert.equal(c.boot, false); assert.equal(c.L, null);
  c.cfg.autoLearn = true;
  for (let i = 0; i < 5; i++) c.learnNet('POST /game/battle/action', { status: 200, res: { delta: {} } });
  assert.equal(c.early.length, 0); assert.equal(c.L, null);
  // хранилище не ответило — копилка очищена, дальше не копим
  c = learnCore(null, { fail: true });
  c.learnNet('GET /character', { status: 200, res: { a: 1 } }); assert.equal(c.early.length, 1);
  c.learnStart(); await new Promise(r => setImmediate(r));
  assert.equal(c.L, null); assert.equal(c.boot, false); assert.equal(c.early.length, 0);
  c.learnNet('GET /character', { status: 200, res: { a: 1 } }); assert.equal(c.early.length, 0);
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
test('ревью: окно TvT на странице победы — плановая закупка и закупка тура не начинаются, проверка окна раньше служебных походов', async () => {
  const run = async o => {
    const f = flowFixture('fighter'), e = f.env, shops = []; f.setWon(true); let waits = 0, buffs = 0;
    Object.assign(e.cfg, { shopAuto: true }); Object.assign(e.rt, { shopT: 0, ...o.rt });
    Object.assign(e, { magisterAfterWin: async () => false, magisterHold: () => o.hold, tvtHoldWait: async () => { if (!o.hold) return false; waits++; return true; },
      shopNeedByPanel: () => 'заряды душі на исходе', shopPlan: () => [], resQuests: () => [], huntOn: () => !!o.tour,
      shopStart: async (why, urgent) => { shops.push([why, !!urgent]); }, townBuffStart: async () => { buffs++; return false; } });
    await f.farm.nextFight(fightCtx);
    return { waits, shops, buffs, href: f.location.href, hunt: f.events.includes('hunt') };
  };
  // TvT через 150 с (окно 3 мин): запасов мало — ни закупки, ни перехода, одна проверка окна со строкой «жду»
  for (const tour of [false, true]) {
    const r = await run({ hold: true, tour });
    assert.equal(r.waits, 1, 'tour=' + tour); assert.deepEqual(r.shops, [], 'tour=' + tour); assert.equal(r.href, undefined, 'tour=' + tour); assert.equal(r.hunt, false); assert.equal(r.buffs, 0, 'к бафферу тоже не идём');
  }
  // заказанная игроком срочная закупка («🛒 Закупить сейчас») проходит, как и в ядре
  const u = await run({ hold: true, rt: { shop: { urgent: true, t: Date.now() } } });
  assert.equal(u.waits, 0); assert.equal(u.href, '/char.html');
  // вне окна — как раньше: плановая закупка начинается
  const n = await run({ hold: false });
  assert.equal(n.waits, 0); assert.deepEqual(n.shops, [['заряды душі на исходе', false]]); assert.equal(n.href, '/char.html');
});
