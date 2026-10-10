/* L2wap v7: isolated loot feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.loot = function create_loot(env) {
function spoilPick(ctx) {                         // какой спойл жать: Spoil Crush (ещё и бьёт) → Spoil → Spoil Festival
  const all = env.names(env.cfg.nSpoil).map(bn => ({ bn, b: env.slotsBy(bn)[0] })).filter(x => x.b && env.ready(x.b) && (ctx.block['spoil:' + x.bn] || 0) < Date.now());
  const rank = x => /crush/i.test(x.bn) ? 0 : /festival/i.test(x.bn) ? 2 : 1;
  return all.sort((a, b) => rank(a) - rank(b))[0] || null;
}

function massSpoilPick(ctx) {
  const list = env.names(env.cfg.nSpoilMass || ''); if (!list.length) return null;
  for (const bn of list) { const b = env.slotsBy(bn)[0]; if (b && env.ready(b) && (ctx.block['spoil:' + bn] || 0) < Date.now()) return { bn, b }; }
  return null;
}

function festivalParse(lines) {                   // → [{ name, ok, ch }] из строки «Spoil Festival: Моб: успіх (63%); Моб2: промах (51%)»
  const L = lines.find(l => /^(?:spoil festival|спойл[- ]фестиваль)\s*:/i.test(l.trim())); if (!L) return [];
  return L.replace(/^[^:]+:\s*/, '').split(/\s*;\s*/).map(part => {
    const m = part.match(/^(.+?)\s*:\s*(успіх|успех|success|ok|промах|провал|fail|miss)\s*(?:\((\d+)\s*%\))?/i);
    return m ? { name: m[1].trim(), ok: /усп|success|ok/i.test(m[2]), ch: +m[3] || 0 } : null;
  }).filter(Boolean);
}

async function massSpoilStep(ctx, act, mob) {
  if (ctx.massTried || !env.cfg.nSpoilMass || (ctx.rb && !env.cfg.spoilRb) || !mob?.max || mob.cur <= 0) return false;
  const near = env.extraMobs().filter(x => x.cur > 0).length;
  if (near < 1) return false;                        // 2+ живых моба: главный + хотя бы один рядом
  const x = massSpoilPick(ctx); if (!x) return false;
  const mp = env.meMp(), need = env.skillMp(env.cleanTitle(x.b.title)) || 0;
  if (mp && need && mp.cur < need + 20) return false;  // маны мало — обойдёмся обычным Spoil
  ctx.massTried = true;
  const before = env.logLines();
  const r = await act(x.b, `Масс-спойл: ${env.cleanTitle(x.b.title)} (мобов ${near + 1})`);
  if (r === 'unavail') { ctx.block['spoil:' + x.bn] = Infinity; env.rec('B', 'спойл', `«${env.cleanTitle(x.b.title)}»: ${env.noticeText() || 'недоступен'} — до конца боя не использую`); return true; }
  if (r === 'cd' || r === 'noforce') { ctx.massTried = false; return true; }
  await env.waitFor(() => env.mobSpoiled() || env.newLines(before, env.logLines()).some(l => env.SPOIL_OK.test(l) || env.SPOIL_FAIL.test(l)), 1500, 80);
  const fresh = env.newLines(before, env.logLines());
  // v5.5.9: игра пишет итог по каждому мобу: «Spoil Festival: Enku Orc Shaman: промах (64%); Roughly Hewn Rock Golem: успіх (51%); …»
  const res = festivalParse(fresh), mainR = res.find(x => env.nameLike(x.name, ctx.name));
  const oks = res.length ? res.filter(x => x.ok).length : fresh.filter(l => env.SPOIL_OK.test(l)).length;
  const bads = res.length ? res.filter(x => !x.ok).length : fresh.filter(l => env.SPOIL_FAIL.test(l)).length;
  if (env.mobSpoiled() || mainR?.ok || (!res.length && oks && !bads)) ctx.spoiled = true;
  const S = { ...(env.rt.spoilStat || {}) }; S.mass = (S.mass || 0) + 1; S.massOk = (S.massOk || 0) + oks; await env.setRt({ spoilStat: S });
  env.rec('B', 'спойл', `${ctx.name} +${near} рядом: масс-спойл → ${oks || bads ? `✅${oks} ✗${bads}${res.length ? ' (' + res.map(x => `${x.name} ${x.ok ? '✅' : '✗'}${x.ch ? x.ch + '%' : ''}`).join(', ') + ')' : ''}` : 'нажат'}${ctx.spoiled ? ' · главный помечен' : ' · главного добью обычным Spoil'}${fresh.length && !oks && !bads ? ' · лог: ' + fresh.slice(0, 3).join(' ⏎ ').slice(0, 160) : ''}`);
  return true;
}

