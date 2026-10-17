'use strict';
// 20.13 (ревизия 17.10, шаг 5, участок pvp-misc): застревания TvT/PvP/листа врагов.
// TVT-1 — невыполнимая регистрация (20/20 или нет кнопки) не держит PvE всё окно; TVT-3 — без пинг-понга «выход ради TvT ↔ назад в бой»;
// TVT-6 — старая фаза ACTIVE не держит приоритет часами, записанный герой перечитывает статус; PVP-1 — отказ сервера в начале PvP
// ставит паузу цели; ENM-1 — лист врагов не нападает на соклановца.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function storage() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
function tvtFixture(o = {}) {
 let now = 1900000000000, battle = !!o.battle;
 const loc = { pathname: o.arena ? '/tvt-arena.html' : o.battle ? '/battle.html' : '/map.html', search: '?spawnId=l2dop_rb_1', href: '' };
 const clicked = [], logs = [], leaves = [], reads = [];
 const button = { id: 'tvt-register-btn' };
 const env = { cfg: { tvtOn: true }, rt: {}, on: true, tabOwner: true,
  TVT: { phase: 'REGISTRATION', eventId: 'ev1', isRegistered: false, registeredCount: o.count ?? 4, maxPlayers: 20, registrationEndsAt: now + 570000,
   schedule: { next: { registrationOpensAt: now, battleStartsAt: now + 600000 } }, t: now },
  $q: s => s === '#tvt-register-btn' && o.button !== false && loc.pathname === '/tvt-arena.html' ? button : s === '#tvt-message' ? { textContent: 'Рівень замалий' } : null,
  shown: e => !!e, isBattle: () => battle, victory: () => false,
  rec: (...x) => logs.push(x.join(' ')), setStatus: s => logs.push(s), setRt: async p => Object.assign(env.rt, p),
  sleep: async ms => { now += ms; }, pause: async () => {}, waitX: async f => f(), autonomyMode: () => 'farm',
  leaveMark: id => leaves.push(id), toMap: async () => { leaves.push('map'); },
  fire: b => { clicked.push(b.id); } };
 const box = { console, Date: class extends Date { static now() { return now; } }, location: loc, document: { querySelectorAll: () => [] }, sessionStorage: o.ss || storage() };
 box.globalThis = box;
 vm.runInNewContext(read('modules/tvt.js'), box);
 return { env, T: box.L2V7Factories.tvt(env), loc, clicked, logs, leaves, reads, box, advance: n => { now += n; }, now: () => now, setBattle: b => { battle = b; } };
}

