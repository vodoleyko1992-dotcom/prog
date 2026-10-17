'use strict';
// 20.13 (ревизия 17.10, шаг 5, участок defaults): скрытые настройки в DEF_CFG и DEF меню (D11), банка MP воина от доли MP (D16).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const objAt = (src, mark) => {
  const i0 = src.indexOf(mark); assert.ok(i0 >= 0, mark); let i = src.indexOf('{', i0), d = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return vm.runInNewContext('(' + src.slice(i, j + 1) + ')', { DAILY_FISH_DEF: 1, DAILY_KILL_DEF: 1, DAILY_RANGES_DEF: () => ({}) });
};
const content = read('defaults.js') + '\n' + read('content.js'), popup = read('popup.js');
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): DEF_CFG движка и DEF меню — одна таблица defaults.js.
assert.match(content, /const DEF_CFG = L2Defaults\.CFG;/); assert.match(popup, /const DEF = L2Defaults\.CFG;/);
const DEF_CFG = objAt(content, 'const DEF_CFG = {'), DEF = require(path.join(root, 'defaults.js')).CFG;

test('D11: скрытые настройки есть в DEF_CFG и DEF меню с прежними запасными значениями', () => {
  const want = { rbHuntMode: false, mageMpPct: 25, mageEcoPct: 30, rbVampHp: 60, rbDeathPenalty: 0, magisterSpReserve: 0, fishRodBuy: true, fishAutoSetup: true, rbOrder: 'up', mageProbe: true, fighterMpPct: 25 };
  for (const [k, v] of Object.entries(want)) {
    assert.equal(DEF_CFG[k], v, 'DEF_CFG.' + k); assert.equal(DEF[k], v, 'popup DEF.' + k);
  }
  // значения совпадают с запасными по месту — поведение не меняется
  const combat = read('modules/combat.js'), raid = read('modules/raid.js'), fishing = read('modules/fishing.js');
  assert.match(combat, /cfg\.mageMpPct \?\? 25\b/); assert.match(combat, /cfg\.mageEcoPct \?\? 30\b/); assert.match(combat, /cfg\.rbVampHp \?\? 60\b/);
  assert.match(combat, /cfg\.mageProbe !== false/); assert.match(raid, /cfg\.rbDeathPenalty \|\| 0/); assert.match(raid, /cfg\.rbOrder === 'down'/);
  assert.match(fishing, /cfg\.fishRodBuy !== false/); assert.match(fishing, /cfg\.fishAutoSetup === false/); assert.match(content, /cfg\.magisterSpReserve \|\| 0/);
});

test('D16: воин пьёт банку MP ниже 25 % MP, а не только у 70 MP; маг с котом — по mageMpPct', () => {
  const src = read('modules/combat.js'), line = src.match(/ {4}const mpReserveHit = [^\n]+\n {4}const fighterMp = [^\n]+\n/)[0];
  const need = (cfg, mage, mp, rb = null, qty = 50) => vm.runInNewContext(line + `const mageMp = mageCombat() && mp?.max ? Math.round(mp.max * (env.cfg.mageMpPct ?? 25) / 100) : 0;
    Math.max(env.cfg.mpPotAt, mageMp, fighterMp)`, { env: { cfg: { mpPotAt: 70, rbPotReserve: 10, ...cfg }, qty: () => qty }, mageCombat: () => mage, mp, ctx: { rb }, mpPot: {} });
  assert.equal(need({ fighterMpPct: 25 }, false, { cur: 300, max: 1500 }), 375);   // Warlord MP 1500: банка при MP < 375
  assert.equal(need({}, false, { cur: 300, max: 1500 }), 375);                     // без сохранённого ключа — то же умолчание
  assert.equal(need({ fighterMpPct: 0 }, false, { cur: 300, max: 1500 }), 70);     // 0 — прежнее правило 70 MP
  assert.equal(need({ fighterMpPct: 25 }, true, { cur: 300, max: 1000 }), 250);    // маг с котом: mageMpPct, доля воина не добавляется
  assert.equal(need({ fighterMpPct: 25 }, false, null), 70);
  // шаг 5 (ревью): на РБ доля воина не трогает резерв банок MP (rbPotReserve), при allIn — трогает; вне РБ резерв не мешает
  assert.equal(need({}, false, { cur: 300, max: 1500 }, {}, 10), 70);
  assert.equal(need({}, false, { cur: 300, max: 1500 }, {}, 11), 375);
  assert.equal(need({}, false, { cur: 300, max: 1500 }, { allIn: true }, 10), 375);
  assert.equal(need({}, false, { cur: 300, max: 1500 }, null, 5), 375);
  assert.match(src, /const mpNeed = Math\.max\(env\.cfg\.mpPotAt, rbMpAt, mageMp, fighterMp,/);
});
