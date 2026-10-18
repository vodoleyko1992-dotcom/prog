'use strict';
// 18.10.2026 (игрок: «не покупает время рыбалки»; журнал 20:59–21:28): галка автодокупки была выключена, адены 1,09 млн при пакете 1 ч
// за 3 млн — пауза писала только «оплаченное время закончилось». Причина отказа теперь в строке паузы; у героя, который уже рыбачил,
// автодокупка включается один раз (новый герой и заводское значение — ВЫКЛ).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { world } = require('./v1014-fishing-controls.test.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
(async () => {
  // 1) выключенная автодокупка: не покупаем, причина названа
  { const W = world({ cfg: { fishTimeAuto: false } });
    assert.equal(await W.F.fishTimeTopUp(), false); assert.equal(W.clicks.length, 0);
    assert.match(W.F.fishTimeWhy(), /автопокупка времени выключена/); }
  // 2) аден меньше цены пакета + резерв (как в журнале: 1 092 136 при 1 ч = 3 млн): причина — нехватка аден
  { const W = world({ cfg: { fishTimePack: '1h' } }); W.adena = 1092136;
    assert.equal(await W.F.fishTimeTopUp(), false); assert.equal(W.clicks.length, 0);
    assert.match(W.F.fishTimeWhy(), /не хватает аден: 1092136, резерв 200000, пакет 1h 3000000/);
    // повтор в течение 5 мин — тоже с причиной, без покупки
    assert.equal(await W.F.fishTimeTopUp(), false); assert.match(W.F.fishTimeWhy(), /повтор не раньше/); }
  // 3) хватает аден — покупка, причины нет
  { const W = world({ cfg: { fishTimePack: '1h' } }); W.adena = 47092136;
    assert.equal(await W.F.fishTimeTopUp(), true); assert.equal(W.clicks[0].pack, '1h'); assert.equal(W.F.fishTimeWhy(), ''); }
  // 4) строка паузы рыбалки содержит причину
  { const src = read('modules/fishing.js');
    assert.equal((src.match(/оплаченное время закончилось' \+ fishTimeWhy\(\)/g) || []).length, 2, 'обе паузы с причиной'); }
  // 5) миграция: только герою с забросами
  const line = read('content.js').match(/once\('fishTimeAuto20261018', (\(\) => \{[^\n]*?\})\);/)[1];
  for (const [rt, want] of [[{ fish: { casts: 5000 } }, true], [{}, undefined], [{ fish: { casts: 0 } }, undefined]]) {
    const cf = {}; vm.runInNewContext('(' + line + ')()', { cf, rt }); assert.equal(cf.fishTimeAuto, want, JSON.stringify(rt));
  }
  assert.match(read('defaults.js'), /fishTimeAuto: false/, 'заводское значение прежнее');
  console.log('PASS v2015-fish-time-why: fishing time top-up reason in pause line, one-time enable for fishing hero');
})().catch(e => { console.error('FAIL v2015-fish-time-why', e); process.exit(1); });

// 18.10 (журнал 21:55:40, сборка 20.16): кнопка пакета перерисована игрой между поиском и кликом — жмём живую кнопку
(async () => {
  const W = world({ cfg: { fishTimePack: '1h' } }); W.adena = 47092136;
  const base = W.env.$q, made = [];
  W.env.$q = s => { const r = base(s); if (r && /data-fishing-time-package/.test(s)) made.push(r); return r; };
  const st = W.env.setStatus; W.env.setStatus = m => { if (/докупаю время/.test(m)) made.forEach(b => { b.isConnected = false; }); return st(m); };
  assert.equal(await W.F.fishTimeTopUp(), true, 'куплено живой кнопкой');
  assert.equal(W.clicks.length, 1); assert.notEqual(W.clicks[0].isConnected, false, 'клик не по выпавшей кнопке');
  // живая кнопка с другой ценой — старым намерением не жмём; одна повторная попытка перечитывает цену заново
  const V = world({ cfg: { fishTimePack: '1h' } }); V.adena = 47092136;
  const vb = V.env.$q; let n = 0;
  V.env.$q = s => { const r = vb(s); if (r && /data-fishing-time-package="1h"/.test(s) && ++n > 1) return { ...r, querySelector: () => ({ textContent: '9 000 000 Adena' }) }; return r; };
  await V.F.fishTimeTopUp(); assert.ok(V.clicks.length <= 1, 'не больше одного клика');
  assert.ok(V.logs.some(l => /изменилась до клика/.test(l)), V.logs.join('\n'));
  // ложная «изучите Fishing» после 502: сервер говорит, что всё изучено → другая причина паузы
  const src = read('modules/fishing.js');
  assert.match(src, /learnedCount >= st\.skillTotal\) why = 'Рыбалка: панель рыбалки не загрузилась \(навыки изучены/);
  console.log('PASS v2015-fish-time-why: live time-package button after native re-render, price change cancels');
})().catch(e => { console.error('FAIL v2015-fish-time-why (live button)', e); process.exit(1); });
