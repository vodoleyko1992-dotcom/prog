// ===== L2wap Bot v20.3 — квестовые цели на точке, единые задачи и автозаточка =====
// Бой: точные селекторы по разметке battle.html (снимок 2026-10-07).
// Карта: точные селекторы map.html + кэш спавнов локации.
const L2V7Modules = Object.create(null);
const TAG = '[L2bot]';
const recovery = L2EngineCore.createRecoveryController();
const transitionMonitor = L2EngineCore.createTransitionMonitor();
const progressMonitor = L2EngineCore.createProgressMonitor();
const ipc = (payload, ms = 15000) => L2EngineCore.withTimeout(chrome.runtime.sendMessage(payload), ms);
const DEF_CFG = { mmOrders: true, mmTpMax: 500000, mmGoalItem: 0, mmGoalLvl: 5, mmGoalFarm: true, mmShopBuy: true, mmSmithAuto: true, mmUpgrade: true, mmCrafter: 'Skye', mmCraftScope: 'next', mmCraftSend: true, mmCraftNote: true, mmMailClaim: true, storyTurnIn: true, storyTpMax: 100000, mmFarmBest: true, mmFarmDrop: true, mmFarmSpoil: 'auto', mmFarmGuide: true, subCraftSelf: true, subSpoilFirst: true, subMainNick: '', subHelpMain: true, epicMode: false, epicList: 'ak,core,orfen,baium,valakas,antharas,frintezza,zaken', epicMaxDeaths: 5, epicCheck: false, epicRetreatHp: 35, epicLvlUp: 0, epicCoinDailyMax: 0, epicCoinPerBoss: 1, epicCoinKeep: 0, epicMaxFightMin: 0, epicMaxRetreats: 8, epicAdenaDailyMax: 0, epicMinHpPots: 0, recipeRes: '', recipeNeed: 0, recipeSpoil: false, catMode: false, catDungeon: 'auto', nKeyBuffs: '', keyBuffBoss: true, nToggles: '', toggleMpOff: 10, toggleMpOn: 30, nSpoil: '', nSpoilMass: '', nSweep: '', spoilRb: false, tvtOn: true, tvtHoldMin: 3, tvtOverRb: true, tvtPet: true, pvpOnSight: true, enemyHunt: true, enemyFlagOnly: true, enemyLvlAbove: 3, enemyMinHits: 3, enemyMaxLoss: 2, enemyScanS: 30, fightMode: 'dps', combatProfile: 'auto', rbPotAt: 75, rbPotTo: 80, rbFrenzyDive: false, nUltra: '', ultMode: 'big', nDrain: '', drainHp: 85, indMode: 'full', autoLearn: true, netLog: true, gameMsgLog: true, learnShots: false,
  "petFullAuto":false,"petFullBudget":10000000,"petFullMaxPrice":10000000,"petFullReserve":null,"petFullRenew":true,"petHealPrefer":"heal",
  enchantMode: false,
  enchant: {"enabled":false,"queue":[],"scrollPolicy":"blessed","ordinaryUntil":3,"maxAttempts":0,"maxScrolls":0,"maxAdena":0,"maxConsecutiveFails":2,"maxDropFromStart":1,"maxDropFromPeak":2,"delayMs":1500,"purchase":false,"colBudget":0},
  priority: '[квест]\n[чемп]\n[все]',
  rec: true, autoSnap: true, questStop: false, dock: true, dockMin: false,
  fishMode: false, rodEnchantTo: 10, fishTimeAuto: false, fishTimePack: '6h', fishTimeMin: 5, fishBait: 'auto', farmLvlBelow: 5, farmLvlAbove: 5, rbSessBuffs: 'auto', rbSessNob: true, epicFaFull: true, rbFaFull: true, rbProbe: true, fishShots: true, fishAutoBuy: true, fishBuyPacks: 100, fishShotPacks: 750, fishShotAuto: true, fishMaxCasts: 0, fishSrvCd: true,
  autoMagister: true, magisterEvery: 1, potSlotAuto: true, debuffAuto: true, debuffMode: 'auto', nDebuff: '', fishProcess: true, fishProcessEvery: 100, fishOpenBoxes: true, fishGoal: '', weaponClassPick: true, weaponClassEquip: true, weaponManual: false, weaponScanAuto: true, shopAuto: true, shopReserve: 200000, shopMaxSpend: 2000000, shopHp: '300/1000', shopMp: '200/1000', shopShots: '1000/5000', shopSpirit: '0/1000', shopSoul: '0/1000', shopBait: '0/0', zoneAuto: false, zoneTrial: 20, zoneAbove: 10, rbMaxBelow: 9, townBuffSet: 'basic', faBuffs: '', resQuests: '', rbMpPots: true, rbFast: true, rbTour: false, farmRes: '', farmNeed: 0,
  campaign: false, campAuto: true, champBlue: true, champOrange: true, champRed: false, champMinLvl: 20, autoRevive: true, campaignEvery: 25,   // 10.0.10: campAuto — сюжетный квест новичка бот ведёт сам (герой < 40)
  autoRoles: true, nWeaponMain: '',
  rbValueTour: false, rbExpValue: 0.20, rbPotCost: 500, rbMode: false, rbBandAuto: true, rbTurnPrice: true, rbCharge: true, rbChipRetreat: false, rbChipMaxAttempts: 3, rbRetreatHp: 20, rbRestHp: 95, rbMaxAbove: 15, rbMaxKillMin: 20, rbTimers: true, rbTimerMin: 10, rbRespH: 8, rbTimerAll: false, rbUsePots: true, rbPotReserve: 10,
  autoTasks: null, taskOnly: false, tsGoalItem: 920033, tsBuy: false, dailyAuto: true, clanTasks: true, chain: true, searchQuest: true, searchChamp: true, champFa: true, champLeave: true, noCancelMobs: true, cancelMobs: '', champCancel: 'efficiency', champEvery: 20, deepEvery: 10,   // 8.0.3: чемпионы по умолчанию ВЫКЛ (игрок 11.10), включаются в «Охоте»
  lvlMin: 1, lvlMax: 99, lvlAbove: 5, lvlBelow: 5, maxPages: 3, sealAuto: false, sealMin: 1,
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
const DEF_RT = { pvpTargets: {}, pvpRecovery: null, pvpResolved: [], status: '', kills: 0, exp: 0, sp: 0, adena: 0, buffAt: {}, buffSeen: {}, hpMin: {},
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
// Рейдовый бой в обычном фарме отключён; старый сохранённый rbBetween не оживляет его.
const rbEff = c => c.enchantMode !== true && !!c.rbHuntMode;
const withRb = c => L2EngineCore.taskConfig({ ...L2EngineCore.rawTaskConfig(c), rbMode: rbEff(c) }, () => rt);
const mergeCfg = c => withRb({ ...DEF_CFG, ...L2EngineCore.rawTaskConfig(c || {}) });
const modeSig = c => Array.isArray(c.autoTasks) ? 'выбрано: ' + L2EngineCore.taskList(c).join(', ') : c.enchantMode === true ? 'заточка' + (c.tvtOn ? ' + TvT' : '') : [c.rbHuntMode && 'тур РБ', c.epicMode && 'эпики', c.fishMode && 'рыбалка', c.catMode && 'катакомбы', c.zoneAuto && 'автофарм',
  c.campaign && 'кампания', c.tvtOn && 'TvT'].filter(Boolean).join(' + ') || 'фарм на месте';

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
  if (on && L2V7Modules.actions?.canAct?.() === false) return false;
  if (L2V7Modules.payments?.blocked?.() && !L2V7Modules.payments.consumePermit()
      && !isBattle() && !/\/tvt-arena\.html$/i.test(location.pathname)
      && !el.matches?.('#tvt-register-btn,#map-defeat-tocity,#battle-defeat-tocity')) return false;
  if (L2V7Modules.pvp?.pending() && !['#map-defeat-tocity','#battle-defeat-tocity'].some(s => $q(s) === el)) return false;
  // 10.0.13: Stop отменяет и клики продолжения после await; при выключенном боте оставляем ручной просмотр инвентаря и раскрытие панели.
  if (!on && !(invBusy && !running && rt.invScan?.manual) && !el.matches?.('.l2-battle-hotbar__row-nav--down')) return false;
  // 10.0.2: пока висит проверка активности, клик по странице = «подозрительная попытка» у игры (10 → блок фарма) — не кликаем ничего,
  // кроме крестика окна «Фарм заблокирован» (тогда проверки уже нет)
  if (abHold() && !el.closest?.('.l2-antibot-card--blocked')) return false;
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
    src: TAB_ID, epoch: leaseEpoch, expectedChar: rt.char || '' });
  if (!response?.ok) throw new Error('settings_patch_failed: ' + (response?.reason || 'unknown'));
  cfg = withRb({ ...L2EngineCore.rawTaskConfig(cfg), ...patch });
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
      mp: +(t.match(/MP\s*(\d+)/)?.[1] || 0), mpKnown: /MP\s*\d+/.test(t), power: +(t.match(/(?:сил[аи]|power)\s*:?\s*(\d+)/i)?.[1] || 0),
      cd: +(t.match(/(?:Перезарядк\S*|Откат|Відкат|Cooldown)\s*:?\s*(\d+(?:[.,]\d+)?)/i)?.[1]?.replace(',', '.') || 0),
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
// Выборка прогноза v1 начинается после исправления истории sync. Общая статистика сохраняется.
function damageSkill(p) {
  const e = p?.damageEvidence?.v === 1 ? p.damageEvidence : {};
  return { ...p, dmg: e.dmg || 0, dmgN: e.dmgN || 0, uses: e.uses || 0, unknown: e.unknown || 0, spl: e.spl || 0, splN: e.splN || 0 };
}
function damageSkills() { return Object.fromEntries(Object.entries(rt.skills || {}).map(([k, p]) => [k, damageSkill(p)])); }
function expDmg(name) {
  const k = (name || '').toLowerCase(), f = fightDmg(k);
  if (f != null) return f;                       // замер текущего боя важнее среднего
  const p = damageSkill(rt.skills?.[k]);
  if (p.dmgN) return p.dmg / p.dmgN;
  const atk = damageSkill(rt.skills?.['атака']), base = atk.dmgN ? atk.dmg / atk.dmgN : 600;
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
  const learned = rt.skillDb?.[k] || rt.skillDb?.[ilOf(k)?.n?.toLowerCase()];
  if (learned && (learned.mpKnown || learned.mp > 0) && Number.isFinite(learned.mp)) return learned.mp;
  const v = ilOf(k)?.mp; return Array.isArray(v) ? v[Math.min(v.length - 1, 10)] : (v || 30);
}
function powerOf(k) {
  const db = rt.skillDb?.[k] || rt.skillDb?.[ilOf(k)?.n?.toLowerCase()];
  if (db?.power) return db.power;
  const m = (rt.skills?.[k]?.last || '').match(/сил[аи]\s*(\d+)/i);
  if (m) return +m[1];
  const ls = LS_BY_NAME[k] ?? (IL_FIX[IL_BY_NAME[k]]?.ls ? IL_BY_NAME[k] : null);   // 10.0.2: умение Life Stone — Power 109
  return ls != null ? ilNum(IL_FIX[ls]?.pow) || 0 : 0;
}
function powerK() {                              // медиана «урон / сила» по скиллам, где известно и то и другое
  const r = Object.entries(damageSkills()).filter(([k, p]) => p.dmgN >= 2 && powerOf(k)).map(([k, p]) => p.dmg / p.dmgN / powerOf(k)).sort((a, b) => a - b);
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
  'flame strike': 'удар полум’я', 'corpse plague': 'чума трупа', 'hamstring': 'підріз сухожилля' };   // остальные имена бот запоминает сам (rt.logAlias) по первому одиночному нажатию