async function spoilStep(ctx, act, mob) {
  if (await massSpoilStep(ctx, act, mob)) return true;
  if (!env.cfg.nSpoil || ctx.spoiled || (ctx.rb && !env.cfg.spoilRb) || !mob?.max || mob.cur <= 0) return false;
  if (env.mobSpoiled()) { ctx.spoiled = true; return false; }           // уже висит значок спойла — не жмём (раньше жали ещё раз: «моб уже заспойлений»)
  // неудача — пробуем снова, пока моб жив и не слишком побит (спойл с шансом ~50–60 %): до 4 попыток, пока HP моба > 30 %
  if ((ctx.spoilTry || 0) >= 4 || (ctx.spoilTry && mob.cur < mob.max * 0.3)) return false;
  const x = spoilPick(ctx); if (!x) return false;
  const before = env.logLines(); ctx.spoilTry = (ctx.spoilTry || 0) + 1; ctx.block['spoil:' + x.bn] = Date.now() + 700;
  const r = await act(x.b, `Спойл (${ctx.spoilTry}): ${env.cleanTitle(x.b.title)}`);
  if (r === 'unavail') { ctx.block['spoil:' + x.bn] = Infinity; env.rec('B', 'спойл', `«${env.cleanTitle(x.b.title)}»: ${env.noticeText() || 'недоступен'} — до конца боя не использую${/crush/i.test(x.bn) ? ' (Spoil Crush — только с дубиной)' : ''}`); return true; }
  if (r === 'cd' || r === 'noforce') { ctx.spoilTry--; return true; }
  await env.waitFor(() => env.mobSpoiled() || env.newLines(before, env.logLines()).some(l => env.SPOIL_OK.test(l) || env.SPOIL_FAIL.test(l)), 1500, 80);
  const fresh = env.newLines(before, env.logLines()), ok = fresh.find(l => env.SPOIL_OK.test(l)), bad = !ok && fresh.find(l => env.SPOIL_FAIL.test(l));
  const S = { ...(env.rt.spoilStat || {}) };
  if (ok || env.mobSpoiled()) { ctx.spoiled = true; S.ok = (S.ok || 0) + 1; }
  else if (bad) { S.fail = (S.fail || 0) + 1; const ch = +(bad.match(/(\d+)\s*%/) || [])[1]; if (ch) S.chance = ch; ctx.block['spoil:' + x.bn] = Date.now() + 300; }
  else if (r !== true) ctx.spoilTry--;            // нажатие не прошло (ответа нет) — попытку не считаем
  else if (!env.rt.spoilMsgKnown && ctx.spoilTry >= 2) ctx.spoiled = true;   // игра молчит (другой язык?) — после 2 нажатий считаем помеченным
  if (ok && !env.rt.spoilMsgKnown) S.known = 1;
  await env.setRt({ spoilStat: S, ...(ok && !env.rt.spoilMsgKnown ? { spoilMsgKnown: 1 } : {}) });
  env.rec('B', 'спойл', `${ctx.name}: ${ctx.spoiled ? '✅ ' + (ok || 'значок спойла').slice(0, 60) : bad ? '✗ ' + bad.slice(0, 60) + (ctx.spoilTry < 4 && mob.cur >= mob.max * 0.3 ? ' — пробую ещё' : '') : 'нажат' + (fresh.length ? ' · лог: ' + fresh.slice(0, 3).join(' ⏎ ').slice(0, 160) : '')}`
    + (S.ok || S.fail ? ` · всего ✅${S.ok || 0} ✗${S.fail || 0}${S.chance ? ' · шанс ' + S.chance + '%' : ''}` : ''));
  return true;
}

