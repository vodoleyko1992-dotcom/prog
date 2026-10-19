'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 9.0 (просьба игрока 11.10: «доведи до ума фарм катакомб» + «кнопка автообмена камней на AA»; живой ответ игры 11.10 — Catacomb of the
// Witch: 190 мобов 60–72 ур., по 15 на странице): весь список из ответа игры, листание страниц, свежая ссылка перед кликом, РБ внутри не цель,
// чемпионы и ★ первыми, возврат в подземелье по activeDungeonId, отказ телепорта (alert) → 3 раза → пропуск; обмен камней у Ancient Trader
const assert = require('node:assert/strict');
const { vm, read, docOf } = require('./epic-harness.cjs');

const SRC = read('modules/dungeons.js');
function load(env, o = {}) {
  const loc = { pathname: o.path || '/dungeon.html', search: o.search ?? '?dungeonId=witch', href: '', reload() { loc.reloaded = (loc.reloaded || 0) + 1; } };
  let doc = o.doc || docOf('');
  const sb = { console, Date, Math, JSON, URLSearchParams, CSS: { escape: s => s }, Event: function (t) { this.type = t; }, chrome: { storage: { local: { set: async p => { sb.stored = p; } } } },
    get document() { return doc; }, location: loc };
  sb.globalThis = sb; vm.runInNewContext(SRC, sb);
  env.$q = s => doc.querySelector(s);
  return { M: sb.L2V7Factories.dungeons(env), loc, sb, setDoc: d => { doc = d; }, getDoc: () => doc };
}
const baseEnv = (o = {}) => { const env = { CAT_URL: '/catacombs.html', CAT_LIST: { witch: ['Catacomb of the Witch', 60, 72], heretic: ['Catacomb of the Heretic', 30, 40] },
  cfg: { catDungeon: 'auto', lvlBelow: 3, lvlAbove: 99 }, rt: {}, on: true, heroLvl: () => 66, logs: [], fired: [],
  isMap: () => false, isBattle: () => false, setStatus() {}, sleep: async () => {}, pause: async () => {}, rec: (...a) => env.logs.push(a.slice(1).join(' ')),
  setRt: async p => { Object.assign(env.rt, p); }, idle: async () => {}, shown: el => !!el && !el.hidden, noticeText: () => '', NET_ERR: { t: 0 },
  waitX: async f => f() || null, waitFor: async f => f() || null, fire: el => { env.fired.push(el); return true; }, ...o }; return env; };

// живой список: 19 видов × 10, по возрастанию уровня (как в ответе игры) + чемпион 67 и РБ 66 в конце
const KINDS = [['Crypt Guardian', 60], ['Lilim Priest', 60], ['Nephilim Bishop', 60], ['Purgatory Shadow', 61], ['Crypt Sage', 62], ['Lilim Knight', 63], ['Nephilim Centurion', 63],
  ['Purgatory Tarantula', 64], ['Tomb Guardian', 65], ['Lilim Assassin', 66], ['Nephilim Scout', 66], ['Tomb Sage', 67], ['Purgatory Gargoyle', 68], ['Lilim Soldier', 69],
  ['Nephilim Archbishop', 69], ['Crypt Guard', 70], ['Purgatory Liviona', 71], ['Lilim Knight Banneret', 72], ['Nephilim Praetorian', 72]];
let n = 0; const MOBS = [];
for (const [nm, lv] of KINDS) for (let i = 0; i < 10; i++) MOBS.push([`sdms_witch_${String(++n).padStart(3, '0')}`, /Shadow|Sage|Tarantula|Tomb|Gargoyle|Liviona/.test(nm) ? 'aggressive' : 'passive', nm, lv, 0]);
// страница игры: 15 строк, «‹ N / M ›»
const page = (mobs, p, star = '') => docOf(`<div id="dungeon-content"><ul id="dungeon-mob-list">${mobs.slice(p * 15, p * 15 + 15).map(m => `<li class="l2-map-mob-item l2-map-mob-item--battle"><button class="l2-map-mob-icon-btn" data-spawn-id="${m[0]}"></button><a class="l2-map-mob-link" href="/battle.html?spawnId=${m[0]}">${star && m[2] === star ? '★ ' : ''}${m[2]} · ур. ${m[3]}</a></li>`).join('')}</ul>
  <div id="dungeon-mob-pager"><button id="dungeon-mob-page-prev"${p <= 0 ? ' disabled' : ''}>‹</button><span id="dungeon-mob-page-ind">${p + 1} / ${Math.ceil(mobs.length / 15)}</span><button id="dungeon-mob-page-next"${p >= Math.ceil(mobs.length / 15) - 1 ? ' disabled' : ''}>›</button></div></div>`);