const apos = s => String(s || '').toLowerCase().replace(/[’'`ʼ]/g, '’');
const logName = n => apos(rt.logAlias?.[(n || '').toLowerCase()] || NAME_ALIAS[(n || '').toLowerCase()] || n);
for (const [a, b] of Object.entries(NAME_ALIAS)) if (IL_BY_NAME[b] != null && IL_BY_NAME[a] == null) IL_BY_NAME[a] = IL_BY_NAME[b];
// 10.0.2: Life Stone (augment.js) — активные умения оружия. На L2WAP все Power 109 (код игры, weapon-augmentation-display.js)
const AUG = typeof L2Aug !== 'undefined' ? L2Aug : null;
const LS_BY_NAME = Object.create(null);
// 10.0.27: штатные actionId панели Warrior, снимки/карточки 15.10 10:26.
// 15.10, живая проверка: Battle Trance расходует HP, это не атака и не автоматический бафф.
const NATIVE_SKILL_META = { battle_trance: { n: 'Battle Trance', c: 'Расход HP', t: 'HP_SELF_COST', o: 'ACTIVE', target: 'SELF', autoUse: false, L: 'L2WAP: снижает текущее HP до 25% максимума; только вручную' } };
const NATIVE_SKILL_NAMES = { 'battle trance': 'battle_trance' };
const NATIVE_SKILL_IL = { war_cry: 78, stun_attack: 100, wild_sweep: 245, power_smash: 255, vicious_stance: 312 };
IL_BY_NAME['дикий розмах'] = 245;
function ilOf(x) {                               // x: кнопка слота, запись панели (cdKey) или имя скилла
  let id = null, name = '';
  if (x && typeof x === 'object') {
    const k = x.cdKey ?? x.getAttribute?.('data-slot-cd') ?? x.querySelector?.('[data-slot-cd]')?.dataset.slotCd ?? '';
    if (Object.hasOwn(NATIVE_SKILL_META, k)) {
      const nm = String(x.name || (x.title || '').split(/\s+[—–-]\s+|\n|\s*\(/)[0]).trim().toLowerCase();
      if (nm) NATIVE_SKILL_NAMES[nm] = k;
      return { ...NATIVE_SKILL_META[k] };
    }
    const m = String(k).match(/l2_(\d+)/);
    name = x.name || (x.title || '').split(/\s+[—–-]\s+|\s*\(/)[0];
    if (m) id = +m[1];
    else if (Object.hasOwn(NATIVE_SKILL_IL, k)) { id = NATIVE_SKILL_IL[k]; if (name.trim()) IL_BY_NAME[name.trim().toLowerCase()] = id; }
    else if (k === 'corpse_plague' || k === 'hamstring_slash') id = k === 'corpse_plague' ? 103 : 127;
    // 10.0.2: умение Life Stone на панели — data-slot-cd="ls_prominence" (без номера). Имя слота (labelUk игры) запоминаем:
    // замеры и план боя ищут скилл по имени
    else if (AUG?.isLs(k)) { id = AUG.SKILL_IL[k] ?? null; const nm = String(name || '').trim().toLowerCase(); if (id != null && nm && !AUG.isLs(nm)) LS_BY_NAME[nm] = id; }
  } else name = x || '';
  if (id == null && NATIVE_SKILL_NAMES[String(name).trim().toLowerCase()]) return { ...NATIVE_SKILL_META[NATIVE_SKILL_NAMES[String(name).trim().toLowerCase()]] };
  if (id == null && name) id = IL_BY_NAME[name.trim().toLowerCase()] ?? LS_BY_NAME[name.trim().toLowerCase()] ?? AUG?.SKILL_IL[name.trim().toLowerCase()];
  return id != null && IL[id] ? { id, ...IL[id], ...(IL_FIX[id] || {}) } : null;
}
// 7.2: скиллы, которые на L2WAP работают иначе, чем в справочнике Interlude.
// Corpse Life Drain (лог 10.10 20:52–20:53, игрок поставил вместо Heal): лечит себя в бою по живой цели («Витяг життя з трупа»,
// HP = уровень×3 + ранг×5 = 178 на 51 ур./ранге 5, MP 0, повтор через ≈2 с; кот бьёт и на этот ход). В Interlude — «маг. атака по трупу»
// 7.2.1 (скрин магистра 10.10): дебаффы L2WAP — не как в Interlude. mDefDown — +урон заклинаний мага (кот бьёт физикой, ему не помогает),
// pAtkDown — защита (моб бьёт слабее). Curse Poison в справочнике — «Яд», на L2WAP это −12 % P.Atk
const IL_FIX = { 78: { dur: 300, L: 'L2WAP: War Cry · +20% P.Atk на 5 минут · MP 10 · откат 180 с' },
  1151: { c: 'Лечение', t: 'HEAL', target: 'SELF', reuse: 2000, mp: 0, pow: 0,
  L: 'Лечение · на себя · L2WAP: в бою по живой цели, HP = уровень×3 + ранг×5, MP 0, откат ≈2 с' },
  // 10.0.23 (лог15.10 07:14): оба навыка наносят прямой урон живому РБ.
  // Тип защиты и АОЕ не подтверждены; урон/MP/КД берём из наблюдений и ответа сервера.
  103: { c: 'Прямая атака', t: 'DAM', target: 'ONE', pow: 0, mag: null, eff: null, dur: 0, l2Damage: true, L: 'L2WAP: прямой урон живой цели; величина и откат — по замеру' },
  127: { c: 'Прямая атака', t: 'DAM', target: 'ONE', pow: 0, mag: null, eff: null, st: null, dur: 0, l2Damage: true, L: 'L2WAP: прямой урон живой цели; величина и откат — по замеру' },
  1083: { st: 'mDefDown', L: 'Дебафф · L2WAP: M.Def цели −10 %' },
  1222: { st: 'mDefDown', st2: 'pAtkDown', L: 'Дебафф · L2WAP: P.Atk цели −12 %, M.Def −10 %' },
  1164: { st: 'pAtkDown', dur: 10, L: 'Дебафф · L2WAP: P.Atk моба −20 % на 10 с, шанс 80 %' },
  1168: { c: 'Дебафф', t: 'DEBUFF', st: 'pAtkDown', dur: 15, L: 'Дебафф · L2WAP: P.Atk цели −12 %' },
  // 15.10, живая проверка: слот1331 сохраняет Kai, эффект4699 у героя держится20мин.
  // Роль PET сохраняем для поддержки слуги; бафф героя сам по себе не доказывает бафф питомца.
  1331: { c: 'Бафф', t: 'BUFF', o: 'ACTIVE', target: 'PET', dur: 1200, reuse: 2000, mp: 87, eff: 'Buff', L: 'L2WAP: Blessing of Queen — физ. крит +30%, урон физ. крита +25%; у героя 20 мин, эффект у слуги проверяется отдельно · MP 87' },
  // 10.0.2: умения Life Stone (есть, пока надето оружие с этим ЛС). Power 109 у всех ударных — замер урона заменит оценку после 1–2 нажатий
  ...Object.fromEntries(Object.values(AUG?.OUT || {}).filter(o => o.k === 'active' && o.il !== 1401).map(o => [o.il, { pow: AUG.POWER, ls: 1, L: `Life Stone · L2WAP: ${o.d}` }])),
  1401: { ls: 1, L: 'Life Stone · L2WAP: сильное лечение HP' } };
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
  })).map(r => (AUG?.isLs(r.cdKey) && ilOf(r), r));        // 10.0.2: имя умения Life Stone → id (LS_BY_NAME) для поиска по имени
}
const BUFF_RE = /\s+на\s+(\d+)\s*с(?![а-яa-z])/i;               // «Totem Spirit Bear на 120 с.»
// урон из строк лога: «Iron Punch ⏎ 993» / «Ты нанёс [ моб ] 97 урона»
const splashDmg = lines => lines.reduce((sum, line) => {
  // Лог 14.10 16:20: считаем отображённый урон каждому соседу, включая разделители тысяч; он может превышать оставшиеся HP.
  const tail = String(line).match(/(?:поруч|додаткові цілі\s*[—–:-])([^⏎]*)/i)?.[1] || '';
  return sum + [...tail.matchAll(/[−-]\s*(\d[\d \u00a0\u202f]*)/g)].reduce((a, m) => a + +m[1].replace(/\D/g, ''), 0);
}, 0);
function dmgFromLog(name, lines, allowAlt = true) {
  if (/^атака$/i.test(name)) {
    // «Атака» кастетами — 1–3 удара за нажатие (в логе 2 строки «Ты нанёс … N урона»): считаем все (до v4.16 — только первый)
    const hits = lines.filter(l => /нан[её]с/i.test(l) && !/поруч|рядом/i.test(l)).map(l => +((l.match(/(\d+)\s*урон/i) || [])[1] || 0));
    return hits.reduce((a, b) => a + b, 0) + splashDmg(lines);   // главная цель + задетые рядом
  }
  // Лог 14.10 16:20: урон соседям — отдельный канал, даже если его строка идёт перед главным попаданием.
  lines = lines.filter(l => !/(?:поруч|додаткові цілі\s*[—–:-])/i.test(String(l)));
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
  const owner = observeOwner();
  if (fightLearn.id !== id || fightLearn.owner !== owner) fightLearn = { id, owner, d: {} };
  (fightLearn.d[key] ||= []).push(dmg);
}
function fightDmg(key) {
  if (fightLearn.id !== location.search || fightLearn.owner !== observeOwner()) return null;
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
function observeOwner() { return JSON.stringify([rt.char || '', rt.classCur?.prof || '', rt.classCur?.slot ?? '', rt.classSwT || rt.classCur?.t || 0, typeof leaseEpoch === 'undefined' ? null : leaseEpoch]); }
function damageSample(p, dmg, known, splash) {
  const e = p.damageEvidence?.v === 1 ? { ...p.damageEvidence } : { v: 1, dmg: 0, dmgN: 0, uses: 0, unknown: 0, spl: 0, splN: 0 };
  e.uses++; if (!known) e.unknown++;
  if (dmg > 0) { e.dmg += dmg; e.dmgN++; }
  if (e.dmgN > 60) { e.dmg = Math.round(e.dmg / e.dmgN * 40); e.dmgN = 40; }
  if (splash != null) { e.spl += splash; e.splN++; }
  p.damageEvidence = e;
}
let lastObserve = 0;                             // время последнего нажатия слота (для честного «запасного» урона)
function observeSlot(b, src) {
  if (!isBattle() || !b) return;
  if (slotKind(b) === 'предмет' && /зілля|зелье|potion|elixir|еліксир|эликсир/i.test(b.title || '')) potWatch(b).catch(() => {});
  const name = cleanTitle(b.title), key = name.toLowerCase();
  if (!key) return;
  const before = { mob: mobHp(), me: meHp(), mp: meMp(), arr: logLines(), t: Date.now(), notice: noticeText(), netStart: ACT_NET.start, netDone: ACT_NET.done };
  const action = slotAction(b), observedOwner = observeOwner();
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
      if (went && !spoiled && observeOwner() === observedOwner) await learnCd(key, name, (Date.now() - t0) / 1000, b);
    })();
  }
  setTimeout(async () => {
    if (observeOwner() !== observedOwner) return;
    // 10.0.12 (лог 14.10 21:43:59): ответ Energy Bolt шёл 1289 мс, а замер в 900 мс учил ложный ноль.
    // Ждём только свой отправленный ход; следующий клик, чужой ответ или таймаут отменяют замер. Без событий хука — старый fallback.
    if (ACT_NET.start > before.netStart) {
      const ownStart = before.netStart + 1;
      while (ACT_NET.done < ownStart && Date.now() - before.t < 8000 && lastObserve === before.t && ACT_NET.start === ownStart) await sleep(40);
      if (lastObserve !== before.t || ACT_NET.start !== ownStart || ACT_NET.done !== ownStart || !ACT_NET.ok || (action && ACT_NET.action !== action)) return;
    } else if (before.netStart > 0 || ACT_NET.done !== before.netDone || lastObserve !== before.t) return;
    if (observeOwner() !== observedOwner) return;
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
    // У атаки DOM-парсер исторически суммирует соседей; модель основного удара хранит их отдельно.
    if (slotKind(b) === 'атака' && dmg > 0) dmg = Math.max(0, dmg - splashDmg(added));
    // 9.2: ответ сервера на этот ход уже разобран анализатором боя — его цифры точные (окно 0,9 с захватывает соседние ходы:
    // лог 11.10 00:49:23 «Blaze: урон 3062 · HP +420» — это банка; 09.10 «Summon Kat» получил урон Vampiric Touch)
    const ex = L2V7Modules.fightlab?.turnFor(key, before.t, action, ACT_NET.rid);
    if (ex && ex.ownKnown !== false && !buff && !support && slotKind(b) !== 'предмет') dmg = ex.own;
    // запасной способ — падение HP моба, только если в окне не было других нажатий
    if (!dmg && !ex && !buff && !support && solo && !petHit && before.mob && mob && before.mob.cur > mob.cur) dmg = before.mob.cur - mob.cur;
    // мусорное число в логе («Force Burst: сила 1713488» при 2580 HP у моба) — урон не может быть больше ~1,5 HP моба:
    // берём реально снятые HP (v4.23)
    // v4.27: только явный мусор (>3× HP моба и >100 тыс.) — добивающий удар 4620 по мобу с 2388 HP настоящий
    if (dmg > 100000 && before.mob?.max && dmg > before.mob.max * 3) dmg = Math.max(0, before.mob.cur - (mob?.cur ?? before.mob.cur));
    // Нет цифры в принятом ответе — неизвестный урон, а не подтверждённый промах.
    const damageKnown = dmg > 0 || !!(buff || support || slotKind(b) === 'предмет' || isChargeName(name))
      || (ex ? ex.ownKnown !== false : /^(?:Ти|Вы|Ты)\s+промахну|промахнулись/i.test(txt));
    const mpd = ex && ex.mpd != null ? ex.mpd : before.mp && mp ? before.mp.cur - mp.cur : 0;
    const hpd = ex ? ex.selfHeal : before.me && me ? me.cur - before.me.cur : 0;
    const stun = /оглуш|приголомш|stun/i.test(txt);
    const p = { name, uses: 0, usesU: 0, dmg: 0, dmgN: 0, mp: 0, mpN: 0, heal: 0, mpGain: 0, buffSec: 0, stun: 0,
                ...(rt.skills?.[key] || {}) };
    p.uses++; if (!damageKnown) p.unknown = (p.unknown || 0) + 1; if (src === 'U') p.usesU++;
    if (dmg > 0) { p.dmg += dmg; p.dmgN++; }
    // 7.2.1 (лог 10.10 21:08): Sprite's Staff (B) вместо Demon's Staff (C) — Blaze бьёт ≈1800, а среднее из 5 373 старых замеров
    // показывало ≈900 (по нему считаются добивание, окупаемость дебаффов, ДПС-план). Среднее — по последним ≈40–60 замерам
    if (p.dmgN > 60) { p.dmg = Math.round(p.dmg / p.dmgN * 40); p.dmgN = 40; }
    if (dmg > 0 && slotKind(b) === 'скилл' && BUFF_CTX) try { L2V7Modules.combat.spellSample(BUFF_CTX, key, dmg); } catch (e) {}   // 7.2.1: выгода дебаффов
    if (damageKnown && (slotKind(b) === 'атака' ? !/перезаряд/i.test(noticeText()) : dmg > 0)) fightNote(key, dmg);   // промахи атаки тоже считаем
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
    damageSample(p, dmg, damageKnown, slotKind(b) === 'скилл' && dmg > 0 ? splashDmg(added) : null);
    await setRt({ skills: { ...(rt.skills || {}), [key]: p } });
    rec(src, 'скилл', `«${name}»: урон ${damageKnown ? dmg : 'не измерен'} · MP ${mpd > 0 ? '−' + mpd : mpd < 0 ? '+' + -mpd : 0}`
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
// 10.0.5 (игрок 13.10: «автопоиск чемпионов раз в 20 убитых мобов»): карта ради чемпионов — раз в cfg.champEvery боёв (20), и при «0 = никогда»
const champEvery = () => Math.max(5, +cfg.champEvery || CHAMP_EVERY);
const champHunt = () => champRuleOn() && parseRules().some(x => x.champ && !x.neg);
// 7.1.31 (просьба игрока: «поставил 99999, а он всё равно проверяет карту»): 0 — карту по плану НЕ проверять никогда, только цепочка
// «Охотиться дальше» (было «0 = каждый бой»). Выключает и «не реже раза в 20 боёв» ради чемпионов, и «горячую» карту, и уход за ★ целью.
// Остаётся только необходимое: цели главы при включённой «Кампании», РБ-режимы, нет кнопки «Охотиться дальше», старт с карты
const mapOff = () => (+cfg.deepEvery || 0) <= 0;
const campChampDue = () => campActive() && campChampOpen();
// 15.10: на точке ресурса/рецепта единый интервал 50 побед; общие deepEvery/champEvery его не сокращают.
const FARM_EVERY = 50;
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
const deepN = () => farmMapOn() ? FARM_EVERY
  : campChampDue() ? Math.min(+cfg.deepEvery || 5, 5)
  : champHunt() ? (mapOff() ? champEvery() : Math.min(cfg.deepEvery, champEvery())) : mapOff() ? Infinity : cfg.deepEvery;
const mapDue = (rules, ignoreHot = false) => rbDue() || (campRbOpen().length && (rt.sinceDeep || 0) >= 3) ||
  (farmMapOn() ? (rt.sinceDeep || 0) >= FARM_EVERY : (searchActive(rules) &&
  (campChampDue() || !mapOff() || champHunt()) && ((!ignoreHot && rt.deepHot) || rt.sinceDeep >= deepN())));
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
  patch => ipc({ cmd: 'statePatch', patch, src: TAB_ID, epoch: leaseEpoch, expectedChar: rt.char || '' }),
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
    try { if (tabOwner) L2V7Modules.fightlab?.flush?.(); } catch (e) {}   // 10.0 (аудит боя): память боя пишется раз в 30 с — при уходе дописываем в очередь
    const p = rtWriter.peek();
    if (p && Object.keys(p).length && tabOwner && leaseEpoch && !tabIdle) chrome.runtime.sendMessage({ cmd: 'statePatch', patch: p, src: TAB_ID, epoch: leaseEpoch, expectedChar: rt.char || '' }, () => void chrome.runtime.lastError);
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

async function gotoPage(...args) { return L2V7Modules.mobfarm.gotoPage(...args); }

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
// 10.0.10 (лог 13.10 18:13, новый герой alt1 8 ур.): уровень в шапке не прочитался (0) — окно уровней в карте и бою не работало, бот пять раз подряд шёл
// к красному Hook Spider 16 (+8), а вердикт чемпионов считался от уровня 0/1. Последнее прочитанное ненулевое значение — запас на такой случай
// (уровень только растёт; ответ игры GET /character тоже его знает, но шапка — быстрее). Смена персонажа — кэш сброшен (lvlSeenNick)
let lvlSeen = 0, lvlSeenNick = '';
const heroLvl = () => { const v = parseInt(($q('#l2-hud-legacy-lvl')?.textContent || '').replace(/\D/g, ''), 10) || 0, n = rt?.char || ''; if (lvlSeenNick !== n) { lvlSeen = 0; lvlSeenNick = n; } if (v) lvlSeen = v; return v || lvlSeen || 0; };
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
const huntOn = (...args) => cfg.enchantMode !== true && L2V7Modules.raid.huntOn(...args);
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
  const active = () => on && tabOwner && L2V7Modules.actions?.canAct?.() !== false;
  if (!active()) return;
  setStatus('Фарм: читаю «Фарм ресурсов» на форуме');
  await waitX(() => !active() || $q('.l2-farm-row__toggle, details.l2-farm-guide-section, details'), 15000, 300);
  if (!active()) return;
  await farmIcons().catch(() => {});
  if (!active()) return;
  const done = new Set(rt.farmScanDone || []);
  const out = [];
  let n = 0;
  const flush = async () => { if (active() && out.length) { await farmSave(out.splice(0)); if (!active()) return; await setRt({ farmScanDone: [...done].slice(-3000) }); } };
  const readRow = async row => {
    if (!active()) return;
    const nm = (row.querySelector('.l2-farm-row__name')?.textContent || '').trim();
    const key = (row.closest('details')?.querySelector(':scope > summary')?.textContent || '').trim().slice(0, 40) + '|' + nm;
    if (!nm || done.has(key)) return;
    const btn = row.querySelector('.l2-farm-row__toggle');
    const has = () => row.querySelector('.l2-farm-source, .l2-farm-boss');   // мобы или «Падает с РБ»
    if (btn && !has()) { fire(btn); await waitX(() => !active() || has() || (row.querySelector('.l2-farm-row__detail')?.textContent.trim().length > 3 ? 1 : null), 4000, 100); }
    if (!active()) return;
    const r = farmRowParse(row);
    if (r) { r.cat = farmCatOf(row); out.push(r); }
    done.add(key); n++;
    if (btn && btn.getAttribute('aria-expanded') === 'true') { fire(btn); await sleep(120); }
    if (!active()) return;
    setRt({ status: `Фарм: читаю базу — ${n} строк${r ? ` · ${r.name}` : ''}` }); draw();
    await sleep(rnd(120, 240));
    if (out.length >= 20) { await flush(); await sleep(600); }   // сохраняем и даём странице «вздохнуть»
  };
  // группы: раскрываем по одной, внутри — строки, затем вложенные группы; после — сворачиваем
  const walk = async (box, depth) => {
    if (!active() || depth > 4) return;
    const own = box.tagName === 'DETAILS' ? box : null;                        // строки именно этой группы (не вложенных)
    for (const row of [...box.querySelectorAll('.l2-farm-row')].filter(r => (r.closest('details') || null) === own)) { if (!active()) return; await readRow(row); }
    const subs = [...box.querySelectorAll('details')].filter(d => d.parentElement.closest('details') === (box.tagName === 'DETAILS' ? box : null));
    for (const d of subs) {
      if (!active()) return;
      const wasOpen = d.open;
      if (!wasOpen) { d.open = true; await sleep(250); }
      if (!active()) return;
      await walk(d, depth + 1);
      if (!active()) return;
      if (!wasOpen) { d.open = false; await sleep(80); }
    }
  };
  await walk(document.body, 0);
  if (!active()) return;
  await flush();
  if (!active()) return;
  rec('B', 'фарм', `база ресурсов: прочитано строк ${n}${done.size ? `, всего в базе ${Object.keys(FARM?.res || {}).length}` : ''}`);
  await setRt({ farmScan: null, farmScanT: Date.now(), farmScanDone: null });
}
// раздел строки: «Ресурсы» / «Кейматы» / «Шмот с РБ» — по заголовку ближайшей верхней группы
function farmCatOf(row) {
  const heads = []; let d = row.closest('details');
  while (d) { heads.unshift((d.querySelector(':scope > summary')?.textContent || '').replace(/[—-]\s*\d+\s*$/, '').replace(/\s+/g, ' ').trim()); d = d.parentElement?.closest('details'); }
  return heads.filter(Boolean).join(' › ').slice(0, 80);
}
// 10.0.7 (игрок 13.10: «автофарм расходников на апгрейд… учитывать дроп и спойл»): база источников прямо из игры — GET /game/farm-guide
// (то же, что форум «Фарм ресурсов», но JSON: resources[] {itemId, nameEn, sources[] {mode drop|spoil, mobName, mobLevel, locationEn, teleportId,
// chanceMin/Max, qtyMin/Max}}). Со страницы форума бот читал только строки дропа — разметку спойл-строк он не видел ни разу (7.2), и спойл
// в базе был только счётчиком. Раз в сутки (или по кнопке): дроп и спойл 14 базовых ресурсов → FARM.res[имя].drop / .sp в формате farmRowParse
const FARM_GUIDE_URL = '/game/farm-guide', FARM_GUIDE_EVERY = 24 * 3600000;
let farmGuideBusy = false;
function farmGuideMerge(db, data) {
  const list = Array.isArray(data?.resources) ? data.resources : [];
  let n = 0, sp = 0, dr = 0;
  for (const r of list) {
    const name = String(r?.nameEn || '').trim(); if (!name || !Array.isArray(r.sources)) continue;
    const drop = [], spl = [];
    for (const x of r.sources) {
      const mob = String(x?.mobName || '').trim(), tp = String(x?.teleportId || '').trim();
      if (!mob || !tp) continue;
      const ch = Math.round(((+x.chanceMax || +x.chanceMin || 0) * 100) * 100) / 100, a = +x.qtyMin || 1, b = +x.qtyMax || a;
      (x.mode === 'spoil' ? spl : drop).push([mob, +x.mobLevel || 0, ch, a, b, tp, String(x.locationEn || '').trim()]);
    }
    const k = name.toLowerCase(), old = db.res[k] || {};
    db.res[k] = { ...old, name: old.name || name, id: +r.itemId || old.id || 0, drop, sp: spl, spoil: spl.length, bosses: old.bosses || [], cat: old.cat || 'Ресурсы',
      icon: old.icon || (typeof r.iconUrl === 'string' && /^\/(?:icons|game\/item-icon|assets)\//.test(r.iconUrl) ? r.iconUrl.slice(0, 200) : ''), t: Date.now(), api: 1 };
    n++; dr += drop.length; sp += spl.length;
  }
  return { n, dr, sp };
}
async function farmGuideSync(why = 'раз в сутки') {
  if (farmGuideBusy) return false;
  farmGuideBusy = true;
  try {
    const r = await gameGet(FARM_GUIDE_URL, 20000);
    if (!r.ok) { rec('B', 'фарм', `источники из игры (${why}): HTTP ${r.status} — пробую позже`); await setRt({ farmGuideT: Date.now() - FARM_GUIDE_EVERY + 3600000 }); return false; }
    const j = await r.json(), db = await farmDb(), m = farmGuideMerge(db, j);
    if (!m.n) { rec('B', 'фарм', `источники из игры (${why}): ответ без ресурсов`); await setRt({ farmGuideT: Date.now() - FARM_GUIDE_EVERY + 3600000 }); return false; }
    db.t = Date.now(); FARM = db;
    await chrome.storage.local.set({ farmDb: db });
    await setRt({ farmGuideT: Date.now(), farmN: Object.keys(db.res).length, farmGuideReq: null });
    rec('B', 'фарм', `источники из игры (${why}): ресурсов ${m.n}, источников дропа ${m.dr}, спойла ${m.sp}${+j?.resourceTeleportAdenaCost ? ` · телепорт к точке ${(+j.resourceTeleportAdenaCost).toLocaleString('ru')} адены` : ''}`);
    return true;
  } catch (e) { rec('B', 'фарм', `источники из игры (${why}): ${String(e?.message || e).slice(0, 80)}`); await setRt({ farmGuideT: Date.now() - FARM_GUIDE_EVERY + 3600000 }); return false; }
  finally { farmGuideBusy = false; }
}
function farmGuideTick() {                        // фоном, только GET; нужна цели Маммона, цели «Фарм ресурса» и помощнику основного
  if (rt.farmGuideReq) { farmGuideSync('по кнопке').catch(() => {}); return; }
  if (cfg.mmFarmGuide === false || !(cfg.mmGoalItem || (cfg.farmRes || '').trim() || (cfg.subMainNick || '').trim())) return;
  if (Date.now() - (rt.farmGuideT || 0) < FARM_GUIDE_EVERY) return;
  farmGuideSync().catch(() => {});
}
// цель фарма: из меню (ресурс + сколько) или ресурс главы кампании («Нужно сдать: Stone of Purity 48/50»)
function farmGoal() {
  if (campEnabled()) {
    const t = campOpen().find(x => x.res && FARM?.res?.[x.name.toLowerCase()]);
    if (t) return { key: t.name.toLowerCase(), name: t.name, left: t.total - t.done, why: 'глава кампании' };
  }
  // 9.0 (игрок 11.10: «копить на определённую задачу и последовательно идти её делать»): цель «Маммон» — недостающий материал
  // улучшения у кузнеца (по одному, по порядку списка цены). Ресурс, выбранный в «Фарм ресурса», главнее
  if (L2EngineCore.taskAllowed(cfg,'resources') && !(cfg.farmRes || '').trim() && cfg.mmGoalItem) { const m = L2V7Modules.mammon.mmFarmGoal(); if (m) return m; }
  // 7.2.1 (игрок: «на точку квеста летаю сам и квесты выполняю сам»): «Квесты на ресурсы» — только счётчик, бот к источнику не летит
  const k = (cfg.farmRes || '').trim().toLowerCase();
  if (k && FARM?.res?.[k]) {
    const got = rt.farmGot?.[k] || 0, need = cfg.farmNeed || 0;
    if (!need || got < need) return { key: k, name: FARM.res[k].name, left: need ? need - got : Infinity, why: 'из меню' };
  }
  // 10.0.7 (заготовка под саб спойлера): этот персонаж — помощник основного (cfg.subMainNick): добывает сырьё, которого не хватает
  // цели Маммона основного (запись subNeed в хранилище от вкладки основного), точка — по всем недостающим сразу
  if (!k && !cfg.mmGoalItem) { const h = L2V7Modules.subclass?.helpGoal?.(); if (h) return h; }
  return null;
}
// зоны-источники: «шт. за бой» = средний (шанс × среднее кол-во) по мобам зоны в окне уровня;
// оценка = это × близость уровня (свой ±3 — лучше: и опыт, и бой быстрый) × (1 + 0,1 за каждый вид моба, до 5 — проще найти цель)
// 7.2: sp — источники спойла (тот же формат) с множителем spK (успех спойла); с одного моба дроп и спойл складываются
// 7.2.1 (игрок 10.10: «чтобы старался выбирать −3…+5 ур. от героя, но с возможностью коррекции»): предпочтительный диапазон уровней
// мобов-источников — cfg.farmLvlBelow / farmLvlAbove (меню «Фарм ресурса»). Точки, где есть источники в диапазоне, — в первую очередь
// (inWin), среди них — по шансу; нет таких — лучшая из остальных, чем дальше уровень от диапазона, тем ниже оценка
const farmWin = L => ({ lo: L - (cfg.farmLvlBelow ?? 5), hi: L + (cfg.farmLvlAbove ?? 5) });
function farmFit(l, L) {
  const w = farmWin(L);
  return l >= w.lo && l <= w.hi ? 1 : l < w.lo ? Math.max(0.15, 1 - (w.lo - l) * 0.12) : Math.max(0.1, 1 - (l - w.hi) * 0.18);
}
function farmZones(drop, L, above, sp = [], spK = 0.8, accept = () => true) {
  const fit = l => farmFit(l, L), w = farmWin(L);
  const by = {};
  for (const [src, k] of [[drop, 1], [sp, spK]]) for (const [mob, lvl, ch, a, b, tp, loc] of src || []) {
    if (!accept(mob)) continue; // 10.0.22: план и боевой выбор должны учитывать одни запреты.
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
// 7.2: спойлер (есть спойл на панели / гном) — считаем и спойл. Шанс пометить моба — по замеру (rt.spoilStat ok/fail за нажатие,
// до 3 попыток на моба: 1 − (1 − p)³), без замера 80 %. 10.0.7: вынесено — точку «по всем материалам» считает modules/mammon.js
function spoilK() {
  const st = rt.spoilStat || {}, tries = (st.ok || 0) + (st.fail || 0);
  return tries >= 10 ? Math.max(0.2, 1 - Math.pow(1 - (st.ok || 0) / tries, 3)) : 0.8;
}
function farmPick(goal) {
  if (goal?.pick?.tp) return goal.pick;           // 10.0.7: точка уже выбрана по всем недостающим материалам цели (mammon.mmFarmGoal)
  const r = FARM?.res?.[goal.key], L = heroLvl();
  if (!r || !L) return null;
  const spK = spoilK();
  const zones = farmZones(r.drop, L, cfg.lvlAbove ?? 6, canSpoil() ? r.sp || [] : [], spK, n => !hardNow(n));
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
    // 10.0 (аудит фарма): подходящего РБ не было (farmWhy) — список ≈14 страниц перечитываем раз в 60 мин, а не в 20
    if (!Object.keys(rt.rbList || {}).length || Date.now() - (rt.rbListT || 0) > (rt.farmWhy === 'rb:' + g.key ? 60 : 20) * 60000) {
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
  (L2V7Modules.actions?.canAct?.() !== false && (location.href = FARM_URL)); await sleep(4000);
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
  (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/teleport.html')); await sleep(4000);
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
async function townBuffStart(...args) { if (Array.isArray(cfg.autoTasks) && ['tasks','fish','enchant'].includes(L2EngineCore.selectedTask(cfg,rt))) return false; return L2V7Modules.buffs.townBuffStart(...args); }
async function townBuffStep(...args) { return L2V7Modules.buffs.townBuffStep(...args); }

async function rest(...args) { return L2V7Modules.resources.rest(...args); }
// 8.0.3 (лог 11.10 10:13:25 «РБ HP 704k ≈6:60», 09:59:54 «до опасного HP ≈-1:-1»): секунды округлялись отдельно от минут (419,6 с →
// «6:60»), отрицательное не обрезалось. Теперь сначала округляем всё время, меньше нуля — «0:00» (уже)
const fmtT = sec => { if (!isFinite(sec)) return '∞'; const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// перейти на страницу спавна и кликнуть его строку (через обработчик карты)
async function attackSpawn(...args) { return L2V7Modules.mobfarm.attackSpawn(...args); }

async function map(...args) {
  if (Array.isArray(cfg.autoTasks) && ((L2EngineCore.selectedTask(cfg,rt) === 'quests' && !campOn()) || (!['farm','auto','quests'].includes(L2EngineCore.selectedTask(cfg,rt)) && !(L2EngineCore.taskAllowed(cfg,'resources') && lootGoal())))) return tasksIdle();
  return L2V7Modules.mobfarm.map(...args);
}

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
function extraKillsInLog(L = logLines()) {       // [{ name, exp, sp, adena, items }] — сверху вниз (новые первыми)
  const out = [];
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
const campEnabled = (...args) => cfg.enchantMode !== true && L2V7Modules.quests.campEnabled(...args);   // 10.0.10: кампания из меню или авто по сюжетному квесту новичка
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
const campOn = (...args) => (!Array.isArray(cfg.autoTasks) || L2EngineCore.selectedTask(cfg,rt) === 'quests') && L2V7Modules.quests.campOn(...args);
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
  // 10.0.13: выбранная удочка бывает за материалами на другой странице. Другую вместо неё не точим.
  const turn = next => L2V7Modules.fishing.fishBagPage(next);
  for (let i = 0; i < 40 && on && tabOwner && await turn(false); i++) {}
  await waitFor(() => document.querySelectorAll('.l2-char-bag-row').length, 5000, 200);
  let row = null;
  for (let page = 0; page < 40 && on && tabOwner; page++) {
    const rows = rodRows();
    row = selName ? rows.find(r => { const n = (r.querySelector('.l2-char-bag-name')?.textContent || '').toLowerCase(); const e = +(n.match(/\+(\d+)/) || [])[1] || +itemJson(r).enchant || 0; return n.includes(selName) && e === selEnch; }) : rows[0];
    if (row || !await turn(true)) break;
  }
  if (!on || !tabOwner) return;
  const finish = async (why, next = null) => {
    if (!on || !tabOwner) return;
    if (why) rec('B','удочка',why);
    fire($q('#char-bag-modal-close')); await sleep(200);
    if (!on || !tabOwner) return;
    await setRt({ fishService: next, rodGoalWaitingProof: !!rt.rodGoalActive && !next });
    await rtCommit();                              // 8.0: без этого новая страница видела старое fishService:'rod' (круги fishing ↔ char)
    if (!on || !tabOwner) return;                  // 14.10: Stop/смена вкладки во время записи отменяет следующий переход.
    if (next === 'exchange') { (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/fishing-shop.html')); await sleep(3500); return; }
    if (next === 'rod') { (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/char.html')); await sleep(3500); return; }
    if (await fishSvcDone(why)) return;
    if (on && tabOwner) { await rtCommit(); if (!on || !tabOwner) return; (L2V7Modules.actions?.canAct?.() !== false && (location.href = fishNow() ? '/fishing.html' : '/map.html')); await sleep(3500); }
  };
  if (!row) return finish('выбранной удочки в сумке не найдено: никаких покупок');
  const item = itemJson(row);
  fire(row.querySelector('.l2-char-bag-icon--stats') || row);
  const lvlNow = () => rodLvlOf($q('#char-bag-modal-title')?.textContent) ?? rodLvlOf(row.textContent)
    ?? (Number.isInteger(item.enchant) ? item.enchant : null);
  if (!(await waitFor(() => shown($q('#char-bag-modal-rod-enchant-row')), 4000, 100))) {
    return finish('окно заточки недоступно (возможно, рыба ещё на крючке)');
  }
  if (!on || !tabOwner) return;
  let lvl = lvlNow();
  if (lvl == null || lvl < 0 || lvl > 10) return finish('реальный уровень заточки неизвестен, покупку отменяю');
  await setRt({ rodLvl: lvl });
  if (!on || !tabOwner) return;
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
  // Следующий свиток ищет ту же удочку уже с новым уровнем, а не устаревшее имя до заточки.
  const rodName = String(rt.fishRodName || row.querySelector('.l2-char-bag-name')?.textContent || '').replace(/\s*(?:\+\d+)?\s*(?:Шанс.*)?$/i, '').trim();
  await setRt({rodLvl:lvl, ...(rodName ? { fishRodName: rodName + (lvl ? ' +' + lvl : '') } : {})});
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
const heroNick = () => { const nick = (($q('#l2-hud-legacy-name .l2-player-identity__nick')?.childNodes[0]?.textContent)
  || $q('#l2-hud-legacy-name')?.textContent || '').trim();
  // 14.10: common.js сначала выводит «—». Это ещё не персонаж: иначе загрузка HUD восстанавливает чужой сохранённый режим.
  return /^[\s.\-–—…]*$/.test(nick) ? '' : nick; };
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
const heroLevel = () => heroLvl();   // 10.0.10: один источник с запасом (см. heroLvl)
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
async function invScanDrive(...args) { if (!on && !rt.invScan?.manual) return; return L2V7Modules.equipment.invScanDrive(...args); }
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
var TVT = null, TVTC = null, TVTS = null;           // последние ответы /game/tvt и /game/tvt/combat/sync (+ время получения); 10.0.11: TVTS — /game/tvt/skills
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
const epicOn = (...args) => cfg.enchantMode !== true && L2V7Modules.epics.epicOn(...args);
// 10.0: «без режима» — между задачами стоим (не реже раза в 2 с проверяем, не появилось ли дело)
async function tasksIdle() {
  const why = [cfg.mmOrders && 'заказ Маммона', cfg.mmUpgrade && cfg.mmGoalItem && 'кузнец', cfg.mmCraftSend && cfg.mmGoalItem && 'крафтер', cfg.mmMailClaim && 'почта',
    cfg.storyTurnIn && 'квесты', cfg.tvtOn && 'TvT', (cfg.farmRes || '').trim() && `цель фарма «${cfg.farmRes.trim()}»`, (cfg.recipeRes || '').trim() && `рецепт «${cfg.recipeRes.trim()}»`].filter(Boolean);
  setStatus(`⏹ Без режима — только задачи${why.length ? ': ' + why.join(', ') : ' (ни одна не включена)'}; сейчас дел нет, стою`);
  if (Date.now() - (window.__tasksIdleT || 0) > 30 * 60000) { window.__tasksIdleT = Date.now(); rec('S', 'режим', `без режима: жду задачи (${why.join(', ') || 'ни одна не включена'}) — мобов не бью`); }
  await sleep(2000);
}
// 10.0.5 (лог 12.10 01:30, игрок: «почему в режиме „только задачи“ автофармит мобов?»): цель фарма ресурса/рецепта — тоже задача, и бот
// бьёт мобов на её точке. Раньше журнал писал «мобов не бью», а бот летел за Oriharukon Ore — теперь говорит прямо, что фармит и как снять
function tasksGoalNote(g) {
  const k = g.kind + ':' + g.name;
  if (window.__tasksGoalK === k && Date.now() - (window.__tasksGoalT || 0) < 30 * 60000) return;
  window.__tasksGoalK = k; window.__tasksGoalT = Date.now();
  rec('S', 'режим', `только задачи: цель ${g.kind === 'farm' ? 'фарма' : 'охоты на рецепт'} «${g.name}» — бью мобов-источники на её точке (снимите ✓ у «${g.name}» в «${g.kind === 'farm' ? 'Фарм ресурсов' : 'Охота на рецепты'}», чтобы бот не бил мобов)`);
}
const autonomyMode = () => L2EngineCore.selectedTask(cfg, rt) === 'quests' ? 'campaign' : L2EngineCore.selectedTask(cfg, rt) === 'auto' ? 'farm' : L2EngineCore.selectedTask(cfg, rt) || L2EngineCore.chooseMode({
  enchant: cfg.enchantMode === true, epic: epicOn(), raid: huntOn(), fish: !!cfg.fishMode,
  cat: !!cfg.catMode, campaign: campEnabled(), tasks: !!cfg.taskOnly
});
// 15.10: диагностика меняется вместе с выбором/задачей, а не на каждом тике.
function taskPolicyNote(active = autonomyMode()) {
  if (!Array.isArray(cfg.autoTasks) || !tabOwner) return;
  const labels = {tvt:'TvT',quests:'квесты',campaign:'квесты',fish:'рыбалка',cat:'катакомбы',raid:'тур РБ',epic:'эпики',farm:'фарм',auto:'автофарм',enchant:'заточка',mammon:'Маммон',dailies:'дейлики',clan:'клан',pvp:'враги',petbuff:'автобаф суммона',resources:'ресурсы',tasks:'ожидание'};
  const selected = L2EngineCore.taskList(cfg), key = JSON.stringify([selected,active]), now = Date.now();
  const previous = window.__taskPolicyNote;
  if (previous?.key === key || previous && now - previous.at < 5000) return;
  window.__taskPolicyNote = {key,at:now};
  rec('S','авторежим', `разрешены: ${selected.map(k=>labels[k]).join(', ') || 'нет'}; сейчас: ${labels[active] || active}; другие задачи запрещены`);
}
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
  if (rt.abChal) return 'check';                   // 10.0.2: проверка выдана сервером, а окна на странице нет (перезагрузка, другая страница) — всё равно ждём
  return null;
}
// 10.0.2 (скрин админки игры 12.10 13:22: «CAPTCHA активна · підозрілих спроб після неї: 0/10»; у другого игрока 10 попыток → «Фарм
// заблоковано»). Как устроено у игры (battle-antibot.js): ответ боя с code «anti_bot_challenge» включает проверку; пока она активна,
// ЛЮБОЙ клик по странице мимо кнопок символов уходит на сервер (POST /game/antibot/activity) как «подозрительная попытка», 10 — блок.
// Окно проверки живёт только в памяти страницы: после перезагрузки или перехода его нет, а проверка на сервере висит. Поэтому:
// выдачу проверки запоминаем по ответу сервера (rt.abChal — переживает перезагрузку), снимаем только по «passed» / «not_found» / блоку
// фарма или когда игрок сам жмёт ▶ (включает бота / снимает паузу). Пока проверка висит — ни одного клика бота (fire) и ни одного
// своего запроса к игре (fetch ниже)
function abNet(path, res) {
  const code = String(res?.code || res?.error || '');
  if (code === 'anti_bot_challenge') {
    if (!rt.abChal) rec('B', 'антибот', `сервер выдал «Проверку активности» (${path}) — бот замер: ни кликов, ни запросов, пока вы её не решите`);
    if (!rt.abChal || Date.now() - (rt.abChal.t || 0) > 60000) setRt({ abChal: { t: Date.now(), id: String(res?.challenge?.id || '').slice(0, 40) } });
    return;
  }
  if (!rt.abChal) return;
  if (path === '/game/antibot/challenge' && res?.passed === true || code === 'antibot_challenge_not_found' || code === 'pve_farm_blocked') setRt({ abChal: null });
}
const abHold = () => !!rt.abChal || !!abLayer()?.querySelector('.l2-antibot-card__options');
// свои запросы бота к игре (content.gameGet/gamePost/srvUp, epics, raid, mammon…) идут через fetch этого мира — один затвор на всех
const fetch0 = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
if (fetch0) window.fetch = async function (u, o) {
  const s = typeof u === 'string' ? u : u?.url || '';
  if (!/^(chrome|moz)-extension:/.test(s) && abHold()) return new Response(JSON.stringify({ error: 'l2bot_antibot_wait' }), { status: 423, headers: { 'content-type': 'application/json' } });
  const r = await fetch0(u, o);
  if (r.status === 423) r.clone().json().then(j => abNet(new URL(s, location.href).pathname, j)).catch(() => {});
  return r;
};
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
    // 10.0.2: окна на странице нет (перезагрузка/другая страница), а сервер проверку не снимал — игра покажет её снова на первом ходе боя
    setStatus(abLayer() ? `⚠ КАПЧА: решите проверку в окне игры — бот ждёт вас (${waited} с) и ничего не нажимает`
      : `⚠ КАПЧА ждёт (${waited} с): откройте бой и сделайте ход сами — игра покажет символы; решили — бот продолжит сам (или нажмите ▶)`);
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
let lockMine = 0, documentLease = null;
async function tabLock() {
  await TAB_KEY_READY;
  const r = await ipc({ cmd: 'lockAcquire', epoch: leaseEpoch || documentLease, page: location.pathname,
    vis: tabVis(), focus: !!document.hasFocus?.() });
  tabOwner = r?.ok === true; tabIdle = !tabOwner; leaseEpoch = tabOwner ? r.epoch : null;
  if (tabOwner) { lockMine = Date.now(); documentLease = leaseEpoch; }
  return tabOwner;
}
setInterval(async () => {
  try {
    if (tabOwner && on) {
      const r = await ipc({ cmd: 'lockRenew', epoch: leaseEpoch, page: location.pathname, vis: tabVis() }, 9000);
      if (!r?.ok) { tabOwner = false; tabIdle = true; leaseEpoch = null; rtWriter.clear(); window.__lockT = 0; return; }
      lockMine = Date.now();
    }
    else if (tabOwner && !on && !enchantCommandBusy && !warlockCommandBusy) { try { await rtWriter.recover(); } catch (e) {} tabOwner = false; tabIdle = false; rtWriter.clear(); /* 7.1.30: дописать счётчики последнего боя */ await chrome.runtime.sendMessage({ cmd: 'lockRelease', epoch: leaseEpoch }); leaseEpoch = null; }
    else if (!on) tabIdle = false;
  } catch (e) {}
}, 5000);
// замок при уходе со страницы не снимаем: следующая страница этой же вкладки продолжит с тем же ключом; закрытую вкладку отпустит таймаут 90 с

// 10.0.2: замеры по РБ из лога 12.10 22:11–22:46 (Warlock 65 + Kai): ДПС в бою, спецудар, обычный удар p90 / макс.
const RB_FIT_1002 = {
  l2dop_rb_25234: { name: 'Ancient Weird Drake', lvl: 60, dps: 4837, sp: 2623, hitP90: 539, maxHit: 539 },
  l2dop_rb_29056: { name: 'Ice Fairy Sirra', lvl: 60, dps: 5179, sp: 2954, hitP90: 221, maxHit: 221 },
  l2dop_rb_25140: { name: 'Hekaton Prime', lvl: 65, dps: 3421, sp: 2770, hitP90: 605, maxHit: 646 },
  l2dop_rb_25051: { name: 'Rahha', lvl: 65, dps: 4337, sp: 2770, hitP90: 635, maxHit: 648 },
  l2dop_rb_25220: { name: 'Death Lord Hallate', lvl: 73, dps: 2465, sp: 2640, hitP90: 845, maxHit: 874 },
  l2dop_rb_25126: { name: 'Longhorn Golkonda', lvl: 79, dps: 2397, sp: 2396, hitP90: 675, maxHit: 730 },
};
// 10.0.2 (лог 12.10 22:35:26–22:35:45, Death Lord Hallate): «пытаюсь выйти» → страница ушла на карту, но POST /game/battle/leave так и не
// пришёл (сервер отвечал по 8 с) — бой на сервере шёл дальше, герой «на карте» стоял под ударами и погиб, а бот выбирал моба
// (battle/start → 400 pve_defeat_pending). Перед нажатием выхода — метка (sessionStorage), ответ 2xx на leave её снимает; не снята через 2 с
// на карте — бой не закончен: обратно на страницу боя (один раз), там бой/банки/аварийный выход как обычно. Остались в бою (выход не сработал) — метку
// снимает сам бой (leaveMark(null))
function leaveMark(id, name) { try { if (!id) { sessionStorage.removeItem('l2bot.leavePend'); return; } sessionStorage.setItem('l2bot.leavePend', JSON.stringify({ id, name: name || id, at: Date.now() })); sessionStorage.removeItem('l2bot.leaveOk'); } catch (e) {} }
function leaveOk(id) { try { sessionStorage.setItem('l2bot.leaveOk', JSON.stringify({ id: id || '', at: Date.now() })); } catch (e) {} }
function leavePending(now = Date.now()) {
  let p = null, ok = null; try { p = JSON.parse(sessionStorage.getItem('l2bot.leavePend') || 'null'); ok = JSON.parse(sessionStorage.getItem('l2bot.leaveOk') || 'null'); } catch (e) {}
  if (!p?.id || now - (p.at || 0) > 60000) return null;
  if (ok && ok.at >= p.at && (!ok.id || ok.id === p.id)) return null;
  return now - p.at >= 2000 ? p : null;
}
async function leaveCheck() {
  const p = leavePending(); if (!p) return false;
  try { sessionStorage.removeItem('l2bot.leavePend'); } catch (e) {}
  rec('B', 'РБ', `${p.name}: выход из боя сервер не подтвердил (нет ответа на «Назад на карту») — бой, скорее всего, идёт, возвращаюсь в бой`);
  (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/battle.html?spawnId=' + encodeURIComponent(p.id))); await sleep(4000);
  return true;
}
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
          // 10.0 (аудит ядра): накопленное, пока вкладка ждала замок, — устаревшее (хозяином была другая вкладка); очередь чистим
          rtWriter.clear();
          const fresh = await chrome.storage.local.get(['rt', 'cfg']);
          rt = { ...DEF_RT, ...(fresh.rt || {}) }; cfg = mergeCfg(fresh.cfg);
        }
      }
      // Migrations calculated during page initialization must not write without a lease.
      // Apply to the saved current character before switching to a new one.
      // 8.0.3 (проверка правки): устаревание пакета настроек — ДО записи rt и только по свежим настройкам: раньше проверка видела
      // флаг, который эта же вкладка строкой выше записала в rt, и выбрасывала ещё не применённые правки настроек
      const cfgStale = Object.keys(deferredMigrations.cfg).length > 0 && migApplied(deferredMigrations.cfg, L2EngineCore.rawTaskConfig(cfg));
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
      L2V7Modules.actions?.enterFrame();
      // До сервисов/рейда: ACK не воскрешает, HP > 0 при pvp_defeat_pending не разрешает продолжение.
      if (await L2V7Modules.pvp.recoveryStep()) { await sleep(200); continue; }
      await enchantModePause();
      if (rt.enchant?.pending) await enchantAccounting();
      if (!servicesStarted) {
        servicesStarted = true;
        // Справочник предметов — только при работе с сумкой, добычей и оружием.
        // Ресурсы и рецепты подгружаем лишь при активном задании (нужны для приоритетов карты).
        if (cfg.farmRes || cfg.resQuests || campEnabled() || cfg.mmGoalItem) farmDb().catch(() => {});
        if (cfg.recipeRes) recipeDb().catch(() => {});
        try { learnSkillDb(); } catch (e) {}
      }
      // A heartbeat alone cannot detect a live but endlessly looping dispatcher.
      // Check observable progress; exclude intentional maintenance/long waits.
      const activeJob = (autonomyMode() !== 'enchant' || isBattle() || !!rt.shop?.urgent || (isFishing() && fishState())) && (isBattle() || !!rt.shop || !!rt.rbGo || !!rt.zoneGo || !!rt.mmJob ||
        !!rt.tbuff || (!!rt.epic && !['pick', 'prep'].includes(rt.epic.step)) ||
        !!rt.invScan || fishNow());
      // 10.0 (аудит ядра): капча / блок PvE-фарма на странице боя — ждём человека, это не «нет прогресса» (раньше 3 перезагрузки и стоп через ≈36 мин)
      const abWait = !!antibotState() || (rt.pveBlockUntil || 0) > Date.now();
      const sig = [location.pathname, location.search, rt.kills, rt.rbKills,
        rt.fish?.casts || 0, rt.fish?.caught || 0, rt.epic?.step || '',
        rt.rbHunt?.step || '', rt.shop?.step || '', rt.tbuff?.step || '',
        meHp()?.cur ?? '', mobHp()?.cur ?? ''].join('|');
      if (progressMonitor.tick(sig, activeJob && !abWait) === 'stalled' && !serverDown()) {
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
      if (isMap() && await leaveCheck()) continue;   // 10.0.2: выход из боя с РБ сервер не подтвердил — бой ещё идёт, назад в бой
      if (cfg.tvtOn && await tvtStep()) { taskPolicyNote('tvt'); await sleep(200); continue; }   // 10.0.11 (игрок 13.10: «TvT важнее»): раньше паузы «один РБ» и всех задач; работает и из PvE-боя
      // 15.10: сохранённые маршруты не обходят новый список задач; квитанции оплат не удаляем.
      if (Array.isArray(cfg.autoTasks)) {
        taskPolicyNote();
        const blocked = {};
        for (const key of ['tbuff','petBufferTrip','shop','magister','invScan','mmJob','storyJob','tsJob','rbGo','rbHunt','zoneGo','bagCheck','faScan','recipeScan','farmScan','rbScan','zoneScan','fishSvc','fishService','dailyFish','dailyRb'])
          if (rt[key] && !L2EngineCore.taskJobAllowed(cfg,key,rt)) blocked[key] = null;
        if (Object.keys(blocked).length) { if(blocked.tbuff===null)blocked.tbInterrupted={t:Date.now(),jobT:rt.tbuff.t}; await setRt(blocked); rec('S','авторежим', 'отменены несовместимые маршруты: ' + Object.keys(blocked).join(', ') + '; квитанции оплат сохранены'); continue; }
        if (autonomyMode() === 'tasks' && !L2EngineCore.taskList(cfg).some(k => ['mammon','quests','dailies','clan','pvp','petbuff','resources'].includes(k))) {
          if (L2V7Modules.actions && await L2V7Modules.actions.dispatch()) { await sleep(200); continue; }
          if (isBattle()) await battle();
          else if (isFishing() && fishState()) await fishFight();
          else await tasksIdle();
          continue;
        }
      }
      // 15.10: заточка — отдельный режим. Доводим текущий бой/улов, затем ждём выбранную серию.
      if (autonomyMode() === 'enchant') {
        if (L2V7Modules.actions && (rt.actionOwner || L2V7Modules.actions.hasPending()) && await L2V7Modules.actions.dispatch()) { await sleep(200); continue; }
        if (await antibotGuard()) continue;
        if (!on || !tabOwner || autonomyMode() !== 'enchant') continue;
        if (rt.shop?.urgent && Date.now() - (rt.shop.t || 0) < 300000) await shopStep();
        else if (isBattle()) await battle();
        else if (isFishing() && fishState()) await fishFight();
        else if (cfg.tvtOn && L2V7Modules.tvt.tvtHold()) await L2V7Modules.tvt.tvtWait();
        else await enchantDispatch();
        await sleep(200); continue;
      }
      if (L2EngineCore.taskAllowed(cfg,'pvp')) await L2V7Modules.pvp.seedConfirmed();
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (L2EngineCore.taskAllowed(cfg,'pvp') && await L2V7Modules.pvp.step()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (!isBattle() && await L2V7Modules.raid.rbOneStep()) { await sleep(200); continue; }   // 10.0.2 (лог 01:00): «один РБ» убит — пауза раньше сторожа баффов и магазина
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      // 9.2 (игрок 11.10: «Лист врагов»): убийцы героя — в лист; враг на локации — нападаем кнопкой игры (с проверкой сил), следим за возвращением
      if (L2EngineCore.taskAllowed(cfg,'pvp')) L2V7Modules.enemies.tick().catch(() => {});
      // 15.10: фоновая слежка РБ отключена; таймеры импортируются, цели читает активный тур.
      if (L2EngineCore.taskAllowed(cfg,'pvp') && await L2V7Modules.enemies.step()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      // 10.0.11 (игрок 13.10 22:00: «команды других задач подавляют TvT»): окно TvT (записаны, до старта < tvtHoldMin мин или бой идёт) —
      // закупку, магистра, баффы, Маммона, квесты, дейлики, туры и телепорты не начинаем; бой с мобом и заброс рыбалки доводим,
      // «🛒 Закупить сейчас» (urgent) — как и раньше. На арену уводит tvtStep выше (за минуту до старта)
      if (cfg.tvtOn && !isBattle() && !rt.shop?.urgent && !(fishNow() && isFishing() && fishState()) && L2V7Modules.tvt.tvtHold()) { taskPolicyNote('tvt'); await L2V7Modules.tvt.tvtWait(); continue; }
      if (await antibotGuard()) continue;           // v5.5.6: блок PvE-фарма — ждём (PvP/TvT выше — можно)   // ⚔ v5.4: TvT — запись, бой, итог   // после смерти: поражение → «Вернуться в город» → статуя → бафф → восстановление
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (!isBattle() && !(isFishing() && fishState()) && !await inventoryReady()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      // 10.0.24: сохранённый маршрут завершаем прежде запуска другого сервиса.
      if (L2V7Modules.actions && await L2V7Modules.actions.dispatch()) { await sleep(200); continue; }
      // «🛒 Закупить сейчас» (urgent) — сразу, даже со страницы боя: бросаем моба/РБ/рыбалку
      if (rt.shop && (!isBattle() || rt.shop.urgent) && Date.now() - (rt.shop.t || 0) < 300000) { await shopStep(); await sleep(300); continue; }
      if (rt.shop && !isBattle()) await setRt({ shop: null });
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      // 14.10: проверка доступных рангов сразу при включении и после каждого +1 уровня.
      await magisterDisable();
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (rt.magister && !isBattle()) { await magisterStep(); continue; }
      if (await magisterStart()) continue;
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (rt.tbuff && !isBattle() && Date.now() - (rt.tbuff.t || 0) < 120000) { await townBuffStep(); continue; }
      if (rt.tbuff && !isBattle()) await setRt({ tbuff: null });
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (rt.bagCheck && !isBattle()) {              // «Пересчитать в сумке» (квесты на ресурсы)
        if (!isChar()) { (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/char.html')); await sleep(4000); continue; }
        setStatus('Квесты на ресурсы: считаю сумку'); await bagCounts(); await setRt({ bagCheck: null });
        (L2V7Modules.actions?.canAct?.() !== false && (location.href = fishNow() ? '/fishing.html' : '/map.html')); await sleep(4000); continue;
      }
      if (rt.faScan && !isBattle()) {              // «Обновить список баффов FA» из меню
        if (!/\/fast-aden-buffer\.html/.test(location.pathname)) { setStatus('Баффы FA: читаю список у баффера'); (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/fast-aden-buffer.html')); await sleep(4000); continue; }
        await waitX(() => $q('.l2-fa-buy[data-skill-id]'), 8000, 200); await waitX(() => /\d/.test($q('#fast-aden-balance')?.textContent || ''), 3000, 200);
        const n = faCatalogNote(); rec('B', 'бафф', `Fast Aden: в списке баффера ${n || 0}, баланс ${rt.faBal?.v ?? '?'} FA`);
        await setRt({ faScan: null }); (L2V7Modules.actions?.canAct?.() !== false && (location.href = fishNow() ? '/fishing.html' : '/map.html')); await sleep(4000); continue;
      }
      if (rt.recipeScan && !isBattle()) {          // «Обновить базу рецептов» из меню
        if (location.pathname !== RECIPE_URL) { setStatus('Рецепты: читаю «Охоту на рецепты» на форуме'); (L2V7Modules.actions?.canAct?.() !== false && (location.href = RECIPE_URL)); await sleep(4000); continue; }
        await waitX(() => $q('article.l2-recipe-hunt-recipe'), 12000, 300);
        await recipeSave(); await setRt({ recipeScan: null }); (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/map.html')); await sleep(4000); continue;
      }
      if (rt.farmScan && !isBattle()) { if (isFarmPage()) await farmScan(); else { (L2V7Modules.actions?.canAct?.() !== false && (location.href = FARM_URL)); await sleep(4000); } continue; }
      if (rt.rbScan && !isBattle()) { if (isRbPage()) await rbListScan(); else { (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/rb-bosses.html')); await sleep(4000); } continue; }
      // 8.0.3 (эпики): «🔄 Проверить эпиков (бесплатно)» — в любом режиме, только чтение с сервера (список + цифры боссов), без переходов.
      // На рыбалке и на странице боя — фоном, не останавливая вываживание и бой (≈6–10 с запросов с паузами). 8.0.3 (ревью): раньше в бою
      // ждали ухода со страницы боя, а цепочка «Охотиться дальше» с неё не уходит — «⏳ проверка запрошена» висела часами
      if (rt.epicScanReq) { if (fishNow() || isBattle()) L2V7Modules.epics.epicScanAll('по кнопке').catch(() => {}); else { await L2V7Modules.epics.epicScanAll('по кнопке'); continue; } }
      if (rt.rbGo && !isBattle()) {
        // Legacy rbBetween jobs must not spend a teleport after the add-on is retired.
        // An explicit resource-boss job still owns its matching destination.
        if (!huntOn() && !(farmRbOn() && rt.rbGo.id === rt.farmRb?.id)) { await setRt({ rbGo: null, rbWant: null, rbPending: false }); continue; }
        if (Date.now() - (rt.rbGo.t || 0) < 90000) { await rbGoStep(); continue; }
        await setRt({ rbGo: null });
      }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (rt.zoneScan && !isBattle()) { if (isTeleport()) await zoneCatalogScan(); else { (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/teleport.html')); await sleep(4000); } continue; }
      if (rt.zoneGo && !isBattle()) {
        if (rt.zoneGo.id === 'ashen_bastion' && rt.zoneGo.returnPath === '/ashen-bastion.html') { await zoneGoStep(); continue; }
        if (rt.zoneGo.forumTp) { await zoneGoStep(); continue; } // Не терять незавершённую оплату по таймауту маршрута.
        const onSrc = isTeleport() || (rt.zoneGo.url && location.pathname + location.search === rt.zoneGo.url);
        if (Date.now() - (rt.zoneGo.t || 0) < 120000 && (onSrc || !rt.zoneGoT || Date.now() - rt.zoneGoT > 120000)) { await zoneGoStep(); continue; }
        await setRt({ zoneGo: null });              // уже нажали «Телепорт» и страница сменилась — улетели, дальше обычная охота
      }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      // v5.5: сторож баффов — в любом режиме вне боя (раньше проверка была только после победы и на карте)
      if (!isBattle() && !fishNow() && !tvtSoon() && !/tvt/i.test(location.pathname) && Date.now() - (rt.tbWatchT || 0) > 15000) { rt.tbWatchT = Date.now(); setRt({ tbWatchT: rt.tbWatchT }); if (await townBuffStart('сторож: баффы слетели')) continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      // «🔪 Разделать всю рыбу → Proof» из меню — сразу, в любом режиме (бой с мобом и вываживание рыбы — доводим до конца)
      if (rt.fishSvc && !isBattle() && !(isFishing() && fishState())) {
        if (Date.now() - (rt.fishSvc.t || 0) > 15 * 60000) { await setRt({ fishSvc: null, fishService: null }); continue; }
        const svc = rt.fishService || 'cut';
        if (svc === 'cut') { if (isChar()) await fishCut(); else { setStatus('Разделка рыбы: иду в инвентарь'); await rtCommit(); if (!on || !tabOwner || !rt.fishSvc || (rt.fishService || 'cut') !== svc) continue; (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/char.html')); await sleep(4000); } }
        else if (svc === 'exchange') { if (isFishShop()) await fishExchange(); else { await rtCommit(); if (!on || !tabOwner || !rt.fishSvc || (rt.fishService || 'cut') !== svc) continue; (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/fishing-shop.html')); await sleep(4000); } }
        else if (svc === 'rod') { if (isChar()) await rodEnchant(); else { await rtCommit(); if (!on || !tabOwner || !rt.fishSvc || (rt.fishService || 'cut') !== svc) continue; (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/char.html')); await sleep(4000); } }
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
      if (L2EngineCore.taskAllowed(cfg,'mammon')) L2V7Modules.mammon.mmTick().catch(() => {});
      farmGuideTick();                             // 10.0.7: источники дропа/спойла из игры (раз в сутки / по кнопке)
      L2V7Modules.subclass.tick().catch(() => {});  // 10.0.7: заготовка под сабы — роль класса, помощь основному
      if (L2EngineCore.taskAllowed(cfg,'mammon') && await L2V7Modules.mammon.mmStep()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;              // 10.0.13: false после await не даёт старому циклу начать следующее действие.
      // 9.0: квесты сабкласса/Noblesse — прогресс фоном (только GET), готовую часть бот сдаёт сам (вне боя и туров, с возвратом на точку)
      if (L2EngineCore.taskAllowed(cfg,'quests')) L2V7Modules.story.storyTick().catch(() => {});
      if (L2EngineCore.taskAllowed(cfg,'quests') && await L2V7Modules.story.storyStep()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      // 10.0 (игрок 12.10 «добавь все, монеток шоу»): магазин TvT — покупка вещи-цели за Shil по галочке (вне боя и туров)
      if (!Array.isArray(cfg.autoTasks) && await L2V7Modules.tvtshop.shopStep()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      // 10.0 (игрок 12.10): дейлики и клановые задания — опрос фоном (GET), сдать/взять/помочь (POST), рыба и РБ по дейликам (вне боя и туров)
      L2V7Modules.dailies.tick().catch(() => {});
      if (await L2V7Modules.dailies.clanStep()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (await L2V7Modules.dailies.dailyStep()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (rt.petBufferTrip && await warlockTripStep()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (on && tabOwner && !isBattle() && await L2V7Modules.warlock.step()) { await sleep(200); continue; }
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (epicOn()) L2V7Modules.epics.epicPollTick().catch(() => {});   // 8.0.3: список эпиков — фоном по окнам появления (только GET, без переходов)
      if (autonomyMode() === 'epic' && !isBattle()) { await epicStep(); await sleep(200); continue; }   // 🐉 v5.5: фарм эпиков — свой цикл (заход → смерть → хил → снова)
      // 8.0.3 (разбор логов 11.10): в туре оружие не читалось (строка ниже ждёт !huntOn) — после сброса памяти заряды бы не докупались.
      // Читаем на шаге выбора РБ, не чаще раза в 30 мин
      // 14.10: начатый тур чтения сумки должен закончить prof → inv → back до следующего шага рейда.
      if (rt.invScan && Date.now() - (rt.invScan.t || 0) < 120000) { await invScanStep(); await sleep(300); continue; }
      if (rt.invScan) await setRt({ invScan: null });
      if (!on || !tabOwner || autonomyMode() === 'enchant') continue;
      if (autonomyMode() === 'raid' && !isBattle() && cfg.weaponScanAuto !== false && !rt.weaponsT && !fishNow() && (!rt.rbHunt?.step || rt.rbHunt.step === 'pick')
          && Date.now() - (rt.invTourT || 0) > 30 * 60000) { await setRt({ invTourT: Date.now() }); await invScanStart(); continue; }
      if (autonomyMode() === 'raid' && !isBattle()) { await rbHuntStep(); await sleep(200); continue; }   // 🧭 тур по РБ — свой пошаговый цикл (после полёта в зону: v4.44)
      if (cfg.weaponScanAuto !== false && !rt.weaponsT && !isBattle() && !fishNow() && !(cfg.rbMode && rt.rbPending) && !huntOn()) { await invScanStart(); continue; }   // 8.0.3: рейдовый тур не отменяет чтение сумки
      // 9.2.3: новое оружие в сумке или открылся новый грейд — перечитать сумку (equipment.weaponRescanWhy)
      if (cfg.weaponScanAuto !== false && rt.weaponsT && !isBattle() && !fishNow() && !(cfg.rbMode && rt.rbPending) && !huntOn()) {
        const why = L2V7Modules.equipment.weaponRescanWhy(invQty(0) === null ? null : INV_NET.m, heroLevel());
        if (why) { rec('B', 'оружие', `перечитываю сумку: ${why}`); await setRt({ weapRescan: { sig: why, t: Date.now() } }); await invScanStart(); continue; }
      }
      if (isMap() && campOn() && !fishNow() && !rt.actionOwner && await L2V7Modules.quests.campLocationStep()) { await sleep(200); continue; }
      // 8.0 (аудит рыбалки): служебный переход — только после того, как fishService дошёл до хранилища (rtCommit)
      if (fishNow() && rt.fishService === 'cut') { if (isChar()) await fishCut(); else { await rtCommit(); if (!on || !tabOwner || !fishNow() || rt.fishService !== 'cut') continue; (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/char.html')); await sleep(5000); } }
      else if (fishNow() && rt.fishService === 'exchange') { if (isFishShop()) await fishExchange(); else { await rtCommit(); if (!on || !tabOwner || !fishNow() || rt.fishService !== 'exchange') continue; (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/fishing-shop.html')); await sleep(5000); } }
      else if (fishNow() && rt.fishService === 'rod') { if (isChar()) await rodEnchant(); else { await rtCommit(); if (!on || !tabOwner || !fishNow() || rt.fishService !== 'rod') continue; (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/char.html')); await sleep(5000); } }
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
      // 10.0 (игрок 12.10: «кнопка старт без быстрого режима… не все задачи стоят на быстром режиме»): режим не выбран — бот делает только
      // включённые задачи (Маммон, крафтер и почта, квесты сабкласса/Noblesse, TvT, цель фарма ресурса/рецепта), между ними стоит, где стоял
      else if (Array.isArray(cfg.autoTasks) && autonomyMode() === 'campaign' && !campOn()) await tasksIdle();
      else if (autonomyMode() === 'tasks' && !lootGoal()) await tasksIdle();
      else if (autonomyMode() === 'tasks' && (tasksGoalNote(lootGoal()), isMap())) await map();   // 10.0.5: на чужой точке map() не бьёт, ждёт перелёта
      else if (location.pathname === '/ashen-bastion.html' && autonomyMode() === 'farm') await L2V7Modules.mobfarm.ashenStep();
      else if (isMap()) {
        if (campOn() && (rt.campaignDue || !rt.campaign)) await goCampaign();
        else await map();
      }
      else await goOutskirts();                   // город, магазин, инвентарь… — в Окрестности
      await sleep(isBattle() ? 40 : 200);         // 10.0 (лог 12.10): цепочка — следующий бой уже на этой странице, 200 мс простоя на каждого моба не нужны
    } catch (e) { console.error(TAG, e); try { await softError(e); } catch (e2) { console.error(TAG, 'softError', e2); await sleep(3000); } }   // 7.1.30: ошибка внутри обработчика не глушит цикл
  }
  } finally { running = false; }
}

// Магистр: актуальный серверный каталог, каждый новый уровень и сразу после включения.
const MAG_SKIP_DEF = 'Curse Weakness, Poisonous Cloud';
// После GET магистра проверка активности или TvT могли прервать обучение: новую охоту не начинаем.
function magisterHold() { return abHold() || !!antibotState() || !!L2V7Modules.tvt?.tvtHold?.(); }
const magActive = () => on && tabOwner && cfg.enchantMode !== true && cfg.autoMagister === true && !abHold() && !antibotState() && !!rt.char && heroNick() === rt.char;
const magIdentity = () => {
  const prof = String(rt.classCur?.prof || '').trim();
  const slot = rt.classCur?.slot;
  const lvl = +heroLevel();
  return prof && Number.isInteger(slot) ? { prof, slot, lvl, key: `${slot}:${prof}` } : null;
};
const magSame = M => !!M && magActive() && M.char === rt.char && rt.magister?.t === M.t && rt.magister?.key === M.key
  && (+rt.manualKickAt || 0) === M.kick && magIdentity()?.key === M.key;
function magScore(c) {
  const n = c.name.toLowerCase(), panel = (rt.panel || []).map(x => (x.name || '').toLowerCase());
  const il = ilOf(c.name) || {};
  if (names(cfg.magisterSkip ?? MAG_SKIP_DEF).includes(n)) return -1;
  if (panel.includes(n) && /атака/.test(il.c || '')) return 100;
  const pet = (petState()?.key || '').replace(/_/g, ' ');
  if (/^summon /.test(n) && pet && n.includes(pet)) return 80;
  // Роль не ограничивает каталог: Spoil крафтера и новые мастерства разрешает canLearn сервера.
  if (/^spoil(?: festival)?$|^sweeper$/.test(n)) return 70;
  if (/^servitor heal/.test(n)) return 30;
  if (c.passive) return /weapon mastery|mana gain|robe mastery|anti magic/.test(n) ? 60 : 40;
  if (panel.includes(n)) return 50;
  return /атака/.test(il.c || '') ? 45 : 20;
}
async function magRead(path) {
  const r = await gameGet(path); const d = await r.json();
  if (!r.ok || !d || d.error) throw new Error(`магистр: HTTP ${r.status}`);
  return d;
}
function magChar(ch) {
  if (!ch || typeof ch !== 'object' || ch.name !== rt.char || !magActive()) return null;
  const slot = ch.classSlots?.activeSlot;
  const prof = ch.l2Profession || ch.classSlots?.slots?.find(x => x.slot === slot)?.profession;
  if (!prof || !Number.isInteger(slot) || !(ch.level > 0) || !Number.isFinite(ch.revision)) return null;
  L2V7Modules.story.charNote(ch); L2V7Modules.subclass.charNote(ch);
  return { prof, slot, lvl: +ch.level, key: `${slot}:${prof}`, revision: ch.revision };
}
async function magisterStart(afterWin = false) {
  if (!magActive() || fishNow() || rt.shop || rt.rbGo || rt.zoneGo
      || (rt.epic?.step && rt.epic.step !== 'pick') || (isBattle() && !afterWin)
      || (afterWin && !victory()) || (cfg.tvtOn && L2V7Modules.tvt.tvtHold())) return false;
  if (!rt.magEnabled) await setRt({ magEnabled: true, magChecked: {} });
  if (!magActive()) return false;
  let who = magIdentity();
  if (!who || !who.lvl) {
    if (Date.now() - (rt.magReadT || 0) < 30000) return false;
    await setRt({ magReadT: Date.now() });
    const char = rt.char;
    try { const d = await magRead('/character'); if (!magActive() || rt.char !== char) return false; who = magChar(d.character || d); } catch (_) { return false; }
  }
  if (!magActive() || !who || magisterHold()) return false;
  const checked = rt.magChecked?.[who.key], retry = rt.magRetry;
  if (!rt.magister && checked?.lvl >= who.lvl) return false;
  if (retry?.key === who.key && retry.lvl === who.lvl && retry.until > Date.now()) return false;
  if (!rt.magister || rt.magister.key !== who.key || rt.magister.kick !== (+rt.manualKickAt || 0)) {
    const home = { zone: rt.zone || null, catIn: rt.catIn || null, catDungeon: cfg.catDungeon || null,
      mode: autonomyMode(), path: location.pathname === '/dungeon.html' ? location.pathname + location.search : '/map.html' };
    await setRt({ magister: { t: Date.now(), char: rt.char, key: who.key, prof: who.prof, slot: who.slot, lvl: who.lvl,
      kick: +rt.manualKickAt || 0, home } });
  }
  const M = rt.magister;
  if (!magSame(M)) return false;
  rec('B', 'магистр', `${who.lvl} ур.: проверяю доступные ранги`);
  if (afterWin) { if (!(await rtCommit())) return true; if (!magSame(M) || magisterHold()) return false; await toMap(); }
  return true;
}
async function magisterDisable() {
  if (cfg.autoMagister === true || !on || !tabOwner) return;
  // Не стираем неопределённый исход уже отправленного POST: повторное включение сначала проверит ранг.
  if (rt.magEnabled || rt.magister) await setRt({ magEnabled: false, magister: null });
}
async function magBack(M) {
  if (!magSame(M)) return;
  const H = M.home || {};
  if (H.mode === 'cat' && autonomyMode() === 'cat' && H.catDungeon === (cfg.catDungeon || null) && H.catIn) {
    await setRt({ magister: null, catCur: H.catIn });
    if (!(await rtCommit())) { if (magActive() && M.char === rt.char) await setRt({ magister: M }); return; }
    if (!magActive() || M.char !== rt.char || M.kick !== (+rt.manualKickAt || 0)) return;
    // Открытие страницы гильдии не телепортирует героя. catGo сверяет реальное положение перед платным возвращением.
    await catGo(H.catIn); return;
  }
  const back = H.mode === autonomyMode() && H.zone && !/^out:|^rb:/.test(H.zone) && H.zone !== rt.zone
    ? { zoneGo: { id: H.zone, t: Date.now(), why: 'магистр: обратно на точку' }, zoneGoT: 0 } : {};
  await setRt({ magister: null, ...back });
  if (!(await rtCommit())) { if (magActive() && M.char === rt.char) await setRt({ magister: M }); return; }
  if (!magActive() || M.char !== rt.char || M.kick !== (+rt.manualKickAt || 0)) return;
  (L2V7Modules.actions?.canAct?.() !== false && (location.href = fishNow() ? '/fishing.html' : '/map.html'));
}
async function magPause(M, why) {
  if (!magSame(M)) return;
  rec('B', 'магистр', why);
  await setRt({ magRetry: { key: M.key, lvl: M.lvl, until: Date.now() + 60000 } });
  await magBack(M);
}
let magUnsent = new WeakSet();   // Только память этого экземпляра; persisted prepared не доказывает отсутствие POST.
async function magConfirm(M, catalog, revision) {
  const p = rt.magPending?.[M.key];
  if (!p) return true;
  const c = catalog.skills.find(x => x.battleId === p.id);
  // Только конкретный ранг того же навыка. Ни списание SP, ни исчезновение карточки не являются подтверждением.
  if (!c || !Number.isFinite(c.skillLevel)) {
    // 15.10 (альт с пикой, лог09:46): выученный до максимума пассив исчезает
    // из каталога доступного обучения. Подтверждаем точный ранг свежим /character,
    // а не исчезновением карточки или списанием SP.
    const data = await magRead('/character');
    if (!magSame(M)) return false;
    const ch = data.character || data, who = magChar(ch);
    if (!who || who.key !== M.key || !(who.revision > p.revision)) return false;
    const learned = ch.learnedBattleSkillsDetail?.find(x => x.battleId === p.id);
    if (!Number.isInteger(learned?.level) || learned.level <= p.rank) return false;
    return magConfirm(M, { ...catalog, skills: [...catalog.skills.filter(x => x.battleId !== p.id), { battleId: p.id, skillLevel: learned.level }] });
  }
  if (c.skillLevel <= p.rank) {
    if (c.skillLevel !== p.rank) return false;
    // character прочитан ДО каталога: при большей revision старый expectedRevision уже не может примениться.
    // Противоречивое списание SP без нового ранга не даёт разрешения платить ещё раз.
    const invalidated = revision > p.revision && Number.isFinite(p.sp) && catalog.characterSp >= p.sp;
    if (!magUnsent.has(p) && !invalidated) return false;
    const P = { ...rt.magPending }; delete P[M.key]; await setRt({ magPending: P }); return true;
  }
  const pending = { ...rt.magPending }; delete pending[M.key];
  const S = { ...(rt.skills || {}) }, n = p.name.toLowerCase();
  if (S[n]) S[n] = { ...S[n], dmg: 0, dmgN: 0, mp: 0, mpN: 0 };
  await setRt({ magPending: pending, skills: S });
  rec('B', 'магистр', `${p.name}: подтверждён ранг ${p.rank}→${c.skillLevel}`);
  return true;
}
function magReplay(M, catalog, revision) {
  const p = rt.magPending?.[M.key], c = p && catalog.skills.find(x => x.battleId === p.id);
  // После сбоя одинаковая revision не доказывает, что старого запроса не было. Через минуту разрешён
  // только ТОТ ЖЕ compare-and-swap: два запроса с одной expectedRevision не могут оба списать SP.
  return !!p && revision === p.revision && catalog.characterSp === p.sp && c?.skillLevel === p.rank
    && Date.now() - (p.lastTry || p.t) >= 60000;
}
let magBusy = false;
async function magisterStep() {
  if (magBusy || !magActive()) return;
  const M = rt.magister;
  if (!M) return;
  if (!magSame(M)) { await setRt({ magister: null }); return; }
  magBusy = true;
  try {
    // Каждый батч берёт полный каталог: hook обрезает массивы до восьми, а здесь навыков больше.
    const data = await magRead('/character');
    if (!magSame(M)) return;
    const who = magChar(data.character || data);
    if (!magSame(M)) return;
    if (!who || who.key !== M.key) return magPause(M, 'класс или уровень не подтверждён');
    let catalog = await magRead('/character/magister');
    if (!magSame(M)) return;
    if (catalog.profession?.l2Profession !== M.prof || !Array.isArray(catalog.skills) || !Number.isFinite(catalog.characterSp))
      return magPause(M, 'каталог текущего класса не подтверждён');
    const npc = +catalog.npc?.npcId;
    if (!Number.isInteger(npc) || npc <= 0) return magPause(M, 'гильдия не указала учителя');
    if (location.pathname !== '/magister.html' || new URLSearchParams(location.search).get('npcId') !== String(npc)
        || new URLSearchParams(location.search).has('mode')) {
      if (await rtCommit() && magSame(M)) (L2V7Modules.actions?.canAct?.() !== false && (location.href = `/magister.html?npcId=${npc}`));
      return;
    }
    // Общий endpoint может возвращать skills:[]; полный каталог доступен по npcId.
    catalog = await magRead(`/character/magister?npcId=${npc}`);
    if (!magSame(M)) return;
    if (catalog.profession?.l2Profession !== M.prof || !Array.isArray(catalog.skills) || !Number.isFinite(catalog.characterSp))
      return magPause(M, 'каталог учителя не подтверждён');
    if (!await magConfirm(M, catalog, who.revision) && !magReplay(M, catalog, who.revision)) return magPause(M, 'исход прошлого обучения пока не подтверждён — повторно SP не трачу');
    if (!magSame(M)) return;
    // Короткий батч, чтобы main снова проверил TvT/Stop/срочную закупку. Остальные ранги остаются в job.
    for (let i = 0; i < 8 && magSame(M); i++) {
      if (rt.shop?.urgent || (cfg.tvtOn && L2V7Modules.tvt.tvtHold())) return;
      // Ревизия читается ДО каталога. Любая ручная покупка между чтениями даст 409,
      // а не позволит оплатить следующий ранг по устаревшей цене/остатку SP.
      const snapshot = await magRead('/character');
      if (!magSame(M)) return;
      const live = magChar(snapshot.character || snapshot);
      if (!magSame(M)) return;
      if (!live || live.key !== M.key || live.lvl !== who.lvl) return magPause(M, 'класс/уровень изменился — перечитаю каталог');
      catalog = await magRead(`/character/magister?npcId=${npc}`);
      if (!magSame(M)) return;
      if (catalog.profession?.l2Profession !== M.prof || !Array.isArray(catalog.skills) || !Number.isFinite(catalog.characterSp))
        return magPause(M, 'каталог текущего класса не подтверждён');
      let replay = rt.magPending?.[M.key];
      if (replay) {
        if (await magConfirm(M, catalog, live.revision)) replay = null;
        else if (!magReplay(M, catalog, live.revision)) return magPause(M, 'прошлый запрос ещё не сверён с сервером');
        if (!magSame(M)) return;
      }
      const reserve = Math.max(0, +cfg.magisterSpReserve || 0);
      const candidates = catalog.skills.filter(s => s.canLearn === true && !s.learnedMax
        && Number.isFinite(s.skillLevel) && Number.isFinite(s.maxSkillLevel) && s.skillLevel < s.maxSkillLevel
        && Number.isFinite(s.spCost) && s.spCost >= 0 && s.spCost <= catalog.characterSp - reserve
        && Number.isFinite(s.minLevel) && s.minLevel <= who.lvl)
        .map(s => ({ ...s, name: String(s.nameUk || ''), passive: s.kind === 'passive' }))
        .filter(s => s.battleId && s.name).map(s => ({ ...s, score: magScore(s) }))
        .filter(s => s.score >= 0).sort((a, b) => b.score - a.score || a.spCost - b.spCost);
      const c = replay ? candidates.find(s => s.battleId === replay.id && s.skillLevel === replay.rank) : candidates[0];
      if (replay && !c) return magPause(M, 'повтор исходного запроса сейчас запрещён резервом SP или условиями навыка');
      if (!c) {
        await setRt({ magChecked: { ...rt.magChecked, [M.key]: { lvl: who.lvl, t: Date.now() } }, magRetry: null });
        if (magSame(M)) await magBack(M);
        return;
      }
      const pending = replay ? { ...replay, lastTry: Date.now() }
        : { id: c.battleId, name: c.name, rank: c.skillLevel, revision: live.revision, sp: catalog.characterSp, t: Date.now(), phase: 'prepared' };
      if (!replay) magUnsent.add(pending);
      // Сначала сохраняем неопределённый исход. После reload только GET подтвердит, был ли принят запрос.
      const saved = await setRt({ magPending: { ...rt.magPending, [M.key]: pending } });
      // inactive не ставит patch в очередь: успешный recover пустой очереди ещё не подтверждает receipt.
      if (saved?.ok !== true || !(await rtCommit())) return;
      if (!magSame(M) || magScore(c) < 0 || c.spCost > catalog.characterSp - Math.max(0, +cfg.magisterSpReserve || 0) || rt.shop?.urgent || (cfg.tvtOn && L2V7Modules.tvt.tvtHold())) {
        if (!replay && tabOwner && rt.magPending?.[M.key] === pending) {
          const P = { ...rt.magPending }; delete P[M.key]; await setRt({ magPending: P });
        }
        return;
      }
      setStatus(`Магистр: ${c.name} ${c.skillLevel}→${c.skillLevel + 1}`);
      let response;
      try {
        // sent — диагностическая метка, не доказательство на диске: crash может сохранить только prepared.
        // С этого момента исход неизвестен; после reload сверяем ранг/ревизию, не доверяем phase.
        magUnsent.delete(pending);
        const write = setRt({ magPending: { ...rt.magPending, [M.key]: { ...pending, phase: 'sent' } } });
        const request = gamePost('/character/skills/learn', { battleId: pending.id, expectedRevision: pending.revision });
        // Сразу обработчик rejection: сетевой отказ может прийти раньше завершения записи.
        const result = request.then(r => ({ r }), error => ({ error }));
        await write; const outcome = await result; if (outcome.error) throw outcome.error; response = outcome.r;
      }
      catch (_) { if (magSame(M)) await magPause(M, 'нет подтверждения запроса обучения — проверю ранг позже'); return; }
      if (!magSame(M)) return;
      // 4xx отклоняет именно этот запрос. У replay оригинал ещё мог успеть: receipt сохраняем до сверки.
      if (response.status >= 400 && response.status < 500) {
        if (!replay) { const P = { ...rt.magPending }; delete P[M.key]; await setRt({ magPending: P }); }
        return magPause(M, `обучение отклонено (${response.status}) — перечитаю состояние`);
      }
      if (!response.ok) return magPause(M, `исход обучения неизвестен (${response.status}) — проверю ранг`);
      catalog = await magRead(`/character/magister?npcId=${npc}`);
      if (!magSame(M)) return;
      if (catalog.profession?.l2Profession !== M.prof || !Array.isArray(catalog.skills) || !Number.isFinite(catalog.characterSp)
          || !await magConfirm(M, catalog)) return magPause(M, 'ранг ещё не подтверждён — следующий запрос не отправляю');
      if (!magSame(M)) return;
    }
  } catch (_) { if (magSame(M)) await magPause(M, 'гильдия временно не ответила — повторю чтение позже'); }
  finally { magBusy = false; }
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
    if (!$q('#l2-hud-legacy-name')) { (L2V7Modules.actions?.canAct?.() !== false && (location.href = fishNow() ? '/fishing.html' : '/map.html')); await sleep(6000); }
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
// 10.0: свой POST с токеном страницы (клановые задания) — JSON, без переходов
async function gamePost(path, body, ms = 8000) {
  if (!on || !tabOwner) throw new Error('bot_inactive');   // 10.0.13: прямой POST подчиняется Stop и замку, как fire.
  if (L2V7Modules.pvp?.pending()) throw new Error('pvp_defeat_pending');
  if (L2V7Modules.actions?.canAct?.() === false) throw new Error('action_cancelled');
  if (L2V7Modules.payments?.blocked?.() && !/^\/game\/(?:tvt\/register|battle\/(?:action|return-to-town))$/.test(path)) throw new Error('payment_unconfirmed');
  const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
  try { return await fetch(path, { method: 'POST', credentials: 'include', cache: 'no-store', headers: { ...gameAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: c.signal }); } finally { clearTimeout(tm); }
}
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
  if (d.action === 'reload' && d.programming && d.fatalRepeats === 3 && autonomyMode() !== 'enchant' && !/\/map\.html/.test(location.pathname)) {
    setStatus('Восстановление: ошибка страницы повторилась — перехожу на карту');
    rec('S', 'восстановление', `${d.error.slice(0, 80)} — 3-й раз подряд, перехожу на карту (4-й — остановка с сообщением)`);
    await sleep(2000);
    if (on && tabOwner) (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/map.html'));
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
// 10.0.5: запоминается самое узкое измеренное поле — окно не залезает на игру (спойлер 13.10: «левая панель вышла за край»)
let indStick = (() => { try { return JSON.parse(localStorage.getItem('l2bot-indw') || 'null'); } catch (e) { return null; } })();
function layoutInd(bounds) {
  try {
    const vw = document.documentElement.clientWidth || innerWidth;
    const s = L2EngineCore.stickyFree(indStick, (bounds?.left || 0) - 16, vw, !!bounds?.observed?.length);
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
const dockWideOpen = () => { try { return localStorage.getItem('l2bot-dockWide') === '1'; } catch (e) { return false; } };
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
    const wide = document.createElement('button');
    wide.id = 'l2bot-dock-wide';
    wide.type = 'button';
    wide.style.cssText = 'position:absolute;top:62px;left:0;width:26px;height:36px;z-index:2;border:1px solid #56452f;border-radius:0 6px 6px 0;background:linear-gradient(180deg,#2e261e,#231d17);color:#f0cf86;font:12px system-ui;cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.4)';
    wide.addEventListener('click', e => {
      e.stopPropagation();
      try { localStorage.setItem('l2bot-dockWide', dockWideOpen() ? '0' : '1'); } catch (er) {}
      dock();
    });
    wrap.append(tg, wide, fr);
    document.documentElement.appendChild(wrap);
  }
  layoutInd(bounds);
  try { ui.classList.toggle('over', dockOver); ui.classList.toggle('hid', dockOver && !min); draw(); } catch (e) {}   // индикатор ещё не создан
  // Если рядом места нет (узкое окно или ещё не загрузилась игра) — компактная панель поверх игры (8.0.7: на Android до 460 px)
  const normalWidth = bounds.right > 0 && available >= 300 ? available : Math.min(dockOver ? 460 : 380, Math.max(0, viewport - 16));
  const wideOn = dockWideOpen() && !dockOver;
  const w = wideOn ? Math.min(normalWidth * 2, Math.max(0, viewport - 16)) : normalWidth;
  wrap.style.cssText = `position:fixed;top:8px;right:${min ? -w : 8}px;bottom:8px;width:${w}px;z-index:2147483646;`
    + 'box-sizing:border-box;border:1px solid #56452f;border-radius:12px;background:#14100d;box-shadow:0 8px 28px rgba(0,0,0,.6);transition:right .2s';
  const toggle = wrap.querySelector('#l2bot-dock-toggle'), tw = dockOver ? 36 : 26;
  toggle.style.width = tw + 'px'; toggle.style.height = (dockOver ? 64 : 46) + 'px'; toggle.style.fontSize = (dockOver ? 17 : 13) + 'px';
  toggle.style.left = min ? -tw + 'px' : '0';
  toggle.style.borderRadius = min ? '8px 0 0 8px' : '0 6px 6px 0';
  toggle.textContent = min ? '◀' : '▶';
  toggle.title = min ? 'Показать меню бота' : 'Свернуть меню бота';
  toggle.setAttribute('aria-expanded', String(!min));
  const wideButton = wrap.querySelector('#l2bot-dock-wide');
  wideButton.style.display = min || dockOver ? 'none' : 'block';
  wideButton.textContent = wideOn ? '½' : '×2';
  wideButton.title = wideOn ? 'Вернуть обычную ширину меню' : 'Расширить меню вдвое';
  wideButton.setAttribute('aria-label', wideButton.title);
  wideButton.setAttribute('aria-pressed', String(wideOn));
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
uiCss.textContent = `#l2bot-ind{-moz-text-size-adjust:none;-webkit-text-size-adjust:none;text-size-adjust:none;position:fixed;left:8px;bottom:8px;z-index:2147483647;width:440px;max-width:calc(100vw - 16px);max-height:60vh;overflow:hidden;padding:9px 12px 10px;border-radius:12px;font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#efe6d6;background:rgba(20,16,13,.88);backdrop-filter:blur(6px);border:1px solid rgba(212,168,86,.35);box-shadow:0 6px 22px rgba(0,0,0,.5);pointer-events:none;white-space:pre-line;overflow-wrap:anywhere}
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
#l2bot-ind .e{margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,.08);color:#d8c39a;font-variant-numeric:tabular-nums}
#l2bot-ind .e b{color:#f0cf86}
#l2bot-ind .e{display:flex;gap:10px;align-items:flex-start}
#l2bot-ind .e .et{flex:1 1 auto;min-width:0}
#l2bot-ind .e .mm{flex:0 0 auto;display:flex;flex-direction:column;align-items:stretch;gap:4px;max-width:46%}
#l2bot-ind .e .mm .bt{pointer-events:auto;cursor:pointer;font:inherit;font-size:11px;line-height:1.3;padding:3px 9px;margin:0;border-radius:7px;border:1px solid rgba(212,168,86,.55);background:rgba(212,168,86,.14);color:#f0cf86;white-space:nowrap;text-align:left}
#l2bot-ind .e .mm .bt:hover{background:rgba(212,168,86,.3)}
#l2bot-ind .e .mm .ms{font-size:10.5px;color:#a39280;white-space:normal}
#l2bot-ind.wide .e .mm .bt{font-size:14px;padding:4px 12px}
#l2bot-ind.wide .e .mm .ms{font-size:12.5px}
#l2bot-ind.wide .e{margin-top:auto;padding-top:9px;font-size:15px;flex:0 0 auto}
#l2bot-ind .b{margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,.08);color:#d8c39a;font-variant-numeric:tabular-nums}
#l2bot-ind .b .bt{pointer-events:auto;cursor:pointer;font:inherit;font-size:11px;line-height:1.3;padding:3px 9px;margin:1px 6px 1px 0;border-radius:7px;border:1px solid rgba(212,168,86,.55);background:rgba(212,168,86,.14);color:#f0cf86}
#l2bot-ind .b .bt:hover{background:rgba(212,168,86,.3)}
#l2bot-ind.wide .b{flex:0 0 auto;font-size:14.5px;padding-top:9px;margin-top:8px}
#l2bot-ind.wide .b .bt{font-size:14px;padding:4px 12px}
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
// 10.0.2 (игрок 12.10: «слева снизу создай раздел — Респ эпиков исходя из нашего слежения»): эпики из таймеров боссов (rt.rbTimer —
// опрос списка эпиков, свои убийства). Убитые — по времени воскрешения, живые — одной строкой. В узком окне — одна строка
function epicRespTxt(wide, now = Date.now()) {
  try {
    const RT = L2V7Modules.rbtimer, T = rt.rbTimer || { b: {} }; if (!RT) return '';
    const nm = n => String(n || '').replace(/^Queen Ant$/, 'АК');
    const E = RT.table(T, now, { all: true }).filter(t => t.e).map(t => ({ n: nm(t.n), l: t.l, al: t.al, txt: t.al ? '' : RT.upTxt(t, now), at: t.al ? Infinity : t.at.lo || t.at.hi }));
    // 10.0.2 (скрин игрока 13.10 00:14: блока не было — бот на паузе, своих опросов ещё не делал): эпики, которых нет в таймерах, — из
    // rt.epicDb (список эпиков игры, страница «Эпик боссы», раздел «🐉 Эпики»)
    const seen = new Set(E.map(x => x.n.toLowerCase()));
    for (const d of Object.values(rt.epicDb || {})) {
      const n = nm(d?.name); if (!n || seen.has(n.toLowerCase()) || typeof d.alive !== 'boolean') continue;
      const u = d.until, txt = d.alive ? '' : !u?.hi ? 'когда — неизвестно' : u.late ? `уже должен воскреснуть (не позже ${RT.hm(u.hi, now)})` : u.lo && u.hi - u.lo > 15 * 60000 ? `${RT.hm(u.lo, now)}–${RT.hm(u.hi, now)}` : `${u.lo ? '≈' : 'не позже '}${RT.hm(u.hi, now)} (через ${RT.dur(u.hi - now)})`;
      E.push({ n, l: d.lvl || 0, al: d.alive, txt, at: d.alive ? Infinity : u?.lo || u?.hi || Infinity }); seen.add(n.toLowerCase());
    }
    if (!E.length) return wide ? '— 🐉 респ эпиков —\nданных пока нет: загрузите файл таймеров (Alt+W) или откройте в игре «Эпик боссы»' : '';
    E.sort((a, b) => a.at - b.at);
    const dead = E.filter(t => !t.al).map(t => `${t.n} (${t.l}): ${t.txt}`), live = E.filter(t => t.al).map(t => t.n);
    if (!wide) return `🐉 Респ эпиков: ${dead.length ? dead[0].replace(/\s*\(через[^)]*\)/, '') + (dead.length > 1 ? ` · ещё убиты ${dead.length - 1}` : '') : 'все живы'}${live.length ? ` · живы ${live.length}` : ''}`;
    return '— 🐉 респ эпиков —\n' + [...dead.map(x => '💀 ' + x), live.length ? '✅ живы: ' + live.join(', ') : ''].filter(Boolean).join('\n');
  } catch (e) { return ''; }
}
// 10.0.6: сводка «📦 Серия РБ» раскрыта/свёрнута — на этом устройстве (localStorage), кнопки в окне кликабельны (pointer-events:auto)
let rbRunOpen = (() => { try { return localStorage.getItem('l2bot-rbrun') === '1'; } catch (e) { return false; } })();
if (typeof addEventListener === 'function') addEventListener('click', e => {
  const b = e.target?.closest?.('[data-rbrun]'); if (!b || !ui.contains?.(b)) return; e.preventDefault(); e.stopPropagation();
  if (b.dataset.rbrun === 'toggle') { rbRunOpen = !rbRunOpen; try { localStorage.setItem('l2bot-rbrun', rbRunOpen ? '1' : '0'); } catch (er) {} try { draw(); } catch (er) {} return; }
  if (b.dataset.rbrun === 'reset') { if (b.dataset.ask !== '1') { b.dataset.ask = '1'; b.textContent = '⚠ Ещё раз — обнулить'; setTimeout(() => { try { draw(); } catch (er) {} }, 4000); return; }
    rbRunReset().catch(() => {}); }
});
// обнуление — через фон (команда rbRunSet): пишется и когда вкладка не держит замок (бот стоит/на паузе); не вышло — обычный setRt
async function rbRunReset() {
  const R = L2V7Modules.rbrun; if (!R) return;
  const r = R.blank('manual'); let ok = false;
  try { ok = !!(await chrome.runtime.sendMessage({ cmd: 'rbRunSet', rbRun: r }))?.ok; } catch (e) {}
  if (ok) { rt = { ...rt, rbRun: r }; rec('B', 'серия РБ', '📦 новая серия (вручную, кнопка «↺ Новая серия» в окне бота) — добыча и награды считаются заново'); }
  else await R.start('manual', 'кнопка «↺ Новая серия» в окне бота');
  try { draw(); } catch (e) {}
}
// 10.0.9 (игрок 13.10 07:22, скрин: обвёл место справа от «Респ эпиков»): кнопки «🛒 Торговец Маммона» / «⚒ Кузнец Маммона» в окне бота.
// Бот работает — разовая команда rt.mmGoReq {kind:'visit', npc} (modules/mammon.js goReq/visit: телепорт за адену, страница NPC, пауза);
// пишется через фон (mmGoSet, без замка вкладки). Бот стоит/на паузе — сразу открываем страницу телепорта к NPC, игрок летит сам
const MM_LOC = { order: '/mammon-merchant-loc.html', smith: '/mammon-blacksmith-loc.html' };
if (typeof addEventListener === 'function') addEventListener('click', e => {
  const b = e.target?.closest?.('[data-mmgo]'); if (!b || !ui.contains?.(b)) return; e.preventDefault(); e.stopPropagation();
  mmGoClick(b.dataset.mmgo === 'smith' ? 'smith' : 'order').catch(() => {});
});
async function mmGoClick(npc) {
  const who = npc === 'smith' ? 'кузнецу' : 'торговцу';
  if (!on) { rec('B', 'Маммон', `кнопка «${who === 'кузнецу' ? '⚒ Кузнец' : '🛒 Торговец'} Маммона»: бот стоит — открываю страницу телепорта к ${who}`); location.href = MM_LOC[npc]; return; }
  const req = { kind: 'visit', npc, t: Date.now() }; let ok = false;
  try { ok = !!(await chrome.runtime.sendMessage({ cmd: 'mmGoSet', mmGoReq: req }))?.ok; } catch (e) {}
  if (ok) rt = { ...rt, mmGoReq: req, mmGoSay: null }; else await setRt({ mmGoReq: req, mmGoSay: null });
  rec('B', 'Маммон', `кнопка в окне бота: прийти к ${who} Маммона — полечу, как только закончу бой/тур`);
  try { draw(); } catch (e) {}
}
function mmGoBtns() {
  const R = rt.mmGoReq, S = rt.mmGoSay, J = rt.mmJob, now = Date.now();
  const st = J?.visit ? `⏳ иду к ${J.kind === 'smith' ? 'кузнецу' : 'торговцу'}…` : R?.kind === 'visit' && now - (R.t || 0) < 30 * 60000 ? `⏳ к ${R.npc === 'smith' ? 'кузнецу' : 'торговцу'}: после боя/тура` : S && now - (S.t || 0) < 600000 ? `✗ ${S.why}` : '';
  return `<button type="button" class="bt" data-mmgo="order" title="${on ? 'Телепорт к торговцу Маммона (за адену), открыть его страницу и встать на паузу' : 'Бот стоит: открыть страницу телепорта к торговцу Маммона'}">🛒 Торговец Маммона</button><button type="button" class="bt" data-mmgo="smith" title="${on ? 'Телепорт к кузнецу Маммона (за адену), открыть его страницу и встать на паузу' : 'Бот стоит: открыть страницу телепорта к кузнецу Маммона'}">⚒ Кузнец Маммона</button>${st ? `<span class="ms">${escH(st)}</span>` : ''}`;
}
function draw() {
  const L = [], now = Date.now();
  const fz = forceNow() || forceMax() ? ` · ⚡${forceNow()}${forceMax() ? '/' + forceMax() : ''}` : '';
  // 8.0 (аудит меню): настоящий текущий режим (как выбирает движок, autonomyMode) — раньше в списке не было «фарма на месте»,
  // «автофарма» и TvT, а при паузе индикатор писал «остановлен»
  let am = 'farm'; try { am = autonomyMode(); } catch (e) {}
  const modeTxt = ({ enchant: '⚒ заточка', epic: '🐉 эпики', raid: '👑 тур по РБ', fish: '🎣 рыбалка', cat: '🏛 катакомбы', campaign: '📜 кампания' })[am] || (cfg.zoneAuto ? '🗺 автофарм' : '⚔ фарм на месте');
  const adds = [am === 'raid' && rt.rbOne?.on && '🎯 по одному РБ', cfg.tvtOn && 'TvT'].filter(Boolean);
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
  // 10.0.6 (игрок 13.10 02:02, скрин: обвёл пустое место между журналом и «Респ эпиков»): кнопка «📦 Серия РБ» — что выпало с РБ/эпиков
  // с запуска серии (modules/rbrun.js, rt.rbRun); нажатие раскрывает сводку, «↺ Новая серия» обнуляет
  let rbRunTxt = ''; try { if (typeof L2V7Modules !== 'undefined' && L2V7Modules.rbrun) { rbRunTxt = '— 📦 серия РБ —\n' + L2V7Modules.rbrun.lines(wide, now).join('\n'); L.push(rbRunTxt); } } catch (e) {}
  // 10.0.2 (игрок 12.10: «слева снизу раздел — респ эпиков»; скрин 13.10 00:14 — обвёл пустой низ окна): блок внизу окна, виден всегда
  const ep = epicRespTxt(wide, now); L.push(ep || '— 🏛 маммон —');   // 10.0.9: без строк эпиков блок всё равно есть — ради кнопок Маммона
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
    // 10.0.9: справа от «Респ эпиков» — кнопки Маммона (.mm); без эпиков — только кнопки
    if (t.startsWith('— 🐉 респ эпиков —')) return `<div class="e"><div class="et"><b>🐉 Респ эпиков</b>\n${escH(t.replace(/^— 🐉 респ эпиков —\n/, ''))}</div><div class="mm">${mmGoBtns()}</div></div>`;
    if (t === '— 🏛 маммон —') return `<div class="e"><div class="mm">${mmGoBtns()}</div></div>`;
    if (rbRunTxt && t === rbRunTxt) { let S = null; try { S = L2V7Modules.rbrun.summary(now); } catch (e) {}
      const head = `<button type="button" class="bt" data-rbrun="toggle" title="${rbRunOpen ? 'Свернуть сводку' : 'Показать, что выпало с РБ за серию'}">📦 Серия РБ${S ? `: убито ${S.kills}${S.nItems ? ` · вещей ${S.nItems}` : ''}` : ''} ${rbRunOpen ? '▴' : '▾'}</button>`;
      const body = rbRunOpen ? `${escH(t.replace(/^— 📦 серия РБ —\n/, ''))}\n<button type="button" class="bt" data-rbrun="reset" title="Обнулить сводку и считать заново с этого момента">↺ Новая серия</button>` : '';
      return `<div class="b">${head}${body ? '\n' + body : ''}</div>`; }
    return `<div>${escH(t)}</div>`;
  }).join('');
  ui.style.borderColor = on ? 'rgba(92,194,122,.55)' : pz ? 'rgba(227,176,75,.55)' : 'rgba(212,168,86,.3)';
}

// стоп с клавиатуры — двойной Esc за 0,6 с: одиночный Esc закрывает окна игры и раньше нечаянно останавливал бота
let escT = 0;
addEventListener('keydown', e => { if (e.key !== 'Escape' || !on || !e.isTrusted) return; if (Date.now() - escT < 600) halt('Остановлено (Esc ×2)', true); escT = Date.now(); }, true);

// 10.0.3 (игрок 12.10 14:26: «Alt+R вызывает окно загрузки таймингов»): Alt+R на странице игры — выбор файла слежки,
// таймеры сливаются с таймерами героя (как кнопка «📥 Загрузить таймеры из файла слежки» в меню; в меню Alt+R делает то же; 10.0.5, игрок 13.10: клавиша теперь Alt+W)
function rbtSay(t, bad) {
  try {
    const d = document.createElement('div'); d.textContent = t; d.id = 'l2bot-rbt-say';
    d.style.cssText = `position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:8px;font:14px sans-serif;background:#2a2217;color:${bad ? '#f08a7a' : '#9fe0a8'};border:1px solid #d4a856`;
    document.getElementById('l2bot-rbt-say')?.remove(); document.body.appendChild(d); setTimeout(() => d.remove(), 5000);
  } catch (e) {}
}
async function rbtImportText(txt) {
  const RT = L2V7Modules.rbtimer, T2 = RT?.parseFile(txt);
  if (!T2 || !Object.keys(T2.b || {}).length) throw new Error('в файле нет таймеров боссов');
  const { rt: s = {} } = await chrome.storage.local.get('rt'), M = RT.merge(s.rbTimer || rt.rbTimer || { b: {} }, T2);
  const r = await chrome.runtime.sendMessage({ cmd: 'rbtImport', rbTimer: M, expectedChar: String(s.char || '') });
  if (!r?.ok) throw new Error(r?.reason || 'фон недоступен');
  if (String(rt.char || '') !== String(s.char || '')) throw new Error('Персонаж изменился — повторите импорт');
  rt = { ...rt, rbTimer: RT.merge(r.rbTimer || M, rt.rbTimer || { b: {} }) };
  try { draw(); } catch (e) {}
  const n = Object.keys(T2.b).length, ob = Object.values(T2.b).reduce((a, x) => a + (x.ob?.length || 0), 0);
  return `Таймеры загружены: ${n} боссов${ob ? `, замеров респа ${ob}` : ''}`;
}
function rbtPick() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,.jsonl,.txt,application/json'; inp.style.display = 'none';
  inp.onchange = async () => {
    const f = inp.files?.[0]; inp.remove(); if (!f) return;
    try { const m = await rbtImportText(await f.text()); rbtSay('⏱ ' + m); try { rec('U', 'таймеры', m + ' (Alt+W)'); } catch (e) {} try { draw(); } catch (e) {} }
    catch (er) { rbtSay('Не загрузил таймеры: ' + (er?.message || er), true); }
  };
  document.body.appendChild(inp); inp.click();
}
addEventListener('keydown', e => { if (!e.isTrusted || !e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyW') return; e.preventDefault(); e.stopPropagation(); rbtPick(); }, true);

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
addEventListener('pageshow', e => {
  pageLeaving = false;
  // Восстановленный BFCache несёт замок и незавершённые async старого документа.
  // Возобновляем через чистый документ, а не выдаём старым продолжениям новый lease.
  if(e.isTrusted&&e.persisted){tabOwner=false;tabIdle=true;leaseEpoch=null;rtWriter.clear();location.reload();}
});
const NET_NOISE = /unread|\/chat\/|\/tvt\b|\/time$|\/online$|party\/hud|news|profession-quest|story-quests|\/sync$|\/raid-bosses$/;
// 7.1.17: ходы боя по сети — ушёл / ответ пришёл. Лог 10.10 01:07: ответ на ход шёл 1,1–2,8 с, а бот жал следующее через 1 с —
// игра такие нажатия не принимала («урон 0 · MP 0» ×6 подряд, бой с чемпионом 33 с). Теперь следующий ход — после ответа
const ACT_NET = { start: 0, done: 0, t: 0 };
// 7.2.3: сумка по ответам сервера { m: itemId → qty, t } — в sessionStorage вкладки, чтобы пережить переход на другую страницу
// (после победы бот сразу уходит на карту, а там панели боя нет)
// 10.0.7 (игрок 13.10 03:07: «переоценка ценности баффов на боевую систему»): цифры героя из ответа игры GET /character (hook.js hero):
// M.Atk, P.Atk, шанс и сила маг./физ. крита, баффы на герое, кот (P.Atk, крит, сила крита, точность) → rt.heroStats (не чаще раза в
// минуту и только при изменении); снимок M.Atk под набором баффов → rt.matkObs (buff-value.js учит настоящие множители баффов)
let heroNoteT = 0;
function heroNote(h) {
  if (!h || !(h.matk > 0 || h.patk > 0)) return;
  const V = globalThis.L2BuffVal, prev = rt.heroStats || {};
  const sig = [h.lv, h.matk, h.patk, h.mcrit, h.crit, (h.buffs || []).join(','), h.cat?.patk, h.cat?.crit].join('|');
  if (sig === prev.sig && Date.now() - (prev.t || 0) < 3600000) return;
  if (Date.now() - heroNoteT < 60000 && sig !== prev.sig && h.lv === prev.lv) { if (Date.now() - (prev.t || 0) < 600000) return; }
  heroNoteT = Date.now();
  const patch = { heroStats: { ...h, sig, t: Date.now() } };
  if (V) patch.matkObs = V.snapAdd(rt.matkObs, h);
  setRt(patch);
}
// цифры героя для модели ценности баффов (fa-full.js порядок набора, меню): null, пока /character не читали
function heroStatsFor() {
  const V = globalThis.L2BuffVal; if (!V || !rt.heroStats) return null;
  let role = null; try { role = L2V7Modules.fightlab?.role?.() || null; } catch (e) {}
  return V.fromRt(rt, cfg, role);
}
// замер крита в бою (fightlab → critNote): нажатий n, из них критов c — под набором крит-баффов, что сейчас на герое (шапка)
let CRIT_ACC = null, critAccN = 0, critOwner = '';
function critNote(n, c) {
  if (!tabOwner || !(n > 0) || combatProfileKind() !== 'mage_summoner') return;
  const V = globalThis.L2BuffVal; if (!V) return;
  let ids = []; try { ids = Object.keys(L2V7Modules.buffs.hudBuffs() || {}).map(Number); } catch (e) {}
  const owner = observeOwner();
  if (critOwner !== owner) { CRIT_ACC = null; critAccN = 0; critOwner = owner; }
  CRIT_ACC = V.obsAdd(CRIT_ACC || rt.critStat, ids, n, c); critAccN += n;
  if (critAccN >= 20) critFlush();
}
function critFlush() { if (critOwner !== observeOwner()) { CRIT_ACC = null; critAccN = 0; return; } if (!CRIT_ACC || !critAccN) return; const o = CRIT_ACC; CRIT_ACC = null; critAccN = 0; setRt({ critStat: o }); }
// 10.0.2 (Life Stone): надетое оружие и его ЛС из ответов сервера (hook.js aug). rt.weaponAug {w, e, o, g, k, n, t} —
// меню показывает бонус, equipment не меняет само оружие с полезным ЛС, бой узнаёт умение ls_* на панели (ilOf)
function augNote(a, path) {
  if (!a || typeof a !== 'object' || !AUG) return;
  const p = rt.weaponAug || {}, m = AUG.info(a.o);
  if (p.w === a.w && p.o === a.o && p.e === a.e && Date.now() - (p.t || 0) < 6 * 3600000) return;
  const same = p.w === a.w && p.o === a.o && p.e === a.e;
  setRt({ weaponAug: { w: a.w, e: a.e, o: a.o, g: a.g, k: m?.k || (a.o ? '?' : ''), n: m?.n || a.o || '', t: Date.now() } });
  if (same || p.w == null && !a.o) return;            // тот же ЛС (освежили отметку) / первая запись без ЛС — в журнал не пишем
  const wn = (itemOf(a.w)?.n || (a.w ? '#' + a.w : 'оружие снято')) + (a.e ? ' +' + a.e : '');
  if (a.o && a.o !== p.o) rec('S', 'ЛС', `Life Stone на ${wn}: ${AUG.text(a)}${m?.k === 'active' ? ' — умение появится в «Навыках», поставьте его на панель боя: бот будет его жать'
    : m?.k === 'negative' ? ' — бонус отрицательный' : ''}`, { path });
  else if (!a.o && p.o && p.w === a.w) rec('S', 'ЛС', `Life Stone снят с ${wn}`, { path });
}
let INV_NET = (() => { try { return JSON.parse(sessionStorage.getItem('l2bot-inv') || 'null'); } catch (e) { return null; } })();
let INV_READY = '', INV_READ = null, INV_RETRY = { key: '', n: 0, at: 0 };
const invContext = () => JSON.stringify([rt.char||'',rt.classCur?.prof??null,rt.classCur?.slot??null,leaseEpoch]);
const invNote = inv => { if (!Array.isArray(inv)) return null; const m = {}; for (const x of inv) if (Array.isArray(x) && x[0]) m[x[0]] = (m[x[0]] || 0) + (+x[1] || 0); return m; };
const invQty = id => INV_NET?.char === rt.char && !!rt.char && INV_NET?.m && Date.now() - (INV_NET.t || 0) < 300000 ? (INV_NET.m[id] ?? 0) : null;
// 9.2.5 (игрок 12.10: «не забывать проверять состояние рюкзака — что там у нас есть по факту»): сумка своим GET /character — свой запрос
// hook.js не видит, поэтому разбираем здесь (character.inventory.stacks, как invOf в hook.js). Адена — отдельно (character.adena)
async function invRefresh() {
  const char=rt.char,lease=leaseEpoch,classKey=JSON.stringify(rt.classCur||null),at=Date.now();
  try {
    const r = await gameGet('/character'); if (!r.ok) return null;
    const j = await r.json(), c = j?.character || j, st = c?.inventory?.stacks;
    if(!char||rt.char!==char||leaseEpoch!==lease||JSON.stringify(rt.classCur||null)!==classKey||c?.name!==char||(heroNick()&&heroNick()!==char))return null;
    if(c.l2Profession&&rt.classCur?.prof&&c.l2Profession!==rt.classCur.prof||Number.isInteger(c.classSlots?.activeSlot)&&Number.isInteger(rt.classCur?.slot)&&c.classSlots.activeSlot!==rt.classCur.slot)return null;
    const m = invNote(Array.isArray(st) ? st.filter(x => x && x.itemId).map(x => [+x.itemId, +x.qty || 0]) : null);
    if (!m) return null;
    INV_NET = { m, char:rt.char, t: Date.now() }; try { sessionStorage.setItem('l2bot-inv', JSON.stringify(INV_NET)); } catch (e) {}
    INV_READY = invContext();
    if (tabOwner) L2V7Modules.warlock?.noteSnapshot?.({...c,requestStartedAt:at});
    if (tabOwner && c?.inventory?.eq) L2V7Modules.mammon.eqNote(c.inventory.eq);
    return m;
  } catch (e) { return null; }
}
// 15.10, MV3 startup: hook начинает раньше content и первый netStart может быть
// потерян. Не принимаем чужой/непривязанный ответ: перед маршрутом сами читаем
// сумку текущего документа. Кэш прошлой страницы не доказывает текущие остатки.
async function inventoryReady() {
  if (!on || !tabOwner || !rt.char || heroNick()!==rt.char) return false;
  // Ручные задачи и сверка уже отправленной оплаты имеют собственный preflight.
  if (cfg.taskOnly || L2V7Modules.payments?.pending?.()) return true;
  const key=invContext();
  if (INV_READY===key && invQty(0)!==null) return true;
  if (INV_RETRY.key===key && Date.now()<INV_RETRY.at) return false;
  if (INV_READ) { await INV_READ; return on && tabOwner && key===invContext() && INV_READY===key; }
  const read=invRefresh(); INV_READ=read;
  try {
    const m=await read;
    if (!on || !tabOwner || key!==invContext()) return false;
    if (m) { INV_RETRY={key,n:0,at:0}; return INV_READY===key; }
    const n=INV_RETRY.key===key?INV_RETRY.n+1:1;
    INV_RETRY={key,n,at:Date.now()+Math.min(30000,2000*2**Math.min(4,n-1))};
    setStatus('Сверяю сумку с сервером; без подтверждения закупку и маршруты не начинаю');
    return false;
  } finally { if (INV_READ===read) INV_READ=null; }
}
const actNet = () => ACT_NET;
// 9.0 (катакомбы): список мобов подземелья целиком из ответа игры (hook.js поле dm: [id, тип, имя, ур., агр.]) и где герой по последнему
// снимку персонажа (character.activeDungeonId, locationType — в sessionStorage, переживает переход на другую страницу)
let DUNG_NET = null, BATTLE_NET = null;
let HERO_AT = (() => { try { return JSON.parse(sessionStorage.getItem('l2bot-at') || 'null'); } catch (e) { return null; } })();
const dungNet = () => DUNG_NET, heroAt = () => HERO_AT?.char === rt.char && !!rt.char && HERO_AT && Date.now() - (HERO_AT.t || 0) < 10 * 60000 ? HERO_AT : null;
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
// 15.10, ревизия: ответ без имени героя (TvT/карта/дейлики) принадлежит контексту начала запроса.
// Отдельно от трёхсекундного busy: поздний ответ не становится ответом нового персонажа.
const NET_CONTEXT = new Map();
const BUSY_PATH = /^\/(?:character|game\/battle\/(?:action|start|hunt-continue))$/;
function netContextStart(d) {
  if(d.rid==null)return;
  NET_CONTEXT.set(d.rid,{char:rt.char||'',hud:heroNick()||'',classKey:JSON.stringify([rt.classCur?.prof??null,rt.classCur?.slot??null]),lease:leaseEpoch,paymentId:L2V7Modules.payments?.claimRequest?.(d)||'',retryOf:d.retryOf||0,nativeNonce:rt.zoneGo?.nativeTp?.nonce||'',at:Date.now()});
  try { L2V7Modules.fishing?.castRequestNote?.(d); } catch (_) {}
  if(NET_CONTEXT.size>1000)NET_CONTEXT.delete(NET_CONTEXT.keys().next().value);
}
function netContextTake(d) {
  const c=NET_CONTEXT.get(d.rid);NET_CONTEXT.delete(d.rid);
  if(!c&&d.rid!=null)return false;
  const names=[d.hero?.name,d.res?.character?.name,d.pv?.owner?.name,d.pet?.name].filter(Boolean), char=rt.char||'',hud=heroNick()||'';
  if(c&&((c.char&&c.char!==char)||(c.hud&&c.hud!==char)||(c.lease&&c.lease!==leaseEpoch)||c.classKey!==JSON.stringify([rt.classCur?.prof??null,rt.classCur?.slot??null])))return false;
  if(char&&names.some(n=>n!==char)||hud&&char&&hud!==char)return false;
  return c||{};
}
function catPaymentReceipt(){try{return JSON.parse(sessionStorage.getItem('l2bot.catTpReceipt')||'null');}catch(_){return null;}}
function catPaymentNote(path,d,c){
  if(path!=='/game/catacombs/teleport'||d.method!=='POST'||!c?.paymentId)return;
  const req=d.req||{},ch=d.res?.character||{},a={t:Date.now(),id:req.dungeonId,expectedRevision:req.expectedRevision,expectedAdenaCost:req.expectedAdenaCost,
    characterId:ch.id,characterName:d.hero?.name||ch.name||'',ok:d.status>=200&&d.status<300&&!d.error&&!d.res?.error&&d.res?.ok!==false,status:d.status,paymentId:c.paymentId};
  try{sessionStorage.setItem('l2bot.catTpReceipt',JSON.stringify(a));}catch(_){}
}

const gameBusy = () => { const now = Date.now(); for (const [rid, t] of GAME_REQ) { if (now - t > 3000) GAME_REQ.delete(rid); else return { busy: true, end: GAME_END }; } return { busy: false, end: GAME_END }; };
addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin || e.data?.__l2bot !== 'netStart') return;
  netContextStart(e.data);
  const p = e.data.path || '/game/battle/action';
  if (p === '/game/battle/action') { ACT_NET.start++; ACT_NET.t = Date.now(); }   // 8.0.3: GET /character — не «ход ушёл»
  if (p === '/game/battle/hunt-continue') ACT_NET.huntT = Date.now();             // 10.0: «Охотиться дальше» в полёте (сервер замирает до ≈8,4 с)
  if (e.data.rid != null && BUSY_PATH.test(p)) { GAME_REQ.set(e.data.rid, Date.now()); if (GAME_REQ.size > 50) GAME_REQ.delete(GAME_REQ.keys().next().value); }
});
async function weaponEquipNote(req) {
  const char = rt.char, id = +req.itemId;
  if (req.action !== 'equip') {
    if (req.action === 'unequip' && /weapon|rhand|lrhand|^r$|^l1$/i.test(String(req.slot || ''))) {
      await setRt({weapons:(rt.weapons || []).map(w=>w.where==='надето'?{...w,where:'сумка'}:w),weaponsT:0,weaponEq:null,
        weaponMetaPending:{char,id:0,inst:'',revision:req.expectedRevision,t:Date.now(),status:'empty'}});
    }
    return;
  }
  if (!id) return;
  const known = L2V7Modules.equipment.weaponItem(id);
  if (known && (known.k !== 'W' || /удочка|питомца/.test(known.wt || ''))) return;
  const oldT = rt.weaponsT;
  const oldEquipped = (rt.weapons || []).find(w => w.where === 'надето');
  const mark = {char,id,inst:String(req.targetInstanceId || ''),revision:req.expectedRevision,t:Date.now(),status:'pending'};
  const current = () => rt.char === char && ['char','id','inst','revision','t'].every(k=>rt.weaponMetaPending?.[k]===mark[k]);
  // setRt ядра сразу обновляет память: старые A-заряды блокируются до первого await.
  const saving = setRt({weaponMetaPending:mark,weaponsT:0});
  await saving;
  if (!current()) return;
  await itemsDb();
  if (!current()) return;
  const it = await L2V7Modules.equipment.resolveWeaponItem(id);
  if (!current()) return;
  if (!it) { await setRt({weaponMetaPending:{...mark,status:'unknown'},weaponsT:0}); return; }
  if (it.k !== 'W' || /удочка|питомца/.test(it.wt || '')) { await setRt({weaponMetaPending:null,weaponsT:oldT}); return; }
  const W = (rt.weapons || []).map(x=>x.where==='надето'?{...x,where:'сумка'}:{...x});
  const ench = +req.enchant || 0, bonusesKnown = !ench || Number.isFinite(req.enchantPAtkBonus) && Number.isFinite(req.enchantMAtkBonus);
  const w = {id, en:it.n, name:it.n, wt:it.wt || '—', g:it.g || 'NG',
    pa:bonusesKnown && Number.isFinite(it.pa) ? it.pa + (+req.enchantPAtkBonus || 0) : null,
    ma:bonusesKnown && typeof it.ma === 'number' ? it.ma + (+req.enchantMAtkBonus || 0) : null,
    spd:it.spd || 0,two:!!it.two,requiredLevel:it.requiredLevel,weaponMode:it.weaponMode,
    ench,enchantUnknown:!bonusesKnown,where:'надето',inst:mark.inst};
  const index = W.findIndex(x=>x.id===id && (!x.inst || !w.inst || x.inst===w.inst));
  if (index>=0) W[index] = {...W[index],...w}; else W.push(w);
  await setRt({weapons:W,weaponsT:Date.now(),weaponEq:{id,g:w.g,t:Date.now()},weaponMetaPending:null,
    ...(oldEquipped?.id !== id ? {shopT:0} : {}),
    ...(rt.shopShotBad?.want && rt.shopShotBad.want !== w.g ? {shopShotBad:null} : {})});
  rec('B','оружие',`надето «${it.n}» (${w.g}, ${w.wt}) — заряды теперь под ${w.g}`);
}
// 10.0.19 (игрок 15.10: S-кастер уже надет до обновления расширения): POST смены оружия
// мог пройти без бота, тогда сохранённый A-кэш живёт весь фарм катакомб. Сверяем GET без выхода на карту.
async function syncShotWeapon() {
  if (!on || !tabOwner || !rt.shotMismatchPending && Date.now() - (rt.shotEquipCheckT || 0) < 600000) return;
  const char = rt.char;
  await setRt({shotEquipCheckT:Date.now()});
  try {
    const r = await gameGet('/character');
    if (!r?.ok || !on || !tabOwner || rt.char !== char) return;
    const j = await r.json(), c = j?.character || j, slot = c?.inventory?.eq?.l1;
    const id = +(slot && typeof slot === 'object' ? slot.itemId : slot) || 0;
    if (!id) return;
    if (!rt.shotMismatchPending && rt.weaponsT && (rt.weapons || []).some(w => w.where === 'надето' && +w.id === id)) return;
    await weaponEquipNote({action:'equip',itemId:id,expectedRevision:c.revision,
      targetInstanceId:slot?.targetInstanceId,enchant:slot?.enchant,
      enchantPAtkBonus:slot?.enchantPAtkBonus,enchantMAtkBonus:slot?.enchantMAtkBonus});
    if (rt.weaponsT && (rt.weapons || []).some(w => w.where === 'надето' && +w.id === id)) await setRt({shotMismatchPending:false});
  } catch (e) { rec('B','оружие','не удалось сверить надетое оружие; повторю позже'); }
}
let RAID_PAY_NET = null;
let SHOP_BUY = null;   // 7.1.30: последняя покупка в магазине вещей (shopKey из запроса)
function shopBuyReceipt(){const p=L2V7Modules.payments?.pending();if(SHOP_BUY?.paymentId===p?.id)return SHOP_BUY;try{const r=JSON.parse(sessionStorage.getItem('l2bot.shopReceipt')||'null');if(p&&r?.paymentId===p.id)return r;}catch(_){}return SHOP_BUY;}
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
  if (d.rid != null && GAME_REQ.delete(d.rid)) GAME_END = Date.now();
  const netContext=netContextTake(d);if(netContext===false)return;
  catPaymentNote(path,d,netContext);
  d.nativeNonce=netContext.nativeNonce||'';
  d.paymentId=netContext.paymentId||'';
  d.retryOf=netContext.retryOf||0;
  if(d.pet&&netContext.at)d.pet.requestStartedAt=netContext.at;
  // Сначала причина смерти; fightlab ниже не должен учить чужой PvP как урон РБ.
  try { L2V7Modules.pvp?.onNet(path, d); } catch (e) { console.warn(TAG, 'PvP', e); }
     // 8.0.3: запрос игры закончился — она снова принимает клики
  // 8.0.3 (логи 11.10 09:11–09:35): сразу после ответа на ход (и начала боя / «Охотиться дальше») игра ещё занята — время ответа нужно бою
  if (/^\/game\/battle\/(?:action|start|hunt-continue)$/.test(path)) ACT_NET.doneT = Date.now();
  if (path === '/game/battle/hunt-continue') ACT_NET.huntDoneT = Date.now();
  if (path === '/game/battle/action') { ACT_NET.done++; ACT_NET.ok = d.status >= 200 && d.status < 300 && !d.res?.error && !d.res?.blockedBy; ACT_NET.action = d.req?.action || ''; ACT_NET.rid = d.rid;
    if (ACT_NET.ok) ACT_NET.okN = (ACT_NET.okN || 0) + 1;                       // 10.0.8: принятых ходов всего — «не по зубам» считается только по ним
    if (+d.ms > 5000) ACT_NET.slowT = Date.now(); }                              // 10.0.8 (лог 13.10 17:17:49: банка 8,4 с): сервер висел — удары за это время не «урон 0»
  // 15.10 (лог 00:32): 207 отказов A-зарядам при S-кастере. Серверный отказ немедленно отменяет кэш оружия.
  if (path === '/game/battle/action' && /^(?:mystic_spiritshot|soulshot)_grade_mismatch$/.test(d.res?.error || '') && !rt.shotMismatchPending) {
    setRt({shotMismatchPending:true,shotEquipCheckT:0});
    rec('B','заряды','сервер отклонил грейд зарядов — сверяю надетое оружие перед следующим боем');
  }
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
  { const m = invNote(d.inv); if (m) { INV_NET = { m, char:rt.char, t: Date.now() }; try { sessionStorage.setItem('l2bot-inv', JSON.stringify(INV_NET)); } catch (e) {}
    INV_READY=invContext();
    if (tabOwner) try { L2V7Modules.tvtshop.shilNote(); } catch (er) {}   // 10.0: Shil Coins в сумке → rt.tsShil
    // 9.0: камни печати и Ancient Adena — для меню (раздел «Катакомбы»): пишем при изменении, не чаще раза в минуту
    const sg = [6360, 6361, 6362, 5575].map(id => m[id] || 0), ss = rt.sealSeen;
    if (tabOwner && (!ss || ss.q?.join() !== sg.join()) && Date.now() - (ss?.t || 0) > 60000) setRt({ sealSeen: { q: sg, t: Date.now() } }); } }
  // 10.0.2 (обновление игры 12.10 «Life Stone»): надетое оружие и его аугментация — для меню, боя и «не снимать оружие с ЛС»
  if (d.aug && tabOwner) try { augNote(d.aug, path); } catch (e) { console.warn(TAG, 'ЛС', e); }
  // 10.0.7 (ценность баффов): цифры героя из /character (hook.js hero) → rt.heroStats + снимки M.Atk под наборами баффов (rt.matkObs)
  if (d.hero && tabOwner) try { heroNote(d.hero); } catch (e) { console.warn(TAG, 'герой', e); }
  if (d.dm && Array.isArray(d.dm.mobs)) DUNG_NET = { id: d.dm.id, mobs: d.dm.mobs, t: Date.now() };
  // 14.10: в цепочке адрес может содержать первый spawnId. Для цвета используем актуальную цель принятого ответа игры.
  if (d.bt?.spawn && d.bt?.name && d.status >= 200 && d.status < 300 && !d.res?.error)
    BATTLE_NET = { spawn: d.bt.spawn, name: d.bt.name, kind: d.bt.kind, lvl: d.bt.lvl, max: d.bt.mobMax, tier: d.bt.tier || '', t: Date.now() };
  { const ch = d.res?.character; if (ch && typeof ch === 'object' && 'activeDungeonId' in ch) { HERO_AT = { char:rt.char, dung: ch.activeDungeonId ? String(ch.activeDungeonId) : null, loc: String(ch.locationType || ''), t: Date.now() };
    try { sessionStorage.setItem('l2bot-at', JSON.stringify(HERO_AT)); } catch (er) {} } }
  if (path === '/game/ancient-trader/exchange' && d.method === 'POST') SEAL_NET = { t: Date.now(), status: d.status, ok: d.status >= 200 && d.status < 300 && !d.error && !d.res?.error,
    msg: String(d.res?.messageRu || d.res?.messageUk || d.res?.error || d.error || '').slice(0, 160), stone: d.req?.stone, qty: +d.req?.qty || 0 };
  // 9.0: Маммон — экипировка (уровни плаща/пояса/тату), список кузнеца и заказ из запросов самой игры (игрок открыл страницу)
  // 10.0 (аудит ядра): игрок сменил персонажа, а память ещё прежнего (switchChar впереди) — заметки Маммона/квестов чужого героя не пишем в его rt
  const meNow = !heroNick() || rt.char === heroNick();
  if (meNow) { L2V7Modules.quests?.campLocationNote(path, d); L2V7Modules.fishing?.paymentNote?.(path,d); L2V7Modules.mammon?.paymentNote?.(path,d); L2V7Modules.tvtshop?.onNet?.(path,d); L2V7Modules.story?.onNet?.(path,d); }
  if (path === '/game/world/enter-city') warlockTownReceive(d,path);
  if (path === '/character' && d.pet && d.pet.name === rt.char && heroNick() === rt.char) L2V7Modules.warlock.noteSnapshot(d.pet);
  if (path === '/game/inventory/enchant' && d.method === 'POST' && heroNick() === rt.char && rt.enchant?.pending)
    Promise.resolve(L2V7Modules.enchant.note(d.req, d.res, d.status)).catch(e => console.warn(TAG, 'заточка: результат', e));
  if (tabOwner && meNow && d.status >= 200 && d.status < 300 && d.res) try {
    const ch = d.res.character; if (ch?.inventory?.eq) L2V7Modules.mammon.eqNote(ch.inventory.eq);
    if (path === '/game/mammon/blacksmith/upgrades' && Array.isArray(d.res.items)) L2V7Modules.mammon.smithNote(d.res.items);
    if (path === '/game/mammon/merchant/request' && d.res.request) L2V7Modules.mammon.orderNote(d.res.request);
    if (path === '/game/item-transfer/claim' && d.status === 200) { L2V7Modules.mammon.mailNote(); L2V7Modules.mammon.mailSeen(); }   // 9.2.5: ресурсы с почты → спросить кузнеца, перечитать почту (учёт возврата от крафтера)
  } catch (e) {}
  // 9.0 (новости игры 11.10): квесты сабкласса и Noblesse — из опросов самой игры (карта, страницы квестов); /character — свой Noblesse и класс
  if (tabOwner && meNow && d.status >= 200 && d.status < 300 && d.res && !d.res.error) try {
    const m = path.match(/^\/game\/story-quests\/(noblesse|subclass)$/);
    if (m && d.res.quest) L2V7Modules.story.qNote(m[1], d.res.quest);
    if (/^\/game\/story-quests\/starter-saga(?:\/[\w-]+)?$/.test(path) && d.res.quest) L2V7Modules.quests.sagaNote(d.res.quest);   // 10.0.10: сюжетный квест новичка → rt.storySaga (кампания авто)
    if (/^\/game\/story-quests\/dion-campaign(?:\/[\w-]+)?$/.test(path) && d.res.quest) L2V7Modules.quests.dionNote(d.res.quest);
    // только свой герой: /character, /character/subclasses*, страницы квестов (в ответах рейтинга/арены бывает чужой character)
    const ch = d.res.character; if (ch && typeof ch === 'object' && /^\/(?:character(?:\/subclasses(?:\/\w+)?)?|game\/story-quests\/[\w-]+(?:\/\w+)?)$/.test(path)) L2V7Modules.story.charNote(ch), L2V7Modules.subclass.charNote(ch);   // 10.0.7: + слоты классов (заготовка под сабы)
  } catch (e) {}
  if (!path || /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ico)$/i.test(path)) return;
  if (!pageLeaving) observeGameHttp(path, d.status);
  logCooldownApi(d, path);
  const secret = /login|auth|register|passw|token|session|sign-?in|sign-?up|enter-game|account/i.test(path);   // v5.6: + вход/регистрация в других написаниях
  const key = `${d.method} ${path}`, body = secret ? '(скрыто)' : d.res != null ? JSON.stringify(d.res) : '';
  if (path === '/game/battle/leave' && d.method === 'POST' && d.status >= 200 && d.status < 300 && !d.error && !d.res?.error) leaveOk(d.req?.battleSpawnId);
  if (path === '/game/battle/leave' && d.method === 'POST' && rt.epic?.step === 'retreatVerify') {
    const id = d.req?.battleSpawnId;
    if (id && id === rt.epic.id) try { sessionStorage.setItem('l2bot.epicLeave', JSON.stringify({ id, at: Date.now(), ok: !d.error && d.status >= 200 && d.status < 300 && !d.res?.error })); } catch (er) {}
  }
  // 8.0.3 (эпики, разбор 11.10): список эпиков и цифры босса — пассивно, когда их запрашивает сама игра (страница «Эпик боссы», нажатие
  // на РБ на карте). Список — только полный (все элементы объекты и их ровно total: hook.js режет массивы длиннее 8)
  // 8.0.3 (лог 11.10 11:41–11:44: total 8 — ровно на пределе обрезки): hook.js отдаёт bosses целиком полем eb (как inv/sp) — 9-й эпик
  // не выключит разбор молча
  // 10.0.2: списки РБ и эпиков, которые запрашивает сама игра (страница «Рейдовые боссы» / «Эпик боссы»), — в таймеры боссов
  if (/^\/game\/(?:raid|epic)-bosses$/.test(path) && Array.isArray(d.eb) && d.res && !d.res.error && !d.error)
    try { L2V7Modules.rbtimer.listNote({ ...d.res, bosses: d.eb }, 'страница').catch(() => {}); } catch (er) {}
  { const eb = epicNetList(d, path);
    if (eb) try { L2V7Modules.epics.epicApiNote(eb, 'page').then(r => r && L2V7Modules.epics.epicVerdictAll()).catch(() => {}); } catch (er) {} }
  // 8.0.3 (логи 11.10 10:32:50, 11:43:34, 11:44:46): телепорт к РБ/эпику (бот или игрок) и «Вернуться в город» после смерти уносят героя —
  // прежняя зона больше не та: EXP/ч и «зона РБ» писались в чужую (Ядро@bee_hive), автофарм решал «остаюсь здесь» по ней. Зону и «мягкое
  // окно» уровней определит карта заново
  try { L2V7Modules.navigation.onForumTeleportNet(path, d); } catch (er) { console.warn(TAG, 'телепорт ресурсов', er); }
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
    // 14.10: выбывшего участника игра уводит в чат; после reload нельзя вновь вести его на арену того же события.
    const alive = TVT.selfCombat?.alive, selfCombat = typeof alive === 'boolean' ? { alive } : null;
    const k = `${TVT.eventId}|${TVT.phase}|${TVT.isRegistered}|${alive ?? ''}`; if (rt.tvt?.k !== k) setRt({ tvt: { k, eventId: TVT.eventId, phase: TVT.phase, isRegistered: TVT.isRegistered, myTeam: TVT.myTeam, startsAt: TVT.startsAt, registrationEndsAt: TVT.registrationEndsAt, registeredCount: TVT.registeredCount, maxPlayers: TVT.maxPlayers, off: TVT.off, schedule: TVT.schedule, selfCombat, t: Date.now() } }); }
  if (/\/game\/tvt\/(combat\/sync|target|target\/clear)$/.test(path) && d.res && !d.res.error) TVTC = { ...d.res, t: Date.now() };
  if (path === '/game/tvt/action' && d.res && !d.res.error && TVTC?.selectedTarget) TVTC.selectedTarget = { ...TVTC.selectedTarget, hp: d.res.targetHp, cp: d.res.targetCp, alive: !d.res.targetDead };
  // 10.0.11 (лог 13.10 22:00): скиллы арены (MP, откат) и ответ на каждый удар — для выбора приёма по MP и для «клик ушёл на сервер?»
  if (path === '/game/tvt/skills' && Array.isArray(d.res?.skills)) {
    const complete = d.res.skills.every(x => x && typeof x === 'object');
    if (complete || !TVTS?.complete || TVTS.event !== tvtState()?.id) TVTS = { skills: d.res.skills.filter(x => x && typeof x === 'object').map(x => ({ ...x })), complete, event: tvtState()?.id, t: Date.now() };
  }
  if (path === '/game/tvt/action') { TVTC = TVTC || { t: 0 }; TVTC.actT = Date.now(); TVTC.actN = (TVTC.actN || 0) + 1;
    const r = d.res && !d.res.error ? d.res : null, sk = r?.skillId ?? d.req?.skillId;
    if (r) { if (r.combatVersion) TVTC.combatVersion = r.combatVersion; if (r.selfMp != null) { TVTC.selfMp = r.selfMp; TVTC.mpT = Date.now(); } if (r.nextBasicAttackAt) TVTC.nextBasicAttackAt = r.nextBasicAttackAt; TVTC.actErr = null; }
    else TVTC.actErr = { err: d.res?.error || d.error || String(d.status || ''), t: Date.now() };
    const ent = sk != null && TVTS?.skills?.find(x => x.skillId === sk);
    if (ent) { if (r?.skillReadyAt) ent.readyAt = r.skillReadyAt; else if (d.res?.error === 'tvt_skill_cooldown' && !(tvtMs(ent.readyAt) > tvtNow())) ent.readyAt = tvtNow() + 1200; } }
  // 9.2 (лог 11.10 03:00): павший враг — по ответу удара (targetDead) или отказу выбрать цель (tvt_target_dead), см. tvt.tvtDeadNote
  if (path === '/game/tvt/action' && d.res?.targetDead) L2V7Modules.tvt.tvtDeadNote(d.res.targetCharacterId || TVTC?.selectedTarget?.characterId);
  if (path === '/game/tvt/shop/catalog' && tabOwner && Array.isArray(d.res?.categories)) try { L2V7Modules.tvtshop.shopNote(d.res); } catch (er) {}
  if (path === '/game/daily-quests' && tabOwner && d.res?.tasks) try { L2V7Modules.dailies.dailyNote(d.res); } catch (er) {}   // 10.0: страница «Ежедневные задания»
  if (path === '/game/clan-tasks' && tabOwner && d.res && !d.error) try { L2V7Modules.dailies.clanNote(d.res); } catch (er) {}   // 10.0: страница «Клановые задания»   // 10.0: каталог магазина TvT
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
  if (['/game/battle/sync', '/game/battle', '/game/battle/start', '/game/battle/hunt-continue'].includes(path) && d.res && !d.res.error && d.status >= 200 && d.status < 300) {
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
    const r = d.res, b = r.delta && typeof r.delta === 'object' ? r.delta : r.battle && typeof r.battle === 'object' ? r.battle : {}, nowS = r.serverNowMs || r.nowMs || b.serverNowMs;
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
  if (d.res && typeof d.res === 'object') try { abNet(path, d.res); } catch (er) {}   // 10.0.2: проверка активности выдана / пройдена
  if (d.res?.code === 'pve_farm_blocked' || d.res?.error === 'pve_farm_blocked') try {   // v5.5.6: игра заблокировала PvE-фарм
    const u = Date.parse(d.res.blockedUntil || '') || (d.res.remainingSeconds ? Date.now() + d.res.remainingSeconds * 1000 : 0);
    if (u && u !== rt.pveBlockUntil) setRt({ pveBlockUntil: u, pveBlockMsg: d.res.messageRu || d.res.messageUk || '' });
  } catch (er) {}
  // 7.1.30 (лог 10.10 15:43): игрок сам надел Demon's Staff (C), а бот помнил «надето: Лялька вуду NG» и купил 3000 NG-зарядов.
  // Надевание оружия видно по запросу к серверу — сразу обновляем «надетое» по базе предметов (грейд, тип, P/M.Atk)
  if (path === '/character/equip' && d.method === 'POST' && d.req && !d.error && /^2/.test(String(d.status)) && !d.res?.error) try { weaponEquipNote(d.req); } catch (er) {}
  if (path === '/game/raid-boss/teleport' && d.method === 'POST') RAID_PAY_NET = { t: Date.now(), id: String(d.req?.spawnId || ''), ok: !d.error && /^2/.test(String(d.status)) && !d.res?.error };
  if (path === '/game/drops-shop/buy' && d.method === 'POST') SHOP_BUY = { t: Date.now(), status:d.status,paymentId:d.paymentId||'',key: String(d.req?.shopKey || ''), qty: +d.req?.qty || 0, ok: !d.error && /^2/.test(String(d.status)) && !d.res?.error };
  if(path==='/game/drops-shop/buy'&&d.method==='POST'&&d.paymentId)try{sessionStorage.setItem('l2bot.shopReceipt',JSON.stringify(SHOP_BUY));}catch(_){}
  // v5.3: для сторожа рыбалки. 8.0.3 (лог 11.10): + обрыв запроса (err — fishAct сразу жмёт снова, а не ждёт 15 с), отметка сервера
  // serverNowMs и длительность запроса (откат считается от того, когда сервер принял нажатие, — fishing.fishNet), fishing.cooldowns
  if (/\/game\/fishing\/action$/.test(path)) {
    const fz = d.res?.fishing && typeof d.res.fishing === 'object' ? d.res.fishing : null;
    NET_FISH = { t: Date.now(), status:+d.status||0, ok: !d.error && /^2/.test(String(d.status)), act: d.req?.action || '', err: d.error ? String(d.error) : '', code: String(d.res?.error || ''), srv: +fz?.serverNowMs || 0, ms: +d.ms || 0, cds: fz?.cooldowns };
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
  const txt = l => { const b = l.querySelector('.l2-battle-log-line__body'); if (!b || b.children.length <= 1) return l.textContent;
    // 14.10: новый renderer вынес «Спойл:» за body; без префикса добыча не попадает в статистику.
    const prefix = l.querySelector('.l2-battle-log-line__spoil-prefix')?.textContent.trim();
    return [prefix, ...[...b.children].map(c => c.textContent.trim())].filter(Boolean).join(' '); };
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


// Служебные просмотры тоже завершают свой маршрут прежде чужого сервиса.
async function actionScanStep(key){
 const cfg0=()=>on&&tabOwner&&L2V7Modules.actions.canAct();
 if(key==='fishSvc'||key==='fishService'){
  const svc=rt.fishService||'cut',char=svc!=='exchange';
  if(char&&!isChar()||!char&&!isFishShop()){if(await rtCommit()&&cfg0())actionLocation.href=char?'/char.html':'/fishing-shop.html';await sleep(4000);return;}
  if(svc==='cut')await fishCut();else if(svc==='exchange')await fishExchange();else if(svc==='rod')await rodEnchant();return;
 }
 const page={bagCheck:'/char.html',faScan:'/fast-aden-buffer.html',recipeScan:RECIPE_URL,farmScan:FARM_URL,rbScan:'/rb-bosses.html',zoneScan:'/teleport.html'}[key];
 if(page&&location.pathname!==page){if(await rtCommit()&&cfg0())actionLocation.href=page;await sleep(4000);return;}
 if(key==='farmScan')return farmScan();if(key==='rbScan')return rbListScan();if(key==='zoneScan')return zoneCatalogScan();
 if(key==='bagCheck')await bagCounts();
 if(key==='faScan'){await waitX(()=>$q('.l2-fa-buy[data-skill-id]'),8000,200);faCatalogNote();}
 if(key==='recipeScan'){await waitX(()=>$q('article.l2-recipe-hunt-recipe'),12000,300);await recipeSave();}
 if(!cfg0())return;await setRt({[key]:null});if(await rtCommit()&&cfg0())actionLocation.href=fishNow()?'/fishing.html':'/map.html';
}

// 10.0.24: реестр продолжений. Read-only опросы не приобретают маршрут.
L2V7Modules.actions = L2V7Factories.actions({
 get rt(){return rt},get cfg(){return cfg},get on(){return on},get tabOwner(){return tabOwner},
 get mode(){return autonomyMode},get lease(){return ()=>leaseEpoch},get page(){return ()=>location.pathname+location.search},
 get id(){return ()=>crypto.randomUUID()},get setRt(){return setRt},get rtCommit(){return rtCommit},get rec(){return rec},get setStatus(){return setStatus},get halt(){return halt},get isBattle(){return isBattle},
 get interrupted(){return ()=>!!rt.revive||!!L2V7Modules.pvp?.pending()||!!antibotState()||(cfg.tvtOn&&L2V7Modules.tvt.tvtHold())},
 get paymentPending(){return ()=>L2V7Modules.payments?.pending?.()||(rt.petFull?.pending?{...rt.petFull.pending,kind:'summon-buff'}:rt.enchant?.pending?{...rt.enchant.pending,kind:'enchant'}:null)},
 get runCombat(){return battle},get victory(){return victory},
 get reconcile(){return async P=>{if(P.kind==='enchant'){await enchantAccounting();return;}const m=P.kind==='summon-buff'?'warlock':P.kind==='shop'?'economy':/buff$/.test(P.kind)?'buffs':P.kind==='raid-teleport'?'raid':P.kind==='cat-teleport'?'dungeons':P.kind==='fishing'?'fishing':P.kind==='tvt-shop'?'tvtshop':P.kind==='story-teleport'?'story':/^mammon(?:-|$)/.test(P.kind)?'mammon':null;if(m&&L2V7Modules[m]?.paymentReconcile)await L2V7Modules[m].paymentReconcile();if(L2V7Modules.payments?.pending?.())setStatus('Оплата не подтверждена: сверяю результат, повторно не плачу');}},
 get jobs(){return ()=>[
  {key:'tbuff',run:townBuffStep},{key:'petBufferTrip',run:warlockTripStep},{key:'shop',run:shopStep},
  {key:'magister',run:async()=>{await magisterDisable();if(rt.magister)await magisterStep();}},{key:'invScan',run:invScanStep},{key:'mmJob',run:()=>L2V7Modules.mammon.mmStep()},
  {key:'storyJob',run:()=>L2V7Modules.story.storyStep()},{key:'tsJob',run:()=>L2V7Modules.tvtshop.shopStep()},
  ...(rt.rbHunt?.step==='exit'?[{key:'rbHunt',run:()=>L2V7Modules.raid.rbHuntStep()}]:[]),
  {key:'rbGo',run:rbGoStep},{key:'zoneGo',run:zoneGoStep},
  ...['bagCheck','faScan','recipeScan','farmScan','rbScan','zoneScan','fishSvc',...(fishNow()&&['cut','exchange','rod'].includes(rt.fishService)?['fishService']:[])].map(key=>({key,run:()=>actionScanStep(key)}))
 ]}
});
const actionLocation=L2V7Modules.actions.locationProxy(location);
L2V7Modules.payments = L2V7Factories.payments({
 get rt(){return rt},get setRt(){return setRt},get rtCommit(){return rtCommit},get on(){return on},get tabOwner(){return tabOwner},get rec(){return rec},get autonomyMode(){return autonomyMode},
 get lease(){return ()=>leaseEpoch},get paymentContext(){return ()=>L2V7Modules.actions.context()},get canRun(){return ()=>L2V7Modules.actions.canAct()},get externalPending(){return ()=>!!rt.petFull?.pending||!!rt.enchant?.pending}
});


// ===== v7 dependency injection: lazy bindings preserve per-character dynamic state =====
L2V7Modules.fishing = L2V7Factories.fishing({ get castEvidence(){return async at=>{let timer;try{return await Promise.race([chrome.runtime.sendMessage({cmd:'fishingCastEvidence',at}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2500)})]);}catch(_){return null}finally{clearTimeout(timer)}}}, get payments(){return L2V7Modules.payments},get leaseEpoch(){return leaseEpoch}, get routeLocation(){return actionLocation}, get tvtStep() { return tvtStep; }, get antibotState() { return antibotState; }, get tabOwner() { return tabOwner; }, get dailyFishNote() { return () => L2V7Modules.dailies?.fishNote?.(); }, get waitX(){return waitX}, get rtCommit(){return rtCommit}, get gameGet(){return gameGet}, get gamePost(){return gamePost}, get canRun(){return ()=>!tvtSoon()&&!L2V7Modules.pvp?.pending()&&!rt.revive}, get $q() { return $q; }, set $q(value) { $q = value; },
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
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.epics = L2V7Factories.epics({ get pauseBot(){return pauseBot}, get canAct(){return ()=>L2V7Modules.actions.canAct()},get canRun(){return ()=>!tvtSoon()&&!antibotState()&&!L2V7Modules.pvp?.pending()&&!rt.revive}, get routeLocation(){return actionLocation}, get shown() { return shown; }, get rbTimerListNote() { return (...a) => L2V7Modules.rbtimer.listNote(...a); }, get faFullIds() { return (...a) => L2V7Modules.buffs.faFullIds(...a); }, get faCost() { return faCost; }, get gameAuth() { return gameAuth; }, get invQty() { return invQty; }, get rbInfo() { return (...a) => L2V7Modules.raid.rbInfo(...a); }, get rbPreCheck() { return rbPreCheck; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get tabOwner() { return tabOwner; },
  get EPICS() { return EPICS; }, set EPICS(value) { EPICS = value; },
  get EPIC_URL() { return EPIC_URL; }, set EPIC_URL(value) { EPIC_URL = value; },
  get LV_RE() { return LV_RE; }, set LV_RE(value) { LV_RE = value; },
  get aroundSig() { return aroundSig; }, set aroundSig(value) { aroundSig = value; },
  get attackSpawn() { return attackSpawn; }, set attackSpawn(value) { attackSpawn = value; },
  get buffWaitBeforeRb() { return buffWaitBeforeRb; }, set buffWaitBeforeRb(value) { buffWaitBeforeRb = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.raid = L2V7Factories.raid({ get idleFarmAllowed(){return ()=>!Array.isArray(cfg.autoTasks)||['farm','auto'].includes(L2EngineCore.selectedTask(cfg,rt))||(L2EngineCore.selectedTask(cfg,rt)==='quests'&&campOn())||(L2EngineCore.taskAllowed(cfg,'resources')&&!!lootGoal())}, get IL(){return IL}, get tourReadReady(){return ()=>!rt.revive&&!L2V7Modules.pvp?.pending()&&!antibotState()&&!(cfg.tvtOn&&L2V7Modules.tvt.tvtHold())}, get canAct(){return ()=>L2V7Modules.actions.canAct()}, get raidPaymentNet(){return ()=>RAID_PAY_NET}, get rtCommit(){return rtCommit}, get payments(){return L2V7Modules.payments}, get routeLocation(){return actionLocation},
  get gameGet() { return gameGet; },
  get warlock() { return L2V7Modules.warlock; }, get pauseBot() { return pauseBot; }, get rbTimer() { return L2V7Modules.rbtimer; }, get storyRbIds() { return () => L2V7Modules.story.rbIds(); }, get gameAuth() { return gameAuth; }, get shopNeedByPanel() { return shopNeedByPanel; }, get mobHp() { return mobHp; }, get faIdsOf() { return (...a) => L2V7Modules.buffs.faIdsOf(...a); }, get faFullIds() { return (...a) => L2V7Modules.buffs.faFullIds(...a); }, get faLow() { return (...a) => L2V7Modules.buffs.faLow(...a); }, get hudBuffs() { return hudBuffs; }, get townBuffNeed() { return () => L2V7Modules.buffs.townBuffNeed(); }, get setCfg() { return setCfg; }, get rbNote() { return rbNote; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get tabOwner() { return tabOwner; },
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
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.combat = L2V7Factories.combat({ get ordinaryLiveTour(){return (...args)=>L2V7Modules.raid.ordinaryLiveTour(...args)}, get battleExitContext(){return ()=>JSON.stringify([rt.char||'',leaseEpoch,rt.manualKickAt||0,autonomyMode()])}, get evidenceOwner() { return observeOwner; }, get damageSkills() { return damageSkills(); }, get activeBuffs(){return activeBuffs}, get routeLocation(){return actionLocation}, get tvtStep() { return tvtStep; },
  get fightHealOn() { return n => L2V7Modules.fightlab.healOn(n); },
  get warlock() { return L2V7Modules.warlock; }, get champs() { return L2V7Modules.champs; }, get rbRun() { return L2V7Modules.rbrun; }, get farmRules() { return farmRules; }, get recipeRules() { return recipeRules; }, get cancelNote() { return (...a) => L2V7Modules.buffs.cancelNote(...a); }, get champTier() { return (...a) => L2V7Modules.mobfarm.champTier(...a); }, get leaveMark() { return leaveMark; }, get rbTimerKill() { return (...a) => L2V7Modules.rbtimer?.kill(...a); }, get fightGroupOn() { return (...a) => L2V7Modules.fightlab.groupOn(...a); }, get fightDamage() { return (...a) => L2V7Modules.fightlab.damageFor(...a); }, get fightDmgOn() { return fightDmgOn; }, get fightKillP() { return fightKillP; }, get fightSpikeEta() { return fightSpikeEta; }, get campChampOpen() { return campChampOpen; }, get campChampMin() { return campChampMin; }, get rbFlee() { return (...a) => L2V7Modules.raid.rbFlee(...a); }, get probeFight() { return (...a) => L2V7Modules.raid.probeFight(...a); }, get srvUp() { return srvUp; }, get srvHangMark() { return srvHangMark; }, get noEffect() { return noEffect; }, get actNet() { return actNet; }, get gameBusy() { return gameBusy; }, get petState() { return petState; }, get combatProfileKind() { return combatProfileKind; }, get HP_POT_RE() { return HP_POT_RE; }, get rbRetreat() { return rbRetreat; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get battleInfo() { return () => BATTLE_NET; },
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
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
  get waitX() { return waitX; }, set waitX(value) { waitX = value; },
  get pvpPending() { return () => !!L2V7Modules.pvp?.pending(); }, get pvpRecoveryStep() { return () => L2V7Modules.pvp.recoveryStep(); }
});
L2V7Modules.dungeons = L2V7Factories.dungeons({ get payments(){return L2V7Modules.payments},get gameGet(){return gameGet},get canAct(){return ()=>L2V7Modules.actions.canAct()},get canRun(){return ()=>!tvtSoon()&&!antibotState()&&!L2V7Modules.pvp?.pending()&&!rt.revive},get catPaymentNet(){return ()=>catPaymentReceipt()}, get routeLocation(){return actionLocation}, get dungNet() { return dungNet; }, get heroAt() { return heroAt; }, get gameAlert() { return gameAlert; }, get sealNet() { return sealNet; }, get invQty() { return invQty; }, get rtCommit() { return rtCommit; }, get rnd() { return rnd; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get tabOwner() { return tabOwner; },
  get champs() { return L2V7Modules.champs; }, get champTier() { return (...args) => L2V7Modules.mobfarm.champTier(...args); },
  get cancelRisk() { return (...args) => L2V7Modules.buffs.cancelRisk(...args); },
  get campActive() { return campActive; },
  get campChampOpen() { return campChampOpen; },
  get CAT_LIST() { return CAT_LIST; }, set CAT_LIST(value) { CAT_LIST = value; },
  get CAT_URL() { return CAT_URL; }, set CAT_URL(value) { CAT_URL = value; },
  get NET_ERR() { return NET_ERR; }, set NET_ERR(value) { NET_ERR = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.tvt = L2V7Factories.tvt({ get routeLocation(){return actionLocation}, get autonomyMode() { return autonomyMode; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get gameGet() { return gameGet; }, get victory() { return victory; }, get leaveMark() { return leaveMark; },
  get TVT() { return TVT; }, set TVT(value) { TVT = value; },
  get TVTC() { return TVTC; }, set TVTC(value) { TVTC = value; },
  get TVTS() { return TVTS; }, set TVTS(value) { TVTS = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
  get cleanTitle() { return cleanTitle; }, set cleanTitle(value) { cleanTitle = value; },
  get fire() { return fire; }, set fire(value) { fire = value; },
  get meMp() { return meMp; }, get slotAction() { return slotAction; }, get toMap() { return toMap; },
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
L2V7Modules.mobfarm = L2V7Factories.mobfarm({ get scanContext(){return ()=>JSON.stringify([rt.char,leaseEpoch,rt.manualKickAt,autonomyMode()])}, get canScanMap(){return ()=>!tvtSoon()&&!antibotState()&&!L2V7Modules.pvp?.pending()&&!rt.revive}, get damageSkills() { return damageSkills(); }, get routeLocation(){return actionLocation}, get tvtStep() { return tvtStep; },
  get syncShotWeapon() { return syncShotWeapon; },
  get warlock() { return L2V7Modules.warlock; }, get NET_ERR() { return NET_ERR; }, get magisterAfterWin() { return () => magisterStart(true); }, get magisterHold() { return magisterHold; }, get campEnabled() { return campEnabled; }, get champs() { return L2V7Modules.champs; }, get cancelRisk() { return (...a) => L2V7Modules.buffs.cancelRisk(...a); }, get actNet() { return actNet; }, get mmChainWant() { return () => L2V7Modules.mammon?.chainWant?.(); }, get storyChainWant() { return () => L2V7Modules.story?.chainWant?.(); }, get tsChainWant() { return () => L2V7Modules.tvtshop?.chainWant?.(); }, get lootGoal() { return lootGoal; }, get farmMapOn() { return farmMapOn; }, get invQty() { return invQty; }, get autonomyMode() { return autonomyMode; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get rbModalIs() { return (...a) => L2V7Modules.raid.rbModalIs(...a); },
  get tabOwner() { return tabOwner; },
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
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
  get zonePick() { return zonePick; }, set zonePick(value) { zonePick = value; },
  get pvpPending() { return () => !!L2V7Modules.pvp?.pending(); }, get pvpRecoveryStep() { return () => L2V7Modules.pvp.recoveryStep(); }, get antibotState() { return antibotState; }, get pvpStep() { return () => L2V7Modules.pvp.step(); }
});
L2V7Modules.quests = L2V7Factories.quests({ get gameGet(){return gameGet}, get rtCommit(){return rtCommit}, get tabOwner(){return tabOwner}, get canAct(){return ()=>L2V7Modules.actions.canAct()}, get routeLocation(){return actionLocation}, get $q() { return $q; }, set $q(value) { $q = value; }, get heroLvl() { return heroLvl; },
  get QLINE() { return QLINE; }, set QLINE(value) { QLINE = value; },
  get TAG() { return TAG; }, set TAG(value) { TAG = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.navigation = L2V7Factories.navigation({ get rtCommit(){return rtCommit}, get canAct(){return ()=>L2V7Modules.actions.canAct()}, get routeLocation(){return actionLocation}, get heroAt() { return heroAt; }, get pauseBot() { return pauseBot; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get tabOwner() { return tabOwner; },
  get gameGet() { return gameGet; },
  get pagerInfo() { return pagerInfo; },
  get kpd() { return globalThis.L2Kpd; }, get kpdMage() { return kpdMage; },
  get BACK() { return BACK; }, set BACK(value) { BACK = value; },
  get byText() { return byText; }, set byText(value) { byText = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.buffs = L2V7Factories.buffs({ get tabOwner(){return tabOwner}, get leaseEpoch(){return leaseEpoch}, get payments(){return L2V7Modules.payments},get gameGet(){return gameGet}, get routeLocation(){return actionLocation}, get heroStatsFor() { return heroStatsFor; }, get epicBuffCol() { return (...a) => L2V7Modules.epics.epicBuffCol(...a); }, get epicBuffPay() { return (...a) => L2V7Modules.epics.epicBuffPay(...a); }, get epicBuffRelease() { return (...a) => L2V7Modules.epics.epicBuffRelease(...a); }, get epicFaOk() { return (...a) => L2V7Modules.epics.epicFaOk(...a); }, get heroRole() { return (...a) => L2V7Modules.fightlab?.role?.(...a); }, get autonomyMode() { return autonomyMode; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get BUFF_CTX() { return BUFF_CTX; }, set BUFF_CTX(value) { BUFF_CTX = value; },
  get DEAD_RE() { return DEAD_RE; }, set DEAD_RE(value) { DEAD_RE = value; },
  get FA_KNOWN() { return FA_KNOWN; }, set FA_KNOWN(value) { FA_KNOWN = value; },
  get IL() { return IL; }, set IL(value) { IL = value; },
  get IL_BY_NAME() { return IL_BY_NAME; }, set IL_BY_NAME(value) { IL_BY_NAME = value; },
  get TB_KEYS() { return TB_KEYS; }, set TB_KEYS(value) { TB_KEYS = value; },
  get TOTEM_MIN() { return TOTEM_MIN; }, set TOTEM_MIN(value) { TOTEM_MIN = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.equipment = L2V7Factories.equipment({ get damageSkills() { return damageSkills(); }, get scanLocation(){return (st,char)=>L2V7Modules.actions.locationProxy(location,()=>invBusy&&!running&&st.manual&&rt.char===char&&(!rt.invScan||rt.invScan.t===st.t))}, get routeLocation(){return actionLocation}, get gameGet() { return gameGet; }, get tabOwner() { return tabOwner; }, get noEffect() { return noEffect; }, get on(){return on},  get combatProfileKind() { return combatProfileKind; }, get normalizeProfession() { return normalizeProfession; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get CLASS_W() { return CLASS_W; }, set CLASS_W(value) { CLASS_W = value; },
  get EQUIP_OK() { return EQUIP_OK; }, set EQUIP_OK(value) { EQUIP_OK = value; },
  get FREE_HIT() { return FREE_HIT; }, set FREE_HIT(value) { FREE_HIT = value; },
  get GRADE_LV() { return GRADE_LV; }, set GRADE_LV(value) { GRADE_LV = value; },
  get MAGE() { return MAGE; }, set MAGE(value) { MAGE = value; },
  get SLOT() { return SLOT; }, set SLOT(value) { SLOT = value; },
  get TAG() { return TAG; }, set TAG(value) { TAG = value; },
  get baseName() { return baseName; }, set baseName(value) { baseName = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.economy = L2V7Factories.economy({ get tabOwner(){return tabOwner}, get leaseEpoch(){return leaseEpoch}, get gameGet(){return gameGet}, get payments(){return L2V7Modules.payments}, get routeLocation(){return actionLocation}, get shopBuyNet(){return shopBuyReceipt}, get invQty() { return invQty; }, get mmShopWant() { return () => L2V7Modules.mammon?.mmShopWant?.() || []; },  get GRADE_LV() { return GRADE_LV; }, get SLOT() { return SLOT; }, get combatProfileKind() { return combatProfileKind; }, get heroLevel() { return heroLevel; }, get autonomyMode() { return autonomyMode; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get BSPS_IDS() { return BSPS_IDS; }, set BSPS_IDS(value) { BSPS_IDS = value; },
  get HP_BIG_RE() { return HP_BIG_RE; }, set HP_BIG_RE(value) { HP_BIG_RE = value; },
  get HP_SHOP_RE() { return HP_SHOP_RE; }, set HP_SHOP_RE(value) { HP_SHOP_RE = value; },
  get ITEMS() { return ITEMS; }, set ITEMS(value) { ITEMS = value; },
  get MAGE() { return MAGE; }, set MAGE(value) { MAGE = value; },
  get SHOT_IDS() { return SHOT_IDS; }, set SHOT_IDS(value) { SHOT_IDS = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
  get shotGrade() { return (...a) => L2V7Modules.economy.shotGrade(...a); }, get shotsMage() { return (...a) => L2V7Modules.economy.shotsMage(...a); }, get $q() { return $q; }, get shown() { return shown; },
  get MP_REGEN() { return MP_REGEN; }, set MP_REGEN(value) { MP_REGEN = value; },
  get POT_LAST() { return POT_LAST; }, set POT_LAST(value) { POT_LAST = value; },
  get SLOT() { return SLOT; }, set SLOT(value) { SLOT = value; },
  get TAG() { return TAG; }, set TAG(value) { TAG = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.loot = L2V7Factories.loot({ get tabOwner(){return tabOwner},get leaseEpoch(){return leaseEpoch}, get heroLvl() { return heroLvl; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get LOOT_RE() { return LOOT_RE; }, set LOOT_RE(value) { LOOT_RE = value; },
  get SPECIAL_RE() { return SPECIAL_RE; }, set SPECIAL_RE(value) { SPECIAL_RE = value; },
  get SPOIL_FAIL() { return SPOIL_FAIL; }, set SPOIL_FAIL(value) { SPOIL_FAIL = value; },
  get SPOIL_LOOT() { return SPOIL_LOOT; }, set SPOIL_LOOT(value) { SPOIL_LOOT = value; },
  get SPOIL_OK() { return SPOIL_OK; }, set SPOIL_OK(value) { SPOIL_OK = value; },
  get SWEEP_OK() { return SWEEP_OK; }, set SWEEP_OK(value) { SWEEP_OK = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
L2V7Modules.survival = L2V7Factories.survival({ get on(){return on}, get tabOwner(){return tabOwner}, get leaseEpoch(){return leaseEpoch}, get routeLocation(){return actionLocation}, get epicDbSet() { return epicDbSet; }, get rbRun() { return L2V7Modules.rbrun; }, get $q() { return $q; }, set $q(value) { $q = value; },
  get byText() { return byText; }, set byText(value) { byText = value; },
  get cfg() { return cfg; }, set cfg(value) { cfg = mergeCfg(value); },
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
  get waitFor() { return waitFor; }, set waitFor(value) { waitFor = value; },
  get pvpPending() { return () => !!L2V7Modules.pvp?.pending(); }, get pvpRecoveryStep() { return () => L2V7Modules.pvp.recoveryStep(); }
});

L2V7Modules.mammon = L2V7Factories.mammon({ get payments(){return L2V7Modules.payments},get leaseEpoch(){return leaseEpoch},get rtCommit(){return rtCommit}, get routeLocation(){return actionLocation}, get $q() { return $q; }, get pauseBot() { return pauseBot; }, get FARM() { return FARM; }, get ITEMS() { return ITEMS; }, get autonomyMode() { return autonomyMode; }, get on() { return on; }, get tabOwner() { return tabOwner; },
  get farmZones() { return (drop, L, above, sp = [], spK = 0.8) => farmZones(drop, L, above, sp, spK, n => !hardNow(n)); }, get heroLvl() { return heroLvl; }, get canSpoil() { return canSpoil; }, get spoilK() { return spoilK; }, get craftSelf() { return () => L2V7Modules.subclass?.craftSelf?.(); }, get handWant() { return now => L2V7Modules.subclass?.handWant?.(now); },
  get cfg() { return cfg; }, get fire() { return el => cfg.enchantMode !== true && fire(el); }, get fishNow() { return fishNow; }, get fishState() { return fishState; }, get gameGet() { return gameGet; },
  get heroNick() { return heroNick; }, get invQty() { return invQty; }, get invRefresh() { return invRefresh; }, get isBattle() { return isBattle; }, get isFishing() { return isFishing; }, get itemsDb() { return itemsDb; },
  get rec() { return rec; }, get rt() { return rt; }, get setRt() { return setRt; }, get setStatus() { return setStatus; }, get sleep() { return sleep; },
  get tvtSoon() { return tvtSoon; }, get waitX() { return waitX; } });

// 9.0: сюжетные квесты сабкласса и Noblesse, смена класса (modules/story.js)
L2V7Modules.story = L2V7Factories.story({ get payments(){return L2V7Modules.payments},get rtCommit(){return rtCommit},get leaseEpoch(){return leaseEpoch}, get tabOwner(){return tabOwner}, get routeLocation(){return actionLocation}, get $q() { return $q; }, get autonomyMode() { return autonomyMode; }, get awayFree() { return awayFree; }, get cfg() { return cfg; },
  get classSwitched() { return classSwitched; }, get fire() { return el => cfg.enchantMode !== true && fire(el); }, get fishNow() { return fishNow; }, get gameGet() { return gameGet; }, get isBattle() { return isBattle; }, get on() { return on; },
  get rec() { return rec; }, get rt() { return rt; }, get setRt() { return setRt; }, get setStatus() { return setStatus; }, get sleep() { return sleep; }, get waitX() { return waitX; } });

// 10.0.7 (игрок 13.10: «заготовка под саб крафтера и спойлера»): роль активного класса, свой крафт вместо крафтера, помощь основному персонажу (modules/subclass.js)
L2V7Modules.subclass = L2V7Factories.subclass({ get cfg() { return cfg; }, get rt() { return rt; }, get setRt() { return setRt; }, get rec() { return rec; }, get FARM() { return FARM; },
  get heroNick() { return heroNick; }, get heroLvl() { return heroLvl; }, get mammon() { return L2V7Modules.mammon; }, get canSpoil() { return canSpoil; },
  get farmZones() { return (drop, L, above, sp = [], spK = 0.8) => farmZones(drop, L, above, sp, spK, n => !hardNow(n)); }, get spoilK() { return spoilK; }, get invQty() { return invQty; }, get gameGet() { return gameGet; },
  get sharedGet() { return k => chrome.storage.local.get(k).then(s => s[k]); }, get sharedSet() { return (k, v) => chrome.storage.local.set({ [k]: v }); } });
// 9.2: анализатор боя. Имя действия хода = ключ замера скилла (rt.skills): l2_<id> → название слота панели, attack → «атака»
const actName = a => { a = String(a || ''); if (a === 'attack') return 'атака'; if (/^battle_potion/.test(a)) return 'банка';
  // 10.0 (аудит боя): в разметке игры data-slot-cd стоит на внутреннем <span class="l2-battle-hotbar-slot-cd">, а не на кнопке —
  // старый селектор не находил ни одного слота, и анализатор боя (dmgOn/killP/turnFor) работал вслепую
  const b = /^(?:l2_\d+|ls_[a-z_]+)$/.test(a) ? (document.querySelector(`.l2-battle-hotbar-slot[data-slot-cd="${a}"]`) || document.querySelector(`[data-slot-cd="${a}"]`)?.closest('.l2-battle-hotbar-slot')) : null;
  return b ? cleanTitle(b.title || '').toLowerCase() : a; };
L2V7Modules.fightlab = L2V7Factories.fightlab({ get routeLocation(){return actionLocation},
  get cfg() { return cfg; },
  get recoveryContext() { return () => L2V7Modules.warlock.heroContext(); }, get critNote() { return critNote; }, get critFlush() { return critFlush; }, get actName() { return actName; }, get fmtT() { return fmtT; }, get isBoss() { return isBoss; }, get isChamp() { return isChamp; },
  get mobTitle() { return mobTitle; }, get rec() { return rec; }, get rt() { return rt; }, get setRt() { return setRt; },
  get pvpPending() { return () => !!L2V7Modules.pvp?.pending(); }
});
const fightDmgOn = n => L2V7Modules.fightlab.dmgOn(n), fightKillP = (n, hp) => L2V7Modules.fightlab.killP(n, hp), fightSpikeEta = () => L2V7Modules.fightlab.spikeEta();
// 9.2: лист врагов и ответный PvP (modules/enemies.js)
L2V7Modules.tvtshop = L2V7Factories.tvtshop({ get leaseEpoch(){return leaseEpoch}, get on(){return on},get tabOwner(){return tabOwner},get payments(){return L2V7Modules.payments},get rtCommit(){return rtCommit},get gameGet(){return gameGet},get tvtHold(){return ()=>!!L2V7Modules.tvt?.tvtHold?.()}, get routeLocation(){return actionLocation}, get $q() { return $q; }, get cfg() { return cfg; }, get rt() { return rt; }, get setRt() { return setRt; }, get rec() { return rec; }, get fire() { return el => cfg.enchantMode !== true && fire(el); },
  get waitX() { return waitX; }, get sleep() { return sleep; }, get shown() { return shown; }, get isBattle() { return isBattle; }, get fishNow() { return fishNow; }, get setStatus() { return setStatus; },
  get heroLevel() { return heroLevel; }, get invQty() { return invQty; }, get awayFree() { return awayFree; }, get pause() { return pause; } });
// 10.0 (игрок 12.10: «клановые задания — на авто; дейлики»): опрос дейликов и клановых заданий (GET), взять/помочь/сдать (POST), рыба и РБ по дейликам
L2V7Modules.dailies = L2V7Factories.dailies({ get routeLocation(){return actionLocation}, get cfg() { return cfg; }, get rbRun() { return L2V7Modules.rbrun; }, get on() { return on && cfg.enchantMode !== true; }, get tabOwner() { return tabOwner; }, get rt() { return rt; }, get setRt() { return setRt; }, get setCfg() { return setCfg; }, get rec() { return rec; }, get gameGet() { return gameGet; }, get gamePost() { return gamePost; },
  get campEnabled() { return campEnabled; }, get fishState() { return fishState; },
  get awayFree() { return awayFree; }, get isBattle() { return isBattle; }, get fishNow() { return fishNow; }, get heroLevel() { return heroLevel; }, get sleep() { return sleep; }, get setStatus() { return setStatus; } });
// Мировой PvP: отдельные явные цели и обязательный возврат после смерти.
L2V7Modules.pvp = L2V7Factories.pvp({ get tvtHold(){return ()=>!!L2V7Modules.tvt?.tvtHold?.()}, get routeLocation(){return actionLocation},
  get rt() { return rt; },
  get cfg() { return cfg; },
  get on() { return on; },
  get tabOwner() { return tabOwner; },
  get setRt() { return setRt; },
  get rtCommit() { return rtCommit; },
  get rec() { return rec; },
  get setStatus() { return setStatus; },
  get $q() { return $q; },
  get shown() { return shown; },
  get fire() { return fire; },
  get pause() { return pause; },
  get sleep() { return sleep; },
  get waitX() { return waitX; },
  get gameGet() { return gameGet; },
  get isMap() { return isMap; },
  get isBattle() { return isBattle; },
  get victory() { return victory; },
  get toMap() { return toMap; },
  get fishNow() { return fishNow; },
  get tvtSoon() { return tvtSoon; },
  get antibotState() { return antibotState; },
  get abHold() { return abHold; }
});
L2V7Modules.enemies = L2V7Factories.enemies({ get on(){return on},get tabOwner(){return tabOwner},get tvtHold(){return ()=>!!L2V7Modules.tvt?.tvtHold?.()}, get routeLocation(){return actionLocation}, get $q() { return $q; }, get autonomyMode() { return autonomyMode; }, get cfg() { return cfg; }, get fire() { return el => cfg.enchantMode !== true && fire(el); },
  get fishNow() { return fishNow; }, get gameGet() { return gameGet; }, get heroLevel() { return heroLevel; }, get isBattle() { return isBattle; }, get isMap() { return isMap; },
  get meHp() { return meHp; }, get rec() { return rec; }, get rt() { return rt; }, get setRt() { return setRt; }, get setStatus() { return setStatus; }, get shown() { return shown; },
  get sleep() { return sleep; }, get toMap() { return toMap; }, get tvtSoon() { return tvtSoon; }, get victory() { return victory; }, get waitX() { return waitX; } });
// 10.0.2: таймеры боссов (modules/rbtimer.js): когда убит и когда воскреснет РБ / эпик
// 10.0.5: чемпионы ради FA — оценка до боя, проба, отход, обучение (rt.champLearn)
L2V7Modules.champs = L2V7Factories.champs({ get combatContext(){return options=>L2V7Modules.warlock.combatContext(options)}, get leaseEpoch(){return leaseEpoch}, get tabOwner(){return tabOwner}, get cfg() { return cfg; }, get rt() { return rt; }, get setRt() { return setRt; }, get rec() { return rec; },
  get heroLvl() { return heroLvl; }, get farmRate() { return (...a) => L2V7Modules.mobfarm.farmRate(...a); }, get faPaidLeft() { return (...a) => L2V7Modules.buffs.faPaidLeft(...a); } });   // 10.0.8: платные баффы за FA — «Cancel» чемпионов
L2V7Modules.rbtimer = L2V7Factories.rbtimer({ get cfg() { return cfg; }, get rt() { return rt; }, get setRt() { return setRt; }, get rec() { return rec; }, get gameGet() { return gameGet; },
  get heroLevel() { return heroLevel; }, get sleep() { return sleep; }, get RB_WIN() { return RB_WIN; } });
// 10.0.6: «📦 Серия РБ» — что выпало с РБ/эпиков с запуска серии (кнопка в окне бота)
L2V7Modules.rbrun = L2V7Factories.rbrun({ get cfg() { return cfg; }, get rt() { return rt; }, get setRt() { return setRt; }, get rec() { return rec; },
  get LOOT_RE() { return LOOT_RE; }, get SPECIAL_RE() { return SPECIAL_RE; } });
// 9.0: отлучиться от охоты (Маммон, сдача части квеста) — те же условия
const awayFree = afterWin => L2V7Modules.mammon.modeFree(afterWin);
// 9.0: смена класса — кот этого класса отозван игрой, прежний слуга не «живой»
const classSwitched = () => { PET = null; };

// Автозаточка: команды меню и диспетчер используют одну фабрику; 15.10 — только в своём режиме.
const enchantFree = (completedStart = false) => on && tabOwner && (cfg.enchantMode === true || completedStart && Array.isArray(cfg.autoTasks) && cfg.autoTasks.includes('enchant') && rt.enchant?.status === 'done' && !rt.enchant.pending) && !!heroNick() && heroNick() === rt.char && !antibotState()
  && L2V7Modules.mammon.modeFree(false, true) && !rt.petBufferTrip && !rt.dailyFish && !rt.dailyRb && !rt.mmJob && !rt.tsJob && !rt.storyJob && !rt.fishService;
L2V7Modules.enchant = L2V7Factories.enchant({ get routeLocation(){return actionLocation},
  get on() { return on; }, get tabOwner() { return tabOwner; }, get cfg() { return cfg; }, get rt() { return rt; },
  get setRt() { return setRt; }, get rtCommit() { return rtCommit; }, get gameGet() { return gameGet; },
  get awayFree() { return enchantFree; }, get canRun() { return enchantFree; }, get canStartCompleted() { return () => enchantFree(true); }, get antibotState() { return antibotState; },
  get fire() { return fire; }, get $q() { return $q; }, get waitX() { return waitX; }, get pause() { return pause; },
  get setStatus() { return setStatus; }, get rec() { return rec; }
});
let enchantCommandBusy = false, enchantAccountingBusy = null;
async function enchantModePause() {
  const s = rt.enchant;
  if (!s || s.status !== 'running' || !tabOwner || heroNick() !== rt.char || (cfg.enchantMode === true && cfg.enchant?.enabled === true)) return false;
  // При смене режима сохраняем даже отправленную попытку: ответ ещё может прийти.
  return setRt({enchant:{...s,status:'paused',reason:cfg.enchantMode === true ? 'Заточка выключена — продолжение только вручную' : 'Выбран другой режим — для продолжения заточки нажмите «Продолжить»'}});
}
async function enchantAccounting() {
  if (!rt.enchant?.pending || !tabOwner || heroNick() !== rt.char) return false;
  if (!enchantAccountingBusy) enchantAccountingBusy = Promise.resolve(L2V7Modules.enchant.step()).finally(() => { enchantAccountingBusy = null; });
  return enchantAccountingBusy;
}
async function enchantCommand(m) {
  if (enchantCommandBusy) return { ok: false, reason: 'Предыдущая команда заточки ещё выполняется' };
  const allowed = ['refresh', 'start', 'pause', 'resume', 'reset', 'reconcile', 'archiveUnknown'];
  if (!allowed.includes(m.action)) return { ok: false, reason: 'Неизвестная команда заточки' };
  enchantCommandBusy = true;
  let manualEpoch = null;
  try {
    const state = await chrome.storage.local.get(['rt', 'cfg', 'on']);
    if (!m.char || state.rt?.char !== m.char || heroNick() !== m.char || rt.char !== m.char)
      return { ok: false, reason: 'Персонаж изменился или ещё не загрузился — обновите меню' };
    if (state.on && (!on || !tabOwner || !leaseEpoch)) return { ok: false, reason: 'Управление у другой вкладки игры' };
    if (['start', 'resume'].includes(m.action) && !state.on) return { ok: false, reason: 'Сначала запустите бота' };
    if (['start', 'resume'].includes(m.action) && !(Array.isArray(state.cfg?.autoTasks) ? state.cfg.autoTasks.includes('enchant') : state.cfg?.enchantMode === true)) return { ok: false, reason: 'Сначала выберите режим «Заточка»' };
    if (typeof m.id !== 'string' || !m.id || m.id.length > 80) return { ok: false, reason: 'Не указан номер команды' };
    if (state.rt.enchantCommandAck?.id === m.id) return state.rt.enchantCommandAck;
    if (!state.on && ['reconcile', 'archiveUnknown'].includes(m.action)) {
      if (!await tabLock()) return { ok: false, reason: 'Другая вкладка проверяет состояние — повторите позже' };
      manualEpoch = leaseEpoch;
      if (heroNick() !== m.char || rt.char !== m.char) return { ok: false, reason: 'Персонаж изменился' };
    }
    cfg = mergeCfg(state.cfg);
    // 16.10: завершённая серия остаётся свидетелем точного экземпляра до успешного нового Start.
    // Off refresh читает только текущего героя; никаких действий игры при остановленном боте.
    const result = m.action === 'reconcile' ? await L2V7Modules.enchant.reconcile() : await L2V7Modules.enchant.command(m.action, {pendingId:m.pendingId});
    if (rt.char !== m.char || heroNick() !== m.char) return { ok: false, reason: 'Персонаж изменился во время команды' };
    const answer = { id: m.id, char: m.char, action: m.action, t: Date.now(), ok: !!result, reason: result ? '' : rt.enchant?.reason || rt.enchantScan?.reason || 'Команда пока недоступна' };
    await setRt({ enchantCommandAck: answer });
    return answer;
  } catch (e) { return { ok: false, reason: String(e?.message || e).slice(0, 180) }; }
  finally {
    if (manualEpoch && !on && leaseEpoch === manualEpoch) {
      await rtWriter.recover().catch(() => {});
      await ipc({cmd:'lockRelease',epoch:manualEpoch}).catch(() => {});
      if (!on && leaseEpoch === manualEpoch) { tabOwner = false; tabIdle = false; leaseEpoch = null; }
    }
    enchantCommandBusy = false;
  }
}
async function enchantDispatch() {
  await enchantModePause();
  const s = rt.enchant;
  if (s?.pending) { await enchantAccounting(); return false; }
  if (cfg.enchantMode !== true || !on || !tabOwner) return false;
  if (enchantCommandBusy) { setStatus('Заточка: выполняю команду меню'); return false; }
  if (!enchantFree()) {
    const jobs = {shop:'закупку',magister:'обучение у магистра',tbuff:'городские баффы',invScan:'проверку оружия',fishSvc:'обслуживание рыбалки',fishService:'обслуживание рыбалки',
      mmJob:'задачу Маммона',tsJob:'покупку в магазине TvT',storyJob:'квестовую задачу',petBufferTrip:'поход за баффом кота',rbGo:'переход к РБ',zoneGo:'переход в локацию',dailyFish:'рыболовный дейлик',dailyRb:'рейдовый дейлик'};
    const job = Object.keys(jobs).find(k => rt[k]);
    setStatus(job ? `Заточка: завершите ${jobs[job]} в прежнем режиме, затем вернитесь` : 'Заточка: жду окончания боя, рыбалки или TvT');
    return false;
  }
  if (s?.status === 'running' && cfg.enchant?.enabled === true) return L2V7Modules.enchant.step();
  setStatus('Заточка: ' + (s?.status === 'done' ? 'цели достигнуты — выберите новую серию или другой режим' : s?.reason || (cfg.enchant?.enabled !== true ? 'включите разрешение и запустите серию в разделе «Заточка»' : 'выберите вещи и нажмите «Начать серию»')));
  return false;
}

// Поход за платным бафом: нативный вход в город, подтверждённый ответ, баффер, возврат.
const petTripUnstored = new Set();
const petMoney = v => typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:typeof v==='string'&&/^\d+$/.test(v)&&Number.isSafeInteger(+v)?+v:null;
const petTripSame = J => !!J && on && tabOwner && cfg.petFullAuto === true && J.char === rt.char && heroNick() === J.char
  && rt.petBufferTrip?.id === J.id && J.kick === (+rt.manualKickAt || 0) && J.home.mode === autonomyMode()
  && (J.home.mode !== 'cat' || J.home.catDungeon === (cfg.catDungeon || null));
const petTripFree = (J, afterWin = false) => petTripSame(J) && warlockCanRun() && !antibotState() && !abHold()
  && !(cfg.tvtOn && L2V7Modules.tvt.tvtHold()) && (!rt.shop || L2V7Modules.actions?.owns?.('petBufferTrip')) && !rt.revive && !(isFishing() && fishState())
  && (!isBattle() || (afterWin && victory()));
const warlockTownReady = () => {
  const J=rt.petBufferTrip,E=J?.entry;
  return !petTripUnstored.has(J?.id) && petTripFree(J) && J.phase==='pay' && location.pathname==='/town-buffer.html' && E?.job===J.id && E.char===J.char
    && Number.isSafeInteger(E.revision) && E.revision>=J.revision && Date.now()-E.at<5*60000;
};
async function petTripSave(J, patch) {
  if (!petTripSame(J)) return false;
  petTripUnstored.add(J.id);
  const saved=await setRt({petBufferTrip:{...rt.petBufferTrip,...patch}});
  if (!saved?.ok || !await rtCommit() || !petTripSame(J)) return false;
  petTripUnstored.delete(J.id);return true;
}
async function warlockTownStart({char,revision,price}) {
  if (rt.petBufferTrip || !on || !tabOwner || cfg.petFullAuto!==true || char!==rt.char || heroNick()!==char
      || !Number.isSafeInteger(revision) || !Number.isSafeInteger(price) || price<0) return false;
  const J={id:crypto.randomUUID(),char,revision,price,kick:+rt.manualKickAt||0,t:Date.now(),phase:'city',cityAt:Date.now(),cityReload:0,
    home:{mode:autonomyMode(),zone:rt.zone||null,catIn:rt.catIn||null,catDungeon:cfg.catDungeon||null,
      path:location.pathname==='/dungeon.html'?location.pathname+location.search:fishNow()?'/fishing.html':'/map.html'}};
  // Завершённый бой разрешает только начать поездку; незавершённый не покидаем.
  if (!warlockCanRun() || antibotState() || abHold() || (cfg.tvtOn&&L2V7Modules.tvt.tvtHold()) || rt.shop || rt.revive
      || (isBattle()&&!victory()) || (isFishing()&&fishState())) return false;
  petTripUnstored.add(J.id);
  const saved=await setRt({petBufferTrip:J});
  if (!saved?.ok || !await rtCommit() || !petTripFree(J,true)) return false;
  petTripUnstored.delete(J.id);
  setStatus('Автобаф суммона: иду в город');(L2V7Modules.actions?.canAct?.() !== false && (location.href = '/city.html'));return true;
}
// Ответ может прийти во время первого storage.get после получения замка. Применяем его
// последовательно в main, иначе старый boot-снимок перетирает уже подтверждённую фазу.
let petTownReceipt = null;
function warlockTownReceive(d,path) {
  const J=rt.petBufferTrip,rev=Number(d.req?.expectedRevision);
  if(path!=='/game/world/enter-city'||d.method!=='POST'||location.pathname!=='/city.html'||J?.phase!=='city'
      ||J.char!==rt.char||heroNick()!==J.char||!Number.isSafeInteger(rev)||rev<J.revision)return;
  const ch=d.res?.character;
  petTownReceipt={job:J.id,char:J.char,at:Date.now(),d:{method:'POST',status:d.status,req:{expectedRevision:rev},
    error:!!d.error,res:{error:!!d.res?.error,ok:d.res?.ok,character:ch?{name:ch.name,revision:ch.revision}:null}}};
}
async function warlockTownNote(d,path) {
  const J=rt.petBufferTrip;
  if (path!=='/game/world/enter-city' || d.method!=='POST' || location.pathname!=='/city.html' || J?.phase!=='city' || !petTripFree(J)) return;
  const ch=d.res?.character,rev=Number(d.req?.expectedRevision);
  if (!Number.isSafeInteger(rev) || rev<J.revision) return;
  if (d.status<200 || d.status>=300 || d.error || d.res?.error || d.res?.ok===false) {
    await petTripSave(J,{phase:'return',why:'Вход в город не подтверждён; покупка отменена'});return;
  }
  if (ch?.name!==J.char || !Number.isSafeInteger(ch.revision) || ch.revision<rev) return;
  petTripUnstored.add(J.id);
  const saved=await setRt({petBufferTrip:{...J,phase:'pay',entry:{job:J.id,char:J.char,revision:ch.revision,at:Date.now()}},
    zone:null,zonePend:null,catIn:null,catBackTried:1});
  if (saved?.ok && await rtCommit() && petTripSame(J)) petTripUnstored.delete(J.id); // Перейти к бафферу может только следующий проверенный шаг.
}
async function warlockTripStep() {
  const J=rt.petBufferTrip;if(!J)return false;
  if (!on || !tabOwner || J.char!==rt.char || heroNick()!==J.char) return false;
  if (cfg.petFullAuto!==true || J.kick!==( +rt.manualKickAt||0) || J.home.mode!==autonomyMode()
      || (J.home.mode==='cat' && J.home.catDungeon!==(cfg.catDungeon||null))) {
    await setRt({petBufferTrip:null});return false; // Новая команда игрока не возвращается к старой цели.
  }
  if (!petTripFree(J)) return false;
  // Принятый, но ещё не учтённый платёж сверяем до новых переходов/изменения ревизии.
  if (rt.petFull?.pending && ['city','pay'].includes(J.phase)) {
    await L2V7Modules.warlock.step({forceRead:true});
    if (petTripFree(J)) await petTripSave(J,{phase:'return',why:rt.petFull?.reason||'Сверка покупки'});
    return true;
  }
  if (J.phase==='city') {
    if (location.pathname!=='/city.html') {
      if (await petTripSave(J,{cityAt:Date.now(),entry:null}) && petTripFree(J)) (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/city.html'));
      return true;
    }
    const received=petTownReceipt;
    if(received) {
      petTownReceipt=null;
      if(received.job===J.id&&received.char===J.char&&Date.now()-received.at<5*60000) {
        await warlockTownNote(received.d,'/game/world/enter-city');return true;
      }
    }
    if (Date.now()-J.cityAt>15000) {
      if (!J.cityReload) {
        // Быстрый нативный ответ мог прийти до content listener. Повторяем только бесплатную загрузку города один раз.
        if (await petTripSave(J,{cityReload:1,cityAt:Date.now()}) && petTripFree(J)) location.reload();
      } else await petTripSave(J,{phase:'return',why:'Не получено подтверждение входа в город; покупка отменена'});
    }
    return true;
  }
  if (J.phase==='pay') {
    if (location.pathname!=='/town-buffer.html') {
      if (location.pathname==='/city.html' && J.entry && Date.now()-J.entry.at<5*60000) {
        if (await petTripSave(J,{}) && petTripFree(J)) (L2V7Modules.actions?.canAct?.() !== false && (location.href = '/town-buffer.html'));
      } else await petTripSave(J,{phase:'city',entry:null,cityAt:Date.now(),cityReload:0});
      return true;
    }
    if (!warlockTownReady()) {await petTripSave(J,{phase:'city',entry:null,cityAt:Date.now(),cityReload:0});return true;}
    if (!await petTripSave(J,{}) || !petTripFree(J)) return true;
    await L2V7Modules.warlock.step({forceRead:true});
    if (!petTripFree(J)) return true;
    // Отказ, неизвестный исход и уже действующий набор завершают поездку. Резерв денег живёт отдельно.
    if (rt.petFull?.status!=='travel') await petTripSave(J,{phase:'return',why:rt.petFull?.reason||'Проверка покупки завершена'});
    return true;
  }
  return warlockTripReturn(J);
}
async function petTripNotice(J, why) {
  if (!petTripSame(J)) return;
  setStatus('Автобаф суммона: '+why);
  if (rt.petBufferTrip.why!==why) await petTripSave(J,{why});
}
const petReturnTarget = J => J.home.mode==='cat'&&J.home.catIn ? {kind:'cat',id:J.home.catIn,page:CAT_URL}
  : J.home.zone&&!/^out:|^rb:/.test(J.home.zone) ? {kind:'zone',id:J.home.zone,page:'/teleport.html'} : null;
function petReturnButton(T) {
  const s=T.kind==='cat'?`.l2-rb-row__tp[data-dungeon-id="${CSS.escape(T.id)}"]`:`.l2-teleport-miru-tp-btn[data-teleport-id="${CSS.escape(T.id)}"]`;
  const b=$q(s);return b&&shown(b)&&!b.disabled?b:null;
}
function petReturnPrice(T,b) {
  const row=b?.closest(T.kind==='cat'?'.l2-rb-row':'.l2-teleport-miru-surroundings-row, .l2-teleport-miru-city-row');
  if(!row)return null;
  const label=(row.querySelector(T.kind==='cat'?'.l2-rb-row__price-gold':'.l2-teleport-miru-price-adena')?.textContent||'').trim();
  if(/coin|luck|\bcol\b|fast\s*aden|\bfa\b|монет/i.test(label))return null;
  const text=T.kind==='cat'?label:row.querySelector('.l2-teleport-miru-price-num')?.textContent||'';
  const unit=T.kind==='cat'?label:row.querySelector('.l2-teleport-miru-price-currency')?.textContent||'';
  if(/аден|adena/i.test(unit)&&/\d/.test(text)){const amount=+(text.replace(/[^\d]/g,''));return Number.isSafeInteger(amount)?amount:null;}
  return /безкоштовно|бесплатно|free/i.test(label)?0:null;
}
async function warlockTripReturn(J) {
  if(!petTripFree(J))return false;
  const T=petReturnTarget(J);
  if(J.phase==='returnSent') {
    if(location.pathname==='/map.html') {
      if(T?.kind==='cat') {
        const a=$q('#map-dungeon-enter-link');
        if(!a||!shown(a)||!String(a.getAttribute('href')||'').includes('dungeonId='+T.id)) {await petTripNotice(J,'Возврат к катакомбам не подтверждён; повторно не плачу');return true;}
        if(await petTripSave(J,{phase:'returnEnter'})&&petTripFree(J))fire(a);
      } else if(await petTripSave(J,{phase:'returned'})&&petTripFree(J))await setRt({petBufferTrip:null});
      return true;
    }
    await petTripNotice(J,'Жду подтверждение возврата; повторный платный телепорт запрещён');return true;
  }
  if(J.phase==='returnEnter') {
    if(location.pathname==='/dungeon.html'&&new URLSearchParams(location.search).get('dungeonId')===T?.id) {
      try {const r=await gameGet('/character'),d=r.ok?await r.json():null;
        if(petTripFree(J)&&d?.character?.name===J.char&&d.character.activeDungeonId===T.id) {await setRt({petBufferTrip:null});return true;}
      }catch(_){}
    }
    await petTripNotice(J,'Жду подтверждение входа в прежние катакомбы; платный телепорт не повторяю');
    return true;
  }
  if(J.phase==='returned'){await setRt({petBufferTrip:null});return true;}
  // Неподтверждённый вход не даёт права оплачивать ещё и возврат. Возвращаемся на безопасную карту.
  if(!J.entry) {
    if(await petTripSave(J,{phase:'returned'})&&petTripFree(J))(L2V7Modules.actions?.canAct?.() !== false && (location.href = J.home.mode==='fish'?'/fishing.html':'/map.html'));
    return true;
  }
  if(!T) {
    const home=J.home.mode==='fish'?'/fishing.html':'/map.html';
    if(await petTripSave(J,{phase:'returned'})&&petTripFree(J))(L2V7Modules.actions?.canAct?.() !== false && (location.href = home));
    return true;
  }
  // Свежий снимок всё ещё внутри исходного подземелья: платный возврат не нужен.
  const at=heroAt();
  if(T.kind==='cat'&&at?.dung===T.id&&at.t>=J.t) {
    if(await petTripSave(J,{phase:'returnEnter'})&&petTripFree(J))(L2V7Modules.actions?.canAct?.() !== false && (location.href = '/dungeon.html?dungeonId='+encodeURIComponent(T.id)));
    return true;
  }
  if(location.pathname!==T.page){if(await petTripSave(J,{})&&petTripFree(J))(L2V7Modules.actions?.canAct?.() !== false && (location.href = T.page));return true;}
  let b=petReturnButton(T);
  if(!b&&T.kind==='zone') {
    const cities=[...document.querySelectorAll('.l2-teleport-miru-city-btn[data-surroundings-key]')].filter(shown),i=J.cityScan||0;
    if(i<cities.length&&await petTripSave(J,{cityScan:i+1})&&petTripFree(J))fire(cities[i]);
    else await petTripNotice(J,'Прежней зоны нет в текущем списке телепорта; жду ручного выбора');
    return true;
  }
  if(!b){await petTripNotice(J,'Жду строку прежних катакомб и подтверждённую цену');return true;}
  const quote=petReturnPrice(T,b);
  if(quote===null){await petTripNotice(J,'Цена возврата неизвестна или валюта не адена; не плачу');return true;}
  let ch,rows;
  try {
    const responses=await Promise.all([gameGet('/character'),gameGet(T.kind==='cat'?'/game/catacombs':'/game/teleport/locations')]);
    const body=await Promise.all(responses.map(r=>r.json()));
    if(!responses.every(r=>r.ok)||body.some(d=>d?.error))return true;
    ch=body[0].character;rows=T.kind==='cat'?body[1].dungeons:body[1].locations;
  }catch(_){return true;}
  if(!petTripFree(J))return true;
  const row=Array.isArray(rows)?rows.find(x=>String(T.kind==='cat'?x.dungeonId:x.teleportId)===T.id):null;
  const cost=petMoney(row?.adenaCost),wallet=petMoney(ch?.adena),reserve=petMoney(cfg.petFullReserve??cfg.shopReserve??200000),cap=petMoney(cfg.shopMaxSpend??2000000);
  if(!row||cost===null||cost!==quote||ch?.name!==J.char||wallet===null||reserve===null||cap===null||cost>cap||wallet-cost<reserve){
    await petTripNotice(J,'Возврат не проходит свежую цену, лимит снабжения или резерв адены');return true;
  }
  b=petReturnButton(T);if(!b||petReturnPrice(T,b)!==cost)return true;
  if(!await petTripSave(J,{phase:'returnSent',returnQuote:{kind:T.kind,id:T.id,price:cost,revision:ch.revision,t:Date.now()}})||!petTripFree(J))return true;
  b=petReturnButton(T);if(!b||petReturnPrice(T,b)!==cost){await petTripSave(rt.petBufferTrip,{phase:'return'});return true;}
  // Нативный обработчик отправляет exact target/expectedAdenaCost; после reload этот click не повторяется.
  if(!fire(b)&&petTripFree(J))await petTripSave(rt.petBufferTrip,{phase:'return'});
  return true;
}

// Автобаф суммона: отдельная задача, текущие режимы и сабкласс не переключает.
// В бою — состояние текущей панели. Перед РБ — отдельно помеченный план штатного keepShots:
// /character сообщает слот и запас, но не ON; грейд проверяем по реально надетому оружию.
const warlockShotContext = (ch, options = {}) => {
  if (options.preflight === true) {
    if (isBattle() || !on || !tabOwner || ch?.inBattle !== false || ch.name !== rt.char || heroNick() !== rt.char
      || ch.l2Profession !== rt.classCur?.prof || ch.classSlots?.activeSlot !== rt.classCur?.slot || rt.shotMismatchPending || rt.weaponMetaPending) return 'unknown';
    const slot=ch.inventory?.eq?.l1,id=+(slot && typeof slot==='object'?slot.itemId:slot)||0;
    const weapon=rt.weaponsT && (rt.weapons||[]).find(w=>w.where==='надето' && +w.id===id);
    if (!id || !weapon || !/^(NG|D|C|B|A|S)$/.test(weapon.g||'')) return 'unknown';
    const grade=L2V7Modules.economy?.shotGrade?.(),mage=L2V7Modules.economy?.shotsMage?.();
    if (grade?.blocked || grade?.g!==weapon.g || typeof mage!=='boolean') return 'unknown';
    if (!Array.isArray(ch.battleHotbarSlots) || !Array.isArray(ch.inventory?.stacks)) return 'unknown';
    const known=new Set([...Object.values(SHOT_IDS),...Object.values(BSPS_IDS)]),want=(mage?BSPS_IDS:SHOT_IDS)[weapon.g];
    const slots=[...new Set(ch.battleHotbarSlots.filter(s=>s?.k==='u' && known.has(+s.id)).map(s=>+s.id))];
    // Несколько разных зарядов: состояние остальных ON/OFF неизвестно, общую выборку не подбираем догадкой.
    if (slots.length!==1 || slots[0]!==want) return 'unknown';
    const stacks=ch.inventory.stacks.filter(s=>+s?.itemId===want);
    if (!stacks.length || stacks.some(s=>!Number.isSafeInteger(s.qty)||s.qty<0) || !stacks.some(s=>s.qty>0)) return 'unknown';
    return `${mage?'Благ. заряды духа':'Заряды души'} ${weapon.g} (#${want}) · вкл · есть`;
  }
  const rows=[...document.querySelectorAll('.l2-hotbar-shot--enabled, .l2-hotbar-shot--disabled')];
  if (!rows.length) return 'unknown';
  const parts=[];
  for (const b of rows) {
    const src=b.querySelector('img')?.getAttribute('src')||'',id=+(src.match(/\/game\/item-icon\/(\d+)(?:[/?#]|$)/)?.[1]||(b.title||'').match(/^#(\d+)\b/)?.[1]||0);
    const soul=Object.entries(SHOT_IDS).find(([,v])=>v===id),spirit=Object.entries(BSPS_IDS).find(([,v])=>v===id),grade=(soul||spirit)?.[0],stock=qty(b);
    if (!grade || stock==null || !Number.isFinite(stock)) return 'unknown';
    parts.push(`${spirit?'Благ. заряды духа':'Заряды души'} ${grade} (#${id}) · ${shotsOn(b)?'вкл':'выкл'} · ${stock>0?'есть':'нет'}`);
  }
  return [...new Set(parts)].sort().join('; ');
};
// Свежесть плана не переживает изменение панели/оружия/расходников. Ответ GET подготовит его заново.
if (typeof addEventListener==='function') addEventListener('message',e=>{
  if (e.source!==window || e.origin!==location.origin || e.data?.__l2bot!=='net') return;
  const d=e.data,path=apiPath(String(d.url||''));
  const shot=/^\/(?:character\/equip|character\/subclasses(?:\/\w+)?|game\/battle\/hotbar|game\/(?:inventory|shop|drops-shop)\/[^?]+)$/.test(path)
    || path==='/game/battle/action' && /^(?:fighter_soulshot|mystic_spiritshot)_toggle$/.test(d.req?.action||'');
  if (d.method==='POST' && shot && d.status>=200 && d.status<300 && !d.error && !d.res?.error
    || path==='/game/battle/action' && /^(?:mystic_spiritshot|soulshot)_grade_mismatch$/.test(d.res?.error||'')) L2V7Modules.warlock?.invalidateSnapshot?.();
});
const warlockCanRun = () => cfg.enchantMode !== true && !L2V7Modules.pvp?.pending() && !L2V7Modules.payments?.blocked?.() && (L2V7Modules.actions?.owns?.('petBufferTrip') || (!rt.magister && !rt.invScan && !rt.fishSvc && !rt.fishService && !rt.dailyFish && !rt.dailyRb
  && !rt.mmJob && !rt.tsJob && !rt.storyJob && !rt.rbGo && !rt.zoneGo && !rt.tbuff)) && !rt.enchant?.pending && rt.enchant?.status !== 'running';
L2V7Modules.warlock = L2V7Factories.warlock({ get leaseEpoch(){return leaseEpoch},
  get townBufferReady() { return warlockTownReady; }, get townBufferStart() { return warlockTownStart; },
  get shotContext() { return warlockShotContext; }, get canRun() { return warlockCanRun; }, get cfg() { return cfg; }, get rt() { return rt; }, get on() { return on; }, get tabOwner() { return tabOwner; },
  get heroNick() { return heroNick; }, get isBattle() { return isBattle; }, get victory() { return victory; },
  get fishState() { return () => isFishing() && fishState(); }, get tvtHold() { return () => cfg.tvtOn && L2V7Modules.tvt.tvtHold(); },
  get abHold() { return abHold; }, get antibotState() { return antibotState; },
  get gameGet() { return gameGet; }, get gamePost() { return gamePost; }, get setRt() { return setRt; }, get rtCommit() { return rtCommit; }, get rec() { return rec; }
});
const warlockService = L2V7Modules.warlock;
L2V7Modules.warlock = { ...warlockService, step: options => warlockCanRun() ? warlockService.step(options) : Promise.resolve(false) };
let warlockCommandBusy = false;
async function warlockCommand(m) {
  if (warlockCommandBusy) return {ok:false,reason:'Предыдущая команда кота ещё выполняется'};
  if (!['preview','resetBudget','archiveUnknown'].includes(m.action) || !m.id || typeof m.id !== 'string' || m.id.length>80) return {ok:false,reason:'Неизвестная команда'};
  warlockCommandBusy=true;let manualEpoch=null;
  try {
    const state=await chrome.storage.local.get(['cfg','rt','on']);
    if (!m.char || m.char!==state.rt?.char || m.char!==rt.char || heroNick()!==m.char) return {ok:false,reason:'Персонаж изменился — обновите меню'};
    if (state.on && (!on || !tabOwner || !leaseEpoch)) return {ok:false,reason:'Управление у другой вкладки'};
    if (state.rt.warlockCommandAck?.id===m.id) return state.rt.warlockCommandAck;
    cfg=mergeCfg(state.cfg);
    if (m.action!=='preview') {
      if ((state.rt.petFull?.budgetEpoch||0)!==m.budgetEpoch || (state.rt.petFull?.spent||0)!==m.spent) return {ok:false,reason:'Расход уже изменился — проверьте новое состояние'};
      if (!state.on) { if (!await tabLock()) return {ok:false,reason:'Другая вкладка проверяет состояние'};manualEpoch=leaseEpoch; }
      if (m.char!==rt.char || heroNick()!==m.char) return {ok:false,reason:'Персонаж изменился'};
    }
    let result;
    if (m.action==='preview') {
      const r=await gameGet('/character'),body=r.ok?await r.json():null,ch=body?.character;
      if (!ch || ch.name!==m.char || heroNick()!==m.char || rt.char!==m.char) return {ok:false,reason:'Не прочитан текущий персонаж'};
      L2V7Modules.warlock.noteSnapshot(ch);
      const preview=await L2V7Modules.warlock.preview();
      if (heroNick()!==m.char || rt.char!==m.char) return {ok:false,reason:'Персонаж изменился'};
      const saved=await setRt({petFullPreview:{char:m.char,t:Date.now(),prof:ch.l2Profession||'',slot:ch.classSlots?.activeSlot,...preview}});
      result=!!saved?.ok;
    } else if (m.action==='archiveUnknown') {
      if (!m.pendingId || rt.petFull?.pending?.id!==m.pendingId) return {ok:false,reason:'Неопределённый запрос уже изменился'};
      result=await L2V7Modules.warlock.archiveUnknown({char:m.char,pendingId:m.pendingId,budgetEpoch:m.budgetEpoch});
    } else result=await L2V7Modules.warlock.resetBudget({char:m.char,budgetEpoch:m.budgetEpoch,spent:m.spent});
    if (heroNick()!==m.char || rt.char!==m.char) return {ok:false,reason:'Персонаж изменился во время команды'};
    const answer={id:m.id,char:m.char,action:m.action,t:Date.now(),ok:typeof result==='object'?result?.ok===true:!!result,reason:typeof result==='object'?result?.reason||'':result?'':rt.petFull?.reason||'Команда недоступна'};
    await setRt({warlockCommandAck:answer});return answer;
  }catch(e){return {ok:false,reason:String(e?.message||e).slice(0,180)};}
  finally {
    if (manualEpoch&&!on&&leaseEpoch===manualEpoch) {
      await rtWriter.recover().catch(()=>{});await ipc({cmd:'lockRelease',epoch:manualEpoch}).catch(()=>{});
      if (!on&&leaseEpoch===manualEpoch) {tabOwner=false;tabIdle=false;leaseEpoch=null;}
    }
    warlockCommandBusy=false;
  }
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.cmd === 'warlockCommand') { warlockCommand(m).then(reply).catch(e=>reply({ok:false,reason:String(e)})); return true; }
  if (m.cmd === 'enchantCommand') { enchantCommand(m).then(reply).catch(e => reply({ok:false,reason:String(e)})); return true; }
  // 10.0 (аудит ядра): фон отдал замок видимой вкладке — прежний хозяин останавливается сразу, а не через ≤ 5 с при продлении
  if (m.cmd === 'lockLost') { if (tabOwner) { tabOwner = false; tabIdle = true; leaseEpoch = null; rtWriter.clear(); window.__lockT = 0; rec('S', 'ядро', 'управление передано другой вкладке игры — здесь жду'); } reply?.({ ok: true }); return; }
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
  const timerPrevious = rt;
  if (ch.rt && ch.rt.newValue?._src !== TAB_ID) rt = { ...DEF_RT, ...ch.rt.newValue, ...rtWriter.peek() }; // свежий storage + наши неподтверждённые PATCHES
  if (ch.rt?.newValue?.rbTimer) {
    const saved = ch.rt.newValue, sameChar = String(saved.char || '') === String(timerPrevious.char || ''), pending = rtWriter.peek();
    const timers = L2V7Modules.rbtimer?.merge(saved.rbTimer, sameChar ? (pending.rbTimer || timerPrevious.rbTimer || { b: {} }) : { b: {} });
    // Свежий импорт сильнее старого pending; canonical echo учитываем и у вкладки-писателя.
    if (timers) rt = { ...rt, rbTimer: timers };
  }
  if (ch.cfg || ch.rt) enchantModePause().catch(() => {});
  if (ch.paused && ch.paused.oldValue && !ch.paused.newValue && rt.abChal) setRt({ abChal: null });   // 10.0.2: игрок снял паузу — проверку решил
  if (ch.on) {
    on = !!ch.on.newValue;
    if (!on && rt.enchant?.status === 'running' && rt.char === heroNick()) L2V7Modules.enchant.command('pause').catch(() => {});
    if (!on) abBlink(false);                      // 10.0 (аудит ядра): бот остановлен во время капчи — заголовок больше не мигает
    if (on && ch.on.oldValue === false && rt.abChal) setRt({ abChal: null });   // 10.0.2: игрок сам включил бота — значит, проверку решил
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
  const C = k => (k in cf ? cf[k] : L2EngineCore.rawTaskConfig(cfg)[k]);
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
  // 14.10: явное новое решение игрока — включить обучение на каждом уровне, включая текущие навыки.
  // Миграция одноразовая; последующее ручное выключение остаётся выключенным.
  once('magEveryLevel20261014', () => { Object.assign(cf, { autoMagister: true, magisterEvery: 1 }); Object.assign(rf, { magister: null, magEnabled: false, magChecked: {}, magRetry: null }); });
  once('shots723', () => { cf.shopShots = '1000/5000'; });
  once('hard924', () => { Object.assign(rf, { hardMobs: {} }); });
  // 10.0.8 (лог 13.10 17:17:57, Purgatory Gargoyle «урон ≈0.0/с» после зависшей банки): метки без единого принятого удара — ложные, стереть
  once('hard1008', () => { const H = rf.hardMobs || {}; const keep = Object.fromEntries(Object.entries(H).filter(([, v]) => !/урон ≈0\.0\/с/.test(v?.why || ''))); if (Object.keys(keep).length !== Object.keys(H).length) Object.assign(rf, { hardMobs: keep }); });   // 9.2.4: «не по зубам» считалось по HP одного моба (Guardian Basilisk у спойлера) — метки 2 ч стереть
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
  // 10.0.2 (игрок 12.10: «учти нужные данные в модели»): замеры лога 12.10 22:11–22:46 (Warlock 65, с котом) — свой ДПС по РБ, спецудар,
  // обычный удар p90/макс. Пишем только то, чего в памяти нет (свои замеры игрока важнее); ДПС привязан к уровню 65 и нынешнему общему ДПС
  once('rbFit1002', () => {
    const D = { ...(rt.rbDb || {}) }, base = rt.rbDps || null;
    for (const [id, v] of Object.entries(RB_FIT_1002)) {
      const d = D[id] || {};
      D[id] = { ...d, name: d.name || v.name, lvl: d.lvl || v.lvl, sp: Math.max(d.sp || 0, v.sp), hitP90: Math.max(d.hitP90 || 0, v.hitP90), maxHit: Math.max(d.maxHit || 0, v.maxHit),
        ...(d.dps > 0 ? {} : { dps: v.dps, dpsLvl: 65, dpsBase: base }) };
    }
    rf.rbDb = D;
  });
  // 9.2.5 (игрок 12.10: РБ «не уверен» бот не шёл проверять): цифры 4 РБ из базового профиля 8.0.3 (from 'base803', M.Atk Кастора 9339
  // при настоящих 4339) — на встроенные цифры игры (замеры loss и т. п. сохраняем); пропуски «не по силам по оценке» — снять
  once('rbStats925', () => {
    const S = { ...(rt.rbStats || {}) }, kn = id => L2V7Modules.raid?.rbKnown?.(id);
    for (const [id, v] of Object.entries(S)) if (v && v.from === 'base803' && kn(id)) S[id] = { ...v, ...kn(id) };
    const P = Object.fromEntries(Object.entries(rt.rbPreSkip || {}).filter(([, v]) => !(v && v.kind === 'strong')));
    Object.assign(rf, { rbStats: S, rbPreSkip: P });
  });
  once('faFull925', () => { if (String(C('rbSessBuffs') || '').replace(/\s+/g, '') === '1413,1323,4703,273,365,1303,264,267,1389') cf.rbSessBuffs = 'auto'; });   // 9.2.5: заводской список РБ-сессии → фулл бафф под класс (свой список игрока не трогаем)
  // 10.0 (ребаланс ради КПД): банок MP 20/100 хватало на ≈10 мин боя (MP не экономим — игрок 10.10), бот бегал в магазин; РБ ниже героя
  // на 10–15 уровней дают EXP со штрафом и почти пустой дроп, а тур летал к ним за телепорт — окно вниз 9 уровней. Только заводские значения
  once('rebal100', () => { if (C('shopMp') === '20/100') cf.shopMp = '200/1000'; if (+C('rbMaxBelow') === 15) cf.rbMaxBelow = 9; });
  once('tsGoal100', () => { if (!+C('tsGoalItem')) cf.tsGoalItem = 920033; });   // 10.0 (игрок 12.10): цель магазина TvT по умолчанию — Тату Душі (+978 M.Atk, лучшее для ДПС), автопокупка выключена
  once('champAuto1005', () => { cf.searchChamp = true; });   // 10.0.5 (игрок 13.10 00:38: «добавь автопоиск чемпионов раз в 20 убитых мобов»): поиск чемпионов ВКЛ (было ВЫКЛ с 8.0.3)
  once('epicDeaths1005', () => { if (+C('epicMaxDeaths') === 3) cf.epicMaxDeaths = 5; });   // 10.0.5 (игрок 13.10 00:57: «3 смерти за заход на эпики расширяем до 5»): только прежние заводские 3
  once('epicTime1005', () => { if (+C('epicMaxFightMin') === 30) cf.epicMaxFightMin = 0; });   // 10.0.5 (игрок 13.10 01:10: «для эпиков лимит по времени не нужен»): только прежние заводские 30
  // 10.0.7 (лог 13.10 13:03–13:12): эти чемпионы снимали баффы (50 строк «зняв з вас N бафи») — в память снятий сразу, чтобы не учиться заново
  // 15.10: решение игрока — оранжевые только при окупаемости; красные остаются запрещены.
  once('orangeValue1017', () => Object.assign(cf, { champOrange: true, champRed: false, champCancel: 'efficiency' }));
  once('cancel1007', () => { const C = { ...(rt.buffCancel || {}) }, t = Date.now(); for (const [n, k, tier] of [['Lost Yeti', 23, 'red'], ['Frost Tarantula', 17, 'red'], ['Ghost of Rebellion Soldier', 4, 'orange'], ['Vanor Silenos Shaman', 6, 'red'], ['Buffalo', 4, 'orange'], ['Canyon Antelope', 4, 'red']]) if (!C['ч:' + n.toLowerCase()]) C['ч:' + n.toLowerCase()] = { t, n: k * 3, k, name: n, champ: true, tier }; setRt({ buffCancel: C }); });
  // 10.0.7 (игрок 13.10 03:16, скрин Warlock 67 против Tomb Guard 75: «бот пытается бить моба больше чем на 5 лвл старше»): верхний предел
  // «до героя +» был 99 (v5.3.1 снял), у игрока 20 — Tomb Guard +8 проходил. Теперь по умолчанию +5 (как и −5); шире — руками в «Охоте»
  once('lvlTop1007', () => { if (!(+C('lvlAbove') <= 5)) cf.lvlAbove = 5; });
  // 10.0.7 (игрок 13.10 03:19, скрин «Мобы-источники: от −5 до +5»: «в базе выстави вот так»): окно −5…+5 везде — охота и источники ресурса/Маммона
  once('win1007', () => Object.assign(cf, { lvlBelow: 5, farmLvlBelow: 5, farmLvlAbove: 5 }));
  once('oriOff1005', () => { if (/^oriharukon ore$/i.test(String(C('farmRes') || '').trim())) Object.assign(cf, { farmRes: '', farmNeed: 0 }); });   // 10.0.5 (игрок 12.10 15:54: «убери эту цель… на будущее»): цель фарма Oriharukon Ore снята; в базовом профиле и умолчаниях цели нет
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
    cfg = withRb({ ...L2EngineCore.rawTaskConfig(cfg), ...cf });
    if (on && !tabOwner) deferredMigrations.cfg = { ...deferredMigrations.cfg, ...cf };
    else setCfg(cf).catch(() => {});
  }
  if (Object.keys(rf).length) {
    if (on && !tabOwner) deferredMigrations.rt = { ...deferredMigrations.rt, ...rf };
    else setRt(rf);
  }
  try { dock(); } catch (e) {}
  if (isBattle()) setTimeout(() => hotbarRows3().catch(() => {}), 800);   // и при выключенном боте — 3 ряда открыты всегда
  if (isEpicPage()) setTimeout(() => epicListScan().catch(e => console.warn(TAG, 'эпики: список страницы', e)), 1800);
  if (/magister/i.test(location.pathname)) [2500, 6000].forEach(ms => setTimeout(() => { try { learnSkillDb(); } catch (e) {} }, ms));   // 7.1.31: ранги/описания навыков — и при выключенном боте
  draw(); main();
  if (!on && rt.invScan) invScanDrive();
}));