async function sweepStep(ctx) {                   // после победы: собрать спойл
  if (!ctx.spoiled) return;
  // v5.5.3: в этой игре добыча спойла приходит сама — «Спойл: Coal ×5» в логе победы. Тогда Sweeper не нужен, только учёт
  const sl = env.newLines(ctx.logStart || [], env.logLines()).map(l => l.match(env.SPOIL_LOOT)).filter(Boolean);
  if (sl.length) {
    const S = { ...(env.rt.spoilStat || {}) }, it = { ...(S.items || {}) };
    for (const m of sl) it[m[1]] = (it[m[1]] || 0) + +m[2];
    S.items = it; S.loots = (S.loots || 0) + 1; await env.setRt({ spoilStat: S });
    env.rec('B', 'спойл', `${ctx.name}: добыча спойла — ${sl.map(m => `${m[1]} ×${m[2]}`).join(', ')}`);
    return;
  }
  // 7.2 (игрок): «свип нам не нужен, это делается автоматом в игре» — Sweeper не жмём никогда (раньше без строки «Спойл: …» жал его
  // до 2 раз по ~1 с после каждой победы). Только отметка в журнале, если игра пишет, что спойл не сработал
  if (/не спрацю|не сработ/i.test(env.$q('#battle-victory-inline, #battle-victory-root')?.textContent || '')) env.rec('B', 'спойл', `${ctx.name}: игра пишет «спойл не сработал»`);
}

function resQuests() {
  return (env.cfg.resQuests || '').split('\n').map(l => l.match(/^\s*(.+?)\s*[=:×x]\s*(\d+)\s*$/i)).filter(Boolean)
    .map(m => ({ name: m[1].trim(), key: m[1].trim().toLowerCase(), need: +m[2] }));
}

function resHave(key) {
  const b = env.rt.bagSeen?.[key], got = env.rt.resGot?.[key] || 0;
  return (b?.n || 0) + got;                       // resGot обнуляется при каждом пересчёте сумки
}

