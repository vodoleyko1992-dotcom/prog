'use strict';
// 9.2 (лог 11.10 03:00): на TvT бот убил xdesx и 20 с жал на него же — список врагов на странице не перерисовывается,
// пока открыта панель боя. Павший враг больше не цель; при павшей цели — «← Вернуться на TvT», затем следующий враг.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const mk = (id, name, lvl, cls = '') => ({ dataset: { characterId: id }, textContent: name, title: 'Уровень ' + lvl, className: 'l2-tvt-nick l2-tvt-nick--team2 ' + cls, id: 'nick-' + name });
const roster = [mk('x1', 'xdesx', 11), mk('k1', 'Kraft', 29), mk('s1', 'Skye', 40)];     // список «как на экране»: xdesx ещё живой
const els = {
  '#tvt-target-name': { textContent: 'xdesx' }, '#tvt-target-hp': { textContent: '0 / 544' },
  '#tvt-battle-target-block': { shown: true }, '#tvt-back-roster-btn': { id: 'back', shown: true }, '#tvt-result-section': null, '#tvt-self-dead': null,
};
const document = { querySelectorAll: () => roster };
const sb = { console, Date, Map, String, document, location: { pathname: '/tvt-arena.html' } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'modules/tvt.js'), 'utf8'), sb);
const now = Date.now(), fired = [], logs = [];
const env = {
  cfg: { tvtOn: true, nPower: 'Blaze' }, rt: { tvtIn: 'e1' }, on: true, tabOwner: true,
  TVT: { eventId: 'e1', phase: 'ACTIVE', isRegistered: true, myTeam: 1, startsAt: now - 5000, endsAt: now + 600000, t: now },
  TVTC: { t: now, selectedTarget: { characterId: 'x1', name: 'xdesx', hp: 0, maxHp: 544, alive: false } },   // ответ удара: targetDead
  $q: s => els[s] || null, shown: e => !!e && e.shown !== false, rec: (...a) => logs.push(a.join(' ')), setStatus: () => {}, setRt: async () => {},
  sleep: async () => {}, rnd: () => 0, meHp: () => ({ pct: 100 }), names: s => String(s || '').split(',').map(x => x.trim()).filter(Boolean),
  slotsBy: () => [{ title: 'Blaze', id: 'blaze' }], ready: () => true, forceCosts: () => [], hudForce: () => 0, forceNow: () => 0, forceMax: () => 0,
  cleanTitle: t => t, autonomyMode: () => 'farm', hpPotPick: () => null,
  fire: e => { fired.push(e.id); if (fired.length >= 3) env.on = false; },
};
const T = sb.L2V7Factories.tvt(env);

// 1) без отметки xdesx на экране «живой» и самый слабый — раньше бот выбирал его снова и снова
assert.equal(T.tvtEnemies().sort((a, b) => a.lvl - b.lvl)[0].name, 'xdesx');
// 2) отказ сервера tvt_target_dead / ответ удара targetDead → враг выбывает из списка целей
T.tvtDeadNote('x1');
assert.equal(T.tvtEnemies().map(x => x.name).join(','), 'Kraft,Skye', 'павший xdesx больше не цель');

(async () => {
  await T.tvtFight();
  assert.equal(fired[0], 'back', 'цель пала — сначала «← Вернуться на TvT»: ' + fired.join(','));
  assert.equal(fired[1], 'nick-Kraft', 'затем следующий живой враг (Kraft), а не павший xdesx: ' + fired.join(','));
  assert.ok(!fired.includes('nick-xdesx'), 'по павшему xdesx больше не жмём');
  assert.ok(logs.some(l => /xdesx повержен/.test(l)), 'в журнале — «xdesx повержен — назад к списку врагов»');
  // 3) content.js передаёт павших из сети в модуль
  const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(src, /tvt_target_dead'\) L2V7Modules\.tvt\.tvtDeadNote\(d\.req\?\.targetCharacterId\)/);
  assert.match(src, /d\.res\?\.targetDead\) L2V7Modules\.tvt\.tvtDeadNote/);
  console.log('PASS: TvT — после убийства бот возвращается к списку врагов и бьёт следующего (лог 11.10 03:00)');
})().catch(e => { console.error(e); process.exit(1); });
