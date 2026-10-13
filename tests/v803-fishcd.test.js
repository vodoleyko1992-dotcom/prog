'use strict';
// 8.0.3 (лог 11.10 10:44–11:45, рыбалка 455 рыб/ч при цели ≈560): откат рыбалки раздувался от лага сервера (1,21 → 1,69 → 1,80 с на ≈40 мин),
// оборванный игрой запрос ждал ещё 6 с до своих 15 с, фоновая вкладка не видна в журнале, сообщение о свитке «+4 → +10» вводило в заблуждение
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const code = read('modules/fishing.js'), content = read('content.js');

const clock = { t: 1800000000000 };
class FDate extends Date { static now() { return clock.t; } }
// страница рыбалки: рыба с HP (ответ на нажатие = HP сменилось), сеть — сводки hook.js по расписанию; часы сервера отстают на OFF
function world(o = {}) {
  const W = { hp: 1e6, ev: [], recs: [], hidden: false, OFF: 7300, next: [], lastFireT: 0, srv: o.srv !== false };
  const target = { textContent: 'White Fish', querySelector: s => /__name/.test(s) ? { textContent: 'White Fish' } : /__hp/.test(s) ? { textContent: `HP: ${W.hp} / 1000000` } : /__state/.test(s) ? { textContent: 'Рыба сопротивляется — используй Reeling!' } : null };
  const sb = { console, Date: FDate, Math, Number, JSON, Object, Array, Promise, setTimeout,
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { body: {}, get hidden() { return W.hidden; }, querySelectorAll: () => [], querySelector: () => null } };
  sb.globalThis = sb;
  vm.runInNewContext(code, sb, { filename: 'modules/fishing.js' });
  const slots = { pumping: { kind: 'pumping', disabled: false }, reeling: { kind: 'reeling', disabled: false } };
  const deliver = () => { W.ev.sort((a, b) => a.at - b.at); while (W.ev.length && W.ev[0].at <= clock.t) W.ev.shift().fn(); };
  const net = nf => { env.NET_FISH = nf; W.F.fishNet(nf); };
  W.net = net;
  const env = {
    rt: { fishCdLen: 1.21, ...(o.rt || {}) }, cfg: { reactMin: 150, reactMax: 450 }, on: true, TAG: 't', fishObs: {}, fishMut: 0, fishCdMsg: 0,
    FCD: { pumping: 0, reeling: 0 }, NET_FISH: { t: 0 }, CD_RE: /перезаряд/i, GEAR_RE: /$^/,
    $q: s => { const m = s.match(/data-slot="(\w+)"/); if (m) return slots[m[1]] || null; return s === '#fishing-target' ? target : null; },
    shown: () => true, rec: (...a) => W.recs.push(a.join(' ')), setRt: async p => { Object.assign(env.rt, p); return { ok: true }; },
    sleep: async ms => { const end = clock.t + ms; while (clock.t < end) { clock.t = Math.min(end, clock.t + 5); deliver(); } },
    waitFor: async (fn, timeout = 10000, step = 250) => { const t0 = clock.t; while (clock.t - t0 < timeout) { deliver(); const r = fn(); if (r) return r; clock.t += step; } deliver(); return null; },
    fire: el => {
      if (!el) return; const p = W.next.shift(); if (!p) return;
      const t0 = W.lastFireT = clock.t, kind = el.kind;
      if (p.abort) { W.ev.push({ at: t0 + p.abort, fn: () => net({ t: clock.t, ok: false, act: kind, err: 'signal is aborted without reason', code: '', srv: 0, ms: p.abort }) }); return; }
      if (p.rej) { W.ev.push({ at: t0 + p.up + p.down, fn: () => { net({ t: clock.t, ok: false, act: kind, err: '', code: 'action_cooldown', srv: 0, ms: p.up + p.down }); env.fishCdMsg++; } }); return; }
      const srv = W.srv ? t0 + p.up - W.OFF : 0, late = p.netLate || 0;
      W.ev.push({ at: t0 + p.up + p.down + late, fn: () => net({ t: clock.t, ok: true, act: kind, err: '', code: '', srv, ms: p.up + p.down + late, cds: p.cds }) });
      W.ev.push({ at: t0 + p.up + p.down, fn: () => { W.hp -= 10; } });   // экран обновился
    },
  };
  W.env = env; W.F = sb.L2V7Factories.fishing(env);
  W.tick = async ms => env.sleep(ms);
  // как цикл вываживания: ждём свой откат, жмём, ждём ответ
  W.press = async (kind, plan) => { while (W.F.fishCdLeft(kind) > 0) await env.sleep(5); W.next.push(plan); return W.F.fishAct(kind); };
  return W;
}
const NORMAL = { up: 200, down: 40 };

