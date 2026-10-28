'use strict';
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');
const s=fs.readFileSync(path.join(root,'content.js'),'utf8');
assert.match(s,/running = true;\s*try \{[\s\S]*?\} finally \{ running = false; \}/);
// 20.71: возврат на передышку сохраняет отдельный маршрут Rebirth и прежнюю карту для ordinary.
// 20.43 (автономность): после 3 восстановлений — передышка 20–30 мин; жёсткий стоп (hard) — при 4-й серии за 6 ч, цикл тогда выходит
assert.match(s,/const r = await selfHoldStart\('stall', `Автономный режим не продвигается после 3 восстановлений за 30 мин[^`]*`, \{ hard: true, page: rebirthModeSelected\(\) \? '\/rebirth-raids\.html' : '\/map\.html' \}\);\s+return r === 'stop' \? LOOP_BREAK : true;/);
assert.match(s,/return halt\(reason, true\)/);
assert.match(s,/engineRecoveryEpoch: '7\.1\.13'/);
console.log('PASS: dispatcher releases running on all exits; hard halt; old fault history reset');
