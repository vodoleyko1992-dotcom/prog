/* L2wap 20.43 (John 21.10 12:12: «взял 3 саб на крафтера, теперь мы сами научимся себе делать ресурсы»): свой крафт материалов.
   Страница игры /craft.html, вкладка «Матеріали» (craft.js игры, прочитано 21.10): GET /game/craft/materials →
   {createItemLevel, currentMp, maxMp, canCraftProfession, recipes[{code, output{itemId,nameEn,nameUk,quantity}, ingredients[{itemId,nameEn,quantity,have}],
   createItemLevel, mpCost, successChance, maxCraftable, lockedReason}]}; крафт — POST /game/craft/materials {recipeCode, craftCount, expectedRevision}
   (revision героя из GET /character; 409 — revision устарела). MP списывается mpCost × craftCount, шанс у материалов 100 %.
   Что крафтим: (1) недостающее для улучшения вещи-цели у кузнеца Маммона (mammon.craftPlan, cfg.craftMammon), (2) свой список из меню
   «скрафтить N штук» (rt.craftQueue [{id, code, nm, n}], прогресс rt.craftMade {id: штук}). Только пока активен класс крафтера (Artisan/
   Warsmith/Maestro), вне боя, с запасом MP cfg.craftMpKeep %. Выключено по умолчанию (cfg.craftAuto). Класс бот не переключает. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.craft = function create_craft(env) {
const BATCH = 100, IDLE = 5 * 60000, BUSY = 1500, MP_WAIT = 60000, FAIL_SKIP = 30 * 60000, NOTE_EVERY = 10 * 60000;
const fmtA = n => Math.round(+n || 0).toLocaleString('ru');
let nextT = 0, noteKey = '', noteT = 0, fails = {};
const outId = r => +r?.output?.itemId || 0, outQ = r => Math.max(1, +r?.output?.quantity || 1), nm = r => r?.output?.nameEn || r?.output?.nameUk || r?.code || '?';
// что нужно скрафтить: [{id (предмет), code?, n (штук готового), src, qid?}] — сначала свой список, затем цель Маммона.
// План Маммона (mammon.goalAll) уже учёл сумку: craft — только недостающее; глубокие промежуточные стоят позже — идём с конца,
// чтобы сперва делать полуфабрикаты (Varnish of Purity раньше Mithril Alloy)
function wants() {
  const out = [], made = env.rt.craftMade || {};
  for (const q of env.rt.craftQueue || []) { const left = (+q.n || 0) - (+made[q.id] || 0); if (q?.code && left > 0) out.push({ code: q.code, id: +q.item || 0, n: left, src: 'список', qid: q.id }); }
  if (env.cfg.craftMammon !== false && env.cfg.mmGoalItem) {
    let P = null; try { P = env.mammon?.craftPlan?.(); } catch (e) { P = null; }
    if (P && !P.done) for (const c of [...(P.craft || [])].reverse()) if (c.qty > 0) out.push({ id: +c.id, n: c.qty, src: `Маммон: ${P.name} Lv.${P.lvl} → ${P.to}` });
  }
  return out;
}
// чистый выбор: первый рецепт из нужного, который можно сделать сейчас; иначе причина (нет навыка / сырья / маны)
function pick(book, list, keepPct = 20, now = Date.now(), skip = {}) {
  if (!book || !Array.isArray(book.recipes)) return { why: 'книга рецептов не прочитана' };
  if (!book.canCraftProfession) return { why: 'активный класс не крафтер', off: 1 };
  const lvl = +book.createItemLevel || 0, floor = Math.ceil((+book.maxMp || 0) * Math.max(0, Math.min(90, +keepPct || 0)) / 100);
  const mpFree = Math.max(0, (+book.currentMp || 0) - floor), why = [];
  let mpWait = false;
  for (const w of list) {
    const r = book.recipes.find(x => w.code ? x.code === w.code : outId(x) === w.id);
    if (!r) { why.push(`${w.code || '#' + w.id}: рецепта нет в книге`); continue; }
    if (skip[r.code] > now) { why.push(`${nm(r)}: ошибка игры, повтор позже`); continue; }
    if ((+r.createItemLevel || 0) > lvl || (r.lockedReason && lvl < 1)) { why.push(`${nm(r)}: нужен Create Item ур. ${r.createItemLevel || 1} (сейчас ${lvl})`); continue; }
    if (r.lockedReason && !(+r.maxCraftable > 0)) { why.push(`${nm(r)}: ${r.lockedReason}`); continue; }
    const runs = Math.ceil(w.n / outQ(r)), max = Math.max(0, Math.floor(+r.maxCraftable || 0)), mp = Math.max(1, +r.mpCost || 1);
    if (max < 1) { const lack = (r.ingredients || []).filter(i => (+i.have || 0) < (+i.quantity || 0)).map(i => i.nameEn || i.nameUk || '#' + i.itemId);
      why.push(`${nm(r)}: не хватает ${lack.join(', ') || 'сырья'}`); continue; }
    const byMp = Math.floor(mpFree / mp);
    if (byMp < 1) { mpWait = true; why.push(`${nm(r)}: жду ману (${mp} MP за штуку, запас ${floor} MP)`); continue; }
    const count = Math.min(runs, max, byMp, BATCH);
    return { r, count, w, out: count * outQ(r), mp: count * mp };
  }
  return { why: why.join('; ') || 'крафтить нечего', mpWait };
}
const note = (key, txt) => { const now = Date.now(); if (key === noteKey && now - noteT < NOTE_EVERY) return; noteKey = key; noteT = now; env.rec('B', 'крафт', txt); };
async function readJson(path) { const r = await env.gameGet(path); if (!r?.ok) return { err: r?.status || 'сеть' }; return { j: await r.json().catch(() => null) }; }
async function setInfo(patch) { try { await env.setRt(patch); } catch (e) {} }
async function step(now = Date.now()) {
  if (env.cfg.craftAuto !== true || !env.on || !env.tabOwner) return false;
  if (env.role?.() !== 'crafter' || env.isBattle?.() || env.busy?.() || now < nextT) return false;   // не в бою, не на рыбалке, не перед TvT
  if (env.canAct?.() === false) return false;
  // пустой список — книгу всё равно читаем раз в 30 мин: меню показывает рецепты для выбора «скрафтить N штук»
  const list = wants(); if (!list.length && now - (+env.rt.craftBook?.t || 0) < 30 * 60000) { nextT = now + IDLE; return false; }
  const char = env.rt.char;
  const B = await readJson('/game/craft/materials');
  if (env.rt.char !== char || !env.on) return false;
  if (!B.j) { nextT = now + 2 * 60000; note('get', `книга рецептов не прочитана (${B.err}) — повторю через 2 мин`); return false; }
  const book = B.j;
  await setInfo({ craftBook: { t: now, lvl: +book.createItemLevel || 0, mp: +book.currentMp || 0, maxMp: +book.maxMp || 0, can: !!book.canCraftProfession,
    list: (book.recipes || []).map(r => [r.code, nm(r), outId(r), outQ(r), +r.createItemLevel || 0, +r.mpCost || 0]) } });
  if (!list.length) { nextT = now + IDLE; return false; }
  const p = pick(book, list, env.cfg.craftMpKeep ?? 20, now, fails);
  if (!p.r) { nextT = now + (p.mpWait ? MP_WAIT : IDLE); note(p.why, p.why); await setInfo({ craftSay: { t: now, why: p.why } }); return false; }
  const C = await readJson('/character'), rev = C.j?.character?.revision ?? C.j?.revision;
  if (env.rt.char !== char || !env.on) return false;
  if (rev == null) { nextT = now + 60000; return false; }
  let res = null, j = null;
  try { res = await env.gamePost('/game/craft/materials', { recipeCode: p.r.code, craftCount: p.count, expectedRevision: rev }); j = await res.json().catch(() => null); }
  catch (e) { nextT = now + 60000; note('post', `крафт ${nm(p.r)} не отправлен (${e?.message || e}) — повторю через минуту`); return false; }
  if (res.status === 409) { nextT = now + 3000; return true; }      // revision устарела — сразу перечитаем
  if (!res.ok) {
    const msg = j?.messageRu || j?.messageUk || j?.error || `HTTP ${res.status}`;
    fails[p.r.code] = now + FAIL_SKIP; nextT = now + BUSY;
    note('fail' + p.r.code, `${nm(p.r)} ×${p.count}: игра отказала — ${msg}; этот рецепт пропускаю 30 мин`);
    await setInfo({ craftSay: { t: now, why: `${nm(p.r)}: ${msg}` } }); return true;
  }
  delete fails[p.r.code];
  const patch = { craftSay: { t: now, ok: 1, why: `скрафтил ${nm(p.r)} ×${fmtA(p.out)} (${p.w.src})` }, craftStat: { ...(env.rt.craftStat || {}), [p.r.code]: (+env.rt.craftStat?.[p.r.code] || 0) + p.out } };
  if (p.w.qid) patch.craftMade = { ...(env.rt.craftMade || {}), [p.w.qid]: (+env.rt.craftMade?.[p.w.qid] || 0) + p.out };
  await setInfo(patch);
  env.rec('B', 'крафт', `${nm(p.r)} ×${fmtA(p.out)} за ${fmtA(p.mp)} MP (${p.w.src})`);
  try { await env.invRefresh?.(); } catch (e) {}                 // план Маммона считает по сумке — перечитываем её после крафта
  nextT = Date.now() + BUSY; return true;
}
function text() {
  const b = env.rt.craftBook, s = env.rt.craftSay, out = [];
  if (env.cfg.craftAuto !== true) out.push('Свой крафт выключен');
  if (b) out.push(`Create Item ур. ${b.lvl}${b.lvl ? '' : ' — навык не выучен, выучи у магистра'} · MP ${fmtA(b.mp)}/${fmtA(b.maxMp)} · рецептов ${b.list?.length || 0}`);
  if (s && Date.now() - s.t < 3600000) out.push(`${new Date(s.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} ${s.ok ? '✓' : '·'} ${s.why}`);
  return out.join('\n');
}
return { BATCH, wants, pick, step, text, reset() { nextT = 0; fails = {}; } };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
