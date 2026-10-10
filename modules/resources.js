/* L2wap v7: isolated resources feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.resources = function create_resources(env) {
function bar(curSel, maxSel) {
  const c = env.numOf(curSel), m = env.numOf(maxSel);
  return c == null || !m ? null : { cur: c, max: m, pct: 100 * c / m };
}

const meHp = () => bar('#l2-hud-hp-cur', '#l2-hud-hp-max');

const meMp = () => bar('#l2-hud-mp-cur', '#l2-hud-mp-max');

async function potWatch(b) {                     // после глотка 4,5 с собираем строки лечения из журнала
  const key = env.potKey(b), name = env.potName(b), t0 = Date.now(), before = env.logLines();
  if (!key) return;
  env.POT_LAST = t0;
  let sum = 0, pulses = 0, pulse = 0, every = 0, kind = /мани|маны|mana|\bmp\b/i.test(name) ? 'mp' : 'hp';
  while (Date.now() - t0 < 4500 && env.isBattle() && env.POT_LAST === t0) {
    await env.sleep(300);
    for (const l of env.newLines(before, env.logLines())) {
      let m = l.match(/(?:імпульсами по|импульсами по|by)\s*(\d+)\s*(HP|MP)\s*(?:кожні|каждые|every)\s*(\d+)/i);
      if (m && l.toLowerCase().includes(key.split(' (')[0].slice(0, 8))) { pulse = +m[1]; kind = m[2].toLowerCase(); every = +m[3]; }
      m = l.match(/(?:Зілля|Зелье|Potion)\s*\+\s*(\d+)\s*(HP|MP)/i);
      if (m && m[2].toLowerCase() === kind) { sum += +m[1]; pulses++; }
    }
    before.length = 0; before.push(...env.logLines());
  }
  const heal = Math.max(sum, pulse);
  if (!heal) return;
  const P = env.rt.pots?.[key] || {};
  const H = P.heal ? Math.round(P.heal * 0.7 + heal * 0.3) : heal;
  await env.setRt({ pots: { ...(env.rt.pots || {}), [key]: { ...P, name, kind, heal: H, pulse: pulse || P.pulse, every: every || P.every, pulses, n: env.potBag(b) ?? P.n, uses: (P.uses || 0) + 1, t: Date.now() } } });
  if (!P.heal || Math.abs(P.heal - heal) > heal * 0.2) env.rec('B', 'зелья', `${name}: лечит ${heal} ${kind.toUpperCase()}${pulses > 1 ? ` (${pulses} × ${pulse || Math.round(heal / pulses)})` : ''}${every ? `, импульс раз в ${every} с` : ''} · в сумке ${env.potBag(b) ?? '?'}`);
}

function potInventory() {                        // банки на панели → база (тип, сколько в сумке); вызывается в начале боя
  const P = { ...(env.rt.pots || {}) }; let ch = false;
  for (const b of document.querySelectorAll(env.SLOT)) {
    if (env.slotKind(b) !== 'предмет' || !/зілля|зелье|potion|elixir|еліксир|эликсир/i.test(b.title || '')) continue;
    const k = env.potKey(b), n = env.potBag(b);
    if (!k) continue;
    const kind = /мани|маны|mana|\bmp\b/i.test(k) ? 'mp' : 'hp';
    if (!P[k] || P[k].n !== n) { P[k] = { name: env.potName(b), kind, ...(P[k] || {}), n, t: Date.now() }; ch = true; }
  }
  // Legacy potion timers (from Interlude reuse) must never survive an upgrade.
  const cd = { ...(env.rt.cdUntil || {}) }, skills = { ...(env.rt.skills || {}) };
  let cdChanged = false;
  for (const b of document.querySelectorAll(env.SLOT)) if (env.slotKind(b) === 'предмет' &&
      /зілля|зелье|potion|elixir|еліксир|эликсир/i.test(b.title || '')) {
    const k = env.skKey(b);
    if (k && (cd[k] || skills[k]?.cdFloor || skills[k]?.cd || skills[k]?.cdNet)) {
      delete cd[k]; cdChanged = true;
      if (skills[k]) skills[k] = { ...skills[k], cdFloor: 0, cd: 0, cdNet: 0 };
    }
  }
  if (ch || cdChanged) env.setRt({ ...(ch ? { pots: P } : {}), ...(cdChanged ? { cdUntil: cd, skills } : {}) });
}

function hpPots() {
  const own = env.slotsBy(env.cfg.nHpPot || '');
  const auto = [...document.querySelectorAll(env.SLOT)].filter(b => env.slotKind(b) === 'предмет' && env.HP_POT_RE.test(b.title || '') && !/ман|mana|\bmp\b/i.test(b.title || ''));
  return [...new Set([...own, ...auto])].filter(b => env.qty(b) !== 0).map(b => {
    const P = env.rt.pots?.[env.potKey(b)], p = env.rt.skills?.[env.skKey(b)] || {};
    return { b, key: env.potKey(b), name: env.potName(b),
      heal: P?.pulse || Math.min(P?.heal || p.heal || (/велик|greater/i.test(b.title) ? 2500 : 600), /велик|greater/i.test(b.title) ? 2500 : 600),
      est: !(P?.pulse || P?.heal), cd: 0, ready: env.ready(b) }; // Для банок действует только серверный GCD
  });
}

function hpPotByDeficit(deficit) {               // v4.46: недостача ≥1500 — самая сильная, иначе самая слабая (меньше перелива)
  const L = hpPots().filter(x => x.ready).sort((a, b) => a.heal - b.heal);
  return (deficit >= 1500 ? L[L.length - 1] : L.find(x => x.heal <= deficit * 1.2) || L[0])?.b || null;
}

function hpPotPick(urgent) {                     // аварийно — самая сильная; обычно — самая слабая (их больше и они дешевле)
  const L = hpPots().filter(x => x.ready).sort((a, b) => a.heal - b.heal);
  return (urgent ? L[L.length - 1] : L[0])?.b || null;
}

function mpPotSlot() {
  return env.slotsBy(`${env.cfg.nMpPot || ''}, Велике зілля MP, Велике зілля мани`).find(b => env.qty(b) !== 0) || null;
}

function longFightMp(ctx, mp, hp) {
  if (!mp?.max || !hp) return null;
  const atkD = env.expDmg('атака');
  if (!ctx.rb && hp < atkD * 12) return null;    // обычный моб — решает скорость, не мана
  const potB = mpPotSlot(), potN = env.qty(potB);
  if (ctx.rb && env.cfg.rbMpPots !== false && potB && (potN == null || potN > (env.cfg.rbPotReserve || 0))) return { pots: true };
  const chMp = env.skillMp(env.names(env.cfg.nCharge)[0] || 'focused force') || 5;
  const cdOf = n => env.rt.skills?.[n]?.cd || env.rt.skillDb?.[n]?.cd || (env.ilOf(n)?.reuse || 12000) / 1000;
  const all = [...env.names(env.cfg.nPower).map(n => ({ n, mp: env.skillMp(n), dmg: env.expDmg(n) })),
               ...env.forceCosts().map(c => ({ n: c.name.toLowerCase(), mp: env.skillMp(c.name) + c.cost * chMp, dmg: env.expDmg(c.name) }))]
    .filter(x => env.slotsBy(x.n).length && x.dmg > 0 && x.mp > 0 && !env.isChargeName(x.n));
  if (!all.length) return null;
  all.forEach(x => { x.cd = cdOf(x.n); x.eff = x.dmg / x.mp; });
  const best = Math.max(...all.map(x => x.eff));
  const cheap = all.filter(x => x.eff >= best * 0.85);
  const atkCd = cdOf('атака') || 4;
  const dps = atkD / Math.max(1, atkCd) + cheap.reduce((a, x) => a + x.dmg / x.cd, 0);
  const Tr = hp / Math.max(1, dps);                // оценка оставшегося боя, с
  const free = mp.cur + env.MP_REGEN * Tr - cheap.reduce((a, x) => a + x.mp / x.cd, 0) * Tr;
  return { cheap: new Set(cheap.map(x => x.n)), free, capSoon: mp.cur + env.MP_REGEN * 6 >= mp.max, costOf: n => all.find(x => x.n === n)?.mp || env.skillMp(n), Tr };
}

async function rest(toPct, why) {   // (не используется в режиме РБ: вместо простоя — фарм мобов)
  while (env.on && env.tabOwner) {
    const me = meHp();
    if (!me || me.pct >= toPct) return true;
    env.setStatus(`${why}: HP ${me.pct | 0}% → ${toPct}%`);
    await env.sleep(2000);
  }
  return false;
}

async function keepShots() {
  const b = env.shotSlot();
  if (!b || env.shotsOn(b) || env.qty(b) === 0 || Date.now() - env.lastShotTry < 5000) return;
  env.lastShotTry = Date.now();
  console.log(env.TAG, 'соски выключены → включаю');
  env.fire(b);
  if (await env.waitFor(() => env.shotsOn(b), 2000, 100)) env.setStatus('Соски включены');
  else console.info(env.TAG, 'соски не включились');
}
 return { bar, meHp, meMp, potWatch, potInventory, hpPots, hpPotByDeficit, hpPotPick, mpPotSlot, longFightMp, rest, keepShots };
 };
})(globalThis);
