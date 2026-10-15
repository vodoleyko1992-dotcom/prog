'use strict';
// 10.0.23, лог 15.10 07:14: новые удары Dark Avenger ошибочно считались дебаффами.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const part = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a); return src.slice(a, b); };
const metadata = part("const IL = typeof IL_DB", '// ---------- база предметов Interlude');
const damage = part('const splashDmg =', 'const cdWatch =');
const observe = part('let lastObserve = 0;', '// роли по панели');
const cases = [
  { name: 'Corpse Plague', action: 'corpse_plague', id: 103, line: 'Чума трупа 14889', dmg: 14889, mp: 45 },
  { name: 'Hamstring', action: 'hamstring_slash', id: 127, line: 'Підріз сухожилля 16269', dmg: 16269, mp: 39 },
];
function context(extra = {}) {
  const rt = {}, sb = { console, Math, Date, rt, BUFF_RE: /x^/, setRt: async p => Object.assign(rt, p), ...extra };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(root, 'skills-il.js'), 'utf8'), sb);
  vm.runInContext(metadata + '\n' + damage + '\nthis.ilOf = ilOf; this.dmgFromLog = dmgFromLog;', sb);
  return sb;
}
async function replay(c, { rejected = false, withTurn = false, support = false } = {}) {
  let now = 10000, callback, arr = [], mp = 1119, mob = 223837;
  const NET = { start: 2, done: 2, ok: true, action: c.action }, logs = [], notes = [];
  const b = { title: c.name, cdKey: c.action, querySelector: () => null };
  const sb = context({ Date: { now: () => now }, ACT_NET: NET, slotAction: () => c.action,
    isBattle: () => true, slotKind: () => 'скилл', cleanTitle: x => x, mobHp: () => ({ cur: mob, max: 369009 }),
    meHp: () => ({ cur: 10592, max: 10592 }), meMp: () => ({ cur: mp, max: 1119 }), logLines: () => arr, noticeText: () => '',
    slotCd: () => null, setTimeout: f => { callback = f; }, sleep: async ms => { now += ms; },
    newLines: (a, z) => z.slice(a.length), isChargeName: () => false, BUFF_CTX: null, UNAVAIL: /x^/,
    fightNote: (...a) => notes.push(a), rec: (...a) => logs.push(a), L2V7Modules: { fightlab: { turnFor: () => null } },
  });
  if (support) sb.ilOf = () => ({ c: 'Бафф' });
  vm.runInContext(observe + '\nthis.observeSlot = observeSlot;', sb);
  sb.observeSlot(b, 'U');
  arr = [c.line, 'Слуга [Темна пантера] атакує [Cursed Clara] 2 756 урону.', '[Cursed Clara] ударив тебе −54 HP.', 'Відбиття на моба −10 HP.'];
  NET.start = NET.done = 3; NET.ok = !rejected; now += 900; mp -= c.mp; mob -= c.dmg + 2756 + 10;
  if (withTurn) {
    vm.runInContext(fs.readFileSync(path.join(root, 'modules/fightlab.js'), 'utf8'), sb);
    const parsed = sb.L2V7Factories.fightlab({}).parseLog(arr, 'Cursed Clara');
    assert.equal(parsed.own, c.dmg, 'разбор принятого хода не присваивает навыку урон пантеры и отражения');
    assert.equal(parsed.pet, 2756);
    sb.L2V7Modules.fightlab.turnFor = () => ({ own: parsed.own, mpd: c.mp, selfHeal: 0 });
  }
  await callback();
  return { skill: sb.rt.skills?.[c.name.toLowerCase()], notes, logs };
}
function raidPlan(c, confirmedGameDamage, { ctx = { block: {}, rb: { id: '25217' } }, uses = 8, fallback = false, dmgN = 0 } = {}) {
  const dom = { slots: [], querySelectorAll: sel => sel === 'button' ? dom.slots : [], querySelector: () => null };
  const sb = context({ document: dom, location: { pathname: '/battle.html' } });
  vm.runInContext(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), sb);
  const button = (title, cdKey) => ({ title, cdKey, disabled: false, getAttribute: () => null, querySelector: () => null });
  const atk = button('Атака', 'attack'), skill = button(c.name, c.action); dom.slots = [atk, skill];
  const rt = { skills: { [c.name.toLowerCase()]: { uses, dmg: 0, dmgN } }, skillDb: {}, rbDb: {}, cdUntil: {}, cdUse: {} };
  const env = { SLOT: 'button', rt, cfg: { nAttack: 'Атака', nPower: c.name, nUltra: '', nCharge: '', fightMode: 'dps', skillMpMin: 35 },
    names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), isEquip: () => false, shown: b => !!b,
    slotKind: b => b === atk ? 'атака' : 'скилл', slotCd: () => null, slotAction: () => null, skKey: b => b.title.toLowerCase(),
    memLeft: () => 0, uiTimer: () => 0, combatCooldown: { skillWait: () => 0 }, battleSpawn: () => 1,
    ilOf: b => { const il = sb.ilOf(b); return il && !confirmedGameDamage ? { ...il, l2Damage: false } : il; },
    $q: s => s === '#battle-mob-hp-val' ? { textContent: '208938/369009' } : null,
    // Свежий замер текущего боя уже есть, старая память observeSlot содержит ложные нули.
    expDmg: n => n.toLowerCase() === 'атака' ? 4500 : fallback ? 6750 : c.dmg, fightDmgOn: () => fallback ? null : ({ mean: c.dmg }),
    forceNow: () => 0, forceMax: () => 0, forceCosts: () => [], isChargeName: () => false, isForceName: () => false,
    cleanTitle: x => x, longFightMp: () => null, skillMp: () => c.mp, meHp: () => ({ cur: 10592, max: 10592, pct: 100 }),
    hpPotByDeficit: () => null, mpPotSlot: () => null, chargeValue: () => 0, turnSec: () => 1.2, actCost: () => 1,
    qty: () => 0, SK_NET: {}, setRt: async p => Object.assign(rt, p),
  };
  return sb.L2V7Factories.combat(env).dpsPlan(ctx, { cur: 1119, max: 1119 });
}
(async () => {
  for (const c of cases) {
    const sb = context(), il = sb.ilOf({ title: c.name, cdKey: c.action });
    assert.equal(il.id, c.id); assert.equal(il.target, 'ONE');
    const mixed = ['Слуга [Темна пантера] атакує [Cursed Clara] 2 756 урону.', 'Відбиття на моба −10 HP.', c.line];
    assert.equal(sb.dmgFromLog(c.name, mixed, false), c.dmg, 'известный перевод работает без обучения алиаса в смешанном окне');
    for (const withTurn of [false, true]) {
      const r = await replay(c, { withTurn });
      assert.equal(r.skill?.dmgN, 1, 'реальный observeSlot учит прямой урон');
      assert.equal(r.skill.dmg, c.dmg); assert.equal(r.skill.mp, c.mp); assert.equal(r.skill.usesU, 1);
      assert.equal(r.notes[0]?.[1], c.dmg);
    }
    const refused = await replay(c, { rejected: true }); assert.equal(refused.skill, undefined, 'отказ сервера не учит ни урон, ни применение');
    assert.equal(raidPlan(c, true)?.name, c.name, 'старые нулевые замеры не запрещают подтверждённый игровой удар');
    assert.equal(raidPlan(c, false)?.key, 'attack', 'защита от неизвестного навыка без урона остаётся');
    const ctx = { block: {}, rb: { id: '25217' } };
    for (let uses = 8; uses < 11; uses++) assert.equal(raidPlan(c, true, { ctx, uses, fallback: true })?.name, c.name,
      'начальная оценка 1,5 атаки не блокирует первые три замера на РБ');
    assert.equal(raidPlan(c, true, { ctx, uses: 11, fallback: true })?.key, 'attack', 'три новых нулевых замера ограничивают повтор в этом бою');
    const acceptedCtx = { block: {}, rb: { id: '25217' } };
    const acceptedLine = fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8').split('\n').find(l => l.includes('if (a.damageProbe && done === true)'));
    assert.ok(acceptedLine);
    const action = { damageProbe: true, b: c.name }, counter = { ctx: acceptedCtx, a: action, done: false, env: { skKey: x => x.toLowerCase() } };
    vm.runInNewContext(acceptedLine, counter);assert.equal(acceptedCtx.damageProbeActs, undefined);
    counter.done = true;for(let n=0;n<3;n++) vm.runInNewContext(acceptedLine,counter);
    assert.equal(raidPlan(c, true, { ctx: acceptedCtx, uses: 8, fallback: true })?.key, 'attack', 'три принятых действия ограничивают пробу даже без callback замера');

    assert.equal(raidPlan(c, true, { ctx, uses: 11, dmgN: 1 })?.name, c.name, 'подтверждённый сильный удар продолжает ротацию после пробы');
    assert.equal(raidPlan(c, true, { ctx, uses: 11, dmgN: 1, fallback: true })?.key, 'attack', 'уже измеренный слабый удар не обходит порог выгоды РБ');
  }
  const support = await replay({ ...cases[0], name: 'Majesty' }, { support: true });
  assert.equal(support.skill.dmgN, 0, 'соседний урон не превращает настоящий бафф в удар');
  console.log('PASS v1023 tank damage learning: aliases, accepted turns, observeSlot, legacy zero samples, support guard');
})().catch(e => { console.error(e); process.exitCode = 1; });
