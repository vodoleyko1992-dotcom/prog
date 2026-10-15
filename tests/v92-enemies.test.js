'use strict';
// 9.2 «☠ Лист врагов» (modules/enemies.js + hook.js pv): убийца героя — в лист (живой ответ 11.10 17:39: Warlock убит игроком Dremia),
// враг на локации — нападение кнопкой игры с проверкой сил, ответный бой (победа/поражение), слежка за возвращением, меню
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = read('modules/enemies.js');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);

// настоящий pvpDefeat из ответа /character (11.10 17:39, Монастир Тиші)
const DREMIA = { killerName: 'Dremia', killerCharacterId: '6f573aad-08ee-4713-9d76-33f5fd4afc93', deathEventId: 'e975b1c8-07c7-4991-8c40-aab130f2bbc6', scope: 'world', playerDied: true,
  messageUk: 'Вас вбив гравець [Dremia]!', fullLog: ['На вас напали: [Dremia].', '[Dremia] −2444 HP (Буря).', '[Dremia] −2996 HP (Вампірні кігті).', '[Dremia] −2340 HP (Іскра тіні).',
    'Noblesse Blessing зберіг ваші бафи після смерті.', 'Вас вбив гравець [Dremia]!'], messageRu: 'Вас вбив игрок [Dremia]!' };
const DID = DREMIA.killerCharacterId;

let NOW = 10_000_000;
function make({ rt = {}, cfg = {}, page = '/map.html', search = '', lvl = 61, hp = { cur: 9000, max: 9000 }, dom = {}, mode = 'farm' } = {}) {
  const recs = [], writes = [], clicks = [], nav = [];
  const location = { pathname: page, search };
  const document = { querySelectorAll: sel => (dom.all?.[sel] || []) };
  const ctx = { Date: { now: () => NOW }, Math, Object, String, Number, Array, Set, JSON, console, URLSearchParams, location, document, CSS: { escape: s => s } };
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx);
  const env = { rt, cfg, rec: (...a) => recs.push(a.join(' ')), setRt: p => { Object.assign(env.rt, p); writes.push(p); return Promise.resolve(); },
    setStatus() {}, sleep: () => Promise.resolve(), heroLevel: () => lvl, meHp: () => hp, autonomyMode: () => mode, fishNow: () => false, tvtSoon: () => false,
    isBattle: () => /battle/.test(location.pathname), isMap: () => location.pathname === '/map.html', victory: () => !!dom.victory,
    $q: sel => dom.q?.[sel] || null, shown: el => !!el && !el.hidden, fire: el => clicks.push(el), waitX: async fn => fn(),
    toMap: async () => { nav.push('map'); }, gameGet: async p => { nav.push('GET ' + p); return dom.around ? { ok: true, json: async () => dom.around } : { ok: false }; } };
  return { en: ctx.L2V7Factories.enemies(env), env, recs, writes, clicks, nav, location };
}
const flush = () => new Promise(r => setImmediate(r));

// 1. удары убийцы из лога смерти
{
  const { en } = make();
  deq(en.hitsOf(DREMIA.fullLog, 'Dremia'), [2444, 2996, 2340]);
  deq(en.hitsOf(['[Other] −100 HP (X).', '[dremia] - 1 500 HP'], 'Dremia'), [1500], 'ник без учёта регистра, пробелы в числе, дефис вместо минуса');
}

