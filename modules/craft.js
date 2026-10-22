/* L2wap 20.43 (John 21.10 12:12: «взял 3 саб на крафтера, теперь мы сами научимся себе делать ресурсы»): свой крафт материалов.
   Страница игры /craft.html, вкладка «Матеріали» (craft.js игры, прочитано 21.10): GET /game/craft/materials →
   {createItemLevel, currentMp, maxMp, canCraftProfession, recipes[{code, output{itemId,nameEn,nameUk,quantity}, ingredients[{itemId,nameEn,quantity,have}],
   createItemLevel, mpCost, successChance, maxCraftable, lockedReason}]}; крафт — POST /game/craft/materials {recipeCode, craftCount, expectedRevision}
   (revision героя из GET /character; 409 — revision устарела). MP списывается mpCost × craftCount, шанс у материалов 100 %.
   Что крафтим: (1) недостающее для улучшения вещи-цели у кузнеца Маммона (mammon.craftPlan, cfg.craftMammon), (2) свой список из меню
   «скрафтить N штук» (rt.craftQueue [{id, code, nm, n}], прогресс rt.craftMade {id: штук}). Только пока активен класс крафтера (Artisan/
   Warsmith/Maestro), вне боя, с запасом MP cfg.craftMpKeep %. Выключено по умолчанию (cfg.craftAuto). Класс бот не переключает.
   20.43 (ревью 21.10): план Маммона — только по свежей сумке, перечитанной после своего крафта; ответ на крафт не пришёл (обрыв, 5xx) —
   результат неизвестен, повтора нет, пока сверка по сумке (rt.craftPending) не скажет, прошёл ли он; не во время тура РБ/эпиков/походов
   (mammon.modeFree); запас MP не ниже порога банок боя; паузы и отказы переживают переход страницы (sessionStorage). */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.craft = function create_craft(env) {
const BATCH = 100, IDLE = 5 * 60000, BUSY = 1500, MP_WAIT = 60000, FAIL_SKIP = 30 * 60000, NOTE_EVERY = 10 * 60000, PEND_WAIT = 15000, BOOK_EVERY = 30 * 60000;
const fmtA = n => Math.round(+n || 0).toLocaleString('ru');
const outId = r => +r?.output?.itemId || 0, outQ = r => Math.max(1, +r?.output?.quantity || 1), nm = r => r?.output?.nameEn || r?.output?.nameUk || r?.code || '?';
// Паузы, отказы и «сумка после крафта» — в sessionStorage вкладки: фабрика создаётся заново на каждой странице игры,
// и без этого каждый переход читал книгу, писал журнал и повторял рецепт, на который игра отказала (как опрос Маммона в 9.2.2).
const SS = 'l2bot-craft';
let mem = (() => { try { return JSON.parse(root.sessionStorage?.getItem(SS) || 'null') || {}; } catch (e) { return {}; } })();
// 20.46 (обзор 22.10): catch fetch не вызывается при уничтожении документа. Намерение пишем с ACK ДО POST;
// не подтверждённую запись результата держим отдельно от оптимистического rt до её повторного ACK.
let writing = null, busy = false;
const stamp = () => ({ char: env.rt.char, epoch: env.leaseEpoch, gen: env.actionGeneration?.(), kick: env.rt.manualKickAt || 0,
  cls: JSON.stringify([env.rt.classCur?.prof, env.rt.classCur?.slot]) });
const owner = t => env.rt.char === t.char && env.tabOwner === true && env.leaseEpoch === t.epoch;
const sameRun = t => owner(t) && env.actionGeneration?.() === t.gen && (env.rt.manualKickAt || 0) === t.kick
  && JSON.stringify([env.rt.classCur?.prof, env.rt.classCur?.slot]) === t.cls;
const active = t => owner(t) && env.on === true && env.cfg.craftAuto === true && env.actionGeneration?.() === t.gen
  && (env.rt.manualKickAt || 0) === t.kick && JSON.stringify([env.rt.classCur?.prof, env.rt.classCur?.slot]) === t.cls
  && env.role?.() === 'crafter' && !env.isBattle?.() && !env.busy?.() && env.canAct?.() !== false && env.free?.() !== false;
const same = p => !!env.rt.craftPending && (p.id ? env.rt.craftPending.id === p.id
  : env.rt.craftPending.code === p.code && env.rt.craftPending.t === p.t && env.rt.craftPending.rev === p.rev);
const requested = p => !p.qid || (env.rt.craftQueue || []).some(q => q.id === p.qid && q.code === p.code
  && (+q.n || 0) - (+env.rt.craftMade?.[q.id] || 0) >= (p.wantN ?? 1));
const S = () => { const c = env.rt.char || ''; if (mem.char !== c) mem = { char: c, nextT: 0, fails: {}, noteKey: '', noteT: 0, bagAfter: 0 }; mem.fails ||= {}; return mem; };
const save = () => { try { root.sessionStorage?.setItem(SS, JSON.stringify(mem)); } catch (e) {} };
const later = (now, ms) => { S().nextT = now + ms; save(); };
const countOf = (c, id) => (c?.inventory?.stacks || []).reduce((s, x) => s + (+x?.itemId === id ? +x.qty || 0 : 0), 0);
function queueWants() {
  const out = [], made = env.rt.craftMade || {};
  for (const q of env.rt.craftQueue || []) { const left = (+q.n || 0) - (+made[q.id] || 0); if (q?.code && left > 0) out.push({ code: q.code, id: +q.item || 0, n: left, src: 'список', qid: q.id }); }
  return out;
}
// План Маммона (mammon.goalAll) считает по сумке, поэтому верим ему только при свежей сумке, прочитанной после своего крафта:
// старая/пустая сумка = «ничего нет», и бот крафтил бы то, что уже лежит. Как и отправка крафтеру (mammon.craftWant): уровень вещи
// виден, у крафтера Skye ничего не лежит, цена уровня — от кузнеца, а не оценка. goalAll уже отдаёт полуфабрикаты первыми.
function mammonWants() {
  const c = env.cfg, r = env.rt;
  if (c.craftMammon === false || !c.mmGoalItem) return { list: [] };
  if (c.subCraftSelf === false) return { list: [], why: 'для Маммона не крафчу: снята галка «Саб крафтера: крафтить самому»' };
  const gid = +c.mmGoalItem;
  if (!((r.mmGear || []).some(x => x.id === gid) || Object.values(r.mmEq || {}).some(x => x?.[0] === gid))) return { list: [], why: 'уровень вещи-цели Маммона не виден — надень её или зайди к кузнецу' };
  if (Object.values(r.mmCraft?.at || {}).some(v => v > 0)) return { list: [], why: 'сырьё на этот крафт уже у крафтера — жду его письмо (или «↺ Забыть, что у крафтера» в «Маммоне»)' };
  const snap = env.invSnapshot?.();
  if (!snap || +snap.t <= +(S().bagAfter || 0)) return { list: [], bag: true, why: 'сумка не перечитана — для Маммона подожду' };
  const off = P => P?.lv?.some(x => x.est || x.unk);
  let P = null; try { P = env.mammon?.craftPlan?.(); if (P && !P.done && off(P)) P = env.mammon?.craftPlan?.('next'); } catch (e) { P = null; }
  if (!P || P.done) return { list: [] };
  if (off(P)) return { list: [], why: `цена ${P.name} Lv.${P.lvl} → ${P.lvl + 1} у кузнеца не видна (только оценка) — для Маммона не крафчу, зайди к кузнецу` };
  return { list: (P.craft || []).filter(x => x.qty > 0).map(x => ({ id: +x.id, n: x.qty, src: `Маммон: ${P.name} Lv.${P.lvl} → ${P.to}` })) };
}
// что нужно скрафтить: [{id (предмет), code?, n (штук готового), src, qid?}] — сначала свой список, затем цель Маммона
function wants() { return [...queueWants(), ...mammonWants().list]; }
// чистый выбор: первый рецепт из нужного, который можно сделать сейчас; иначе причина (нет навыка / сырья / маны)
function pick(book, list, keepPct = 20, now = Date.now(), skip = {}, floorMp = 0) {
  if (!book || !Array.isArray(book.recipes)) return { why: 'книга рецептов не прочитана' };
  if (!book.canCraftProfession) return { why: 'активный класс не крафтер', off: 1 };
  const lvl = +book.createItemLevel || 0, floor = Math.max(+floorMp || 0, Math.ceil((+book.maxMp || 0) * Math.max(0, Math.min(90, +keepPct || 0)) / 100));
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
const note = (key, txt) => { const s = S(), now = Date.now(); if (key === s.noteKey && now - s.noteT < NOTE_EVERY) return; s.noteKey = key; s.noteT = now; save(); env.rec('B', 'крафт', txt); };
async function readJson(path) {
  try { const r = await env.gameGet(path); if (!r?.ok) return { err: r?.status || 'сеть' }; return { j: await r.json().catch(() => null) }; }
  catch (e) { return { err: e?.name === 'AbortError' ? 'нет ответа' : e?.message || 'сеть' }; }   // обрыв GET — не ошибка главного цикла
}
async function setInfo(patch) { try { return await env.setRt(patch); } catch (e) { return null; } }
async function persist(patch, t) {
  if (!owner(t)) return false;
  const w = writing = { patch, token: t };
  const r = await setInfo(patch);
  if (r?.ok === true && writing === w) writing = null;
  return r?.ok === true && owner(t);
}
async function say(now, why, ok) { if (env.rt.craftSay?.why !== why || ok) await setInfo({ craftSay: { t: now, ...(ok ? { ok: 1 } : {}), why } }); }
// засчитать скрафченное: статистика, прогресс строки списка, журнал; сумку перечитать — план Маммона считает по ней
async function credit(now, p, how, t) {
  if (!owner(t) || !same(p)) return false;
  const patch = { craftPending: null, craftStat: { ...(env.rt.craftStat || {}), [p.code]: Math.max(+env.rt.craftStat?.[p.code] || 0, (p.stat0 ?? (+env.rt.craftStat?.[p.code] || 0)) + p.out) },
    craftSay: { t: now, ok: 1, why: `${how}${p.nm} ×${fmtA(p.out)} (${p.src})` } };
  if (p.qid) patch.craftMade = { ...(env.rt.craftMade || {}), [p.qid]: Math.max(+env.rt.craftMade?.[p.qid] || 0, (p.made0 ?? (+env.rt.craftMade?.[p.qid] || 0)) + p.out) };
  S().bagAfter = Date.now(); save();
  if (!await persist(patch, t)) return false;
  env.rec('B', 'крафт', `${how}${p.nm} ×${fmtA(p.out)}${p.mp ? ` за ${fmtA(p.mp)} MP` : ''} (${p.src})`);
  if (active(t)) try { await env.invRefresh?.(); } catch (e) {}
  return true;
}
// Ответ на POST не пришёл: игра могла скрафтить. Прежде чем крафтить снова — сверка по сумке (выход рецепта до и после) и revision героя.
// 20.43 (ревью 21.10): ждём PEND_WAIT от момента обрыва (не от начала шага). Та же revision — старый запрос ещё может дойти, поэтому
// новый крафт не шлём: повторяем ТОТ ЖЕ запрос с прежней expectedRevision — из двух сервер примет только один (как повтор заброса
// в рыбалке). Revision ушла вперёд — старый запрос уже не применится (409): выход вырос на партию — скрафчено, иначе — нет.
// Повторяющийся 5xx/обрыв: после 3 повторов — раз в 10 мин; подтверждённый «не скрафчен» после 5xx — рецепт пропускаем 30 мин,
// после обрыва связи — 5 мин (иначе сервер, который не отвечает на POST, получал бы новый крафт каждые 16 с).
const pendNote = (p, txt, end) => note((end ? 'pendEnd' : 'pend') + p.code, txt);
// отказ самого gamePost до отправки (Stop/замок, смена поколения, PvP, Life Stone, неизвестная оплата): запрос не ушёл — это не «неизвестно»
const NOT_SENT = /^(?:bot_inactive|action_cancelled|pvp_defeat_pending|payment_unconfirmed|lifestone_session_active)$/;
async function pendKeep(p, why, t) {
  if (!owner(t) || !same(p)) return false;
  const tries = (+p.tries || 0) + 1, at = Date.now();
  if (!await persist({ craftPending: { ...p, tries, t: at, err: p.err || 1 } }, t)) return true;
  later(at, tries >= 3 ? NOTE_EVERY : PEND_WAIT);
  pendNote(p, `${p.nm} ×${fmtA(p.out)}: повтор того же запроса — ${why}; результат неизвестен, новый крафт не шлю${tries >= 3 ? ', следующая сверка через 10 мин' : ''}`);
  return true;
}
async function pendNot(p, why, t) {
  if (!owner(t) || !same(p)) return false;
  const at = Date.now(), skip = p.err === 1 ? FAIL_SKIP : p.err ? IDLE : 0;
  if (skip) S().fails[p.code] = at + skip;
  if (!await persist({ craftPending: null }, t)) return true;
  later(at, BUSY);
  pendNote(p, `сверка: ${p.nm} ×${fmtA(p.out)} не скрафчен (${why}) — ${skip ? `рецепт пропускаю ${skip / 60000} мин` : 'можно повторить'}`, 1);
  return true;
}
async function reconcile(t) {
  const p = env.rt.craftPending;
  if (p.char && p.char !== t.char) return false;
  if (Date.now() - (+p.t || 0) < PEND_WAIT) { later(+p.t || Date.now(), PEND_WAIT); return false; }
  const C = await readJson('/character'), c = C.j?.character || C.j, rev = c?.revision;
  if (!active(t) || !same(p)) return false;
  if (!Number.isSafeInteger(rev) || c?.name !== t.char || !Array.isArray(c?.inventory?.stacks)) { later(Date.now(), MP_WAIT); pendNote(p, `сверка крафта ${p.nm}: герой не прочитан (${C.err || 'нет полного снимка'}) — повторю через минуту, крафт не повторяю`); return false; }
  const got = countOf(c, p.outId) - (+p.have0 || 0);
  if (rev < p.rev) { later(Date.now(), MP_WAIT); pendNote(p, `сверка крафта ${p.nm}: устаревший снимок героя — новый крафт не шлю`); return false; }
  if (rev !== p.rev) {
    if (got >= p.out) { await credit(Date.now(), p, 'сверка: скрафчено ', t); later(Date.now(), BUSY); return true; }
    // Выход могли уже потратить/передать после крафта: новая revision сама по себе не доказывает отказ.
    // Разрешаем новый заказ только при неизменных выходе, сырье и MP; иначе сохраняем неизвестный исход.
    if (got === 0 && Array.isArray(p.inputs) && p.inputs.every(x => countOf(c, x[0]) === x[1]) && c.mp === p.mp0)
      return pendNot(p, 'revision героя ушла вперёд, выход, сырьё и MP не изменились', t);
    later(Date.now(), MP_WAIT); pendNote(p, `сверка крафта ${p.nm}: revision изменилась, исход не подтверждён — новый крафт не шлю`); return false;
  }
  if (!active(t)) return false;
  // Удалённый игроком пункт не является разрешением тратить снова; старый исход продолжает сверяться по GET.
  if (!requested(p)) return false;
  // В том числе после смены хозяина: локальное наличие p не заменяет ACK его durable-копии.
  if (!await persist({ craftPending: p }, t) || !active(t) || !same(p) || !requested(p)) return false;
  let res = null, j = null;
  try { res = await env.gamePost('/game/craft/materials', { recipeCode: p.code, craftCount: p.count, expectedRevision: p.rev }); j = await res.json().catch(() => null); }
  catch (e) { if (!owner(t) || !same(p)) return false; if (NOT_SENT.test(e?.message || '')) { later(Date.now(), BUSY); return false; } return pendKeep(p, e?.name === 'AbortError' ? 'ответ не пришёл' : `обрыв (${e?.message || e})`, t); }
  if (!owner(t) || !same(p)) return false;
  if (res.status === 409) { await persist({ craftPending: { ...p, t: Date.now() - PEND_WAIT } }, t); later(Date.now(), BUSY); return true; }   // revision сменилась — сверим выход
  if (res.status >= 500) return pendKeep({ ...p, err: 1 }, `HTTP ${res.status}`, t);
  if (!res.ok) { later(Date.now(), MP_WAIT); pendNote(p, `повтор крафта ${p.nm}: игра отказала — исход первого запроса ещё сверяется`); return true; }
  delete S().fails[p.code];
  await credit(Date.now(), p, 'скрафтил ', t); later(Date.now(), BUSY); return true;
}
async function runStep(now = Date.now()) {
  if (env.cfg.craftAuto !== true || !env.on || !env.tabOwner) return false;
  if (env.role?.() !== 'crafter' || env.isBattle?.() || env.busy?.() || now < (+S().nextT || 0)) return false;   // не в бою, не на рыбалке, не перед TvT
  if (env.canAct?.() === false) return false;
  const t = stamp();
  if (writing) {
    // Старая вкладка после новой аренды не возвращает в память патч, уже завершённый другим владельцем.
    if (!sameRun(writing.token)) writing = null;
    else { await persist(writing.patch, t); return false; }
  }
  // тур РБ/эпики/РБ-сессия, служебный поход, неизвестная оплата: мана нужна там, крафт подождёт
  if (env.free && env.free() === false) return false;
  const char = env.rt.char;
  if (env.rt.craftPending?.code) return reconcile(t);
  let mm = mammonWants();
  if (mm.bag) { let m = null; try { m = await env.invRefresh?.(); } catch (e) {} if (env.rt.char !== char || !env.on) return false; if (m) mm = mammonWants(); }
  const list = [...queueWants(), ...mm.list];
  // пустой список — книгу всё равно читаем раз в 30 мин: меню показывает рецепты для выбора «скрафтить N штук»
  if (!list.length && now - (+env.rt.craftBook?.t || 0) < BOOK_EVERY) { if (mm.why) await say(now, mm.why); later(now, mm.bag ? MP_WAIT : IDLE); return false; }
  const B = await readJson('/game/craft/materials');
  if (!active(t)) return false;
  if (!B.j) { later(now, 2 * 60000); note('get', `книга рецептов не прочитана (${B.err}) — повторю через 2 мин`); return false; }
  const book = B.j;
  await setInfo({ craftBook: { t: now, lvl: +book.createItemLevel || 0, mp: +book.currentMp || 0, maxMp: +book.maxMp || 0, can: !!book.canCraftProfession,
    list: (book.recipes || []).map(r => [r.code, nm(r), outId(r), outQ(r), +r.createItemLevel || 0, +r.mpCost || 0]) } });
  if (!active(t)) return false;
  if (!list.length) { if (mm.why) await say(now, mm.why); later(now, IDLE); return false; }
  // запас MP: не меньше craftMpKeep и не ниже порога банки MP в бою (fighterMpPct + 10 %, mpPotAt) — иначе следующий бой начинается с банки
  const keep = Math.max(+(env.cfg.craftMpKeep ?? 20) || 0, (+(env.cfg.fighterMpPct ?? 25) || 0) + 10);
  const p = pick(book, list, keep, now, S().fails, +env.cfg.mpPotAt || 0);
  if (!p.r) { later(now, p.mpWait ? MP_WAIT : IDLE); const why = [p.why, mm.why].filter(Boolean).join('; '); note(why, why); await say(now, why); return false; }
  const C = await readJson('/character'), ch = C.j?.character || C.j, rev = ch?.revision;
  if (!active(t)) return false;
  if (!Number.isSafeInteger(rev) || ch?.name !== char || !Array.isArray(ch?.inventory?.stacks)) { later(now, 60000); return false; }
  const job = { id: `${Date.now()}:${Math.random().toString(36).slice(2)}`, t: Date.now(), tries: 0, char, code: p.r.code, nm: nm(p.r), count: p.count,
    out: p.out, outId: outId(p.r), have0: countOf(ch, outId(p.r)), rev, qid: p.w.qid || null, wantN: p.w.n, src: p.w.src, mp: p.mp,
    inputs: (p.r.ingredients || []).map(x => [+x.itemId, countOf(ch, +x.itemId)]), mp0: ch.mp,
    stat0: +env.rt.craftStat?.[p.r.code] || 0, made0: +env.rt.craftMade?.[p.w.qid] || 0 };
  if (!await persist({ craftPending: job }, t) || !active(t) || !same(job) || !requested(job)) return false;
  // результат неизвестен: не повторяем, пока сверка по сумке не ответит. err: 1 — 5xx, 2 — обрыв/нет ответа (пропуск после сверки 30/5 мин)
  const unknown = async (why, err = 2) => {
    const at = Date.now();                    // ожидание сверки — от момента обрыва, не от начала шага
    if (!owner(t) || !same(job)) return false;
    await persist({ craftPending: { ...job, t: at, tries: 0, err }, craftSay: { t: at, why: `${job.nm} ×${fmtA(job.out)}: ${why} — сверю по сумке, повтора нет` } }, t);
    pendNote(job, `${job.nm} ×${fmtA(job.out)}: ${why} — результат неизвестен, сверю по сумке перед повтором`);
    later(at, PEND_WAIT); return true;
  };
  let res = null, j = null;
  try { res = await env.gamePost('/game/craft/materials', { recipeCode: p.r.code, craftCount: p.count, expectedRevision: rev }); j = await res.json().catch(() => null); }
  catch (e) { if (NOT_SENT.test(e?.message || '')) { if (owner(t) && same(job)) await persist({ craftPending: null }, t); later(Date.now(), BUSY); return false; } return unknown(e?.name === 'AbortError' ? 'ответ не пришёл' : `обрыв (${e?.message || e})`); }
  if (!owner(t) || !same(job)) return false;
  // 20.46: даже первый видимый 409 мог быть wire-повтором уже применённого POST (наблюдали в Firefox).
  // Сохраняем намерение до GET, а не открываем новый заказ с новой revision.
  if (res.status === 409) { await persist({ craftPending: { ...job, t: Date.now() - PEND_WAIT } }, t); later(Date.now(), 3000); return true; }
  if (res.status >= 500) return unknown(`HTTP ${res.status}`, 1);
  if (!res.ok) {
    const msg = j?.messageRu || j?.messageUk || j?.error || `HTTP ${res.status}`;
    S().fails[p.r.code] = Date.now() + FAIL_SKIP; later(Date.now(), BUSY);
    note('fail' + p.r.code, `${nm(p.r)} ×${p.count}: игра отказала — ${msg}; этот рецепт пропускаю 30 мин`);
    if (!await persist({ craftPending: null }, t)) return true;
    await say(now, `${nm(p.r)}: ${msg}`); return true;
  }
  delete S().fails[p.r.code];
  await credit(now, job, 'скрафтил ', t);
  later(Date.now(), BUSY); return true;
}
async function step(now = Date.now()) { if (busy) return false; busy = true; try { return await runStep(now); } finally { busy = false; } }
function text() {
  const b = env.rt.craftBook, s = env.rt.craftSay, out = [];
  if (env.cfg.craftAuto !== true) out.push('Свой крафт выключен');
  if (b) out.push(`Create Item ур. ${b.lvl}${b.lvl ? '' : ' — навык не выучен, выучи у магистра'} · MP ${fmtA(b.mp)}/${fmtA(b.maxMp)} · рецептов ${b.list?.length || 0}`);
  if (s && Date.now() - s.t < 3600000) out.push(`${new Date(s.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} ${s.ok ? '✓' : '·'} ${s.why}`);
  return out.join('\n');
}
return { BATCH, wants, mammonWants, pick, step, text, reset() { mem = {}; save(); } };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
