'use strict';
// 10.0.5 (игрок 13.10 01:10: «для эпиков лимит по времени не нужен»): «Не браться, если бой дольше, мин» у эпиков — 0 = без предела
// (по умолчанию); своё число игрока работает как прежде; разовая миграция epicTime1005 меняет только прежние заводские 30
const assert = require('node:assert/strict');
const { vm, read, content, mk } = require('./epic-harness.cjs');
(async () => {
  const long = { hp: 20000000, patk: 10, matk: 10, mdef: 800, pdef: 700, src: 'api' };   // бой ≈ часы, удары слабые — банки не мешают
  const verdict = lim => { const { env, E, setHero } = mk({ cfg: { epicMaxFightMin: lim }, rt: { epicDb: { orfen: { id: 'l2dop_rb_29014', canAttack: true, lvl: 50 } } } });
    setHero(55); env.rt.rbStats.l2dop_rb_29014 = { ...long }; return E.epicVerdict('orfen'); };
  const v30 = verdict(30); assert.equal(v30.v, 'slow', 'player limit 30 still works: ' + v30.why); assert.ok(v30.tKill > 1800);
  for (const lim of [0, undefined, '']) { const v = verdict(lim); assert.equal(v.v, 'ok', `limit ${JSON.stringify(lim)} → no time cap: ${v.v} ${v.why}`); }
  // умолчания: ядро, меню, подсказка, базовый профиль
  const defs = read('defaults.js');   // 20.13 (шаг 7): DEF_CFG живёт в defaults.js
  assert.ok(defs.slice(defs.indexOf('const DEF_CFG = {')).split('\n')[0].includes('epicMaxFightMin: 0,'));
  assert.match(read('popup.js'), /L2Defaults/); assert.match(defs, /epicMaxFightMin: 0,/);   // меню берёт умолчания из defaults.js
  assert.match(read('popup.html'), /мин \(0 — без предела\) <input id="epicMaxFightMin" type="number" min="0"/);
  assert.match(read('ui-v7.js'), /epicMaxFightMin:'[^']*0 — без предела/);
  assert.equal(JSON.parse(read('base-profile.json')).cfg.epicMaxFightMin, 0);
  // обычные РБ не тронуты: свой предел (rbMaxKillMin, с 18.10 — 30 мин) на месте
  assert.match(defs, /rbMaxKillMin: 30,/);
  // миграция: 30 → 0, своё число не трогаем
  const line = content.match(/once\('epicTime1005', (\(\) => \{[^\n]*?\})\);/)[1];
  for (const [was, want] of [[30, 0], [45, 45], [10, 10], [undefined, undefined]]) {
    const cf = {}; const C = k => (k === 'epicMaxFightMin' ? was : undefined);
    vm.runInNewContext('(' + line + ')()', { cf, C });
    assert.equal('epicMaxFightMin' in cf ? cf.epicMaxFightMin : was, want, `migrate ${was}`);
  }
  console.log('PASS v1005-epic-time: epic fight time cap off by default (0), player value kept, migration 30 → 0 only, RB 30 min cap untouched');
})().catch(e => { console.error(e); process.exit(1); });