(async () => {
  // ---------- C1: весь список из ответа игры; герой 66 — моб со страницы 7, листаем; РБ не цель; чемпион первым ----------
  {
    const list = [...MOBS, ['sdms_witch_rb', 'raid', 'Witch Boss', 66, 1]];
    let p = 0; const env = baseEnv({ dungNet: () => ({ id: 'witch', mobs: list, t: Date.now() }) });
    const L = load(env, { doc: page(list, 0) });
    env.fire = el => { env.fired.push(el); if (el.id === 'dungeon-mob-page-next') L.setDoc(page(list, ++p)); else if (el.id === 'dungeon-mob-page-prev') L.setDoc(page(list, --p)); return true; };
    // старое поведение: только открытая страница (60–61) → «Авто» для героя 66 бросал подземелье
    assert.equal(L.M.dungeonMobs().length, 15); assert.ok(L.M.dungeonMobs().every(x => x.lvl <= 61), 'page 1 has only 60–61');
    const { net, list: all } = L.M.mobList('witch');
    assert.equal(net, true); assert.equal(all.length, 191, 'full list from the game answer');
    assert.equal(all.find(x => x.id === 'sdms_witch_rb').rb, true, 'raid kind recognised');
    for (let i = 0; i < 30; i++) { const k = L.M.catPick(all, 66); assert.ok(!k.rb && k.lvl === 67, 'closest to hero+1, never the RB: ' + k.name + ' ' + k.lvl); }
    const champ = [...all, { id: 'sdms_witch_ch', name: 'Crypt Guard', lvl: 70, champ: true, rb: false, i: 191 }];
    assert.equal(L.M.catPick(champ, 66).id, 'sdms_witch_ch', 'champion in the window goes first');
    // бой: моб 67 — на странице 8 (индексы 110–119) — бот листает «›» и жмёт свежую ссылку
    let battle = false; env.isBattle = () => battle;
    const fire0 = env.fire; env.fire = el => { fire0(el); if (el.tag === 'a') battle = true; return true; };
    await L.M.catHunt('witch');
    const a = env.fired.filter(x => x.tag === 'a');
    assert.equal(a.length, 1); assert.match(a[0].getAttribute('href'), /sdms_witch_1[12]\d/, 'Tomb Sage 67 clicked');
    assert.ok(env.fired.filter(x => x.id === 'dungeon-mob-page-next').length >= 7, 'paged forward to page 8');
    assert.equal(env.rt.catLv.witch.lo, 60); assert.equal(env.rt.catLv.witch.hi, 72); assert.equal(env.rt.catLv.witch.n, 3, 'levels known at once from the full list');
    assert.equal(env.rt.catBad?.witch, undefined, 'dungeon is not dropped');
  }
  // ---------- C2: ссылка берётся заново перед кликом (игра перерисовала список) ----------
  {
    const env = baseEnv({ dungNet: () => null }); const L = load(env, { doc: page(MOBS, 0) });
    const old = L.M.mobLink('sdms_witch_005'); L.setDoc(page(MOBS, 0));
    const fresh = await L.M.showMob('sdms_witch_005', -1);
    assert.ok(old && fresh && old !== fresh, 'fresh element after re-render');
    // ★ цель квеста — имя без звезды, отметка quest
    L.setDoc(page(MOBS, 0, 'Lilim Priest')); const q = L.M.dungeonMobs().find(x => x.quest);
    assert.equal(q.name, 'Lilim Priest'); assert.equal(L.M.dungeonMobs().filter(x => x.quest).length, 5, 'page 1: 5 of 10 Lilim Priest');
    assert.equal(L.M.catPick(L.M.dungeonMobs().map((x, i) => ({ ...x, i })), 60).name, 'Lilim Priest', '★ quest target first (before Purgatory Shadow 61)');
  }
  // ---------- C3: возврат в подземелье по activeDungeonId; после «не в подземелье» — не по кругу ----------
  {
    const env = baseEnv({ heroAt: () => ({ dung: 'witch', loc: 'catacomb', t: Date.now() }), isMap: () => true });
    const L = load(env, { path: '/map.html', search: '' });
    await L.M.catGo('witch');
    assert.equal(L.loc.href, '/dungeon.html?dungeonId=witch', 'straight back, no teleport, no enter');
    const env2 = baseEnv({ heroAt: () => ({ dung: 'witch', loc: 'catacomb', t: Date.now() - 5000 }), isMap: () => false, rt: { catGoneT: Date.now() } });
    const L2 = load(env2, { path: '/char.html', search: '' });
    await L2.M.catGo('witch');
    assert.equal(L2.loc.href, '/catacombs.html', 'stale snapshot after a «not inside» error → via the catacomb list');
    // снимок: герой снаружи — сразу телепорт, без попытки «назад»
    const env3 = baseEnv({ heroAt: () => ({ dung: null, loc: 'city', t: Date.now() }), rt: { catIn: 'witch', catInT: Date.now() - 60000 } });
    const L3 = load(env3, { path: '/city.html', search: '' });
    await L3.M.catGo('witch');
    assert.equal(L3.loc.href, '/catacombs.html'); assert.equal(env3.rt.catBackTried, 1);
  }
  // ---------- C4: отказ телепорта (окно игры alert → текст в журнал), 3 раза → подземелье на час ----------
  {
    const row = '<div id="catacombs-list"><div class="l2-rb-row"><span class="l2-rb-row__price">(<span class="l2-rb-row__price-gold">Аден 1</span>)</span><button class="l2-rb-row__tp" data-dungeon-id="witch">Телепорт</button></div></div>';
    const env = baseEnv({ gameAlert: () => ({ t: Date.now() + 1, text: 'Недостатньо адени' }) });
    const L = load(env, { path: '/catacombs.html', search: '', doc: docOf(row) });
    for (let i = 1; i <= 3; i++) await L.M.catGo('witch');
    assert.equal(env.fired.length, 3); assert.ok(env.logs.some(l => /телепорт не сработал — Недостатньо адени \(1\/3\)/.test(l)), env.logs.join('\n'));
    assert.ok(env.rt.catBad.witch > 0, '3 refusals → skip for an hour'); assert.match(env.rt.catBadWhy.witch, /адени/);
  }
  // ---------- C5: пусто по ответу игры — ждём новый ответ, без перезагрузки ----------
  {
    let t = Date.now(); const env = baseEnv({ dungNet: () => ({ id: 'witch', mobs: t > Date.now() ? MOBS : [], t }) });
    const L = load(env, { doc: page([], 0) });
    let w = 0; env.waitX = async f => { if (++w === 2) t = Date.now() + 1000; return f() || null; };   // второе ожидание — игра прислала новый список
    await L.M.catHunt('witch');
    assert.equal(env.rt.catEmpty, 1); assert.equal(L.loc.reloaded, undefined, 'no reload when the game sent a new list');
  }
  console.log('PASS C1–C5: catacombs — full mob list from the game answer (190 mobs, 15 per page) with paging, fresh link right before the click, RB inside is not a target, champions/★ first, back by activeDungeonId, teleport refusal via alert counted (3 → 1 h), empty list waits for the game');

  // ---------- S1: когда менять камни ----------
  {
    const inv = { 6360: 16000, 6361: 7400, 6362: 5000 };
    const env = baseEnv({ invQty: id => inv[id] ?? 0, heroAt: () => ({ dung: null, loc: 'zone', t: Date.now() }) });
    const L = load(env, { path: '/map.html', search: '' });
    assert.equal(L.M.sealStones(), 28400);
    assert.equal(L.M.sealDue(), '', 'auto exchange off by default');
    env.rt.sealEx = { t: Date.now() }; assert.equal(L.M.sealDue(), 'по кнопке'); env.rt.sealEx = null;
    env.cfg.sealAuto = true; assert.equal(L.M.sealDue(), 'автообмен');
    env.rt.sealT = Date.now() - 5 * 60000; assert.equal(L.M.sealDue(), '', 'not more often than every 20 min'); env.rt.sealT = 0;
    env.cfg.sealMin = 50000; assert.equal(L.M.sealDue(), '', 'below the threshold'); env.cfg.sealMin = 1;
    env.rt.sealTown = true; assert.equal(L.M.sealDue(), '', 'server said «town only» — wait for the town');
    env.heroAt = () => ({ dung: null, loc: 'city', t: Date.now() }); assert.equal(L.M.sealDue(), 'автообмен');
    const L0 = load(baseEnv({ invQty: () => null, cfg: { sealAuto: true } }), { path: '/map.html', search: '' });
    assert.equal(L0.M.sealDue(), '', 'bag unknown — wait');
  }
  // ---------- S2: обмен на странице Ancient Trader ----------
  {
    const row = (st, own, rate) => `<div class="l2-ancient-trader-exchange" data-stone="${st}" data-aa-rate="${rate}"><p class="l2-ancient-trader-info"><span class="l2-ancient-trader-owned__value">${own}</span></p><input class="l2-ancient-trader-exchange__input" value="1"><button class="l2-ancient-trader-exchange__btn">Обміняти</button><p class="l2-ancient-trader-exchange__err" hidden></p></div>`;
    const html = `<div class="l2-ancient-trader-exchange-list">${row('green', 16000, 5)}${row('blue', 0, 3)}${row('red', 5000, 10)}</div>`;
    let net = { t: 0 }; const env = baseEnv({ rt: { sealEx: { t: Date.now() } }, sealNet: () => net, rtCommit: async () => {} });
    const L = load(env, { path: '/ancient-trader.html', search: '', doc: docOf(html) });
    for (const el of L.getDoc().querySelectorAll('input')) el.dispatchEvent = () => true;
    const sent = [];
    env.fire = el => { const r = el.closest('.l2-ancient-trader-exchange'), inp = r.querySelector('input'); sent.push([r.dataset.stone, inp.value]); net = { t: Date.now(), ok: true, status: 200, stone:r.dataset.stone, qty:+inp.value }; return true; };
    await L.M.sealStep();
    assert.equal(JSON.stringify(sent), '[["green","16000"],["red","5000"]]', 'all stones of each colour, empty colour skipped');
    assert.equal(env.rt.sealEx, null); assert.ok(env.rt.sealT > 0);
    assert.ok(env.logs.some(l => /16000 зелёных → 80000 AA, 5000 красных → 50000 AA/.test(l)), env.logs.join('\n'));
    assert.equal(L.loc.href, '/map.html', 'back to hunting');
    // отказ «только в городе» → sealTown; кнопка при выключенном боте → бот снова выключен
    net = { t: 0 }; const env2 = baseEnv({ rt: { sealEx: { t: Date.now(), stopAfter: true } }, sealNet: () => net, heroAt: () => ({ loc: 'zone', t: Date.now() }) });
    const L2 = load(env2, { path: '/ancient-trader.html', search: '', doc: docOf(html) });
    for (const el of L2.getDoc().querySelectorAll('input')) el.dispatchEvent = () => true;
    env2.fire = el => { net = { stone:el.closest('.l2-ancient-trader-exchange').dataset.stone, qty:+el.closest('.l2-ancient-trader-exchange').querySelector('input').value, t: Date.now(), ok: false, status: 400, msg: 'Обмін доступний лише в місті' }; return true; };
    await L2.M.sealStep();
    assert.equal(env2.rt.sealTown, true); assert.ok(env2.logs.some(l => /не вышло: зелёных: Обмін доступний лише в місті/.test(l)));
    assert.equal(L2.sb.stored?.on, false, 'stopAfter: the bot is off again');
    // не на странице — идём к торговцу
    const L3 = load(baseEnv({ rtCommit: async () => {} }), { path: '/map.html', search: '' }); await L3.M.sealStep();
    assert.equal(L3.loc.href, '/ancient-trader.html');
  }
  console.log('PASS S1–S2: seal stones → Ancient Adena — button / auto (threshold, 20 min, town-only remembered), whole stacks per colour, result in the log, stopAfter');

  // ---------- W: проводка — hook.js, ядро, меню ----------
  {
    const hook = read('hook.js'), content = (read('defaults.js') + '\n' + read('content.js')), popup = (read('defaults.js') + '\n' + read('popup.js')), html = read('popup.html'), base = JSON.parse(read('base-profile.json'));
    assert.equal((hook.match(/dm: dungMobs\(u, o\)/g) || []).length, 2, 'fetch and XHR pass the dungeon list');
    assert.match(hook, /\/game\\\/dungeon\\\/\(\?:view\|enter\)\$/);
    assert.match(hook, /catacombs\|dungeon\|ancient-trader/, 'alert is replaced only on these pages');
    // dungMobs в песочнице — живой формат ответа
    const fnSrc = hook.slice(hook.indexOf('const dungMobs ='), hook.indexOf('// 9.0: на страницах катакомб'));
    const dungMobs = vm.runInNewContext(fnSrc + ';dungMobs');
    const r = dungMobs({ pathname: '/game/dungeon/view' }, { dungeon: { id: 'catacomb_of_the_witch', mobs: [{ id: 'sdms_x_1', name: 'Crypt Sage', level: 62, kind: 'aggressive', aggressive: true }] } });
    assert.equal(JSON.stringify(r), '{"id":"catacomb_of_the_witch","mobs":[["sdms_x_1","aggressive","Crypt Sage",62,1]]}');
    assert.equal(dungMobs({ pathname: '/game/map/spawns' }, {}), undefined);
    assert.match(content, /'activeDungeonId' in ch\) \{ HERO_AT = \{ char:rt.char, dung:/);
    assert.match(content, /path === '\/game\/ancient-trader\/exchange' && d\.method === 'POST'\) SEAL_NET =/);
    assert.match(content, /const sd = sealDue\(\);/);
    assert.match(content, /sealAuto: false, sealMin: 1,/);
    assert.match(popup, /const BOOL = \['sealAuto',/); assert.match(popup, /\$\('sealNow'\)\.onclick/);
    assert.match(html, /id="sealAuto"/); assert.match(html, /id="sealNow"/);
    assert.equal(base.cfg.sealAuto, false);
  }
  console.log('PASS W: hook passes the full dungeon list and game alerts, core tracks activeDungeonId and the exchange answer, menu button/toggle, defaults');
})().catch(e => { console.error(e); process.exit(1); });