test('TVT-1: 20/20 мест — регистрация не держит PvE и бой с РБ не прерывается; освободилось место — снова на арену', async () => {
 const f = tvtFixture({ battle: true, count: 20 });
 assert.equal(f.T.tvtRegistrationDue(), false); assert.equal(f.T.tvtHold(), false);
 assert.equal(await f.T.tvtStep(), false); assert.deepEqual(f.leaves, [], 'бой с РБ не прерван ради полной записи');
 f.env.TVT.registeredCount = 19;
 assert.equal(f.T.tvtRegistrationDue(), true);
 assert.equal(await f.T.tvtStep(), true); assert.equal(f.leaves[0], 'l2dop_rb_1');
});
test('TVT-1: кнопки «Зарегистрироваться» нет дважды — событие пропускается до конца регистрации, бот возвращается к делу', async () => {
 const f = tvtFixture({ arena: true, button: false });
 assert.equal(await f.T.tvtStep(), true); assert.equal(f.env.rt.tvtRegNoBtn.n, 1); assert.equal(f.T.tvtRegistrationDue(), true);
 f.advance(5000);
 assert.equal(await f.T.tvtStep(), true);
 assert.equal(f.env.rt.tvtRegSkip.id, 'ev1'); assert.equal(f.loc.href, '/map.html'); assert.match(f.logs.join('\n'), /пропускаю до конца регистрации/);
 assert.equal(f.T.tvtRegistrationDue(), false); assert.equal(f.T.tvtHold(), false);
 f.loc.pathname = '/map.html'; f.loc.href = '';
 assert.equal(await f.T.tvtStep(), false); assert.equal(f.loc.href, '', 'не возвращается на арену в этом окне');
 f.env.TVT = { ...f.env.TVT, eventId: 'ev2' };
 assert.equal(f.T.tvtRegistrationDue(), true, 'новое событие пробуем снова');
});
test('TVT-1: кнопка нашлась — счётчик «нет кнопки» сбрасывается', async () => {
 const f = tvtFixture({ arena: true }); f.env.rt.tvtRegNoBtn = { id: 'ev1', n: 1 };
 await f.T.tvtStep(); assert.equal(f.clicked.length, 1); assert.equal(f.env.rt.tvtRegNoBtn, null); assert.equal(f.env.rt.tvtRegSkip, undefined);
});
test('TVT-3: выход ради TvT не подтверждён и бот вернулся в бой — повтор не раньше 30 с, а не каждые 3 с', async () => {
 const ss = storage();
 const a = tvtFixture({ battle: true, ss });
 assert.equal(await a.T.tvtStep(), true); assert.equal(a.leaves.length, 2);
 // новая страница боя (leaveCheck вернул в бой): та же вкладка, тот же sessionStorage
 const b = tvtFixture({ battle: true, ss }); b.advance(a.now() - b.now() + 5000);
 assert.equal(await b.T.tvtStep(), false); assert.equal(b.leaves.length, 0);
 b.advance(26000);
 assert.equal(await b.T.tvtStep(), true); assert.equal(b.leaves[0], 'l2dop_rb_1');
});
test('TVT-3: первая попытка в странице и без прошлых меток — сразу, как раньше', async () => {
 const f = tvtFixture({ battle: true }); f.box.sessionStorage = undefined;
 assert.equal(await f.T.tvtStep(), true); assert.equal(f.leaves[0], 'l2dop_rb_1');
});
test('TVT-6: фаза ACTIVE из старых данных часами не держит арену и задачи; записанный герой перечитывает статус', async () => {
 const f = tvtFixture();
 f.env.TVT = { eventId: 'old', phase: 'ACTIVE', isRegistered: true, myTeam: 1, startsAt: f.now() - 30000, schedule: {}, t: f.now() };
 assert.equal(f.T.tvtSoon(), true); assert.equal(f.T.tvtHold(), true);
 f.advance(3 * 3600000);
 assert.equal(f.T.tvtSoon(), false); assert.equal(f.T.tvtHold(), false);
 // а свежий опрос нужен и записанному: данные старше минуты при фазе ACTIVE
 const g = tvtFixture();
 g.env.TVT = { eventId: 'e', phase: 'ACTIVE', isRegistered: true, myTeam: 1, startsAt: g.now(), schedule: {}, t: g.now() };
 g.env.gameGet = async url => { g.reads.push(url); return { ok: true, json: async () => ({ phase: 'IDLE', isRegistered: false, schedule: {} }) }; };
 await g.T.tvtRefresh(); assert.equal(g.reads.length, 0, 'свежие данные — без лишнего GET');
 g.advance(61000); await g.T.tvtRefresh(); assert.equal(g.reads.length, 1);
 assert.equal(g.T.tvtSoon(), false, 'сервер сказал IDLE — на арену не идём');
});
test('TVT-6: фаза ACTIVE в пределах боя (10 мин + запас) по-прежнему держит приоритет', () => {
 const f = tvtFixture();
 f.env.TVT = { eventId: 'e', phase: 'ACTIVE', isRegistered: true, myTeam: 1, startsAt: f.now() - 30000, endsAt: f.now() + 600000, schedule: {}, t: f.now() };
 f.advance(13 * 60000); assert.equal(f.T.tvtSoon(), true);
});

