'use strict';
// 8.0.3 (лог 11.10 09:59:55 и 10:00:06.8, Тимініель: клик аварийной банки потерян в окне занятости игры — act() вернул 'lock', а отметка
// «банку пили» (lastHpPot) уже стояла: повтор только через 1,1–1,3 с, за 2,3 с до смерти; призыв кота 10:00:45 — повтор через ≈2–4 с).
// Повтор «сразу» был только у вампирика и дебаффа. Теперь все ветки, где отметка ставится ДО нажатия, на 'lock' её откатывают
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const combat = fs.readFileSync(path.join(__dirname, '..', 'modules/combat.js'), 'utf8');

(async () => {
  // 1. аварийная банка: 'lock' → следующий цикл жмёт банку сразу (без 1,1 с), учёт банок РБ (potT) не растёт; дошла — как раньше
  const i0 = combat.indexOf('    if (me && me.pct <= Math.max(env.cfg.stopHp, 25)) {'), i1 = combat.indexOf('    ctx.emWait = 0;', i0);
  assert.ok(i0 > 0 && i1 > i0, 'emergency potion block');
  const block = combat.slice(i0, i1);
  const run = async results => {
    const calls = []; let now = 5_000_000;
    const sb = { env: { cfg: { stopHp: 25 }, hpPotPick: () => ({ title: 'Зілля' }), cleanTitle: s => s, qty: () => 10, hpPots: () => [1], rec: () => {} },
      ctx: { rb: { id: 'x' } }, me: { pct: 4, cur: 200, max: 6000 }, Date: { now: () => now }, Math,
      act: async (b, st) => { calls.push(now); return results[calls.length - 1]; } };
    vm.runInNewContext(`let lastHpPot = 0; this.step = async () => { for (let i = 0; i < 1; i++) {\n${block}\n} };`, sb);
    for (let k = 0; k < results.length; k++) { await sb.step(); now += 50; }
    return { calls, potT: sb.ctx.rb.potT || [] };
  };
  let r = await run(['lock', true]);
  assert.equal(r.calls.length, 2, 'lost potion click retried on the next loop (50 ms later), not after 1.1 s');
  assert.equal(r.potT.length, 1, 'only the potion that reached the game is counted');
  r = await run([true, true]);
  assert.equal(r.calls.length, 1, 'potion went through — next one not before 1.1 s (unchanged)');

  // 2. остальные ветки: обычная банка, лечение скиллом, банка MP, призыв/перепризыв кота, баффы (аварийный, кота, обычные), дебафф
  const checks = [
    [/const r = await act\(hpPot, [^\n]+\);\n\s+if \(r === 'lock'\) \{ lastHpPot = prevPot; ctx\.rb\?\.potT\?\.pop\(\); \}/, 'potion band'],
    [/if \(hs\) \{ ctx\.block\['heal:' \+ hs\.title\] = Date\.now\(\) \+ 2500; const r = await act\(hs, [^;]+\); if \(r === 'lock'\) ctx\.block\['heal:' \+ hs\.title\] = 0; continue; \}/, 'heal skill'],
    [/const prevMp = lastMpPot; lastMpPot = Date\.now\(\); if \(await act\(mpPot, [^\n]+?\) === 'lock'\) lastMpPot = prevMp; continue;/, 'MP potion'],
    [/else await env\.setRt\(\{ petSummonT: sr === 'lock' \? 0 : Date\.now\(\) - 13000 \}\);/, 'pet summon'],
    [/if \(pr === 'lock'\) \{ ctx\.block\['petheal'\] = 0; continue; \}/, 'pet heal / resummon'],
    [/if \(r === 'lock'\) ctx\.block\['buff:' \+ low\[0\]\] = 0;/, 'emergency buff'],
    [/if \(r === 'lock'\) ctx\.block\['petbuff:' \+ pb\.n\] = 0;/, 'pet buff'],
    [/else if \(r === 'lock'\) ctx\.block\['buff:' \+ bn\] = 0;/, 'buff'],
    [/if \(dr === 'lock'\) continue;/, 'debuff: no 0.5 s pause on a lost click'],
    [/if \(drainB\) \{ ctx\.seq\.push\('💉'\); const r = await act\(drainB, [^;]+\); if \(r !== 'lock'\) ctx\.block\['drain:' \+ drainB\.title\] = Date\.now\(\) \+ 1500; continue; \}/, 'vampiric (unchanged)'],
  ];
  for (const [re, what] of checks) assert.match(combat, re, what);
  // 'lock' по-прежнему отдаётся только для клика, потерянного сразу после освобождения игры
  assert.match(combat, /if \(lockLost\) return 'lock';/);
  console.log('PASS: 8.0.3 lost click in the game busy window (lock) — emergency/band potion, heal skill, MP potion, pet summon/heal, buffs, pet buffs, debuffs retried at once (pre-set block undone)');
})().catch(e => { console.error(e); process.exit(1); });
