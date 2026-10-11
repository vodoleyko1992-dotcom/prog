'use strict';
// 8.0.3 (эпики, разбор 11.10 — логи 4ee00a04/d089c7e2, снимок 75dac78f): Coin of Luck — «0» = не тратить; единые ворота перед любой
// тратой CoL (свежий список, жив, игра пускает, цифры босса, вердикт); 1 платный заход на появление; резерв не снимается на таймауте;
// разбор строки .l2-rb-row (подсказка «Недоступно»); список и цифры — из ответов сервера; смерть без подтверждённого сохранения HP — ждать
// следующего появления; магазин не покупает за Coin of Luck
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js'), epicsSrc = read('modules/epics.js'), raidSrc = read('modules/raid.js');
const EPICS = vm.runInNewContext('(' + content.slice(content.indexOf('const EPICS = [') + 'const EPICS = '.length, content.indexOf('const EPIC_URL')).replace(/;\s*$/, '') + ')');
const LV_RE = vm.runInNewContext(content.match(/const LV_RE = (\/.+\/iu);/)[1]);
const base = JSON.parse(read('base-profile.json')).chars.Warlock.rt;
const fx = JSON.parse(read('tests/fixtures-epic-bosses-803.json'));
const clone = o => JSON.parse(JSON.stringify(o));
const H = 3600000, MIN = 60000;

