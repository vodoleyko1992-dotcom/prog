'use strict';
// 8.0.3 (ревью; лог 10.10 23:23 Селян — бой ВЫИГРАН в 23:25:06): спецудар 1853 + обычный ≈318 в одном шаге замера (S.lethal 2171 = 46 %
// от 4710) давал аварийный выход 'strong' и «не по силам» до нового уровня, спецудар при HP 1644 — 'brink'. Проверяем: S.lethal в rbFlee
// не считается, 'brink' — только по обычному удару, сильнейший одиночный удар запоминается (rbDb.maxHit) и действует в следующем бою
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const quiet = { log() {}, info() {}, warn: console.warn, error: console.error };
const mk = (rt = {}, extra = {}) => {
  const env = { cfg: { rbRetreatHp: 20, stopHp: 25 }, rt: { rbDb: {}, rbStats: {}, ...rt }, heroLvl: () => 56, setRt: async p => Object.assign(env.rt, p), rec: () => {},
    logLines: () => [], newLines: (a, b) => b.filter(x => !a.includes(x)), activeBuffs: () => [], mobHp: () => null, epicById: () => null, epicOn: () => false, ...extra };
  env.rbNote = async (id, p) => { env.rt.rbDb = { ...env.rt.rbDb, [id]: { ...(env.rt.rbDb[id] || {}), ...p } }; };
  const sb = { console: quiet, Date, Math, JSON, CSS: { escape: s => s }, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/battle.html', search: '', href: '' } };
  sb.globalThis = sb; vm.runInNewContext(read('modules/raid.js'), sb);
  return { env, R: sb.L2V7Factories.raid(env) };
};
const SEL = 'l2dop_rb_25xx_sel', ORF = 'l2dop_rb_29014', boss = { cur: 132000, max: 507285 };
(async () => {
  // Селян 23:23:16: HP 4037 → 1866 (спецудар 1853 + удар ≈318), 23:23:20: HP 1644 — бой выигран → никакого выхода
  { const { R } = mk();
    const ctx = { name: 'Селян', rb: { id: SEL, hits: [301, 318, 296], sp: 1853, lethal: 2171, samples: [] } };
    assert.equal(R.rbFlee(ctx, { max: 4710, cur: 1866, pct: 40 }, boss), null, 'Selyan 23:23:16 — special + hit in one sample is not a single hit');
    assert.equal(R.rbFlee(ctx, { max: 4710, cur: 1644, pct: 35 }, boss), null, 'Selyan 23:23:20 — special on cooldown, normal hits 318: keep fighting');
    // без платных баффов (макс. 5032, как после 10:32) — спецудар 37 % — тоже не выход
    assert.equal(R.rbFlee(ctx, { max: 5032, cur: 2100, pct: 42 }, boss), null, 'special 37 % at 5032 HP — no brink'); }
  // спецудар из прошлых боёв (rbDb.sp) — тоже не 'brink'; а ≥ 45 % при HP < 2 спецударов — 'strong' как раньше
  { const { R } = mk({ rbDb: { [SEL]: { sp: 1853, hitP90: 318 } } });
    assert.equal(R.rbFlee({ name: 'Селян', rb: { id: SEL, samples: [] } }, { max: 4710, cur: 1700, pct: 36 }, boss), null);
    assert.equal(R.rbFlee({ name: 'Т', rb: { id: 'x61', sp: 1885, samples: [] } }, { max: 4151, cur: 3000, pct: 72 }, boss)?.kind, 'strong', 'special 45 % — strong kept'); }
  // Орфен бой 1: удар 2875 при 5032 → strong; бой 2: обычные 2508 + 2559 при 6369, HP 2351 → brink
  { const { R } = mk();
    assert.equal(R.rbFlee({ name: 'Орфен', rb: { id: ORF, hits: [2875], samples: [] } }, { max: 5032, cur: 2157, pct: 43 }, { cur: 483262, max: 487686 })?.kind, 'strong');
    const { R: R2 } = mk();                                   // свой env: удар 2875 из боя 1 уже в rbDb.maxHit
    const f = R2.rbFlee({ name: 'Орфен', rb: { id: ORF, hits: [2508, 2559], samples: [] } }, { max: 6369, cur: 2351, pct: 37 }, { cur: 456073, max: 487686 });
    assert.equal(f?.kind, 'brink'); assert.equal(f.worst, 2559); assert.match(f.why, /удар 2559 HP = 40 %/); }
  // сильнейший одиночный удар помнится после 1 удара (hitP90 — только от ≥ 3): следующий бой с Орфеном знает 57 % удар
  { let lines = []; const { env, R } = mk({}, { logLines: () => lines });
    const ctx = { name: 'Орфен', rb: { id: ORF, samples: [] } };
    R.rbFlee(ctx, { max: 5032, cur: 5032, pct: 100 }, { cur: 486000, max: 487686 });
    lines = ['[Орфен] ударив тебе −2875 HP.'];
    assert.equal(R.rbFlee(ctx, { max: 5032, cur: 2157, pct: 43 }, { cur: 483262, max: 487686 })?.kind, 'strong');
    assert.equal(env.rt.rbDb[ORF].maxHit, 2875, 'max single hit persisted'); assert.ok(!(env.rt.rbDb[ORF].hitP90 > 0), 'hitP90 still needs ≥ 3 hits');
    assert.equal(R.rbFlee({ name: 'Орфен', rb: { id: ORF, samples: [] } }, { max: 5032, cur: 2500, pct: 50 }, { cur: 480000, max: 487686 })?.kind, 'strong', 'next fight: leaves before the first hit lands twice'); }
  // меньший удар maxHit не понижает
  { let lines = []; const { env, R } = mk({ rbDb: { [ORF]: { maxHit: 2875 } } }, { logLines: () => lines });
    const ctx = { name: 'Орфен', rb: { id: ORF, samples: [] } }; R.rbLearn(ctx); lines = ['[Орфен] ударив тебе −2400 HP.']; R.rbLearn(ctx);
    assert.equal(env.rt.rbDb[ORF].maxHit, 2875); }
  assert.doesNotMatch(read('modules/raid.js').match(/function rbFlee[\s\S]*?\n\}/)[0], /S\.lethal/, 'rbFlee does not use S.lethal');
  console.log('PASS: 8.0.3 rbFlee — HP jump between samples (S.lethal) is not a hit, brink only from normal hits (special on cooldown), max single hit remembered (rbDb.maxHit)');
})().catch(e => { console.error(e); process.exit(1); });
