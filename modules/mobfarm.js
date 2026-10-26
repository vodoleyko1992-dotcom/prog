/* L2wap v7: isolated mobfarm feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.mobfarm = function create_mobfarm(env) {
const location = env.routeLocation || root.location;
// Рейдовый тур и ожидаемый бой удерживают текущую локацию. Обычный фарм может менять зону и выполнять ресурсную цель.
// 10.0 (лог 12.10 11:16–11:52: тур 36 мин без единого РБ — «все не по силам», а автофарм стоял в зоне 8,8 M EXP/ч при замере 32 M в Silent Valley):
// тур в простое (подходящих РБ нет, rbHuntIdle) больше не держит автофарм и фарм ресурса на месте
const rbHold = () => !!((env.cfg.rbHuntMode && !((env.rt.rbHuntIdle || 0) > Date.now())) || (!env.cfg.rbHuntMode && env.cfg.rbMode && env.rt.rbPending));
// 7.1.30: «Риба · ур. 48 · миньоны зоны эпика» (spawnId l2dop_eg_…) — охрана эпика, не обычный моб
const EPIC_GUARD = /миньон|мін[ьй]он|epic guard|зоны эпика|зони епіка/i;
function pageItems() {
  return [...document.querySelectorAll('#map-mob-list a.l2-map-mob-link')].map(a => {
    const id = (a.getAttribute('href') || '').match(/spawnId=([^&#]+)/)?.[1] || '';
    const text = a.textContent.trim(), m = text.match(env.LV_RE);
    const row = a.closest?.('li')?.textContent || text, stat = key => { const v = row.match(new RegExp('\\b' + key + '\\s+([0-9][0-9 \\u00a0\\u202f]*)', 'i')); return v ? Number(v[1].replace(/\s/g, '')) : 0; };
    return { a, id, text, hp: stat('HP'), exp: stat('EXP'), name: m ? m[2].trim() : text, lvl: m ? +m[3] : 0,
             quest: a.classList.contains('l2-map-mob-link--quest-target') || env.QUEST.test(text),
             champ: env.isChamp(text), boss: env.isBoss(text) || env.isRaidId(id) || a.classList.contains('l2-map-mob-link--raid') || EPIC_GUARD.test(text) || /--epic_guard/.test(a.className) };
  }).filter(x => x.id);
}

function pagerInfo() {                         // «5 / 27 (398)»
  const m = (env.$q('#map-mob-page-ind')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+)\s*\)/);
  if (m) return { cur: +m[1], total: +m[2], count: +m[3] };
  // 14.10: «1 2 3 4 5 >>» больше не содержит общее число страниц. Игра пишет count и p (с нуля) в подпись списка.
  const parts = (env.$q('#map-mob-list')?.dataset.l2AroundSig || '').split('|');
  const page = parts.slice(2).find(p => /^p\d+$/.test(p));
  if (!/^\d+$/.test(parts[0]) || !page) return null;
  const count = +parts[0], cur = +page.slice(1) + 1, total = Math.max(1, Math.ceil(count / env.PAGE_SIZE));
  return cur <= total ? { cur, total, count } : null;
}

const pageKey = () => (env.$q('#map-mob-page-ind')?.textContent || '') + '|' + pageItems().map(i => i.id).join(',');

async function gotoPage(n, active = () => true) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return false;
  for (let guard = 0; guard < 40 && env.on && active(); guard++) {
    const pg = pagerInfo();
    if (!pg) return false;
    n = Math.max(1, Math.min(n, pg.total));
    if (pg.cur === n) return true;
    const buttons = [...(env.$q('#map-mob-page-ind')?.querySelectorAll?.('.l2-compact-pages__btn') || [])];
    // Номер в текущей группе — прямой переход; >>/<< ведут на первую страницу следующей/предыдущей пятёрки.
    const direct = buttons.find(b => b.textContent.trim() === String(n));
    const btn = buttons.length ? direct || buttons.find(b => b.textContent.trim() === (pg.cur < n ? '>>' : '<<')) :
      env.$q(pg.cur < n ? '#map-mob-page-next' : '#map-mob-page-prev');
    if (!btn || btn.disabled) return false;
    const before = pageKey();
    if (!active() || !env.fire(btn)) return false;
    if (!(await env.waitFor(() => pagerInfo()?.cur !== pg.cur && pageKey() !== before && pageItems().length, 4000, 100))) return false;
    if (!active()) return false;
    await env.sleep(env.rnd(120, 300));
  }
  return false;
}

function aroundSig() {
  const parts = (env.$q('#map-mob-list')?.dataset.l2AroundSig || '').split('|');
  const ids = (parts[1] || '').split(',').map(x => x.split(':')[0]).filter(Boolean);
  // «q…» — отдельное поле после «pN|lvN». Список мобов (поле 1) тоже может начинаться с «q» (spawnId «quest_…») — его не берём
  const q = (parts.slice(2).find(p => /^q/.test(p) && !/[:]\d/.test(p)) || 'q').slice(1).split(',').map(x => x.trim()).filter(Boolean);
  return { ids, quest: q };
}

function markerTypes() {
  const t = {};
  // v5.6: тип моба (passive/aggressive/champion…) — из ответа сервера /game/map/spawns: метки карты теперь только у РБ
  if (env.NET_SPAWNS && Date.now() - env.NET_SPAWNS.t < 10 * 60000) Object.assign(t, env.NET_SPAWNS.kind);
  (env.$q('#map-mob-markers')?.dataset.l2MarkerSig || '').split('|')[1]?.split(',').forEach(x => {
    const [id, ty] = x.split(':'); if (id) t[id] = ty;
  });
  return t;
}

// 10.0.5 (обновление игры 13.10, анонс «Обновление чемпионов»): с чемпиона падает 1 Fast Aden — синий 10 %, оранжевый 20 %, красный 60 %
// (респ 10/10/15 мин), с обычного моба 1 %; только если моб не ниже героя больше чем на 5 ур. Цвет — championTier в /game/map/spawns
// (живой ответ 13.10, Wild Beast Pastures: 12 синих dense_*, 4 оранжевых champ_o_*, 2 красных champ_r_*; HP ×1 / ×2 / ×3 синего,
// EXP ×1 / ≈1,6 / ≈2), в разметке — li.l2-map-mob-item--champion-<цвет>
const FA_P = { blue: 0.1, orange: 0.2, red: 0.6 }, FA_MOB = 0.01, FA_BELOW = 5;
const TIER_RU = { blue: 'синий', orange: 'оранжевый', red: 'красный' };
function champTier(id, a, unknown = 'blue') {      // в бою неизвестный цвет не разрешаем автоматически как синий
  const li = a?.closest?.('li'), m = (li?.className || '').match(/l2-map-mob-item--champion-(\w+)/);
  if (m) return m[1];
  const t = Date.now() - (env.NET_SPAWNS?.t || 0) < 10 * 60000 ? env.NET_SPAWNS?.tier?.[id] : '';
  if (t) return t;
  if (/^champ_r_/i.test(id || '')) return 'red';
  if (/^champ_o_/i.test(id || '')) return 'orange';
  return unknown;
}
// шанс 1 FA с этого моба (0 — моб ниже героя больше чем на 5 ур.)
// 10.0.5 (игрок 13.10 00:32: «поставь фарм мобов −5 лвл максимум, иначе не падают ФА»): ниже героя больше чем на 5 ур. не бьём никогда —
// ни по окну из меню (больше 5 или «0» = 5), ни чемпионов (было −8), ни «мягким окном», когда тут все мобы ниже. Исключения — только явные
// задачи: ★ квест, источник ресурса/рецепта, чемпион главы
const lowCap = () => Math.min(+env.cfg.lvlBelow > 0 ? +env.cfg.lvlBelow : FA_BELOW, FA_BELOW);
// 20.43 (разбор 21.10, ночной лог alt2 Warlord 48: ≥ 4 % FA за обычный бой против 1 % анонса): шанс — свой замер класса (champs.faRate,
// сглажен анонсом); без модуля чемпионов — анонс, как раньше
const faChance = (champ, tier, lvl, hl = env.heroLvl() || env.rt.lvl || 0) => hl && lvl && lvl < hl - FA_BELOW ? 0 : env.champs?.faRate ? env.champs.faRate(champ ? (FA_P[tier] ? tier : 'blue') : 'mob') : champ ? FA_P[tier] || FA_P.blue : FA_MOB;

async function netSpawns(list) {
  const kind = {}, tier = {}, hp = {}, exp = {}, sp = { ...(env.rt.spawns || {}) };
  let added = 0;
  for (const [id, k, name, lvl, , tr, mh, ex] of list) {
    if (!id) continue;
    if (k) kind[id] = k;
    if (k === 'champion') { const t = tr || (/^champ_r_/i.test(id) ? 'red' : /^champ_o_/i.test(id) ? 'orange' : champTier(id, null, '')); if (t) tier[id] = t; if (mh > 0) hp[id] = mh; if (ex > 0) exp[id] = ex; }   // 20.13 (шаг 5, farm/MF-2): неизвестный цвет не подставляем «синим» — решение за tierOff
    if (name && !env.isRaidId(id) && (!sp[id] || sp[id][0] !== name || sp[id][1] !== lvl)) { sp[id] = [name, lvl]; added++; }
  }
  env.NET_SPAWNS = { t: Date.now(), kind, tier, hp, exp };
  const ch = list.filter(x => x[1] === 'champion'), key = ch.map(x => x[0]).join(',');
  if (key !== (env.rt.netChampKey || '')) {
    env.rt.netChampKey = key;
    if (!env.tabIdle) env.setRt({ netChampKey: key }).catch(() => {});
    // 10.0.5: красные и оранжевые первыми, с цветом — их бот бьёт ради FA
    const tw = x => ({ red: 0, orange: 1 })[tier[x[0]]] ?? 2;
    if (ch.length) env.rec('B', 'чемпионы', `в списке локации (сервер): ${[...ch].sort((a, b) => tw(a) - tw(b)).slice(0, 5).map(x => `${x[2]} (${x[3]}${tier[x[0]] && tier[x[0]] !== 'blue' ? ', ' + TIER_RU[tier[x[0]]] : ''})`).join(', ')}${ch.length > 5 ? ` …ещё ${ch.length - 5}` : ''}`);
  }
  if (added && !env.tabIdle) await env.setRt({ spawns: Object.keys(sp).length > 4000 ? Object.fromEntries(list.filter(x => x[2] && !env.isRaidId(x[0])).map(x => [x[0], [x[2], x[3]]])) : sp });
}

function parseRules() {
  // кампания с открытыми мобами-целями: ★ цели главы всегда первые — даже если «Искать квестовых» выключено
  // (так было: галочка снята → правило [квест] выпало → бот бил ближайших Shooter/Marksman вместо ★ Guerilla рядом)
  const campQuest = env.campMobOpen().length > 0;
  const rules = env.cfg.priority.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const neg = line.startsWith('-');
    const t = neg ? line.slice(1).trim() : line;
    return {
      neg, line,
      quest: /\[квест\]/i.test(t), champ: /\[чемп\]/i.test(t), all: /\[все\]/i.test(t),
      name: t.replace(/\[(квест|чемп|все)\]/gi, '').trim().toLowerCase()
    };
  }).filter(x => x.neg || ((!x.quest || env.cfg.searchQuest || campQuest) && (!x.champ || champRuleOn())));
  if (campQuest && !rules.some(x => x.quest && !x.neg))
    rules.unshift({ neg: false, line: '[квест] (кампания)', quest: true, champ: false, all: false, name: '' });
  const fr = [...env.farmRules(), ...env.recipeRules()];  // фарм ресурса и охота на рецепт: мобы-источники — сразу после квестовых
  if (fr.length) rules.splice(rules.findIndex(x => !x.neg && x.quest) + 1, 0, ...fr);
  // глава ждёт «★ Чемпионы N/M»: чемпионы редкие, а мобы-цели есть всегда — увиденный чемпион идёт первым
  // (так было: [квест] выше [чемп] → бот бил Marsh Stakato, а чемпионов главы не трогал вовсе)
  if (env.campActive() && env.campChampOpen()) {
    const i = rules.findIndex(x => !x.neg && x.champ && !x.quest && !x.name);
    const r = i >= 0 ? rules.splice(i, 1)[0] : { neg: false, line: '[чемп] (глава)', quest: false, champ: true, all: false, name: '' };
    rules.unshift(r);
  }
  return rules;
}

function champRuleOn() {
  if (env.campActive() && env.campChampOpen()) return true;
  if (env.campActive() && env.campMobOpen().length) return false;
  // v4.30: галочка «Искать чемпионов» решает сама. Раньше бот молча выключал чемпионов, если цепочка давала на 10 % больше
  // EXP/мин, — игрок видел «Чемп» в приоритете, а чемпионов бот не искал
  return !!env.cfg.searchChamp;
}

function chainBetter() {
  const E = env.rt.eff || {}, c = E.chain, m = E.map;
  return !!c && !!m && c.n >= 5 && m.n >= 5 && c.rate > m.rate * 1.1;
}

function chainCarries() {
  const q = env.rt.chainQ || [];
  if (q.length < 6 || (!(+env.cfg.deepEvery > 0) && !env.farmMapOn?.())) return false;   // 7.2: на точке фарма ресурса карта есть и при 0   // 7.1.31: 0 = карту не проверять — откладывать нечего   // v4.28: deepHot больше не отключает цепочку — решает доля целей
  if (env.campActive() && env.campChampOpen() && !env.rt.champSeen?.startsWith('0:')) return false;   // чемпионы главы видны на карте — не откладываем
  return q.reduce((a, b) => a + b, 0) / q.length >= 0.5 && (env.rt.sinceDeep || 0) < env.deepN() * 3;
}

function ruleMatch(x, r) {
  if (!x.quest && !x.champ && !x.all && !x.name) return false;
  if (x.quest && !r.quest) return false;
  if (x.champ && !r.champ) return false;
  if (x.name && !r.name.toLowerCase().includes(x.name)) return false;
  if (x.all && (r.lvl < env.cfg.lvlMin || r.lvl > env.cfg.lvlMax)) return false;
  return true;
}

// открытая ★ цель квеста есть на ЭТОЙ локации (квест профессии — только свежий ≤ 1 ч; ★ из подписи карты/списка — только мобы этой зоны,
// мобы зоны ещё не известны — любая). Та же проверка решает «за ★ целью на карту» в nextFight и «есть зачем проверять карту» (searchActive)
function questHere() {
  const zM = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  const pqFresh = Date.now() - (env.rt.profQuest?.t || 0) < 3600000;   // 7.1.30: квест профессии — только свежий (≤ 1 ч)
  const qNames = [...(pqFresh ? env.rt.profQuest?.open || [] : []), ...(env.rt.questTargets || []).map(n => n.toLowerCase())].filter(n => env.isQuestName(n));
  return qNames.some(n => !zM.length || zM.includes(n));
}
// моб из правила с именем есть на этой локации (как ruleMatch: имя правила — часть имени моба); мобы зоны не известны — да
function nameHere(name) {
  const zM = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  return !zM.length || zM.some(n => n.includes(String(name || '').toLowerCase()));
}

function rank(r, rules) {
  if (r.boss) return -1;
  if (rules.some(x => x.neg && ruleMatch(x, r))) return -1;
  return rules.filter(x => !x.neg).findIndex(x => ruleMatch(x, r));
}
// A remembered catIn is only a return hint. It does not prove the current battle
// is inside a dungeon: Ashen Bastion and other zones have their own spawn IDs.
const dungeonBattle = () => /^sdms_/i.test(new URLSearchParams(location.search).get('spawnId') || '');
// 20.66 (лог 26.10 21:52): оплаченный Rebirth-поход не уводим в обычную карту/планировщик катакомб.
const rebirthBattle = () => /^rebirth_raid_/i.test(new URLSearchParams(location.search).get('spawnId') || '');
let rebirthAttempt = null;
async function rebirthNext(ctx) {
  if (!env.victory()) return; // старое продолжение победы не трогает уже начатый игроком бой
  const char = env.rt.char, prof = env.rt.classCur?.prof, slot = env.rt.classCur?.slot, page = location.href;
  const owner = env.evidenceOwner?.(), scan = env.scanContext?.(), generation = env.actionGeneration?.(), mode = env.autonomyMode(), level = env.heroLvl();
  const info = env.battleInfo?.(), infoSig = JSON.stringify(info || null), title = env.$q('#battle-mob-title')?.textContent || '';
  const name = title.replace(/\s*[·•]\s*ур\.?\s*\d+[\s\S]*$/i, '').trim();
  const fresh = info && Date.now() - info.t >= 0 && Date.now() - info.t < 60000 && String(info.name || '').toLowerCase() === name.toLowerCase();
  const after = fresh && info.spawn || ctx?.name === name && ctx.spawnId || '';
  const victory = env.$q('#battle-victory-inline'), hunt = env.$q('#battle-victory-hunt'), ctxSpawn = ctx?.spawnId;
  const active = () => env.on && env.tabOwner === true && env.canAct?.() !== false && env.heroNick?.() === char
    && env.rt.char === char && env.rt.classCur?.prof === prof && env.rt.classCur?.slot === slot && location.href === page
    && env.evidenceOwner?.() === owner && env.scanContext?.() === scan && env.actionGeneration?.() === generation
    && env.autonomyMode() === mode && env.heroLvl() === level && !env.pvpPending?.() && !env.antibotState?.() && !env.tvtSoon();
  const current = () => active() && env.victory() && env.cfg.chain !== false && ctx?.spawnId === ctxSpawn
    && env.$q('#battle-victory-inline') === victory && env.$q('#battle-victory-hunt') === hunt && env.shown(hunt) && !hunt.disabled
    && (env.$q('#battle-mob-title')?.textContent || '') === title && JSON.stringify(env.battleInfo?.() || null) === infoSig;
  const hold = async why => { if (active()) { env.setStatus('Rebirth: ' + why); await env.sleep(1000); } };
  if (!active()) return;
  if (env.cfg.chain === false) return hold('цепочка выключена — жду вашего продолжения');
  if (!['farm', 'auto', 'campaign', 'cat', 'raid', 'epic'].includes(mode)) return hold('выбранная задача не продолжает поход');
  if (!current() || !/^rebirth_raid_/i.test(after) || !owner || !scan || !Number.isFinite(generation)
      || !prof || !Number.isInteger(slot) || slot < 0 || fresh && ctxSpawn && ctxSpawn !== after)
    return hold('текущая победа не подтверждена — жду вашего продолжения');
  const key = JSON.stringify([char, prof, slot, after]), receiptKey = 'l2bot.rebirth-next';
  const receipt = () => JSON.parse(sessionStorage.getItem(receiptKey) || 'null');
  const clear = () => { try { if (receipt()?.key === key) sessionStorage.setItem(receiptKey, 'null'); } catch (_) {} };
  try { if (receipt()?.key === key) return hold('исход продолжения ещё не подтверждён — повторно не нажимаю'); }
  catch (_) { return hold('не удалось прочитать отметку продолжения'); }
  if (rebirthAttempt?.key === key && (rebirthAttempt.busy || Date.now() < rebirthAttempt.until)) return hold('жду повторной серверной сверки');
  const attempt = rebirthAttempt = { key, busy: true, until: Date.now() + 15000 };
  try {
    if (await env.tvtHoldWait?.() || !current()) return;
    const ready = !env.dailyWorkReady || await env.dailyWorkReady('mobs');
    if (!current()) return;
    if (!ready) return hold('лимит охоты проверяется или достигнут');
    if (env.actionWait && !await env.actionWait(current) || !current()) return;
    if (typeof env.gameGet !== 'function' || !await env.rtCommit?.() || !current()) return hold('не удалось подтвердить память перед продолжением');
    const response = await env.gameGet('/character', 4000);
    if (!current()) return;
    if (!response.ok) { attempt.until = Date.now() + 60000; return hold('персонаж не подтверждён сервером'); }
    const data = await response.json();
    if (!current()) return;
    const ch = data?.character || data;
    if (data?.error || data?.ok === false || ch?.name !== char || typeof ch.id !== 'string' || !ch.id || ch.l2Profession !== prof
        || ch.classSlots?.activeSlot !== slot || ch.level !== level || !Number.isSafeInteger(ch.revision) || ch.revision < 0 || ch.inBattle !== false || !(ch.rebirthStage > 0))
      return hold('свой персонаж вне боя не подтверждён');
    const result = await env.gameGet('/game/rebirth-raids?view=instance', 4000);
    if (!current()) return;
    if (!result.ok) { attempt.until = Date.now() + 60000; return hold('оплаченный поход не подтверждён сервером'); }
    const instance = await result.json();
    if (!current()) return;
    const run = instance?.activeRun;
    if (instance?.error || instance?.ok === false || instance?.enabled !== true || !(instance.rebirthStage > 0)
        || typeof run?.id !== 'string' || !run.id || !after.startsWith('rebirth_raid_' + run.id + '_')
        || !Array.isArray(run.participantCharacterIds) || !run.participantCharacterIds.includes(ch.id))
      return hold('принадлежность текущего оплаченного похода не подтверждена');
    if (run.phase !== 'mobs' || !Number.isSafeInteger(run.mobKillTarget) || run.mobKillTarget <= 0
        || !Number.isSafeInteger(run.mobKills) || run.mobKills < 0 || run.mobKills >= run.mobKillTarget)
      return hold('этап требует вашего выбора — новый вход и логово не открываю');
    const stillReady = !env.dailyWorkReady || await env.dailyWorkReady('mobs');
    if (!current()) return;
    if (!stillReady) return hold('лимит охоты проверяется или достигнут');
    const saved = await env.setRt({ via: 'chain' });
    if (saved?.ok !== true || !current() || !await env.rtCommit?.() || !current()) return;
    if (env.nativePending?.()) return hold('жду завершения запроса игры перед продолжением');
    // Синхронная отметка переживает reload: неизвестный native next/start не разрешает второй клик.
    try { sessionStorage.setItem(receiptKey, JSON.stringify({ key, t: Date.now() })); }
    catch (_) { return hold('не удалось сохранить отметку продолжения'); }
    if (!current()) { clear(); return; }
    env.setStatus('Rebirth: продолжаю оплаченный поход');
    if (!env.fire(hunt)) { clear(); return hold('кнопка продолжения не сработала'); }
    await env.waitFor(() => !active() || !env.victory() || JSON.stringify(env.battleInfo?.() || null) !== infoSig, 8000, 50);
    if (current()) return hold('исход продолжения ещё не подтверждён — повторно не нажимаю');
  } catch (_) { attempt.until = Date.now() + 60000; return hold('серверная сверка не ответила — жду без повторного входа'); }
  finally { attempt.busy = false; }
}

// 20.6: случайное «Охотиться дальше» обходит фильтр catPick и снова даёт снявший баффы вид.
function dungeonCancelBlocked() {
  if (env.cfg.noCancelMobs === false) return false;
  const id = (location.search || '').match(/[?&]spawnId=sdms_([^&]+)_\d+(?:&|$)/)?.[1];
  return !!id && Object.values(env.rt.buffCancel || {}).some(r => !r.champ && r.dungeon === id && env.cancelRisk?.(r.name, false));
}

async function nextFight(ctx) {
  const rebirthFrame = () => JSON.stringify([location.href, env.scanContext?.(), env.evidenceOwner?.(), env.actionGeneration?.(),
    env.battleInfo?.(), ctx?.spawnId, env.$q('#battle-mob-title')?.textContent || '']);
  const source = rebirthBattle() ? { stamp: rebirthFrame(), victory: env.$q('#battle-victory-inline'), hunt: env.$q('#battle-victory-hunt') } : null;
  const sameFrame = () => !source || source.stamp === rebirthFrame() && source.victory === env.$q('#battle-victory-inline') && source.hunt === env.$q('#battle-victory-hunt');
  if (env.pvpPending?.()) return env.pvpRecoveryStep();
  if (await env.tvtStep?.()) return;
  if (!sameFrame()) return;
  if (env.tvtSoon() && !ctx?.rb) { env.rec('B', 'TvT', 'бой TvT скоро — после этого моба на арену'); location.href = '/tvt-arena.html'; await env.sleep(4000); return; }
  if (!env.on || !env.tabOwner) return;
  if (env.pvpPending?.()) return env.pvpRecoveryStep();
  // 15.10: начатый бой доводим до конца, после него отдельная заточка не начинает новую охоту/обслуживание.
  if (env.autonomyMode() === 'enchant') return env.toMap();
  if (env.victory() && await env.pvpStep?.()) return;
  if (!sameFrame()) return;
  if (!env.on || !env.tabOwner || env.tvtSoon() || env.antibotState?.()) return;
  if (env.autonomyMode() === 'enchant') return env.toMap();
  if (rebirthBattle()) return rebirthNext(ctx);
  // 10.0.19: ручная смена оружия до запуска бота не даёт POST-события расширению.
  // Сверка по GET один раз в 10 мин не уводит катакомбы на карту.
  if (env.cfg.shopAuto) await env.syncShotWeapon?.();
  if (!env.on || !env.tabOwner) return;
  // 20.43 (ревью разбора лога 21.10 21:57–21:59): окно TvT на странице победы — до любых служебных походов (закупка тура, плановая
  // проверка запасов, бафф, карта тура/эпика): стоим и пишем «жду TvT», как ядро на карте. Как и там, пропускаем только уже
  // заказанную срочную закупку (rt.shop.urgent, «🛒 Закупить сейчас»). На арену за минуту до старта уводят tvtStep/tvtSoon выше
  if (env.victory() && !env.rt.shop?.urgent && await env.tvtHoldWait?.()) return;
  // v5.2.2: в «Туре РБ» проверка расходников раньше не доходила (выход на карту стоял выше) — банки не докупались
  // 20.12 (ревизия 17.10, аудит PAY-1): при неизвестной оплате после победы не уходим в магазин/телепорт — цепочка продолжается.
  const payHold = !!env.paymentHold?.();
  if (!payHold && env.huntOn() && env.cfg.shopAuto && !env.rt.shop && Date.now() - (env.rt.shopT || 0) > (env.shopGap?.() ?? 600000)) { const low0 = env.shopNeedByPanel(); if (low0) { await env.shopStart(`${low0} — докупаю всё, пока не в бою`, true); location.href = '/char.html'; await env.sleep(4000); return; } }
  // 10.0 (аудит фарма): тур «лечится на мобах» (HP < порога перед РБ) — цепочкой (≈5 с на моба), а не через карту после каждого боя (≈11 с)
  const healing = (env.rt.rbHunt?.phase === 'prepare' || env.rt.rbHunt?.last === 'лечусь на мобах') && (env.meHp?.()?.pct ?? 100) < (env.cfg.rbRestHp ?? 95);
  if (env.huntOn() && !((env.rt.rbHuntIdle || 0) > Date.now()) && !healing) return env.toMap();
  if (env.epicOn() && env.rt.epic?.step && env.rt.epic.step !== 'pick') return env.toMap();
  if (env.autonomyMode() === 'tasks' && !tasksGoalHere()) return env.toMap();   // 10.0: без режима — бой (начатый игроком или по задаче) довели, дальше не охотимся   // 🐉 эпики: после миньона/моба — снова к эпику   // тур по РБ: дальше решает rbHuntStep (следующий РБ); пока РБ нет — цепочкой
  // расходники на исходе (по панели) или пора проверить руду (раз в час) — сначала в магазин
  // (не чаще раза в 10 мин — если адены не хватило, не бегаем в магазин после каждого боя)
  if (env.rt.shop && !payHold) { location.href = '/char.html'; await env.sleep(4000); return; }   // «Закупить сейчас» нажали во время боя
  if (env.rt.bagCheck && !payHold) { location.href = '/char.html'; await env.sleep(4000); return; }   // «Пересчитать в сумке» из меню
  if (env.rt.zoneGo && !payHold) { location.href = '/teleport.html'; await env.sleep(4000); return; }   // «Лететь» в меню локаций
  if (!ctx?.rb && await env.townBuffStart('баффы кончились')) return;            // городской бафф слетел (смерть/24 ч)
  if (env.autonomyMode() === 'enchant') return env.toMap();
  const since = Date.now() - (env.rt.shopT || 0);
  const shopGap = env.shopGap?.() ?? 600000;   // 20.13 (ревизия 17.10, шаг 5, ECO-1): пауза растёт, если купить было нечего
  const low = since > shopGap ? env.shopNeedByPanel() : '';
  const plan = env.cfg.shopAuto ? env.shopPlan() : [];
  let oreDue = env.cfg.shopAuto && plan.some(x => ['spirit', 'soul', 'bait'].includes(x.key)) && since > Math.max(3600000, shopGap);
  // 8.0 (аудит фарма B4): сумка из ответов сервера свежая (< 5 мин, env.invQty) и всё из плана закупки не ниже минимума —
  // плановый поход в инвентарь (≈10–15 с раз в час) ничего не купит, пропускаем. Не пропускаем, если идут «Квесты на ресурсы»
  // (прогресс берётся из пересчёта сумки) или полный пересчёт сумки старше 5 ч (по нему оценивается запас банок перед РБ)
  if (oreDue && !env.resQuests().length && Date.now() - (env.rt.bagAll?.t || 0) < 5 * 3600000
      && plan.every(x => x.ids?.length && x.ids.every(id => env.invQty?.(id) != null) && x.ids.reduce((a, id) => a + env.invQty(id), 0) >= x.mm[0])) oreDue = false;
  if (!payHold && (low || (oreDue && !ctx?.rb))) { await env.shopStart(low || 'плановая проверка запасов'); location.href = '/char.html'; await env.sleep(4000); return; }
  // Новый уровень проверяем после подтверждённой победы, до обеих цепочек. Обычный catloop без задачи не меняем.
  if (!env.on || env.tabOwner === false) return;
  if (env.magisterAfterWin && env.victory()) {
    if (await env.magisterAfterWin(ctx)) return;
    if (env.pvpPending?.()) return env.pvpRecoveryStep();
    if (env.tvtSoon()) return; // Условия могли измениться во время чтения персонажа.
    // 20.43 (лог 21.10 21:57:02–21:58:56): окно TvT — новый бой не начинаем, как и на карте, но пишем «TvT через N с — жду»
    if (env.magisterHold?.()) { await env.tvtHoldWait?.(); return; }
  }
  if (!env.on || env.tabOwner === false) return;
  // Автобаф кота — обслуживание между целями, без выхода из выбранной зоны.
  // 20.13 (ревизия 17.10, шаг 7, farm/MF-4): повтор той же проверки on/tabOwner без await между ними убран
  if (env.autonomyMode() === 'enchant') return env.toMap();
  if (env.victory()) await env.warlock?.step?.({ afterWin: true });
  if (!env.on || env.tabOwner === false) return;
  if (env.pvpPending?.()) return env.pvpRecoveryStep();
  if (env.tvtSoon() || env.warlock?.chainBlocked?.()) return;
  if (env.autonomyMode() === 'enchant') return env.toMap();
  if (env.autonomyMode() === 'fish') return env.goFishing();
  // 20.43 (John 21.10 13:44): крафтеру нужен другой набор (пика ↔ булава+щит+голем) — после победы на карту, набор сменится там
  if (env.victory() && env.canAct?.() !== false && env.crafterKit?.chainWant?.()) return env.toMap();
  // 19.10, аудит: служебные шаги после победы доступны и при сбое дневного API; новый бой — только после сверки.
  if(env.dailyWorkReady && !await env.dailyWorkReady('mobs')) { if(env.on && env.tabOwner!==false && env.victory() && env.canAct?.()!==false)return env.toMap();return; }
  // 10.0.22 (лог15.10 05:06): Ashen поддерживает штатную цепочку; список — только запасной путь.
  if (/^ashen_bastion_mob_/i.test(new URLSearchParams(location.search).get('spawnId') || '') && env.autonomyMode() === 'farm') {
    if (env.cfg.chain !== false) {
      const hunt = await env.waitFor(() => { const h = env.$q('#battle-victory-hunt'); return env.shown(h) && !h.disabled ? h : null; }, 2500, 50);
      if (!env.on || env.tabOwner === false || env.autonomyMode() !== 'farm' || env.antibotState?.()) return;
      if (hunt) {
        if(env.dailyWorkReady && !await env.dailyWorkReady('mobs'))return;
        const t0 = Date.now(); env.setStatus('Ashen Bastion: охотиться дальше'); env.setRt({ via: 'chain' }); env.fire(hunt);
        const started = () => !env.victory() && (env.mobHp()?.cur || 0) > 0;
        let ok = await env.waitFor(started, 8000, 50);
        const net = env.actNet?.();
        if (!ok && env.on && env.tabOwner !== false && net && net.huntT >= t0 && !((net.huntDoneT || 0) >= net.huntT)) ok = await env.waitFor(started, 7000, 50);
        if (ok || !env.on || env.tabOwner === false || env.autonomyMode() !== 'farm' || env.antibotState?.()) return;
        // Игра может уже перейти к новому бою; не перекрываем навигацию старого документа.
        if (!env.victory() || !/\/battle\.html/i.test(location.pathname)) return;
        env.rec('B', 'цепочка', 'Ashen Bastion: следующий бой не подтвердился — возвращаюсь к местному списку');
      }
    }
    if (!env.on || env.tabOwner === false || env.autonomyMode() !== 'farm') return;
    location.href = '/ashen-bastion.html'; await env.sleep(3000); return;
  }
  if (env.cfg.catMode && !env.campOn() && !env.huntOn()) {    // 🏛 фарм катакомб: после боя — «Охотиться дальше» внутри подземелья
    // 20.7: игрок уже мог начать следующий бой, пока старый nextFight обслуживал победу.
    if (dungeonBattle() && !env.victory()) return;
    // 20.10, лог13:41: native продолжение запросило67, сервер выдал62. В «Авто» каждую цель выбираем из свежего списка.
    const checkedChain = dungeonCancelBlocked() || !env.cfg.catDungeon || env.cfg.catDungeon === 'auto';
    // 20.41: свежий список однородный — catNext отвечает 'native', и следующий бой даёт штатная кнопка (без загрузки страницы).
    let native = false;
    if (env.cfg.chain !== false && dungeonBattle() && checkedChain && env.catNext) {
      const r = await env.catNext();
      if (r === 'native') native = true;
      else if (r) return;
      if (!env.on || env.tabOwner === false || !env.victory()) return;
    }
    // v5.3.1: раньше после каждого моба бот уходил на страницу подземелья и выбирал заново (≈3 с на моба, лог 08.10 14:49).
    // «Охотиться дальше» в подземелье даёт следующего моба оттуда же — цепочкой, как на карте
    if (env.cfg.chain !== false && dungeonBattle() && (!checkedChain || native)) {
      const hunt = await env.waitFor(() => { const h = env.$q('#battle-victory-hunt'); return env.shown(h) ? h : null; }, 2500, 50);
      if (!env.on || env.tabOwner === false) return;
      if (env.autonomyMode() === 'enchant') return env.toMap();
      if (hunt) {
        if(env.dailyWorkReady && !await env.dailyWorkReady('cat'))return;
        env.setStatus('Катакомбы: охотиться дальше'); env.setRt({ via: 'chain', catInT: Date.now() });   // 10.0: запись не ждём
        const href = location.href, t0 = Date.now(); if (native) env.catNatArm?.(); env.fire(hunt);
        const started = () => (location.href !== href && !/\/dungeon\.html/i.test(location.pathname)) || (!env.victory() && (env.mobHp()?.cur || 0) > 0);
        let ok = await env.waitFor(started, 8000, 50);
        // 10.0 (карта): запрос hunt-continue ещё в полёте — ждём ответ до 15 с, а не уходим
        const net = env.actNet?.();
        if (!ok && env.on && net && net.huntT >= t0 && !((net.huntDoneT || 0) >= net.huntT)) ok = await env.waitFor(started, 7000, 50);
        if (ok) env.catNatOk?.();   // 20.41: штатное продолжение сработало — метка ожидания снята
        if (ok || !env.on) return;
        // 10.0.7 (игрок 13.10 03:20: «в катакомбах не работает кнопка охотиться дальше»; код игры battle.js huntContinueManual): в подземелье
        // отказ сервера на hunt-continue игра не показывает — молча уводит на страницу подземелья (/dungeon.html). Бот считал «бой начался»
        // по смене адреса, а дальше ничего не писал. Теперь: причина в журнал (раз в 10 мин), следующий моб — из списка подземелья
        const E = env.NET_ERR, err = E && E.t >= t0 && /hunt-continue/.test(E.path || '') ? E.err : '';
        if (Date.now() - (env.rt.catHuntNoteT || 0) > 600000) {
          env.rec('B', 'катакомбы', `«Охотиться дальше» в подземелье не сработало${err ? ` (сервер: ${String(err).slice(0, 60)})` : ''} — следующий моб беру из списка подземелья`);
          env.setRt({ catHuntNoteT: Date.now() });
        }
      }
    }
    if (dungeonBattle() && !env.victory()) return;
    return env.catGo();
  }
  if (env.campOn() && env.rt.campaignDue) return env.goCampaign();
  // фарм ресурса (меню или «Нужно сдать» главы): не в той зоне — летим с форума «Фарм ресурсов»
  if ((env.cfg.farmRes || env.campEnabled() || env.resQuests().length) && !rbHold() && !ctx?.rb && !env.campMobOpen().length && await env.farmStep()) return;
  if (env.cfg.recipeRes && !rbHold() && !ctx?.rb && !env.campMobOpen().length && await env.recipeStep()) return;   // охота на рецепт
  // сам подбирает локацию для кача (не в кампании/РБ/рыбалке): проба новых подходящих зон, затем лучшая по EXP/ч
  if (env.cfg.zoneAuto && !env.campEnabled() && !rbHold() && !ctx?.rb && !env.lootGoal?.() && Date.now() - (env.rt.zoneGoT || 0) > 600000) {   // 7.2: цель ресурса/рецепта держит на месте
    if ((!env.rt.zoneCatT || env.zoneCatThin() || Date.now() - env.rt.zoneCatT > 24 * 3600000) && ((env.rt.zoneCatFail || 0) < 3 || Date.now() - (env.rt.zoneCatFailT || 0) > 3600000)) { await env.setRt({ zoneScan: true }); location.href = '/teleport.html'; await env.sleep(4000); return; }
    const pick = env.zonePick();
    // 10.0 (лог 12.10 12:00:05–12:00:16): метка «▶ при старте» из меню оставалась — карта выбирала зону второй раз сразу после полёта
    if (pick) { await env.setRt({ zoneGo: { ...pick, t: Date.now() }, zoneGoT: 0, zoneAutoKick: null }); location.href = '/teleport.html'; await env.sleep(4000); return; }
  }
  // глава: «Охотиться дальше» даёт случайного соседа. Чужой моб в цепочке — не повод уходить на карту:
  // уходим, только если цепочка приносит цели реже, чем окупается дорога через карту
  // (время на цель цепочкой = с/моб ÷ доля целей; через карту ≈ с/моб карты — там бот сам выбирает цель).
  const rules = parseRules();
  // 7.2: моб-источник ресурса/рецепта — тоже «цель» (по доле таких в цепочке решаем, нужна ли карта)
  const tgt = !!ctx && (env.isQuestName(ctx.name) || ctx.killed.some(n => env.isQuestName(n)) || (!!ctx.champ && rules.some(x => x.champ && !x.neg))
    || rules.some(x => x.farm && x.name === String(ctx.name || '').toLowerCase()));
  const resourceFarm = !!env.farmMapOn?.();
  const camp = !!ctx && env.campMobOpen().length > 0;
  if (ctx && (camp || env.searchActive(rules)) && env.rt.via === 'chain') env.setRt({ chainQ: [...(env.rt.chainQ || []), tgt ? 1 : 0].slice(-12) });
  let offQuest = false, campChain = null;
  if (camp && !tgt && !resourceFarm) {
    const q = env.rt.chainQ || [], share = (q.reduce((a, b) => a + b, 0) + 1) / (q.length + 2);
    const cs = env.rt.eff?.chain?.sec || 9, ms = env.rt.eff?.map?.sec || 20, perTgt = cs / share;
    offQuest = q.length >= 6 && perTgt > ms * 1.1;           // решаем по 6+ боям цепочки, не по одному чужому мобу
    const why = `цепочка: целей ${Math.round(share * 100)} % · ≈${perTgt.toFixed(0)} с на цель против ≈${ms.toFixed(0)} с через карту`;
    campChain = { why, viable: q.length >= 6 && Number.isFinite(perTgt) && perTgt > 0 && Number.isFinite(ms) && ms > 0 && !offQuest };
  }
  // 7.1.30 (10.10 14:01): ★ квестовые мобы на локации (квест профессии: Giant Fungus/Dire Wyrm), а «Охотиться дальше» дал чужого —
  // цепочка 10 боёв била кого попало до плановой проверки карты. Есть открытые ★ цели и этот моб не цель — сразу на карту за целью
  // только если такая цель есть на ЭТОЙ локации (подпись карты «q…» перечисляет цели квеста на любой локации)
  // и только если правило [квест] вообще может выбрать цель (иначе карта после каждого боя ни к чему)
  const qRule = rules.some(x => x.quest && !x.neg);
  // 7.1.31: «Проверять карту каждые 0 боёв» = никогда — за ★ целью на карту тоже не ходим (бьём то, что даёт цепочка)
  const qOpen = !resourceFarm && qRule && env.cfg.searchQuest !== false && !camp && +env.cfg.deepEvery > 0 && questHere();
  if (ctx && qOpen && !tgt && !ctx.rb) {
    offQuest = true;
    if (env.rt.chainWhy !== 'qmap') { env.rec('B', 'цепочка', `${ctx.name} — не ★ цель квеста; иду на карту за целью`); env.setRt({ chainWhy: 'qmap' })?.catch?.(() => {}); }
  } else if (ctx && qOpen && tgt && env.rt.chainWhy === 'qmap') env.setRt({ chainWhy: 'chain' })?.catch?.(() => {});
  let due = env.mapDue(rules);
  // 15.10 (лог11:11,21:06:12): 43% целей давали ≈6 с/цель против ≈10 с через карту,
  // но deepHot после дальней страницы отменял решение. Убираем только внеплановый hot-выход;
  // срок проверки карты, чемпионы главы, РБ и ресурсные 50 боёв сохраняют приоритет.
  if (due && !resourceFarm && campChain?.viable && env.rt.deepHot && !env.campChampOpen() && !env.campRbOpen().length
      && !env.mapDue(rules, true)) due = false;
  // v4.28: цель далеко по списку карты (deepHot), но цепочка только что дала цель (★/чемпион) — соседи такие же, продолжаем
  // цепочку. Так было: Leto Lizardman Archer на 8-й странице → после КАЖДОГО боя карта (+5–8 с на бой)
  if (!resourceFarm && due && tgt && env.rt.deepHot && !env.rbDue() && !env.campRbOpen().length && (+env.cfg.deepEvery > 0 || env.farmMapOn?.())) {
    if (env.rt.chainWhy !== 'hot') env.rec('B', 'цепочка', `${ctx.name} — цель; цепочка приносит цели, карту не проверяю`);
    // 20.41 (лог 20.10, память 1,3 МБ: запись ≈0,5 с перед каждым «Охотиться дальше»): метка журнала цепочки — только при изменении и без ожидания
    { const nd = Math.min(env.rt.sinceDeep || 0, env.deepN() - 1); if (env.rt.chainWhy !== 'hot' || env.rt.sinceDeep !== nd) env.setRt({ chainWhy: 'hot', sinceDeep: nd })?.catch?.(() => {}); }
    due = false;
  }
  if (!resourceFarm && due && !env.rbDue() && !env.campRbOpen().length && chainCarries()) {
    if (env.rt.chainWhy !== 'carry') env.rec('B', 'цепочка', `цели идут цепочкой (${Math.round((env.rt.chainQ.reduce((a, b) => a + b, 0) / env.rt.chainQ.length) * 100)} % боёв) — плановую проверку карты откладываю`);
    if (env.rt.chainWhy !== 'carry') env.setRt({ chainWhy: 'carry' })?.catch?.(() => {});
    due = false;
  }
  // 10.0 (лог 12.10 12:01): заказ Маммона / почта / готовая часть квеста ждали, пока идёт цепочка — после этой победы разово на карту, дальше mmStep/storyStep
  if (!ctx?.rb && (env.mmChainWant?.() || env.storyChainWant?.() || env.tsChainWant?.())) {
    env.rec('B', 'цепочка', `после боя — дело вне боя (${env.mmChainWant?.()?.why || env.storyChainWant?.()?.why || env.tsChainWant?.()?.why || ''}), иду на карту`);
    return env.toMap();
  }
  const intent = { mode: env.autonomyMode(), kick: +env.rt.manualKickAt || 0, char: env.rt.char, chain: env.cfg.chain };
  const sameIntent = () => env.on && env.tabOwner !== false && env.cfg.chain === intent.chain && env.autonomyMode() === intent.mode
    && (+env.rt.manualKickAt || 0) === intent.kick && env.rt.char === intent.char;
  const chainNote = async (continuing, reason = '') => {
    if (!campChain) return;
    const key = continuing ? 'chain' : 'map';
    if (env.rt.chainWhy !== key) env.rec('B', 'цепочка', `${ctx.name} — не цель главы; ${campChain.why} → ${continuing ? 'продолжаю цепочку' : `на карту${reason ? ': ' + reason : ' за целью'}`}`);
    if (env.rt.chainWhy !== key) env.setRt({ chainWhy: key })?.catch?.(() => {});
  };
  if (env.cfg.chain && !offQuest && !due) {
    // кнопка «Охотиться дальше» появляется на экране победы не сразу (иногда через 0,3–1 с) —
    // ждём её, а не уходим на карту (v4.6–4.13: бот уходил через 0,2 с, «цепочка не работает»)
    const hunt = await env.waitFor(() => { const h = env.$q('#battle-victory-hunt'); return env.shown(h) ? h : null; }, 2500, 50);
    if (!env.on || env.tabOwner === false) return;
    if (env.autonomyMode() === 'enchant') return env.toMap();
    if (!sameIntent()) return;
    if (hunt) {
      await chainNote(true);
      if (!sameIntent() || env.tvtSoon() || env.antibotState?.()) return;
      if(env.dailyWorkReady && (!await env.dailyWorkReady('mobs') || !sameIntent()))return;   // 20.41: после ожидания — снова тот же замысел
      env.setStatus('Охотиться дальше');
      // 10.0 (лог 12.10: от записи «Охотиться дальше» до запроса 273 мс против ≈45 мс у игрока): запись не ждём — rt в памяти уже новый,
      // хвост очереди досылается при уходе со страницы (pagehide); опрос 50 мс вместо 250
      env.setRt({ via: 'chain' });
      const href = location.href, t0 = Date.now();
      env.fire(hunt);
      const started = () => (location.href !== href && !env.victory()) || (!env.victory() && (env.mobHp()?.cur || 0) > 0);   // 7.1.30: пока экран победы виден, бой не «начат» — иначе «Охотиться дальше» жмётся дважды
      let ok = await env.waitFor(started, 8000, 50);
      // 10.0 (лог 12.10, 7 раз за 47 мин: сервер отвечает на hunt-continue через ≈8,4 с, бот уходил на карту за 0,3 с до ответа):
      // запрос ушёл и ещё в полёте — ждём до 15 с
      const net = env.actNet?.();
      if (!ok && env.on && net && net.huntT >= t0 && !((net.huntDoneT || 0) >= net.huntT)) ok = await env.waitFor(started, 7000, 50);
      if (ok || !env.on) return;
      console.info(env.TAG, '«Охотиться дальше» не сработало — иду на карту');
    }
  }
  await chainNote(false, !env.cfg.chain ? 'цепочка выключена' : offQuest ? '' : due ? 'проверка приоритетных целей' : 'следующий бой не подтвердился');
  if (!sameIntent()) return;
  // 20.46 (лог 22.10 10:41:52): обычный выход ради поиска чемпионов отличаем в журнале от обучения/закупки/смены задачи выше.
  if (env.cfg.chain && due && !offQuest && !env.rbDue() && !env.campRbOpen().length) {
    const hot = env.rt.deepHot && env.rt.sinceDeep < env.deepN();
    env.rec('B', 'цепочка', `на карту: ${hot ? 'есть более приоритетные квестовые цели' : `плановая проверка целей — раз в ${env.deepN()} боёв`}`);
  }
  await env.toMap();
}

async function mapReady(timeout = 30000, label = '') {   // список мобов отрисован и не меняется (игра грузит его до ~10–20 с)
  let prev = '', same = 0;
  const t0 = Date.now(); let sec0 = -1;
  return env.waitFor(() => {
    // 20.6: новый выбор задач прерывает ожидание карты без ложной ошибки загрузки.
    if (env.canAct?.() === false) return 'changed';
    const sec = (Date.now() - t0) / 1000 | 0;
    if (label && sec >= 2 && sec !== sec0) { sec0 = sec; env.rt = { ...env.rt, status: `${label} · ${sec} с` }; env.draw(); }   // только индикатор, без записи в журнал
    if (env.serverDown()) return 'down';           // страница ошибки сервера — ждать список бессмысленно
    if (!env.$q('#map-mob-list')?.dataset.l2AroundSig || !pagerInfo() || !pageItems().length) { same = 0; return false; }
    const k = (env.$q('#map-mob-page-ind')?.textContent || '') + '|' + pageItems().length;   // порядок строк не учитываем
    same = k === prev ? same + 1 : 0;
    prev = k;
    return same >= 2;
  }, timeout, 250);
}

// 8.0.3 (лог 11.10 11:43:44 → 11:45:53): «мягкое окно» уровней (20 мин бить мобов ниже/выше окна) открылось в Sea of Spores при выключенном
// автофарме, а после смерти и ▶ с «Автофармом» действовало в Bee Hive — бот бил Ant Soldier 35 и Ant Larva 29 героем 56. Окно — только на той
// локации, где его открыли, и открытое без автофарма при автофарме не действует (тот сам летит в зону своего уровня)
const relaxOk = r => !!r && Date.now() - (r.t || 0) < 20 * 60000 && (r.zone || null) === (env.rt.zone || null) && (!env.cfg.zoneAuto || !!r.auto);
let farRecT = 0, lowRecT = 0, idleT0 = 0, idleRecT = 0, idleN = 0;   // 10.0.10: простой «Целей нет» — с какого момента, когда писали в журнал, проходов карты подряд
// 20.13 (ревизия 17.10, шаг 5, farm/MF-1): простой «Целей нет» кончается переходом на /map.html — контент-скрипт создаётся заново, и счётчики
// выше обнулялись: пауза 15 → 60 → 180 с не росла, причина простоя в журнал не попадала (≈200 перезагрузок/ч молча). Теперь счётчики
// переживают перезагрузку вкладки в sessionStorage; запись старше 10 мин (бот стоял/работал другим) не продолжается
const IDLE_KEY = 'l2bot.mapIdle';
function idleLoad() {
  if (idleT0) return;
  try { const s = JSON.parse(sessionStorage.getItem(IDLE_KEY) || 'null');
    if (s && Date.now() - (+s.at || 0) < 600000) { idleT0 = +s.t0 || 0; idleN = +s.n || 0; idleRecT = +s.recT || 0; } } catch (e) {}
}
function idleSave() { try { sessionStorage.setItem(IDLE_KEY, JSON.stringify({ t0: idleT0, n: idleN, recT: idleRecT, at: Date.now() })); } catch (e) {} }
function idleClear() { try { sessionStorage.removeItem(IDLE_KEY); } catch (e) {} }
// 20.13 (ревизия 17.10, шаг 7, farm/MF-3): метки «раз в 10 мин» жили в переменной модуля и обнулялись каждым переходом на /map.html —
// «пропускаю — снимает баффы / оранжевый…» писались на каждом заходе на карту. Теперь одна запись в sessionStorage, старше часа — стираются
const SKIP_KEY = 'l2bot.skipRecT';
let skipMem = {};                                   // без sessionStorage (тесты, запрет хранилища) — как прежде, в памяти модуля
function skipDue(k) {
  const now = Date.now();
  let m = skipMem;
  // ревью шага 7: память модуля сливается с записью хранилища — если setItem не проходит (квота), метка не теряется и журнал не спамит
  try { const v = JSON.parse(sessionStorage.getItem(SKIP_KEY) || '{}'); if (v && typeof v === 'object') m = { ...skipMem, ...v }; } catch (e) {}
  if (now - (+m[k] || 0) < 600000) return false;
  for (const x of Object.keys(m)) if (!(now - (+m[x] || 0) < 3600000)) delete m[x];
  m[k] = now; skipMem = m;
  try { sessionStorage.setItem(SKIP_KEY, JSON.stringify(m)); } catch (e) {}
  return true;
}
function cancelSkip(r, cr) {                        // в журнал — раз в 10 мин на вид
  const k = 'снятие:' + (r.champ ? 'ч:' : '') + String(r.name || '').toLowerCase();
  if (!skipDue(k)) return;
  env.rec('B', 'цели', `${r.name || 'моб'} (${r.lvl || '?'}${r.champ ? ', ' + (TIER_RU[r.tier] || 'чемпион') : ''}): пропускаю — снимает баффы${cr.own ? ' (ваш список)' : ` (${cr.n} за ${cr.k} боёв)`}`);
}
function champSkip(r, why) {                       // в журнал — раз в 10 мин на цвет и уровень
  const k = (r.tier || 'blue') + ':' + (r.lvl || 0);
  if (!skipDue(k)) return;
  env.rec('B', 'чемпионы', `${r.name || 'чемпион'} (${r.lvl || '?'}, ${TIER_RU[r.tier] || 'неизвестный цвет'}): пропускаю — ${why}`);
}
// темп обычного фарма этой зоны: EXP/с (медиана видов зоны по замерам) и время на моба, с — для цены чемпиона (champs.limitS)
function farmRate() {
  const V = env.rt.mobVal || {}, zm = env.rt.zoneMobs?.[env.rt.zone] || [];
  let eps = medOf(zm.map(n => mobEps(n, false) || 0));
  if (!(eps > 0)) eps = medOf(Object.entries(V).filter(([k, v]) => !k.startsWith('ч:') && v.n >= 3 && v.sec > 0).map(([, v]) => v.exp / v.sec));
  const sk = medOf(Object.values(V).filter(v => v.n >= 3 && v.sec > 0).map(v => v.sec / v.n));
  return eps > 0 && sk > 0 ? { eps, sk } : null;
}
function candidates(rules, sig, types, limitIdx, evidence = {}) {
  const out = [];
  // 8.0.3 (игрок 11.10: «поиск чемпионов по умолчанию откл.»): пока «Искать чемпионов» выключено (и глава не просит чемпионов),
  // чемпион — обычный моб: без окна до −8 ур. и без особой ценности (бот не тянется к ним сам)
  const champOn = champRuleOn();
  const hl0 = env.heroLvl() || env.rt.lvl || 0, meNow = env.meHp?.();
  // 10.0.5: «FA с чемпионов» (cfg.champFa, по умолчанию ВКЛ) — оранжевый/красный чемпион не ниже героя −5 (шанс FA 20/60 %) идёт сразу
  // после ★ квеста и источников ресурса, даже при выключенном «Искать чемпионов». Только из списка этой локации: бот никуда не летит
  const pos = rules.filter(x => !x.neg), faRank = pos.findIndex(x => !(x.quest || x.farm));
  // 10.0.10 (лог 13.10 18:13: красный Hook Spider 16 при герое 8 — окно +5 не сработало): чемпиона без записи в кэше спавнов брали с уровнем 0,
  // а окно уровней при 0 не проверяется. Имя и уровень такого — из строки списка на экране (pageItems), если она видна
  const onPage = { ...evidence }; try { for (const it of pageItems()) if (it.id) onPage[it.id] = it; } catch (e) {}
  sig.ids.forEach((id, idx) => {
    if (idx >= limitIdx || env.isRaidId(id) || types[id] === 'raid' || types[id] === 'epic_guard') return;
    const c = (onPage[id]?.name && onPage[id].lvl ? [onPage[id].name, onPage[id].lvl] : null) || env.rt.spawns?.[id];
    const minL = env.campChampMin();
    // Тип сервера не зависит от порога задания главы: иначе теряется запрет цвета.
    // 16.10: после reload/истечения NET карта всё ещё доказывает тип видимой строки.
    const champ = onPage[id] ? !!onPage[id].champ : types[id] === 'champion';
    const campEligible = champ && !(minL && c && c[1] && c[1] < minL);
    if (!c && !champ) return;                  // имя неизвестно и не чемпион — оценить нельзя
    const name = c ? c[0] : '', lvl = c ? c[1] : 0;
    const r = { id, idx, name, lvl, champ, boss: !!name && env.isBoss(name),
                quest: !!name && env.isQuestName(name, sig.quest) };
    if (champ) {
      r.tier = onPage[id]?.tier || champTier(id, onPage[id]?.a, ''); r.fa = faChance(true, r.tier, lvl, hl0);
      const fresh = Date.now() - (env.NET_SPAWNS?.t || 0) < 10 * 60000;
      r.hp = (onPage[id] ? onPage[id].hp : fresh ? env.NET_SPAWNS?.hp?.[id] : 0) || 0; r.exp = (onPage[id] ? onPage[id].exp : fresh ? env.NET_SPAWNS?.exp?.[id] : 0) || 0;
    }
    // моб на 7+ ур. выше: атака почти не попадает (лог 20:20: Bloody Banshee 74 при герое 41 — атака 1–2 урона,
    // бой 26 с вместо 3). Такие — не цели, даже если чемпионы. Цели квеста — до +10
    const hl = env.heroLvl() || env.rt.lvl || 0;   // 8.0.3: уровень в шапке ещё не прочитан — последний известный (без него окно уровня не работало)
    // v5.6: чемпион открытой главы — цель квеста: окно «не ниже героя на N» и «не по зубам» к нему не применяем
    // (глава «Champions · Lv.24» при герое 31 — все чемпионы 24–27 отсекались окном lvlBelow 3)
    // 7.2: моб-источник ресурса/рецепта (правило farm) — как цель квеста: зона выбрана под него (до −10 ур.), окно уровней не отсекает
    const farmT = !!name && rules.some(x => x.farm && x.name === name.toLowerCase());
    const chapter = campEligible && env.campActive() && env.campChampOpen();
    if (chapter) r.chapterChamp = true;
    const qLike = r.quest || farmT || chapter;
    // v4.58: «мягкое окно» — улететь в зону своего уровня не вышло, а тут все выше: 20 мин бьём самых слабых из тех, что есть
    const relax = relaxOk(env.rt.lvlRelax) ? env.rt.lvlRelax.up : 0;
    if (hl && lvl && lvl > hl + Math.max(qLike ? 10 : 0, env.cfg.lvlAbove ?? 15, relax)) return;
    // v4.44: и не ниже героя больше чем на lvlBelow (по умолчанию 5): после смерти бот бил пауков 15 ур. героем 49
    const relaxDown = relaxOk(env.rt.lvlRelaxDown);   // 7.1.30: и при автофарме, если улететь не вышло (8.0.3: только на той же локации)
    // 8.0 (аудит фарма A4, лог 10.10 20:08:57: чемпион «Probe Golem Prodigy IV (46)» в Pavel Ruins при герое 51 окно −3 отсекало):
    // чемпион даёт в 5–10 раз больше опыта обычного моба (≈29 тыс. против ≈3,5–6 тыс., лог 20:20–20:30) — для чемпионов нижняя
    // граница не −lvlBelow, а −8 (если игрок не поставил шире)
    // 10.0.5: окно чемпионов и «мягкое окно» вниз — не дальше −5 (FA с мобов ниже не падает)
    const below = (champ && champOn) || relaxDown ? FA_BELOW : lowCap();
    if (hl && lvl && !qLike && lvl < hl - below) return;
    // «не по зубам» по опыту: бой с этим видом шёл дольше 45 с (или урон ≈0) — пропускаем 2 часа (v4.23)
    // 9.2.2 (лог 12.10 07:22–07:34, спойлер): источник ресурса (farmT, цель Маммона «Mithril Ore») обходил «не по зубам», а бой
    // (combat: «не по зубам» прощает только ★ квест) сразу возвращал на карту — 12 мин по кругу карта → Guardian Basilisk → карта.
    // Теперь исключение — только ★ квест и чемпион главы (как в бою); источник ресурса «не по зубам» 2 ч не выбираем
    const hard = env.rt.hardMobs?.[(name || '').toLowerCase()];
    if (hard && Date.now() - hard.t < 7200000 && !(r.quest || (campEligible && env.campActive() && env.campChampOpen()))) return;
    // 10.0.5 (игрок 13.10: «анализ, кого мы можем убить, а кого нет… проба… отход»): чемпион, которого не успеть убить за его цену в
    // секундах обычного фарма (EXP + FA), или по вердикту прошлых боёв (до роста силы), — не цель; чемпион главы — цель всегда
    if (champ && env.champs?.tierOff) {
      const off = env.champs.tierOff(r, true) || (!(lvl > 0 && hl - lvl >= 20) && env.champs.hpLow?.(meNow));   // 20.60: не с полупустым HP
      if (off) { champSkip(r, off); return; }
    }
    // 14.10, аудит Astra: ресурсный приоритет не обходит запрет, который бой применит на входе.
    if (champ && !r.quest && !(campEligible && env.campActive() && env.campChampOpen())) {
      const off = env.champs?.tierOff?.(r) || env.champs?.held?.(r);
      if (off) { champSkip(r, off); return; }
    }
    if (champ && env.champs && (!qLike || env.champs.valueMode?.(r) || ((r.quest || chapter) && lvl > 0 && hl - lvl >= 20))) {
      const j = env.champs.judge(r, r.quest || chapter);
      Object.assign(r, { chOk: j.ok, chProbe: !!j.probe, chQuestQuick: !!j.questQuick, chEta: j.eta || 0, chLim: j.lim || 0, chWhy: j.why || '' });
      if (!j.ok) { champSkip(r, j.why); return; }
    }
    // 10.0.7 (лог 13.10 13:07–13:11, игрок 03:15: «некоторые мобы научились убивать бафф, таких избегаем»): моб снимает баффы
    // («[Frost Tarantula] зняв з вас 3 бафи», два набора по 8–9 FA ушли за минуту) — не цель: по памяти снятий (rt.buffCancel, чемпион и
    // обычный моб вида отдельно) и по списку игрока cfg.cancelMobs; галка cfg.noCancelMobs (ВКЛ). ★ квест и источник ресурса — как прежде
    if (!qLike && env.cfg.noCancelMobs !== false) {     // 10.0.8: оранжевый/красный чемпион — по правилу игры в champs.judge (cancelRisk → null)
      const cr = env.cancelRisk?.(name, champ, r.tier);
      if (cr) { cancelSkip(r, cr); return; }
    }
    let k = rank({ ...r, champ: campEligible }, rules);
    const faHot = k >= 0 && env.cfg.champFa !== false && (r.fa || 0) > 0 && (FA_P[r.tier] || 0) >= FA_P.orange && faRank >= 0;   // 20.43: порог — цвет по анонсу, r.fa — свой замер
    if (faHot) k = Math.min(k, faRank);
    if (k >= 0) out.push({ ...r, rank: k, ql: qLike, faHot });
  });
  return mobValRank(out, champOn);
}

// 16.10, журнал 01:56: знание имени не доказывает свежие тип/цвет/HP на скрытой странице.
// Наблюдения живут только в этом проходе; отсутствие цели объявляем лишь после всех страниц.
async function scanChampPages(rules, sig, limitIdx, active = () => env.on) {
  const evidence = {}, ids = sig.ids.join(','), total = Math.ceil(Math.min(limitIdx, sig.ids.length) / env.PAGE_SIZE);
  let visited = 0;
  const valid = () => active() && aroundSig().ids.join(',') === ids;
  for (let p = 1; p <= total; p++) {
    if (!valid()) return { sig, evidence, visited, total, complete: false, canceled: true };
    env.setStatus(`Ищу чемпионов: стр. ${p}/${total}`);
    if (!(await env.gotoPage(p, valid)) || !valid()) return { sig, evidence, visited, total, complete: false, canceled: true };
    const expected = sig.ids.slice((p - 1) * env.PAGE_SIZE, Math.min(p * env.PAGE_SIZE, limitIdx));
    const ready = () => valid() && pagerInfo()?.cur === p && expected.every(id => pageItems().some(it => it.id === id));
    if (!ready()) await env.waitFor(ready, 1500);
    if (!ready()) return { sig, evidence, visited, total, complete: false, canceled: true };
    await env.absorb();
    if (!ready()) return { sig, evidence, visited, total, complete: false, canceled: true };
    for (const it of pageItems()) if (sig.ids.includes(it.id)) evidence[it.id] = { id: it.id, name: it.name, lvl: it.lvl, champ: it.champ, boss: it.boss, hp: it.hp, exp: it.exp, tier: champTier(it.id, it.a, '') };
    visited++;
    const candidate = candidates(rules, sig, markerTypes(), limitIdx, evidence).find(c => c.champ);
    if (candidate) return { sig, evidence, visited, total, complete: visited === total, candidate };
  }
  return { sig, evidence, visited, total, complete: true };
}

// 8.0 (аудит фарма B1): среди целей одного приоритета — самая выгодная, а не ближайшая. Раньше в строке «[все]» бот брал первого
// в списке карты, а виды одной зоны различаются в 2–2,5 раза (лог 10.10 20:09–20:20, Pavel Ruins, время между победами):
// Deadly Ginzu Golem ≈4,5 тыс. EXP за ≈3,6 с (≈1260 EXP/с) против Horrifying Jackhammer Golem ≈2,2 тыс. за ≈4,6 с (≈490 EXP/с).
// Ценность вида — EXP за секунду (rt.mobVal: замеры после каждой победы, время приведено к цепочке), листание страницы ≈0,6 с;
// без замера — медиана зоны (чемпион — ×3: Blazing Swamp 20:20–20:30 — ≈29 тыс. EXP за ≈11 с против ≈870 EXP/с у зоны), при равенстве — выше уровнем
// (до героя +5; кто ещё выше — тем позже: без замеров к ним не тянемся), ближе — только последним. Вид с замером (≥3 боя) ниже 0,7 медианы зоны — не цель,
// если есть другие (★ цели квеста и источники ресурса не отсекаются)
const PAGE_S = 0.6, MOBVAL_MAX = 150, MOBVAL_N = 30;
const mobKey = (name, champ) => (champ ? 'ч:' : '') + String(name || '').toLowerCase();
const medOf = xs => { const a = xs.filter(v => v > 0).sort((p, q) => p - q), m = a.length >> 1; return !a.length ? 0 : a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
function mobEps(name, champ) {                   // EXP/с вида моба по замерам (обычный — от 3 боёв, чемпион — от 1) или null
  const v = name ? env.rt.mobVal?.[mobKey(name, champ)] : null;
  return v && v.n >= (champ ? 1 : 3) && v.sec > 0 && v.exp > 0 ? v.exp / v.sec : null;
}
function mobValRank(out, champOn = champRuleOn()) {
  const hl = env.heroLvl() || 0, V = env.rt.mobVal || {};
  // 20.54 (квест плаща Goddard, стадия охоты): засчитываются только мобы не ниже уровня героя — в своём приоритете они первыми
  const huntUp = !!env.storyHuntUp?.(), up = c => huntUp && hl && (c.lvl || 0) >= hl ? 1 : 0;
  const zMed = medOf((env.rt.zoneMobs?.[env.rt.zone] || []).map(n => mobEps(n, false) || 0));
  const zn = (env.rt.zoneMobs?.[env.rt.zone] || []).filter(n => mobEps(n, false)).length;
  const med = zn >= 3 ? zMed : medOf(out.filter(c => !c.champ).map(c => mobEps(c.name, false) || 0));
  const chMed = medOf(Object.entries(V).filter(([k, v]) => k.startsWith('ч:') && v.sec > 0).map(([, v]) => v.exp / v.sec));
  const sk = medOf(Object.values(V).filter(v => v.n >= 3 && v.sec > 0).map(v => v.sec / v.n)) || 4;   // типичное время на моба, с
  for (const c of out) {
    const ch = c.champ && champOn;                 // 8.0.3: особая ценность чемпиона — только при включённом поиске чемпионов
    const raw = mobEps(c.name, ch), pg = Math.floor(c.idx / env.PAGE_SIZE);
    const v = raw ?? (ch ? chMed || med * 3 : med);
    c.eps = raw;
    c.val = v > 0 ? v * sk / (sk + PAGE_S * pg) : 0;   // с учётом листания до его страницы
    c.low = zn >= 3 && raw != null && !ch && !c.ql && raw < 0.7 * zMed && !(huntUp && hl && (c.lvl || 0) >= hl);
  }
  const keep = out.filter(c => !c.low);
  const list = keep.length ? keep : out;
  const cap = hl ? hl + 5 : 999, lv = c => (c.lvl || 0) <= cap ? c.lvl || 0 : 2 * cap - c.lvl;   // выше героя +5 — чем выше, тем позже
  // 10.0.5: в одном приоритете FA-чемпион (оранжевый/красный в окне −5) первым, красный раньше оранжевого
  return list.sort((a, b) => a.rank - b.rank || (b.faHot ? FA_P[b.tier] || 0 : 0) - (a.faHot ? FA_P[a.tier] || 0 : 0) || up(b) - up(a) || b.val - a.val || lv(b) - lv(a) || a.idx - b.idx);   // приоритет, FA, выгода, уровень, ближе
}
// 20.43 (разбор 21.10): вклад одного боя в замеры охоты (mobVal, zoneStat, rt.eff) — не больше 3× обычного времени на такую награду:
// у этого вида (≥ 3 боёв этого класса), для нового вида — у способа прихода (rt.eff[via], ≥ 5 боёв). Пример: у вида 30 боёв по 3 с, один
// разрыв в 60 с (поход, ожидание оплаты) менял 90 с на 150 с — EXP/с 60 %, и при < 70 % медианы зоны вид выпадал с карты (c.low) и больше не
// перемерялся. Предел — по награде, а не по бою: пачка агро даёт ×N EXP за ×N времени и не обрезается. mapX — дорога картой (с)
function winSecCap(name, champ, exp, via, mapX = 0) {
  const o = name ? env.rt.mobVal?.[mobKey(name, champ)] : null, c = env.rt.prof || undefined;
  if (o && o.n >= 3 && o.sec > 0 && o.exp > 0 && (!o.c || !c || o.c === c)) return 3 * (Math.max(o.sec / o.n, (exp || 0) * o.sec / o.exp) + Math.max(0, +mapX || 0));
  const e = env.rt.eff?.[via];
  return e?.n >= 5 && e.sec > 0 ? 3 * Math.max(e.sec, e.rate > 0 ? (exp || 0) * 60 / e.rate : 0) : Infinity;
}
// после победы (из trackEfficiency, без ожидания): EXP и время на этот вид — скользящее по ≈30 последним боям
function mobValNote(name, champ, exp, sec) {
  if (!name || !(exp > 0) || !(sec > 0)) return;
  const V = { ...(env.rt.mobVal || {}) }, k = mobKey(name, champ), o = V[k] || { n: 0, exp: 0, sec: 0 };
  // 9.0 (сабклассы, 11.10: у каждого класса свой уровень и скиллы): замер помечен классом героя (rt.prof); другой класс — замер с нуля
  const c = env.rt.prof || undefined, same = !o.c || !c || o.c === c, b = same ? o : { n: 0, exp: 0, sec: 0 }, f = b.n >= MOBVAL_N ? (MOBVAL_N - 1) / MOBVAL_N : 1;
  V[k] = { n: Math.min(MOBVAL_N, b.n + 1), exp: Math.round(b.exp * f + exp), sec: +(b.sec * f + sec).toFixed(1), t: Date.now(), ...(c ? { c } : {}) };
  const ks = Object.keys(V);
  if (ks.length > MOBVAL_MAX) ks.sort((a, b) => (V[a].t || 0) - (V[b].t || 0)).slice(0, ks.length - MOBVAL_MAX).forEach(x => delete V[x]);
  return env.setRt({ mobVal: V });
}

function champEntryOff(c) {
  // 16.10: исторический champ=true у РБ/эпиков не делает их цветными чемпионами.
  if (c.rb || !c.champ) return null;
  const min = env.campChampMin?.() || 0;
  const chapter = env.campActive() && env.campChampOpen() && !(min && c.lvl && c.lvl < min);
  if (c.chapterChamp && !chapter) return 'цель по чемпионам этой главы уже не активна';
  const required = chapter || (c.quest && (env.isQuestName?.(c.name) ?? true));
  if (c.chQuestQuick && !env.champs?.questQuick?.({ ...c, quest: required }, required)) return 'условия короткой квестовой пробы изменились';
  const quickQuest = (c.quest || chapter) && c.lvl > 0 && (env.heroLvl?.() || env.rt?.lvl || 0) - c.lvl >= 20;
  return env.champs?.tierOff?.(c, true) || (quickQuest && env.champs?.held?.(c)) || (!c.quest && !chapter && (env.champs?.tierOff?.(c) || env.champs?.held?.(c))) || null;
}
async function attackSpawn(c, label, opt = {}) {
  // 15.10: рейд передаёт свою отмену; смена режима/ручная команда во время листания не открывает прежнюю цель.
  const context = () => JSON.stringify([env.rt.char, env.rt.manualKickAt, env.cfg.rbHuntMode, env.cfg.epicMode, env.cfg.catMode, env.cfg.zoneAuto, env.cfg.farmHere]);
  const captured = context();
  const active = () => env.on && env.tabOwner !== false && context() === captured && (!opt.active || opt.active());
  if (!active()) return false;
  const page = Math.floor(c.idx / env.PAGE_SIZE) + 1;
  const sel = `#map-mob-list a[href*="spawnId=${CSS.escape(c.id)}"]`;
  if (!(await env.gotoPage(page, active)) || !active()) return false;
  let a = env.$q(sel);
  for (const d of [1, -1]) { if (a || !active()) break; if (await env.gotoPage(page + d, active)) a = env.$q(sel); }
  if (!a || !active()) return false;
  const it = pageItems().find(x => x.id === c.id);
  if (it) Object.assign(c, { name: c.name || it.name, lvl: c.lvl || it.lvl, quest: c.quest || it.quest, champ: c.champ || it.champ });
  if (c.champ) {   // настройки/цвет могли обновиться, пока листали страницы — последняя проверка до клика «Бой»
    c.tier = champTier(c.id, a, '') || c.tier || '';
    const off = champEntryOff(c);
    if (off) { champSkip(c, off); return false; }
  }
  env.setStatus(label(c));
  console.log(env.TAG, 'цель:', c.id, c.name, '| поз.', c.idx);
  await env.pause();
  if (!active()) return false;
  // Настройка могла измениться во время паузы: проверяем непосредственно перед записью цели.
  if (c.champ) {
    const off = champEntryOff(c);
    if (off) { champSkip(c, off); return false; }
  }
  // Лог 15.10 04:31: тур выбрал Lokness, а карта запустила бой с Sheshark.
  // Проверяем актуальную цель тура непосредственно перед кликом по ссылке.
  if (env.cfg.rbHuntMode && env.rt.rbHunt?.step === 'fight' && c.id !== env.rt.rbHunt.id) {
    env.rec('B', 'тур РБ', `карта предложила ${c.name}, но цель тура ${env.rt.rbHunt.name} — чужую ссылку не нажимаю`);
    return false;
  }
  a = env.$q(sel); if (!a || env.shown?.(a) === false) return false;
  const clickAt = Date.now(), before = { target: env.rt.target || null, mobClickAt: env.rt.mobClickAt || 0 };
  const rollback = async () => { if (active() && env.rt.mobClickAt === clickAt && env.rt.target?.name === c.name) await env.setRt(before); };
  await env.setRt({ target: { name: c.name, champ: c.champ, quest: c.quest, rb: !!c.rb, ...(c.champ ? { tier: c.tier || champTier(c.id, a), lvl: c.lvl || 0, lim: c.chLim || 0, exp: c.exp || 0, fa: c.fa, valueT: Date.now(), probe: !!c.chProbe } : {}) }, mobClickAt: clickAt, via: 'map' });
  if (!active()) return false;
  if (env.cfg.rbHuntMode && env.rt.rbHunt?.step === 'fight' && c.id !== env.rt.rbHunt.id) return false;
  if (c.champ && env.champs?.valueMode?.(c)) env.rec('B', 'чемпионы', `${c.name}: ${c.chWhy}`);
  if (c.champ && (c.faHot || c.chProbe)) env.rec('B', 'чемпионы', `${c.name} (${c.lvl}, ${TIER_RU[c.tier] || c.tier})${c.faHot ? ` — бью ради FA: шанс ${Math.round(c.fa * 100)} %` : ''}${c.chProbe ? ` · проба${c.chEta ? `: жду ≈${c.chEta} с` : ''}, предел ${c.chLim} с (дольше — уйду)` : c.chEta ? ` · ≈${c.chEta} с, предел ${c.chLim} с` : ''}`);
  { const off = champEntryOff(c); if (off || !env.on) { if (off) champSkip(c, off); await env.setRt({ target: null }); return false; } }
  // Список перерисовывается во время паузы и сохранения цели. Detached link
  // не получит native обработчик; отказ fire не является отправленной атакой.
  if(env.dailyWorkReady && !await env.dailyWorkReady('mobs') || !active())return false;
  a = env.$q(sel);
  if (!a || env.shown?.(a) === false || env.fire(a) === false) { await rollback(); return false; }
  if (!(await env.waitFor(env.isBattle, 10000)) && active()) {   // бой не открылся — обновляем карту; стоп только после 3 раз подряд
    const n = (env.rt.clickFail || 0) + 1;
    if (n >= 3) { await env.setRt({ clickFail: 0 }); await mobHold('Клик по мобу 3 раза подряд не открыл бой', 'проверьте игру'); return true; }
    await env.setRt({ clickFail: n });
    if (!active()) return false;
    env.rec('B', 'карта', `клик по «${c.name}» не открыл бой — обновляю карту (${n}/3)`);
    location.reload(); await env.sleep(8000);
  } else if (env.rt.clickFail) await env.setRt({ clickFail: 0 });
  return true;
}

// 20.43 (автономность, разбор 21.10): клик по мобу трижды не открыл бой, бой трижды вернул на карту, список мобов не грузится — раньше
// стоп бота до утра (env.halt). Теперь передышка: уход с карты на нейтральную /char.html (не /city.html: штатный вход в город переносит
// героя, а назад — платный телепорт; бот должен стоять, где оставили), 5 → 15 → 30 мин; на это время идут другие выбранные задачи, потом
// снова карта со свежей загрузкой. Стоп с причиной — если понадобилась бы 4-я передышка за 6 ч (content.selfHoldStart)
const mobHold = (why, advice) => env.selfHold ? env.selfHold('mob', why, { page: '/char.html' }) : env.halt(`${why} — ${advice}`);

// 10.0.5: «Только задачи» — бить мобов можно только на точке активной цели фарма ресурса/рецепта (зона известна и совпадает)
function tasksGoalHere() { const g = env.lootGoal?.(); return !!g && !!env.rt.zone && env.rt.zone === g.zone; }

async function map() {
  // 20.43 (автономность): передышка после сбоя карты — мобов с карты не бьём, только честное ожидание (поражение на карте — как всегда)
  if (env.selfHoldOn?.('mob')) {
    if (env.shown(env.$q('#map-defeat-root'))) return env.onDeath();
    // 20.43 (доводка 21.10): rt.selfHold — передышки по задаче; текст — именно передышки карты (selfHoldOf), старое ядро — прежняя запись
    const h = env.selfHoldOf ? env.selfHoldOf('mob') : env.rt.selfHold;
    env.setStatus(env.selfHoldText && h ? env.selfHoldText(h) : 'Передышка после сбоя карты'); await env.sleep(3000); return;
  }
  // защита от петли «клик по мобу → снова карта»
  if (env.rt.mobClickAt && Date.now() - env.rt.mobClickAt < 8000) {
    const n = (env.rt.bounce || 0) + 1;
    await env.setRt({ bounce: n, mobClickAt: 0 });
    if (n >= 3) { await env.setRt({ bounce: 0 }); return mobHold('Клик по мобу 3 раза вернул на карту', 'пришлите лог'); }
    env.setStatus(`Бой не открылся (${n}/3), пауза 5 с`);
    await env.sleep(5000);
    if (!env.on) return;
  }
  if (env.shown(env.$q('#map-defeat-root'))) return env.onDeath();
  if (await env.townBuffStart('баффов нет')) return;

  env.setStatus('Карта: жду список мобов');
  await env.sleep(env.rnd(150, 300));
  if (!env.on) return;
  const tab = env.$q('#map-list-mode-mobs');        // открыта вкладка NPC — переключаем на «Мобы»
  if (tab && !tab.classList.contains('is-active')) { env.fire(tab); await env.sleep(500); }
  const mr = await mapReady(30000, 'Карта: жду список мобов');
  if (mr === 'changed' || mr === 'down' || env.serverDown()) return;     // ошибка сервера — разберётся главный цикл (ожидание без остановки)
  if (!mr && env.on && !pageItems().length) {
    const n = (env.rt.mapReload || 0) + 1;
    if (n > 3) {                                 // сервер/интернет лежит: ждём и пробуем снова; стоп — если так 15 мин
      const down = env.rt.mapDownT || Date.now();
      if (Date.now() - down > 15 * 60000) { await env.setRt({ mapReload: 0, mapDownT: 0 }); return mobHold('Список мобов не грузится 15 минут', 'проверьте игру/интернет'); }
      await env.setRt({ mapReload: 0, mapDownT: down });
      env.rec('B', 'карта', 'список мобов не грузится — жду 2 мин и пробую снова');
      await env.idle(120000, 'Игра не отвечает — жду и пробую снова');
      location.reload(); await env.sleep(8000); return;
    }
    await env.setRt({ mapReload: n });
    env.rec('B', 'карта', `список мобов не загрузился за 30 с — перезагрузка ${n}/3`);
    env.setStatus(`Список мобов не загрузился — обновляю карту (${n}/3)`);
    location.reload(); await env.sleep(8000); return;
  }
  if (!env.on) return;
  if (!pageItems().length) {                     // пустой список — как «не загрузился»: обновить (до 3 раз)
    const n = (env.rt.mapReload || 0) + 1;
    if (n > 3) { await env.setRt({ mapReload: 0 }); return mobHold('Не вижу список мобов после 3 обновлений карты', 'проверьте игру'); }
    await env.setRt({ mapReload: n }); location.reload(); await env.sleep(8000); return;
  }
  if (env.rt.mapReload || env.rt.mapDownT) await env.setRt({ mapReload: 0, mapDownT: 0 });

  // 15.10 (лог 01:01): фарм мобов во время подготовки/ожидания рейда не запускает второй выбор РБ и старый rt.rbGo.
  if (!env.cfg.rbHuntMode && (env.cfg.rbMode || env.farmRbOn())) {
    // все РБ локации — в базу (видно игроку, даже вне уровня)
    // 8.0.3: зона РБ — только определённая на месте (сразу после перелёта «Телепортом» rt.zone ещё прежняя; телепорт к РБ и смерть её сбрасывают)
    const seen = { ...(env.rt.rbSeen || {}) }, zNow = !(env.rt.zonePend && Date.now() - (env.rt.zonePend.t || 0) < 120000) && env.rt.zone || null;
    env.raidList().forEach(r => { seen[r.id] = { name: r.name, lvl: r.lvl, inRange: r.lvl >= env.rbLo(env.heroLvl()) && r.lvl <= env.rbHi(env.heroLvl()), zone: zNow || seen[r.id]?.zone || null, seenT: Date.now() }; });
    const rbs = env.rbCandidates(), me = env.meHp();
    await env.setRt({ rbSeen: seen, rbPending: rbs.length > 0, sinceRb: 0 });
    const bw = rbs.length && me && me.pct >= env.cfg.rbRestHp ? env.buffWaitBeforeRb() : null;
    if (bw) { env.setRt({ status: `РБ ${rbs[0].name}: жду откат «${bw.who}» ${bw.s} с` }); env.draw(); await env.sleep(Math.min(bw.s, 10) * 1000); return; }
    if (rbs.length && me && me.pct >= env.cfg.rbRestHp) {
      const r = rbs[0];
      await env.setRt({ rbCur: r.id });
      const d = env.rt.rbDb?.[r.id];
      const lbl = c => `РБ: ${c.name} (${c.lvl})${d?.verdict === 'ok' ? ' ✅' : d?.verdict === 'chip' ? ' ⚠' : ' ❔'}`
          + (env.rt.rb?.[c.id]?.hpAfter ? ` · у него ${env.rt.rb[c.id].hpAfter}/${env.rt.rb[c.id].max}` : '');
      if (await env.townBuffStart(`перед РБ ${r.name}`, true)) return;   // v5.3: бафф слетел — сначала баффер, потом РБ
      const res = await env.rbEngage(r, lbl(r));              // v4.46: оценка до боя по окну РБ
      if (res === true) return;
      if (res === 'skip') { await env.setRt({ rbCur: null }); return; }
    } else if (rbs.length) {
      env.setStatus(`РБ ждёт: HP ${me ? me.pct | 0 : '?'}% < ${env.cfg.rbRestHp}% — лечусь на мобах`);
      await env.sleep(600);
    } else {
      env.setStatus(`РБ по силам нет (ур. ${env.rbLo(env.heroLvl())}–${env.rbHi(env.heroLvl())}) — фармлю обычных`);
      await env.setRt({ rbCur: null, rbZoneVisit: { ...(env.rt.rbZoneVisit || {}), [env.rt.zone || '?']: Date.now() } });
      // тур по РБ (v4.23): здесь РБ нет — не фармим, а сразу летим дальше. Сначала — список зон из «Телепорта»
      // (бесплатно), потом по очереди: знакомые РБ → РБ с форума → разведка зон по уровню. Мобов фармим,
      // только когда все подходящие зоны уже обойдены за последние 40 мин
      if (env.cfg.rbMode && env.cfg.rbTour !== false && !env.campActive() && Date.now() - (env.rt.zoneGoT || 0) > 8000) {   // v5.6: тур — только в «Фарм РБ», не при походе за ресурсом
        // v4.27: главный источник — список РБ игры (Меню → Рейдовые боссы): живые, разрешённые, с телепортом прямо к ним
        if (!env.rt.rbListT || Date.now() - env.rt.rbListT > 15 * 60000) { await env.setRt({ rbScan: true }); location.href = '/rb-bosses.html'; await env.sleep(4000); return; }
        const rp = env.rbListPick();
        if (rp) { await env.setRt({ rbGo: { id: rp.id, name: rp.name, lvl: rp.lvl, page: rp.page, price: rp.price, t: Date.now() }, rbTourWhy: '', rbTourNext: 0 }); return; }
        if (!env.rt.zoneCatT) { env.rec('B', 'РБ-тур', 'списка зон ещё нет — читаю «Телепорт»'); await env.setRt({ zoneScan: true }); location.href = '/teleport.html'; await env.sleep(4000); return; }
        const pick = env.rbTourPick();
        if (pick) {
          env.rec('B', 'РБ-тур', `здесь (${env.zoneName(env.rt.zone)}) РБ по силам нет → ${env.zoneName(pick.id)}: ${pick.why}`);
          await env.setRt({ zoneGo: { id: pick.id, url: pick.url || null, t: Date.now(), why: 'РБ-тур: ' + pick.why }, zoneGoT: 0, rbTourWhy: '' });
          return;
        }
        if (env.rt.rbTourWhy !== 'none') env.rec('B', 'РБ-тур', `все подходящие зоны (${Object.keys(env.rt.rbZoneVisit || {}).length}) обойдены за 40 мин — фармлю обычных здесь, проверяю снова через 3 мин`);
        await env.setRt({ rbTourWhy: 'none', rbTourNext: Date.now() + 180000 });
      }
      await env.sleep(600);
    }
  }

  // глава требует убить РБ («★ Рейдовый босс: Емісар Нурки»): ищем его метку на карте и идём, когда HP полное.
  // Бой — та же логика, что в «Фарм РБ»: оценка «убьём ли», банки, отход и заходы, если не по силам за раз
  if (env.campRbOpen().length) {
    const want = env.campRbOpen()[0], me = env.meHp();
    const r = env.raidList().find(x => x.idx >= 0 && env.nameLike(x.name, want.name));
    const key = r ? 'see:' + r.id : 'none';
    if (env.rt.campRbSeen !== key) { env.rec('B', 'РБ главы', r ? `«${want.name}» на карте (ур. ${r.lvl}) — иду, когда HP ≥ ${env.cfg.rbRestHp}%` : `«${want.name}» на карте не виден (убит/не появился) — фармлю, проверяю карту каждые 3 боя`); await env.setRt({ campRbSeen: key }); }
    if (r && env.rbVerdictBlocks(r.id)) env.setStatus(`РБ главы ${want.name}: не по силам на ур. ${env.heroLvl()} — фармлю и расту`);
    else if (r && me && me.pct >= env.cfg.rbRestHp) {
      await env.setRt({ rbCur: r.id });
      const d = env.rt.rbDb?.[r.id];
      const done = await attackSpawn({ ...r, rb: true, champ: true, rank: 0 },
        c => `РБ главы: ${c.name} (${c.lvl})${d?.verdict === 'ok' ? ' ✅' : d?.verdict === 'chip' ? ' ⚠ заходами' : ''}`
          + (env.rt.rb?.[c.id]?.hpAfter ? ` · у него ${env.rt.rb[c.id].hpAfter}/${env.rt.rb[c.id].max}` : ''));
      if (done) return;
      // в списке не нашёлся — через метку на карте: «Емісар Нурки · ур. 33 · рейд-босс» → окно → «В бой»
      const pin = env.$q(`.l2-map-mob-pin--raid[data-spawn-id="${CSS.escape(r.id)}"]`);
      if (pin && env.on && env.tabOwner !== false) {
        if (!env.fire(pin)) return;
        const go = await env.waitFor(() => { const a = env.$q('#map-mob-modal-battle'); return env.rbModalIs?.(r) && env.shown(a) ? a : null; }, 3000, 100);
        if (!env.on || env.tabOwner === false) return;
        await env.setRt({ target: { name: r.name, champ: true, quest: true, rb: true }, mobClickAt: Date.now(), via: 'map' });
        // 14.10: Stop/смена вкладки отменяют и прямой URL боя; старая кнопка окна другого РБ не подходит.
        if (!env.on || env.tabOwner === false) return;
        if(env.dailyWorkReady && !await env.dailyWorkReady('mobs') || !env.on || env.tabOwner === false)return;
        if (go && env.rbModalIs?.(r) && env.shown(go)) { if (!env.fire(go)) return; }
        else location.href = '/battle.html?spawnId=' + encodeURIComponent(r.id);
        await env.waitFor(env.isBattle, 10000);
        return;
      }
    } else if (r) env.setStatus(`РБ главы ${want.name}: жду HP ${me ? me.pct | 0 : '?'}% → ${env.cfg.rbRestHp}% — фармлю`);
  }

  const rules = parseRules();
  if (!rules.some(x => !x.neg)) return env.halt('Список приоритетов пуст');
  // 7.1.30: «Автофарм» включили / нажали «Старт» с ним — сразу проверяем локации, не дожидаясь 10 мин после боя:
  // каталог зон «Телепорта» (устарел — перечитать), мобов своего уровня тут нет — в зону своего уровня, иначе — лучшая/пробная зона
  // 7.2: есть цель «ресурс»/«рецепт» — при старте сразу к её источнику (раньше — сначала в зону для опыта, потом обратно)
  const lg = !env.campActive() && !rbHold() && !env.cfg.fishMode ? env.lootGoal?.() : null;
  if (lg && env.rt.zone !== lg.zone) {
    if (env.rt.zoneAutoKick) await env.setRt({ zoneAutoKick: null });
    if (lg.kind === 'farm' ? await env.farmStep() : await env.recipeStep()) return;
  }
  if (env.cfg.zoneAuto && env.rt.zoneAutoKick && !lg && !env.campActive() && !rbHold() && !env.cfg.fishMode) {
    if ((!env.rt.zoneCatT || env.zoneCatThin() || Date.now() - env.rt.zoneCatT > 24 * 3600000) && ((env.rt.zoneCatFail || 0) < 3 || Date.now() - (env.rt.zoneCatFailT || 0) > 3600000)) {
      env.rec('B', 'локации', 'автофарм: при старте читаю список зон «Телепорта»');
      await env.setRt({ zoneScan: true }); location.href = '/teleport.html'; await env.sleep(4000); return;   // kick остаётся — после чтения выбор зоны
    }
    if (await mapReady(15000) === 'changed') return;
    // 8.0.3 (лог 11.10 11:45:34): после смерти «проверил локации — остаюсь здесь (sea_of_spores)» решалось по зоне до смерти (зону по карте
    // бот определял только после этого блока), и герой 56 остался бить мобов 15–35 ур. в Bee Hive. Сначала — зона по этой карте и уровень
    // героя; не прочитались — решаем на следующем проходе карты (kick остаётся), а сейчас фармим как обычно
    await env.absorb();
    if (env.rt.zone && (env.heroLvl() || await env.waitFor(() => env.heroLvl(), 3000, 200))) {
      await env.setRt({ zoneAutoKick: null, zoneLvlT: 0 });
      if (await env.zoneForLevel()) return;
      const pick = env.zonePick();
      if (pick) { env.rec('B', 'локации', `автофарм: при старте → ${pick.name || pick.id}`); await env.setRt({ zoneGo: { ...pick, t: Date.now() }, zoneGoT: 0 }); location.href = '/teleport.html'; await env.sleep(4000); return; }
      env.rec('B', 'локации', `автофарм: проверил локации — остаюсь здесь (${env.zoneName(env.rt.zone)})`);
      await env.setRt({ zoneGoT: Date.now() });
    }
  }

  let sig = aroundSig();
  await env.absorb();
  // 10.0.5 (лог 12.10 01:29:58–01:30:25, «почему в режиме „только задачи“ автофармит мобов»): без режима мобов бьём только на точке
  // цели фарма ресурса/рецепта. Раньше карта в Окрестностях сразу выбрала Vampire Soldier (71), и лишь после боя бот полетел за
  // Oriharukon Ore: farmStep не летит 3 мин после прошлого перелёта (zoneGoT), и в это время map() бил всех подряд
  if (env.autonomyMode() === 'tasks' && !tasksGoalHere()) {
    const g = env.lootGoal?.();
    env.setStatus(g ? `⏹ Только задачи: цель фарма «${g.name}» — жду перелёта к её точке, здесь мобов не бью` : '⏹ Только задачи: мобов не бью');
    await env.sleep(2000); return;
  }
  // ★ цели: из подписи карты + ★ в строках списка (несюжетные квесты); в «оригинальном» написании имён
  // только свежие (до 6 ч, как в isQuestName) и только мобы текущей зоны: раньше ★ из прошлой локации
  // (Leto Lizardman Warrior в Hot Springs) висела в «На локации» и считалась квестовой целью бесконечно
  const zMobs = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  const seenQ = Object.entries(env.rt.questSeen || {}).filter(([k, t]) => Date.now() - t < 6 * 3600000 && (!zMobs.length || zMobs.includes(k)))
    .map(([k]) => Object.values(env.rt.spawns || {}).find(v => v[0].toLowerCase() === k)?.[0] || k);
  const qt = [...new Set([...sig.quest, ...seenQ])];
  if (qt.join('|') !== (env.rt.questTargets || []).join('|')) await env.setRt({ questTargets: qt });   // 20.62: тот же список — без записи памяти

  // цели главы (мобы и чемпионы) ищем по всему списку локации, а не только на первых страницах
  // 7.1.30: и открытые цели квеста профессии (Giant Fungus лежал на 25-й стр. списка из 26)
  const zMq = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  const profOpen = ((env.rt.profQuest?.open || []).length > 0 && Date.now() - (env.rt.profQuest.t || 0) < 3600000)
    || (sig.quest || []).some(n => zMq.includes(String(n).toLowerCase()) && env.isQuestName(n));   // 7.1.30: ★ цель есть на этой локации — ищем по всему списку
  const deep = env.mapDue(rules) || env.campMobOpen().length > 0 || (env.campActive() && env.campChampOpen()) || profOpen;
  const limitIdx = deep ? sig.ids.length : env.cfg.maxPages * env.PAGE_SIZE;

  // изучить страницы с ещё неизвестными мобами (только если цели высшего приоритета пока нет)
  const unknownPages = [...new Set(sig.ids.map((id, i) => [id, i])
    .filter(([id, i]) => i < limitIdx && !env.isRaidId(id) && !env.rt.spawns?.[id])
    .map(([, i]) => Math.floor(i / env.PAGE_SIZE) + 1))].sort((a, b) => a - b);
  // изучать имена незачем, если уже есть цель лучшего «именного» правила (чемпионов видно по меткам и без имён)
  const pos = rules.filter(x => !x.neg), named = Math.max(0, pos.findIndex(x => !(x.champ && !x.quest && !x.name)));
  const initial = candidates(rules, sig, markerTypes(), limitIdx), best0 = initial[0];
  let pageEvidence = {}, champScanned = false;
  const champPriority = pos.findIndex(x => x.champ);
  const searchingChamps = deep && champRuleOn() && champPriority >= 0 && (!best0 || best0.rank >= champPriority);
  if (searchingChamps && !initial.some(c => c.champ)) {
    const context = () => JSON.stringify([env.scanContext?.(), env.rt.char, env.rt.manualKickAt, env.rt.zone, location.pathname,
      env.autonomyMode(), env.cfg.searchChamp, env.cfg.champBlue, env.cfg.champOrange, env.cfg.champRed, env.cfg.champCancel, env.cfg.champLeave,
      env.campActive(), env.campOpen().filter(t => t.champ)]);
    const before = context(), active = () => env.on && env.tabOwner !== false && env.canScanMap?.() !== false && context() === before;
    const scan = await scanChampPages(rules, sig, limitIdx, active);
    if (scan.canceled || !active()) return;
    pageEvidence = scan.evidence; champScanned = true;
    env.rec('B', 'чемпионы', scan.candidate ? `Проверено страниц ${scan.visited}/${scan.total}: найден ${scan.candidate.name} на стр. ${Math.floor(scan.candidate.idx / env.PAGE_SIZE) + 1}` : `Проверены все ${scan.total} страниц: доступных чемпионов сейчас нет`);
  }
  if (!champScanned && unknownPages.length && !(best0 && best0.rank <= named)) {
    const cap = env.campMobOpen().length ? 30 : 6;     // ищем цели главы — изучаем локацию целиком за один заход
    for (const [k, p] of unknownPages.slice(0, cap).entries()) {
      env.setStatus(`Изучаю список локации: стр. ${p} (${k + 1}/${Math.min(cap, unknownPages.length)} из ${unknownPages.length})`);
      if (!(await env.gotoPage(p)) || !env.on) break;
      await env.absorb();
    }
    if (!env.on) return;
    sig = aroundSig();
  }
  // глава: открытые мобы-цели должны быть в списке ЭТОЙ локации. Подпись карты «q…» тут не помогает —
  // она перечисляет цели квеста на любой локации. Смотрим имена мобов (кэш спавнов), когда список изучен ≥85 %.
  // Так было: телепорт «без сообщения» → 15 мин фарма Plains of Dion вместо Fortress of Resistance.
  const open = env.campMobOpen();
  if (open.length) {
    const ids = sig.ids.filter(id => !env.isRaidId(id) && !/^dung_/.test(id));
    const known = ids.filter(id => env.rt.spawns?.[id]).length / Math.max(1, ids.length);
    const here = ids.some(id => open.includes((env.rt.spawns?.[id]?.[0] || '').toLowerCase()));
    if (!here && known >= 0.85 && (env.rt.wrongLoc || 0) < 3) {
      await env.setRt({ wrongLoc: (env.rt.wrongLoc || 0) + 1, lastTeleport: '', campaignDue: true });
      env.rec('B', 'локация', `целей главы (${open.join(', ')}) в списке локации нет (изучено ${Math.round(known * 100)} %) — телепорт заново ${env.rt.wrongLoc}/3`);
      env.setStatus(`Цели главы не на этой локации — телепорт заново (${env.rt.wrongLoc}/3)`);
      return env.goCampaign();
    }
    if (here && env.rt.wrongLoc) await env.setRt({ wrongLoc: 0 });
  }

  let cands = candidates(rules, sig, markerTypes(), limitIdx, pageEvidence);
  // 7.2.1 (лог 10.10 21:17:34): после города «В Окрестности» ближе всего — мобы 69–78 ур., и бот улетел в Pavel Ruins (≈2,6 M EXP/ч),
  // хотя в этой же локации дальше по списку — мобы 54–63 ур. (замер тут ≈4,45 M EXP/ч на 52 ур.). Ближние страницы без своих —
  // сперва свои по всей локации (имена из кэша спавнов), телепорт — только если их нет нигде
  if (!cands.length && !deep && limitIdx < sig.ids.length) {
    const far = candidates(rules, sig, markerTypes(), sig.ids.length);
    if (far.length) {
      if (Date.now() - farRecT > 600000) { farRecT = Date.now(); env.rec('B', 'локации', `рядом мобов своего уровня нет — иду к ${far[0].name || '?'} (${far[0].lvl || '?'}) на стр. ${Math.floor(far[0].idx / env.PAGE_SIZE) + 1} этой же локации, без телепорта`); }
      cands = far;
    }
  }
  if (env.campActive() && env.campChampOpen()) {          // сколько чемпионов главы сейчас на локации — в журнал при изменении
    const ch = cands.filter(c => c.champ), key = ch.length + ':' + (ch[0]?.id || '');
    if (env.rt.champSeen !== key) {
      const ct = env.campOpen().find(t => t.champ);
      env.rec('B', 'чемпионы', ch.length ? `на локации ${ch.length}: ${ch.slice(0, 3).map(c => `${c.name || '?'} (${c.lvl || '?'})`).join(', ')} — иду к ближайшему (глава: ${ct.done}/${ct.total})`
        : `доступных чемпионов на локации сейчас нет (глава: ${ct.done}/${ct.total}) — бью цели главы, проверяю карту чаще`);
      await env.setRt({ champSeen: key });
    }
  }
  if (deep) {
    const near = cands.find(c => c.idx < env.cfg.maxPages * env.PAGE_SIZE);
    // «горячая» карта (идти на неё после каждого боя) — только для ★ квестовых целей и чемпионов главы.
    // Обычные чемпионы ([чемп] по галочке) — плановая проверка раз в N боёв, между ними цепочка (v4.28:
    // лог 23:08–23:10 — 6 чемпионов подряд через карту, по 15–17 с на каждый, цепочка простаивала)
    const hot = !!cands[0] && (cands[0].quest || (env.campActive() && env.campChampOpen() && cands[0].champ)) && (!near || cands[0].rank < near.rank);
    await env.setRt({ sinceDeep: 0, deepHot: hot });
  }
  // 7.1.30: «Сам подбирать локацию» выключен — с локации НЕ улетаем никогда (лог 14:12: бот улетел из Sea of Spores в Enchanted Valley).
  // Мобы тут ниже окна уровня — бьём их (окно снизу снимается на 20 мин, продлевается)
  if (!cands.length && !env.campActive() && env.cfg.zoneAuto && !(env.lootGoal?.()?.zone === env.rt.zone) && await env.zoneForLevel()) return;
  if (!cands.length && !env.campActive()) {   // 7.1.30: автофарм включён, а улететь некуда — тоже бьём, что есть, а не «Целей нет» до остановки
    const hl = env.heroLvl(), lv = pageItems().filter(i => !i.champ && !i.boss && i.lvl).map(i => i.lvl);
    const downOn = relaxOk(env.rt.lvlRelaxDown);
    const lo = hl - lowCap();   // 7.1.30: РБ/охрана эпика не считаются; хватит того, что есть мобы ниже окна
    // 10.0.5: «мягкое окно» открывает только до −5; мобы тут все ниже — не бьём (FA не падает), стоим и пишем, что делать
    if (hl && lv.length && Math.max(...lv) < hl - FA_BELOW) {
      if (Date.now() - lowRecT > 600000) { lowRecT = Date.now(); env.rec('B', 'локации', `мобы тут ${Math.min(...lv)}–${Math.max(...lv)} ур., герой ${hl}: все ниже героя больше чем на 5 ур. — не бью (FA с них не падает). Включите «Автофарм» или перелетите в зону от ${hl - FA_BELOW} ур.`); }
    } else if (hl && lv.length && lv.some(l => l < lo) && lo > hl - FA_BELOW && !downOn) {
      env.rec('B', 'локации', `мобы тут ${Math.min(...lv)}–${Math.max(...lv)} ур. (герой ${hl}) — ${env.cfg.zoneAuto ? env.lootGoal?.() ? 'сохраняю точку фарма ресурса' : 'подходящей новой зоны нет' : 'подбор локации выключен'}, остаюсь и бью тех, что не ниже ${hl - FA_BELOW} ур.`);
      await env.setRt({ lvlRelaxDown: { t: Date.now(), zone: env.rt.zone || null, auto: !!env.cfg.zoneAuto } });
      return;
    }
  }   // v4.44: мобов своего уровня нет — в зону своего уровня
  // v4.58: улететь не вышло (нет подходящей зоны / нет кнопки / недавно пробовали), а все мобы тут выше окна —
  // не стоим на «Целей нет»: 20 мин бьём самых слабых из этих (бои > 45 с всё равно отсекаются как «не по зубам»)
  if (!cands.length && !env.campActive()) {
    const hl = env.heroLvl(), lv = pageItems().filter(i => !i.champ && i.lvl).map(i => i.lvl);
    const relaxOn = relaxOk(env.rt.lvlRelax);
    if (hl && lv.length && Math.min(...lv) > hl + (env.cfg.lvlAbove ?? 10) && !relaxOn) {
      const up = Math.min(...lv) - hl;
      env.rec('B', 'локации', `мобов своего уровня нет, в зону своего уровня улететь не вышло — 20 мин бью самых слабых здесь (${Math.min(...lv)} ур., +${up} к герою)`);
      await env.setRt({ lvlRelax: { t: Date.now(), up, zone: env.rt.zone || null, auto: !!env.cfg.zoneAuto } });
      return;                                      // следующий проход выберет цель с «мягким окном»
    }
  }
  if (!cands.length) {
    // 10.0.10 (лог 13.10 19:44–20:56, alt1 19 ур.): 72 мин подряд «Целей нет, обновлю карту через 15 с» — все мобы рядом были «не по зубам»
    // (урон атаки ≈1 после конца «Бонуса новичка») или ниже героя −5, подбор локации выключен, бот молчал (242 перезагрузки карты).
    // Теперь пауза растёт (15 с → 60 с → 3 мин), а через 3 мин простоя и дальше раз в 10 мин — в журнал причина и что сделать
    idleLoad();                                    // 20.13 (шаг 5, farm/MF-1): счётчики с прошлой загрузки карты
    idleN++;
    const wait = idleN <= 3 ? 15 : idleN <= 8 ? 60 : 180;
    if (!idleT0) idleT0 = Date.now();
    else if (Date.now() - idleT0 > 180000 && Date.now() - idleRecT > 600000) {
      idleRecT = Date.now();
      const hl = env.heroLvl(), items = pageItems().filter(i => !i.boss && i.lvl), hard = env.rt.hardMobs || {}, now = Date.now();
      const nHard = items.filter(i => hard[String(i.name || '').toLowerCase().trim()] && now - (hard[String(i.name || '').toLowerCase().trim()].t || 0) < 2 * 3600000).length;
      const nLow = items.filter(i => hl && i.lvl < hl - FA_BELOW).length, nHigh = items.filter(i => hl && i.lvl > hl + (env.cfg.lvlAbove ?? 5)).length;
      const aS = (env.damageSkills || env.rt.skills)?.['атака'], atk = aS?.dmgN >= 5 ? aS.dmg / aS.dmgN : 0;
      env.rec('B', 'локации', `целей нет уже ${Math.round((now - idleT0) / 60000)} мин: на карте ${items.length} мобов — ${nHard} «не по зубам» (2 ч), ${nLow} ниже героя −5, ${nHigh} выше окна`
        + (env.cfg.zoneAuto ? ' — автофарм ищет зону' : ' — подбор локации ВЫКЛ: включите «🗺 Автофарм» или смените оружие/зону сами')
        + (atk && atk <= 5 ? ` · обычная атака ≈${atk.toFixed(0)} урона за удар — герой почти не пробивает (кончился «Бонус новичка» / слабое или снятое оружие): нужны оружие по уровню и заряды, пока — мобы слабее или другая зона` : '')
        + ` · проверяю карту раз в ${wait} с`);
    }
    idleSave();
    env.setStatus(`Целей нет, обновлю карту через ${wait} с`);
    for (let i = 0; i < wait && env.on && !env.rt.shop?.urgent; i++) await env.sleep(1000);
    if (env.on) { location.href = '/map.html'; await env.sleep(5000); }
    return;
  }

  idleT0 = 0; idleN = 0;                         // 10.0.10: цели есть — простой кончился
  idleRecT = 0; idleClear();                     // 20.13 (шаг 5, farm/MF-1): и сохранённый между перезагрузками счётчик
  // цель могла погибнуть/сдвинуться — пробуем до 5 лучших
  for (const c of cands.slice(0, 5)) {
    if (await attackSpawn(c, c => `Цель: ${c.name || 'чемпион'} (${c.lvl || '?'})${env.tags(c)} · приоритет ${c.rank + 1} · стр. ${pagerInfo()?.cur}`)) return;
    if (!env.on) return;
  }
  env.setStatus('Цели исчезли из списка, ищу заново');
  await env.sleep(1500);
}
function ashenRows() {
  return [...document.querySelectorAll('#ashen-mobs .ashen-mob')].map(row => {
    const fight = row.querySelector('button.ashen-fight');
    const name = row.querySelector('.ashen-name')?.textContent?.trim() || '';
    const lvl = +(name.match(/(?:Lv|ур\.)\s*(\d+)/i)?.[1] || 0);
    return { row, fight, name, lvl, ready: !!fight && !fight.disabled && !row.classList.contains('is-dead') && !/\d+\s*(?:с|s)\b/i.test(fight.textContent || '') };
  });
}
async function ashenStep() {
  if (!env.on || env.tabOwner === false || env.autonomyMode() !== 'farm') return;
  const rows = ashenRows(), min = +env.cfg.lvlMin || 1, max = +env.cfg.lvlMax || 99;
  const target = rows.find(r => r.ready && r.lvl >= min && r.lvl <= max);
  if (target) {
    if(env.dailyWorkReady && !await env.dailyWorkReady('mobs'))return;
    env.setStatus(`Ashen Bastion: ${target.name}`);
    const href = location.href;
    if (!env.fire(target.fight)) return;
    const opened = await env.waitFor(() => location.href !== href, 4000, 100);
    if (!opened && env.on) { env.setStatus('Ashen Bastion: бой не открылся, обновляю список'); location.reload(); }
    return;
  }
  const next = document.querySelector('#ashen-next');
  if (next && !next.disabled) { env.setStatus('Ashen Bastion: следующая страница'); env.fire(next); await env.sleep(700); return; }
  const first = document.querySelector('#ashen-prev');
  if (first && !first.disabled) { env.setStatus('Ashen Bastion: все страницы просмотрены, жду возрождения'); await env.sleep(19000); if (env.on && env.tabOwner !== false) location.href = '/ashen-bastion.html'; return; }
  env.setStatus(rows.length ? 'Ashen Bastion: подходящие мобы возрождаются' : 'Ashen Bastion: жду список мобов');
  await env.sleep(2000);
}
 return { dungeonCancelBlocked, scanChampPages, farmRate, FA_P, FA_MOB, FA_BELOW, lowCap, champTier, faChance, pageItems, pagerInfo, pageKey, gotoPage, aroundSig, markerTypes, netSpawns, parseRules, champRuleOn, chainBetter, chainCarries, ruleMatch, questHere, nameHere, rank, nextFight, mapReady, candidates, mobEps, mobValRank, mobValNote, winSecCap, attackSpawn, map, ashenRows, ashenStep, dungeonBattle };
 };
})(globalThis);
