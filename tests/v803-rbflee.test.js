'use strict';
// 8.0.3 (лог 11.10 10:43–11:45, Орфен 11:42:31 и 11:44:43 — оба боя начал игрок): удар босса 2508–2885 = 40–57 % HP героя, а бот бился
// «до конца на банках», хотя выход из боя работает (POST /game/battle/leave → 200). Модель обычного удара эпика до боя — «≈218»
// (rbK выучен на обычных РБ), и удары эпика могли испортить общий rbK. Проверяем: аварийный выход (raid.rbFlee → rbRetreat с вердиктом),
// осторожную модель удара эпика в rbPreCheck, rbK/rbLossK не учатся на эпиках
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const quiet = { log() {}, info() {}, warn: console.warn, error: console.error };
const load = (f, extra = {}) => { const sb = { console: quiet, Date, Math, JSON, CSS: { escape: s => s }, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/battle.html', search: '', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(read(f), sb); return sb; };
const base = JSON.parse(read('base-profile.json')).chars.Warlock.rt;
const mk = (rt = {}, extra = {}) => {
  const notes = [], recs = [];
  const env = { cfg: { rbMaxBelow: 15, rbMaxAbove: 15, rbRetreatHp: 20, rbRestHp: 95, stopHp: 25 }, rt: { rbDb: {}, rbStats: {}, ...rt }, heroLvl: () => 56, RB_WIN: 15, RB_TRY_MS: 0, RB_RETRY_MS: 0,
    meHp: () => ({ max: 7000, cur: 7000, pct: 100 }), potModel: () => ({ pool: 600000, rate: 2000, n: 960 }), fmtK: n => String(Math.round(n)), fmtT: s => String(Math.round(s)),
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), logLines: () => [], newLines: (a, b) => b.filter(x => !a.includes(x)), activeBuffs: () => [],
    mobHp: () => null, epicById: id => (/^l2dop_rb_290\d\d$/.test(id) ? { k: 'orfen' } : null), epicOn: () => false, setStatus: () => {}, sleep: async () => {}, rnd: a => a,
    toOutskirts: async () => {}, shopNeedByPanel: () => '', ...extra };
  env.rbNote = async (id, p) => { notes.push([id, p]); env.rt.rbDb = { ...env.rt.rbDb, [id]: { ...(env.rt.rbDb[id] || {}), ...p } }; };
  return { env, notes, recs, R: load('modules/raid.js').L2V7Factories.raid(env) };
};
const ORF = 'l2dop_rb_29014', orfSt = { hp: 487686, patk: 3920, pdef: 1601, matk: 3192, mdef: 1924 };

(async () => {
  // 1. аварийный выход: бой 1 (11:42:16.6) — удар 2875 при HP 5032 → 2157: «двух не переживу» → kind strong
  { const { R } = mk();
    const ctx = { name: 'Орфен', rb: { id: ORF, hits: [2875], samples: [] } };
    const f = R.rbFlee(ctx, { max: 5032, cur: 2157, pct: 43 }, { cur: 483262, max: 487686 });
    assert.equal(f?.kind, 'strong', 'Orfen fight 1: 57 % hit → leave at once'); assert.equal(f.worst, 2875); assert.equal(f.pct, 57);
    assert.match(f.why, /удар 2875 HP = 57 %/);
    // скачок HP между замерами (S.lethal из rbAssess) — не одиночный удар: выхода по нему нет (см. v803-rbflee-single)
    assert.equal(mk().R.rbFlee({ name: 'Орфен', rb: { id: ORF, lethal: 2764, samples: [] } }, { max: 5032, cur: 2268, pct: 45 }, { cur: 483262, max: 487686 }), null);
    // бой 2 (6369 HP): 2508 (39 %) при HP 3710 — ещё нет; после крита 2559 HP 2351 ≤ 2559 × 1,15 → «следующий удар убьёт»
    const c2 = { name: 'Орфен', rb: { id: ORF, hits: [2508], samples: [] } }, R2 = mk().R;   // свой env: 2875 из боя 1 уже в rbDb.maxHit
    assert.equal(R2.rbFlee(c2, { max: 6369, cur: 3710, pct: 58 }, { cur: 456073, max: 487686 }), null, '39 % hit and 3710 HP — keep fighting');
    c2.rb.hits.push(2559);
    assert.equal(R2.rbFlee(c2, { max: 6369, cur: 2351, pct: 37 }, { cur: 456073, max: 487686 })?.kind, 'brink', 'next hit kills → leave (11:44:37.7)');
    // босс почти добит (≤ 5 %) — добиваем
    assert.equal(R.rbFlee({ name: 'Орфен', rb: { id: ORF, hits: [2875], samples: [] } }, { max: 5032, cur: 2157, pct: 43 }, { cur: 20000, max: 487686 }), null, 'boss at 4 % — finish it');
  }
  // замер с прошлого боя с этим боссом (rbDb.hitP90) — выход после первого же удара
  { const { R } = mk({ rbDb: { [ORF]: { hitP90: 2875 } } });
    assert.equal(R.rbFlee({ name: 'Орфен', rb: { id: ORF, samples: [] } }, { max: 6369, cur: 6369, pct: 100 }, { cur: 470000, max: 487686 }), null, 'full HP — two such hits are survivable only just: no flee yet');
    assert.equal(R.rbFlee({ name: 'Орфен', rb: { id: ORF, samples: [] } }, { max: 6369, cur: 3710, pct: 58 }, { cur: 456000, max: 487686 })?.kind, 'strong', 'known 45 % hit, HP < 2 hits → leave'); }
  // обычный РБ (Барда 55: удары 129–149, спецудар 1077 = 17 % при 6178) — никакого выхода, бой идёт как раньше
  { const { R } = mk({ rbDb: { l2dop_rb_25434: { sp: 1077, hitP90: 149 } } });
    assert.equal(R.rbFlee({ name: 'Барда', rb: { id: 'l2dop_rb_25434', hits: [141, 149, 265], sp: 1077, samples: [] } }, { max: 6178, cur: 2776, pct: 45 }, { cur: 504275, max: 704170 }), null, 'Barda: no emergency');
    // Тимініель 61 (спецудар 1885) при макс. HP без платных баффов (4151): 45 % — уходим, пока HP < двух спецударов
    assert.equal(R.rbFlee({ name: 'Тимініель', rb: { id: 'x61', sp: 1885, samples: [] } }, { max: 4151, cur: 3000, pct: 72 }, { cur: 800000, max: 877023 })?.kind, 'strong'); }
  // строки журнала боя сами попадают в замер (rbLearn внутри rbFlee)
  { let lines = []; const { R } = mk({}, { logLines: () => lines });
    const ctx = { name: 'Орфен', rb: { id: ORF, samples: [] } };
    assert.equal(R.rbFlee(ctx, { max: 5032, cur: 5032, pct: 100 }, { cur: 486000, max: 487686 }), null);
    lines = ['[Орфен] ударив тебе −2875 HP.'];
    assert.equal(R.rbFlee(ctx, { max: 5032, cur: 2157, pct: 43 }, { cur: 483262, max: 487686 })?.worst, 2875, 'hit parsed from the battle log'); }

  // 2. rbRetreat с вердиктом: strong → «не по силам» до нового уровня, без возврата после отдыха; skip → пропуск 30 мин; без — как раньше
  { const { env, R } = mk({ rbDb: { [ORF]: { verdict: 'ok' } } });
    const ctx = { name: 'Орфен', rb: { id: ORF, start: 486171 } }, mob = { cur: 475039, max: 487686 };
    await R.rbRetreat(ctx, mob, 'удар 2875', 'no');
    assert.equal(env.rt.rbPending, false); assert.equal(env.rt.rbDb[ORF].verdict, 'no'); assert.equal(env.rt.rbPreSkip[ORF].kind, 'strong');
    assert.match(env.rt.rbDb[ORF].note, /аварийный выход: удар 2875/);
    assert.equal(R.rbVerdictBlocks(ORF), true, 'blocked until the next hero level'); }
  { const { env, R } = mk({ rbDb: { a: { verdict: 'ok' } } });
    await R.rbRetreat({ name: 'A', rb: { id: 'a', start: 100 } }, { cur: 50, max: 100 }, 'x', 'skip');
    assert.deepEqual([env.rt.rbPending, env.rt.rbDb.a.verdict, env.rt.rbPreSkip.a.kind], [false, 'ok', 'strong'], 'brink: 30 min skip, verdict kept');
    await R.rbRetreat({ name: 'A', rb: { id: 'a', start: 100 } }, { cur: 50, max: 100 }, 'x');
    assert.equal(env.rt.rbPending, true, 'plain retreat unchanged (come back after rest)'); }

  // 3. модель удара эпика до боя: Орфен — обычный ≈0,7 × max(P.Atk, M.Atk) = 2744 (было ≈218), не «по силам» и при 7000 / 9000 HP
  { const { R } = mk({ rbStats: base.rbStats, rbDb: JSON.parse(JSON.stringify(base.rbDb)), rbK: base.rbK, rbLossK: base.rbLossK });
    for (const hp of [5032, 6369, 7000, 9000]) {
      const c = R.rbPreCheck(ORF, { ...orfSt, hpExact: true, loss: Math.round(0.059 * orfSt.patk) }, 1, 600, hp);
      assert.equal(c.ok, false, `Orfen at ${hp} HP is not ok: ${c.why}`);
    }
    const c = R.rbPreCheck(ORF, { ...orfSt, hpExact: true }, 1, 600, 9000);
    assert.match(c.why, /обычный ≈2744/, 'epic normal hit shown: ' + c.why);
    assert.ok(c.p90 >= 3000, 'epic p90 ≈ hit × 1,1');
    // тот же стат у обычного РБ — прежняя формула (P.Atk × rbK)
    const n = R.rbPreCheck('l2dop_rb_99999', { ...orfSt, hpExact: true }, 1, 600, 9000);
    assert.match(n.why, new RegExp(`обычный ≈${Math.round(orfSt.patk * base.rbK)},`), 'normal RB model unchanged: ' + n.why);
    // эпик узнаётся и по kind 'epic' из /game/spawn/info, и по epicDb
    const { R: R2 } = mk({ rbStats: { l2dop_rb_77777: { ...orfSt, kind: 'epic' } }, epicDb: { zz: { id: 'l2dop_rb_66666' } } }, { epicById: () => null });
    assert.equal(R2.isEpicId('l2dop_rb_77777'), true); assert.equal(R2.isEpicId('l2dop_rb_66666'), true); assert.equal(R2.isEpicId('l2dop_rb_29006'), true);
    assert.equal(R2.isEpicId('l2dop_rb_25434'), false);
    const st = await R2.rbInfoNote('l2dop_rb_55555', { kind: 'epic', stats: { maxHp: 876883, pAtk: 3920, pDef: 2001, mAtk: 3192, mDef: 2124 } }, 'page');
    assert.equal(st.kind, 'epic', 'kind from /game/spawn/info kept'); }

  // 4. удары эпика не учат общий rbK (Орфен k ≈0,65 испортил бы оценку всех РБ), hitP90 эпика в базу пишется; обычный РБ — учит
  for (const [id, learns] of [[ORF, false], ['l2dop_rb_25057', true]]) {
    let lines = []; const { env, R } = mk({ rbK: 0.0556, rbStats: { [id]: { hp: 487686, patk: 3920, matk: 3192 } } }, { logLines: () => lines });
    const ctx = { name: 'Орфен', rb: { id, samples: [] } };
    R.rbLearn(ctx);
    lines = Array.from({ length: 12 }, (_, i) => `[Орфен] ударив тебе −${2540 + i} HP.`);
    R.rbLearn(ctx);
    assert.equal(env.rt.rbK !== 0.0556, learns, `${id}: rbK ${learns ? 'learns' : 'untouched'} (${env.rt.rbK})`);
    assert.ok(env.rt.rbDb[id].hitP90 >= 2550, 'own hitP90 recorded');
  }
  // rbLossK — тоже не с эпика (потери эпика — только в его rbStats.loss)
  const raid = read('modules/raid.js');
  assert.match(raid, /const k = loss \/ stL\.patk, epicL = isEpicId\(S\.id\);[\s\S]{0,140}\.\.\.\(epicL \? \{\} : \{ rbLossK:/);

  // 5. бой: выход по rbFlee стоит до аварийной банки, работает и в бою игрока (manualRb), кроме своей эпик-цепочки; выход подтверждается
  const combat = read('modules/combat.js');
  const iFlee = combat.indexOf('const fl = !epChain && env.rbFlee ? env.rbFlee(ctx, me, mob) : null;'), iPot = combat.indexOf("if (me && me.pct <= Math.max(env.cfg.stopHp, 25)) {");
  assert.ok(iFlee > 0 && iPot > iFlee, 'flee check runs before the emergency potion');
  const fb = combat.slice(iFlee, iPot);
  assert.match(fb, /const leave = env\.\$q\('#battle-back-map'\);/);
  assert.match(fb, /if \(await env\.waitFor\(\(\) => !env\.isBattle\(\), 8000, 150\)\) \{ await env\.rbRetreat\(ctx, mob, fl\.why, verdict\); return; \}/);
  assert.match(fb, /const verdict = fl\.kind === 'strong' && !\(hang && Date\.now\(\) - \(\+hang\.t \|\| 0\) < 60000\) \? 'no' : 'skip';/, 'after a server hang — no verdict, only a 30 min skip');
  assert.match(fb, /leaveBadUntil: Date\.now\(\) \+ 3600000/);
  assert.match(fb, /manualRb \? ' \(бой начат вами/, 'player-started fight also leaves (logged)');
  assert.doesNotMatch(combat.slice(iFlee - 900, iFlee), /manualRb\s*&&|!manualRb/, 'not limited to bot fights');
  assert.match(read('content.js'), /get rbFlee\(\) \{ return \(\.\.\.a\) => L2V7Modules\.raid\.rbFlee\(\.\.\.a\); \}/);
  // поведение блока боя: выход → rbRetreat с вердиктом; после зависания сервера — только пропуск; выход не подтвердился — запрет на час
  { const i0 = combat.indexOf('    if (ctx.rb && me && mob && !ctx.rb.retreated) {'), i1 = combat.indexOf('    // v4.44: из боя в этой игре уйти нельзя', i0);
    assert.ok(i0 > 0 && i1 > i0);
    const blk = combat.slice(i0, i1);
    const run = async ({ fl = { kind: 'strong', why: 'удар 2875 HP = 57 %' }, ended = true, hang = null, epic = false, leaveBad = 0, manual = true } = {}) => {
      const out = { fired: 0, retreat: null, notes: [], recs: [], fleeCalls: 0 };
      const ss = { getItem: k => (k === 'l2bot.srvHang' && hang ? JSON.stringify(hang) : null) };
      const env = { epicOn: () => epic, epicById: () => (epic ? { k: 'orfen' } : null), rt: { epic: epic ? { k: 'orfen', step: 'fight' } : null, rbDb: { [ORF]: { leaveBadUntil: leaveBad } } },
        rbFlee: () => { out.fleeCalls++; return fl; }, $q: s => (s === '#battle-back-map' ? { id: 'leave' } : null), shown: x => !!x, fire: () => { out.fired++; return true; },
        waitFor: async () => ended, isBattle: () => !ended, rbRetreat: async (c, m, why, v) => { out.retreat = v; }, rbNote: async (id, p) => out.notes.push(p), rec: (...a) => out.recs.push(a.join(' ')) };
      const sb = { env, ctx: { name: 'Орфен', rb: { id: ORF } }, me: { max: 5032, cur: 2157, pct: 43 }, mob: { cur: 483262, max: 487686 }, manualRb: manual, sessionStorage: ss, Date, JSON };
      vm.runInNewContext(`this.step = async () => { for (let i = 0; i < 1; i++) {\n${blk}\n return 'through'; } return 'cont'; };`, sb);
      out.r = (await sb.step()) ?? 'return';
      return out;
    };
    let o = await run();
    assert.deepEqual([o.r, o.fired, o.retreat], ['return', 1, 'no'], 'leave + «не по силам»'); assert.match(o.recs.join('\n'), /ухожу из боя \(бой начат вами/);
    o = await run({ hang: { t: Date.now() - 5000, why: 'ход без ответа 9 с' } }); assert.equal(o.retreat, 'skip', 'right after a server hang — only a skip');
    o = await run({ fl: { kind: 'brink', why: 'x' } }); assert.equal(o.retreat, 'skip');
    o = await run({ ended: false }); assert.equal(o.r, 'through'); assert.ok(o.notes[0].leaveBadUntil > Date.now(), 'leave not confirmed — fight on, no new leave for 1 h');
    o = await run({ leaveBad: Date.now() + 60000 }); assert.deepEqual([o.fired, o.r], [0, 'through']); assert.match(o.recs.join('\n'), /выйти нельзя/);
    o = await run({ epic: true }); assert.deepEqual([o.fleeCalls, o.fired], [0, 0], 'own epic chain — its own retreat rules'); }
  console.log('PASS: 8.0.3 RB emergency leave (hit ≥ 45 % HP and HP < 2 hits, or ≥ 35 % and the next hit kills; also in player fights; boss ≤ 5 % — finish), verdict on leave, epic normal hit ≈0,7 × max(P.Atk, M.Atk) before the fight, epic hits do not teach rbK/rbLossK');
})().catch(e => { console.error(e); process.exit(1); });
