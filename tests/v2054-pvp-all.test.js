'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 9.2 «☠ Лист врагов» (оригинальный заголовок теста v92-enemies) (modules/enemies.js + hook.js pv): убийца героя — в лист (живой ответ 11.10 17:39: Warlock убит игроком Dremia),
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


// 20.54 (John 23.10: «Убиваем ВСЕХ кроме Teddy и tms», «сразу как только замечаем»): режим pvpAll
const btnFor = id => `#map-hero-list li[data-character-id="${id}"] .l2-map-hero-name-link--battle`;
const H = (id, name, extra = {}) => ({ id, name, lvl: 80, col: '', atk: true, party: false, clanKnown: true, clanId: 'other', ...extra });
const self = { clanId: 'mine' };
function mk(cfg, opts = {}) { const m = make({ cfg: { enemyHunt: true, pvpAll: true, pvpSpare: 'Teddy, tms', ...cfg }, ...opts }); m.env.pvpSelf = () => self; return m; }

// 1. умолчания: режим ВКЛ, исключения Teddy и tms; задача pvp включается разово
{
  const d = read('defaults.js');
  assert.match(d, /pvpAll: true, pvpSpare: 'Teddy, tms'/);
  assert.match(read('content.js'), /once\('pvpAll2054'[\s\S]{0,200}cf\.enemyHunt = true;[\s\S]{0,200}cf\.autoTasks = \[\.\.\.at, 'pvp'\]/);
  assert.match(read('engine-core.js'), /pvp: \['enemyHunt','pvpOnSight','pvpAll'\]/);
}
// 2. посторонний игрок (не в листе, обычный ник, выше на 20 ур.) — цель сразу; Teddy/tms (любой регистр) — нет
{
  const { en } = mk({});
  en.noteHeroes([H('t1', 'TEDDY'), H('t2', 'Tms'), H('x1', 'Stranger', { lvl: 99 })], 'Zone');
  const p = en.pick();
  assert.equal(p.e.name, 'Stranger'); assert.equal(p.e.stranger, true);
  assert.equal(en.verdict({ name: 'teddy' }, H('t1', 'teddy')), 'в списке «не трогать» (PvP)');
  assert.equal(en.spared('TMS'), true); assert.equal(en.spared('Tmsx'), false);
}
// 3. исключения редактируются: пустой список — бьём и Teddy; свои ники — не бьём
{
  const a = mk({ pvpSpare: '' }); a.en.noteHeroes([H('t1', 'Teddy')]); assert.equal(a.en.pick().e.name, 'Teddy');
  const b = mk({ pvpSpare: 'Friend; Teddy' }); b.en.noteHeroes([H('f', 'friend'), H('t1', 'Teddy')]); assert.equal(b.en.pick(), null);
}
// 4. группа, свой клан, нет кнопки атаки, свой ник — не цель; режим выключен — посторонние не цель
{
  const { en, env } = mk({});
  en.noteHeroes([H('p', 'Party', { party: true }), H('c', 'Clan', { clanId: 'mine' }), H('n', 'NoBtn', { atk: false }), H('me', env.rt.char || 'Me')]);
  env.rt.char = 'Me';
  assert.equal(en.pick(), null);
  const off = mk({ pvpAll: false }); off.en.noteHeroes([H('x', 'Stranger')]); assert.equal(off.en.pick(), null);
}
// 5. нападение кнопкой на карте; посторонний не попадает в лист врагов; занятость (тур РБ) — не нападаем
(async () => {
  const btn = { id: 'b' };
  const m = mk({}, { dom: { q: { [btnFor('x1')]: btn } } });
  m.en.noteHeroes([H('x1', 'Stranger')]);
  assert.equal(await m.en.step(), true);
  deq(m.clicks, [btn]);
  assert.equal(m.env.rt.enemyHunt.name, 'Stranger'); assert.equal(m.env.rt.enemyHunt.all, true);
  assert.equal(Object.keys(m.env.rt.enemies || {}).length, 0, 'посторонний не в листе врагов');
  assert.ok(m.recs.some(r => /нападаю на Stranger .*бить всех/.test(r)));
  const busy = mk({}, { mode: 'raid', dom: { q: { [btnFor('x1')]: btn } } });
  busy.en.noteHeroes([H('x1', 'Stranger')]);
  assert.equal(await busy.en.step(), false); deq(busy.clicks, []);
  // бой с мобом — сначала добить, потом на карту
  const bt = mk({}, { page: '/battle.html', dom: { victory: true } });
  bt.en.noteHeroes([H('x1', 'Stranger')]);
  assert.equal(await bt.en.step(), true); deq(bt.nav, ['map']);
  // 6. сканирование локации идёт и при пустом листе врагов
  const sc = mk({}, { dom: { around: { nearbyHeroes: [{ characterId: 'z', name: 'Zed', level: 70, battleOnNameClick: true, clanId: 'x' }] } } });
  sc.env.on = true; sc.env.tabOwner = true; sc.env.rt.char = 'Me';
  NOW += 10 * 60000; await sc.en.tick();
  assert.ok(sc.nav.includes('GET /game/map/around'));
  assert.equal(sc.en._state.HERO.list[0].name, 'Zed');
  // 7. отказ игры по постороннему — пауза без записи в лист
  const rf = mk({}); rf.env.rt.enemyHunt = { id: 'x1', name: 'Stranger' };
  rf.en.noteHeroes([H('x1', 'Stranger')]);
  await rf.en.onStart({ req: { targetCharacterId: 'x1' }, status: 400, res: { error: 'pvp_target_safe' } });
  assert.equal(rf.env.rt.enemyHunt, null); assert.ok(rf.recs.some(r => /Stranger не вышло: в городе/.test(r)));
  // 8. явная цель pvp.js тоже не атакует ник из «не трогать»
  assert.match(read('modules/pvp.js'), /pvpSpare\?\?'Teddy, tms'[\s\S]{0,120}'в списке «не трогать» \(PvP\)'/);
  // 9. меню: отдельный раздел PvP с режимом и исключениями, TvT — свой раздел
  const html = read('popup.html'), sec = id => { const a = html.indexOf(`<section id="tab-${id}"`); return html.slice(a, html.indexOf('</section>', a)); };
  assert.ok(sec('pvp').includes('id="pvpAll"') && sec('pvp').includes('id="pvpSpare"') && sec('pvp').includes('id="enemyHunt"'));
  assert.ok(sec('tvt').includes('id="tvtOn"') && !sec('pvp').includes('id="tvtOn"'));
  const pj = read('popup.js'); assert.match(pj, /TXT\.push\('pvpSpare'\)/); assert.match(pj, /'enemyFlagOnly', 'pvpAll'/);
  console.log('v2054-pvp-all: PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