async function trackLoot(lines, mob) {
  await env.itemsDb();
  const L = { ...(env.rt.loot || {}) }, S = { ...(env.rt.lootSpecial || {}) };
  const LS = { ...(env.rt.lootStat || {}) }, MK = { ...(env.rt.mobKills || {}) }, RG = { ...(env.rt.resGot || {}) };
  const mk = (mob || '?').trim();
  MK[mk] = (MK[mk] || 0) + 1;
  const rq = resQuests(), camp = env.cfg.campaign ? (env.rt.campaign?.targets || []).filter(t => t.res && !t.ok) : [];
  let campCh = false;
  let got = 0, value = 0;
  for (const l of lines) {
    if (/квест|\bEXP\b|\bSP\b|аден/i.test(l)) continue;   // 7.1.30: «SP» без границ слова выкидывал Spirit Ore / Spider Leg / Spellbook
    let m = l.match(env.SPECIAL_RE);
    if (m) { S[m[1].trim()] = (S[m[1].trim()] || 0) + +m[2]; got++; env.rec('B', 'особая добыча', `${m[1].trim()} +${m[2]}`); continue; }
    m = l.match(env.LOOT_RE);
    // 7.2: «Спойл: Coal ×5» — это Coal (раньше считался предмет «Спойл: Coal» — спойл не шёл в фарм ресурса, квесты и главу)
    if (m) m = [m[0], m[1].replace(/^\s*(?:Спойл|Spoil)\s*:?\s*/i, ''), m[2]];
    if (m && m[1].length < 64) {                   // v5.1: 40 → 64 — «Recipe: Elven Long Sword (100%)» и длинные кейматы
      L[m[1].trim()] = (L[m[1].trim()] || 0) + +m[2]; got++;
      const fk = m[1].trim().toLowerCase(), q = +m[2];
      const e = LS[m[1].trim()] ? { ...LS[m[1].trim()], k: { ...LS[m[1].trim()].k } } : { n: 0, d: 0, k: {} };
      e.n += q; e.d++; e.k[mk] = (e.k[mk] || 0) + q;
      if (Object.keys(e.k).length > 12) delete e.k[Object.entries(e.k).sort((a, b) => a[1] - b[1])[0][0]];
      LS[m[1].trim()] = e;
      const r = rq.find(x => x.key === fk);
      if (r) {
        const before = resHave(fk); RG[fk] = (RG[fk] || 0) + q;
        if (before < r.need && before + q >= r.need) env.rec('B', 'квест', `📦 ${r.name}: ${before + q}/${r.need} — собрано!`);
      }
      const ct = camp.find(t => t.name.toLowerCase() === fk);     // ресурс главы («Нужно сдать») — прибавляем сразу, не ждём проверки главы
      if (ct) { ct.done = Math.min(ct.total, ct.done + q); ct.est = true; campCh = true; if (ct.done >= ct.total) { ct.ok = true; env.rec('B', 'кампания', `${ct.name}: ${ct.done}/${ct.total} — собрано, иду сдавать`); } }
      if (env.cfg.farmRes && fk === env.cfg.farmRes.trim().toLowerCase()) {
        const fg = { ...(env.rt.farmGot || {}) }; fg[fk] = (fg[fk] || 0) + +m[2]; await env.setRt({ farmGot: fg });
        if (env.cfg.farmNeed && fg[fk] >= env.cfg.farmNeed && fg[fk] - +m[2] < env.cfg.farmNeed) env.rec('B', 'фарм', `${m[1].trim()}: собрано ${fg[fk]}/${env.cfg.farmNeed} — цель выполнена`);
      }
      if (env.cfg.recipeRes && env.recipeKey(fk) === env.recipeKey(env.cfg.recipeRes)) {   // охота на рецепт: считаем выпавшие
        const rg = { ...(env.rt.recipeGot || {}) }, rk = env.recipeKey(fk); rg[rk] = (rg[rk] || 0) + q; await env.setRt({ recipeGot: rg });
        env.rec('B', 'рецепт', `📜 ${m[1].trim()} +${q} (всего ${rg[rk]}${env.cfg.recipeNeed ? '/' + env.cfg.recipeNeed : ''})`);
      }
      const it = env.itemOf(m[1].trim());
      if (it?.pr) value += Math.floor(it.pr / 2) * +m[2];
    }
  }
  if (Object.keys(LS).length > 120) for (const [k] of Object.entries(LS).sort((a, b) => a[1].n - b[1].n).slice(0, 20)) delete LS[k];
  if (Object.keys(MK).length > 120) for (const [k] of Object.entries(MK).sort((a, b) => a[1] - b[1]).slice(0, 20)) delete MK[k];
  const patch = { lootStat: LS, mobKills: MK, lootStatT0: env.rt.lootStatT0 || Date.now() };
  const cap = (o, n) => { const k = Object.keys(o); if (k.length <= n) return o; return Object.fromEntries(Object.entries(o).sort((a, b) => (b[1]?.n || 0) - (a[1]?.n || 0)).slice(0, n)); };   // v5.6: без бесконечного роста
  if (got) Object.assign(patch, { loot: cap(L, 200), lootSpecial: cap(S, 120), lootValue: (env.rt.lootValue || 0) + value, resGot: RG });
  if (campCh) Object.assign(patch, { campaign: { ...env.rt.campaign, live: Date.now() }, campaignDue: env.rt.campaign.targets.some(t => t.res && t.ok && t.est) || env.rt.campaignDue });
  await env.setRt(patch);
}
 return { spoilPick, massSpoilPick, festivalParse, massSpoilStep, spoilStep, sweepStep, resQuests, resHave, trackLoot };
 };
})(globalThis);
