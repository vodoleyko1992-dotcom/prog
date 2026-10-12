'use strict';
// 8.0.3 (эпики, ревью 11.10): правки по 12 находкам ревью безопасности Coin of Luck — отказ сервера только явный (5xx/обрыв не снимают
// резерв), запрос не к тому эпику не учитывается; вердикт не берёт старую рану прошлой «жизни»; платный «Повний баф» — только при
// разрешённом заходе и в режиме эпиков всегда в лимите CoL, резерв — прямо перед нажатием; магазин — только за адену (класс --adena);
// катакомбы, тур РБ и логово — только за адену; журнал трат CoL не откатывается импортом и часами; seenZone — куда летели;
// «Проверить эпиков» — и на странице боя; комментарии без устаревшего смысла
const assert = require('node:assert/strict');
const { vm, read, content, base, fx, clone, H, MIN, docOf, mk, listAlive } = require('./epic-harness.cjs');

const pin = '<div><button class="l2-map-mob-pin l2-map-mob-pin--epic" data-spawn-id="l2dop_rb_29014" title="Орфен · ур. 50 · епік-бос"></button></div>';
const okDb = (x = {}) => ({ orfen: { id: 'l2dop_rb_29014', col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50, respH: 12, lifeT: Date.now() - 3600000, ...x } });
const okStats = () => ({ ...clone(base.rbStats), l2dop_rb_29014: { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' } });
// модуль в песочнице с мини-DOM (как в content.js: фабрика L2V7Factories.<name>(env))
function loadMod(file, name, env, o = {}) {
  const loc = { pathname: o.path || '/map.html', search: o.search || '', href: '' };
  let doc = o.doc || docOf('');
  const sb = { console, Date, Math, JSON, URLSearchParams, CSS: { escape: s => s }, get document() { return doc; }, location: loc };
  sb.globalThis = sb; vm.runInNewContext(read(file), sb);
  return { M: sb.L2V7Factories[name](env), loc, setDoc: d => { doc = d; } };
}

(async () => {
  // ---------- R1: ответ на телепорт — отказ только явный; 5xx / обрыв / «нет ответа» — резерв остаётся; другой spawnId — не наш ----------
  {
    const { E } = mk();
    const A = d => E.epicTpAckOf(d).ok;
    assert.equal(A({ status: 502 }), null, '502 from the proxy — unknown');
    assert.equal(A({ status: 504, res: { error: 'Gateway Timeout' } }), null, '5xx with a body — still unknown');
    assert.equal(A({ status: 0, error: 'нет ответа' }), null, 'cancelled XHR — unknown');
    assert.equal(A({ error: 'Failed to fetch' }), null, 'fetch rejected — unknown');
    assert.equal(A({ status: 404, res: null }), null, '4xx without an error body — unknown');
    assert.equal(A({ status: 400, res: { error: 'not_enough_coin', messageUk: 'Недостатньо Coin of Luck' } }), false, '4xx with an error body — refusal');
    assert.equal(A({ status: 200, res: { ok: false, messageRu: 'Босс мёртв' } }), false, '2xx ok:false — refusal');
    assert.equal(A({ status: 200, res: { error: 'boss_dead' } }), false, '2xx error — refusal');
    assert.equal(A({ status: 200, res: { ok: true, messageRu: 'Телепортировано' } }), true);
    const id = 'l2dop_rb_29014', F = (req, p = '/game/epic-boss/teleport') => E.epicTpReqFor({ req }, p, id);
    assert.equal(F({ spawnId: id }), true); assert.equal(F({ spawnId: 'l2dop_rb_29001' }), false, 'another epic in the body');
    assert.equal(F({ bossId: 29014 }), true); assert.equal(F({ bossId: 29001 }), false);
    assert.equal(F(null, '/game/epic-boss/29001/teleport'), false, 'another epic in the path'); assert.equal(F(null, '/game/epic-boss/teleport/29014'), true);
    assert.equal(F(null), true, 'request format never seen — by time only');
    // поток: оплата → таймаут перехода → в sessionStorage ответ 502 / обрыв → резерв и paidN не тронуты
    for (const d of [{ status: 502 }, { status: 0, error: 'нет ответа' }]) {
      const alive = read('tests/fixtures-epic-page-803.html').replace(/(data-spawn-id="l2dop_rb_29014"[\s\S]*?)l2-rb-row__status--dead"> · Убит/, '$1l2-rb-row__status--alive"> · Живий');
      const m = mk({ doc: docOf(alive), path: '/epic-bosses.html', search: '?page=1', cfg: { epicCoinDailyMax: 1 },
        rt: { epicDb: okDb(), rbStats: okStats(), epic: { step: 'go', k: 'orfen', id, name: 'Орфен', mapChecked: true } } });
      m.store['l2bot.epicTp'] = JSON.stringify({ path: '/game/epic-boss/teleport', status: d.status || 0, ok: E.epicTpAckOf(d).ok, msg: d.error || '', t: Date.now() + 5 });
      await m.E.epicStep();
      assert.equal(m.env.rt.epicTpBudget.length, 1, 'reserve kept: ' + JSON.stringify(d)); assert.equal(m.env.rt.epicDb.orfen.paidN, 1);
      await m.E.epicStep();                               // шаг «прилёт» (страница ещё не сменилась) — то же самое
      assert.equal(m.env.rt.epicTpBudget.length, 1); assert.equal(m.env.rt.epicDb.orfen.paidN, 1); assert.notEqual(m.env.rt.epic.step, 'pick', 'not given up as «refused»');
    }
    // «отказ», а мы уже на карте рядом с ним — резерв не снимаем (CoL, скорее всего, списан)
    const m = mk({ doc: docOf(pin), cfg: { epicCoinDailyMax: 1 }, rt: { epicDb: okDb({ paidN: 1 }), rbStats: okStats(), epicTpBudget: [{ t: 1000, k: 'orfen', cost: 1, unit: 'Coin of Luck' }],
      epic: { step: 'arrive', k: 'orfen', id, name: 'Орфен', via: 'page', at: Date.now(), tpT: Date.now() - 2000, tpRes: 1000 } } });
    m.env.rt.epicTpBudget[0].t = Date.now() - 2000; m.env.rt.epic.tpRes = m.env.rt.epicTpBudget[0].t;
    m.store['l2bot.epicTp'] = JSON.stringify({ path: '/game/epic-boss/teleport', status: 400, ok: false, msg: 'x', t: Date.now() });
    await m.E.epicStep();
    assert.equal(m.env.rt.epicTpBudget.length, 1); assert.equal(m.env.rt.epicDb.orfen.paidN, 1); assert.equal(m.env.rt.epic.step, 'fight');
    assert.ok(m.logs.some(l => /но он на карте — резерв оставляю/.test(l)));
    assert.match(content, /const EP = L2V7Modules\.epics, mine = EP\.epicTpReqFor\(d, path, rt\.epic\.id\), a = EP\.epicTpAckOf\(d\)/);
    assert.match(content, /if \(mine\) sessionStorage\.setItem\('l2bot\.epicTp', JSON\.stringify\(\{ path, status: d\.status, ok: a\.ok, msg, t: Date\.now\(\) \}\)\);/);
    assert.doesNotMatch(content, /const ok = !d\.error && \/\^2\/\.test\(String\(d\.status\)\) && !d\.res\?\.error/, 'old «any non-2xx = refusal» rule is gone');
    console.log('PASS R1: teleport ack — only an explicit refusal releases (502/504/status 0/aborted keep the reserve), another spawnId ignored, refusal while on the map keeps it');
  }
  // ---------- R2: старая рана прошлой «жизни» не превращает «долго»/«банки» в «по силам» ----------
  {
    const id = 'l2dop_rb_29014', big = { hp: 9000000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' };
    const mkv = (rt = {}) => { const m = mk({ rt: { epicDb: okDb(), ...rt } }); m.env.rt.rbStats[id] = { ...big }; return m; };
    const v0 = mkv().E.epicVerdict('orfen');
    assert.ok(['slow', 'pots'].includes(v0.v), 'fresh spawn at full HP: ' + v0.v + ' ' + v0.why);
    const old = { [id]: { cur: 900000, max: 9000000, t: Date.now() - 3 * 24 * H, name: 'Орфен' } };
    const vOld = mkv({ rbWound: old }).E.epicVerdict('orfen');
    assert.equal(vOld.v, v0.v, '3-day-old wound ignored'); assert.equal(vOld.tKill, v0.tKill);
    const prev = { [id]: { cur: 900000, max: 9000000, t: Date.now() - 20 * MIN } };   // 20 мин назад, но эта «жизнь» замечена 10 мин назад
    assert.equal(mkv({ rbWound: prev, epicDb: okDb({ lifeT: Date.now() - 10 * MIN }) }).E.epicVerdict('orfen').tKill, v0.tKill, 'wound from before this life ignored');
    const hpA = mkv({ rb: { [id]: { hpAfter: 900000, max: 9000000, t: Date.now() - 3 * 24 * H } } }).E.epicVerdict('orfen');
    assert.equal(hpA.tKill, v0.tKill, 'old rb[id].hpAfter ignored'); assert.equal(hpA.v, v0.v, 'rbPreCheck does not re-apply hpAfter (hpExact)');
    const fresh = mkv({ rbWound: { [id]: { cur: 900000, max: 9000000, t: Date.now() - 5 * MIN } } }).E.epicVerdict('orfen');
    assert.ok(fresh.tKill < v0.tKill / 5, 'a fresh wound of this life still counts: ' + fresh.tKill);
    // смена «жизни» (жив → мёртв по серверу) стирает раны прошлого захода
    const m = mk({ rt: { epicDb: { orfen: { id, alive: true, lvl: 50 } }, rbWound: { [id]: { cur: 5, max: 9, t: Date.now() } }, rb: { [id]: { hpAfter: 5, t: Date.now() } } } });
    await m.E.epicApiNote(fx, 'api', Date.now());
    assert.equal(m.env.rt.rbWound[id], undefined); assert.equal(m.env.rt.rb[id], undefined);
    await m.E.epicApiNote(listAlive(id), 'api', Date.now() + 1000); assert.ok(m.env.rt.epicDb.orfen.lifeT > 0, 'new life start remembered');
    // 10.0.2: HP недобитого — rbHpNow (hpAfter своего отхода и замер в бою rbWound); эпики по-прежнему передают HP сами (hpExact)
    assert.match(read('modules/raid.js'), /const curHp = st\.hpExact \? st\.hp \|\| 0 : rbHpNow\(id, st\.hp \|\| 0\)/);
    assert.match(read('modules/raid.js'), /const rbHpNow = \(id, hp\) => \{ const w = env\.rt\.rbWound\?\.\[id\]; return Math\.min\(hp, env\.rt\.rb\?\.\[id\]\?\.hpAfter/);
    console.log('PASS R2: verdict uses only a fresh (30 min) wound of this life; a new life clears rbWound / rb[id]; hpAfter not re-applied');
  }
  // ---------- R3 / R8: платный «Повний баф» — только при разрешённом заходе; в режиме эпиков всегда в лимите CoL ----------
  {
    const m = mk({ doc: docOf(pin), cfg: { epicCoinDailyMax: 20 }, rt: { epicDb: okDb({ verdict: { v: 'unknown' } }), epic: { step: 'prep', k: 'orfen', route: 'here' } } });
    m.env.rt.rbStats = {};                               // цифр босса нет → вердикт «неизвестно»
    assert.equal(m.E.epicBuffCol(), false, "'here' route + unknown verdict + limit 20 → free set"); assert.match(m.E.epicBuffWhy(), /нет цифр/);
    // townBuffNeed с настоящим epicBuffCol → «basic»
    const hud = { querySelectorAll: () => [] };
    const benv = { cfg: { townBuffSet: 'mage', epicMode: true }, rt: {}, TB_KEYS: { basic: [1068], mage: [1059] }, $q: s => s === '#l2-hud-active-buffs' ? hud : null,
      setRt: async () => {}, rec() {}, faCost: () => 1, epicBuffCol: () => m.E.epicBuffCol() };
    const { M: B } = loadMod('modules/buffs.js', 'buffs', benv);
    assert.equal(B.townBuffNeed()?.set, 'basic');
    m.env.rt.rbStats = okStats(); assert.equal(m.E.epicBuffCol(), true, 'cleared attempt → paid set allowed'); assert.equal(B.townBuffNeed()?.set, 'mage');
    m.env.rt.deaths1h = [Date.now() - 1000, Date.now() - 2000]; assert.equal(m.E.epicBuffCol(), false, '2 deaths in an hour'); m.env.rt.deaths1h = [];
    m.env.rt.epicDb.orfen.apiT = Date.now() - 5 * MIN; assert.equal(m.E.epicBuffCol(), false, 'alive not confirmed within 3 min'); m.env.rt.epicDb.orfen.apiT = Date.now();
    m.env.rt.epicDb.orfen.deny = 'Epic Boss нижче дозволеного рівня.'; assert.equal(m.E.epicBuffCol(), false, 'deny'); m.env.rt.epicDb.orfen.deny = '';
    m.env.rt.epic.route = null; assert.equal(m.E.epicBuffCol(), false, 'route not decided'); m.env.rt.epic.route = 'page';
    assert.equal(await m.E.epicBuffPay('mage') > 0, true);
    // R8: режим эпиков, между заходами (выбор цели) — тот же лимит Coin of Luck
    const p = mk({ rt: { epic: { step: 'pick' } } });
    assert.equal(p.E.epicBuffCol(), false, 'epic mode, between epics, limit 0 → never');
    assert.equal(await p.E.epicBuffPay('mage'), false); assert.equal((p.env.rt.epicTpBudget || []).length, 0);
    p.env.cfg.epicCoinDailyMax = 20; assert.equal(p.E.epicBuffCol(), true);
    assert.ok(await p.E.epicBuffPay('mage') > 0); assert.equal(p.env.rt.epicTpBudget[0].k, 'buff'); assert.equal(p.E.epicBuffCol(), false, '15 of 20 used — the next set would exceed');
    p.env.cfg.epicMode = false; assert.equal(p.E.epicBuffCol(), null, 'epic mode off — player choice');
    assert.match(read('ui-v7.js'), /townBuffSet:'[^']*Пока включён режим «Эпики», платный набор берётся только в пределах лимита Coin of Luck на эпиков \(0 — всегда бесплатный/);
    console.log('PASS R3/R8: paid town set — only with a cleared attempt (verdict ok, fresh alive, no deny, < 2 deaths, route); in epic mode always within the CoL limit');
  }
  // ---------- R10: резерв платного набора — прямо перед нажатием; явный отказ баффера — резерв снят ----------
  {
    const page = set => `<div id="town-buffer-sets"><section class="l2-town-buffer-set"><button class="l2-town-buffer-set-apply" data-set-id="${set}">Застосувати</button></section></div>
      <div id="l2-hud-active-buffs"></div><div id="town-buffer-result-overlay"><div id="town-buffer-result-title"></div><div id="town-buffer-result-text"></div></div><div id="town-buffer-msg"></div>`;
    const run = async (html, o = {}) => {
      const calls = [], fired = [];
      const env = { cfg: { townBuffSet: 'mage', epicMode: true }, rt: { tbuff: { step: 'town', set: 'mage', t: Date.now(), ...(o.st || {}) }, tbLvl: o.tbLvl }, TB_KEYS: { basic: [1068], mage: [1059] },
        DEAD_RE: /знепритомн|без сознани/i, FA_KNOWN: {}, IL: {}, on: true, autonomyMode: () => 'farm', setStatus() {}, sleep: async () => {}, pause: async () => {}, rnd: () => 0,
        shown: el => !!el && !el.hidden, rec: (...a) => calls.push('rec:' + a.slice(1).join(' ')), setRt: async p => { Object.assign(env.rt, p); },
        epicBuffCol: () => true, epicBuffPay: async () => { calls.push('pay'); return 777; }, epicBuffRelease: async (at, why) => { calls.push('release:' + at + ':' + why); return true; } };
      const d = docOf(html), L = loadMod('modules/buffs.js', 'buffs', env, { path: '/town-buffer.html', doc: d });
      env.$q = s => d.querySelector(s); env.waitX = async f => f() || null;
      env.fire = el => { fired.push(el); calls.push('fire'); if (o.result) d.querySelector('#town-buffer-result-title').textContent = o.result; return true; };
      await L.M.townBuffStep();
      return { calls, fired, env };
    };
    const a = await run('<div id="l2-hud-active-buffs"></div>');            // кнопки набора нет («баффер не открылся»)
    assert.ok(!a.calls.includes('pay'), 'no reservation when the buffer did not open: ' + a.calls.join(' | '));
    const b = await run(page('mage').replace('<div id="l2-hud-active-buffs"></div>', `<div id="l2-hud-active-buffs"><span class="l2-hud-active-buff" data-skill-id="1059" data-expires-at="${Date.now() + 2 * H}" title="Empower · Lv.3"></span></div>`), { tbLvl: { mage: { 1059: 2 } } });
    assert.ok(!b.calls.includes('pay'), 'no reservation when the set would downgrade buffs: ' + b.calls.join(' | '));
    const c = await run(page('mage'), { result: 'Недостатньо Coin of Luck' });
    assert.deepEqual(c.calls.filter(x => /^(pay|fire|release)/.test(x)), ['pay', 'fire', 'release:777:Недостатньо Coin of Luck'], 'reserve right before the click, released on an explicit refusal');
    const d = await run(page('mage'), { result: 'Баф накладено' });
    assert.ok(!d.calls.some(x => /^release/.test(x)), 'applied — reserve kept');
    const e = await run(page('mage'));                                   // нет ответа — резерв остаётся (могли списать)
    assert.ok(!e.calls.some(x => /^release/.test(x)));
    console.log('PASS R10: paid set reserve only right before the click (not on «buffer did not open» / downgrade), explicit refusal releases, no answer keeps it');
  }
  // ---------- R4 / R11: магазин — только известное «за адену» ----------
  {
    const shop = price => `<div><span class="l2-gm-shop-adena__amount">50 000 000</span><span class="l2-gm-shop-coin">Coin of Luck: <strong class="l2-gm-shop-coin__amount">53</strong></span>
      <button class="l2-gm-shop-pager-btn" disabled=""></button><button class="l2-gm-shop-pager-btn" disabled=""></button>
      <div class="l2-gm-shop-row l2-gm-shop-row--grade-b"><span class="l2-gm-shop-name">Avadon Circlet</span>${price}<button class="l2-gm-shop-buy">Купити</button></div></div>`;
    const cases = [
      ['<div class="l2-gm-shop-price l2-gm-shop-price--coin">30 Coin of Luck</div>', /Coin of Luck/, 'real CoL markup (snapshot 23:00)'],
      ['<div class="l2-gm-shop-price">30 CoL</div>', /Coin of Luck/, 'abbreviation «CoL»'],
      ['<div class="l2-gm-shop-price">30 <img src="/assets/l2dop/4037.jpg" alt=""></div>', /Coin of Luck/, 'icon-only CoL price'],
      ['<div class="l2-gm-shop-price">30</div>', /не распознана/, 'unknown currency'],
      ['<div class="l2-gm-shop-price l2-gm-shop-price--adena">124 200 Adena</div>', null, 'real adena markup'],
      ['<div class="l2-gm-shop-price l2-gm-shop-price--adena">1 200 <img src="/icons/adena.png" alt="coin" title="Монети"></div>', null, 'adena with a generic «coin»/«Монети» icon'],
    ];
    for (const [price, refuse, what] of cases) {
      const d = docOf(shop(price)), fired = [];
      const env = { cfg: { shopReserve: 200000, shopMaxSpend: 2000000 }, rt: {}, $q: s => d.querySelector(s), waitX: async f => f() || null, sleep: async () => {}, rnd: () => 0,
        fire: el => { fired.push(el); return true; }, shown: el => !!el, setVal() {}, rec() {}, setRt: async () => {} };
      const { M: Ec } = loadMod('modules/economy.js', 'economy', env, { path: '/gm-shop.html', doc: d });
      const r = await Ec.shopBuyOne({ name: /Avadon Circlet/i, key: 'x' }, 1);
      const bought = fired.some(e => /l2-gm-shop-buy/.test(e.className));
      if (refuse) { assert.equal(r.ok, false, what); assert.match(r.why, refuse, what); assert.ok(!bought, 'Buy not pressed: ' + what); }
      else assert.ok(bought, 'bought: ' + what);
    }
    console.log('PASS R4/R11: shop buys only known adena prices (--adena / «Adena»), refuses --coin, «CoL», icon 4037, unknown currency; a generic coin icon with --adena does not stop supplies');
  }
  // ---------- R5: катакомбы и тур РБ — телепорт только за адену ----------
  {
    const cat = price => `<div class="l2-rb-row"><div class="l2-rb-row__top"><span class="l2-rb-row__label">Catacomb of the Heretic</span><span class="l2-rb-row__price">(<span class="l2-rb-row__price-gold">${price}</span>)</span><button type="button" class="l2-rb-row__tp" data-dungeon-id="heretic">Телепорт</button></div></div>`;
    for (const [price, go] of [['1 Coin of Luck', false], ['5 Монет удачі', false], ['Аден 50000', true], ['Безкоштовно', true]]) {
      const fired = [], env = { CAT_URL: '/catacombs.html', CAT_LIST: { heretic: ['Катакомба Еретиков', 30, 40] }, cfg: { catDungeon: 'heretic' }, rt: {}, heroLvl: () => 54,
        isMap: () => false, setStatus() {}, sleep: async () => {}, pause: async () => {}, rec() {}, setRt: async p => { Object.assign(env.rt, p); }, idle: async () => {}, shown: () => false,
        fire: el => { fired.push(el); return true; }, waitX: async f => f() || null, waitFor: async f => f() || null };
      const d = docOf(cat(price)), L = loadMod('modules/dungeons.js', 'dungeons', env, { path: '/catacombs.html', doc: d }); env.$q = s => d.querySelector(s);
      await L.M.catGo('heretic');
      assert.equal(fired.length > 0, go, `${price}: teleport ${go ? 'pressed' : 'refused'}`);
      if (!go) { assert.ok(env.rt.catBad?.heretic > 0); assert.match(env.rt.catBadWhy.heretic, /не за адену/); }
    }
    const m = mk();
    const rbRow = price => docOf(`<div id="rb-list"><div class="l2-rb-row"><div class="l2-rb-row__top"><button class="l2-rb-row__name" data-spawn-id="l2dop_rb_25001"><span class="l2-rb-row__label">Тест</span><span class="l2-rb-row__level"> · рів. 50</span><span class="l2-rb-row__status l2-rb-row__status--alive"> · Живий</span></button><span class="l2-rb-row__price">(<span class="l2-rb-row__price-gold">${price}</span>)</span><button type="button" class="l2-rb-row__tp" data-spawn-id="l2dop_rb_25001">Телепорт</button></div></div></div>`);
    m.setDoc(rbRow('Аден 100000')); let r = m.R.rbRowsParse().l2dop_rb_25001;
    assert.deepEqual([r.price, r.unit], [100000, 'аден'], 'real RB price «(Аден 100000)»'); assert.equal(m.R.rbPriceWhy(r), '');
    m.setDoc(rbRow('1 Coin of Luck')); r = m.R.rbRowsParse().l2dop_rb_25001;
    assert.equal(r.unit, 'Coin of Luck'); assert.match(m.R.rbPriceWhy(r), /не за адену/);
    assert.match(m.R.rbTeleportCheck('l2dop_rb_25001', r), /не за адену/, 'candidate filter');
    assert.equal(m.R.rbPriceWhy({ price: 100000 }), '', 'old rbList rows without a unit — as before (checked again at the click)');
    // тур: строка в rbList старая (без единицы), а на странице цена в CoL — «Телепорт» не нажимается
    const t = mk({ path: '/rb-bosses.html', search: '?page=1', rt: { rbHunt: { step: 'go', id: 'l2dop_rb_25001', name: 'Тест', lvl: 50, page: 1 }, rbList: { l2dop_rb_25001: { name: 'Тест', lvl: 50, alive: true, page: 1 } }, rbListT: Date.now() },
      env: { rbSessTick: async () => false } });
    t.setDoc(rbRow('1 Coin of Luck'));
    await t.R.rbHuntStep();
    assert.equal(t.fires.length, 0, 'tour teleport not pressed for a CoL price'); assert.equal(t.env.rt.rbHunt.step, 'pick'); assert.ok(t.logs.some(l => /не за адену/.test(l)));
    console.log('PASS R5: catacomb teleport and RB tour — adena or free only; Coin of Luck / unknown currency refused (catBad, candidate filter, click-time check)');
  }
  // ---------- R6: логово — валюта из «Телепорта»; не адена — не берём ----------
  {
    const row = (cur, price = '6 000') => `<div data-surroundings-key="dion"><div class="l2-teleport-miru-city-block" data-surroundings-key="dion"><button class="l2-teleport-miru-city-btn" data-surroundings-key="dion">Dion</button>
      <div class="l2-teleport-miru-surroundings"><div class="l2-teleport-miru-surroundings-row"><span class="l2-teleport-miru-surroundings-label"><span>Sea of Spores</span></span><span class="l2-teleport-miru-mob-level">48-52</span>
      <span class="l2-teleport-miru-price-num">${price}</span>${cur == null ? '' : `<span class="l2-teleport-miru-price-currency">${cur}</span>`}<button class="l2-teleport-miru-tp-btn" data-teleport-id="sea_of_spores">Телепорт</button></div></div></div></div>`;
    const nav = (html, rt = {}) => { const fired = [], env = { rt: { zoneGo: { id: 'sea_of_spores', t: Date.now() }, ...rt }, cfg: {}, heroLvl: () => 54, setStatus() {}, sleep: async () => {}, rec() {}, setRt: async p => { Object.assign(env.rt, p); },
      shown: el => !!el && !el.hidden, waitX: async f => f() || null, fire: el => { fired.push(el); return true; } };
      const d = docOf(html), L = loadMod('modules/navigation.js', 'navigation', env, { path: '/teleport.html', doc: d }); env.$q = s => d.querySelector(s); return { N: L.M, env, fired, loc: L.loc }; };
    assert.deepEqual(clone(nav(row('аден')).N.zoneRows().sea_of_spores), { name: 'Sea of Spores', city: 'dion', price: 6000, cur: 'аден', curT: 'аден', lo: 48, hi: 52 });
    assert.equal(nav(row('Coin of Luck', '1')).N.zoneRows().sea_of_spores.cur, 'Coin of Luck');
    assert.equal(nav(row(null)).N.zoneRows().sea_of_spores.curT, undefined, 'no currency element — nothing recorded (as before)');
    const a = nav(row('Coin of Luck', '1')); await a.N.zoneGoStep();
    assert.equal(a.fired.filter(e => /tp-btn/.test(e.className)).length, 0, 'zone teleport priced in CoL is not pressed'); assert.equal(a.env.rt.zoneGo, null); assert.equal(a.env.rt.zoneCat.sea_of_spores.cur, 'Coin of Luck');
    const b = nav(row('аден')); await b.N.zoneGoStep(); assert.equal(b.fired.filter(e => /tp-btn/.test(e.className)).length, 1, 'adena — as before');
    const c = nav(row(null)); await c.N.zoneGoStep(); assert.equal(c.fired.filter(e => /tp-btn/.test(e.className)).length, 1, 'no currency element — as before');
    const m = mk({ rt: { epicDb: okDb(), rbStats: okStats(), zoneCat: { sea_of_spores: { name: 'Sea of Spores', price: 1, cur: 'Coin of Luck', curT: 'Coin of Luck', city: 'dion' } } } });
    assert.match(m.E.epicLair('orfen').why, /не за адену: 1 Coin of Luck/);
    m.env.rt.zoneCat.sea_of_spores = { price: 6000, cur: '', curT: '', city: 'dion' }; assert.equal(m.E.epicLair('orfen').ok, false, 'lair: unlabelled currency refused');
    m.env.rt.zoneCat.sea_of_spores = { price: 6000, cur: 'аден', curT: 'аден', city: 'dion' }; assert.equal(m.E.epicLair('orfen').ok, true);
    m.env.rt.zoneCat.sea_of_spores = { price: 6000, city: 'dion' }; assert.equal(m.E.epicLair('orfen').ok, true, 'old catalog without currency — the click-time check guards');
    // меню: не адена — видно
    const js = read('popup.js'), s0 = js.indexOf('function renderEpics(');
    let i = js.indexOf('{', s0), depth = 0; for (; i < js.length; i++) { if (js[i] === '{') depth++; else if (js[i] === '}' && --depth === 0) break; }
    const el = {}, sb = { $: id => (el[id] ||= { textContent: '', innerHTML: '' }), Date, Math, String, Object }; vm.runInNewContext(js.slice(s0, i + 1), sb);
    sb.renderEpics({ epicDb: { orfen: { lvl: 50, alive: true, col: 1 } }, zoneCat: { sea_of_spores: { price: 1, cur: 'Coin of Luck', curT: 'Coin of Luck' } } }, { epicCoinDailyMax: 0 });
    assert.match(el.epicTable.innerHTML, /логово 1 Coin of Luck — не адена, не беру/);
    console.log('PASS R6: teleport currency recorded (zoneRows cur/curT), CoL zone teleport not pressed, epic lair only for adena, menu shows a non-adena lair');
  }
  // ---------- R7: журнал трат CoL — «из будущего» считается, импорт старой памяти его не откатывает ----------
  {
    const { env, E } = mk({ cfg: { epicCoinDailyMax: 1 }, rt: { epicDb: { orfen: { col: 1, adena: 0, apiT: Date.now(), paidN: 0 } } } });
    env.rt.epicTpBudget = [{ t: Date.now() + 3 * H, k: 'core', cost: 1, unit: 'Coin of Luck' }];   // часы перевели назад
    assert.match(E.epicTpBudgetQuote({ known: true, col: 1, adena: 0 }, 'orfen').why, /за 24 ч уже 1\/1/, 'future-dated record still counts');
    const js = read('popup.js'), a = js.indexOf('function colLedgerKeep(');
    let i = js.indexOf('{', a), depth = 0; for (; i < js.length; i++) { if (js[i] === '{') depth++; else if (js[i] === '}' && --depth === 0) break; }
    const sb = { Date, Number, Set, Object }; vm.runInNewContext(js.slice(a, i + 1), sb);
    const now = Date.now(), rec = { t: now - H, k: 'orfen', cost: 1, unit: 'Coin of Luck' };
    const cur = { char: 'Warlock', epicTpBudget: [rec], epicDb: { orfen: { paidN: 1, paidT: now - H } } };
    const imp = { char: 'Warlock', epicTpBudget: [], epicDb: { orfen: { paidN: 0, alive: false } }, rbDb: { x: 1 } };
    const out = sb.colLedgerKeep(cur, imp, now);
    assert.equal(out.epicTpBudget.length, 1); assert.equal(out.epicDb.orfen.paidN, 1); assert.equal(out.epicDb.orfen.alive, false, 'other fields from the file'); assert.equal(out.rbDb.x, 1);
    assert.equal(sb.colLedgerKeep(cur, { ...imp, char: 'West' }, now).epicTpBudget.length, 0, 'another hero — as in the file');
    assert.equal(sb.colLedgerKeep({ ...cur, epicTpBudget: [{ ...rec, t: now - 25 * H }] }, imp, now).epicTpBudget.length, 0, 'older than 24 h dropped');
    assert.match(js, /for \(const k of Object\.keys\(data\)\) if \(\(k === 'rt' \|\| \/\^rt@\/\.test\(k\)\) && data\[k\] && typeof data\[k\] === 'object'\) \{ const c = byChar\[data\[k\]\.char \|\| k\.slice\(3\)\]; if \(c\) data\[k\] = colLedgerKeep\(c, data\[k\]\); \}/);
    console.log('PASS R7: CoL ledger — future-dated records count, memory import merges the 24 h ledger and keeps the larger paidN (same hero only)');
  }
  // ---------- R9: seenZone — куда летели, а не устаревшая rt.zone ----------
  {
    const zc = { sea_of_spores: { name: 'Sea of Spores', price: 6000, city: 'dion' }, blazing_swamp: { name: 'Blazing Swamp', price: 9000, city: 'goddard' } };
    const arrive = async (via, rt = {}) => { const m = mk({ doc: docOf(pin), rt: { epicDb: okDb(), rbStats: okStats(), zoneCat: zc, zone: 'blazing_swamp', ...rt,
      epic: { step: 'arrive', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', via, lair: via === 'zone' ? 'sea_of_spores' : undefined, at: Date.now(), tpT: Date.now() } } });
      await m.E.epicStep(); return m; };
    assert.equal((await arrive('zone')).env.rt.epicDb.orfen.seenZone, 'sea_of_spores', 'lair route: the lair flown to');
    assert.equal((await arrive('page')).env.rt.epicDb.orfen.seenZone, undefined, 'page teleport: nothing (rt.zone is the old farming zone)');
    assert.equal((await arrive('here', { zonePend: { id: 'sea_of_spores', t: Date.now() } })).env.rt.epicDb.orfen.seenZone, undefined, 'teleport still pending — rt.zone not trusted');
    assert.equal((await arrive('here')).env.rt.epicDb.orfen.seenZone, 'blazing_swamp', 'on this map without a teleport — the current zone');
    assert.equal((await arrive('here', { zone: 'out:Spore Fungus' })).env.rt.epicDb.orfen.seenZone, undefined, 'not a teleport destination');
    console.log('PASS R9: seenZone — the lair flown to; page teleport saves nothing; «here» only without a pending teleport and for a real teleport point');
  }
  // ---------- R12: комментарии без устаревшего смысла ----------
  {
    assert.doesNotMatch(content, /Доступ сервера: ±10 уровней/); assert.doesNotMatch(content, /Добровольные бюджеты платных телепортов/); assert.doesNotMatch(content, /разметку игры ещё не видели — читаем широко/);
    assert.match(content, /сервер пускает к боссам не ниже «герой − 9» \(minRaidBossLevel\), сверху — предохранитель бота: герой \+ 10/);
    assert.match(content, /Coin of Luck: 0 — не тратить никогда, N — не больше N за 24 ч/);
    assert.match(content, /строка \.l2-rb-row \(снимок 75dac78f\)/);
    console.log('PASS R12: epics wrapper comments match 8.0.3 (hero − 9 / hero + 10, CoL 0 = never, .l2-rb-row parse)');
  }
  console.log('PASS: all 8.0.3 epic review fixes');
})().catch(e => { console.error(e); process.exit(1); });
