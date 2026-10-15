/* L2wap 9.0: сюжетные квесты сабкласса (Fate's Whisper / Mimir's Elixir) и Noblesse (Possessor of a Precious Soul) + смена класса.
   Прогресс — из ответов игры (страницы карты и квестов сами опрашивают /game/story-quests/*) и своим GET раз в 10 мин.
   Бот сам только СДАЁТ готовую часть у NPC (кнопка «Завершити частину» / «Завершити квест», телепорт к NPC за адену в пределах лимита).
   Взять квест, выбрать или переключить сабкласс — только игрок (kb/quest-noblesse.md). FA и Coin of Luck не тратятся. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.story = function create_story(env) {
const location = env.routeLocation || root.location;
// 9.0 (новости игры 11.10, API 11.10 14:30): POST <root>/<accept|advance|complete|teleport> {expectedRevision, targetId} — жмём кнопки страницы,
// как игрок; ★ квестовых мобов на карте игра ставит сама (map-profession-quest-markers.js опрашивает и noblesse, и subclass)
const Q = {
  noblesse: { root: '/game/story-quests/noblesse', page: '/noblesse-quest.html', act: 'noblesse', name: 'Noblesse', done: 'advance' },
  subclass: { root: '/game/story-quests/subclass', page: '/subclass-quest.html', act: 'subclass', name: 'сабкласс', done: 'complete' },
};
const POLL = 10 * 60000, JOB_MAX = 4 * 60000, RETRY = 30 * 60000;
// 9.0: всё, что зависит от класса (скиллы и их замеры, кот, дебаффы, EXP/ч зон, вердикты РБ «по силам») — у каждого класса своё.
// При переключении класса эти ключи памяти уходят в rt.classStash[<старый класс>] и возвращаются из stash нового (или пустые)
const CLASS_KEYS = ['skills', 'skillDb', 'petStat', 'petAdvice', 'petLast', 'petBuffAt', 'petResummon', 'debuffStat', 'debuffGain', 'debuffImmune',
  'zoneStat', 'mobVal', 'rbDb', 'rbK', 'rbDpsSample', 'hardMobs', 'profQuest', 'fightMem', 'fightLast', 'fightGroups'];   // 15.10: модель групповых атак тоже принадлежит классу
// 10.0 (аудит ядра): метка опроса — в sessionStorage, иначе 2 GET на каждой загрузке страницы (как Маммон в 9.2.2)
const ssNum = k => { try { return +sessionStorage.getItem(k) || 0; } catch (e) { return 0; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, String(v)); } catch (e) {} };
let pollT = ssNum('l2bot-storyPollT');
const fmtA = n => Math.round(+n || 0).toLocaleString('ru');
const low = s => String(s || '').trim().toLowerCase();
// ответ игры → короткая запись rt.story[kind]
function norm(kind, q) {
  if (!q || typeof q !== 'object') return null;
  if (kind === 'noblesse') {
    const tg = (Array.isArray(q.targets) ? q.targets : []).filter(t => t?.name).map(t => ({ name: String(t.name), lvl: +t.level || 0, have: +t.have || 0, need: +t.need || 0, tp: t.teleportId || '' }));
    // 14.10 (полный аудит, noblesse-quest.js): canAdvance включает близость NPC. Готовую часть надо сначала отвезти к нему;
    // на основном/слабом сабе не едем. Пустой список нормален только у финальной беседы (часть 4).
    const readyAway = +q.part > 0 && !q.completed && q.subclassLevel != null && +q.subclassLevel >= (+q.minLevel || 50)
      && (tg.length > 0 || +q.part === 4) && tg.every(t => t.need > 0 && t.have >= t.need);
    return { part: +q.part || 0, of: +q.totalParts || 4, active: !!q.active || +q.part > 0, completed: !!q.completed, sub: q.subclassLevel ?? null, min: +q.minLevel || 0,
      targets: tg, ready: !!q.actions?.canAdvance || readyAway, canAccept: !!q.actions?.canAccept, atNpc: !!q.atNpc, npc: q.npc?.name || '', npcTp: q.npc?.teleportId || '' };
  }
  const bosses = (Array.isArray(q.bosses) ? q.bosses : []).filter(b => b?.spawnId).map(b => ({ id: String(b.spawnId), name: String(b.name || b.spawnId), lvl: +b.level || 0, done: !!b.done }));
  const st = String(q.stage || ''), ret = st === 'return_to_ladd';
  return { stage: st, active: !!st && st !== 'not_started', completed: !!q.completed || st === 'completed', min: +q.minLevel || 0, bosses,
    ready: !!q.actions?.canComplete || ret, canAccept: !!q.actions?.canAccept, atNpc: ret ? !!q.location?.atLadd : !!q.location?.atReorin,
    npc: ret ? q.npc?.ladd?.name || 'Magister Ladd' : q.npc?.reorin?.name || 'Maestro Reorin', npcTp: (ret ? q.npc?.ladd?.teleportId : q.npc?.reorin?.teleportId) || '' };
}
const sigOf = s => JSON.stringify([s.part, s.stage, s.completed, s.ready, s.canAccept, s.atNpc, (s.targets || []).map(t => `${t.name}:${t.have}/${t.need}`), (s.bosses || []).map(b => b.id + (b.done ? '+' : ''))]);
const line = (kind, s) => kind === 'noblesse'
  ? (s.completed ? 'квест Noblesse пройден 👑' : !s.active ? `не взят${s.canAccept ? ' (можно взять у Virgil в Rune)' : ''}` : `часть ${s.part}/${s.of}: ${s.targets.map(t => `${t.name} ${t.have}/${t.need}`).join(', ') || 'поговорить с ' + s.npc}${s.ready ? ' — готово, сдать ' + s.npc : ''}`)
  : (s.completed ? 'квест сабкласса пройден — выбери класс в «Персонаж → Сабклассы»' : !s.active ? `не взят${s.canAccept ? ' (можно взять у Maestro Reorin)' : ` (нужен ${s.min || 75} ур.)`}`
    : s.stage === 'hunt_bosses' ? `РБ: ${s.bosses.map(b => `${b.done ? '✓' : '★'} ${b.name} ${b.lvl}`).join(', ')}` : `вернуться к ${s.npc}${s.ready ? ' — готово' : ''}`);
// ★-цели квеста (имена в нижнем регистре): ★ на карте снимать нельзя, пока квест их ждёт
function openNames() {
  const n = env.rt.story?.noblesse;
  return n?.active && !n.completed ? n.targets.filter(t => t.have < t.need).map(t => low(t.name)) : [];
}
// РБ квестов (spawnId), которые ещё нужны: 4 босса сабкласса и РБ части Noblesse (имя → rbList)
function rbIds() {
  const S = env.rt.story || {}, out = new Set();
  if (S.subclass?.stage === 'hunt_bosses') for (const b of S.subclass.bosses) if (!b.done) out.add(b.id);
  const names = openNames();
  if (names.length) for (const [id, x] of Object.entries(env.rt.rbList || {})) if (names.includes(low(x.name))) out.add(id);
  return [...out];
}
function qNote(kind, q) {
  if (!Q[kind]) return null;
  const s = norm(kind, q);
  if (!s) return null;
  const now = Date.now(), prev = env.rt.story?.[kind], sig = sigOf(s);
  if (prev?.sig === sig && now - (prev.t || 0) < POLL) return s;   // игра опрашивает часто — пишем при изменении или раз в 10 мин
  env.setRt({ story: { ...(env.rt.story || {}), [kind]: { ...s, sig, t: now } } });
  if (prev?.sig !== sig) env.rec('B', 'квест', `${Q[kind].name}: ${line(kind, s)}`);
  return s;
}
// /character: свой Noblesse (скилл 1323 на всех классах) и активный класс
function charNote(ch) {
  if (!ch || typeof ch !== 'object') return;
  if ('noblesse' in ch && !!ch.noblesse !== !!env.rt.story?.nobleOwn) {
    env.setRt({ story: { ...(env.rt.story || {}), nobleOwn: !!ch.noblesse } });
    if (ch.noblesse) env.rec('B', 'квест', 'статус Noblesse получен 👑: Noblesse Blessing (1323) свой — за FA больше не покупаю; поставь его на панель боя, бот будет держать его как бафф');
  }
  // 9.2: ветка класса (mystic/fighter) — профиль боя незнакомой профессии (content.combatProfileKind)
  if (ch.classBranch && String(ch.classBranch) !== env.rt.classBranch) env.setRt({ classBranch: String(ch.classBranch).slice(0, 20) });
  const cs = ch.classSlots, slot = cs && Number.isFinite(+cs.activeSlot) ? +cs.activeSlot : null;
  const prof = ch.l2Profession || (slot != null && cs.slots?.find?.(x => +x?.slot === slot)?.profession) || '';
  if (prof) classNote(String(prof), slot, +ch.level || 0);
}
const profName = p => String(p || '?').replace(/^(human|elf|dark_elf|orc|dwarf)_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
function classNote(prof, slot, lvl) {
  const cur = env.rt.classCur;
  if (cur?.prof === prof) { if (slot != null && cur.slot !== slot) env.setRt({ classCur: { ...cur, slot } }); return false; }
  if (!cur?.prof) { env.setRt({ classCur: { prof, slot, t: Date.now() } }); return false; }   // первый раз — просто запоминаем
  const stash = { ...(env.rt.classStash || {}) }, mine = {};
  for (const k of CLASS_KEYS) if (env.rt[k] != null) mine[k] = env.rt[k];
  stash[cur.prof] = { ...mine, t: Date.now() };
  const back = stash[prof] || {}, patch = {};
  for (const k of CLASS_KEYS) patch[k] = back[k] ?? null;
  delete stash[prof];
  // баффы сняты и кот отозван сменой класса, а не смертью: снимок платных баффов и «длинные» баффы шапки — заново (не «смерть сняла…»)
  Object.assign(patch, { classStash: stash, classCur: { prof, slot, t: Date.now() }, classSwT: Date.now(), faSnap: null, hudLong: {}, zone: null, zonePend: null });
  env.setRt(patch);
  try { sessionStorage.setItem('l2bot.classSw', String(Date.now())); } catch (e) {}
  env.classSwitched?.();
  env.rec('B', 'класс', `смена класса: ${profName(cur.prof)} → ${profName(prof)}${lvl ? ' ' + lvl + ' ур.' : ''} · баффы сняты, кот отозван (игра) · замеры скиллов, кота, зон и РБ — ${back.t ? 'свои с прошлого раза' : 'с нуля'}; панель боя проверь под этот класс`);
  return true;
}
async function getJson(path) {
  const r = await env.gameGet(path);
  let j = null; try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, j };
}
// фоновый опрос (только GET): прогресс обоих квестов раз в 10 мин
async function storyTick(force) {
  if (!force && Date.now() - pollT < POLL) return;
  pollT = Date.now(); ssSet('l2bot-storyPollT', pollT);
  for (const kind of Object.keys(Q)) {
    const S = env.rt.story?.[kind];
    if (!force && S?.completed && Date.now() - (S.t || 0) < 24 * 3600000) continue;   // пройденный — раз в сутки
    try { const r = await getJson(Q[kind].root); if (r.ok && r.j?.quest) qNote(kind, r.j.quest); } catch (e) {}
  }
}
// ---- сдача готовой части ----
function want() {
  if (env.cfg.storyTurnIn === false) return null;
  const S = env.rt.story || {}, tried = env.rt.storyTried || {}, now = Date.now();
  for (const kind of Object.keys(Q)) {
    const s = S[kind];
    if (!s?.ready || s.completed) continue;
    const key = `${kind}:${s.part ?? s.stage}`;
    if (now - (tried[key] || 0) < RETRY) continue;
    return { kind, key, why: line(kind, s) };
  }
  return null;
}
async function finish(J, ok, why) {
  const log = [{ kind: J.kind, ok: !!ok, why: String(why || '').slice(0, 140), t: Date.now() }, ...(env.rt.storyLog || [])].slice(0, 20);
  env.rec('B', 'квест', `${Q[J.kind].name}: ${ok ? '✓' : '✗'} ${why}${J.home ? ' · возвращаюсь на точку' : ''}`);
  const back = J.home && !env.fishNow() ? { zoneGo: { id: J.home, t: Date.now(), why: 'квест сдан: обратно на точку' }, zoneGoT: 0 } : {};
  await env.setRt({ storyJob: null, storyLog: log, ...back });
  storyTick(true).catch(() => {});
  if (!back.zoneGo && env.on !== false) { location.href = env.fishNow() ? '/fishing.html' : '/map.html'; await env.sleep(3000); }
}
async function tpPrice(tp) {                      // цена телепорта к точке NPC (с учётом VIP) или null
  const r = await getJson('/game/teleport/locations');
  const x = r.ok && (r.j?.locations || []).find(l => l?.teleportId === tp);
  return x ? +(x.vipFreeApplied ? 0 : x.adenaCost ?? x.baseAdenaCost ?? NaN) : null;
}
async function cancel(J) {
  const tried = { ...(env.rt.storyTried || {}) }; delete tried[J.key];
  env.rec('B', 'квест', `${Q[J.kind].name}: поход отменён — автосдача выключена`);
  await env.setRt({ storyJob: null, storyTried: tried });
}
async function step(J) {
  if (env.on === false) return;
  if (env.cfg.storyTurnIn === false) return cancel(J);
  const P = Q[J.kind];
  if (location.pathname !== P.page) { env.setStatus(`Квест ${P.name}: иду сдавать часть`); location.href = P.page; await env.sleep(4000); return; }
  const box = await env.waitX(() => { const a = env.$q(`#${P.act}-quest-actions`); return a && a.children.length ? a : null; }, 10000, 200);
  if (env.on === false) return;              // 14.10: остановили бота, пока страница загружала кнопки.
  if (env.cfg.storyTurnIn === false) return cancel(J);
  const err = () => (env.$q(`#${P.act}-quest-err`)?.textContent || '').trim();
  if (!box) return finish(J, false, err() || 'кнопок квеста нет (страница не загрузилась или часть уже сдана)');
  const btn = a => box.querySelector(`[data-${P.act}-action="${a}"]`);
  const done = btn(P.done);
  if (done) {
    env.fire(done);
    await env.waitX(() => !btn(P.done) || err() || null, 8000, 200);
    const e = err();
    return finish(J, !e && !btn(P.done), e ? `игра отказала: ${e.slice(0, 80)}` : `часть сдана (${J.why})`);
  }
  const tp = btn('teleport');
  if (!tp) return finish(J, false, 'кнопки «Завершить» нет — условия части ещё не выполнены');
  if (J.tpT) return finish(J, false, 'после телепорта NPC всё ещё не рядом');
  const id = tp.dataset[`${P.act}Target`] || '';
  const price = await tpPrice(id), max = env.cfg.storyTpMax ?? 100000;
  if (env.on === false) return;              // цена пришла после «Стоп» — платный переход уже не нужен.
  if (env.cfg.storyTurnIn === false) return cancel(J);
  if (price == null || !isFinite(price)) return finish(J, false, `цена телепорта к ${id || 'NPC'} неизвестна — не лечу вслепую`);
  if (price > max) return finish(J, false, `телепорт к NPC ${fmtA(price)} адены дороже лимита ${fmtA(max)}`);
  // 10.0.14: setRt синхронно меняет память/очередь. Резерв и клик — в одном JS-шаге: Stop во время записи
  // не оставит tpT без отправленного перехода. Отклонённый fire возвращает исходное задание до первого await.
  const write = env.setRt({ storyJob: { ...J, tpT: Date.now() } });
  const clicked = env.on !== false && env.cfg.storyTurnIn !== false && env.fire(tp);
  const rollback = clicked ? null : env.setRt({ storyJob: J });
  await write; if (rollback) await rollback;
  if (!clicked) { if (env.on !== false && env.cfg.storyTurnIn === false) await cancel(J); return; }
  env.rec('B', 'квест', `${P.name}: телепорт к NPC (${id}) за ${price ? fmtA(price) + ' адены' : 'бесплатно'} — сдать часть`);
  if (env.on === false) return;
  await env.waitX(() => location.pathname !== P.page || err() || null, 8000, 200);
  if (env.on === false) return;
  if (location.pathname === P.page && err()) return finish({ ...J, home: null }, false, `не улетели: ${err().slice(0, 80)}`);
}
// шаг в главном цикле. true — занят квестом (цикл идёт на следующий круг)
async function storyStep() {
  if (env.on === false) return false;
  const J = env.rt.storyJob;
  if (J) {
    if (env.cfg.storyTurnIn === false) { await cancel(J); return true; }
    if (env.isBattle()) return false;
    if (Date.now() - (J.t || 0) > JOB_MAX) { await finish(J, false, 'не уложился в 4 мин'); return true; }
    await step(J); return true;
  }
  const w = want();
  if (!w || !env.awayFree()) return false;
  const home = !env.fishNow() && env.autonomyMode() !== 'cat' ? env.rt.zone || null : null;
  // 10.0 (аудит): «стоять там, где оставили» — точка неизвестна (после телепорта к РБ/смерти) или найдена только по мобам (out:…, телепорта туда нет) —
  // бот не вернулся бы; сдаём, когда точка снова определится по карте
  // 10.0: без режима (только задачи) бот стоит, где стоял — точка возврата не нужна
  if (!env.fishNow() && !['cat', 'tasks'].includes(env.autonomyMode()) && (!home || /^out:/.test(home))) return false;
  const tried = Object.fromEntries(Object.entries(env.rt.storyTried || {}).filter(([, t]) => Date.now() - t < 86400000));
  await env.setRt({ storyJob: { ...w, home, t: Date.now() }, storyTried: { ...tried, [w.key]: Date.now() } });
  env.rec('B', 'квест', `${Q[w.kind].name}: иду сдавать — ${w.why}`);
  return true;
}
// 10.0 (лог 12.10 12:01: заказ Маммона висел, пока шла цепочка): готовую часть есть смысл сдать — цепочку прерываем после боя
function chainWant() { const w = want(); if (!w || !env.awayFree(true)) return null; const z = env.rt.zone; return z && !/^out:/.test(z) ? w : null; }
return { chainWant, Q, CLASS_KEYS, norm, qNote, charNote, classNote, openNames, rbIds, storyTick, want, finish, tpPrice, step, storyStep, line };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
