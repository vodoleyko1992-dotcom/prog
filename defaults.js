/* L2wap Bot — общие умолчания настроек.
 * 20.13 (ревизия 17.10, шаг 7, defaults/D12 + quality/L3): единый источник умолчаний. Раньше DEF_CFG (content.js, движок)
 * и DEF (popup.js, меню) велись вручную двумя копиями. Теперь обе берут таблицу отсюда: content.js — L2Defaults.CFG,
 * popup.js — тот же объект (в меню добавились только 7 ключей, которых там не было: dockMin, potSlotAuto, weaponClassPick,
 * weaponScanAuto, rbExpValue, rbPotCost, magisterSkip — меню их не показывает, а импорт принимал их и раньше с тем же типом
 * через CFG_IMPORT_EXTRA). Значения перенесены из DEF_CFG без изменений; base-profile.json применяется только к пустой
 * установке и ключей режимов не содержит (tests/v2013-defaults-shared).
 * Подключается: manifest content_scripts перед content.js, popup.html перед popup.js. Без DOM/chrome — тестируется в Node.
 */
(function (root) {
'use strict';
// 19.10.2026 (игрок: админ разрешил до 8000 обычных мобов в сутки суммарно): у мобов точный заводской лимит,
// у рыбы диапазон 1511–1564 с одним выбором на сутки. До первого выбора рыбы действует нижняя граница.
const DAILY_RANGE = { min: 1511, max: 1564 }, DAILY_KILL_DEF = 8000, DAILY_FISH_DEF = DAILY_RANGE.min;
const DAILY_RANGES_DEF = () => ({ dailyFishLimit: { ...DAILY_RANGE } });
const DEF_CFG = { mmOrders: true, mmTpMax: 500000, mmGoalItem: 0, mmGoalLvl: 5, mmGoalFarm: true, mmShopBuy: true, mmSmithAuto: true, mmUpgrade: true, mmCrafter: 'Skye', mmCraftScope: 'next', mmCraftSend: true, mmCraftNote: true, mmMailClaim: true, storyTurnIn: true, storyTpMax: 100000, mmFarmBest: true, mmFarmDrop: true, mmFarmSpoil: 'auto', mmFarmGuide: true, subCraftSelf: true, subSpoilFirst: true, subMainNick: '', subHelpMain: true, subMasterTp: 'oren', subTpMax: 100000, craftAuto: false, craftMammon: true, craftMpKeep: 20, craftMode: false, craftMpPots: true, crafterKit: true, epicMode: false, epicList: 'ak,core,orfen,baium,valakas,antharas,frintezza,zaken', epicMaxDeaths: 5, epicCheck: false, epicRetreatHp: 35, epicLvlUp: 0, epicCoinDailyMax: 0, epicCoinPerBoss: 1, epicCoinKeep: 0, epicMaxFightMin: 0, epicMaxRetreats: 8, epicAdenaDailyMax: 0, epicMinHpPots: 0, recipeRes: '', recipeNeed: 0, recipeSpoil: false, catMode: false, catDungeon: 'auto', nKeyBuffs: '', keyBuffBoss: true, nToggles: '', toggleMpOff: 10, toggleMpOn: 30, nSpoil: '', nSpoilMass: '', nSweep: '', spoilRb: false, rbNearMobs: true, tvtOn: true, tvtHoldMin: 3, tvtOverRb: true, tvtPet: true, pvpOnSight: true, enemyHunt: true, enemyFlagOnly: true, enemyLvlAbove: 3, enemyMinHits: 3, enemyMaxLoss: 2, enemyScanS: 30, fightMode: 'dps', combatProfile: 'auto', rbPotAt: 75, rbPotTo: 80, rbFrenzyDive: false, nUltra: '', ultMode: 'big', nDrain: '', drainHp: 85, indMode: 'full', autoLearn: true, netLog: true, gameMsgLog: true, learnShots: false,
  "petFullAuto":false,"petFullBudget":10000000,"petFullMaxPrice":10000000,"petFullReserve":null,"petFullRenew":true,"petHealPrefer":"heal",
  autoLs: { targets: [], maxAttempts: 10, buyMaterials: true, aaBudget: 2000000, adenaBudget: 2000000, aaReserve: 0 },
  craftChain: true, craftNotify: true,
  enchantMode: false,
  enchant: {"enabled":false,"queue":[],"scrollPolicy":"blessed","ordinaryUntil":3,"maxAttempts":0,"maxScrolls":0,"maxAdena":0,"maxConsecutiveFails":2,"maxDropFromStart":1,"maxDropFromPeak":2,"delayMs":1500,"batchSize":1,"purchase":false,"colBudget":0},
  priority: '[квест]\n[чемп]\n[все]',
  rec: true, autoSnap: true, questStop: false, dock: true, dockMin: false, notifyStops: true,   // 20.43: уведомление и «!» о самоостановке
  fishMode: false, rodEnchantTo: 10, fishTimeAuto: false, fishTimePack: '6h', fishTimeMin: 5, fishBait: 'auto', farmLvlBelow: 5, farmLvlAbove: 5, rbSessBuffs: 'auto', rbSessNob: true, epicFaFull: true, rbFaFull: true, rbProbe: true, fishShots: true, fishAutoBuy: true, fishBuyPacks: 100, fishShotPacks: 750, fishShotAuto: true, fishMaxCasts: 0, fishSrvCd: true,
  autoMagister: true, magisterEvery: 1, potSlotAuto: true, debuffAuto: true, debuffMode: 'auto', nDebuff: '', fishProcess: true, fishProcessEvery: 100, fishOpenBoxes: true, fishGoal: '', weaponClassPick: true, weaponClassEquip: true, weaponManual: false, weaponScanAuto: true, shopAuto: true, shopReserve: 200000, shopMaxSpend: 2000000, shopHp: '300/1000', shopMp: '200/1000', shopShots: '1000/5000', shopSpirit: '0/1000', shopSoul: '0/1000', shopBait: '0/0', zoneAuto: false, autoKillLimit: 0, catKillLimit: 0, dailyFishLimit: DAILY_FISH_DEF, dailyKillLimit: DAILY_KILL_DEF, limitRanges: DAILY_RANGES_DEF(), zoneTrial: 20, zoneAbove: 10, rbMaxBelow: 9, townBuffSet: 'basic', vipBuffAuto: true, vipResists: true, faBuffs: '', resQuests: '', rbMpPots: true, rbFast: true, rbTour: false, farmRes: '', farmNeed: 0,
  campaign: false, campAuto: true, champBlue: true, champOrange: true, champRed: false, champMinLvl: 20, autoRevive: true, campaignEvery: 25,   // 10.0.10: campAuto — сюжетный квест новичка бот ведёт сам (герой < 40)
  autoRoles: true, nWeaponMain: '',
  rbValueTour: false, rbScrollFirst: true, rbExpValue: 0.20, rbPotCost: 500, rbMode: false, rbBandAuto: true, rbTurnPrice: true, rbSpikeRhythm: true, rbCharge: true, rbChipRetreat: false, rbChipMaxAttempts: 3, rbRetreatHp: 20, rbRestHp: 95, rbMaxAbove: 15, rbMaxKillMin: 30, rbRespH: 8, rbTimerAll: false, rbUsePots: true, rbPotReserve: 10,
  // 20.46 (лог 22.10 10:41:52, просьба «на карту реже»): плановый поиск целей раз в 100 боёв; срочные дела и ресурсные 50 — отдельно.
  autoTasks: null, taskOnly: false, tsGoalItem: 920033, tsBuy: false, dailyAuto: true, clanTasks: true, chain: true, searchQuest: true, searchChamp: true, champFa: true, champLeave: true, noCancelMobs: true, cancelMobs: '', champCancel: 'efficiency', champEvery: 100, deepEvery: 100,
  catNoFa: true,   // 20.16: в катакомбах баффы за FA не покупаются, висящие не мешают бою (buffs.catNoFa)
  cancelFreeOk: true,   // 20.16: обычный моб, снимающий баффы, — цель, пока нет платных баффов за FA (buffs.cancelRisk)
  lvlMin: 1, lvlMax: 99, lvlAbove: 5, lvlBelow: 5, maxPages: 3, sealAuto: false, sealMin: 1,
  champMark: 'чемпион, чемпіон', bossMark: 'босс, boss, рейд', champHpMult: 1.5, stunEvery: 15,
  actionDelayMs: 1000, reactMin: 150, reactMax: 450, buffSec: 118,
  stopHp: 25, hpPotAt: 50, mpPotAt: 70, skillMpMin: 35, warlordAggro: true, destroyerLimits: true, fastTurn: true,
  // 20.13 (ревизия 17.10, шаг 5, quality/L3): скрытые настройки, умолчание которых раньше жило только в месте чтения
  // (`?? 30`, `!== false`…). Значения те же, поведение не меняется; теперь они видны в cfg, экспорте и проверке
  // tests/v2013-defaults-sync. Резервные `??` в модулях оставлены для старых тестовых окружений без DEF_CFG.
  mageEcoPct: 30, mageMpPct: 25, mageProbe: true, rbVampHp: 60, rbDeathPenalty: 0, magisterSkip: 'Curse Weakness, Poisonous Cloud', magisterSpReserve: 0,
  fishRodBuy: true, fishAutoSetup: true,
  // слоты панели — по названию (атрибут title), через запятую — альтернативные написания
  nAttack: 'Атака', nPower: 'Iron Punch', nStun: 'Stunning Fist', nBuffs: 'Totem Spirit Bear',
  nShots: 'Заряд душі, Заряд души, Soulshot', nMpPot: 'Зілля мани, Зелье маны, Mana Potion', nHpPot: '', nHeal: '',
  // энергия силы: кто копит и кто тратит («Имя=цена»)
  nCharge: 'Focused Force', nForce: 'Hurricane Assault=2, Force Blaster=1',
  // 7.1.31: 🐱 слуга (Warlock): какого кота призывать (пусто — того, что был, иначе первого на панели), пороги, добивание котом, баффы кота
  debuffMinActs: 10,   // 7.1.31: дебафф в «авто» — только если бою ещё ≥ 10 действий (окупаемость хода)
  petAuto: true, petSummon: '', petResummon: true, petResummonAt: 25, petHealAt: 50, petFinish: false, petFinishMp: 80, petBuffAuto: true, nPetBuffs: '', petBuffSec: 1200,
  // 20.13 (ревизия 17.10, шаг 5, defaults/D11): скрытые настройки, которые читались только через «?? N» по месту, — с теми же значениями,
  // чтобы они были видны в экспорте настроек и при разборе лога. Поведение не меняется (значения равны прежним запасным).
  // Остальные такие ключи (mageMpPct, mageEcoPct, rbVampHp…) — выше, в блоке quality/L3.
  rbHuntMode: false, rbOrder: 'up',
  // 20.13 (ревизия 17.10, шаг 5, defaults/D16): банка MP у воина — от доли MP (как mageMpPct у мага), а не только от 70 MP: «MP не экономим».
  fighterMpPct: 25,
};
// 20.25 (19.10, игрок: «пока убираем модуль автозаточки»): импорт и старые профили
// сохраняют очередь/историю, но не могут выбрать снятую задачу или запустить фарм вместо неё.
function withoutAutoEnchant(c = {}) {
  const n = { ...c, enchantMode: false };
  if (Array.isArray(c.autoTasks)) n.autoTasks = c.autoTasks.filter(k => k !== 'enchant');
  else if (c.enchantMode === true) n.taskOnly = true;
  if (c.enchant && typeof c.enchant === 'object') n.enchant = { ...c.enchant, enabled: false };
  return n;
}
root.L2Defaults = { AUTO_ENCHANT_DISABLED: true, withoutAutoEnchant, DAILY_RANGE, DAILY_KILL_DEF, DAILY_FISH_DEF, DAILY_RANGES_DEF, CFG: DEF_CFG };
if (typeof module !== 'undefined' && module.exports) module.exports = root.L2Defaults;
})(typeof globalThis !== 'undefined' ? globalThis : this);
