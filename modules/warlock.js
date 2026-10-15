/* Автобаф суммона: отдельная дополнительная задача, без смены основного режима. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.warlock = function create_warlock(env) {
const DEF = { petFullAuto: false, petFullBudget: 10000000, petFullMaxPrice: 10000000, petFullReserve: null, petFullRenew: true };
const number = x => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : typeof x === 'string' && /^\d+$/.test(x) && Number.isSafeInteger(+x) ? +x : null;
const option = k => env.cfg[k] ?? DEF[k];
const state = () => env.rt.petFull || {};
const charName = () => String(env.rt.char || '');
const mine = T => env.tabOwner === true && T?.lease === env.leaseEpoch && !!T?.char && charName() === T.char && env.heroNick() === T.char;
const active = () => env.on === true && env.tabOwner === true && option('petFullAuto') === true;
const priority = afterWin => env.canRun?.() !== false && (!env.isBattle() || (afterWin && env.victory())) && !env.fishState()
  && !env.tvtHold() && !env.abHold() && !env.antibotState() && !env.rt.revive && !env.rt.shop?.urgent;
const signature = () => JSON.stringify([option('petFullAuto'), option('petFullBudget'), option('petFullMaxPrice'), option('petFullReserve'), env.cfg.shopReserve, option('petFullRenew')]);
const token = () => ({ char: charName(), lease: env.leaseEpoch, kick: +env.rt.manualKickAt || 0, config: signature() });
const same = (T, afterWin) => mine(T) && active() && T.kick === (+env.rt.manualKickAt || 0) && T.config === signature() && priority(afterWin);
const patch = p => env.setRt({ petFull: { ...state(), ...p } });
const pendingSame = P => state().pending?.id === P?.id;
let paymentPoll = null;
let busy = false, serial = 0, latest = null, latestSeen = false, latestHero = null, latestCombat = null, latestCombatPlan = null, latestDefense = null, prepared = null, preparedSource = null, snapshotOwner = '', snapshotRevision = -1, snapshotEvidenceAt = 0;
const unsent = new Set();
function identity(ch) {
  const slot = ch?.classSlots?.activeSlot;
  if (!ch || ch.name !== charName() || ch.name !== env.heroNick() || !Number.isInteger(slot) || !Number.isSafeInteger(ch.revision)) return null;
  const prof = String(ch.l2Profession || '');
  if (!/^human_(?:warlock|arcana_lord|dark_avenger|hell_knight)$/.test(prof)) return null;
  return { char: ch.name, prof, slot, key: `${slot}:${prof}` };
}
// 10.0.23 (лог 15.10 07:18): полный городской набор доступен и Dark Panther (283).
function summon(ch) {
  const p = ch?.activeSummon;
  return p && p.kind === 'servitor' && typeof p.key === 'string' && (/^human_(?:dark_avenger|hell_knight)$/.test(ch.l2Profession || '') ? p.key === 'dark_panther' && number(p.summonSkillId) === 283 : /^(?:kai|kat|mew)_the_cat$/.test(p.key) || p.key === 'feline_king' && number(p.summonSkillId) === 1406)
    && p.hp > 0 && number(p.summonSkillId) > 0 && number(p.summonSkillLevel) > 0 && Array.isArray(p.activeBuffs) ? p : null;
}
function catalogSet(data) {
  const s = data?.sets?.find(x => x?.id === 'summon');
  if (!s || number(s.feeAdena) === null || number(s.feeCoinOfLuck) !== 0) return null;
  // Незнакомую валюту не оплачиваем: известны только адена и нулевой Coin of Luck.
  if (Object.entries(s).some(([k,v]) => /^fee/i.test(k) && !['feeAdena','feeCoinOfLuck','feeHintUk'].includes(k) && number(v) !== 0)) return null;
  if (!Array.isArray(s.skills) || !s.skills.length || s.skills.some(x => !(number(x.skillId) > 0) || !(number(x.level) > 0) || !(number(x.durationSec) > 0))) return null;
  const skills = s.skills.map(x => ({ id: +x.skillId, level: +x.level, duration: +x.durationSec }));
  if (new Set(skills.map(x => x.id)).size !== skills.length) return null;
  // Логи14.10: этот точный каталог26 возвращает25 эффектов:1356 есть,1413 нет.
  // Это наблюдённый состав набора, не правило «можно потерять любой один баф».
  const observed = '264:1|267:1|269:1|271:1|272:1|273:1|274:1|304:1|310:1|365:1|1036:2|1040:3|1045:6|1059:3|1062:2|1068:3|1077:3|1240:3|1242:3|1268:4|1303:2|1356:1|1388:3|1389:3|1413:1|4699:3';
  const sig = skills.slice().sort((a,b) => a.id-b.id).map(x => `${x.id}:${x.level}`).join('|');
  const effective = sig === observed && skills.every(x => x.duration === 18000) ? skills.filter(x => x.id !== 1413) : skills;
  return { price: +s.feeAdena, skills: effective, listedSkills: skills.length };
}
function coverage(p, skills, at = Date.now()) {
  if (!p || !skills?.length) return null;
  const rows = skills.map(s => p.activeBuffs.find(b => +b.skillId === s.id && +b.level >= s.level && Number.isFinite(b.expiresAtMs) && b.expiresAtMs > at));
  if (rows.some(x => !x)) return null;
  return { expiresAt: Math.min(...rows.map(x => x.expiresAtMs)), stamps: rows.map(x => `${x.skillId}:${x.level}:${x.expiresAtMs}`).sort().join('|') };
}
function freshEffects(ch, P) {
  const I = identity(ch), p = summon(ch);
  if (!I || I.key !== P.classKey || !p || p.key !== P.petKey || p.summonSkillLevel !== P.petLevel || ch.revision <= P.revision) return null;
  const c = coverage(p, P.skills); if (!c) return null;
  // До запроса полного набора не было. Все эффекты должны иметь новую длительность из оплаченного каталога.
  if (P.skills.some(s => !p.activeBuffs.some(b => +b.skillId === s.id && +b.level >= s.level && b.expiresAtMs >= P.at + s.duration * 1000 - 60000))) return null;
  return c;
}
function receipt(body, P) {
  if (!body || body.set !== 'summon' || number(body.feeAdena) !== P.price || number(body.feeCoinOfLuck) !== 0
    || Object.entries(body).some(([k,v]) => /^fee/i.test(k) && !['feeAdena','feeCoinOfLuck','feeHintUk'].includes(k) && number(v) !== 0)) return null;
  return { price: P.price, kind: 'server', at: Date.now() };
}
async function read(path) {
  const requestStartedAt = Date.now(), r = await env.gameGet(path), d = await r.json();
  if (path === '/character' && d && typeof d === 'object') (d.character || d).requestStartedAt = requestStartedAt;
  if (!r.ok || !d || d.error) throw Error('read_failed'); return d;
}
async function status(T, code, reason, extra = {}) {
  if (mine(T)) await patch({ status: code, reason, ...extra });
}
function summary() {
  const S = state(), budget = number(option('petFullBudget'));
  const reserved = (S.unknownReserved || 0) + (S.pending ? S.pending.price || 0 : 0);
  return { char: charName(), pendingId: S.pending?.id || null, unknownReserved: S.unknownReserved || 0, enabled: option('petFullAuto') === true, status: S.status || 'off', reason: S.reason || 'Автобаф выключен',
    price: S.lastPrice ?? null, budget, spent: S.spent || 0, reserved, remaining: budget === null ? null : Math.max(0, budget - (S.spent || 0) - reserved),
    lifetimeSpent: S.lifetimeSpent || 0, purchases: S.purchases || 0, expiresAt: S.expiresAt || 0, observedMs: S.observedMs || 0, renew: option('petFullRenew') === true, budgetEpoch: S.budgetEpoch || 0 };
}
async function observe(T, ch, set, full) {
  if (!mine(T)) return;
  const S = state(), now = Date.now(), p = summon(ch), prev = S.observation;
  const continuity = full && prev?.stamps === full.stamps && prev.petKey === p?.key && now >= prev.at && now - prev.at <= 60000;
  const observedMs = (S.observedMs || 0) + (continuity ? Math.max(0, Math.min(now, prev.expiresAt) - prev.at) : 0);
  await patch({ lastPrice: set.price, lastCheckAt: now, expiresAt: full?.expiresAt || 0, observedMs,
    observation: { at: now, petKey: p?.key || '', stamps: full?.stamps || '', expiresAt: full?.expiresAt || 0 },
    snapshot: snapshot(ch), nextCheckAt: now + (full ? Math.min(60000, Math.max(1000, full.expiresAt - now)) : 10000) });
}
async function reconcile(T, ch, afterWin, confirmedWrite) {
  const P = state().pending; if (!P) return false;
  if (P.char !== T.char) { await status(T, 'unknown', 'Сохранённый запрос относится к другому персонажу'); return true; }
  if (P.phase === 'prepared' && unsent.has(P.id)) {
    if (mine(T) && pendingSame(P)) { unsent.delete(P.id); await patch({ pending: null, nextCheckAt: 0, status: 'ready', reason: 'Неотправленный запрос отменён; проверю условия заново' }); }
    return true;
  }
  const effects = freshEffects(ch, P);
  const exactDelta = ch.revision === P.revision + 1 && number(ch.adena) === P.adena - P.price;
  const contradicts = P.contradiction || (P.receipt && ch.revision === P.revision + 1 && !exactDelta);
  if (contradicts && !P.contradiction && mine(T) && pendingSame(P)) await patch({ pending: { ...P, contradiction: 'balance', balanceEvidence: { revision: ch.revision, before: P.adena, after: number(ch.adena) } } });
  const paid = !contradicts && (P.receipt || (effects && exactDelta ? { price: P.price, kind: 'revision+balance', at: Date.now() } : null));
  if (effects && paid) {
    if (!mine(T) || !pendingSame(P)) return true;
    const before = { ...state() };
    const saved = await patch({ pending: null, spent: (state().spent || 0) + paid.price, lifetimeSpent: (state().lifetimeSpent || 0) + paid.price, snapshot: snapshot(ch), purchases: (state().purchases || 0) + 1,
      budgetEpoch: state().budgetEpoch || P.at, lastReceipt: { at: P.at, confirmedAt: Date.now(), revision: ch.revision, price: paid.price, kind: paid.kind,
        classKey: P.classKey, petKey: P.petKey, petLevel: P.petLevel, expiresAt: effects.expiresAt },
      expiresAt: effects.expiresAt, status: 'active', reason: 'Полный баф суммона подтверждён', nextCheckAt: Date.now() + 60000 });
    const durable = await durableOrRestore(T, before, ['pending','spent','lifetimeSpent','snapshot','purchases','budgetEpoch','lastReceipt','expiresAt','status','reason','nextCheckAt'], saved);
    confirmedWrite?.(durable);
    if (!durable) { await status(T, 'unknown', 'Квитанция не сохранена; резерв покупки остаётся'); return true; }
    env.rec('B', 'суммон', `Полный баф подтверждён: ${paid.price} адены, до ${new Date(effects.expiresAt).toISOString()}`); return true;
  }
  await status(T, 'unknown', contradicts ? 'Цена, валюта или баланс противоречат квитанции; повторная оплата запрещена' : effects ? 'Эффекты есть, расход не подтверждён; повторная покупка запрещена' : 'Исход покупки не подтверждён; проверяю бафы без повторной оплаты', { nextCheckAt: Date.now() + 15000 });
  return true;
}
// 10.0.24: сверка уже отправленного платежа не зависит от нового режима/очереди магазина.
// Только GET: ни каталог, ни переход к бафферу, ни новая покупка здесь невозможны.
async function paymentReconcile() {
  const P = state().pending;
  if (!P || busy) return false;
  const T = token(); if (!mine(T) || P.char !== T.char) return false;
  const now = Date.now();
  if (paymentPoll?.id === P.id && now - paymentPoll.at < 15000) return false;
  paymentPoll = { id: P.id, at: now }; busy = true;
  try {
    const data = await read('/character'); if (!mine(T) || !pendingSame(P)) return false;
    const ch = data.character || data;
    if (ch?.name !== T.char || !Number.isSafeInteger(ch.revision)) return false;
    await reconcile(T, ch, false);
    return mine(T) && !state().pending;
  } catch (_) {
    if (mine(T) && pendingSame(P)) await status(T, 'unknown', 'Не удалось сверить оплату бафа суммона; повторная покупка запрещена', { nextCheckAt: Date.now() + 15000 });
    return false;
  } finally { busy = false; }
}
async function step({ afterWin = false, forceRead = false } = {}) {
  if (busy || !active() || !priority(afterWin)) return false;
  const T = token(); if (!mine(T)) return false;
  if (!forceRead && state().nextCheckAt > Date.now()) return false;
  busy = true;
  try {
    const data = await read('/character'); if (!same(T, afterWin)) return false;
    const ch = data.character || data;
    if (!identity(ch)) { await status(T, 'class', 'Нужен подтверждённый активный класс Warlock / Arcana Lord или Dark Avenger / Hell Knight', { nextCheckAt: Date.now() + 15000 }); return false; }
    noteSnapshot(ch);
    if (ch.inBattle !== false) { await status(T, 'battle', 'Дождусь завершения боя'); return false; }
    if (await reconcile(T, ch, afterWin)) return true;
    if (!same(T, afterWin)) return false;
    const p = summon(ch); if (!p) { await status(T, 'pet', 'Нужен живой призванный суммон', { nextCheckAt: Date.now() + 10000 }); return false; }
    const raw = await read('/character/town/buffer/catalog'); if (!same(T, afterWin)) return false;
    const set = catalogSet(raw); if (!set) { await status(T, 'catalog', 'Цена, валюта или состав полного бафа не подтверждены', { nextCheckAt: Date.now() + 15000 }); return false; }
    const full = coverage(p, set.skills); await observe(T, ch, set, full); if (!same(T, afterWin)) return false;
    if (full) { await status(T, 'active', 'Полный баф уже действует'); return false; }
    const S = state(), last = S.lastReceipt;
    if (last?.expiresAt > Date.now()) { await status(T, 'early-loss', 'Оплаченный срок ещё не истёк; после смены или потери суммона повторно не покупаю'); return false; }
    if (last && option('petFullRenew') !== true) { await status(T, 'renew', 'Автообновление выключено'); return false; }
    if (last && ch.revision < last.revision) { await status(T, 'stale', 'Снимок старее последней покупки; жду свежее состояние'); return false; }
    const budget = number(option('petFullBudget')), cap = number(option('petFullMaxPrice'));
    const reserve = number(option('petFullReserve') ?? env.cfg.shopReserve ?? 0), adena = number(ch.adena);
    const fence = S.archiveFence;
    if (fence && (ch.revision < fence.verifiedRevision || (Date.now() < fence.possibleUntil && !(budget > fence.budgetAtArchive)))) {
      await status(T, 'archived', 'Неопределённый расход остаётся в резерве; дождитесь возможного срока или задайте дополнительный бюджет'); return false;
    }
    if (cap === null || set.price > cap) { await status(T, 'price', `Цена ${set.price} выше разрешённой ${cap ?? '?'}`); return false; }
    if (budget === null || set.price > budget - (S.spent || 0) - (S.unknownReserved || 0)) { await status(T, 'budget', 'Бюджет автобафа исчерпан; увеличьте лимит или явно сбросьте расход'); return false; }
    if (reserve === null || adena === null || adena - set.price < reserve) { await status(T, 'reserve', 'Не хватает адены с учётом резерва'); return false; }
    // Оплата только после подтверждённого штатного входа в город; прямой POST с карты не предполагаем.
    if (env.townBufferReady?.() !== true) {
      await status(T, 'travel', 'Для покупки нужен подтверждённый вход в город');
      if (same(T, afterWin)) await env.townBufferStart?.({ char: T.char, revision: ch.revision, price: set.price });
      return true;
    }
    const I = identity(ch), P = { id: `${Date.now()}:${++serial}:${ch.revision}`, phase: 'prepared', at: Date.now(), char: T.char, classKey: I.key,
      petKey: p.key, petLevel: p.summonSkillLevel, revision: ch.revision, adena, price: set.price, skills: set.skills };
    unsent.add(P.id);
    const saved = await patch({ pending: P, budgetEpoch: S.budgetEpoch || Date.now(), status: 'prepared', reason: 'Сохраняю запрос перед покупкой' });
    const durable = saved?.ok === true && (await env.rtCommit()) === true;
    if (!durable || !same(T, afterWin) || !pendingSame(P) || env.townBufferReady?.() !== true) {
      if (mine(T) && pendingSame(P)) await patch({ pending: null, nextCheckAt: 0, status: 'paused', reason: durable ? 'Покупка отменена до отправки' : 'Состояние не сохранено; покупка отложена' });
      return false;
    }
    // Между пометкой sent и вызовом API нет await. Core gamePost повторно проверяет Stop/lease.
    const queued = patch({ pending: { ...P, phase: 'sent' }, status: 'pending', reason: 'Жду подтверждение покупки' });
    unsent.delete(P.id);
    const sent = env.gamePost('/character/town/buffer', { set: 'summon', expectedRevision: P.revision, expectedFeeAdena: String(P.price), expectedFeeCoinOfLuck: 0 })
      .then(response => ({ response }), error => ({ error }));
    await queued; const result = await sent;
    if (!mine(T) || !pendingSame(P)) return true;
    if (result.error) { await status(T, 'unknown', 'Ответ покупки потерян; повторно не оплачиваю', { nextCheckAt: 0 }); return true; }
    const response = result.response;
    if (response.status >= 400 && response.status < 500) {
      await patch({ pending: null, status: 'rejected', reason: `Покупка отклонена (${response.status}); перечитаю каталог`, nextCheckAt: Date.now() + 15000 }); return true;
    }
    let body = null; try { body = await response.json(); } catch (_) {}
    if (!mine(T) || !pendingSame(P)) return true;
    const R = response.ok && receipt(body, P);
    if (R) await patch({ pending: { ...state().pending, receipt: R } });
    else if (body && Object.keys(body).some(k => k === 'set' || /^fee/i.test(k))) await patch({ pending: { ...state().pending, contradiction: 'receipt' } });
    if (!same(T, afterWin)) return true;
    const fresh = await read('/character'); if (!same(T, afterWin)) return true;
    noteSnapshot(fresh.character || fresh);
    await reconcile(T, fresh.character || fresh, afterWin); return true;
  } catch (_) {
    if (mine(T)) await status(T, state().pending ? 'unknown' : 'read', state().pending ? 'Исход покупки неизвестен; повторно не оплачиваю' : 'Не удалось прочитать состояние суммона', { nextCheckAt: Date.now() + 15000 });
    return false;
  } finally { busy = false; }
}
async function preview() {
  const raw = await read('/character/town/buffer/catalog'), set = catalogSet(raw);
  return { ...summary(), price: set?.price ?? null, skills: set?.listedSkills || 0, effectiveSkills: set?.skills.length || 0, durationSec: set ? Math.min(...set.skills.map(s => s.duration)) : 0, catalogValid: !!set };
}
async function durableOrRestore(T, before, keys, saved) {
  let ok = false;
  try { ok = saved?.ok === true && (await env.rtCommit()) === true; } catch (_) {}
  if (ok && mine(T)) return true;
  // Только поля этой операции: не затираем текущие настройки, класс и чужие задачи.
  if (mine(T)) await patch(Object.fromEntries(keys.map(k => [k, before[k] ?? null])));
  return false;
}
async function archiveUnknown(expected = {}) {
  const T = token(), P = state().pending;
  if (expected.char !== T.char || expected.pendingId !== P?.id || expected.budgetEpoch !== (state().budgetEpoch || 0)) return { ok: false, reason: 'Подтверждение устарело; перечитайте попытку и бюджет' };
  if (!mine(T) || busy || !P) return { ok: false, reason: 'Нет доступной неопределённой попытки' };
  busy = true;
  try {
    const data = await read('/character'), ch = data.character || data;
    if (!mine(T) || !pendingSame(P) || ch?.name !== T.char || !Number.isSafeInteger(ch.revision)) return { ok: false, reason: 'Текущий персонаж не подтверждён' };
    if (ch.revision <= P.revision) return { ok: false, reason: 'Старая ревизия ещё действительна; возможный запрос нельзя завершить' };
    // Сначала восстановим точную квитанцию, если новая сверка уже её подтверждает.
    let confirmation = null;
    await reconcile(T, ch, false, ok => { confirmation = ok; });
    if (!mine(T)) return { ok: false, reason: 'Управление вкладкой потеряно' };
    if (confirmation === false) return { ok: false, reason: 'Квитанция не сохранена; попытка остаётся заблокированной' };
    if (!state().pending) return { ok: true, reason: 'Покупка подтверждена свежим состоянием' };
    if (!pendingSame(P)) return { ok: false, reason: 'Запрос изменился; перечитайте состояние' };
    const budget = number(option('petFullBudget'));
    const possibleUntil = Date.now() + Math.max(...P.skills.map(x => x.duration), 0) * 1000;
    const entry = { ...state().pending, archivedAt: Date.now(), verifiedRevision: ch.revision, possibleUntil, budgetAtArchive: budget, outcome: 'unknown' };
    const beforeArchive = { ...state() };
    const saved = await patch({ pending: null, unknownReserved: (state().unknownReserved || 0) + P.price,
      history: [...(state().history || []), entry].slice(-50), archiveFence: { verifiedRevision: ch.revision, possibleUntil, budgetAtArchive: budget },
      nextCheckAt: 0, status: 'archived', reason: 'Попытка завершена пользователем; возможный расход сохранён в резерве' });
    if (!await durableOrRestore(T, beforeArchive, ['pending','unknownReserved','history','archiveFence','nextCheckAt','status','reason'], saved)) return { ok: false, reason: 'Архив не сохранён; попытка остаётся заблокированной' };
    return { ok: true, reason: 'Резерв сохранён; для новой покупки нужен дополнительный бюджет или истечение возможного срока' };
  } catch (_) { return { ok: false, reason: 'Свежая сверка не получена; резерв сохранён' }; }
  finally { busy = false; }
}
async function resetBudget(expected = {}) {
  const T = token();
  if (expected.char !== T.char || expected.budgetEpoch !== (state().budgetEpoch || 0) || expected.spent !== (state().spent || 0)) return false; if (!mine(T) || busy || state().pending) return false;
  // Только явная команда пользователя; переключение задачи и перезагрузка бюджет не обнуляют.
  const before = { ...state() };
  const saved = await patch({ spent: 0, budgetEpoch: Date.now(), status: 'ready', reason: 'Бюджет сброшен пользователем', nextCheckAt: 0 });
  return durableOrRestore(T, before, ['spent','budgetEpoch','status','reason','nextCheckAt'], saved);
}
const modelManaged = () => /^human_(?:warlock|arcana_lord)$/.test(env.rt.classCur?.prof || env.rt.prof || '');
// 15.10, живой /character: срок героя expiresAt; hook нормализует в expiresAtMs, прямой GET оставляет исходное поле.
const heroBuffExpiry = b => Number.isFinite(b?.expiresAtMs) ? b.expiresAtMs : Number.isFinite(b?.expiresAt) ? b.expiresAt : 0;
// Только устойчивые публичные свойства: без UID, HP/MP и откатов. При равных M/P.Atk
// клановый процент урона, аугментация и новый ранг умения всё равно меняют состав.
function combatSetup(ch) {
  const eq = ch.inventory?.eq;
  const attrs = a => (a || []).map(x => [String(x.attributeId || ''), +x.level || 0]).sort((a,b) => a[0].localeCompare(b[0]));
  return { gear: eq && typeof eq === 'object' ? Object.entries(eq).sort(([a],[b]) => a.localeCompare(b)).map(([slot,v]) => {
    const x = v && typeof v === 'object' ? v : { itemId:v };
    return [slot,+x.itemId||0,+x.enchant||0,+x.specialGearLevel||0,+x.enchantPAtkBonus||0,+x.enchantMAtkBonus||0,
      String(x.augmentation?.outcomeId || ''),attrs(x.clanWeaponAttrs),attrs(x.clanArmorAttrs)];
  }) : null, skills: Array.isArray(ch.learnedBattleSkillsDetail) ? ch.learnedBattleSkillsDetail.map(x => [String(x.battleId || ''),+x.level||0]).sort((a,b) => a[0].localeCompare(b[0])) : null };
}
function snapshot(ch, shots) {
  const I = identity(ch), p = summon(ch); if (!I || !p) return null;
  const active = a => (a || []).filter(b => b.expiresAtMs > Date.now());
  const buffs = active(p.activeBuffs).map(b => `${b.skillId}:${b.level}`).sort();
  const heroFields = ['mAtk','pAtk','pDef','mDef','maxHp','mCritPct','magicCritDamageMultiplier','critRate','critDmgMul','castSpd','pAtkSpd','castSpeed','attackSpeed'];
  const hero = Object.fromEntries(heroFields.map(k => [k, Number.isFinite(ch[k]) ? ch[k] : null]));
  const heroBuffs = Array.isArray(ch.activeBuffs) ? ch.activeBuffs.filter(b => heroBuffExpiry(b) > Date.now()) : null;
  hero.setup = combatSetup(ch);
  hero.buffs = heroBuffs?.map(b => `${b.skillId}:${b.level}`).sort() ?? null;
  const data = { char: I.char, classKey: I.key, level: +ch.level || 0, petKey: p.key, petLevel: p.summonSkillLevel,
    pAtk: +p.pAtk || 0, accuracy: +p.accuracy || 0, critRate: +p.critRate || 0, critDmgMul: +p.critDmgMul || 0, buffs, hero,
    shots: String(shots ?? env.shotContext?.() ?? 'unknown') };
  return { at: Date.now(), born: +env.rt.petBornT || 0, validUntil: Math.min(Date.now() + 30000, ...active(p.activeBuffs).map(b => b.expiresAtMs), ...(heroBuffs || []).map(heroBuffExpiry)),
    ...data, key: JSON.stringify(data) };
}
// Входящий урон не зависит от зарядов/кота, зато меняется от брони, стоек
// и сопротивлений. Неизвестный бафф включаем; исключаем только чистые усиления атаки.
const OFFENSE_ONLY = new Set([1077,1240,1068,1086,1059,1085,1078,4699]);
const DEFENSE_FIELDS = ['level','maxHp','pDef','mDef','evasion','magicEvasion','shieldDef','shieldRate','fireResist','waterResist','windResist','earthResist','holyResist','darkResist'];
function defenseSnapshot(ch) {
  if (!Array.isArray(ch.activeBuffs) || !Array.isArray(ch.toggleStances) || !ch.inventory?.eq || !Array.isArray(ch.learnedBattleSkillsDetail)
      || !['level','maxHp','pDef','mDef'].every(k=>Number.isFinite(ch[k])&&ch[k]>0)) return null;
  const buffs = ch.activeBuffs.filter(b=>heroBuffExpiry(b)>Date.now()&&!OFFENSE_ONLY.has(b.skillId));
  const data = { char:ch.name,prof:ch.l2Profession,slot:ch.classSlots?.activeSlot,setup:combatSetup(ch),
    stats:DEFENSE_FIELDS.map(k=>Number.isFinite(ch[k])?ch[k]:null),buffs:buffs.map(b=>[b.skillId,b.level]).sort((a,b)=>a[0]-b[0]),
    stances:ch.toggleStances.filter(x=>x.active===true).map(x=>[String(x.battleId||''),+x.skillId||0,+x.level||0]).sort((a,b)=>a[0].localeCompare(b[0])) };
  const proofAt = Number.isFinite(ch.requestStartedAt) ? Math.min(Date.now(),ch.requestStartedAt) : Date.now();
  return { ...data,key:JSON.stringify(data),until:Math.min(proofAt+30000,Number.isFinite(ch.snapshotGeneratedAt)?ch.snapshotGeneratedAt+30000:Infinity,...buffs.map(heroBuffExpiry)) };
}
function defenseContext() {
  const d=latestDefense;
  return d && d.char===charName() && d.char===env.heroNick() && d.prof===env.rt.classCur?.prof && d.slot===env.rt.classCur?.slot && d.until>Date.now() ? d.key : null;
}
function noteSnapshot(ch, shots) {
  // Вызывается только для полного собственного /character; обрезанный res.activeSummon не годится.
  if (!ch || ch.name !== charName() || ch.name !== env.heroNick()) return;
  // 15.10, аудит: два полных GET одного героя могут вернуться в обратном порядке.
  if (ch.l2Profession !== env.rt.classCur?.prof || ch.classSlots?.activeSlot !== env.rt.classCur?.slot) return;
  if (Number.isFinite(ch.snapshotGeneratedAt) && (Date.now()-ch.snapshotGeneratedAt > 30000 || ch.snapshotGeneratedAt-Date.now() > 5000)) return;
  if (snapshotOwner !== ch.name) { snapshotOwner = ch.name; snapshotRevision = -1; snapshotEvidenceAt = 0; }
  if (Number.isSafeInteger(ch.revision)) {
    if (ch.revision < snapshotRevision) return;
    const proofAt = Number.isFinite(ch.requestStartedAt) ? Math.min(Date.now(), ch.requestStartedAt) : Date.now();
    if (ch.revision > snapshotRevision) snapshotEvidenceAt = proofAt;
    else snapshotEvidenceAt = Math.min(snapshotEvidenceAt, proofAt);
    snapshotRevision = ch.revision;
  }
  const fields = ['level','mAtk','pAtk','pDef','mDef','maxHp','mCritPct','magicCritDamageMultiplier','critRate','critDmgMul','castSpd','pAtkSpd','castSpeed','attackSpeed'];
  const buffs = Array.isArray(ch.activeBuffs) ? ch.activeBuffs.filter(b => heroBuffExpiry(b) > Date.now()) : null;
  const data = { char: ch.name, setup: combatSetup(ch), prof: ch.l2Profession, slot: ch.classSlots?.activeSlot, stats: fields.map(k => Number.isFinite(ch[k]) ? ch[k] : null), buffs: buffs?.map(b => `${b.skillId}:${b.level}`).sort(), shots: String(shots ?? env.shotContext?.() ?? 'unknown') };
  latestDefense = defenseSnapshot(ch);
  latestHero = buffs && (ch.mAtk > 0 || ch.pAtk > 0) ? { ...data, key: JSON.stringify(data), until: Math.min(Date.now()+30000,...buffs.map(heroBuffExpiry)) } : null;
  latestCombat = combatSnapshot(ch);
  latestCombatPlan=null;
  if(ch.inBattle===false && !env.isBattle() && latestHero){
    const plannedShots=env.shotContext?.(ch,{preflight:true});
    if(plannedShots && plannedShots!=='unknown'){
      const plannedHero={...data,shots:String(plannedShots)};
      const plan=combatSnapshot(ch,{...plannedHero,key:JSON.stringify(plannedHero),until:latestHero.until});
      const weapon=ch.inventory?.eq?.l1;
      if(plan)latestCombatPlan={...plan,actualHero:latestHero.key,source:{name:ch.name,l2Profession:ch.l2Profession,classSlots:{activeSlot:ch.classSlots?.activeSlot},inBattle:false,
        inventory:{eq:{l1:weapon&&typeof weapon==='object'?{itemId:weapon.itemId}:weapon},stacks:ch.inventory?.stacks?.map(x=>({itemId:x?.itemId,qty:x?.qty}))},
        battleHotbarSlots:ch.battleHotbarSlots?.map(x=>x?{k:x.k,id:x.id}:null)},shots:String(plannedShots)};
    }
  }
  latest = snapshot(ch, shots); latestSeen = true;
  if (latest) latest.proofAt = snapshotEvidenceAt || latest.at;
  // 10.0.21: вне боя hotbar отсутствует. Сохраняем отдельный план включения подтверждённых
  // расходников, не выдавая его за реально включённые заряды и не подмешивая в обучение боя.
  prepared = null; preparedSource = null;
  const p = summon(ch);
  if (ch.inBattle === false && !env.isBattle() && Array.isArray(ch.activeBuffs) && p
    && Number.isFinite(ch.level) && ch.level>0 && ['maxHp','pAtk','critDmgMul'].every(k=>Number.isFinite(p[k]) && p[k]>0)
    && ['accuracy','critRate'].every(k=>Number.isFinite(p[k]) && p[k]>=0)
    && ['mAtk','pAtk','pDef','mDef','maxHp'].every(k=>Number.isFinite(ch[k]) && ch[k]>0)
    && (!Number.isFinite(ch.snapshotGeneratedAt) || Date.now()-ch.snapshotGeneratedAt>=-5000 && Date.now()-ch.snapshotGeneratedAt<=30000)) {
    const weapon=ch.inventory?.eq?.l1;
    preparedSource = { name: ch.name, l2Profession: ch.l2Profession, classSlots: { activeSlot: ch.classSlots?.activeSlot }, inBattle: false,
      inventory: { eq: { l1: weapon && typeof weapon==='object'?{itemId:weapon.itemId}:weapon },
        stacks: Array.isArray(ch.inventory?.stacks)?ch.inventory.stacks.map(s=>({itemId:s?.itemId,qty:s?.qty})):null },
      battleHotbarSlots: Array.isArray(ch.battleHotbarSlots)?ch.battleHotbarSlots.map(s=>s?{k:s.k,id:s.id}:null):null };
    prepared = snapshot(ch, env.shotContext?.(preparedSource,{preflight:true}) || 'unknown');
    if (prepared && Number.isFinite(ch.snapshotGeneratedAt)) prepared.validUntil = Math.min(prepared.validUntil, ch.snapshotGeneratedAt + 30000);
  }
}
function invalidateSnapshot() { latest = null; latestSeen = true; latestHero = null; latestCombat = null; latestCombatPlan = null; latestDefense = null; prepared = null; preparedSource = null; }
function heroContext() {
  const h = latestHero;
  return h && h.char === charName() && h.char === env.heroNick() && h.prof === env.rt.classCur?.prof && h.slot === env.rt.classCur?.slot && h.until > Date.now()
    && String(env.shotContext?.() ?? 'unknown') === h.shots ? h.key : null;
}
// Полный состав для общего обучения боя: отсутствие суммона должно быть явным.
function combatSnapshot(ch,h=latestHero) {
  const p=ch.activeSummon;
  if (!h || !h.setup.gear || !h.setup.skills || !Array.isArray(ch.toggleStances)
      || !Object.prototype.hasOwnProperty.call(ch,'activeSummon') || p === undefined || h.shots==='unknown') return null;
  let pet=null, expires=[];
  if (p !== null) {
    if (!p || typeof p.key!=='string' || !p.kind || !Array.isArray(p.activeBuffs)
        || !['hp','maxHp','pAtk','accuracy','critRate','critDmgMul','summonSkillId','summonSkillLevel'].every(k=>Number.isFinite(p[k]))) return null;
    const buffs=p.activeBuffs.filter(b=>heroBuffExpiry(b)>Date.now()); expires=buffs.map(heroBuffExpiry);
    pet={kind:p.kind,key:p.key,alive:p.hp>0,level:p.summonSkillLevel,skill:p.summonSkillId,
      stats:['maxHp','pAtk','mAtk','accuracy','critRate','critDmgMul'].map(k=>Number.isFinite(p[k])?p[k]:null),
      buffs:buffs.map(b=>[b.skillId,b.level]).sort((a,b)=>a[0]-b[0]),born:+env.rt.petBornT||0};
  }
  const stances=ch.toggleStances.filter(x=>x.active===true).map(x=>[String(x.battleId||''),+x.skillId||0,+x.level||0]).sort((a,b)=>a[0].localeCompare(b[0]));
  const proof=Number.isFinite(ch.requestStartedAt)?Math.min(Date.now(),ch.requestStartedAt):Date.now();
  return {hero:h.key,key:JSON.stringify([h.key,stances,pet]),born:+env.rt.petBornT||0,
    until:Math.min(h.until,proof+30000,Number.isFinite(ch.snapshotGeneratedAt)?ch.snapshotGeneratedAt+30000:Infinity,...expires)};
}
function combatContext(options={}) {
  const planning=options.preflight===true&&!env.isBattle(), c=planning?latestCombatPlan:latestCombat;
  if(!c||c.until<=Date.now()||c.born!==( +env.rt.petBornT||0))return null;
  if(planning)return c.actualHero===heroContext()&&env.shotContext?.(c.source,{preflight:true})===c.shots?c.key:null;
  return c.hero===heroContext()?c.key:null;
}
function currentSnapshot() {
  const s = latestSeen ? latest : state().snapshot;
  if (!s || s.char !== charName() || s.char !== env.heroNick() || s.classKey !== `${env.rt.classCur?.slot}:${env.rt.classCur?.prof}`
    || s.validUntil <= Date.now() || Date.now() - s.at > 30000 || s.born !== (+env.rt.petBornT || 0)) return null;
  const shots = env.shotContext?.();
  if (shots != null && String(shots) !== s.shots) return null; // новый снимок после смены/исчерпания зарядов
  return s;
}
function targetContext(ctx) {
  if (!ctx?.name) return null;
  return [String(ctx.rb?.id || ctx.spawnId || ''),String(ctx.name).toLowerCase(),+ctx.lvl || 0,+ctx.max || 0,!!ctx.champ,String(ctx.tier || '')];
}
function capture(ctx, ch, shots) {
  if (!ctx) return;
  const snap = ch ? snapshot(ch, shots) : currentSnapshot();
  const fresh = snap && Date.now() - snap.at <= 30000 && snap.validUntil > Date.now();
  const target = targetContext(ctx), cohort = fresh ? { ...snap, snapshotKey: snap.key, target, key: JSON.stringify([snap.key,target]) } : null;
  if (!fresh || (ctx.petCohort && ctx.petCohort.key !== cohort.key) || ctx.pet?.resummons || ctx.pet?.deaths) { ctx.petCohortMixed = true; return; }
  if (!ctx.petCohort) {
    if (ctx.pet?.hits || ctx.pet?.crits || ctx.pet?.misses) ctx.petCohortMixed = true;
    ctx.petCohort = cohort;
  } else ctx.petCohort.validUntil = cohort.validUntil;
}
function petExpected(ctx) {
  if (!modelManaged()) return null;
  capture(ctx);
  const c = ctx?.petCohort, p = ctx?.pet;
  if (!c || !p || !c.target || c.shots === 'unknown' || ctx.petCohortMixed) return 0;
  const S = env.rt.petCohorts?.[c.key] || {}, sum = k => (+S[k] || 0) + (+p[k] || 0);
  const hits = sum('hits'), acts = sum('acts'), swings = hits + sum('crits') + sum('misses');
  if (hits < 5 || acts < 5 || swings / acts < 0.8 || sum('misses') / swings > 0.25) return 0;
  const avg = p.hits >= 2 ? p.hitDmg / p.hits : sum('hitDmg') / hits;
  return avg > 0 ? avg * 0.85 : 0; // крит не обещаем для следующего добивания
}
// 15.10: отсутствие эффекта в свежем полном снимке отличается от неизвестного состояния.
function petBuffState(id, appliedAt = 0) {
  const s = currentSnapshot();
  if (!s) return null;
  if (s.buffs.some(b => +b.split(':')[0] === +id)) return true;
  // Отсутствие до принятого каста не доказывает отсутствие после него.
  return (s.proofAt ?? s.at) > appliedAt ? false : null;
}
function petBuffActive(id) { return petBuffState(id) === true; }
function raidContext(id, st = {}, options = {}) {
  if (!modelManaged()) return null;
  const planning = options.preflight === true && !env.isBattle();
  const p = prepared, fresh = p && p.char===charName() && p.char===env.heroNick() && p.classKey===`${env.rt.classCur?.slot}:${env.rt.classCur?.prof}`
    && p.validUntil>Date.now() && Date.now()-p.at>=0 && Date.now()-p.at<=30000 && p.born===(+env.rt.petBornT||0);
  const s = planning ? fresh ? p : null : currentSnapshot(), h = s?.hero;
  const flags = planning ? { prepared: !!s, planned: true, reason: s ? 'Заряды для следующего боя не подтверждены' : 'Нужен свежий полный состав персонажа и суммона' } : {};
  if (!s || !h?.buffs || !(h.mAtk > 0 || h.pAtk > 0) || s.shots === 'unknown' || !id
    || planning && env.shotContext?.(preparedSource,{preflight:true})!==s.shots) return { managed: true, key: null, ...flags };
  const target = [String(id), ...[['lvl','level'],['hp','maxHp'],['pDef','pdef'],['mDef','mdef'],['pAtk','patk'],['mAtk','matk']].map(keys => keys.map(k => st[k]).find(Number.isFinite) ?? null)];
  // 10.0.21 (лог 15.10 00:49): сила состава общая для РБ, точный замер потерь/урона остаётся привязан к цели.
  // Перепризыв меняет powerKey даже после свежего /character с теми же цифрами суммона.
  return { managed: true, key: JSON.stringify([s.key,target,s.born]), powerKey: JSON.stringify([s.key,s.born]), validUntil: s.validUntil,
    ...(planning ? { prepared: true, planned: true, reason: 'Заряды на панели и в сумке; бот включит их в начале боя' } : {}) };
}
async function noteBattle(ctx) {
  const p = ctx?.pet, c = ctx?.petCohort, T = token();
  if (!mine(T) || !p || !c || c.char !== T.char || c.classKey !== `${env.rt.classCur?.slot}:${env.rt.classCur?.prof}`
    || c.validUntil <= Date.now() || (latestSeen && (!latest || latest.key !== c.snapshotKey)) || ctx.petActsKnown === false || ctx.petCohortMixed || p.resummons || p.deaths || ctx.petCohortDone || p.key !== c.petKey) return;
  // Только наблюдаемый урон. Не смешиваем ранг суммона, бафы и заряды; неизвестные заряды помечены явно.
  ctx.petCohortDone = true;
  const all = { ...(env.rt.petCohorts || {}) }, old = all[c.key] || {}, fields = ['hits','hitDmg','crits','misses','dmg','acts'];
  all[c.key] = { ...c, fights: (old.fights || 0) + 1, ...Object.fromEntries(fields.map(k => [k, (old[k] || 0) + (+p[k] || 0)])), at: Date.now() };
  const kept = Object.fromEntries(Object.entries(all).sort((a,b) => b[1].at - a[1].at).slice(0,100));
  await env.setRt({ petCohorts: kept });
}
const chainBlocked = () => !!env.rt.petBufferTrip || env.canRun?.() === false || env.tvtHold() || env.abHold() || !!env.antibotState() || !!env.rt.shop?.urgent || !!env.rt.zoneGo || !!env.rt.bagCheck || !!env.rt.revive;
return { paymentReconcile, step, preview, summary, chainBlocked, archiveUnknown, resetBudget, capture, noteSnapshot, invalidateSnapshot, noteBattle, snapshot, defenseContext, heroContext, combatContext, raidContext, petExpected, petBuffState, petBuffActive, catalogSet, coverage, DEF };
 };
})(globalThis);
