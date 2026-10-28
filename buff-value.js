// 10.0.7 (игрок 13.10 03:07: «переоценка ценности баффов на боевую систему — как влияет шанс крита от баффа на ДПС, прогон тестов
// и вариаций»): модель ценности баффов FA для ДПС героя и кота. Раньше fa-full.js держал порядок покупки руками; теперь порядок
// считается по цифрам героя из ответа игры GET /character (rt.heroStats: M.Atk, P.Atk, шанс и сила маг./физ. крита, кот — P.Atk,
// крит 50 %, сила крита, точность 70 %) и по замерам крита в бою (rt.critStat — доля критов под каждым набором крит-баффов).
// Что известно (подсказки игры 11–13.10, замеры логов): Magnus' Chant M.Atk +30 % → урон заклинаний +13–18 % (урон ≈ √M.Atk,
// как в Interlude); Prophecy of Water — M.Atk +20 %, шанс маг. крита +100 % (×2); Berserker Lv.1 M.Atk +10 %; крит ×2,0 урона
// (magicCritDamageMultiplier 13.10); кот — P.Atk = база + 25 % M.Atk хозяина, крит всегда 50 %, ×2,44, точность 70 %; Blessing of
// Queen Lv.3 — крит кота +30 %, урон крита +25 %. Чего игра не пишет (догадки по Interlude, помечены g:1 — замер крита в бою поправит):
// Dance of Siren ×2, Wild Magic Lv.2 ×1,5, Dance of Mystic +20 % M.Atk, Empower Lv.3 +75 %… Скорость каста упёрлась в 3500, ход
// ограничен кликами (8.0.3) — каст, Atk.Spd и откат (Дар Серафима) ДПС почти не дают: «темп» ≈ +3 %.
(function (G) {
  'use strict';
  // Эффект баффа: matk/patk — множитель атаки; mcrit/crit — множитель ШАНСА маг./физ. крита; mck/ck — прибавка к силе крита
  // (доля: 0.25 = +25 % к крит-части); catCrit/catCk — то же для слуги; tempo — доля ходов, которые бафф ускоряет; g — догадка.
  const FX = {
    1413: { nm: "Magnus' Chant", matk: 1.30, cost: 5, k: 'урон' },
    1357: { nm: 'Prophecy of Water', matk: 1.20, mcrit: 2, cost: 5, k: 'урон' },
    365:  { nm: 'Dance of Siren', mcrit: 2, g: 1, k: 'урон' },
    1303: { nm: 'Wild Magic Lv.2', mcrit: 1.5, g: 1, k: 'урон' },
    273:  { nm: 'Dance of Mystic', matk: 1.20, g: 1, k: 'урон' },
    1059: { nm: 'Empower Lv.3', matk: 1.75, g: 1, k: 'урон', town: 1.30 },     // городской Lv.2 (+30 %, догадка) уже на герое
    1062: { nm: 'Berserker Lv.2', matk: 1.12, patk: 1.07, g: 1, k: 'урон', town: 1.10 },
    4703: { nm: 'Дар Серафима', tempo: 1, k: 'темп' },
    1323: { nm: 'Noblesse Blessing', keep: 1, cost: 5, k: 'защита' },
    // 20.76+ (ревизия 28.10): эффект 4699 висит и на герое (каталог FA «warrior»: физ. крит +30 %, урон крита +25 %) — воину это бафф героя;
    // раньше только catCrit/catCk → у воина без кота прибавка 0 и автонабор FA его выбрасывал. Урон мага crit/ck не считает — магу без изменений
    4699: { nm: 'Blessing of Queen Lv.3', catCrit: 0.30, catCk: 0.25, crit: 1.3, ck: 0.25, g: 1, k: 'урон' },
    // воин
    1414: { nm: "Victories of Pa'agrio", patk: 1.20, crit: 1.3, g: 1, cost: 5, k: 'урон' },
    1363: { nm: 'Chant of Victory', patk: 1.15, crit: 1.3, g: 1, cost: 5, k: 'урон' },
    1356: { nm: 'Prophecy of Fire', patk: 1.20, crit: 1.3, g: 1, cost: 5, k: 'урон' },
    1355: { nm: 'Prophecy of Wind', crit: 1.2, g: 1, cost: 5, k: 'урон' },
    1388: { nm: 'Greater Might Lv.3', patk: 1.25, g: 1, k: 'урон' },
    1068: { nm: 'Might Lv.3', patk: 1.12, g: 1, k: 'урон', town: 1.08 },
    271:  { nm: 'Dance of Warrior', patk: 1.12, g: 1, k: 'урон' },
    1077: { nm: 'Focus Lv.3', crit: 1.3, g: 1, k: 'урон', town: 1.2 },
    269:  { nm: 'Song of Hunter', crit: 1.3, g: 1, k: 'урон' },
    1242: { nm: 'Death Whisper Lv.3', ck: 0.35, g: 1, k: 'урон', town: 0.30 },
    275:  { nm: 'Dance of Fury', tempo: 1, k: 'темп' }, 1086: { nm: 'Haste Lv.2', tempo: 1, k: 'темп' },
    1240: { nm: 'Guidance Lv.3', hit: 1.02, g: 1, k: 'урон' }, 272: { nm: 'Dance of Inspiration', hit: 1.02, g: 1, k: 'урон' },
  };
  // 10.0.7 (игрок 13.10 03:27: «Magnus и Water — нет, не стакаются»): Greater-баффы баффера FA — одна группа, действует один
  // (как в Interlude: Prophecy of Fire/Water/Wind, Chant of Victory, Magnus' Chant, Victories of Pa'agrio). В наборе остаётся лучший по ДПС
  const GROUP = [1356, 1357, 1355, 1363, 1413, 1414];
  const CRIT_CAP = 0.5;           // предел шанса крита на сервере не известен (под 4 крит-баффами видели 28–43 %); выше 50 % не считаем
  const TEMPO = 0.03;             // 8.0.3: ход ≈1,1 с ограничен кликами, откат сервера ≈0,7 с — ускорение даёт ≈3 %
  const MEXP = 0.5;               // урон заклинаний ≈ √M.Atk (Magnus +30 % → +14 %, лог 11.10 01:12)
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  // ---------- цифры героя ----------
  // S = { role: 'mage'|'fighter', matk, patk, mcrit (0..1, ШАНС БЕЗ крит-баффов), mck (сила маг. крита, 2.0 = ×2), crit, ck,
  //       cat: { patk, crit, ck, acc, queen (бафф Королевы ставит сам) } | null, have: [id…] (баффы на герое сейчас),
  //       critObs: { 'id,id': { n, c } } (замер: сколько нажатий и критов под таким набором крит-баффов), tempo }
  // spell — средний урон заклинания БЕЗ крита при этом M.Atk (замер rt.skills; без замера ≈0,9 × M.Atk: Blaze 8 450 при 9 586, лог 13.10)
  const DEF = { mage: { role: 'mage', matk: 9000, patk: 1600, mcrit: 0.04, mck: 2.0, crit: 0.07, ck: 1.86, cat: { patk: 3000, crit: 0.5, ck: 2.44, acc: 0.7 } },
                fighter: { role: 'fighter', matk: 1000, patk: 3000, mcrit: 0.01, mck: 2.0, crit: 0.10, ck: 1.9, cat: null } };
  const SPELL_K = 0.9;
  const kind = role => (role && role.mage) || role === 'mage' ? 'mage' : 'fighter';
  // шанс маг. крита из /character (mCritPct) считается ВМЕСТЕ с висящими крит-баффами (13.10: 17 % под Prophecy of Water и Siren) — делим
  function baseCrit(pct, have, fx = FX) {
    let p = clamp((+pct || 0) / 100, 0, 1);
    for (const id of have || []) { const m = fx[id]?.mcrit; if (m > 1 && p > 0) p /= m; }
    return clamp(p, 0, 1);
  }
  function stats(role, hero, extra) {
    const k = kind(role), base = { ...DEF[k] };
    const h = hero || {};
    if (h.matk > 0) base.matk = h.matk; if (h.patk > 0) base.patk = h.patk;
    if (h.spell > 0) base.spell = h.spell;
    if (h.mck > 1) base.mck = h.mck; if (h.ck > 1) base.ck = h.ck;
    if (h.mcrit != null) base.mcrit = baseCrit(h.mcrit, h.buffs);
    if (h.crit != null) base.crit = clamp(h.crit / 1000, 0, 1);      // critRate 68 = 6,8 %
    base.have = Array.isArray(h.buffs) ? h.buffs.map(Number) : [];
    base.cat = h.cat === null ? null : h.cat?.patk > 0 ? { patk: h.cat.patk, crit: clamp((h.cat.crit ?? 500) / 1000, 0, 1), ck: h.cat.ck > 1 ? h.cat.ck : 2.44, acc: clamp((h.cat.acc ?? 70) / 100, 0.1, 1), queen: !!h.cat.queen } : k === 'mage' ? base.cat : null;
    return { ...base, ...(extra || {}) };
  }
  const critSig = ids => [...new Set((ids || []).map(Number).filter(id => FX[id]?.mcrit > 1))].sort((a, b) => a - b).join(',');
  // шанс маг. крита под набором баффов: замер (≥ 40 нажатий под точно таким набором) важнее модели
  function mcritOf(S, ids) {
    const sig = critSig(ids), o = S.critObs?.[sig];
    if (o && o.n >= 40) return clamp(o.c / o.n, 0, 1);
    let p = S.mcrit; for (const id of sig ? sig.split(',') : []) p *= (S.fx || FX)[id].mcrit;
    return clamp(p, 0, CRIT_CAP);
  }
  // ---------- ДПС героя + кота под набором баффов (условные единицы) ----------
  function dps(S, ids) {
    const set0 = (ids || []).map(Number), set = []; let g0 = false;
    for (const id of set0) { if (GROUP.includes(id)) { if (g0) continue; g0 = true; } set.push(id); }   // второй Greater не действует
    let matk = S.matk, patk = S.patk, crit = S.crit, ck = S.ck, hit = 1, tempo = 0, catCrit = S.cat?.crit || 0, catCk = S.cat?.ck || 0;
    const matk0 = matk;
    const FXS = S.fx || FX;
    for (const id of set) { const f = FXS[id]; if (!f) continue;
      // городской бафф того же номера уже на герое (Lv.2 под FA Lv.3) — FA даёт только разницу
      const hadTown = S.have?.includes(id) && f.town != null;
      if (f.matk) matk *= hadTown ? f.matk / f.town : f.matk;
      if (f.patk) patk *= f.patk;
      if (f.crit) crit *= hadTown ? f.crit / f.town : f.crit;
      if (f.ck) ck += hadTown ? f.ck - f.town : f.ck;
      if (f.hit) hit *= f.hit;
      if (f.tempo) tempo = 1;
      if (S.cat && !S.cat.queen) { if (f.catCrit) catCrit += f.catCrit; if (f.catCk) catCk += f.catCk; }
    }
    const mage = S.role === 'mage';
    const pm = mcritOf(S, set), spell = S.spell > 0 ? S.spell : SPELL_K * S.matk;
    const own = mage ? spell * Math.pow(matk / S.matk, MEXP) * (1 + pm * (S.mck - 1)) : patk * (1 + clamp(crit, 0, CRIT_CAP) * (ck - 1)) * hit;
    // кот: P.Atk = база + 25 % M.Atk хозяина — прибавка M.Atk кормит и его
    const cat = S.cat ? (S.cat.patk + 0.25 * (matk - matk0)) * S.cat.acc * (1 + clamp(catCrit, 0, 1) * (catCk - 1)) : 0;
    const t = 1 + (tempo ? (S.tempo ?? TEMPO) : 0);
    return { own: own * t, cat: cat * t, total: (own + cat) * t, mcrit: pm };
  }
  const costOf = (id, costFn) => +(costFn ? costFn(id) : 0) || FX[id]?.cost || 1;
  // ---------- порядок покупки: Noblesse, затем урон по прибавке ДПС на 1 FA (жадно, с учётом уже взятых), темп, защита как было ----------
  function rank(ids, S, costFn) {
    const list = [...new Set((ids || []).map(Number))], base = dps(S, []).total || 1;
    const keep = list.filter(id => FX[id]?.keep), rest = list.filter(id => !FX[id]?.keep);
    const dmg = rest.filter(id => FX[id] && FX[id].k === 'урон'), tempo = rest.filter(id => FX[id]?.k === 'темп'), other = rest.filter(id => !FX[id] || FX[id].k === 'защита');
    const out = keep.map(id => ({ id, gain: 0, per: 0, cost: costOf(id, costFn), k: 'защита' }));
    let chosen = [], cur = base;
    while (dmg.length) {
      let best = null;
      for (const id of dmg) { const v = dps(S, [...chosen, id]).total, gain = v / cur - 1, c = costOf(id, costFn), per = gain / c; if (!best || per > best.per) best = { id, gain, per, cost: c, v }; }
      if (!best) break;
      out.push({ id: best.id, gain: best.gain, per: best.per, cost: best.cost, k: 'урон' }); chosen.push(best.id); cur = best.v; dmg.splice(dmg.indexOf(best.id), 1);
    }
    for (const id of tempo) { const v = dps(S, [...chosen, id]).total, gain = v / cur - 1, c = costOf(id, costFn); out.push({ id, gain, per: gain / c, cost: c, k: 'темп' }); chosen.push(id); cur = v; }
    for (const id of other) out.push({ id, gain: 0, per: 0, cost: costOf(id, costFn), k: 'защита' });
    return out;
  }
  // что брать на бюджет FA: по порядку rank, урон с прибавкой < minGain (0,5 %) не берём — он не стоит FA
  function plan(ids, S, budget, costFn, minGain = 0.005) {
    const r = rank(ids, S, costFn), out = []; let left = budget == null ? Infinity : +budget || 0;
    for (const x of r) { if (x.k !== 'защита' && x.gain < minGain) continue; if (x.cost > left) continue; out.push(x); left -= x.cost; }
    return out;
  }
  const total = (ids, S) => dps(S, ids).total / (dps(S, []).total || 1);
  // замер крита: нажатий n, критов c под набором ids → критический статистик в rt.critStat (ключ — подпись набора)
  function obsAdd(critObs, ids, n, c) {
    const sig = critSig(ids), o = { ...(critObs || {}) }, p = o[sig] || { n: 0, c: 0 };
    const fresh = p.evidence?.v === 1 ? p.evidence : { n: 0, c: 0 };
    const evidence = { v: 1, n: fresh.n + n, c: fresh.c + c };
    if (evidence.n > 2000) { evidence.n = Math.round(evidence.n / 2); evidence.c = Math.round(evidence.c / 2); }
    o[sig] = { n: p.n + n, c: p.c + c, t: Date.now(), evidence };
    if (o[sig].n > 2000) { o[sig].n = Math.round(o[sig].n / 2); o[sig].c = Math.round(o[sig].c / 2); }   // скользящее — баффы и шмот меняются
    return o;
  }
  // ---------- обучение по снимкам /character: M.Atk и P.Atk кота под разными наборами баффов ----------
  // rt.matkObs { 'id,id' (баффы, влияющие на M.Atk): { matk, cat, lv, t } } — два снимка, отличающиеся одним баффом, дают его
  // настоящий множитель (Empower/Mystic/Magnus/Prophecy — игра цифр не пишет). Снимки одного уровня героя; при росте уровня стираются
  const matkSig = ids => [...new Set((ids || []).map(Number).filter(id => FX[id]?.matk > 1 || FX[id]?.town))].sort((a, b) => a - b).join(',');
  function snapAdd(obs, hero) {
    if (!(hero?.matk > 0)) return obs || {};
    const o = {}; for (const [k, v] of Object.entries(obs || {})) if (v.lv === hero.lv) o[k] = v;   // новый уровень — старые снимки врут
    o[matkSig(hero.buffs)] = { matk: hero.matk, cat: hero.cat?.patk || 0, lv: hero.lv, t: Date.now() };
    const keys = Object.keys(o); if (keys.length > 16) delete o[keys.sort((a, b) => o[a].t - o[b].t)[0]];
    return o;
  }
  // выученные множители M.Atk: { id: mul } — по парам снимков «набор» и «набор + id»
  function fxLearn(obs) {
    const out = {}, E = Object.entries(obs || {});
    for (const [k1, v1] of E) for (const [k2, v2] of E) {
      const a = k1 ? k1.split(',') : [], b = k2 ? k2.split(',') : [];
      if (b.length !== a.length + 1 || !a.every(x => b.includes(x))) continue;
      const id = +b.find(x => !a.includes(x)), m = v2.matk / v1.matk;
      if (m > 1.01 && m < 2.5) out[id] = Math.round(m * 1000) / 1000;
    }
    return out;
  }
  // цифры героя для бота и меню: rt.heroStats (hook hero), замер крита rt.critStat, выученные множители rt.matkObs, замер урона rt.skills
  function fromRt(rt, cfg, role) {
    const H = rt?.heroStats; if (!H) return null;
    const k = kind(role), learned = fxLearn(rt.matkObs);
    const fx = Object.keys(learned).length ? Object.fromEntries(Object.entries(FX).map(([id, f]) => [id, learned[id] ? { ...f, matk: learned[id], g: 0, L: 1 } : f])) : null;
    const S = stats(role, { ...H, cat: H.cat ? { ...H.cat, queen: k === 'mage' && cfg?.petBuffAuto !== false } : (k === 'mage' ? undefined : null) }, { critObs: Object.fromEntries(Object.entries(rt.critStat || {}).filter(([, p]) => p.evidence?.v === 1).map(([key, p]) => [key, p.evidence])), fx });
    // средний урон лучшего заклинания (замер содержит и криты — убираем их по текущему шансу)
    const best = Object.values(rt.skills || {}).filter(p => p?.damageEvidence?.v === 1 && p.damageEvidence.dmgN >= 5 && !/атака/i.test(p.name || '')).map(p => p.damageEvidence.dmg / p.damageEvidence.dmgN).sort((a, b) => b - a)[0];
    if (k === 'mage' && best > 0) { const pm = mcritOf(S, S.have); S.spell = best / (1 + pm * (S.mck - 1)); }
    return S;
  }
  const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(x * 100 >= 10 ? 0 : 1)} %`;
  G.L2BuffVal = { FX, DEF, GROUP, CRIT_CAP, TEMPO, MEXP, SPELL_K, kind, stats, baseCrit, critSig, matkSig, mcritOf, dps, rank, plan, total, obsAdd, snapAdd, fxLearn, fromRt, pct };
})(typeof globalThis !== 'undefined' ? globalThis : this);
