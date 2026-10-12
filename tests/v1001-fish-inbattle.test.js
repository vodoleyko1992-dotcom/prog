'use strict';
// 10.0.1 (лог 12.10 14:04:32–16:46:16): у героя висел незакрытый бой, сервер на каждое нажатие рыбалки отвечал 400 «in_battle»
// («Під час бою рибалка недоступна»), а бот 2 ч 42 мин жал pumping раз в 15 с с записью «нет ответа 15 с (лаг сервера)».
// Теперь «in_battle» = сразу (не через 15 с) спросить /character и открыть страницу этого боя; уже не в бою — рыбачить дальше.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const code = read('modules/fishing.js'), content = read('content.js');

const clock = { t: 1800000000000 };
class FDate extends Date { static now() { return clock.t; } }
function world(charAns) {
  const W = { recs: [], gets: [], ev: [] };
  const loc = { href: '/fishing.html', reload() { W.reloaded = true; } };
  const target = { textContent: 'Fat Fish', querySelector: s => /__name/.test(s) ? { textContent: 'Fat Fish' } : /__hp/.test(s) ? { textContent: 'HP: 451 / 650' } : /__state/.test(s) ? { textContent: 'Рыба замерла — используй Pumping!' } : null };
  const sb = { console, Date: FDate, Math, Number, JSON, Object, Array, Promise, setTimeout, String, encodeURIComponent, location: loc,
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { body: {}, hidden: false, querySelectorAll: () => [], querySelector: () => null } };
  sb.globalThis = sb;
  vm.runInNewContext(code, sb, { filename: 'modules/fishing.js' });
  const slots = { pumping: { kind: 'pumping', disabled: false }, reeling: { kind: 'reeling', disabled: false } };
  const deliver = () => { W.ev.sort((a, b) => a.at - b.at); while (W.ev.length && W.ev[0].at <= clock.t) W.ev.shift().fn(); };
  const env = {
    rt: { fishCdLen: 1.21 }, cfg: {}, on: true, TAG: 't', fishObs: {}, fishMut: 0, fishCdMsg: 0,
    FCD: { pumping: 0, reeling: 0 }, NET_FISH: { t: 0 }, CD_RE: /перезаряд/i, GEAR_RE: /$^/,
    $q: s => { const m = s.match(/data-slot="(\w+)"/); if (m) return slots[m[1]] || null; return s === '#fishing-target' ? target : null; },
    shown: () => true, rec: (...a) => W.recs.push(a.join(' ')), setRt: async p => { Object.assign(env.rt, p); return { ok: true }; },
    setStatus() {}, rtCommit: async () => { W.committed = true; },
    gameGet: async p => { W.gets.push(p); return { ok: true, json: async () => ({ character: charAns }) }; },
    sleep: async ms => { const end = clock.t + ms; while (clock.t < end) { clock.t = Math.min(end, clock.t + 5); deliver(); } },
    waitFor: async (fn, timeout = 10000, step = 250) => { const t0 = clock.t; while (clock.t - t0 < timeout) { deliver(); const r = fn(); if (r) return r; clock.t += step; } deliver(); return null; },
    // ответ сервера на нажатие — 400 in_battle через 300 мс, экран не меняется
    fire: el => { if (!el) return; const kind = el.kind; W.ev.push({ at: clock.t + 300, fn: () => { env.NET_FISH = { t: clock.t, ok: false, act: kind, err: '', code: 'in_battle', srv: 0, ms: 300 }; } }); },
  };
  W.env = env; W.loc = loc; W.F = sb.L2V7Factories.fishing(env);
  return W;
}

(async () => {
  // 1. бой висит: через ≈0,3 с (а не 15 с) — /character, переход на страницу боя по battleSpawnId, без «лаг сервера»
  { const W = world({ inBattle: true, battleSpawnId: 'dense_4345' });
    const t0 = clock.t;
    const L = await W.F.fishAct('pumping');
    assert.equal(L.rej, false);
    assert.deepEqual(W.gets, ['/character'], 'спросил у сервера, какой бой открыт');
    assert.equal(W.loc.href, '/battle.html?spawnId=dense_4345', 'открыл страницу незакрытого боя');
    assert.ok(W.committed, 'память записана до перехода');
    assert.ok(!W.recs.some(r => /лаг сервера/.test(r)), 'не пишет «нет ответа 15 с (лаг сервера)»');
    assert.ok(W.recs.some(r => /незакрытый бой \(dense_4345\)/.test(r)), W.recs.join('\n'));
    assert.ok(clock.t - t0 < 7000, `не ждал 15 с (${clock.t - t0} мс)`);
    // повтор в течение 20 с — без нового запроса и перехода
    W.loc.href = '/fishing.html';
    await W.F.fishAct('pumping');
    assert.equal(W.gets.length, 1, 'не чаще раза в 20 с');
    assert.equal(W.loc.href, '/fishing.html');
  }
  clock.t += 60000;
  // 2. сервер уже не в бою — остаёмся на рыбалке
  { const W = world({ inBattle: false, battleSpawnId: null });
    await W.F.fishAct('reeling');
    assert.equal(W.loc.href, '/fishing.html', 'не в бою — никуда не уходим');
    assert.ok(W.recs.some(r => /уже не в бою/.test(r)));
  }
  clock.t += 60000;
  // 3. бой есть, spawnId неизвестен — на карту (оттуда бой продолжится или рыбалка вернётся)
  { const W = world({ inBattle: true });
    await W.F.fishAct('pumping');
    assert.equal(W.loc.href, '/map.html');
  }
  // 4. геттер gameGet у фабрики рыбалки
  assert.match(content, /L2V7Modules\.fishing = L2V7Factories\.fishing\(\{[^\n]*get gameGet\(\)\{return gameGet\}/);
  console.log('PASS v1001-fish-inbattle: «in_battle» на рыбалке → открыть незакрытый бой, а не жать 15 с вечно');
})().catch(e => { console.error(e); process.exit(1); });
