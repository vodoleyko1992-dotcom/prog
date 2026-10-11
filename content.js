// ===== L2wap Bot v9.2.2 — content script (РБ, квесты, карта по точным селекторам) =====
// Бой: точные селекторы по разметке battle.html (снимок 2026-10-07).
// Карта: точные селекторы map.html + кэш спавнов локации.
const L2V7Modules = Object.create(null);
const TAG = '[L2bot]';
const recovery = L2EngineCore.createRecoveryController();
const transitionMonitor = L2EngineCore.createTransitionMonitor();
const progressMonitor = L2EngineCore.createProgressMonitor();
const ipc = (payload, ms = 15000) => L2EngineCore.withTimeout(chrome.runtime.sendMessage(payload), ms);
const DEF_CFG = { mmOrders: true, mmTpMax: 500000, mmGoalItem: 0, mmGoalLvl: 5, mmGoalFarm: true, mmSmithAuto: true, storyTurnIn: true, storyTpMax: 100000, epicMode: false, epicList: 'ak,core,orfen,baium,valakas,antharas,frintezza,zaken', epicMaxDeaths: 3, epicCheck: false, epicRetreatHp: 35, epicLvlUp: 0, epicCoinDailyMax: 0, epicCoinPerBoss: 1, epicCoinKeep: 0, epicMaxFightMin: 30, epicMaxRetreats: 8, epicAdenaDailyMax: 0, epicMinHpPots: 0, recipeRes: '', recipeNeed: 0, recipeSpoil: false, catMode: false, catDungeon: 'auto', nKeyBuffs: '', keyBuffBoss: true, nToggles: '', toggleMpOff: 10, toggleMpOn: 30, nSpoil: '', nSpoilMass: '', nSweep: '', spoilRb: false, tvtOn: true, enemyHunt: true, enemyFlagOnly: true, enemyLvlAbove: 3, enemyMinHits: 3, enemyMaxLoss: 2, enemyScanS: 30, fightMode: 'dps', combatProfile: 'auto', rbPotAt: 75, rbPotTo: 80, rbFrenzyDive: false, nUltra: '', ultMode: 'big', nDrain: '', drainHp: 85, indMode: 'full', autoLearn: true, netLog: true, gameMsgLog: true, learnShots: false,
  priority: '[квест]\n[чемп]\n[все]',
  rec: true, autoSnap: true, questStop: false, dock: true, dockMin: false,
  fishMode: false, rodEnchantTo: 10, fishTimeAuto: false, fishTimePack: '6h', fishTimeMin: 5, fishBait: 'auto', farmLvlBelow: 3, farmLvlAbove: 5, rbSessBuffs: '1413, 1323, 4703, 273, 365, 1303, 264, 267, 1389', rbSessNob: true, fishShots: true, fishAutoBuy: true, fishBuyPacks: 100, fishShotPacks: 750, fishShotAuto: true, fishMaxCasts: 0,
  autoMagister: false, potSlotAuto: true, debuffAuto: true, debuffMode: 'auto', nDebuff: '', fishProcess: true, fishProcessEvery: 100, fishOpenBoxes: true, fishGoal: '', weaponClassPick: true, weaponClassEquip: true, weaponScanAuto: true, shopAuto: true, shopReserve: 200000, shopMaxSpend: 2000000, shopHp: '300/1000', shopMp: '20/100', shopShots: '1000/5000', shopSpirit: '0/1000', shopSoul: '0/1000', shopBait: '0/0', zoneAuto: false, zoneTrial: 20, zoneAbove: 10, rbMaxBelow: 15, townBuffSet: 'basic', faBuffs: '', resQuests: '', rbMpPots: true, rbFast: true, rbTour: true, farmRes: '', farmNeed: 0,
  campaign: false, autoRevive: true, campaignEvery: 25,
  autoRoles: true, nWeaponMain: '',
  rbValueTour: false, rbExpValue: 0.20, rbPotCost: 500, rbMode: false, rbBetween: false, rbBandAuto: true, rbTurnPrice: true, rbCharge: true, rbChipRetreat: false, rbChipMaxAttempts: 3, rbRetreatHp: 20, rbRestHp: 95, rbMaxAbove: 15, rbUsePots: true, rbPotReserve: 10,
  chain: true, searchQuest: true, searchChamp: false, deepEvery: 10,   // 8.0.3: чемпионы по умолчанию ВЫКЛ (игрок 11.10), включаются в «Охоте»
  lvlMin: 1, lvlMax: 99, lvlAbove: 99, lvlBelow: 3, maxPages: 3, sealAuto: false, sealMin: 1,
  champMark: 'чемпион, чемпіон', bossMark: 'босс, boss, рейд', champHpMult: 1.5, stunEvery: 15,
  reactMin: 150, reactMax: 450, buffSec: 118,
  stopHp: 25, hpPotAt: 50, mpPotAt: 70, skillMpMin: 35,
  // слоты панели — по названию (атрибут title), через запятую — альтернативные написания
  nAttack: 'Атака', nPower: 'Iron Punch', nStun: 'Stunning Fist', nBuffs: 'Totem Spirit Bear',
  nShots: 'Заряд душі, Заряд души, Soulshot', nMpPot: 'Зілля мани, Зелье маны, Mana Potion', nHpPot: '', nHeal: '',
  // энергия силы: кто копит и кто тратит («Имя=цена»)
  nCharge: 'Focused Force', nForce: 'Hurricane Assault=2, Force Blaster=1',
  // 7.1.31: 🐱 слуга (Warlock): какого кота призывать (пусто — того, что был, иначе первого на панели), пороги, добивание котом, баффы кота
  debuffMinActs: 10,   // 7.1.31: дебафф в «авто» — только если бою ещё ≥ 10 действий (окупаемость хода)
  petAuto: true, petSummon: '', petResummon: true, petResummonAt: 25, petHealAt: 50, petFinish: false, petFinishMp: 80, petBuffAuto: true, nPetBuffs: '', petBuffSec: 1200
};
const DEF_RT = { status: '', kills: 0, exp: 0, sp: 0, adena: 0, buffAt: {}, buffSeen: {}, hpMin: {},
                 sinceDeep: 999, deepHot: false, target: null, mobClickAt: 0, bounce: 0,
                 spawns: {}, questTargets: [], quests: {},
                 rb: {}, rbDb: {}, rbSeen: {}, rbPending: false, rbCur: null, sinceRb: 999,
                 campaign: null, campaignUrl: '', campaignDue: false, sinceCamp: 0, lastTeleport: '', deaths: [] };
const BACK  = /^(Назад на карту|Назад на мапу)$/i;
const QUEST = /[★☆⭐✩✪✫✭✮✯]/;

let cfg = DEF_CFG, rt = DEF_RT, on = false, running = false;
let deferredMigrations = { cfg: {}, rt: {} }; // execute only after acquiring ownership
// флаг разовой миграции (значение 1) уже есть в свежем хранилище — значит, хозяин её применил: отложенный пакет устарел
const migApplied = (patch, ...states) => Object.keys(patch).some(k => patch[k] === 1 && states.some(s => s && s[k]));
// 8.0.3 (игрок 11.10: «РБ между мобами по умолчанию выкл, с возможностью включения»; проверка правки): rbMode больше не хранимый
// флаг, который каждый режим должен держать в согласии (выход из эпиков/кампании, импорт старых настроек, миграции его теряли), а
// ВЫЧИСЛЯЕМЫЙ: тур по РБ — да; иначе выбор игрока rbBetween (по умолчанию выкл), если не мешает рыбалка/эпики/кампания
const rbEff = c => !!(c.rbHuntMode || (c.rbBetween && !c.fishMode && !c.epicMode && !c.campaign));
const withRb = c => ({ ...c, rbMode: rbEff(c) });
const mergeCfg = c => withRb({ ...DEF_CFG, ...(c || {}) });
const modeSig = c => [c.rbHuntMode && 'тур РБ', c.epicMode && 'эпики', c.fishMode && 'рыбалка', c.catMode && 'катакомбы', c.zoneAuto && 'автофарм',
  !c.rbHuntMode && rbEff(c) && 'РБ между мобами', c.campaign && 'кампания', c.tvtOn && 'TvT'].filter(Boolean).join(' + ') || 'фарм на месте';

// ---------- утилиты ----------
// v5.1 автообучение: каждый поиск элемента запоминается — «на этой странице нашёлся / нет» (за заход на страницу).
// Если селектор, который раньше находился почти всегда, перестал находиться — игра поменяла разметку (см. learnTick)
const SELV = new Map();
const SID = Math.random().toString(36).slice(2, 7);   // заход на страницу: события одного захода связываются в анализе
const $q = s => { const r = document.querySelector(s); if (SELV.size < 800 || SELV.has(s)) { if (r) SELV.set(s, true); else if (!SELV.has(s)) SELV.set(s, false); } return r; };
// фоновая вкладка: браузер тормозит таймеры страницы (до 1 раза в секунду, а через 5 мин — раз в минуту).
// Тогда паузы отсчитывает фоновый скрипт расширения — его таймеры не тормозятся.
const bgSleep = ms => new Promise(r => {
  let done = false; const fin = () => { if (!done) { done = true; r(); } };
  try { chrome.runtime.sendMessage({ cmd: 'sleep', ms }, () => { void chrome.runtime.lastError; fin(); }); } catch (e) { setTimeout(fin, ms); }
  setTimeout(fin, ms + 2000);                     // страховка, если фоновый скрипт не ответил
});
// пульс для сторожа: работающий цикл бота всегда где-то «спит» — оттуда раз в 5 с сообщаем фону, что живы.
// Нет пульса > 2,5 мин при включённом боте (вкладка зависла, выгружена браузером, ошибка сервера) — фон перезагрузит вкладку.
let hbT = 0;
var leaseEpoch = null;
function heartbeat() {
  if (!tabOwner || !on) return; // ожидающие вкладки не должны перепривязывать сторожа
  const now = Date.now();
  if (now - hbT < 5000) return;
  hbT = now;
  try { chrome.runtime.sendMessage({ cmd: 'hb', epoch: leaseEpoch, page: location.pathname }, () => void chrome.runtime.lastError); } catch (e) {}
}
// в фоновой вкладке любые паузы (даже 35 мс) — через фоновый скрипт: браузер растягивает их до 1 с и больше
setInterval(() => { if (on && tabOwner && running) heartbeat(); }, 5000);
const sleep = ms => { if (on) heartbeat(); return document.visibilityState === 'hidden' ? bgSleep(ms) : new Promise(r => setTimeout(r, ms)); };
const rnd = (a, b) => a + Math.random() * (b - a);
// долгое ожидание кусками по 10 с: пульс для сторожа не прерывается, в статусе — обратный отсчёт
async function idle(ms, label) {
  const t0 = Date.now();
  setStatus(label);                              // в журнал — один раз, дальше только отсчёт в статусе
  while (on && tabOwner && !rt.shop?.urgent && Date.now() - t0 < ms) { setStatus(`${label} · ${Math.ceil((ms - (Date.now() - t0)) / 1000)} с`); await sleep(Math.min(1000, ms - (Date.now() - t0))); }
}
// «реакция» между ходами. На РБ — быстрее (модель 100 000 боёв: 300 → 150 мс среднее = −7 % времени боя; 600 мс = +17 %)
const pause = () => { const rb = isBattle() && rt.target?.rb && cfg.rbFast !== false; return sleep(rb ? rnd(Math.min(cfg.reactMin, 100), Math.min(cfg.reactMax, 220)) : rnd(cfg.reactMin, cfg.reactMax)); };
const visible = el => !!el && el.getClientRects().length > 0;
const shown = el => !!el && !el.hidden && !el.closest('[hidden]') && visible(el);
const isBattle = () => /battle/i.test(location.pathname);
const isMap = (...args) => L2V7Modules.navigation.isMap(...args);            // «Окрестности»; city.html — это город
const isMail = () => /\/mail\.html/i.test(location.pathname);
const isCampaign = () => /\/(?:starter-story-quest|dion-campaign)\.html$/i.test(location.pathname)
                      || !!document.querySelector('.l2-starter-story-targets, [data-action="complete-chapter"], [id$="-campaign-main"]')
                      || /campaign/i.test(location.pathname);
const names = s => (s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

async function waitFor(fn, timeout = 10000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (!on || !tabOwner) return null;
    const r = fn(); if (r) return r;
    await sleep(step);
  }
  return null;
}

function byText(re, sel = 'a,button,div,span') {
  return [...document.querySelectorAll(sel)].find(e =>
    visible(e) && re.test(e.textContent.trim()) &&
    ![...e.children].some(c => re.test(c.textContent.trim())));
}

function fire(el) {
  if (!el || (on && !tabOwner)) return false;
  el.scrollIntoView({ block: 'nearest' });
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true, view: window,
              clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  const p = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...o, ...p, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
  el.dispatchEvent(new PointerEvent('pointerup', { ...o, ...p }));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  return true;
}

// Single-writer settings update. Avoid whole-cfg races with the popup.
async function setCfg(patch) {
  const response = await ipc({ cmd: 'statePatch', patch: {}, cfgPatch: patch,
    src: TAB_ID, epoch: leaseEpoch });
  if (!response?.ok) throw new Error('settings_patch_failed: ' + (response?.reason || 'unknown'));
  cfg = withRb({ ...cfg, ...patch });
}

// ---------- персонаж (шапка есть на всех страницах) ----------
const numOf = sel => { const t = $q(sel)?.textContent || ''; const n = parseInt(t.replace(/\D/g, ''), 10); return isNaN(n) ? null : n; };
function bar(...args) { return L2V7Modules.resources.bar(...args); }
const meHp = (...args) => L2V7Modules.resources.meHp(...args);
const meMp = (...args) => L2V7Modules.resources.meMp(...args);

// ---------- бой: точные элементы ----------
function mobHp(...args) { return L2V7Modules.combat.mobHp(...args); }
// доп. цели (пика/древко бьёт нескольких): «Ol Mahum Marksman 874 / 1524» внутри #battle-whirlwind-extras
function extraMobs(...args) { return L2V7Modules.combat.extraMobs(...args); }
// сообщения игры над боем: «Цей скилл зараз недоступний для твого персонажа», «Зброю змінено» и т.п.
const noticeText = (...args) => L2V7Modules.combat.noticeText(...args);
const UNAVAIL = /недоступн|недоступен|unavailable|не можна використ|нельзя использ/i;
const mobTitle = (...args) => L2V7Modules.combat.mobTitle(...args);
const mobName = (...args) => L2V7Modules.combat.mobName(...args);
const victory = (...args) => L2V7Modules.combat.victory(...args);
const defeat = (...args) => L2V7Modules.combat.defeat(...args);
const loadErr = (...args) => L2V7Modules.combat.loadErr(...args);

const SLOT = '.l2-battle-hotbar-slot:not(.l2-battle-hotbar-slot--empty)';
function slotsBy(...args) { return L2V7Modules.combat.slotsBy(...args); }
const slotCd = b => b?.querySelector('.l2-battle-hotbar-slot-cd');
function cdBusy(...args) { return L2V7Modules.combat.cdBusy(...args); }
// готовность по панели (оверлей КД)
const uiReady = (...args) => L2V7Modules.combat.uiReady(...args);
// память КД: панель иногда показывает «готов», а игра отвечает «Скіл на перезарядці» —
// бот сам помнит, когда скилл откатится (rt.cdUntil, переживает перезагрузку страницы)
const CD_RE = /перезаряд|на откат|cooldown|ещё не готов|ще не готов/i;
const skKey  = b => cleanTitle(b?.title || '').toLowerCase();
const combatCooldown = L2BattleCooldown.createBattleCooldown();
const slotAction = b => b?.getAttribute('data-slot-cd') || b?.querySelector('[data-slot-cd]')?.getAttribute('data-slot-cd') || '';
let PET = null;                                  // 7.1.16-fix: последний известный слуга (activeSummon из ответа боя)
const petState = () => PET;
// 7.1.31 (скрин магистра 10.10): на L2WAP у части скиллов в описании «В бою эффекта нет: 0 изменения HP и статов, только трата MP
// и откат» — Servitor Wind Walk, Body To Mind. Бот их никогда не жмёт (раньше Body To Mind жался при нехватке MP — ход впустую).
// Кроме встроенного списка — описание со страницы магистра (learnSkillDb → rt.skillDb[имя].desc; «Умения» = /magister.html?mode=learned).
// Важно: иконка Servitor Wind Walk — skill1144, а в справочнике Interlude 1144 = Fast Servitor (бафф кота) — без этой проверки попал бы в баффы кота
const NO_EFFECT_DEF = 'Servitor Wind Walk, Body To Mind';
const NO_EFFECT_RE = /в бою эффекта нет|у бою ефекту немає/i;
const noEffect = x => {
  const n = (typeof x === 'string' ? x : cleanTitle(x?.title || '')).trim().toLowerCase();
  if (!n) return false;
  const d = rt.skillDb?.[n]?.desc;
  return d ? NO_EFFECT_RE.test(d) : names(NO_EFFECT_DEF).includes(n);
};
const battleSpawn = () => new URLSearchParams(location.search).get('spawnId') || '';
// 7.2.1 (лог 10.10 21:08–21:14): в цепочке «Охотиться дальше» адрес страницы меняется (spawnId нового моба), а игра в /game/battle/action
// шлёт battleSpawnId ПЕРВОГО боя цепочки (url=dense_30865, req=dense_30844). Модель откатов сверяла ответ с адресом и выбрасывала его —
// в цепочке (≈85 % боёв) бот не знал серверных откатов, жал заклинание на КД («Aura Burn: урон 0», «ещё на КД — бью другим»: +2–3 с на бой).
// Откаты — по тому id, который шлёт сама игра на этой странице (новая страница — заново)
let GAME_SPAWN = '';
const cdSpawn = () => GAME_SPAWN || battleSpawn();
const memLeft = b => {
  const id = slotAction(b), spawn = cdSpawn();
  if (id && combatCooldown.skillKnown(id, spawn)) return combatCooldown.skillWait(id, spawn) / 1000;
  return Math.max(0, ((rt.cdUntil || {})[skKey(b)] || 0) - Date.now()) / 1000;
};
const ready = (...args) => L2V7Modules.combat.ready(...args);
const uiTimer = b => parseFloat((b?.querySelector('.l2-battle-hotbar-slot-cd__timer')?.textContent || '').replace(',', '.'));
function cdLeft(...args) { return L2V7Modules.combat.cdLeft(...args); }
async function rememberCd(...args) { return L2V7Modules.combat.rememberCd(...args); }
const qty     = b => { const t = b?.querySelector('.l2-battle-hotbar-slot-uqty')?.textContent; return t ? parseInt(t.replace(/\D/g, ''), 10) : null; };
const shotsOn = b => !!b && (b.classList.contains('l2-hotbar-shot--enabled') || (/активн/i.test(b.title || '') && !/активац/i.test(b.title || '')));
const shotSlot = () => document.querySelector('.l2-hotbar-shot--enabled, .l2-hotbar-shot--disabled') || slotsBy(cfg.nShots)[0] || null;
// строка активных баффов у шапки: <div data-skill-id="1068" data-expires-at="…"> — точнее, чем поиск по названию
function activeBuffs(...args) { return L2V7Modules.buffs.activeBuffs(...args); }
function buffDur(...args) { return L2V7Modules.buffs.buffDur(...args); }
function ownBuffLeft(...args) { return L2V7Modules.buffs.ownBuffLeft(...args); }
// перед РБ: важные баффы (тотем) должны висеть с начала боя — сколько секунд ждать их отката (0 — не нужно / не дождёмся за 60 с)
function buffWaitBeforeRb(...args) { return L2V7Modules.buffs.buffWaitBeforeRb(...args); }
function buffActive(...args) { return L2V7Modules.buffs.buffActive(...args); }

// ---------- ⛏ v5.3: спойл (гном): Spoil / Spoil Crush (удар + спойл, дубины) / Spoil Festival → после победы Sweeper ----------
// В начале боя — пометить моба спойлом (до 3 попыток: спойл может не пройти); удачу ищем в логе боя («спойл активирован» и т.п.).
// После победы, пока панель боя ещё на экране, — «Sweeper» (собрать спойл). Что пишет игра, бот записывает в журнал (учимся).
// v5.5.3 (лог 08.10 21:31, украинский интерфейс): «Спойл успішний», «Спойл не вдався (56%)», «Spoil: моб уже заспойлений»;
// на экране победы — «Спойл успішний / не спрацював», добыча строками «Спойл: Coal ×5» (собирается сама, Sweeper не нужен)
const SPOIL_OK = /(спойл|spoil)[^.]{0,40}(актив|успе[шх]|успіш|успіх|наклад|наложен|activat|success)|(актив|успе[шх]|успіш)[^.]{0,30}(спойл|spoil)|condition of spoil|(уже|вже)\s+заспойл|already spoil/i;
const SPOIL_FAIL = /(спойл|spoil)[^.]{0,40}(не (удал|прош|сработ|вдав|спрацю)|провал|fail|resist)|(не (удал|прош|сработ|вдав|спрацю)|fail)[^.]{0,30}(спойл|spoil)/i;
const mobSpoiled = () => /(^|\|)spoil:/i.test($q('#battle-mob-effects-row')?.dataset.effectsSig || '');   // значок спойла на мобе
const SPOIL_LOOT = /^(?:Спойл|Spoil)\s*:?\s*(.+?)\s*×\s*(\d+)/i;
const SWEEP_OK = /(sweep|свип|зібр|собра)[^.]{0,40}|спойл[^.]{0,20}(получ|отрим)/i;
function spoilPick(...args) { return L2V7Modules.loot.spoilPick(...args); }
// v5.5.8: 🎉 масс-спойл (Spoil Festival — область вокруг цели, MP 73–204): когда в бою 2+ живых моба — сначала он (метит всех
// рядом за одно нажатие), один моб — обычный Spoil (в 3–6 раз дешевле). Масс-спойл — раз за бой (не прошёл — дальше обычный Spoil по главному)
function massSpoilPick(...args) { return L2V7Modules.loot.massSpoilPick(...args); }
function festivalParse(...args) { return L2V7Modules.loot.festivalParse(...args); }
async function massSpoilStep(...args) { return L2V7Modules.loot.massSpoilStep(...args); }
async function spoilStep(...args) { return L2V7Modules.loot.spoilStep(...args); }
async function sweepStep(...args) { return L2V7Modules.loot.sweepStep(...args); }

// ---------- 🔁 v5.3: постоянные баффы (тогглы: Vicious Stance, Soul Cry, Fist Fury, Arcane Power, Accuracy…) ----------
// Включил — висят, пока не выключишь, и понемногу тратят MP. Бот держит их включёнными; если MP < «выключать при» —
// выключает (чтобы хватило на удары и банки), включает снова, когда MP ≥ «включать при».
// Включён ли: строка баффов у шапки (ID скилла) → подсветка слота (aria-pressed / --active / --on) → память бота (rt.toggleOn).
// Чтобы не щёлкать туда-сюда: после нажатия 4 с не трогаем; если состояние нигде не видно — верим памяти.
function toggleState(bn, b) {
  const il = ilOf(b), act = activeBuffs();
  if (il && act.length) { if (act.some(x => x.id === il.id)) return true; if (rt.toggleSeen?.[bn]) return false; }
  if (b.getAttribute('aria-pressed') === 'true' || /--(active|on|toggled|enabled)\b/.test(b.className)) return true;
  if (b.getAttribute('aria-pressed') === 'false') return false;
  return rt.toggleOn?.[bn] ?? null;                 // null — не знаем
}
async function toggleStep(ctx, me, act) {   // act — нажатие из боя (battle)
  const list = names(cfg.nToggles); if (!list.length) return false;
  const mp = meMp(), mpP = mp?.max ? mp.cur / mp.max * 100 : 100, off = cfg.toggleMpOff ?? 10, onP = cfg.toggleMpOn ?? 30;
  for (const bn of list) {
    const b = slotsBy(bn)[0]; if (!b || (ctx.block['tgl:' + bn] || 0) > Date.now()) continue;
    const st = toggleState(bn, b), il = ilOf(b);
    if (st === true && il && activeBuffs().some(x => x.id === il.id) && !rt.toggleSeen?.[bn]) await setRt({ toggleSeen: { ...(rt.toggleSeen || {}), [bn]: true } });
    let want = null;
    if (st !== true && mpP >= (st === false && rt.toggleOff?.[bn] ? onP : off + 1) && uiReady(b)) want = true;     // включить
    else if (st === true && mpP < off) want = false;                                                                  // выключить — бережём MP
    if (want == null) continue;
    ctx.block['tgl:' + bn] = Date.now() + 4000;
    const r = await act(b, `${want ? 'Включаю' : 'Выключаю (MP ' + (mpP | 0) + '%)'}: ${cleanTitle(b.title)}`);
    if (r !== 'unavail' && r !== 'noforce') {   // у тоггла КД может не быть — нажатие засчитываем, дальше сверяемся со строкой баффов
      await setRt({ toggleOn: { ...(rt.toggleOn || {}), [bn]: want }, toggleOff: { ...(rt.toggleOff || {}), [bn]: !want } });
      rec('B', 'тоггл', `${cleanTitle(b.title)}: ${want ? 'включён' : `выключен — MP ${mpP | 0}% < ${off}%, включу при ≥ ${onP}%`}`);
    } else if (r === 'unavail') { ctx.block['tgl:' + bn] = Infinity; rec('B', 'тоггл', `${cleanTitle(b.title)}: ${noticeText() || 'недоступен'} — до конца боя не трогаю`); }
    return true;
  }
  return false;
}

// ---------- 🩺 v5.2: самопроверка баффов — что назначено, что висит, почему не ставится ----------
// Раз в 15 с в бою: по каждому баффу из «Баффы» — причина в rt.buffAudit (меню показывает), в журнал — при смене причины.
// Сторож: бафф, который бот уже видел в строке баффов (значит, его ID там точно виден), пропал, готов и не стоит
// по таймеру уже 20 с — сбрасываем таймер и блок: бот ставит его заново (раньше мог ждать всю длительность — до 20 мин).
function buffAudit(...args) { return L2V7Modules.buffs.buffAudit(...args); }
async function buffAuditStep(...args) { return L2V7Modules.buffs.buffAuditStep(...args); }

// ---------- оружие на панели: смена ради баффа (кастеты → бафф → обратно пика) ----------
const EQUIP_OK = /змінено|изменено|одягнено|надето|экипир/i;
function equipBy(...args) { return L2V7Modules.equipment.equipBy(...args); }
async function equip(...args) { return L2V7Modules.equipment.equip(...args); }

// ---------- энергия силы: Focused Force копит, Hurricane Assault / Force Blaster тратят ----------
// Лог игры: «Концентрація сили: +1 енергія (1/2).» — счётчик и предел; «Hurricane Assault: сила 535, −2 енергії сили» — трата.
// На пределе нажатие ничего не пишет в лог. Заряды сохраняются между боями (видно по журналу).
const FORCE_CNT  = /(?:енергі\S*|энерги\S*|energy)\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/i;          // «+1 енергія (1/2)»
const FORCE_SPEND = /[−-]\s*(\d+)\s*(?:енергі|энерги|energy)/i;                             // «−2 енергії сили»
const FORCE_WORD = '(?:енергі\\S*|энерги\\S*|force\\s+energ\\S*)';
const FORCE_NEED = new RegExp('(?:недостат|не вистача|не хвата|потрібн|нужн|need|not enough|немає)[^|]{0,40}' + FORCE_WORD + '|' + FORCE_WORD + '[^|]{0,30}(?:недостат|не вистача|не хвата|not enough)', 'i');
const FORCE_TTL = 20 * 60000;                    // предположение: заряды живут долго; через 20 мин без боя считаем 0
// Burning Fist / Soul Breaker энергию НЕ тратят (лог «Burning Fist: сила 486» без «−N енергії», заряды в шапке те же) — v4.16
const FORCE_KNOWN = { 'hurricane assault': 2, 'force blaster': 1, 'force storm': 1, 'force burst': 1 };
// Force Buster (= Force Burst) игрок применял при 0 зарядов, в логе «−N енергії» нет — на этом сервере бесплатный
const FREE_HIT = /^(burning fist|soul breaker|force buster|force burst)$/i;
const CHARGE_RE = /focused force|концентрац\S* сил|накоплен\S* сил/i;
const skillCost = n => { const k = (n || '').toLowerCase(), il = ilOf(n);
  if (rt.forceNeed?.[k]) return rt.forceNeed[k];
  if (rt.forceFree?.[k] || FREE_HIT.test(k)) return 0;                 // проверено в бою: удар прошёл, энергия не списана
  return rt.skillDb?.[k]?.force || (il && il.t !== 'CHARGE' && ilNum(il.charges)) || FORCE_KNOWN[k] || 0; };
function forceCosts() {                          // [{ name, cost }] — из «Имя=2, Имя=1»; без «=N» — из базы магистра
  return (cfg.nForce || '').split(',').map(s => s.trim()).filter(Boolean).map(part => {
    const m = part.match(/^(.+?)\s*[=:]\s*(\d+)$/), name = (m ? m[1] : part).trim();
    return { name, cost: m ? +m[2] : (skillCost(name) || 1) };
  });
}
const isForceName  = n => skillCost(n) > 0;
const isChargeName = n => CHARGE_RE.test(n || '') || !!rt.skillDb?.[(n || '').toLowerCase()]?.charge || ilOf(n)?.t === 'CHARGE';
// энергия в шапке: значок Focused Force «3 зарядів …» (.l2-hud-active-buff--charges) — точное число зарядов.
// Нет значка при видимых баффах — 0; нет баффов вовсе — неизвестно (null).
function hudForce() {
  const c = $q('.l2-hud-active-buff--charges');
  if (c) { const n = parseInt(c.querySelector('.l2-hud-active-buff-charge')?.textContent || (c.title.match(/(\d+)\s*заряд/) || [])[1], 10); return n >= 0 ? n : null; }
  return $q('.l2-hud-active-buff') ? 0 : null;
}
// шапка может не обновляться посреди боя: верим ей, если её число изменилось с нашей последней записи
// (или это начало боя — см. battle()), иначе — своему учёту по логу
function forceNow() {
  const f = rt.force || {}, h = hudForce();
  if (h != null && h !== f.hud) return h;
  return f.t && Date.now() - f.t < FORCE_TTL ? f.n || 0 : 0;
}
const forceMax = () => rt.force?.max || 0;
async function forceSet(n, max, why) {
  const nf = { n: Math.max(0, n), t: Date.now(), max: max || rt.force?.max || 0, hud: hudForce() };
  await setRt({ force: nf });
  if (why) rec('B', 'энергия', `${why}: ${nf.n}${nf.max ? '/' + nf.max : ''}`);
}
// по новым строкам лога после нажатия: точное значение или списание
async function forceFromLog(added) {
  for (const l of added) { const m = l.match(FORCE_CNT); if (m) { await forceSet(+m[1], +m[2]); return true; } }
  for (const l of added) { const m = l.match(FORCE_SPEND); if (m) { await forceSet(forceNow() - +m[1]); return true; } }
  return false;
}
// база умений со страницы магистра: «Нужно и тратит 2 энергии силы. MP 49, сила 501. … Перезарядка 17 с.»
function learnSkillDb() {
  const cards = [...document.querySelectorAll('[class*="magister-skill-card__name"]')];
  if (!cards.length) return 0;
  const db = { ...(rt.skillDb || {}) };
  const fresh = [];
  for (const nm of cards) {
    let card = nm.parentElement;
    while (card && !card.querySelector('[class*="magister-skill-card__desc"]')) card = card.parentElement;
    if (!card) continue;
    const name = nm.textContent.trim(), k = name.toLowerCase();
    const t = (card.querySelector('[class*="magister-skill-card__desc"]')?.textContent || '').replace(/\s+/g, ' ').trim();
    const meta = (card.querySelector('[class*="magister-skill-card__meta"]')?.textContent || '').replace(/\s+/g, ' ');
    const info = { name,
      force: +(t.match(/(\d+)\s*(?:энерги|енергі)\S*\s+сил/i)?.[1] || 0), spends: /трат|витрач/i.test(t),
      charge: /(?:накаплива|копит|набира|заряжа)\S*[^.]{0,30}(?:энерги|енергі)/i.test(t) && !/нужн|потрібн/i.test(t),
      mp: +(t.match(/MP\s*(\d+)/)?.[1] || 0), power: +(t.match(/сил[аи]\s*(\d+)/i)?.[1] || 0),
      cd: +(t.match(/Перезарядк\S*\s*(\d+)/i)?.[1] || 0),
      fists: /кастет/i.test(t), passive: /пассив|пасив/i.test(t + ' ' + meta),
      rank: meta.match(/ранг:\s*(\d+\s*\/\s*\d+)/i)?.[1]?.replace(/\s/g, '') || '', desc: t.slice(0, 220) };
    if (JSON.stringify(db[k]) !== JSON.stringify(info)) { db[k] = info; fresh.push(info); }
  }
  if (fresh.length) {
    setRt({ skillDb: db });
    rec('S', 'умения', fresh.map(i => `${i.name}${i.rank ? ' р.' + i.rank : ''}: ${i.passive ? 'пассив' : `MP ${i.mp}${i.power ? ' · сила ' + i.power : ''}${i.cd ? ' · КД ' + i.cd + ' с' : ''}`}`
      + `${i.force ? ' · энергия ' + i.force + (i.spends ? ' (тратит)' : ' (нужна)') : ''}${i.fists ? ' · кастеты' : ''}`).join(' | '));
  }
  return fresh.length;
}

// ---------- расчёт ДПС и стратегия боя ----------
// Ход ≈ 1 нажатие (время между нажатиями бот меряет сам: rt.turnMs). Для каждого действия: ожидаемый урон
// (средний по логу), КД, MP, цена в энергии. Правила:
//  1) добивание — самым «дешёвым» действием, которое наверняка убивает (не жжём Hurricane и КД на то, что добьёт атака);
//  2) если до мощного удара не хватает одного заряда и цель «толстая» — сначала заряд;
//  3) иначе — максимум урона из готового (длинные КД запускаем сразу, чтобы они быстрее откатились);
//  4) пока атака и скиллы на КД — копим энергию (бесплатный ход).
const turnSec = () => (rt.turnMs || 1000) / 1000;
function expDmg(name) {
  const k = (name || '').toLowerCase(), f = fightDmg(k);
  if (f != null) return f;                       // замер текущего боя важнее среднего
  const p = rt.skills?.[k];
  if (p?.dmgN) return p.dmg / p.dmgN;
  const atk = rt.skills?.['атака'], base = atk?.dmgN ? atk.dmg / atk.dmgN : 600;
  if (k === 'атака') return base;
  // ещё не применялся: урон ≈ «сила» × коэффициент героя. Коэффициент — по уже изученным скиллам
  // (Hurricane Assault: сила 535 → 3247 урона ≈ ×6). Сила — из описания магистра или из лога «…: сила N»
  const pw = powerOf(k);
  if (pw) { const kf = powerK(); if (kf) return pw * kf; }
  return pw ? base * Math.max(1.2, pw / 120) : base * 1.5;
}
function skillMp(name) {                        // MP за применение: замер или справочник Interlude
  const k = (name || '').replace(/\s*\(.*$/, '').toLowerCase(), p = rt.skills?.[k];
  if (p?.mpN) return p.mp / p.mpN;
  const v = ilOf(k)?.mp; return Array.isArray(v) ? v[Math.min(v.length - 1, 10)] : (v || 30);
}
function powerOf(k) {
  const db = rt.skillDb?.[k];
  if (db?.power) return db.power;
  const m = (rt.skills?.[k]?.last || '').match(/сил[аи]\s*(\d+)/i);
  return m ? +m[1] : 0;
}
function powerK() {                              // медиана «урон / сила» по скиллам, где известно и то и другое
  const r = Object.entries(rt.skills || {}).filter(([k, p]) => p.dmgN >= 2 && powerOf(k)).map(([k, p]) => p.dmg / p.dmgN / powerOf(k)).sort((a, b) => a - b);
  return r.length ? r[r.length >> 1] : 0;
}
// «цена» действия в секундах: КД, который сгорит, + заряды (1 заряд = 1 ход)
const actCost = o => (o.cd || 0) + (o.force || 0) * turnSec() * 1.5;
// ---------- длинный бой (РБ): мана — главный ресурс ----------
// Модель по 4 боям с РБ, прогон 50 000 боёв (v4.16): «Атака» откатывается ≈4 с, между атаками 2–3 свободных хода,
// значит скиллы урон атаки не вытесняют, а упираются в MP (реген ≈2,5 MP/с, а FB+IP+HA просят ≈11 MP/с).
// Итог: время на РБ 200 с (v4.14, резерв 30 %) → 166 с (бюджет MP) → 101 с (бюджет + банки MP).
// Правила: 1) банки MP есть — тратим всё, сильнейшее готовое, пьём при MP < 80;
// 2) банок нет — «дешёвые» удары (урон/MP ≥ 85 % лучшего: Force Blaster с зарядом, Soul Breaker) — по откату,
//    дорогие (Iron Punch, Burning Fist, Hurricane) — только из излишка MP до конца боя или когда MP упирается в потолок.
const MP_REGEN = 2.5;                            // MP/с в бою без банок (Гармаш 2,4 · Белефа 2,6)
// ---------- 🧪 база зелий (v4.40): что лечит каждая банка, сколько в сумке, откат — для оценки «хватит ли сил на РБ» ----------
// Ключ — полное имя до « — » («Зілля мани (велика банка)» и «(мала банка)» — разные банки; раньше скобки отрезались).
// Лечение — по журналу боя после глотка: «Велике зілля HP: відновлення імпульсами по 2500 HP кожні 1 с.» + «Зілля +2500 HP».
const potName = b => (b?.title || '').split(/\s+[—–]\s+/)[0].trim();
const potKey = b => potName(b).toLowerCase();
const potBag = b => { const m = (b?.title || '').match(/\((\d[\d\s]*)\s*(?:у сумці|в сумке|in bag)/i); return m ? +m[1].replace(/\s/g, '') : qty(b); };
let POT_LAST = 0;
async function potWatch(...args) { return L2V7Modules.resources.potWatch(...args); }
function potInventory(...args) { return L2V7Modules.resources.potInventory(...args); }

// банки HP: из роли «Банка HP» + любые лечебные зелья на панели (Велике зілля HP, Зілля зцілення…); лечение — по замеру
const HP_POT_RE = /зілля\s*hp|зелье\s*hp|зцілен|исцелен|лікуван|лечен|healing|greater healing|здоров/i;
function hpPots(...args) { return L2V7Modules.resources.hpPots(...args); }
function hpPotByDeficit(...args) { return L2V7Modules.resources.hpPotByDeficit(...args); }
function hpPotPick(...args) { return L2V7Modules.resources.hpPotPick(...args); }
function mpPotSlot(...args) { return L2V7Modules.resources.mpPotSlot(...args); }
function longFightMp(...args) { return L2V7Modules.resources.longFightMp(...args); }

function dpsPlan(...args) { return L2V7Modules.combat.dpsPlan(...args); }
// ценность одного заряда энергии: лучший «урон на 1 заряд» среди ударов силой, которые его потратят.
// Если зарядов уже хватает на всё, что откатится в ближайшие ~3 хода, лишний заряд почти ничего не стоит
// (энергия сохраняется между боями — остаток ценим наполовину)
function chargeValue() {
  const fN = forceNow(), max = forceMax() || 3;
  if (fN >= max) return 0;
  const fs = forceCosts().map(c => ({ ...c, b: slotsBy(c.name)[0] })).filter(c => c.b);
  if (!fs.length) return 0;
  const per = Math.max(...fs.map(c => expDmg(c.name) / Math.max(1, c.cost)));
  const need = t => fs.filter(c => cdLeft(c.b) <= t).reduce((a, c) => a + c.cost, 0);
  if (fN < need(turnSec() * 3)) return per;      // заряд пойдёт в дело в ближайшие ходы
  if (fN < need(10)) return per * 0.5;           // пригодится через несколько секунд (или в следующем бою)
  return 0;                                      // и так хватает на всё, что откатится
}

// ---------- панель: инвентаризация и профили скиллов (бот учится, что делает каждый слот) ----------
// ---------- справочник скиллов Interlude (skills-il.js): слот → ID → тип, откат, заряды, оружие, длительность ----------
const IL = typeof IL_DB !== 'undefined' ? IL_DB : {};
const IL_BY_NAME = Object.fromEntries(Object.entries(IL).map(([id, e]) => [e.n.toLowerCase(), +id]));
// игра называет скилл на панели иначе, чем в логе боя и в справочнике: «Force Buster» (панель) = «Force Burst» (лог, IL #17)
const NAME_ALIAS = { 'force buster': 'force burst',
  // 7.1.16-fix: в логе боя заклинания мага — по-украински («Вампірний дотик 596», «Полум’я 618»). Без этого урон Vampiric Touch
  // и Blaze не узнавался (урон 0, «урон ≈2»), и бот выбирал заклинания вслепую
  'vampiric touch': 'вампірний дотик', 'aura burn': 'опік аури', 'energy bolt': 'енергетична блискавка', 'blaze': 'полум’я',
  'flame strike': 'удар полум’я' };   // остальные имена бот запоминает сам (rt.logAlias) по первому одиночному нажатию
const apos = s => String(s || '').toLowerCase().replace(/[’'`ʼ]/g, '’');
const logName = n => apos(rt.logAlias?.[(n || '').toLowerCase()] || NAME_ALIAS[(n || '').toLowerCase()] || n);
for (const [a, b] of Object.entries(NAME_ALIAS)) if (IL_BY_NAME[b] != null && IL_BY_NAME[a] == null) IL_BY_NAME[a] = IL_BY_NAME[b];
function ilOf(x) {                               // x: кнопка слота, запись панели (cdKey) или имя скилла
  let id = null, name = '';
  if (x && typeof x === 'object') {
    const k = x.cdKey ?? x.querySelector?.('[data-slot-cd]')?.dataset.slotCd ?? '';
    const m = String(k).match(/l2_(\d+)/);
    if (m) id = +m[1]; else name = x.name || (x.title || '').split(/\s+[—–-]\s+|\s*\(/)[0];
  } else name = x || '';
  if (id == null && name) id = IL_BY_NAME[name.trim().toLowerCase()];
  return id != null && IL[id] ? { id, ...IL[id], ...(IL_FIX[id] || {}) } : null;
}
// 7.2: скиллы, которые на L2WAP работают иначе, чем в справочнике Interlude.
// Corpse Life Drain (лог 10.10 20:52–20:53, игрок поставил вместо Heal): лечит себя в бою по живой цели («Витяг життя з трупа»,
// HP = уровень×3 + ранг×5 = 178 на 51 ур./ранге 5, MP 0, повтор через ≈2 с; кот бьёт и на этот ход). В Interlude — «маг. атака по трупу»
// 7.2.1 (скрин магистра 10.10): дебаффы L2WAP — не как в Interlude. mDefDown — +урон заклинаний мага (кот бьёт физикой, ему не помогает),
// pAtkDown — защита (моб бьёт слабее). Curse Poison в справочнике — «Яд», на L2WAP это −12 % P.Atk
const IL_FIX = { 1151: { c: 'Лечение', t: 'HEAL', target: 'SELF', reuse: 2000, mp: 0, pow: 0,
  L: 'Лечение · на себя · L2WAP: в бою по живой цели, HP = уровень×3 + ранг×5, MP 0, откат ≈2 с' },
  1083: { st: 'mDefDown', L: 'Дебафф · L2WAP: M.Def цели −10 %' },
  1222: { st: 'mDefDown', st2: 'pAtkDown', L: 'Дебафф · L2WAP: P.Atk цели −12 %, M.Def −10 %' },
  1164: { st: 'pAtkDown', dur: 10, L: 'Дебафф · L2WAP: P.Atk моба −20 % на 10 с, шанс 80 %' },
  1168: { c: 'Дебафф', t: 'DEBUFF', st: 'pAtkDown', dur: 15, L: 'Дебафф · L2WAP: P.Atk цели −12 %' },
  // 9.2 (игрок 11.10, скрин окна кота + лог 12.10 02:44:49 «Blessing of Queen застосовано до героя та активного слуги»): слот «Summon Feline Queen»
  // (l2_1331) на L2WAP больше не призывает королеву — это бафф кота Blessing of Queen. 9.2.2 (игрок 11.10 21:21, ответ админа): админ переделал
  // бафф — «Фіз. Crit Rate +30% і урон фіз. крита +25%», 20 мин (было +20 % крит-урона, 2 мин). Роль «Баффы кота», ставим всегда, как истёк
  1331: { c: 'Бафф', t: 'BUFF', o: 'ACTIVE', target: 'PET', dur: 1200, reuse: 2000, mp: 87, eff: 'Buff', L: 'Бафф кота · L2WAP: Blessing of Queen — герою и слуге, шанс физ. крита +30 % и урон крита +25 % на 20 мин · MP 87' } };
const ilNum = v => Array.isArray(v) ? v[0] : v;
// ---------- база предметов Interlude (items-il.json, 9208 шт.) — грузится один раз, когда нужна ----------
let ITEMS = null, ITEM_BY_NAME = Object.create(null), itemsLoading = null, itemsRetryAt = 0;
async function itemsDb() {
  if (ITEMS) return ITEMS;
  if (itemsLoading) return itemsLoading; // несколько вызовов — один запрос и один разбор базы
  if (Date.now() < itemsRetryAt) return null;
  itemsLoading = (async () => {
    try {
      const r = await fetch(chrome.runtime.getURL('items-il.json'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('неверный формат справочника');
      const names = Object.create(null);
      for (const [id, e] of Object.entries(data)) {
        if (typeof e?.n !== 'string') continue;
        const k = e.n.toLowerCase();
        if (!(k in names)) names[k] = +id;
      }
      ITEM_BY_NAME = names; ITEMS = data;
      return ITEMS;
    } catch (e) {
      // Не закреплять {} навсегда: ошибка чтения расширения может быть временной.
      itemsRetryAt = Date.now() + 30000;
      console.warn(TAG, 'справочник предметов: повторная попытка через 30 с', e);
      return null;
    } finally { itemsLoading = null; }
  })();
  return itemsLoading;
}
function itemOf(x) {                             // по ID или английскому имени; null, если база ещё не загружена
  if (!ITEMS) return null;
  const id = typeof x === 'number' ? x : ITEM_BY_NAME[String(x || '').trim().toLowerCase()];
  return id != null && ITEMS[id] ? { id, ...ITEMS[id] } : null;
}
// баффы с общим слотом эффекта (все тотемы — «possession») стирают друг друга: держим один, самый полезный для урона
// v5.3: «Важные баффы» без условия по HP (War Cry, Battle Roar…) — в бою с РБ и чемпионами (или в каждом бою,
// если снята галочка «только РБ/чемпионы»); с условием HP ≤ 30 % (Frenzy, Guts, Zealot) — аварийный блок боя
let BUFF_CTX = null;
function buffList(...args) { return L2V7Modules.buffs.buffList(...args); }
// ---------- тотемы (Bear, Ogre, Bison, Puma…): одновременно висит только один, новый сбрасывает прежний ----------
// Раньше выбирался один — по оценке справочника L2J (Bison 71, Bear 26, Ogre 0), а на l2wap польза другая.
// Теперь бот сам меряет скорость убийства с каждым тотемом на одних и тех же мобах и ставит лучший;
// пока лучший на откате и тотема нет — ставит следующий по замеру (если он лучше боя без тотема).
const TOTEM_RE = /totem|spirit of (bear|wolf|ogre|puma|bison|rabbit|hawk)|тотем/i;
const TOTEM_MIN = 15;                             // боёв на замер одного тотема (бой ≈2–3 с, тотем висит 120 с)
const isTotem = b => { const il = ilOf(b); return il?.st === 'possession' || (!il?.st && TOTEM_RE.test(cleanTitle(b.title))); };
function totemSlots(...args) { return L2V7Modules.buffs.totemSlots(...args); }
function totemActive(...args) { return L2V7Modules.buffs.totemActive(...args); }
function totemPick(...args) { return L2V7Modules.buffs.totemPick(...args); }
// итог боя: тотем, висевший ≥70 % боя (или «—» без тотема) → скорость убийства этого моба с ним.
// Оценка тотема — его ДПС к среднему по тотемам на тех же мобах (разные мобы не смешиваются)
async function totemNote(...args) { return L2V7Modules.buffs.totemNote(...args); }
const cleanTitle = t => { const c = (t || '').split(/\s+[—–-]\s+|\s*\(/)[0].trim();
  return /^#\d+$/.test(c) && /заряд|shot/i.test(t) ? 'Заряд душі' : c; };   // «#1463 — заряд душі…» (соски выкл.)     // «Зілля мани (мала банка) — …» → «Зілля мани»
function slotKind(b) {
  const src = b.querySelector('img')?.getAttribute('src') || '';
  const cdKey = b.querySelector('[data-slot-cd]')?.dataset.slotCd || '';
  if (/l2-hotbar-shot--|shot/i.test(b.className) || /заряд|soulshot|spiritshot/i.test(b.title)) return 'заряды';
  if (cdKey === 'attack') return 'атака';
  if (qty(b) != null) return 'предмет';                      // расходник со счётчиком (банки)
  if (cdKey || /\/skills\//i.test(src)) return 'скилл';
  return 'снаряжение';                                        // оружие/броня: смена экипировки — бот не нажимает
}
const isEquip = b => !!b && slotKind(b) === 'снаряжение';
function panelInventory() {
  return [...document.querySelectorAll(SLOT)].map(b => ({
    idx: +b.dataset.slotIdx + 1, title: b.title || '', name: cleanTitle(b.title), kind: slotKind(b),
    img: (b.querySelector('img')?.getAttribute('src') || '').split('/').pop(),
    cdKey: b.querySelector('[data-slot-cd]')?.dataset.slotCd || '', qty: qty(b),
    row: +(b.closest('[data-hotbar-row]')?.dataset.hotbarRow || 1)
  }));
}
const BUFF_RE = /\s+на\s+(\d+)\s*с(?![а-яa-z])/i;               // «Totem Spirit Bear на 120 с.»
// урон из строк лога: «Iron Punch ⏎ 993» / «Ты нанёс [ моб ] 97 урона»
const splashDmg = lines => [...lines.join(' ⏎ ').matchAll(/поруч[^⏎]*?[−-]\s*(\d+)/gi)].reduce((a, m) => a + +m[1], 0);
function dmgFromLog(name, lines, allowAlt = true) {
  if (/^атака$/i.test(name)) {
    // «Атака» кастетами — 1–3 удара за нажатие (в логе 2 строки «Ты нанёс … N урона»): считаем все (до v4.16 — только первый)
    const hits = lines.filter(l => /нан[её]с/i.test(l) && !/поруч|рядом/i.test(l)).map(l => +((l.match(/(\d+)\s*урон/i) || [])[1] || 0));
    return hits.reduce((a, b) => a + b, 0) + splashDmg(lines);   // главная цель + задетые рядом
  }
  // строка этого заклинания: сначала та, что НАЧИНАЕТСЯ с его имени («Полум’я 618», а не «Удар полум’я 610»), потом любая с именем
  const ln = logName(name), eng = apos(name);
  const has = (l, n) => !BUFF_RE.test(l) && apos(l).includes(n);
  let i = lines.findIndex(l => !BUFF_RE.test(l) && apos(l).startsWith(ln));
  if (i < 0) i = lines.findIndex(l => !BUFF_RE.test(l) && apos(l).startsWith(eng));
  if (i < 0) i = lines.findIndex(l => has(l, ln) || has(l, eng));
  if (i < 0) {                                   // строка «<название на языке игры><урон>» — первая новая такая
    if (!allowAlt) return 0;
    const alt = lines.find(l => /^[^\d⏎]{3,40}?\s*\d{2,}$/.test(l) && !/нан[её]с|ударив|промах|HP|MP|EXP|SP|аден|×|Побед|Бой начат|енергі|энерги|Квест|осталось|Слуга|Servitor/i.test(l));
    if (!alt) return 0;
    // запоминаем, как игра пишет это заклинание (только в «чистом» окне — одно нажатие), дальше узнаём и в цепочке
    const nm = apos(alt.replace(/\s*(?:·\s*КРИТ\s*)?\d{2,}$/i, '').trim());
    // 7.1.30: имя, которое уже принадлежит другому заклинанию («Полум’я» = Blaze), — это чужая строка: урон не наш, алиас не учим
    // (в базе было «Surrender to Fire → Полум’я»: дебафф и Blaze в одном окне)
    if (Object.entries({ ...NAME_ALIAS, ...(rt.logAlias || {}) }).some(([k, v]) => apos(v) === nm && k !== (name || '').toLowerCase())) return 0;
    if (nm.length >= 3 && !Object.values(rt.logAlias || {}).includes(nm)) setRt({ logAlias: { ...(rt.logAlias || {}), [(name || '').toLowerCase()]: nm } });
    return +alt.match(/(\d{2,})$/)[1];
  }
  // значение урона — в конце строки: «Hurricane Assault: сила 535, −2 енергії сили3247» → 3247 (не «сила 535»)
  const li = apos(lines[i]), at = li.indexOf(ln) >= 0 ? li.indexOf(ln) + ln.length : li.indexOf(eng) >= 0 ? li.indexOf(eng) + eng.length : 0;
  const tail = lines[i].slice(at);
  const clean = tail.replace(/сил[аи]\s*\d+|[−-]\s*\d+\s*(?:енергі|энерги)[а-яіїє]*(?:\s+сил[аиіу]?)?/gi, ' ');
  const end = clean.match(/(\d{2,})\D{0,12}$/);
  if (end) return +end[1];
  const m = (lines[i + 1] || '').match(/^\D{0,3}(\d{2,})/);
  return m ? +m[1] : 0;
}
const cdWatch = new Set();
// урон в ЭТОМ бою: против моба +30 ур. атака даёт 1–3 вместо 900, скиллы — вдвое меньше. Средние «за всё время»
// тут врут, поэтому план боя смотрит сначала на замеры текущего боя (от 2 ударов)
let fightLearn = { id: '', d: {} };
function fightNote(key, dmg) {
  const id = location.search;
  if (fightLearn.id !== id) fightLearn = { id, d: {} };
  (fightLearn.d[key] ||= []).push(dmg);
}
function fightDmg(key) {
  if (fightLearn.id !== location.search) return null;
  const a = fightLearn.d[key];
  return a && a.length >= 2 ? a.reduce((x, y) => x + y, 0) / a.length : null;
}
// КД скилла — по последним замерам (медиана), со сверкой по справочнику Interlude: выброс не портит расчёт
async function learnCd(key, name, sec, b) {
  const il = b && ilOf(b), ref = il?.reuse ? il.reuse / 1000 : 0;
  // 8.0.3 (лог 11.10: Blaze навсегда «КД 3,1 с», у Vampiric Touch откат не замерялся): под баффами откат бывает втрое короче справочного —
  // короче отбрасываем только явную помеху (< 0,4 с)
  if (ref && (sec > ref * 1.6 + 1 || sec < 0.4)) return;          // заметно дольше справочного — помеха, не КД
  if (!ref && slotKind(b) === 'атака' && sec > 4) return;         // атака: ход ≈2 с, дольше — замер через смену боя
  const p = { ...(rt.skills?.[key] || {}) };
  const S = [...(p.cdS || []), Math.round(sec * 10) / 10].slice(-7);
  const med = [...S].sort((x, y) => x - y)[S.length >> 1];
  p.cdS = S; p.cd = med;
  await setRt({ skills: { ...(rt.skills || {}), [key]: { ...p, name } } });
}
let lastObserve = 0;                             // время последнего нажатия слота (для честного «запасного» урона)
function observeSlot(b, src) {
  if (!isBattle() || !b) return;
  if (slotKind(b) === 'предмет' && /зілля|зелье|potion|elixir|еліксир|эликсир/i.test(b.title || '')) potWatch(b).catch(() => {});
  const name = cleanTitle(b.title), key = name.toLowerCase();
  if (!key) return;
  const before = { mob: mobHp(), me: meHp(), mp: meMp(), arr: logLines(), t: Date.now(), notice: noticeText() };
  lastObserve = before.t;
  // реальный КД: от клика до отката слота. Замер, «переехавший» через победу/смену страницы, не считаем
  // (так атака получала «КД 7,4 с», и бот стоял, думая, что атака на откате).
  if (slotCd(b) && !cdWatch.has(key)) {
    cdWatch.add(key);
    (async () => {
      const t0 = Date.now(), href = location.href;
      let went = false, spoiled = false;
      while (Date.now() - t0 < 120000) {
        if (!b.isConnected || location.href !== href || victory() || defeat()) { spoiled = true; break; }
        const busy = !uiReady(b);
        if (busy) went = true; else if (went) break;
        if (!went && Date.now() - t0 > 1500) break;            // так и не ушёл в КД
        await sleep(100);
      }
      cdWatch.delete(key);
      if (went && !spoiled) await learnCd(key, name, (Date.now() - t0) / 1000, b);
    })();
  }
  setTimeout(async () => {
    const mob = mobHp(), me = meHp(), mp = meMp();
    const added = newLines(before.arr, logLines());   // v5.6: с учётом повторов (такой же урон / тот же бафф ещё раз — раньше терялись)
    const txt = added.join(' ⏎ ');
    const bl = added.find(l => l.toLowerCase().includes(key) && BUFF_RE.test(l));   // бафф — только строка с именем этого скилла
    const buff = bl ? bl.match(BUFF_RE) : null;
    // 7.1.16-fix: обучение не должно смешивать чужие действия. Лог 09.10 23:41: «Summon Kat» получил 564 урона Vampiric Touch,
    // Energy Bolt — расход MP призыва. В окне 0,9 с у мага успевает уйти следующее заклинание, а кот бьёт сам.
    // Призыв/поддержка — без урона; «чужие» строки и падение HP моба — только если в окне не было других нажатий и ударов слуги
    const solo = lastObserve === before.t, petHit = added.some(l => /^Слуга\s*\[|Servitor\s*\[/i.test(l));
    const support = /^(?:(?:mass )?summon|servitor|transfer pain|heal\b|battle heal|cubic)/i.test(name) || ['Призыв', 'Дебафф', 'Бафф', 'Лечение'].includes(ilOf(b)?.c);
    let dmg = buff || support || isChargeName(name) || slotKind(b) === 'предмет' ? 0 : dmgFromLog(name, added, solo);
    // 9.2: ответ сервера на этот ход уже разобран анализатором боя — его цифры точные (окно 0,9 с захватывает соседние ходы:
    // лог 11.10 00:49:23 «Blaze: урон 3062 · HP +420» — это банка; 09.10 «Summon Kat» получил урон Vampiric Touch)
    const ex = L2V7Modules.fightlab?.turnFor(key, before.t);
    if (ex && !buff && !support && slotKind(b) !== 'предмет') dmg = ex.own;
    // запасной способ — падение HP моба, только если в окне не было других нажатий
    if (!dmg && !buff && !support && solo && !petHit && before.mob && mob && before.mob.cur > mob.cur) dmg = before.mob.cur - mob.cur;
    // мусорное число в логе («Force Burst: сила 1713488» при 2580 HP у моба) — урон не может быть больше ~1,5 HP моба:
    // берём реально снятые HP (v4.23)
    // v4.27: только явный мусор (>3× HP моба и >100 тыс.) — добивающий удар 4620 по мобу с 2388 HP настоящий
    if (dmg > 100000 && before.mob?.max && dmg > before.mob.max * 3) dmg = Math.max(0, before.mob.cur - (mob?.cur ?? before.mob.cur));
    const mpd = ex && ex.mpd != null ? ex.mpd : before.mp && mp ? before.mp.cur - mp.cur : 0;
    const hpd = ex ? ex.selfHeal : before.me && me ? me.cur - before.me.cur : 0;
    const stun = /оглуш|приголомш|stun/i.test(txt);
    const p = { name, uses: 0, usesU: 0, dmg: 0, dmgN: 0, mp: 0, mpN: 0, heal: 0, mpGain: 0, buffSec: 0, stun: 0,
                ...(rt.skills?.[key] || {}) };
    p.uses++; if (src === 'U') p.usesU++;
    if (dmg > 0) { p.dmg += dmg; p.dmgN++; }
    // 7.2.1 (лог 10.10 21:08): Sprite's Staff (B) вместо Demon's Staff (C) — Blaze бьёт ≈1800, а среднее из 5 373 старых замеров
    // показывало ≈900 (по нему считаются добивание, окупаемость дебаффов, ДПС-план). Среднее — по последним ≈40–60 замерам
    if (p.dmgN > 60) { p.dmg = Math.round(p.dmg / p.dmgN * 40); p.dmgN = 40; }
    if (dmg > 0 && slotKind(b) === 'скилл' && BUFF_CTX) try { L2V7Modules.combat.spellSample(BUFF_CTX, key, dmg); } catch (e) {}   // 7.2.1: выгода дебаффов
    if (slotKind(b) === 'атака' ? !/перезаряд/i.test(noticeText()) : dmg > 0) fightNote(key, dmg);   // промахи атаки тоже считаем
    // массовые удары: урон по соседям («… поруч: Моб −N») — отдельно, для выбора удара, когда рядом 2–3 моба
    if (slotKind(b) === 'скилл' && dmg > 0) { const spl = splashDmg(added); p.spl = (p.spl || 0) + spl; p.splN = (p.splN || 0) + 1; if (spl) p.aoe = 1; }
    if ((solo || ex) && mpd > 0 && mpd < 200 && !/Зілля\s*\+\d+\s*MP|Зелье\s*\+\d+\s*MP/i.test(txt)) { p.mp += mpd; p.mpN++; }
    if (mpd < -15) p.mpGain = Math.max(p.mpGain, -mpd);
    if (hpd > 15) p.heal = Math.max(p.heal, hpd);
    if (buff) p.buffSec = +buff[1];
    const pulse = txt.match(/імпульсами по\s*(\d+)\s*HP\s*кожні\s*(\d+)|импульсами по\s*(\d+)\s*HP\s*каждые\s*(\d+)/i);
    if (pulse) setRt({ potInfo: { name, pulse: +(pulse[1] || pulse[3]), every: +(pulse[2] || pulse[4]) } });
    if (stun) p.stun++;
    const unav = UNAVAIL.test(noticeText()) && noticeText() !== before.notice;
    if (unav) { p.unavail = (p.unavail || 0) + 1; p.unavailT = Date.now(); }
    p.kind = slotKind(b); p.img = (b.querySelector('img')?.getAttribute('src') || '').split('/').pop();
    p.last = txt.slice(0, 160);
    await setRt({ skills: { ...(rt.skills || {}), [key]: p } });
    rec(src, 'скилл', `«${name}»: урон ${dmg} · MP ${mpd > 0 ? '−' + mpd : mpd < 0 ? '+' + -mpd : 0}`
      + `${hpd > 15 ? ' · HP +' + hpd : ''}${buff ? ' · бафф ' + buff[1] + ' с' : ''}${stun ? ' · стан' : ''}`
      + `${p.cd ? ' · КД ' + p.cd + ' с' : ''}${unav ? ' · ⚠ недоступен' : ''}`, { added: added.slice(0, 8) });
  }, 900);
}
// роли по панели и профилям; баффы — только те, что использует сам игрок (если такие есть)
function suggestRoles(...args) { return L2V7Modules.equipment.suggestRoles(...args); }
// основное оружие: выбранное по инвентарю «в класс» (если оно на панели) → любое на панели нужного вида → старое правило (древковое)
function weaponMainSuggest(...args) { return L2V7Modules.equipment.weaponMainSuggest(...args); }
// автоназначение: заполнить только пустые роли и роли, чьё название не найдено на панели
async function autoRoles(...args) { return L2V7Modules.equipment.autoRoles(...args); }

// ---------- карта: точные элементы map.html (снимок 2026-10-07) ----------
// #map-mob-list[data-l2-around-sig]  = «398|id:дист,id:дист,…|p4|lv35|qКвестовая цель,…|…» — ВСЕ живые мобы по дистанции
// #map-mob-markers[data-l2-marker-sig] = «498|id:тип,…» — тип спавна: passive/aggressive/neutral/champion/raid
// #map-mob-list a.l2-map-mob-link[href=/battle.html?spawnId=…] — строки текущей страницы (по 15)
function hasMark(text, marks) { const t = text.toLowerCase(); return names(marks).some(w => t.includes(w)); }
// 7.2 (лог 10.10 20:21–20:29): обычный моб «Hatar Ratman Boss · ур. 48» считался рейд-боссом по слову «boss» в имени — бот 45 раз
// уходил из боя на карту и ни разу его не убил. Метки ищем только в приписках ПОСЛЕ имени («Карте · ур. 49 · рейд-босс», «… · чемпион»);
// настоящий РБ и так узнаётся по spawnId l2dop_rb_* и метке карты --raid
const markTail = text => String(text || '').split(/\s*[·•]\s*/).slice(1).join(' · ');
const isChamp = text => hasMark(markTail(text), cfg.champMark);
const isBoss  = text => hasMark(markTail(text), cfg.bossMark);
const PAGE_SIZE = 15;
const LV_RE = /^([^\p{L}\d]*)(.+?)\s*[·•]\s*ур\.?\s*(\d+)/iu;
const isRaidId = id => /^l2dop_(?:rb|eg)_/i.test(id);   // 7.1.30: + охрана эпика (l2dop_eg_…) — не цель обычного фарма

function pageItems(...args) { return L2V7Modules.mobfarm.pageItems(...args); }
function pagerInfo(...args) { return L2V7Modules.mobfarm.pagerInfo(...args); }
const pageKey = (...args) => L2V7Modules.mobfarm.pageKey(...args);
function aroundSig(...args) { return L2V7Modules.mobfarm.aroundSig(...args); }
function markerTypes(...args) { return L2V7Modules.mobfarm.markerTypes(...args); }
// v5.6 (лог 09.10 13:27–14:35): глава «★ Champions 0/6» час стояла — чемпионов бот не видел: игра убрала тип моба из меток карты
// (data-l2-marker-sig теперь только «id:raid»). Полный список с типами приходит ответом /game/map/spawns — берём его
let NET_SPAWNS = null;
async function netSpawns(...args) { return L2V7Modules.mobfarm.netSpawns(...args); }

// ---------- приоритеты и задачи поиска ----------
function parseRules(...args) { return L2V7Modules.mobfarm.parseRules(...args); }
// чемпионы в приоритете: по условиям главы (пока «★ Чемпионы» не выполнены), иначе — по галочке «Искать чемпионов»;
// если в главе есть невыполненные мобы-цели, а чемпионы уже закрыты — чемпионы не отвлекают
function champRuleOn(...args) { return L2V7Modules.mobfarm.champRuleOn(...args); }
// эффективность: опыт в минуту за «цепочку» и за «поиск по карте» (включая время на карту и листание)
function chainBetter(...args) { return L2V7Modules.mobfarm.chainBetter(...args); }
async function trackEfficiency(exp, ctx) {
  // 8.0: вызывается без ожидания — способ прихода к этому мобу (цепочка/карта) берём сразу, пока nextFight не записал новый
  const now = Date.now(), dt = rt.lastWinT ? (now - rt.lastWinT) / 1000 : 0, via0 = rt.via;
  setRt({ lastWinT: now });
  const pct = expPctGain();                       // прирост полоски опыта, % (с учётом нового уровня)
  if (!dt || dt > 180 || !exp || ctx?.rb) return;      // первая победа сессии, долгий перерыв или РБ — не считаем
  // 8.0 (аудит фарма B1): ценность вида моба (EXP/с) для выбора цели на карте — без ожидания записи. Приход через карту дольше
  // цепочки на одну и ту же величину для любого моба — вычитаем её, чтобы виды, добытые цепочкой и картой, сравнивались честно
  { const E0 = rt.eff || {}, mapX = via0 === 'chain' ? 0 : Math.max(0, (E0.map?.sec || 0) - (E0.chain?.sec || 0));
    try { L2V7Modules.mobfarm.mobValNote(ctx?.name, !!ctx?.champ, exp, Math.max(dt * 0.5, dt - mapX))?.catch?.(e => console.warn(TAG, 'ценность моба', e)); } catch (e) { console.warn(TAG, 'ценность моба', e); } }
  await zoneTrack(exp, dt, pct);
  const via = via0 === 'chain' ? 'chain' : 'map';
  const E = { ...(rt.eff || {}) }, e = E[via] || { n: 0, rate: 0 };
  const rate = exp / dt * 60, k = e.n < 20 ? 1 / (e.n + 1) : 0.05;
  E[via] = { n: e.n + 1, rate: Math.round(e.rate ? e.rate * (1 - k) + rate * k : rate), sec: +((e.sec || dt) * (1 - k) + dt * k).toFixed(1) };
  await setRt({ eff: E });
  if (E.chain?.n === 5 || E.map?.n === 5) rec('B', 'эффективность', `цепочка ${E.chain?.rate || '?'} EXP/мин (${E.chain?.sec || '?'} с/моб) · карта ${E.map?.rate || '?'} EXP/мин (${E.map?.sec || '?'} с/моб)`);
}
// ---------- локации для кача: где герой сейчас, EXP/ч и %/ч по каждой, рекомендации ----------
// Каталог зон — со страницы «Телепорт» (Окрестности городов: имя, цена, уровни мобов «60-70»).
// Текущая зона — по нажатию «Телепорт» (игроком или ботом) и проверяется по составу мобов на карте.
// Статистика: rt.zoneStat[id][уровень героя] = { n, exp, sec, pct }.
function expPctGain() {
  const p = parseFloat(($q('#l2-hud-exp-pct')?.textContent || '').replace(',', '.')), l = heroLvl();
  if (!(p >= 0) || !l) return null;
  const prev = rt.expMark;
  rt.expMark = { p, l };
  if (!tabIdle) setRt({ expMark: rt.expMark }).catch(() => {});
  if (!prev) return null;
  const d = l === prev.l ? p - prev.p : l === prev.l + 1 ? 100 - prev.p + p : null;
  return d != null && d >= 0 && d < 60 ? d : null;
}
function zoneRows(...args) { return L2V7Modules.navigation.zoneRows(...args); }
const isTeleport = (...args) => L2V7Modules.navigation.isTeleport(...args);
// список городов «Телепорта» дорисовывается скриптом страницы — ждём, пока число городов перестанет меняться
async function tpCitiesReady(...args) { return L2V7Modules.navigation.tpCitiesReady(...args); }
async function zoneCatalogScan(...args) { return L2V7Modules.navigation.zoneCatalogScan(...args); }
// нажали «Телепорт» в Окрестности (сам игрок, бот или кнопка квеста) — запоминаем, куда летим
addEventListener('click', e => {
  const b = e.target.closest?.('[data-teleport-id], [data-quest-teleport-id]');
  if (!b) return;
  const id = b.dataset.teleportId || b.dataset.questTeleportId, fRow = !isTeleport() && rt.forumTp?.[id];
  if (fRow && !rt.zoneCat?.[id]) setRt({ zoneCat: { ...(rt.zoneCat || {}), [id]: { name: fRow.text.split(/[·(|\[]/)[0].trim().slice(0, 40) || id, url: fRow.url, price: fRow.cost } } });
  const cityLbl = b.closest('.l2-teleport-miru-city-row')?.querySelector('.l2-teleport-miru-city-label')?.textContent.trim();
  const row = zoneRows()[id] || (cityLbl && { ...(rt.zoneCat?.[id] || {}), name: 'Окрестности: ' + cityLbl, city: id, town: true });
  if (row) setRt({ zoneCat: { ...(rt.zoneCat || {}), [id]: row } });
  setRt({ zonePend: { id, t: Date.now() } });
  setTimeout(() => {                             // «Недостаточно адени для телепорту» — никуда не улетели
    if (/недостат|not enough/i.test(document.body.innerText.slice(-4000)) && isTeleport()) setRt({ zonePend: null });
  }, 1500);
}, true);
function zoneHere(...args) { return L2V7Modules.navigation.zoneHere(...args); }
// 8.0.3: разовая чистка испорченной «Pavel Ruins» (once pavelZone803; r — память, out — патч миграций)
function pavelFix(r, out) {
  const ZS = out.zoneStat || r.zoneStat, ZM = out.zoneMobs || r.zoneMobs, zs = ZS?.pavel_ruins, zm = ZM?.pavel_ruins;
  if (zs && Object.keys(zs).some(l => +l >= 55)) out.zoneStat = { ...ZS, pavel_ruins: Object.fromEntries(Object.entries(zs).filter(([l]) => +l < 55)) };
  if (Array.isArray(zm)) {
    const lv = {}; for (const v of Object.values(r.spawns || {})) if (v && v[1]) lv[v[0]] = Math.max(lv[v[0]] || 0, v[1]);
    const keep = zm.filter(n => !(lv[n] >= 60));
    if (keep.length !== zm.length) out.zoneMobs = { ...ZM, pavel_ruins: keep };
  }
  if (r.zone === 'pavel_ruins') out.zone = null;
  return out;
}
// каталог зон неполный (меньше 5 зон с уровнями — как после сбоя скана v4.56) — считаем непрочитанным
const zoneCatThin = (...args) => L2V7Modules.navigation.zoneCatThin(...args);   // только зоны из «Телепорта»
const zoneName = (...args) => L2V7Modules.navigation.zoneName(...args);
async function zoneTrack(...args) { return L2V7Modules.navigation.zoneTrack(...args); }
// оценка зоны для героя уровня L: EXP/ч и %/ч (по своему уровню; если нет — по соседним ±2, с поправкой)
function zoneRate(...args) { return L2V7Modules.navigation.zoneRate(...args); }
// куда лететь: не изученная подходящая зона → проба; иначе лучшая по EXP/ч (если заметно лучше текущей)
// v4.44: на карте нет ни одного моба в окне уровня (герой −lvlBelow … +lvlAbove) — летим в зону своего уровня (от героя до +10)
async function zoneForLevel(...args) { return L2V7Modules.navigation.zoneForLevel(...args); }
function zonePick(...args) { return L2V7Modules.navigation.zonePick(...args); }
async function zoneGoStep(...args) { return L2V7Modules.navigation.zoneGoStep(...args); }

// добыча: «Animal Bone×3», «Випала мисливська шкура +1», «Випав кубок +1»
const LOOT_RE = /^(.+?)\s*×\s*(\d+)$/, SPECIAL_RE = /^Випа\S*\s+(.+?)\s*\+\s*(\d+)$/i;
// ---------- квесты на ресурсы: «Имя = N» в меню (как профессия: собрать N предметов) ----------
// Прогресс = сколько в сумке на последней проверке инвентаря + сколько выпало после неё.
function resQuests(...args) { return L2V7Modules.loot.resQuests(...args); }
function resHave(...args) { return L2V7Modules.loot.resHave(...args); }
// статистика добычи: предмет → { n: штук, d: выпадений, k: { моб: штук } }; бои по видам мобов — rt.mobKills
async function trackLoot(...args) { return L2V7Modules.loot.trackLoot(...args); }
// сумка: запоминаем количество предметов квестов на ресурсы (вызывается при любом чтении инвентаря)
async function noteBag(cnt) {
  // v4.30: вся сумка (имя → штук) сохраняется всегда — меню показывает итог пересчёта, даже если «Квесты на ресурсы» пусты
  // (раньше без строк «Имя = N» пересчёт ничего не сохранял и кнопка выглядела мёртвой)
  const all = {};                                 // v5.2: «#1061» → «Healing Potion» по базе предметов
  for (const [k, v] of Object.entries(cnt)) { if (!k.startsWith('n:')) continue; let n = k.slice(2); const id = n.match(/^#(\d+)$/)?.[1]; if (id && ITEMS?.[id]?.n) n = ITEMS[id].n; all[n] = (all[n] || 0) + v; if (Object.keys(all).length >= 400) break; }
  const patch = { bagAll: { t: Date.now(), n: all } };
  const rq = resQuests();
  if (rq.length) {
    const B = { ...(rt.bagSeen || {}) }, RG = { ...(rt.resGot || {}) };
    for (const r of rq) {
      const n = Object.entries(all).reduce((a, [k, v]) => a + (k.toLowerCase() === r.key ? v : 0), 0);
      B[r.key] = { n, t: Date.now() }; delete RG[r.key];
    }
    Object.assign(patch, { bagSeen: B, resGot: RG });
    rec('B', 'квест', `📦 в сумке: ${rq.map(r => `${r.name} ${B[r.key].n}/${r.need}`).join(' · ')}`);
  } else rec('B', 'сумка', `пересчитана: ${Object.keys(all).length} видов предметов`);
  await setRt(patch);
}
// 8.0 (аудит фарма; настройки игрока 10.10 22:10–23:30: «каждые 10 боёв», «Искать чемпионов» выкл.): правило [квест] в приоритете
// есть всегда («[квест] [чемп] [все]»), поэтому карта проверялась раз в 10 боёв и без единой ★ цели на локации — по аудиту ≈20 походов
// на 201 бой (≈7 % времени впустую).
// Теперь плановая проверка — только если есть зачем: ★ цель квеста на ЭТОЙ локации (та же проверка, что «за ★ целью» в nextFight),
// точка фарма ресурса/рецепта, кампания, охота на чемпионов (правило [чемп] при «Искать чемпионов») или правило с именем моба этой локации
const questHere = (...args) => L2V7Modules.mobfarm.questHere(...args);
const searchActive = rules => campActive() || campMobOpen().length > 0 || campChampDue() || farmMapOn()
  || rules.some(x => !x.neg && ((x.quest && questHere()) || x.champ || (!!x.name && L2V7Modules.mobfarm.nameHere(x.name))));
const rbDue = (...args) => L2V7Modules.raid.rbDue(...args);   // тур: решение «фармлю здесь» держится 3 мин — между проверками цепочка
// проверка карты каждые N боёв; пока глава ждёт чемпионов — не реже чем раз в 5 боёв (чемпионы появляются и пропадают)
// v4.30: ищем чемпионов (правило «Чемп» в приоритете) — не реже раза в 20 боёв: при «раз в 100» бот их почти не заставал
const CHAMP_EVERY = 20;
const champHunt = () => champRuleOn() && parseRules().some(x => x.champ && !x.neg);
// 7.1.31 (просьба игрока: «поставил 99999, а он всё равно проверяет карту»): 0 — карту по плану НЕ проверять никогда, только цепочка
// «Охотиться дальше» (было «0 = каждый бой»). Выключает и «не реже раза в 20 боёв» ради чемпионов, и «горячую» карту, и уход за ★ целью.
// Остаётся только необходимое: цели главы при включённой «Кампании», РБ-режимы, нет кнопки «Охотиться дальше», старт с карты
const mapOff = () => (+cfg.deepEvery || 0) <= 0;
const campChampDue = () => campActive() && campChampOpen();
// 7.2 (игрок: «активная цель „ресурс“ или „рецепт“ сама включает карту, даже при 0»): на точке фарма мобов-источников бот выбирает
// с карты — раз в 5 боёв при «0», не реже раза в 10 при большем числе (99999 — иначе фарм ресурса бьёт кого попало). Если цепочка
// сама приносит источники в ≥ 50 % боёв — карта откладывается (chainCarries), как для ★ целей
const FARM_EVERY = 5;
// 9.2.3 (игрок 12.10: «на спойлере пересматривает карту раз в несколько боёв, вместо того чтобы бить следующего»): цель Маммона
// «добываю Mithril Ore» включает карту раз в 10 боёв ради источника (Guardian Basilisk), а он «не по зубам» (9.2.2: на карте не выбирается) —
// карта ходила впустую. Все источники цели на этой точке «не по зубам» → карта по обычному правилу (цепочка)
const hardNow = n => { const h = rt.hardMobs?.[String(n || '').toLowerCase()]; return !!h && Date.now() - (h.t || 0) < 7200000; };
const farmMapOn = () => {
  const lg = lootGoal();
  if (!lg || !rt.zone || rt.zone !== lg.zone) return false;
  const names = [...farmRules(), ...recipeRules()].map(x => x.name);
  return !names.length || names.some(n => !hardNow(n));
};
const deepN = () => campChampDue() ? Math.min(+cfg.deepEvery || 5, 5)
  : farmMapOn() ? Math.min(+cfg.deepEvery > 0 ? +cfg.deepEvery : FARM_EVERY, FARM_EVERY * 2)
  : mapOff() ? Infinity : champHunt() ? Math.min(cfg.deepEvery, CHAMP_EVERY) : cfg.deepEvery;
const mapDue = rules => rbDue() || (campRbOpen().length && (rt.sinceDeep || 0) >= 3) || (searchActive(rules) &&
  (campChampDue() || !mapOff() || farmMapOn()) && (rt.deepHot || rt.sinceDeep >= deepN()));
// цепочка сама приносит цели (★/чемпионы) в ≥ 50 % боёв — плановую проверку карты откладываем (до 3× интервала)
function chainCarries(...args) { return L2V7Modules.mobfarm.chainCarries(...args); }

function ruleMatch(...args) { return L2V7Modules.mobfarm.ruleMatch(...args); }
function rank(...args) { return L2V7Modules.mobfarm.rank(...args); }

// ---------- состояние ----------
// запись состояния: память меняется сразу, в хранилище — пачкой (серия setRt подряд = 1–2 записи, а не 10).
// Своё «эхо» из хранилища не применяем: раньше старое эхо могло откатить свежие изменения в памяти.
const TAB_ID = Math.random().toString(36).slice(2);
// v6: Storage updates are serialized PATCHES in the background, under the
// same epoch-checked lease as character switching. Other keys are preserved.
// A failed write remains queued and is retried after backoff.
const RT_BULKY = ['forumTp', 'rbForum', 'zoneMobs', 'spawns'];
let rtBigWarnT = 0, rtSizeT = 0, rtRetryT = null;
const rtWriter = L2EngineCore.createPatchQueue(
  patch => ipc({ cmd: 'statePatch', patch, src: TAB_ID, epoch: leaseEpoch }),
  () => !tabIdle && !document.prerendering && (!on || (tabOwner && !!leaseEpoch)),
  e => {
    console.warn(TAG, 'запись состояния отложена', e);
    if (!rtRetryT) rtRetryT = setTimeout(() => {
      rtRetryT = null;
      if (!tabIdle && !document.prerendering) rtWriter.recover().catch(() => {});
    }, 3100);
  }
);
// 8.0 (аудит ядра/боя): часть записей в бою больше не ждём (память вкладки обновлена сразу). Чтобы при уходе со страницы
// (location.href, перезагрузка) недописанное не пропало — отправляем остаток очереди сразу, без ожидания ответа
addEventListener('pagehide', () => {
  try {
    const p = rtWriter.peek();
    if (p && Object.keys(p).length && tabOwner && leaseEpoch && !tabIdle) chrome.runtime.sendMessage({ cmd: 'statePatch', patch: p, src: TAB_ID, epoch: leaseEpoch }, () => void chrome.runtime.lastError);
  } catch (e) {}
});
function setRt(p) {
  rt = { ...rt, ...p };
  let patch = { ...p };
  if (Object.keys(p).some(k => RT_BULKY.includes(k)) || Date.now() - rtSizeT > 60000) {
    rtSizeT = Date.now();
    let size = 0; try { size = JSON.stringify(rt).length; } catch (e) {}
    // 7.1.30: до сброса кэшей — срезать устаревшее в растущих без предела словарях (по t: hardMobs 2 ч, hpMin/questSeen/rbSeen 24 ч)
    if (size > 300000) {
      const age = { hardMobs: 2 * 3600000, questSeen: 24 * 3600000, rbSeen: 24 * 3600000, zoneTried: 24 * 3600000, zoneBad: 24 * 3600000 };   // hpMin — не метки времени, не трогаем
      for (const [k, maxAge] of Object.entries(age)) {
        const v = rt[k]; if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        const keep = Object.fromEntries(Object.entries(v).filter(([, x]) => { const t = typeof x === 'number' ? x : x?.t; return !(t > 1e12) || Date.now() - t < maxAge; }));
        if (Object.keys(keep).length !== Object.keys(v).length) { rt = { ...rt, [k]: keep }; patch[k] = keep; try { size -= JSON.stringify(v).length - JSON.stringify(keep).length; } catch (e) {} }
      }
    }
    if (size > 350000) {
      const big = RT_BULKY.map(k => [k, rt[k] ? JSON.stringify(rt[k]).length : 0])
        .filter(x => x[1] > 40000).sort((a, b) => b[1] - a[1]);
      const cleared = [];
      for (const [k, len] of big) {
        if (size <= 350000) break;
        rt = { ...rt, [k]: Array.isArray(rt[k]) ? [] : {} };
        patch[k] = rt[k]; cleared.push(k); size -= len;
      }
      if (Date.now() - rtBigWarnT > 60000) {
        rtBigWarnT = Date.now();
        try { rec('S', 'состояние', `размер ${Math.round(size / 1024)} КБ — сброшены только временные кэши: ${cleared.join(', ') || 'нет'}; статистика сохранена`); } catch (e) {}
      }
    }
  }
  if (tabIdle || document.prerendering) return Promise.resolve({ ok: false, reason: 'inactive' });
  return rtWriter.enqueue(patch);
}
const RECENT = [];                               // v4.47: последние действия — для индикатора
// v5.6: статус с бегущим счётчиком («ждёт 37 с», «HP 512/900») — в журнал только когда меняется смысл (цифры не в счёт),
// в хранилище — не чаще раза в 2,5 с (раньше каждую секунду: весь rt в storage + запись в журнал + чтение всей страницы)
let statusShape = '', statusW = 0;
function setStatus(s) {
  const shape = String(s).replace(/[\d.,]+/g, '#');
  if (s !== rt.status && shape !== statusShape) { statusShape = shape; recBot(s); RECENT.unshift({ t: Date.now(), s }); RECENT.length = Math.min(RECENT.length, 31); }
  if (s !== rt.status && Date.now() - statusW > 2500) { statusW = Date.now(); setRt({ status: s }); }
  else rt = { ...rt, status: s };
  draw();
}
// hard = настоящая остановка (Esc ×2, цель рыбалки выполнена, лимит забросов). В режиме рыбалки любая другая
// «остановка» превращается в паузу с повтором (fishSoft) — рыбалка идёт, пока её не выключат кнопкой (v4.49)
async function halt(msg, hard) {
  console.warn(TAG, 'СТОП:', msg);
  if (fishNow() && !hard && on) return fishSoft(msg);
  // 8.0 (аудит ядра): «список мобов не грузится 15 мин», «клик по мобу 3 раза» и т. п. при частичном простое сервера — не остановка:
  // сервер не отвечает — ждём его. Настоящие остановки (hard: Esc ×2, цель выполнена, ошибка кода) — как раньше
  if (!hard && on && !(await srvUp())) { rec('S', 'сервер', `«${String(msg).slice(0, 80)}» — но сервер игры не отвечает: жду сервер, бота не останавливаю`); netOutage.since = netOutage.since || Date.now(); netOutage.last = Date.now(); return serverWait(); }
  rec('B', 'СТОП', msg);                         // причина остановки — всегда в журнал (раньше была видна только в статусе)
  on = false;
  await chrome.storage.local.set({ on: false, stopMeta: { source: 'content-halt', reason: String(msg).slice(0, 240), t: Date.now() } });
  await setRt({ status: msg });
}
// 8.0.3 (игрок 11.10: «кнопку — убить одного РБ и ждать команды… когда не могу 24/7 смотреть за ботом»): пауза от самого бота —
// как кнопка «⏸ Пауза»: состояние сохранено, «▶ Продолжить» или «🎯 Ещё один РБ» в меню запускают снова
async function pauseBot(msg) {
  rec('B', 'пауза', msg);
  on = false;
  await chrome.storage.local.set({ on: false, paused: { t: Date.now(), why: String(msg).slice(0, 160) }, stopMeta: { source: 'content-pause', reason: String(msg).slice(0, 240), t: Date.now() } });
  await setRt({ status: msg });
}

// ---------- переходы ----------
async function toMap(...args) { return L2V7Modules.navigation.toMap(...args); }

// выход из боя через нижнее меню «Окрестности» — прерывает бой (так выходят из боя с РБ)
async function toOutskirts(...args) { return L2V7Modules.navigation.toOutskirts(...args); }

async function nextFight(...args) { return L2V7Modules.mobfarm.nextFight(...args); }

// ---------- карта ----------
const tags = r => (r.quest ? ' [квест]' : '') + (r.champ ? ' [чемп]' : '');

async function mapReady(...args) { return L2V7Modules.mobfarm.mapReady(...args); }

async function gotoPage(n) {                   // листание кнопками < > (без перезагрузки страницы)
  for (let guard = 0; guard < 40 && on; guard++) {
    const pg = pagerInfo();
    if (!pg) return false;
    n = Math.max(1, Math.min(n, pg.total));
    if (pg.cur === n) return true;
    const btn = $q(pg.cur < n ? '#map-mob-page-next' : '#map-mob-page-prev');
    if (!btn) return false;
    const before = pageKey();
    fire(btn);
    if (!(await waitFor(() => pageKey() !== before && pageItems().length, 4000, 100))) return false;
    await sleep(rnd(120, 300));
  }
  return false;
}

// кэш «спавн → имя, уровень»: точки спавна постоянны, поэтому список локации изучается один раз
async function absorb() {
  const sp = { ...(rt.spawns || {}) };
  let added = 0;
  // ★ в строке списка — квестовая цель (в т.ч. НЕсюжетных квестов: профессия и т.п.). Подпись карты «q…» их
  // не всегда перечисляет — запоминаем сами; пропала ★ у моба с тем же именем — квест по нему закрыт
  const qs = { ...(rt.questSeen || {}) }, now = Date.now();
  let qch = false;
  for (const it of pageItems()) {
    if (!sp[it.id] || sp[it.id][0] !== it.name) added++;
    sp[it.id] = [it.name, it.lvl];
    const k = it.name.toLowerCase();
    if (it.quest) { if (!qs[k]) qch = true; qs[k] = now; }
  }
  // 7.1.30 (лог 14:11:56): строка того же моба БЕЗ ★ (другой спавн) стирала цель — «★ цели: нет», и бот улетел с локации.
  // Снимаем цель, только если на странице этот моб есть и ни одна его строка не со ★, и квест профессии его не требует
  const nq = rt.story?.noblesse, open = [...(rt.profQuest?.open || []), ...(nq?.active && !nq.completed ? (nq.targets || []).filter(t => t.have < t.need).map(t => String(t.name).toLowerCase()) : [])];   // 9.0: и цели квеста Noblesse (story.openNames)
  const gone = items => [...new Set(items.filter(i => !i.champ).map(i => i.name.toLowerCase()))]
    .filter(k => qs[k] && !open.includes(k) && !items.some(i => i.quest && i.name.toLowerCase() === k));
  // 8.0.3 (лог 11.10 11:45:50): «★ цели: нет» записалось за 0,2 с до ответов /game/story-quests/* — игра вешает ★ (--quest-target) на строки
  // позже самого списка, и бот пошёл бить моба 2-го приоритета (Ant Soldier 35), хотя на снимке 11:45:51 ★ Ol Mahum Raider уже был.
  // Снимаем цель, только если ★ нет и через ≥2 с после первого взгляда, и не раньше 5 с после открытия страницы
  let miss = gone(pageItems());
  if (miss.length) {
    await waitX(() => !(miss = gone(pageItems())).length, Math.max(2000, 5000 - performance.now()), 250);
    for (const it of pageItems()) if (it.quest) { const k = it.name.toLowerCase(); if (!qs[k]) qch = true; qs[k] = now; }
    miss = gone(pageItems());
  }
  for (const k of miss) { delete qs[k]; qch = true; }
  for (const [k, t] of Object.entries(qs)) if (now - t > 6 * 3600000) { delete qs[k]; qch = true; }   // старше 6 ч — квест уже не актуален
  if (qch) rec('B', 'квест', `★ цели в списке локации: ${Object.keys(qs).join(', ') || 'нет'}`);
  if (added || qch) await setRt({ spawns: Object.keys(sp).length > 4000 ? {} : sp, questSeen: qs });
  try { await zoneHere(); } catch (e) { console.warn(TAG, 'зона', e); }
  return added;
}

function candidates(...args) { return L2V7Modules.mobfarm.candidates(...args); }

// ---------- рейд-боссы ----------
const heroLvl = () => parseInt(($q('#l2-hud-legacy-lvl')?.textContent || '').replace(/\D/g, ''), 10) || 0;
function raidList(...args) { return L2V7Modules.raid.raidList(...args); }
// база РБ: rt.rbDb[id] = { name, lvl, verdict: 'ok'|'no'|'chip', heroLvl, tries, kills, t, note }
// «не по силам» не пробуем снова, пока не вырос уровень героя (или пока игрок не нажал «перепроверить»)
function rbVerdictBlocks(...args) { return L2V7Modules.raid.rbVerdictBlocks(...args); }
// окно уровня РБ (v4.39, по просьбе игрока): не дальше ±15 ур. от героя, даже если в меню больше (0 в «не ниже» — тоже 15)
const RB_WIN = 15;
const rbLo = (...args) => L2V7Modules.raid.rbLo(...args);
const rbHi = (...args) => L2V7Modules.raid.rbHi(...args);
// v5.6: «Фарм ресурсов» летит к РБ за предметом, который падает только с него — 15 мин бот бьёт этого РБ и без «Фарм РБ»
const farmRbOn = (...args) => L2V7Modules.raid.farmRbOn(...args);
function rbCandidates(...args) { return L2V7Modules.raid.rbCandidates(...args); }
// РБ есть меткой на карте, но нет в списке мобов (или клик по списку не сработал): метка → окно → «В бой»
async function rbPinAttack(...args) { return L2V7Modules.raid.rbPinAttack(...args); }
// ---------- v4.46: оценка РБ ДО боя (из боя уйти нельзя — решать надо заранее) ----------
// Окно РБ на карте: HP (max), P.Atk. Модель из 350 000 симуляций (тактика v4.46, тотем Ogre):
//   удар РБ ≈ k × P.Atk (k учится по боям, старт 0,109 — Карте: P.Atk 1445 → удар ≈157 без Ogre),
//   входящий урон ≈ 0,876 × удар HP/с, вампиризм атаки держит ≈90 HP/с, время ≈ HP РБ / наш ДПС по РБ (≈1150),
//   нужно лечения банками ≈ max(0, входящий − 90) × время. Не лезем, если нужно > 50 % запаса банок
//   или один спецудар (≈4 удара) снимает 40 %+ HP героя.
function rbModalStats(...args) { return L2V7Modules.raid.rbModalStats(...args); }
const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
function rbPreCheck(...args) { return L2V7Modules.raid.rbPreCheck(...args); }
// открыть окно РБ (метка на карте), прочитать характеристики, оценить. → { ok, why } или null (окна нет)
async function rbScout(...args) { return L2V7Modules.raid.rbScout(...args); }
const closeMobModal = (...args) => L2V7Modules.raid.closeMobModal(...args);
// в бой с РБ: оценка → «В бой» из открытого окна (или по списку/метке). 'skip' — не по силам, true — пошёл, false — не вышло
async function rbEngage(...args) { return L2V7Modules.raid.rbEngage(...args); }
async function rbNote(...args) { return L2V7Modules.raid.rbNote(...args); }
// ---------- тур по РБ: телепорт по локациям, поиск РБ по силам, журнал «можем / не можем» ----------
// Откуда берём зоны (по убыванию надёжности):
//  1) РБ, уже виденные в другой зоне (rbSeen/rbDb с zone) — уровень в окне героя, вердикт не «не по силам»;
//  2) записи форума о РБ (rt.rbForum: имя, ур., телепорт) — страница форума разбирается сама, когда её открыть;
//  3) неизученные зоны из «Телепорта», где мобы того же уровня, что и РБ, — разведка (РБ видно на карте зоны).
// Зону, где РБ по силам нет, не посещаем снова 40 мин (РБ мог быть убит — ждём респаун).
function rbTourPick(...args) { return L2V7Modules.raid.rbTourPick(...args); }
// ---------- список РБ игры: Меню → «Рейдовые боссы» (/rb-bosses.html?page=N, 15 на страницу) ----------
// Строка: имя · ур. N · Живой/…, цена телепорта, кнопка «Телепорт» (data-spawn-id = id метки на карте),
// подсказка «Недоступно: Raid Boss нижче дозволеного рівня» — игра сама говорит, кого бить нельзя.
const isRbPage = (...args) => L2V7Modules.raid.isRbPage(...args);
// v5.6: номер страницы — по индикатору «5 / 14 (197)» (по снимкам совпадает с адресом, но адрес после листания кнопкой может отстать)
const rbPageNow = (...args) => L2V7Modules.raid.rbPageNow(...args);
function rbRowsParse(...args) { return L2V7Modules.raid.rbRowsParse(...args); }
async function rbListScan(...args) { return L2V7Modules.raid.rbListScan(...args); }
// кого бить: живой, игра не запрещает, в окне уровня, не «не по силам». v4.39: сначала самые слабые; v4.45: кнопкой — наоборот.
// v5.1: строго по порядку списка игры (уровень, затем место в списке); «пробовал недавно» — 10 мин вместо 30, а если
// других нет — берём и недавно пробованных (кроме последних 2 мин), чтобы тур не стоял; причины пропуска — в rbListWhy()
const RB_TRY_MS = 10 * 60000, RB_RETRY_MS = 2 * 60000;
// v5.2: оценка ДО платного телепорта (100 000 аден). Лог 08.10 12:02–12:05: 25 телепортов подряд = 2,5 млн аден, и каждый РБ
// через 3 с после прилёта — «не полезу: банками ≈3k из 0» (Велике зілля HP 11 шт., резерв 10). Теперь та же модель считается
// заранее: характеристики РБ — замер из его окна (rt.rbStats), а если его не видели — по ближайшему по уровню замеру
// (P.Atk и HP растут ≈ как уровень в 3-й степени — сверено по замерам 45/47/49/55).
function rbStatsGuess(...args) { return L2V7Modules.raid.rbStatsGuess(...args); }
function rbTeleportCheck(...args) { return L2V7Modules.raid.rbTeleportCheck(...args); }
const now_ = (...args) => L2V7Modules.raid.now_(...args);
function rbListPick(...args) { return L2V7Modules.raid.rbListPick(...args); }
// почему никого: разбивка по причинам (для статуса и журнала)
function rbListWhy(...args) { return L2V7Modules.raid.rbListWhy(...args); }
async function rbGoStep(...args) { return L2V7Modules.raid.rbGoStep(...args); }

// ---------- 🧭 ТУР ПО РБ — отдельный режим по кнопке (v4.32) ----------
// Пошагово и без фарма между РБ: список РБ игры → выбор (живой, игра разрешает, в окне уровня, не «не по силам»,
// не пробовали 30 мин; сначала проверенные ✅, потом ближе к уровню) → полное HP/MP у баффера → «Телепорт» из списка
// → РБ на карте (строка списка или метка) → бой (оценка «хватит ли сил» — та же, что в «Фарм РБ») → следующий.
// Подходящих нет — ждём 3 мин и перечитываем список. Состояние: rt.rbHunt = { step, id, name, lvl, page, price, at }
const huntOn = (...args) => L2V7Modules.raid.huntOn(...args);
async function huntSet(...args) { return L2V7Modules.raid.huntSet(...args); }
async function huntDone(...args) { return L2V7Modules.raid.huntDone(...args); }
async function rbHuntStep(...args) { return L2V7Modules.raid.rbHuntStep(...args); }

// форум: любая страница со строками «… [Телепорт]» — запоминаем, куда ведёт кнопка и что написано рядом.
// Строки с РБ («рейд», «РБ», «boss») и уровнем («ур. 35», «(35)», «Lv 35») — в rt.rbForum
async function forumRbParse() {
  if (!/\/forum/i.test(location.pathname) || /farm-resources/i.test(location.pathname)) return;   // «Фарм ресурсов» — свой разбор
  const btns = [...document.querySelectorAll('[data-teleport-id]')].slice(0, 80);   // крупные списки (800+ кнопок) — не для состояния
  if (!btns.length) return;
  const rb = { ...(rt.rbForum || {}) }, tps = { ...(rt.forumTp || {}) };
  let n = 0;
  for (const b of btns) {
    const row = b.closest('li, tr, article, [class*="row"], [class*="item"], [class*="card"], [class*="entry"]') || b.parentElement;
    const txt = (row?.textContent || '').replace(/\s+/g, ' ').trim();
    const tp = b.dataset.teleportId;
    tps[tp] = { text: txt.slice(0, 120), cost: +(b.dataset.adenaCost || b.dataset.baseAdenaCost || 0), url: location.pathname + location.search, t: Date.now() };
    const page = (document.title + ' ' + ($q('h1, h2')?.textContent || '')).toLowerCase();
    if (!/рейд|рб(?![\p{L}\d])|boss|босс|raid/iu.test(txt + ' ' + page)) continue;   // v5.6: \b не работает с кириллицей
    for (const m of txt.matchAll(/([A-ZА-ЯЁІЇЄ][^·()\[\]|,;:]{2,40}?)\s*(?:·\s*)?(?:ур\.?|lv\.?|level|\()\s*(\d{1,2})/gi)) {
      const name = m[1].trim(), lvl = +m[2];
      if (lvl < 10 || /телепорт|аден|adena|ур(?![\p{L}\d])/iu.test(name)) continue;
      rb[name.toLowerCase()] = { name, lvl, tp, url: location.pathname + location.search, t: Date.now() };
      n++;
    }
  }
  const trim = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, n));
  await setRt({ rbForum: trim(rb, 150), forumTp: trim(tps, 120) });
  if (n) rec('B', 'форум', `РБ с форума: ${n} (всего в базе ${Object.keys(rb).length})`);
}

// ---------- фарм ресурсов по форуму «Фарм ресурсов» (/forum-farm-resources.html) ----------
// Строка ресурса → раскрыть → источники «ДРОП • Wolf · ур. 4 · 16% · ×1–3 · Elven Village [Телепорт]».
// Берём только ДРОП (спойлера нет). База — отдельный ключ chrome.storage «farmDb» (большая, в rt не кладём).
// Телепорт со страницы: 50 000 адены, для VIP — бесплатно.
const FARM_URL = '/forum-farm-resources.html';
let FARM = null, farmLoading = null;
async function farmDb() {
  if (FARM) return FARM;
  if (!farmLoading) farmLoading = chrome.storage.local.get('farmDb')
    .then(s => FARM ||= s.farmDb || { res: {} }).finally(() => { farmLoading = null; });
  return farmLoading;
}
const isFarmPage = () => location.pathname === FARM_URL;
function farmRowParse(row) {                      // одна раскрытая строка ресурса → { name, n, drop: [[моб, ур, %, мин, макс, tp, локация]], spoil, sp }
  const name = (row.querySelector('.l2-farm-row__name')?.textContent || '').trim();
  const src = row.querySelectorAll('.l2-farm-source');
  // v5.1: «Шмот с РБ» и часть «Кейматов» — не мобы, а «Падает с РБ: • Матріарх Лангк Рашкос · ур. 24 · 4%» (li.l2-farm-boss)
  const bosses = [...row.querySelectorAll('.l2-farm-boss')].map(li => (li.textContent || '').replace(/^\s*•\s*/, '').trim().match(/^(.+?)\s*·\s*ур\.?\s*(\d+)\s*·\s*([\d.,]+)\s*%/i))
    .filter(Boolean).map(m => [m[1].trim(), +m[2], +m[3].replace(',', '.')]);
  if (!name || (!src.length && !bosses.length)) return null;
  const drop = [], sp = []; let spoil = 0;
  for (const el of src) {
    const kind = el.querySelector('.l2-farm-source__kind');
    if (!kind) continue;
    // 7.2 (игрок играет и спойлером — «спойлить ресурсы на крафт»): источники спойла раньше только считались. Теперь — как дроп
    // (моб · ур. · шанс · ×кол-во · телепорт), в sp. Разметку спойл-строки форума бот не видел — не разобралась, остаётся только счётчик
    const isSpoil = /spoil/.test(kind.className) || /спойл/i.test(kind.textContent);
    if (isSpoil) spoil++;
    const t = (kind.nextElementSibling?.textContent || '').replace(/^\s*•\s*/, '').trim();
    const m = t.match(/^(.+?)\s*·\s*ур\.?\s*(\d+)\s*·\s*([\d.,]+)\s*%\s*(?:·\s*×\s*(\d+)(?:\s*[–-]\s*(\d+))?)?/i);
    const b = el.querySelector('[data-teleport-id]');
    if (!m || !b) continue;
    (isSpoil ? sp : drop).push([m[1].trim(), +m[2], +m[3].replace(',', '.'), +(m[4] || 1), +(m[5] || m[4] || 1), b.dataset.teleportId,
               (el.querySelector('.l2-farm-source__location')?.textContent || '').trim()]);
  }
  return { name, n: +((row.querySelector('.l2-farm-row__hint')?.textContent || '').match(/\d+/) || [0])[0], drop, spoil, sp, bosses, icon: farmIconOf(row) };
}
// 8.0.5 (игрок: «ресурсы … с картинками как в игре»): иконка предмета строки — путь игры (/icons/resources/basic/coal.jpg,
// /icons/drops/earring_b/…png, /game/item-icon/<id>); картинки мобов из раскрытых источников не берём
function farmIconOf(row) {
  for (const img of row.querySelectorAll('img')) {
    if (img.closest('.l2-farm-source, .l2-farm-boss, .l2-farm-row__detail')) continue;
    const s = (img.getAttribute('src') || '').trim().replace(/^https?:\/\/(?:[\w-]+\.)?l2wap\.com(?=\/)/i, '');
    if (/^\/(?:icons|game\/item-icon|assets)\/[^\s"'<>]+$/.test(s) && !/\/(?:mobs|l2dop-mob)\//.test(s)) return s.slice(0, 200);
  }
  return '';
}
// 8.0.5: иконки без полного перечитывания базы — со всех строк, что уже есть на странице (раздел и уровни не трогаем)
async function farmIcons() {
  const db = await farmDb(); let n = 0;
  for (const row of document.querySelectorAll('.l2-farm-row')) {
    const k = (row.querySelector('.l2-farm-row__name')?.textContent || '').trim().toLowerCase(), r = db.res[k], ic = k && r && farmIconOf(row);
    if (ic && r.icon !== ic) { r.icon = ic; n++; }
    if (r && !r.cat) { const c = farmCatOf(row); if (c) { r.cat = c; n++; } }
  }
  if (n) { await chrome.storage.local.set({ farmDb: db }); rec('B', 'фарм', `база ресурсов: картинки/разделы обновлены у ${n} строк`); }
  return n;
}
async function farmSave(list) {
  if (!list.length) return;
  const db = await farmDb(), cat = { ...(rt.zoneCat || {}) };
  for (const r of list) {
    // 8.0.5: строка, раскрытая игроком, приходит без раздела/иконки — не стираем прежние (Oriharukon Ore попал в «Прочее»)
    const k = r.name.toLowerCase(), old = db.res[k] || {};
    db.res[k] = { ...r, cat: r.cat || old.cat || '', icon: r.icon || old.icon || '', t: Date.now() };
    for (const d of r.drop) if (!cat[d[5]]) cat[d[5]] = { name: d[6] || d[5], url: FARM_URL, forum: true };
  }
  db.t = Date.now();
  await chrome.storage.local.set({ farmDb: db });
  await setRt({ zoneCat: cat, farmN: Object.keys(db.res).length });
  rec('B', 'фарм', `база ресурсов: ${list.map(r => `${r.name} (${r.drop.length ? 'дроп ' + r.drop.length : ''}${r.bosses?.length ? (r.drop.length ? ', ' : '') + 'РБ ' + r.bosses.length : ''})`).join(', ')} · всего ${Object.keys(db.res).length}`);
}
// v5.1: страница выросла (ресурсы + «Кейматы» 116 + «Шмот с РБ» 254, вложенные группы по грейду и типу) — раньше бот
// раскрывал ВСЕ разделы разом и страница «не отвечала». Теперь: по одному разделу/группе (раскрыл → прочитал строки →
// свернул), сохраняем каждые 20 строк, прогресс помним (rt.farmScanDone) — после перезагрузки продолжаем с того же места.
async function farmScan() {
  setStatus('Фарм: читаю «Фарм ресурсов» на форуме');
  await waitX(() => $q('.l2-farm-row__toggle, details.l2-farm-guide-section, details'), 15000, 300);
  await farmIcons().catch(() => {});
  const done = new Set(rt.farmScanDone || []);
  const out = [];
  let n = 0;
  const flush = async () => { if (out.length) { await farmSave(out.splice(0)); await setRt({ farmScanDone: [...done].slice(-3000) }); } };
  const readRow = async row => {
    const nm = (row.querySelector('.l2-farm-row__name')?.textContent || '').trim();
    const key = (row.closest('details')?.querySelector(':scope > summary')?.textContent || '').trim().slice(0, 40) + '|' + nm;
    if (!nm || done.has(key)) return;
    const btn = row.querySelector('.l2-farm-row__toggle');
    const has = () => row.querySelector('.l2-farm-source, .l2-farm-boss');   // мобы или «Падает с РБ»
    if (btn && !has()) { fire(btn); await waitX(() => has() || (row.querySelector('.l2-farm-row__detail')?.textContent.trim().length > 3 ? 1 : null), 4000, 100); }
    const r = farmRowParse(row);
    if (r) { r.cat = farmCatOf(row); out.push(r); }
    done.add(key); n++;
    if (btn && btn.getAttribute('aria-expanded') === 'true') { fire(btn); await sleep(120); }
    setRt({ status: `Фарм: читаю базу — ${n} строк${r ? ` · ${r.name}` : ''}` }); draw();
    await sleep(rnd(120, 240));
    if (out.length >= 20) { await flush(); await sleep(600); }   // сохраняем и даём странице «вздохнуть»
  };
  // группы: раскрываем по одной, внутри — строки, затем вложенные группы; после — сворачиваем
  const walk = async (box, depth) => {
    if (!on || depth > 4) return;
    const own = box.tagName === 'DETAILS' ? box : null;                        // строки именно этой группы (не вложенных)
    for (const row of [...box.querySelectorAll('.l2-farm-row')].filter(r => (r.closest('details') || null) === own)) await readRow(row);
    const subs = [...box.querySelectorAll('details')].filter(d => d.parentElement.closest('details') === (box.tagName === 'DETAILS' ? box : null));
    for (const d of subs) {
      if (!on) return;
      const wasOpen = d.open;
      if (!wasOpen) { d.open = true; await sleep(250); }
      await walk(d, depth + 1);
      if (!wasOpen) { d.open = false; await sleep(80); }
    }
  };
  await walk(document.body, 0);
  await flush();
  if (!on) return;
  rec('B', 'фарм', `база ресурсов: прочитано строк ${n}${done.size ? `, всего в базе ${Object.keys(FARM?.res || {}).length}` : ''}`);
  await setRt({ farmScan: null, farmScanT: Date.now(), farmScanDone: null });
}
// раздел строки: «Ресурсы» / «Кейматы» / «Шмот с РБ» — по заголовку ближайшей верхней группы
function farmCatOf(row) {
  const heads = []; let d = row.closest('details');
  while (d) { heads.unshift((d.querySelector(':scope > summary')?.textContent || '').replace(/[—-]\s*\d+\s*$/, '').replace(/\s+/g, ' ').trim()); d = d.parentElement?.closest('details'); }
  return heads.filter(Boolean).join(' › ').slice(0, 80);
}
// цель фарма: из меню (ресурс + сколько) или ресурс главы кампании («Нужно сдать: Stone of Purity 48/50»)
function farmGoal() {
  if (cfg.campaign) {
    const t = campOpen().find(x => x.res && FARM?.res?.[x.name.toLowerCase()]);
    if (t) return { key: t.name.toLowerCase(), name: t.name, left: t.total - t.done, why: 'глава кампании' };
  }
  // 9.0 (игрок 11.10: «копить на определённую задачу и последовательно идти её делать»): цель «Маммон» — недостающий материал
  // улучшения у кузнеца (по одному, по порядку списка цены). Ресурс, выбранный в «Фарм ресурса», главнее
  if (!(cfg.farmRes || '').trim() && cfg.mmGoalItem) { const m = L2V7Modules.mammon.mmFarmGoal(); if (m) return m; }
  // 7.2.1 (игрок: «на точку квеста летаю сам и квесты выполняю сам»): «Квесты на ресурсы» — только счётчик, бот к источнику не летит
  const k = (cfg.farmRes || '').trim().toLowerCase();
  if (!k || !FARM?.res?.[k]) return null;
  const got = rt.farmGot?.[k] || 0, need = cfg.farmNeed || 0;
  if (need && got >= need) return null;
  return { key: k, name: FARM.res[k].name, left: need ? need - got : Infinity, why: 'из меню' };
}
// зоны-источники: «шт. за бой» = средний (шанс × среднее кол-во) по мобам зоны в окне уровня;
// оценка = это × близость уровня (свой ±3 — лучше: и опыт, и бой быстрый) × (1 + 0,1 за каждый вид моба, до 5 — проще найти цель)
// 7.2: sp — источники спойла (тот же формат) с множителем spK (успех спойла); с одного моба дроп и спойл складываются
// 7.2.1 (игрок 10.10: «чтобы старался выбирать −3…+5 ур. от героя, но с возможностью коррекции»): предпочтительный диапазон уровней
// мобов-источников — cfg.farmLvlBelow / farmLvlAbove (меню «Фарм ресурса»). Точки, где есть источники в диапазоне, — в первую очередь
// (inWin), среди них — по шансу; нет таких — лучшая из остальных, чем дальше уровень от диапазона, тем ниже оценка
const farmWin = L => ({ lo: L - (cfg.farmLvlBelow ?? 3), hi: L + (cfg.farmLvlAbove ?? 5) });
function farmFit(l, L) {
  const w = farmWin(L);
  return l >= w.lo && l <= w.hi ? 1 : l < w.lo ? Math.max(0.15, 1 - (w.lo - l) * 0.12) : Math.max(0.1, 1 - (l - w.hi) * 0.18);
}
function farmZones(drop, L, above, sp = [], spK = 0.8) {
  const fit = l => farmFit(l, L), w = farmWin(L);
  const by = {};
  for (const [src, k] of [[drop, 1], [sp, spK]]) for (const [mob, lvl, ch, a, b, tp, loc] of src || []) {
    if (lvl > Math.max(L + above, w.hi) || lvl < Math.min(L - 10, w.lo)) continue;
    const e = ch / 100 * (a + b) / 2 * k, z = (by[tp] ||= { tp, loc, mobs: {} }), kind = k === 1 ? 'd' : 's';
    const x = (z.mobs[mob] ||= { lvl, e: 0, ch: 0, d: 0, s: 0 });
    if (x[kind] < e) { x.e += e - x[kind]; x[kind] = e; if (kind === 'd') x.ch = Math.max(x.ch, ch); else x.spCh = Math.max(x.spCh || 0, ch); }
  }
  return Object.values(by).map(z => {
    const m = Object.values(z.mobs);
    z.e = m.reduce((s, x) => s + x.e, 0) / m.length;
    z.score = m.reduce((s, x) => s + x.e * fit(x.lvl), 0) / m.length * (1 + 0.1 * Math.min(m.length, 5));
    z.inWin = m.some(x => x.lvl >= w.lo && x.lvl <= w.hi);
    return z;
  }).sort((x, y) => (y.inWin - x.inWin) || y.score - x.score);
}
function farmPick(goal) {
  const r = FARM?.res?.[goal.key], L = heroLvl();
  if (!r || !L) return null;
  // 7.2: спойлер (есть спойл на панели / гном) — считаем и спойл. Шанс пометить моба — по замеру (rt.spoilStat ok/fail за нажатие,
  // до 3 попыток на моба: 1 − (1 − p)³), без замера 80 %
  const st = rt.spoilStat || {}, tries = (st.ok || 0) + (st.fail || 0);
  const spK = tries >= 10 ? Math.max(0.2, 1 - Math.pow(1 - (st.ok || 0) / tries, 3)) : 0.8;
  const zones = farmZones(r.drop, L, cfg.lvlAbove ?? 6, canSpoil() ? r.sp || [] : [], spK);
  const best = zones[0];
  return best ? { ...best, names: Object.keys(best.mobs) } : null;
}
// 7.2: персонаж умеет спойлить — спойл в роли «Спойл» или профессия гнома-спойлера
const canSpoil = () => !!names(cfg.nSpoil || '').length || /\b(?:dwarven fighter|scavenger|bounty hunter|fortune seeker)\b/i.test(String(rt.prof || ''));
// 7.2: активная цель «фарм ресурса» / «охота на рецепт» с подходящей зоной. Пока она есть, автофарм не уводит с её локации
// (раньше: прилетел за ресурсом → через 10 мин автофарм улетал в «лучшую по опыту» зону → через 3 мин фарм тянул обратно — по кругу)
function lootGoal() {
  const g = FARM && farmGoal(), r0 = g && FARM.res[g.key], p = r0 && (r0.drop?.length || r0.sp?.length) ? farmPick(g) : null;
  if (p) return { kind: 'farm', name: g.name, zone: p.tp };
  const rg = RECIPES && recipeGoal(), q = rg && recipePick(rg);
  return q?.zid ? { kind: 'recipe', name: rg.name, zone: q.zid } : null;
}
function farmRules() {                            // мобы-источники ресурса — в приоритет, пока мы в нужной зоне
  const g = FARM && farmGoal(), p = g && farmPick(g);
  if (!p || rt.zone !== p.tp) return [];
  return p.names.map(n => ({ neg: false, line: `${n} (фарм ${g.name})`, quest: false, champ: false, all: false, name: n.toLowerCase(), farm: true }));
}
// предмет падает только с РБ («Шмот с РБ»): ищем этих РБ в списке игры — живой, в окне уровня, не «не по силам» → телепорт к нему
function farmBossPick(goal) {
  const r = FARM?.res?.[goal.key], L = heroLvl();
  if (!r?.bosses?.length || !L) return null;
  const lo = rbLo(L), hi = rbHi(L), list = Object.entries(rt.rbList || {});
  const c = r.bosses.map(([nm, lvl, ch]) => { const e = list.find(([, x]) => x.name.toLowerCase() === nm.toLowerCase()); return e && { id: e[0], ...e[1], ch }; })
    .filter(x => x && x.alive && !x.deny && x.lvl >= lo && x.lvl <= hi && !rbVerdictBlocks(x.id) && Date.now() - ((rt.rbGoTried || {})[x.id] || 0) > 10 * 60000 && !rbTeleportCheck(x.id, x))
    .sort((a, b) => b.ch - a.ch || a.lvl - b.lvl);
  return c[0] || null;
}
async function farmStep() {                       // после боя: пора лететь к ресурсу?
  if (!FARM) await farmDb();
  const g = farmGoal(); if (!g) return false;
  const r0 = FARM?.res?.[g.key];
  if (r0?.bosses?.length && !r0.drop?.length) {     // только с РБ
    // v5.6: раньше требовался «👑 Фарм РБ», а при нём фарм ресурсов не вызывается вовсе — такой предмет был недостижим.
    // Теперь сам: список РБ игры (если не читан или старше 20 мин) → телепорт к нужному РБ → бой только с ним (rt.farmRb)
    if (!Object.keys(rt.rbList || {}).length || Date.now() - (rt.rbListT || 0) > 20 * 60000) {
      if (rt.rbScan) return false;
      rec('B', 'фарм', `${g.name}: падает только с РБ — читаю список рейд-боссов`);
      await setRt({ rbScan: true }); return true;
    }
    const b = farmBossPick(g);
    if (!b) { if (rt.farmWhy !== 'rb:' + g.key) { rec('B', 'фарм', `${g.name}: падает с РБ (${r0.bosses.map(x => `${x[0]} ${x[1]} ур. ${x[2]}%`).join(', ')}) — сейчас подходящего живого РБ нет`); await setRt({ farmWhy: 'rb:' + g.key }); } return false; }
    if (rt.rbGo || Date.now() - (rt.zoneGoT || 0) < 180000) return false;
    rec('B', 'фарм', `${g.name} (${g.why}) падает с РБ → лечу к ${b.name} (${b.lvl} ур., шанс ${b.ch}%)`);
    await setRt({ rbGo: { id: b.id, name: b.name, lvl: b.lvl, page: b.page, price: b.price, t: Date.now() }, farmRb: { id: b.id, name: b.name, t: Date.now() }, farmWhy: '' });
    return true;
  }
  const p = farmPick(g); if (!p) { if (rt.farmWhy !== 'none:' + g.key) { rec('B', 'фарм', `${g.name}: нет источников ${canSpoil() ? 'дропа и спойла' : 'дропа'} для ур. ${heroLvl()}`); await setRt({ farmWhy: 'none:' + g.key }); } return false; }
  if (rt.zone === p.tp || Date.now() - (rt.zoneGoT || 0) < 180000) return false;
  const why = `${g.name} (${g.why}${isFinite(g.left) ? `, ещё ${g.left}` : ''}): ${p.loc} — ${p.names.slice(0, 3).map(n => `${n} ${p.mobs[n].lvl} ур. ${p.mobs[n].ch ? p.mobs[n].ch + '%' : ''}${p.mobs[n].spCh ? ' спойл ' + p.mobs[n].spCh + '%' : ''}`).join(', ')} · ≈${p.e.toFixed(2)} шт./бой`;
  rec('B', 'фарм', `лечу за ресурсом → ${why}`);
  await setRt({ zoneGo: { id: p.tp, url: FARM_URL, forum: true, res: g.name, t: Date.now(), why: 'фарм: ' + why }, zoneGoT: 0 });
  location.href = FARM_URL; await sleep(4000);
  return true;
}

// ---------- 📜 охота на рецепты (форум «Охота на рецепты», /forum-recipe-hunt.html) ----------
// Страница целиком: «D-grade» → группа (⚔️ Оружие — 8) → «Recipe: Bonebreaker (100%)» → СПОЙЛ / ДРОП → «• Stinger Wasp · ур. 30 · 3.200%» + локация.
// Кнопок телепорта нет — локацию ищем по имени в каталоге зон «Телепорта». Спойл — только если в меню отмечено «есть спойл».
const RECIPE_URL = '/forum-recipe-hunt.html';
let RECIPES = null, recipeLoading = null;
async function recipeDb() {
  if (RECIPES) return RECIPES;
  if (!recipeLoading) recipeLoading = chrome.storage.local.get('recipeDb')
    .then(s => RECIPES ||= s.recipeDb || { rec: {} }).finally(() => { recipeLoading = null; });
  return recipeLoading;
}
const recipeKey = n => String(n || '').toLowerCase().replace(/\s*\(\d+%\)\s*$/, '').replace(/^recipe:\s*/, 'recipe: ').trim();
function recipeParse() {
  const out = {};
  let grade = '';
  for (const el of document.querySelectorAll('.l2-recipe-hunt-grade, article.l2-recipe-hunt-recipe')) {
    if (el.classList.contains('l2-recipe-hunt-grade')) { grade = el.textContent.trim(); continue; }
    const title = (el.querySelector('.l2-recipe-hunt-recipe__title')?.textContent || '').trim();
    if (!title) continue;
    const group = (el.closest('details')?.querySelector('.l2-recipe-hunt-group__label')?.textContent || '').replace(/^[^\p{L}]+/u, '').trim();
    const src = kind => [...el.querySelectorAll(`.l2-recipe-hunt-section--${kind} .l2-recipe-hunt-source-item`)].map(li => {
      const m = (li.querySelector('.l2-recipe-hunt-source-mob')?.textContent || '').replace(/^\s*•\s*/, '').match(/^(.+?)\s*·\s*ур\.?\s*(\d+)\s*·\s*([\d.,]+)\s*%/i);
      return m && [m[1].trim(), +m[2], +m[3].replace(',', '.'), (li.querySelector('.l2-recipe-hunt-source-loc')?.textContent || '').trim()];
    }).filter(Boolean);
    out[recipeKey(title)] = { name: title.replace(/\s*\(\d+%\)\s*$/, ''), full: title, grade, group, drop: src('drop'), spoil: src('spoil') };
  }
  return out;
}
async function recipeSave() {
  const got = recipeParse(), n = Object.keys(got).length;
  if (!n) return 0;
  const db = await recipeDb();
  db.rec = { ...db.rec, ...got }; db.t = Date.now();
  await chrome.storage.local.set({ recipeDb: db });
  await setRt({ recipeN: Object.keys(db.rec).length });
  rec('B', 'рецепты', `база рецептов: ${n} (${[...new Set(Object.values(got).map(r => r.grade))].join(', ')})`);
  return n;
}
// локация с форума → зона «Телепорта» (по имени; «Town of Giran» → окрестности Giran)
function zoneByLoc(...args) { return L2V7Modules.navigation.zoneByLoc(...args); }
function recipeGoal() {
  const k = recipeKey(cfg.recipeRes);
  if (!k || !RECIPES?.rec?.[k]) return null;
  const got = rt.recipeGot?.[k] || 0, need = cfg.recipeNeed || 0;
  if (need && got >= need) return null;
  return { key: k, name: RECIPES.rec[k].name, left: need ? need - got : Infinity };
}
function recipePick(goal) {
  const r = RECIPES?.rec?.[goal.key], L = heroLvl();
  if (!r || !L) return null;
  const w = farmWin(L), lo = Math.min(L - (cfg.lvlBelow ?? 3) - 7, w.lo), hi = Math.max(L + Math.min(cfg.lvlAbove ?? 15, 15), w.hi);
  const fit = l => farmFit(l, L);   // 7.2.1: тот же предпочтительный диапазон, что у ресурсов
  const by = {};
  for (const [kind, list] of [['дроп', r.drop], ...(cfg.recipeSpoil || canSpoil() ? [['спойл', r.spoil]] : [])])   // 7.2: спойлер — спойл сам
    for (const [mob, lvl, ch, loc] of list || []) {
      if (lvl < lo || lvl > hi) continue;
      const z = (by[loc] ||= { loc, zid: zoneByLoc(loc), mobs: {} });
      if (!z.mobs[mob] || z.mobs[mob].ch < ch) z.mobs[mob] = { lvl, ch, kind };
    }
  const zones = Object.values(by).map(z => { const m = Object.values(z.mobs); z.e = m.reduce((s, x) => s + x.ch / 100, 0) / m.length; z.score = m.reduce((s, x) => s + x.ch / 100 * fit(x.lvl), 0) / m.length * (1 + 0.1 * Math.min(m.length, 5)); z.inWin = m.some(x => x.lvl >= w.lo && x.lvl <= w.hi); return z; })
    .sort((a, b) => (!!b.zid - !!a.zid) || (b.inWin - a.inWin) || b.score - a.score);
  return zones[0] ? { ...zones[0], names: Object.keys(zones[0].mobs), all: zones } : null;
}
function recipeRules() {                          // мобы-источники рецепта — в приоритет, пока мы в нужной зоне
  const g = RECIPES && recipeGoal(), p = g && recipePick(g);
  if (!p || !p.zid || rt.zone !== p.zid) return [];
  return p.names.map(n => ({ neg: false, line: `${n} (рецепт ${g.name})`, quest: false, champ: false, all: false, name: n.toLowerCase(), farm: true }));
}
async function recipeStep() {                     // после боя: пора лететь за рецептом?
  if (!RECIPES) await recipeDb();
  const g = recipeGoal(); if (!g) return false;
  const p = recipePick(g);
  if (!p || !p.zid) {
    const why = !p ? `нет источников для ${heroLvl()} ур.` : `локации «${p.loc}» нет в каталоге «Телепорта» (обновите список зон)`;
    if (rt.recipeWhy !== why) { rec('B', 'рецепт', `${g.name}: ${why}`); await setRt({ recipeWhy: why }); }
    return false;
  }
  if (rt.zone === p.zid || Date.now() - (rt.zoneGoT || 0) < 180000) return false;
  const why = `${g.name}${isFinite(g.left) ? ` (ещё ${g.left})` : ''}: ${p.loc} — ${p.names.slice(0, 3).map(n => `${n} ${p.mobs[n].lvl} ур. ${p.mobs[n].ch}%${p.mobs[n].kind === 'спойл' ? ' спойл' : ''}`).join(', ')}`;
  rec('B', 'рецепт', `лечу за рецептом → ${why}`);
  await setRt({ zoneGo: { id: p.zid, t: Date.now(), why: 'рецепт: ' + why }, zoneGoT: 0, recipeWhy: '' });
  location.href = '/teleport.html'; await sleep(4000);
  return true;
}
if (location.pathname === RECIPE_URL) setTimeout(() => { recipeSave().catch(() => {}); }, 3000);   // зашёл бот или игрок — база обновится сама

// ---------- городской баффер (/town-buffer.html): бафф на 24 ч, слетает при смерти ----------
// «Звичайний баф» — бесплатно; «Повний баф воїна/мага» — 15 Coin of Luck: только если выбран в меню.
// Баффы за Fast Aden (/fast-aden-buffer.html, 1–5 FA, 3 ч) — только из списка в меню (skillId через запятую).
const TB_KEYS = { basic: [1068, 1268, 1086, 1045], warrior: [1388, 1268, 271, 1045], mage: [1059, 1303, 1045] };
function hudBuffs(...args) { return L2V7Modules.buffs.hudBuffs(...args); }
function townBuffNeed(...args) { return L2V7Modules.buffs.townBuffNeed(...args); }
// ---- баффы за Fast Aden (v5.1): список из меню (через «+»), каталог и баланс FA — со страницы баффера ----
// Защита от «глюков» при нехватке FA: известный баланс меньше самого дешёвого нужного баффа — к бафферу не ходим
// (до 60 мин или пока не увидим баланс больше); бафф, которого нет в списке игры, пропускаем 6 ч; покупаем по порядку списка,
// не хватает на один — берём следующие, что по карману; ничего не купили из-за баланса — пауза 60 мин.
// 7.2.1 (снимок баффера 10.10 22:27): Greater — по 5 FA, обычные — 1 FA, всё на 3 ч; номера Prophecy были перепутаны (1357 — Water, 1355 — Wind)
// 8.0.3 (лог 11.10 09:05: игрок купил 9 баффов по 1 FA, среди них Song of Wind 268 и Song of Vitality 304 — их в списке не было)
const FA_KNOWN = { 1363: ['Chant of Victory', 5], 1356: ['Prophecy of Fire', 5], 1357: ['Prophecy of Water', 5], 1355: ['Prophecy of Wind', 5], 1413: ["Magnus' Chant", 5], 1414: ["Victories of Pa'agrio", 5], 1323: ['Noblesse Blessing', 5],
  4703: ['Дар Серафима (откат −30 %)', 1], 273: ['Dance of Mystic', 1], 365: ['Dance of Siren', 1], 1303: ['Wild Magic', 1], 264: ['Song of Earth', 1], 267: ['Song of Warding', 1], 1389: ['Великий щит', 1], 1059: ['M.Atk ↑', 1], 1085: ['Cast.Spd ↑', 1], 276: ['Dance of Concentration', 1],
  268: ['Song of Wind', 1], 304: ['Song of Vitality', 1] };
const faCost = id => rt.faCat?.[id]?.cost || FA_KNOWN[id]?.[1] || 1;
function faWanted(...args) { return L2V7Modules.buffs.faWanted(...args); }
function faCatalogNote(...args) { return L2V7Modules.buffs.faCatalogNote(...args); }
async function townBuffStart(...args) { return L2V7Modules.buffs.townBuffStart(...args); }
async function townBuffStep(...args) { return L2V7Modules.buffs.townBuffStep(...args); }

async function rest(...args) { return L2V7Modules.resources.rest(...args); }
// 8.0.3 (лог 11.10 10:13:25 «РБ HP 704k ≈6:60», 09:59:54 «до опасного HP ≈-1:-1»): секунды округлялись отдельно от минут (419,6 с →
// «6:60»), отрицательное не обрезалось. Теперь сначала округляем всё время, меньше нуля — «0:00» (уже)
const fmtT = sec => { if (!isFinite(sec)) return '∞'; const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// перейти на страницу спавна и кликнуть его строку (через обработчик карты)
async function attackSpawn(...args) { return L2V7Modules.mobfarm.attackSpawn(...args); }

async function map(...args) { return L2V7Modules.mobfarm.map(...args); }

// ---------- бой ----------
let lastShotTry = 0;
async function keepShots(...args) { return L2V7Modules.resources.keepShots(...args); }

// ---------- 💥 v5.3: сверхсильные скиллы и 🩸 вампиризм магов ----------
// Сверхсильные (роль «Сверхсильные»): Punch of Doom (Тиран, сила до 9132, откат 2 мин, стоит HP), Crush of Doom
// (Дестроер, до 7635, 26 с, стоит HP), Vortex-ы магов (откат 60 с, 84 MP, каст 6 с). Откат долгий — тратить на моба,
// который и так умрёт от обычного удара, жалко. Режим «ultMode»:
//   boss — только РБ и чемпионы;  big — ещё и обычные мобы, если у моба HP хватит на сам удар (не «перебить» впустую);
//   always — как только откатился. Скиллы, что стоят HP (… of Doom), не жмём при HP < 40 %.
function ultPick(...args) { return L2V7Modules.combat.ultPick(...args); }
function frenzyDive(...args) { return L2V7Modules.combat.frenzyDive(...args); }
function drainPick(...args) { return L2V7Modules.combat.drainPick(...args); }
function chooseAction(...args) { return L2V7Modules.combat.chooseAction(...args); }

// панель скиллов в бою: игра даёт показать 1–3 ряда (кнопки ▲/▼ слева). Держим открытыми все 3:
// скрытый ряд (hidden) — это скиллы и банки, которыми бот пользоваться не должен «вслепую»
async function hotbarRows3(...args) { return L2V7Modules.combat.hotbarRows3(...args); }
async function battle(...args) { return L2V7Modules.combat.battle(...args); }

// ---------- РБ в бою: хватит ли сил ----------
// банки HP для РБ: сколько можно выпить (минус резерв), лечение одной банки (замер по панели), интервал питья
function potModel(...args) { return L2V7Modules.combat.potModel(...args); }
// Скользящее окно 30 с: скорость урона по РБ и скорость потери HP героя (вампирик и банки уже учтены — это чистая потеря).
function rbLearn(...args) { return L2V7Modules.raid.rbLearn(...args); }
let rbLive = null;                                // v4.47: живые данные боя с РБ для индикатора (в памяти вкладки)
function rbAssess(...args) { return L2V7Modules.raid.rbAssess(...args); }
async function rbRetreat(...args) { return L2V7Modules.raid.rbRetreat(...args); }
// РБ не по силам: выход в Окрестности, в базу «❌ не по силам» (до роста уровня), дальше — обычные мобы
async function rbAbort(...args) { return L2V7Modules.raid.rbAbort(...args); }

// ---------- доп. цели, поваленные посреди боя ----------
const EXTRA_KILL = /(?:Додаткова ціль повалена|Дополнительная цель повержена)\s*:\s*(.+?)\.?$/i;
function extraKillsInLog() {                     // [{ name, exp, sp, adena, items }] — сверху вниз (новые первыми)
  const L = logLines(), out = [];
  L.forEach((l, i) => {
    const m = l.match(EXTRA_KILL);
    if (!m) return;
    const k = { name: m[1].trim(), exp: 0, sp: 0, adena: 0, items: [] };
    for (let j = i - 1; j >= 0; j--) {           // награда — строки над записью о поверженной цели
      const v = L[j], n = +(v.match(/\+\s*(\d+)/)?.[1] || 0);
      if (/^EXP/i.test(v)) k.exp = n; else if (/^SP/i.test(v)) k.sp = n; else if (/^аден/i.test(v)) k.adena = n;
      else if (/×\s*\d+\s*$/.test(v)) k.items.push(v.replace(/\s+/g, ' '));
      else break;
    }
    out.push(k);
  });
  return out;
}

// ---------- условия главы кампании: модель целей ----------
// Источники: страница кампании (точно) + строки лога боя «★ Квест · Партизан Ол Махум 17 / 40 · осталось 23».
// Метка в логе локализована («Партизан Ол Махум»), цель на странице — «Ol Mahum Guerilla»: связь метка→цель
// выучивается по убитому мобу и запоминается (rt.qAlias). Квест-предметы пишутся так же — та же логика.
// v5.5.1: игра пишет «★ Квест: Greystone Golem 3 / 20 · осталось 17» — с двоеточием (раньше «Квест · …»); бот строку не узнавал
const QLINE = /(?:Квест|Quest|★[^·:⏎]{1,30})\s*[·:]\s*(.+?)\s*(\d+)\s*\/\s*(\d+)\s*(?:·\s*(?:осталось|залишилось)\s*(\d+)|✓|Цель выполн|Ціль викон|Мета викон)/i;
const GOAL_RE = /Цель выполнена|Ціль виконано|Мета виконана/i;
const goalLines = () => logLines().filter(l => GOAL_RE.test(l)).length;
function questLinesInLog(...args) { return L2V7Modules.quests.questLinesInLog(...args); }
const campActive = (...args) => L2V7Modules.quests.campActive(...args);
const campOpen = (...args) => L2V7Modules.quests.campOpen(...args);
const campMobOpen = (...args) => L2V7Modules.quests.campMobOpen(...args);
const campRbOpen = (...args) => L2V7Modules.quests.campRbOpen(...args);
const nameLike = (a, b) => { a = (a || '').toLowerCase().trim(); b = (b || '').toLowerCase().trim(); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
const campChampOpen = (...args) => L2V7Modules.quests.campChampOpen(...args);
const campChampMin = (...args) => L2V7Modules.quests.campChampMin(...args);
function isQuestName(...args) { return L2V7Modules.quests.isQuestName(...args); }
// killed — имена мобов, поваленных в этом бою; champKill — был ли среди них чемпион
async function applyQuestLog(...args) { return L2V7Modules.quests.applyQuestLog(...args); }

// ---------- квесты ----------
function questProgress(...args) { return L2V7Modules.quests.questProgress(...args); }
const questRate = (...args) => L2V7Modules.quests.questRate(...args);                     // сглаженная частота дропа
const questFights = (...args) => L2V7Modules.quests.questFights(...args);

// учёт после победы над мобом `name`; возвращает подпись выполненных квестов, если все выполнены
async function trackQuest(...args) { return L2V7Modules.quests.trackQuest(...args); }
// учёт квестов по логу боя — только для целей текущей главы: старые (прошлая глава) убираем
function questsFor(...args) { return L2V7Modules.quests.questsFor(...args); }
function questSummary(...args) { return L2V7Modules.quests.questSummary(...args); }

// ---------- автономия: кампания из почты, телепорт к целям, возрождение ----------
// HP/MP сами не восстанавливаются (страница не обновляется) — ждать бесполезно. Городской баффер:
// «Восстановить HP | MP | CP» (#town-buffer-restore-btn) — сразу полные. «Снять бафф» рядом не трогаем никогда.
async function restoreVitals(...args) { return L2V7Modules.survival.restoreVitals(...args); }
async function goOutskirts(...args) { return L2V7Modules.navigation.goOutskirts(...args); }

const isCampaignPage = (...args) => L2V7Modules.quests.isCampaignPage(...args);
const isQuests = (...args) => L2V7Modules.quests.isQuests(...args);
// «Проверить кампанию сейчас» при выключенной Кампании — разовое чтение главы (campOnce): без телепортов и сдачи, потом обратно на охоту
const campOn = (...args) => L2V7Modules.quests.campOn(...args);
async function goCampaign(...args) { return L2V7Modules.quests.goCampaign(...args); }
// «Персонаж → Мои квесты»: список активных кампаний (Клятва Гирана, Тень над Дионом…) — надёжнее письма в почте
async function questsStep(...args) { return L2V7Modules.quests.questsStep(...args); }

async function mailStep(...args) { return L2V7Modules.quests.mailStep(...args); }

function campaignState(...args) { return L2V7Modules.quests.campaignState(...args); }

async function campaign(...args) { return L2V7Modules.quests.campaign(...args); }

// мало HP в обычном бою: выйти из боя, восстановиться до 80 % и продолжить. Стоп — если так 3 раза за 20 мин.
async function lowHpEscape(...args) { return L2V7Modules.survival.lowHpEscape(...args); }

async function onDeath(...args) { return L2V7Modules.survival.onDeath(...args); }
// ---------- после смерти: город → магическая статуя (иначе «Восстановить» у баффера не работает) ----------
const DEAD_RE = /знепритомн|без сознани|сначала натисни|спочатку натисни|сначала нажми/i;
const isCity = (...args) => L2V7Modules.navigation.isCity(...args);
const clickText = e => [e.textContent, e.title, e.getAttribute('aria-label'), e.getAttribute('href'), ...[...e.querySelectorAll('img')].map(i => (i.alt || '') + ' ' + (i.getAttribute('src') || ''))].join(' ');
async function reviveStep(...args) { return L2V7Modules.survival.reviveStep(...args); }


// ---------- рыбалка (/fishing.html) ----------
var NET_FISH = { t: 0 }, NET_ERR = { t: 0 };                          // v5.3: последний ответ сервера на действие рыбалки (из сетевого «жучка»)
// v4.49: в режиме рыбалки бот сам не останавливается — любая помеха (страница не догрузилась, нет удочки/наживки,
// повторяющийся сбой) = пауза и повтор с нарастающим ожиданием 5 → 10 → 20 → 30 → 40 с → 1 → 2 → 3 → 4 → 5 мин, пока рыбалку не выключат.
// Останавливают только: кнопка «Стоп», выполненная цель рыбалки, лимит забросов из настроек.
async function fishSoft(...args) { return L2V7Modules.fishing.fishSoft(...args); }
// Цикл: заброс (Fishing, тратит 1 наживку) → «Что-то клюнуло!» или «Рыба не клюнула.» → бой с рыбой:
// подсказка «Рыба замерла — используй Pumping!» / «Рыба сопротивляется — используй Reeling!» меняется после ударов;
// неверный скилл — «… — неверно. Рыба сорвалась!». Удар 63–77 (≈70, с зарядом), HP рыбы 250 / 400 / 650 (55 / 32 / 14 %), клёв 68 %.
// Бот читает подсказку прямо перед нажатием — человек часто жмёт по устаревшей (в журнале: 9 срывов на 5 уловов).
const isFishing = (...args) => L2V7Modules.fishing.isFishing(...args);
const fSlot = (...args) => L2V7Modules.fishing.fSlot(...args);
const fOk = (...args) => L2V7Modules.fishing.fOk(...args);
function fishState(...args) { return L2V7Modules.fishing.fishState(...args); }
// журнал рыбалки игра перерисовывает целиком — сравниваем по тексту, а не по элементам:
// новые строки — те, что появились сверху над прежним началом журнала
function fishLog(...args) { return L2V7Modules.fishing.fishLog(...args); }
function fishNewLines(...args) { return L2V7Modules.fishing.fishNewLines(...args); }
async function fishStat(...args) { return L2V7Modules.fishing.fishStat(...args); }
// счётчик перерисовок журнала: одинаковые строки («Вы забросили… / Рыба не клюнула.») повторяются,
// и сравнение по тексту их не различает — поэтому дополнительно ловим сам факт изменения журнала
let fishMut = 0, fishCdMsg = 0, fishObs = null, fishLastPre = null, fishGearMsg = null;
// игра отказывает в забросе: «Выберите удочку» / «Нет наживки» / «Оберіть вудку» … (рус./укр./англ.)
const GEAR_RE = /(удочк|вудк|\brod\b|наживк|приманк|\blure\b|bait).{0,40}(выбер|выбран|обер|обран|вибер|вибран|нет|немає|нема|закінч|кончил|нужн|потріб|потреб|select|need|no )|(выбер|обер|вибер|нет|немає|нема|нужн|потріб|select|no ).{0,25}(удочк|вудк|\brod\b|наживк|приманк|\blure\b|bait)/i;
const ROD_RE = /удочк|вудк|\brod\b/i;
function fishWatch(...args) { return L2V7Modules.fishing.fishWatch(...args); }
const fishTop = (...args) => L2V7Modules.fishing.fishTop(...args);
const isNoBite = l => !!l && (/no_bite/.test(l.cls) || /не клюнула|не клюнула/i.test(l.t));
const isBite = l => !!l && (/--bite/.test(l.cls) || /клюнуло|клюнуло/i.test(l.t)) && !isNoBite(l);
const isCast = l => !!l && (/--cast/.test(l.cls) || /забросили|закинули/i.test(l.t));
// Откат Pumping/Reeling — своя память (симуляция 10 млн забросов, v4.49): оверлей КД на панели появляется
// с задержкой 0,02–0,35 с после ответа и гаснет на ≈0,45 с позже реального отката — бот то жал «в откат»
// (отказ «Навичка ще перезаряджається» + ожидание ≈1 с), то ждал лишнее. Сервер принимает повтор через ≈1,16–1,2 с
// после прошлого нажатия того же скилла. Бот помнит время своих нажатий и учит откат по отказам.
const FCD = { pumping: 0, reeling: 0 };          // время последнего принятого нажатия
const fishCdLen = (...args) => L2V7Modules.fishing.fishCdLen(...args);
const fishCdLeft = (...args) => L2V7Modules.fishing.fishCdLeft(...args);
async function fishAct(...args) { return L2V7Modules.fishing.fishAct(...args); }
// сколько наживки / зарядов. Пустой счётчик на панели (hidden, без числа) — это НОЛЬ, а не «неизвестно»:
// так игра рисует кончившиеся заряды (журнал 08.10: «0 OFF» в строке снаряжения, на панели — пусто, бот не видел и не докупал).
// Источники: число на панели → число в строке снаряжения (#fishing-gear-row) → пустой счётчик при загруженной странице = 0.
function fishQty(...args) { return L2V7Modules.fishing.fishQty(...args); }
// «Магазин рыбака» (кнопка «Магазин» на странице рыбалки, за аден). Разметку открытого магазина ещё не видели в снимках —
// ищем строку товара по data-offer, по названию и по иконке; поле количества и кнопку «Купить» — любые в строке.
// Если не нашли — пишем в журнал, что внутри, чтобы научиться.
async function fishBuy(...args) { return L2V7Modules.fishing.fishBuy(...args); }
// удочка. Выбранная показывается названием («Вудка», «Fishing Rod +3»), невыбранная — «не выбрана / не обрано / не вибрано».
// Кроме текста, бот учится по отказу игры при забросе («Выберите удочку» …) — тогда выбирает принудительно (rt.fishRodForce).
// Выбор: «Выбрать» → окно «Выбор удочки» → лучшая (выше заточка, потом шанс Old Box) → её кнопка.
const ROD_NONE_RE = /не\s*выбран|не\s*обран|не\s*вибран|not\s*selected|без\s*удочк|без\s*вудк|нет\s*удочк|немає\s*вудк/i;
const rodText = (...args) => L2V7Modules.fishing.rodText(...args);
async function fishRod(...args) { return L2V7Modules.fishing.fishRod(...args); }
async function fishPrepare(...args) { return L2V7Modules.fishing.fishPrepare(...args); }
// урон удара: «Reeling + Soulshot — 75 урона» — копим средний урон с зарядом и без (для расчёта выгоды зарядов)
let fishShotsSess = 0;                            // заряды, потраченные с прошлой пойманной рыбы
function fishDmgNote(...args) { return L2V7Modules.fishing.fishDmgNote(...args); }
async function fishCaught(...args) { return L2V7Modules.fishing.fishCaught(...args); }
function fishRateTxt(...args) { return L2V7Modules.fishing.fishRateTxt(...args); }
async function fishFight(...args) { return L2V7Modules.fishing.fishFight(...args); }
async function fishing(...args) { return L2V7Modules.fishing.fishing(...args); }
let fishNoResp = 0, fishGearN = 0, fishCast = null;   // 7.2.1: fishCast — текущий заброс {bait, t} для замера наживки

// ---------- цикл рыбака: разделка улова в инвентаре → обмен продуктов на Proof ----------
// Инвентарь (/char.html), вкладка «Рибалка»: строка предмета → значок → окно: «MAX» → «Разрезать» (рыба) или «Открыть» (Old Box).
// «Рыболовный магазин» (/fishing-shop.html), «Обмен материалов»: Fish Oil 25→1 Proof, Fish Scale 5→1, Fish Gem 4→1 … «макс» → «Обменять».
const isChar = () => /\/char\.html/i.test(location.pathname);
const isFishShop = () => /\/fishing-shop\.html/i.test(location.pathname);
const MATERIAL_RE = /fish oil|fish scale|fish gem|fish bone|lure|наживк|soulshot|заряд|rod|удочк|вудк|proof|scroll|свиток|сувій|пергамент/i;
const itemJson = r => { try { return JSON.parse(r.dataset.itemJson || '{}'); } catch (e) { return {}; } };
async function fishCut(...args) { return L2V7Modules.fishing.fishCut(...args); }
async function fishExchange(...args) { return L2V7Modules.fishing.fishExchange(...args); }

// ---------- 🎣 заточка удочки (разметка 09.10): инвентарь → «Рибалка» → удочка → окно предмета:
// #char-bag-modal-rod-enchant-row: #char-rod-enchant-scroll-qty (свитков) + кнопка #char-bag-modal-rod-enchant «Заточить удочку»,
// итог — #char-rod-enchant-result. Уровень — в названии «Fishing Rod +2» (и в «Выбор удочки» на рыбалке). Максимум +10.
// Свитки: «Рыболовный магазин» → «Ресурсы» → «Товары» → «Fishing Rod Enchant Scroll x1» (100 Proof), button[data-offer="rod_enchant_scroll_x1"].
// Точим только вне вываживания рыбы (служебный шаг между рыбалками).
const ROD_RE2 = /fishing rod|вудк|удочк/i;
// 8.0 (аудит рыбалки, лог 10.10 18:48:52–57 и 19:21:25–30): после заточки бот 3 раза подряд прыгал fishing.html ↔ char.html
// («удочка +1/+10, свитков нет» ×3): результат setRt перед переходом не проверялся — запись «отложена» (повтор через 3 с /
// вкладка ещё не хозяин), а новая страница читала из хранилища старое fishService:'rod' и уводила обратно в инвентарь.
// Теперь перед переходом ждём, пока очередь записей реально дошла до хранилища (до 5 с, потом — переход как раньше)
async function rtCommit(maxMs = 5000) {
  const t0 = Date.now();
  let r = await rtWriter.recover().catch(e => ({ ok: false, reason: String(e) }));
  while (!r?.ok && on && Date.now() - t0 < maxMs) {
    await sleep(400);
    r = await rtWriter.recover().catch(e => ({ ok: false, reason: String(e) }));
  }
  if (!r?.ok) console.warn(TAG, 'состояние не записано перед переходом', r);
  return !!r?.ok;
}
const rodLvlOf = t => { const m = String(t || '').match(/\+\s*(\d{1,2})\b/); return m ? +m[1] : null; };
async function rodScrollsBuy(rodTo, proof) {
  const top = $q('#fishing-shop-tab-resources');
  if (top && !top.classList.contains('l2-fishing-special-shop-tab--active')) { fire(top); await sleep(rnd(500, 800)); }
  const tab = $q('#fishing-shop-tab-products');
  if (tab && !tab.classList.contains('l2-fishing-special-shop-tab--active')) { fire(tab); await sleep(rnd(600, 900)); }
  const row = () => $q('button[data-offer="rod_enchant_scroll_x1"]')?.closest('.l2-fshop-row');
  if (!(await waitFor(row, 4000, 150))) { rec('B','удочка','свиток отсутствует в магазине'); return { have: 0, bought: 0 }; }
  const owned = () => +((row()?.querySelector('.l2-fshop-row__owned-qty')?.textContent || '').replace(/\D/g,'') || 0);
  const lvl = Number.isFinite(rt.rodLvl) ? rt.rodLvl : null;
  if (lvl == null || lvl < 0 || lvl > 10) { rec('B','удочка','уровень неизвестен: сначала проверю инвентарь'); return {have:0,bought:0}; }
  const need = Math.max(0, rodTo - lvl);
  if (!need || owned()) return { have: owned(), bought: 0 };
  // Exactly one scroll per iteration. Re-check current enchant after each attempted use.
  const btn = row()?.querySelector('button[data-offer="rod_enchant_scroll_x1"]');
  if (!btn || btn.disabled || proof() < 100) {
    rec('B','удочка',`+${lvl}/+${rodTo}: недостаточно Proof на следующий свиток`);
    return {have: 0, bought: 0};
  }
  const before = $q('#fishing-shop-success')?.textContent || '', q0 = owned(), p0 = proof();
  fire(btn);
  const ok = await waitFor(() => owned() > q0 || proof() < p0 || ($q('#fishing-shop-success')?.textContent || '') !== before, 6000, 150);
  if (!ok) { rec('B','удочка','покупка свитка не подтверждена, повтор позже'); return {have:0,bought:0}; }
  // 8.0.3 (лог 11.10 10:54:50): «куплен один свиток …: +4 → +10» читалось как заточка до +10 — это уровень сейчас и цель игрока
  rec('B','удочка',`куплен свиток заточки за 100 Proof (удочка сейчас +${lvl}, цель +${rodTo})`);
  return {have: owned(), bought: 1};
}
async function rodEnchant() {
  const rodTo = Math.min(10, Math.max(0, +cfg.rodEnchantTo || 0));
  setStatus(`Удочка: цель +${rodTo}`);
  const tab = await waitFor(() => $q('button[data-fishing-inventory-tab]'), 10000, 200);
  if (!on) return;
  if (tab && tab.getAttribute('aria-selected') !== 'true') { fire(tab); await sleep(rnd(500,900)); }
  const rodRows = () => [...document.querySelectorAll('.l2-char-bag-row')].filter(r => { const n = r.querySelector('.l2-char-bag-name')?.textContent || itemJson(r).name || ''; return ROD_RE2.test(n) && !/scroll|свиток|сувій/i.test(n); });
  // 7.1.30: точим ВЫБРАННУЮ удочку (rt.fishRodName, напр. «Fishing Rod +5»), а не первую попавшуюся в сумке
  const selName = String(rt.fishRodName || '').replace(/\s*(?:\+\d+)?\s*(?:Шанс.*)?$/i, '').trim().toLowerCase();
  const selEnch = +(String(rt.fishRodName || '').match(/\+(\d+)/) || [])[1] || 0;
  const row = await waitFor(() => { const rows = rodRows(); if (!rows.length) return null;
    const hit = rows.find(r => { const n = (r.querySelector('.l2-char-bag-name')?.textContent || '').toLowerCase(); const e = +(n.match(/\+(\d+)/) || [])[1] || +itemJson(r).enchant || 0; return selName && n.includes(selName) && e === selEnch; });
    return hit || rows[0]; }, 5000, 200);
  const finish = async (why, next = null) => {
    if (why) rec('B','удочка',why);
    fire($q('#char-bag-modal-close')); await sleep(200);
    await setRt({ fishService: next, rodGoalWaitingProof: !!rt.rodGoalActive && !next });
    await rtCommit();                              // 8.0: без этого новая страница видела старое fishService:'rod' (круги fishing ↔ char)
    if (next === 'exchange') { location.href = '/fishing-shop.html'; await sleep(3500); return; }
    if (next === 'rod') { location.href = '/char.html'; await sleep(3500); return; }
    if (await fishSvcDone(why)) return;
    if (on) { await rtCommit(); location.href = fishNow() ? '/fishing.html' : '/map.html'; await sleep(3500); }
  };
  if (!row) return finish('удочки в сумке не найдено: никаких покупок');
  const item = itemJson(row);
  fire(row.querySelector('.l2-char-bag-icon--stats') || row);
  const lvlNow = () => rodLvlOf($q('#char-bag-modal-title')?.textContent) ?? rodLvlOf(row.textContent)
    ?? (Number.isInteger(item.enchant) ? item.enchant : null);
  if (!(await waitFor(() => shown($q('#char-bag-modal-rod-enchant-row')), 4000, 100))) {
    return finish('окно заточки недоступно (возможно, рыба ещё на крючке)');
  }
  let lvl = lvlNow();
  if (lvl == null || lvl < 0 || lvl > 10) return finish('реальный уровень заточки неизвестен, покупку отменяю');
  await setRt({ rodLvl: lvl });
  if (lvl >= rodTo) {
    await setRt({ rodGoalActive: false, rodGoalWaitingProof: false, rodLvl: lvl });
    return finish(`удочка +${lvl}: цель +${rodTo} достигнута, теперь рыбалка и накопление Proof`);
  }
  const scrolls = () => +(($q('#char-rod-enchant-scroll-qty')?.textContent || '').match(/\d+/)?.[0] || 0);
  if (!scrolls()) return finish(`удочка +${lvl}/+${rodTo}, свитков нет`, rt.fishProof >= 100 ? 'exchange' : null);
  // A single enchant per iteration: success must be reflected by the actual item or the server message.
  const btn = $q('#char-bag-modal-rod-enchant');
  if (!btn || btn.disabled || !shown(btn)) return finish('кнопка заточки недоступна');
  const r0 = $q('#char-rod-enchant-result')?.textContent || '', s0 = scrolls();
  fire(btn);
  const confirmed = await waitFor(() => ($q('#char-rod-enchant-result')?.textContent || '') !== r0 || scrolls() !== s0, 6500, 150);
  const res = ($q('#char-rod-enchant-result')?.textContent || '').replace(/\s+/g,' ').trim();
  const nextLvl = rodLvlOf(res) ?? lvlNow();
  if (/завершите текущую рыбалку|завершіть поточну рибалку|target_active/i.test(res))
    return finish('игра отклонила заточку: сначала завершить текущую рыбалку');
  if (!confirmed) return finish('нет подтверждения заточки: повтор позже');
  if (nextLvl != null && nextLvl >= 0 && nextLvl <= 10) lvl = nextLvl;
  rec('B','удочка',`попытка заточки +${item.enchant ?? '?'} → +${lvl}: ${res.slice(0,100)}`);
  await setRt({rodLvl:lvl});
  if (lvl >= rodTo) {
    await setRt({ rodGoalActive:false, rodGoalWaitingProof:false });
    return finish(`удочка +${lvl}: цель достигнута, перехожу на ловлю и накопление Proof`);
  }
  return finish(`удочка +${lvl}/+${rodTo}, следующий свиток`, scrolls() ? 'rod' : (rt.fishProof >= 100 ? 'exchange' : null));
}
// «🔪 Разделать всю рыбу → Proof» из меню (rt.fishSvc): выполнено — вернуть бота как было (stopAfter — бот стоял до нажатия)
async function fishSvcDone(...args) { return L2V7Modules.fishing.fishSvcDone(...args); }

// ---------- цель рыбалки (v4.35): поймать N рыб / собрать N Proof (считается с момента постановки) — потом стоп ----------
async function fishTgtAdd(...args) { return L2V7Modules.fishing.fishTgtAdd(...args); }
async function fishTgtReached(...args) { return L2V7Modules.fishing.fishTgtReached(...args); }
async function goFishing(...args) { return L2V7Modules.fishing.goFishing(...args); }

// ---------- персонажи: у каждого своё состояние (кампания, квесты, РБ, профили скиллов) и свои роли панели ----------
const heroNick = () => (($q('#l2-hud-legacy-name .l2-player-identity__nick')?.childNodes[0]?.textContent)
  || $q('#l2-hud-legacy-name')?.textContent || '').trim();
const ROLE_KEYS = ['nAttack', 'nPower', 'nStun', 'nBuffs', 'nShots', 'nMpPot', 'nHpPot', 'nWeaponMain', 'nCharge', 'nForce', 'nHeal', 'nKeyBuffs', 'nToggles', 'nSpoil', 'nSpoilMass', 'nSweep', 'nUltra', 'nDrain', 'nPetBuffs'];
// страница переведена браузером (Google Translate): текст искажён — ник «Teddy» превращается в «Тедди»
const pageTranslated = () => /translated-(ltr|rtl)/.test(document.documentElement.className) || !!$q('font[style*="vertical-align"]');
async function switchChar() {
  const nick = heroNick();
  if (!nick) return;
  if (on && !tabOwner) return;
  if (pageTranslated()) {                        // не принимать «нового персонажа» из перевода; перевод отключаем и обновляем страницу
    document.documentElement.setAttribute('translate', 'no');
    if (Date.now() - (rt.trReloadT || 0) > 60000) {
      await setRt({ trReloadT: Date.now() });
      rec('S', 'перевод', `страница переведена браузером (ник «${nick}») — отключаю перевод и обновляю страницу`);
      location.reload();
    }
    return;
  }
  if (rt.char === nick) return;
  // Commit outstanding changes before snapshotting the previous character.
  const savedState = await rtWriter.recover();
  if (!savedState.ok) { rec('S', 'хранилище', 'смена персонажа отложена: состояние ещё не сохранено'); return; }
  rtWriter.clear();
  // Переключение выполняется атомарно на фоне после проверки владельца.
  // Другие вкладки больше не могут перезаписать общий rt/cfg чужим персонажем.
  const result = await ipc({ cmd: 'charSwitch', epoch: leaseEpoch, vis: document.visibilityState === 'visible', nick,
    src: TAB_ID, roles: ROLE_KEYS, defRt: DEF_RT });
  if (!result?.ok) { if (on) { tabOwner = false; tabIdle = true; leaseEpoch = null; rtWriter.clear(); window.__lockT = 0; await sleep(2000); } return; }   // 7.1.30: без паузы крутилось без сна
  rt = { ...DEF_RT, ...(result.rt || {}) }; cfg = mergeCfg(result.cfg);
  if (result.changed) rec('S', 'персонаж', `${result.old || 'новый'} → ${nick}: своё состояние и роли`);
}

// ---------- главный цикл ----------
// ---------- оружие из инвентаря: что есть, что «в класс», выбор игроку ----------
// Профессия — «Персонаж» (/character.html, #character-profession: «Titan»). Инвентарь — /char.html:
// надетое — img[data-l2-slot="weapon"] (имя по иконке → база предметов), сумка — .l2-char-bag-row[data-item-json] (itemId → база),
// фильтр «Оружие» — [data-inv-cat="weapon"], страницы — #char-bag-pager, надеть — .l2-char-bag-equip--wear «[Надеть]».
// ожидание, которое работает и при выключенном боте (проверка оружия кнопкой меню)
async function waitX(fn, timeout = 5000, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const r = fn(); if (r) return r; await sleep(step); }
  return null;
}
const isCharacter = () => /\/character\.html/i.test(location.pathname);
const GRADE_LV = { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 };
const W2H = ['двуруч. меч', 'двуруч. дубина'], WDUAL = ['парные мечи'], WDAG = ['кинжал'], WBOW = ['лук'], W1H = ['меч', 'дубина'];
const MAGE = '#mage';
// профессия Interlude → виды оружия по приоритету (MAGE — смотрим маг. атаку)
const CLASS_W = {};
const cw = (list, w) => list.split(',').forEach(n => CLASS_W[n.trim().toLowerCase()] = w);
cw('Orc Monk, Monk, Tyrant, Grand Khavatari', ['кастеты']);
cw('Orc Raider, Destroyer, Titan', W2H);
cw('Warlord, Dreadnought', ['древковое']);
cw('Human Warrior, Warrior', ['древковое', 'парные мечи', 'двуруч. меч']);
cw('Gladiator, Duelist, Bladedancer, Spectral Dancer', WDUAL);
cw('Swordsinger, Sword Muse', ['парные мечи', 'меч']);
cw('Rogue, Treasure Hunter, Adventurer, Elven Scout, Plainswalker, Wind Rider, Assassin, Abyss Walker, Ghost Hunter', WDAG);
cw('Hawkeye, Sagittarius, Silver Ranger, Moonlight Sentinel, Phantom Ranger, Ghost Sentinel', WBOW);
cw('Human Knight, Knight, Paladin, Phoenix Knight, Dark Avenger, Hell Knight, Elven Knight, Temple Knight, Evas Templar, Eva\'s Templar, Palus Knight, Shillien Knight, Shillien Templar', W1H);
cw('Human Fighter, Elven Fighter, Dark Elven Fighter, Dark Fighter', ['меч', 'дубина', 'двуруч. меч', 'древковое']);
cw('Orc Fighter', ['кастеты', 'двуруч. меч', 'двуруч. дубина']);
cw('Dwarven Fighter, Scavenger, Bounty Hunter, Fortune Seeker', ['дубина', 'двуруч. дубина', 'древковое']);
cw('Artisan, Warsmith, Maestro', ['дубина', 'двуруч. дубина']);
cw('Mage, Human Mage, Mystic, Human Wizard, Wizard, Sorcerer, Sorceror, Necromancer, Warlock, Cleric, Bishop, Prophet, Elven Mage, Elven Wizard, Spellsinger, Elemental Summoner, Elven Oracle, Elven Elder, Dark Elven Mage, Dark Mage, Dark Wizard, Spellhowler, Phantom Summoner, Shillien Oracle, Shillien Elder, Orc Mage, Orc Shaman, Overlord, Warcryer, Archmage, Soultaker, Arcana Lord, Cardinal, Hierophant, Mystic Muse, Elemental Master, Evas Saint, Eva\'s Saint, Storm Screamer, Spectral Master, Shillien Saint, Dominator, Doomcryer', [MAGE]);
const heroLevel = () => +($q('#l2-hud-legacy-lvl')?.textContent.match(/\d+/)?.[0] || 0);
const iconStem = src => (src || '').split('/').pop().replace(/\.\w+$/, '').replace(/_i\d+$/, '').replace(/[_-]+/g, ' ').trim();
// виды оружия «в класс»: по профессии; если профессии нет — по требованиям атакующих скиллов на панели (поле w базы IL)
const normalizeProfession = name => String(name || '').trim().replace(/[_\s-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
function combatProfileKind() {
  if (cfg.combatProfile === 'fighter' || cfg.combatProfile === 'mage_summoner') return cfg.combatProfile;
  const normalized = normalizeProfession(rt.prof);
  if ((CLASS_W[normalized] || [])[0] === MAGE) return 'mage_summoner';
  if (CLASS_W[normalized]) return 'fighter';
  if (/\b(?:mage|mystic|wizard|warlock|summoner|arcana lord|sorcer|necromancer|bishop|prophet|cleric|spellhowler|spellsinger|oracle|elder|shaman|overlord|warcryer)\b/.test(normalized)) return 'mage_summoner';
  // 9.2 (игрок: «научить универсальности — незнакомый герой или профессия»): профессии нет в списке — по ветке класса из ответов игры
  // (character.classBranch: mystic/fighter), а без неё — по панели боя: ≥ 2 заклинания «Маг. атака» и ни одного удара воина → маг
  if (normalized && /\b(?:fighter|warrior|knight|rogue|archer|scout|raider|monk|artisan|smith|dancer|singer)\b/.test(normalized)) return 'fighter';
  if (rt.classBranch === 'mystic') return 'mage_summoner';
  if (rt.classBranch === 'fighter') return 'fighter';
  if (isBattle()) {
    const sk = panelInventory().filter(x => x.kind === 'скилл').map(x => ilOf(x.name) || {});
    const mag = sk.filter(il => il.c === 'Маг. атака' || il.t === 'MDAM' || il.t === 'MDAMDOT').length, phys = sk.filter(il => il.c === 'Физ. атака' || il.t === 'PDAM').length;
    if (mag >= 2 && !phys) return 'mage_summoner';
    if (phys >= 1 && !mag) return 'fighter';
  }
  return null;
}
function classWeaponTypes(...args) { return L2V7Modules.equipment.classWeaponTypes(...args); }
function weaponOf(...args) { return L2V7Modules.equipment.weaponOf(...args); }
const baseName = n => (n || '').replace(/\s*[×x]\d+$/, '').replace(/^\+\d+\s*/, '').trim();
// рейтинг для выбора: вид «в класс» (чем выше в списке — тем лучше), разрешён грейдом по уровню, затем атака
function rankWeapons(...args) { return L2V7Modules.equipment.rankWeapons(...args); }
async function readWeaponsPage(...args) { return L2V7Modules.equipment.readWeaponsPage(...args); }
// предмет по иконке: «scallop_jamadhr.png», «weapon_scallop_jamadhr_i00.png», «glaive_d.jpg» → запись базы
function itemByIcon(src) {
  const stem = iconStem(src);
  const tries = [stem, stem.replace(/^weapon\s+/, ''), stem.replace(/\s+[dcbas]$/, ''), stem.replace(/\s+(i\d+|\d+)$/g, '')];
  for (const t of tries) { const it = t && itemOf(t); if (it) return it; }
  return null;
}
async function equippedWeapon(...args) { return L2V7Modules.equipment.equippedWeapon(...args); }
async function scanInventoryWeapons(...args) { return L2V7Modules.equipment.scanInventoryWeapons(...args); }
// при необходимости — надеть оружие «в класс» из сумки (страницы перелистываем до нужной строки)
async function wearFromBag(...args) { return L2V7Modules.equipment.wearFromBag(...args); }
// полный проход: «Персонаж» (профессия) → «Инвентарь» (оружие) → назад. Запускается кнопкой меню или раз на старте.
async function invScanStep(...args) { return L2V7Modules.equipment.invScanStep(...args); }
let invBusy = false;
async function invScanDrive(...args) { return L2V7Modules.equipment.invScanDrive(...args); }
async function invScanStart(...args) { return L2V7Modules.equipment.invScanStart(...args); }

// ---------- закупка расходников в «Магазине вещей» (/gm-shop.html) ----------
// Список: банки HP/MP, заряды по грейду оружия (воин — «Заряд душі воїна», маг — «Благословенний заряд духу»),
// Spirit Ore / Soul Ore. Наличие — по инвентарю (itemId), покупка: строка → «Купить» → окно «Количество» → «Купить».
// Резерв адены не трогаем; за один заход тратим не больше лимита.
const SHOT_IDS = { NG: 1835, D: 1463, C: 1464, B: 1465, A: 1466, S: 1467 }, BSPS_IDS = { NG: 3947, D: 3948, C: 3949, B: 3950, A: 3951, S: 3952 };
const pair = (v, d) => { const m = String(v ?? d).match(/(\d+)\s*\/\s*(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; };
function shopPlan(...args) { return L2V7Modules.economy.shopPlan(...args); }
// быстрая проверка по панели боя (без похода в инвентарь): кончаются банки или заряды?
function shopNeedByPanel(...args) { return L2V7Modules.economy.shopNeedByPanel(...args); }
async function bagCounts(...args) { return L2V7Modules.economy.bagCounts(...args); }
const shopAdena = (...args) => L2V7Modules.economy.shopAdena(...args);
async function shopBuyOne(...args) { return L2V7Modules.economy.shopBuyOne(...args); }
// поход за покупками: инвентарь (сколько есть) → магазин (по вкладкам грейда) → назад к делу
async function shopStep(...args) { return L2V7Modules.economy.shopStep(...args); }
// v5.2.2: перед вылетом к РБ — банок HP (обычных, из магазина) не меньше минимума «Банки HP» (по умолчанию 300).
// Счёт: панель боя, вне боя — запомненный запас (rt.pots). Не хватает — сначала магазин (не чаще раза в 10 мин,
// чтобы при нехватке адены не бегать туда-сюда).
const HP_SHOP_RE = /зцілен|исцелен|healing/i, HP_BIG_RE = /велик|больш|greater/i;
function hpPotStock(...args) { return L2V7Modules.economy.hpPotStock(...args); }
async function rbShopFirst(...args) { return L2V7Modules.raid.rbShopFirst(...args); }
// ---------- 🏛 v5.3: ФАРМ КАТАКОМБ / НЕКРОПОЛЕЙ (Меню → «Катакомбы — Некрополи») ----------
// Путь (снимки и журнал 08.10): /catacombs.html — строки .l2-rb-row, кнопка button.l2-rb-row__tp[data-dungeon-id] «Телепорт»
// (Аден 1) → карта у входа: p#map-dungeon-enter > a#map-dungeon-enter-link «Войти в подземелье» (/dungeon.html?dungeonId=…&enter=1)
// → /dungeon.html: ul#dungeon-mob-list (строки как на карте: a[href*="battle"] «Имя · ур. N»), окно моба #dungeon-mob-modal
// с «В бой» #dungeon-mob-modal-battle, выход a.l2-dungeon-back__link «На поверхню». После боя бот возвращается в подземелье.
// Уровни: стартовая прикидка (Interlude), дальше — по мобам, которых бот сам увидел внутри (rt.catLv).
const CAT_URL = '/catacombs.html';
const CAT_LIST = {
  necropolis_of_sacrifice: ['Necropolis of Sacrifice', 20, 30], pilgrims_necropolis: ["The Pilgrim's Necropolis", 30, 40],
  patriots_necropolis: ["The Patriot's Necropolis", 54, 54], necropolis_of_worship: ['Necropolis of Worship', 42, 43],
  necropolis_of_devotion: ['Necropolis of Devotion', 60, 70], necropolis_of_martyrdom: ['Necropolis of Martyrdom', 60, 70],
  saints_necropolis: ["The Saint's Necropolis", 70, 80], disciples_necropolis: ["The Disciple's Necropolis", 70, 80],
  catacomb_of_the_heretic: ['Catacomb of the Heretic', 30, 40], catacomb_of_the_branded: ['Catacomb of the Branded', 40, 50],
  catacomb_of_the_apostate: ['Catacomb of the Apostate', 50, 51], catacomb_of_the_witch: ['Catacomb of the Witch', 60, 72],   // 9.0: Witch — живой список 11.10 (60–72)
  catacomb_of_dark_omens: ['Catacomb of Dark Omens', 70, 80], catacomb_of_the_forbidden_path: ['Catacomb of the Forbidden Path', 75, 76],
};
const isCatPage = (...args) => L2V7Modules.dungeons.isCatPage(...args);
const isDungeon = (...args) => L2V7Modules.dungeons.isDungeon(...args);
const dungeonHere = (...args) => L2V7Modules.dungeons.dungeonHere(...args);
const catLv = (...args) => L2V7Modules.dungeons.catLv(...args);
function catTarget(...args) { return L2V7Modules.dungeons.catTarget(...args); }
function dungeonMobs(...args) { return L2V7Modules.dungeons.dungeonMobs(...args); }
async function catGo(...args) { return L2V7Modules.dungeons.catGo(...args); }
async function catHunt(...args) { return L2V7Modules.dungeons.catHunt(...args); }
const sealDue = (...args) => L2V7Modules.dungeons.sealDue(...args);   // 9.0: камни печати → Ancient Adena
async function sealStep(...args) { return L2V7Modules.dungeons.sealStep(...args); }
// ---------- ⚔ v5.4: TvT (Город → TvT Arena) — запись, бой «убить как можно быстрее, по возможности застанить», итог ----------
// Расписание и состояние — из ответов игры (сетевой «жучок»): GET /game/tvt { phase REGISTRATION/…/ACTIVE/…, isRegistered,
// myTeam, schedule.next { registrationOpensAt, preparationStartsAt, battleStartsAt } } и GET /game/tvt/combat/sync
// { self, selectedTarget{hp,cp,alive,stunnedUntil}, … }. Слоты (игровое время): 08:00, 15:00, 20:00, запись за 10 мин.
// Окно «Зарегистрироваться на TvT? Да» (#l2-tvt-registration-prompt) всплывает на любой странице — жмём «Да».
// Бой на /tvt-arena.html: враги — .l2-tvt-nick[data-target-kind="enemy"][data-character-id] (клик = цель), панель скиллов —
// та же, что в бою с мобами. Цель — живой враг, которого быстрее всего добить (меньше HP+CP); стан, пока цель не в стане;
// дальше сильнейшие удары. Награда за победу: 500 000 аден, Coin of Luck, 2 Shil Coins (если не «afk» — поэтому бьём всегда).
var TVT = null, TVTC = null;                        // последние ответы /game/tvt и /game/tvt/combat/sync (+ время получения)
const tvtNow = (...args) => L2V7Modules.tvt.tvtNow(...args);  // серверное время
// v5.6: время в ответе — число (мс); если игра пришлёт строку ISO — разбираем, а не получаем NaN
const tvtMs = (...args) => L2V7Modules.tvt.tvtMs(...args);
function tvtState(...args) { return L2V7Modules.tvt.tvtState(...args); }
const isArena = (...args) => L2V7Modules.tvt.isArena(...args);
function tvtSoon(...args) { return L2V7Modules.tvt.tvtSoon(...args); }
async function tvtStep(...args) { return L2V7Modules.tvt.tvtStep(...args); }
async function tvtLeave(...args) { return L2V7Modules.tvt.tvtLeave(...args); }
function tvtEnemies(...args) { return L2V7Modules.tvt.tvtEnemies(...args); }
async function tvtFight(...args) { return L2V7Modules.tvt.tvtFight(...args); }
// ---------- 🐉 v5.5: ФАРМ ЭПИКОВ (Меню → «Эпик боссы», /epic-bosses.html) ----------
// Эпик — тот же РБ (метка l2-map-mob-pin--epic, id l2dop_rb_29xxx, «Закен · ур. 60 · эпик-босс»), но за один заход его обычно не убить.
// 8.0.3 (эпики, разбор 11.10): сначала безопасность. Список — из ответа игры GET /game/epic-bosses (жив/мёртв, респаун в часах, цена,
// canAttack; сервер пускает к боссам не ниже «герой − 9»), цифры босса — GET /game/spawn/<id>/info; оба запроса — те же, что шлёт игра.
// Цикл: выбор (жив, игра пускает, вердикт «по силам») → банки → бафф → хил → дорога: эпик на этой карте — без телепорта → логово за
// адену → «Телепорт» за Coin of Luck только через единые ворота (epicPayGate) и лимит (0 — не тратить), не больше 1 платного захода на
// появление. Смерть: заходами — только если подтверждено, что HP эпика между заходами сохраняется (не проверено в живой игре),
// иначе ждём следующего появления; смертей на эпика по умолчанию 3. Миньоны зоны мешают открыть бой — бьём ближайшего.
// Состояние: rt.epic = { step, k, id, name, at, via, deaths, hpLog, noPay, … }, база: rt.epicDb[k] = { id, name, lvl, alive, aliveT, deadT,
// until, respH, canAttack, deny, col, adena, apiT, verdict, paidN, persist, seenZone, lairOkT, lairBadT, skipT, why, kills, deaths }.
const EPICS = [
  { k: 'ak', lvl: 40,        nm: 'Королева Муравьёв (АК)', ids: [29001], re: /^(queen ant|королева мурав\S*|королева мурах\S*)$/i, tp: 'ant_nest' },
  { k: 'core', lvl: 50,      nm: 'Ядро (Core)',            ids: [29006], re: /^(core|ядро)$/i,                                     tp: 'cruma_tower' },
  { k: 'orfen', lvl: 50,     nm: 'Орфен',                  ids: [29014], re: /^(orfen|орфен)$/i,                                   tp: 'sea_of_spores' },
  { k: 'baium', lvl: 75,     nm: 'Баюм',                   ids: [29020], re: /^(baium|баюм)$/i,                                    tp: 'tower_of_insolence' },
  { k: 'valakas', lvl: 85,   nm: 'Валакас',                ids: [29028], re: /^(valakas|валакас)$/i,                               tp: null },
  { k: 'antharas', lvl: 79,  nm: 'Антарас',                ids: [29019, 29066, 29067, 29068], re: /^(antharas|антарас)$/i,         tp: 'antharas_lair' },
  { k: 'frintezza', lvl: 90, nm: 'Фринтеза',               ids: [29045], re: /^(frintezza|фринтез\S*|фрінтез\S*)$/i,               tp: null },
  { k: 'zaken', lvl: 60,     nm: 'Закен',                  ids: [29022], re: /^(zaken|закен)$/i,                                   tp: 'devils_isle' },
];
const EPIC_URL = '/epic-bosses.html';
const isEpicPage = (...args) => L2V7Modules.epics.isEpicPage(...args);
const epicOn = (...args) => L2V7Modules.epics.epicOn(...args);
const autonomyMode = () => L2EngineCore.chooseMode({
  epic: epicOn(), raid: huntOn(), fish: !!cfg.fishMode,
  cat: !!cfg.catMode, campaign: !!cfg.campaign
});
// эпики + рыбалка: эпиков подходящих нет (выбор цели) — бот рыбачит; места «куда вернуться» и «мягкая ошибка» считают это рыбалкой
const fishNow = (...args) => L2V7Modules.fishing.fishNow(...args);
const epicNum = (...args) => L2V7Modules.epics.epicNum(...args);
const epicById = (...args) => L2V7Modules.epics.epicById(...args);
const epicByName = (...args) => L2V7Modules.epics.epicByName(...args);
const epicOf = (...args) => L2V7Modules.epics.epicOf(...args);
const epicWant = (...args) => L2V7Modules.epics.epicWant(...args);
// метки эпиков на карте (и на всякий случай — «рейдовые» метки с id эпика)
function epicPins(...args) { return L2V7Modules.epics.epicPins(...args); }
function epicGuards(...args) { return L2V7Modules.epics.epicGuards(...args); }
// страница «Эпик боссы»: 8.0.3 (эпики, разбор 11.10): строка .l2-rb-row (снимок 75dac78f) — имя, уровень, статус (--alive/--dead), респаун,
// цена .l2-rb-row__price-gold («1 Coin of Luck»), подсказка «Недоступно» в соседнем .l2-rb-row__actions, кнопка .l2-rb-row__tp;
// широкий разбор (любой data-spawn-id эпика, строка с именем и «Телепорт») — запасной.
function epicRowsParse(...args) { return L2V7Modules.epics.epicRowsParse(...args); }
function epicTpBtn(...args) { return L2V7Modules.epics.epicTpBtn(...args); }
async function epicListScan(...args) { return L2V7Modules.epics.epicListScan(...args); }
async function epicSet(...args) { return L2V7Modules.epics.epicSet(...args); }
async function epicDbSet(...args) { return L2V7Modules.epics.epicDbSet(...args); }
// кого бить: начатого добиваем; дальше — по порядку списка, кроме мёртвых (по списку игры, 15 мин), запрещённых и «отложенных»
// 8.0.3 (эпики, разбор 11.10): сервер пускает к боссам не ниже «герой − 9» (minRaidBossLevel), сверху — предохранитель бота: герой + 10.
// Настройка epicLvlUp — пожелание, а не запрет:
// если все живые эпики ниже пожелания, всё равно берём доступного по уровню.
const epicLvl = (...args) => L2V7Modules.epics.epicLvl(...args);
function epicLvlWhy(...args) { return L2V7Modules.epics.epicLvlWhy(...args); }
function epicPick(...args) { return L2V7Modules.epics.epicPick(...args); }
function epicWhyNone(...args) { return L2V7Modules.epics.epicWhyNone(...args); }
async function epicGiveUp(...args) { return L2V7Modules.epics.epicGiveUp(...args); }
// 8.0.3 (эпики, разбор 11.10): бюджеты за 24 ч. Coin of Luck: 0 — не тратить никогда, N — не больше N за 24 ч (телепорты к эпикам и
// платный «Повний баф» в режиме эпиков), не больше epicCoinPerBoss платных заходов на одно появление; адена: 0 — без лимита.
// Учитываем ПОПЫТКУ до нажатия (резерв), чтобы ошибка/перезагрузка не привела к превышению лимита; снимается только при явном отказе.
function epicTpBudgetQuote(...args) { return L2V7Modules.epics.epicTpBudgetQuote(...args); }
async function epicTpBudgetReserve(...args) { return L2V7Modules.epics.epicTpBudgetReserve(...args); }
async function epicTpBudgetRelease(...args) { return L2V7Modules.epics.epicTpBudgetRelease(...args); }
async function epicStep(...args) { return L2V7Modules.epics.epicStep(...args); }
async function shopStart(...args) { return L2V7Modules.economy.shopStart(...args); }

// ---------- v5.5.6: антибот-проверка игры и блок PvE-фарма ----------
// С 09.10 игра посреди боя показывает «Проверка активности — нажмите символы по порядку» (#l2-antibot-layer, .l2-antibot-card),
// пока она открыта, PvE-урон не проходит; не прошёл — «Фарм заблоковано на 1 годину через автоматизовану бойову активність»
// (ответ 423 pve_farm_blocked, blockedUntil). Проверку бот НЕ решает — это работа человека: бот замирает (ничего не нажимает),
// зовёт игрока уведомлением и ждёт. Во время блока PvE не долбит сервер (раньше — запрос каждые 2–3 с), ждёт до конца блока.
const abLayer = () => { const L = $q('#l2-antibot-layer'); return L && shown(L) ? L : null; };
function antibotState() {
  const L = abLayer();
  if (L && (L.querySelector('.l2-antibot-card--blocked') || /заблок|недоступ|blocked/i.test(L.textContent) && !L.querySelector('.l2-antibot-card__options'))) return 'blocked';
  if (L && (L.querySelector('.l2-antibot-card__options') || /провер|символ|перевір/i.test(L.textContent))) return 'check';
  if ((rt.pveBlockUntil || 0) > Date.now()) return 'blocked';
  return null;
}
const sendAlert = (id, title, text, sticky) => { try { chrome.runtime.sendMessage({ cmd: 'alert', id, title, text, sticky }, () => void chrome.runtime.lastError); } catch (e) {} };
const clearAlert = id => { try { chrome.runtime.sendMessage({ cmd: 'alertClear', id }, () => void chrome.runtime.lastError); } catch (e) {} };
// v5.5.7: пока висит проверка — звать игрока: сигнал (если браузер разрешил звук), мигающий заголовок вкладки, повтор уведомления раз в 45 с
let abTitle0 = null, abBlinkT = null;
function abBeep() {
  try {
    const C = window.__abAC || (window.__abAC = new (window.AudioContext || window.webkitAudioContext)());
    if (C.state === 'suspended') C.resume().catch(() => {});
    [0, 0.35].forEach(dt => { const o = C.createOscillator(), g = C.createGain(); o.type = 'square'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, C.currentTime + dt); g.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + dt + 0.25);
      o.connect(g).connect(C.destination); o.start(C.currentTime + dt); o.stop(C.currentTime + dt + 0.26); });
  } catch (e) {}
}
function abBlink(on) {
  if (on && !abBlinkT) { abTitle0 = document.title; let k = 0; abBlinkT = setInterval(() => { document.title = (k++ % 2) ? '⚠ КАПЧА — решите!' : (abTitle0 || 'L2wap'); }, 800); }
  if (!on && abBlinkT) { clearInterval(abBlinkT); abBlinkT = null; if (abTitle0 != null) document.title = abTitle0; }
}
async function antibotGuard() {                     // true — бот на паузе (ничего не делать)
  const st = antibotState();
  if (st !== 'check') abBlink(false);
  if (!st) { if (rt.abState) { rec('B', 'антибот', rt.abState === 'check' ? 'проверка пройдена — продолжаю' : 'блок PvE-фарма закончился — продолжаю'); clearAlert('ab'); await setRt({ abState: null }); } return false; }
  if (st === 'check') {
    if (rt.abState !== 'check') {
      rec('B', 'антибот', `игра показала «Проверку активности» — бот замер, решите её вручную: ${(abLayer()?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)}`);
      sendAlert('ab', '⚠ L2wap: проверка активности', 'Игра просит нажать символы по порядку. Бот на паузе — решите проверку вручную.', true);
      await setRt({ abState: 'check', abT: Date.now() });
    }
    abBlink(true);
    if (Date.now() - (window.__abBeepT || 0) > 10000) { window.__abBeepT = Date.now(); abBeep(); }          // сигнал раз в 10 с
    if (Date.now() - (window.__abNoteT || 0) > 45000) { if (window.__abNoteT) sendAlert('ab', '⚠ L2wap: проверка всё ещё ждёт', 'Нажмите символы по порядку в окне игры — бот на паузе.', true); window.__abNoteT = Date.now(); }
    const waited = Math.round((Date.now() - (rt.abT || Date.now())) / 1000);
    setStatus(`⚠ КАПЧА: решите проверку в окне игры — бот ждёт вас (${waited} с) и ничего не нажимает`);
    await sleep(1000); return true;
  }
  const until = rt.pveBlockUntil || 0, left = Math.max(0, until - Date.now());
  if (rt.abState !== 'blocked') {
    rec('B', 'антибот', `PvE-фарм заблокирован игрой${until ? ' до ' + new Date(until).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : ''}${rt.pveBlockMsg ? ' — ' + rt.pveBlockMsg : ''} · бот ждёт, сервер не трогает`);
    sendAlert('ab', '⛔ L2wap: PvE-фарм заблокирован', `${rt.pveBlockMsg || 'Блок за автоматическую боевую активность.'}${until ? ' До ' + new Date(until).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) + '.' : ''}`, false);
    await setRt({ abState: 'blocked', abT: Date.now() });
  }
  if (!until && !abLayer()) { await setRt({ abState: null }); return false; }
  if (until && left === 0 && abLayer()) {           // блок истёк, а окно «Фарм временно заблокирован» висит — закрываем его (это просто сообщение)
    const x = abLayer().querySelector('.l2-antibot-card__close, button'); if (x) { fire(x); await sleep(800); }
    await setRt({ pveBlockUntil: 0 }); return false;
  }
  setStatus(`⛔ PvE-фарм заблокирован игрой${left ? ` — ещё ${Math.ceil(left / 60000)} мин` : ''} · жду`);
  await sleep(Math.min(Math.max(left, 5000), 30000)); return true;
}

// ---------- v5.5.1: бот — только в одной вкладке ----------
// Лог 08.10: игра была открыта в двух вкладках, бот работал в обеих — два боя одновременно, «Принудительная атака» друг
// у друга, одна смерть засчитана дважды (16:30:44 и :45) → стоп «3 смерти за 30 мин» раньше времени. Теперь вкладка-хозяин
// раз в 5 с отмечается в storage (lock); другие ждут. Хозяин молчит > 90 с (вкладку закрыли; фоновые вкладки Chrome будит
// раз в минуту) — работу забирает другая.
// v5.5.10: ключ — у ВКЛАДКИ (sessionStorage живёт, пока открыта вкладка, и переживает переходы карта ↔ бой), а не у страницы.
// Раньше каждый переход давал новый ключ, а старая страница не успевала снять замок при уходе (Firefox) — новая страница той же
// вкладки ждала «другую вкладку» до 90 с
let TAB_KEY = (() => { try { let k = sessionStorage.getItem('l2botTab'); if (!k) { k = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('l2botTab', k); } return k; } catch (e) { return Math.random().toString(36).slice(2, 10); } })();
// v5.6: ключ — номер вкладки в браузере (у дубликата вкладки он свой; sessionStorage дубликат копирует → два бота с одним ключом).
// Номер не узнали (старый браузер, ошибка) — остаётся ключ из sessionStorage
const TAB_KEY_READY = chrome.runtime.sendMessage({ cmd: 'tabId' }).then(id => { if (Number.isInteger(id) && id >= 0) TAB_KEY = 'tab' + id; }).catch(() => {});
let tabOwner = false;
var tabIdle = false;
var ATK_NET = null;
var SK_NET = {};                                    // v5.5.5: когда сервер последний раз сказал откат скилла (ключ — skKey)                                // v5.5.1: темп атаки от сервера { t, wait, iv }                               // объявлен через var: setRt выше по файлу
// v5.6: в замке — видна ли вкладка (vis). Замок держит скрытая вкладка, а игрок смотрит на эту — забираем: бот должен работать
// там, где игрок (лог 09.10: «работает в другой вкладке» час подряд из невидимой копии). Отобрали замок — сразу пауза
const tabVis = () => document.visibilityState === 'visible';
// 8.0.3 (лог 11.10 11:01:56–11:37): рыбалка в фоновой вкладке — игра снимает «disabled» с кнопок умений только на своём секундном тике,
// 88 нажатий опоздали (≈48 с за час). Жать недоступную кнопку нельзя (игра отклонит или засчитает неверное нажатие) — пишем в журнал
document.addEventListener('visibilitychange', () => {
  if (!on || !tabOwner || !/\/fishing\.html/i.test(location.pathname)) return;
  rec('S', 'вкладка', document.hidden ? 'рыбалка ушла в фон — кнопки игры оживают раз в 1 с, темп ниже (держите окно рыбалки видимым)' : 'рыбалка снова на экране');
});
let lockMine = 0;
async function tabLock() {
  await TAB_KEY_READY;
  const r = await ipc({ cmd: 'lockAcquire', epoch: leaseEpoch, page: location.pathname,
    vis: tabVis(), focus: !!document.hasFocus?.() });
  tabOwner = r?.ok === true; tabIdle = !tabOwner; leaseEpoch = tabOwner ? r.epoch : null;
  if (tabOwner) lockMine = Date.now();
  return tabOwner;
}
setInterval(async () => {
  try {
    if (tabOwner && on) {
      const r = await ipc({ cmd: 'lockRenew', epoch: leaseEpoch, page: location.pathname, vis: tabVis() }, 9000);
      if (!r?.ok) { tabOwner = false; tabIdle = true; leaseEpoch = null; rtWriter.clear(); window.__lockT = 0; return; }
      lockMine = Date.now();
    }
    else if (tabOwner && !on) { try { await rtWriter.recover(); } catch (e) {} tabOwner = false; tabIdle = false; rtWriter.clear(); /* 7.1.30: дописать счётчики последнего боя */ await chrome.runtime.sendMessage({ cmd: 'lockRelease', epoch: leaseEpoch }); leaseEpoch = null; }
    else if (!on) tabIdle = false;
  } catch (e) {}
}, 5000);
// замок при уходе со страницы не снимаем: следующая страница этой же вкладки продолжит с тем же ключом; закрытую вкладку отпустит таймаут 90 с

async function main() {
  if (running) return;
  if (!on) { try { await switchChar(); } catch (e) { console.warn(TAG, 'персонаж', e); } return; }
  running = true;
  try {
  let servicesStarted = false;
  while (on) {
    try {
      if (!tabOwner || Date.now() - (window.__lockT || 0) > 30000) {
        const wasOwner = tabOwner;
        window.__lockT = Date.now();
        if (!(await tabLock())) { setStatus('⏸ Бот уже работает в другой вкладке игры — здесь жду (закройте лишнюю вкладку)'); window.__lockT = 0; await sleep(tabVis() ? 3000 : 10000); continue; }
        if (!wasOwner) {
          rec('S', 'ядро', `v${chrome.runtime.getManifest().version}: управление вкладкой получено, запускаю цикл ${location.pathname}`);
          // При передаче управления перечитываем последнюю сохранённую версию,
          // не продолжаем со снимком состояния вкладки-ожидателя.
          const fresh = await chrome.storage.local.get(['rt', 'cfg']);
          rt = { ...DEF_RT, ...(fresh.rt || {}) }; cfg = mergeCfg(fresh.cfg);
        }
      }
      // Migrations calculated during page initialization must not write without a lease.
      // Apply to the saved current character before switching to a new one.
      // 8.0.3 (проверка правки): устаревание пакета настроек — ДО записи rt и только по свежим настройкам: раньше проверка видела
      // флаг, который эта же вкладка строкой выше записала в rt, и выбрасывала ещё не применённые правки настроек
      const cfgStale = Object.keys(deferredMigrations.cfg).length > 0 && migApplied(deferredMigrations.cfg, cfg);
      if (Object.keys(deferredMigrations.rt).length) {
        // 7.1.30: пока ждали замок, хозяин мог уже применить эти миграции — снимок не затирает свежие данные
        if (migApplied(deferredMigrations.rt, rt)) deferredMigrations.rt = {};
        const patch = deferredMigrations.rt; deferredMigrations.rt = {};
        const result = await setRt(patch);
        if (!result?.ok) deferredMigrations.rt = { ...patch, ...deferredMigrations.rt };
      }
      // 8.0.3 (проверка правок по чемпионам): и для настроек — иначе вкладка, ждавшая замок, позже записывала свой старый пакет
      // разовых миграций вслепую: игрок включил «Искать чемпионов», вкладка перехватила управление — и галочка молча выключилась
      if (cfgStale) deferredMigrations.cfg = {};
      if (Object.keys(deferredMigrations.cfg).length) {
        const patch = deferredMigrations.cfg; deferredMigrations.cfg = {};
        try { await setCfg(patch); } catch (e) { deferredMigrations.cfg = { ...patch, ...deferredMigrations.cfg }; throw e; }
      }
      if (heroNick() && rt.char !== heroNick()) { await switchChar(); if (!tabOwner) continue; }
      if (!servicesStarted) {
        servicesStarted = true;
        // Справочник предметов — только при работе с сумкой, добычей и оружием.
        // Ресурсы и рецепты подгружаем лишь при активном задании (нужны для приоритетов карты).
        if (cfg.farmRes || cfg.resQuests || cfg.campaign || cfg.mmGoalItem) farmDb().catch(() => {});
        if (cfg.recipeRes) recipeDb().catch(() => {});
        try { learnSkillDb(); } catch (e) {}
      }
      // A heartbeat alone cannot detect a live but endlessly looping dispatcher.
      // Check observable progress; exclude intentional maintenance/long waits.
      const activeJob = isBattle() || !!rt.shop || !!rt.rbGo || !!rt.zoneGo || !!rt.mmJob ||
        !!rt.tbuff || (!!rt.epic && !['pick', 'prep'].includes(rt.epic.step)) ||
        !!rt.invScan || fishNow();
      const sig = [location.pathname, location.search, rt.kills, rt.rbKills,
        rt.fish?.casts || 0, rt.fish?.caught || 0, rt.epic?.step || '',
        rt.rbHunt?.step || '', rt.shop?.step || '', rt.tbuff?.step || '',
        meHp()?.cur ?? '', mobHp()?.cur ?? ''].join('|');
      if (progressMonitor.tick(sig, activeJob) === 'stalled' && !serverDown()) {
        if (!(await srvUp())) { netOutage.since = netOutage.since || Date.now(); netOutage.last = Date.now(); await serverWait(); continue; }   // 7.2.5: это простой сервера, а не зависание бота — без остановки
        const history = (rt.stallRecoveries || []).filter(t => Date.now() - t < 30 * 60000);
        rec('S', 'восстановление', `нет прогресса 9 мин: ${location.pathname}, режим ${autonomyMode()}, попытка ${history.length + 1}/3`);
        if (history.length >= 3) { await halt('Автономный режим не продвигается после 3 восстановлений за 30 мин', true); break; }
        await setRt({ stallRecoveries: [...history, Date.now()] });
        location.reload(); await sleep(5000); continue;
      }
      if (serverDown()) { await serverWait(); continue; }      // 502/503/таймаут Cloudflare — ждём, бота не останавливаем
      if (rt.downT) await serverBack();              // v5.6: сразу после восстановления сервера (раньше — после многих веток, время простоя завышалось)
      if (loginPage()) { await autoLogin(); continue; }       // выбило из игры — входим снова (логин/пароль из меню)
      if (antibotState() === 'check' && await antibotGuard()) continue;   // v5.5.6: проверка активности — ждём человека
      if (rt.revive) { await reviveStep(); await sleep(300); continue; }
      if (cfg.tvtOn && await tvtStep()) { await sleep(200); continue; }
      // 9.2 (игрок 11.10: «Лист врагов»): убийцы героя — в лист; враг на локации — нападаем кнопкой игры (с проверкой сил), следим за возвращением
      L2V7Modules.enemies.tick().catch(() => {});
      if (await L2V7Modules.enemies.step()) { await sleep(200); continue; }
      if (await antibotGuard()) continue;           // v5.5.6: блок PvE-фарма — ждём (PvP/TvT выше — можно)   // ⚔ v5.4: TvT — запись, бой, итог   // после смерти: поражение → «Вернуться в город» → статуя → бафф → восстановление
      // «🛒 Закупить сейчас» (urgent) — сразу, даже со страницы боя: бросаем моба/РБ/рыбалку
      if (rt.shop && (!isBattle() || rt.shop.urgent) && Date.now() - (rt.shop.t || 0) < 300000) { await shopStep(); await sleep(300); continue; }
      if (rt.shop && !isBattle()) await setRt({ shop: null });
      // 7.1.16-fix: магистр — на каждом чётном уровне (28, 30, 32…; перескочили чётный — идём на следующем) учим/качаем скиллы.
      // По просьбе игрока. Выключить: autoMagister: false; шаг уровней — magisterEvery (2)
      if (rt.magister && cfg.autoMagister !== true) await setRt({ magister: null });   // 7.1.30: выключили — бросаем начатый поход
      if (rt.magister && !isBattle()) { if (Date.now() - (rt.magister.t || 0) < 180000) { await magisterStep(); continue; } await setRt({ magister: null, magT: Date.now() }); }
      const magEvery = Math.max(1, cfg.magisterEvery || 2), magDue = heroLevel() ? heroLevel() - heroLevel() % magEvery : 0;
      // 7.1.30: по умолчанию ВЫКЛ (10.10: все скиллы выучены, дальше квест 2-й профы — бот застревал у магистра). Включить: «Скиллы → Магистр»
      if (cfg.autoMagister === true && !isBattle() && !fishNow() && !rt.shop && !rt.rbGo && !(rt.epic && rt.epic.step && rt.epic.step !== 'pick')
          && magDue && magDue > (rt.magLvl || 0) && Date.now() - (rt.magT || 0) > 10 * 60000) {
        if (!rt.magLvl) await setRt({ magLvl: magDue });   // первый запуск: текущий чётный уровень — точка отсчёта (только что учили руками)
        else { rec('B', 'магистр', `уровень ${heroLevel()} — иду учить скиллы`); await setRt({ magister: { t: Date.now(), lvl: magDue } }); continue; }
      }
      if (rt.tbuff && !isBattle() && Date.now() - (rt.tbuff.t || 0) < 120000) { await townBuffStep(); continue; }
      if (rt.tbuff && !isBattle()) await setRt({ tbuff: null });
      if (rt.bagCheck && !isBattle()) {              // «Пересчитать в сумке» (квесты на ресурсы)
        if (!isChar()) { location.href = '/char.html'; await sleep(4000); continue; }
        setStatus('Квесты на ресурсы: считаю сумку'); await bagCounts(); await setRt({ bagCheck: null });
        location.href = fishNow() ? '/fishing.html' : '/map.html'; await sleep(4000); continue;
      }
      if (rt.faScan && !isBattle()) {              // «Обновить список баффов FA» из меню
        if (!/\/fast-aden-buffer\.html/.test(location.pathname)) { setStatus('Баффы FA: читаю список у баффера'); location.href = '/fast-aden-buffer.html'; await sleep(4000); continue; }
        await waitX(() => $q('.l2-fa-buy[data-skill-id]'), 8000, 200); await waitX(() => /\d/.test($q('#fast-aden-balance')?.textContent || ''), 3000, 200);
        const n = faCatalogNote(); rec('B', 'бафф', `Fast Aden: в списке баффера ${n || 0}, баланс ${rt.faBal?.v ?? '?'} FA`);
        await setRt({ faScan: null }); location.href = fishNow() ? '/fishing.html' : '/map.html'; await sleep(4000); continue;
      }
      if (rt.recipeScan && !isBattle()) {          // «Обновить базу рецептов» из меню
        if (location.pathname !== RECIPE_URL) { setStatus('Рецепты: читаю «Охоту на рецепты» на форуме'); location.href = RECIPE_URL; await sleep(4000); continue; }
        await waitX(() => $q('article.l2-recipe-hunt-recipe'), 12000, 300);
        await recipeSave(); await setRt({ recipeScan: null }); location.href = '/map.html'; await sleep(4000); continue;
      }
      if (rt.farmScan && !isBattle()) { if (isFarmPage()) await farmScan(); else { location.href = FARM_URL; await sleep(4000); } continue; }
      if (rt.rbScan && !isBattle()) { if (isRbPage()) await rbListScan(); else { location.href = '/rb-bosses.html'; await sleep(4000); } continue; }
      // 8.0.3 (эпики): «🔄 Проверить эпиков (бесплатно)» — в любом режиме, только чтение с сервера (список + цифры боссов), без переходов.
      // На рыбалке и на странице боя — фоном, не останавливая вываживание и бой (≈6–10 с запросов с паузами). 8.0.3 (ревью): раньше в бою
      // ждали ухода со страницы боя, а цепочка «Охотиться дальше» с неё не уходит — «⏳ проверка запрошена» висела часами
      if (rt.epicScanReq) { if (fishNow() || isBattle()) L2V7Modules.epics.epicScanAll('по кнопке').catch(() => {}); else { await L2V7Modules.epics.epicScanAll('по кнопке'); continue; } }
      if (rt.rbGo && !isBattle()) { if (Date.now() - (rt.rbGo.t || 0) < 90000) { await rbGoStep(); continue; } await setRt({ rbGo: null }); }
      if (rt.zoneScan && !isBattle()) { if (isTeleport()) await zoneCatalogScan(); else { location.href = '/teleport.html'; await sleep(4000); } continue; }
      if (rt.zoneGo && !isBattle()) {
        const onSrc = isTeleport() || (rt.zoneGo.url && location.pathname + location.search === rt.zoneGo.url);
        if (Date.now() - (rt.zoneGo.t || 0) < 120000 && (onSrc || !rt.zoneGoT || Date.now() - rt.zoneGoT > 120000)) { await zoneGoStep(); continue; }
        await setRt({ zoneGo: null });              // уже нажали «Телепорт» и страница сменилась — улетели, дальше обычная охота
      }
      // v5.5: сторож баффов — в любом режиме вне боя (раньше проверка была только после победы и на карте)
      if (!isBattle() && !fishNow() && !tvtSoon() && !/tvt/i.test(location.pathname) && Date.now() - (rt.tbWatchT || 0) > 15000) { rt.tbWatchT = Date.now(); setRt({ tbWatchT: rt.tbWatchT }); if (await townBuffStart('сторож: баффы слетели')) continue; }
      // «🔪 Разделать всю рыбу → Proof» из меню — сразу, в любом режиме (бой с мобом и вываживание рыбы — доводим до конца)
      if (rt.fishSvc && !isBattle() && !(isFishing() && fishState())) {
        if (Date.now() - (rt.fishSvc.t || 0) > 15 * 60000) { await setRt({ fishSvc: null, fishService: null }); continue; }
        const svc = rt.fishService || 'cut';
        if (svc === 'cut') { if (isChar()) await fishCut(); else { setStatus('Разделка рыбы: иду в инвентарь'); await rtCommit(); location.href = '/char.html'; await sleep(4000); } }
        else if (svc === 'exchange') { if (isFishShop()) await fishExchange(); else { await rtCommit(); location.href = '/fishing-shop.html'; await sleep(4000); } }
        else if (svc === 'rod') { if (isChar()) await rodEnchant(); else { await rtCommit(); location.href = '/char.html'; await sleep(4000); } }
        await sleep(200); continue;
      }
      // 9.0: камни печати → Ancient Adena (кнопка «Обменять сейчас» или автообмен) — вне боя, не посреди вываживания рыбы, не в TvT и не посреди
      // захода на эпика/РБ (автообмен ждёт выбора следующего РБ)
      if (!isBattle() && !(isFishing() && fishState()) && !tvtSoon() && !/tvt/i.test(location.pathname)) {
        const sd = sealDue();
        if (sd && (sd === 'по кнопке' || (!rt.epic?.step && (!rt.rbHunt?.step || rt.rbHunt.step === 'pick')))) { await sealStep(); await sleep(200); continue; }
      }
      // 9.0 (игрок 11.10: «функция исполнения заказов» + раздел «Маммон»): заказ торговца и где стоят NPC — фоном (только GET);
      // поход к торговцу/кузнецу — вне боя и туров, с возвратом на точку охоты
      L2V7Modules.mammon.mmTick().catch(() => {});
      if (await L2V7Modules.mammon.mmStep()) { await sleep(200); continue; }
      // 9.0: квесты сабкласса/Noblesse — прогресс фоном (только GET), готовую часть бот сдаёт сам (вне боя и туров, с возвратом на точку)
      L2V7Modules.story.storyTick().catch(() => {});
      if (await L2V7Modules.story.storyStep()) { await sleep(200); continue; }
      if (epicOn()) L2V7Modules.epics.epicPollTick().catch(() => {});   // 8.0.3: список эпиков — фоном по окнам появления (только GET, без переходов)
      if (autonomyMode() === 'epic' && !isBattle()) { await epicStep(); await sleep(200); continue; }   // 🐉 v5.5: фарм эпиков — свой цикл (заход → смерть → хил → снова)
      // 8.0.3 (разбор логов 11.10): в туре оружие не читалось (строка ниже ждёт !huntOn) — после сброса памяти заряды бы не докупались.
      // Читаем на шаге выбора РБ, не чаще раза в 30 мин
      if (autonomyMode() === 'raid' && !isBattle() && cfg.weaponScanAuto !== false && !rt.weaponsT && !fishNow() && (!rt.rbHunt?.step || rt.rbHunt.step === 'pick')
          && Date.now() - (rt.invTourT || 0) > 30 * 60000) { await setRt({ invTourT: Date.now() }); await invScanStart(); continue; }
      if (autonomyMode() === 'raid' && !isBattle()) { await rbHuntStep(); await sleep(200); continue; }   // 🧭 тур по РБ — свой пошаговый цикл (после полёта в зону: v4.44)
      if (rt.invScan && Date.now() - (rt.invScan.t || 0) < 120000) { await invScanStep(); await sleep(300); continue; }
      if (rt.invScan) await setRt({ invScan: null });
      if (cfg.weaponScanAuto !== false && !rt.weaponsT && !isBattle() && !fishNow() && !(cfg.rbMode && rt.rbPending) && !huntOn()) { await invScanStart(); continue; }   // 8.0.3: дополнение «РБ между мобами» не отменяет чтение сумки
      // 9.2.3: новое оружие в сумке или открылся новый грейд — перечитать сумку (equipment.weaponRescanWhy)
      if (cfg.weaponScanAuto !== false && rt.weaponsT && !isBattle() && !fishNow() && !(cfg.rbMode && rt.rbPending) && !huntOn()) {
        const why = L2V7Modules.equipment.weaponRescanWhy(invQty(0) === null ? null : INV_NET.m, heroLevel());
        if (why) { rec('B', 'оружие', `перечитываю сумку: ${why}`); await setRt({ weapRescan: { sig: why, t: Date.now() } }); await invScanStart(); continue; }
      }
      // 8.0 (аудит рыбалки): служебный переход — только после того, как fishService дошёл до хранилища (rtCommit)
      if (fishNow() && rt.fishService === 'cut') { if (isChar()) await fishCut(); else { await rtCommit(); location.href = '/char.html'; await sleep(5000); } }
      else if (fishNow() && rt.fishService === 'exchange') { if (isFishShop()) await fishExchange(); else { await rtCommit(); location.href = '/fishing-shop.html'; await sleep(5000); } }
      else if (fishNow() && rt.fishService === 'rod') { if (isChar()) await rodEnchant(); else { await rtCommit(); location.href = '/char.html'; await sleep(5000); } }
      // 8.0 (аудит рыбалки, лог 10.10: ≈0,4 с накладных на заброс): после шага рыбалки — 30 мс вместо общих 200 мс. Проверки стопа /
      // паузы (on) / «Закупить сейчас» / TvT / сервера — в начале каждого круга, как и раньше
      else if (fishNow() && isFishing()) { await fishing(); await sleep(30); continue; }
      else if (isBattle()) await battle();
      else if (fishNow()) await goFishing();
      else if (autonomyMode() === 'cat') await catGo();         // 🏛 фарм катакомб: телепорт → «Войти в подземелье» → мобы
      else if (campOn() && isCampaign()) await campaign();
      else if (campOn() && (rt.campaignDue || !rt.campaign) && !isMap()) await goCampaign();
      else if (campOn() && isMail() && rt.campaignDue) await mailStep();
      else if (campOn() && isQuests() && rt.campaignDue) await questsStep();
      else if (isMap()) {
        if (campOn() && (rt.campaignDue || !rt.campaign)) await goCampaign();
        else await map();
      }
      else await goOutskirts();                   // город, магазин, инвентарь… — в Окрестности
      await sleep(200);
    } catch (e) { console.error(TAG, e); try { await softError(e); } catch (e2) { console.error(TAG, 'softError', e2); await sleep(3000); } }   // 7.1.30: ошибка внутри обработчика не глушит цикл
  }
  } finally { running = false; }
}

// ---------- 7.1.16-fix: магистр — бот сам учит и прокачивает скиллы ----------
// Страница /magister.html?npcId=…: карточки li.l2-magister-skill-card (имя, «SP за ранг», «ранг: N/M», «активный боевой»/«пассивный»),
// кнопка «Изучить навык», SP героя — «SP: 92778» в шапке. Так игрок учил вручную 10.10 00:46 (журнал): Anti Magic, Weapon Mastery,
// Vampiric Touch, Blaze, Summon Mew/Kat, Servitor Recharge/Heal, Robe Mastery… Curse Weakness — нет.
// Порядок: атакующие заклинания с панели → призыв текущего кота и Servitor Heal → пассивы → остальное. Пропуск — cfg.magisterSkip
const MAG_SKIP_DEF = 'Curse Weakness, Poisonous Cloud';
function magCards() {
  return [...document.querySelectorAll('#magister-list li.l2-magister-skill-card')].map(li => {
    const name = (li.querySelector('.l2-magister-skill-card__name')?.textContent || '').trim();
    const nums = [...li.querySelectorAll('.l2-magister-meta__num')].map(e => +e.textContent.replace(/\D/g, '') || 0);
    const btn = li.querySelector('.l2-magister-skill-card__learn-link');
    return { li, name, minLvl: nums[0] || 0, sp: nums[1] || 0, rank: +(li.querySelector('.l2-magister-meta__rank-current')?.textContent || 0),
      max: +(li.querySelector('.l2-magister-meta__rank-max')?.textContent || 0), passive: !!li.querySelector('.l2-magister-meta__kind-passive'),
      btn: btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && shown(btn) ? btn : null };
  }).filter(c => c.name);
}
const magSp = () => +(((document.querySelector('.l2-magister-panel__sub-right')?.textContent || document.body.textContent).match(/SP:\s*([\d\s]+)/) || [])[1] || '').replace(/\D/g, '') || 0;
function magScore(c) {
  const n = c.name.toLowerCase(), panel = (rt.panel || []).map(x => (x.name || '').toLowerCase());
  const il = ilOf(c.name) || {};
  if (names(cfg.magisterSkip ?? MAG_SKIP_DEF).includes(n)) return -1;
  if (panel.includes(n) && (il.c === 'Маг. атака' || /атака/.test(il.c || ''))) return 100;          // ударные заклинания с панели
  const pet = (petState()?.key || '').replace(/_/g, ' ');
  if (/^summon /.test(n) && pet && n.includes(pet)) return 80;
  if (/^servitor heal/.test(n)) return 30;   // лечит кота мало — кот лечится перепризывом, SP сюда в последнюю очередь
  if (c.passive) return /weapon mastery|mana gain|robe mastery|anti magic/.test(n) ? 60 : 40;
  if (panel.includes(n)) return 50;
  if (il.c === 'Маг. атака' || /атака/.test(il.c || '')) return 45;   // ударное, но не на панели (Flame Strike)
  return 20;
}
async function magisterStep() {
  const M = rt.magister;
  if (!/\/magister\.html/.test(location.pathname)) {
    if (/\/magisters\.html/.test(location.pathname)) {
      const a = await waitX(() => $q('#magisters-npc-list a.l2-town-btn, #magisters-npc-list .l2-town-btn'), 6000, 200);
      if (a) { fire(a); await sleep(3000); return; }
      rec('B', 'магистр', 'нет магистра в списке гильдии — пропускаю'); await setRt({ magister: null, magT: Date.now() }); return;
    }
    if (!M.viaCity && rt.magNpc) { await setRt({ magister: { ...M, viaCity: true } }); location.href = `/magister.html?npcId=${rt.magNpc}`; await sleep(3500); return; }
    if (!isCity()) { location.href = '/city.html'; await sleep(3500); return; }
    location.href = '/magisters.html'; await sleep(3500); return;
  }
  const npc = new URLSearchParams(location.search).get('npcId'); if (npc && rt.magNpc !== npc) await setRt({ magNpc: npc });
  if (!(await waitX(() => magCards().length, 8000, 200))) {
    if (!M.viaCityDone) { await setRt({ magister: { ...M, viaCity: true, viaCityDone: true } }); location.href = '/city.html'; await sleep(3500); return; }
    rec('B', 'магистр', 'список скиллов не загрузился — пропускаю'); await setRt({ magister: null, magT: Date.now() }); return;
  }
  const learned = [], reserve = cfg.magisterSpReserve || 0;
  for (let i = 0; i < 60 && on; i++) {
    const sp = magSp(), lv = heroLevel() || rt.lvl || 99;
    const c = magCards().filter(x => x.btn && x.sp && x.sp <= sp - reserve && (!x.minLvl || x.minLvl <= lv) && (!x.max || x.rank < x.max))
      .map(x => ({ ...x, sc: magScore(x) })).filter(x => x.sc >= 0).sort((a, b) => b.sc - a.sc || a.sp - b.sp)[0];
    if (!c) break;
    setStatus(`Магистр: ${c.name} ${c.rank}→${c.rank + 1} (SP ${sp})`);
    fire(c.btn);
    const ok = await waitX(() => magSp() < sp, 5000, 150);
    if (!ok) { rec('B', 'магистр', `${c.name}: SP не списались — останавливаюсь`); break; }
    learned.push(c.name);
    await sleep(rnd(500, 900));
  }
  if (learned.length) {
    // ранг вырос — старые замеры урона/MP этих скиллов устарели: пусть бот перемерит (проба новых заклинаний)
    const S = { ...(rt.skills || {}) };
    for (const n of new Set(learned)) { const k = n.toLowerCase(); if (S[k]) S[k] = { ...S[k], dmg: 0, dmgN: 0, mp: 0, mpN: 0 }; }
    const cnt = learned.reduce((a, n) => (a[n] = (a[n] || 0) + 1, a), {});
    rec('B', 'магистр', `выучено: ${Object.entries(cnt).map(([n, k]) => `${n} +${k}`).join(', ')} · SP осталось ${magSp()}`);
    await setRt({ skills: S });
  } else rec('B', 'магистр', `учить нечего (SP ${magSp()})`);
  { const ev = Math.max(1, cfg.magisterEvery || 2), hl = heroLevel() || rt.lvl || 0; await setRt({ magister: null, magT: Date.now(), magLvl: M.lvl || (hl - hl % ev) }); }
  location.href = '/map.html'; await sleep(3500);
}
// ---------- выбило из игры: форма входа «Нік / Пароль / Войти в игру» ----------
// Логин и пароль хранятся только в этом браузере (chrome.storage.local, ключ «auth»), не попадают в журнал,
// снимки и выгрузку настроек. Попыток — не больше 3 за 10 мин (чтобы не заблокировали за перебор).
function loginPage() {
  if ($q('#l2-hud-legacy-name')) return false;
  const pw = [...document.querySelectorAll('input[type="password"]')].find(shown);
  return !!pw;
}
function setVal(el, v) {                         // как будто ввёл человек: «родной» сеттер + события ввода
  const proto = Object.getPrototypeOf(el), d = Object.getOwnPropertyDescriptor(proto, 'value');
  d?.set ? d.set.call(el, v) : (el.value = v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
async function autoLogin() {
  const { auth } = await chrome.storage.local.get('auth');
  if (!auth?.login || !auth?.pass) {
    await idle(60000, 'Вы вышли из игры — войдите вручную (или задайте логин/пароль: меню → Журнал → 🔐 Автовход)');
    return;
  }
  const now = Date.now(), tries = (rt.loginTries || []).filter(t => now - t < 600000);
  if (tries.length >= 3) { await idle(120000, 'Автовход: 3 попытки за 10 мин не удались — жду (проверьте логин/пароль)'); return; }
  await setRt({ loginTries: [...tries, now] });
  const pw = [...document.querySelectorAll('input[type="password"]')].find(shown);
  const form = pw.closest('form') || document;
  const user = [...form.querySelectorAll('input:not([type]), input[type="text"], input[type="email"]')].filter(shown)
    .find(i => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) || [...document.querySelectorAll('input[type="text"], input:not([type])')].find(shown);
  setStatus('Выбило из игры — вхожу снова');
  rec('S', 'вход', `форма входа на ${location.pathname} — автовход (попытка ${tries.length + 1}/3)`);   // без логина и пароля
  if (user) { user.focus(); setVal(user, auth.login); }
  await sleep(rnd(300, 600));
  pw.focus(); setVal(pw, auth.pass);
  await sleep(rnd(300, 600));
  const btn = [...form.querySelectorAll('button, input[type="submit"], a')].filter(shown)
    .find(b => /войти|увійти|вход|вхід|login|sign in/i.test(b.textContent + ' ' + (b.value || '')));
  if (btn) fire(btn); else if (pw.form) pw.form.requestSubmit ? pw.form.requestSubmit() : pw.form.submit();
  const ok = await waitFor(() => !loginPage() || $q('#l2-hud-legacy-name'), 15000, 300);
  if (ok && !loginPage()) {
    rec('S', 'вход', 'вход выполнен — продолжаю');
    await setRt({ loginTries: [] });
    await sleep(2000);
    if (!$q('#l2-hud-legacy-name')) { location.href = fishNow() ? '/fishing.html' : '/map.html'; await sleep(6000); }
  } else {
    const err = [...document.querySelectorAll('[class*="error"], [class*="err"], [role="alert"]')].filter(shown).map(e => e.textContent.trim()).filter(Boolean).join(' ').slice(0, 120);
    rec('S', 'вход', `не удалось войти${err ? ': ' + err : ''}`);
    await sleep(5000);
  }
}

// ---------- сервер игры недоступен (страница ошибки Cloudflare: «502: Bad gateway», 503, 504, 52x) ----------
// Бот не останавливается: каждые 10 с пробует открыть игру снова (журнал — только начало и конец простоя).
function serverDown() {
  if (netOutage.since && Date.now() - netOutage.last < 90000) return true;
  if ($q('#cf-error-details, #cf-wrapper .cf-error-source')) return true;
  if ($q('#l2-hud-legacy-name, #l2-nav-bottom')) return false;   // игра на месте — текст страницы не читаем (дорого на больших страницах)
  const t = (document.title || '') + ' ' + (document.body?.innerText || '').slice(0, 300);
  if (/\b(5\d\d)\b[^\n]{0,40}(bad gateway|gateway time|service unavailable|origin|web server|timed out|error)|Error code 5\d\d|Bad gateway|Service Unavailable|Gateway Time-?out/i.test(t)) return true;
  // 7.2.5: перезапуск сервера может отдавать не 5xx, а страницу техработ — тоже простой (не страница входа: там поле пароля)
  return /технічн\S* (?:робот|перерв)|техническ\S* (?:работ|перерыв)|maintenance|перезапуск сервер|оновлення сервер|обновление сервер/i.test(t)
    && !document.querySelector('input[type="password"]');
}
// 9.0 (разбор Маммона 11.10, проверено на сервере): API игры пускает только с заголовком «Authorization: Bearer <токен>» — токен страница
// держит в localStorage 'token'. Свои GET бота шли с одной cookie и получали 401 (/game/spawn/…/info, /game/epic-bosses, заказ Маммона):
// отсюда «цифры … у игры не получены» и «список эпиков с сервера не получен». Токен только в заголовок запроса — никуда не пишем
const gameAuth = () => { try { const t = localStorage.getItem('token'); return t ? { Authorization: 'Bearer ' + t } : {}; } catch (e) { return {}; } };
async function gameGet(path, ms = 6000) {
  const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
  try { return await fetch(path, { credentials: 'include', cache: 'no-store', headers: gameAuth(), signal: c.signal }); } finally { clearTimeout(tm); }
}
// 7.2.5 (игрок 10.10, скрин 502 Bad gateway: «сервер уходит в перезагрузку — бот должен восстанавливаться и продолжать задачу»):
// лёгкая проверка, отвечает ли сервер игры (Cloudflare 5xx или нет ответа — «нет»). Запрос из скрипта расширения hook.js не видит
async function srvUp() {
  const c = new AbortController(), tm = setTimeout(() => c.abort(), 8000);
  // 8.0 (аудит ядра): страница техработ/Cloudflare с кодом 200 и HTML вместо JSON — сервер игры ещё не отвечает
  try { const r = await fetch('/game/time', { cache: 'no-store', credentials: 'include', signal: c.signal }); return srvAnswer(r.status, r.headers.get('content-type')); }
  catch (e) { return false; } finally { clearTimeout(tm); }
}
const srvAnswer = (status, ct) => status < 500 && !(status === 200 && !/json/i.test(ct || ''));
async function serverWait() {
  // по просьбе игрока: рестарт сервера — перезагружаем страницу каждые 10 с (раньше 30 с → … → 5 мин), пока игра не ответит
  // 8.0 (аудит ядра): короткая серия ошибок API при живой игре на экране — через 3 с спрашиваем сервер; отвечает — работаем
  // дальше без перезагрузки страницы (раньше три 5xx за 30 с всегда вели к перезагрузке)
  if (netOutage.since && !rt.downT && $q('#l2-hud-legacy-name, #l2-nav-bottom')) {
    setStatus('Сбой ответов сервера — проверяю, отвечает ли игра'); await sleep(3000);
    if (await srvUp()) { netOutage.since = 0; netOutage.failures = []; rec('S', 'сервер', 'короткий сбой ответов сервера — игра отвечает, продолжаю без перезагрузки'); return; }
  }
  const now = Date.now(), n = (rt.downN || 0) + 1, wait = Math.min(120000, 10000 * Math.pow(2, Math.min(4, n - 1)));
  const code = netOutage.since ? 'API 5xx' : (((document.title || '') + ' ' + (document.body?.innerText || '').slice(0, 300)).match(/\b5\d\d\b/)?.[0] || '5xx');
  if (!rt.downT) rec('S', 'сервер', `игра недоступна (${code}) на ${location.pathname} — жду и пробую снова`);
  await setRt({ downT: rt.downT || now, downN: n });
  const t0 = Date.now();                          // свой отсчёт, без записи в журнал на каждой попытке
  let probeT = t0;                                // 7.2.5: раз в 10 с спрашиваем сервер — ответил, значит перезагружаем сразу, не ждём до 2 мин
  while (on && Date.now() - t0 < wait) {
    setStatus(`Сервер игры недоступен (${code}) — попытка ${n}, проверяю каждые 10 с, перезагрузка не позже чем через ${Math.ceil((wait - (Date.now() - t0)) / 1000)} с`);   // 8.0: не чаще раза в 2,5 с в хранилище
    if (Date.now() - probeT >= 10000) { probeT = Date.now(); if (await srvUp()) { rec('S', 'сервер', `сервер снова отвечает — перезагружаю страницу и продолжаю (${autonomyMode()})`); break; } }
    await sleep(1000);
  }
  if (!on) return;
  location.reload();   // сохраняем URL боя/локации и состояние пользователя
  await sleep(8000);
}
async function serverBack() {
  const mins = Math.round((Date.now() - rt.downT) / 6000) / 10;
  rec('S', 'сервер', `игра снова доступна (простой ${mins} мин, попыток ${rt.downN || 0})`);
  await setRt({ downT: 0, downN: 0, mapReload: 0, mapDownT: 0, battleReload: 0 });
}

// сбой в цикле — не повод останавливать бота: записать, переждать, при повторах — обновить страницу.
// Остановка — только если ошибки сыплются постоянно (8 за 10 мин).
async function softError(e) {
  const route = [location.pathname, rt.epic?.step || '', rt.rbGo ? 'raid' : '', rt.fishService || ''].join(':');
  if (!recovery.count(route) && rt.engineFailures?.[route]?.length) recovery.restore(route, rt.engineFailures[route]);
  // 8.0: повторы ошибки кода переживают перезагрузку страницы (sessionStorage вкладки) — иначе вечный круг «повтор → перезагрузка»
  let fatalAll = {}; try { fatalAll = JSON.parse(sessionStorage.getItem('l2bot-fatal') || '{}') || {}; } catch (x) {}
  if (fatalAll[route]) recovery.restoreFatal(route, fatalAll[route]);
  const d = recovery.failure(route, e);
  try { const f = recovery.exportFatal(route); if (f) fatalAll[route] = f; else delete fatalAll[route]; sessionStorage.setItem('l2bot-fatal', JSON.stringify(fatalAll)); } catch (x) {}
  const keep = Object.fromEntries(Object.entries(rt.engineFailures || {})
    .filter(([, t]) => Array.isArray(t) && t.some(x => Date.now() - x < 30 * 60000)).slice(-12));
  keep[route] = d.times;
  const now = Date.now(), errs = [...(rt.errs || []), now].filter(t => now - t < 30 * 60000);
  await setRt({ errs, engineFailures: keep,
    health: { route, action: d.action, failures10m: d.recent, updatedAt: now } });
  rec('S', 'ошибка', `${d.error} @ ${route}: ${d.action} (${d.recent} за 10 мин)`);
  if (d.action === 'halt' && !d.programming && !(await srvUp())) {   // 7.2.5: сбои из-за лежащего сервера — ждём сервер, бота не останавливаем
    rec('S', 'сервер', 'сбои повторяются, а сервер игры не отвечает — это простой сервера, жду его, бота не останавливаю');
    netOutage.since = netOutage.since || Date.now(); netOutage.last = Date.now();
    return serverWait();
  }
  // 8.0: «Cannot read properties of null/undefined» бывает и от недогруженной страницы при сбое сервера — сначала проверка сервера
  if (d.action === 'halt' && d.programming && /cannot (?:read|set) properties of (?:null|undefined)/i.test(d.error) && !(await srvUp())) {
    rec('S', 'сервер', 'ошибка страницы повторяется, а сервер игры не отвечает — жду сервер, бота не останавливаю');
    netOutage.since = netOutage.since || Date.now(); netOutage.last = Date.now();
    return serverWait();
  }
  // 8.0: 3-й повтор той же ошибки страницы — не ещё одна перезагрузка, а уход на карту (другая страница, другое состояние)
  if (d.action === 'reload' && d.programming && d.fatalRepeats === 3 && !/\/map\.html/.test(location.pathname)) {
    setStatus('Восстановление: ошибка страницы повторилась — перехожу на карту');
    rec('S', 'восстановление', `${d.error.slice(0, 80)} — 3-й раз подряд, перехожу на карту (4-й — остановка с сообщением)`);
    await sleep(2000);
    if (on && tabOwner) location.href = '/map.html';
    return;
  }
  if (d.action === 'halt') {
    const reason = d.programming ? `Ошибка программы повторилась: ${d.error}. Требуется исправление расширения` :
      `Сбой повторился ${d.total} раз за 30 мин: ${d.error}`;
    return halt(reason, true); // Never silently resume programming errors via fishSoft.
  }
  if (d.action === 'reload') {
    setStatus(`Восстановление: перезагрузка после ${d.recent} ошибок`);
    await sleep(2000);
    if (on && tabOwner) location.reload();
    return;
  }
  const wait = d.delayMs;
  setStatus(d.action === 'cooldown'
    ? `Сетевая пауза не более ${Math.ceil(wait / 1000)} с после ${d.recent} ошибок в ${route}`
    : `Сбой: ${d.error.slice(0, 60)} — повтор через ${Math.ceil(wait / 1000)} с`);
  // v7.0.1: пауза держится и без замка вкладки — раньше idle() выходил сразу при !tabOwner, и при сбое самого замка
  // («Illegal invocation», лог 09.10 18:33) 15 «пауз 3 мин» проходили за 50 мс
  const label = d.action === 'cooldown' ? 'Пауза после повторных сбоев' : 'Восстановление', t0 = Date.now(), lastKick = +rt.manualKickAt || 0;
  setStatus(label);
  while (on && !rt.shop?.urgent && (+rt.manualKickAt || 0) <= lastKick && Date.now() - t0 < wait) { setStatus(`${label} · ${Math.ceil((wait - (Date.now() - t0)) / 1000)} с`); await sleep(Math.max(1, Math.min(1000, wait - (Date.now() - t0)))); }
}
// ---------- меню бота справа от игры (то же меню, что по кнопке расширения) ----------
// Панель занимает всё место справа от игрового блока; границу берём из самой страницы.
let dockObserver = null, dockObserved = [], dockWaiter = null, dockFrame = 0;
function scheduleDock() {
  if (dockFrame) return;
  dockFrame = requestAnimationFrame(() => { dockFrame = 0; try { dock(); } catch (e) {} });
}
function dockGameBounds(viewport) {
  const anchors = [...document.querySelectorAll('#l2-nav-bottom, #battle-content, #map-mob-list, .l2-battle-hotbar, #fishing-target')];
  let right = 0, left = Infinity;
  const observed = [];
  for (const anchor of anchors) {
    if (!shown(anchor)) continue;
    const base = anchor.getBoundingClientRect();
    if (base.width < 200) continue;
    // Поднимаемся до рамки игры, но не до общего контейнера страницы.
    // Небольшой запас учитывает рамку и отступы вокруг игрового меню.
    for (let el = anchor; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width > base.width + 96 || r.width >= viewport - 8) break;
      if (r.width >= base.width && r.right > 0 && r.left >= -1) {
        right = Math.max(right, r.right); left = Math.min(left, r.left);
        observed.push(el);
      }
    }
  }
  return { right: Math.ceil(right), left: left === Infinity ? 0 : Math.floor(left), observed };
}
// v5.2: сторож встроенной панели. Панель (iframe с меню) шлёт «я жива» каждые 3 с; если 20 с тишины, а вкладка на экране —
// панель упала (в Chrome — «грустный листок»), пересоздаём её. Не чаще раза в минуту; бот при этом работает дальше.
let dockHb = 0, dockBorn = 0, dockFix = 0;
// v5.6: в Firefox адрес расширения moz-extension:// — сигнал панели не принимался, и её перезапускали каждые 20–60 с (лог 09.10: 80 раз за час)
const EXT_ORIGIN = (() => { try { return new URL(chrome.runtime.getURL('')).origin; } catch (e) { return ''; } })();
addEventListener('message', e => { if (e.data?.__l2dock === 'hb' && (e.origin === EXT_ORIGIN || /^(chrome|moz)-extension:\/\//.test(String(e.origin)))) dockHb = Date.now(); });
setInterval(() => {
  const fr = document.querySelector('#l2bot-dock iframe');
  if (!fr || !cfg.dock || cfg.dockMin || document.hidden) return;
  const now = Date.now();
  if (now - Math.max(dockHb, dockBorn) < 20000 || now - dockFix < 60000) return;
  dockFix = now;
  try { rec('S', 'меню', `встроенная панель не отвечает ${Math.round((now - Math.max(dockHb, dockBorn)) / 1000)} с — перезапускаю её`); } catch (e) {}
  const nf = fr.cloneNode(false); nf.src = chrome.runtime.getURL('popup.html?dock=1&r=' + now); fr.replaceWith(nf); dockBorn = now;
}, 5000);
// 7.2.1 (игрок 10.10: «информационное окно крупнее, полностью по левому пустому краю, текст покрупнее»): слева от игры есть место
// (≥ 300 px) — окно на всю высоту и ширину этого поля, шрифт крупнее; места нет — компактное окно внизу слева, как раньше
// 7.2.3: ширина запоминается (stickyFree) — окно больше не прыгает между крупным и мелким при смене экрана
let indStick = (() => { try { return JSON.parse(localStorage.getItem('l2bot-indw') || 'null'); } catch (e) { return null; } })();
function layoutInd(bounds) {
  try {
    const vw = document.documentElement.clientWidth || innerWidth;
    const s = L2EngineCore.stickyFree(indStick, (bounds?.left || 0) - 16, vw);
    if (s !== indStick) { indStick = s; try { localStorage.setItem('l2bot-indw', JSON.stringify(s)); } catch (e) {} }
    const free = s.free;
    ui.classList.toggle('wide', free >= 300);
    ui.style.width = free >= 300 ? `${Math.min(free, 760)}px` : '';
  } catch (e) {}   // индикатор ещё не создан
}
// 8.0.7 (игрок: «основная версия — не под андроиды, там ничего не меняем»): раскладка для планшета — только на Android
const ANDROID = /Android/i.test(navigator.userAgent || '');
let dockOver = false;
const dockOverOpen = () => { try { return localStorage.getItem('l2bot-dockOpen') === '1'; } catch (e) { return false; } };
function dock() {
  if (window.top !== window) return;
  if (!cfg.dock) try { layoutInd(dockGameBounds(document.documentElement.clientWidth || innerWidth)); } catch (e) {}
  let wrap = document.getElementById('l2bot-dock');
  if (!cfg.dock) { wrap?.remove(); dockObserver?.disconnect(); dockObserved = []; dockWaiter?.disconnect(); dockWaiter = null; try { ui.classList.remove('over', 'hid'); } catch (e) {} return; }
  const viewport = document.documentElement.clientWidth || innerWidth;
  const bounds = dockGameBounds(viewport), available = viewport - bounds.right - 8;
  // 8.0.7 (игрок 11.10, планшет с Firefox для Android: «всё немного криво косо»): рядом с игрой места нет (портрет планшета,
  // телефон, узкое окно) — меню стояло поверх правой половины игры, индикатор налезал на меню и кнопки игры. Теперь в таком
  // случае меню свёрнуто, пока его не откроют язычком (своё для этого устройства — localStorage, cfg.dockMin общий с ПК не трогаем),
  // язычок крупнее под палец, открытое меню шире, индикатор — 3 строки и прячется, пока меню открыто поверх игры
  dockOver = ANDROID && !(bounds.right > 0 && available >= 300);
  const min = dockOver ? !dockOverOpen() : !!cfg.dockMin;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'l2bot-dock';
    const fr = document.createElement('iframe');
    fr.src = chrome.runtime.getURL('popup.html?dock=1'); dockBorn = Date.now();
    fr.title = 'L2wap Bot';
    fr.style.cssText = 'border:0;width:100%;height:100%;display:block;background:#14100d;border-radius:10px';
    const tg = document.createElement('button');
    tg.id = 'l2bot-dock-toggle';
    tg.style.cssText = 'position:absolute;top:10px;width:26px;height:46px;z-index:2;border:1px solid #56452f;background:linear-gradient(180deg,#2e261e,#231d17);color:#f0cf86;font:13px system-ui;cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.4)';
    tg.addEventListener('click', async e => {
      e.stopPropagation();
      if (dockOver) { try { localStorage.setItem('l2bot-dockOpen', dockOverOpen() ? '0' : '1'); } catch (er) {} dock(); return; }
      await setCfg({ dockMin: !cfg.dockMin });
    });
    wrap.append(tg, fr);
    document.documentElement.appendChild(wrap);
  }
  layoutInd(bounds);
  try { ui.classList.toggle('over', dockOver); ui.classList.toggle('hid', dockOver && !min); draw(); } catch (e) {}   // индикатор ещё не создан
  // Если рядом места нет (узкое окно или ещё не загрузилась игра) — компактная панель поверх игры (8.0.7: на Android до 460 px)
  const w = bounds.right > 0 && available >= 300 ? available : Math.min(dockOver ? 460 : 380, Math.max(0, viewport - 16));
  wrap.style.cssText = `position:fixed;top:8px;right:${min ? -w : 8}px;bottom:8px;width:${w}px;z-index:2147483646;`
    + 'box-sizing:border-box;border:1px solid #56452f;border-radius:12px;background:#14100d;box-shadow:0 8px 28px rgba(0,0,0,.6);transition:right .2s';
  const toggle = wrap.querySelector('#l2bot-dock-toggle'), tw = dockOver ? 36 : 26;
  toggle.style.width = tw + 'px'; toggle.style.height = (dockOver ? 64 : 46) + 'px'; toggle.style.fontSize = (dockOver ? 17 : 13) + 'px';
  toggle.style.left = min ? -tw + 'px' : '0';
  toggle.style.borderRadius = min ? '8px 0 0 8px' : '0 6px 6px 0';
  toggle.textContent = min ? '◀' : '▶';
  toggle.title = min ? 'Показать меню бота' : 'Свернуть меню бота';
  toggle.setAttribute('aria-expanded', String(!min));
  if (!bounds.right && document.body && !dockWaiter && typeof MutationObserver !== 'undefined') {
    dockWaiter = new MutationObserver(scheduleDock);
    dockWaiter.observe(document.body, { childList: true, subtree: true });
  } else if (bounds.right && dockWaiter) { dockWaiter.disconnect(); dockWaiter = null; }
  if (typeof ResizeObserver !== 'undefined') {
    dockObserver ||= new ResizeObserver(scheduleDock);
    const targets = [...new Set([document.body, ...bounds.observed])].filter(Boolean);
    if (targets.length !== dockObserved.length || targets.some((el, i) => el !== dockObserved[i])) {
      dockObserver.disconnect(); targets.forEach(el => dockObserver.observe(el)); dockObserved = targets;
    }
  }
}
addEventListener('resize', scheduleDock);
// страница баффера Fast Aden (зашёл бот или игрок) — запоминаем список баффов, цены и баланс FA
setTimeout(() => { try { faCatalogNote(); L2V7Modules.buffs.tbLevelsNote(); } catch (e) {} }, 2500);   // 7.2.2: и уровни городских наборов
addEventListener('click', e => { if (e.target.closest?.('.l2-fa-buy')) setTimeout(() => { try { faCatalogNote(); } catch (er) {} }, 1500); }, true);
// Игровые блоки могут появиться после document_idle.
addEventListener('load', scheduleDock, { once: true });
setTimeout(scheduleDock, 2000);
setTimeout(scheduleDock, 5000);

// ---------- индикатор (вне body) ----------
// v4.47: многострочный — режим, статус, HP/MP/тотем/банки, бой с РБ (HP, расчётное время убийства, хватит ли банок), итоги
const ui = document.createElement('div');
ui.id = 'l2bot-ind';
// v5: оформление индикатора — тёмная «стеклянная» панель, цветная точка состояния, статус крупнее, история — приглушённо
const uiCss = document.createElement('style');
// 8.0.3 (игрок 11.10: «бывает полоска с перемоткой, она раздражает»): крупное окно было overflow:auto — когда 30 строк истории не
// влезали по высоте, появлялась полоса прокрутки, хотя окно не кликается (pointer-events:none) и прокрутить её нельзя. Теперь окно
// не прокручивается: сверху статус и бой целиком, история (новые строки сверху) обрезается снизу с плавным затуханием
uiCss.textContent = `#l2bot-ind{-moz-text-size-adjust:none;-webkit-text-size-adjust:none;text-size-adjust:none;position:fixed;left:8px;bottom:8px;z-index:2147483647;width:440px;max-width:calc(100vw - 16px);max-height:60vh;overflow:hidden;padding:9px 12px 10px;border-radius:12px;font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#efe6d6;background:rgba(20,16,13,.88);backdrop-filter:blur(6px);border:1px solid rgba(212,168,86,.35);box-shadow:0 6px 22px rgba(0,0,0,.5);pointer-events:none;white-space:pre-line}
#l2bot-ind .h{display:flex;align-items:center;gap:7px;font-weight:700;color:#f0cf86;font-size:11.5px;letter-spacing:.02em}
#l2bot-ind .h i{width:8px;height:8px;border-radius:50%;flex:0 0 8px;box-shadow:0 0 6px currentColor}
#l2bot-ind .s{font-weight:600;font-size:13px;margin:4px 0 3px;color:#fff}
#l2bot-ind .r{margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,.08);color:#a39280;font-size:11px}
#l2bot-ind .k{color:#a39280}
#l2bot-ind .s.old{color:#a39280;font-weight:400;font-size:12px}
#l2bot-ind .t{color:#d8c39a;font-variant-numeric:tabular-nums}
#l2bot-ind.wide .s.old{font-size:15px}
#l2bot-ind.wide{box-sizing:border-box;top:8px;bottom:8px;max-height:none;overflow:hidden;font-size:16px;line-height:1.5;padding:14px 18px 16px;display:flex;flex-direction:column}
#l2bot-ind.wide .r{flex:1 1 auto;min-height:0;overflow:hidden;-webkit-mask-image:linear-gradient(#000 calc(100% - 48px),transparent);mask-image:linear-gradient(#000 calc(100% - 48px),transparent)}
#l2bot-ind.wide .h{font-size:15px}
#l2bot-ind.wide .h i{width:11px;height:11px;flex-basis:11px}
#l2bot-ind.wide .s{font-size:18px;margin:8px 0 6px}
#l2bot-ind.wide .r{font-size:14.5px;margin-top:10px;padding-top:9px}
#l2bot-ind.over{max-width:min(380px,calc(100vw - 60px));opacity:.92}
#l2bot-ind.hid{display:none!important}`;
document.documentElement.append(uiCss, ui);
const escH = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const clockAt = sec => new Date(Date.now() + sec * 1000).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
// 8.0 (аудит меню): пауза — отдельный ключ хранилища (кнопка «⏸ Пауза» в меню): индикатор пишет «⏸ пауза», а не «остановлен»
let indPaused = null;
chrome.storage.local.get('paused').then(s => { indPaused = s.paused || null; try { draw(); } catch (e) {} }).catch(() => {});
chrome.storage.onChanged.addListener(ch => { if (ch.paused) { indPaused = ch.paused.newValue || null; try { draw(); } catch (e) {} } });
const indBig = n => { n = Math.round(+n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' млн' : n >= 1e4 ? Math.round(n / 1e3) + ' тыс.' : n.toLocaleString('ru'); };
const indDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`; };
const IND_HEALTH = { retry: 'повтор действия', reload: 'перезагрузка страницы', cooldown: 'пережидаю серию сбоев', halt: 'остановка из-за сбоев' };
function draw() {
  const L = [], now = Date.now();
  const fz = forceNow() || forceMax() ? ` · ⚡${forceNow()}${forceMax() ? '/' + forceMax() : ''}` : '';
  // 8.0 (аудит меню): настоящий текущий режим (как выбирает движок, autonomyMode) — раньше в списке не было «фарма на месте»,
  // «автофарма» и TvT, а при паузе индикатор писал «остановлен»
  let am = 'farm'; try { am = autonomyMode(); } catch (e) {}
  const modeTxt = ({ epic: '🐉 эпики', raid: '👑 тур по РБ', fish: '🎣 рыбалка', cat: '🏛 катакомбы', campaign: '📜 кампания' })[am] || (cfg.zoneAuto ? '🗺 автофарм' : '⚔ фарм на месте');
  const adds = [am === 'raid' && rt.rbOne?.on && '🎯 по одному РБ', cfg.rbMode && am !== 'raid' && 'РБ между мобами', cfg.tvtOn && 'TvT'].filter(Boolean);
  const pz = !on && !!indPaused, stTxt = on ? 'работает' : pz ? '⏸ пауза' : 'остановлен';
  L.push(`L2wap Bot · ${stTxt} · ${modeTxt}${adds.length ? ' + ' + adds.join(', ') : ''}${cfg.rec ? ' · ⏺' : ''}${fz}`);
  L.push(on ? `▶ ${rt.status || '—'}` : `последнее: ${rt.status || '—'}`);
  // темп за сессию (с ↺ в меню — rt.sessT0, как в «Обзоре») + банки MP и заряды (в бою — с панели, иначе — что помнит бот)
  const sm = rt.sessT0 ? now - rt.sessT0 : 0, sh = sm / 3600000;
  let mpN = null, shN = null;
  try {
    if (isBattle()) { const mb = mpPotSlot(); if (mb) mpN = potBag(mb); const sb = slotsBy(cfg.nShots || '')[0]; if (sb) shN = qty(sb); }
    if (mpN == null) { const P = Object.values(rt.pots || {}).filter(x => x.kind === 'mp' && x.n != null); if (P.length) mpN = P.reduce((a, x) => a + (+x.n || 0), 0); }
    if (shN == null && rt.bagAll?.n) { const nm = names(cfg.nShots); const hit = Object.entries(rt.bagAll.n).filter(([k]) => nm.some(n => k.toLowerCase().startsWith(n)));
      if (hit.length) shN = hit.reduce((a, [, v]) => a + (+v || 0), 0); }
  } catch (e) {}
  const sess = [sh >= 1 / 30 ? `⏱ ${indDur(sm)} · EXP ${indBig((rt.exp || 0) / sh)}/ч · адена ${indBig((rt.adena || 0) / sh)}/ч` : '',
    mpN != null ? `💧 банок MP ${mpN.toLocaleString('ru')}` : '', shN != null ? `✨ зарядов ${shN.toLocaleString('ru')}` : ''].filter(Boolean).join(' · ');
  if (sess) L.push(sess);
  if (on && rt.health?.action && now - (rt.health.updatedAt || 0) < 10 * 60000)   // 8.0: у выключенного бота старый сбой не показываем
    L.push(`🛠 Сбой — ${IND_HEALTH[rt.health.action] || rt.health.action} · сбоев за 10 мин: ${rt.health.failures10m || 0}`);
  const me = meHp(), mp = meMp();
  if (me) {
    const og = activeBuffs().find(x => x.id === 109), ogL = og?.exp ? Math.round((og.exp - now) / 1000) : null;
    let pots = '';
    try { const P = isBattle() ? hpPots().map(x => ({ n: potBag(x.b), heal: x.heal, name: x.name })) : Object.values(rt.pots || {}).filter(x => x.kind === 'hp');
      if (P.length) pots = ' · 🧪 ' + P.sort((a, b) => (b.heal || 0) - (a.heal || 0)).map(x => `${x.n ?? '?'}×${x.heal || '?'}`).join(' + '); } catch (e) {}
    L.push(`❤ ${me.cur}/${me.max} (${me.pct | 0}%)${mp ? ` · 💧 ${mp.cur}/${mp.max}` : ''}${ogL != null ? ` · 🗿 Ogre ${ogL > 0 ? ogL + ' с' : 'вышел'}` : ''}${pots}`);
  }
  const R = rbLive && isBattle() && now - rbLive.t < 15000 ? rbLive : null;
  if (R) {
    const el = (now - (R.t0 || now)) / 1000;
    L.push(`👑 ${R.name}: ${Math.round(R.cur / R.max * 100)}% (${R.cur.toLocaleString('ru')} / ${R.max.toLocaleString('ru')}) · бой ${fmtT(el)}`);
    if (R.dps > 0) L.push(`⏱ Расчётное время: ≈${fmtT(R.tKill)} · DPS ${Math.round(R.dps)}/с (это НЕ прогноз победы)`);
    else L.push('⏱ Сбор данных о фактическом уроне…');
    L.push(`${R.win ? '✅ Победа вероятна' : R.verdict === 'measuring' ? '🧪 Оценка не подтверждена' : '⚠ Высокий риск'} · ${R.reason || 'идут измерения'}`);
    if (R.loss != null) L.push(`📉 Изменение HP ${Math.round(R.loss)} HP/с${R.pool ? ` · запас лечения ${fmtK(R.pool)} HP` : ''} · ударов ${R.hits || 0}`);
  } else if (huntOn() && rt.rbPlan && now - rt.rbPlan.t < 10 * 60000) {
    L.push(`👑 ${rt.rbPlan.ok === false ? '❌' : '➡'} ${rt.rbPlan.name}: ${rt.rbPlan.why}`);
  }
  if (rt.rbSess?.on) { const S = rt.rbSess, left = S.until ? Math.max(0, S.until - now) / 1000 : null;   // 7.2.1: РБ-сессия
    L.push(S.bought ? `🔥 РБ-сессия: осталось ${fmtT(left)} · РБ +${(rt.rbKills || 0) - (S.k0 || 0)} · EXP +${((rt.exp || 0) - (S.e0 || 0)).toLocaleString('ru')}` : '🔥 РБ-сессия: беру баффы за FA'); }
  const dz = rt.dps?.n ? ` · ДПС ${rt.dps.dps} (≈${rt.dps.ttk} с/моб)` : '';
  L.push(`Бои: ${rt.kills} · EXP +${(rt.exp || 0).toLocaleString('ru')}${rt.rbKills ? ` · РБ убито: ${rt.rbKills}` : ''}${dz}`);
  const F = rt.fish;
  if (cfg.fishMode && F?.casts) L.push(`🎣 ${F.caught} поймано / ${F.lost} сорвалось / ${F.casts} забросов${rt.fishSess?.n ? '\n🎣 сессия: ' + fishRateTxt() : ''}`);
  const q = questSummary(); if (q) L.push(q.replace(/^\s*·\s*/, ''));
  const wide = ui.classList.contains('wide');        // 7.2.1: окно на всю высоту — больше истории и длиннее строки
  const rec5 = RECENT.slice(1, wide ? 31 : 6);      // [0] — текущий статус, он уже сверху
  if (rec5.length) L.push('— последние действия —\n' + rec5.map(x => `${new Date(x.t).toLocaleTimeString('ru')} ${x.s.replace(/\[РБ [^\]]*\]/, '[РБ]').slice(0, wide ? 140 : 64)}`).join('\n'));
  const mode = cfg.indMode || 'full';
  if (mode === 'off') { ui.style.display = 'none'; return; }
  ui.style.display = '';
  const lines = mode === 'mini' || ui.classList.contains('over') ? L.slice(0, 3) : L;   // 8.0.7: поверх игры (планшет) — 3 строки
  const dot = on ? '#5cc27a' : pz ? '#e3b04b' : '#7f8c8d';
  ui.innerHTML = lines.map((t, i) => {
    if (i === 0) return `<div class="h"><i style="background:${dot};color:${on || pz ? dot : 'transparent'}"></i>${escH(t)}</div>`;
    if (i === 1) return `<div class="s${on ? '' : ' old'}">${escH(t)}</div>`;
    if (t === sess) return `<div class="t">${escH(t)}</div>`;
    if (t.startsWith('— последние действия —')) return `<div class="r">${escH(t.replace(/^— последние действия —\n/, ''))}</div>`;
    return `<div>${escH(t)}</div>`;
  }).join('');
  ui.style.borderColor = on ? 'rgba(92,194,122,.55)' : pz ? 'rgba(227,176,75,.55)' : 'rgba(212,168,86,.3)';
}

// стоп с клавиатуры — двойной Esc за 0,6 с: одиночный Esc закрывает окна игры и раньше нечаянно останавливал бота
let escT = 0;
addEventListener('keydown', e => { if (e.key !== 'Escape' || !on || !e.isTrusted) return; if (Date.now() - escT < 600) halt('Остановлено (Esc ×2)', true); escT = Date.now(); }, true);

// ---------- запись действий (для анализа) ----------
// Пишутся клики на ВСЕХ страницах игры. На чате/почте/форуме/поддержке — только какой элемент нажат, без текста.
const PRIVATE = /chat|mail|forum|support/i;
// справочные страницы форума (дроп, спойл, крафт, фарм ресурсов, события мира) — это не переписка игроков:
// их можно записывать и разбирать в базу. Темы, новости и личные разделы форума по-прежнему приватны
const FORUM_REF = /\/forum-(recipe-hunt|farm-resources|world-events|drop|spoil|craft|recipes?|resources?|guide|db|wiki|raid|rb|boss|epic|bosses)[\w-]*\.html/i;
const isPrivate = () => (PRIVATE.test(location.pathname) && !FORUM_REF.test(location.pathname)) || loginPage();
const fmtS = x => x ? `${x.cur}/${x.max}` : '';
function snapLite() {
  const mob = isBattle() ? mobHp() : null;
  return { page: location.pathname.replace(/^\/|\.html$/g, '') + (isPrivate() ? '' : location.search),
           hp: fmtS(meHp()), mp: fmtS(meMp()),
           mob: mob ? `${mobName()} ${fmtS(mob)}` + extraMobs().map(x => ` + ${x.name} ${x.cur}/${x.max}`).join('') : '' };
}
function rec(src, kind, what, extra = {}) {
  if (document.prerendering) return;                // v5.5.9: невидимая предзагруженная копия страницы — не пишем
  if (!cfg.rec) return;
  const ev = { t: Date.now(), src, kind, what, st: snapLite(), sid: SID, ...extra };
  try { chrome.runtime.sendMessage({ cmd: 'rec', ev }); } catch (e) {}
}

// ====================== 🌐 расширенный журнал и 🧠 автообучение (v5.1) ======================
// [N] сеть — запросы игры к серверу (hook.js): метод, путь, статус, время, тело запроса и ответа (урезано, без паролей/токенов).
//     Одинаковые ответы одного запроса (опрос) пишутся не чаще раза в 15 с.
// [G] игра — всплывающие сообщения игры (тосты, ошибки, результаты) — то, что игрок видит на экране.
// [L] обучение — замеченные изменения игры: пропал элемент, на который опирается бот; изменилась структура страницы;
//     новый запрос API или у ответа пропали/появились поля. При изменении — снимок страницы (и скриншот, если разрешён).
const learnPk = () => location.pathname.replace(/^\/|\.html$/g, '') || 'index';
const hashStr = str => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
let LEARN = null, learnDirty = false, learnSavedT = 0;
// v5.6: раньше весь объект обучения (сотни КБ) писался в хранилище каждые 20 с и при КАЖДОМ переходе страницы (бой ↔ карта —
// раз в 15–30 с), а каждая запись рассылалась всем вкладкам и меню. Теперь: счётчики переживают переходы в памяти вкладки
// (sessionStorage), в хранилище — раз в 3 мин; новые находки (изменения игры, новый запрос API) — сразу. Пишет только рабочая вкладка
const LEARN_SS = 'l2botLearn';
const learnLoad = () => LEARN ? Promise.resolve(LEARN) : chrome.storage.local.get('learn').then(({ learn }) => {
  let L = learn && learn.v === 1 ? learn : { v: 1, t0: Date.now(), sel: {}, pages: {}, api: {}, changes: [] };
  try { const ss = JSON.parse(sessionStorage.getItem(LEARN_SS) || 'null');
    if (ss?.L?.v === 1 && ss.t > (L.saved || 0) && (ss.L.t0 || 0) === (L.t0 || 0)) { L = ss.L; learnDirty = true; } } catch (e) {}
  learnSavedT = Date.now();
  return (LEARN = L);
});
const learnSave = () => {
  if (!learnDirty || !LEARN || tabIdle || document.prerendering) return;
  learnDirty = false; learnSavedT = Date.now(); LEARN.saved = learnSavedT;
  chrome.storage.local.set({ learn: LEARN }).catch(() => {});
  try { sessionStorage.removeItem(LEARN_SS); } catch (e) {}
};
setInterval(() => { if (Date.now() - learnSavedT > 180000) learnSave(); }, 20000);
// v5.2: страница РБ перезагружается каждые ~20 с — обучение не успевало сохраниться. При уходе со страницы — копия в памяти
// вкладки (быстро, без рассылки), следующая страница продолжит с неё
addEventListener('pagehide', () => {
  if (!LEARN || !learnDirty) return;
  if (Date.now() - learnSavedT > 180000) return learnSave();
  try { sessionStorage.setItem(LEARN_SS, JSON.stringify({ t: Date.now(), L: LEARN })); } catch (e) { learnSave(); }
});
let learnSaveT = null; const learnSaveSoon = () => { if (!learnSaveT) learnSaveT = setTimeout(() => { learnSaveT = null; learnSave(); }, 1500); };
function learnChange(kind, what, opts = {}) {
  const now = Date.now(), key = kind + '|' + what;
  LEARN.seen ||= {};
  if (now - (LEARN.seen[key] || 0) < 6 * 3600000) return;           // одно и то же — не чаще раза в 6 ч
  LEARN.seen[key] = now;
  const ch = { t: now, page: learnPk(), kind, what, v: chrome.runtime.getManifest().version };
  LEARN.changes = [ch, ...(LEARN.changes || [])].slice(0, 300); learnDirty = true; learnSaveSoon();
  rec('L', 'обучение', `${kind}: ${what}`);
  if (opts.snap !== false && !isPrivate()) {
    try { chrome.runtime.sendMessage({ cmd: 'snap', key: 'learn:' + hashStr(key) + ':' + Math.floor(now / 3600000), state: `⚠ ${kind}: ${what}`.slice(0, 160), html: domSnapshot() }); } catch (e) {}
    if (cfg.learnShots) try { chrome.runtime.sendMessage({ cmd: 'shot', reason: `${kind}: ${what}`.slice(0, 160), page: learnPk() }); } catch (e) {}
  }
}
// селекторы: учёт «за заход на страницу»; тревога — если раньше находился в ≥85 % заходов (≥6 заходов), а теперь 3 захода подряд нет
const normSel = sel => sel.replace(/"[^"]*"/g, '"*"').replace(/\b\d{2,}\b/g, 'N').slice(0, 160);
const selCounted = new Map();
function learnSelectors() {
  // 8.0.3 (лог 11.10 09:24:09: 10 ложных «пропал элемент» — это были страницы Cloudflare 502): страница ошибки сервера — не заход
  if (serverDown()) return;
  const pk = learnPk(), P = (LEARN.sel[pk] ||= {});
  for (const [raw, hit] of SELV) {
    const k = normSel(raw), x = (P[k] ||= { v: 0, h: 0, ms: 0 }), c = selCounted.get(k);
    if (!c) { x.v++; if (hit) { x.h++; x.ms = 0; if (x.alert) { x.alert = 0; rec('L', 'обучение', `селектор снова находится на «${pk}»: ${k}`); } } else x.ms++; selCounted.set(k, { hit }); learnDirty = true; }
    else if (hit && !c.hit) { x.h++; x.ms = 0; c.hit = true; learnDirty = true; if (x.alert) { x.alert = 0; rec('L', 'обучение', `селектор снова находится на «${pk}»: ${k}`); } }
    const base = (x.h) / Math.max(1, x.v - x.ms);
    if (!x.alert && x.ms >= 3 && x.v - x.ms >= 6 && base >= 0.85) { x.alert = Date.now(); learnChange('пропал элемент', `«${pk}»: ${k} — раньше находился в ${Math.round(base * 100)} % заходов, теперь ${x.ms} захода подряд нет`); }
  }
  const keys = Object.keys(P); if (keys.length > 400) keys.sort((a, b) => P[a].v - P[b].v).slice(0, keys.length - 400).forEach(k => delete P[k]);
}
// структура страницы: id и классы l2-* (без модификаторов состояния)
function pageTokens() {
  const set = new Set();
  for (const el of document.querySelectorAll('[id], [class*="l2-"]')) {
    if (set.size > 700) break;
    if (el.closest('#l2bot-dock, #l2bot-ind')) continue;
    if (el.id && !/\d{3,}|^(l2bot|tp-|cf-)/.test(el.id)) set.add('#' + el.id);
    for (const c of el.classList) if (/^l2-/.test(c) && !/--(on|off|active|selected|open|hidden|empty|alive|dead|lvl|quest|ok|bad|cur|act|hover|focus|anim)/i.test(c) && !/\d{3,}/.test(c)) set.add('.' + c);
  }
  return set;
}
function learnPage() {
  if (isPrivate() || serverDown() || heavyPage()) return;
  const pk = learnPk(), now = pageTokens(), P = (LEARN.pages[pk] ||= { n: 0, tok: {}, gone: {}, neu: {} });
  if (P.n >= 5) {
    const gone = Object.keys(P.tok).filter(t => P.tok[t] / Math.max(1, P.n - (P.gone[t] || 0)) >= 0.9 && !now.has(t));   // доля — до исчезновения
    const neu = [...now].filter(t => !P.tok[t]);
    for (const t of gone) P.gone[t] = (P.gone[t] || 0) + 1;
    for (const t of Object.keys(P.gone)) if (now.has(t)) delete P.gone[t];
    for (const t of neu) P.neu[t] = (P.neu[t] || 0) + 1;
    const g2 = Object.keys(P.gone).filter(t => P.gone[t] === 2), n2 = Object.keys(P.neu).filter(t => P.neu[t] === 2 && now.has(t));
    if (g2.length) learnChange('изменилась страница', `«${pk}»: пропало ${g2.length} — ${g2.slice(0, 8).join(' ')}`);
    if (n2.length >= 2) learnChange('новое на странице', `«${pk}»: появилось ${n2.length} — ${n2.slice(0, 8).join(' ')}`, { snap: n2.length >= 4 });
  }
  P.n++; for (const t of now) P.tok[t] = (P.tok[t] || 0) + 1;
  const tk = Object.keys(P.tok); if (tk.length > 1500) tk.sort((a, b) => P.tok[a] - P.tok[b]).slice(0, tk.length - 1500).forEach(t => delete P.tok[t]);
  for (const m of [P.gone, P.neu]) for (const t of Object.keys(m)) if (m[t] > 3) delete m[t];
  learnDirty = true;
}
// API: ключи ответа (верхний уровень и поле data), статусы; новый запрос / пропавшее поле — изменение
const apiPath = u => u.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:n').replace(/[0-9a-f]{16,}/gi, ':h');
function respKeys(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return [];
  const k = Object.keys(r);
  // 8.0 (аудит боя/рыбалки): и поля вложенных battle/delta/fishing — ходы в бою приходят «delta»-ответами (5144 из 8830), а что
  // в них лежит (откаты? кот?), бот не знал: отчёт обучения покажет поля, по ним следующей версией научим бота их читать
  const d = ['data', 'battle', 'delta', 'fishing'].flatMap(n => r[n] && typeof r[n] === 'object' && !Array.isArray(r[n]) ? Object.keys(r[n]).map(x => n + '.' + x) : []);
  return [...k, ...d].slice(0, 100);
}
function learnApi(key, d) {
  const A = LEARN.api, x = A[key], keys = respKeys(d.res), total = Object.values(A).reduce((a, y) => a + y.n, 0);
  const status = Number(d.status || 0);
  const success = status >= 200 && status < 300 && !d.error && !d.res?.error;
  // Сравниваем только ответы одного класса: HTTP 400 не является изменением
  // схемы HTTP 200, а итог боя, delta и обычная команда могут иметь разные поля.
  const kind = !success ? 'error:' + (d.res?.error || status || 'network')
    : /\/game\/battle\/action$/.test(key)
      ? (d.res?.battle || d.res?.victory || d.res?.defeat ? 'battle-end'
        : d.res?.delta ? 'delta' : 'battle-action')
      : 'success';
  if (!x) {
    A[key] = { n: 1, keys: Object.fromEntries(keys.map(k => [k, 1])),
      forms: { [kind]: { n: 1, keys: Object.fromEntries(keys.map(k => [k, 1])) } },
      st: { [d.status ?? 'err']: 1 }, first: Date.now(), last: Date.now(), page: learnPk() };
    if (total >= 150) learnChange('новый запрос API', `${key} (со страницы «${learnPk()}»)`, { snap: false });
    learnDirty = true; learnSaveSoon();
  } else {
    // Старые смешанные счётчики оставляем для отчёта, но обучаем схемы заново.
    x.forms ||= {};
    const f = (x.forms[kind] ||= { n: 0, keys: {} });
    if (success && f.n >= 5 && keys.length) {
      const miss = Object.keys(f.keys).filter(k => f.keys[k] / f.n >= 0.95 && !keys.includes(k));
      const neu = keys.filter(k => !f.keys[k]);
      if (miss.length) learnChange('ответ API изменился', `${key}: пропали поля ${miss.slice(0, 8).join(', ')}`, { snap: false });
      if (neu.length) learnChange('ответ API изменился', `${key}: новые поля ${neu.slice(0, 8).join(', ')}`, { snap: false });
    }
    f.n++; for (const k of keys) f.keys[k] = (f.keys[k] || 0) + 1;
    x.n++; x.last = Date.now(); for (const k of keys) x.keys[k] = (x.keys[k] || 0) + 1;
    const s = d.status ?? 'err'; x.st[s] = (x.st[s] || 0) + 1;
  }
  const ak = Object.keys(A); if (ak.length > 300) ak.sort((a, b) => A[a].last - A[b].last).slice(0, ak.length - 300).forEach(k => delete A[k]);
  learnDirty = true;
}
// Replace stale local fallbacks with explicit server deadlines. Missing fields
// remain unknown; this never interprets an absent cooldown map as ready.
function alignServerSkillCooldowns() {
  if (!isBattle()) return;
  const deadlines = combatCooldown.snapshot().skillUntil;
  const old = rt.cdUntil || {}, next = { ...old }, now = Date.now();
  let changed = false;
  for (const [id, end] of Object.entries(deadlines)) {
    if (!combatCooldown.skillKnown(id, cdSpawn())) continue;
    const el = document.querySelector(`[data-slot-cd="${CSS.escape(id)}"]`);
    const b = el?.closest(SLOT) || el?.closest('button');
    const key = b && skKey(b);
    if (!key || !Number.isFinite(end)) continue;
    const effective = end > now ? end : 0;
    if (Math.abs((next[key] || 0) - effective) > 500 || (effective === 0 && next[key])) {
      if (effective) next[key] = effective;
      else delete next[key];
      changed = true;
    }
  }
  if (changed) setRt({ cdUntil: next }).catch(e => console.warn(TAG, 'sync server cooldown', e));
}
const netSeen = new Map();
const cooldownDiagSeen = new Map();
function logCooldownApi(d, path) {
  if (!['/game/battle/action', '/game/battle/sync', '/game/battle'].includes(path) || !d.res || typeof d.res !== 'object') return;
  const r = d.res, inner = r.battle && typeof r.battle === 'object' ? r.battle : r.delta && typeof r.delta === 'object' ? r.delta : {};   // 8.0.3: и delta
  const sc = r.skillCooldowns ?? inner.skillCooldowns;
  const fields = {
    action: d.req?.action ?? r.requestedAction ?? null,
    battle: d.req?.battleSpawnId ?? battleSpawn(),
    status: d.status,
    serverNowMs: r.serverNowMs ?? r.nowMs ?? inner.serverNowMs ?? null,
    blockedBy: r.blockedBy ?? null,
    globalCooldownUntilMs: r.globalCooldownUntilMs ?? inner.globalCooldownUntilMs ?? null,
    cooldownUntilMs: r.cooldownUntilMs ?? r.readyAtMs ?? null,
    skillRemainingMs: r.skillRemainingMs ?? null,
    globalRemainingMs: r.globalRemainingMs ?? null,
    skillCooldowns: sc && typeof sc === 'object' ? Object.entries(sc).slice(0, 15) : null,
    mysticSkillCdUntil: r.mysticSkillCdUntil ?? inner.mysticSkillCdUntil ?? null,   // 8.0.3: смысл поля ещё не ясен — пишем для разбора
    receivedAt: Date.now()
  };
  if (fields.blockedBy == null && fields.globalCooldownUntilMs == null && fields.cooldownUntilMs == null && fields.skillCooldowns == null) return;
  const key = `${path}|${fields.action}|${fields.blockedBy}|${fields.status}`;
  if (Date.now() - (cooldownDiagSeen.get(key) || 0) < 3000) return;
  cooldownDiagSeen.set(key, Date.now());
  if (cooldownDiagSeen.size > 100) cooldownDiagSeen.delete(cooldownDiagSeen.keys().next().value);
  if (cfg.rec !== false) rec('N', 'КД сервера', key, { data: fields });
}
const netOutage = { failures: [], successes: [], since: 0, last: 0 };
// 8.0.3: отметка «сервер завис в бою» (ход без ответа > 8 с, «нет ответа игры 20 с», серия 5xx) — в sessionStorage вкладки: смерть сразу после неё
// не пишется как «не по силам» (survival.onDeath читает l2bot.srvHang)
const srvHangMark = why => { try { sessionStorage.setItem('l2bot.srvHang', JSON.stringify({ t: Date.now(), why: String(why || '').slice(0, 60) })); } catch (e) {} };
function observeGameHttp(path, status, now = Date.now()) {
  if (!/^\/(game|character)(?:\/|$)/.test(path)) return;
  const code = Number(status);
  if (code >= 500 && code < 600) {
    netOutage.failures = netOutage.failures.filter(x => now - x.t < 30000);
    netOutage.failures.push({ t: now, path });
    netOutage.last = now;
    if (!netOutage.since && netOutage.failures.length >= 3 &&
        new Set(netOutage.failures.map(x => x.path)).size >= 2) {
      netOutage.since = now;
      srvHangMark('сбой ответов сервера (5xx)');   // 8.0.3: смерть в бою сразу после — не «не по силам» (survival.onDeath)
      rec('S', 'сервер', 'Несколько API одновременно возвращают 5xx — приостанавливаю действия до восстановления');
    }
  } else if (code >= 200 && code < 300 && netOutage.since) {
    netOutage.successes = netOutage.successes.filter(x => now - x.t < 20000);
    netOutage.successes.push({ t: now, path });
    if (new Set(netOutage.successes.map(x => x.path)).size >= 2) {
      rec('S', 'сервер', 'API отвечает 2xx по разным адресам — проверяю состояние игры');
      netOutage.since = 0; netOutage.last = 0;
      netOutage.failures = []; netOutage.successes = [];
    }
  }
}

// v5.6: при уходе со страницы браузер обрывает фоновые запросы игры — это не ошибки сети, в журнал их не пишем
let pageLeaving = false;
addEventListener('beforeunload', () => { pageLeaving = true; });
addEventListener('pagehide', () => { pageLeaving = true; });
addEventListener('pageshow', () => { pageLeaving = false; });
const NET_NOISE = /unread|\/chat\/|\/tvt\b|\/time$|\/online$|party\/hud|news|profession-quest|story-quests|\/sync$|\/raid-bosses$/;
// 7.1.17: ходы боя по сети — ушёл / ответ пришёл. Лог 10.10 01:07: ответ на ход шёл 1,1–2,8 с, а бот жал следующее через 1 с —
// игра такие нажатия не принимала («урон 0 · MP 0» ×6 подряд, бой с чемпионом 33 с). Теперь следующий ход — после ответа
const ACT_NET = { start: 0, done: 0, t: 0 };
// 7.2.3: сумка по ответам сервера { m: itemId → qty, t } — в sessionStorage вкладки, чтобы пережить переход на другую страницу
// (после победы бот сразу уходит на карту, а там панели боя нет)
let INV_NET = (() => { try { return JSON.parse(sessionStorage.getItem('l2bot-inv') || 'null'); } catch (e) { return null; } })();
const invNote = inv => { if (!Array.isArray(inv) || !inv.length) return null; const m = {}; for (const x of inv) if (Array.isArray(x) && x[0]) m[x[0]] = (m[x[0]] || 0) + (+x[1] || 0); return m; };
const invQty = id => INV_NET?.m && Date.now() - (INV_NET.t || 0) < 300000 ? (INV_NET.m[id] ?? 0) : null;
const actNet = () => ACT_NET;
// 9.0 (катакомбы): список мобов подземелья целиком из ответа игры (hook.js поле dm: [id, тип, имя, ур., агр.]) и где герой по последнему
// снимку персонажа (character.activeDungeonId, locationType — в sessionStorage, переживает переход на другую страницу)
let DUNG_NET = null;
let HERO_AT = (() => { try { return JSON.parse(sessionStorage.getItem('l2bot-at') || 'null'); } catch (e) { return null; } })();
const dungNet = () => DUNG_NET, heroAt = () => HERO_AT && Date.now() - (HERO_AT.t || 0) < 10 * 60000 ? HERO_AT : null;
// 9.0: окно игры alert() на страницах катакомб/подземелья/торговцев (hook.js его не показывает, а пересылает) и ответ обмена камней печати
let GAME_ALERT = { t: 0 }, SEAL_NET = { t: 0 };
const gameAlert = () => GAME_ALERT, sealNet = () => SEAL_NET;
addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin || e.data?.__l2bot !== 'alert') return;
  GAME_ALERT = { t: Date.now(), text: String(e.data.text || '').slice(0, 300), path: String(e.data.path || '') };
  rec('B', 'игра', `окно игры (${GAME_ALERT.path}): ${GAME_ALERT.text.slice(0, 160)}`);
});
// 8.0.3 (логи 11.10, разбор откатов: клик, ушедший пока в полёте GET /character игры, потерян в 770 случаях из 770; через 25–200 мс после
// его конца — дошёл в 95 %): «игра занята» — пока в полёте её GET /character или запрос хода/начала боя (старше 3 с — забываем)
const GAME_REQ = new Map(); let GAME_END = 0;
const gameBusy = () => { const now = Date.now(); for (const [rid, t] of GAME_REQ) { if (now - t > 3000) GAME_REQ.delete(rid); else return { busy: true, end: GAME_END }; } return { busy: false, end: GAME_END }; };
addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin || e.data?.__l2bot !== 'netStart') return;
  const p = e.data.path || '/game/battle/action';
  if (p === '/game/battle/action') { ACT_NET.start++; ACT_NET.t = Date.now(); }   // 8.0.3: GET /character — не «ход ушёл»
  if (e.data.rid != null) { GAME_REQ.set(e.data.rid, Date.now()); if (GAME_REQ.size > 50) GAME_REQ.delete(GAME_REQ.keys().next().value); }
});
async function weaponEquipNote(req) {
  await itemsDb();
  const W = [...(rt.weapons || [])];
  if (req.action === 'equip') {
    const it = itemOf(+req.itemId); if (!it || it.k !== 'W' || /удочка|питомца/.test(it.wt || '')) return;
    const w = { id: +req.itemId, en: it.n, name: it.n, wt: it.wt || '—', g: it.g || 'NG', pa: (it.pa || 0) + (+req.enchantPAtkBonus || 0), ma: typeof it.ma === 'number' ? it.ma + (+req.enchantMAtkBonus || 0) : null,   // 9.2.3: и M.Atk заточки (магу)
      spd: it.spd || 0, two: !!it.two, ench: +req.enchant || 0, where: 'надето', inst: req.targetInstanceId || '' };
    for (const x of W) if (x.where === 'надето') x.where = 'сумка';
    const i = W.findIndex(x => x.id === w.id && (!x.inst || !w.inst || x.inst === w.inst));
    if (i >= 0) W[i] = { ...W[i], ...w, name: W[i].name || w.name }; else W.push(w);
    await setRt({ weapons: W, weaponsT: Date.now(), weaponEq: { id: w.id, g: w.g, t: Date.now() } });
    rec('B', 'оружие', `надето «${it.n}» (${w.g}, ${w.wt}) — заряды теперь под ${w.g}`);
  } else if (req.action === 'unequip' && /weapon|rhand|lrhand|^r$/i.test(String(req.slot || ''))) {
    for (const x of W) if (x.where === 'надето') x.where = 'сумка';
    await setRt({ weapons: W, weaponEq: null });
  }
}
let SHOP_BUY = null;   // 7.1.30: последняя покупка в магазине вещей (shopKey из запроса)
function profQuestNote(st) {
  if (!st.accepted) { if (rt.profQuest?.open?.length) { const qs = { ...(rt.questSeen || {}) }; for (const n of rt.profQuest.open) delete qs[n]; setRt({ profQuest: { ...rt.profQuest, open: [], t: Date.now() }, questSeen: qs }); } return; }   // 7.1.30: квест сброшен
  const kills = (Array.isArray(st.kills) ? st.kills : []).filter(k => k?.name).map(k => ({ name: String(k.name), need: +k.need || 0, have: +k.have || 0 }));
  const open = st.completed ? [] : kills.filter(k => k.have < k.need);
  const sig = (st.titleUk || '') + '|' + st.stage + '|' + kills.map(k => `${k.name}:${k.have}/${k.need}`).join(',') + '|' + !!st.completed;
  const now = Date.now(), prev = rt.profQuest;
  if (prev?.sig === sig && now - (prev.t || 0) < 600000) return;      // опрос идёт часто — пишем при изменении или раз в 10 мин
  const seen = { ...(rt.questSeen || {}) };
  for (const k of kills) { const n = k.name.toLowerCase(); if (open.includes(k)) seen[n] = now; else if (prev?.open?.includes(n)) delete seen[n]; }
  const quests = { ...(rt.quests || {}) };
  // 7.1.30: квест сдан (stage completed) — его счётчики (сервер показывает 0/100) не цели: убираем, а не пишем «осталось 100»
  if (st.completed) { for (const k of kills) if (quests[k.name]?.prof) delete quests[k.name]; }
  else for (const k of kills) quests[k.name] = { ...(quests[k.name] || { kills: 0, drops: 0 }), total: k.need, done: Math.min(k.have, k.need), left: Math.max(0, k.need - k.have), label: k.name, prof: 1, t: now };
  setRt({ profQuest: { sig, t: now, title: st.titleUk || '', stage: st.stage || '', hint: st.instructionUk || '', open: open.map(k => k.name.toLowerCase()) }, questSeen: seen, quests });
  if (prev?.sig !== sig) rec('B', 'квест профессии', `${st.titleUk || '?'}: ${kills.map(k => `${k.name} ${k.have}/${k.need}`).join(', ') || st.stage}${open.length ? ' — бью как цели квеста' : ''}`);
}
// 8.0.3: полный список эпиков из ответа игры (bosses — из поля eb hook.js, без обрезки до 8) или null
const epicNetList = (d, path) => { const j = path === '/game/epic-bosses' && d.res && !d.res.error ? (Array.isArray(d.eb) ? { ...d.res, bosses: d.eb } : d.res) : null;
  return j && Array.isArray(j.bosses) && j.bosses.length && j.bosses.every(b => b && typeof b === 'object') && j.bosses.length === +j.total ? j : null; };
// 8.0.3: принятый сервером перенос героя — телепорт к РБ/эпику, «Вернуться в город» после смерти
const ZONE_MOVE_RE = /^\/game\/(?:raid-boss\/teleport|epic-boss\/teleport|battle\/return-to-town)$/;
const zoneMoveNet = (d, path) => ZONE_MOVE_RE.test(path) && d.method === 'POST' && d.status >= 200 && d.status < 300 && !d.error && !!d.res && !d.res.error && d.res.ok !== false;
addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin || e.data?.__l2bot !== 'net') return;   // 7.1.30: только из hook.js этой же страницы
  const d = e.data, path = apiPath(String(d.url || ''));
  if (d.rid != null && GAME_REQ.delete(d.rid)) GAME_END = Date.now();   // 8.0.3: запрос игры закончился — она снова принимает клики
  // 8.0.3 (логи 11.10 09:11–09:35): сразу после ответа на ход (и начала боя / «Охотиться дальше») игра ещё занята — время ответа нужно бою
  if (/^\/game\/battle\/(?:action|start|hunt-continue)$/.test(path)) ACT_NET.doneT = Date.now();
  if (path === '/game/battle/action') { ACT_NET.done++; ACT_NET.ok = d.status >= 200 && d.status < 300 && !d.res?.error && !d.res?.blockedBy; ACT_NET.action = d.req?.action || ''; }
  // 9.0 (лог 12.10 01:08:30, Fairy Queen Timiniel 7 092 из 1,9 млн): ход → 400 «Немає активного бою» (battle_none / not_in_battle) — боя на
  // сервере уже нет (РБ добили другие), а страница боя осталась. Бот 23 мин жал вслепую. Метка для боя (combat), снимает её любой принятый ход/новый бой
  if (/^\/game\/battle\/(?:action|start|hunt-continue)$/.test(path) && d.status >= 200 && d.status < 300 && !d.res?.error) ACT_NET.gone = null;
  else if (path === '/game/battle/action' && (d.res?.error === 'battle_none' || d.res?.reason === 'not_in_battle')) ACT_NET.gone = { t: Date.now(), spawn: d.req?.battleSpawnId || '' };
  // 8.0.3 (лог 11.10 10:32:17: «POST /game/battle/action → 409 · 28586 мс», через 1 с — смерть у Барды): ответ на ход дольше 8 с — сервер
  // висел; отметка во вкладке (переживает перезагрузку) — смерть в ближайшие 60 с не «не по силам» (survival.onDeath)
  // 9.2: анализатор боя — ход за ходом из ответа сервера (hook.js bt): урон по цели, удары по нам, спецудары, итог боя → rt.fightMem
  if (d.bt && /^\/game\/battle(?:\/(?:action|start|hunt-continue|sync))?$/.test(path)) try { L2V7Modules.fightlab?.onNet(path, d); } catch (e) { console.warn(TAG, 'fightlab', e); }
  // 9.2: лист врагов — смерть от игрока, игроки на локации, кто напал, начало и победа в ответном бою (hook.js pv)
  if (d.pv || d.bt?.win || path === '/game/battle/pvp/start') try { L2V7Modules.enemies?.onNet(path, d); } catch (e) { console.warn(TAG, 'враги', e); }
  if (path === '/game/battle/action' && +d.ms > 8000) srvHangMark(`ответ на ход ${Math.round(d.ms / 1000)} с`);
  // 8.0.3 (лог 11.10 11:44:46): «Вернуться в город» нажато (ботом или игроком, и при остановленном боте) — герой воскрешён (survival.reviveStep)
  if (path === '/game/battle/return-to-town' && d.status >= 200 && d.status < 300) try { sessionStorage.setItem('l2bot.toTown', String(Date.now())); } catch (e) {}
  // 7.2.3 (лог 10.10 23:19–23:30: зарядов 310 → 139 при минимуме 500, а закупки не было): сумка из ответов сервера
  // (character.inventory.stacks, hook.js отдаёт её целиком полем inv — в res массивы обрезаны) — количество не зависит
  // от того, видна ли кнопка на панели (после победы бот сразу уходит на карту)
  { const m = invNote(d.inv); if (m) { INV_NET = { m, t: Date.now() }; try { sessionStorage.setItem('l2bot-inv', JSON.stringify(INV_NET)); } catch (e) {}
    // 9.0: камни печати и Ancient Adena — для меню (раздел «Катакомбы»): пишем при изменении, не чаще раза в минуту
    const sg = [6360, 6361, 6362, 5575].map(id => m[id] || 0), ss = rt.sealSeen;
    if (tabOwner && (!ss || ss.q?.join() !== sg.join()) && Date.now() - (ss?.t || 0) > 60000) setRt({ sealSeen: { q: sg, t: Date.now() } }); } }
  if (d.dm && Array.isArray(d.dm.mobs)) DUNG_NET = { id: d.dm.id, mobs: d.dm.mobs, t: Date.now() };
  { const ch = d.res?.character; if (ch && typeof ch === 'object' && 'activeDungeonId' in ch) { HERO_AT = { dung: ch.activeDungeonId ? String(ch.activeDungeonId) : null, loc: String(ch.locationType || ''), t: Date.now() };
    try { sessionStorage.setItem('l2bot-at', JSON.stringify(HERO_AT)); } catch (er) {} } }
  if (path === '/game/ancient-trader/exchange' && d.method === 'POST') SEAL_NET = { t: Date.now(), status: d.status, ok: d.status >= 200 && d.status < 300 && !d.error && !d.res?.error,
    msg: String(d.res?.messageRu || d.res?.messageUk || d.res?.error || d.error || '').slice(0, 160), stone: d.req?.stone, qty: +d.req?.qty || 0 };
  // 9.0: Маммон — экипировка (уровни плаща/пояса/тату), список кузнеца и заказ из запросов самой игры (игрок открыл страницу)
  if (tabOwner && d.status >= 200 && d.status < 300 && d.res) try {
    const ch = d.res.character; if (ch?.inventory?.eq) L2V7Modules.mammon.eqNote(ch.inventory.eq);
    if (path === '/game/mammon/blacksmith/upgrades' && Array.isArray(d.res.items)) L2V7Modules.mammon.smithNote(d.res.items);
    if (path === '/game/mammon/merchant/request' && d.res.request) L2V7Modules.mammon.orderNote(d.res.request);
  } catch (e) {}
  // 9.0 (новости игры 11.10): квесты сабкласса и Noblesse — из опросов самой игры (карта, страницы квестов); /character — свой Noblesse и класс
  if (tabOwner && d.status >= 200 && d.status < 300 && d.res && !d.res.error) try {
    const m = path.match(/^\/game\/story-quests\/(noblesse|subclass)$/);
    if (m && d.res.quest) L2V7Modules.story.qNote(m[1], d.res.quest);
    // только свой герой: /character, /character/subclasses*, страницы квестов (в ответах рейтинга/арены бывает чужой character)
    const ch = d.res.character; if (ch && typeof ch === 'object' && /^\/(?:character(?:\/subclasses(?:\/\w+)?)?|game\/story-quests\/[\w-]+(?:\/\w+)?)$/.test(path)) L2V7Modules.story.charNote(ch);
  } catch (e) {}
  if (!path || /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ico)$/i.test(path)) return;
  if (!pageLeaving) observeGameHttp(path, d.status);
  logCooldownApi(d, path);
  const secret = /login|auth|register|passw|token|session|sign-?in|sign-?up|enter-game|account/i.test(path);   // v5.6: + вход/регистрация в других написаниях
  const key = `${d.method} ${path}`, body = secret ? '(скрыто)' : d.res != null ? JSON.stringify(d.res) : '';
  if (path === '/game/battle/leave' && d.method === 'POST' && rt.epic?.step === 'retreatVerify') {
    const id = d.req?.battleSpawnId;
    if (id && id === rt.epic.id) try { sessionStorage.setItem('l2bot.epicLeave', JSON.stringify({ id, at: Date.now(), ok: !d.error && d.status >= 200 && d.status < 300 && !d.res?.error })); } catch (er) {}
  }
  // 8.0.3 (эпики, разбор 11.10): список эпиков и цифры босса — пассивно, когда их запрашивает сама игра (страница «Эпик боссы», нажатие
  // на РБ на карте). Список — только полный (все элементы объекты и их ровно total: hook.js режет массивы длиннее 8)
  // 8.0.3 (лог 11.10 11:41–11:44: total 8 — ровно на пределе обрезки): hook.js отдаёт bosses целиком полем eb (как inv/sp) — 9-й эпик
  // не выключит разбор молча
  { const eb = epicNetList(d, path);
    if (eb) try { L2V7Modules.epics.epicApiNote(eb, 'page').then(r => r && L2V7Modules.epics.epicVerdictAll()).catch(() => {}); } catch (er) {} }
  // 8.0.3 (логи 11.10 10:32:50, 11:43:34, 11:44:46): телепорт к РБ/эпику (бот или игрок) и «Вернуться в город» после смерти уносят героя —
  // прежняя зона больше не та: EXP/ч и «зона РБ» писались в чужую (Ядро@bee_hive), автофарм решал «остаюсь здесь» по ней. Зону и «мягкое
  // окно» уровней определит карта заново
  if (zoneMoveNet(d, path) && (rt.zone || rt.zonePend || rt.lvlRelax || rt.lvlRelaxDown)) setRt({ zone: null, zonePend: null, lvlRelax: null, lvlRelaxDown: null });
  { const m = path.match(/^\/game\/spawn\/(l2dop_rb_\d+)\/info$/);
    if (m && d.res?.stats?.maxHp > 0 && !d.res.error) try { L2V7Modules.raid.rbInfoNote(m[1], d.res, 'page').then(() => epicById(m[1]) && L2V7Modules.epics.epicVerdictAll()).catch(() => {}); } catch (er) {} }
  // запрос телепорта к эпику ещё ни разу не видели (у РБ — POST /game/raid-boss/teleport): любой POST «…/teleport» в 10 с после нажатия
  // «Телепорт» на странице эпиков — ответ сервера в sessionStorage (отказ → резерв Coin of Luck снимается), путь и тело — в журнал.
  // 8.0.3 (ревью): отказ — только явный (epicTpAckOf: 4xx с телом ошибки, 2xx с error/ok:false); 5xx, обрыв, «нет ответа» — «неизвестно»,
  // резерв остаётся (CoL могли списать). Запрос про другой spawnId (epicTpReqFor) — не наш, не учитываем
  if (d.method === 'POST' && /\/teleport(\/|$|\?)/.test(path) && rt.epic?.step === 'arrive' && rt.epic.via === 'page' && Date.now() - (rt.epic.tpT || 0) < 10000) try {
    const EP = L2V7Modules.epics, mine = EP.epicTpReqFor(d, path, rt.epic.id), a = EP.epicTpAckOf(d), msg = String(d.res?.messageRu || d.res?.messageUk || d.res?.error || d.error || '').slice(0, 120);
    if (mine) sessionStorage.setItem('l2bot.epicTp', JSON.stringify({ path, status: d.status, ok: a.ok, msg, t: Date.now() }));
    rec('B', 'эпики', `телепорт к эпику: ${d.method} ${path} → ${d.status || d.error} · запрос ${JSON.stringify(d.req ?? null).slice(0, 200)}${msg ? ' · ' + msg : ''}${!mine ? ' · запрос не к этому эпику — не учитываю' : a.ok === null ? ' · ответ неясен — резерв оставляю' : ''}`);
  } catch (er) {}
  if (path === '/game/tvt' && d.res && !d.res.error) { TVT = { ...d.res, t: Date.now(), off: tvtMs(d.res.serverNow) ? tvtMs(d.res.serverNow) - Date.now() : 0 };
    const k = `${TVT.eventId}|${TVT.phase}|${TVT.isRegistered}`; if (rt.tvt?.k !== k) setRt({ tvt: { k, eventId: TVT.eventId, phase: TVT.phase, isRegistered: TVT.isRegistered, myTeam: TVT.myTeam, startsAt: TVT.startsAt, schedule: TVT.schedule, t: Date.now() } }); }
  if (/\/game\/tvt\/(combat\/sync|target|target\/clear)$/.test(path) && d.res && !d.res.error) TVTC = { ...d.res, t: Date.now() };
  if (path === '/game/tvt/action' && d.res && !d.res.error && TVTC?.selectedTarget) TVTC.selectedTarget = { ...TVTC.selectedTarget, hp: d.res.targetHp, cp: d.res.targetCp, alive: !d.res.targetDead };
  // 9.2 (лог 11.10 03:00): павший враг — по ответу удара (targetDead) или отказу выбрать цель (tvt_target_dead), см. tvt.tvtDeadNote
  if (path === '/game/tvt/action' && d.res?.targetDead) L2V7Modules.tvt.tvtDeadNote(d.res.targetCharacterId || TVTC?.selectedTarget?.characterId);
  if (path === '/game/tvt/target' && d.res?.error === 'tvt_target_dead') L2V7Modules.tvt.tvtDeadNote(d.req?.targetCharacterId);
  if (Array.isArray(d.sp) && d.sp.length && !document.prerendering) netSpawns(d.sp).catch(er => console.warn(TAG, 'spawns', er));
  if (d.res?.error && /\/game\/(battle|dungeon)\//.test(path)) NET_ERR = { t: Date.now(), err: d.res.error, path };   // v5.3.1: ответ «battle_too_far» и т.п.
  // v5.6.4: серверный GCD + индивидуальные откаты учитываются раздельно.
  // Отказ blockedBy=global НИКОГДА не обучает память КД конкретного скилла.
  if (path === '/game/battle/action' && d.res && d.req?.action) {
    if (d.req.battleSpawnId) GAME_SPAWN = String(d.req.battleSpawnId);
    combatCooldown.observe(d.req, d.res, d.status, cdSpawn());
  }
  // Mage rotations must respect server GCD from background battle sync.
  // The page hotbar often reports a spell ready while globalCooldownUntilMs
  // still prohibits every action (observed Wind Strike HTTP 400).
  if ((path === '/game/battle/sync' || path === '/game/battle') && d.res && !d.res.error) {
    combatCooldown.observeSync(d.res, cdSpawn());
  }
  if (/^\/game\/battle(?:\/(?:sync|action))?$/.test(path) && d.res) alignServerSkillCooldowns();
  // 7.1.16-fix: слуга мага — из ответа сервера (activeSummon: {key, hp, maxHp…} или null). Только явное поле, без догадок по разметке
  if (/^\/game\/battle(?:\/(?:sync|action|start|hunt-continue))?$/.test(path) && d.res && typeof d.res === 'object' && !d.res.error) try {
    const src = d.res.battle && typeof d.res.battle === 'object' && 'activeSummon' in d.res.battle ? d.res.battle : d.res;
    if ('activeSummon' in src) { const s = src.activeSummon; PET = { t: Date.now(), has: !!s, key: s?.key || PET?.key || '', name: s?.nameUk || PET?.name || '', hp: +s?.hp || 0, maxHp: +s?.maxHp || 0 };
      if (s?.key && rt.petLast !== s.key && tabOwner) setRt({ petLast: s.key }).catch(() => {}); }   // 8.0.3: последний живой кот — переживает перезагрузку (combat.petPick)
  } catch (er) {}
  // v5.5.1: темп обычной атаки — от сервера. С луком (лог 08.10 19:32) интервал атаки длиннее, кнопка «готова» раньше, игра
  // отвечала «ещё на перезарядке», а бот из-за ошибки памяти КД ждал 5–6 с между выстрелами. Сервер в ответе на удар пишет,
  // когда можно бить снова (nextPhysicalAttackAt / attackIntervalMs, при отказе — remainingMs / readyAtMs) — по нему и бьём
  if (path === '/game/battle/action' && d.res && (d.req?.action === 'attack' || d.res.requestedAction === 'attack')) try {
    const r = d.res, b = r.battle && typeof r.battle === 'object' ? r.battle : {}, nowS = r.serverNowMs || r.nowMs || b.serverNowMs;
    const nx = r.nextPhysicalAttackAt || b.nextPhysicalAttackAt || r.readyAtMs, iv = r.attackIntervalMs || b.attackIntervalMs;
    let wait = r.remainingMs != null && !/^2/.test(String(d.status)) ? +r.remainingMs : nx && nowS ? nx - nowS : /^2/.test(String(d.status)) && iv ? +iv : null;
    if (wait != null && isFinite(wait) && wait >= 0 && wait < 15000) {
      const k = skKey(slotsBy(cfg.nAttack || 'Атака')[0]) || 'атака';
      ATK_NET = { t: Date.now(), wait, iv: iv || ATK_NET?.iv || null };
      rt.cdUntil = { ...(rt.cdUntil || {}), [k]: Date.now() + wait + 40 };   // только в памяти вкладки: часто, писать в storage незачем
    }
  } catch (er) {}
  // Skill deadlines are managed by battle-cooldown.js (server time + sequence order).
  // Do not independently write rt.cdUntil using Math.max or retain a stale estimate.
  if (d.res?.code === 'pve_farm_blocked' || d.res?.error === 'pve_farm_blocked') try {   // v5.5.6: игра заблокировала PvE-фарм
    const u = Date.parse(d.res.blockedUntil || '') || (d.res.remainingSeconds ? Date.now() + d.res.remainingSeconds * 1000 : 0);
    if (u && u !== rt.pveBlockUntil) setRt({ pveBlockUntil: u, pveBlockMsg: d.res.messageRu || d.res.messageUk || '' });
  } catch (er) {}
  // 7.1.30 (лог 10.10 15:43): игрок сам надел Demon's Staff (C), а бот помнил «надето: Лялька вуду NG» и купил 3000 NG-зарядов.
  // Надевание оружия видно по запросу к серверу — сразу обновляем «надетое» по базе предметов (грейд, тип, P/M.Atk)
  if (path === '/character/equip' && d.method === 'POST' && d.req && !d.error && /^2/.test(String(d.status)) && !d.res?.error) try { weaponEquipNote(d.req); } catch (er) {}
  if (path === '/game/drops-shop/buy' && d.method === 'POST') SHOP_BUY = { t: Date.now(), key: String(d.req?.shopKey || ''), qty: +d.req?.qty || 0, ok: !d.error && /^2/.test(String(d.status)) && !d.res?.error };
  // v5.3: для сторожа рыбалки. 8.0.3 (лог 11.10): + обрыв запроса (err — fishAct сразу жмёт снова, а не ждёт 15 с), отметка сервера
  // serverNowMs и длительность запроса (откат считается от того, когда сервер принял нажатие, — fishing.fishNet), fishing.cooldowns
  if (/\/game\/fishing\/action$/.test(path)) {
    const fz = d.res?.fishing && typeof d.res.fishing === 'object' ? d.res.fishing : null;
    NET_FISH = { t: Date.now(), ok: !d.error && /^2/.test(String(d.status)), act: d.req?.action || '', err: d.error ? String(d.error) : '', code: String(d.res?.error || ''), srv: +fz?.serverNowMs || 0, ms: +d.ms || 0, cds: fz?.cooldowns };
    try { L2V7Modules.fishing.fishNet(NET_FISH); } catch (er) {}
  }
  // 7.1.30: квест профессии (Алхімік Орфеус: «★ Giant Fungus ×100 і ★ Dire Wyrm ×15»). Сервер отдаёт счётчики убийств —
  // делаем этих мобов целями квеста: уровень-окно к ним не применяется, бот не улетает «в зону своего уровня» (лог 10.10 13:22)
  if (/\/character\/profession-quest\/[\w-]+\/status$/.test(path) && d.res?.status && !d.res.error) try { profQuestNote(d.res.status); } catch (er) {}
  if (cfg.autoLearn !== false && LEARN) try { learnApi(key, secret ? {} : d); } catch (er) {}
  if (cfg.netLog === false || !cfg.rec) return;
  if (d.error && pageLeaving) return;
  const h = hashStr(body), prev = netSeen.get(key), now = Date.now();
  if (prev && prev.h === h && now - prev.t < 15000) return;                // одинаковый ответ опроса — реже
  // v5.2: журнал разрастался до 40 МБ — игра опрашивает сервер по многу раз в секунду. Обычный GET с ответом 2xx
  // по одному адресу — не чаще раза в 3 с (ошибки, POST и новые адреса — всегда); ответ в журнале — до 800 знаков
  const okGet = d.method === 'GET' && !d.error && /^2/.test(String(d.status));
  if (okGet && prev && now - prev.t < 3000) return;
  // фоновые опросы игры (непрочитанные, чат, время, онлайн, ТвТ, новости, квесты профессий, синхронизация) — 90 % объёма
  // журнала (лог 08.10: 38,7 из 43 МБ). Их — только при новом ответе и не чаще раза в минуту; ошибки — всегда
  if (okGet && prev && NET_NOISE.test(path) && (prev.h === h || now - prev.t < 60000)) return;
  netSeen.set(key, { h, t: now });
  if (netSeen.size > 500) netSeen.delete(netSeen.keys().next().value);
  const st = d.error ? `ошибка: ${d.error}` : d.status;
  rec('N', 'сеть', `${key}${d.url.includes('?') && !secret ? ' ?' + d.url.split('?')[1].slice(0, 80) : ''} → ${st}${d.ms != null ? ` · ${d.ms} мс` : ''}${d.len ? ` · ${d.len} б` : ''}`,
    { data: { q: secret ? '(скрыто)' : d.req ?? undefined, r: body.slice(0, 800) || undefined } });
});
// сообщения игры: тосты, ошибки, результаты действий — всё, что всплывает на экране
const GAME_MSG_SEL = '[role="alert"], [aria-live], [class*="toast"], [class*="notice"], [class*="notify"], [class*="-msg"], [class*="result"], [class*="error"], [class*="success"]';
const gmSeen = new Map();
let gmQueue = new Set(), gmTimer = null;
function gameMsgFlush() {
  gmTimer = null;
  for (const el of gmQueue) {
    if (!el.isConnected || !shown(el) || el.closest('#l2bot-dock, #l2bot-ind, #battle-log, #fishing-log, #rb-list, #map-mob-list')) continue;
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 300 || /^\d+([.,]\d+)?$/.test(t)) continue;
    const now = Date.now(); if (now - (gmSeen.get(t) || 0) < 5000) continue;
    gmSeen.set(t, now); if (gmSeen.size > 300) gmSeen.clear();
    rec('G', 'игра', t, { el: (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 2).map(c => '.' + c).join('') });
  }
  gmQueue = new Set();
}
function gameMsgWatch() {
  if (!document.body || isPrivate()) return;
  new MutationObserver(ms => {
    if (!cfg.rec || cfg.gameMsgLog === false) return;
    let budget = 60;                              // в бою разметка меняется постоянно — смотрим не больше 60 узлов за раз
    for (const m of ms) {
      if (budget <= 0) break;
      const nodes = m.type === 'characterData' ? [m.target.parentElement] : [...m.addedNodes].filter(n => n.nodeType === 1);
      for (const n of nodes) { if (--budget < 0) break; const el = n?.closest?.(GAME_MSG_SEL) || (n?.matches?.(GAME_MSG_SEL) ? n : null); if (el) gmQueue.add(el); }
    }
    if (gmQueue.size && !gmTimer) gmTimer = setTimeout(gameMsgFlush, 400);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
// такт обучения: структура страницы — через 4 с после загрузки, селекторы — через 20 с и потом раз в минуту
function learnStart() {
  if (cfg.autoLearn === false) return;
  learnLoad().then(() => {
    setTimeout(() => { try { learnPage(); } catch (e) {} }, 4000);
    setTimeout(() => { try { learnSelectors(); } catch (e) {} }, 20000);
    setInterval(() => { try { if (cfg.autoLearn !== false) learnSelectors(); } catch (e) {} }, 60000);
  }).catch(() => {});
}
// ошибки скрипта бота, не пойманные циклом. v5.6: обрыв запросов самой игры при переходе страницы (Firefox: «NetworkError when
// attempting to fetch», 56 строк за час) — не ошибка бота, в журнал не пишем
addEventListener('error', e => { if (e.filename && /(chrome|moz)-extension:/.test(e.filename)) rec('S', 'ошибка JS', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`); });
addEventListener('unhandledrejection', e => { const m = String(e.reason?.message || e.reason || ''); if (m && !/Extension context|message port|Receiving end|NetworkError|Failed to fetch|Load failed|AbortError|aborted/i.test(m)) rec('S', 'ошибка JS', `promise: ${m.slice(0, 160)}`); });
setTimeout(() => { try { gameMsgWatch(); learnStart(); } catch (e) {} }, 1500);
// тяжёлая страница (форум «Фарм ресурсов»: 800+ источников) — innerText/снимок/скелет всей страницы её вешают (v4.15–4.17)
const heavyPage = () => !isBattle() && document.getElementsByTagName('*').length > 3500;
function logLines() {                          // строки лога боя (или текст страницы вне боя)
  const box = $q('#battle-log');
  if (!box && heavyPage()) return [];
  // текст строки собираем из частей через пробел: «Force Burst: сила 171» + «2696» — иначе склеивается в «сила 1712696» (v4.23)
  const txt = l => { const b = l.querySelector('.l2-battle-log-line__body'); return b && b.children.length > 1 ? [...b.children].map(c => c.textContent.trim()).join(' ') : l.textContent; };
  const src = box ? [...box.querySelectorAll('.l2-battle-log-line')].map(txt) : document.body.innerText.split('\n');
  return src.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function newLines(before, after) {             // новые строки лога (одинаковые строки прошлых боёв не считаются новыми)
  const c = new Map(); before.forEach(l => c.set(l, (c.get(l) || 0) + 1));
  return after.filter(l => { const n = c.get(l) || 0; if (n) { c.set(l, n - 1); return false; } return true; });
}
let prevLines = null;
function recBot(s) {
  if (!cfg.rec) return;
  const cur = logLines();
  const added = prevLines ? cur.filter(l => !prevLines.has(l)).slice(0, 10) : [];
  prevLines = new Set(cur);
  rec('B', 'бот', s, { added });
}
function slotDesc(b) {
  const tm = b.querySelector('.l2-battle-hotbar-slot-cd__timer')?.textContent.trim();
  const q = qty(b);
  return `слот #${+b.dataset.slotIdx + 1} «${(b.title || '').slice(0, 50)}»${ready(b) ? '' : ' КД ' + (tm || '?')}${q != null ? ' ×' + q : ''}`;
}
function slotStates() {
  const f = (k, b) => b ? `${k}:${ready(b) ? 'ok' : 'КД' + (cdLeft(b) < 99 ? cdLeft(b) : '')}` : `${k}:∅`;
  const sh = shotSlot(), mpP = slotsBy(cfg.nMpPot)[0];
  return [f('power', slotsBy(cfg.nPower)[0]), f('stun', slotsBy(cfg.nStun)[0]),
          f('attack', slotsBy(cfg.nAttack).find(ready) || slotsBy(cfg.nAttack)[0]),
          ...names(cfg.nBuffs).map(n => f('buff', slotsBy(n)[0]) + (buffActive(n) ? '(активен)' : '')),
          `shots:${sh ? (shotsOn(sh) ? 'on' : 'off') : '∅'}`, `mpPot:${mpP ? qty(mpP) : '∅'}`].join(' ');
}
function describe(el) {
  const fb = el.closest('.l2-fishing-hotbar-slot');
  if (fb) { const f = fishState();
    return `рыбалка: ${fb.dataset.slot}${fb.disabled ? ' (недоступно)' : ''}${qty(fb) != null ? ' ×' + qty(fb) : ''}${f ? ` · рыба ${f.name} ${f.cur}/${f.max} «${f.st}»` : ''}`; }
  const b = el.closest('.l2-battle-hotbar-slot');
  if (b) return slotDesc(b);
  const c = el.closest('a,button,[onclick],[role="button"],[role="tab"],label,li') || el;
  const id = c.id ? '#' + c.id : '';
  const cls = [...c.classList].slice(0, 2).map(x => '.' + x).join('');
  const data = Object.entries(c.dataset || {}).filter(([k]) => !/i18n|sig/i.test(k)).slice(0, 4)
    .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join(' ');
  const zone = c.closest('[aria-label],section[id],[id$="-root"],[id$="-panel"],[id$="-list"]');
  const zl = zone && zone !== c ? (zone.getAttribute('aria-label') || '#' + zone.id).slice(0, 40) : '';
  const href = c.closest('a')?.getAttribute('href') || '';
  const txt = isPrivate() ? '' : ` «${(c.textContent.trim() || c.title || c.getAttribute('aria-label') || '').replace(/\s+/g, ' ').slice(0, 80)}»`;
  return `${c.tagName.toLowerCase()}${id}${cls}${txt}${data ? ' {' + data + '}' : ''}${zl ? ' в [' + zl + ']' : ''}${href && !isPrivate() ? ' → ' + href : ''}`;
}

// ваши клики (isTrusted = настоящий клик; клики бота сюда не попадают)
addEventListener('click', e => {             // ручная смена оружия игроком — запоминаем, что надето
  if (!e.isTrusted) return;
  const w = e.target.closest('.l2-battle-hotbar-slot');
  if (w && isEquip(w)) setRt({ weaponNow: cleanTitle(w.title) });
}, true);
addEventListener('click', e => {             // профиль скилла — всегда, даже без журнала
  if (!e.isTrusted || cfg.rec) return;
  const hb = e.target.closest('.l2-battle-hotbar-slot:not(.l2-battle-hotbar-slot--empty):not(.l2-fishing-hotbar-slot)');
  if (hb) observeSlot(hb, 'U');
}, true);
addEventListener('click', e => {
  if (!e.isTrusted || !cfg.rec || e.target.closest?.('#l2bot-dock')) return;   // панель бота — не игра
  if (e.target.closest('input[type=text],input[type=password],input:not([type]),textarea,[contenteditable]')) return; // поля ввода не пишем
  const what = describe(e.target);
  rec('U', 'клик', what, { slots: isBattle() ? slotStates() : '' });
  const hb = e.target.closest('.l2-battle-hotbar-slot:not(.l2-battle-hotbar-slot--empty):not(.l2-fishing-hotbar-slot)');
  if (hb) observeSlot(hb, 'U');
  if (isPrivate()) return;                                    // на приватных страницах — без «итога»
  if (heavyPage()) {                                          // тяжёлая страница: итог — только текст нажатой строки
    const row = e.target.closest('.l2-farm-row, li, tr, [class*="row"], [class*="item"]');
    setTimeout(() => { const t = (row?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300); if (t) rec('U', 'итог', what, { added: [t] }); }, 1200);
    return;
  }
  const before = new Set(logLines()), href = location.href;
  setTimeout(() => {
    if (location.href !== href) return;                       // ушли на другую страницу — итог покажет [S]
    const added = logLines().filter(l => !before.has(l)).slice(0, 20);
    if (added.length) rec('U', 'итог', what, { added });
  }, 1500);
}, true);

// ---- автоснимки: каждое НОВОЕ состояние страницы (адрес + вкладка/диалог), повторы — по хэшу структуры ----
function pageState() {                          // человекочитаемое состояние: адрес [активные вкладки] {открытые окна}
  const act = [...document.querySelectorAll('[role=tab][aria-selected="true"], .is-active, [aria-current="page"]')]
    .filter(shown).map(e => (e.id || e.textContent.trim().replace(/\s+/g, ' ')).slice(0, 25)).slice(0, 3);
  const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal"], [class*="popup"], [class*="dialog"]')]
    .filter(shown).map(e => e.id || e.getAttribute('aria-label') || [...e.classList][0]).slice(0, 2);
  return location.pathname + (act.length ? ` [${act.join(', ')}]` : '') + (dlg.length ? ` {${dlg.join(', ')}}` : '');
}
function skel(el, depth = 0) {                  // скелет разметки: теги и классы видимых элементов, без текста и повторов
  if (depth > 30) return '';
  const kids = new Set();
  if (el.matches?.('[id*="log"], ul, ol, [class*="-list"], [class*="hotbar__grid"], #battle-whirlwind-extras, [id*="loot"], [id*="toast"], [id*="notice"]'))
    return `${el.tagName}${el.id ? '#' + el.id : ''}(…)`;   // содержимое меняется от боя к бою — структуру не меняет
  for (const c of el.children) {
    if (c.hidden || /^(SCRIPT|STYLE|NOSCRIPT|svg|path)$/i.test(c.tagName)) continue;
    kids.add(skel(c, depth + 1));                 // одинаковые строки списка схлопываются в одну
  }
  const cls = [...el.classList].filter(c => !/active|selected|current|hover|focus|enabled|disabled|--lvl|--quest|--empty|anim/i.test(c)).sort().join('.');
  return `${el.tagName}${el.id ? '#' + el.id : ''}.${cls}(${[...kids].sort().join(',')})`;
}
function structHash() {                         // FNV-1a по адресу + скелету
  let h = 2166136261 >>> 0;
  const str = location.pathname + '|' + skel(document.body);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
const sentSnaps = new Set();
let snapTimer = null;
function trySnap(delay) {                       // отложенно и не чаще раза в delay мс
  if (!cfg.rec || !cfg.autoSnap || isPrivate()) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    if (heavyPage()) {                            // тяжёлую страницу снимаем один раз за заход (кнопка «📸 Эта стр.» — вручную)
      if (sentSnaps.has('heavy:' + location.pathname)) return;
      sentSnaps.add('heavy:' + location.pathname);
    }
    const key = heavyPage() ? 'heavy:' + location.pathname + ':' + Math.floor(Date.now() / 3600000) : structHash();
    if (sentSnaps.has(key)) return;
    sentSnaps.add(key);
    try {
      chrome.runtime.sendMessage({ cmd: 'snapHas', key }, has => {
        if (chrome.runtime.lastError || has) return;
        const state = pageState();
        chrome.runtime.sendMessage({ cmd: 'snap', key, state, html: domSnapshot() });
        rec('S', 'новый снимок', state);
      });
    } catch (e) {}
  }, delay);
}

// загрузка страницы: заголовок и разделы + снимок; после кликов — снимок, если страница стала новой
setTimeout(() => {
  if (!cfg.rec) return;
  const heads = isPrivate() ? [] : [...document.querySelectorAll('h1,h2,h3,[role=tab].is-active,[aria-selected=true]')]
    .map(h => h.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 5);
  rec('S', 'страница', document.title, { added: heads });
  if (!isBattle()) trySnap(0);                     // бой снимается позже, после отрисовки панели
}, 2500);
addEventListener('click', e => { if (e.isTrusted && !isBattle() && !e.target.closest?.('#l2bot-dock')) trySnap(1800); }, true);
if (location.pathname === FARM_URL) {             // «Фарм ресурсов»: раскрытую игроком строку — в базу (только эту строку)
  let farmIconT = setTimeout(() => farmIcons().catch(() => {}), 4000);
  addEventListener('click', e => {
    const row = e.target.closest?.('.l2-farm-row');
    if (row) setTimeout(() => { const r = farmRowParse(row); if (r) { r.cat = farmCatOf(row); farmSave([r]).catch(() => {}); } }, 1500);
    clearTimeout(farmIconT); farmIconT = setTimeout(() => farmIcons().catch(() => {}), 2500);   // раскрытый раздел — его картинки
  }, true);
}
if (/\/forum/i.test(location.pathname)) {        // форум: кнопки телепорта и РБ — в базу (сразу и после раскрытия строк)
  setTimeout(() => forumRbParse().catch(() => {}), 2500);
  addEventListener('click', () => setTimeout(() => forumRbParse().catch(() => {}), 1200), true);
}   // в бою разметка одна и та же

// снимок разметки страницы (без скриптов и полей ввода)
function domSnapshot() {
  if (document.getElementsByTagName('*').length > 3500) {   // огромная страница: по частям, до 400 КБ, без клонирования всего
    let html = '', n = 0;
    const walk = el => { for (const ch of el.children) { if (html.length > 400000) return; if (/^(SCRIPT|STYLE|NOSCRIPT|IFRAME|INPUT|TEXTAREA)$/.test(ch.tagName)) continue;
      const oh = ch.outerHTML; if (oh.length < 60000) { html += oh.replace(/\s{2,}/g, ' '); n++; } else { html += `<${ch.tagName.toLowerCase()} class="${ch.className}">`; walk(ch); html += `</${ch.tagName.toLowerCase()}>`; } } };
    walk(document.body);
    return `<!-- ${location.pathname}${location.search} · ${new Date().toISOString()} · крупная страница, ${n} блоков -->\n<body class="${document.body.className}">${html.slice(0, 400000)}</body>`;
  }
  const c = document.body.cloneNode(true);
  c.querySelectorAll('script,style,noscript,iframe').forEach(n => n.remove());
  c.querySelectorAll('input,textarea').forEach(n => { n.removeAttribute('value'); n.textContent = ''; });
  let html = c.outerHTML.replace(/\s{2,}/g, ' ');
  if (html.length > 400000) html = html.slice(0, 400000) + '<!-- обрезано -->';
  return `<!-- ${location.pathname}${location.search} · ${new Date().toISOString()} -->\n${html}`;
}

// проверка панели: какие слоты нашлись по названиям
function panelReport() {
  const all = [...document.querySelectorAll(SLOT)].filter(shown);
  const roles = [['Атака', cfg.nAttack], ...names(cfg.nPower).map(n => ['Силовая', n]), ...names(cfg.nStun).map(n => ['Стан', n]),
                 ['Соски', cfg.nShots], ['Банка MP', cfg.nMpPot], ['Банка HP', cfg.nHpPot], ...names(cfg.nBuffs).map(n => ['Бафф', n])]
    .filter(([, s]) => names(s).length)
    .map(([r, s]) => { const b = r === 'Соски' ? shotSlot() : slotsBy(s)[0]; return `${b ? '✅' : '❌'} ${r}: ${b ? slotDesc(b) + (r === 'Соски' ? (shotsOn(b) ? ' · ВКЛ' : ' · ВЫКЛ') : '') : 'не найден («' + s + '»)'}`; });
  return { battle: isBattle(), roles, panel: all.map(slotDesc) };
}


// ===== v7 dependency injection: lazy bindings preserve per-character dynamic state =====
L2V7Modules.fishing = L2V7Factories.fishing({ get waitX(){return waitX}, get rtCommit(){return rtCommit}, get $q() { return $q; }, set $q(value) { $q = value; },
  get CD_RE() { return CD_RE; }, set CD_RE(value) { CD_RE = value; },
  get FCD() { return FCD; }, set FCD(value) { FCD = value; },
  get GEAR_RE() { return GEAR_RE; }, set GEAR_RE(value) { GEAR_RE = value; },
  get MATERIAL_RE() { return MATERIAL_RE; }, set MATERIAL_RE(value) { MATERIAL_RE = value; },
  get NET_FISH() { return NET_FISH; }, set NET_FISH(value) { NET_FISH = value; },
  get ROD_NONE_RE() { return ROD_NONE_RE; }, set ROD_NONE_RE(value) { ROD_NONE_RE = value; },
  get ROD_RE() { return ROD_RE; }, set ROD_RE(value) { ROD_RE = value; },
  get autonomyMode() { return autonomyMode; }, set autonomyMode(value) { autonomyMode = value; },
  get byText() { return byText; }, set byText(value) { byText = value; },
  get cdBusy() { return cdBusy; }, set cdBusy(value) { cdBusy = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get fishCdMsg() { return fishCdMsg; }, set fishCdMsg(value) { fishCdMsg = value; },
  get fishGearMsg() { return fishGearMsg; }, set fishGearMsg(value) { fishGearMsg = value; },
  get fishGearN() { return fishGearN; }, set fishGearN(value) { fishGearN = value; }, get fishCast() { return fishCast; }, set fishCast(value) { fishCast = value; }, get TAG() { return TAG; },
  get fishLastPre() { return fishLastPre; }, set fishLastPre(value) { fishLastPre = value; },
  get fishMut() { return fishMut; }, set fishMut(value) { fishMut = value; },
  get fishNoResp() { return fishNoResp; }, set fishNoResp(value) { fishNoResp = value; },
  get fishObs() { return fishObs; }, set fishObs(value) { fishObs = value; },
  get fishShotsSess() { return fishShotsSess; }, set fishShotsSess(value) { fishShotsSess = value; },
  get halt() { return halt; }, set halt(value) { halt = value; },
  get idle() { return idle; }, set idle(value) { idle = value; },
  get isBite() { return isBite; }, set isBite(value) { isBite = value; },
  get isCast() { return isCast; }, set isCast(value) { isCast = value; },
  get isNoBite() { return isNoBite; }, set isNoBite(value) { isNoBite = value; },
  get itemJson() { return itemJson; }, set itemJson(value) { itemJson = value; },
  get names() { return names; }, set names(value) { names = value; },
  get on() { return on; }, set on(value) { on = value; },
  get qty() { return qty; }, set qty(value) { qty = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rodScrollsBuy() { return rodScrollsBuy; }, set rodScrollsBuy(value) { rodScrollsBuy = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; } });
L2V7Modules.epics = L2V7Factories.epics({ get shown() { return shown; }, get gameAuth() { return gameAuth; }, get invQty() { return invQty; }, get rbInfo() { return (...a) => L2V7Modules.raid.rbInfo(...a); }, get rbPreCheck() { return rbPreCheck; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get EPICS() { return EPICS; }, set EPICS(value) { EPICS = value; },
  get EPIC_URL() { return EPIC_URL; }, set EPIC_URL(value) { EPIC_URL = value; },
  get LV_RE() { return LV_RE; }, set LV_RE(value) { LV_RE = value; },
  get aroundSig() { return aroundSig; }, set aroundSig(value) { aroundSig = value; },
  get attackSpawn() { return attackSpawn; }, set attackSpawn(value) { attackSpawn = value; },
  get buffWaitBeforeRb() { return buffWaitBeforeRb; }, set buffWaitBeforeRb(value) { buffWaitBeforeRb = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get fishCut() { return fishCut; }, set fishCut(value) { fishCut = value; },
  get fishExchange() { return fishExchange; }, set fishExchange(value) { fishExchange = value; },
  get fishState() { return fishState; }, set fishState(value) { fishState = value; },
  get fishing() { return fishing; }, set fishing(value) { fishing = value; },
  get goFishing() { return goFishing; }, set goFishing(value) { goFishing = value; },
  get heroLvl() { return heroLvl; }, set heroLvl(value) { heroLvl = value; },
  get isChar() { return isChar; }, set isChar(value) { isChar = value; },
  get isFishShop() { return isFishShop; }, set isFishShop(value) { isFishShop = value; },
  get isFishing() { return isFishing; }, set isFishing(value) { isFishing = value; },
  get isMap() { return isMap; }, set isMap(value) { isMap = value; },
  get map() { return map; }, set map(value) { map = value; },
  get mapReady() { return mapReady; }, set mapReady(value) { mapReady = value; },
  get meHp() { return meHp; }, set meHp(value) { meHp = value; },
  get meMp() { return meMp; }, set meMp(value) { meMp = value; },
  get on() { return on; }, set on(value) { on = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get potModel() { return potModel; }, set potModel(value) { potModel = value; },
  get rbEngage() { return rbEngage; }, set rbEngage(value) { rbEngage = value; },
  get rbShopFirst() { return rbShopFirst; }, set rbShopFirst(value) { rbShopFirst = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get recBot() { return recBot; }, set recBot(value) { recBot = value; },
  get restoreVitals() { return restoreVitals; }, set restoreVitals(value) { restoreVitals = value; },
  get rodEnchant() { return rodEnchant; }, set rodEnchant(value) { rodEnchant = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get townBuffStart() { return townBuffStart; }, set townBuffStart(value) { townBuffStart = value; },
  get transitionMonitor() { return transitionMonitor; }, set transitionMonitor(value) { transitionMonitor = value; },
  get waitX() { return waitX; }, set waitX(value) { waitX = value; } });
L2V7Modules.raid = L2V7Factories.raid({ get pauseBot() { return pauseBot; }, get storyRbIds() { return () => L2V7Modules.story.rbIds(); }, get gameAuth() { return gameAuth; }, get shopNeedByPanel() { return shopNeedByPanel; }, get mobHp() { return mobHp; }, get faIdsOf() { return (...a) => L2V7Modules.buffs.faIdsOf(...a); }, get hudBuffs() { return hudBuffs; }, get setCfg() { return setCfg; }, get rbNote() { return rbNote; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get LV_RE() { return LV_RE; }, set LV_RE(value) { LV_RE = value; },
  get RB_RETRY_MS() { return RB_RETRY_MS; }, set RB_RETRY_MS(value) { RB_RETRY_MS = value; },
  get RB_TRY_MS() { return RB_TRY_MS; }, set RB_TRY_MS(value) { RB_TRY_MS = value; },
  get RB_WIN() { return RB_WIN; }, set RB_WIN(value) { RB_WIN = value; },
  get TAG() { return TAG; }, set TAG(value) { TAG = value; },
  get activeBuffs() { return activeBuffs; }, set activeBuffs(value) { activeBuffs = value; },
  get aroundSig() { return aroundSig; }, set aroundSig(value) { aroundSig = value; },
  get attackSpawn() { return attackSpawn; }, set attackSpawn(value) { attackSpawn = value; },
  get buffWaitBeforeRb() { return buffWaitBeforeRb; }, set buffWaitBeforeRb(value) { buffWaitBeforeRb = value; },
  get campActive() { return campActive; }, set campActive(value) { campActive = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get draw() { return draw; }, set draw(value) { draw = value; },
  get epicById() { return epicById; }, set epicById(value) { epicById = value; },
  get epicOn() { return epicOn; }, set epicOn(value) { epicOn = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get fmtK() { return fmtK; }, set fmtK(value) { fmtK = value; },
  get fmtT() { return fmtT; }, set fmtT(value) { fmtT = value; },
  get heroLvl() { return heroLvl; }, set heroLvl(value) { heroLvl = value; },
  get hpPotStock() { return hpPotStock; }, set hpPotStock(value) { hpPotStock = value; },
  get isBattle() { return isBattle; }, set isBattle(value) { isBattle = value; },
  get isMap() { return isMap; }, set isMap(value) { isMap = value; },
  get logLines() { return logLines; }, set logLines(value) { logLines = value; },
  get map() { return map; }, set map(value) { map = value; },
  get mapReady() { return mapReady; }, set mapReady(value) { mapReady = value; },
  get meHp() { return meHp; }, set meHp(value) { meHp = value; },
  get meMp() { return meMp; }, set meMp(value) { meMp = value; },
  get nameLike() { return nameLike; }, set nameLike(value) { nameLike = value; },
  get newLines() { return newLines; }, set newLines(value) { newLines = value; },
  get on() { return on; }, set on(value) { on = value; },
  get pair() { return pair; }, set pair(value) { pair = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get potModel() { return potModel; }, set potModel(value) { potModel = value; },
  get rbLive() { return rbLive; }, set rbLive(value) { rbLive = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get recBot() { return recBot; }, set recBot(value) { recBot = value; },
  get restoreVitals() { return restoreVitals; }, set restoreVitals(value) { restoreVitals = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shopStart() { return shopStart; }, set shopStart(value) { shopStart = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get toOutskirts() { return toOutskirts; }, set toOutskirts(value) { toOutskirts = value; },
  get townBuffStart() { return townBuffStart; }, set townBuffStart(value) { townBuffStart = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; },
  get waitX() { return waitX; }, set waitX(value) { waitX = value; } });
L2V7Modules.combat = L2V7Factories.combat({ get fightDmgOn() { return fightDmgOn; }, get fightKillP() { return fightKillP; }, get fightSpikeEta() { return fightSpikeEta; }, get campChampOpen() { return campChampOpen; }, get rbFlee() { return (...a) => L2V7Modules.raid.rbFlee(...a); }, get srvUp() { return srvUp; }, get srvHangMark() { return srvHangMark; }, get noEffect() { return noEffect; }, get actNet() { return actNet; }, get gameBusy() { return gameBusy; }, get petState() { return petState; }, get combatProfileKind() { return combatProfileKind; }, get HP_POT_RE() { return HP_POT_RE; }, get rbRetreat() { return rbRetreat; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get ATK_NET() { return ATK_NET; }, set ATK_NET(value) { ATK_NET = value; },
  get BUFF_CTX() { return BUFF_CTX; }, set BUFF_CTX(value) { BUFF_CTX = value; },
  get CD_RE() { return CD_RE; }, set CD_RE(value) { CD_RE = value; },
  get FORCE_KNOWN() { return FORCE_KNOWN; }, set FORCE_KNOWN(value) { FORCE_KNOWN = value; },
  get FORCE_NEED() { return FORCE_NEED; }, set FORCE_NEED(value) { FORCE_NEED = value; },
  get FORCE_SPEND() { return FORCE_SPEND; }, set FORCE_SPEND(value) { FORCE_SPEND = value; },
  get SK_NET() { return SK_NET; }, set SK_NET(value) { SK_NET = value; },
  get SLOT() { return SLOT; }, set SLOT(value) { SLOT = value; },
  get TAG() { return TAG; }, set TAG(value) { TAG = value; },
  get UNAVAIL() { return UNAVAIL; }, set UNAVAIL(value) { UNAVAIL = value; },
  get actCost() { return actCost; }, set actCost(value) { actCost = value; },
  get antibotState() { return antibotState; }, set antibotState(value) { antibotState = value; },
  get applyQuestLog() { return applyQuestLog; }, set applyQuestLog(value) { applyQuestLog = value; },
  get autoRoles() { return autoRoles; }, set autoRoles(value) { autoRoles = value; },
  get battleSpawn() { return battleSpawn; }, set battleSpawn(value) { battleSpawn = value; }, get cdSpawn() { return cdSpawn; },
  get buffActive() { return buffActive; }, set buffActive(value) { buffActive = value; },
  get buffAuditStep() { return buffAuditStep; }, set buffAuditStep(value) { buffAuditStep = value; },
  get buffList() { return buffList; }, set buffList(value) { buffList = value; },
  get campActive() { return campActive; }, set campActive(value) { campActive = value; },
  get campOpen() { return campOpen; }, set campOpen(value) { campOpen = value; },
  get campRbOpen() { return campRbOpen; }, set campRbOpen(value) { campRbOpen = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get chargeValue() { return chargeValue; }, set chargeValue(value) { chargeValue = value; },
  get cleanTitle() { return cleanTitle; }, set cleanTitle(value) { cleanTitle = value; },
  get combatCooldown() { return combatCooldown; }, set combatCooldown(value) { combatCooldown = value; },
  get epicById() { return epicById; }, set epicById(value) { epicById = value; },
  get epicDbSet() { return epicDbSet; }, set epicDbSet(value) { epicDbSet = value; },
  get epicOn() { return epicOn; }, set epicOn(value) { epicOn = value; },
  get equip() { return equip; }, set equip(value) { equip = value; },
  get equipBy() { return equipBy; }, set equipBy(value) { equipBy = value; },
  get expDmg() { return expDmg; }, set expDmg(value) { expDmg = value; },
  get extraKillsInLog() { return extraKillsInLog; }, set extraKillsInLog(value) { extraKillsInLog = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get fmtK() { return fmtK; }, set fmtK(value) { fmtK = value; },
  get fmtT() { return fmtT; }, set fmtT(value) { fmtT = value; },
  get forceCosts() { return forceCosts; }, set forceCosts(value) { forceCosts = value; },
  get forceFromLog() { return forceFromLog; }, set forceFromLog(value) { forceFromLog = value; },
  get forceMax() { return forceMax; }, set forceMax(value) { forceMax = value; },
  get forceNow() { return forceNow; }, set forceNow(value) { forceNow = value; },
  get forceSet() { return forceSet; }, set forceSet(value) { forceSet = value; },
  get goalLines() { return goalLines; }, set goalLines(value) { goalLines = value; },
  get halt() { return halt; }, set halt(value) { halt = value; },
  get heroLvl() { return heroLvl; }, set heroLvl(value) { heroLvl = value; },
  get hpPotByDeficit() { return hpPotByDeficit; }, set hpPotByDeficit(value) { hpPotByDeficit = value; },
  get hpPotPick() { return hpPotPick; }, set hpPotPick(value) { hpPotPick = value; },
  get hpPots() { return hpPots; }, set hpPots(value) { hpPots = value; },
  get hudForce() { return hudForce; }, set hudForce(value) { hudForce = value; },
  get huntOn() { return huntOn; }, set huntOn(value) { huntOn = value; },
  get ilNum() { return ilNum; }, set ilNum(value) { ilNum = value; },
  get ilOf() { return ilOf; }, set ilOf(value) { ilOf = value; },
  get isBattle() { return isBattle; }, set isBattle(value) { isBattle = value; },
  get isBoss() { return isBoss; }, set isBoss(value) { isBoss = value; },
  get isChamp() { return isChamp; }, set isChamp(value) { isChamp = value; },
  get isChargeName() { return isChargeName; }, set isChargeName(value) { isChargeName = value; },
  get isEquip() { return isEquip; }, set isEquip(value) { isEquip = value; },
  get isForceName() { return isForceName; }, set isForceName(value) { isForceName = value; },
  get isQuestName() { return isQuestName; }, set isQuestName(value) { isQuestName = value; },
  get isRaidId() { return isRaidId; }, set isRaidId(value) { isRaidId = value; },
  get keepShots() { return keepShots; }, set keepShots(value) { keepShots = value; },
  get logLines() { return logLines; }, set logLines(value) { logLines = value; },
  get logName() { return logName; }, set logName(value) { logName = value; },
  get longFightMp() { return longFightMp; }, set longFightMp(value) { longFightMp = value; },
  get meHp() { return meHp; }, set meHp(value) { meHp = value; },
  get meMp() { return meMp; }, set meMp(value) { meMp = value; },
  get memLeft() { return memLeft; }, set memLeft(value) { memLeft = value; },
  get mpPotSlot() { return mpPotSlot; }, set mpPotSlot(value) { mpPotSlot = value; },
  get nameLike() { return nameLike; }, set nameLike(value) { nameLike = value; },
  get names() { return names; }, set names(value) { names = value; },
  get newLines() { return newLines; }, set newLines(value) { newLines = value; },
  get nextFight() { return nextFight; }, set nextFight(value) { nextFight = value; },
  get observeSlot() { return observeSlot; }, set observeSlot(value) { observeSlot = value; },
  get on() { return on; }, set on(value) { on = value; },
  get onDeath() { return onDeath; }, set onDeath(value) { onDeath = value; },
  get panelInventory() { return panelInventory; }, set panelInventory(value) { panelInventory = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get potBag() { return potBag; }, set potBag(value) { potBag = value; },
  get potInventory() { return potInventory; }, set potInventory(value) { potInventory = value; },
  get qty() { return qty; }, set qty(value) { qty = value; },
  get rbAssess() { return rbAssess; }, set rbAssess(value) { rbAssess = value; },
  get rbHi() { return rbHi; }, set rbHi(value) { rbHi = value; },
  get rbLo() { return rbLo; }, set rbLo(value) { rbLo = value; },
  get rbNote() { return rbNote; }, set rbNote(value) { rbNote = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get restoreVitals() { return restoreVitals; }, set restoreVitals(value) { restoreVitals = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get serverDown() { return serverDown; }, set serverDown(value) { serverDown = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get skKey() { return skKey; }, set skKey(value) { skKey = value; },
  get skillMp() { return skillMp; }, set skillMp(value) { skillMp = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get slotAction() { return slotAction; }, set slotAction(value) { slotAction = value; },
  get slotCd() { return slotCd; }, set slotCd(value) { slotCd = value; },
  get slotKind() { return slotKind; }, set slotKind(value) { slotKind = value; },
  get spoilStep() { return spoilStep; }, set spoilStep(value) { spoilStep = value; },
  get sweepStep() { return sweepStep; }, set sweepStep(value) { sweepStep = value; },
  get tabOwner() { return tabOwner; }, set tabOwner(value) { tabOwner = value; },
  get toMap() { return toMap; }, set toMap(value) { toMap = value; },
  get toOutskirts() { return toOutskirts; }, set toOutskirts(value) { toOutskirts = value; },
  get toggleStep() { return toggleStep; }, set toggleStep(value) { toggleStep = value; },
  get totemActive() { return totemActive; }, set totemActive(value) { totemActive = value; },
  get totemNote() { return totemNote; }, set totemNote(value) { totemNote = value; },
  get totemSlots() { return totemSlots; }, set totemSlots(value) { totemSlots = value; },
  get trackEfficiency() { return trackEfficiency; }, set trackEfficiency(value) { trackEfficiency = value; },
  get trackLoot() { return trackLoot; }, set trackLoot(value) { trackLoot = value; },
  get trackQuest() { return trackQuest; }, set trackQuest(value) { trackQuest = value; },
  get trySnap() { return trySnap; }, set trySnap(value) { trySnap = value; },
  get turnSec() { return turnSec; }, set turnSec(value) { turnSec = value; },
  get uiTimer() { return uiTimer; }, set uiTimer(value) { uiTimer = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; },
  get waitX() { return waitX; }, set waitX(value) { waitX = value; } });
L2V7Modules.dungeons = L2V7Factories.dungeons({ get dungNet() { return dungNet; }, get heroAt() { return heroAt; }, get gameAlert() { return gameAlert; }, get sealNet() { return sealNet; }, get invQty() { return invQty; }, get rtCommit() { return rtCommit; }, get rnd() { return rnd; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get CAT_LIST() { return CAT_LIST; }, set CAT_LIST(value) { CAT_LIST = value; },
  get CAT_URL() { return CAT_URL; }, set CAT_URL(value) { CAT_URL = value; },
  get NET_ERR() { return NET_ERR; }, set NET_ERR(value) { NET_ERR = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get heroLvl() { return heroLvl; }, set heroLvl(value) { heroLvl = value; },
  get idle() { return idle; }, set idle(value) { idle = value; },
  get isBattle() { return isBattle; }, set isBattle(value) { isBattle = value; },
  get isMap() { return isMap; }, set isMap(value) { isMap = value; },
  get noticeText() { return noticeText; }, set noticeText(value) { noticeText = value; },
  get on() { return on; }, set on(value) { on = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; },
  get waitX() { return waitX; }, set waitX(value) { waitX = value; } });
L2V7Modules.tvt = L2V7Factories.tvt({ get autonomyMode() { return autonomyMode; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get TVT() { return TVT; }, set TVT(value) { TVT = value; },
  get TVTC() { return TVTC; }, set TVTC(value) { TVTC = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get cleanTitle() { return cleanTitle; }, set cleanTitle(value) { cleanTitle = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get fishNow() { return fishNow; }, set fishNow(value) { fishNow = value; },
  get forceCosts() { return forceCosts; }, set forceCosts(value) { forceCosts = value; },
  get forceMax() { return forceMax; }, set forceMax(value) { forceMax = value; },
  get forceNow() { return forceNow; }, set forceNow(value) { forceNow = value; },
  get hpPotPick() { return hpPotPick; }, set hpPotPick(value) { hpPotPick = value; },
  get hudForce() { return hudForce; }, set hudForce(value) { hudForce = value; },
  get isBattle() { return isBattle; }, set isBattle(value) { isBattle = value; },
  get meHp() { return meHp; }, set meHp(value) { meHp = value; },
  get names() { return names; }, set names(value) { names = value; },
  get on() { return on; }, set on(value) { on = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get ready() { return ready; }, set ready(value) { ready = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get slotsBy() { return slotsBy; }, set slotsBy(value) { slotsBy = value; },
  get tabOwner() { return tabOwner; }, set tabOwner(value) { tabOwner = value; },
  get waitX() { return waitX; }, set waitX(value) { waitX = value; } });
L2V7Modules.mobfarm = L2V7Factories.mobfarm({ get lootGoal() { return lootGoal; }, get farmMapOn() { return farmMapOn; }, get invQty() { return invQty; }, get autonomyMode() { return autonomyMode; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get LV_RE() { return LV_RE; }, set LV_RE(value) { LV_RE = value; },
  get NET_SPAWNS() { return NET_SPAWNS; }, set NET_SPAWNS(value) { NET_SPAWNS = value; },
  get PAGE_SIZE() { return PAGE_SIZE; }, set PAGE_SIZE(value) { PAGE_SIZE = value; },
  get QUEST() { return QUEST; }, set QUEST(value) { QUEST = value; },
  get TAG() { return TAG; }, set TAG(value) { TAG = value; },
  get absorb() { return absorb; }, set absorb(value) { absorb = value; },
  get buffWaitBeforeRb() { return buffWaitBeforeRb; }, set buffWaitBeforeRb(value) { buffWaitBeforeRb = value; },
  get campActive() { return campActive; }, set campActive(value) { campActive = value; },
  get campChampMin() { return campChampMin; }, set campChampMin(value) { campChampMin = value; },
  get campChampOpen() { return campChampOpen; }, set campChampOpen(value) { campChampOpen = value; },
  get campMobOpen() { return campMobOpen; }, set campMobOpen(value) { campMobOpen = value; },
  get campOn() { return campOn; }, set campOn(value) { campOn = value; },
  get campOpen() { return campOpen; }, set campOpen(value) { campOpen = value; },
  get campRbOpen() { return campRbOpen; }, set campRbOpen(value) { campRbOpen = value; },
  get catGo() { return catGo; }, set catGo(value) { catGo = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get deepN() { return deepN; }, set deepN(value) { deepN = value; },
  get draw() { return draw; }, set draw(value) { draw = value; },
  get epicOn() { return epicOn; }, set epicOn(value) { epicOn = value; },
  get farmRbOn() { return farmRbOn; }, set farmRbOn(value) { farmRbOn = value; },
  get farmRules() { return farmRules; }, set farmRules(value) { farmRules = value; },
  get farmStep() { return farmStep; }, set farmStep(value) { farmStep = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get fishNow() { return fishNow; }, set fishNow(value) { fishNow = value; },
  get goCampaign() { return goCampaign; }, set goCampaign(value) { goCampaign = value; },
  get goFishing() { return goFishing; }, set goFishing(value) { goFishing = value; },
  get gotoPage() { return gotoPage; }, set gotoPage(value) { gotoPage = value; },
  get halt() { return halt; }, set halt(value) { halt = value; },
  get heroLvl() { return heroLvl; }, set heroLvl(value) { heroLvl = value; },
  get huntOn() { return huntOn; }, set huntOn(value) { huntOn = value; },
  get idle() { return idle; }, set idle(value) { idle = value; },
  get isBattle() { return isBattle; }, set isBattle(value) { isBattle = value; },
  get isBoss() { return isBoss; }, set isBoss(value) { isBoss = value; },
  get isChamp() { return isChamp; }, set isChamp(value) { isChamp = value; },
  get isQuestName() { return isQuestName; }, set isQuestName(value) { isQuestName = value; },
  get isRaidId() { return isRaidId; }, set isRaidId(value) { isRaidId = value; },
  get mapDue() { return mapDue; }, set mapDue(value) { mapDue = value; },
  get meHp() { return meHp; }, set meHp(value) { meHp = value; },
  get mobHp() { return mobHp; }, set mobHp(value) { mobHp = value; },
  get nameLike() { return nameLike; }, set nameLike(value) { nameLike = value; },
  get on() { return on; }, set on(value) { on = value; },
  get onDeath() { return onDeath; }, set onDeath(value) { onDeath = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get raidList() { return raidList; }, set raidList(value) { raidList = value; },
  get rbCandidates() { return rbCandidates; }, set rbCandidates(value) { rbCandidates = value; },
  get rbDue() { return rbDue; }, set rbDue(value) { rbDue = value; },
  get rbEngage() { return rbEngage; }, set rbEngage(value) { rbEngage = value; },
  get rbHi() { return rbHi; }, set rbHi(value) { rbHi = value; },
  get rbListPick() { return rbListPick; }, set rbListPick(value) { rbListPick = value; },
  get rbLo() { return rbLo; }, set rbLo(value) { rbLo = value; },
  get rbTourPick() { return rbTourPick; }, set rbTourPick(value) { rbTourPick = value; },
  get rbVerdictBlocks() { return rbVerdictBlocks; }, set rbVerdictBlocks(value) { rbVerdictBlocks = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get recipeRules() { return recipeRules; }, set recipeRules(value) { recipeRules = value; },
  get recipeStep() { return recipeStep; }, set recipeStep(value) { recipeStep = value; },
  get resQuests() { return resQuests; }, set resQuests(value) { resQuests = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get searchActive() { return searchActive; }, set searchActive(value) { searchActive = value; },
  get serverDown() { return serverDown; }, set serverDown(value) { serverDown = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shopNeedByPanel() { return shopNeedByPanel; }, set shopNeedByPanel(value) { shopNeedByPanel = value; },
  get shopPlan() { return shopPlan; }, set shopPlan(value) { shopPlan = value; },
  get shopStart() { return shopStart; }, set shopStart(value) { shopStart = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get tabIdle() { return tabIdle; }, set tabIdle(value) { tabIdle = value; },
  get tags() { return tags; }, set tags(value) { tags = value; },
  get toMap() { return toMap; }, set toMap(value) { toMap = value; },
  get townBuffStart() { return townBuffStart; }, set townBuffStart(value) { townBuffStart = value; },
  get tvtSoon() { return tvtSoon; }, set tvtSoon(value) { tvtSoon = value; },
  get victory() { return victory; }, set victory(value) { victory = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; },
  get zoneCatThin() { return zoneCatThin; }, set zoneCatThin(value) { zoneCatThin = value; },
  get zoneForLevel() { return zoneForLevel; }, set zoneForLevel(value) { zoneForLevel = value; },
  get zoneName() { return zoneName; }, set zoneName(value) { zoneName = value; },
  get zonePick() { return zonePick; }, set zonePick(value) { zonePick = value; } });
L2V7Modules.quests = L2V7Factories.quests({ get $q() { return $q; }, set $q(value) { $q = value; },
  get QLINE() { return QLINE; }, set QLINE(value) { QLINE = value; },
  get TAG() { return TAG; }, set TAG(value) { TAG = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get goOutskirts() { return goOutskirts; }, set goOutskirts(value) { goOutskirts = value; },
  get isCampaign() { return isCampaign; }, set isCampaign(value) { isCampaign = value; },
  get isMail() { return isMail; }, set isMail(value) { isMail = value; },
  get logLines() { return logLines; }, set logLines(value) { logLines = value; },
  get noticeText() { return noticeText; }, set noticeText(value) { noticeText = value; },
  get on() { return on; }, set on(value) { on = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; } });
// 9.0: модель КПД локаций (zone-kpd.js + встроенная база zone-db.js) для автокача; маг ли герой — по оружию/классу (защита моба: M.Def или P.Def)
const kpdMage = () => { try { return L2V7Modules.economy.shotsMage() !== false; } catch { return true; } };
L2V7Modules.navigation = L2V7Factories.navigation({ get $q() { return $q; }, set $q(value) { $q = value; },
  get kpd() { return globalThis.L2Kpd; }, get kpdMage() { return kpdMage; },
  get BACK() { return BACK; }, set BACK(value) { BACK = value; },
  get byText() { return byText; }, set byText(value) { byText = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get farmRowParse() { return farmRowParse; }, set farmRowParse(value) { farmRowParse = value; },
  get farmSave() { return farmSave; }, set farmSave(value) { farmSave = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get heroLvl() { return heroLvl; }, set heroLvl(value) { heroLvl = value; },
  get isFarmPage() { return isFarmPage; }, set isFarmPage(value) { isFarmPage = value; },
  get isRaidId() { return isRaidId; }, set isRaidId(value) { isRaidId = value; },
  get meHp() { return meHp; }, set meHp(value) { meHp = value; },
  get on() { return on; }, set on(value) { on = value; },
  get pageItems() { return pageItems; }, set pageItems(value) { pageItems = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get restoreVitals() { return restoreVitals; }, set restoreVitals(value) { restoreVitals = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; },
  get waitX() { return waitX; }, set waitX(value) { waitX = value; } });
L2V7Modules.buffs = L2V7Factories.buffs({ get epicBuffCol() { return (...a) => L2V7Modules.epics.epicBuffCol(...a); }, get epicBuffPay() { return (...a) => L2V7Modules.epics.epicBuffPay(...a); }, get epicBuffRelease() { return (...a) => L2V7Modules.epics.epicBuffRelease(...a); }, get autonomyMode() { return autonomyMode; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get BUFF_CTX() { return BUFF_CTX; }, set BUFF_CTX(value) { BUFF_CTX = value; },
  get DEAD_RE() { return DEAD_RE; }, set DEAD_RE(value) { DEAD_RE = value; },
  get FA_KNOWN() { return FA_KNOWN; }, set FA_KNOWN(value) { FA_KNOWN = value; },
  get IL() { return IL; }, set IL(value) { IL = value; },
  get IL_BY_NAME() { return IL_BY_NAME; }, set IL_BY_NAME(value) { IL_BY_NAME = value; },
  get TB_KEYS() { return TB_KEYS; }, set TB_KEYS(value) { TB_KEYS = value; },
  get TOTEM_MIN() { return TOTEM_MIN; }, set TOTEM_MIN(value) { TOTEM_MIN = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get cleanTitle() { return cleanTitle; }, set cleanTitle(value) { cleanTitle = value; },
  get draw() { return draw; }, set draw(value) { draw = value; },
  get faCost() { return faCost; }, set faCost(value) { faCost = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get fishNow() { return fishNow; }, set fishNow(value) { fishNow = value; },
  get ilOf() { return ilOf; }, set ilOf(value) { ilOf = value; },
  get isTotem() { return isTotem; }, set isTotem(value) { isTotem = value; },
  get meHp() { return meHp; }, set meHp(value) { meHp = value; },
  get memLeft() { return memLeft; }, set memLeft(value) { memLeft = value; },
  get names() { return names; }, set names(value) { names = value; },
  get on() { return on; }, set on(value) { on = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get ready() { return ready; }, set ready(value) { ready = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get slotCd() { return slotCd; }, set slotCd(value) { slotCd = value; },
  get slotsBy() { return slotsBy; }, set slotsBy(value) { slotsBy = value; },
  get toggleState() { return toggleState; }, set toggleState(value) { toggleState = value; },
  get waitX() { return waitX; }, set waitX(value) { waitX = value; } });
L2V7Modules.equipment = L2V7Factories.equipment({ get noEffect() { return noEffect; }, get on(){return on},  get combatProfileKind() { return combatProfileKind; }, get normalizeProfession() { return normalizeProfession; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get CLASS_W() { return CLASS_W; }, set CLASS_W(value) { CLASS_W = value; },
  get EQUIP_OK() { return EQUIP_OK; }, set EQUIP_OK(value) { EQUIP_OK = value; },
  get FREE_HIT() { return FREE_HIT; }, set FREE_HIT(value) { FREE_HIT = value; },
  get GRADE_LV() { return GRADE_LV; }, set GRADE_LV(value) { GRADE_LV = value; },
  get MAGE() { return MAGE; }, set MAGE(value) { MAGE = value; },
  get SLOT() { return SLOT; }, set SLOT(value) { SLOT = value; },
  get TAG() { return TAG; }, set TAG(value) { TAG = value; },
  get baseName() { return baseName; }, set baseName(value) { baseName = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get cleanTitle() { return cleanTitle; }, set cleanTitle(value) { cleanTitle = value; },
  get expDmg() { return expDmg; }, set expDmg(value) { expDmg = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get heroLevel() { return heroLevel; }, set heroLevel(value) { heroLevel = value; },
  get iconStem() { return iconStem; }, set iconStem(value) { iconStem = value; },
  get ilNum() { return ilNum; }, set ilNum(value) { ilNum = value; },
  get ilOf() { return ilOf; }, set ilOf(value) { ilOf = value; },
  get invBusy() { return invBusy; }, set invBusy(value) { invBusy = value; },
  get isBattle() { return isBattle; }, set isBattle(value) { isBattle = value; },
  get isChar() { return isChar; }, set isChar(value) { isChar = value; },
  get isCharacter() { return isCharacter; }, set isCharacter(value) { isCharacter = value; },
  get isChargeName() { return isChargeName; }, set isChargeName(value) { isChargeName = value; },
  get isEquip() { return isEquip; }, set isEquip(value) { isEquip = value; },
  get isForceName() { return isForceName; }, set isForceName(value) { isForceName = value; },
  get itemByIcon() { return itemByIcon; }, set itemByIcon(value) { itemByIcon = value; },
  get itemJson() { return itemJson; }, set itemJson(value) { itemJson = value; },
  get itemOf() { return itemOf; }, set itemOf(value) { itemOf = value; },
  get itemsDb() { return itemsDb; }, set itemsDb(value) { itemsDb = value; },
  get names() { return names; }, set names(value) { names = value; },
  get noticeText() { return noticeText; }, set noticeText(value) { noticeText = value; },
  get panelInventory() { return panelInventory; }, set panelInventory(value) { panelInventory = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get running() { return running; }, set running(value) { running = value; },
  get setCfg() { return setCfg; }, set setCfg(value) { setCfg = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get skillCost() { return skillCost; }, set skillCost(value) { skillCost = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get slotKind() { return slotKind; }, set slotKind(value) { slotKind = value; }, get slotsBy() { return slotsBy; }, set slotsBy(value) { slotsBy = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; },
  get waitX() { return waitX; }, set waitX(value) { waitX = value; } });
L2V7Modules.economy = L2V7Factories.economy({ get shopBuyNet(){return () => SHOP_BUY}, get invQty() { return invQty; },  get GRADE_LV() { return GRADE_LV; }, get SLOT() { return SLOT; }, get combatProfileKind() { return combatProfileKind; }, get heroLevel() { return heroLevel; }, get autonomyMode() { return autonomyMode; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get BSPS_IDS() { return BSPS_IDS; }, set BSPS_IDS(value) { BSPS_IDS = value; },
  get HP_BIG_RE() { return HP_BIG_RE; }, set HP_BIG_RE(value) { HP_BIG_RE = value; },
  get HP_SHOP_RE() { return HP_SHOP_RE; }, set HP_SHOP_RE(value) { HP_SHOP_RE = value; },
  get ITEMS() { return ITEMS; }, set ITEMS(value) { ITEMS = value; },
  get MAGE() { return MAGE; }, set MAGE(value) { MAGE = value; },
  get SHOT_IDS() { return SHOT_IDS; }, set SHOT_IDS(value) { SHOT_IDS = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get classWeaponTypes() { return classWeaponTypes; }, set classWeaponTypes(value) { classWeaponTypes = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get fishNow() { return fishNow; }, set fishNow(value) { fishNow = value; },
  get isBattle() { return isBattle; }, set isBattle(value) { isBattle = value; },
  get isChar() { return isChar; }, set isChar(value) { isChar = value; },
  get itemJson() { return itemJson; }, set itemJson(value) { itemJson = value; },
  get itemsDb() { return itemsDb; }, set itemsDb(value) { itemsDb = value; },
  get noteBag() { return noteBag; }, set noteBag(value) { noteBag = value; },
  get on() { return on; }, set on(value) { on = value; },
  get pair() { return pair; }, set pair(value) { pair = value; },
  get potBag() { return potBag; }, set potBag(value) { potBag = value; },
  get qty() { return qty; }, set qty(value) { qty = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get setVal() { return setVal; }, set setVal(value) { setVal = value; },
  get shotSlot() { return shotSlot; }, set shotSlot(value) { shotSlot = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get slotsBy() { return slotsBy; }, set slotsBy(value) { slotsBy = value; },
  get waitX() { return waitX; }, set waitX(value) { waitX = value; } });
L2V7Modules.resources = L2V7Factories.resources({ get HP_POT_RE() { return HP_POT_RE; }, set HP_POT_RE(value) { HP_POT_RE = value; },
  get shotGrade() { return (...a) => L2V7Modules.economy.shotGrade(...a); }, get $q() { return $q; }, get shown() { return shown; },
  get MP_REGEN() { return MP_REGEN; }, set MP_REGEN(value) { MP_REGEN = value; },
  get POT_LAST() { return POT_LAST; }, set POT_LAST(value) { POT_LAST = value; },
  get SLOT() { return SLOT; }, set SLOT(value) { SLOT = value; },
  get TAG() { return TAG; }, set TAG(value) { TAG = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get expDmg() { return expDmg; }, set expDmg(value) { expDmg = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get forceCosts() { return forceCosts; }, set forceCosts(value) { forceCosts = value; },
  get ilOf() { return ilOf; }, set ilOf(value) { ilOf = value; },
  get isBattle() { return isBattle; }, set isBattle(value) { isBattle = value; },
  get isChargeName() { return isChargeName; }, set isChargeName(value) { isChargeName = value; },
  get lastShotTry() { return lastShotTry; }, set lastShotTry(value) { lastShotTry = value; },
  get logLines() { return logLines; }, set logLines(value) { logLines = value; },
  get names() { return names; }, set names(value) { names = value; },
  get newLines() { return newLines; }, set newLines(value) { newLines = value; },
  get numOf() { return numOf; }, set numOf(value) { numOf = value; },
  get on() { return on; }, set on(value) { on = value; },
  get potBag() { return potBag; }, set potBag(value) { potBag = value; },
  get potKey() { return potKey; }, set potKey(value) { potKey = value; },
  get potName() { return potName; }, set potName(value) { potName = value; },
  get qty() { return qty; }, set qty(value) { qty = value; },
  get ready() { return ready; }, set ready(value) { ready = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shotSlot() { return shotSlot; }, set shotSlot(value) { shotSlot = value; },
  get shotsOn() { return shotsOn; }, set shotsOn(value) { shotsOn = value; },
  get skKey() { return skKey; }, set skKey(value) { skKey = value; },
  get skillMp() { return skillMp; }, set skillMp(value) { skillMp = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get slotKind() { return slotKind; }, set slotKind(value) { slotKind = value; },
  get slotsBy() { return slotsBy; }, set slotsBy(value) { slotsBy = value; },
  get tabOwner() { return tabOwner; }, set tabOwner(value) { tabOwner = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; } });
L2V7Modules.loot = L2V7Factories.loot({ get $q() { return $q; }, set $q(value) { $q = value; },
  get LOOT_RE() { return LOOT_RE; }, set LOOT_RE(value) { LOOT_RE = value; },
  get SPECIAL_RE() { return SPECIAL_RE; }, set SPECIAL_RE(value) { SPECIAL_RE = value; },
  get SPOIL_FAIL() { return SPOIL_FAIL; }, set SPOIL_FAIL(value) { SPOIL_FAIL = value; },
  get SPOIL_LOOT() { return SPOIL_LOOT; }, set SPOIL_LOOT(value) { SPOIL_LOOT = value; },
  get SPOIL_OK() { return SPOIL_OK; }, set SPOIL_OK(value) { SPOIL_OK = value; },
  get SWEEP_OK() { return SWEEP_OK; }, set SWEEP_OK(value) { SWEEP_OK = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get cleanTitle() { return cleanTitle; }, set cleanTitle(value) { cleanTitle = value; },
  get extraMobs() { return extraMobs; }, set extraMobs(value) { extraMobs = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get itemOf() { return itemOf; }, set itemOf(value) { itemOf = value; },
  get itemsDb() { return itemsDb; }, set itemsDb(value) { itemsDb = value; },
  get logLines() { return logLines; }, set logLines(value) { logLines = value; },
  get meMp() { return meMp; }, set meMp(value) { meMp = value; },
  get mobSpoiled() { return mobSpoiled; }, set mobSpoiled(value) { mobSpoiled = value; },
  get nameLike() { return nameLike; }, set nameLike(value) { nameLike = value; },
  get names() { return names; }, set names(value) { names = value; },
  get newLines() { return newLines; }, set newLines(value) { newLines = value; },
  get noticeText() { return noticeText; }, set noticeText(value) { noticeText = value; },
  get on() { return on; }, set on(value) { on = value; },
  get ready() { return ready; }, set ready(value) { ready = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get recipeKey() { return recipeKey; }, set recipeKey(value) { recipeKey = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get skillMp() { return skillMp; }, set skillMp(value) { skillMp = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get slotsBy() { return slotsBy; }, set slotsBy(value) { slotsBy = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; } });
L2V7Modules.survival = L2V7Factories.survival({ get epicDbSet() { return epicDbSet; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get byText() { return byText; }, set byText(value) { byText = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = value; },
  get epicById() { return epicById; }, set epicById(value) { epicById = value; },
  get epicOn() { return epicOn; }, set epicOn(value) { epicOn = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get halt() { return halt; }, set halt(value) { halt = value; },
  get isBattle() { return isBattle; }, set isBattle(value) { isBattle = value; },
  get isCity() { return isCity; }, set isCity(value) { isCity = value; },
  get isMap() { return isMap; }, set isMap(value) { isMap = value; },
  get isRaidId() { return isRaidId; }, set isRaidId(value) { isRaidId = value; },
  get mobHp() { return mobHp; }, set mobHp(value) { mobHp = value; },
  get mobName() { return mobName; }, set mobName(value) { mobName = value; },
  get pause() { return pause; }, set pause(value) { pause = value; },
  get rbNote() { return rbNote; }, set rbNote(value) { rbNote = value; },
  get rec() { return rec; }, set rec(value) { rec = value; },
  get rnd() { return rnd; }, set rnd(value) { rnd = value; },
  get rt() { return rt; }, set rt(value) { rt = value; },
  get setRt() { return setRt; }, set setRt(value) { setRt = value; },
  get setStatus() { return setStatus; }, set setStatus(value) { setStatus = value; },
  get shown() { return shown; }, set shown(value) { shown = value; },
  get sleep() { return sleep; }, set sleep(value) { sleep = value; },
  get toOutskirts() { return toOutskirts; }, set toOutskirts(value) { toOutskirts = value; },
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; } });

L2V7Modules.mammon = L2V7Factories.mammon({ get $q() { return $q; }, get FARM() { return FARM; }, get ITEMS() { return ITEMS; }, get autonomyMode() { return autonomyMode; },
  get cfg() { return cfg; }, get fire() { return fire; }, get fishNow() { return fishNow; }, get fishState() { return fishState; }, get gameGet() { return gameGet; },
  get heroNick() { return heroNick; }, get invQty() { return invQty; }, get isBattle() { return isBattle; }, get isFishing() { return isFishing; }, get itemsDb() { return itemsDb; },
  get rec() { return rec; }, get rt() { return rt; }, get setRt() { return setRt; }, get setStatus() { return setStatus; }, get sleep() { return sleep; },
  get tvtSoon() { return tvtSoon; }, get waitX() { return waitX; } });

// 9.0: сюжетные квесты сабкласса и Noblesse, смена класса (modules/story.js)
L2V7Modules.story = L2V7Factories.story({ get $q() { return $q; }, get autonomyMode() { return autonomyMode; }, get awayFree() { return awayFree; }, get cfg() { return cfg; },
  get classSwitched() { return classSwitched; }, get fire() { return fire; }, get fishNow() { return fishNow; }, get gameGet() { return gameGet; }, get isBattle() { return isBattle; },
  get rec() { return rec; }, get rt() { return rt; }, get setRt() { return setRt; }, get setStatus() { return setStatus; }, get sleep() { return sleep; }, get waitX() { return waitX; } });
// 9.2: анализатор боя. Имя действия хода = ключ замера скилла (rt.skills): l2_<id> → название слота панели, attack → «атака»
const actName = a => { a = String(a || ''); if (a === 'attack') return 'атака'; if (/^battle_potion/.test(a)) return 'банка';
  const b = /^l2_\d+$/.test(a) ? document.querySelector(`.l2-battle-hotbar-slot[data-slot-cd="${a}"]`) : null;
  return b ? cleanTitle(b.title || '').toLowerCase() : a; };
L2V7Modules.fightlab = L2V7Factories.fightlab({ get actName() { return actName; }, get fmtT() { return fmtT; }, get isBoss() { return isBoss; }, get isChamp() { return isChamp; },
  get mobTitle() { return mobTitle; }, get rec() { return rec; }, get rt() { return rt; }, get setRt() { return setRt; } });
const fightDmgOn = n => L2V7Modules.fightlab.dmgOn(n), fightKillP = (n, hp) => L2V7Modules.fightlab.killP(n, hp), fightSpikeEta = () => L2V7Modules.fightlab.spikeEta();
// 9.2: лист врагов и ответный PvP (modules/enemies.js)
L2V7Modules.enemies = L2V7Factories.enemies({ get $q() { return $q; }, get autonomyMode() { return autonomyMode; }, get cfg() { return cfg; }, get fire() { return fire; },
  get fishNow() { return fishNow; }, get gameGet() { return gameGet; }, get heroLevel() { return heroLevel; }, get isBattle() { return isBattle; }, get isMap() { return isMap; },
  get meHp() { return meHp; }, get rec() { return rec; }, get rt() { return rt; }, get setRt() { return setRt; }, get setStatus() { return setStatus; }, get shown() { return shown; },
  get sleep() { return sleep; }, get toMap() { return toMap; }, get tvtSoon() { return tvtSoon; }, get victory() { return victory; }, get waitX() { return waitX; } });
// 9.0: отлучиться от охоты (Маммон, сдача части квеста) — те же условия
const awayFree = () => L2V7Modules.mammon.modeFree();
// 9.0: смена класса — кот этого класса отозван игрой, прежний слуга не «живой»
const classSwitched = () => { PET = null; };

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.cmd === 'kick') {
    // ACK only after this document actually owns the lease and entered the loop.
    // A stored on=true is not proof that a single game action can be performed.
    (async () => {
      const state = await chrome.storage.local.get(['on', 'cfg']);
      on = !!state.on; cfg = mergeCfg(state.cfg);
      const v = chrome.runtime.getManifest().version;
      if (!on) return reply({ ok: false, v, running: false, owner: false, reason: 'stopped' });
      void main();
      const deadline = Date.now() + 3500;
      while (on && !(running && tabOwner && leaseEpoch) && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 120));
      if (!on) return reply({ ok: false, v, running, owner: false, reason: 'stopped_during_start' });
      if (!running) return reply({ ok: false, v, running: false, owner: tabOwner, reason: 'loop_not_running' });
      if (!tabOwner || !leaseEpoch) return reply({ ok: false, v, running: true, owner: false, reason: 'another_tab_or_lock_unavailable' });
      heartbeat();
      reply({ ok: true, v, running: true, owner: true, reason: '' });
    })().catch(e => reply({ ok: false, reason: 'kick_error: ' + String(e?.message || e) }));
    return true;
  }
  if (m.cmd === 'ping')  reply({ ok: true, v: chrome.runtime.getManifest().version, page: location.pathname });
  if (m.cmd === 'dom')   reply({ html: domSnapshot(), page: location.pathname.replace(/^\/|\.html$/g, '') || 'page' });
  if (m.cmd === 'slots') reply(panelReport());
  if (m.cmd === 'suggest') { itemsDb().then(() => reply({ battle: isBattle(), ...suggestRoles() })).catch(() => reply({ battle: isBattle(), ...suggestRoles() })); return true; }
});

// ---------- старт ----------
// любая необработанная ошибка расширения — в журнал (чтобы «полный сбой» был виден в выгрузке, а не только в консоли)
// v5.6: обработчики ошибок — один набор (выше, у записи журнала); второй дублировал каждую ошибку в журнале
chrome.storage.onChanged.addListener(ch => {
  // Обновление справочников из меню должно быть видно без перезагрузки страницы.
  if (ch.farmDb) FARM = ch.farmDb.newValue || null;
  if (ch.recipeDb) RECIPES = ch.recipeDb.newValue || null;
  if (ch.lock && on && tabOwner && ch.lock.newValue?.epoch !== leaseEpoch) {
    // Передача замка другой вкладке: прекращаем работу немедленно, не ждём очередные 5 с.
    tabOwner = false; tabIdle = true; leaseEpoch = null; rtWriter.clear(); window.__lockT = 0;
  }
  if (ch.learn && !ch.learn.newValue) { LEARN = null; learnDirty = false; try { sessionStorage.removeItem(LEARN_SS); } catch (e) {} learnLoad().catch(() => {}); }   // v5.6: «Сбросить обучение» из меню
  if (ch.cfg) {
    // 8.0.3 (разбор лога 11.10 09:16: тур выключали и включали из меню, а журнал этого не показывал): смена режима — строкой в журнал
    const m0 = modeSig(cfg); cfg = mergeCfg(ch.cfg.newValue); const m1 = modeSig(cfg);
    if (m0 !== m1 && tabOwner) try { rec('U', 'меню', `режим: ${m0} → ${m1}`); } catch (e) {}
  }
  if (ch.rt && ch.rt.newValue?._src !== TAB_ID) rt = { ...DEF_RT, ...ch.rt.newValue, ...rtWriter.peek() }; // свежий storage + наши неподтверждённые PATCHES
  if (ch.on) {
    on = !!ch.on.newValue;
    const stopMeta = ch.stopMeta?.newValue;
    const reason = !on && stopMeta && Date.now() - (+stopMeta.t || 0) < 30000
      ? ` · источник: ${String(stopMeta.source || 'не указан').slice(0, 50)} · ${String(stopMeta.reason || '').slice(0, 180)}`
      : !on ? ' · источник не указан (внешняя запись в storage)' : '';
    const pz = !on && stopMeta?.source === 'popup-pause' && Date.now() - (+stopMeta.t || 0) < 30000;
    rec('S', 'сессия', on ? '▶ бот запущен' : pz ? '⏸ пауза (состояние сохранено)' : '■ бот остановлен' + reason);
    if (on) main();
  }
  if (ch.rt && rt.invScan && !ch.rt.oldValue?.invScan && !running) invScanDrive();   // «Проверить оружие» из меню
  if (ch.cfg) { try { dock(); } catch (e) {} }
  if (ch.cfg || ch.rt || ch.on) draw();
});
// v5.5.9: игра заранее загружает следующую страницу (карту) в фоне — Chrome «предзагрузка» (document.prerendering), и наш скрипт
// запускался и в этой невидимой копии: второй бот в той же вкладке («⏸ работает в другой вкладке», лог 09.10 12:08; вероятно, и
// «две вкладки» 08.10). Теперь в предзагруженной странице бот спит, пока игрок на неё не перейдёт
const whenActive = fn => document.prerendering ? document.addEventListener('prerenderingchange', fn, { once: true }) : fn();
whenActive(() => chrome.storage.local.get(['cfg', 'rt', 'on']).then(s => {
  cfg = mergeCfg(s.cfg); rt = { ...DEF_RT, ...s.rt }; on = !!s.on;
  // v5.6: одноразовые миграции — в ОДНУ запись настроек и одну запись состояния. Раньше каждая делала своё
  // «прочитать cfg → записать cfg» параллельно с остальными: на чистой установке часть терялась (lvlAbove 99 → 15),
  // а прямые записи rt из хранилища перетирали свежее состояние. Порядок — по версиям: побеждает самое новое значение
  const cf = {}, rf = {};
  if (rt.engineRecoveryEpoch !== '7.1.13') {
    // Errors in older extension code do not justify cooldown after an update.
    Object.assign(rf, { engineRecoveryEpoch: '7.1.13', engineFailures: {}, errs: [], health: null });
    Object.assign(rt, rf);
  }
  const C = k => (k in cf ? cf[k] : cfg[k]);
  // 7.1.30: флаг и в cfg — иначе при смене персонажа (rt новый) все разовые правки настроек применялись заново
  const once = (flag, fn) => { if (!rt[flag] && !rf[flag] && !cfg[flag] && !cf[flag]) { rf[flag] = 1; cf[flag] = 1; fn(); } };
  // v3.5: Focused Force / Hurricane Assault попали в «силовые» (автороли v3.3) — убираем, у них свои роли
  if (names(cfg.nPower || '').some(n => isChargeName(n) || isForceName(n)))
    cf.nPower = (cfg.nPower || '').split(',').map(x => x.trim()).filter(x => x && !isChargeName(x) && !isForceName(x)).join(', ') || 'Iron Punch';
  // v4.7: игра отдала имя надетого оружия как «#262» — сбрасываем такое имя и проверяем инвентарь заново
  if (/^#\d+$/.test(cfg.nWeaponMain || '') || (rt.weapons || []).some(w => /^#\d+$/.test(w.name || ''))) {
    if (/^#\d+$/.test(cfg.nWeaponMain || '')) cf.nWeaponMain = '';
    Object.assign(rf, { weapons: [], weaponsT: 0, weaponRec: null });
  }
  // --- значения по умолчанию, менявшиеся по просьбам игрока (по возрастанию версий; новые перекрывают старые) ---
  once('deep25', () => { cf.deepEvery = 25; });                                         // v4.18
  once('lvl423', () => Object.assign(cf, { lvlAbove: 30, rbMaxAbove: 15, rbMaxBelow: 15 }));   // v4.23
  once('retreat427', () => { cf.rbRetreatHp = 20; });                                   // v4.27: отход с РБ на 20 %
  once('tour427', () => { cf.rbTour = true; });
  once('deep100', () => { cf.deepEvery = 100; });                                       // v4.29
  once('deep20', () => { cf.deepEvery = 20; });                                         // v4.30: карта раз в 20 боёв
  once('huntMig432', () => { cf.rbTour = false; });                                     // v4.32: тур — отдельный режим
  once('lvl444', () => Object.assign(cf, { lvlAbove: 10, lvlBelow: 5 }));               // v4.44
  once('fishBuyMig', () => { cf.fishAutoBuy = true; });                                 // v4.52: докупка наживки/зарядов
  once('lvl459', () => Object.assign(cf, { lvlAbove: 15, lvlBelow: 3 }));               // v4.59
  once('shopHpMig', () => {                                                             // v5.2.2: банок HP не меньше 300
    const [mn, mx] = pair(C('shopHp'), '300/1000');
    if (mn < 300) cf.shopHp = `300/${Math.max(mx, 1000)}`;
  });
  once('lvlTopMig', () => { cf.lvlAbove = 99; });                                       // v5.3.1: ограничение вверх снято
  // v5.5.8: Spoil Festival — своя строка «Масс-спойл»
  if (/festival/i.test(cfg.nSpoil || '') && !cfg.nSpoilMass) {
    const raw = String(cfg.nSpoil).split(',').map(x => x.trim()).filter(Boolean);
    cf.nSpoil = raw.filter(n => !/festival/i.test(n)).join(', '); cf.nSpoilMass = raw.filter(n => /festival/i.test(n)).join(', ');
  }
  // --- состояние: испорченные замеры ---
  let S = { ...(rt.skills || {}) }, sk = false;
  once('rbPotsMig', () => {                                                             // v3.5: оценка РБ с банками — «не по силам» перепроверяем
    const db = { ...(rt.rbDb || {}) };
    for (const id in db) if (db[id].verdict === 'no') db[id] = { ...db[id], verdict: 'chip', note: (db[id].note || '') + ' · перепроверка с банками' };
    rf.rbDb = db;
  });
  once('cdFix49', () => {                                                               // v4.7: «КД атаки 7 с» — замер через экран победы
    for (const [k, p] of Object.entries(S)) {
      const ref = (ilOf(k)?.reuse || 0) / 1000;
      if ((k === 'атака' && p.cd > 4) || (ref && p.cd && (p.cd < ref * 0.5 || p.cd > ref * 1.6))) { S[k] = { ...p, cd: k === 'атака' ? 2 : 0, cdS: [] }; sk = true; }
    }
    rf.cdUntil = {};
  });
  once('atkFix417', () => { if (S['атака']) { S['атака'] = { ...S['атака'], dmg: 0, dmgN: 0 }; sk = true; } });   // v4.17
  once('dmgFix427', () => { for (const [k, p] of Object.entries(S)) if (p.dmgN && p.dmg / p.dmgN < 100) { S[k] = { ...p, dmg: 0, dmgN: 0 }; sk = true; } });   // v4.27
  once('rbZoneFix430', () => {                                                          // v4.30: мусорные «зоны» rb:<id>
    const strip = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !/^rb:/.test(k)));
    Object.assign(rf, { zoneCat: strip(rt.zoneCat), zoneMobs: strip(rt.zoneMobs), zoneStat: strip(rt.zoneStat), rbZoneVisit: strip(rt.rbZoneVisit), zone: /^rb:/.test(rt.zone || '') ? null : rt.zone });
  });
  if (rt.spoilCdMig !== 2) { rf.spoilCdMig = 2; S.spoil = { ...(S.spoil || {}), cdNet: 0.3, cdFloor: 0 }; sk = true; }   // v5.5.5: у Spoil нет отката
  if (S['атака']?.cdFloor) { S['атака'] = { ...S['атака'], cdFloor: 0 }; sk = true; }                                 // v5.5.1
  once('learnFix7116', () => {   // 7.1.16-fix: урон призыва/поддержки и MP заклинаний были перемешаны с чужими действиями — учим заново
    for (const [k, p] of Object.entries(S)) {
      const sup = /^(?:(?:mass )?summon|servitor|transfer pain|heal\b|battle heal|cubic)/i.test(k);
      if (sup && p.dmgN) { S[k] = { ...p, dmg: 0, dmgN: 0 }; sk = true; }
      if (p.kind === 'скилл' && p.mpN) { S[k] = { ...S[k], mp: 0, mpN: 0 }; sk = true; }
    }
  });
  once('zone7128', () => { cf.zoneAuto = false; });
  once('trial7128', () => { if (!(C('zoneTrial') >= 15)) cf.zoneTrial = 20; });   // 7.1.30: проба зоны < 15 боёв — шум, а не замер (было 5)   // 7.1.30: автофарм (подбор локации) по умолчанию выключен — включается в «Быстрых режимах»
  once('weap7128', () => { Object.assign(rf, { weaponsT: 0 }); });   // 7.1.30: перечитать оружие (в памяти могла остаться кукла NG как «надето»)
  once('mag7125', () => { cf.autoMagister = false; Object.assign(rf, { magister: null }); });   // 7.1.30: магистр — только руками
  once('shots723', () => { cf.shopShots = '1000/5000'; });
  // 7.2.4: настройки рыбалки игрока (скрин 10.10) — базовые: наживка «Авто», заряды вкл., докупать вкл., 1000 пакетов наживки,
  // заряды под наживку (авто), 750 пакетов, если авто выкл., без лимита забросов
  // 8.0 (аудит боя): устаревшие «нижние границы» отката (Aura Burn 3,4 с при 1,1 с, VT 3,9 с) тормозили лучшие заклинания — стереть
  once('cdFloor80', () => { for (const [k, p] of Object.entries(S)) if (p && (p.cdFloor || p.cdFloorAt)) { S[k] = { ...p, cdFloor: 0, cdFloorAt: 0 }; sk = true; } });
  once('fish724', () => { Object.assign(cf, { fishBait: 'auto', fishShots: true, fishAutoBuy: true, fishBuyPacks: 1000, fishShotAuto: true, fishShotPacks: 750, fishMaxCasts: 0 }); });   // 7.2.3: игрок 10.10 — «минимум сосок в запасе 1000, докупать до 5000»
  once('champ803', () => { cf.searchChamp = false; });   // 8.0.3 (игрок 11.10): «поиск чемпионов по умолчанию откл., с возможностью вкл»
  // 8.0.3: замеры отката до правки learnCd (Blaze «3,1 с» при настоящих ≈0,8 с под баффами) — стереть, переучатся за пару боёв
  once('cdS803', () => { for (const [k, p] of Object.entries(S)) if (p && (p.cd || p.cdS)) { S[k] = { ...p, cd: 0, cdS: [] }; sk = true; } });
  // 8.0.3 (игрок 11.10: «купил почему-то сразу 9999 крючков» — 1000 пакетов × 10 = 10 000 наживки за 1 000 000 аден одной суммой;
  // выбор игрока: «покупать по 100 пакетов — кончилась, бот докупит»): 100 пакетов = 1000 шт. ≈ 100 000 аден ≈ 1,5 ч рыбалки
  // 8.0.3: выгода дебаффов набрана, когда провал «Ціль опирається ефекту» засчитывался как успех — замер заново
  once('dbfGain803', () => { if (rt.debuffGain) rf.debuffGain = {}; });
  // 8.0.3 (разбор RU/UA 11.10): в украинском интерфейсе метка «· чемпіон» — чемпионы шли как обычные мобы
  once('champMark803', () => { if (C('champMark') === 'чемпион') cf.champMark = 'чемпион, чемпіон'; });
  once('fishBait803', () => { if (C('fishBuyPacks') === 1000) cf.fishBuyPacks = 100; });
  // 8.0.3 (лог 11.10 10:44–11:45): откат рыбалки, раздутый отказами из-за лага сервера (1,69–1,80 с, в памяти 1,61 с), — обратно к 1,22 с
  once('fishCd803', () => { if (+rt.fishCdLen > 1.22) rf.fishCdLen = 1.22; });
  // 8.0.3 (логи 11.10 10:32–10:43): точка у Фальстона (мобы 75–80, Годдард) и Hot Springs записались как Pavel Ruins — «ур56: 141 бой,
  // 14,2 M EXP/ч» (настоящий Pavel Ruins — мобы 46–54, 2,2–3,9 M): автофарм полетел бы туда. Замеры 55+ ур. — долой, из её списка мобов —
  // чужие (60+ ур. по кэшу спавнов, иначе по ним зона снова узналась бы на чужой точке); текущую зону определит карта заново
  once('pavelZone803', () => { pavelFix(rt, rf); });
  // 8.0.3 (эпики): «Coin of Luck на эпиков» 0 теперь значит «НЕ тратить» (было «без лимита») — значение игрока не трогаем, только строка в журнал
  once('epicCol803', () => { const n = +C('epicCoinDailyMax') || 0; setTimeout(() => { try { rec('B', 'эпики', `Coin of Luck на эпиков: 0 теперь значит НЕ тратить (раньше — без лимита); ${n ? `ваш лимит ${n} за 24 ч сохранён` : 'сейчас стоит 0 — бот их не тратит'}`); } catch (e) {} }, 3000); });
  once('epicDeaths803', () => { if (+C('epicMaxDeaths') === 10) cf.epicMaxDeaths = 3; });   // 8.0.3: смертей на эпика 10 → 3 (только заводские 10)
  once('fishPack80', () => { if (C('fishTimePack') === '1h') cf.fishTimePack = '6h'; });   // 8.0 (аудит рыбалки): время рыбалки пакетом 6 ч — на 22 % дешевле часа (2,33 млн/ч против 3 млн/ч)
  once('rbFix721', () => {   // 7.2.1: окно карты другого РБ портило замеры (одинаковые HP/P.Atk у разных РБ) и вечные «не по силам» по оценке
    const S = { ...(rt.rbStats || {}) }, sig = {};
    for (const [id, v] of Object.entries(S)) (sig[`${v.hp}|${v.patk}`] ||= []).push(id);
    for (const ids of Object.values(sig)) if (ids.length > 1) ids.forEach(id => delete S[id]);
    const D = {};
    for (const [id, d] of Object.entries(rt.rbDb || {})) D[id] = d.verdict === 'no' && /^оценка до боя/.test(d.note || '') ? { ...d, verdict: null } : d;
    Object.assign(rf, { rbStats: S, rbDb: D, rbPreSkip: {}, debuffImmune: { ...(rt.debuffImmune || {}), rb: Date.now() } });   // лог 21:32: «Raid Boss має імунітет до негативних ефектів»
  });
  once('queenBuff92', () => {   // 9.2 (игрок 11.10): «Summon Feline Queen» = бафф кота Blessing of Queen → в «Баффы кота», из «какого кота призывать» — убрать
    const ps = String(C('nPetBuffs') || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!ps.some(n => /^summon feline queen$/i.test(n))) cf.nPetBuffs = [...ps, 'Summon Feline Queen'].join(', ');
    if (/feline queen/i.test(String(C('petSummon') || ''))) cf.petSummon = '';
  });
  once('fistOff923', () => { cf.nWeaponBuff = ''; cf.weaponSwap = false; rf.buffSwap = null; });   // 9.2.3: смена оружия ради баффа (кастеты) убрана
  once('ud721', () => { const ps = String(C('nPetBuffs') || '').split(',').map(x => x.trim()).filter(Boolean); if (ps.some(n => /ultimate defen/i.test(n))) cf.nPetBuffs = ps.filter(n => !/ultimate defen/i.test(n)).join(', '); });   // 7.2.1: автороли поставили Ultimate Defense в баффы кота
  once('bait721', () => { if (C('fishBait') !== 'good') cf.fishBait = 'auto'; });   // 7.2.1: наживка по замеру (обычная была заводской)
  once('camp721', () => { cf.campaign = false; Object.assign(rf, { campOnce: false, campaignDue: false }); });   // 7.2.1: кампания убрана — квесты игрок ведёт сам
  once('deep10_7123', () => { cf.deepEvery = 10; });                                   // 7.1.30: карта раз в 10 боёв (просьба игрока)
  once('aliasFix7121', () => {    // 7.1.30: выкинуть выученные алиасы, совпавшие с именем чужого заклинания
    const A = { ...(rt.logAlias || {}) }; let n = 0;
    for (const [k, v] of Object.entries(A)) if (Object.entries(NAME_ALIAS).some(([k2, v2]) => k2 !== k && apos(v2) === apos(v))) { delete A[k]; n++; }
    if (n) setRt({ logAlias: A });
  });
  once('debuffDmg7120', () => {   // 7.1.30: дебаффы получали чужой урон (Surrender to Fire «1822») — обнуляем
    for (const [k, p] of Object.entries(S)) if (p.dmgN && /^(?:curse|surrender|сurse)/i.test(k)) { S[k] = { ...p, dmg: 0, dmgN: 0 }; sk = true; }
  });
  once('ffDmgMig', () => { if (S['focused force']?.dmgN) { S['focused force'] = { ...S['focused force'], dmg: 0, dmgN: 0 }; sk = true; } });
  const ha = S['hurricane assault'];
  if (ha?.dmgN && Math.abs(ha.dmg / ha.dmgN - 535) < 1) { S['hurricane assault'] = { ...ha, dmg: 0, dmgN: 0 }; sk = true; }   // v3.5
  if (sk) rf.skills = S;
  if (Object.keys(cf).length) {
    cfg = withRb({ ...cfg, ...cf });
    if (on && !tabOwner) deferredMigrations.cfg = { ...deferredMigrations.cfg, ...cf };
    else setCfg(cf).catch(() => {});
  }
  if (Object.keys(rf).length) {
    if (on && !tabOwner) deferredMigrations.rt = { ...deferredMigrations.rt, ...rf };
    else setRt(rf);
  }
  try { dock(); } catch (e) {}
  if (isBattle()) setTimeout(() => hotbarRows3().catch(() => {}), 800);   // и при выключенном боте — 3 ряда открыты всегда
  if (/magister/i.test(location.pathname)) [2500, 6000].forEach(ms => setTimeout(() => { try { learnSkillDb(); } catch (e) {} }, ms));   // 7.1.31: ранги/описания навыков — и при выключенном боте
  draw(); main();
  if (!on && rt.invScan) invScanDrive();
}));
