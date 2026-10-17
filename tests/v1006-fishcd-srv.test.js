'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 10.0.6 (разбор 13.10 по логам 12.10 12:20–18:12): откат одного и того же приёма рыбалки — по откатам сервера из ответа
// (fishing.cooldowns: pumpingUntil/reelingUntil при pumpingMs 500 / reelingMs 700), а не по своей модели 1,05 с. Отказ «action_cooldown»
// при откате по серверу растит запас (+50 мс), модель не раздувает; запас 400 и отказы идут — час по модели; cfg.fishSrvCd=false — как было
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const code = read('modules/fishing.js'), content = (read('defaults.js') + '\n' + read('content.js')), popup = (read('defaults.js') + '\n' + read('popup.js')), html = read('popup.html'), base = read('base-profile.json');

const clock = { t: 1800000000000 };
class FDate extends Date { static now() { return clock.t; } }
// как в v803-fishcd: рыба с HP, сеть — сводки hook.js по расписанию; часы сервера отстают на OFF; план нажатия {up, down, cd, rej, nocds}
function world(o = {}) {
  const W = { hp: 1e6, ev: [], recs: [], next: [], lastFireT: 0, fires: [], OFF: 7300 };
  const target = { textContent: 'White Fish', querySelector: s => /__name/.test(s) ? { textContent: 'White Fish' } : /__hp/.test(s) ? { textContent: `HP: ${W.hp} / 1000000` } : /__state/.test(s) ? { textContent: 'Рыба сопротивляется — используй Reeling!' } : null };
  const sb = { console, Date: FDate, Math, Number, JSON, Object, Array, Promise, setTimeout,
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { body: {}, hidden: false, querySelectorAll: () => [], querySelector: () => null } };
  sb.globalThis = sb;
  vm.runInNewContext(code, sb, { filename: 'modules/fishing.js' });
  const slots = { pumping: { kind: 'pumping', disabled: false }, reeling: { kind: 'reeling', disabled: false } };
  const deliver = () => { W.ev.sort((a, b) => a.at - b.at); while (W.ev.length && W.ev[0].at <= clock.t) W.ev.shift().fn(); };
  const net = nf => { env.NET_FISH = nf; W.F.fishNet(nf); };
  const env = {
    rt: { fishCdLen: 1.05, ...(o.rt || {}) }, cfg: { reactMin: 150, reactMax: 450, ...(o.cfg || {}) }, on: true, TAG: 't', fishObs: {}, fishMut: 0, fishCdMsg: 0,
    FCD: { pumping: 0, reeling: 0 }, NET_FISH: { t: 0 }, CD_RE: /перезаряд/i, GEAR_RE: /$^/,
    $q: s => { const m = s.match(/data-slot="(\w+)"/); if (m) return slots[m[1]] || null; return s === '#fishing-target' ? target : null; },
    shown: () => true, rec: (...a) => W.recs.push(a.join(' ')), setRt: async p => { Object.assign(env.rt, p); return { ok: true }; },
    sleep: async ms => { const end = clock.t + ms; while (clock.t < end) { clock.t = Math.min(end, clock.t + 5); deliver(); } },
    waitFor: async (fn, timeout = 10000, step = 250) => { const t0 = clock.t; while (clock.t - t0 < timeout) { deliver(); const r = fn(); if (r) return r; clock.t += step; } deliver(); return null; },
    fire: el => {
      if (!el) return; const p = W.next.shift(); if (!p) return;
      const t0 = W.lastFireT = clock.t, kind = el.kind; W.fires.push({ t0, kind });
      if (p.rej) { W.ev.push({ at: t0 + p.up + p.down, fn: () => { net({ t: clock.t, ok: false, act: kind, err: '', code: 'action_cooldown', srv: 0, ms: p.up + p.down }); env.fishCdMsg++; } }); return; }
      const srv = t0 + p.up - W.OFF;             // отметка сервера: клик дошёл через up
      const cds = p.nocds ? undefined : { pumpingUntil: kind === 'pumping' ? srv + (p.cd ?? 500) : 0, reelingUntil: kind === 'reeling' ? srv + (p.cd ?? 700) : 0, pumpingMs: 500, reelingMs: 700 };
      W.ev.push({ at: t0 + p.up + p.down + (p.netLate || 0), fn: () => net({ t: clock.t, ok: true, act: kind, err: '', code: '', srv, ms: p.up + p.down, cds }) });
      W.ev.push({ at: t0 + p.up + p.down, fn: () => { W.hp -= 10; } });   // экран обновился
    },
  };
  W.env = env; W.F = sb.L2V7Factories.fishing(env);
  W.press = async (kind, plan) => { while (W.F.fishCdLeft(kind) > 0) await env.sleep(5); W.next.push(plan); return W.F.fishAct(kind); };
  W.gaps = () => W.fires.slice(1).map((f, i) => f.t0 - W.fires[i].t0);
  return W;
}
const N = { up: 200, down: 40 };

