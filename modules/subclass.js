/* L2wap 10.0.7 (игрок 13.10: «подготовь заготовку под саб крафтера и спойлера»): заготовка под сабклассы.
   Что умеет сейчас: узнаёт роль активного класса (крафтер — Artisan/Warsmith/Maestro, спойлер — Dwarven Fighter/Scavenger/Bounty Hunter/
   Fortune Seeker), слоты классов из /character (classSlots), план своего крафта по цели Маммона (вместо письма крафтеру), режим
   «помощник основного»: другой персонаж аккаунта (WestSPOIL) добывает сырьё, которого не хватает цели Маммона основного (cfg.subMainNick),
   и по кнопке передаёт его через «Передача предмета». Чего НЕ делает: не жмёт кнопки на страницах крафта (/game/craft/* бот ещё не видел),
   не берёт и не переключает сабкласс (только игрок, kb/quest-noblesse.md), ничего не покупает. Смена класса — modules/story.js (classStash). */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.subclass = function create_subclass(env) {
const ROLE = { crafter: /\b(?:artisan|warsmith|maestro)\b/i, spoiler: /\b(?:dwarven fighter|scavenger|bounty hunter|fortune seeker)\b/i };
const ROLE_RU = { crafter: 'крафтер', spoiler: 'спойлер' };
const NEED_KEY = 'subNeed', NEED_EVERY = 5 * 60000, NEED_TTL = 7 * 86400000, INFO_EVERY = 30000;
const fmtA = n => Math.round(+n || 0).toLocaleString('ru');
const profOf = () => String(env.rt.classCur?.prof || env.rt.prof || '');
const profName = p => String(p || '?').replace(/^(human|elf|dark_elf|orc|dwarf)_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const roleOf = p => { const s = String(p || '').replace(/_/g, ' '); return ROLE.crafter.test(s) ? 'crafter' : ROLE.spoiler.test(s) ? 'spoiler' : null; };
const role = () => roleOf(profOf());
const isSub = () => (+env.rt.classCur?.slot || 0) > 0;
// слоты классов героя из /character (classSlots: slots[4] {slot, owned, active, profession, race, level}, secondAndThirdUnlocked)
function charNote(ch) {
  if (ch?.name && env.rt.char && String(ch.name).toLowerCase() !== String(env.rt.char).toLowerCase()) return false;
  const cs = ch?.classSlots; if (!cs || !Array.isArray(cs.slots)) return false;
  const slots = cs.slots.filter(x => x && (x.owned || x.profession)).map(x => ({ slot: +x.slot || 0, prof: String(x.profession || ''), lvl: +x.level || 0, on: !!x.active }));
  const patch = { subSlots: slots, subUnlock: !!cs.secondAndThirdUnlocked };
  // 20.41 (замер цепочки катакомб, память 1,3 МБ: 1–2 лишние полные записи памяти на моба): хранилище Chrome отдаёт объекты с ключами
  // по алфавиту — после любой чужой записи rt (итог квоты фона, дважды на моба) слоты приходили как {lvl,on,prof,slot}, строка не совпадала
  // с {slot,prof,lvl,on}, и следующий GET /character (после каждого хода) снова писал ту же память. Сравниваем значения, не порядок ключей.
  const sig = (s, u) => JSON.stringify([s.map(x => [x?.slot, x?.prof, x?.lvl, x?.on]), u]);
  if (Array.isArray(env.rt.subSlots) && typeof env.rt.subUnlock === 'boolean' && sig(slots, patch.subUnlock) === sig(env.rt.subSlots, env.rt.subUnlock)) return false;
  env.setRt(patch);
  return true;
}
// крафтер: активный класс умеет крафтить (canCraftProfession у Artisan/Warsmith/Maestro, kb/mammon.md) — сырьё крафтеру Skye не шлём,
// план крафта показываем в меню. Сам крафт (страница /game/craft/materials) — следующий шаг, когда игрок пришлёт снимок страницы
const craftSelf = () => role() === 'crafter' && env.cfg.subCraftSelf !== false;
function craftSelfPlan() {
  if (!craftSelf()) return null;
  let P = null; try { P = env.mammon?.craftPlan?.(); } catch (e) { return null; }
  if (!P || P.done) return null;
  return { goal: `${P.name} Lv.${P.lvl} → ${P.to}`, craft: (P.craft || []).filter(c => c.qty > 0).map(c => ({ nm: c.nm, qty: c.qty, runs: c.runs, rec: c.rec })),
    miss: P.cmiss || 0, raw: (P.raw || []).filter(r => r.miss > 0).map(r => ({ nm: r.nm, miss: r.miss })) };
}
// спойлер: спойл в приоритете — точка фарма по дропу + спойлу (mammon.spoilOn через content.canSpoil), спойл в начале боя (loot.spoilStep)
const spoilFirst = () => role() === 'spoiler' && env.cfg.subSpoilFirst !== false;
// помощник основного: вкладка основного раз в 5 мин пишет в общее хранилище subNeed {nick, goal, items[[id, имя, недостача, естьВФарме]]};
// другой персонаж с cfg.subMainNick = ник основного читает её и добывает это сырьё (content.farmGoal → helpGoal), а по кнопке передаёт
const mainNick = () => String(env.cfg.subMainNick || '').trim();
const me = () => String(env.heroNick?.() || '').trim();
// 20.13 (ревизия 17.10, шаг 7, pvp-misc/SUB-1): пока ник героя не прочитан (сразу после загрузки), герой не «помощник» —
// раньше сам основной на минуту читал свою недостачу как чужую (строка «помощник: …» в журнале, цель фарма «помощь …»)
const isHelper = () => !!me() && !!mainNick() && mainNick().toLowerCase() !== me().toLowerCase();
// 10.0.14: настройки уже могли сменить основного, а пятиминутный кэш ещё принадлежит прежнему адресату.
const mainNeed = () => String(env.rt.subNeed?.nick || '').trim().toLowerCase() === mainNick().toLowerCase() ? env.rt.subNeed : null;
let needT = 0, readT = 0, infoT = 0, cacheChar = env.rt.char;
const token = () => JSON.stringify([env.rt.char || '', me(), mainNick(), env.cfg.mmGoalItem || '', env.rt.classCur || null]);
function resetPoll() { if (cacheChar !== env.rt.char) { cacheChar = env.rt.char; needT = readT = infoT = 0; } }
async function needWrite(now = Date.now()) {
  resetPoll();
  if (!env.cfg.mmGoalItem || !me() || isHelper() || now - needT < NEED_EVERY) return false;   // 20.13 (шаг 7, SUB-1): без ника — не пишем
  needT = now;
  let P = null; try { P = env.mammon?.goalAll?.(); } catch (e) { return false; }
  if (!P) return false;
  if (P.done) { await env.sharedSet(NEED_KEY, null); return true; }
  const items = (P.raw || []).filter(r => r.miss > 0 && !r.shop).map(r => [r.id, r.nm, r.miss, r.farm ? 1 : 0]);
  await env.sharedSet(NEED_KEY, { nick: me(), goal: `${P.name} до Lv.${P.to}`, items, t: now });
  return true;
}
async function needRead(now = Date.now()) {
  resetPoll();
  const T0 = token();
  if (!isHelper() || now - readT < NEED_EVERY) return false;
  readT = now;
  let v = null; try { v = await env.sharedGet(NEED_KEY); } catch (e) { v = null; }
  if (token() !== T0) return false;
  const need = v && now - (+v.t || 0) < NEED_TTL && String(v.nick || '').toLowerCase() === mainNick().toLowerCase() ? v : null;
  if (JSON.stringify(need || null) === JSON.stringify(env.rt.subNeed || null)) return false;
  await env.setRt({ subNeed: need });
  if (need) env.rec('B', 'саб', `помощник: ${need.nick} копит на ${need.goal} — не хватает ${need.items.slice(0, 6).map(x => `${x[1]} ${fmtA(x[2])}`).join(', ')}${need.items.length > 6 ? ` и ещё ${need.items.length - 6}` : ''}`);
  else env.rec('B', 'саб', `помощник: у ${mainNick()} сейчас нет цели Маммона (или его вкладка давно не писала)`);
  return true;
}
// цель фарма помощника: точка по всем недостающим сразу (mammon.farmPlanPt по списку основного)
function helpGoal() {
  if (!isHelper() || env.cfg.subHelpMain === false) return null;
  const need = mainNeed(); if (!need?.items?.length) return null;
  const raws = need.items.map(([id, nm, miss]) => ({ id: +id, nm: String(nm), miss: +miss || 0, need: +miss || 0, farm: 1 })).filter(r => r.miss > 0);
  let B = null; try { B = env.mammon?.farmPlanPt?.(null, raws); } catch (e) { return null; }
  if (!B) return null;
  return { ...B.goal, why: `помощь ${need.nick} (${need.goal}): ${B.goal.why.replace(/^Маммон: .*? — /, '')}`, help: need.nick };
}
// что из недостачи основного лежит в сумке помощника — передать (кнопка «📤 Передать основному сейчас», поход mammon.sendStep с hand: 1)
function handover() {
  if (!isHelper()) return null;
  const need = mainNeed(); if (!need?.items) return null;
  const items = need.items.map(([id, nm, miss]) => { const h = env.invQty(+id), n = Number(miss); return h > 0 && Number.isFinite(n) && n > 0 ? [+id, Math.min(h, n), String(nm)] : null; }).filter(Boolean);
  return { to: need.nick, items };
}
function handWant(now = Date.now()) {
  const R = env.rt.subHandReq; if (!R?.t) return null;
  if (now - R.t > 30 * 60000) return { drop: 'команда устарела (30 мин)' };
  if (!me()) return null;                         // 20.13 (шаг 7, SUB-1): ник ещё не прочитан — команду не снимаем, ждём
  const h = handover();
  if (!h) return { drop: isHelper() ? 'недостача выбранного основного ещё не прочитана' : 'ник основного не задан или это и есть основной' };
  if (env.invQty(0) == null) return null;         // сумка не прочитана — подождём (mmTick читает её)
  if (!h.items.length) return { drop: `в сумке нет сырья, которого не хватает ${h.to}` };
  return { kind: 'send', cmd: true, hand: 1, to: h.to, items: h.items, ret: {}, retDone: true, note: null, why: `передаю ${h.to}: ${h.items.slice(0, 6).map(x => `${x[2]} ${fmtA(x[1])}`).join(', ')}` };
}
function text() {
  const r = role(), p = profOf(), out = [];
  out.push(`Класс сейчас: ${p ? profName(p) : '?'}${isSub() ? ` (саб, слот ${env.rt.classCur.slot})` : ''}${r ? ` · роль: ${ROLE_RU[r]}` : ' · ни крафтер, ни спойлер'}`);
  const sl = env.rt.subSlots || [];
  if (sl.length) out.push(`Слоты: ${sl.map(x => `${x.slot}: ${profName(x.prof)} ${x.lvl}${x.on ? ' ✓' : ''}`).join(' · ')}${env.rt.subUnlock ? '' : ' · 2-й и 3-й саб закрыты (нужен 75 ур. первого)'}`);
  if (r === 'crafter') { const C = craftSelfPlan();
    out.push(env.cfg.subCraftSelf === false ? 'Свой крафт выключен — сырьё уйдёт крафтеру из раздела «Маммон»'
      : C ? `Свой крафт (${C.goal}): ${C.craft.map(c => `${c.nm} ${fmtA(c.qty)}`).join(', ') || 'крафтить нечего'}${C.miss ? ` · сырья не хватает ${fmtA(C.miss)}` : ''} · крафт на странице игры пока жмёшь сам` : 'Свой крафт: цель Маммона не выбрана или уже собрана'); }
  if (r === 'spoiler') out.push(spoilFirst() ? 'Спойл в приоритете: точка фарма считается по дропу + спойлу, спойл в начале каждого боя' : 'Спойл в приоритете выключен');
  if (isHelper()) { const n = mainNeed(), h = handover();
    out.push(!n ? `Помощник ${mainNick()}: его цель Маммона ещё не прочитана (его вкладка пишет её раз в 5 мин)` : `Помощник ${n.nick} (${n.goal}): не хватает ${n.items.slice(0, 6).map(x => `${x[1]} ${fmtA(x[2])}`).join(', ')}${h?.items?.length ? ` · в сумке есть ${h.items.map(x => `${x[2]} ${fmtA(x[1])}`).join(', ')} — «📤 Передать основному сейчас»` : ''}`); }
  else if (mainNick()) out.push(`Это основной персонаж (${mainNick()}): недостачу цели Маммона пишу помощнику раз в 5 мин`);
  return out.join('\n');
}
async function tick() {
  const now = Date.now(), T0 = token();
  await needWrite(now); if (token() !== T0) return;
  await needRead(now); if (token() !== T0) return;
  const r = role();
  if (r !== (env.rt.subRole ?? null)) { await env.setRt({ subRole: r }); if (r) env.rec('B', 'саб', r === 'crafter' ? `класс ${profName(profOf())} умеет крафтить: сырьё крафтеру не шлю, план крафта — в «Сабклассах»` : `класс ${profName(profOf())} — спойлер: спойл в приоритете, точка фарма по дропу + спойлу`); }
  if (now - infoT > INFO_EVERY) { infoT = now; const t = text(); if (t !== env.rt.subInfo) await env.setRt({ subInfo: t }); }
}
return { ROLE, roleOf, role, isSub, charNote, craftSelf, craftSelfPlan, spoilFirst, isHelper, helpGoal, handover, handWant, needWrite, needRead, text, tick, NEED_KEY };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
