'use strict';
// 10.0.10 (лог 13.10 19:39–20:57, alt1 18–19 ур., Neutral Zone): обычная атака 1 урона 112 из 112 ударов — кончился «Бонус новичка»,
// герой с NG-оружием не пробивает мобов 15–20. Бот пометил все 6 видов окна «не по зубам» и 72 мин молча перезагружал карту каждые 15 с
// (242 раза). Теперь: пауза растёт 15 с → 60 с → 3 мин, причина простоя и подсказка про урон/оружие — в журнале.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
(async () => {
  // 1. combat.lowDmgNote — вырезаем функцию из исходника и гоняем со stub-env
  const combat = read('modules/combat.js');
  const m = combat.match(/async function lowDmgNote\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, 'lowDmgNote есть в combat.js');
  assert.ok(/await lowDmgNote\(\);/.test(combat.split('не пробиваю — \${why}')[1] || ''), 'зовётся после «не пробиваю»');
  assert.ok(/await lowDmgNote\(\);/.test(combat.split('слишком долго, 2 часа не выбираю')[1] || ''), 'зовётся после «слишком долго»');
  const recs = [];
  const env = { rt: { skills: { 'атака': { dmg: 112, dmgN: 112 } } }, rec: (l, tag, s) => recs.push(s), setRt: async p => Object.assign(env.rt, p) };
  const ctx = { env, Date, Math, console }; vm.runInNewContext(m[0] + 'this.lowDmgNote = lowDmgNote;', ctx);
  await ctx.lowDmgNote();
  assert.equal(recs.length, 1, 'при ≈1 урона — предупреждение');
  assert.ok(/атака ≈1 урона/.test(recs[0]) && /Бонус новичка/.test(recs[0]) && /D-grade/.test(recs[0]) && /сам не покупает/.test(recs[0]), recs[0]);
  await ctx.lowDmgNote(); assert.equal(recs.length, 1, 'повтор не раньше чем через час');
  env.rt.lowDmgNoteT -= 3600001; await ctx.lowDmgNote(); assert.equal(recs.length, 2, 'через час — снова');
  env.rt.skills['атака'] = { dmg: 40, dmgN: 3 }; env.rt.lowDmgNoteT = 0; await ctx.lowDmgNote(); assert.equal(recs.length, 2, 'меньше 5 ударов — молчим');
  env.rt.skills['атака'] = { dmg: 900, dmgN: 20 }; await ctx.lowDmgNote(); assert.equal(recs.length, 2, 'нормальный урон — молчим');

  // 2. mobfarm: простой без целей — растущая пауза и причина в журнале
  const mf = read('modules/mobfarm.js');
  assert.ok(/let farRecT = 0, lowRecT = 0, idleT0 = 0, idleRecT = 0, idleN = 0;/.test(mf), 'счётчики простоя объявлены');
  const blk = mf.match(/if \(!cands\.length\) \{[\s\S]*?\n  \}\n/);
  assert.ok(blk && mf.indexOf('idleT0 = 0; idleN = 0;') > mf.indexOf(blk[0]), 'цели нашлись — счётчик простоя сброшен (вместе с idleT0 из PR #89)');
  const b = blk[0];
  assert.ok(/idleN\+\+/.test(b) && /idleN <= 3 \? 15 : idleN <= 8 \? 60 : 180/.test(b), 'пауза 15 → 60 → 180 с');
  assert.ok(/Date\.now\(\) - idleRecT > 600000/.test(b), 'запись раз в 10 мин');
  assert.ok(/«не по зубам» \(2 ч\)/.test(b) && /Бонус новичка/.test(b) && /проверяю карту раз в \$\{wait\} с/.test(b), 'причина и подсказка в журнале');
  assert.ok(/обновлю карту через \$\{wait\} с/.test(b) && /i < wait && env\.on/.test(b), 'ждём именно wait секунд');
  assert.ok(!/через 15 с'/.test(b), 'жёстких 15 с больше нет');
  console.log('v1010-lowdmg-idle: PASS');
})().catch(e => { console.error(e); process.exit(1); });
