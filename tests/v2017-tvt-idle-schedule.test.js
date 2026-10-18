'use strict';
// 20.17 (лог 18.10 21:30–21:55): бот на паузе рыбалки не записался на TvT — окно открылось в 21:50, игрок нажал «Да» сам в 21:55.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const S0 = 1792323050782;                           // 21:30:50 по журналу
const NEXT_1500 = { slotKey: '20261018:1500', registrationOpensAt: 1792324200000, preparationStartsAt: 1792324770000, battleStartsAt: 1792324800000 };
const NEXT_0800 = { slotKey: '20261018:0800', registrationOpensAt: 1792299000000, preparationStartsAt: 1792299570000, battleStartsAt: 1792299600000 };
function fixture(tvt, at) {
 let now = at, reads = 0;
 const location = { pathname: '/fishing.html', search: '', href: '' };
 const env = { on: true, tabOwner: true, cfg: { tvtOn: true }, TVT: null, rt: { char: 'Warlock', tvt },
  gameGet: async () => { reads++; return { ok: true, json: async () => ({ phase: 'REGISTRATION', eventId: 'tvt-scheduled-20261018:1500', serverNow: now, isRegistered: false,
   registeredCount: 5, maxPlayers: 50, registrationEndsAt: NEXT_1500.preparationStartsAt, schedule: { enabled: true, next: NEXT_1500 } }) }; },
  setRt: async p => Object.assign(env.rt, p), isBattle: () => false, victory: () => false, toMap: async () => {}, sleep: async () => {},
  rec: () => {}, setStatus: () => {}, $q: () => null, shown: () => false, waitX: async () => null, autonomyMode: () => 'fish', pause: async () => {} };
 const box = { Date: class extends Date { static now() { return now; } }, location, console };
 vm.runInNewContext(fs.readFileSync(__dirname + '/../modules/tvt.js', 'utf8'), box);
 return { env, location, T: box.L2V7Factories.tvt(env), reads: () => reads, advance: ms => { now += ms; } };
}
const idleState = (next, t) => ({ k: 'null|IDLE|false|', eventId: null, phase: 'IDLE', isRegistered: false, myTeam: null, startsAt: null,
 registrationEndsAt: null, registeredCount: 0, maxPlayers: 50, off: 0, schedule: { enabled: true, next }, selfCombat: null, t });

test('устаревший слот расписания в rt.tvt: бот сам читает /game/tvt и идёт записываться', async () => {
 const f = fixture(idleState(NEXT_0800, S0 - 3600000), S0 + 20 * 60000 + 28000);   // 21:51:18, после перезагрузки вкладки
 assert.equal(await f.T.tvtStep(), true);
 assert.equal(f.reads(), 1);
 assert.equal(f.location.href, '/tvt-arena.html');
});
test('свежее расписание с будущим окном не опрашивается каждый круг', async () => {
 const f = fixture(idleState(NEXT_1500, S0), S0 + 5 * 60000);
 assert.equal(await f.T.tvtStep(), false); assert.equal(f.reads(), 0);
 f.advance(5 * 60000); assert.equal(await f.T.tvtStep(), false); assert.equal(f.reads(), 0, 'до окна 21:50 без GET');
});
test('устаревший слот перечитывается не чаще раза в минуту', async () => {
 const f = fixture(idleState(NEXT_0800, S0 - 3600000), S0);
 f.env.gameGet = async () => { f.reads.n = (f.reads.n || 0) + 1; return { ok: false }; };
 await f.T.tvtRefresh(); f.advance(30000); await f.T.tvtRefresh(); assert.equal(f.reads.n, 1);
 f.advance(31000); await f.T.tvtRefresh(); assert.equal(f.reads.n, 2);
});
test('в регистрации старт считается от её конца, даже если schedule.next уже на следующем слоте', () => {
 const later = { slotKey: '20261018:2000', registrationOpensAt: 1792342200000, battleStartsAt: 1792342800000 };
 const f = fixture({ eventId: 'e', phase: 'REGISTRATION', isRegistered: true, registrationEndsAt: NEXT_1500.preparationStartsAt, schedule: { next: later }, t: S0 + 19 * 60000 }, S0 + 28 * 60000 + 30000);
 assert.equal(f.T.tvtState().start, NEXT_1500.preparationStartsAt + 30000);
 assert.equal(f.T.tvtSoon(), true, 'за минуту до боя — на арену');
 const g = fixture({ eventId: 'e', phase: 'REGISTRATION', isRegistered: true, registrationEndsAt: NEXT_1500.preparationStartsAt, schedule: { next: NEXT_1500 }, t: S0 }, S0);
 assert.equal(g.T.tvtState().start, NEXT_1500.battleStartsAt);
});
test('ожидание (пауза рыбалки) прерывается, когда пора на TvT; ключ записи rt.tvt учитывает слот', () => {
 const src = fs.readFileSync(__dirname + '/../content.js', 'utf8');
 const idle = src.slice(src.indexOf('async function idle('), src.indexOf('async function idle(') + 600);
 assert.match(idle, /idleTvtBreak\(\)/);
 assert.match(src, /const idleTvtBreak = \(\) => \{[^\n]*tvtRefresh[^\n]*tvtRegistrationDue[^\n]*tvtSoon/);
 assert.match(src, /TVT\.schedule\?\.next\?\.slotKey/);
});
