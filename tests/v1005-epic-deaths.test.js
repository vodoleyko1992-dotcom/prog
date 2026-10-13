'use strict';
// 10.0.5 (игрок 13.10 00:57: «3 смерти за заход на эпики расширяем до 5»): смертей на эпика за появление — 5 (было 3);
// разовая миграция epicDeaths1005 меняет только прежние заводские 3, своё число игрока не трогает
const assert = require('node:assert/strict');
const { vm, read, content, base, clone, mk } = require('./epic-harness.cjs');
(async () => {
  const okDb = (x = {}) => ({ orfen: { id: 'l2dop_rb_29014', col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50, respH: 12, persist: true, ...x } });
  const okStats = () => ({ ...clone(base.rbStats), l2dop_rb_29014: { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' } });
  const fight = d => ({ step: 'fight', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', died: true, deaths: d, kills0: 0, hpLog: [{ t: Date.now(), cur: 300000, max: 400000 }], startHp: 400000 });
  // умолчание (cfg без числа) — 5: после 3-й и 4-й смерти снова заход, 5-я — ждём следующего появления
  for (const d of [2, 3]) {
    const m = mk({ cfg: { epicMaxDeaths: undefined }, rt: { epicDb: okDb(), rbStats: okStats(), epic: fight(d) } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'prep', `death ${d + 1} of 5 → retry`); assert.equal(m.env.rt.epic.deaths, d + 1);
  }
  { const m = mk({ cfg: { epicMaxDeaths: undefined }, rt: { epicDb: okDb(), rbStats: okStats(), epic: fight(4) } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'pick', '5th death → give up until next spawn'); }
  // своё число игрока по-прежнему действует
  { const m = mk({ cfg: { epicMaxDeaths: 3 }, rt: { epicDb: okDb(), rbStats: okStats(), epic: fight(2) } });
    await m.E.epicStep(); assert.equal(m.env.rt.epic.step, 'pick', 'player limit 3 respected'); }
  // умолчания: ядро, меню, подсказка, базовый профиль
  assert.ok(content.slice(content.indexOf('const DEF_CFG = {')).split('\n')[0].includes('epicMaxDeaths: 5'));
  assert.match(read('popup.js'), /epicMaxDeaths: 5, epicCheck: false/);
  assert.match(read('popup.html'), /Смертей на одного эпика за его появление \(5\)/);
  assert.match(read('ui-v7.js'), /epicMaxDeaths:'[^']*по умолчанию 5/);
  assert.equal(JSON.parse(read('base-profile.json')).cfg.epicMaxDeaths, 5);
  // миграция: 3 → 5, другое число не трогаем
  const line = content.match(/once\('epicDeaths1005', (\(\) => \{[^\n]*?\})\);/)[1];
  for (const [was, want] of [[3, 5], [4, 4], [8, 8], [undefined, undefined]]) {
    const cf = {}; const C = k => (k === 'epicMaxDeaths' ? was : undefined);
    vm.runInNewContext('(' + line + ')()', { cf, C });
    assert.equal(cf.epicMaxDeaths === undefined ? was : cf.epicMaxDeaths, want, `migrate ${was}`);
  }
  assert.ok(content.indexOf("once('epicDeaths803'") < content.indexOf("once('epicDeaths1005'"), '10 → 3 runs before 3 → 5');
  console.log('PASS v1005-epic-deaths: 5 deaths per epic spawn by default, player value kept, migration 3 → 5 only');
})().catch(e => { console.error(e); process.exit(1); });
