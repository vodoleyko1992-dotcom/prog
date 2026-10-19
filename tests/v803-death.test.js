'use strict';
// 8.0.3 (логи 11.10 09:39–10:37 и 10:43–11:45): смерть и всё вокруг неё —
//  · 10:31:48–10:32:18 (Барда 55): ход висел 28,6 с, бот жал вслепую 20 с, смерть записана «не по силам» до 57 ур., РБ на 71 % брошен;
//  · 10:00:09 Noblesse ушёл со смертью и не докупался (условие ждало бафф ≥ 5 FA, а у игрока все по 1 FA) → 10:32:18 слетели все 9 баффов;
//  · 11:42:31 / 11:44:43 две смерти за 2 мин — «1/3» (▶ Старт стирал счётчик); 11:44:56 после смерти бот повёл героя на страницу боя
//    с Орфеном (battle/start → 400), хотя игрок уже нажал «Вернуться в город»; «≈6:60» / «≈-1:-1» в прогнозах
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const quiet = { log() {}, info() {}, warn: console.warn, error: console.error };
const mkSS = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const content = read('content.js'), combat = read('modules/combat.js');

(async () => {
  // 1. fmtT: «6:60» → «7:00», отрицательное → «0:00»
  { const src = content.match(/const fmtT = sec => \{[^\n]+\};/)[0]; const sb = { Math, String, isFinite }; vm.runInNewContext(src + '\nthis.fmtT = fmtT;', sb);
    assert.deepEqual([419.6, 59.5, 61, 0, -5, -61, Infinity, NaN].map(sb.fmtT), ['7:00', '1:00', '1:01', '0:00', '0:00', '0:00', '∞', '∞']); }

  // 2. survival.onDeath: зависание сервера ≤ 60 с до смерти — без вердикта «не по силам»; история смертей переживает «▶ Старт»
  const mkSurv = (rt, ss, extra = {}) => {
    const notes = [], recs = [], halts = [];
    const env = { cfg: { autoRevive: false, ...(extra.cfg || {}) }, rt: { rbDb: { l2dop_rb_25434: { name: 'Барда', lvl: 55, verdict: 'ok' } }, ...rt },
      epicOn: () => false, epicById: () => null, mobHp: () => ({ cur: 504275, max: 704170 }), mobName: () => 'Барда', epicDbSet: async () => {},
      rbNote: async (id, p) => notes.push([id, p]), setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), halt: why => { halts.push(why); },
      setStatus: () => {}, sleep: async () => {}, rnd: a => a, waitFor: async fn => fn(), $q: () => null, shown: () => false, byText: () => null, fire: () => true, isCity: () => false, ...extra };
    const sb = { console: quiet, Date, Math, JSON, URLSearchParams, sessionStorage: ss, location: { pathname: '/battle.html', search: '?spawnId=l2dop_rb_25434', href: '' } };
    sb.globalThis = sb; vm.runInNewContext(read('modules/survival.js'), sb);
    return { env, notes, recs, halts, S: sb.L2V7Factories.survival(env), sb };
  };
  { const ss = mkSS(); ss.setItem('l2bot.srvHang', JSON.stringify({ t: Date.now() - 1200, why: 'ответ на ход 29 с' }));
    const t = mkSurv({}, ss);
    await t.S.onDeath();
    assert.equal(t.notes.length, 1); assert.equal('verdict' in t.notes[0][1], false, 'no «не по силам» after a server hang');
    assert.match(t.notes[0][1].note, /зависании сервера \(ответ на ход 29 с\)/);
    assert.match(t.recs.join('\n'), /пока сервер не отвечал .* недобитого РБ добью позже/); }
  { const ss = mkSS(); ss.setItem('l2bot.srvHang', JSON.stringify({ t: Date.now() - 120000, why: 'старое' }));
    const t = mkSurv({}, ss);
    await t.S.onDeath();
    assert.equal(t.notes[0][1].verdict, 'no', 'old hang (2 min) — normal death verdict'); }
  { const now = Date.now(), t = mkSurv({ deaths: [], deathLog: [now - 130000] }, mkSS());   // «▶ Старт» стёр deaths, история за час осталась
    await t.S.onDeath();
    assert.equal(t.env.rt.deaths.length, 2, 'two deaths in 2 min — «2/3», not «1/3»'); assert.equal(t.env.rt.deathLog.length, 2);
    assert.match(t.recs.join('\n'), /смертей за 30 мин: 2/); }
  { const now = Date.now(), t = mkSurv({ deaths: [], deathLog: [now - 600000, now - 130000, now - 40 * 60000, now - 2 * 3600000] }, mkSS(), { cfg: { autoRevive: true } });
    await t.S.onDeath();
    assert.equal(t.env.rt.deathLog.length, 4, 'history keeps one hour'); assert.match(t.halts[0] || '', /3 смерти за 30 минут/, 'third death in 30 min stops the bot even after ▶ Start'); }
  { const t = mkSurv({ deaths1h: [] }, mkSS(), { cfg: { autoRevive: true } });
    await t.S.onDeath();
    assert.equal(t.env.rt.deaths1h.length, 1, 'boss death counts for «2 deaths an hour — no Coin of Luck» even outside epic mode'); }

  // 3. reviveStep: «Вернуться в город» уже нажато (ответ сети) — воскрешён; смерть от босса — экран поражения через карту, а не страница боя
  const mkRev = (R, page, ss = mkSS()) => {
    const recs = [], st = { href: '' };
    const env = { rt: { revive: R, lastBattle: R.url }, setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), $q: () => null, shown: () => false,
      setStatus: () => {}, sleep: async () => {}, pause: async () => {}, fire: () => true, waitFor: async fn => fn(), isCity: () => page === 'city', isBattle: () => page === 'battle', isMap: () => page === 'map' };
    const loc = { pathname: page === 'battle' ? '/battle.html' : '/' + page + '.html', search: '', get href() { return st.href; }, set href(v) { st.href = v; } };
    const sb = { console: quiet, Date, Math, JSON, URLSearchParams, sessionStorage: ss, location: loc, document: { querySelectorAll: () => [] } };
    sb.globalThis = sb; vm.runInNewContext(read('modules/survival.js'), sb);
    return { env, recs, st, S: sb.L2V7Factories.survival(env) };
  };
  const bossUrl = '/battle.html?spawnId=l2dop_rb_29014';
  { const ss = mkSS(); ss.setItem('l2bot.toTown', String(Date.now() - 1000));
    const t = mkRev({ t: Date.now() - 12000, url: bossUrl, revived: false }, 'city', ss);
    await t.S.reviveStep();
    assert.match(t.recs.join('\n'), /«Вернуться в город» уже нажато/); assert.notEqual(t.st.href, bossUrl, 'not back to the killer');
    assert.equal(t.st.href, '/town-buffer.html', 'straight to the statue/buffer'); assert.equal(t.env.rt.tbuff?.step, 'restore'); }
  { const t = mkRev({ t: Date.now() - 12000, url: bossUrl, revived: false }, 'city');
    await t.S.reviveStep();
    assert.equal(t.st.href, '/map.html', 'boss death: defeat screen via the map (map has «Вернуться в город» too)'); assert.equal(t.env.rt.revive.hops, 1); }
  { const t = mkRev({ t: Date.now() - 12000, url: bossUrl, revived: false, hops: 1 }, 'map');
    await t.S.reviveStep();
    assert.equal(t.env.rt.revive.revived, true, 'no defeat screen on the map after the hop — conscious'); assert.equal(t.st.href, ''); }
  { const t = mkRev({ t: Date.now() - 12000, url: '/battle.html?spawnId=dense_6693', revived: false }, 'city');
    await t.S.reviveStep();
    assert.equal(t.st.href, '/battle.html?spawnId=dense_6693', 'ordinary mob — old way (its battle page)'); }
  { const ss = mkSS(); ss.setItem('l2bot.toTown', String(Date.now() - 60000));   // нажато ДО этой смерти — не в счёт
    const t = mkRev({ t: Date.now() - 12000, url: bossUrl, revived: false }, 'city', ss);
    await t.S.reviveStep();
    assert.equal(t.st.href, '/map.html'); assert.doesNotMatch(t.recs.join('\n'), /уже нажато/); }
  { const ss = mkSS(); ss.setItem('l2bot.toTown', String(Date.now() - 9000));    // игрок нажал, пока бот ждал кнопку (после смерти, до записи revive)
    const t = mkRev({ t: Date.now() - 4000, url: bossUrl, revived: false }, 'city', ss); t.env.rt.deathLog = [Date.now() - 12000];
    await t.S.reviveStep();
    assert.match(t.recs.join('\n'), /уже нажато/, 'counted from the death time'); }
  // content.js: отметки из сети (и при остановленном боте)
  assert.match(content, /if \(path === '\/game\/battle\/action' && \+d\.ms > 8000\) srvHangMark\(`ответ на ход \$\{Math\.round\(d\.ms \/ 1000\)\} с`\);/);
  assert.match(content, /if \(path === '\/game\/battle\/return-to-town' && d\.status >= 200 && d\.status < 300\) try \{ sessionStorage\.setItem\('l2bot\.toTown', String\(Date\.now\(\)\)\); \}/);
  assert.match(content, /const srvHangMark = \(why, kind = 'network'\) => \{ try \{ sessionStorage\.setItem\('l2bot\.srvHang', JSON\.stringify\(\{ t: Date\.now\(\), why:/);
  assert.match(content, /get srvUp\(\) \{ return srvUp; \}, get srvHangMark\(\) \{ return srvHangMark; \}/);

  // 4. бой: ход без ответа > 8 с — не жмём, отметка, проверка сервера; отвечает — перезагрузка; не отвечает — ждём, ≥ 20 с — перезагрузка
  { const i0 = combat.indexOf('    { const an = env.actNet?.(), hangMs'), i1 = combat.indexOf('    if (ctx.pet) petTick(ctx);', i0);
    assert.ok(i0 > 0 && i1 > i0, 'hang block found');
    assert.ok(i0 < combat.indexOf("if (me && me.pct <= Math.max(env.cfg.stopHp, 25)) {"), 'before any action of the loop');
    const block = combat.slice(i0, i1);
    const run = async ({ hangMs, up, start = 7, done = 6, slots = 3, answerDuring = false }) => {
      let now = 1_000_000; const NET = { start, done, t: now - hangMs }, recs = [], marks = [], reloads = [];
      const env = { actNet: () => NET, srvHangMark: w => marks.push(w), setStatus: () => {}, rec: (...a) => recs.push(a.join(' ')), on: true, tabOwner: true,
        srvUp: async () => { if (answerDuring) NET.done = NET.start; return up; }, sleep: async ms => { now += ms; } };
      let n = 0; const reloadSlot = () => n++ < slots;
      const sb = { env, ctx: { rb: { id: 'l2dop_rb_25434' }, name: 'Барда' }, mob: { cur: 504275, max: 704170 }, reloadSlot, location: { reload: () => reloads.push(1) }, Date: { now: () => now }, Math };
      vm.runInNewContext(`this.step = async () => { for (let i = 0; i < 1; i++) {\n${block}\n return 'through'; } return 'wait'; };`, sb);
      const r = await sb.step();
      return { r: r ?? 'return', recs, marks, reloads };
    };
    let x = await run({ hangMs: 3000, up: true }); assert.equal(x.r, 'through', 'normal 3 s answer — fight goes on'); assert.equal(x.marks.length, 0);
    x = await run({ hangMs: 9000, up: false }); assert.equal(x.r, 'wait', 'server silent — do not press'); assert.equal(x.reloads.length, 0);
    assert.match(x.marks[0], /ход без ответа 9 с/); assert.match(x.recs.join('\n'), /не жму вслепую, проверяю сервер[\s\S]*сервер игры не отвечает/);
    x = await run({ hangMs: 9000, up: true }); assert.equal(x.r, 'return'); assert.equal(x.reloads.length, 1, 'server answers — only this request hung: reload');
    x = await run({ hangMs: 9000, up: true, answerDuring: true }); assert.equal(x.r, 'wait'); assert.equal(x.reloads.length, 0, 'answer came while probing — no reload');
    x = await run({ hangMs: 21000, up: false }); assert.equal(x.reloads.length, 1, '≥ 20 s without answer — reload');
    x = await run({ hangMs: 21000, up: false, slots: 0 }); assert.equal(x.r, 'wait'); assert.equal(x.reloads.length, 0, 'reload budget spent — keep waiting');
    x = await run({ hangMs: 70000, up: false }); assert.equal(x.r, 'through', 'after 60 s — old behaviour (no permanent lock)');
    x = await run({ hangMs: 9000, up: false, start: 6, done: 6 }); assert.equal(x.r, 'through', 'nothing in flight'); }
  assert.match(combat, /env\.srvHangMark\?\.\(waiting \? 'нет ответа игры 20 с'/, '19.10: only an unanswered request is a network hang');

  // 5. Noblesse при платных баффах по 1 FA (лог 09:05: 9 баффов + Noblesse 5 FA) — после смерти докупается; без платных — нет
  { const base = require('./helpers/warlock52-rt.cjs')(); // 20.12: замеры Warlock 52 — из фикстуры
    const now = Date.now(), E3 = now + 125 * 60000, T24 = now + 20 * 3600000;
    const TOWN = [1036, 1040, 1045, 1048, 1059, 1062, 1068, 1077, 1085, 1086, 1240, 1242, 1268], FA9 = [1389, 264, 273, 276, 1303, 365, 268, 304, 4703];
    let hud = [], path_ = '/map.html';
    const box = { querySelectorAll: () => hud.map(([id, exp]) => ({ dataset: { skillId: String(id), expiresAt: String(exp) }, getAttribute: () => '' })) };
    const recs = [];
    const FA_KNOWN = Object.fromEntries([...content.matchAll(/(\d+): \[['"][^'"]+['"], (\d)\]/g)].map(m => [m[1], ['x', +m[2]]]));
    assert.equal(FA_KNOWN[268]?.[1], 1, 'Song of Wind 268 known'); assert.equal(FA_KNOWN[304]?.[1], 1, 'Song of Vitality 304 known');
    const env = { cfg: { rbHuntMode: true, townBuffSet: 'basic', faBuffs: '' }, rt: { faCat: base.faCat, tbSetIds: {}, tbT: now - 3600000 }, $q: s => (s === '#l2-hud-active-buffs' ? box : null),
      TB_KEYS: { basic: [1068, 1268, 1086, 1045], warrior: [1388, 1268, 271, 1045], mage: [1059, 1303, 1045] }, FA_KNOWN, faCost: id => base.faCat[id]?.cost || 1,
      setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), epicBuffCol: () => null };
    const sb = { console: quiet, Date, Math, JSON, document: { querySelectorAll: () => [], querySelector: () => null }, get location() { return { pathname: path_ }; } };
    sb.globalThis = sb; vm.runInNewContext(read('modules/buffs.js'), sb);
    const B = sb.L2V7Factories.buffs(env);
    hud = [...TOWN.map(id => [id, T24]), ...FA9.map(id => [id, E3])];                 // 10:00:18: 9 баффов по 1 FA, Noblesse ушёл
    assert.deepEqual([...B.faWanted()], [1323], 'Noblesse wanted: 8 paid buffs × 1 FA ≥ Noblesse 5 FA (1303 is also a town-set id — not counted)');
    assert.deepEqual([...(B.townBuffNeed()?.fa || [])], [1323]);
    env.cfg.townBuffSet = 'off'; assert.equal(JSON.stringify(B.townBuffNeed()), '{"set":null,"fa":[1323]}', 'town set off — Noblesse still rebought'); env.cfg.townBuffSet = 'basic';
    hud = TOWN.map(id => [id, T24]);                                                   // 10:32:35: только городской набор
    assert.deepEqual([...B.faWanted()], [], 'only the town set (same ids are sold for FA) — no Noblesse');
    hud = [[1389, E3], [264, E3], [1059, E3], [1085, E3], [1303, E3]];                 // 2 платных + id городского набора
    assert.deepEqual([...B.faWanted()], [], '2 FA at risk < Noblesse 5 FA');
    env.cfg.rbHuntMode = false; hud = [...TOWN.map(id => [id, T24]), ...FA9.map(id => [id, E3])];
    assert.deepEqual([...B.faWanted()], [], 'not in a boss mode — nothing'); env.cfg.rbHuntMode = true;
    // старая шапка: Noblesse «висит», а куплен до последней смерти — уходим за новым; свой, купленный после смерти, — нет
    hud = [...FA9.map(id => [id, E3]), [1323, E3 + 3000]]; env.rt.deathLog = [now - 30000];
    assert.ok(B.townBuffNeed()?.fa.includes(1323), 'Noblesse bought before the death is gone');
    env.rt.nobBuyT = now - 10000; assert.deepEqual([...(B.townBuffNeed()?.fa || [])], [], 'own Noblesse bought after the death — nothing to buy');
    delete env.rt.nobBuyT; env.rt.deathLog = [];
    assert.deepEqual([...(B.townBuffNeed()?.fa || [])], [], 'no death — the visible Noblesse is real');
    assert.match(read('modules/buffs.js'), /if \(ok && id === 1323\) nobT = Date\.now\(\);/);
    assert.match(read('modules/buffs.js'), /\.\.\.\(nobT \? \{ nobBuyT: nobT \} : \{\}\)/);

    // 6. что смерть сделала с баффами за FA — в журнал (раньше ни строки)
    recs.length = 0; env.rt = { faCat: base.faCat, tbSetIds: {}, tbT: now, deathLog: [] };
    hud = [...TOWN.map(id => [id, T24]), ...FA9.map(id => [id, E3]), [1323, E3 + 2000]];
    B.townBuffNeed();                                                               // снимок до смерти
    assert.ok(env.rt.faSnap?.ids?.[1323] && env.rt.faSnap.ids[4703], 'paid buffs snapshot');
    const snapT = env.rt.faSnap.t;
    env.rt.deathLog = [snapT + 1]; env.rt.faSnap = { ...env.rt.faSnap, t: snapT - 60000 };
    // сразу после воскрешения у баффера — ещё не сравниваем
    path_ = '/town-buffer.html'; hud = [...TOWN.map(id => [id, T24]), ...FA9.map(id => [id, E3])];
    B.townBuffNeed(); assert.equal(recs.filter(r => /смерть/.test(r)).length, 0, 'no verdict at the buffer page / within 20 s');
    path_ = '/map.html'; env.rt.deathLog = [now - 30000]; env.rt.faSnap.t = now - 90000;
    B.townBuffNeed();
    assert.match(recs.join('\n'), /Noblesse Blessing сберёг 8 бафф\(ов\) за FA и ушёл — докупаю его/, recs.join('\n'));
    assert.equal(env.rt.faDeathSaid, now - 30000);
    // вторая смерть без Noblesse — все платные слетели
    recs.length = 0; env.rt.deathLog = [now - 25000]; env.rt.faSnap = { t: now - 60000, sig: 'x', ids: Object.fromEntries(FA9.map(id => [id, E3])) };
    hud = TOWN.map(id => [id, T24]);
    B.townBuffNeed();
    assert.match(recs.join('\n'), /смерть \d\d:\d\d сняла 9 бафф\(ов\) за FA: .*Дар Серафима.* — Noblesse Blessing не было/, recs.join('\n')); }

  console.log('PASS: 8.0.3 death — no «не по силам» after a server hang (and no blind presses: probe, reload), deaths history survives ▶ Start, boss death counts for Coin of Luck, revive after «Вернуться в город» by network, boss death via the map (never back to the killer’s battle page), Noblesse rebought with 1-FA buffs, FA buffs lost on death logged, fmtT 7:00 / 0:00');
})().catch(e => { console.error(e); process.exit(1); });