(async () => {
  // ---------- 1. повтор Pumping — по откату сервера: 0,5 с от отметки сервера + запас 60 мс, а не 1,05 с ----------
  { const W = world();
    for (let i = 0; i < 12; i++) await W.press('pumping', N);
    const g = W.gaps().slice(1);                 // первое нажатие — без сводки
    assert.ok(g.every(x => x >= 600 && x <= 760), `повтор Pumping по серверу ≈0,62–0,76 с (было 1,05) · ${g.join(',')}`);
    // сервер видит повтор не раньше своего отката: клик + up ≥ отметка прошлого + 500
    for (let i = 2; i < W.fires.length; i++) assert.ok(W.fires[i].t0 + N.up - (W.fires[i - 1].t0 + N.up) >= 500, 'сервер видит повтор после своих 500 мс');
    assert.ok(W.recs.some(r => /откат приёмов — по серверу: Pumping 0.5 с, Reeling 0.7 с/.test(r)), 'в журнале — откаты сервера, раз');
    assert.equal(W.env.rt.fishCdStat.rej, 0, 'отказов нет');
  }
  // ---------- 2. Reeling — 0,7 с; смена приёма — сразу (у другого приёма откат 0) ----------
  { const W = world();
    await W.press('reeling', N); await W.press('reeling', N); await W.press('reeling', N);
    const g = W.gaps();
    assert.ok(g[1] >= 800 && g[1] <= 960, `повтор Reeling ≈0,82–0,96 с · ${g[1]}`);
    const t = clock.t; await W.press('pumping', N);
    assert.ok(W.lastFireT - t <= 10, 'другой приём — без ожидания');
  }
  // ---------- 3. отказ «на перезарядке» при откате по серверу: запас +50, своя модель не раздута; потом ждём откат сервера снова ----------
  { const W = world();
    for (let i = 0; i < 3; i++) await W.press('pumping', N);
    const cd0 = W.env.rt.fishCdLen;
    const L = await W.press('pumping', { up: 200, down: 40, rej: true });
    assert.equal(L.rej, true, 'отказ распознан');
    assert.equal(W.env.rt.fishSrvMargin, 110, 'запас 60 → 110 мс');
    assert.equal(W.env.rt.fishCdLen, cd0, 'модель 1,05 не тронута');
    assert.equal(W.env.rt.fishCdStat.srvRej, 1);
    assert.ok(W.recs.some(r => /отказ «на перезарядке» при откате по серверу/.test(r)), 'отказ в журнале');
    const tRej = W.lastFireT; await W.press('pumping', N);
    assert.ok(W.lastFireT - tRej >= 100, `после отказа не жмём мгновенно (${W.lastFireT - tRej} мс)`);
    // следующий чистый повтор — с новым запасом (≈ +50 мс к серии 1)
    await W.press('pumping', N); const g = W.gaps(); const last = g[g.length - 1];
    assert.ok(last >= 650 && last <= 810, `повтор с запасом 110 мс · ${last}`);
  }
  // ---------- 4. запас упёрся в 400 и отказы продолжаются (5-й) — час по своей модели, в журнале причина ----------
  { const W = world({ rt: { fishSrvMargin: 400 } });
    for (let i = 0; i < 2; i++) await W.press('pumping', N);
    for (let i = 0; i < 5; i++) { await W.press('pumping', { up: 200, down: 40, rej: true }); await W.press('pumping', N); }
    assert.ok(W.env.rt.fishSrvOff > 0, 'откат по серверу выключен');
    assert.equal(W.F.fishSrvOn(), false);
    assert.ok(W.recs.some(r => /час откат приёмов по своей модели/.test(r)), 'причина в журнале');
    await W.press('pumping', N); await W.press('pumping', N);
    const g = W.gaps(); assert.ok(g[g.length - 1] >= 1040, `по модели ≈1,05 с · ${g[g.length - 1]}`);
    clock.t += 3600001; assert.equal(W.F.fishSrvOn(), true, 'через час — снова по серверу');
  }
  // ---------- 5. cfg.fishSrvCd=false и ответ без cooldowns — как было, по модели ----------
  { const W = world({ cfg: { fishSrvCd: false } });
    for (let i = 0; i < 4; i++) await W.press('pumping', N);
    assert.ok(W.gaps().every(x => x >= 1040), `выключено — по модели · ${W.gaps().join(',')}`);
    assert.ok(!W.recs.some(r => /по серверу/.test(r)), 'без записи про сервер');
  }
  { const W = world();
    for (let i = 0; i < 4; i++) await W.press('pumping', { ...N, nocds: true });
    assert.ok(W.gaps().every(x => x >= 1040), `нет cooldowns в ответе — по модели · ${W.gaps().join(',')}`);
  }
  // ---------- 6. лаг: ответ шёл 8,6 с (лог 12.10 13:33:10) — сервер отметил клик поздно; откат по серверу считается от его отметки,
  // раннего повтора (через 0,13 с → отказ) нет ----------
  { const W = world();
    for (let i = 0; i < 3; i++) await W.press('reeling', N);
    await W.press('reeling', { up: 8300, down: 340 });
    const tResp = clock.t, left = W.F.fishCdLeft('reeling');
    assert.ok(left >= 700 && left <= 800, `после позднего ответа ждём ещё ≈0,76 с от прихода (${left})`);
    await W.press('reeling', N);
    assert.ok(W.lastFireT - tResp >= 700, 'повтор не раньше отката сервера от прихода ответа');
  }
  // ---------- 7. сводка сети опоздала к экрану — до неё ждём по модели, с ней — по серверу ----------
  { const W = world();
    await W.press('pumping', N);
    await W.press('pumping', { ...N, netLate: 900 });
    const t1 = W.lastFireT;
    await W.env.sleep(300);                      // экран обновился, сводки ещё нет
    assert.ok(W.F.fishCdLeft('pumping') >= 400, 'без сводки — по модели');
    await W.press('pumping', N);
    assert.ok(W.lastFireT - t1 >= 1040 && W.lastFireT - t1 <= 1300, `сводка опоздала на 0,9 с — нажали по модели/серверу, что раньше (${W.lastFireT - t1})`);
  }
  // ---------- 8. строка темпа, умолчания, меню ----------
  { const W = world();
    for (let i = 0; i < 3; i++) await W.press('pumping', N);
    W.env.rt.fishSess = { n: 10, t0: clock.t - 3600000 };
    assert.match(W.F.fishRateTxt(), /откат сервер 0\.5\/0\.7 с \+60 мс/);
    assert.match(content, /fishSrvCd: true/, 'DEF_CFG'); assert.match(popup, /fishSrvCd: true/, 'popup DEF'); assert.match(popup, /'fishSrvCd'/, 'BOOL');
    assert.match(html, /id="fishSrvCd" type="checkbox"/, 'меню'); assert.match(base, /"fishSrvCd":true/, 'базовый профиль');
  }
  console.log('v1006-fishcd-srv: PASS');
})().catch(e => { console.error('v1006-fishcd-srv: FAIL', e); process.exit(1); });