// 2. hook.js: поле pv — из настоящих ответов игры (через подменённый fetch)
{
  const posted = [];
  const win = { postMessage: m => posted.push(m), alert() {} };
  const mkRes = body => Promise.resolve({ status: 200, headers: { get: () => 'application/json' }, clone: () => ({ text: () => Promise.resolve(JSON.stringify(body)) }) });
  let next = null;
  win.fetch = () => mkRes(next);
  const ctx = { window: win, location: { href: 'https://l2wap.com/map.html', host: 'l2wap.com', origin: 'https://l2wap.com', pathname: '/map.html' }, URL, URLSearchParams, performance: { now: () => 0 },
    XMLHttpRequest: function () {}, console, JSON, Math, String, Number, Array, Object };
  ctx.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {} };
  vm.runInNewContext(read('hook.js'), ctx);
  (async () => {
    next = { character: { id: 'me', hp: 1874, maxHp: 6220, pvpDefeat: DREMIA, currentZoneNameUk: 'Монастир Тиші' }, pvpIncoming: [] };
    await win.fetch('/character'); await flush(); await flush();
    const heroes = Array.from({ length: 12 }, (_, i) => ({ characterId: 'c' + i, name: 'P' + i, level: 50 + i, pvpNickColor: i === 11 ? 'pk' : null, nickColor: '#fff', battleOnNameClick: i > 5, showPkButton: false, isPartyMember: i === 0 }));
    next = { changed: true, around: { nearestLabelUk: 'Монастир Тиші', nearbyHeroes: heroes }, pvpIncoming: [{ attackerCharacterId: DID, attackerName: 'Dremia', playerCombatMode: 'world' }], pvpDefeat: null };
    await win.fetch('/game/map/sync'); await flush(); await flush();
    const net = posted.filter(m => m.__l2bot === 'net');
    const pv1 = net[0].pv, pv2 = net[1].pv;
    assert.equal(pv1.defeat.name, 'Dremia'); assert.equal(pv1.defeat.id, DID); assert.equal(pv1.defeat.ev, DREMIA.deathEventId); assert.equal(pv1.defeat.scope, 'world');
    assert.equal(pv1.defeat.log.length, 6); assert.equal(pv1.zone, 'Монастир Тиші'); deq(pv1.incoming, []);
    assert.equal(pv2.heroes.length, 12, 'все игроки, а не первые 8 (redact режет массивы)');
    // PvP friendly guard: отсутствие clanId остаётся неизвестным, не означает «без клана».
    deq(pv2.heroes[11], { id: 'c11', name: 'P11', lvl: 61, col: 'pk', atk: true, ok: null, why: '', party: false, clanId: '', clanKnown: false });
    assert.equal(pv2.heroes[0].party, true); assert.equal(pv2.heroes[0].atk, false);
    deq(pv2.incoming, [{ id: DID, name: 'Dremia', mode: 'world' }]); assert.equal(pv2.zone, 'Монастир Тиші');
    assert.ok(!JSON.stringify(net).includes('#fff'), 'цвет ника (nickColor) не нужен');
  })().catch(e => { console.error(e); process.exit(1); });
}

