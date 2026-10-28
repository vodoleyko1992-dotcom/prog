/* Автобаф суммона: отдельная дополнительная задача, без смены основного режима. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.warlock = function create_warlock(env) {
const DEF = { petFullAuto: false, petFullBudget: 10000000, petFullMaxPrice: 10000000, petFullReserve: null, petFullRenew: true };
const number = x => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : typeof x === 'string' && /^\d+$/.test(x) && Number.isSafeInteger(+x) ? +x : null;
// 20.71: отдельный поход использует только прежние явные разрешения на суммона, не включает чужие службы.
const rebirthConfig = () => env.rebirthCfg?.() || null;
const REBIRTH_OPTIONS = new Set(['petFullAuto','petFullBudget','petFullMaxPrice','petFullReserve','petFullRenew','shopReserve']);
const option = k => { const own=rebirthConfig();return (own&&REBIRTH_OPTIONS.has(k)?own[k]:env.cfg[k]) ?? DEF[k]; };
const state = () => env.rt.petFull || {};
const charName = () => String(env.rt.char || '');
const mine = T => env.tabOwner === true && T?.lease === env.leaseEpoch && !!T?.char && charName() === T.char && env.heroNick() === T.char;
const active = () => env.on === true && env.tabOwner === true && option('petFullAuto') === true;
const priority = afterWin => env.canRun?.() !== false && (!env.rt.autoLs?.hold || !!rebirthConfig()) && !env.rt.autoLs?.pending && (!env.isBattle() || (afterWin && env.victory())) && !env.fishState()
  && !env.tvtHold() && !env.abHold() && !env.antibotState() && !env.rt.revive && !env.rt.shop?.urgent;
// 20.60 (John 24.10: «Убери вообще лимит на Бафф суммонов»; лог 22:13–22:15 — тур РБ ждал «Бюджет автобафа исчерпан»): общий бюджет
// наборов снят. petFullBudget больше не читается и не входит в ключ ожидания — старое ожидание «бюджет» после обновления снимается сразу.
// Остались защита цены одного набора, резерв адены и запрет повторной оплаты при неизвестном исходе
const signature = () => JSON.stringify([option('petFullAuto'), option('petFullMaxPrice'), option('petFullReserve'), env.cfg.shopReserve, option('petFullRenew')]);
const token = () => ({ char: charName(), lease: env.leaseEpoch, kick: +env.rt.manualKickAt || 0, config: signature(), rebirth:!!rebirthConfig() });
const same = (T, afterWin) => mine(T) && active() && T.kick === (+env.rt.manualKickAt || 0) && T.config === signature() && T.rebirth===!!rebirthConfig() && priority(afterWin);
// 20.43 (разбор 21.10, ревью): каждый срок следующей проверки пишется вместе с ключом, при котором он назначен (waitKey). Иначе после
// Старта/смены настроек срок из веток «нет кота»/«класс»/«каталог»/«бой»/«ошибка чтения» не совпадал с ключом и не действовал — GET на каждом круге
const patch = p => env.setRt({ petFull: { ...state(), ...p, ...('nextCheckAt' in p ? { waitKey: waitKey() } : {}) } });
const pendingSame = P => state().pending?.id === P?.id;
let paymentPoll = null;
let busy = false, serial = 0, latest = null, latestSeen = false, latestHero = null, latestCombat = null, latestCombatPlan = null, latestDefense = null, prepared = null, preparedSource = null, snapshotOwner = '', snapshotRevision = -1, snapshotEvidenceAt = 0;
const unsent = new Set();
// 20.76+ (ревизия 28.10): отказ core gamePost ДО fetch (Stop/замок, PvP, устаревший кадр действий, ЛС, неподтверждённая оплата) — покупка
// не уходила на сервер; это не «ответ потерян». Тот же список, что craft.js/crafterkit.js NOT_SENT
const NOT_SENT = /^(?:bot_inactive|action_cancelled|pvp_defeat_pending|payment_unconfirmed|lifestone_session_active)$/;
const classProf = p => String(p || '').trim().toLowerCase().replace(/[ -]+/g,'_').replace(/^human_/, '');
// 20.67 (лог 27.10 11:44): после Rebirth Wizard уже призывает Mew/Kat — коту нужен тот же автобаф до второй профессии.
const catClass = p => /^(wizard|warlock|arcana_lord)$/.test(classProf(p));
// 20.45 (лог 22.10 09:03, John «не взял бафф на суммона перед РБ»): платный «Повний баф сумона» берёт и голем крафтера
// (Warsmith / Maestro, Mechanic Golem из набора РБ crafterkit). Раньше задача молча стояла на «нужен класс Warlock…».
const FULL_CLASS = /^(wizard|warlock|arcana_lord|dark_avenger|hell_knight|warsmith|maestro)$/;
const fullProf = p => String(p || '').trim().toLowerCase().replace(/[ -]+/g,'_').replace(/^(?:human|dwarf)_/, '');
const fullClass = p => FULL_CLASS.test(fullProf(p));
const golemClass = p => /^(warsmith|maestro)$/.test(fullProf(p));
let classBusy = false, classReadAt = 0, classRevision = -1, classOwner = '', classSeenKey = '', raidBusy = false, raidProof = null;
// 23.10.2026, решение игрока: на активном котоводе восстанавливать выключенный автобаф и при повторном снимке, без сброса бюджета.
async function autoEnableClass(ch) {
  if (rebirthConfig()) return false; // Подготовка похода не переписывает сохранённый список задач/разрешения игрока.
  if (!env.on || !env.tabOwner || ch?.name !== charName() || ch.name !== env.heroNick()
    || !Number.isSafeInteger(ch.revision) || !Number.isInteger(ch.classSlots?.activeSlot) || !ch.l2Profession) return false;
  const key = `${ch.classSlots.activeSlot}:${classProf(ch.l2Profession)}`, old = env.rt.petClassEntry;
  if (classOwner !== ch.name) {classOwner=ch.name;classRevision=-1;classSeenKey='';}
  if (ch.revision < Math.max(classRevision, old?.char === ch.name ? old.revision : -1) || ch.revision === classRevision && classSeenKey && classSeenKey !== key) return false;
  classRevision = ch.revision;classSeenKey=key;
  if (classBusy) return false;
  // В явном списке задач petFullAuto скрыт, пока не разрешён petbuff: включаем и саму галочку задачи.
  const tasks = env.cfg.autoTasks, needsTask = Array.isArray(tasks) && !tasks.includes('petbuff');
  const needsEnable = catClass(ch.l2Profession) && (needsTask || env.cfg.petFullAuto !== true || env.cfg.petBuffAuto !== true);
  if (old?.char === ch.name && old.key === key && old.kick === (+env.rt.manualKickAt || 0) && !needsEnable) return false;
  const who = ch.name, epoch = env.leaseEpoch, kick = +env.rt.manualKickAt || 0;
  const valid = () => env.on && env.tabOwner && charName() === who && env.heroNick() === who && env.leaseEpoch === epoch && (+env.rt.manualKickAt || 0) === kick && classOwner === who && classSeenKey === key;
  classBusy = true;
  try {
    if (catClass(ch.l2Profession) && typeof env.setCfg === 'function') {
      if (!valid()) return false;
      await env.setCfg({ petFullAuto:true, petBuffAuto:true, ...(needsTask ? { autoTasks:[...tasks,'petbuff'] } : {}) });
      if (!valid()) return false;
      env.rec?.('B','суммон','Активен котовод — включён полный автобаф кота; бюджет и резерв сохранены');
    }
    if (!valid()) return false;
    return (await env.setRt({ petClassEntry:{char:who,key,kick,revision:ch.revision,t:Date.now()} }))?.ok === true;
  } finally { classBusy = false; }
}
async function classAutoTick() {
  if (rebirthConfig()) return false;
  if (!env.on || !env.tabOwner || !charName() || charName() !== env.heroNick() || env.canRun?.() === false || env.isBattle() || Date.now() < classReadAt || classBusy) return false;
  classReadAt = Date.now() + 15000;
  const who = charName(), epoch = env.leaseEpoch;
  try { const d = await read('/character'); if (env.on && env.tabOwner && who === charName() && epoch === env.leaseEpoch) { const ch=d.character||d;if(ch?.name===who&&Number.isSafeInteger(ch.revision)&&ch.revision>=Math.max(classOwner===who?classRevision:-1,env.rt.petClassEntry?.char===who?env.rt.petClassEntry.revision:-1)){env.classNote?.(ch);return autoEnableClass(ch);} } } catch (_) {}
  return false;
}
const raidSettings = () => JSON.stringify([env.cfg.petAuto !== false,env.cfg.petBuffAuto !== false,env.cfg.petSummon || '',env.cfg.nPetBuffs || '']);
const raidClass = () => `${env.rt.classCur?.slot}:${classProf(env.rt.classCur?.prof || env.rt.prof)}`;
const raidManaged = () => /^(wizard|warlock|arcana_lord|dark_avenger|hell_knight)$/.test(classProf(env.rt.classCur?.prof || env.rt.prof)) && env.cfg.petAuto !== false;
// 20.43 (лог 21.10 15:47–15:51): общий шаг кота вне боя — тур РБ (raid) и подготовка после Старта (start).
const PREP = { raid: { jobKey: 'petRaidPrep', tag: 'Перед РБ', wanted: () => env.raidWanted?.() !== false }, start: { jobKey: 'petPrep', tag: 'Старт', wanted: () => env.startPrepWanted?.() === true } };
const prepSafe = wanted => env.on && env.tabOwner && priority(false) && env.canAct?.() !== false && wanted();
const raidSafe = () => prepSafe(PREP.raid.wanted);
const effectEnd = b => Number.isFinite(b?.expiresAtMs) ? b.expiresAtMs : Number.isFinite(b?.expiresAt) ? b.expiresAt : 0;
const hasNative = (ch,x) => ch.activeSummon?.activeBuffs?.some(b => +b.skillId === x.effectId && effectEnd(b) > Date.now()+5000) === true;
// 20.43 (разбор 21.10): один потерянный клик призыва/баффа кота перед РБ навсегда держал loopGate — pending ждал свежую ревизию без срока,
// а каждый круг (≈0,3 с) уходил свой GET /character. Теперь ожидание читает /character не чаще раза в 1,5 с первые 15 с после клика
// (обычное подтверждение) и раза в 12 с дальше; через 2 мин без подтверждения — один повтор (навык стоит только MP). Второй провал:
// бафф пропускается на час (к РБ без него), без призыва тур РБ откладывается на 30 мин (Warlock без кота слаб; raid → raidBlocked).
// Пропуск снимают новый Старт, смена настроек кота/класса, для призыва — живой кот в свежем полном снимке /character игры.
const RAID_CONFIRM_MS = 120000, RAID_READ_FAST = 1500, RAID_READ_SLOW = 12000, RAID_READ_WAIT = 3000, RAID_SKIP_BUFF_MS = 3600000, RAID_HOLD_SUMMON_MS = 1800000;
let raidReadAt = null;                 // {char, until, fail} — следующее чтение /character во время ожидания (fail — после сбоя чтения)
let raidFailMs = 0;                    // 20.43 (доводка 21.10): растущая пауза после сбоя чтения /character перед РБ: 1,5 → 3 → 6 → 12 с
// 20.43 (автономность, доводка 21.10, ревью): и подготовка после Старта — {char, gen, until, fail}. Раньше на Старте ни later(), ни failLater()
// паузы не ставили: при 429/5xx/HTML на GET /character задача petPrep ещё не записана (она пишется после удачного чтения), ветка loopGate со
// сном 0,3 с не срабатывала, а loopStartPrep возвращал true без сна — GET /character шёл с частотой ответов сервера (при быстрых 429 — 5–20 в
// секунду) все 2 мин этапа, на каждом Старте и после воскрешения; удачное чтение в ожидании подтверждения/MP/панели — ≈3 раза в секунду.
// Теперь сбой — пауза 1,5 → 3 → 6 с (этап Старта всё равно ≤ 2 мин), ожидание — 1,5 с (подтверждение, панель) или 3 с (MP, откат).
let startReadAt = null, startFailMs = 0;
const START_READ_FAIL_MAX = 6000;
const raidWaitSince = new Map();       // вид ожидания → {at, last, said}: с какого момента ждём панель/призыв (перерыв > 30 с — заново)
const raidSkip = () => { const S = env.rt.petRaidSkip; return S && S.char === charName() && S.classKey === raidClass() && S.settings === raidSettings() && S.kick === (+env.rt.manualKickAt || 0) ? S : null; };
const buffSkipped = x => (raidSkip()?.buffs?.[x.effectId] || 0) > Date.now();
const summonHeld = () => { const S = raidSkip(); return S?.summonUntil > Date.now() && !(latest && latest.char === charName() && latest.at > (S.summonAt || 0)); };
// 20.43 (ревью): срок отсрочки — туру, чтобы на это время передать ход выбранной рыбалке (rbFishWait), как при пустом туре
const raidHoldUntil = () => raidManaged() && summonHeld() ? env.rt.petRaidSkip.summonUntil : 0;
function raidBlocked() {
  const until = raidHoldUntil(); if (!until) return '';
  return `призыв кота перед РБ не подтвердился и после повтора — тур отложен до ${new Date(until).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} (снимут новый Старт или кот, призванный вручную)`;
}
function raidReady() {
  return !raidManaged() || !!raidProof && raidProof.char === charName() && raidProof.classKey === raidClass() && raidProof.settings === raidSettings()
    && raidProof.kick === (+env.rt.manualKickAt || 0) && raidProof.until > Date.now() && !env.rt.petRaidPrep;
}
// 20.43: отметка подготовки после Старта: 'summon' — кот жив, 'pet' — кот и его баффы; failed — бесплатный каст не подтвердился, задача идёт.
// 20.43 (ревью): отметка и сохранённая задача привязаны к этой подготовке (rt.startPrep.id: новый Старт, воскрешение, «кот пропал вне боя») —
// старая отметка не отвечает «кот готов» новой подготовке, старая задача прошлого Старта снимается без «не уложилась в 2 мин».
let startProof = null, raidSummonProof = null;
const startGen = () => +env.rt.startPrep?.id || 0;
const startProofOk = () => !!startProof && startProof.char === charName() && startProof.classKey === raidClass() && startProof.settings === raidSettings()
  && startProof.kick === (+env.rt.manualKickAt || 0) && startProof.gen === startGen() && startProof.until > Date.now();
function startReady(phase = 'pet') {
  return !raidManaged() || startProofOk() && !env.rt.petPrep && (startProof.failed || phase === 'summon' || startProof.phase === 'pet');
}
// Родная внебоевая панель сама формирует POST /character/skills/cast; тело запроса не выдумываем.
async function petPrepare(o = {}) {
  const start = o.reason === 'start', R = start ? PREP.start : PREP.raid, jobKey = R.jobKey, tag = R.tag, wanted = o.wanted || R.wanted;
  const rebirthPrep = o.returnPath === '/rebirth-raids.html' && !!rebirthConfig(), returnPath = rebirthPrep ? o.returnPath : null;
  // 20.43: buffs:false — только призыв (Старт и тур РБ: кот → баффы героя → баффы кота); продолжение сохранённой задачи берёт её вид.
  const buffs = o.buffs ?? env.rt[jobKey]?.buffs !== false;
  if (raidBusy) return true;
  // Смена режима отменяет бесплатный native-cast маршрут, а не платёжную квитанцию полного набора.
  if(env.rt[jobKey]?.rebirth===true&&!rebirthPrep){
    if(env.tabOwner===true&&env.rt[jobKey].char===charName())await env.setRt({[jobKey]:null});
    return false;
  }
  if (!raidManaged()) { if (env.rt[jobKey] && env.tabOwner) await env.setRt({[jobKey]:null}); return false; }
  if (!prepSafe(wanted)) return false;
  if (start) {
    if (startProofOk() && startProof.failed) return false;
    let J0 = env.rt.petPrep;
    if (J0 && J0.gen !== startGen()) { if (!env.tabOwner || (await env.setRt({ petPrep: null }))?.ok !== true) return true; J0 = null; }
    // Бесплатные касты: задача Старта не держит бота дольше 2 мин, даже если GET или панель не отвечают.
    if (J0 && Date.now() - (+J0.t || 0) > 120000) return startGiveUp(J0, 'подготовка кота не уложилась в 2 мин');
    if (startReady(buffs ? 'pet' : 'summon')) return false;
    // 20.43 (автономность, доводка 21.10, ревью): ожидание и сбой чтения на Старте — с паузой (startReadAt), а не GET на каждом круге;
    // новое поколение подготовки (новый Старт, воскрешение, «кот пропал вне боя») читает сразу, срок 2 мин выше проверяется и в паузе
    if ((env.rt.petPrep || startReadAt?.fail) && startReadAt?.char === charName() && startReadAt.gen === startGen() && Date.now() < startReadAt.until) return true;
  } else {
    if (raidReady() || !buffs && raidSummonProof?.char === charName() && raidSummonProof.classKey === raidClass() && raidSummonProof.kick === (+env.rt.manualKickAt || 0) && raidSummonProof.until > Date.now()) return false;
    // 20.43 (разбор 21.10): отсрочка после двух неподтверждённых призывов — без GET и родной панели; тур ждёт сам (raid → raidBlocked)
    if (summonHeld()) return false;
    // 20.43: ожидание (подтверждение, MP/откат, панель) не перечитывает /character на каждом круге главного цикла
    // 20.43 (доводка 21.10): и сбой чтения (401/429/5xx, HTML вместо JSON, чужой/боевой снимок) — тоже, даже до записи задачи petRaidPrep
    if ((env.rt.petRaidPrep || raidReadAt?.fail) && raidReadAt?.char === charName() && Date.now() < raidReadAt.until) return true;
  }
  raidBusy = true;
  const who=charName(),epoch=env.leaseEpoch,kick=+env.rt.manualKickAt||0,key=raidClass(),settings=raidSettings();
  const gen=start?startGen():undefined,prepPage=env.nativePanelPath?.();
  const valid=()=>prepSafe(wanted)&&charName()===who&&env.heroNick()===who&&env.leaseEpoch===epoch&&(+env.rt.manualKickAt||0)===kick&&raidClass()===key&&raidSettings()===settings&&(!start||startGen()===gen&&env.nativePanelPath?.()===prepPage);
  const save=async j=>valid()&&(await env.setRt({[jobKey]:j&&rebirthPrep?{...j,rebirth:true,ownerMode:'rebirth',prof:env.rt.classCur?.prof,slot:env.rt.classCur?.slot}:j}))?.ok===true&&await env.rtCommit()&&valid();
  const proof=(phase,failed)=>{const P={char:who,classKey:key,settings,kick,gen,phase,failed:!!failed,until:Date.now()+(failed?120000:30000)};if(start)startProof=P;else if(phase==='pet')raidProof=P;else raidSummonProof=P;};
  // Старт: задача идёт без кота (касты бесплатные), призыв и баффы — в бою
  const giveUp=async(J,why)=>{if(!await save(null))return true;proof('pet',true);env.rec?.('B','суммон',tag+': '+why+' — начинаю задачу, призыв и баффы кота будут в бою');
    if(J?.back&&env.nativePanelPath?.()==='/skill-panel.html'&&J.back!=='/skill-panel.html'&&valid())env.nativeNavigate?.(J.back);return false;};
  // 20.43: тур РБ — ожидание с редким чтением /character (raidReadAt)
  // 20.43 (автономность, доводка 21.10, ревью): на Старте — тоже (startReadAt), раньше там каждый круг
  const later=ms=>{if(start)startReadAt={char:who,gen,until:Date.now()+ms};else raidReadAt={char:who,until:Date.now()+ms};return true;};
  // 20.43 (автономность, доводка 21.10): сбой чтения /character (исключение, d.error, HTML) и снимок не того героя/в бою/не того класса
  // возвращали true без later(): loopGate спал 0,3 с и снова слал свой GET /character — 2–3 раза в секунду всё время сбоя, а при 429 это
  // ещё и усиливало ограничение игры. Теперь растущая пауза 1,5 → 3 → 6 → 12 с; удачное чтение её сбрасывает.
  // Ревью: на Старте то же, пауза 1,5 → 3 → 6 с (этап Старта ≤ 2 мин) — раньше на Старте паузы не было вовсе
  const failLater=()=>{
    if(start){startFailMs=Math.min(START_READ_FAIL_MAX,startFailMs?startFailMs*2:RAID_READ_FAST);startReadAt={char:who,gen,until:Date.now()+startFailMs,fail:true};return true;}
    raidFailMs=Math.min(RAID_READ_SLOW,raidFailMs?raidFailMs*2:RAID_READ_FAST);raidReadAt={char:who,until:Date.now()+raidFailMs,fail:true};return true;};
  // 20.43: тур РБ, окончательный отказ от навыка — бафф пропускается на час, призыв откладывает тур на 30 мин; запись до снятия pending
  const raidGiveUp=async(P,note)=>{
    const now=Date.now(),old=raidSkip(),buffs=Object.fromEntries(Object.entries(old?.buffs||{}).filter(([,t])=>t>now));
    const S={char:who,classKey:key,settings,kick,buffs,summonUntil:old?.summonUntil>now?old.summonUntil:0,summonAt:old?.summonAt||0};
    if(P.kind==='summon'){S.summonUntil=now+RAID_HOLD_SUMMON_MS;S.summonAt=now;}else if(P.effectId)S.buffs[P.effectId]=now+RAID_SKIP_BUFF_MS;
    if(!valid()||(await env.setRt({petRaidSkip:S}))?.ok!==true||!valid())return false;
    env.rec?.('B','суммон',note||(P.kind==='summon'?`Перед РБ: призыв «${P.name}» не подтвердился и после повтора — без кота тур РБ отложен на 30 мин`
      :`Перед РБ: «${P.name}» не подтвердился и после повтора — иду к РБ без него (снова попробую через час)`));
    return true;
  };
  // 20.43: без кота подготовка невозможна (призыв дважды не подтвердился или его нет на панели) — назад и отсрочка тура
  const holdSummon=async(J,P,note)=>{if(!await raidGiveUp(P,note))return true;raidWaitSince.clear();const back=J?.back;if(await save(null)&&valid()&&env.nativePanelPath?.()==='/skill-panel.html'&&back&&back!=='/skill-panel.html')env.nativeNavigate?.(back);return true;};
  const waited=(kind,on)=>{const k=[who,key,settings,kind].join('|'),now=Date.now();let w=raidWaitSince.get(k);if(!on){raidWaitSince.delete(k);return null;}
    if(!w||now-w.last>30000)raidWaitSince.set(k,w={at:now,last:now,said:false});w.last=now;return now-w.at>=RAID_CONFIRM_MS?w:null;};
  try {
    if (!env.rt[jobKey]?.pending && env.actionWait && !await env.actionWait(valid)) return true;
    if (!valid()) return true;
    const data=await read('/character'),ch=data.character||data;
    if(!valid())return true;
    if(ch.name!==who||!Number.isSafeInteger(ch.revision)||`${ch.classSlots?.activeSlot}:${classProf(ch.l2Profession)}`!==key)return failLater();
    // 20.65 (лог 26.10 12:57: Старт на почте после паузы между боями): сервер ещё ведёт прежний бой, хотя страница уже вне боя.
    // Сначала возвращаемся в подтверждённый бой; живой кот не разрешает пропустить сверку и начать новую задачу.
    if(start&&ch.inBattle===true){
      if(typeof env.resumeStartBattle==='function'&&await env.resumeStartBattle(ch,valid))return true;
      if(!valid())return true;
      env.setStatus?.('Старт: незавершённый бой не подтверждён — повторю сверку');return failLater();
    }
    if(ch.inBattle!==false)return failLater();
    if(start){startFailMs=0;if(startReadAt?.fail)startReadAt=null;}else{raidFailMs=0;if(raidReadAt?.fail)raidReadAt=null;}
    noteSnapshot(ch);
    let J=env.rt[jobKey];
    if(J&&(J.char!==who||J.classKey!==key)){await save(null);return true;}
    if(J&&(rebirthPrep&&!J.rebirth||returnPath&&J.back!==returnPath||!J.pending&&(J.settings!==settings||J.kick!==kick||J.buffs!==buffs))){J={...J,settings,kick,buffs,...(returnPath?{back:returnPath}:{})};if(!await save(J))return true;}
    const pet=summon(ch),pending=J?.pending;
    if(pending){
      const confirmed=ch.revision>pending.revision&&(pending.kind==='summon'?pet&&+pet.summonSkillId===pending.skillId:pet&&hasNative(ch,pending));
      if(start){
        if(!confirmed){
          // 20.43: на Старте неподтверждённый бесплатный каст повторяется не больше 2 раз, затем задача идёт.
          if(Date.now()-pending.at>15000&&ch.revision>pending.revision){
            const n=(+J.retries||0)+1;
            if(n>2)return giveUp(J,'кот не подтверждён');
            if(!await save({...J,pending:null,retries:n}))return true;
            env.rec?.('B','суммон',tag+': «'+pending.name+'» не подтверждён сервером — повторю ('+n+'/2)');return true;
          }
          // 20.43 (автономность, доводка 21.10, ревью): следующее чтение — через 1,5 с (первые 15 с) или 3 с, а не на каждом круге
          const age=Date.now()-pending.at;
          env.setStatus?.(age>15000?tag+': подтвердите «'+pending.name+'» вручную на панели — продолжу после свежей сверки; автоматически не повторяю':'Подготовка кота: жду подтверждения навыка');return later(age<15000?RAID_READ_FAST:RAID_READ_WAIT);
        }
        J={...J,settings,kick,pending:null};if(!await save(J))return true;
        if(pending.kind==='summon'){const t=Date.now();await env.setRt({petBornT:t,petSummonOkT:t});}   // 20.43: и отметка принятого призыва (combat.petAlive)
      } else {
        // 20.43 (разбор 21.10): тур РБ — 2 мин ожидания с редким чтением, один повтор, затем пропуск баффа на час / отсрочка тура без кота
        const age=Date.now()-pending.at,tries=+pending.tries||1;
        if(!confirmed&&age<RAID_CONFIRM_MS){env.setStatus?.(age>15000?'Перед РБ: жду подтверждения «'+pending.name+'» — можно нажать вручную на панели, иначе через 2 мин '+(tries<2?'повторю один раз':'продолжу без него'):'Подготовка кота: жду подтверждения навыка');return later(age<15000?RAID_READ_FAST:RAID_READ_SLOW);}
        if(confirmed){J={...J,settings,kick,pending:null,retry:null};if(!await save(J))return true;if(pending.kind==='summon'){const t=Date.now();await env.setRt({petBornT:t,petSummonOkT:t});}}
        // 20.43: кот уже есть (другой призыв) — повтор призыва и отсрочка тура не нужны, дальше баффы
        else if(pending.kind==='summon'&&pet){J={...J,settings,kick,pending:null,retry:null};if(!await save(J))return true;}
        // 20.43: 2 мин без подтверждения — клик, видимо, потерялся: один повтор того же навыка (только MP), затем без него
        else if(tries<2){J={...J,settings,kick,pending:null,retry:{action:pending.action,tries}};if(!await save(J))return true;env.rec?.('B','суммон',`Перед РБ: «${pending.name}» не подтвердился за 2 мин — повторю один раз (тратится только MP)`);}
        else if(pending.kind==='summon')return holdSummon(J,pending);
        else {if(!await raidGiveUp(pending))return true;J={...J,settings,kick,pending:null,retry:null};if(!await save(J))return true;}
      }
    }
    const cache=env.rt.petRaidSkills,cacheOk=cache?.char===who&&cache.classKey===key&&cache.settings===settings;
    const buffWanted=env.cfg.petBuffAuto!==false&&!!String(env.cfg.nPetBuffs||'').trim();
    const skip=new Set(start&&Array.isArray(J?.missing)?J.missing:[]);
    // 20.43: тур РБ — бафф, дважды не подтвердившийся, пропускается на час (buffSkipped)
    const want=x=>!skip.has(x.name)&&(start||!buffSkipped(x));
    // 20.43: на Старте без кэша панели эффекты берутся из справочника по именам — готовый кот не требует поездки на панель.
    const known=cacheOk?cache.rows:start?env.petBuffGuess?.():null,buffsOk=!buffWanted||Array.isArray(known)&&known.filter(want).every(x=>hasNative(ch,x));
    let needs=!pet||buffs&&!buffsOk;
    if(!needs){
      proof(buffs||start&&buffsOk?'pet':'summon');
      if(J){const back=J.back;if(!await save(null))return true;if(env.nativePanelPath?.()==='/skill-panel.html'&&back&&back!=='/skill-panel.html'){if(valid())env.nativeNavigate?.(back);return true;}}
      return false;
    }
    const page=env.nativePanelPath?.();
    if(page!=='/skill-panel.html'){
      const back=returnPath||env.nativeReturnPath?.()||'/map.html';
      if(!J){J={char:who,classKey:key,settings,kick,buffs,gen,back,pending:null,t:Date.now()};if(!await save(J))return true;}
      if(valid())env.nativeNavigate?.('/skill-panel.html');return true;
    }
    if(!J){J={char:who,classKey:key,settings,kick,buffs,gen,back:returnPath||'/map.html',pending:null,t:Date.now()};if(!await save(J))return true;}
    await env.nativePanelOpen?.();if(!valid())return true;
    const panel=env.nativePanel?.(ch)||{},rows=(panel.buffs||[]).filter(x=>!skip.has(x.name));
    // 20.43 (тур РБ): навыка из настроек нет на панели — неполная панель держала цикл без срока; через 2 мин готовим кота тем, что есть
    const pw=start?null:waited('panel',!!panel.incomplete&&(buffs||!panel.summon)),sw=start?null:waited('summon',!pet&&!panel.summon);
    if(panel.incomplete&&(buffs||!panel.summon)){
      if(!start){
        if(!pw){env.setStatus?.(tag+': жду родную панель навыков кота');return later(RAID_READ_WAIT);}
        if(!pw.said){pw.said=true;env.rec?.('B','суммон','Перед РБ: за 2 мин на панели не нашлись все навыки кота из настроек — готовлю кота тем, что есть');}
      } else {
        // 20.43: на Старте — без вечного ожидания: нет панели 10 с — в бой; нет отдельных баффов — пропускаем их один раз с записью в журнал.
        if(panel.hotbar===false||!panel.summon&&!pet){
          if(!J.hotbarWait){if(!await save({...J,hotbarWait:Date.now()}))return true;}
          else if(Date.now()-J.hotbarWait>10000)return giveUp(J,'панель навыков кота не открылась');
          env.setStatus?.(tag+': жду родную панель навыков кота');return later(RAID_READ_FAST);   // 20.43 (доводка 21.10, ревью): чтение раз в 1,5 с
        }
        if(buffs&&Array.isArray(panel.missing)&&panel.missing.length&&!J.missing){
          if(!await save(J={...J,missing:panel.missing.slice(0,10)}))return true;
          env.rec?.('B','суммон',tag+': на панели нет '+panel.missing.join(', ')+' — пропускаю');
        }
      }
    }
    if(buffs&&(await env.setRt({petRaidSkills:{char:who,classKey:key,settings,rows:rows.map(({effectId,name})=>({effectId,name}))}}))?.ok!==true||!valid())return true;
    const action=!pet?panel.summon:buffs?rows.find(x=>!hasNative(ch,x)&&want(x)):null;
    if(!action){
      if(!pet){
        if(start)return giveUp(J,'нужен навык призыва кота на панели');
        if(sw)return holdSummon(J,{kind:'summon'},'Перед РБ: за 2 мин на панели не нашёлся навык призыва кота — без кота тур РБ отложен на 30 мин');
        env.setStatus?.(tag+': нужен навык призыва кота на панели');return later(RAID_READ_WAIT);
      }
      proof(buffs?'pet':'summon');const back=J.back;if(await save(null)&&valid()&&back!=='/skill-panel.html')env.nativeNavigate?.(back);return true;
    }
    if(!action.ready||!Number.isFinite(ch.mp)||ch.mp<(action.mp||0)){env.setStatus?.(tag+': жду готовность и MP для '+action.name);return later(RAID_READ_WAIT);}
    const P={kind:pet?'buff':'summon',action:action.action,skillId:action.skillId,effectId:action.effectId,name:action.name,revision:ch.revision,at:Date.now(),tries:(J.retry?.action===action.action?+J.retry.tries||1:0)+1};
    if(!await save({...J,pending:P}))return true;
    const fresh=env.nativePanel?.(ch),button=[fresh?.summon,...(fresh?.buffs||[])].find(x=>x?.action===P.action&&x.ready);
    if(!valid()||!button){if(valid())await save({...J,pending:null});return true;}
    if(!env.nativeFire?.(button.button)){await save({...J,pending:null});return true;}
    env.rec?.('B','суммон',tag+': '+P.name+(P.tries>1?' (повтор)':''));return true;
  } catch (_) { if(!valid())return true;env.setStatus?.(tag+': не удалось подтвердить подготовку кота');return failLater(); }
  finally {raidBusy=false;}
}
// Таймаут сохранённой задачи Старта до чтения сервера: снимаем её без новой сверки (касты бесплатные).
async function startGiveUp(J, why) {
  if (!env.tabOwner || (await env.setRt({ petPrep: null }))?.ok !== true) return false;
  startProof = { char: charName(), classKey: raidClass(), settings: raidSettings(), kick: +env.rt.manualKickAt || 0, gen: startGen(), phase: 'pet', failed: true, until: Date.now() + 120000 };
  env.rec?.('B','суммон','Старт: '+why+' — начинаю задачу, призыв и баффы кота будут в бою');
  if (J?.back && env.nativePanelPath?.() === '/skill-panel.html' && J.back !== '/skill-panel.html') env.nativeNavigate?.(J.back);
  return false;
}
const raidPrepare = (o = {}) => petPrepare({ ...o, reason: 'raid' });
const startPrepare = (o = {}) => petPrepare({ ...o, reason: 'start' });
let rebirthPrepKey = '';
// Собственный вызов перед открытием боя: родной призыв/баффы, затем прежний каталог и квитанции полного набора.
// Полный набор всё так же требует подтверждённого входа в город; сюда не добавляется новый путь оплаты.
async function rebirthPrepare({ afterWin = false, wanted, returnPath = '/rebirth-raids.html' } = {}) {
  const settings=rebirthConfig();
  if(!settings||returnPath!=='/rebirth-raids.html'||typeof wanted!=='function'||!wanted()||env.on!==true||env.tabOwner!==true
    ||env.canAct?.()===false||!priority(afterWin))return false;
  const owns=()=>!!rebirthConfig()&&wanted();
  const key=JSON.stringify([charName(),env.leaseEpoch,+env.rt.manualKickAt||0,raidClass(),env.rt.rebirth?.runId||'',returnPath]);
  if(rebirthPrepKey!==key){rebirthPrepKey=key;startProof=null;startReadAt=null;}
  if(latestSeen&&latest===null)startProof=null;
  if(!afterWin&&await petPrepare({reason:'start',buffs:true,wanted:owns,returnPath}))return true;
  if(!wanted()||!rebirthConfig())return false;
  if(settings.petFullAuto!==true)return false;
  const waiting=await step({afterWin});
  if(!wanted()||!rebirthConfig())return waiting;
  // На победе панели призыва нет. Проверенный сервером отсутствующий кот готовится в своём каталоге, без нового входа.
  if(afterWin&&state().status==='pet'&&mine(token())&&priority(true)&&env.canAct?.()!==false){env.nativeNavigate?.(returnPath);return true;}
  return waiting;
}
function identity(ch) {
  const slot = ch?.classSlots?.activeSlot;
  if (!ch || ch.name !== charName() || ch.name !== env.heroNick() || !Number.isInteger(slot) || !Number.isSafeInteger(ch.revision)) return null;
  const plain = fullProf(ch.l2Profession);
  if (!FULL_CLASS.test(plain)) return null;
  const prof = (golemClass(plain) ? 'dwarf_' : 'human_') + plain;
  return { char: ch.name, prof, slot, key: `${slot}:${prof}` };
}
// 10.0.23 (лог 15.10 07:18): полный городской набор доступен и Dark Panther (283).
function summon(ch) {
  const p = ch?.activeSummon;
  return p && p.kind === 'servitor' && typeof p.key === 'string' && (/^(dark_avenger|hell_knight)$/.test(classProf(ch.l2Profession)) ? p.key === 'dark_panther' && number(p.summonSkillId) === 283
    : golemClass(ch.l2Profession) ? /golem/i.test(p.key) : /^(?:kai|kat|mew)_the_cat$/.test(p.key) || p.key === 'feline_king' && number(p.summonSkillId) === 1406)
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
// 20.43 (лог 21.10 15:47–15:51: проверка автобафа после каждой ≈3-й победы в катакомбах +0,9–1,8 с — два GET и две ожидаемые полные
// записи памяти ≈960 КБ): в проверке после победы (quiet) справочные статусы без оплаты пишутся только при смене смысла и без ожидания.
// Оплата, неизвестный исход и сверка квитанции — прежней ожидаемой записью.
const INFO_STATUS = /^(?:battle|class|pet|catalog|active|early-loss|renew|stale|price|budget|reserve|archived|read)$/;
let quiet = false;
async function status(T, code, reason, extra = {}) {
  if (!mine(T)) return;
  const S = state();
  if (quiet && !S.pending && INFO_STATUS.test(code)) {
    // 20.43 (слияние с PR #324): новый срок проверки (nextCheckAt/waitKey) пишется и при прежнем статусе, если старый срок истёк или ключ сменился
    const due = 'nextCheckAt' in extra && (!(S.nextCheckAt > Date.now()) || S.waitKey !== waitKey());
    if (S.status !== code || S.reason !== reason || due) patch({ status: code, reason, ...extra })?.catch?.(() => {});
    return;
  }
  await patch({ status: code, reason, ...extra });
}
// 20.43: ворота проверки после победы — память вкладки (sessionStorage переживает переход к следующему мобу катакомб). После победы
// проверяем не чаще раза в 60 с, раньше — только если кот переродился/призван заново (rt.petBornT), истёк оплаченный срок или прошлый
// ответ был «бой на сервере» (не больше двух раз подряд).
const GATE_KEY = 'l2bot.petFullGate', GATE_MS = 60000;
let gateMem = null;
function gateRead() { try { const g = JSON.parse(sessionStorage.getItem(GATE_KEY) || 'null'); if (g && typeof g === 'object') return g; } catch (_) {} return gateMem || {}; }
// 20.43 (слияние с PR #324): ключ ворот включает waitKey — смена настроек автобафа, новый Старт или класс снимают ворота сразу
const gateKeyOf = T => `${T.char}|${T.kick}|${waitKey()}`;
function gateNote(T, code) {
  const g = gateRead(), key = gateKeyOf(T), now = Date.now(), same = g.key === key && g.code === code;
  gateMem = { key, t: now, code: code || '', n: same ? (g.n || 0) + 1 : 1 };
  try { sessionStorage.setItem(GATE_KEY, JSON.stringify(gateMem)); } catch (_) {}
}
function gateHolds(T) {
  const g = gateRead(), now = Date.now(), S = state();
  if (g.key !== gateKeyOf(T) || !(g.t > 0) || now - g.t >= GATE_MS || now < g.t) return false;
  if (!(S.nextCheckAt > 0)) return false;                                  // сброс бюджета кнопкой (nextCheckAt 0)
  if ((+env.rt.petBornT || 0) > g.t) return false;                         // кот погиб/призван заново
  if (S.expiresAt > 0 && S.expiresAt <= now && g.t < S.expiresAt) return false;   // оплаченный срок истёк
  if (g.code === 'battle' && (g.n || 0) < 2) return false;                // сервер ещё считал бой — одна повторная проверка
  return true;
}
function summary() {
  const S = state();
  const reserved = (S.unknownReserved || 0) + (S.pending ? S.pending.price || 0 : 0);
  return { char: charName(), pendingId: S.pending?.id || null, unknownReserved: S.unknownReserved || 0, enabled: option('petFullAuto') === true, status: S.status || 'off', reason: S.reason || 'Автобаф выключен',
    price: S.lastPrice ?? null, budget: null, spent: S.spent || 0, reserved, remaining: null,   // 20.60: без общего бюджета
    lifetimeSpent: S.lifetimeSpent || 0, purchases: S.purchases || 0, expiresAt: S.expiresAt || 0, observedMs: S.observedMs || 0, renew: option('petFullRenew') === true, budgetEpoch: S.budgetEpoch || 0 };
}
// 20.43 (разбор 21.10): у Warlock проверка набора после победы (свой GET /character + каталог + две записи памяти ≈1–1,3 с) шла раз
// в минуту при действующем наборе и раз в 10 с, когда купить нельзя, — почти на каждой второй победе цепочки. Свой оплаченный набор
// (квитанция бота, тот же суммон и срок) до конца ничего не требует — следующая проверка за 1,5 мин до конца срока; «купить нельзя»
// (бюджет, автообновление, цена, резерв, архив) — раз в 10 мин, early-loss — к концу оплаченного срока. Смена настроек автобафа,
// новый Старт или смена класса снимают ожидание (waitKey); сброс бюджета/архив и так ставят nextCheckAt 0. Покупка и сверка прежние.
const NO_BUY_MS = 600000;
const waitKey = () => JSON.stringify([signature(), +env.rt.manualKickAt || 0, env.rt.classCur?.slot ?? null, env.rt.classCur?.prof || '']);
async function observe(T, ch, set, full) {
  if (!mine(T)) return;
  const S = state(), now = Date.now(), p = summon(ch), prev = S.observation, last = S.lastReceipt;
  const own = !!full && !!last && last.petKey === p?.key && Math.abs(full.expiresAt - (+last.expiresAt || 0)) <= 60000;
  const plan = full ? Math.min(60000, Math.max(1000, full.expiresAt - now)) : 10000, gap = own ? Math.max(plan, full.expiresAt - now - 90000) : plan;
  // 20.43: у своего набора непрерывность — по плану редкой проверки (+5 мин запаса): те же точные сроки всех эффектов на обоих концах
  // доказывают, что набор не терялся и не перекупался; чужой/ручной набор — как раньше, только при проверках не реже раза в минуту
  const continuity = full && prev?.stamps === full.stamps && prev.petKey === p?.key && now >= prev.at && now - prev.at <= (prev.own ? Math.max(60000, (+prev.gap || 0) + 300000) : 60000);
  const observedMs = (S.observedMs || 0) + (continuity ? Math.max(0, Math.min(now, prev.expiresAt) - prev.at) : 0);
  // 20.43: после победы наблюдение без изменений (та же цена, срок, кот и отметки эффектов) не переписывает память; раз в 50 с —
  // запись без ожидания, чтобы учёт времени действия (непрерывность) не прерывался
  if (quiet && prev && S.lastPrice === set.price && (S.expiresAt || 0) === (full?.expiresAt || 0) && prev.stamps === (full?.stamps || '') && prev.petKey === (p?.key || '') && now >= prev.at && now - prev.at < 50000) return;
  const write = patch({ lastPrice: set.price, lastCheckAt: now, expiresAt: full?.expiresAt || 0, observedMs,
    observation: { at: now, petKey: p?.key || '', stamps: full?.stamps || '', expiresAt: full?.expiresAt || 0, own, gap },
    snapshot: snapshot(ch), nextCheckAt: now + gap });
  if (quiet) write?.catch?.(() => {}); else await write;
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
  // 20.13 (ревизия 17.10, шаг 5, combat/C10, ревью): пауза 10 с после «бой на сервере» — против опроса на каждом тике цикла; проверка после
  // победы (одна на бой) её не ждёт, иначе в цепочке «Охотиться дальше» (≈5 с/моб) автобаф пропускал каждую вторую победу
  // 20.43: ожидание, назначенное при других настройках/Старте/классе (waitKey), не держит проверку
  const W = state();
  // 20.43 (слияние): кот призван заново после прошлой проверки (rt.petBornT) — срок ожидания не держит, набор проверяется сразу
  const reborn = (+env.rt.petBornT || 0) > Math.max(+W.lastCheckAt || 0, +gateRead().t || 0);
  if (!forceRead && !reborn && W.nextCheckAt > Date.now() && (!W.waitKey || W.waitKey === waitKey()) && !(afterWin && W.status === 'battle')) return false;
  if (afterWin && !forceRead && !state().pending && gateHolds(T)) return false;   // 20.43: после победы — не чаще раза в 60 с без перемен
  busy = true; quiet = afterWin && !forceRead;
  try {
    // 23.10: после победы тоже ждём общий темп до свежего снимка, не задерживая сверку неизвестной оплаты.
    if (!state().pending && env.actionWait && !await env.actionWait(() => same(T, afterWin))) return false;
    if (!same(T, afterWin)) return false;
    const data = await read('/character'); if (!same(T, afterWin)) return false;
    const ch = data.character || data;
    if (!identity(ch)) { await status(T, 'class', 'Нужен подтверждённый активный класс Wizard / Warlock / Arcana Lord, Dark Avenger / Hell Knight или Warsmith / Maestro', { nextCheckAt: Date.now() + 15000 }); return false; }
    noteSnapshot(ch);
    // 20.13 (ревизия 17.10, шаг 5, аудит combat/C10): без nextCheckAt бой на сервере давал GET /character на каждом тике главного цикла
    if (ch.inBattle !== false) { await status(T, 'battle', 'Дождусь завершения боя', { nextCheckAt: Date.now() + 10000 }); return false; }
    if (await reconcile(T, ch, afterWin)) return true;
    if (!same(T, afterWin)) return false;
    const p = summon(ch); if (!p) { await status(T, 'pet', 'Нужен живой призванный суммон', { nextCheckAt: Date.now() + 10000 }); return false; }
    const raw = await read('/character/town/buffer/catalog'); if (!same(T, afterWin)) return false;
    const set = catalogSet(raw); if (!set) { await status(T, 'catalog', 'Цена, валюта или состав полного бафа не подтверждены', { nextCheckAt: Date.now() + 15000 }); return false; }
    const full = coverage(p, set.skills); await observe(T, ch, set, full); if (!same(T, afterWin)) return false;
    if (full) { await status(T, 'active', 'Полный баф уже действует'); return false; }
    const S = state(), last = S.lastReceipt;
    if (last?.expiresAt > Date.now()) { await status(T, 'early-loss', 'Оплаченный срок ещё не истёк; после смены или потери суммона повторно не покупаю', { nextCheckAt: Math.max(Date.now() + 10000, last.expiresAt) }); return false; }
    if (last && option('petFullRenew') !== true) { await status(T, 'renew', 'Автообновление выключено', { nextCheckAt: Date.now() + NO_BUY_MS }); return false; }
    if (last && ch.revision < last.revision) { await status(T, 'stale', 'Снимок старее последней покупки; жду свежее состояние'); return false; }
    const cap = number(option('petFullMaxPrice'));
    const reserve = number(option('petFullReserve') ?? option('shopReserve') ?? 0), adena = number(ch.adena);
    const fence = S.archiveFence;
    if (fence && (ch.revision < fence.verifiedRevision || Date.now() < fence.possibleUntil)) {
      await status(T, 'archived', 'Неопределённый расход: новый набор — после возможного срока прежнего',
        { nextCheckAt: ch.revision < fence.verifiedRevision ? Date.now() + 10000 : Math.min(Date.now() + NO_BUY_MS, Math.max(Date.now() + 10000, +fence.possibleUntil || 0)) }); return false;
    }
    if (cap === null || set.price > cap) { await status(T, 'price', `Цена ${set.price} выше разрешённой ${cap ?? '?'}`, { nextCheckAt: Date.now() + NO_BUY_MS }); return false; }
    if (reserve === null || adena === null || adena - set.price < reserve) { await status(T, 'reserve', 'Не хватает адены с учётом резерва', { nextCheckAt: Date.now() + NO_BUY_MS }); return false; }
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
    // 20.76+ (ревизия 28.10): same() не видит устаревший кадр действий (правка меню) и удержание ЛС в Rebirth, а gamePost по ним отказывает
    // до отправки — проверяем здесь, до пометки sent; ожидание 15 с, чтобы постоянное удержание не гоняло GET на каждом тике
    const held = env.canAct?.() === false || !!env.rt.autoLs?.hold || !!env.rt.autoLs?.pending;
    if (!durable || held || !same(T, afterWin) || !pendingSame(P) || env.townBufferReady?.() !== true) {
      if (mine(T) && pendingSame(P)) await patch({ pending: null, nextCheckAt: held ? Date.now() + 15000 : 0, status: 'paused', reason: durable ? 'Покупка отменена до отправки' : 'Состояние не сохранено; покупка отложена' });
      return false;
    }
    // Между пометкой sent и вызовом API нет await. Core gamePost повторно проверяет Stop/lease.
    const queued = patch({ pending: { ...P, phase: 'sent' }, status: 'pending', reason: 'Жду подтверждение покупки' });
    unsent.delete(P.id);
    const sent = env.gamePost('/character/town/buffer', { set: 'summon', expectedRevision: P.revision, expectedFeeAdena: String(P.price), expectedFeeCoinOfLuck: 0 })
      .then(response => ({ response }), error => ({ error }));
    await queued; const result = await sent;
    if (!mine(T) || !pendingSame(P)) return true;
    // 20.76+ (ревизия 28.10): отказ до fetch — запрос не ушёл, сервер ничего не списал; pending снимаем, иначе вечный 'sent' блокировал все оплаты
    if (result.error && NOT_SENT.test(result.error?.message || '')) { await patch({ pending: null, nextCheckAt: Date.now() + 15000, status: 'paused', reason: 'Покупка отменена до отправки' }); return false; }
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
  } finally { busy = false; quiet = false; if (mine(T)) gateNote(T, state().status); }
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
    return { ok: true, reason: 'Неизвестный исход сохранён; новая покупка — после истечения возможного срока' };
  } catch (_) { return { ok: false, reason: 'Свежая сверка не получена; резерв сохранён' }; }
  finally { busy = false; }
}
async function resetBudget(expected = {}) {
  const T = token();
  if (expected.char !== T.char || expected.budgetEpoch !== (state().budgetEpoch || 0) || expected.spent !== (state().spent || 0)) return false; if (!mine(T) || busy || state().pending) return false;
  // Только явная команда пользователя; переключение задачи и перезагрузка бюджет не обнуляют.
  const before = { ...state() };
  const saved = await patch({ spent: 0, budgetEpoch: Date.now(), status: 'ready', reason: 'Счётчик расхода сброшен пользователем', nextCheckAt: 0 });
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
// 16.10: maxHp — резерв для rbProbeBudget, не коэффициент входящего урона.
const DEFENSE_FIELDS = ['level','pDef','mDef','evasion','magicEvasion','shieldDef','shieldRate','fireResist','waterResist','windResist','earthResist','holyResist','darkResist'];
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
  // 20.43 (ревью): живой кот в свежем снимке снимает отсрочку тура и тогда, когда ход отдан рыбалке — срок её передачи (rbFishWait.pet)
  // истекает сейчас; начатый заброс доводится (selectedTask держит рыбалку, пока fishBusy). Запись одна: дальше until уже прошёл
  const FW = env.rt.rbFishWait;
  if (latest && FW?.pet && FW.until > Date.now() && env.tabOwner && !summonHeld()) Promise.resolve(env.setRt({ rbFishWait: { ...FW, until: Date.now() } })).catch(() => {});
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
// 20.41 (лог 20.10 21:09: память 1,3 МБ, каждая запись ≈0,5 с): строка petCohorts хранила весь снимок (hero.setup — снаряжение и умения,
// key/snapshotKey — JSON-строки) ≈10 КБ × 100 ≈ 1 МБ, а цель в ключе со spawnId — словарь всегда полный. Ключ хранилища — короткий хэш
// полного ключа (алгоритм packHash из fightlab.js; L2EngineCore модулю не нужен), строка — только поля для warlock-ui.js и счётчики,
// не больше 40 (меню показывает 30). Полный ключ остаётся в памяти боя ctx.petCohort — сравнение условий внутри боя прежнее.
const cohortId = s => { let a=2166136261,b=5381; for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}return (a>>>0).toString(36)+':'+(b>>>0).toString(36)+':'+s.length; };
const COHORT_N = ['hits','hitDmg','crits','misses','dmg','acts'], COHORT_MAX = 40;
const cohortRow = (c, s) => ({ petKey: c.petKey, petLevel: c.petLevel, level: c.level, classKey: c.classKey, buffs: c.buffs, pAtk: c.pAtk, accuracy: c.accuracy,
  critRate: c.critRate, critDmgMul: c.critDmgMul, shots: c.shots, target: c.target, fights: +s.fights || 0, ...Object.fromEntries(COHORT_N.map(k => [k, +s[k] || 0])), at: +s.at || 0 });
// Старые полные строки (ключ длиннее 64, hero/snapshotKey) — под хэш того же полного ключа со счётчиками; самые свежие 40.
function slimCohorts(map) {
  const out = {};
  for (const [k, v] of Object.entries(map && typeof map === 'object' ? map : {})) {
    if (!v || typeof v !== 'object') continue;
    const fat = k.length > 64 || !!v.hero || !!v.snapshotKey, id = fat ? cohortId(k) : k, o = out[id];
    out[id] = !o ? fat ? cohortRow(v, v) : v
      : cohortRow(o, { fights: (+o.fights || 0) + (+v.fights || 0), ...Object.fromEntries(COHORT_N.map(n => [n, (+o[n] || 0) + (+v[n] || 0)])), at: Math.max(+o.at || 0, +v.at || 0) });
  }
  return Object.fromEntries(Object.entries(out).sort((a,b) => (+b[1].at || 0) - (+a[1].at || 0)).slice(0, COHORT_MAX));
}
function petExpected(ctx) {
  if (!modelManaged()) return null;
  capture(ctx);
  const c = ctx?.petCohort, p = ctx?.pet;
  if (!c || !p || !c.target || c.shots === 'unknown' || ctx.petCohortMixed) return 0;
  const S = env.rt.petCohorts?.[cohortId(c.key)] || {}, sum = k => (+S[k] || 0) + (+p[k] || 0);
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
  // 20.41: короткая строка под хэшем полного ключа; старые полные строки заодно ужимаются (slimCohorts).
  const id = cohortId(c.key), all = slimCohorts(env.rt.petCohorts), old = all[id] || {};
  all[id] = cohortRow(c, { fights: (+old.fights || 0) + 1, ...Object.fromEntries(COHORT_N.map(k => [k, (+old[k] || 0) + (+p[k] || 0)])), at: Date.now() });
  const kept = Object.fromEntries(Object.entries(all).sort((a,b) => (+b[1].at || 0) - (+a[1].at || 0)).slice(0, COHORT_MAX));
  await env.setRt({ petCohorts: kept });
}
// 20.43 (ревью au/travel): открытая квитанция перелёта (rt.travelCheck) — занятость, как маршрут zoneGo
const chainBlocked = () =>!!env.rt.petBufferTrip || env.canRun?.() === false || env.tvtHold() || env.abHold() || !!env.antibotState() || !!env.rt.shop?.urgent || !!env.rt.zoneGo || !!env.rt.travelCheck || !!env.rt.bagCheck || !!env.rt.revive;
return { autoEnableClass, classAutoTick, fullClass, raidPrepare, raidReady, raidBlocked, raidHoldUntil, startPrepare, startReady, rebirthPrepare, paymentReconcile, step, preview, summary, chainBlocked, archiveUnknown, resetBudget, capture, noteSnapshot, invalidateSnapshot, noteBattle, snapshot, defenseContext, heroContext, combatContext, raidContext, petExpected, slimCohorts, petBuffState, petBuffActive, catalogSet, coverage, DEF };
 };
})(globalThis);
