'use strict';
// 8.0.3 (эпики): общий стенд для тестов эпиков (v803-epics, v803-epics-review): мини-DOM (разбор HTML-фрагмента + простые селекторы),
// окружение модулей epics + raid как в content.js (зависимости только через env), фикстуры ответа /game/epic-bosses и страницы «Эпик боссы»
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js'), epicsSrc = read('modules/epics.js'), raidSrc = read('modules/raid.js');
const EPICS = vm.runInNewContext('(' + content.slice(content.indexOf('const EPICS = [') + 'const EPICS = '.length, content.indexOf('const EPIC_URL')).replace(/;\s*$/, '') + ')');
const LV_RE = vm.runInNewContext(content.match(/const LV_RE = (\/.+\/iu);/)[1]);
const base = require('./helpers/warlock52-rt.cjs')(); // 20.12: замеры Warlock 52 — из фикстуры
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
  const parts = sel.trim().replace(/\s*>\s*/g, ' ').split(/\s+(?![^[]*\])/);   // «A > B» — как «A B» (для тестов достаточно)
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
    get document() { return doc; }, location: loc, ...(o.sb || {}) };   // 20.43 (доводка 21.10): o.sb — глобальные справочники страницы (L2EngineCore)
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
module.exports = { fs, path, vm, root, read, content, epicsSrc, raidSrc, EPICS, LV_RE, base, fx, clone, H, MIN, El, parseHTML, docOf, pageHtml, mk, QA, WEAK, listAlive, T0 };
