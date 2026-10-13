/* L2wap 10.0.5: чемпионы ради Fast Aden — оценка «по силам и по времени» до боя, проба, отход из боя, обучение.
   Только расчёты и память (rt.champLearn); кнопки жмёт combat, цели выбирает mobfarm. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.champs = function create_champs(env) {
// Игрок 13.10 00:38: «автопоиск чемпионов раз в 20 убитых мобов, анализ кого мы можем убить, а кого нет, автообучение этому, проба тогда,
// когда предположительно мы можем убить чемпиона, и отход, если мы его не пробиваем или его бить нецелесообразно по времени — по отношению
// к фарму ФА… и проба бить чемпионов, когда сила возрастает».
// Выгода: чемпион стоит столько секунд обычного фарма, сколько нужно, чтобы набрать его EXP (EXP ÷ EXP/с зоны) и его FA (шанс × время на
// 1 FA с обычных мобов = время на моба ÷ 1 %). Пример Warlock 66, Wild Beast Pastures: обычный моб ≈8,4 тыс. EXP за ≈1,5 с → красный
// (250 тыс. EXP, FA 60 %) окупается за ≈45 + 0,6 × 150 ≈ 135 с боя, оранжевый ≈64 с, синий ≈38 с. Дольше — невыгодно, бот не идёт или уходит.
const FA_P = { blue: 0.1, orange: 0.2, red: 0.6 }, FA_MOB = 0.01;
const T_DEF = { blue: 40, orange: 70, red: 120 };     // предел боя, пока своего темпа фарма нет, с
const TIER_RU = { blue: 'синий', orange: 'оранжевый', red: 'красный' };
const L = () => env.heroLvl?.() || env.rt.lvl || 0;
const mem = () => env.rt.champLearn || {};
// «сила» — уровень героя и урон по долгим целям (ДПС по РБ, иначе общий): по ней видно, что стало сильнее (уровень, шмот, тату, баффы)
const powNow = () => ({ lvl: L(), base: Math.round(env.rt.rbDps || env.rt.dps?.dps || 0) });
function grown(p) {
  if (!p) return true;
  const n = powNow();
  return !!((n.lvl && p.lvl && n.lvl > p.lvl) || (n.base > 0 && p.base > 0 && n.base >= p.base * 1.15));
}
// свой ДПС по чемпионам (замер боёв, приведён к нынешней силе); без замера — ДПС по РБ или общий (тогда только проба)
function dpsOn() {
  const m = mem().dps, n = powNow();
  if (m?.dps > 0) {
    const kb = m.base > 0 && n.base > 0 ? Math.min(2, Math.max(0.5, n.base / m.base)) : 1;
    return { dps: m.dps * kb, known: true };
  }
  return { dps: env.rt.rbDps || env.rt.dps?.dps || 0, known: false };
}
// предел боя с этим чемпионом, с: сколько стоит он в секундах обычного фарма (EXP + FA)
function limitS(c) {
  const r = env.farmRate?.(), p = c.fa != null ? c.fa : FA_P[c.tier] ?? FA_P.blue;
  if (!r || !(r.eps > 0) || !(r.sk > 0) || !(c.exp > 0)) return T_DEF[c.tier] || T_DEF.blue;
  return Math.round(Math.max(15, Math.min(300, c.exp / r.eps + p * r.sk / FA_MOB)));
}
// решение до боя: { ok, probe, eta, lim, why }
function judge(c) {
  const tier = TIER_RU[c.tier] ? c.tier : 'blue', lim = limitS(c), gap = (c.lvl || 0) - L();
  const v = mem().v?.[tier];
  if (v && gap >= (v.gap ?? -99) && !grown(v.pow)) return { ok: false, lim, why: `${v.why} — жду роста силы (ур. ${v.pow?.lvl || '?'}, урон ${v.pow?.base || '?'})` };
  const d = dpsOn();
  if (!(c.hp > 0) || !(d.dps > 0)) return { ok: true, probe: true, lim, why: 'цифр нет — проба' };
  const eta = Math.round(c.hp / d.dps + 2);
  if (eta <= lim) return { ok: true, probe: !d.known, eta, lim, why: d.known ? '' : 'своего замера нет — проба' };
  // «предположительно можем»: без своего замера ДПС по РБ/общий занижен (одиночные мобы падают с одного удара) — проба до 2× предела
  if (!d.known && eta <= lim * 2) return { ok: true, probe: true, eta, lim, why: 'проба' };
  return { ok: false, eta, lim, why: `≈${eta} с на бой при пределе ${lim} с` };
}
// в бою (раз в ход): уйти? → null | { kind: 'danger'|'weak'|'slow', why }
function fleeCheck(ctx, me, mob, sec) {
  if (!ctx.champ || ctx.rb || !mob?.max || !(mob.cur > 0) || sec < 6) return null;
  const done = Math.max(0, (ctx.chHp0 || mob.max) - mob.cur), left = mob.cur / mob.max, lim = ctx.chLim || T_DEF[ctx.tier] || T_DEF.blue;
  if (me && me.pct < 30 && left > 0.35) return { kind: 'danger', why: `моё HP ${Math.round(me.pct)} %, у чемпиона ${Math.round(left * 100)} %` };
  if (sec >= 8 && done < mob.max * 0.03) return { kind: 'weak', why: `не пробиваю: за ${Math.round(sec)} с снято ${Math.round(done / mob.max * 100)} %` };
  const eta = sec + mob.cur / Math.max(done / sec, 1);
  if (sec >= 10 && eta > lim * 1.3 && left > 0.25) return { kind: 'slow', why: `бой ≈${Math.round(eta)} с при пределе ${lim} с — невыгодно против обычного фарма` };
  return null;
}
// после боя или отхода: замер ДПС, итог по цвету, вердикт (отход/смерть — до роста силы), удача снимает вердикт
async function learn(ctx, outcome, dealt, sec) {
  if (!ctx?.champ || ctx.rb) return null;
  const tier = TIER_RU[ctx.tier] ? ctx.tier : 'blue', M = { ...mem() }, pw = powNow();
  if (sec >= 4 && dealt > 0) {
    const dps = dealt / sec, o = M.dps, od = o?.dps > 0 ? dpsOn().dps : 0;
    M.dps = { dps: Math.round(od > 0 ? od * 0.6 + dps * 0.4 : dps), base: pw.base || null, lvl: pw.lvl || null, n: (o?.n || 0) + 1 };
  }
  const S = { ...(M.st || {}) }, s = { ...(S[tier] || {}) };
  s[outcome] = (s[outcome] || 0) + 1;
  if (outcome === 'win') s.sec = +(s.sec ? s.sec * 0.7 + sec * 0.3 : sec).toFixed(1);
  S[tier] = s; M.st = S;
  const V = { ...(M.v || {}) }, gap = (ctx.lvl || 0) - L();
  if (outcome === 'win' && V[tier] && gap >= (V[tier].gap ?? -99)) delete V[tier];
  if (['death', 'danger', 'weak', 'slow'].includes(outcome)) {
    const why = outcome === 'death' ? 'погиб в бою' : outcome === 'danger' ? 'отход: мало HP' : outcome === 'weak' ? 'не пробиваю' : 'слишком долго';
    V[tier] = { t: Date.now(), why: `${TIER_RU[tier]} ${ctx.lvl ? ctx.lvl + ' ур.' : ''}: ${why}`.trim(), gap: Math.min(gap, V[tier]?.gap ?? 99), pow: pw };
  }
  M.v = V;
  await env.setRt({ champLearn: M });
  return M;
}
const tierRu = t => TIER_RU[t] || TIER_RU.blue;
 return { FA_P, FA_MOB, T_DEF, TIER_RU, tierRu, powNow, grown, dpsOn, limitS, judge, fleeCheck, learn };
 };
})(globalThis);
