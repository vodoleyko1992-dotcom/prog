'use strict';
// 20.43 (автономность, доводка 21.10, замечание R4): rbExitAshen — неудачные сверки героя после выхода из Ashen Bastion не считались.
// Повторяющийся сбой GET /character (исключение, 401/5xx, ответ без JSON), чужое имя или «в бою» навсегда оставляли тур на шаге exit:
// раз в минуту GET, без боя, без паузы и без строки в журнале. Теперь: первая неудача — одна строка в журнал, ASHEN_READ_MAX (30) подряд —
// пауза с причиной (pauseBot fault); любой ответ про героя вне боя (город или «не в городе») счёт обнуляет. Платных шагов и переходов нет.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const file = path.join(__dirname, 'v1021-raid-farm-lifecycle.test.js'), source = fs.readFileSync(file, 'utf8');
const box = { require: require('node:module').createRequire(file), __dirname, console, process };
vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nthis.make=fixture;', box);
const { docOf } = require('./epic-harness.cjs');

function fixture(read) {
  const f = box.make(); f.loc.pathname = '/ashen-bastion.html'; f.env.rtCommit = async () => true;
  f.setDoc(docOf('<a id="ashen-exit-city" href="/city.html">Вийти в місто (Aden)</a>'));
  let reads = 0; const pauses = [];
  f.env.gameGet = async () => { reads++; return read(reads); };
  f.env.pauseBot = async (s, o) => { pauses.push({ s, o }); f.env.on = false; };
  return Object.assign(f, { reads: () => reads, pauses });
}
const reply = character => ({ ok: true, json: async () => ({ character }) });
async function begin(f) {
  await f.R.rbHuntStep(); assert.equal(f.env.rt.rbHunt.step, 'exit'); assert.equal(f.env.rt.rbHunt.id, 'one');
  await f.R.rbHuntStep(); assert.equal(f.fires.length, 1, 'штатный выход нажат один раз');
  f.env.rt.rbHunt.exitAt = Date.now() - 61000;   // минута на подтверждение истекла
}
const tick = async f => { f.env.rt.rbHunt.exitReadAt = Date.now() - 61000; await f.R.rbHuntStep(); };
const exitLogs = f => f.logs.filter(l => /сверка героя не удалась/.test(l));

for (const [kind, read, what] of [
  ['исключение сети', () => { throw new Error('502'); }, 'сервер не отдал героя'],
  ['ответ 401 без JSON', () => ({ ok: false, status: 401, json: async () => { throw new Error('no json'); } }), 'сервер не отдал героя'],
  ['чужой герой', () => reply({ name: 'Other', cityId: 'ashen_bastion', inBattle: false }), 'ответ не про этого героя'],
  ['герой в бою', () => reply({ name: 'TestHero', cityId: 'ashen_bastion', inBattle: true }), 'герой в бою'],
]) test(`R4: ${kind} — неудачи считаются, одна строка в журнал, после 30 подряд пауза с причиной; выход не повторяется, оплат и переходов нет`, async () => {
  const f = fixture(read); await begin(f);
  for (let i = 1; i < 30; i++) {
    await tick(f);
    assert.equal(f.env.rt.rbHunt.exitReadFail, i); assert.equal(f.pauses.length, 0, `неудача ${i} — ещё не пауза`);
  }
  assert.equal(exitLogs(f).length, 1, 'в журнал — только первая неудача'); assert.ok(exitLogs(f)[0].includes(what), exitLogs(f)[0]);
  await tick(f);
  assert.equal(f.pauses.length, 1, '30-я неудача подряд — пауза (раньше — вечный шаг exit без паузы)');
  assert.match(f.pauses[0].s, /30 раз подряд .*не дал сверить героя/); assert.ok(f.pauses[0].s.includes(what)); assert.equal(f.pauses[0].o?.fault, true);
  assert.match(f.pauses[0].s, /цель Первый сохранена/);
  assert.equal(f.reads(), 30); assert.equal(f.fires.length, 1, 'неудачная сверка не повторяет выход'); assert.equal(f.loc.href, '');
  assert.equal(f.env.rt.rbHunt.step, 'exit'); assert.equal(f.env.rt.rbHunt.id, 'one'); assert.equal(f.env.rt.rbHunt.exitMiss || 0, 0);
});

test('R4: ответ «не в городе» между неудачами обнуляет счёт; подтверждённый город продолжает тур и чистит счётчик', async () => {
  let mode = 'fail', city = 'ashen_bastion';
  const f = fixture(() => { if (mode === 'fail') throw new Error('offline'); return reply({ name: 'TestHero', cityId: city, inBattle: false }); });
  await begin(f);
  for (let i = 0; i < 20; i++) await tick(f);
  assert.equal(f.env.rt.rbHunt.exitReadFail, 20);
  mode = 'ok'; await tick(f);
  assert.equal(f.env.rt.rbHunt.exitReadFail, 0, 'ответ про героя вне боя — счёт неудач с нуля'); assert.equal(f.env.rt.rbHunt.exitMiss, 1); assert.equal(f.fires.length, 2, 'повтор штатного выхода');
  mode = 'fail'; for (let i = 0; i < 29; i++) await tick(f);
  assert.equal(f.pauses.length, 0, 'после сброса 29 неудач — ещё не пауза'); assert.equal(f.env.rt.rbHunt.exitReadFail, 29);
  assert.equal(exitLogs(f).length, 2, 'новая серия неудач — снова одна строка');
  mode = 'ok'; city = 'l2dop_aden'; f.loc.pathname = '/city.html'; await tick(f);
  assert.equal(f.env.rt.rbHunt.step, 'go'); assert.equal(f.env.rt.rbHunt.id, 'one'); assert.equal(f.env.rt.rbHunt.exitReadFail, null); assert.equal(f.pauses.length, 0);
});

test('R4: Stop во время сверки — неудача не записывается и паузы нет', async () => {
  const f = fixture(() => { f.env.on = false; throw new Error('offline'); }); await begin(f);
  f.env.rt.rbHunt.exitReadFail = 29; await tick(f);
  assert.equal(f.pauses.length, 0); assert.equal(f.env.rt.rbHunt.exitReadFail, 29);
});
