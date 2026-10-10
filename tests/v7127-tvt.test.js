'use strict';
// 7.1.30: после окончания TvT (FINISHED) бот не должен бегать рыбалка ↔ арена (лог 10.10 15:00–15:03)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sb = { console, Date, location: { pathname: '/fishing.html' } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'modules/tvt.js'), 'utf8'), sb);
const now = Date.now();
const env = { cfg: { tvtOn: true }, rt: {}, TVT: null };
const T = sb.L2V7Factories.tvt(env);
const base = { eventId: 'tvt-x', isRegistered: true, myTeam: 2, startsAt: now - 13000, endsAt: now + 600000, serverNow: now, t: now };
env.TVT = { ...base, phase: 'ACTIVE' }; assert.equal(T.tvtSoon(), true, 'active fight → arena');
env.TVT = { ...base, phase: 'FINISHED' }; assert.equal(T.tvtSoon(), false, 'finished fight → not arena, even within 11 min of start');
env.TVT = { ...base, phase: 'PREPARATION', startsAt: now + 30000 }; assert.equal(T.tvtSoon(), true, 'preparation, start in 30 s → arena');
env.rt.tvtDone = 'tvt-x'; env.TVT = { ...base, phase: '' }; assert.equal(T.tvtSoon(), false, 'already played this event');
console.log('PASS: TvT — finished/played event no longer pulls the bot back to the arena');