// ---------- мини-DOM: разбор корректного HTML-фрагмента + простые селекторы (тег, #id, .класс, [атр], [атр="v"], [атр*="v"], [атр$="v"], :not()) ----------
const ENT = { lt: '<', gt: '>', amp: '&', nbsp: ' ', quot: '"' };
const decode = t => t.replace(/&(lt|gt|amp|nbsp|quot);/g, (_, k) => ENT[k]);
function El(tag, attrs, parent) { this.tag = tag; this.attrs = attrs; this.kids = []; this.parentElement = parent || null; }
El.prototype = {
  get className() { return this.attrs.class || ''; }, get hidden() { return 'hidden' in this.attrs; }, get disabled() { return 'disabled' in this.attrs; },
  get id() { return this.attrs.id || ''; },
  get dataset() { const o = {}; for (const [k, v] of Object.entries(this.attrs)) if (k.startsWith('data-')) o[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v; return o; },
  get textContent() { return this.kids.map(k => k.text != null ? k.text : k.textContent).join(''); }, set textContent(v) { this.kids = [{ text: String(v) }]; },
  get innerText() { return this.textContent; }, get classList() { return { contains: c => this.className.split(/\s+/).includes(c) }; },
  get nextElementSibling() { const p = this.parentElement, a = p ? p.kids.filter(k => k instanceof El) : []; return a[a.indexOf(this) + 1] || null; },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
  setStatus(cls, txt) { this.attrs.class = cls; this.textContent = txt; },
  all() { const out = []; const walk = e => { for (const k of e.kids) if (k instanceof El) { out.push(k); walk(k); } }; walk(this); return out; },
  querySelectorAll(sel) { return this.all().filter(e => matches(e, sel)); }, querySelector(sel) { return this.all().find(e => matches(e, sel)) || null; },
  closest(sel) { for (let e = this; e && e.tag !== '#root'; e = e.parentElement) if (matches(e, sel)) return e; return null; },
};
function matchOne(el, sel) {
  let s = sel.trim(); const tm = s.match(/^[a-zA-Z][\w-]*/);
  if (tm) { if (el.tag !== tm[0].toLowerCase()) return false; s = s.slice(tm[0].length); }
  while (s) {
    let m;
    if ((m = s.match(/^\.([\w-]+)/))) { if (!el.className.split(/\s+/).includes(m[1])) return false; }
    else if ((m = s.match(/^#([\w-]+)/))) { if (el.attrs.id !== m[1]) return false; }
    else if ((m = s.match(/^\[([\w-]+)(?:([*$]?=)"([^"]*)")?\]/))) { const v = el.attrs[m[1]]; if (v == null || (m[2] === '=' && v !== m[3]) || (m[2] === '*=' && !v.includes(m[3])) || (m[2] === '$=' && !v.endsWith(m[3]))) return false; }
    else if ((m = s.match(/^:not\(([^)]+)\)/))) { if (matchOne(el, m[1])) return false; }
    else throw new Error('selector not supported: ' + sel);
    s = s.slice(m[0].length);
  }
  return true;
}
function matchDesc(el, sel) {                      // «A B» — потомок: B на элементе, A у кого-то из предков
  const parts = sel.trim().split(/\s+(?![^[]*\])/);
  if (!matchOne(el, parts.pop())) return false;
  for (let e = el.parentElement; parts.length && e && e.tag !== '#root'; e = e.parentElement) if (matchOne(e, parts[parts.length - 1])) parts.pop();
  return !parts.length;
}
const matches = (el, sel) => sel.split(',').some(x => matchDesc(el, x));
function parseHTML(html) {
  const top = new El('#root', {}), stack = [top], re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z0-9]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g; let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    const cur = stack[stack.length - 1];
    if (m[4] != null) { cur.kids.push({ text: decode(m[4]) }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { while (stack.length > 1 && stack.pop().tag !== tag); continue; }
    const attrs = {}; m[3].replace(/([\w:-]+)(?:="([^"]*)")?/g, (_, k, v) => { attrs[k] = decode(v ?? ''); });
    const el = new El(tag, attrs, cur); cur.kids.push(el);
    if (!/^(img|br|input|meta|link|hr)$/.test(tag)) stack.push(el);
  }
  return top;
}
const docOf = html => { const top = parseHTML(html); return { querySelectorAll: s => top.querySelectorAll(s), querySelector: s => top.querySelector(s), body: { get innerText() { return top.textContent; } }, top }; };
const pageHtml = read('tests/fixtures-epic-page-803.html');

// ---------- окружение модулей (как в content.js: зависимости только через env) ----------
function mk(o = {}) {
  const logs = [], fires = [], calls = [], store = {};
  let doc = o.doc || docOf('');
  const loc = { pathname: o.path || '/map.html', search: o.search || '', href: '' };
  const sessionStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const fetchMock = async u => { calls.push(u); const r = o.net?.(u); if (!r) throw new Error('net'); return { ok: true, status: 200, json: async () => clone(r) }; };
  const sb = { console, Date, Math, JSON, URLSearchParams, CSS: { escape: s => s }, AbortController, setTimeout, clearTimeout, sessionStorage, fetch: fetchMock,
    get document() { return doc; }, location: loc };
  sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(raidSrc, sb); vm.runInContext(epicsSrc, sb);
  let hero = o.hero || 54;
  const env = { EPICS, EPIC_URL: '/epic-bosses.html', LV_RE, on: true,
    cfg: { epicMode: true, epicList: 'ak,core,orfen,zaken,baium,antharas,valakas,frintezza', epicCoinDailyMax: 0, epicCoinPerBoss: 1, epicMaxDeaths: 3, epicMaxFightMin: 30, epicMaxRetreats: 8, autoRevive: true, rbRestHp: 95, ...(o.cfg || {}) },
    rt: { rbStats: clone(base.rbStats), rbDb: clone(base.rbDb), rbK: base.rbK, rbDps: base.rbDps, rbLossK: base.rbLossK, ...(o.rt || {}) },
    heroLvl: () => hero, meHp: o.meHp || (() => ({ max: 4843, cur: 4843, pct: 100 })), meMp: () => ({ cur: 3794, max: 3794 }),
    potModel: () => ({ pool: 600000, rate: 2000, n: 960 }), fmtK: n => String(Math.round(n)), fmtT: s => String(Math.round(s)),
    invQty: o.invQty || (() => null), setRt: async p => { Object.assign(env.rt, p); }, rec: (...a) => logs.push(a.slice(1).join(' ')), recBot: m => logs.push(m),
    setStatus() {}, sleep: async () => {}, waitX: async f => f() || null, mapReady: async () => true, isMap: () => loc.pathname === '/map.html',
    isFishing: () => false, fishState: () => null, aroundSig: () => ({ ids: [] }), shown: el => !!el && !el.hidden && !el.closest?.('[hidden]'),
    fire: el => { fires.push(el); return o.fireOk !== false; }, pause: async () => {}, transitionMonitor: { expect() {}, check: () => 'pending', clear() {} },
    $q: s => doc.querySelector(s), rbShopFirst: async () => false, townBuffStart: async () => false, restoreVitals: async () => false, buffWaitBeforeRb: () => null,
    rbEngage: async () => true, attackSpawn: async () => false, map: async () => 'map', ...(o.env || {}) };
  const R = sb.L2V7Factories.raid(env);
  env.rbPreCheck = R.rbPreCheck; env.rbInfo = R.rbInfo; env.epicById = id => sb.L2V7Factories && E.epicById(id);
  const E = sb.L2V7Factories.epics(env);
  return { env, E, R, logs, fires, calls, store, loc, setDoc: d => { doc = d; }, setHero: h => { hero = h; } };
}
const QA = { hp: 429898, patk: 3150, pdef: 1985, matk: 2562, mdef: 1823 };                  // окно Королевы Муравьёв (снимок 75dac78f)
const WEAK = { stats: { maxHp: 400000, pAtk: 1100, pDef: 700, mAtk: 700, mDef: 800 }, drops: [{ kind: 'adena', chance: 1, min: 90000, max: 110000 }, { kind: 'equipment', chance: 0.3, displayName: 'Ring of Core' }, '…ещё 4'], rewardExp: 900000, rewardSp: 200000 };
const listAlive = (k, alive = true) => { const j = clone(fx); for (const b of j.bosses) if (b.spawnId === k) b.isAlive = alive; return j; };
const T0 = Date.parse('2026-10-10T23:03:37Z');

(async () => {
  // ---------- T1: /game/epic-bosses → epicDb ----------
  {
    const { env, E, logs } = mk();
    assert.ok(await E.epicApiNote(fx, 'api', T0));
    const db = env.rt.epicDb;
    assert.equal(db.ak.canAttack, false); assert.equal(db.ak.deny, 'Epic Boss нижче дозволеного рівня.');
    assert.equal(db.orfen.canAttack, true); assert.equal(db.baium.canAttack, true, 'server shows no upper level limit');
    assert.equal(db.frintezza.lvl, 90); assert.equal(db.valakas.respH, 240); assert.equal(db.zaken.respH, 36);
    assert.ok(Object.values(db).every(d => d.alive === false && d.col === 1 && d.adena === 0 && d.paidN === 0));
    assert.equal(db.ak.until.hi, T0 + 12 * H); assert.equal(db.ak.until.lo, 0, 'never seen alive → only the upper bound');
    assert.equal(env.rt.epicApi.minLvl, 45); assert.equal(env.rt.epicApi.charLvl, 54);
    assert.match(env.rt.epicApi.keys, /attackBlockedReasonUk,.*respawnHours/); assert.ok(logs.some(l => /поля эпика/.test(l)), 'key set logged');
    // урезанный / не полный список не разбирается
    const cut = clone(fx); cut.bosses = [...cut.bosses.slice(0, 7), '…ещё 1'];
    assert.equal(await E.epicApiNote(cut, 'page', T0), null);
    const short = clone(fx); short.bosses.pop(); assert.equal(await E.epicApiNote(short, 'page', T0), null, 'length ≠ total');
    // жив → мёртв: окно [последний раз жив + 12 ч, впервые мёртв + 12 ч]; платные заходы появления обнуляются
    await E.epicApiNote(listAlive('l2dop_rb_29014'), 'api', T0 + H);
    assert.ok(logs.some(l => /🐉 Орфен появился/.test(l)));
    await E.epicDbSet('orfen', { paidN: 1 });
    await E.epicApiNote(fx, 'api', T0 + 2 * H);
    const o = env.rt.epicDb.orfen;
    assert.deepEqual([o.until.lo, o.until.hi], [T0 + 13 * H, T0 + 14 * H]); assert.equal(o.paidN, 0);
    assert.ok(logs.some(l => /Орфен убит — появится между/.test(l)));
    // время от сервера (если пришлёт) — точное
    const fx2 = clone(fx); fx2.bosses[1].respawnAt = new Date(T0 + 5 * H).toISOString();
    await E.epicApiNote(fx2, 'api', T0 + 3 * H); assert.equal(env.rt.epicDb.orfen.until.exact, true); assert.equal(env.rt.epicDb.orfen.until.hi, T0 + 5 * H);
    console.log('PASS T1: /game/epic-bosses parsed (deny, levels, respawn, CoL cost, dead-until window, key set), truncated lists ignored');
  }
  // ---------- T2: окно появления и расписание опроса ----------
  {
    const { env, E } = mk({ cfg: { epicList: 'orfen' } });
    assert.deepEqual(clone(E.epicUntil({ alive: false, killT: T0, respH: 12 })), { lo: T0 + 12 * H, hi: T0 + 12 * H, exact: true, late: false });
    const last = Date.now() - 30 * 1000;
    env.rt.epicApi = { t: last, minLvl: 45, charLvl: 54 };
    const now = Date.now(), set = d => { env.rt.epicDb = { orfen: { lvl: 50, canAttack: true, alive: false, respH: 12, ...d } }; };
    set({ killT: now - 11 * H });                         // точное время через час
    assert.equal(E.epicApiNext(now), now - 11 * H + 12 * H - 5 * MIN, 'nothing before lo − 5 min'); assert.equal(E.epicApiDue(now), false);
    set({ killT: now - 12 * H + 2 * MIN }); assert.equal(E.epicApiNext(now), last + MIN, 'exact window: every minute');
    set({ deadT: now - 11.9 * H, aliveT: now - 12.1 * H }); assert.equal(E.epicApiNext(now), last + 3 * MIN, 'window with both bounds: 3 min');
    set({ deadT: now - 6 * H }); assert.equal(E.epicApiNext(now), last + 15 * MIN, 'lower bound unknown: 15 min');
    set({ deadT: now - 13 * H }); assert.equal(E.epicApiNext(now), last + 10 * MIN, 'after the window: 10 min');
    set({ deadT: now - 6 * H, verdict: { v: 'strong' } }); assert.equal(E.epicApiNext(now), last + 2 * H, 'nothing suitable: 2 h');
    env.rt.epicApi = null; assert.equal(E.epicApiDue(now), true, 'never asked — ask now');
    console.log('PASS T2: dead-until window, poll schedule (none before window, 1/3/15 min inside, 10 min after, 2 h if nothing suitable)');
  }
  // ---------- T3: бюджет Coin of Luck / цена / единица ----------
  {
    const { env, E } = mk({ rt: { epicDb: { orfen: { col: 1, adena: 0, apiT: Date.now(), paidN: 0 } } } });
    const pr = E.epicPrice('orfen', { priceKnown: true, price: 1, priceUnit: 'Coin of Luck', priceText: '(1 Coin of Luck)' });
    assert.deepEqual([pr.known, pr.col], [true, 1]);
    assert.match(E.epicTpBudgetQuote(pr, 'orfen').why, /лимит Coin of Luck = 0 \(не тратить\)/);
    env.cfg.epicCoinDailyMax = 2; assert.equal(E.epicTpBudgetQuote(pr, 'orfen').ok, true);
    env.rt.epicTpBudget = [{ t: Date.now() - 1000, k: 'core', cost: 2, unit: 'Coin of Luck' }]; assert.equal(E.epicTpBudgetQuote(pr, 'orfen').ok, false, '2/2 per 24 h');
    env.rt.epicTpBudget = []; env.rt.epicDb.orfen.paidN = 1; assert.match(E.epicTpBudgetQuote(pr, 'orfen').why, /предел 1/);
    assert.equal(E.epicTpBudgetQuote({ known: true, col: 15, adena: 0 }, 'orfen', { kind: 'buff' }).ok, false, 'buff 15 > daily 2');
    env.cfg.epicCoinDailyMax = 20; assert.equal(E.epicTpBudgetQuote({ known: true, col: 15, adena: 0 }, 'orfen', { kind: 'buff' }).ok, true, 'buff ignores the per-spawn rule');
    env.cfg.epicCoinDailyMax = 2; env.rt.epicDb.orfen.paidN = 0; env.cfg.epicCoinKeep = 30;
    assert.match(E.epicTpBudgetQuote(pr, 'orfen').why, /неизвестен/);
    env.invQty = () => 30; assert.match(E.epicTpBudgetQuote(pr, 'orfen').why, /баланс 30, запас 30/);
    env.invQty = () => 31; assert.equal(E.epicTpBudgetQuote(pr, 'orfen').ok, true); env.cfg.epicCoinKeep = 0;
    assert.equal(E.epicTpBudgetQuote({ known: false }, 'orfen').ok, false, 'unknown price is refused even with a limit');
    assert.equal(E.unitOf('1 ?'), ''); assert.equal(E.unitOf('1 Монета удачі'), 'Coin of Luck'); assert.equal(E.unitOf('7 000 аден'), 'аден');
    const odd = E.epicPrice('orfen', { priceKnown: true, price: 1, priceUnit: E.unitOf('1 ?'), priceText: '1 ?' });
    assert.equal(odd.known, false); assert.equal(E.epicTpBudgetQuote(odd, 'orfen').ok, false, 'unrecognised unit → refuse');
    env.rt.epicDb.orfen.col = 0; assert.equal(E.epicPrice('orfen', { priceKnown: true, price: 1, priceUnit: 'Coin of Luck' }).col, 1, 'DOM says 1 CoL while API says 0 → the higher');
    env.rt.epicDb.orfen.vipFree = true; const vip = E.epicPrice('orfen', null);
    assert.equal(vip.free, true); const q = await E.epicTpBudgetReserve('orfen', vip);
    assert.equal(q.ok, true); assert.equal(q.cost, 0); assert.equal((env.rt.epicTpBudget || []).length, 0, 'VIP: nothing reserved'); assert.equal(env.rt.epicDb.orfen.paidN, 0);
    env.cfg.epicCoinDailyMax = 0; env.cfg.epicAdenaDailyMax = 0;
    assert.equal(E.epicTpBudgetQuote({ known: true, col: 0, adena: 8000 }, 'orfen').ok, true, 'adena limit 0 = no limit');
    env.cfg.epicCoinDailyMax = 2; assert.equal(E.epicTpBudgetQuote({ price: 1, priceKnown: true, priceUnit: 'Coin of Luck' }, 'ak').ok, true, 'old row-style call');
    console.log('PASS T3: CoL 0 = never, daily cap, 1 per spawn, keep balance, unknown price/unit refused, DOM vs API → higher, VIP free, adena as before');
  }
  // ---------- T4: вердикт по силам (базовый профиль, макс. HP 4843) ----------
  {
    const { env, E, setHero } = mk({ rt: { epicDb: { ak: { id: 'l2dop_rb_29001', canAttack: true, lvl: 40 } } } });
    env.rt.rbStats.l2dop_rb_29001 = { ...QA, src: 'api' };
    setHero(48);                                        // уровень, при котором игра пустила бы к Королеве
    const v = E.epicVerdict('ak');
    assert.equal(v.v, 'strong', v.why); assert.ok(Math.abs(v.sp - 2306) <= 5, 'special ≈0.9 × M.Atk: ' + v.sp); assert.ok(v.spPct >= 45);
    setHero(54); env.rt.epicDb.ak = { id: 'l2dop_rb_29001', canAttack: false, deny: 'Epic Boss нижче дозволеного рівня.', apiLvl: 54, lvl: 40 };
    assert.equal(E.epicVerdict('ak').v, 'level');
    assert.equal(E.epicVerdict('orfen').v, 'unknown', 'no stats → unknown (never pay)');
    env.rt.rbStats.l2dop_rb_29014 = { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' };
    const ok = E.epicVerdict('orfen'); assert.equal(ok.v, 'ok', ok.why);
    env.rt.rbStats.l2dop_rb_29014 = { hp: 9000000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' };
    const sl = E.epicVerdict('orfen'); assert.ok(['slow', 'pots'].includes(sl.v), sl.v + ' ' + sl.why);
    env.rt.rbStats.l2dop_rb_29014 = { hp: 400000, patk: 1100, matk: 700, mdef: 2400, pdef: 700, src: 'api' };
    const corr = E.epicVerdict('orfen'); assert.ok(corr.dps < base.rbDps * 0.5, 'M.Def correction is conservative: ' + corr.dps);
    env.rt.rbDb.l2dop_rb_29014 = { dps: 5000 }; assert.equal(E.epicVerdict('orfen').dps, 5000, 'measured DPS on it — no M.Def correction');
    // макс. HP героя неизвестно → «неизвестно», запасные 6000 HP не решают (на 6000 Королева прошла бы)
    const { env: e2, E: E2, setHero: sh2 } = mk({ meHp: () => null, rt: { epicDb: { ak: { id: 'l2dop_rb_29001', canAttack: true, lvl: 40 } } } });
    e2.rt.rbStats.l2dop_rb_29001 = { ...QA, src: 'api' }; sh2(48);
    assert.equal(E2.epicVerdict('ak').v, 'unknown');
    assert.equal(e2.rbPreCheck('l2dop_rb_29001', { ...QA, est: false }).spPct, 38, 'rbPreCheck alone would fall back to 6000 HP (2306 = 38 %)');
    assert.equal(e2.rbPreCheck('l2dop_rb_29001', { ...QA, est: false }, 1, 700, 4843).spPct, 48, 'hpOver wins over the fallback');
    console.log('PASS T4: verdicts — Queen Ant strong (2306 ≈48 %), level, unknown, ok, slow/pots, conservative DPS, unknown hero HP → unknown');
  }
  // ---------- T5: единые ворота epicPayGate ----------
  {
    const { env, E, calls } = mk({ rt: { epicDb: { orfen: { id: 'l2dop_rb_29014', col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50 } } } });
    const g0 = await E.epicPayGate('orfen');
    assert.equal(g0.ok, false); assert.match(g0.why, /лимит Coin of Luck = 0/); assert.equal(calls.length, 0, 'limit 0: not even asking the server');
    assert.equal((env.rt.epicTpBudget || []).length, 0);
    const net = u => /epic-bosses/.test(u) ? listAlive('l2dop_rb_29014') : /spawn\/l2dop_rb_29014\/info/.test(u) ? WEAK : null;
    const m = mk({ cfg: { epicCoinDailyMax: 2 }, net, rt: { epicDb: { orfen: { id: 'l2dop_rb_29014', col: 1, adena: 0, apiT: Date.now() - 3 * MIN, alive: true, canAttack: true, lvl: 50 } } } });
    const g = await m.E.epicPayGate('orfen');
    assert.equal(m.calls[0], '/game/epic-bosses?page=1', 'stale list (> 2 min) → fresh list first');
    assert.equal(m.calls[1], '/game/spawn/l2dop_rb_29014/info', 'no boss numbers → spawn info');
    assert.equal(g.ok, true, g.why); assert.equal(m.env.rt.rbStats.l2dop_rb_29014.from, 'api');
    await m.E.epicTpBudgetReserve('orfen', g.price); assert.equal(m.env.rt.epicDb.orfen.paidN, 1); assert.equal(m.env.rt.epicTpBudget.length, 1);
    const d = mk({ cfg: { epicCoinDailyMax: 2 }, net: u => /epic-bosses/.test(u) ? fx : WEAK, rt: { epicDb: { orfen: { id: 'l2dop_rb_29014', col: 1, apiT: 0, lvl: 50 } } } });
    const gd = await d.E.epicPayGate('orfen'); assert.equal(gd.ok, false); assert.match(gd.why, /мёртв/);
    const dd = mk({ cfg: { epicCoinDailyMax: 2 }, net, rt: { deaths1h: [Date.now() - 1000, Date.now() - 2000], epicDb: { orfen: { id: 'l2dop_rb_29014', apiT: 0, lvl: 50 } } } });
    const g2 = await dd.E.epicPayGate('orfen'); assert.equal(g2.ok, false); assert.match(g2.why, /2 смерти за последний час/);
    const nf = mk({ cfg: { epicCoinDailyMax: 2 }, net: () => null, rt: { epicDb: { orfen: { id: 'l2dop_rb_29014', apiT: 0, lvl: 50 } } } });
    assert.match((await nf.E.epicPayGate('orfen')).why, /не получен/, 'no list from the server → no payment');
    console.log('PASS T5: pay gate — limit 0 without network, fresh list then spawn info, ok → reserve (paidN 1), dead / deaths / no list → refuse');
  }
  // ---------- T6: дорога — эпик на карте, страница, таймаут, отказ сервера, повторная оплата ----------
  const pin = '<div><button class="l2-map-mob-pin l2-map-mob-pin--epic" data-spawn-id="l2dop_rb_29014" title="Орфен · ур. 50 · епік-бос"></button></div>';
  const alivePage = pageHtml.replace(/(data-spawn-id="l2dop_rb_29014"[\s\S]*?)l2-rb-row__status--dead"> · Убит/, '$1l2-rb-row__status--alive"> · Живий');
  const okDb = (x = {}) => ({ orfen: { id: 'l2dop_rb_29014', col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50, respH: 12, ...x } });
  const okStats = () => ({ ...clone(base.rbStats), l2dop_rb_29014: { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' } });
  {
    const m = mk({ doc: docOf(pin), cfg: { epicCoinDailyMax: 2 }, rt: { epicDb: okDb(), rbStats: okStats(), epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен' } } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'arrive'); assert.equal(m.env.rt.epic.via, 'here'); assert.equal(m.loc.href, '', 'no epic page');
    assert.equal((m.env.rt.epicTpBudget || []).length, 0, 'free — nothing reserved'); assert.ok(m.logs.some(l => /он здесь, на этой карте — без телепорта/.test(l)));
    // подтверждённый отход → prep (только бесплатно) → go → он здесь, второй оплаты нет
    m.store['l2bot.epicLeave'] = JSON.stringify({ id: 'l2dop_rb_29014', at: Date.now(), ok: true });
    m.env.rt.epic = { step: 'retreatVerify', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', retreatT: Date.now() - 1000, retreatAttempt: { t: Date.now(), cur: 300000, max: 400000, chip: 100000, sec: 60, dps: 1666 } };
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'prep'); assert.equal(m.env.rt.epic.noPay, true); assert.equal(m.env.rt.rbDb.l2dop_rb_29014.dps, 1666, 'DPS on it from the attempt');
    await m.E.epicStep(); assert.equal(m.env.rt.epic.step, 'go');
    await m.E.epicStep(); assert.equal(m.env.rt.epic.via, 'here'); assert.equal((m.env.rt.epicTpBudget || []).length, 0, 'no second payment');
  }
  {   // страница: оплата → таймаут перехода без отказа сервера — резерв остаётся, шаг «прилёт» страницей
    const m = mk({ doc: docOf(alivePage), path: '/epic-bosses.html', search: '?page=1', cfg: { epicCoinDailyMax: 2 },
      rt: { epicDb: okDb(), rbStats: okStats(), epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await m.E.epicStep();
    assert.equal(m.fires.length, 1); assert.equal(m.fires[0].className, 'l2-rb-row__tp', 'the teleport button, not the name');
    assert.equal(m.env.rt.epicTpBudget.length, 1, 'reserve kept on transition timeout'); assert.equal(m.env.rt.epicDb.orfen.paidN, 1);
    assert.equal(m.env.rt.epic.step, 'arrive'); assert.equal(m.env.rt.epic.via, 'page');
    // сервер отказал (POST …/teleport, ответ в sessionStorage) → резерв снят, paidN откатан
    m.store['l2bot.epicTp'] = JSON.stringify({ path: '/game/epic-boss/teleport', status: 400, ok: false, msg: 'Недостатньо Coin of Luck', t: Date.now() });
    await m.E.epicStep();
    assert.equal(m.env.rt.epicTpBudget.length, 0); assert.equal(m.env.rt.epicDb.orfen.paidN, 0); assert.equal(m.env.rt.epic.step, 'pick');
    // второй раз: телепорт прошёл, но карты нет >90 с, логово не подтверждено → ждать следующего появления, страницей НЕ идти
    m.env.rt.epicDb.orfen.skipT = 0; m.store['l2bot.epicTp'] = null; delete m.store['l2bot.epicTp'];
    m.env.rt.epic = { step: 'arrive', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', via: 'page', at: Date.now() - 95000, tpT: Date.now() - 95000 };
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'pick'); assert.ok(m.env.rt.epicDb.orfen.skipT > Date.now() + 11 * H, 'until the next spawn'); assert.notEqual(m.loc.href, '/epic-bosses.html');
  }
  {   // Валакас (логова нет, tp:null): раньше через 90 с снова платил страницей (:331)
    const m = mk({ cfg: { epicCoinDailyMax: 2 }, path: '/town.html', rt: { epicDb: { valakas: { id: 'l2dop_rb_29028', respH: 240, alive: true } }, epic: { step: 'arrive', k: 'valakas', id: 'l2dop_rb_29028', name: 'Валакас', via: 'page', at: Date.now() - 95000 } } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'pick'); assert.notEqual(m.env.rt.epic.via, 'page'); assert.ok(m.env.rt.epicDb.valakas.skipT > Date.now() + 200 * H);
  }
  {   // логово за адену: только живой (свежий ответ сервера) и «по силам»; на месте — логово подтверждено, локация запомнена
    const zc = { sea_of_spores: { name: 'Sea of Spores', price: 6000 } };
    const m = mk({ path: '/town.html', rt: { epicDb: okDb(), rbStats: okStats(), zoneCat: zc, epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.via, 'zone'); assert.equal(m.env.rt.zoneGo.id, 'sea_of_spores');
    assert.deepEqual(m.env.rt.epicTpBudget.map(x => [x.cost, x.unit, x.kind]).join(), '6000,аден,lair', 'adena reserved, Coin of Luck not touched (limit 0)');
    m.loc.pathname = '/map.html'; m.setDoc(docOf(pin)); m.env.rt.zone = 'sea_of_spores';
    await m.E.epicStep();
    assert.ok(m.env.rt.epicDb.orfen.lairOkT); assert.equal(m.env.rt.epicDb.orfen.seenZone, 'sea_of_spores'); assert.equal(m.env.rt.epic.step, 'fight');
    const d = mk({ path: '/town.html', net: () => fx, rt: { epicDb: okDb({ apiT: 0 }), rbStats: okStats(), zoneCat: zc, epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await d.E.epicStep();
    assert.equal(d.calls[0], '/game/epic-bosses?page=1', 'stale list → asked before the road'); assert.equal(d.env.rt.zoneGo, undefined, 'dead — no lair trip'); assert.equal(d.env.rt.epic.step, 'pick');
  }
  {   // кнопка не нажалась → резерв снят
    const m = mk({ doc: docOf(alivePage), path: '/epic-bosses.html', fireOk: false, cfg: { epicCoinDailyMax: 2 },
      rt: { epicDb: okDb(), rbStats: okStats(), epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epicTpBudget.length, 0); assert.equal(m.env.rt.epicDb.orfen.paidN, 0);
    // лимит 0 — на странице ничего не нажимаем
    const z = mk({ doc: docOf(alivePage), path: '/epic-bosses.html', rt: { epicDb: okDb(), rbStats: okStats(), epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await z.E.epicStep();
    assert.equal(z.fires.length, 0); assert.equal((z.env.rt.epicTpBudget || []).length, 0); assert.match(z.env.rt.epicDb.orfen.why, /лимит Coin of Luck = 0/);
    console.log('PASS T6: road — epic on this map without teleport, retreat → free only, page: reserve kept on timeout, refusal releases it, no second page payment (incl. Valakas), click failure releases');
  }
  // ---------- T7: смерть и сохранение HP ----------
  {
    const fight = { step: 'fight', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', died: true, kills0: 0, hpLog: [{ t: Date.now(), cur: 300000, max: 400000 }], startHp: 400000 };
    const m = mk({ cfg: { epicCoinDailyMax: 2 }, rt: { epicDb: okDb({ paidN: 1 }), rbStats: okStats(), epic: clone(fight) } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'pick'); assert.ok(m.env.rt.epicDb.orfen.skipT > Date.now() + 11 * H, 'persist unknown → next spawn');
    const p = mk({ cfg: { epicCoinDailyMax: 2 }, rt: { epicDb: okDb({ paidN: 1, persist: true }), rbStats: okStats(), epic: clone(fight) } });
    await p.E.epicStep();
    assert.equal(p.env.rt.epic.step, 'prep'); assert.equal(p.env.rt.epic.noPay, true); assert.equal(p.env.rt.epic.deaths, 1);
    p.env.rt.epic.step = 'go'; p.env.rt.epic.mapChecked = true; p.loc.pathname = '/town.html';
    await p.E.epicStep();
    assert.equal(p.env.rt.epic.step, 'pick'); assert.equal((p.env.rt.epicTpBudget || []).length, 0, 'after death: no Coin of Luck even with a limit');
    const r = mk({ rt: { epicDb: okDb({ retreatsLife: 7 }), epic: { step: 'retreatVerify', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', retreatT: Date.now() - 1000 } } });
    r.store['l2bot.epicLeave'] = JSON.stringify({ id: 'l2dop_rb_29014', at: Date.now(), ok: true });
    await r.E.epicStep(); assert.equal(r.env.rt.epic.step, 'pick'); assert.match(r.env.rt.epicDb.orfen.why, /8 отходов/);
    const killed = mk({ rt: { epicDb: okDb({ paidN: 1 }), rbDb: { l2dop_rb_29014: { kills: 1 } }, epic: { ...clone(fight), died: false } } });
    await killed.E.epicStep();
    assert.equal(killed.env.rt.epicDb.orfen.paidN, 0); assert.equal(killed.env.rt.epicDb.orfen.until.exact, true); assert.ok(killed.logs.some(l => /следующее появление ровно в/.test(l)));
    const combat = read('modules/combat.js');
    assert.match(combat, /if \(reset \|\| keep\) await env\.epicDbSet\(ek, \{ persist: !!keep, persistT: Date\.now\(\) \}\);/);
    assert.match(combat, /Date\.now\(\) - \(last\.t \|\| 0\) >= 60000 && mob0\.cur <= last\.cur \+ mob0\.max \* 0\.02/);
    console.log('PASS T7: death without confirmed HP persistence → next spawn; with persistence → free retry only; 8 retreats → next spawn; kill → exact next spawn');
  }
  // ---------- T8: выбор ----------
  {
    const db = { ak: { lvl: 40, canAttack: false, apiLvl: 54, deny: 'Epic Boss нижче дозволеного рівня.', alive: true, apiT: Date.now() },
      core: { lvl: 50, canAttack: true, alive: true, apiT: Date.now(), col: 1, adena: 0, verdict: { v: 'strong', why: 'спецудар 60%' } },
      orfen: { lvl: 50, canAttack: true, alive: true, apiT: Date.now(), col: 1, adena: 0, verdict: { v: 'ok', why: 'ок' } },
      zaken: { lvl: 60, canAttack: true, alive: true, apiT: Date.now(), col: 1, adena: 0, verdict: { v: 'unknown', why: 'нет цифр' } },
      baium: { lvl: 75, canAttack: true, alive: true, apiT: Date.now(), col: 1, adena: 0, verdict: { v: 'ok', why: 'ок' } } };
    const m = mk({ cfg: { epicCoinDailyMax: 2, epicList: 'ak,core,zaken,baium,orfen' }, rt: { epicDb: clone(db), epicApi: { t: Date.now(), minLvl: 45, charLvl: 54 } } });
    assert.equal(m.E.epicPick()?.k, 'orfen');
    assert.match(m.E.epicPickWhy('ak'), /⛔/); assert.match(m.E.epicPickWhy('core'), /❌/); assert.match(m.E.epicPickWhy('zaken'), /❔/); assert.match(m.E.epicPickWhy('baium'), /выше героя/);
    m.env.rt.epicDb.orfen.alive = false; assert.equal(m.E.epicPick(), null, 'fresh «dead» from the server is excluded');
    // метки /game/map/spawns (в них нет isAlive — сервер показывает и убитых) эпика живым не делают
    assert.doesNotMatch(read('modules/mobfarm.js'), /epicDb|epicSeenNear/);
    m.env.cfg.epicCoinDailyMax = 0; m.env.rt.epicDb.orfen.alive = true;
    assert.equal(m.E.epicPick(), null, 'CoL limit 0, no free route — not picked'); assert.match(m.E.epicPickWhy('orfen'), /лимит Coin of Luck = 0/);
    m.setDoc(docOf(pin)); assert.equal(m.E.epicPick()?.k, 'orfen', 'on this map — free route');
    console.log('PASS T8: pick — level / strong / unknown / above hero+10 / dead excluded, CoL 0 without free route excluded, epic on this map picked');
  }
  // ---------- P0-8: платный «Повний баф» во время эпика — только в пределах лимита Coin of Luck ----------
  {
    const m = mk({ rt: { epic: { step: 'prep', k: 'orfen' } } });
    assert.equal(m.E.epicBuffCol(), false, 'limit 0 → free set');
    m.env.cfg.epicCoinDailyMax = 20; assert.equal(m.E.epicBuffCol(), true);
    assert.equal(await m.E.epicBuffPay('mage'), true); assert.equal(m.env.rt.epicTpBudget[0].kind, 'buff'); assert.equal(m.env.rt.epicDb?.orfen?.paidN || 0, 0, 'buff is not a paid entry');
    m.env.rt.epic = { step: 'pick' }; assert.equal(m.E.epicBuffCol(), null, 'not in an epic — player choice as before');
    const hud = { querySelectorAll: () => [] };      // шапка с баффами есть, баффов нет — набор нужен
    const benv = { cfg: { townBuffSet: 'mage', epicMode: true }, rt: { epic: { step: 'fight', k: 'orfen' } }, TB_KEYS: { basic: [1068], mage: [1059] }, $q: s => s === '#l2-hud-active-buffs' ? hud : null,
      setRt: async () => {}, rec() {}, faCost: () => 1, epicBuffCol: () => false };
    const sbb = { console, Date, Math, JSON, document: { querySelectorAll: () => [] }, location: { pathname: '/map.html' } }; sbb.globalThis = sbb; vm.runInNewContext(read('modules/buffs.js'), sbb);
    const B = sbb.L2V7Factories.buffs(benv);
    const need = B.townBuffNeed();
    assert.equal(need?.set, 'basic', 'paid set downgraded to basic during an epic: ' + JSON.stringify(need));
    benv.epicBuffCol = () => null; assert.equal(B.townBuffNeed()?.set, 'mage', 'RB / outside an epic — player choice');
    const buffs = read('modules/buffs.js');
    assert.match(buffs, /if \(set !== 'basic' && \(await env\.epicBuffPay\?\.\(set\)\) === false\) set = 'basic';/);
    assert.match(buffs, /const bossOn = !!\(env\.cfg\.rbMode \|\| env\.cfg\.rbHuntMode \|\| \(env\.cfg\.epicMode && env\.rt\.epic\?\.k && env\.rt\.epic\.step !== 'pick'\)\);\s+let H = \{\}; if \(bossOn\)/, 'Noblesse: both the HUD gate and the want');
    console.log('PASS P0-8/P2-3: paid town set during an epic only within the CoL limit (incl. restore/revive — state-derived), Noblesse in epics');
  }
  // ---------- P0-9: магазин не покупает за Coin of Luck ----------
  {
    const shop = price => `<div><span class="l2-gm-shop-adena__amount">50 000 000</span><button class="l2-gm-shop-pager-btn" disabled=""></button><button class="l2-gm-shop-pager-btn" disabled=""></button>
      <div class="l2-gm-shop-row l2-gm-shop-row--grade-b"><span class="l2-gm-shop-name">Avadon Circlet</span><span class="l2-gm-shop-price">${price}</span><button class="l2-gm-shop-buy">Купити</button></div></div>`;
    for (const [price, col] of [['30 Coin of Luck', true], ['<img alt="Coin of Luck" src="/icons/col.png"> 30', true], ['1 200 аден', false]]) {
      const d = docOf(shop(price)), fired = [];
      const sbe = { console, Date, Math, JSON, document: d, location: { pathname: '/gm-shop.html' } }; sbe.globalThis = sbe; vm.runInNewContext(read('modules/economy.js'), sbe);
      const Ec = sbe.L2V7Factories.economy({ cfg: { shopReserve: 200000, shopMaxSpend: 2000000 }, rt: {}, $q: s => d.querySelector(s), waitX: async f => f() || null, sleep: async () => {}, rnd: () => 0,
        fire: el => { fired.push(el); return true; }, shown: el => !!el, setVal() {}, rec() {}, setRt: async () => {} });
      const r = await Ec.shopBuyOne({ name: /Avadon Circlet/i, key: 'x' }, 1);
      if (col) { assert.equal(r.ok, false); assert.match(r.why, /Coin of Luck/); assert.ok(!fired.some(e => /l2-gm-shop-buy/.test(e.className)), 'Buy not pressed: ' + price); }
      else assert.ok(fired.some(e => /l2-gm-shop-buy/.test(e.className)), 'adena item is bought as before');
    }
    console.log('PASS P0-9: shop never buys items priced in Coin of Luck (text or currency icon); adena items as before');
  }
  // ---------- P0-4: строка списка (снимок 75dac78f) ----------
  {
    const m = mk({ doc: docOf(pageHtml), path: '/epic-bosses.html', search: '?page=1' });
    const rows = m.E.epicRowsParse();
    assert.equal(Object.keys(rows).length, 8);
    assert.equal(rows.ak.deny, 'Epic Boss нижче дозволеного рівня.', 'hint in the sibling .l2-rb-row__actions is read');
    assert.equal(rows.ak.name, 'Королева Муравьев'); assert.equal(rows.orfen.deny, '');
    assert.deepEqual(['ak', 'orfen', 'core', 'zaken', 'baium', 'antharas', 'valakas', 'frintezza'].map(k => rows[k].respH), [12, 12, 12, 36, 60, 72, 240, 60]);
    assert.equal(rows.frintezza.lvl, 90); assert.ok(Object.values(rows).every(r => r.alive === false && r.priceUnit === 'Coin of Luck' && r.price === 1 && r.tp));
    assert.equal(m.E.epicTpBtn('orfen').className, 'l2-rb-row__tp');
    // скрытая подсказка — не запрет; скрытый пейджер «1 / 1» не нажимаем
    const hid = mk({ doc: docOf(pageHtml.replace('<span class="l2-rb-row__attack-hint">', '<span class="l2-rb-row__attack-hint" hidden="">')), path: '/epic-bosses.html' });
    assert.equal(hid.E.epicRowsParse().ak.deny, '');
    await m.E.epicListScan();
    assert.ok(!m.fires.some(e => e.id === 'rb-pager-next'), 'hidden pager is not clicked'); assert.equal(m.env.rt.epicDb.ak.deny, 'Epic Boss нижче дозволеного рівня.');
    // окно босса на странице эпиков: #rb-modal-stats
    const sbr = { console, Date, Math, JSON, document: docOf(pageHtml), location: { pathname: '/epic-bosses.html' } }; sbr.globalThis = sbr; vm.runInNewContext(raidSrc, sbr);
    const st = sbr.L2V7Factories.raid({ cfg: {}, rt: {} }).rbModalStats();
    assert.deepEqual([st.hp, st.patk, st.matk, st.mdef, st.exp], [429898, 3150, 2562, 1823, 1179536]);
    console.log('PASS P0-4: .l2-rb-row parse (deny from the sibling hint, clean names, respawn hours, CoL unit), hidden hint/pager ignored, #rb-modal-stats');
  }
  // ---------- T9: исходники ----------
  {
    assert.match(content, /if \(path === '\/game\/epic-bosses' && d\.res && !d\.res\.error && Array\.isArray\(d\.res\.bosses\) && d\.res\.bosses\.every\(b => b && typeof b === 'object'\) && d\.res\.bosses\.length === \+d\.res\.total\)\s+try \{ L2V7Modules\.epics\.epicApiNote\(d\.res, 'page'\)/);
    assert.match(content, /const m = path\.match\(\/\^\\\/game\\\/spawn\\\/\(l2dop_rb_\\d\+\)\\\/info\$\/\);\s+if \(m && d\.res\?\.stats\?\.maxHp > 0 && !d\.res\.error\) try \{ L2V7Modules\.raid\.rbInfoNote\(m\[1\], d\.res, 'page'\)/);
    assert.match(content, /d\.method === 'POST' && \/\\\/teleport\(\\\/\|\$\|\\\?\)\/\.test\(path\)/, 'teleport detector matches …/teleport too');
    { const tpRe = vm.runInNewContext(content.match(/d\.method === 'POST' && (\/.+?\/)\.test\(path\)/)[1]);
      assert.ok(['/game/raid-boss/teleport', '/game/epic-boss/teleport', '/game/epic-boss/teleport/29014'].every(p => tpRe.test(p)) && !tpRe.test('/game/teleports'), 'teleport path matcher'); }
    assert.match(content, /if \(rt\.epicScanReq && !isBattle\(\)\) \{ if \(fishNow\(\)\) L2V7Modules\.epics\.epicScanAll\('по кнопке'\)\.catch\(\(\) => \{\}\); else \{ await L2V7Modules\.epics\.epicScanAll\('по кнопке'\); continue; \} \}/);
    assert.match(content, /if \(epicOn\(\)\) L2V7Modules\.epics\.epicPollTick\(\)\.catch\(\(\) => \{\}\);/);
    assert.match(content, /once\('epicCol803', /); assert.match(content, /once\('epicDeaths803', \(\) => \{ if \(\+C\('epicMaxDeaths'\) === 10\) cf\.epicMaxDeaths = 3; \}\);/);
    const def = content.slice(content.indexOf('const DEF_CFG = {'), content.indexOf('\n', content.indexOf('const DEF_CFG = {')));
    for (const kv of ['epicCoinPerBoss: 1', 'epicCoinKeep: 0', 'epicMaxFightMin: 30', 'epicMaxRetreats: 8', 'epicMaxDeaths: 3', 'epicCoinDailyMax: 0']) assert.ok(def.includes(kv), kv);
    assert.match(content, /\{ k: 'frintezza', lvl: 90,/);
    const html = read('popup.html'), popup = read('popup.js'), ui = read('ui-v7.js');
    assert.match(html, /Coin of Luck на эпиков за 24 ч \(0 — НЕ тратить\)/); assert.match(ui, /epicCoinDailyMax:'Coin of Luck — ценная валюта \(донат, немного падает из Old Box и за TvT\)\. Ноль — бот не тратит их никогда/);
    assert.ok(!/0 — без лимита\) <input id="epicCoinDailyMax"/.test(html) && !/Ноль — лимита нет\.',\n\s+epicAdena/.test(ui.replace(/epicAdenaDailyMax:'[^']*'/, '')), 'no stale «0 = no limit» for CoL');
    assert.match(html, /<button id="epicScan"[^>]*>🔄 Проверить эпиков \(бесплатно\)<\/button>/); assert.match(html, /<div id="epicTable" class="zbox">/); assert.match(html, /id="epicSum"/);
    for (const id of ['epicCoinPerBoss', 'epicCoinKeep', 'epicMaxFightMin', 'epicMaxRetreats']) { assert.ok(html.includes(`id="${id}"`), id); assert.ok(popup.includes(`'${id}'`), id); assert.ok(def.includes(id), id); assert.ok(ui.includes(id + ":'"), id); }
    assert.match(popup, /epicMaxDeaths: 3, epicCheck: false/);
    const bp = JSON.parse(read('base-profile.json')).cfg;
    assert.deepEqual([bp.epicMaxDeaths, bp.epicCoinDailyMax, bp.epicCoinPerBoss, bp.epicCoinKeep, bp.epicMaxFightMin, bp.epicMaxRetreats], [3, 0, 1, 0, 30, 8]);
    assert.equal((read('base-profile.json').match(/passw|"auth"/gi) || []).length, 0);
    // survival: смерть на эпике считается за его появление; стоп — 2 × «смертей на эпика» (≤20) за час, вне эпика — 3 за 30 мин
    const surv = read('modules/survival.js');
    assert.match(surv, /await env\.epicDbSet\(epicD\.k, \{ deathsLife:/); assert.match(surv, /epicCap = Math\.min\(20, 2 \* Math\.max\(1, \+env\.cfg\.epicMaxDeaths \|\| 3\)\)/);
    assert.match(content, /L2V7Modules\.survival = L2V7Factories\.survival\(\{ get epicDbSet\(\) \{ return epicDbSet; \}/);
    console.log('PASS T9: network routing, menu button, migrations, defaults, Frintezza 90, menu labels, base profile without password, survival');
  }
  // ---------- T10: таблица эпиков в меню ----------
  {
    const js = read('popup.js'), a = js.indexOf('function renderEpics(');
    let i = js.indexOf('{', a), depth = 0; for (; i < js.length; i++) { if (js[i] === '{') depth++; else if (js[i] === '}' && --depth === 0) break; }
    const el = {}; const sb = { $: id => (el[id] ||= { textContent: '', innerHTML: '' }), Date, Math, String, Object };
    vm.runInNewContext(js.slice(a, i + 1), sb);
    const { env, E } = mk(); await E.epicApiNote(fx, 'api', Date.now());
    env.rt.epicDb.core.verdict = { v: 'strong', spPct: 48, why: 'спецудар 48 %' };
    sb.renderEpics({ epicDb: env.rt.epicDb, epicApi: env.rt.epicApi, epic: { step: 'pick' } }, { epicCoinDailyMax: 0, epicMode: false });
    const t = el.epicTable.innerHTML;
    assert.match(t, /Королева Муравьёв \(40\)<\/td><td>💀 до ~[^<]+<\/td><td title="[^"]*">⛔ игра не пускает/); assert.match(t, /❌ спецудар 48 %/); assert.match(t, /❔ нет цифр/);
    assert.match(t, /1 CoL — запрещено \(лимит 0\)/); assert.match(el.epicSum.textContent, /Coin of Luck: лимит 0 — не тратить/); assert.match(el.epicSum.textContent, /мин\. уровень босса 45/);
    assert.match(js, /\$\('epicScan'\)\.onclick = async \(\) => \{ try \{ await menuPatch\(\{ epicScanReq: Date\.now\(\) \}\);/);
    console.log('PASS T10: menu table (⛔ Queen Ant, ❌, 💀 until ~, ❔), «лимит 0 — не тратить», scan button → menuPatch({epicScanReq})');
  }
  // ---------- кнопка «Проверить эпиков»: список + цифры всех 8, вердикты, итог в журнал ----------
  {
    const m = mk({ net: u => /epic-bosses/.test(u) ? fx : WEAK, rt: { epicScanReq: Date.now(), rbStats: {} } });
    await m.E.epicScanAll('по кнопке');
    assert.equal(m.calls.filter(u => /spawn\//.test(u)).length, 8); assert.equal(m.env.rt.epicScanReq, null); assert.ok(m.env.rt.epicScanT);
    assert.ok(Object.values(m.env.rt.epicDb).every(d => d.verdict?.v), 'verdicts for all 8'); assert.ok(m.logs.some(l => /проверка по кнопке: .*игра пускает к боссам от 45 ур\./.test(l)));
    console.log('PASS: «Проверить эпиков» — 1 list + 8 spawn info GETs, verdicts for all, summary in the log, request cleared');
  }
  console.log('PASS: all 8.0.3 epic safety tests');
})().catch(e => { console.error(e); process.exit(1); });
