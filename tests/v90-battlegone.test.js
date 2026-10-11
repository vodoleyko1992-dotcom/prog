'use strict';
// 9.0 (лог 12.10 01:08:28–01:31:22, бот 7.2.3): Fairy Queen Timiniel на 7 092 из 1 877 023 HP — её добили другие игроки, ход банкой →
// 400 {"error":"battle_none","reason":"not_in_battle","messageUk":"Немає активного бою."}, дальше игра ходов не шлёт, а страница боя стоит.
// Бот 23 мин жал «урон 0 · MP 0» (HP героя от регена менялось — сторож «нет ответа 20 с» молчал), пока игрок не увёл героя в город.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js'), combat = read('modules/combat.js');

(async () => {
  // 1. content.js: метка «боя нет» из ответа на ход, снимается принятым ходом / новым боем
  { const i0 = content.indexOf("  if (/^\\/game\\/battle\\/(?:action|start|hunt-continue)$/.test(path) && d.status >= 200"), i1 = content.indexOf('\n', content.indexOf('ACT_NET.gone = {', i0));
    assert.ok(i0 > 0 && i1 > i0, 'net handler block found');
    const block = content.slice(i0, i1);
    const ACT_NET = { start: 5, done: 5, t: 0 }, sb = { ACT_NET, Date };
    vm.runInNewContext(`this.on = (path, d) => {\n${block}\n};`, sb);
    sb.on('/game/battle/action', { status: 400, req: { action: 'battle_potion_use', battleSpawnId: 'l2dop_rb_25423' }, res: { error: 'battle_none', code: 'battle_skill_not_allowed', reason: 'not_in_battle', messageUk: 'Немає активного бою.' } });
    assert.equal(ACT_NET.gone?.spawn, 'l2dop_rb_25423', '400 not_in_battle → marked');
    sb.on('/game/battle/action', { status: 409, req: { action: 'l2_1220' }, res: { error: 'revision_conflict' } });
    assert.ok(ACT_NET.gone, 'other errors do not clear it');
    sb.on('/game/battle/start', { status: 200, res: { kind: 'full' } });
    assert.equal(ACT_NET.gone, null, 'a new fight clears it');
    sb.on('/game/battle/action', { status: 400, res: { error: 'battle_none' } }); assert.ok(ACT_NET.gone, 'error code alone is enough');
    sb.on('/game/battle/action', { status: 200, res: { kind: 'delta' } }); assert.equal(ACT_NET.gone, null, 'an accepted move clears it'); }

  // 2. combat: метка после начала боя → журнал, РБ не «недобитый», на карту; до начала боя / при победе — бой идёт
  { const i0 = combat.indexOf('    { const g = env.actNet?.().gone;'), i1 = combat.indexOf('    // 8.0.3 (лог 11.10 10:31:48', i0);
    assert.ok(i0 > 0 && i1 > i0, 'combat block found');
    assert.ok(i0 < combat.indexOf("if (me && me.pct <= Math.max(env.cfg.stopHp, 25)) {"), 'before any action of the loop');
    const block = combat.slice(i0, i1);
    const run = async ({ goneT, rb = true, win = false }) => {
      const NET = { start: 9, done: 9, gone: goneT == null ? null : { t: goneT, spawn: 'l2dop_rb_25423' } }, recs = [], patches = [];
      const env = { actNet: () => NET, rec: (...a) => recs.push(a.join(' ')), setRt: async p => patches.push(p), toMap: async () => 'map',
        rt: { rbWound: { l2dop_rb_25423: { cur: 7092, max: 1877023, t: 1 }, l2dop_rb_25050: { cur: 1, max: 2, t: 1 } } } };
      const sb = { env, ctx: { rb: rb ? { id: 'l2dop_rb_25423' } : null, name: 'Fairy Queen Timiniel' }, mob: { cur: 7092, max: 1877023 }, t0: 1000,
        victory: () => win, defeat: () => false, mobName: () => 'x', Math };
      vm.runInNewContext(`this.step = async () => { for (let i = 0; i < 1; i++) {\n${block}\n return 'through'; } };`, sb);
      return { r: await sb.step(), recs, patches, NET };
    };
    let x = await run({ goneT: 5000 });
    assert.equal(x.r, 'map', 'server said no battle → leave to the map');
    assert.match(x.recs[0], /Немає активного бою.*Fairy Queen Timiniel.*0\.4 %.*добили другие/);
    assert.equal(x.patches[0].rbCur, null); assert.equal(x.patches[0].target, null);
    assert.deepEqual(Object.keys(x.patches[0].rbWound), ['l2dop_rb_25050'], 'not a «wounded» RB to pay 100k to come back for');
    assert.equal(x.NET.gone, null, 'mark consumed');
    x = await run({ goneT: 500 }); assert.equal(x.r, 'through', 'mark from an earlier fight — ignored');
    x = await run({ goneT: null }); assert.equal(x.r, 'through', 'no mark — fight goes on');
    x = await run({ goneT: 5000, win: true }); assert.equal(x.r, 'through', 'victory screen — the usual result path');
    x = await run({ goneT: 5000, rb: false }); assert.equal(x.r, 'map'); assert.ok(!('rbCur' in x.patches[0]), 'ordinary mob — no RB keys'); }

  // 3. сторож «нет ответа 20 с»: признак жизни — ответ сервера на ход, а не HP героя (реген)
  assert.match(combat, /const sig = mob\.cur \+ '\|' \+ \(env\.actNet\?\.\(\)\.done \?\? me\?\.cur \?\? ''\) \+ '\|' \+ env\.logLines\(\)\.length/);
  console.log('PASS: v90-battlegone — 400 «Немає активного бою» ends the fight (RB finished by others), no blind clicking; 20 s watchdog ignores HP regen');
})().catch(e => { console.error('FAIL v90-battlegone', e); process.exit(1); });