// ---------- PvP «Атаковать при встрече» и лист врагов ----------
const DID = '6f573aad-08ee-4713-9d76-33f5fd4afc93';
function pvpFixture(o = {}) {
 let now = 1e6; const calls = [], nodes = {}, location = { pathname: '/map.html', search: '' };
 const hero = { characterId: DID, name: 'Dremia', level: 77, clanId: 'their-clan', isPartyMember: false, battleOnNameClick: true, pvpAllowed: true, pvpNickColor: o.col || '' };
 nodes[`#map-hero-list li[data-character-id="${DID}"] .l2-map-hero-name-link--battle`] = { dataset: {}, textContent: 'Dremia', disabled: false };
 const env = { cfg: { pvpOnSight: true, enemyHunt: true, enemyFlagOnly: true, enemyMinHits: 0 },
  rt: { char: 'Warlock', manualKickAt: 0, pvpTargets: o.noTarget ? {} : { [DID]: { id: DID, name: 'Dremia', enabled: true } }, enemies: { [DID]: { id: DID, name: 'Dremia', kills: 2 } } }, on: true, tabOwner: true,
  antibotState: () => false, abHold: () => false, setRt: async p => { Object.assign(env.rt, p); return { ok: true }; }, rtCommit: async () => true, rec: (...a) => calls.push(['log', ...a]), setStatus: () => {},
  heroLevel: () => 77, meHp: () => ({ cur: 9000, max: 9000 }), autonomyMode: () => 'farm', fishNow: () => false, tvtSoon: () => false,
  isMap: () => location.pathname === '/map.html', isBattle: () => location.pathname === '/battle.html', victory: () => false,
  $q: s => nodes[s], shown: b => !!b && !b.hidden, fire: b => { calls.push(['click', b]); return true; }, pause: async () => {}, sleep: async () => {}, waitX: async fn => fn(), toMap: async () => calls.push(['map']),
  gameGet: async p => { calls.push(['GET', p]); return { ok: true, json: async () => p === '/character' ? { character: { id: 'our-id', name: 'Warlock', clanId: o.ourClan ?? 'our-clan' } } : p.endsWith('/profile') ? { profile: { id: DID, name: 'Dremia', clanId: o.profileClan ?? 'their-clan' } } : { nearbyHeroes: [hero] } }; } };
 const box = { console, Date: { now: () => now }, Math, URLSearchParams, Object, location, document: { querySelectorAll: () => [] }, CSS: { escape: x => x }, sessionStorage: storage() };
 vm.createContext(box); box.globalThis = box;
 for (const f of ['modules/enemies.js', 'modules/pvp.js']) vm.runInContext(read(f), box);
 const pvp = box.L2V7Factories.pvp(env);
 if (o.wire) Object.assign(env, { pvpSelf: () => pvp.selfClan(), pvpSelfRead: () => pvp.selfRead(), pvpHeroClan: (id, n) => pvp.heroClan(id, n) });
 const en = box.L2V7Factories.enemies(env);
 return { env, pvp, en, calls, hero, nodes, box, setNow: n => { now = n; }, now: () => now };
}
const clicks = f => f.calls.filter(x => x[0] === 'click');
for (const [code, min] of [['pvp_target_safe', 10], ['pvp_target_dead', 5], ['pvp_some_error', 15]]) test(`PVP-1: отказ сервера ${code} — пауза цели ${min} мин, PvE не стоит`, async () => {
 const f = pvpFixture();
 assert.equal(await f.pvp.step(), true); assert.equal(clicks(f).length, 1);
 f.pvp.onNet('/game/battle/pvp/start', { method: 'POST', status: 400, req: { targetCharacterId: DID }, res: { error: code } });
 f.setNow(f.now() + 6000);
 assert.equal(await f.pvp.step(), false, 'после отказа не жмём ник каждые 5 с'); assert.equal(clicks(f).length, 1);
 assert.match(f.pvp.verdict(f.env.rt.pvpTargets[DID], f.pvp._state.heroes[0]), /отказ сервера/);
 f.setNow(f.now() + min * 60000);
 assert.equal(await f.pvp.step(), true, 'пауза кончилась — снова пробуем явную цель'); assert.equal(clicks(f).length, 2);
});
test('PVP-1: три нажатия без начала боя — пауза 2 мин; успешный старт сбрасывает счётчик', async () => {
 const f = pvpFixture();
 for (let i = 0; i < 3; i++) { assert.equal(await f.pvp.step(), true); f.setNow(f.now() + 6000); }
 assert.equal(clicks(f).length, 3);
 assert.equal(await f.pvp.step(), false); assert.equal(clicks(f).length, 3);
 f.setNow(f.now() + 2 * 60000);
 assert.equal(await f.pvp.step(), true); f.setNow(f.now() + 6000);
 f.pvp.onNet('/game/battle/pvp/start', { method: 'POST', status: 200, req: { targetCharacterId: DID }, res: { ok: true } });
 assert.equal(await f.pvp.step(), true); f.setNow(f.now() + 6000);
 assert.equal(await f.pvp.step(), true, 'после успешного старта счёт начат заново'); assert.equal(clicks(f).length, 6);
});
test('ENM-1: лист врагов не нападает на соклановца; другой клан — нападает; свой клан не прочитан — ждёт', async () => {
 const same = pvpFixture({ noTarget: true, wire: true, col: 'pk' });
 same.hero.clanId = 'our-clan';
 same.en.onNet('/game/map/sync', { pv: { heroes: [{ id: DID, name: 'Dremia', lvl: 77, col: 'pk', atk: true, clanId: 'our-clan', clanKnown: true }] } });
 assert.match(same.en.verdict(same.env.rt.enemies[DID], { col: 'pk', clanId: 'our-clan', clanKnown: true }), /проверяю свой клан/);
 assert.equal(await same.en.step(), false); assert.equal(clicks(same).length, 0);
 assert.equal(same.pvp.selfClan().clanId, 'our-clan');
 assert.match(same.en.verdict(same.env.rt.enemies[DID], { col: 'pk', clanId: 'our-clan', clanKnown: true }), /в одном клане/);
 const other = pvpFixture({ noTarget: true, wire: true, col: 'pk' });
 other.en.onNet('/game/map/sync', { pv: { heroes: [{ id: DID, name: 'Dremia', lvl: 77, col: 'pk', atk: true, clanId: 'their-clan', clanKnown: true }] } });
 assert.equal(await other.en.step(), true); assert.equal(clicks(other).length, 1);
});
test('ENM-1: клан врага неизвестен в списке — дочитывается профилем; ответ на нападение отменяет только подтверждённый общий клан', async () => {
 const f = pvpFixture({ noTarget: true, wire: true, col: 'pk', profileClan: 'our-clan' });
 f.en.onNet('/game/map/sync', { pv: { heroes: [{ id: DID, name: 'Dremia', lvl: 77, col: 'pk', atk: true }] } });
 assert.equal(await f.en.step(), false); assert.equal(clicks(f).length, 0);
 assert.ok(f.calls.some(c => c[0] === 'GET' && c[1].endsWith('/profile')));
 assert.equal(f.en.verdict(f.env.rt.enemies[DID], {}, null, { incoming: true }), '', 'напал сам, клан неизвестен — отвечаем, как раньше');
 assert.match(f.en.verdict(f.env.rt.enemies[DID], { clanId: 'our-clan', clanKnown: true }, null, { incoming: true }), /в одном клане/);
 const g = pvpFixture({ noTarget: true, wire: true, col: 'pk', profileClan: 'their-clan' });
 g.en.onNet('/game/map/sync', { pv: { heroes: [{ id: DID, name: 'Dremia', lvl: 77, col: 'pk', atk: true }] } });
 assert.equal(await g.en.step(), true); assert.equal(clicks(g).length, 1);
});
test('ENM-1: без клана у героя чужой неизвестный клан не мешает', async () => {
 const f = pvpFixture({ noTarget: true, wire: true, col: 'pk', ourClan: null });
 f.en.onNet('/game/map/sync', { pv: { heroes: [{ id: DID, name: 'Dremia', lvl: 77, col: 'pk', atk: true }] } });
 assert.equal(await f.en.step(), true); assert.equal(clicks(f).length, 1);
});
test('content.js: у фабрики enemies есть геттеры pvpSelf/pvpSelfRead/pvpHeroClan', () => {
 const src = read('content.js'), m = src.match(/L2V7Modules\.enemies = L2V7Factories\.enemies\(\{[^\n]*/)[0];
 for (const g of ['pvpSelf', 'pvpSelfRead', 'pvpHeroClan']) assert.ok(m.includes(`get ${g}()`), g);
});