(async () => {
  // ---------- 1. лог 10:44:51.152: reeling ответил за 1445 мс (сервер отметил клик на ≈1,1 с позже обычного) → следующий клик через 0,13 с
  // получил «action_cooldown», а откат стал 1,69 с. Теперь отсчёт отката сдвинут на опоздание клика — раннего нажатия нет ----------
  { const W = world();
    for (let i = 0; i < 20; i++) await W.press('reeling', NORMAL);
    await W.press('reeling', { up: 1300, down: 145 });
    const tf = W.lastFireT, shift = W.env.FCD.reeling - tf;
    assert.ok(shift >= 980 && shift <= 1080, `отсчёт отката сдвинут на опоздание клика на сервер (1100 мс сверх обычного − 80 мс допуска), а не от клика (${shift})`);
    const left = W.F.fishCdLeft('reeling');
    assert.ok(left > 600, `сразу после медленного ответа — ещё ждать (было 0: жал через 0,13 с) · ${left}`);
    // по часам сервера следующий клик дойдёт не раньше чем через (откат − обычная доставка) после отметки прошлого
    const srvMark = tf + 1300, nextArrive = clock.t + left + NORMAL.up;
    assert.ok(nextArrive - srvMark >= W.F.fishCdLen() - 100, `сервер видит повтор через ${nextArrive - srvMark} мс (было ≈250)`);
    const cd0 = W.env.rt.fishCdLen;
    await W.press('reeling', NORMAL);
    assert.equal(W.env.rt.fishCdStat.rej, 0, 'отказа нет');
    assert.equal(W.env.rt.fishCdLen, cd0, 'откат не раздут');
  }
  // ---------- 2. сводка сети пришла ПОСЛЕ перерисовки экрана (fishAct уже засчитал нажатие) — fishNet сдвигает отсчёт сам ----------
  { const W = world();
    for (let i = 0; i < 20; i++) await W.press('reeling', NORMAL);
    await W.press('reeling', { up: 1300, down: 145, netLate: 30 });
    const tf = W.lastFireT;
    assert.equal(W.env.FCD.reeling, tf, 'до сводки сети — от клика');
    await W.tick(40);
    const shift = W.env.FCD.reeling - tf;
    assert.ok(shift >= 980 && shift <= 1150, `сводка сети сдвинула отсчёт (${shift})`);
    // повтор той же сводки (или ответ на старый клик) второй раз не сдвигает
    const f1 = W.env.FCD.reeling; W.net({ ...W.env.NET_FISH, t: clock.t }); assert.equal(W.env.FCD.reeling, f1, 'повтор не учитывается');
    W.net({ t: clock.t, ok: true, act: 'reeling', srv: clock.t - W.OFF - 40, ms: 9000 });   // ушёл за 9 с до клика — не наш
    assert.equal(W.env.FCD.reeling, f1, 'ответ на старый клик не трогает отсчёт');
  }
  // ---------- 2б. обычный разброс доставки (+60 мс) отсчёт не сдвигает — темп не теряем ----------
  { const W = world();
    for (let i = 0; i < 20; i++) await W.press('pumping', NORMAL);
    await W.press('pumping', { up: 260, down: 40 });
    assert.equal(W.env.FCD.pumping, W.lastFireT, 'разброс +60 мс — отсчёт от клика, как раньше');
  }
  // ---------- 3. отказ из-за лага (без времени сервера — запасной путь): прошлый ответ 1445 мс → откат НЕ раздувается, повтор через 150 мс ----------
  { const W = world({ srv: false });
    for (let i = 0; i < 5; i++) await W.press('reeling', NORMAL);
    await W.press('reeling', { up: 1300, down: 145 });
    const cd0 = W.env.rt.fishCdLen;
    const L = await W.press('reeling', { rej: true, up: 200, down: 75 });
    assert.equal(L.rej, true);
    assert.equal(W.env.rt.fishCdStat.rej, 1);
    assert.equal(W.env.rt.fishCdLen, cd0, `отказ после лага не учит откат (было «gap+60 мс» → 1,69 с) · ${W.env.rt.fishCdLen}`);
    const left = W.F.fishCdLeft('reeling');
    assert.ok(left > 100 && left <= 150, `повтор через ≈150 мс (${left})`);
    await W.press('reeling', NORMAL);
    assert.equal(W.env.rt.fishCdStat.rej, 1, 'повтор прошёл');
  }
  // ---------- 4. чистый отказ (жали ровно по своему откату, ответы быстрые) — +30 мс, потолок 1,5 с ----------
  { const W = world();
    for (let i = 0; i < 3; i++) await W.press('pumping', NORMAL);
    W.env.rt.fishCdLen = 1.49;
    await W.press('pumping', { rej: true, up: 200, down: 40 });
    assert.equal(W.env.rt.fishCdLen, 1.5, `+30 мс, но не выше 1,5 с (${W.env.rt.fishCdLen})`);
    await W.tick(200); await W.press('pumping', { rej: true, up: 200, down: 40 });
    assert.equal(W.env.rt.fishCdLen, 1.5, 'потолок 1,5 с');
    W.env.rt.fishCdLen = 1.8; assert.equal(W.F.fishCdLen(), 1500, 'старое раздутое 1,8 с читается как 1,5 с');
    W.env.rt.fishCdLen = 1.21; await W.tick(2000);
    const W2 = world(); for (let i = 0; i < 3; i++) await W2.press('pumping', NORMAL);
    await W2.press('pumping', { rej: true, up: 1100, down: 40 });   // сам отказ шёл > 1 с — лаг, не учим
    assert.equal(W2.env.rt.fishCdLen, 1.21, 'отказ, который сам шёл > 1 с, откат не трогает');
  }
  // ---------- 5. вниз — быстро: из 1,8 (читается 1,5) до 1,05 за ≤ 300 чистых нажатий (было −10 мс на 40: ≈1800 нажатий, ≈40 мин) ----------
  { const W = world({ rt: { fishCdLen: 1.8, fishCdStat: { ok: 0, rej: 0 } } });
    let n = 0;
    while (W.F.fishCdLen() > 1050 && n < 2000) { await W.press('pumping', NORMAL); n++; }
    assert.ok(n <= 300, `до 1,05 с за ${n} нажатий`);
    assert.equal(W.F.fishCdLen(), 1050);
    for (let i = 0; i < 30; i++) await W.press('pumping', NORMAL);
    assert.equal(W.F.fishCdLen(), 1050, 'ниже 1,05 с не идём');
    assert.equal(W.env.rt.fishCdStat.rej, 0);
  }
  // ---------- 6. лог 11:19:44.802: игра оборвала pumping через 8940 мс — повтор сразу, а не через 15 с ----------
  { const W = world();
    await W.press('pumping', NORMAL);
    const fcd = W.env.FCD.pumping, ok0 = W.env.rt.fishCdStat.ok;
    await W.tick(1500);
    W.next.push({ abort: 8940 }); const t0 = clock.t;
    const L = await W.F.fishAct('pumping');
    const dt = clock.t - t0;
    assert.ok(dt >= 8940 && dt < 8940 + 1500, `после обрыва — к повтору за ≤ 1,5 с (${dt} мс; было 15 000)`);
    assert.equal(L.tmo, true); assert.equal(L.rej, false);
    assert.equal(W.env.FCD.pumping, fcd, 'оборванный клик не засчитан в откат');
    assert.equal(W.env.rt.fishCdStat.ok, ok0, 'и не засчитан чистым');
    assert.ok(W.recs.some(r => /запрос оборвался/.test(r)), 'в журнале — обрыв');
    assert.ok(!W.recs.some(r => /нет ответа на pumping 15 с/.test(r)));
    assert.equal(W.F.fishCdLeft('pumping'), 0, 'можно жать сразу');
    // ошибка СТАРОГО запроса (ушёл раньше клика) — не наш обрыв: ждём свой ответ
    const W2 = world(); await W2.press('pumping', NORMAL); await W2.tick(1500);
    const t1 = clock.t; W2.next.push(NORMAL);
    W2.env.NET_FISH = { t: t1 + 1, ok: false, act: 'pumping', err: 'нет ответа', ms: 6000 };
    W2.ev.push({ at: t1 + 1, fn: () => {} });
    const L2 = await W2.F.fishAct('pumping');
    assert.notEqual(L2.tmo, true, 'чужой обрыв не прерывает ожидание своего ответа');
    assert.ok(!W2.recs.some(r => /оборвался/.test(r)));
  }
  // ---------- 7. fishing.cooldowns (структура неизвестна) — раз за сессию в журнал ----------
  { const W = world();
    await W.press('reeling', { ...NORMAL, cds: { reeling: { readyAtMs: 123 } } });
    await W.tick(1300); await W.press('reeling', { ...NORMAL, cds: { reeling: { readyAtMs: 456 } } });
    const ln = W.recs.filter(r => /fishing\.cooldowns/.test(r));
    assert.equal(ln.length, 1, 'одна строка за сессию'); assert.match(ln[0], /readyAtMs/);
  }
  // ---------- 8. фоновая вкладка — предупреждение в строке темпа ----------
  { const W = world({ rt: { fishSess: { n: 10, t0: clock.t - 600000 } } });
    assert.ok(!/вкладка в фоне/.test(W.F.fishRateTxt()));
    W.hidden = true; assert.match(W.F.fishRateTxt(), /⚠ вкладка в фоне — кнопки игры оживают раз в 1 с/);
  }
  // ---------- 9. content.js: сводка сети с обрывом/временем сервера, fishNet, миграция отката, журнал видимости, текст о свитке ----------
  { const m = content.match(/if \(\/\\\/game\\\/fishing\\\/action\$\/\.test\(path\)\) \{[\s\S]{0,700}?\n  \}/);
    assert.ok(m, 'блок NET_FISH найден');
    for (const k of ['err:', 'srv:', 'ms:', 'cds:', 'serverNowMs', 'L2V7Modules.fishing.fishNet(NET_FISH)']) assert.ok(m[0].includes(k), `NET_FISH: ${k}`);
    assert.match(content, /once\('fishCd803', \(\) => \{ if \(\+rt\.fishCdLen > 1\.22\) rf\.fishCdLen = 1\.22; \}\)/);
    assert.match(content, /addEventListener\('visibilitychange'[\s\S]{0,300}fishing\\\.html[\s\S]{0,200}рыбалка ушла в фон/);
    assert.ok(!content.includes('куплен один свиток за 100 Proof: +${lvl} → +${rodTo}'), 'старый текст «+4 → +10» убран');
    assert.ok(content.includes('куплен свиток заточки за 100 Proof (удочка сейчас +${lvl}, цель +${rodTo})'));
    assert.match(code, /fishCdLeft, fishSrvOn, fishSrvMargin, fishNet, fishAct/, 'fishNet в экспорте модуля');   // 10.0.6: + fishSrvOn/fishSrvMargin
  }
  console.log('PASS: 8.0.3 fishing cooldown — lag-shifted cooldown from serverNowMs (no early press after 1.4 s response), late net summary, lag refusals do not inflate (retry 150 ms), clean refusal +30 ms cap 1.5 s, fast decay to 1.05 s, aborted request retried at once, cooldowns logged once, background-tab warning, scroll message');
})().catch(e => { console.error(e); process.exit(1); });