(async () => {
  // 3. смерть от игрока → в лист; повтор той же смерти (map/sync и /character шлют её несколько раз) — не дубль
  {
    const { en, env, recs } = make();
    const pd = { id: DID, name: 'Dremia', ev: DREMIA.deathEventId, scope: 'world', log: DREMIA.fullLog };
    en.onNet('/character', { pv: { defeat: pd, zone: 'Монастир Тиші' } }); await flush();
    en.onNet('/game/map/sync', { pv: { defeat: pd } }); await flush();
    const e = env.rt.enemies[DID];
    assert.equal(e.name, 'Dremia'); assert.equal(e.kills, 1); assert.equal(e.hitMax, 2996); assert.equal(e.hitAvg, 2593);
    assert.equal(recs.filter(r => /убил нас/.test(r)).length, 1);
    deq(env.rt.enemyDeaths, [DREMIA.deathEventId]);
    // TvT, арена, осада — не враги
    await en.noteDefeat({ id: 'x', name: 'Arena', ev: 'a1', arena: true });
    await en.noteDefeat({ id: 'y', name: 'Siege', ev: 's1', scope: 'clan_siege' });
    assert.equal(Object.keys(env.rt.enemies).length, 1);
    // вторая смерть от него — +1
    await en.noteDefeat({ ...pd, ev: 'ev2', log: ['[Dremia] −3100 HP (Буря).'] });
    assert.equal(env.rt.enemies[DID].kills, 2); assert.equal(env.rt.enemies[DID].hitMax, 3100);
  }

  // 4. проверка сил
  {
    const base = { id: DID, name: 'Dremia', kills: 1 };
    const v = (e, h, o = {}) => make({ cfg: o.cfg || {}, lvl: o.lvl ?? 61, hp: o.hp || { cur: 9000, max: 9000 } }).en.verdict(e, h);
    assert.equal(v(base, { col: 'pk', lvl: 62 }), '');
    assert.match(v({ ...base, hitMax: 2996 }, { col: 'pk' }, { hp: { cur: 6220, max: 6220 } }), /убивает нас за 3 удара/, 'Dremia: 6220 HP / 2996 — нападать нет смысла');
    assert.equal(v({ ...base, hitMax: 2996 }, { col: 'pk' }, { hp: { cur: 6220, max: 6220 }, cfg: { enemyMinHits: 0 } }), '', '0 — не проверять');
    assert.match(v(base, { col: '' }), /карму/, 'обычный ник — по умолчанию не трогаем');
    assert.equal(v(base, { col: '' }, { cfg: { enemyFlagOnly: false } }), '');
    assert.match(v(base, { col: 'pk', lvl: 66 }), /выше нас на 5/);
    assert.match(v(base, { col: 'pk', atk: false }), /не даёт/);
    assert.match(v(base, { col: 'pk', party: true }), /группе/);
    assert.match(v(base, { col: 'pk' }, { hp: { cur: 5000, max: 9000 } }), /HP ниже 80/);
    assert.match(v({ ...base, ignore: true }, { col: 'pk' }), /не трогать/);
    assert.match(v({ ...base, blockLvl: 61, skipWhy: 'проиграли 2 раза' }, { col: 'pk' }), /проиграли/);
    assert.equal(v({ ...base, blockLvl: 61 }, { col: 'pk' }, { lvl: 62 }), '', 'новый уровень — снова пробуем');
    assert.match(v(base, { col: 'pk' }, { cfg: { enemyHunt: false } }), /выключено/);
    assert.equal(v(base, {}), '', 'напал на нас сам (без данных карты) — флаг не проверяем');
  }

  // 5. враг на карте → клик по его нику в списке игроков (кнопка игры «Атакувати»)
  {
    const btn = { id: 'atk' };
    const rt = { enemies: { [DID]: { id: DID, name: 'Dremia', kills: 2, w: 0, l: 0 } } };
    const { en, env, clicks, recs } = make({ rt, dom: { q: { [`#map-hero-list li[data-character-id="${DID}"] .l2-map-hero-name-link--battle`]: btn } } });
    en.onNet('/game/map/sync', { pv: { heroes: [{ id: 'z', name: 'Zed', lvl: 60, col: 'pk' }, { id: DID, name: 'Dremia', lvl: 62, col: 'pk', atk: true }], zone: 'Монастир Тиші' } });
    assert.ok(recs.some(r => /враг Dremia \(62 ур\.\) на локации Монастир Тиші/.test(r)), recs.join('\n'));
    assert.equal(await en.step(), true);
    assert.equal(clicks[0], btn); assert.equal(env.rt.enemyHunt.id, DID); assert.equal(env.rt.enemies[DID].lvl, 62);
    assert.ok(recs.some(r => /нападаю на Dremia \(62 ур\.\)/.test(r)));
  }

  // 6. враг на локации во время боя с мобом — сначала добить моба; после победы — на карту
  {
    const rt = { enemies: { [DID]: { id: DID, name: 'Dremia', kills: 1 } } };
    const t = make({ rt, page: '/battle.html', search: '?spawnId=m1' });
    t.en.noteHeroes([{ id: DID, name: 'Dremia', lvl: 60, col: 'pk', atk: true }]);
    assert.equal(await t.en.step(), false, 'бой идёт');
    const t2 = make({ rt: { enemies: { [DID]: { id: DID, name: 'Dremia', kills: 1 } } }, page: '/battle.html', search: '?spawnId=m1', dom: { victory: true } });
    t2.en.noteHeroes([{ id: DID, name: 'Dremia', lvl: 60, col: 'pk', atk: true }]);
    assert.equal(await t2.en.step(), true); deq(t2.nav, ['map']);
    // в туре РБ / на рыбалке — не отвлекаемся
    const t3 = make({ rt: { enemies: { [DID]: { id: DID, name: 'Dremia', kills: 1 } } }, mode: 'raid' });
    t3.en.noteHeroes([{ id: DID, name: 'Dremia', lvl: 60, col: 'pk', atk: true }]);
    assert.equal(await t3.en.step(), false);
  }

  // 7. ошибка начала боя: игрок в городе — пауза 10 мин; победа — счёт и сброс серии поражений
  {
    const rt = { enemies: { [DID]: { id: DID, name: 'Dremia', kills: 1, streak: 1 } }, enemyHunt: { id: DID, name: 'Dremia', t: NOW } };
    const { en, env, recs, location } = make({ rt });
    await en.onStart({ method: 'POST', status: 400, req: { targetCharacterId: DID }, res: { error: 'pvp_target_safe' } });
    assert.match(env.rt.enemies[DID].skipWhy, /город/); assert.equal(env.rt.enemies[DID].skipT, NOW + 10 * 60000); assert.equal(env.rt.enemyHunt, null);
    env.rt.enemyHunt = { id: DID, name: 'Dremia', t: NOW };
    location.pathname = '/battle.html'; location.search = '?pvpTargetId=' + DID;
    NOW += 5000;
    en.onNet('/game/battle/action', { bt: { win: true } }); await flush();
    assert.equal(env.rt.enemies[DID].w, 1); assert.equal(env.rt.enemies[DID].streak, 0); assert.equal(env.rt.enemies[DID].skipT, 0);
    assert.ok(recs.some(r => /победа над Dremia/.test(r)));
    en.onNet('/game/battle/action', { bt: { win: true } }); await flush();
    assert.equal(env.rt.enemies[DID].w, 1, 'одна победа — один счёт');
  }

  // 8. поражение в ответном бою: пауза 30 мин, после 2 подряд — до нового уровня
  {
    const rt = { enemies: { [DID]: { id: DID, name: 'Dremia', kills: 1, w: 0, l: 0, streak: 0 } }, enemyHunt: { id: DID, name: 'Dremia', t: NOW } };
    const { en, env } = make({ rt, lvl: 61 });
    await en.noteDefeat({ id: DID, name: 'Dremia', ev: 'r1', scope: 'world', log: [] });
    let e = env.rt.enemies[DID];
    assert.equal(e.l, 1); assert.equal(e.kills, 2); assert.equal(e.skipT, NOW + 30 * 60000); assert.ok(!e.blockLvl);
    env.rt.enemyHunt = { id: DID, name: 'Dremia', t: NOW };
    await en.noteDefeat({ id: DID, name: 'Dremia', ev: 'r2', scope: 'world', log: [] });
    e = env.rt.enemies[DID];
    assert.equal(e.streak, 2); assert.equal(e.blockLvl, 61); assert.match(en.verdict(e, { col: 'pk' }), /до нового уровня/);
  }

  // 9. враг из листа напал на нас — бот жмёт «Атакувати» в шапке игры
  {
    const btn = { id: 'inc' };
    const rt = { enemies: { [DID]: { id: DID, name: 'Dremia', kills: 1 } } };
    const { en, env, clicks } = make({ rt, page: '/battle.html', search: '?spawnId=m1', dom: { q: { '#l2-pvp-incoming-attack': btn } } });
    en.onNet('/character', { pv: { incoming: [{ id: DID, name: 'Dremia' }] } });
    assert.equal(await en.step(), true); assert.equal(clicks[0], btn); assert.equal(env.rt.enemyHunt.via, 'incoming');
    // не враг — не отвечаем
    const t2 = make({ rt: { enemies: { [DID]: { id: DID, name: 'Dremia', kills: 1 } } }, page: '/battle.html', search: '?spawnId=m1', dom: { q: { '#l2-pvp-incoming-attack': btn } } });
    t2.en.onNet('/character', { pv: { incoming: [{ id: 'other', name: 'Other' }] } });
    assert.equal(await t2.en.step(), false); assert.equal(t2.clicks.length, 0);
  }

  // 10. слежка: фоном GET /game/map/around раз в enemyScanS (не чаще, только если лист не пуст)
  {
    const around = { nearestLabelUk: 'Монастир Тиші', nearbyHeroes: [{ characterId: DID, name: 'Dremia', level: 61, pvpNickColor: 'pk', battleOnNameClick: true }] };
    const t = make({ rt: { enemies: { [DID]: { id: DID, name: 'Dremia', kills: 1, seenT: NOW - 3600000 } } }, page: '/battle.html', search: '?spawnId=m1', dom: { around } });
    await t.en.tick();
    deq(t.nav, ['GET /game/map/around']);
    assert.ok(t.recs.some(r => /враг Dremia \(61 ур\.\) на локации/.test(r)));
    await t.en.tick(); assert.equal(t.nav.length, 1, 'не чаще раза в 30 с');
    const t2 = make({ dom: { around } }); await t2.en.tick(); deq(t2.nav, [], 'лист пуст — не опрашиваем');
  }

  // 11. проводка: модуль в манифесте, ядро, хук, меню
  {
    const mf = JSON.parse(read('manifest.json')), js = mf.content_scripts.find(x => x.js.includes('content.js')).js;
    assert.ok(js.indexOf('modules/enemies.js') >= 0 && js.indexOf('modules/enemies.js') < js.indexOf('content.js'));
    const content = read('content.js');
    assert.match(content, /if \(d\.pv \|\| d\.bt\?\.win \|\| path === '\/game\/battle\/pvp\/start'\) try \{ L2V7Modules\.enemies\?\.onNet\(path, d\);/);
    assert.match(content, /if \(L2EngineCore\.taskAllowed\(cfg,'pvp'\) && await L2V7Modules\.enemies\.step\(\)\) \{ await sleep\(200\); continue; \}/);
    // 15.10: заточка раньше доводит уже открытый бой; обычный поиск врагов остаётся после TvT и до общего боевого dispatcher.
    const enemiesAt = content.indexOf('L2V7Modules.enemies.step()'), routeAt = content.indexOf('else if (fishNow() && isFishing())');
    const regularBattleAt = content.indexOf('else if (isBattle()) await battle();', routeAt);
    assert.ok(enemiesAt > content.indexOf('await tvtStep()') && routeAt > enemiesAt && regularBattleAt > routeAt);
    const enchantAt = content.indexOf("if (autonomyMode() === 'enchant') {", content.indexOf('await tvtStep()'));
    assert.ok(enchantAt > 0 && enchantAt < enemiesAt);
    assert.match(content.slice(enchantAt, enemiesAt), /else await enchantDispatch\(\);\s*await sleep\(200\); continue;/, 'enchant branch exits before ordinary enemy hunting');
    assert.match(content, /enemyHunt: true, enemyFlagOnly: true, enemyLvlAbove: 3, enemyMinHits: 3, enemyMaxLoss: 2, enemyScanS: 30/);
    const popup = read('popup.js'), html = read('popup.html');
    assert.match(popup, /enemyHunt: true, enemyFlagOnly: true, enemyLvlAbove: 3, enemyMinHits: 3, enemyMaxLoss: 2, enemyScanS: 30/);
    for (const id of ['enemyHunt', 'enemyFlagOnly', 'enemyLvlAbove', 'enemyMinHits', 'enemyMaxLoss', 'enemyScanS', 'enemyBox']) assert.match(html, new RegExp(`id="${id}"`));
    assert.ok(html.indexOf('id="tab-enemies"') > html.indexOf('id="tab-panel"') && html.indexOf('id="tab-enemies"') < html.indexOf('id="tab-pet"'), 'подраздел в «⚔ Бой»');
    assert.match(html, /<script src="modules\/enemies\.js"><\/script>/);
    const bp = JSON.parse(read('base-profile.json')); assert.equal(bp.cfg.enemyHunt, true); assert.equal(bp.cfg.enemyMinHits, 3);
    const { en } = make(); assert.match(en.brief({ name: 'Dremia', lvl: 61, kills: 2, w: 1, l: 0, hitMax: 2996, lastKill: NOW - 120000 }, NOW), /^Dremia \(61 ур\.\): убил нас 2×, последний раз 2 мин назад · ответ: побед 1, поражений 0 · удар до 2/);
  }
  console.log('PASS: 9.2 лист врагов — убийца из pvpDefeat (Dremia, 11.10) в лист без дублей, удары из лога, проверка сил (уровень, удары, флаг, HP, группа, поражения), нападение кнопкой ника на карте, после победы над мобом, ответ на нападение, ошибки старта (город), победа/поражение в ответном бою, слежка GET /game/map/around, hook pv, меню «☠ Лист врагов»');
})().catch(e => { console.error(e); process.exit(1); });
