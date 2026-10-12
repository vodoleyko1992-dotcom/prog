const $ = id => document.getElementById(id);
// All menu runtime updates are serialized with bot updates, never rewrite stale snapshots.
async function menuPatch(rtPatch, extra = {}) {
  const response = await Promise.race([chrome.runtime.sendMessage({ cmd: 'menuPatch', rtPatch, ...extra }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Фоновый процесс не отвечает (15 с)')), 15000))]);
  if (!response?.ok) throw new Error('Не удалось сохранить изменение: ' + (response?.reason || 'фон недоступен'));
}

// 8.0 (аудит меню): неудачный запуск — постоянная строка под кнопками, а не тост на 1,4 с и не текст в #status,
// который следующая перерисовка тут же стирала. Строка живёт, пока бот включён и движок не подал сигнал (localStorage —
// переживает закрытие всплывающего меню); пропадает при сигнале движка, «Стопе» или успешном запуске
const WAKE_KEY = 'l2bot-wakeWarn', WAKE_NOTAB = 'Бот включён, но вкладка игры не отвечает — откройте l2wap.com';
function wakeWarnGet() { try { return JSON.parse(localStorage.getItem(WAKE_KEY) || 'null'); } catch (e) { return null; } }
function wakeWarnSet(v) { try { v ? localStorage.setItem(WAKE_KEY, JSON.stringify(v)) : localStorage.removeItem(WAKE_KEY); } catch (e) {} }
// текст строки: нет вкладки / вкладка молчит — одна понятная фраза; иначе — причина от движка
function wakeWarnText(reason) {
  return /Откройте вкладку|Не удалось найти вкладку|не получено подтверждение|Не удалось запустить вкладку/i.test(reason || '')
    ? WAKE_NOTAB : `Бот включён, но игра не подтвердила запуск: ${reason}`;
}
function paintWakeWarn(show, text) {
  const el = $('wakeWarn'); if (!el) return;
  el.hidden = !show;
  if (show) el.textContent = '⚠ ' + text;
}
// Запуск режимов централизован: запись on=true НЕ доказывает, что игра исполняет цикл.
async function wakeGame() {
  let tabs = [];
  try {
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    const game = (active || []).filter(t => /^https?:\/\/(?:www\.)?l2wap\.com\//i.test(t.url || ''));
    tabs = game.length ? game : (await chrome.tabs.query({ url: ['*://l2wap.com/*', '*://www.l2wap.com/*'] })).filter(t => t.id != null);
  } catch (e) { return { ok: false, reason: 'Не удалось найти вкладку игры: ' + String(e?.message || e) }; }
  const tab = tabs[0];
  if (!tab) return { ok: false, reason: 'Откройте вкладку l2wap.com, затем включите режим' };
  const expected = chrome.runtime.getManifest().version;
  const ask = async () => Promise.race([
    chrome.tabs.sendMessage(tab.id, { cmd: 'kick' }).catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), 5500))
  ]);
  try {
    let pong = await ask();
    if (pong?.v === expected) {
      if (pong.ok === true && pong.running === true && pong.owner === true)
        return { ok: true, status: 'Движок запущен и управляет вкладкой' };
      const hints = {
        stopped: 'Режим не включён в хранилище',
        stopped_during_start: 'Запуск был отменён',
        loop_not_running: 'Игровой цикл не запустился',
        another_tab_or_lock_unavailable: 'Вкладка не получила управление: закройте другие вкладки L2WAP и повторите Старт'
      };
      return { ok: false, reason: hints[pong.reason] || ('Движок не подтвердил запуск: ' + (pong.reason || 'неизвестно')) };
    }
    // Only reload for a missing or outdated document; never reload on an explicit lease denial.
    await chrome.tabs.reload(tab.id);
    const until = Date.now() + 12000;
    while (Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 900));
      pong = await ask();
      if (pong?.v !== expected) continue;
      if (pong.ok && pong.running && pong.owner)
        return { ok: true, status: 'Игровая вкладка обновлена, движок подтвердил запуск' };
      if (pong.reason === 'another_tab_or_lock_unavailable')
        return { ok: false, reason: 'Вкладка обновлена, но управляет другая вкладка L2WAP. Закройте лишние вкладки.' };
      if (pong.reason === 'stopped' || pong.reason === 'stopped_during_start')
        return { ok: false, reason: 'После обновления запуск отменён (бот выключен)' };
    }
    return { ok: false, reason: 'Не получено подтверждение после обновления вкладки. Проверьте активную версию расширения.' };
  } catch (e) { return { ok: false, reason: 'Не удалось запустить вкладку: ' + String(e?.message || e) }; }
}
async function showWakeResult() {
  const result = await wakeGame();
  if (!result.ok) {
    const text = wakeWarnText(result.reason);
    wakeWarnSet({ text, reason: result.reason, t: Date.now() });
    paintWakeWarn(true, text);
    if (typeof toast === 'function') toast('⚠ ' + text);
  } else { wakeWarnSet(null); paintWakeWarn(false); }
  if (result.ok && typeof toast === 'function') toast('▶ ' + result.status);
  return result;
}
async function activateMode(rtPatch, cfgPatch) {
  await chrome.storage.local.set({ paused: null });   // 8.0: выбран режим — пауза снята (иначе после остановки меню предлагало «Продолжить»)
  await menuPatch({ ...rtPatch, manualKickAt: Date.now() }, { cfgPatch, on: true });
  return showWakeResult();
}

const NUM  = ['enemyLvlAbove', 'tsGoalItem', 'enemyMinHits', 'enemyMaxLoss', 'enemyScanS', 'sealMin', 'mmTpMax', 'storyTpMax', 'mmGoalItem', 'mmGoalLvl', 'farmLvlBelow', 'farmLvlAbove', 'debuffMinActs', 'petFinishMp', 'petResummonAt', 'petHealAt', 'petBuffSec', 'epicMinHpPots', 'epicCoinDailyMax', 'epicCoinPerBoss', 'epicCoinKeep', 'epicMaxFightMin', 'epicMaxRetreats', 'epicAdenaDailyMax', 'epicRetreatHp', 'epicLvlUp', 'epicMaxDeaths', 'rbPotTo', 'rbPotAt', 'rbChipMaxAttempts', 'drainHp', 'toggleMpOff', 'toggleMpOn', 'campaignEvery', 'rbMaxAbove', 'rbMaxBelow', 'rbRetreatHp', 'rbRestHp', 'deepEvery', 'lvlMin', 'lvlMax', 'lvlAbove', 'lvlBelow', 'maxPages', 'champHpMult', 'reactMin', 'reactMax',
              'stopHp', 'skillMpMin', 'mpPotAt', 'hpPotAt', 'stunEvery', 'buffSec', 'rbPotReserve', 'rodEnchantTo', 'fishTimeMin', 'fishBuyPacks', 'fishShotPacks', 'fishMaxCasts', 'fishProcessEvery', 'shopReserve', 'shopMaxSpend', 'zoneTrial', 'zoneAbove', 'farmNeed', 'recipeNeed'];
const TXT  = ['mmCrafter', 'mmCraftScope', 'rbSessBuffs', 'petSummon', 'nPetBuffs', 'priority', 'champMark', 'bossMark',
              'combatProfile', 'nAttack', 'nPower', 'nStun', 'nBuffs', 'nShots', 'nMpPot', 'nHpPot', 'nHeal', 'nWeaponMain', 'nCharge', 'nForce', 'nDebuff', 'debuffMode', 'fishBait', 'fishGoal', 'fishTimePack', 'shopHp', 'shopMp', 'shopShots', 'shopSpirit', 'shopSoul', 'shopBait', 'farmRes', 'townBuffSet', 'faBuffs', 'resQuests', 'indMode', 'recipeRes', 'catDungeon', 'nKeyBuffs', 'nToggles', 'nSpoil', 'nSpoilMass', 'nSweep', 'nUltra', 'nDrain', 'ultMode', 'fightMode', 'epicList'];
const BOOL = ['sealAuto', 'tsBuy', 'mmOrders', 'mmCraftSend', 'mmMailClaim', 'storyTurnIn', 'mmGoalFarm', 'mmSmithAuto', 'mmUpgrade', 'rbSessNob', 'petAuto', 'petResummon', 'petFinish', 'petBuffAuto', 'autoMagister', 'debuffAuto', 'rbValueTour', 'rbBandAuto', 'rbTurnPrice', 'rbCharge', 'rbChipRetreat', 'rbProbe', 'epicCheck', 'epicFaFull', 'dock', 'tvtOn', 'rbFrenzyDive', 'catMode', 'keyBuffBoss', 'spoilRb', 'autoRevive', 'chain', 'searchQuest', 'searchChamp', 'rec', 'autoSnap', 'questStop', 'autoRoles', 'rbUsePots', 'weaponClassEquip', 'fishShots', 'fishAutoBuy', 'fishProcess', 'fishOpenBoxes', 'shopAuto', 'zoneAuto', 'rbMpPots', 'rbFast', 'fishShotAuto', 'fishTimeAuto', 'autoLearn', 'netLog', 'gameMsgLog', 'learnShots', 'recipeSpoil', 'enemyHunt', 'enemyFlagOnly'];
const DEF = { mmOrders: true, mmTpMax: 500000, mmGoalItem: 0, mmGoalLvl: 5, mmGoalFarm: true, mmSmithAuto: true, mmUpgrade: true, mmCrafter: 'Skye', mmCraftScope: 'next', mmCraftSend: true, mmMailClaim: true, storyTurnIn: true, storyTpMax: 100000, sealAuto: false, sealMin: 1, farmLvlBelow: 3, farmLvlAbove: 5, rbSessBuffs: 'auto', rbSessNob: true, epicFaFull: true, debuffMinActs: 10, petAuto: true, petSummon: '', petResummon: true, petResummonAt: 25, petHealAt: 50, petFinish: false, petFinishMp: 80, petBuffAuto: true, nPetBuffs: '', petBuffSec: 1200, autoMagister: false, debuffAuto: true, debuffMode: 'auto', nDebuff: '', epicMode: false, epicList: 'ak,core,orfen,baium,valakas,antharas,frintezza,zaken', epicMaxDeaths: 3, epicCheck: false, epicRetreatHp: 35, epicLvlUp: 0, epicCoinDailyMax: 0, epicCoinPerBoss: 1, epicCoinKeep: 0, epicMaxFightMin: 30, epicMaxRetreats: 8, epicAdenaDailyMax: 0, epicMinHpPots: 0, fightMode: 'dps', combatProfile: 'auto', tvtOn: true, enemyHunt: true, enemyFlagOnly: true, enemyLvlAbove: 3, enemyMinHits: 3, enemyMaxLoss: 2, enemyScanS: 30, rbPotAt: 75, rbPotTo: 80, rbValueTour: false, rbBandAuto: true, rbTurnPrice: true, rbCharge: true, rbChipRetreat: false, rbProbe: true, rbChipMaxAttempts: 3, rbFrenzyDive: false, nUltra: '', ultMode: 'big', nDrain: '', drainHp: 85, nKeyBuffs: '', keyBuffBoss: true, nToggles: '', toggleMpOff: 10, toggleMpOn: 30, nSpoil: '', nSpoilMass: '', nSweep: '', spoilRb: false, catMode: false, catDungeon: 'auto', recipeRes: '', recipeNeed: 0, recipeSpoil: false, indMode: 'full', autoLearn: true, netLog: true, gameMsgLog: true, learnShots: false, dock: true, campaign: false, autoRevive: true, campaignEvery: 25, autoRoles: true, weaponClassEquip: true, weaponManual: false, nWeaponMain: '', rbMode: false, rbBetween: false, rbMaxAbove: 15, rbRetreatHp: 20, rbRestHp: 95, autoSnap: true,
              taskOnly: false, tsGoalItem: 0, tsBuy: false, chain: true, searchQuest: true, searchChamp: false, rec: true, questStop: false, deepEvery: 10,
              priority: '[квест]\n[чемп]\n[все]', champMark: 'чемпион, чемпіон', bossMark: 'босс, boss, рейд',
              lvlMin: 1, lvlMax: 99, lvlAbove: 99, lvlBelow: 3, maxPages: 3, champHpMult: 1.5, reactMin: 150, reactMax: 450,
              stopHp: 25, skillMpMin: 35, mpPotAt: 70, hpPotAt: 50, stunEvery: 15, buffSec: 118,
              nAttack: 'Атака', nPower: 'Iron Punch', nStun: 'Stunning Fist', nBuffs: 'Totem Spirit Bear',
              nShots: 'Заряд душі, Заряд души, Soulshot', nMpPot: 'Зілля мани, Зелье маны, Mana Potion', nHpPot: '', nHeal: '',
              nCharge: 'Focused Force', nForce: 'Hurricane Assault=2, Force Blaster=1', rbUsePots: true, rbPotReserve: 10,
              fishMode: false, rodEnchantTo: 10, fishTimeAuto: false, fishTimePack: '6h', fishTimeMin: 5, fishBait: 'auto', fishShots: true, fishAutoBuy: true, fishBuyPacks: 100, fishShotPacks: 750, fishShotAuto: true, fishMaxCasts: 0, fishProcess: true, fishProcessEvery: 100, fishOpenBoxes: true, fishGoal: '',
              shopAuto: true, shopReserve: 200000, shopMaxSpend: 2000000, shopHp: '300/1000', shopMp: '200/1000', shopShots: '1000/5000', shopSpirit: '0/1000', shopSoul: '0/1000', shopBait: '0/0', zoneAuto: false, zoneTrial: 20, zoneAbove: 10, rbMaxBelow: 9, townBuffSet: 'basic', faBuffs: '', resQuests: '', rbMpPots: true, rbFast: true, rbTour: false, farmRes: '', farmNeed: 0 };
const fmt = n => (n || 0).toLocaleString('ru');
// подтверждение опасных кнопок вторым нажатием (4 с). confirm() во встроенном меню не работает:
// меню — iframe расширения на странице игры, и Chrome молча блокирует там диалоги (confirm сразу возвращает «Отмена»)
function confirmClick(id, fn) {
  const b = $(id); let t = null;
  b.onclick = async () => {
    if (!t) {
      b.dataset.txt = b.textContent; b.textContent = b.offsetWidth && b.offsetWidth < 70 ? '⚠?' : '⚠ Нажмите ещё раз — подтвердить';   // 8.0: иконка-кнопка — короткая метка
      t = setTimeout(() => { t = null; b.textContent = b.dataset.txt; }, 4000);
      return;
    }
    clearTimeout(t); t = null; b.textContent = b.dataset.txt;
    await fn();
  };
}
// Запись rt из меню помечается _src: 'menu'. Без метки меню копировало _src вкладки с ботом,
// бот принимал запись за своё эхо, игнорировал её и следующим сохранением возвращал старые данные
// меню встроено в страницу игры (панель справа): растягиваем на всю высоту панели
// 8.0 (аудит меню): состояние для экономной перерисовки встроенного меню (см. loadSoon)
const DOCKED = /dock=1/.test(location.search);
let dockMin = false, recN = 0, snapN = 0;
if (DOCKED) {
  document.documentElement.classList.add('docked');
  // v5.2: «я жива» для страницы игры раз в 3 с — если панель упадёт (грустный листок), бот перезапустит её сам
  const hb = () => { try { parent.postMessage({ __l2dock: 'hb' }, '*'); } catch (e) {} };
  hb(); setInterval(hb, 3000);
}

// 8.0.7 (игрок 11.10, планшет с Firefox для Android): меню из «⋮ → Расширения» открывается отдельной вкладкой — было окошко
// 738×600 в углу и пустота ниже. Во вкладке — раскладка встроенной панели на всю высоту. Только на Android (на ПК ничего не меняем)
if (!DOCKED && /Android/i.test(navigator.userAgent || '')) chrome.tabs?.getCurrent?.()?.then(t => { if (t) document.documentElement.classList.add('docked', 'tabbed'); }).catch(() => {});

async function load() {
  const { cfg = {}, rt = {}, on = false, paused = null, reccount = 0, snapcount = 0, wdog = [], hbBg = null, lock = null } = await chrome.storage.local.get(['cfg', 'rt', 'on', 'paused', 'reccount', 'snapcount', 'wdog', 'hbBg', 'lock']);
  const d = { ...DEF, ...cfg };
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    fillWeapons(rt, d);                            // списки оружия выставляют выбор сами
    TXT.forEach(k => { if (!/^nWeapon/.test(k)) $(k).value = d[k] ?? ''; });
    NUM.forEach(k => $(k).value = d[k]);
    BOOL.forEach(k => $(k).checked = !!d[k]);
  }
  recN = reccount; snapN = snapcount; dockMin = DOCKED && !!d.dockMin;
  // v5: шапка — герой, версия, состояние; статус и итоги — «чипами»
  const ver = chrome.runtime.getManifest().version, hl = healthLine(rt, wdog).trim(), S = sessInfo(rt);
  const chip = (ic, v, t) => `<span class="chip" title="${t}">${ic} <b>${v}</b></span>`;
  const heartbeatValid = !!on && !!lock?.tab && !!hbBg?.tab && lock.tab === hbBg.tab && Date.now() - (+lock.t || 0) < 85000 && Date.now() - (+hbBg.t || 0) < 70000;
  const booting = !!on && Date.now() - (+rt.manualKickAt || 0) < 15000;
  const failing = !!on && ['retry','reload','cooldown'].includes(rt.health?.action) &&
    Date.now() - (+rt.health.updatedAt || 0) < 45000;
  const runningLabel = !on && paused ? '⏸ Пауза' : !on ? '○ Остановлен' : failing ? 'Ошибка · восстановление' :
    heartbeatValid ? 'Движок активен' : booting ? 'Запускается' : 'Нет сигнала движка';
  // 8.0 (аудит меню): бот включён, а движок молчит — постоянная строка (причина от запуска, если была)
  { const w = wakeWarnGet();
    if (!on || heartbeatValid) { if (w) wakeWarnSet(null); paintWakeWarn(false); }
    else if (w) paintWakeWarn(true, w.text);
    else paintWakeWarn(!booting && !failing && Date.now() - (+rt.manualKickAt || 0) > 20000, WAKE_NOTAB); }
  if ($('workVer')) $('workVer').textContent = 'v' + ver;   // 8.0: версия из манифеста (было зашито «v7.1.11»)
  $('heroLine').innerHTML = `<span class="hero">👤 ${esc(rt.char || 'Персонаж')}${rt.lvl ? ` · ${rt.lvl} ур.` : ''}</span><span class="ver">v${esc(ver)}</span>`
    + `<span class="state ${heartbeatValid ? 'on' : 'off'}">${runningLabel}</span>`;
  // 8.0 (аудит меню): ⏱ — EXP/ч за сессию (с ↺), как в «Обзоре». Раньше — средний темп за всё время (rt.eff):
  // «≈3,5 млн EXP/ч» при 0 боёв
  $('status').innerHTML = `<div class="st">${esc(rt.status || '—')}</div><div class="chips">`
    + chip('⚔', rt.kills || 0, 'Боёв за сессию') + chip('✨', '+' + fmt(rt.exp), 'Опыт за сессию') + chip('📘', '+' + fmt(rt.sp), 'SP за сессию')
    + chip('💰', '+' + fmt(rt.adena), 'Адена за сессию') + (rt.rbKills ? chip('👑', rt.rbKills, 'РБ убито') : '')
    + (S.exp != null && rt.exp > 0 ? chip('⏱', fmtBig(S.exp) + ' EXP/ч', 'EXP в час за сессию (с нажатия ↺)') : '')
    + `</div>${hl ? `<div class="health">${esc(hl)}</div>` : ''}`;
  if ($('footVer')) $('footVer').textContent = 'v' + ver;
  // v4.53: кнопка «Старт» показывает, что бот работает: «● Работает» с пульсирующей зелёной подсветкой
  $('start').classList.toggle('running', heartbeatValid && !failing);
  $('start').textContent = on ? (heartbeatValid && !failing ? '● Активен' : booting ? '… Запуск' : '↻ Возобновить') : '▶ Старт';
  $('stop').classList.toggle('idle', !on && !paused);
  // 7.1.30: пауза — бот замирает без сброса состояния; «Продолжить» — с того же места
  $('pause').textContent = paused && !on ? '▶ Продолжить' : '⏸ Пауза';
  $('pause').classList.toggle('paused', !!paused && !on);
  $('pause').classList.toggle('idle', !on && !paused);
  if (document.activeElement?.id !== 'addName') renderPrio($('priority').value);
  // 8.0 (аудит меню): список имён мобов (все спавны — тысячи строк) пересобирается, только когда спавнов стало больше/меньше
  { const sp = rt.spawns || {}, sig = Object.keys(sp).length;
    if (dlSig.mob !== sig) { dlSig.mob = sig; $('mobNames').innerHTML = [...new Set(Object.values(sp).map(x => x[0]))].sort()
      .map(n => `<option value="${String(n ?? '').replace(/"/g, '&quot;')}">`).join(''); } }
  showCounts(reccount, snapcount);

  // режим РБ
  paintRbToggle(d);
  $('epicToggle2').textContent = `🐉 Эпики: ${d.epicMode ? 'ВКЛ' : 'ВЫКЛ'}`; $('epicToggle2').classList.toggle('on', !!d.epicMode);
  paintModes(d, on);
  paintCls(d, rt);
  { const on = String(d.epicList ?? DEF.epicList).split(','); document.querySelectorAll('.epicChk').forEach(c => c.checked = on.includes(c.dataset.epic)); }
  renderEpics(rt, d);
  renderMammon(rt, d); renderTvtShop(rt, d);
  renderStory(rt);
  $('huntToggle2').textContent = `🧭 Тур по РБ: ${d.rbHuntMode ? 'ВКЛ' : 'ВЫКЛ'}`; $('huntToggle2').classList.toggle('on', !!d.rbHuntMode);
  renderHunt(rt, d);
  renderRb(rt);
  const forecast=$('rbForecastBox'), RF=rt.rbForecast;
  if (forecast) {
    const age=RF?.t ? Math.round((Date.now()-RF.t)/1000) : null;
    if (!RF || age > 600) {
      forecast.textContent='Нет свежих измерений. Прогноз появится после начала боя с рейд-боссом.';
      forecast.dataset.status='idle';
    } else {
      const name=RF.status==='likely'?'Победа вероятна':RF.status==='measuring'?'Продолжается оценка':'Победа не подтверждена';
      forecast.dataset.status=RF.status;
      forecast.textContent=`${name} · ${RF.name} · HP босса ${RF.hpPct}%\n${RF.note}\nDPS ${RF.dps}; ударов ${RF.hits}; самый сильный ${RF.worstHit} HP; измерено ${RF.samples} точек · ${age} с назад`;
    }
  }
  // кампания
  const F = rt.fish;
  if (F?.casts) {
    const h = Math.max(1 / 60, (Date.now() - (F.t0 || Date.now())) / 3600000);
    $('fishBox').textContent = `Забросов ${F.casts} · клюнуло ${F.bites || 0} · не клюнуло ${F.nobite || 0}\n`
      + `Поймано ${F.caught || 0} · сорвалось ${F.lost || 0}${F.bites ? ` · успех ${Math.round((F.caught || 0) / F.bites * 100)}%` : ''} · ≈${Math.round((F.caught || 0) / h)} рыб/ч\n`
      + Object.entries(F.byFish || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(' · ')
      + `\nДо разделки: ${rt.fishSinceProc || 0} / ${d.fishProcessEvery || 100}${rt.fishProof != null ? ` · Proof: ${rt.fishProof}` : ''}${rt.fishService ? ` · сейчас: ${rt.fishService === 'cut' ? 'разделка' : 'обмен на Proof'}` : ''}`
      + fishSessLine(rt, F)
      + baitLine(rt)
      + goalLine(d, rt);
  } else $('fishBox').textContent = 'Ещё не рыбачил';
  if (!document.activeElement?.closest?.('#goalGrid')) renderGoals(rt);
  renderFishTgt(rt, d);
  renderRodGoal(rt, d);
  const C = rt.campaign;
  $('campBox').textContent = C ? `${C.title}\n` + C.targets.map(t => `${t.ok ? '✅' : '★'} ${t.name}${t.lvl ? ' (' + t.lvl + ')' : ''}: ${t.est ? '≈' : ''}${t.done}/${t.total}${t.ok ? '' : ' · осталось ' + (t.total - t.done)}${t.loc && !t.ok ? ' · ' + t.loc : ''}`).join('\n')
    + `\nпроверено ${new Date(C.t).toLocaleTimeString('ru')}${C.live ? ' · по логу боя ' + new Date(C.live).toLocaleTimeString('ru') : ''}${rt.campaignDue ? ' · ⏳ скоро проверка' : ''}`
    : rt.questList?.length ? rt.questList.map(q => `${q.title}\n${q.lines.join('\n')}`).join('\n') : 'Ещё не проверялась';

  renderDps(rt, showAllCls ? '' : heroCls(d, rt));
  renderFight(rt);
  renderEnemies(rt);
  renderPet(rt);
  paintRbOne(rt, on, paused);
  renderDash(rt, d, { on, paused, heartbeatValid, booting, failing });
  renderEff(rt);
  renderFa(rt, d); renderPots(rt, d); renderRbSess(rt, d);
  renderZones(rt, d);
  renderLoot(rt);
  // 🩺 v5.2: самопроверка баффов (пишет бот в бою раз в 15 с)
  if ($('buffAudit')) { const A = rt.buffAudit, ic = { ok: '✅', info: 'ℹ️', wait: '⏳', miss: '⚠️', bad: '❌' };
    $('buffAudit').textContent = A?.list?.length ? `🔍 Проверка баффов (${new Date(A.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}):\n`
      + A.list.map(x => `${ic[x.st] || '•'} ${x.bn} — ${x.why}`).join('\n') : (d.nBuffs ? '🔍 Проверка баффов — появится в первом бою' : ''); }
  renderCat(rt, d);
  // 8.0 (аудит меню): базы «Фарм ресурсов»/«Рецепты» (мегабайты) — только когда открыт раздел «Охота»
  if (huntOpen()) renderHuntDb(rt, d);
  $('shopBox').textContent = rt.shop ? `⏳ Сейчас закупаюсь (${rt.shop.step === 'count' ? 'считаю сумку' : 'покупаю'})…`
    : rt.shopLast ? `Последняя закупка ${new Date(rt.shopLast.t).toLocaleString('ru')}: ${rt.shopLast.text}` : '';

  // квесты: прогресс, частота дропа, прогноз боёв
  const rate = q => (q.drops + 1) / (q.kills + 2);
  // в кампании — только цели текущей главы (прошлая глава могла оставить «Ol Mahum Raider 39/40»)
  const campNames = cfg?.campaign && rt.campaign?.targets?.length ? rt.campaign.targets.filter(t => !t.objective).map(t => (t.name || '').toLowerCase()) : null;
  const inCamp = mob => !campNames || campNames.some(n => n.includes(mob.toLowerCase()) || mob.toLowerCase().includes(n));
  const qs = Object.entries(rt.quests || {}).filter(([mob, q]) => q.total && inCamp(mob));
  // «На локации» — только когда бот ищет квестовых (галочка; кампания убрана в 7.2.1); защита от мусора в старых данных
  const qt = d.searchQuest || d.campaign ? (rt.questTargets || []).filter(x => x.length < 60 && !/:\d/.test(x)) : [];
  renderQuestBox(rt, qt, qs, campNames ? rt.campaign : null, rate);
}

// шапка: цели задачи карточками — имя, счётчик, полоса прогресса, дроп и прогноз боёв
function renderQuestBox(rt, qt, qs, camp, rate) {
  const h = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const stat = name => qs.find(([mob]) => mob.toLowerCase() === name.toLowerCase() || name.toLowerCase().includes(mob.toLowerCase()))?.[1];
  const rows = camp
    ? camp.targets.map(t => ({ name: t.rb ? 'РБ: ' + t.name : t.name, done: t.done, total: t.total, ok: t.ok, est: t.est, rb: t.rb, champ: t.champ || /чемпион/i.test(t.name), loc: t.loc, q: stat(t.name || '') }))
    : qs.map(([mob, q]) => ({ name: mob, label: q.label, done: q.done, total: q.total, ok: q.left === 0, q }));
  const open = rows.filter(r => !r.ok), done = rows.filter(r => r.ok);
  const card = r => {
    const pct = r.total ? Math.min(100, Math.round(r.done / r.total * 100)) : 0, q = r.q;
    const sub = [q?.label && q.label !== r.name ? h(q.label) : '', q?.kills ? `дроп ≈${Math.round(rate(q) * 100)} % (${q.drops} из ${q.kills})` : '',
                 q && !r.ok && q.left > 0 ? `ещё ≈${Math.ceil(q.left / rate(q))} боёв` : '', ].filter(Boolean).join(' · ');
    return `<div class="qc${r.ok ? ' ok' : ''}"><div class="qh"><span class="qn">${r.ok ? '✅' : r.rb ? '👑' : r.champ ? '⚔' : '★'} ${h(r.name)}${r.loc && !r.ok ? ` <span class="qloc">· ${h(r.loc)}</span>` : ''}</span>`
      + `<span class="qv">${r.est ? '≈' : ''}${r.done}<i>/${r.total}</i></span></div>`
      + `<div class="qbar"><b style="width:${pct}%"></b></div>${sub ? `<div class="qs">${sub}</div>` : ''}</div>`;
  };
  const chips = qt.length && !camp ? `<div class="qchips"><span>На локации:</span>${qt.slice(0, 6).map(n => `<em>${h(n)}</em>`).join('')}${qt.length > 6 ? `<em>+${qt.length - 6}</em>` : ''}</div>` : '';
  $('questBox').innerHTML = !rows.length && !chips ? ''
    : (camp ? `<div class="qt">📜 ${h(camp.title)}</div>` : '') + chips + open.map(card).join('')
      + (done.length ? `<div class="qdone">${done.map(r => '✅ ' + h(r.name)).join(' · ')}</div>` : '');
}

// расчёт ДПС: по каждому удару — средний урон, КД, урон в секунду КД, MP на 1000 урона, цена в энергии
// 8.0 (аудит меню): у мага (cls 'mage') — без энергии силы и воинской стратегии (магу они не относятся)
function renderDps(rt, cls = '') {
  const box = $('dpsBox');
  if (!box) return;
  const mage = cls === 'mage';
  const turn = (rt.turnMs || 1000) / 1000, P = rt.skills || {}, DB = rt.skillDb || {};
  const rows = Object.entries(P).filter(([, p]) => p.dmgN).map(([k, p]) => {
    const dmg = p.dmg / p.dmgN, cd = p.cd || DB[k]?.cd || 0, mp = p.mpN ? p.mp / p.mpN : (DB[k]?.mp || 0);
    const force = DB[k]?.force || ({ 'hurricane assault': 2, 'force blaster': 1 })[k] || 0;
    const per = dmg / Math.max(cd, turn) ;                         // урон в секунду, если жать сразу по откату
    return { name: p.name || k, dmg, cd, mp, force, per, eff: dmg / (1 + force) };
  }).sort((a, b) => b.dmg - a.dmg);
  // отдача маны: урон сверх обычной атаки (с учётом ходов на заряды) на 1 MP — чем больше, тем выгоднее скилл
  const atk = rows.find(r => /^атака$/i.test(r.name))?.dmg || 0;
  rows.forEach(r => { r.mpEff = r.mp && atk ? (r.dmg - atk * (1 + r.force)) / r.mp : null; });
  const d = rt.dps;
  box.textContent = (d?.n ? `Бои: ${d.n} · средний ДПС ${d.dps} · время убийства ≈${d.ttk} с · последний: ${d.last} ДПС за ${d.lastTtk} с\n` : 'Боёв с расчётом ещё нет\n')
    + `Ход ≈${turn.toFixed(2)} с${mage ? '' : ` · энергия ⚡${rt.force?.n ?? 0}${rt.force?.max ? '/' + rt.force.max : ''}`}\n`
    + (rows.length ? rows.map(r => `• ${r.name}: ≈${Math.round(r.dmg)} урона${r.cd ? ` · КД ${r.cd} с` : ''} · ${Math.round(r.per)}/с`
      + `${r.mp ? ` · MP ${Math.round(r.mp)}` : ''}${r.mpEff != null ? ` · ${r.mpEff > 0 ? '+' + Math.round(r.mpEff) : Math.round(r.mpEff)} урона/MP сверх атаки${r.mpEff < 20 ? ' ⚠ невыгодно при нехватке MP' : ''}` : ''}${r.force && !mage ? ` · −${r.force} эн. → ${Math.round(r.eff)} за ход` : ''}`).join('\n')
      : 'Удары ещё не изучены — бот выучит их в бою')
    + (mage ? '' : totemLines(rt))
    + (mage
      ? '\nСтратегия мага: добивание — самым дешёвым заклинанием, которое добьёт моба → иначе самое сильное готовое по замеру урона; новое заклинание сначала замеряется на «толстом» мобе. Кот бьёт на каждое твоё действие. MP не экономим (банки MP); экономия (урон на 1 MP) — только когда банки MP нет и MP < 30 %.'
      : '\nСтратегия: добивание самым дешёвым ударом → иначе самый сильный готовый → в паузах КД копит энергию → мощный удар, как только хватает энергии. MP < 35 % и банки нет — только скиллы с лучшей отдачей на 1 MP. Урон считается по текущему бою (против сильного моба атака почти 0 — тогда заряд ценнее атаки). Мобов выше героя больше чем на N ур. не выбирает.');
}

// 7.1.31: 🐱 статистика котов (rt.petStat[кот] = { fights, hits, dmg, acts, dealt, deaths, summons, resummons, lvMin, lvMax })
function renderPet(rt) {
  const box = $('petBox');
  if (box) {
    const S = Object.entries(rt.petStat || {}).sort((a, b) => (b[1].fights || 0) - (a[1].fights || 0));
    const db = rt.skillDb || {}, rank = k => { const i = db['summon ' + k.replace(/_/g, ' ')]; return i?.rank ? ` · ранг призыва ${i.rank}` : ''; };
    box.textContent = S.length ? S.map(([k, s]) => {
      const sw = (s.hits || 0) + (s.crits || 0) + (s.misses || 0), hit = s.hits ? (s.hitDmg || s.dmg) / s.hits : 0, rate = s.acts ? sw / s.acts : 0, per = s.acts ? s.dmg / s.acts : 0;
      return `• ${s.name || k}: ${s.fights} боёв${s.lvMin ? ` (${s.lvMin === s.lvMax ? s.lvMin : s.lvMin + '–' + s.lvMax} ур.)` : ''}${rank(k)}\n`
        + `   удар ≈${Math.round(hit)}${s.crits ? ` · критов ${Math.round(s.crits / sw * 100)} %` : ''} · промахов ${sw ? Math.round((s.misses || 0) / sw * 100) : 0} %\n`
        + `   бьёт на ${Math.round(rate * 100)} % твоих действий · ≈${Math.round(per)} урона за действие`
        + `${s.dealt ? ` · ${Math.round(s.dmg / s.dealt * 100)} % всего урона` : ''}\n`
        + `   гибель ${s.deaths || 0} (${s.fights ? Math.round((s.deaths || 0) / s.fights * 100) : 0} на 100 боёв) · призывов ${s.summons || 0} · перепризывов ${s.resummons || 0}`;
    }).join('\n') + `\n\n💡 ${rt.petAdvice?.text || 'рекомендация появится после 30 боёв с котом'}`
      : 'Пока нет данных — бот считает удары кота в каждом бою (строки «Слуга [Mew the Cat] атакує … урону»).';
  }
  const nb = $('noEffBox');
  if (nb) {
    const off = Object.values(rt.skillDb || {}).filter(v => /в бою эффекта нет|у бою ефекту немає/i.test(v.desc || '')).map(v => v.name);
    nb.textContent = off.length ? `«В бою эффекта нет» (по описанию магистра): ${off.join(', ')}` : 'Список «в бою эффекта нет» пополнится сам, когда откроешь у магистра «Умения» (Персонаж → Умения).';
  }
}

// тотемы: одновременно висит один — бот меряет скорость убийства с каждым на одних и тех же мобах (15 боёв на замер)
function totemLines(rt) {
  const E = Object.entries(rt.buffEff || {});
  if (!E.length) return '';
  const MIN = 15, meas = E.filter(([k, e]) => k !== '—' && e.n >= MIN).sort((a, b) => b[1].r - a[1].r);
  const top = meas[0]?.[0];
  return '\n\n🗿 Тотемы (висит один — бот ставит лучший по замеру, на его откате — следующий):\n'
    + E.sort((a, b) => (b[1].n >= MIN) - (a[1].n >= MIN) || b[1].r - a[1].r).map(([k, e]) => `• ${e.name || k}: ${e.n < MIN ? `замер ${e.n}/${MIN} боёв` : `${e.n} боёв · скорость убийства ${e.r >= 1 ? '+' : ''}${Math.round((e.r - 1) * 100)} % к среднему`}${k === top ? ' ← основной' : ''}`).join('\n');
}

// 🎯 цель рыбалки: поймать N рыб / собрать N Proof (rt.fishTgt = { type, n, got, t, done })
function renderFishTgt(rt, d) {
  const T = rt.fishTgt, F = rt.fish || {};
  if (!T) { $('fishTgtBox').textContent = 'Цели нет — бот рыбачит без остановки' + (d.fishMaxCasts ? ` (лимит ${d.fishMaxCasts} забросов)` : ''); $('fishTgtClear').hidden = true; return; }
  $('fishTgtClear').hidden = false;
  const got = T.got || 0, left = Math.max(0, T.n - got), pct = Math.min(100, Math.round(got / T.n * 100));
  const hrs = Math.max(1 / 60, (Date.now() - (F.t0 || Date.now())) / 3600000), perH = (F.caught || 0) / hrs;
  const perFish = rt.fishProofFish ? (rt.fishProofGain || 0) / rt.fishProofFish : 0;
  let eta = '';
  if (!T.done && left) {
    const fishLeft = T.type === 'fish' ? left : perFish ? Math.max(0, Math.ceil(left / perFish) - (rt.fishSinceProc || 0)) : 0;
    eta = T.type === 'proof' && !perFish ? '\nТемп Proof появится после первого обмена'
      : `\n≈${fmt(fishLeft)} рыб${perH >= 1 ? ` · ≈${fishLeft / perH < 1 ? Math.max(1, Math.round(fishLeft / perH * 60)) + ' мин' : (fishLeft / perH).toFixed(1) + ' ч'}` : ''}${T.type === 'proof' ? ` (${perFish.toFixed(2)} Proof/рыба${rt.fishSinceProc ? `, в сумке ещё ${rt.fishSinceProc} рыб ≈${Math.floor(rt.fishSinceProc * perFish)} Proof` : ''})` : ''}`;
  }
  $('fishTgtBox').textContent = `${T.done ? '✅ Выполнено' : '🎯'} ${T.type === 'fish' ? 'Поймать' : 'Собрать'} ${fmt(T.n)} ${T.type === 'fish' ? 'рыб' : 'Proof'}: ${fmt(got)}/${fmt(T.n)} (${pct} %)`
    + (T.done ? ` · ${new Date(T.doneT).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` : left ? ` · осталось ${fmt(left)}` : '')
    + (T.final && !T.done ? '\n⏳ Цель достигнута — сдаю улов на Proof, потом стоп' : '') + eta
    + `\nпоставлена ${new Date(T.t).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${rt.fishProof != null ? ` · всего Proof: ${fmt(rt.fishProof)}` : ''}`;
}
$('fishTgtSet').onclick = async () => {
  const n = Math.floor(+$('fishTgtN').value || 0);
  if (n < 1) return $('fishTgtN').focus();
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ fishTgt: { type: $('fishTgtType').value, n, got: 0, t: Date.now() } });
  $('fishTgtN').value = '';
};
$('fishTgtN').addEventListener('keydown', e => { if (e.key === 'Enter') $('fishTgtSet').click(); });
$('fishTgtClear').onclick = async () => {
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ fishTgt: null });
};

// цель рыбалки: следующая вещь за Proof, сколько осталось и сколько рыбы примерно нужно
const GEAR_COST = { d: 500, c: 1500, b: 3500, a: 5000, s: 8000 };
const GEAR_ADENA = { d: 0.5, c: 1.5, b: 5, a: 15, s: 50 };     // млн аден
const GEAR_NAME = { tattoo: 'Тату', cloak: 'Плащ', belt: 'Пояс' };
// вещи «Рыболовного магазина» (со страницы магазина): название и бонусы
// 8.0.1 (обновление L2WAP 11.10): плащи — бонусы HP/P.Def/M.Def усиливаются активными баффами (и улучшенные до +5); пояса — вместо
// шанса крита сила физ. и маг. крита: D +2 %, C +3 %, B +5 %, A +7 %, S +10 %, каждый уровень заточки +25 % к базе (S +5 = 22,5 %)
const GEAR_INFO = {
  cloak_d: ['Плащ рибалки', 'HP +250 · P.Def +70 · M.Def +70 (усиливается баффами)'], cloak_c: ['Плащ мисливця моря', 'HP +450 · P.Def +110 · M.Def +110 (усиливается баффами)'],
  cloak_b: ['Плащ глибокого моря', 'HP +700 · P.Def +170 · M.Def +170 (усиливается баффами)'], cloak_a: ['Плащ стража океану', 'HP +1000 · P.Def +240 · M.Def +240 (усиливается баффами)'],
  cloak_s: ['Плащ Левіафан', 'HP +1400 · P.Def +320 · M.Def +320 (усиливается баффами)'],
  tattoo_d: ['Татуювання річки', 'P.Atk/M.Atk +150 · скорость атаки/каста +1%'], tattoo_c: ['Татуювання озера', 'P.Atk/M.Atk +250 · скорость +2%'],
  tattoo_b: ['Татуювання моря', 'P.Atk/M.Atk +400 · скорость +3%'], tattoo_a: ['Татуювання глибокого моря', 'P.Atk/M.Atk +700 · скорость +4%'],
  tattoo_s: ['Татуювання Левіафан', 'P.Atk/M.Atk +1000 · скорость +5%'],
  belt_d: ['Пояс рибалки', 'HP +250 · бег +3 · сила крита +2%'], belt_c: ['Пояс досвідченого рибалки', 'HP +450 · бег +5 · сила крита +3%'],
  belt_b: ['Пояс ветерана рибалки', 'HP +700 · бег +7 · сила крита +5%'], belt_a: ['Пояс майстра рибалки', 'HP +1000 · бег +9 · сила крита +7%'],
  belt_s: ['Пояс Левіафан', 'HP +1400 · бег +12 · сила крита +10%'],
};
const goalList = v => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(x => GEAR_INFO[x]);
let goalItemsMode = null;                         // «Покупать вещи» нажато, но вещи ещё не выбраны
function renderRodGoal(rt, d) {
  const known = Number.isFinite(rt.rodLvl), lvl = known ? `+${rt.rodLvl}` : 'пока неизвестен';
  const active = !!rt.rodGoalActive && (rt.rodLvl == null || rt.rodLvl < 10);
  $('fishRodGoalStatus').textContent = active
    ? `Цель +10: текущий уровень ${lvl}. ${rt.rodGoalWaitingProof ? 'Накапливаю Proof для следующего свитка.' : 'Заточка продолжится автоматически.'}`
    : rt.rodLvl >= 10 ? 'Удочка +10: цель достигнута. Рыбалка и накопление Proof продолжаются.'
    : `${known ? `Удочка ${lvl}` : 'Заточка удочки пока неизвестна'}. Для запуска полной цепочки нажмите кнопку.`;   // 8.0: было «Удочка пока неизвестен»
  $('fishRodGoal10').textContent = active ? 'Цель +10 активна' : 'Цель: заточить удочку до +10';
}
function renderGoals(rt) {
  const q = goalList($('fishGoal').value), own = new Set(rt.fishGearBought || []);
  const items = q.length > 0 || goalItemsMode === true;
  $('goalProof').classList.toggle('on', !items);
  $('goalItems').classList.toggle('on', items);
  $('goalProof').setAttribute('aria-pressed', String(!items));
  $('goalItems').setAttribute('aria-pressed', String(items));
  $('goalGrid').hidden = !items;
  if (items) {
    let h = '<span></span>' + ['D', 'C', 'B', 'A', 'S'].map(g => `<span class="gh">${g}</span>`).join('');
    for (const k of ['cloak', 'tattoo', 'belt']) {
      h += `<span class="gk">${GEAR_NAME[k]}</span>`;
      for (const g of ['d', 'c', 'b', 'a', 's']) {
        const id = `${k}_${g}`, n = q.indexOf(id), [nm, st] = GEAR_INFO[id];
        h += `<button data-goal="${id}" class="${own.has(id) ? 'own' : n >= 0 ? 'sel' : ''}" title="${nm}\n${st}\n${GEAR_COST[g]} Proof + ${GEAR_ADENA[g]} млн аден">${GEAR_COST[g]}${n >= 0 && !own.has(id) ? `<i>${n + 1}</i>` : own.has(id) ? ' ✓' : ''}</button>`;
      }
    }
    $('goalGrid').innerHTML = h;
  }
  const left = q.filter(x => !own.has(x));
  const proof = rt.fishProof || 0, adenaM = left.reduce((a, x) => a + GEAR_ADENA[x.split('_')[1]], 0), need = left.reduce((a, x) => a + GEAR_COST[x.split('_')[1]], 0);
  $('goalQueue').textContent = !items ? `Proof накоплено: ${proof}. Автоматическая покупка плащей, татуировок и поясов выключена. Заточка удочки до +${$('rodEnchantTo').value || 0} — отдельная цель и может расходовать Proof на свитки.`
    : !q.length ? 'Нажмите на клетку (число — цена в Proof), чтобы добавить вещь в очередь. Повторное нажатие — убрать.'
    : `Очередь: ${q.map((x, i) => `${i + 1}. ${GEAR_INFO[x][0]} (${x.split('_')[1].toUpperCase()})${own.has(x) ? ' ✓' : ''}`).join(' → ')}`
      + (left.length ? `\nВсего нужно ${need} Proof + ${adenaM} млн аден · есть ${proof} Proof. Бот покупает по порядку, когда хватает Proof и аден.` : '\nВсё из очереди уже куплено.');
}
async function setGoals(list) {
  $('fishGoal').value = list.join(', ');
  await save();
  const { rt = {} } = await chrome.storage.local.get('rt');
  renderGoals(rt);
}
// сессия рыбалки: темп, откат Pumping/Reeling (учится по отказам), урон, расход аден на рыбу (наживка 100, заряд 100)
// 7.2.1: замер наживки — Proof в час на обычной и хорошей (оценка Proof по видам рыбы из разделки)
function baitLine(rt) {
  const S = rt.fishBaitStat || {}, b = S.basic || {}, g = S.good || {};
  const pph = o => o.ms > 60000 ? o.proof / o.ms * 3600000 : 0, row = (nm, o) => `${nm}: ${o.casts || 0} забр. · клёв ${o.casts ? Math.round((o.bites || 0) / o.casts * 100) : 0}% · ${pph(o) ? pph(o).toFixed(1) + ' Proof/ч' : '—'}`;
  if (!b.casts && !g.casts) return '';
  const done = (b.casts || 0) >= 60 && (g.casts || 0) >= 60, per = done ? g.proof / g.casts - b.proof / b.casts : 0;
  return `\n🐛 ${row('обычная', b)}\n🐛 ${row('хорошая', g)}` + (done ? `\n🐛 хорошая на заброс ${per >= 0 ? '+' : ''}${per.toFixed(2)} Proof → ${per > 0.3 ? 'выгодно даже покупать за Proof (0,3 шт.)' : pph(g) > pph(b) * 1.03 ? 'ловить на бесплатных (Old Box), не покупать' : 'не нужна — только обычная'}` : `\n🐛 замер: по 60 забросов на каждой`);
}
function fishSessLine(rt, F) {
  const S = rt.fishSess; if (!S?.n) return '';
  const R = fishRate(rt);                          // 8.0: тот же темп, что в «Обзоре»
  const C = rt.fishCdStat || {}, D = rt.fishDmg || {};
  const avg = k => D[k]?.n ? Math.round(D[k].sum / D[k].n) : null;
  const bait = F.caught ? F.casts / F.caught : 0, shots = (S.shots || 0) / S.n;
  return `\nСессия: ${S.n} рыб · ${Math.round(R.perH)}/ч${R.proofH != null ? ` · ≈${Math.round(R.proofH)} Proof/ч` : ''} · откат ${(rt.fishCdLen || 1.22).toFixed(2)} с${C.rej ? ` · отказов ${C.rej}/${(C.ok || 0) + C.rej}` : ''}`
    + (rt.fishNoShots ? `\n⚠ Заряды кончились — ловлю без них (≈в 1,6 раза медленнее). Включите «докупать» или купите заряды` : '')
    + `\nУрон: с зарядом ${avg('shot') ?? '—'} · без ${avg('plain') ?? '—'} · расход ≈${Math.round(bait * 100 + shots * 100)} аден/рыба`;
}
function goalLine(d, rt) {
  const next = goalList(d.fishGoal).find(g => !(rt.fishGearBought || []).includes(g));
  if (!goalList(d.fishGoal).length) return `\n💰 Копим Proof: ${rt.fishProof || 0}`;
  if (!next) return (rt.fishGearBought || []).length ? `\n🎯 Все цели куплены: ${(rt.fishGearBought || []).join(', ')}` : '';
  const [k, gr] = next.split('_'), cost = GEAR_COST[gr] || 0, have = rt.fishProof || 0;
  const per = rt.fishProofFish ? (rt.fishProofGain || 0) / rt.fishProofFish : 0;
  const left = Math.max(0, cost - have);
  return `\n🎯 Цель: ${GEAR_INFO[next]?.[0] || GEAR_NAME[k] || k} (${(gr || '').toUpperCase()}) — ${have}/${cost} Proof + ${GEAR_ADENA[gr]} млн аден`
    + (left && per ? ` · ≈${Math.ceil(left / per)} рыб (${per.toFixed(2)} Proof/рыба)` : left ? ' · темп появится после первого обмена' : ' · хватает — куплю при обмене');
}

// добыча: что, сколько, с кого и как часто (на 100 боёв с этим мобом)
function renderLoot(rt) {
  const box = $('lootBox'); if (!box) return;
  const LS = rt.lootStat || {}, MK = rt.mobKills || {}, h = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const items = Object.entries(LS).sort((a, b) => b[1].n - a[1].n);
  const kills = Object.values(MK).reduce((a, b) => a + b, 0);
  if (!items.length) { box.innerHTML = `<div class="hint">Пока пусто${kills ? ` (боёв: ${kills}, без добычи)` : ''} — статистика копится с каждой победы.</div>`; return; }
  const hrs = Math.max(1 / 60, (Date.now() - (rt.lootStatT0 || Date.now())) / 3600000);
  box.innerHTML = `<table><tr><th>Предмет</th><th>Всего</th><th>/ч</th><th>Лучший источник</th></tr>`
    + items.slice(0, 25).map(([name, e]) => {
      const best = Object.entries(e.k).map(([m, n]) => [m, n, MK[m] || 0]).filter(x => x[2] > 0).sort((a, b) => b[1] / b[2] - a[1] / a[2])[0];
      return `<tr><td>${h(name)}</td><td>${fmt(e.n)}</td><td>${fmt(Math.round(e.n / hrs))}</td><td>${best ? `${h(best[0])} — ${(best[1] / best[2]).toFixed(2)} шт./бой (${best[2]} боёв)` : '—'}</td></tr>`;
    }).join('') + '</table>'
    + `<div class="rec">Боёв: ${fmt(kills)} · видов добычи: ${items.length} · с ${new Date(rt.lootStatT0).toLocaleString('ru')}</div>`;
}
// v5.2: базы «Фарм ресурсов» и «Рецепты» — читаем из хранилища один раз и держим в памяти, перечитываем только когда они
// поменялись. Раньше меню перечитывало их (мегабайты: у Stem 1044 источника) на КАЖДОМ обновлении — до 3 раз в секунду,
// и встроенная панель могла упасть от нехватки памяти («грустный листок» вместо меню).
const DBC = {}, dlSig = {};
async function dbGet(k, def) { if (!(k in DBC)) DBC[k] = (await chrome.storage.local.get(k))[k] || def; return DBC[k]; }
chrome.storage.onChanged.addListener(ch => { for (const k of ['farmDb', 'recipeDb']) if (ch[k]) { if (ch[k].newValue) DBC[k] = ch[k].newValue; else delete DBC[k]; } });
// база предметов (items-il.json) — имя по itemId, грузится один раз
let ITEMS_IL = null;
const itemsIl = async () => ITEMS_IL || (ITEMS_IL = await fetch(chrome.runtime.getURL('items-il.json')).then(r => r.json()).catch(() => ({}))); 
// v5.2: своё выпадающее меню вместо системного <datalist> — системное закрывалось само при каждом обновлении меню
// (список в сумке/добыче меняется после каждого боя) и показывало только «значение». Данные берутся из того же <datalist>.
function combo(inp) {
  const dl = document.getElementById(inp.getAttribute('list')); if (!dl) return;
  inp.removeAttribute('list'); inp.setAttribute('autocomplete', 'off');
  const box = document.createElement('div'); box.className = 'cb-pop'; box.hidden = true; document.body.appendChild(box);
  let items = [], act = -1, sig = '';
  const esc2 = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const place = () => { const r = inp.getBoundingClientRect(), below = innerHeight - r.bottom - 8, up = below < 160 && r.top > below;
    box.style.left = r.left + 'px'; box.style.width = Math.max(r.width, 220) + 'px';
    box.style.maxHeight = Math.max(120, Math.min(300, (up ? r.top : below) - 8)) + 'px';
    box.style.top = up ? '' : r.bottom + 2 + 'px'; box.style.bottom = up ? innerHeight - r.top + 2 + 'px' : ''; };
  const draw = (keep) => {
    const q = inp.value.trim().toLowerCase(), all = [...dl.options].map(o => ({ v: o.value, n: o.textContent }));
    items = (q ? all.filter(o => o.v.toLowerCase().includes(q) || o.n.toLowerCase().includes(q)) : all).slice(0, 300);
    const s2 = q + '|' + items.map(o => o.v + o.n).join('|'); if (keep && s2 === sig) return; sig = s2;
    const st = box.scrollTop; if (act >= items.length) act = items.length - 1;
    box.innerHTML = items.length ? items.map((o, i) => `<div class="cb-it${i === act ? ' on' : ''}" data-i="${i}"><b>${esc2(o.v)}</b>${o.n ? `<span>${esc2(o.n)}</span>` : ''}</div>`).join('')
      : '<div class="cb-empty">ничего не найдено</div>';
    if (keep) box.scrollTop = st;
  };
  const open = () => { draw(); place(); box.hidden = false; };
  const close = () => { box.hidden = true; act = -1; };
  const pick = i => { const o = items[i]; if (!o) return; inp.value = o.v; close(); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); };
  const hl = () => { box.querySelectorAll('.cb-it').forEach((e, i) => e.classList.toggle('on', i === act)); box.querySelector('.cb-it.on')?.scrollIntoView({ block: 'nearest' }); };
  inp.addEventListener('focus', open); inp.addEventListener('click', () => box.hidden && open());
  inp.addEventListener('input', e => { if (e.isTrusted) { act = -1; open(); } });
  inp.addEventListener('blur', () => setTimeout(close, 120));
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (box.hidden) open(); act = Math.max(0, Math.min(items.length - 1, act + (e.key === 'ArrowDown' ? 1 : -1))); hl(); e.preventDefault(); }
    else if (e.key === 'Enter' && !box.hidden && act >= 0) { pick(act); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.key === 'Escape' && !box.hidden) { close(); e.preventDefault(); e.stopPropagation(); }
  });
  box.addEventListener('mousedown', e => { e.preventDefault(); const i = e.target.closest('.cb-it')?.dataset.i; if (i != null) pick(+i); });
  new MutationObserver(() => { if (!box.hidden) draw(true); }).observe(dl, { childList: true, subtree: true, characterData: true });
  addEventListener('scroll', () => { if (!box.hidden) place(); }, true); addEventListener('resize', () => { if (!box.hidden) place(); });
}
['resPick', 'farmRes', 'recipeRes', 'addName'].forEach(id => { const el = document.getElementById(id); if (el) combo(el); });
// квесты на ресурсы: цели «Имя = N» (хранятся строками в cfg.resQuests), выбор предмета из списка, прогресс по каждой
const resParse = v => String(v || '').split('\n').map(l => l.match(/^\s*(.+?)\s*[=:×x]\s*(\d+)\s*$/i)).filter(Boolean)
  .map(m => ({ name: m[1].trim(), key: m[1].trim().toLowerCase(), need: +m[2] }));
async function resSet(list) {
  $('resQuests').value = list.map(r => `${r.name} = ${r.need}`).join('\n');
  await save(); load();
}
async function renderRes(rt, d) {
  const rq = resParse(d.resQuests), bag = rt.bagAll, h = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  // список для выбора: сумка, добыча, база «Фарм ресурсов», ресурсы главы
  const fdb = await dbGet('farmDb', { res: {} });
  const opt = new Map(), add = (n, note) => { if (!n || n.length > 60 || /^(adena|аден[аи]?)$/i.test(n)) return; const k = n.toLowerCase(); const o = opt.get(k) || { n, notes: [] }; if (note) o.notes.push(note); opt.set(k, o); };
  const IT = await itemsIl();                     // v5.2: старый пересчёт мог сохранить «#1061» — показываем название из базы
  Object.entries(bag?.n || {}).forEach(([n, v]) => { const id = n.match(/^#(\d+)$/)?.[1]; add(id && IT[id]?.n ? IT[id].n : n, `в сумке ${fmt(v)}`); });
  Object.entries(rt.lootStat || {}).forEach(([n, e]) => add(n, `выпало ${fmt(e.n)}`));
  (rt.campaign?.targets || []).filter(t => t.res && !t.ok).forEach(t => add(t.name, `глава ${t.done}/${t.total}`));
  Object.values(fdb.res || {}).forEach(r => add(r.name, 'фарм-база'));
  const dl = [...opt.values()].sort((a, b) => b.notes.length - a.notes.length || a.n.localeCompare(b.n))
    .map(o => `<option value="${h(o.n)}">${h(o.notes.join(' · '))}</option>`).join('');
  if (dlSig.res !== dl) { dlSig.res = dl; $('resPickList').innerHTML = dl; }
  // цели: прогресс, число можно поправить, ✕ — убрать
  if (!$('resList').contains(document.activeElement)) {
    $('resList').innerHTML = rq.map(r => {
      const b = rt.bagSeen?.[r.key], have = (b?.n || 0) + (rt.resGot?.[r.key] || 0);
      return `<div class="rule"><span class="t">${have >= r.need ? '✅' : '📦'} ${h(r.name)} — ${fmt(have)}/${fmt(r.need)}${have < r.need ? ` · осталось ${fmt(r.need - have)}` : ''}`
        + `<br><span class="hint">${b ? 'сумка ' + new Date(b.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : 'сумку ещё не считал — нажмите «Пересчитать в сумке»'}</span></span>`
        + `<input type="number" min="1" data-res="${h(r.key)}" value="${r.need}" style="width:66px" title="Сколько нужно"><button data-resdel="${h(r.key)}" title="Убрать">✕</button></div>`;
    }).join('');
  }
  const head = rt.bagCheck ? '⏳ Пересчитаю сумку после текущего боя (бот должен быть запущен)…\n' : '';
  if (!bag) { $('resBox').textContent = head; return; }
  const loot = new Set(Object.keys(rt.lootStat || {}).map(x => x.toLowerCase()));
  const fromLoot = Object.entries(bag.n).filter(([k]) => loot.has(k.toLowerCase())).sort((a, b) => b[1] - a[1]).slice(0, 25);
  $('resBox').textContent = head + `🎒 Сумка пересчитана ${new Date(bag.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}: ${Object.keys(bag.n).length} видов предметов`
    + (fromLoot.length && !rq.length ? `\nИз добычи: ${fromLoot.map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}` : '');
}
$('resAdd').onclick = async () => {
  const name = $('resPick').value.trim(), need = Math.floor(+$('resNeed').value || 0);
  if (!name) return $('resPick').focus();
  if (need < 1) return $('resNeed').focus();
  const list = resParse($('resQuests').value).filter(r => r.key !== name.toLowerCase());
  list.push({ name, key: name.toLowerCase(), need });
  $('resPick').value = ''; $('resNeed').value = '';
  await resSet(list);
};
$('resPick').addEventListener('keydown', e => { if (e.key === 'Enter') $('resNeed').focus(); });
$('resNeed').addEventListener('keydown', e => { if (e.key === 'Enter') $('resAdd').click(); });
$('resList').addEventListener('click', e => {
  const k = e.target.closest('[data-resdel]')?.dataset.resdel; if (k == null) return;
  resSet(resParse($('resQuests').value).filter(r => r.key !== k));
});
$('resList').addEventListener('change', e => {
  const k = e.target.dataset?.res; if (k == null) return;
  const n = Math.floor(+e.target.value || 0);
  const list = resParse($('resQuests').value).map(r => r.key === k ? { ...r, need: Math.max(1, n) } : r);
  e.target.blur(); resSet(list);
});

// фарм ресурса: база с форума (chrome.storage «farmDb»), лучшая зона для уровня героя, прогресс
// 📜 охота на рецепты: список из базы форума, лучшие локации для уровня героя, сколько выбито
// 🏛 v5.3: фарм катакомб — какое подземелье, уровни мобов (что бот видел внутри), где он сейчас
const CAT_NM = { necropolis_of_sacrifice: ['Necropolis of Sacrifice', 20, 30], pilgrims_necropolis: ["The Pilgrim's Necropolis", 30, 40], patriots_necropolis: ["The Patriot's Necropolis", 54, 54], necropolis_of_worship: ['Necropolis of Worship', 42, 43], necropolis_of_devotion: ['Necropolis of Devotion', 60, 70], necropolis_of_martyrdom: ['Necropolis of Martyrdom', 60, 70], saints_necropolis: ["The Saint's Necropolis", 70, 80], disciples_necropolis: ["The Disciple's Necropolis", 70, 80], catacomb_of_the_heretic: ['Catacomb of the Heretic', 30, 40], catacomb_of_the_branded: ['Catacomb of the Branded', 40, 50], catacomb_of_the_apostate: ['Catacomb of the Apostate', 50, 51], catacomb_of_the_witch: ['Catacomb of the Witch', 60, 70], catacomb_of_dark_omens: ['Catacomb of Dark Omens', 70, 80], catacomb_of_the_forbidden_path: ['Catacomb of the Forbidden Path', 75, 76] };
// 9.0: камни печати и Ancient Adena (rt.sealSeen.q: зелёные, синие, красные, AA — из ответов игры), итог последнего обмена
function renderSeal(rt, d) {
  if (!$('sealBox')) return;
  const q = rt.sealSeen?.q, L = rt.sealLast, f = n => Number(n || 0).toLocaleString('ru-RU');
  $('sealBox').textContent = (q ? `В сумке: зелёных ${f(q[0])}, синих ${f(q[1])}, красных ${f(q[2])} → ≈${f(q[0] * 5 + q[1] * 3 + q[2] * 10)} AA · Ancient Adena сейчас ${f(q[3])}` : 'Сколько камней — узнаю, когда бот увидит сумку')
    + (rt.sealEx ? '\n⏳ Обмен поставлен в очередь' : '') + (L ? `\nПоследний обмен ${new Date(L.t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: ${L.why}` : '')
    + (rt.sealTown ? '\nИгра меняет только в городе — автообмен ждёт, пока герой в городе' : '');
}
$('sealNow').onclick = async () => {
  const { on = false } = await chrome.storage.local.get('on');
  await activateMode({ sealEx: { t: Date.now(), stopAfter: !on }, sealT: 0 }, {});
  $('sealNow').textContent = 'Обмен поставлен в очередь';
};
function renderCat(rt, d) {
  renderSeal(rt, d);
  if (!$('catBox')) return;
  const lv = id => { const k = rt.catLv?.[id]; return k?.n >= 3 ? `${k.lo}–${k.hi} ур. (видел)` : `≈${CAT_NM[id][1]}–${CAT_NM[id][2]} ур. (прикидка)`; };
  const cur = rt.catIn || rt.catCur, now = Date.now();
  const seen = Object.keys(CAT_NM).filter(id => rt.catLv?.[id]);
  $('catBox').textContent = (d.catMode ? `${rt.catIn ? '🏛 Внутри: ' : cur ? '➜ Цель: ' : '⏳ Цель выберу по уровню героя'}${cur ? CAT_NM[cur]?.[0] + ' · ' + lv(cur) : ''}` : 'Выключено')
    + (seen.length ? `\nУвиденные подземелья: ${seen.map(id => `${CAT_NM[id][0]} ${lv(id).replace(/ \(.*\)/, '')}${now - (rt.catBad?.[id] || 0) < 3600000 ? ' (пропускаю)' : ''}`).join(' · ')}` : '');
}
// ---------- 7.2.1 (просьба игрока): список «что фармить» как на форуме — разделы раскрываются, предмет раскрывается
// в источники (дроп / спойл / РБ), «🌾 Фармить» ставит цель одним нажатием, поиск по названию ----------
const TREE = { farm: { db: 'farmDb', items: 'res', input: 'farmRes', search: 'farmSearch', box: 'farmTree' },
  recipe: { db: 'recipeDb', items: 'rec', input: 'recipeRes', search: 'recipeSearch', box: 'recipeTree' } };
const treeSig = {}, treeOpen = { farm: new Set(), recipe: new Set() };
// 8.0.5 (игрок: «перед кейматами сделай ресурсы … с картинками как в игре»): разделы в порядке страницы игры, у предмета — иконка игры.
// Базовые ресурсы без раздела (строку раскрыл игрок — раньше раздел стирался) — в «Ресурсы»
const BASIC_RES = /^(animal (bone|skin)|charcoal|coal|iron ore|mithril ore|oriharukon ore|silver nugget|adamantite nugget|stem|stone of purity|suede|thread|varnish|asofe|thons|enria|mold \w+|cokes|steel|leather|braided hemp|coarse bone powder|cord|metallic (fiber|thread)|crafted leather|high grade suede|compound braid|durable metal plate|metal hardener|oriharukon|mithril alloy|synthetic cokes|varnish of purity|artisan's frame|blacksmith's frame|crafter's frame|reorin|maestro (holder|anvil lock|mold)|warsmith's (holder|mold)|craftsman mold)$/i;
const treeCat = r => r.cat || (BASIC_RES.test(String(r.name || '').trim()) ? 'Ресурсы' : 'Прочее');
const treePath = (kind, r) => kind === 'farm' ? String(treeCat(r)).split(/\s*›\s*/) : [r.grade || 'Без грейда', r.group || 'Прочее'];
const TREE_ORDER = ['Ресурсы', 'Кейматы', 'Шмот с РБ'];          // как на странице «Фарм ресурсов»; остальное — по алфавиту, «Прочее» в конце
const treeRank = p => { const i = TREE_ORDER.findIndex(x => p.replace(/^[^\p{L}]+/u, '').startsWith(x)); return i >= 0 ? i : p === 'Прочее' ? 99 : 50; };
// иконка: путь игры из базы (content.farmIconOf), у базовых ресурсов без неё — /icons/resources/basic/<имя>.jpg (так их рисует журнал боя)
const treeIcon = (kind, r) => {
  let s = kind === 'farm' ? String(r.icon || '') : '';
  if (!s && kind === 'farm' && treeCat(r) === 'Ресурсы') s = '/icons/resources/basic/' + String(r.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.jpg';
  return /^\/(?:icons|game\/item-icon|assets)\/[^\s"'<>]+$/.test(s) ? 'https://l2wap.com' + s : '';
};
const treeKey = (kind, n) => kind === 'farm' ? String(n || '').trim().toLowerCase() : String(n || '').toLowerCase().replace(/\s*\(\d+%\)\s*$/, '').trim();
function treeSources(kind, r, L, d) {
  const w = farmWinP(d, L), fit = l => !L || (l >= w.lo && l <= w.hi);   // 7.2.1: 🎯 — в предпочтительном диапазоне (−3…+5 ур.)
  const line = (tag, cls, txt, l) => `<div class="fs ${cls}"><b>${tag}</b> ${l != null && fit(l) && L ? '🎯 ' : ''}${esc(txt)}</div>`;
  const out = [];
  if (kind === 'farm') {
    for (const [m, l, c, a, b, , loc] of r.drop || []) out.push([l, line('ДРОП', 'drop', `${m} · ур. ${l} · ${c}% · ×${a}–${b} · ${loc || ''}`, l)]);
    for (const [m, l, c, a, b, , loc] of r.sp || []) out.push([l, line('СПОЙЛ', 'spoil', `${m} · ур. ${l} · ${c}% · ×${a}–${b} · ${loc || ''}`, l)]);
    for (const [n, l, c] of r.bosses || []) out.push([l, line('РБ', 'boss', `${n} · ур. ${l} · ${c}%`, l)]);
  } else {
    for (const [m, l, c, loc] of r.drop || []) out.push([l, line('ДРОП', 'drop', `${m} · ур. ${l} · ${c}% · ${loc || ''}`, l)]);
    for (const [m, l, c, loc] of r.spoil || []) out.push([l, line('СПОЙЛ', 'spoil', `${m} · ур. ${l} · ${c}% · ${loc || ''}`, l)]);
  }
  // подходящие по уровню — сверху
  out.sort((x, y) => (fit(y[0]) - fit(x[0])) || Math.abs(x[0] - L) - Math.abs(y[0] - L));
  return out.map(x => x[1]).join('') || '<div class="fs far">источников в базе нет</div>';
}
function treeRow(kind, k, r, cur, got, L, d) {
  const n = kind === 'farm' ? `дроп ${(r.drop || []).length}${(r.sp || []).length || r.spoil ? ` · спойл ${(r.sp || []).length || r.spoil}` : ''}${(r.bosses || []).length ? ` · РБ ${r.bosses.length}` : ''}`
    : `дроп ${(r.drop || []).length}${(r.spoil || []).length ? ` · спойл ${r.spoil.length}` : ''}`;
  const on = k === cur, open = treeOpen[kind].has('i:' + k);
  const ico = treeIcon(kind, r);
  return `<div class="frow${on ? ' cur' : ''}" data-k="${esc(k)}"><div class="fr-h">${ico ? `<img class="fr-ico" src="${esc(ico)}" alt="" loading="lazy" decoding="async">` : '<span class="fr-ico none"></span>'}<span class="fr-t"><button class="fr-name" data-tree-item="${esc(k)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(r.name)}</button>`
    + `<span class="fr-hint">${n}${on ? ` · ✓ цель${got ? ` · собрано ${got}` : ''}` : ''}</span></span>`
    + `<button class="fr-go" data-tree-go="${esc(k)}" title="${on ? 'Снять цель' : 'Фармить это'}">${on ? '✓' : '🌾'}</button></div>`
    + (open ? `<div class="fr-src">${treeSources(kind, r, L, d)}</div>` : '') + '</div>';
}
async function renderTree(kind, rt, d) {
  const T = TREE[kind], box = $(T.box); if (!box) return;
  const db = await dbGet(T.db, { [T.items]: {} }), all = db[T.items] || {}, keys = Object.keys(all);
  const q = ($(T.search)?.value || '').trim().toLowerCase(), cur = treeKey(kind, d[T.input]), L = rt.lvl || 0;
  const gotMap = kind === 'farm' ? rt.farmGot || {} : rt.recipeGot || {};
  const sig = [keys.length, db.t, q, cur, L, d.farmLvlBelow, d.farmLvlAbove, [...treeOpen[kind]].join('|'), gotMap[cur] || 0].join('#');
  if (treeSig[kind] === sig) return;
  treeSig[kind] = sig;
  if (!keys.length) { box.innerHTML = '<div class="hint">База пуста — нажмите «Обновить базу» ниже.</div>'; return; }
  if (q.length >= 2) {                                         // поиск — плоский список совпадений с путём раздела
    const hit = keys.filter(k => all[k].name?.toLowerCase().includes(q)).slice(0, 80);
    box.innerHTML = hit.length ? hit.map(k => `<div class="fpath">${esc(treePath(kind, all[k]).join(' › '))}</div>` + treeRow(kind, k, all[k], cur, gotMap[k], L, d)).join('')
      : '<div class="hint">Ничего не найдено</div>';
    return;
  }
  const tree = {};                                             // разделы → подразделы → предметы
  for (const k of keys) { let node = tree; for (const p of treePath(kind, all[k])) node = (node[p] ||= { _items: [] }); node._items.push(k); }
  const count = node => node._items.length + Object.entries(node).filter(([p]) => p !== '_items').reduce((s, [, v]) => s + count(v), 0);
  const html = (node, path) => Object.entries(node).filter(([p]) => p !== '_items').sort(([a], [b]) => (path ? 0 : treeRank(a) - treeRank(b)) || a.localeCompare(b)).map(([p, v]) => {
    const id = path + '›' + p, open = treeOpen[kind].has('g:' + id);
    return `<details class="fgrp" data-tree-grp="${esc(id)}"${open ? ' open' : ''}><summary>${esc(p)} <span class="fr-hint">${count(v)}</span></summary>`
      + (open ? html(v, id) + v._items.sort((a, b) => all[a].name.localeCompare(all[b].name)).map(k => treeRow(kind, k, all[k], cur, gotMap[k], L, d)).join('') : '') + '</details>';
  }).join('');
  box.innerHTML = (cur && all[cur] ? `<div class="fpath">Текущая цель</div>${treeRow(kind, cur, all[cur], cur, gotMap[cur], L, d)}` : '') + html(tree, '');
}
// 8.0 (аудит меню): всё, что читает большие базы (farmDb/recipeDb) и строит по ним списки, — только при открытой «Охоте».
// Раньше меню грузило farmDb (у Stem 1044 источника) при каждом открытии и перерисовке, даже на «Обзоре»
const huntOpen = () => !!document.getElementById('tab-hunt')?.classList.contains('act');
function renderHuntDb(rt, d) { renderRes(rt, d); renderFarm(rt, d); renderRecipes(rt, d); renderTree('farm', rt, d); renderTree('recipe', rt, d); }
document.addEventListener('l2:tabchange', async e => {
  if (e.detail?.tab !== 'hunt') return;
  const { rt = {}, cfg = {} } = await chrome.storage.local.get(['rt', 'cfg']);
  renderHuntDb(rt, { ...DEF, ...cfg });
});
async function treeRefresh(kind) { const { rt = {}, cfg = {} } = await chrome.storage.local.get(['rt', 'cfg']); treeSig[kind] = ''; await renderTree(kind, rt, { ...DEF, ...cfg }); }
for (const kind of Object.keys(TREE)) {
  const T = TREE[kind], box = $(T.box); if (!box) continue;
  // 8.0.5: картинки нет на сервере игры — пустое место той же ширины (строки не прыгают); inline onerror запрещён CSP
  box.addEventListener('error', e => { const i = e.target; if (i?.classList?.contains('fr-ico') && i.tagName === 'IMG') i.replaceWith(Object.assign(document.createElement('span'), { className: 'fr-ico none' })); }, true);
  box.addEventListener('toggle', e => { const g = e.target.closest?.('[data-tree-grp]'); if (!g) return; const id = 'g:' + g.dataset.treeGrp;
    if (g.open === treeOpen[kind].has(id)) return;              // перерисовка открытого раздела тоже шлёт «toggle» — это не клик
    if (g.open) treeOpen[kind].add(id); else treeOpen[kind].delete(id); treeRefresh(kind); }, true);
  box.addEventListener('click', async e => {
    const it = e.target.closest('[data-tree-item]'), go = e.target.closest('[data-tree-go]');
    if (it) { const id = 'i:' + it.dataset.treeItem; if (treeOpen[kind].has(id)) treeOpen[kind].delete(id); else treeOpen[kind].add(id); return treeRefresh(kind); }
    if (go) {
      const db = await dbGet(T.db, { [T.items]: {} }), r = db[T.items]?.[go.dataset.treeGo]; if (!r) return;
      // 9.2.6 (игрок 12.10: «не получается снять галочку / отменить фармимый ресурс»): ✓ у текущей цели снимает её —
      // раньше кнопка только ставила цель заново, отменить можно было лишь стерев поле «Ресурс» руками
      const off = go.dataset.treeGo === treeKey(kind, $(T.input).value);
      $(T.input).value = off ? '' : r.name; await save({ target: $(T.input) });
      toast?.(`${kind === 'farm' ? '🌾 Фарм ресурса' : '📜 Охота на рецепт'}${off ? ' снят' : ''}: ${r.name}`);
      treeRefresh(kind);
    }
  });
  $(T.search)?.addEventListener('input', () => treeRefresh(kind));
}
async function renderRecipes(rt, d) {
  if (!$('recipeBox')) return;
  const db = await dbGet('recipeDb', { rec: {} });
  const keys = Object.keys(db.rec || {});
  if (dlSig.recipe !== db) { dlSig.recipe = db; $('recipeResList').innerHTML = keys.map(k => `<option value="${String(db.rec[k].name ?? '').replace(/"/g, '&quot;')}">${(db.rec[k].grade + ' · ' + db.rec[k].group).replace(/</g, '&lt;')}</option>`).join(''); }
  const rk = n => String(n || '').toLowerCase().replace(/\s*\(\d+%\)\s*$/, '').trim();
  const k = rk(d.recipeRes), r = db.rec[k], L = rt.lvl || 0;
  let txt = keys.length ? `В базе рецептов: ${keys.length} (обновлено ${new Date(db.t).toLocaleString('ru')})` : 'База пуста — нажмите «Обновить базу рецептов» или откройте форум «Охота на рецепты».';
  if (k && !r) txt += `\n⚠ «${d.recipeRes}» нет в базе`;
  if (r) {
    const got = rt.recipeGot?.[k] || 0;
    const src = [...r.drop.map(x => [...x, 'дроп']), ...(d.recipeSpoil ? r.spoil.map(x => [...x, 'спойл']) : [])]
      .filter(([, l]) => !L || (l >= L - (d.lvlBelow ?? 3) - 7 && l <= L + Math.min(d.lvlAbove ?? 15, 15))).sort((a, b) => b[2] - a[2]);
    const cat = rt.zoneCat || {}, has = loc => Object.values(cat).some(c => (c.name || '').toLowerCase() === loc.toLowerCase() || ((c.name || '').length > 4 && (loc.toLowerCase().includes((c.name || '').toLowerCase()) || (c.name || '').toLowerCase().includes(loc.toLowerCase()))));
    txt += `\n${r.name} (${r.grade}, ${r.group}) · дроп ${r.drop.length}, спойл ${r.spoil.length}${d.recipeSpoil ? '' : ' — не наш'} · выбито ${got}${d.recipeNeed ? '/' + d.recipeNeed : ''}`
      + (src.length ? src.slice(0, 4).map((x, i) => `\n${i ? '  ' : '➤ '}${x[3]}${has(x[3]) ? '' : ' (нет в «Телепорте»)'}: ${x[0]} ${x[1]} ур. · ${x[2]}% · ${x[4]}`).join('')
        : `\nДля ${L} ур. подходящих источников нет${!d.recipeSpoil && r.spoil.length ? ' (есть спойл — отметьте «есть спойл», если вы гном)' : ''}`);
  }
  $('recipeBox').textContent = txt;
}
$('recipeScan').onclick = async () => {
  const { rt = {}, on = false } = await chrome.storage.local.get(['rt', 'on']);
  await menuPatch({ recipeScan: true });
  $('recipeBox').textContent = on ? '⏳ Бот откроет «Охоту на рецепты» после текущего боя' : '⏳ База обновится после ▶ Старт (или откройте форум «Охота на рецепты» сами)';
};
$('recipeReset').onclick = async () => {
  const { rt = {}, cfg = {} } = await chrome.storage.local.get(['rt', 'cfg']);
  const k = String(cfg.recipeRes || '').toLowerCase().replace(/\s*\(\d+%\)\s*$/, '').trim();
  await menuPatch({ recipeGot: { ...(rt.recipeGot || {}), [k]: 0 } });
  toast?.('↺ Счётчик рецепта обнулён');
};
// 7.2.1: предпочтительный диапазон уровней мобов-источников (как в боте: farmWin/farmFit в content.js)
const farmWinP = (d, L) => ({ lo: L - (d.farmLvlBelow ?? 3), hi: L + (d.farmLvlAbove ?? 5) });
function farmFitP(d, l, L) { const w = farmWinP(d, L); return l >= w.lo && l <= w.hi ? 1 : l < w.lo ? Math.max(0.15, 1 - (w.lo - l) * 0.12) : Math.max(0.1, 1 - (l - w.hi) * 0.18); }
async function renderFarm(rt, d) {
  const db = await dbGet('farmDb', { res: {} });
  const keys = Object.keys(db.res || {});
  if (dlSig.farm !== db) { dlSig.farm = db; $('farmResList').innerHTML = keys.map(k => `<option value="${String(db.res[k].name ?? '').replace(/"/g, '&quot;')}">${(db.res[k].cat || '').replace(/</g, '&lt;')}</option>`).join(''); }
  const L = rt.lvl || 0, k = (d.farmRes || '').trim().toLowerCase(), r = db.res[k];
  let txt = keys.length ? `В базе ресурсов: ${keys.length} (обновлено ${new Date(db.t).toLocaleString('ru')})` : 'База пуста — нажмите «Обновить базу ресурсов» (бот откроет форум и раскроет строки по одной).';
  if (k && !r) txt += `\n⚠ «${d.farmRes}» нет в базе`;
  if (r?.bosses?.length) txt += `\n${r.name}: падает с РБ — ${r.bosses.slice(0, 6).map(([n, l, c]) => `${n} ${l} ур. ${c}%`).join(' · ')}${r.drop?.length ? '' : ' (бот полетит к живому РБ из списка, если включён «👑 РБ между мобами»)'}`;
  if (r && L) {
    const above = d.lvlAbove ?? 30, w = farmWinP(d, L), fit = l => farmFitP(d, l, L);   // 7.2.1: тот же диапазон −3…+5, что у бота
    const by = {};
    for (const [mob, lvl, ch, a, b, tp, loc] of r.drop) {
      if (lvl > Math.max(L + above, w.hi) || lvl < Math.min(L - 10, w.lo)) continue;
      const e = ch / 100 * (a + b) / 2, z = (by[tp] ||= { loc, mobs: {} });
      if (!z.mobs[mob] || z.mobs[mob].e < e) z.mobs[mob] = { lvl, e, ch };
    }
    for (const z of Object.values(by)) { const m = Object.values(z.mobs); z.e = m.reduce((s, x) => s + x.e, 0) / m.length; z.score = m.reduce((s, x) => s + x.e * fit(x.lvl), 0) / m.length * (1 + 0.1 * Math.min(m.length, 5)); z.inWin = m.some(x => x.lvl >= w.lo && x.lvl <= w.hi); }
    const top = Object.entries(by).sort((x, y) => (y[1].inWin - x[1].inWin) || y[1].score - x[1].score).slice(0, 3);
    const got = rt.farmGot?.[k] || 0;
    txt += `\n${r.name}: источников дропа ${r.drop.length} (спойл ${r.spoil} — не наш) · собрано ${got}${d.farmNeed ? '/' + d.farmNeed : ''}`
      + (top.length ? top.map(([tp, z], i) => `\n${i ? '  ' : '➤ '}${z.loc}${tp === rt.zone ? ' 📍' : ''}: ≈${z.e.toFixed(2)} шт./бой — ${Object.entries(z.mobs).sort((a, b) => b[1].e - a[1].e).slice(0, 3).map(([n, m]) => `${n} ${m.lvl} ур. ${m.ch}%`).join(', ')}`).join('')
        : `\nДля ${L} ур. подходящих мобов нет (окно ${L - 10}…${L + (d.lvlAbove ?? 30)})`);
  }
  $('farmBox').textContent = txt;
}

// локации для кача: EXP/ч и %/ч по зонам для текущего уровня героя, подходящие неизученные, кнопка «Лететь»
function zoneRateP(rt, id, L) {
  const z = rt.zoneStat?.[id] || {};
  for (const dd of [0, -1, 1, -2, 2]) {
    const e = z[L + dd];
    if (e && e.n >= 5) return { n: e.n, exp: e.exp / e.sec * 3600, pct: e.pn ? e.pct / e.sec * 3600 * (e.n / e.pn) : null, near: dd !== 0 ? L + dd : 0 };
  }
  return z[L] ? { n: z[L].n, few: true } : null;
}
function renderZones(rt, d) {
  const box = $('zoneBox');
  if (!box) return;
  const h = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const L = rt.lvl || 0, cat = { ...(rt.zoneCat || {}) }, S = rt.zoneStat || {};
  const name = id => cat[id]?.name || String(id).replace(/^out:/, 'Окрестности: ');
  // v4.59: желаемое окно уровней мобов (от героя −lvlBelow до +lvlAbove, по умолчанию −3…+15) — зона подходит, если её мобы в него попадают
  const wLo = L - (d.lvlBelow ?? 3), wHi = L + Math.min(d.lvlAbove ?? 15, 15), wMid = (wLo + wHi) / 2;
  if ($('lvlWin')) $('lvlWin').textContent = L ? `Герой ${L} ур. → бьёт мобов ${(d.lvlAbove ?? 99) >= 99 ? `от ${Math.max(1, wLo)} ур. и выше (без верхнего предела; слишком сильных — бой > 45 с — сам пропускает на 2 ч)` : `${Math.max(1, wLo)}–${L + (d.lvlAbove ?? 15)} ур.`} · зону для кача выбирает до ${wHi} ур.` : '';
  const fits = id => { const c = cat[id]; return !!c?.lo && L && c.lo <= wHi && c.hi >= wLo; };
  // насколько зона «в окне»: доля её диапазона внутри окна, затем близость середины к середине окна
  const inWin = c => c?.lo ? (Math.min(c.hi, wHi) - Math.max(c.lo, wLo) + 1) / (c.hi - c.lo + 1) : 0;
  // 9.0: прогноз КПД по встроенной базе (тот же расчёт, что у автофарма, без поправки на свои замеры зон) + зоны из базы
  const K = globalThis.L2Kpd, ko = K?.ready?.() && L ? { rt, cfg: d, mage: heroCls(d, rt) !== 'fighter' } : null;
  if (ko) { ko.cal = K.learn(ko, L); for (const [id, c] of Object.entries(K.cat())) cat[id] = { ...c, ...(cat[id] || {}), lo: cat[id]?.lo || c.lo, hi: cat[id]?.hi || c.hi }; }
  const est = {}, estOf = id => est[id] !== undefined ? est[id] : (est[id] = ko ? K.zoneEst(id, L, ko) : null);
  const ids = [...new Set([...Object.keys(S), ...Object.keys(cat).filter(fits)])];
  if (!ids.length) { box.innerHTML = `<div class="hint">Пока нет данных — бот считает опыт в каждой зоне, где охотится.${Object.keys(cat).length ? '' : ' Нажмите «Обновить список зон», чтобы узнать уровни мобов всех Окрестностей.'}</div>`; return; }
  const rows = ids.map(id => ({ id, r: L ? zoneRateP(rt, id, L) : null, c: cat[id] || {}, e: estOf(id) }))
    .sort((a, b) => (b.r?.exp || 0) - (a.r?.exp || 0) || (b.e?.exp || 0) - (a.e?.exp || 0) || (fits(b.id) - fits(a.id)) || (inWin(b.c) - inWin(a.c)) || (Math.abs((a.c.lo + a.c.hi) / 2 - wMid) - Math.abs((b.c.lo + b.c.hi) / 2 - wMid)));
  const best = rows.find(x => x.r?.exp);
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(1) + ' М' : n >= 1e3 ? Math.round(n / 1e3) + ' К' : Math.round(n);
  box.innerHTML = `<table><tr><th>Зона</th><th>Мобы</th><th>EXP/ч</th><th title="Прогноз по базе игры (КПД)">КПД</th><th>%/ч</th><th>Боёв</th><th></th></tr>`
    + rows.slice(0, 14).map(x => `<tr class="${x.id === rt.zone ? 'cur' : ''} ${best && x.id === best.id ? 'best' : ''}">`
      + `<td>${x.id === rt.zone ? '📍 ' : ''}${h(name(x.id))}</td><td>${x.c.lo ? `${x.c.lo}-${x.c.hi}` : '—'}</td>`
      + `<td>${x.r?.exp ? k(x.r.exp) + (x.r.near ? '*' : '') : x.r?.few ? '…' : fits(x.id) ? '?' : '—'}</td>`
      + `<td title="${h(x.e?.why || '')}">${x.e?.exp ? '≈' + k(x.e.exp) : x.e ? '0' : '—'}</td><td>${x.r?.pct != null ? x.r.pct.toFixed(1) : '—'}</td>`
      + `<td>${x.r?.n || Object.values(S[x.id] || {}).reduce((a, e) => a + e.n, 0) || ''}</td>`
      + `<td>${x.id !== rt.zone && !/^out:/.test(x.id) ? `<button data-zone="${h(x.id)}" title="Лететь (телепорт ${x.c.price ? x.c.price.toLocaleString('ru') + ' аден' : ''})">✈</button>` : ''}</td></tr>`).join('')
    + '</table>';
  const fresh = rows.filter(x => fits(x.id) && !x.r?.exp).map(x => `${name(x.id)} (${x.c.lo}-${x.c.hi})`);
  const cur = rows.find(x => x.id === rt.zone);
  box.innerHTML += `<div class="rec">${L ? `Герой ${L} ур.` : ''}${best ? ` · лучшая: ${h(name(best.id))} — ${k(best.r.exp)} EXP/ч${best.r.pct != null ? `, ${best.r.pct.toFixed(1)} %/ч (≈${100 / best.r.pct < 1 ? Math.round(6000 / best.r.pct) + ' мин' : (100 / best.r.pct).toFixed(1) + ' ч'} на уровень)` : ''}` : ''}`
    + `${cur?.r?.exp && best && best.id !== cur.id ? `\nТекущая: ${k(cur.r.exp)} EXP/ч — ${Math.round((1 - cur.r.exp / best.r.exp) * 100)} % хуже лучшей` : ''}`
    + `${fresh.length ? `\n🔍 Не изучены, но по уровню подходят: ${h(fresh.slice(0, 5).join(', '))}` : ''}`
    + `${ko ? (b => b ? `\n📈 По базе игры лучше всех для ${L} ур.: ${h(name(b.id))} — ≈${k(b.exp)} EXP/ч (${h(b.why.replace(/^по базе: /, ''))})` : '')(K.rank(L, ko)[0]) : ''}`
    + `\n<span class="hint">* — по соседнему уровню героя · «…» — меньше 5 боёв · «?» — не охотился · КПД — прогноз по базе игры (наведите — какие мобы)</span></div>`;
  renderRoute(ko, L, name);
}
// 9.0: маршрут кача 1→80 по базе игры — какая зона лучше на каждом отрезке уровней (без своих замеров; свой уровень отмечен 📍)
let routeSig = '';
function renderRoute(ko, L, name) {
  const box = $('routeBox'), K = globalThis.L2Kpd;
  if (!box || !K?.ready?.()) return;
  const o = ko || { rt: {}, cfg: {}, mage: true }, sig = [L, o.mage, o.cfg?.lvlBelow, o.cfg?.zoneAbove].join('|');
  if (sig === routeSig) return; routeSig = sig;
  const h = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'), k = n => n >= 1e6 ? (n / 1e6).toFixed(1) + ' М' : Math.round(n / 1e3) + ' К';
  box.innerHTML = '<table><tr><th>Уровни</th><th>Зона</th><th>Мобы</th><th>КПД</th><th>Телепорт</th></tr>'
    + K.route(o, 1, 80).map(x => `<tr class="${L >= x.from && L <= x.to ? 'cur' : ''}"><td>${L >= x.from && L <= x.to ? '📍 ' : ''}${x.from}${x.to > x.from ? '–' + x.to : ''}</td>`
      + `<td>${x.id ? h(name(x.id) || x.name) : '—'}</td><td>${x.mobs || ''}</td><td>${x.exp ? '≈' + k(x.exp) + (k(x.expTo) !== k(x.exp) ? '…' + k(x.expTo) : '') : ''}</td><td>${x.price ? x.price.toLocaleString('ru') : ''}</td></tr>`).join('')
    + '</table><div class="hint">Прогноз EXP/ч — для героя с «типичным» временем на моба (≈5 с); настоящие цифры бот меряет сам и по ним уточняет выбор. Мобы-«стражи» без цифр в базе считаются со скидкой.</div>';
}

// 💎 баффы за Fast Aden: выбор из списка «+», порядок ▲▼, ✕; баланс и стоимость круга
// 7.2.1 (снимок баффера 10.10 22:27): Greater — по 5 FA, обычные — 1 FA, всё на 3 ч; номера Prophecy были перепутаны (1357 — Water, 1355 — Wind)
const FA_KNOWN = { 1363: ['Chant of Victory', 5], 1356: ['Prophecy of Fire', 5], 1357: ['Prophecy of Water', 5], 1355: ['Prophecy of Wind', 5], 1413: ["Magnus' Chant", 5], 1414: ["Victories of Pa'agrio", 5], 1323: ['Noblesse Blessing', 5],
  4703: ['Дар Серафима (откат −30 %)', 1], 273: ['Dance of Mystic', 1], 365: ['Dance of Siren', 1], 1303: ['Wild Magic', 1], 264: ['Song of Earth', 1], 267: ['Song of Warding', 1], 1389: ['Великий щит', 1], 1059: ['M.Atk ↑', 1], 1085: ['Cast.Spd ↑', 1], 276: ['Dance of Concentration', 1] };
const faIds = () => ($('faBuffs').value || '').split(/[,\s]+/).map(x => +x).filter(x => x > 0);
const faSet = async ids => { $('faBuffs').value = [...new Set(ids)].join(', '); await save({ target: $('faBuffs') }); };
function faInfo(rt, id) { const c = rt.faCat?.[id]; return { name: c?.name || FA_KNOWN[id]?.[0] || 'skill ' + id, cost: c?.cost || FA_KNOWN[id]?.[1] || 1, known: !!c } }
// 7.2.1: 🔥 РБ-сессия с баффом за FA — состав, цена, баланс, ход сессии
// 8.0.3 (эпики, разбор 11.10): состояние режима + таблица эпиков (жив / мёртв до ~ЧЧ:ММ, по силам или нет и почему, как туда попасть
// и сколько это стоит) + строка «Coin of Luck: лимит 0 — не тратить». Данные — rt.epicDb / rt.epicApi (ответ игры /game/epic-bosses)
function renderEpics(rt, d) {
  const E = rt.epic || {}, db = rt.epicDb || {}, A = rt.epicApi || {}, now = Date.now();
  const EP = [['ak', 'Королева Муравьёв', 40], ['core', 'Ядро', 50], ['orfen', 'Орфен', 50], ['zaken', 'Закен', 60], ['baium', 'Баюм', 75], ['antharas', 'Антарас', 79], ['valakas', 'Валакас', 85], ['frintezza', 'Фринтеза', 90]];
  const LAIR = { ak: 'ant_nest', core: 'cruma_tower', orfen: 'sea_of_spores', baium: 'tower_of_insolence', antharas: 'antharas_lair', zaken: 'devils_isle' };
  const ST = { pick: 'выбор цели', prep: 'банки, бафф, хил', go: 'дорога', arrive: 'ищу на карте', fight: 'бой', retreatVerify: 'выход из боя' };
  const hm = t => { if (!(t > 0)) return '?'; const x = new Date(t), s = String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0');
    return Math.abs(t - now) > 20 * 3600000 ? `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')} ${s}` : s; };
  const e = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const L = E.hpLog || [], last = L[L.length - 1];
  $('epicBox').textContent = (d.epicMode ? '▶ Идёт' : '■ Выключено') + (E.step ? ' · ' + (ST[E.step] || E.step) : '') + (E.name && E.step !== 'pick' ? `: ${E.name}` : '')
    + (E.deaths ? ` · смертей ${E.deaths}` : '') + (last?.max ? ` · у него ${Math.round(last.cur / last.max * 1000) / 10} %` : '') + (E.last ? `\n${E.last}` : '');
  const lim = Math.max(0, Math.floor(+(d.epicCoinDailyMax ?? 0) || 0)), per = Math.max(0, Math.floor(+(d.epicCoinPerBoss ?? 1) || 0));
  const recs = (rt.epicTpBudget || []).filter(x => x && x.t > now - 86400000), usedC = recs.filter(x => x.unit === 'Coin of Luck').reduce((a, x) => a + (+x.cost || 0), 0);
  const now1 = x => x.alive === true ? '✅ жив' : x.alive === false ? (u => !u ? '💀 мёртв' : u.exact || !u.lo ? `💀 до ~${hm(u.hi)}` : `окно ${hm(u.lo)}–${hm(u.hi)}`)(x.until) : '❔';
  const fit = x => { const v = x.verdict || {};
    if (x.canAttack === false || v.v === 'level') return ['⛔ игра не пускает', x.deny || v.why];
    return ({ strong: [`❌ спецудар ${v.spPct || '?'} %`, v.why], pots: ['⚠ банки', v.why], slow: ['⏳ долго', v.why], ok: ['✅', v.why] })[v.v] || ['❔ нет цифр', v.why || 'нажмите «Проверить эпиков»']; };
  const way = (k, x) => {
    if (x.seenZone && x.seenZone === rt.zone) return 'рядом — бесплатно';
    if (x.col === 0 && x.adena === 0 && x.vipFree) return 'VIP — бесплатно';
    // 8.0.3 (ревью): валюта логова из «Телепорта» — не адена (Coin of Luck и т. п.) показываем и не берём
    const lair = x.seenZone || LAIR[k], zc = lair && rt.zoneCat?.[lair], zcCol = zc && +zc.price > 0 && zc.curT != null && zc.cur !== 'аден';
    const lz = zc && !(x.lairBadT > now - 6 * 3600000) ? (zcCol ? `логово ${(+zc.price).toLocaleString('ru')} ${zc.curT || '(валюта?)'} — не адена, не беру` : `логово ≈${(+zc.price || 0).toLocaleString('ru')} аден`) : '';
    const col = x.col > 0 ? (!lim ? `${x.col} CoL — запрещено (лимит 0)` : (x.paidN || 0) >= per ? `${x.col} CoL — уже ${x.paidN} за появление` : `${x.col} CoL (за 24 ч ${usedC}/${lim})`)
      : x.adena > 0 ? `${x.adena.toLocaleString('ru')} аден` : x.col === 0 ? 'бесплатно' : '';
    return [lz, col].filter(Boolean).join(' / ') || '❔'; };
  const rows = EP.map(([k, nm, lv]) => { const x = db[k] || {}, f = fit(x);
    return `<tr${E.k === k && E.step !== 'pick' ? ' class="cur"' : ''}><td>${e(nm)} (${x.lvl || lv})${x.skipT > now ? `<br><small>⏸ до ${hm(x.skipT)}: ${e(String(x.why || '').slice(0, 80))}</small>` : ''}</td>`
      + `<td>${e(now1(x))}</td><td title="${e(f[1] || '')}">${e(f[0])}</td><td>${e(way(k, x))}</td></tr>`; }).join('');
  $('epicTable').innerHTML = Object.keys(db).length ? `<table><tr><th>Эпик (ур.)</th><th>Сейчас</th><th>По силам?</th><th>Вход</th></tr>${rows}</table>`
    : '<div class="hint">Пока пусто — нажмите «🔄 Проверить эпиков» (бот должен быть запущен)</div>';
  $('epicSum').textContent = `Coin of Luck: ${lim ? `лимит ${lim} за 24 ч, не больше ${per} на появление эпика` : 'лимит 0 — не тратить'} · за 24 ч ${usedC}`
    + (rt.colBal?.t ? ` · баланс ${rt.colBal.v} (${hm(rt.colBal.t)})` : '')
    + (A.t ? ` · список с сервера ${hm(A.t)}${A.minLvl ? `, мин. уровень босса ${A.minLvl}` : ''}` : ' · список с сервера ещё не читали')
    + (rt.epicScanReq ? ' · ⏳ проверка запрошена' : rt.epicScanT ? ` · проверка ${hm(rt.epicScanT)}` : '');
}
function renderRbSess(rt, d) {
  if (!$('rbSessBox')) return;
  // 9.2.5: «auto» — фулл бафф под класс (fa-full.js), с причиной каждого баффа; пары, что снимают друг друга (rt.faClash), — без второго
  const F = globalThis.L2FaFull, role = heroRole(rt), auto = !F || F.isAuto(d.rbSessBuffs);
  const raw = F ? F.resolve(d.rbSessBuffs, role) : String(d.rbSessBuffs || '').split(/[,\s]+/).map(Number).filter(x => x > 0);
  const ids = F ? F.dropClash(raw, rt.faClash) : raw, S = rt.rbSess, now = Date.now();
  const sum = ids.reduce((a, id) => a + faInfo(rt, id).cost, 0), bal = rt.faBal?.v;
  const why = F && auto ? Object.fromEntries(F.SETS[F.kind(role)].map(([id, , t]) => [id, t])) : {};
  const L = [auto && F ? `⚡ Фулл бафф под класс (${F.kind(role) === 'mage' ? 'маг' : 'воин'}${role ? '' : ', класс ещё не известен'}):` : 'Баффы (свой список):',
    ...ids.map(id => `• ${why[id] || faInfo(rt, id).name} · ${faInfo(rt, id).cost} FA`),
    ...raw.filter(id => !ids.includes(id)).map(id => `✕ ${faInfo(rt, id).name} — снимает другой бафф из списка, не беру`),
    `Стоимость: ${sum} FA на 3 ч${bal != null ? ` · баланс ${bal} FA${bal < sum ? ' ⚠ не хватает' : ` (хватит на ${Math.floor(bal / Math.max(1, sum))})`}` : ' · баланс FA ещё не видел'}`];
  if (S?.on && !S.bought) L.push('⏳ Сессия начинается: иду к бафферу за баффами');
  else if (S?.on) { const left = Math.max(0, S.until - now) / 60000, k = (rt.rbKills || 0) - (S.k0 || 0), e = (rt.exp || 0) - (S.e0 || 0);
    L.push(`🔥 Идёт: осталось ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} · РБ убито ${k} · EXP +${e.toLocaleString('ru')}`); }
  else if (S?.sum) L.push(`Прошлая сессия: ${S.sum.min} мин · РБ ${S.sum.kills} · EXP +${(S.sum.exp || 0).toLocaleString('ru')} · аден ${(S.sum.adena || 0).toLocaleString('ru')}${S.sum.deaths ? ` · смертей ${S.sum.deaths}` : ''} — ${S.sum.why}`);
  $('rbSessBox').textContent = L.join('\n');
  $('rbSessStart').disabled = !!S?.on; $('rbSessStop').disabled = !S?.on;
}
function renderFa(rt, d) {
  if (!$('faList')) return;
  const ids = (d.faBuffs || '').split(/[,\s]+/).map(x => +x).filter(x => x > 0);
  if (document.activeElement !== $('faBuffs')) $('faBuffs').value = ids.join(', ');
  const all = [...new Set([...Object.keys(rt.faCat || {}), ...Object.keys(FA_KNOWN)].map(Number))].filter(id => !ids.includes(id))
    .sort((a, b) => faInfo(rt, a).name.localeCompare(faInfo(rt, b).name));
  if (document.activeElement !== $('faPick')) $('faPick').innerHTML = all.length ? all.map(id => { const f = faInfo(rt, id); return `<option value="${id}">${esc(f.name)} · ${f.cost} FA</option>`; }).join('') : '<option value="">— все уже в списке —</option>';
  const gone = rt.faGone || {}, now = Date.now();
  $('faList').innerHTML = ids.length ? ids.map((id, i) => { const f = faInfo(rt, id), g = now - (gone[id] || 0) < 6 * 3600000;
    return `<div class="rule${g ? ' neg' : ''}"><span class="n">${i + 1}</span><span class="t">${esc(f.name)} <span style="color:var(--mute)">· ${f.cost} FA${g ? ' · нет у баффера' : ''}</span></span>`
      + `<button data-fa-up="${i}" title="Выше">▲</button><button data-fa-dn="${i}" title="Ниже">▼</button><button data-fa-del="${i}" title="Убрать">✕</button></div>`; }).join('')
    : '<div class="hint">Пусто — баффы за Fast Aden не берутся.</div>';
  const sum = ids.reduce((a, id) => a + faInfo(rt, id).cost, 0), bal = rt.faBal;
  const lines = [];
  if (ids.length) lines.push(`За один круг: ${sum} FA (на 3 ч)`);
  if (bal) lines.push(`Баланс: ${bal.v} FA (видел ${new Date(bal.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })})${ids.length ? ` → хватит на ${Math.floor(bal.v / Math.max(1, sum))} кр.` : ''}`);
  else if (ids.length) lines.push('Баланс FA ещё не видел — нажмите «Обновить список и баланс FA»');
  if (bal && ids.length && bal.v < sum) lines.push(`⚠ На полный круг не хватает ${sum - bal.v} FA — бот возьмёт по порядку то, что по карману`);
  if (rt.faSkipUntil && now < rt.faSkipUntil) lines.push(`⏸ FA не хватило ни на один бафф — к бафферу FA не хожу до ${new Date(rt.faSkipUntil).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} (или пока баланс не вырастет)`);
  $('faNote').textContent = lines.join('\n');
}
$('faAdd').onclick = async () => { const v = +$('faPick').value; if (v) { await faSet([...faIds(), v]); toast?.('✓ Бафф добавлен'); } };
$('faList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const ids = faIds();
  if (b.dataset.faDel != null) ids.splice(+b.dataset.faDel, 1);
  else if (b.dataset.faUp != null && +b.dataset.faUp > 0) { const i = +b.dataset.faUp; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; }
  else if (b.dataset.faDn != null && +b.dataset.faDn < ids.length - 1) { const i = +b.dataset.faDn; [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; }
  else return;
  await faSet(ids);
});
$('faScanBtn').onclick = async () => {
  const { rt = {}, on = false } = await chrome.storage.local.get(['rt', 'on']);
  await menuPatch({ faScan: true });
  $('faNote').textContent = on ? '⏳ Бот откроет баффер Fast Aden после текущего боя' : '⏳ Список обновится после ▶ Старт (или откройте баффер Fast Aden сами — бот перепишет его)';
};

// 🧪 зелья: что лечит, сколько в сумке, общий запас (для оценки РБ резерв не тратится)
function renderPots(rt, d) {
  const P = Object.values(rt.pots || {}), h = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (!P.length) return;
  const rows = P.sort((a, b) => (a.kind || '').localeCompare(b.kind || '') || (b.heal || 0) - (a.heal || 0));
  const pool = k => rows.filter(x => x.kind === k && x.heal).reduce((a, x) => a + Math.max(0, (x.n || 0) - (k === 'hp' ? d.rbPotReserve || 0 : 0)) * x.heal, 0);
  $('potBox').innerHTML = `<table><tr><th>Банка</th><th></th><th>Лечит</th><th>В сумке</th><th>Запас</th></tr>`
    + rows.map(x => `<tr><td>${h(x.name)}</td><td>${(x.kind || '?').toUpperCase()}</td><td>${x.heal ? fmt(x.heal) + (x.pulses > 1 ? ` (${x.pulses}×)` : '') : '<span title="ещё не пил">?</span>'}</td>`
      + `<td>${x.n != null ? fmt(x.n) : '?'}</td><td>${x.heal && x.n ? fmt(x.heal * x.n) : '—'}</td></tr>`).join('') + '</table>'
    + `<div class="rec">Запас лечения HP для РБ: ≈${fmt(pool('hp'))} (без резерва ${d.rbPotReserve || 0} шт. каждой) · MP: ≈${fmt(pool('mp'))}</div>`;
}

// эффективность: EXP/мин по способу поиска целей (время на карту и листание входит) + добыча
function renderEff(rt) {
  const box = $('effBox');
  if (!box) return;
  const E = rt.eff || {}, c = E.chain, m = E.map;
  const line = (t, e) => e ? `${t}: ${fmt(e.rate)} EXP/мин · ≈${e.sec} с на моба · боёв ${e.n}` : `${t}: ещё нет данных`;
  const verdict = c && m && c.n >= 5 && m.n >= 5
    ? (c.rate > m.rate * 1.1 ? '→ цепочка выгоднее карты (чемпионов ищу, если включена галочка «Искать чемпионов»)' : '→ поиск по карте окупается')
    : '→ нужно ≥5 боёв каждым способом для вывода';
  const top = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
  const special = top(rt.lootSpecial), loot = top(rt.loot).slice(0, 12);
  const valueLine = rt.lootValue ? `\n💰 Добыча при продаже в магазин ≈ ${fmt(rt.lootValue)} аден (цены Interlude ÷ 2)` : '';
  box.textContent = `${line('🔁 Цепочка', c)}\n${line('🗺 Через карту', m)}\n${verdict}`;
  if ($('lootExtra')) $('lootExtra').textContent = (special.length ? `⭐ Особая: ${special.map(([k, v]) => `${k} ×${v}`).join(', ')}` : '⭐ Особой добычи пока нет')
    + (loot.length ? `\n🎒 За сессию: ${loot.map(([k, v]) => `${k} ×${fmt(v)}`).join(', ')}` : '') + valueLine;
}

// темп: EXP в час по замерам «цепочка / карта» (взвешено по числу боёв)
function expHour(rt) {
  const E = rt.eff || {}, parts = ['chain', 'map'].map(k => E[k]).filter(x => x?.n && x.rate);
  if (!parts.length) return '';
  const n = parts.reduce((a, x) => a + x.n, 0), perMin = parts.reduce((a, x) => a + x.rate * x.n, 0) / n;
  const h = perMin * 60;
  return ` · ≈${h >= 1e6 ? (h / 1e6).toFixed(1).replace('.', ',') + ' млн' : fmt(Math.round(h / 1000)) + ' тыс.'} EXP/ч`;
}
// надёжность: сбои и перезагрузки сторожем за последние 20 мин (строка видна, только если что-то было)
function healthLine(rt, wdog) {
  const now = Date.now(), e = (rt.errs || []).filter(t => now - t < 600000).length, w = (wdog || []).filter(t => now - t < 1200000).length;
  return e || w ? `\n🛡 ${e ? `сбоев за 10 мин: ${e} (бот продолжает)` : ''}${e && w ? ' · ' : ''}${w ? `сторож перезагрузил вкладку: ${w}` : ''}` : '';
}

// ==== 8.0 (аудит меню): сводка «Обзора» — чистые функции (тест v80-ui.test.js) ====
// Сессия — с нажатия ↺ (rt.sessT0). Нет отметки — «в час» не считаем (показываем итоги): иначе делили бы на неизвестное время
const fmtBig = n => { n = Math.round(+n || 0); const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace('.', ',') + ' млн' : a >= 1e4 ? Math.round(n / 1e3) + ' тыс.' : n.toLocaleString('ru'); };
const fmtDur = ms => { const m = Math.max(0, Math.round((+ms || 0) / 60000)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`; };
function sessInfo(rt, now = Date.now()) {
  const t0 = +rt?.sessT0 || 0, ms = t0 && now > t0 ? now - t0 : 0, h = ms / 3600000;
  const per = v => h >= 1 / 30 ? (+v || 0) / h : null;          // первые 2 мин темп скачет — не показываем
  return { t0, ms, h, exp: per(rt?.exp), adena: per(rt?.adena), kills: per(rt?.kills) };
}
// рыбалка: рыб/ч — как в «Рыбалке» (fishSessLine), Proof на рыбу — по обменам (fishProofGain/fishProofFish), иначе по разделке (fishVal)
function fishRate(rt, now = Date.now()) {
  const S = rt?.fishSess; if (!S?.n) return null;
  const perH = S.n / (Math.max(1, (S.last || now) - S.t0) / 3600000);
  const V = Object.values(rt.fishVal || {}), vn = V.reduce((a, v) => a + (+v.n || 0), 0);
  const perFish = rt.fishProofFish ? (rt.fishProofGain || 0) / rt.fishProofFish : vn ? V.reduce((a, v) => a + (+v.proof || 0), 0) / vn : 0;
  return { n: S.n, perH, perFish, proofH: perFish ? perH * perFish : null, fresh: now - (S.last || 0) < 15 * 60000 };
}
// запасы: банки — по панели боя (rt.pots, обновляется в начале боя), заряды — по сумке (rt.bagAll) под роль «Соски»
function suppliesOf(rt, d) {
  const P = Object.values(rt?.pots || {}).filter(x => x && x.n != null);
  const of = k => P.filter(x => x.kind === k), sum = k => of(k).length ? of(k).reduce((a, x) => a + (+x.n || 0), 0) : null;
  const names = String(d?.nShots || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const hit = Object.entries(rt?.bagAll?.n || {}).filter(([k]) => names.some(n => k.toLowerCase().startsWith(n)));
  const min = v => +(String(v || '').match(/^\s*(\d+)\s*\//)?.[1] || 0);
  return { hp: sum('hp'), mp: sum('mp'), potT: Math.max(0, ...P.map(x => +x.t || 0)),
    shots: hit.length ? hit.reduce((a, [, v]) => a + (+v || 0), 0) : null, shotsT: hit.length ? +rt.bagAll.t || 0 : 0,
    hpMin: min(d?.shopHp), mpMin: min(d?.shopMp), shotsMin: min(d?.shopShots) };
}
// тур по РБ: одинаковые причины пропуска — одной строкой со счётом
function skipGroups(list, max = 4) {
  const G = new Map();
  for (const x of list) { const g = G.get(x.why) || []; g.push(x); G.set(x.why, g); }
  return [...G].slice(0, 8).map(([why, xs]) => xs.length === 1 ? `• ${xs[0].name} ${xs[0].lvl} — ${why}`
    : `• ${why} (${xs.length}): ${xs.slice(0, max).map(x => `${x.name} ${x.lvl}`).join(', ')}${xs.length > max ? ` … ещё ${xs.length - max}` : ''}`);
}
function rbLineOf(rt, d, now = Date.now()) {
  const H = rt?.rbHunt || {}, tour = !!d?.rbHuntMode, sess = rt?.rbSess?.on ? rt.rbSess : null;
  const W = Object.values(rt?.rbWound || {}).filter(w => w?.max && now - (w.t || 0) < 30 * 60000 && w.cur < w.max * 0.95);
  if (!tour && !rt?.rbKills && !W.length && !sess) return '';
  const STEP = { pick: 'выбираю', go: 'лечу', arrive: 'ищу на карте', fight: 'бой' };
  let t = `👑 ${tour ? 'Тур' : 'РБ'}${tour && H.step ? ': ' + (STEP[H.step] || H.step) : ''}${tour && H.name && H.step !== 'pick' ? ` · ${H.name}${H.lvl ? ` (${H.lvl})` : ''}` : ''} · убито ${rt.rbKills || 0}`;
  if (W.length) { const w = W.sort((a, b) => a.cur / a.max - b.cur / b.max)[0]; t += ` · недобит: ${w.name || 'РБ'} ${Math.round(w.cur / w.max * 100)} %`; }
  if (sess) t += sess.until ? ` · 🔥 сессия ещё ${fmtDur(sess.until - now)}` : ' · 🔥 сессия: беру баффы';
  return t;
}
function petLineOf(rt) {
  const s = Object.values(rt?.petStat || {}).filter(x => x && (x.fights || x.hits)).sort((a, b) => (b.t || 0) - (a.t || 0))[0];
  if (!s) return '';
  const sw = (s.hits || 0) + (s.crits || 0) + (s.misses || 0), hit = s.hits ? (s.hitDmg || s.dmg || 0) / s.hits : 0;
  return `🐱 ${s.name || 'кот'} · боёв ${s.fights || 0}${hit ? ` · удар ≈${Math.round(hit).toLocaleString('ru')}` : ''}${sw ? ` · промахов ${Math.round((s.misses || 0) / sw * 100)} %` : ''}`
    + `${s.dealt ? ` · ${Math.round(s.dmg / s.dealt * 100)} % урона` : ''} · гибель ${s.deaths || 0}`;
}
// ==== /8.0 сводка «Обзора» ====
// 8.0.3: «РБ между мобами» — как в ядре (content.rbEff): тур по РБ, или выбор игрока rbBetween, пока не рыбалка/эпики/кампания.
// Хранимый rbMode больше не источник правды — сводки и подсветка не расходятся с тем, что делает бот
const rbEff = d => !!(d.rbHuntMode || (d.rbBetween && !d.fishMode && !d.epicMode && !d.campaign));
function paintRbToggle(d) {
  const b = $('rbToggle'); if (!b) return;
  const susp = !!d.rbBetween && !rbEff(d);
  b.classList.toggle('on', !!d.rbBetween); b.classList.toggle('susp', susp); b.dataset.on = d.rbBetween ? '1' : '0';
  b.title = susp ? 'Включено, но сейчас ждёт: вернётся само после ' + (d.fishMode ? 'рыбалки' : d.epicMode ? 'эпиков' : 'кампании')
    : 'Бить РБ в текущей локации между мобами (по умолчанию выкл)';
}
const hhmm = t => new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
function renderDash(rt, d, st) {
  if (!$('dash')) return;
  const now = Date.now(), m = currentMode(d), S = sessInfo(rt, now);
  const mods = [rbEff(d) && m !== 'rb' && 'РБ между мобами', d.tvtOn && 'TvT'].filter(Boolean);
  $('dashMode').textContent = MODE_NAME[m] + (mods.length ? ' + ' + mods.join(', ') : '');
  const [stTxt, stCls] = !st.on ? (st.paused ? ['⏸ пауза', 'pause'] : ['○ остановлен', 'off']) : st.failing ? ['⚠ сбой · восстановление', 'warn']
    : st.heartbeatValid ? ['● работает', 'on'] : st.booting ? ['… запуск', 'warn'] : ['⚠ нет сигнала', 'warn'];
  $('dashState').textContent = stTxt; $('dashState').dataset.st = stCls;
  const zn = rt.zone && m !== 'fish' ? (rt.zoneCat?.[rt.zone]?.name || String(rt.zone).replace(/^out:/, 'Окрестности: ')) : '';
  $('dashSub').textContent = [zn && '📍 ' + zn, S.t0 ? `⏱ сессия ${fmtDur(S.ms)} (с ${hhmm(S.t0)})` : '⏱ сессия не отмечена — ↺ обнулит счётчики и начнёт отсчёт «в час»'].filter(Boolean).join(' · ');
  const kpi = (lbl, per, tot, totTxt) => `<div class="kpi"><span>${lbl}${per != null ? '/ч' : ''}</span><b>${per != null ? fmtBig(per) : fmtBig(tot)}</b><small>${per != null ? totTxt : 'всего'}</small></div>`;
  $('dashKpi').innerHTML = kpi('EXP', S.exp, rt.exp, '+' + fmtBig(rt.exp)) + kpi('Адена', S.adena, rt.adena, '+' + fmtBig(rt.adena)) + kpi('Боёв', S.kills, rt.kills, fmt(rt.kills) + ' всего');
  const L = [], rb = rbLineOf(rt, d, now); if (rb) L.push(esc(rb));
  const F = fishRate(rt, now);
  if (m === 'fish' || F?.fresh) L.push(esc(F ? `🎣 ${fmt(Math.round(F.perH))} рыб/ч · ${F.proofH != null ? `≈${fmt(Math.round(F.proofH))} Proof/ч` : 'Proof/ч — после первого обмена'}${rt.fishProof != null ? ` · Proof ${fmt(rt.fishProof)}` : ''} · ${fmt(F.n)} рыб за сессию` : '🎣 Рыбалка: сессия ещё не началась'));
  const U = suppliesOf(rt, d), low = (v, mn) => v != null && mn > 0 && v < mn ? ' class="low"' : '';
  const sup = [U.hp != null && `🧪 HP <b${low(U.hp, U.hpMin)}>${fmt(U.hp)}</b>`, U.mp != null && `💧 MP <b${low(U.mp, U.mpMin)}>${fmt(U.mp)}</b>`,
    U.shots != null && `✨ <b${low(U.shots, U.shotsMin)}>${fmt(U.shots)}</b>${now - U.shotsT > 30 * 60000 ? ` <i>(сумка ${hhmm(U.shotsT)})</i>` : ''}`,
    rt.tsShil?.n != null && `Shil <b>${fmt(rt.tsShil.n)}</b>`].filter(Boolean);   // 10.0: Shil Coins (магазин TvT)
  if (sup.length) L.push(`<span title="Банки — по панели боя${U.potT ? ' (' + hhmm(U.potT) + ')' : ''}; заряды — по сумке${U.shotsT ? ' (' + hhmm(U.shotsT) + ')' : ''}. Красным — меньше минимума закупки">${sup.join(' · ')}</span>`);
  const pet = (heroCls(d, rt) === 'mage' || rt.petStat) ? petLineOf(rt) : ''; if (pet) L.push(esc(pet));
  $('dashLines').innerHTML = L.map(x => `<div>${x}</div>`).join('');
  // плитки разделов: где сейчас работает бот
  const tile = (id, v) => { const el = $(id); if (el) { el.textContent = v ? '● Включён' : 'Открыть ↗'; el.classList.toggle('on', !!v); } };
  tile('modeHuntState', m === 'farm' || m === 'auto'); tile('modeRbState', m === 'rb' || rbEff(d)); tile('modeEpicState', m === 'epic');
  tile('modeCatState', m === 'cat'); tile('modeFishState', m === 'fish');
}

// ---------- оружие: список из инвентаря, ⭐ «в класс», ✓ надето ----------
const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function fillWeapons(rt, d) {
  const W = rt.weapons || [], R = rt.weaponRec || {}, types = R.types || [];
  const panel = new Set((rt.panel || []).filter(s => s.kind === 'снаряжение').map(s => (s.name || '').toLowerCase()));
  const onPanel = n => [...panel].some(p => p.startsWith(n.toLowerCase()) || n.toLowerCase().startsWith(p));
  const inClass = w => types[0] === '#mage' || types.includes(w.wt);
  const uniq = []; const seen = new Set();
  for (const w of W) { if (!w.name || seen.has(w.name)) continue; seen.add(w.name); uniq.push(w); }
  const opt = (w, sel) => `<option value="${esc(w.name)}"${sel ? ' selected' : ''}>${inClass(w) ? '⭐ ' : ''}${w.where === 'надето' ? '✓ ' : ''}${esc(w.name)} · ${esc(w.wt)} · ${w.g}${w.ench ? ' +' + w.ench : ''} · ${types[0] === '#mage' ? 'M' : 'P'}.Atk ${types[0] === '#mage' ? w.ma : w.pa}${onPanel(w.name) ? '' : ' · не на панели'}</option>`;
  const build = (id, list, cur) => {
    const el = $(id); if (!el) return;
    const lc = cur.toLowerCase(), hit = list.find(w => w.name === cur) || (lc && list.find(w => w.name.toLowerCase().startsWith(lc)));
    let html = `<option value="">— не выбрано —</option>` + list.map(w => opt(w, w === hit)).join('');
    if (cur && !hit) html += `<option value="${esc(cur)}" selected>${esc(cur)} (вручную / нет в инвентаре)</option>`;
    el.innerHTML = html;
  };
  // 9.2.3: магу — по M.Atk (раньше и у мага сортировалось по P.Atk)
  const atkOf = w => (types[0] === '#mage' ? w.ma : w.pa) || 0;
  const sortCls = l => [...l].sort((a, b) => (inClass(b) - inClass(a)) || (atkOf(b) - atkOf(a)));
  build('nWeaponMain', sortCls(uniq), d.nWeaponMain || '');
  const eq = W.find(w => w.where === 'надето');
  $('weapBox').textContent = !rt.weaponsT ? 'Инвентарь ещё не проверялся — нажмите «🔍 Проверить инвентарь»'
    : `Профессия: ${rt.prof || '?'}${R.lv ? ' · ' + R.lv + ' ур.' : ''} · в класс: ${types[0] === '#mage' ? 'маг (по M.Atk)' : types.join(' / ') || '?'}${R.src && !/^профессия/.test(R.src) ? ' (' + R.src + ')' : ''}
`
      + `Надето: ${eq ? `${eq.name} [${eq.wt}, ${eq.g}]${inClass(eq) ? ' ⭐ в класс' : ' — не в класс'}` : 'ничего'}
`
      + `Рекомендую: ${R.main || 'оружия в класс нет в инвентаре'}${R.wore ? '\n✅ Надел: ' + R.wore : R.keptEq ? '\nℹ «В класс» не надето: слабее текущего больше чем на 15 %' : ''}
`
      + `Оружия в инвентаре: ${uniq.length} · проверено ${new Date(rt.weaponsT).toLocaleTimeString('ru')}${rt.invScan ? ' · ⏳ проверяю…' : ''}`;
}
async function weapScan() {
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ invScan: { step: 'prof', back: '', t: Date.now() } });
  $('weapBox').textContent = '⏳ Проверяю: Персонаж → профессия, Инвентарь → оружие… (вкладка игры перейдёт и вернётся)';
}
$('weapScan').onclick = weapScan;
$('weapClass').onclick = async () => {
  const { cfg = {}, rt = {} } = await chrome.storage.local.get(['cfg', 'rt']);
  const R = rt.weaponRec || {};
  if (!R.main && !rt.weaponsT) return weapScan();
  await menuPatch({}, { cfgPatch: { ...(R.main ? { nWeaponMain: R.main } : {}), weaponManual: false, weaponClassEquip: true } });
  await weapScan();                                // пройдёт по инвентарю и наденет, если «в класс» не слабее
};

// ---------- автовход: отдельный ключ «auth», в cfg и выгрузку не попадает ----------
chrome.storage.local.get('auth').then(({ auth }) => {
  if (auth?.login) $('authLogin').value = auth.login;
  $('authNote').dataset.base ||= $('authNote').textContent;
  if (auth?.pass) $('authPass').placeholder = '•••••• (сохранён)';
});
$('authSave').onclick = async () => {
  const login = $('authLogin').value.trim(), pass = $('authPass').value;
  const { auth = {} } = await chrome.storage.local.get('auth');
  await chrome.storage.local.set({ auth: { login, pass: pass || auth.pass || '' } });
  $('authPass').value = ''; $('authPass').placeholder = '•••••• (сохранён)';
  $('authNote').textContent = '✅ Сохранено. ' + ($('authNote').dataset.base || '');
};
$('authClear').onclick = async () => {
  await chrome.storage.local.remove('auth');
  $('authLogin').value = ''; $('authPass').value = ''; $('authPass').placeholder = '';
  $('authNote').textContent = 'Стёрто. ' + ($('authNote').dataset.base || '');
};

async function save(e) {
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  const n = {};
  if (/^nWeapon/.test(e?.target?.id || '')) n.weaponManual = true;   // игрок выбрал оружие сам — проверка инвентаря его не перепишет
  // v5.6: сохраняем только изменённое поле — раньше форма целиком перезаписывала настройки, и то, что бот сам поменял
  // (автороли, оружие) пока поле было в фокусе, откатывалось к старому
  const id = e?.target?.id;
  const one = id && (NUM.includes(id) || TXT.includes(id) || BOOL.includes(id)) ? [id] : null;
  NUM.forEach(k => { if (!one || one.includes(k)) n[k] = Math.max(0, +$(k).value || 0); });
  TXT.forEach(k => { if (!one || one.includes(k)) n[k] = $(k).value; });
  BOOL.forEach(k => { if (!one || one.includes(k)) n[k] = $(k).checked; });
  if (n.rodEnchantTo != null) n.rodEnchantTo = Math.min(10, n.rodEnchantTo);
  if (n.maxPages < 1) n.maxPages = 1;
  if (n.champHpMult < 1.1) n.champHpMult = 1.1;
  if (n.buffSec < 10) n.buffSec = 10;
  if (n.reactMin < 80) n.reactMin = 80;
  if (n.campaignEvery < 5) n.campaignEvery = 5;
  if (n.reactMax != null && n.reactMax < (n.reactMin ?? cfg.reactMin ?? 80)) n.reactMax = n.reactMin ?? cfg.reactMin ?? 80;
  try { await menuPatch({}, { cfgPatch: n }); }
  catch (error) {
    const why = String(error?.message || error);
    $('status').textContent = 'Не удалось сохранить настройки: ' + why;
    if (typeof toast === 'function') toast('Настройки не сохранены: ' + why);
    throw error; // do not continue Start/Buy/Mode with unapplied configuration
  } // отдельные поля, без перезаписи всего cfg
}

// ---------- вкладки ----------
// 7.1.31: 15 разделов сведены в 7. Бывшие разделы — подразделы (метка #tab-<старый> внутри нового), переходы на них работают
// ---------- 🏺 Маммон (9.0): заказ торговца, где стоят NPC, цель «копить на улучшение» ----------
let MMG = null;                                    // справочник улучшаемых вещей (mammon-gear.json)
fetch(chrome.runtime.getURL('mammon-gear.json')).then(r => r.ok ? r.json() : {}).then(j => { MMG = j; load(); }).catch(() => { MMG = {}; });
const MM_STAT = { cloakMaxHp: 'HP', equipFlatMaxHp: 'HP', equipFlatMaxCp: 'CP', cloakPDefFlat: 'P.Def', equipFlatPDef: 'P.Def', cloakMDefFlat: 'M.Def', equipFlatMDef: 'M.Def',
  equipFlatPAtk: 'P.Atk', equipFlatMAtk: 'M.Atk', equipOutgoingPhysicalSkillDamagePct: 'урон физ. умений %', equipOutgoingMagicalSkillDamagePct: 'урон маг. умений %',
  equipAttackSpeedPct: 'скор. атаки %', equipCastSpeedPct: 'скор. каста %', equipFinalRunSpeedFlat: 'бег', equipPhysicalCritDamagePct: 'сила физ. крита %',
  equipMagicCritDamagePct: 'сила маг. крита %', equipEvasionFlat: 'уклонение' };
const MM_KIND = { order: 'заказ', send: 'крафтеру', claim: 'почта' };
// имена ресурсов «у крафтера» (id → имя): сырьё рецептов Маммона (MM_RECIPES в modules/mammon.js)
const MM_RES = { 1864: 'Stem', 1865: 'Varnish', 1866: 'Suede', 1867: 'Animal Skin', 1868: 'Thread', 1869: 'Iron Ore', 1870: 'Coal', 1871: 'Charcoal', 1872: 'Animal Bone',
  1873: 'Silver Nugget', 1874: 'Oriharukon Ore', 1875: 'Stone of Purity', 1876: 'Mithril Ore', 1877: 'Adamantite Nugget', 1878: 'Braided Hemp', 1879: 'Cokes', 1880: 'Steel',
  1881: 'Coarse Bone Powder', 1882: 'Leather', 1883: 'Steel Mold', 1884: 'Cord', 1886: 'Silver Mold', 1887: 'Varnish of Purity', 1888: 'Synthetic Cokes', 1889: 'Compound Braid', 5549: 'Metallic Thread' };
const MM_SLOT = { cloak: 'плащ', belt: 'пояс', tattoo: 'тату', wings: 'крылья' };
const mmTime = t => t ? new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '?';
function renderMammon(rt, d) {
  if (!$('tab-mammon')) return;
  const N = rt.mmNpc || {}, npc = (x, nm) => x ? `${nm}: ${esc(x.loc)} · до ${mmTime(x.at)}, дальше ${esc(x.next || '?')} · телепорт ${x.price ? fmt(x.price) + ' адены' : 'бесплатно'}` : `${nm}: ?`;
  $('mmNpcBox').innerHTML = N.t ? `${npc(N.order, '📦 Торговец')}<br>${npc(N.smith, '⚒ Кузнец')}` : 'Ещё не проверял — бот спросит у игры сам';
  const o = rt.mmOrder;
  $('mmOrderBox').innerHTML = !o ? 'Заказа ещё не видел' : o.st === 'OPEN'
    ? `<b>${esc(o.res)} ×${o.qty}</b> · в сумке ${fmt(o.have)} ${o.have >= o.qty ? '✅' : '— не хватает ' + fmt(o.qty - o.have)}<br>Награда: ${o.col} Coin of Luck + ${fmt(o.adena)} адены · до ${mmTime(o.exp)}${rt.mmJob?.kind === 'order' ? '<br>⏳ бот летит сдавать' : ''}`
    : `Заказ ${esc(o.res)} ×${o.qty} закрыт${o.win ? ' · забрал ' + esc(o.win) : ''} · следующий — после ${mmTime(o.exp)}`;
  // 9.2.5: команда «… сейчас» ждёт (бой/тур) или отклонена — первой строкой
  const go = rt.mmGoReq?.kind ? `⏳ по кнопке: ${rt.mmGoReq.kind === 'order' ? 'сдать заказ' : 'улучшить вещь-цель'} — полечу, как только закончу бой/тур` : rt.mmGoSay && Date.now() - rt.mmGoSay.t < 600000 ? `✗ по кнопке не полетел: ${rt.mmGoSay.why}` : '';
  $('mmLogBox').textContent = (go ? go + '\n' : '') + (rt.mmLog || []).slice(0, 6).map(x => `${mmTime(x.t)} ${MM_KIND[x.kind] || 'кузнец'} ${x.ok ? '✓' : '✗'} ${x.why}`).join('\n');
  // 9.2.5: крафтер и почта — что лежит у крафтера, что пришло в почту, что отправить
  const C = rt.mmCraft, at = Object.entries(C?.at || {}).filter(([, n]) => n > 0), U = rt.mmMail?.unc || [], to = String(d.mmCrafter ?? 'Skye').trim() || '—';
  const cs = rt.mmCraftReq?.t ? '⏳ по кнопке: отправлю крафтеру, как только закончу бой/тур' : rt.mmCraftSay && Date.now() - rt.mmCraftSay.t < 600000 ? `✗ по кнопке не отправил: ${rt.mmCraftSay.why}` : '';
  $('mmCraftBox').textContent = [cs,
    at.length ? `У крафтера ${C.to || to} (отправлено ${mmTime(C.t)}): ${at.map(([id, n]) => `${MM_RES[id] || '#' + id} ${fmt(n)}`).join(', ')} — жду готовое письмом` : `У крафтера ${to} ничего нашего нет`,
    U.length ? `📬 В почте не забрано: ${U.map(a => `${a.n} ×${fmt(a.q)} от ${a.s || '?'}`).join(', ')}` : rt.mmMail?.t ? `📭 Почта проверена ${mmTime(rt.mmMail.t)}: всё забрано` : ''].filter(Boolean).join('\n');
  // вещи: экипировка из ответов игры + список кузнеца + все из справочника (для выбора цели заранее)
  const eq = Object.entries(rt.mmEq || {}), gear = rt.mmGear || [], ids = [...new Set([...eq.map(([, v]) => v[0]), ...gear.map(g => g.id)])];
  const lvlOf = id => gear.find(g => g.id === id)?.lvl ?? (eq.find(([, v]) => v[0] === id)?.[1][1] || 0);
  const nm = id => MMG?.[id]?.n || gear.find(g => g.id === id)?.n || '#' + id;
  if (MMG && document.activeElement?.id !== 'mmGoalItem') {
    const all = [...ids, ...Object.keys(MMG).map(Number).filter(id => !ids.includes(id))];
    const sig = all.join(',') + '|' + ids.map(lvlOf).join(',');
    if ($('mmGoalItem').dataset.sig !== sig) {
      $('mmGoalItem').dataset.sig = sig;
      $('mmGoalItem').innerHTML = '<option value="0">— цели нет —</option>' + all.map(id => `<option value="${id}">${ids.includes(id) ? '★ ' : ''}${esc(nm(id))} · ${MMG?.[id]?.g || ''} ${MM_SLOT[MMG?.[id]?.s] || ''}${ids.includes(id) ? ' · Lv.' + lvlOf(id) : ''}</option>`).join('');
    }
    $('mmGoalItem').value = String(+d.mmGoalItem || 0);
  }
  if (document.activeElement?.id !== 'mmGoalLvl') $('mmGoalLvl').value = String(+d.mmGoalLvl || 5);
  const gid = +d.mmGoalItem || 0;
  $('mmGoalBox').innerHTML = !gid ? 'Цели нет' : esc(rt.mmGoalSt || `${nm(gid)}: считаю…`) + (rt.mmJob?.kind === 'smith' ? '<br>⏳ бот летит к кузнецу' : '');
  // 9.2 (игрок 11.10: «собрать ВСЕ ресурсы наперёд»): по уровням до цели, итог наперёд, сырьё (крафтовое разобрано) и что передать крафтеру
  const P = gid && rt.mmGoalPlan?.id === gid ? rt.mmGoalPlan : null, n0 = v => v == null ? '?' : fmt(v);
  const tb = (head, rows) => `<table class="mm-t" style="width:100%;border-collapse:collapse;margin:3px 0 7px;font-size:11px"><tr>${head.map(h => `<th style="text-align:left;opacity:.75;padding-right:6px">${h}</th>`).join('')}</tr>${rows.join('')}</table>`;
  $('mmPlanBox').innerHTML = !P ? '' : `<b>По уровням</b> (≈ — оценка по известной цене, уточню у кузнеца):`
    + tb(['Уровень', 'Адена', 'CoL', 'Материалы'], P.lv.map(x => `<tr><td style="white-space:nowrap;padding-right:6px">${x.e ? '≈ ' : ''}Lv.${x.L}→${x.L + 1}</td>` + (x.unk ? '<td colspan="3">цена неизвестна — узнаю у кузнеца</td></tr>'
      : `<td style="white-space:nowrap;padding-right:6px">${fmt(x.a)}</td><td>${x.c}</td><td>${x.m.map(m => `${esc(m[0])} ${fmt(m[1])}`).join(', ')}</td></tr>`)))
    + `<b>Всего наперёд до Lv.${P.to}</b>: ${fmt(P.a)} адены + ${P.c} Coin of Luck`
    + tb(['Материал', 'Нужно', 'Есть', 'Не хватает'], P.tot.map(t => `<tr><td>${esc(t[0])}</td><td>${fmt(t[1])}</td><td>${n0(t[2])}</td><td>${t[3] ? '<b>' + fmt(t[3]) + '</b>' : '✅'}</td></tr>`))
    + (P.cr.length ? `<b>Сырьё</b> (крафтовое разобрано по рецептам, сумка учтена):`
      + tb(['Ресурс', 'Нужно', 'Есть', 'Не хватает'], P.raw.map(r => `<tr><td>${esc(r[0])}${r[4] ? '' : ' <span title="В базе фарма источников нет">·нет в фарме</span>'}</td><td>${fmt(r[1])}</td><td>${n0(r[2])}</td><td>${r[3] ? '<b>' + fmt(r[3]) + '</b>' : '✅'}</td></tr>`))
      + `<b>Передать крафтеру</b> (письмом, обратно — готовое):` + tb(['Скрафтить', 'Шт.', 'Рецепт'], P.cr.map(c => `<tr><td>${esc(c[0])}</td><td>${fmt(c[1])}</td><td>${esc(c[3])}${c[2] !== c[1] ? ` ×${c[2]}` : ''}</td></tr>`))
      + (P.snd?.length ? `<b>Из сумки крафтеру на недостающие уровни Lv.${P.lvl} → Lv.${P.to}</b>${P.lk === 0 ? ' (уровень вещи бот ещё не видел — считаю от Lv.0; узнаю у кузнеца)' : ''}${P.cm ? ` (сырья на крафт не хватает ещё ${fmt(P.cm)})` : ' ✅ набор полный'}: ${P.snd.map(x => `${esc(x[0])} ${fmt(x[1])}`).join(', ')}` : '') : '');
  // бонусы выбранной вещи Lv.0–5 (★ — надето/в сумке)
  const G = MMG?.[gid];
  $('mmGearBox').textContent = G ? `${G.n} (${G.g}, ${MM_SLOT[G.s] || G.s}) — бонусы по уровням:\n` + Object.keys(G.L[0]).map(k => `${MM_STAT[k] || k}: ${G.L.map(x => x[k]).join(' → ')}`).join('\n')
    + (ids.includes(gid) ? `\nСейчас Lv.${lvlOf(gid)}` : '\nЭтой вещи у героя бот не видел') : ids.length ? 'Твои улучшаемые вещи: ' + ids.map(id => `${nm(id)} Lv.${lvlOf(id)}`).join(', ') : '';
}
// ---------- 🛒 Магазин TvT (10.0): Shil Coins, цель, покупка ----------
let TS_RT = {}, TS_CFG = {};
const TS = (typeof L2V7Factories !== 'undefined' && L2V7Factories.tvtshop) ? L2V7Factories.tvtshop({ get rt() { return TS_RT; }, get cfg() { return TS_CFG; }, invQty: () => null, heroLevel: () => +TS_RT.lvl || 0, rec() {}, setRt() { return Promise.resolve(); } }) : null;
function renderTvtShop(rt, d) {
  if (!$('tsBox') || !TS) return;
  TS_RT = rt; TS_CFG = d;
  const have = TS.shil(), log = rt.tsLog || [];
  $('tsBox').textContent = (have == null ? 'Shil Coins: ещё не считал (нужен снимок сумки — бот читает её при старте)' : `Shil Coins: ${fmt(have)}${rt.tsShil?.t ? ' (сумка ' + mmTime(rt.tsShil.t) + ')' : ''}`)
    + (rt.tsJob ? `
⏳ бот идёт покупать ${rt.tsJob.it?.n || ''}` : '') + (log.length ? `
Последнее: ${log.slice(0, 3).map(x => `${x.ok ? '✓' : '✗'} ${x.n} (${mmTime(x.t)}${x.ok ? '' : ': ' + x.why})`).join('; ')}` : '');
  if (document.activeElement?.id !== 'tsGoalItem') {
    const items = TS.catalog(), cls = heroCls(d, rt), sig = items.map(x => x.id).join(',') + '|' + cls;
    if ($('tsGoalItem').dataset.sig !== sig) {
      $('tsGoalItem').dataset.sig = sig;
      const fit = x => x.cat !== 'weapon' || (cls === 'mage' ? x.mode === 'magic' : cls === 'fighter' ? x.mode !== 'magic' : true);
      const opt = x => `<option value="${x.id}">${fit(x) ? '' : '· '}${esc(x.n)} · ${TS.CAT_RU[x.cat] || x.cat} · ${x.price} Shil${x.lvl ? ' · ' + x.lvl + ' ур.' : ''}</option>`;
      $('tsGoalItem').innerHTML = '<option value="0">— цели нет —</option>' + [...items.filter(fit), ...items.filter(x => !fit(x))].map(opt).join('');
    }
    $('tsGoalItem').value = String(+d.tsGoalItem || 0);
  }
  const it = TS.itemOf(+d.tsGoalItem || 0);
  $('tsGoalBox').textContent = !it ? 'Цели нет' : `${TS.line()}
${it.cat === 'weapon' ? `P.Atk ${it.pa} · M.Atk ${it.ma}` : it.st || ''}`;
}
// ---------- 👑 Сабкласс и Noblesse (9.0): прогресс квестов из памяти бота (rt.story) ----------
function renderStory(rt) {
  if (!$('storyBox')) return;
  const S = rt.story || {}, n = S.noblesse, c = S.subclass, out = [];
  if (rt.classCur?.prof) out.push(`Класс: ${esc(String(rt.classCur.prof).replace(/^(human|elf|dark_elf|orc|dwarf)_/, '').replace(/_/g, ' '))}${Object.keys(rt.classStash || {}).length ? ' · замеры других классов сохранены: ' + esc(Object.keys(rt.classStash).join(', ')) : ''}`);
  if (c) out.push(`⚔ Сабкласс: ${c.completed ? 'квест пройден ✅' : !c.active ? `не взят (нужен ${c.min || 75} ур.)` : c.stage === 'hunt_bosses' ? 'РБ: ' + c.bosses.map(b => `${b.done ? '✓' : '★'} ${esc(b.name)} ${b.lvl}`).join(', ') : `сдать ${esc(c.npc)}${c.ready ? ' — готово' : ''}`}`);
  if (n) out.push(`👑 Noblesse: ${n.completed ? 'пройден ✅' : !n.active ? `не взят (сабкласс ${n.min || 50}+, Virgil в Rune)` : `часть ${n.part}/${n.of}: ` + (n.targets.map(t => `${t.have >= t.need ? '✓' : '★'} ${esc(t.name)} ${t.have}/${t.need}`).join(', ') || 'к ' + esc(n.npc)) + (n.ready ? ' — готово к сдаче' : '')}`);
  if (S.nobleOwn) out.push('👑 Статус Noblesse есть: Noblesse Blessing свой');
  if (rt.storyJob) out.push(`⏳ бот летит сдавать: ${esc(rt.storyJob.why || '')}`);
  const lg = (rt.storyLog || [])[0]; if (lg) out.push(`${new Date(lg.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} ${lg.ok ? '✓' : '✗'} ${esc(lg.why)}`);
  $('storyBox').innerHTML = out.join('<br>') || 'Прогресс бот узнает у игры сам';
}
$('mmPoll')?.addEventListener('click', () => menuPatch({ mmPollReq: Date.now() }));
$('mmSmith')?.addEventListener('click', () => menuPatch({ mmSmithReq: Date.now() }));
// 9.2.5: «идти сейчас» — разовая команда (mammon.goReq); бот летит, как только закончит бой/тур
$('mmGoOrder')?.addEventListener('click', async () => { await menuPatch({ mmGoReq: { kind: 'order', t: Date.now() }, mmGoSay: null }); toast('📦 Лечу сдавать заказ Маммону'); });
// 9.2.5: крафтер — «отправить сейчас» (разовая команда, mammon.craftWant) и «забыть, что у крафтера»
$('mmCraftGo')?.addEventListener('click', async () => { await menuPatch({ mmCraftReq: { t: Date.now() }, mmCraftSay: null }); toast('📤 Отправлю крафтеру сырьё из сумки'); });
$('mmCraftForget')?.addEventListener('click', async () => { await menuPatch({ mmCraft: null }); toast('↺ Забыл, что лежит у крафтера'); });
$('mmGoUp')?.addEventListener('click', async () => { await menuPatch({ mmGoReq: { kind: 'up', t: Date.now() }, mmGoSay: null }); toast('⬆ Лечу к кузнецу улучшать вещь-цель'); });

const TAB_GROUP = { autofarm: 'hunt', dungeon: 'hunt', loc: 'hunt', tvtshop: 'hunt', analyze: 'panel', roles: 'panel', pet: 'panel', mage: 'panel', spoil: 'panel', fighter: 'panel', fight: 'panel', enemies: 'panel', epic: 'rb', loot: 'supply', log: 'svc' };
function showTab(t) {
  const sub = TAB_GROUP[t] ? t : '';
  t = TAB_GROUP[t] || t;
  if (!document.getElementById('tab-' + t)) t = 'overview';
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('act', b.dataset.tab === t));
  document.querySelectorAll('section').forEach(sec => sec.classList.toggle('act', sec.id === 'tab-' + t));
  try { localStorage.setItem('tab', t); } catch (e) {}
  document.dispatchEvent(new CustomEvent('l2:tabchange', { detail: { tab: t } }));
  if (sub) setTimeout(() => document.getElementById('tab-' + sub)?.parentElement?.scrollIntoView({ block: 'start' }), 30);
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
try { showTab(localStorage.getItem('tab') || 'overview'); } catch (e) {}

// ---------- приоритет целей кнопками (хранится тем же текстом, что и раньше) ----------
const parseLine = line => {
  const neg = line.startsWith('-'), t = neg ? line.slice(1).trim() : line;
  return { neg, quest: /\[квест\]/i.test(t), champ: /\[чемп\]/i.test(t), all: /\[все\]/i.test(t),
           name: t.replace(/\[(квест|чемп|все)\]/gi, '').trim() };
};
const lineOf = r => (r.neg ? '-' : '') + [r.name, r.quest ? '[квест]' : '', r.champ ? '[чемп]' : '', r.all ? '[все]' : ''].filter(Boolean).join(' ');
const labelOf = r => r.name ? `${r.name}${r.champ ? ' — только чемпион' : ''}${r.quest ? ' — только квестовый' : ''}`
  : r.quest && r.champ ? '★ Квестовые чемпионы' : r.quest ? '★ Квестовые мобы' : r.champ ? '⚔ Чемпионы' : r.all ? '◎ Все в диапазоне уровней' : '?';
let prio = [];
// 8.0.3: правило выключено своей галочкой — бот его не применяет (mobfarm.parseRules), в списке оно серое с пояснением
const ruleOff = r => !r.neg && ((r.champ && !$('searchChamp')?.checked) || (r.quest && !$('searchQuest')?.checked));
function renderPrio(text) {
  prio = text.split('\n').map(s => s.trim()).filter(Boolean).map(parseLine);
  $('prioList').innerHTML = prio.length ? prio.map((r, i) => `
    <div class="rule${r.neg ? ' neg' : ''}"${ruleOff(r) ? ' style="opacity:.5"' : ''}><span class="n">${r.neg ? '🚫' : i + 1}</span><span class="t">${labelOf(r).replace(/</g, '&lt;')}${ruleOff(r) ? ` <small>(выкл. — галочка «${r.champ ? 'Искать чемпионов' : 'Искать квестовых'}»)</small>` : ''}</span>
      <button data-a="up" data-i="${i}" title="Выше">▲</button><button data-a="down" data-i="${i}" title="Ниже">▼</button>
      ${r.name ? `<button data-a="champ" data-i="${i}" title="Только чемпион этого вида">⚔</button>` : ''}
      <button data-a="neg" data-i="${i}" title="Исключить / вернуть">🚫</button><button data-a="del" data-i="${i}" title="Удалить">✕</button></div>`).join('')
    : '<div class="hint">Пусто — бот не будет выбирать цели на карте</div>';
}
for (const id of ['searchChamp', 'searchQuest']) $(id)?.addEventListener('change', () => renderPrio($('priority').value));   // 8.0.3
async function commitPrio() { $('priority').value = prio.map(lineOf).join('\n'); renderPrio($('priority').value); await save({ target: $('priority') }); }
$('prioList').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const i = +b.dataset.i, a = b.dataset.a;
  if (a === 'up' && i > 0) [prio[i - 1], prio[i]] = [prio[i], prio[i - 1]];
  if (a === 'down' && i < prio.length - 1) [prio[i + 1], prio[i]] = [prio[i], prio[i + 1]];
  if (a === 'neg') prio[i].neg = !prio[i].neg;
  if (a === 'champ') prio[i].champ = !prio[i].champ;
  if (a === 'del') prio.splice(i, 1);
  commitPrio();
};
const addRule = r => { if (!prio.some(x => lineOf(x) === lineOf(r))) prio.push(r); commitPrio(); };
$('addQuest').onclick = () => addRule({ quest: true });
$('addChamp').onclick = () => addRule({ champ: true });
$('addAll').onclick   = () => addRule({ all: true });
$('addMob').onclick   = () => { const n = $('addName').value.trim(); if (n) { addRule({ name: n }); $('addName').value = ''; } };
$('addName').onkeydown = e => { if (e.key === 'Enter') $('addMob').click(); };

// ---------- база РБ ----------
function renderRb(rt) {
  const db = rt.rbDb || {}, seen = rt.rbSeen || {};
  const order = id => ({ ok: 0, chip: 1, no: 3 })[db[id]?.verdict] ?? (seen[id]?.inRange === false ? 4 : 2);
  const ids = [...new Set([...Object.keys(seen), ...Object.keys(db)])].sort((a, b) => order(a) - order(b));
  const MARK = { ok: ['✅', 'по силам'], no: ['❌', 'не по силам'], chip: ['⚠', 'частично — бьём заходами'] };
  $('rbList').innerHTML = ids.length ? ids.map(id => {
    const s = seen[id] || {}, d = db[id] || {}, m = MARK[d.verdict] || (d.probe ? ['🧪', `пробный заход на ур. ${d.probe.lvl}${d.sp ? `, спецудар ${d.sp} HP` : ''}`] : s.inRange === false ? ['⛔', 'вне уровня героя'] : ['❔', 'не проверен']);
    const chipNow = rt.rb?.[id] ? ` · у него ${rt.rb[id].hpAfter}/${rt.rb[id].max}` : '';
    const z = d.zone || s.zone, zn = z ? (rt.zoneCat?.[z]?.name || String(z).replace(/^out:/, 'Окрестности: ')) : '';
    return `<div class="rb"><span class="m">${m[0]}</span><div><b>${(d.name || s.name || id).replace(/</g, '&lt;')}</b> (${d.lvl || s.lvl || '?'}) — ${m[1]}`
      + `<div class="d">${zn ? '📍 ' + zn.replace(/</g, '&lt;') + (z === rt.zone ? ' (здесь)' : '') + ' · ' : ''}${s.seenT ? 'видел ' + new Date(s.seenT).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) + ' · ' : ''}${d.tries ? `попыток ${d.tries}` : ''}${d.kills ? ` · убит ${d.kills}×` : ''}${d.heroLvl ? ` · проверен на ур. ${d.heroLvl}` : ''}${chipNow}`
      + `${d.note ? '<br>' + d.note.replace(/</g, '&lt;') : ''}</div></div></div>`;
  }).join('') : '<div class="hint">Пусто — включите «👑 Тур по РБ» или «РБ между мобами» и зайдите на карту</div>';
  const F = Object.values(rt.rbForum || {}), V = Object.entries(rt.rbZoneVisit || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const ok = Object.values(db).filter(d => d.verdict === 'ok').length, no = Object.values(db).filter(d => d.verdict === 'no').length;
  const RL = Object.values(rt.rbList || {}), L = rt.lvl || 0;
  const rlLine = RL.length ? `Список РБ игры: ${RL.length} · живых ${RL.filter(x => x.alive).length} · разрешено мне ${RL.filter(x => x.alive && !x.deny).length} (${rt.rbListT ? 'обновлён ' + new Date(rt.rbListT).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : 'перечитаю при запуске тура'})${rt.rbGo ? ` · ✈ лечу к ${rt.rbGo.name}` : ''}\n` : 'Список РБ игры ещё не читал — прочитаю при запуске тура по РБ\n';
  $('rbTourBox').textContent = rlLine + `Можем: ${ok} · не можем: ${no} · РБ с форума: ${F.length}${F.length ? ' (' + F.slice(0, 5).map(f => `${f.name} ${f.lvl}`).join(', ') + (F.length > 5 ? '…' : '') + ')' : ''}`
    + (V.length ? `\nЗоны без РБ по силам (не летим 40 мин): ${V.map(([z, t]) => `${rt.zoneCat?.[z]?.name || z} ${new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`).join(', ')}` : '');
}
// ---------- 🧭 тур по РБ: состояние ----------
// очередь тура: те же правила, что у бота (rbListPick): живой, игра разрешает, окно ±15, не «не по силам», не пробовали 30 мин
function renderHuntQueue(rt, d) {
  const L = rt.lvl || 0, RL = Object.entries(rt.rbList || {}), db = rt.rbDb || {}, tried = rt.rbGoTried || {}, now = Date.now();
  $('rbOrderUp').classList.toggle('on', d.rbOrder !== 'down'); $('rbOrderDown').classList.toggle('on', d.rbOrder === 'down');
  if (!RL.length || !L) { $('huntQueue').textContent = RL.length ? '' : 'Список РБ игры ещё не читался — прочитаю при запуске тура'; return; }
  const lo = L - Math.min(d.rbMaxBelow > 0 ? d.rbMaxBelow : 15, 15), hi = L + Math.min(d.rbMaxAbove ?? 15, 15);
  const why = (id, x) => !x.alive ? 'мёртв' : x.deny ? 'игра не даёт: ' + x.deny.toLowerCase() : x.lvl < lo ? 'слишком слабый для окна' : x.lvl > hi ? 'слишком сильный' : db[id]?.verdict === 'no' ? '❌ не по силам' : now - (tried[id] || 0) < 30 * 60000 ? `пробовал, ещё ${Math.ceil((30 * 60000 - (now - tried[id])) / 60000)} мин` : '';
  const dir = d.rbOrder === 'down' ? -1 : 1;
  const all = RL.map(([id, x]) => ({ id, ...x, why: why(id, x) })).sort((a, b) => dir * (a.lvl - b.lvl));
  const ok = all.filter(x => !x.why), skip = all.filter(x => x.why && x.lvl >= L - 20 && x.lvl <= hi);
  // 8.0 (аудит меню): одинаковые причины («игра не даёт: …» ×10) — одной строкой со счётом
  $('huntQueue').textContent = `Очередь (${d.rbOrder === 'down' ? 'с сильных' : 'со слабых'}, окно ${lo}–${hi}): ` + (ok.length ? ok.slice(0, 6).map(x => `${x.name} ${x.lvl}${db[x.id]?.verdict === 'ok' ? ' ✅' : ''}`).join(' → ') + (ok.length > 6 ? ` … ещё ${ok.length - 6}` : '') : 'подходящих нет')
    + (skip.length ? `\nПропускаю:\n` + skipGroups(skip).join('\n') : '');
}
async function setRbOrder(v) {
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  await menuPatch({}, { cfgPatch: { rbOrder: v } });
}

$('fishRodGoal10').onclick = async () => {
  await activateMode({ rodGoalActive: true, rodGoalAt: Date.now(), fishService: 'rod', fishTgt: null, fishSvc: null },
    { rodEnchantTo: 10, fishMode: true, fishGoal: '', epicMode: false, rbMode: false, rbHuntMode: false, catMode: false, campaign: false });
  $('rodEnchantTo').value = '10';
  $('fishRodGoalStatus').textContent = 'Цель активна: +10. Проверю удочку, по одному куплю свитки, затем вернусь к рыбалке и Proof.';
  $('fishRodGoal10').textContent = 'Заточка +10 запущена';
};
$('fishQuickCut').onclick = async () => {
  const { on = false } = await chrome.storage.local.get('on');
  await activateMode({ fishSvc: { t: Date.now(), stopAfter: !on }, fishService: 'cut' }, {});
  $('fishQuickCut').textContent = 'Разделка поставлена в очередь';
};
$('rbOrderUp').onclick = () => setRbOrder('up');
$('rbOrderDown').onclick = () => setRbOrder('down');
function renderHunt(rt, d) {
  renderHuntQueue(rt, d);
  const H = rt.rbHunt, db = rt.rbDb || {};
  const STEP = { pick: 'выбираю следующего', go: 'лечу (список РБ → «Телепорт»)', arrive: 'ищу на карте', fight: 'бой' };
  const tried = Object.entries(rt.rbGoTried || {}).filter(([, t]) => Date.now() - t < 30 * 60000).length;
  const kills = Object.values(db).reduce((a, x) => a + (x.kills || 0), 0);
  $('huntBox').textContent = !d.rbHuntMode && !H?.t ? 'Тур не запускался — нажмите «🧭 Тур по РБ»'
    : `${d.rbHuntMode ? '▶ Тур идёт' : '■ Тур выключен'}${H?.step ? ' · ' + (STEP[H.step] || H.step) : ''}${H?.name && H.step !== 'pick' ? `: ${H.name} (${H.lvl})` : ''}`
      + (H?.last ? `\nПоследнее: ${H.last}` : '')
      + `\nУбито РБ (всего по базе): ${kills} · пропущено на 30 мин: ${tried}`
      + `\nОценка до боя: удар РБ ≈ ${rt.rbK || 0.109} × P.Atk${rt.rbK ? ' (выучено)' : ' (старт)'} · наш ДПС по РБ ≈${rt.rbDps || 1150}${rt.rbDps ? ' (общая статистика, не гарантия)' : ' (ориентир по умолчанию)'} · не лезет, если спецудар ≥40 % HP или банок уйдёт >½ запаса`;
}
confirmClick('rbReset', async () => {                 // сбросить вердикты по всем РБ и проверить заново
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ rbDb: {}, rb: {}, rbPending: true, sinceRb: 999 });
});

// 8.0.6 (Firefox для Android): меню из «⋮ → Расширения» открывается отдельной вкладкой — активная вкладка там само меню, берём вкладку игры
async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (t && /^https:\/\/([\w-]+\.)?l2wap\.com\//.test(t.url || '')) return t;
  const g = (await chrome.tabs.query({ url: ['https://l2wap.com/*', 'https://*.l2wap.com/*'] }).catch(() => [])).filter(x => x.id != null);
  return g.find(x => x.active) || g[0] || t;
}

document.querySelectorAll('input,textarea,select').forEach(el => { if (!['recN', 'resPick', 'resNeed', 'fishTgtType', 'fishTgtN', 'memFile', 'uiSearch', 'faPick', 'cfgFile', 'addName', 'authLogin', 'authPass'].includes(el.id)   /* 7.1.30: эти поля сохраняют себя сами — иначе ввод логина перезаписывал все настройки */ && !el.classList.contains('epicChk')) el.addEventListener('change', save); });

$('check').onclick = async () => {
  await save();
  const box = $('slots');
  box.style.whiteSpace = 'pre-line';
  try {
    const r = await chrome.tabs.sendMessage((await activeTab()).id, { cmd: 'slots' });
    box.textContent = !r.battle ? '⚠ Откройте страницу боя и нажмите ещё раз'
      : r.roles.join('\n') + '\n— панель —\n' + (r.panel.join('\n') || 'слоты не найдены');
  } catch { box.textContent = '⚠ Откройте вкладку l2wap.com (страницу боя)'; }
};
let proposed = null;
const ROLE_RU = { nWeaponMain: 'Основное оружие', nAttack: 'Атака', nPower: 'Силовые', nStun: 'Станы', nBuffs: 'Баффы', nShots: 'Соски', nMpPot: 'Банка MP', nHpPot: 'Банка HP', nHeal: 'Лечение', nKeyBuffs: 'Важные баффы', nToggles: 'Постоянные баффы', nSpoil: 'Спойл', nSpoilMass: 'Масс-спойл', nSweep: 'Сбор спойла', nUltra: 'Сверхсильные', nDrain: 'Вампиризм', nCharge: 'Копит энергию', nForce: 'Тратит энергию', nDebuff: 'Дебаффы' };
$('suggest').onclick = async () => {
  await save();
  const box = $('slots'); box.style.whiteSpace = 'pre-line';
  try {
    const r = await chrome.tabs.sendMessage((await activeTab()).id, { cmd: 'suggest' });
    proposed = r.roles;
    const { cfg = {} } = await chrome.storage.local.get('cfg');
    box.textContent = '🤖 Предложение (сейчас → будет):\n'
      + Object.entries(r.roles).map(([k, v]) => `${(cfg[k] || '') === v ? '=' : '→'} ${ROLE_RU[k]}: ${cfg[k] || '—'}${(cfg[k] || '') === v ? '' : '  ⇒  ' + (v || '—')}`).join('\n')
      + `\n(${r.buffsNote})\n\nЧто бот знает о скиллах:\n` + (r.why.join('\n') || 'скиллов на панели нет')
      + (r.battle ? '' : '\n\n⚠ Не на странице боя — использована последняя сохранённая панель');
    $('applyRow').hidden = false;
  } catch { box.textContent = '⚠ Откройте вкладку l2wap.com (лучше страницу боя)'; }
};
$('apply').onclick = async () => {
  if (!proposed) return;
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  const fix = Object.fromEntries(Object.entries(proposed).filter(([, v]) => v));
  await menuPatch({}, { cfgPatch: fix });
  $('applyRow').hidden = true; $('slots').textContent = '✅ Роли применены';
  load();
};
// ---------- 7.1.31: «Чем занят бот» — ровно один режим (движок и так исполняет один: эпики → тур РБ → рыбалка → катакомбы → кампания → фарм) ----------
// Текущий режим — так же, как его выбирает движок (L2EngineCore.chooseMode). Кампания, «РБ между мобами», TvT — дополнения
function currentMode(d) {
  return d.epicMode ? 'epic' : d.rbHuntMode ? 'rb' : d.fishMode ? 'fish' : d.catMode && !d.campaign ? 'cat' : d.taskOnly ? 'tasks' : d.zoneAuto ? 'auto' : 'farm';
}
const MODE_NAME = { tasks: '⏹ Без режима — только задачи', farm: '⚔ Фарм на месте', auto: '🗺 Автофарм', rb: '👑 Тур по РБ', epic: '🐉 Эпики', fish: '🎣 Рыбалка', cat: '🏛 Катакомбы' };
function paintModes(d, on) {
  const m = currentMode(d);
  $('rbSessStart').onclick = async () => {
  await save();
  await menuPatch({ rbSess: { on: true, start: Date.now(), bought: false } });   // сначала сессия, потом режим (запуск ждёт ответа игры)
  await setMode('rb');
  toast('🔥 РБ-сессия: бот идёт к бафферу за баффами, потом — тур по РБ');
};
$('rbSessAuto').onclick = async () => { $('rbSessBuffs').value = 'auto'; await save(); toast('⚡ Фулл бафф под класс: список подставлен'); };
$('rbSessStop').onclick = async () => {
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ rbSess: { ...(rt.rbSess || {}), on: false, end: Date.now(), sum: rt.rbSess?.sum || null } });
  await setMode('auto');
  toast('РБ-сессия остановлена — автофарм');
};
document.querySelectorAll('#quickModeGrid [data-mode]').forEach(b => { b.classList.toggle('on', b.dataset.mode === m); b.classList.toggle('stopped', b.dataset.mode === m && !on); });
  $('campToggle').classList.toggle('on', !!d.campaign); $('tvtToggle').classList.toggle('on', !!d.tvtOn); paintRbToggle(d);
  document.querySelectorAll('#quickModeGrid [data-task]').forEach(b => b.classList.toggle('on', d[b.dataset.task] !== false));
  const mods = [d.campaign && '📜 кампания', rbEff(d) && m !== 'rb' && '👑 РБ между мобами', d.tvtOn && '⚔ TvT'].filter(Boolean);
  const ms = $('modeSummary'); if (ms) ms.textContent = `${MODE_NAME[m]}${on ? '' : ' (бот стоит)'}${mods.length ? ' · + ' + mods.join(', ') : ''}`;
}
// 7.1.31: меню под класс — у мага скрыты воинские блоки (энергия силы, спойл, тотемы/Frenzy, станы, кастеты…), у воина — «Слуга» и дебаффы мага.
// Класс — как у движка (combatProfileKind): профиль из «Боя» или профессия героя. «👁 Показать настройки всех классов» — всё сразу
const MAGE_PROF = /\b(?:mage|mystic|wizard|warlock|summoner|arcana lord|sorcer|necromancer|bishop|prophet|cleric|spellhowler|spellsinger|oracle|elder|shaman|overlord|warcryer)\b/i;
// 9.2: профиль класса — как у движка (modules/fightlab.js role(): саммонер/нюкер/лекарь/спойлер/Дестр/Тиран/…); профессия — из ответов
// игры (rt.classCur.prof, смена саба) или со страницы персонажа (rt.prof); незнакомая — по ветке класса rt.classBranch (mystic/fighter)
let FL_RT = {};
const FL = (typeof L2V7Factories !== 'undefined' && L2V7Factories.fightlab) ? L2V7Factories.fightlab({ get rt() { return FL_RT; }, cfg: {}, rec() {}, setRt() { return Promise.resolve(); } }) : null;
function heroRole(rt) {
  const prof = rt.classCur?.prof || rt.prof || '';
  if (!prof) return rt.classBranch ? { id: rt.classBranch === 'mystic' ? 'nuker' : 'fighter', label: rt.classBranch === 'mystic' ? 'маг (по ветке класса)' : 'воин (по ветке класса)', mage: rt.classBranch === 'mystic', pet: false, spoil: false, prof: '' } : null;
  if (FL) return FL.role(prof);
  const mage = MAGE_PROF.test(String(prof));
  return { id: mage ? 'summoner' : 'fighter', label: mage ? 'маг' : 'воин', mage, pet: mage, spoil: SPOIL_PROF.test(String(prof)), prof: String(prof) };
}
function heroCls(d, rt) {
  if (d.combatProfile === 'fighter') return 'fighter';
  if (d.combatProfile === 'mage_summoner') return 'mage';
  const r = heroRole(rt); return r ? (r.mage ? 'mage' : 'fighter') : '';
}
let showAllCls = (() => { try { return localStorage.getItem('showAllCls') === '1'; } catch (e) { return false; } })();
// 7.2: спойлер (гном: Dwarven Fighter/Scavenger/Bounty Hunter/Fortune Seeker или спойл в роли «Спойл») — блок «Спойл» виден только ему
const SPOIL_PROF = /\b(?:dwarven fighter|scavenger|bounty hunter|fortune seeker)\b/i;
function paintCls(d, rt) {
  FL_RT = rt;
  const cls = heroCls(d, rt), root = document.documentElement, role = heroRole(rt);
  const spoil = !!role?.spoil || SPOIL_PROF.test(String(rt.prof || '')) || !!String(d.nSpoil || '').trim();
  // кот — подраздел Warlock: профиль «маг» руками или саммонер по профессии; пока профессия неизвестна, у мага кот показан (вдруг он есть)
  const summoner = cls === 'mage' && (d.combatProfile === 'mage_summoner' || !role || role.pet || !role.prof || !!rt.petStat);
  root.classList.toggle('cls-mage', cls === 'mage'); root.classList.toggle('cls-fighter', cls === 'fighter'); root.classList.toggle('cls-spoil', spoil);
  root.classList.toggle('cls-summoner', summoner); root.classList.toggle('show-all', showAllCls);
  const b = $('showAllCls'); if (b) b.textContent = showAllCls ? '🙈 Только настройки моего класса' : '👁 Показать настройки всех классов';
  const who = role?.label || (cls === 'mage' ? 'маг' : 'воин'), pf = profLabel(rt);
  const n = $('clsNote'); if (n) n.textContent = !cls ? 'Класс ещё не определён — показаны все подразделы.' : showAllCls ? 'Показаны настройки всех классов.' : cls === 'mage'
    ? `Класс: ${who} (${pf}) — показаны «${summoner ? 'Warlock — маг с котом» и «' : ''}Маг»; подразделы спойлера и воина скрыты.`
    : spoil ? `Класс: спойлер (${pf}) — показаны «Спойлер» и «Воин»; подразделы мага и кота скрыты.`
    : `Класс: ${who} (${pf}) — показан «Воин»; подразделы мага, кота и спойлера скрыты.`;
  renderClsBox(d, rt, role, cls);
}
const profLabel = rt => String(rt.classCur?.prof || rt.prof || '').replace(/^(human|elf|dark_elf|orc|dwarf|kamael)_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'профессия неизвестна';
// 9.2: «Класс и профиль боя» — что бот знает о герое и как под него подстроился
function renderClsBox(d, rt, role, cls) {
  const box = $('clsBox'); if (!box) return;
  const manual = d.combatProfile && d.combatProfile !== 'auto';
  const skills = Object.values(rt.skills || {}), measured = skills.filter(p => p.dmgN >= 3).length, fresh = skills.filter(p => p.kind === 'скилл' && (p.uses || 0) > 0 && (p.dmgN || 0) < 3 && !p.heal && !p.buffSec).length;
  const slot = rt.classCur?.slot != null ? (rt.classCur.slot ? ` · саб ${rt.classCur.slot}` : ' · основной класс') : '';
  const stash = Object.keys(rt.classStash || {}).filter(k => k && k !== rt.classCur?.prof);
  const lines = [
    `Профессия: ${profLabel(rt)}${rt.lvl ? ' ' + rt.lvl + ' ур.' : ''}${slot}${rt.classBranch ? ` · ветка ${rt.classBranch === 'mystic' ? 'маг' : 'воин'}` : ''}`,
    `Профиль боя: ${manual ? (d.combatProfile === 'fighter' ? 'воин (выбран вручную)' : 'маг (выбран вручную)') : role ? `${role.label} (авто)` : cls ? `${cls === 'mage' ? 'маг' : 'воин'} (авто)` : 'ещё не определён'}`
      + (role?.pet ? ' · кот — основной урон' : '') + (role?.spoil ? ' · спойл в начале боя' : '') + (role?.frenzy ? ' · Frenzy/Guts при низком HP' : '') + (role?.force ? ' · энергия силы' : ''),
    `Скиллы: замерено ${measured}${fresh ? `, ещё пробуются ${fresh}` : ''}${rt.turnMs ? ` · ход ≈${(rt.turnMs / 1000).toFixed(2)} с` : ''}`,
    stash.length ? `Память других классов: ${stash.map(k => profLabel({ prof: k })).join(', ')} (вернётся при смене саба)` : '',
  ].filter(Boolean);
  box.textContent = lines.join('\n');
}
// 9.2: «Память боя» — rt.fightMem (цели этого класса) и последний разобранный бой rt.fightLast
function renderFight(rt) {
  const box = $('fightBox'); if (!box) return;
  FL_RT = rt;
  const M = rt.fightMem || {}, keys = Object.keys(M), rb = keys.filter(k => k.startsWith('rb:')), ch = keys.filter(k => k.startsWith('ch:')), mob = keys.filter(k => k.startsWith('m:'));
  const L = rt.fightLast, out = [];
  if (L) out.push(`Последний бой: ${L.name}${L.rb ? ' (РБ)' : L.champ ? ' (чемпион)' : ''} — ${L.outcome === 'win' ? 'победа' : L.outcome === 'lose' ? 'смерть' : 'бой окончен'} за ${L.sec} с, ходов ${L.turns}, урон ${L.dealt}${L.pet ? ' + кот ' + L.pet : ''}${L.dps ? ` (≈${L.dps}/с)` : ''}${L.pots ? `, банок ${L.pots}` : ''}${L.lost ? `, потерянных ходов ${L.lost}` : ''}`);
  out.push(`Целей в памяти: ${keys.length} (РБ ${rb.length}, чемпионов ${ch.length}, видов мобов ${mob.length})`);
  const byT = a => a.sort((x, y) => (M[y].t || 0) - (M[x].t || 0));
  const line = k => FL ? FL.brief(k) : `${M[k].nm}: боёв ${M[k].n}`;
  if (rb.length) out.push('РБ:\n' + byT(rb).slice(0, 8).map(k => '• ' + line(k)).join('\n'));
  if (ch.length) out.push('Чемпионы:\n' + byT(ch).slice(0, 5).map(k => '• ' + line(k)).join('\n'));
  if (mob.length) out.push('Мобы (последние):\n' + byT(mob).slice(0, 8).map(k => '• ' + line(k)).join('\n'));
  box.textContent = keys.length || L ? out.join('\n') : 'Боёв с анализом ещё нет — появится после первых боёв на 9.2';
}
// 9.2: «☠ Лист врагов» — rt.enemies (кто убил героя); у каждого: не трогать / убрать из листа
const EN = typeof L2V7Factories !== 'undefined' && L2V7Factories.enemies ? L2V7Factories.enemies({ rt: {}, cfg: {} }) : null;
function renderEnemies(rt) {
  const box = $('enemyBox'); if (!box) return;
  const E = rt.enemies || {}, keys = Object.keys(E).sort((a, b) => (E[b].lastKill || 0) - (E[a].lastKill || 0));
  const sig = JSON.stringify(E); if (box.dataset.sig === sig) return; box.dataset.sig = sig;
  box.textContent = '';
  if (!keys.length) { box.textContent = 'Лист пуст — сюда попадут игроки, которые убьют героя'; return; }
  for (const k of keys) {
    const e = E[k], item = document.createElement('div'), row = document.createElement('div'); row.className = 'row'; item.style.margin = '4px 0 8px';
    const t = document.createElement('div'); t.textContent = '☠ ' + (EN ? EN.brief(e) : `${e.name}: убил нас ${e.kills || 0}×`);
    const ig = document.createElement('button'); ig.textContent = e.ignore ? '⚔ Нападать' : '🚫 Не трогать'; ig.title = e.ignore ? 'Снова нападать на этого врага' : 'Оставить в листе, но не нападать';
    ig.onclick = async () => { const { rt: r = {} } = await chrome.storage.local.get('rt'); const X = { ...(r.enemies || {}) }; if (!X[k]) return;
      X[k] = { ...X[k], ignore: !X[k].ignore, blockLvl: 0, skipT: 0, skipWhy: '' }; await menuPatch({ enemies: X }); toast(X[k].ignore ? `${e.name}: не трогать` : `${e.name}: снова враг`); };
    const rm = document.createElement('button'); rm.textContent = '🗑'; rm.title = 'Убрать из листа врагов';
    rm.onclick = async () => { const { rt: r = {} } = await chrome.storage.local.get('rt'); const X = { ...(r.enemies || {}) }; delete X[k]; await menuPatch({ enemies: X }); toast(`${e.name} убран из листа`); };
    row.append(ig, rm); item.append(t, row); box.append(item);
  }
}
confirmClick('fightMemReset', async () => {
  await menuPatch({ fightMem: {}, fightLast: null });
  toast('Память боя этого класса очищена');
});
$('showAllCls').onclick = async () => {
  showAllCls = !showAllCls; try { localStorage.setItem('showAllCls', showAllCls ? '1' : '0'); } catch (e) {}
  const { cfg = {}, rt = {} } = await chrome.storage.local.get(['cfg', 'rt']); paintCls({ ...DEF, ...cfg }, rt);
};
// выбор режима запускает бота (как и прежние кнопки) и выключает остальные режимы; дополнения не трогаем
const MODES_OFF = { epicMode: false, rbHuntMode: false, fishMode: false, catMode: false, taskOnly: false };
async function setMode(m) {
  await save();
  { const { rt = {} } = await chrome.storage.local.get('rt');   // 7.2.1: сменили режим руками — РБ-сессия окончена
    if (rt.rbSess?.on && m !== 'rb') await menuPatch({ rbSess: { ...rt.rbSess, on: false, end: Date.now() } });
    if (rt.rbOne?.on) await menuPatch({ rbOne: { ...rt.rbOne, on: false } }); }   // 8.0.3: режим выбран руками — «🎯 по одному РБ» выключен (тур — без остановок)
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  const now = Date.now(), leaveEpic = cfg.epicMode && m !== 'epic' ? { epic: { step: 'pick', t: now, last: 'режим выключен' } } : {};
  const leaveHunt = cfg.rbHuntMode && m !== 'rb' ? { rbHunt: { step: 'pick', t: now, last: 'тур выключен' }, rbGo: null } : {};
  const leave = { ...leaveEpic, ...leaveHunt };
  // 8.0.3: «РБ между мобами» вне тура — только по выбору игрока (rbBetween, по умолчанию выкл). Раньше тур включал rbMode, а переход на
  // фарм/автофарм/катакомбы его не выключал: бот продолжал бегать к РБ, и автофарм не летал по зонам. С 8.0.3 rbMode вычисляется в ядре (rbEff), здесь — только для совместимости хранилища
  const rbB = !!cfg.rbBetween;
  // 10.0 (игрок 12.10: «старт без быстрого режима»): режим снят — бот делает только включённые задачи (Маммон, квесты, цель фарма, TvT).
  // Снятие режима бота не запускает и не останавливает: работал — продолжает задачами, стоял — «▶ Старт» запустит задачи
  if (m === 'tasks') await menuPatch({ ...leave, zoneAutoKick: null, zoneGo: null, manualKickAt: now }, { cfgPatch: { ...MODES_OFF, zoneAuto: false, taskOnly: true, rbMode: rbB } });
  else if (m === 'farm') await activateMode({ ...leave, zoneAutoKick: null, zoneGo: null }, { ...MODES_OFF, zoneAuto: false, rbMode: rbB });
  // с автофармом включаем и цепочку «Охотиться дальше»: ≈5,4 с на моба против ≈11,4 с через карту
  else if (m === 'auto') await activateMode({ ...leave, zoneAutoKick: now, zoneGoT: 0, zoneLvlT: 0 }, { ...MODES_OFF, zoneAuto: true, chain: true, rbMode: rbB });
  else if (m === 'rb') await activateMode({ ...leaveEpic, rbHunt: { step: 'pick', t: now, last: 'тур запущен' }, rbGo: null, rbWant: null, rbListT: 0 }, { ...MODES_OFF, rbHuntMode: true, rbMode: true, campaign: false });
  else if (m === 'epic') await activateMode({ ...leaveHunt, epic: { step: 'pick', t: now, last: 'режим запущен' }, epicListT: 0, rbWant: null }, { ...MODES_OFF, epicMode: true, rbMode: false, campaign: false });
  else if (m === 'fish') await activateMode({ ...leave, fishTgt: null }, { ...MODES_OFF, fishMode: true, rbMode: false, campaign: false });
  else if (m === 'cat') await activateMode({ ...leave }, { ...MODES_OFF, catMode: true, campaign: false, rbMode: rbB });
  if (m === 'tasks') { const { on = false } = await chrome.storage.local.get('on'); toast(`${MODE_NAME.tasks}${on ? '' : ' · ▶ Старт запустит их'}`); }
  else toast(`Режим: ${MODE_NAME[m]}`);
}
// 10.0: повторное нажатие на включённый режим снимает его («без режима — только задачи»)
document.querySelectorAll('#quickModeGrid [data-mode]').forEach(b => { b.onclick = async () => {
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  const m = b.dataset.mode !== 'tasks' && currentMode({ ...DEF, ...cfg }) === b.dataset.mode ? 'tasks' : b.dataset.mode;
  return setMode(m).catch(e => toast(String(e?.message || e)));
}; });
// 10.0 (игрок 12.10: «ребилд быстрых режимов»): задачи вне режимов — тоже быстрыми кнопками (те же галочки, что в разделах)
document.querySelectorAll('#quickModeGrid [data-task]').forEach(b => { b.onclick = async () => {
  const k = b.dataset.task, { cfg = {} } = await chrome.storage.local.get('cfg'), v = !({ ...DEF, ...cfg })[k];
  await menuPatch({}, { cfgPatch: { [k]: v } });
  if ($(k) && 'checked' in $(k)) $(k).checked = v;
  b.classList.toggle('on', v); toast(`${b.textContent.trim()}: ${v ? 'включено' : 'выключено'}`);
}; });
$('tvtToggle').onclick = async () => {
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  await menuPatch({}, { cfgPatch: { tvtOn: !cfg.tvtOn } });
  toast(cfg.tvtOn ? '⚔ TvT выключен' : '⚔ TvT включён');
};
$('goalProof').onclick = () => { goalItemsMode = false; setGoals([]); };
$('goalItems').onclick = async () => { goalItemsMode = true; const { rt = {} } = await chrome.storage.local.get('rt'); renderGoals(rt); };
$('goalGrid').onclick = e => {
  const b = e.target.closest('[data-goal]');
  if (!b) return;
  const q = goalList($('fishGoal').value), id = b.dataset.goal;
  setGoals(q.includes(id) ? q.filter(x => x !== id) : [...q, id]);
};
$('bagCheck').onclick = async () => {
  await save();
  const { rt = {}, on = false } = await chrome.storage.local.get(['rt', 'on']);
  await menuPatch({ bagCheck: true });
  toast(on ? '🎒 Бот пересчитает сумку после боя' : '🎒 Пересчёт после ▶ Старт');   // 8.0: в #status текст стирала ближайшая перерисовка
};
confirmClick('lootReset', async () => {               // обнулить статистику добычи
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ lootStat: {}, mobKills: {}, lootStatT0: Date.now() });
});
$('farmScan').onclick = async () => {
  const { rt = {}, on = false } = await chrome.storage.local.get(['rt', 'on']);
  await menuPatch({ farmScan: true });
  toast(on ? 'База ресурсов: бот откроет форум после боя' : 'База обновится после ▶ Старт (или раскройте строки на странице «Фарм ресурсов» сами — они сохранятся)');   // 8.0: в #status текст стирала ближайшая перерисовка
};
$('farmReset').onclick = async () => {
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ farmGot: {} });
};
// 8.0: confirm() во встроенном меню Chrome молча блокирует — подтверждение вторым нажатием
confirmClick('petStatReset', async () => {
  await menuPatch({ petStat: {}, petAdvice: null });
  toast('🐱 Статистика котов сброшена');   // 8.0: в #status текст стирала ближайшая перерисовка
});
$('zoneScan').onclick = async () => {
  const { rt = {}, on = false } = await chrome.storage.local.get(['rt', 'on']);
  await menuPatch({ zoneScan: true });
  toast(on ? 'Список зон: бот откроет «Телепорт» после боя' : 'Список зон обновится после ▶ Старт (или откройте «Телепорт» — зоны читаются сами)');   // 8.0: в #status текст стирала ближайшая перерисовка
};
$('zoneBox').onclick = async e => {
  const b = e.target.closest('[data-zone]');
  if (!b) return;
  const { rt = {}, on = false } = await chrome.storage.local.get(['rt', 'on']);
  await menuPatch({ zoneGo: { id: b.dataset.zone, t: Date.now(), why: 'вручную' }, zoneGoT: 0 });
  toast(on ? `✈ Лечу: ${rt.zoneCat?.[b.dataset.zone]?.name || b.dataset.zone}` : '✈ Полёт начнётся после ▶ Старт');   // 8.0: в #status текст стирала ближайшая перерисовка
};
// ⚙ рекомендуемые (базовые) настройки рыбалки — выбраны игроком (v4.52): обычная наживка, заряды, докупка,
// 100 пакетов наживки (1000 шт. ≈ 680 рыб) и заряды под наживку (≈75 пакетов, кончаются вместе) — v4.56, без лимита, разделка каждые 100, Old Box
$('fishBest').onclick = async () => {
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  await menuPatch({}, { cfgPatch: { fishBait: 'auto', fishShots: true, fishAutoBuy: true, fishBuyPacks: 100, fishShotPacks: 750, fishShotAuto: true, fishMaxCasts: 0, fishProcess: true, fishProcessEvery: 100, fishOpenBoxes: true } });
  load();
};
$('fishReset').onclick = async () => {
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ fish: null, fishSess: null, fishDmg: null, fishCdStat: null });
};
$('campToggle').onclick = async () => {
  const { cfg = {}, rt = {} } = await chrome.storage.local.get(['cfg', 'rt']);
  if (!cfg.campaign) await activateMode({ campaignDue: true }, { campaign: true, fishMode: false, epicMode: false, rbHuntMode: false, rbMode: false, catMode: false });
  else await menuPatch({ campaignDue: false }, { cfgPatch: { campaign: false } });
};
// «🛒 Закупить сейчас» — бот бросает текущее дело (моба, РБ, рыбу, ожидание) и сразу идёт в магазин; потом возвращается
async function shopNowGo() {
  await save();
  const { rt = {}, cfg = {}, on = false } = await chrome.storage.local.get(['rt', 'cfg', 'on']);
  await menuPatch({ shop: { step: 'count', back: cfg.fishMode ? '/fishing.html' : '/map.html', t: Date.now(), force: true, urgent: true, why: 'вручную' } });
  $('shopBox').textContent = on ? '🛒 Иду в магазин прямо сейчас (текущий бой брошен)' : '⏳ Закупка начнётся после ▶ Старт';
  if (typeof toast === 'function') toast(on ? '🛒 Закупка — иду сейчас' : '🛒 Закупка — после ▶ Старт', 'var(--gold)');
}
$('shopNow').onclick = shopNowGo;
if ($('shopNowTop')) confirmClick('shopNowTop', shopNowGo);   // 8.0: бросает моба/РБ/рыбалку — вторым нажатием
$('campNow').onclick = async () => {
  const { rt = {}, cfg = {}, on = false } = await chrome.storage.local.get(['rt', 'cfg', 'on']);
  // Кампания выключена — разовая проверка (campOnce): бот прочитает главу и вернётся к охоте, без телепортов
  await menuPatch({ campaignDue: true, campOnce: !cfg.campaign });
  $('campBox').textContent = (on ? '⏳ Проверю кампанию после текущего боя' : '⏳ Проверю кампанию после ▶ Старт')
    + (cfg.campaign ? '' : ' (Кампания выключена — только прочитаю главу и вернусь к охоте)');
};
$('start').onclick = async () => {
  await save();
  const { rt = {} } = await chrome.storage.local.get('rt');
  await chrome.storage.local.set({ paused: null });
  await menuPatch({ ...((await chrome.storage.local.get('cfg')).cfg?.zoneAuto ? { zoneAutoKick: Date.now(), zoneGoT: 0, zoneLvlT: 0 } : {}), sinceDeep: 999, deepHot: false, scan: null, mobClickAt: 0, bounce: 0, mapReload: 0, campaignDue: true, deaths: [], manualKickAt: Date.now() }, { on: true });
  await showWakeResult();
};
$('stop').onclick = () => chrome.storage.local.set({ on: false, paused: null, stopMeta: { source: 'popup-stop', reason: 'Нажата кнопка Стоп', t: Date.now() } });
$('pause').onclick = async () => {
  const { on = false, paused = null } = await chrome.storage.local.get(['on', 'paused']);
  if (on) { await chrome.storage.local.set({ on: false, paused: { t: Date.now() }, stopMeta: { source: 'popup-pause', reason: 'Пауза', t: Date.now() } }); toast('⏸ Пауза — состояние сохранено'); }
  else if (paused) { await chrome.storage.local.set({ paused: null }); await menuPatch({ manualKickAt: Date.now() }, { on: true }); toast('▶ Продолжаю с того же места'); }
};
// 8.0: ↺ стирает статистику, раны РБ и добычу — только вторым нажатием (рядом 🛒 и Стоп, легко промахнуться)
confirmClick('reset', async () => {
  await menuPatch({ kills: 0, exp: 0, sp: 0, adena: 0, buffAt: {}, buffSeen: {}, quests: {}, rb: {}, rbBad: {}, rbKills: 0, loot: {}, lootSpecial: {}, lootValue: 0, sessT0: Date.now() });
});

// ---------- журнал: IndexedDB расширения (пишет фоновый скрипт, читает попап) ----------
const pad = (n, w = 2) => String(n).padStart(w, '0');
const tm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };
const fmtEv = e => [tm(e.t), `[${e.src}]`, e.kind, e.what,
  `| ${e.st?.page || ''} HP ${e.st?.hp || ''} MP ${e.st?.mp || ''}${e.st?.mob ? ' · моб ' + e.st.mob : ''}`,
  e.slots ? `| слоты: ${e.slots}` : '',
  e.added?.length ? `| +лог: ${e.added.join(' ⏎ ')}` : '',
  e.el ? `| эл: ${e.el}` : '',
  e.data?.q != null ? `| запрос: ${typeof e.data.q === 'string' ? e.data.q : JSON.stringify(e.data.q)}`.slice(0, 600) : '',
  e.data?.r ? `| ответ: ${e.data.r}` : ''].filter(Boolean).join(' ');
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
// v5.2: выгрузки — не больше 20 МБ. Берём события с конца (самые свежие), пока влезают в лимит; старые — отбрасываем
// и пишем в шапке, сколько не вошло. Файл собирается из частей (Blob), без одной гигантской строки в памяти.
const EXPORT_MAX = 6 * 1024 * 1024;
const u8len = t => { let n = t.length; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c > 0x7f) n += c > 0x7ff ? 2 : 1; } return n; };
function fitTail(lines, budget) {                 // lines — от старых к новым; вернёт хвост, который влезает в budget байт
  let used = 0, i = lines.length;
  while (i > 0) { const b = u8len(lines[i - 1]) + 1; if (used + b > budget) break; used += b; i--; }
  return { keep: lines.slice(i), cut: i, bytes: used };
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(Array.isArray(text) ? text : [text], { type: type + ';charset=utf-8' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

let dbp = null;
function idb() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('l2bot', 3);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('log')) d.createObjectStore('log', { autoIncrement: true });
      if (!d.objectStoreNames.contains('snaps')) d.createObjectStore('snaps', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('shots')) d.createObjectStore('shots', { autoIncrement: true });   // v5.1: скриншоты автообучения
      const ss = r.transaction.objectStore('snaps');
      if (!ss.indexNames.contains('t')) ss.createIndex('t', 't');      // время снимка — для «новых» без чтения разметки
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
}
// чтение журнала: { after } — ключи больше after; { since } — время ≥ since; { last } — последние N
async function readLog({ after = null, since = 0, last = 0 }) {
  const db = await idb();
  return new Promise((res, rej) => {
    const out = [], st = db.transaction('log').objectStore('log');
    const back = !!(last || since);
    const c = st.openCursor(after != null ? IDBKeyRange.lowerBound(after, true) : null, back ? 'prev' : 'next');
    c.onsuccess = e => {
      const cur = e.target.result;
      if (!cur || (last && out.length >= last) || (since && cur.value.t < since)) return res(back ? out.reverse() : out);
      out.push([cur.key, cur.value]); cur.continue();
    };
    c.onerror = () => rej(c.error);
  });
}
async function countAfter(after) {
  const db = await idb();
  return new Promise(res => {
    const r = db.transaction('log').objectStore('log').count(after != null ? IDBKeyRange.lowerBound(after, true) : null);
    r.onsuccess = () => res(r.result); r.onerror = () => res(0);
  });
}
async function readSnaps(sinceT = 0) {
  const db = await idb();
  return new Promise(res => {
    const r = db.transaction('snaps').objectStore('snaps').index('t').getAll(IDBKeyRange.lowerBound(sinceT, true));
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
}
async function countSnaps(sinceT = 0) {
  const db = await idb();
  return new Promise(res => {
    const r = db.transaction('snaps').objectStore('snaps').index('t').count(IDBKeyRange.lowerBound(sinceT, true));
    r.onsuccess = () => res(r.result); r.onerror = () => res(0);
  });
}

// v5.6: счёт «новых с прошлой выгрузки» — проход курсором по базе журнала (до 100 000 записей). Раньше — при каждой перерисовке
// меню (до 3 раз в секунду, пока бот работает). Теперь — только когда строку видно и не чаще раза в 10 с
let countsT = 0, countsBusy = false;
async function showCounts(reccount, snapcount, force) {
  const el = $('recCount');
  if (!el || countsBusy || (!force && (!el.offsetParent || Date.now() - countsT < 10000))) return;
  countsBusy = true; countsT = Date.now();
  try { await showCounts0(reccount, snapcount); } finally { countsBusy = false; }
}
async function showCounts0(reccount, snapcount) {
  const { exLogKey = null, exSnapT = 0 } = await chrome.storage.local.get(['exLogKey', 'exSnapT']);
  const nNew = await countAfter(exLogKey);
  const sNew = await countSnaps(exSnapT);
  $('recCount').textContent = `Журнал: ${fmt(reccount)} событий (до 100 000), новых с прошлой выгрузки: ${fmt(nNew)}`
    + ` · снимков: ${snapcount} (новых: ${sNew}, до 1000)`;
}

async function exportLog(rows, title, markNew) {   // 8.0: вернёт true, если файл скачан (для «📤 Логи для разбора»)
  if (!rows.length) { $('recCount').textContent = `${title}: событий нет`; return false; }
  const { cfg = {}, rt = {} } = await chrome.storage.local.get(['cfg', 'rt']);
  const head = `# L2wap Bot v${chrome.runtime.getManifest().version} — журнал: ${title} · ${rows.length} событий · ${new Date(rows[0][1].t).toLocaleString('ru')} — ${new Date(rows.at(-1)[1].t).toLocaleString('ru')}\n`
    + `# [U] ваш клик · [B] бот · [S] страница/сессия/снимок · [N] сеть (запросы игры к серверу) · [G] сообщения игры · [L] автообучение (изменения игры)\n`
    + `# Настройки: ${JSON.stringify(cfg)}\n`
    + `# Панель: ${(rt.panel || []).map(x => `#${x.idx} ${x.name} [${x.kind}${x.cdKey ? ', cd=' + x.cdKey : ''}${x.img ? ', ' + x.img : ''}]`).join(' · ')}\n`
    + `# Скиллы (по наблюдениям): ${Object.entries(rt.skills || {}).filter(([, p]) => p.uses || p.dmgN).map(([k, p]) => ({ ...p, name: p.name || k })).map(p => `${p.name}: исп ${p.uses || 0} (ваших ${p.usesU || 0})`
        + (p.dmgN ? `, урон≈${Math.round(p.dmg / p.dmgN)}` : '') + (p.mpN ? `, MP≈${Math.round(p.mp / p.mpN)}` : '')
        + (p.cd ? `, КД ${p.cd}с` : '') + (p.buffSec ? `, бафф ${p.buffSec}с` : '') + (p.stun ? `, стан×${p.stun}` : '')
        + (p.heal ? `, HP+${p.heal}` : '') + (p.mpGain ? `, MP+${p.mpGain}` : '')).join(' | ')}\n`
    + `# Квесты: ${JSON.stringify(rt.quests || {})}\n`
    + `# Оружие: профессия ${rt.prof || '?'} · в класс ${(rt.weaponRec?.types || []).join('/') || '?'} · рекомендую ${rt.weaponRec?.main || '—'} · инвентарь: ${(rt.weapons || []).map(w => `${w.name} [${w.wt}, ${w.g}, P${w.pa}${w.where === 'надето' ? ', надето' : ''}]`).join(' | ') || '—'}\n`
    + `# Эффективность: ${JSON.stringify(rt.eff || {})} · добыча особая: ${JSON.stringify(rt.lootSpecial || {})} · цепочка (цели): ${JSON.stringify(rt.chainQ || [])}\n`
    + `# Надёжность: сбоев за 10 мин ${(rt.errs || []).filter(t => Date.now() - t < 600000).length} · КД (замер): ${Object.entries(rt.skills || {}).filter(([, p]) => p.cd).map(([k, p]) => `${k} ${p.cd}`).join(', ') || '—'}\n`
    + `# РБ: ${Object.values(rt.rbDb || {}).map(d => `${d.name}(${d.lvl})=${d.verdict || '?'}@${d.zone || '?'}`).join(', ') || '—'} · форум: ${Object.keys(rt.rbForum || {}).length} · тур: ${cfg.rbTour ? 'вкл' : 'выкл'}\n`
    + `# Локации: сейчас ${rt.zone || '?'} · ${Object.entries(rt.zoneStat || {}).map(([z, v]) => z + ' ' + Object.entries(v).map(([l, e]) => `ур${l}:${e.n}б/${Math.round(e.exp / e.sec * 3600)}EXPч/${e.pn ? (e.pct / e.sec * 3600 * e.n / e.pn).toFixed(1) : '?'}%ч`).join(',')).join(' | ') || '—'} · закупка: ${rt.shopLast ? rt.shopLast.text : '—'}\n`
    + `# Энергия: ${JSON.stringify(rt.force || {})} · бесплатные удары: ${Object.keys(rt.forceFree || {}).join(', ') || '—'} · ход ${rt.turnMs || '?'} мс · ДПС: ${JSON.stringify(rt.dps || {})}\n`
    + `# Умения (магистр): ${Object.values(rt.skillDb || {}).map(i => `${i.name}${i.rank ? ' р.' + i.rank : ''}: ${i.passive ? 'пассив' : `MP ${i.mp} · сила ${i.power} · КД ${i.cd}${i.force ? ' · эн. ' + i.force : ''}${i.fists ? ' · кастеты' : ''}`}`).join(' | ') || '—'}\n`
    + `# Глава: ${rt.campaign ? rt.campaign.title + ' · ' + rt.campaign.targets.map(t => `${t.name} ${t.done}/${t.total}${t.ok ? ' ✓' : ''}`).join(' · ') : '—'} · метки лога: ${JSON.stringify(rt.qAlias || {})}\n\n`;
  const lines = rows.map(([, e]) => fmtEv(e).slice(0, 4000)), sum = logSummary(rows);
  const f = fitTail(lines, EXPORT_MAX - u8len(head) - u8len(sum) - 400);
  const cutNote = f.cut ? `# ⚠ Лимит файла 20 МБ: ${fmt(f.cut)} самых старых событий не вошли (в файле последние ${fmt(f.keep.length)}, с ${tm(rows[f.cut][1].t)})\n\n` : '';
  download(`l2bot-log-${stamp()}.txt`, [head, cutNote, sum, f.keep.join('\n')]);
  if (f.cut && typeof toast === 'function') toast(`Журнал урезан до 20 МБ: последние ${fmt(f.keep.length)} событий`, 'var(--warn)');
  if (markNew) await chrome.storage.local.set({ exLogKey: rows.at(-1)[0] });
  load();
  return true;
}
// сводка для анализа: события по типам, запросы к серверу (число, среднее время, ошибки), сообщения игры, изменения
function logSummary(rows) {
  const by = {}, net = {}, gm = {}, err = {}, learn = [];
  for (const [, e] of rows) {
    const k = `[${e.src}] ${e.kind}`; by[k] = (by[k] || 0) + 1;
    if (e.src === 'N') {
      const m = String(e.what).match(/^(\S+ \S+).*?→ (\S+)(?: · (\d+) мс)?/);
      if (m) { const x = net[m[1]] ||= { n: 0, ms: 0, msN: 0, bad: 0 }; x.n++; if (m[3]) { x.ms += +m[3]; x.msN++; } if (!/^2\d\d$/.test(m[2])) x.bad++; }
    }
    if (e.src === 'G') gm[e.what] = (gm[e.what] || 0) + 1;
    if (/ошибка/.test(e.kind)) { const w = String(e.what).slice(0, 90); err[w] = (err[w] || 0) + 1; }
    if (e.src === 'L') learn.push(`${tm(e.t)} ${e.what}`);
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => (b[1].n ?? b[1]) - (a[1].n ?? a[1])).slice(0, n);
  return `# ===== СВОДКА =====\n# События: ${top(by, 30).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`
    + `# Запросы к серверу (${Object.keys(net).length} видов): ${top(net, 25).map(([k, x]) => `${k} ×${x.n}${x.msN ? ' ~' + Math.round(x.ms / x.msN) + 'мс' : ''}${x.bad ? ' ⚠' + x.bad : ''}`).join(' | ') || '—'}\n`
    + `# Сообщения игры: ${top(gm, 25).map(([k, v]) => `«${k.slice(0, 70)}» ×${v}`).join(' | ') || '—'}\n`
    + `# Ошибки: ${top(err, 10).map(([k, v]) => `${k} ×${v}`).join(' | ') || '—'}\n`
    + `# Изменения игры (автообучение): ${learn.slice(-20).join(' | ') || '—'}\n# ==================\n\n`;
}
$('exJson').onclick = async () => {
  const n = Math.max(50, Math.min(20000, +$('recN').value || 20000));
  const rows = await readLog({ last: n });
  if (!rows.length) { $('recCount').textContent = 'JSON: событий нет'; return; }
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  const head = JSON.stringify({ l2botLog: 1, v: chrome.runtime.getManifest().version, t: Date.now(), n: rows.length, cfg: { ...cfg } });
  const f = fitTail(rows.map(([k, e]) => JSON.stringify({ k, ...e })), EXPORT_MAX - u8len(head) - 200);
  download(`l2bot-log-${stamp()}.jsonl`, [head, '\n', f.keep.join('\n')], 'application/x-ndjson');
  if (f.cut && typeof toast === 'function') toast(`JSON урезан до 20 МБ: последние ${fmt(f.keep.length)} событий`, 'var(--warn)');
};
$('exNew').onclick = async () => {
  const { exLogKey = null } = await chrome.storage.local.get('exLogKey');
  exportLog(await readLog({ after: exLogKey }), 'новое с прошлой выгрузки', true);
};
$('exToday').onclick = async () => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  exportLog(await readLog({ since: d.getTime() }), 'сегодня', true);
};
$('exLast').onclick = async () => {
  const n = Math.max(50, Math.min(20000, +$('recN').value || 20000));
  exportLog(await readLog({ last: n }), `последние ${n}`, true);
};

async function exportSnaps(list, title) {
  if (!list.length) { $('recCount').textContent = `${title}: нет — походите по разделам игры с включённой записью`; return false; }
  list.sort((a, b) => a.t - b.t);
  const f = fitTail(list.map(x => `\n<!-- ===== ${x.state || x.key} · ${new Date(x.t).toLocaleString('ru')} · ${x.key} ===== -->\n${x.html}`), EXPORT_MAX - 200000);
  const inc = list.slice(f.cut);
  download(`l2wap-pages-${stamp()}.html`, [`<!-- L2wap: ${title}, ${inc.length} шт.${f.cut ? ` (ещё ${f.cut} старых не вошли — лимит 20 МБ)` : ''}:\n${inc.map(x => '  ' + (x.state || x.key)).join('\n')}\n-->\n`, f.keep.join('\n')], 'text/html');
  await chrome.storage.local.set({ exSnapT: Math.max(...list.map(x => x.t)) });
  load();
  return true;
}
$('snapNew').onclick = async () => { const { exSnapT = 0 } = await chrome.storage.local.get('exSnapT'); exportSnaps(await readSnaps(exSnapT), 'новые снимки'); };
$('snapAll').onclick = async () => exportSnaps(await readSnaps(0), 'все снимки');

$('recDom').onclick = async () => {
  try {
    const r = await chrome.tabs.sendMessage((await activeTab()).id, { cmd: 'dom' });
    download(`l2wap-${r.page}-${stamp()}.html`, r.html, 'text/html');
  } catch { toast('⚠ Откройте вкладку l2wap.com'); }
};
// ---------- 💾 память бота: сохранить в файл / загрузить из файла (переживает переустановку расширения) ----------
const MEM_SKIP = new Set(['auth', 'on', 'reccount', 'snapcount', 'exLogKey', 'exSnapT', 'hbBg', 'wdog', 'lock', 'wdDown', 'stopMeta', 'paused']);   // логин/пароль и служебное — не сохраняем (8.0: и замок вкладки, метка простоя, причина остановки, пауза)
$('memSave').onclick = async () => {
  const all = await chrome.storage.local.get(null);
  const data = Object.fromEntries(Object.entries(all).filter(([k]) => !MEM_SKIP.has(k)));
  const rt = data.rt || {};
  download(`l2bot-memory-${rt.char || 'hero'}-${stamp()}.json`, JSON.stringify({ l2bot: 1, v: chrome.runtime.getManifest().version, t: Date.now(), data }), 'application/json');
  $('memNote').textContent = `✅ Сохранено: РБ в базе ${Object.keys(rt.rbDb || {}).length}, скиллов ${Object.keys(rt.skills || {}).length}, зон ${Object.keys(rt.zoneStat || {}).length}. Файл — в «Загрузках».`;
};
$('memLoad').onclick = () => $('memFile').click();
// 🧠 автообучение: сводка, отчёт, сброс
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'только что' : m < 60 ? m + ' мин назад' : m < 1440 ? Math.round(m / 60) + ' ч назад' : Math.round(m / 1440) + ' дн назад'; };
async function renderLearn() {
  const { learn } = await chrome.storage.local.get('learn');
  if (!learn) { $('learnBox').textContent = 'Данных ещё нет — бот учится по ходу игры.'; return; }
  const sel = Object.values(learn.sel || {}).reduce((a, p) => a + Object.keys(p).length, 0);
  const bad = Object.entries(learn.sel || {}).flatMap(([pg, P]) => Object.entries(P).filter(([, x]) => x.alert).map(([k]) => `${pg}: ${k}`));
  const ch = learn.changes || [];
  $('learnBox').textContent = `Учусь с ${new Date(learn.t0).toLocaleDateString('ru')} · страниц ${Object.keys(learn.pages || {}).length} · селекторов ${sel} · запросов API ${Object.keys(learn.api || {}).length}\n`
    + (bad.length ? `⚠ Сейчас не находятся: ${bad.length} — ${bad.slice(0, 3).join(' · ')}\n` : '✅ Все элементы, на которые опирается бот, находятся\n')
    + (ch.length ? `Изменения игры (${ch.length}):\n` + ch.slice(0, 5).map(c => `• ${ago(c.t)} · ${c.kind}: ${c.what}`.slice(0, 160)).join('\n') : 'Изменений игры пока не замечено');
}
let learnT = null;
chrome.storage.onChanged.addListener(ch => { if (ch.learn && !learnT) learnT = setTimeout(() => { learnT = null; if (document.querySelector('#tab-svc.act')) renderLearn(); }, 2000); });
document.querySelector('nav button[data-tab="svc"]')?.addEventListener('click', () => renderLearn());
renderLearn();
$('learnShots').addEventListener('change', async e => {
  if (!e.target.checked) return;
  let ok = false;
  try { ok = await chrome.permissions.request({ origins: ['<all_urls>'] }); } catch (er) {}
  if (!ok) { e.target.checked = false; await save(); toast?.('Скриншоты: Chrome не дал разрешения', 'var(--bad)'); }
});
confirmClick('learnReset', async () => { await chrome.storage.local.remove('learn'); renderLearn(); toast?.('↺ База автообучения сброшена'); });
const readShots = async () => {
  try { const db = await idb(); return await new Promise(res => { const out = []; const c = db.transaction('shots').objectStore('shots').openCursor(null, 'prev');
    c.onsuccess = e => { const cur = e.target.result; if (!cur || out.length >= 60) return res(out); out.push(cur.value); cur.continue(); }; c.onerror = () => res(out); }); } catch (e) { return []; }
};
async function learnReportDl() {
  const { learn = {}, cfg = {}, rt = {} } = await chrome.storage.local.get(['learn', 'cfg', 'rt']);
  const shots = await readShots();
  const h = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const dt = t => t ? new Date(t).toLocaleString('ru') : '—';
  const selRows = Object.entries(learn.sel || {}).flatMap(([pg, P]) => Object.entries(P).map(([k, x]) => ({ pg, k, ...x, rate: x.h / Math.max(1, x.v) })))
    .sort((a, b) => (b.alert ? 1 : 0) - (a.alert ? 1 : 0) || b.ms - a.ms || b.v - a.v);
  const apiRows = Object.entries(learn.api || {}).sort((a, b) => b[1].n - a[1].n);
  const css = 'body{font:13px system-ui;background:#14100d;color:#efe6d6;margin:20px;max-width:1200px}h1{color:#f0cf86}h2{color:#d4a856;border-bottom:1px solid #3a2f24;padding-bottom:4px;margin-top:28px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid #3a2f24;padding:4px 6px;text-align:left;vertical-align:top}th{color:#a39280}tr.bad td{color:#e06352}code{color:#f0cf86;word-break:break-all}.dim{color:#a39280}img{max-width:100%;border:1px solid #3a2f24;border-radius:8px;margin:6px 0}.shot{margin:14px 0}';
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>L2wap Bot — отчёт автообучения</title><style>${css}</style></head><body>`
    + `<h1>🧠 Отчёт автообучения</h1><p class="dim">L2wap Bot v${h(chrome.runtime.getManifest().version)} · герой ${h(rt.char || '?')} ${rt.lvl || ''} ур. · учится с ${dt(learn.t0)} · отчёт ${dt(Date.now())}</p>`
    + `<h2>Изменения игры (${(learn.changes || []).length})</h2><table><tr><th>Когда</th><th>Страница</th><th>Что</th><th>Версия</th></tr>`
    + (learn.changes || []).map(c => `<tr><td>${dt(c.t)}</td><td>${h(c.page)}</td><td><b>${h(c.kind)}</b>: ${h(c.what)}</td><td>${h(c.v)}</td></tr>`).join('') + '</table>'
    + `<h2>Селекторы бота (${selRows.length}) — сверху проблемные</h2><table><tr><th>Страница</th><th>Селектор</th><th>Заходов</th><th>Нашёлся</th><th>Подряд нет</th></tr>`
    + selRows.slice(0, 400).map(x => `<tr class="${x.alert ? 'bad' : ''}"><td>${h(x.pg)}</td><td><code>${h(x.k)}</code></td><td>${x.v}</td><td>${Math.round(x.rate * 100)} %</td><td>${x.ms || ''}</td></tr>`).join('') + '</table>'
    + `<h2>Страницы (${Object.keys(learn.pages || {}).length})</h2><table><tr><th>Страница</th><th>Заходов</th><th>Элементов в структуре</th><th>Сейчас под наблюдением</th></tr>`
    + Object.entries(learn.pages || {}).sort((a, b) => b[1].n - a[1].n).map(([pg, P]) => `<tr><td>${h(pg)}</td><td>${P.n}</td><td>${Object.keys(P.tok || {}).length}</td><td class="dim">${h([...Object.keys(P.gone || {}).map(t => '−' + t), ...Object.keys(P.neu || {}).map(t => '+' + t)].slice(0, 12).join(' '))}</td></tr>`).join('') + '</table>'
    + `<h2>Запросы игры к серверу (${apiRows.length})</h2><table><tr><th>Запрос</th><th>Раз</th><th>Статусы</th><th>Поля ответа</th><th>Первый / последний</th></tr>`
    + apiRows.map(([k, x]) => `<tr><td><code>${h(k)}</code><div class="dim">${h(x.page || '')}</div></td><td>${x.n}</td><td>${h(Object.entries(x.st || {}).map(([s, n]) => s + '×' + n).join(' '))}</td><td class="dim">${h(Object.keys(x.keys || {}).slice(0, 40).join(', '))}</td><td class="dim">${dt(x.first)}<br>${dt(x.last)}</td></tr>`).join('') + '</table>'
    + `<h2>Скриншоты (${shots.length})</h2>` + (shots.length ? shots.map(s => `<div class="shot"><div><b>${dt(s.t)}</b> · ${h(s.page)} · ${h(s.reason)}</div><img src="${s.url}" alt=""></div>`).join('') : '<p class="dim">Нет — включите «📷 Скриншоты при изменениях».</p>')
    + `<h2>Настройки</h2><pre class="dim" style="white-space:pre-wrap">${h(JSON.stringify(cfg, null, 1))}</pre></body></html>`;
  download(`l2bot-learn-${stamp()}.html`, html, 'text/html');
  toast?.('⬇ Отчёт автообучения сохранён');
}
$('learnReport').onclick = learnReportDl;
// 8.0 (аудит меню): «📤 Логи для разбора» — то, что игрок присылает на разбор, одним нажатием и по очереди:
// журнал (новое с прошлой выгрузки; нового нет — за сегодня), новые снимки страниц, отчёт автообучения
async function exportAll() {
  const btn = $('logsAll'), note = $('logsNote'); if (!btn || btn.disabled) return;
  const label = btn.textContent, done = [], gap = () => new Promise(r => setTimeout(r, 800));   // пауза: Chrome принимает файлы по одному
  btn.disabled = true; btn.textContent = '⏳ Собираю логи…';
  try {
    const { exLogKey = null, exSnapT = 0 } = await chrome.storage.local.get(['exLogKey', 'exSnapT']);
    let rows = await readLog({ after: exLogKey }), title = 'новое с прошлой выгрузки';
    if (!rows.length) { const t0 = new Date(); t0.setHours(0, 0, 0, 0); rows = await readLog({ since: t0.getTime() }); title = 'сегодня'; }
    done.push(await exportLog(rows, title, true) ? `журнал (${fmt(rows.length)} событий, ${title})` : 'журнал: событий нет');
    await gap();
    const snaps = await readSnaps(exSnapT);
    done.push(await exportSnaps(snaps, 'новые снимки') ? `снимки страниц (${snaps.length})` : 'новых снимков нет');
    await gap();
    await learnReportDl(); done.push('отчёт автообучения');
    note.textContent = `⬇ ${done.join(' · ')} — в «Загрузках». Если Chrome спросит «Скачать несколько файлов?» — нажмите «Разрешить».`;
  } catch (e) { note.textContent = '⚠ Выгрузка прервалась: ' + String(e?.message || e) + (done.length ? ` (успело: ${done.join(', ')})` : ''); }
  finally { note.hidden = false; btn.disabled = false; btn.textContent = label; }
}
if ($('logsAll')) $('logsAll').onclick = exportAll;
// ⚙ экспорт / импорт только настроек (cfg и настройки по персонажам cfg@ник)
$('cfgExport').onclick = async () => {
  const all = await chrome.storage.local.get(null);
  const data = Object.fromEntries(Object.entries(all).filter(([k]) => k === 'cfg' || /^cfg@/.test(k)));
  const n = Object.keys(data.cfg || {}).length;
  download(`l2bot-settings-${all.rt?.char || 'hero'}-${stamp()}.json`, JSON.stringify({ l2botCfg: 1, v: chrome.runtime.getManifest().version, t: Date.now(), data }, null, 1), 'application/json');
  $('cfgNote').textContent = `✅ Экспортировано настроек: ${n}. Файл — в «Загрузках».`;
  toast?.('⬇ Настройки сохранены в файл');
};
$('cfgImport').onclick = () => $('cfgFile').click();
$('cfgFile').onchange = async e => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const src = j?.l2botCfg ? j.data : j?.l2bot ? j.data : null;          // файл настроек или файл «Памяти бота»
    if (!src?.cfg || typeof src.cfg !== 'object') throw new Error('в файле нет настроек L2wap Bot');
    const { cfg = {} } = await chrome.storage.local.get('cfg');
    const patch = { cfg: { ...cfg, ...src.cfg } };
    for (const [k, v] of Object.entries(src)) if (/^cfg@/.test(k) && v && typeof v === 'object') patch[k] = v;
    await chrome.storage.local.set(patch);
    $('cfgNote').textContent = `✅ Импортировано настроек: ${Object.keys(src.cfg).length} (из v${j.v || '?'}, ${j.t ? new Date(j.t).toLocaleString('ru') : '—'}). Работающий бот подхватит их сразу.`;
    toast?.('⬆ Настройки загружены');
    load();
  } catch (err) { $('cfgNote').textContent = '⚠ Не импортировано: ' + (err.message || err); }
};
// 8.0.3 (эпики, ревью): траты Coin of Luck за 24 ч (rt.epicTpBudget) и платные заходы появления эпика (epicDb[k].paidN) при загрузке
// старой «Памяти» не откатываются: записи объединяются, paidN — большее (иначе суточный лимит CoL обнулялся импортом). Другой герой — как в файле
function colLedgerKeep(cur, imp, now = Date.now()) {
  if (!cur || !imp || typeof imp !== 'object' || (cur.char && imp.char && cur.char !== imp.char)) return imp;
  const key = x => [x.t, x.k, x.cost, x.unit, x.kind].join('|'), seen = new Set(), L = [];
  for (const x of [...(imp.epicTpBudget || []), ...(cur.epicTpBudget || [])]) if (x && Number.isFinite(x.t) && x.t > now - 86400000 && !seen.has(key(x))) { seen.add(key(x)); L.push(x); }
  const db = { ...(imp.epicDb || {}) };
  for (const [k, d] of Object.entries(cur.epicDb || {})) if ((d?.paidN || 0) > (db[k]?.paidN || 0)) db[k] = { ...(db[k] || {}), paidN: d.paidN, paidT: d.paidT || 0 };
  return { ...imp, epicTpBudget: L, epicDb: db };
}
$('memFile').onchange = async e => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j?.l2bot || !j.data?.cfg) throw new Error('это не файл памяти L2wap Bot');
    const data = Object.fromEntries(Object.entries(j.data).filter(([k]) => !MEM_SKIP.has(k)));
    { const all0 = await chrome.storage.local.get(null), byChar = {};      // 8.0.3: журнал трат CoL — по герою, из текущей памяти
      for (const [k, v] of Object.entries(all0)) if ((k === 'rt' || /^rt@/.test(k)) && v && typeof v === 'object') byChar[v.char || k.slice(3)] = v;
      for (const k of Object.keys(data)) if ((k === 'rt' || /^rt@/.test(k)) && data[k] && typeof data[k] === 'object') { const c = byChar[data[k].char || k.slice(3)]; if (c) data[k] = colLedgerKeep(c, data[k]); } }
    if (data.rt) data.rt = { ...data.rt, _src: 'menu' };
    await chrome.storage.local.set({ ...data, on: false, stopMeta: { source: 'memory-import', reason: 'Импорт памяти', t: Date.now() } });          // бота останавливаем — запустите заново
    const rt = data.rt || {};
    $('memNote').textContent = `✅ Загружено (v${j.v}, ${new Date(j.t).toLocaleString('ru')}): РБ в базе ${Object.keys(rt.rbDb || {}).length}, скиллов ${Object.keys(rt.skills || {}).length}. Бот остановлен — нажмите ▶ Старт.`;
    load();
  } catch (err) { $('memNote').textContent = '⚠ Не загружено: ' + (err.message || err); }
};
confirmClick('recClear', async () => {                // удалить весь журнал и все снимки страниц
  const db = await idb();
  const tx = db.transaction(['log', 'snaps', 'shots'], 'readwrite');   // v5.6: и скриншоты
  tx.objectStore('log').clear(); tx.objectStore('snaps').clear(); tx.objectStore('shots').clear();
  tx.oncomplete = async () => { await chrome.storage.local.set({ reccount: 0, snapcount: 0, exLogKey: null, exSnapT: 0 }); load(); };
});
async function huntToggle() {
  const { cfg = {}, rt = {}, on = false } = await chrome.storage.local.get(['cfg', 'rt', 'on']);
  const v = !cfg.rbHuntMode;
  // включение: с начала — свежий список РБ; рыбалку выключаем (тур её заменяет)
  const patch = { rbHunt: { step: 'pick', t: Date.now(), last: v ? 'тур запущен' : 'тур выключен' }, rbGo: null, rbWant: null, ...(v ? { rbListT: 0 } : {}), ...(rt.rbOne?.on ? { rbOne: { ...rt.rbOne, on: false } } : {}) };
  const mode = { rbHuntMode: v, ...(v ? { fishMode: false, rbMode: true, epicMode: false, catMode: false, campaign: false } : { rbMode: !!cfg.rbBetween }) };   // 8.0.3: тур выключен — rbMode по выбору игрока
  if (v) await activateMode(patch, mode); else await menuPatch(patch, { cfgPatch: mode });
}
async function epicToggle() {
  const { cfg = {}, rt = {}, on = false } = await chrome.storage.local.get(['cfg', 'rt', 'on']);
  const v = !cfg.epicMode;
  const patch = { epic: { step: 'pick', t: Date.now(), last: v ? 'режим запущен' : 'режим выключен' }, epicListT: 0, rbWant: null };
  const mode = { epicMode: v, ...(v ? { fishMode: false, rbHuntMode: false, rbMode: false, catMode: false, campaign: false } : {}) };
  if (v) await activateMode(patch, mode); else await menuPatch(patch, { cfgPatch: mode });
}
$('epicToggle2').onclick = epicToggle;
// 8.0.3: «🔄 Проверить эпиков (бесплатно)» — только чтение с сервера, в любом режиме (на рыбалке — фоном, в бою — после боя)
$('epicScan').onclick = async () => { try { await menuPatch({ epicScanReq: Date.now() }); toast('Проверка эпиков запрошена — итог в журнале и в таблице'); } catch (e) { toast(String(e.message || e)); } };
document.querySelectorAll('.epicChk').forEach(c => c.addEventListener('change', () => {
  $('epicList').value = [...document.querySelectorAll('.epicChk')].filter(x => x.checked).map(x => x.dataset.epic).join(',');
  save({ target: $('epicList') });
}));
$('huntToggle2').onclick = huntToggle;
// 8.0.3 (игрок 11.10: «кнопку — убить одного РБ и ждать команды, после команды убить ещё РБ, и так каждый раз; это когда я не могу
// 24/7 смотреть за ботом, а даю ему по 1 РБ за раз»): тур по РБ до первого убийства, потом пауза (raid.rbOnePause). Следующее нажатие
// (или «▶ Продолжить») — ещё один РБ. Тур уже шёл — список РБ не перечитываем заново (≈14 страниц), продолжаем с выбора
$('rbOneBtn').onclick = async () => {
  await save();
  const { cfg = {}, rt = {}, on = false } = await chrome.storage.local.get(['cfg', 'rt', 'on']);
  if (on && cfg.rbHuntMode && rt.rbOne?.on) return toast('🎯 Уже иду за РБ — после убийства встану на паузу и буду ждать команды');
  const now = Date.now(), tour = !!cfg.rbHuntMode;
  const leaveEpic = cfg.epicMode ? { epic: { step: 'pick', t: now, last: 'режим выключен' } } : {};
  const one = { ...(rt.rbOne || {}), on: true, k0: rt.rbKills || 0, t: now };
  await activateMode({ ...leaveEpic, rbOne: one, ...(tour ? {} : { rbHunt: { step: 'pick', t: now, last: 'один РБ по команде' }, rbGo: null, rbWant: null, rbListT: 0 }) },
    { ...MODES_OFF, rbHuntMode: true, rbMode: true, campaign: false });
  toast('🎯 Иду за одним РБ — после убийства встану на паузу и буду ждать команды');
};
function paintRbOne(rt, on, paused) {
  const b = $('rbOneBtn'), inf = $('rbOneInfo'); if (!b) return;
  const o = rt?.rbOne?.on ? rt.rbOne : null, waiting = !!o && !on && !!paused && !!o.last;
  b.textContent = !o ? '🎯 Убить один РБ и ждать команды' : on ? '🎯 Один РБ: в работе…' : '🎯 Ещё один РБ';
  b.classList.toggle('on', !!o);
  if (inf) inf.textContent = !o ? 'Бот найдёт и убьёт одного РБ (как тур: выбор, банки, телепорт), потом встанет на паузу и будет ждать твоей команды.'
    : waiting ? `⏸ Ждёт команды · последний: ${o.lastName || 'РБ'} в ${new Date(o.last).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} · по команде убито ${o.n || 0}`
    : on ? `Ищу и бью РБ — после убийства пауза.${o.n ? ` По команде убито ${o.n}.` : ''} Обычный «🧭 Тур по РБ» — без остановок.`
    : 'Бот стоит. «🎯 Ещё один РБ» — продолжить по одному.';
}
$('rbToggle').onclick = async () => {
  const { cfg = {}, rt = {} } = await chrome.storage.local.get(['cfg', 'rt']);
  const v = !cfg.rbBetween;   // 8.0.3: кнопка — выбор игрока (rbBetween); тур по РБ ею не выключается
  // выключение — сразу: никаких ожиданий РБ, бот возвращается к обычным мобам.
  // включение (v4.27) — сразу в работу: свежий список РБ игры, тур, и бот запускается, если стоял
  const patch = { sinceRb: v ? 999 : 0, rbPending: v, rbCur: null, rbTourWhy: '', ...(v ? { rbListT: 0, rbZoneVisit: {} } : { rbGo: null, rbWant: null }) };
  const mode = { rbBetween: v, rbMode: v || !!cfg.rbHuntMode, ...(v ? { rbTour: cfg.rbTour !== false, fishMode: false, epicMode: false, catMode: false, campaign: false } : {}) };
  if (v) await activateMode(patch, mode); else await menuPatch(patch, { cfgPatch: mode });
};

// перерисовка меню — не чаще 3 раз в секунду и только когда его видно: бот пишет состояние часто,
// а полная перерисовка панели на каждую запись тормозила вкладку игры
let loadT = 0, loadTimer = null, loadPending = false;
function loadSoon() {
  // 8.0 (аудит меню): свёрнутое встроенное меню (◀, cfg.dockMin) тоже не перерисовываем — его не видно, а бот пишет rt часто
  if (document.hidden || dockMin) { loadPending = true; return; }   // перерисуем, когда меню снова покажут
  loadPending = false;
  const wait = Math.max(0, 350 - (Date.now() - loadT));
  if (loadTimer) return;
  loadTimer = setTimeout(() => { loadTimer = null; loadT = Date.now(); load(); }, wait);
}
chrome.storage.onChanged.addListener(ch => {
  if (ch.cfg) { const was = dockMin; dockMin = DOCKED && !!ch.cfg.newValue?.dockMin; if (was && !dockMin) loadPending = true; }
  if (ch.cfg || ch.rt || ch.on || ch.paused || ch.wdog) return loadSoon();
  // 8.0: новые записи журнала/снимки — только счётчики (раньше — полная перерисовка меню на каждую запись журнала)
  if (ch.reccount || ch.snapcount) {
    if (ch.reccount) recN = ch.reccount.newValue || 0;
    if (ch.snapcount) snapN = ch.snapcount.newValue || 0;
    if (!dockMin && !document.hidden) showCounts(recN, snapN);
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && loadPending) loadSoon(); });
load();

// ===================== v5: удобство интерфейса =====================
// 1) разделы вкладок — сворачиваемые карточки (состояние запоминается); 2) длинные пояснения — под «ⓘ»;
// 3) поиск настройки по всем вкладкам (Ctrl+K); 4) «✓ Сохранено» после изменения; 5) горячие клавиши.
const UIKEY = 'ui5';
const uiState = (() => { try { return JSON.parse(localStorage.getItem(UIKEY) || '{}'); } catch (e) { return {}; } })();
const uiSave = () => { try { localStorage.setItem(UIKEY, JSON.stringify(uiState)); } catch (e) {} };
uiState.closed ||= {};

function cardify() {
  document.querySelectorAll('section').forEach(sec => {
    const kids = [...sec.childNodes];
    let card = null, body = null, idx = 0, subTitle = '', subCls = '';
    const start = (h) => {
      const c = card = document.createElement('div'); c.className = 'card';
      const head = document.createElement('div'); head.className = 'ch'; head.tabIndex = 0; head.setAttribute('role', 'button');
      const key = sec.id + ':' + (h ? h.textContent.trim() : '#' + idx); idx++;
      card.dataset.key = key;
      if (h) head.appendChild(h); else { const t = document.createElement('h4'); t.textContent = subTitle ? subTitle.replace(/^\S+\s*/, '') + ' — основное' : '⚙ Основное'; head.appendChild(t); }
      // 7.1.31: блок только для воина/мага (data-cls на h4 или на подзаголовке объединённого раздела) — скрывается по классу
      const cls = h?.dataset.cls || subCls; if (cls) c.dataset.cls = cls;
      const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '▼'; head.appendChild(chev);
      body = document.createElement('div'); body.className = 'cb';
      card.append(head, body); sec.appendChild(card);
      if (uiState.closed[key]) c.classList.add('closed');
      const tog = () => { c.classList.toggle('closed'); uiState.closed[key] = c.classList.contains('closed'); uiSave(); };   // своя карточка, не последняя
      head.addEventListener('click', tog);
      head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } });
    };
    for (const n of kids) {
      // 8.0 (аудит меню): .no-card (сводка «Обзора», «📤 Логи») — всегда на виду, вне сворачиваемых карточек;
      // скрытые служебные поля в начале раздела не создают пустую карточку «⚙ Основное» (было вверху «Охоты»)
      if (n.nodeType === 1 && n.classList?.contains('no-card')) { sec.appendChild(n); card = null; continue; }
      if (!card && n.nodeType === 1 && n.hidden) { sec.appendChild(n); continue; }
      // 7.1.31: подзаголовок бывшего раздела внутри объединённого (Охота: Автофарм, Катакомбы…) — вне карточек
      if (n.nodeType === 1 && n.classList?.contains('subsec-title')) { sec.appendChild(n); card = null; subTitle = n.textContent.trim(); subCls = n.dataset.cls || ''; continue; }
      if (n.nodeType === 1 && n.tagName === 'H4') { start(n); continue; }
      if (n.nodeType === 3 && !n.textContent.trim()) { n.remove(); continue; }
      if (!card && subTitle && n.nodeType === 1 && n.classList?.contains('intro-callout')) { n.classList.add('subsec-lead'); if (subCls) n.dataset.cls = subCls; sec.appendChild(n); continue; }
      if (n.nodeType === 8) continue;
      if (!card) start(null);
      body.appendChild(n);
    }
  });
}
// длинные пояснения (больше ~150 знаков) прячем под «ⓘ Как это работает» — экран не забит текстом
function foldHints() {
  document.querySelectorAll('section .hint').forEach(h => {
    if (h.id || h.closest('details') || h.textContent.trim().length < 150) return;   // с id — живые блоки (пишет код)
    const prev = h.previousElementSibling;
    // подряд идущие пояснения — под одним «ⓘ»; 8.0: только одного класса — иначе общее пояснение пряталось вместе с воинским
    if (prev?.matches('details.help') && (prev.dataset.cls || '') === (h.dataset.cls || '')) { prev.appendChild(h); return; }
    const d = document.createElement('details'); d.className = 'help'; if (h.dataset.cls) d.dataset.cls = h.dataset.cls;
    const s = document.createElement('summary'); s.textContent = 'Как это работает';
    h.replaceWith(d); d.append(s, h);
  });
}
// уведомление внизу
let toastT = null;
// 8.0 (аудит меню): предупреждения (⚠, красный/жёлтый) держатся ~4 с — за 1,4 с их не успевали прочитать; текст переносится (CSS)
const toastMs = (msg, color) => /^\s*⚠/.test(String(msg)) || /--(bad|warn)\b/.test(String(color || '')) ? 4000 : String(msg).length > 50 ? 3000 : 1400;
function toast(msg, color) {
  const t = $('toast'); if (!t) return;
  const warn = toastMs(msg, color) > 1400;
  t.textContent = msg; t.style.borderLeftColor = color || (warn ? 'var(--warn)' : 'var(--ok)'); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), toastMs(msg, color));
}
document.addEventListener('change', e => {
  const el = e.target;
  if (!el.matches?.('section input, section select, section textarea') || ['recN', 'resPick', 'resNeed', 'fishTgtType', 'fishTgtN', 'memFile', 'uiSearch', 'faPick', 'cfgFile'].includes(el.id)) return;
  const name = (el.closest('label')?.firstChild?.textContent || el.placeholder || '').trim().slice(0, 40);
  toast(`✓ Сохранено${name ? ': ' + name : ''}`);
});
// поиск настройки по всем вкладкам
function searchIndex() {
  const out = [];
  document.querySelectorAll('section').forEach(sec => {
    const tab = sec.id.replace('tab-', ''), nb = document.querySelector(`nav button[data-tab="${tab}"]`), tabName = nb ? (nb.querySelector('.ic')?.textContent || '') + ' ' + nb.lastChild.textContent.trim() : tab;
    sec.querySelectorAll('.card').forEach(card => {
      const title = card.querySelector('.ch h4')?.textContent.trim() || '';
      out.push({ el: card.querySelector('.ch'), card, tab, text: title, where: tabName, kind: 'раздел' });
      card.querySelectorAll('.cb > label, .cb > .row > button, .cb > .row button').forEach(el => {
        const t = (el.tagName === 'LABEL' ? [...el.childNodes].filter(n => n.nodeType === 3 || n.tagName === 'SPAN' && !n.querySelector('input')).map(n => n.textContent).join(' ') : el.textContent).replace(/\s+/g, ' ').trim();
        if (t) out.push({ el, card, tab, text: t, where: tabName + ' › ' + title, kind: el.tagName === 'LABEL' ? '' : 'кнопка' });
      });
    });
  });
  return out;
}
let IDX = null, resSel = 0;
function goTo(r) {
  showTab(r.tab);
  if (r.card.classList.contains('closed')) { r.card.classList.remove('closed'); uiState.closed[r.card.dataset.key] = false; uiSave(); }
  r.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  r.el.classList.remove('flash'); void r.el.offsetWidth; r.el.classList.add('flash');
  const inp = r.el.querySelector?.('input:not([hidden]),select'); if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 350);
  $('uiResults').classList.remove('show'); $('uiSearch').value = '';
}
function runSearch() {
  const q = $('uiSearch').value.trim().toLowerCase(), box = $('uiResults');
  if (q.length < 2) { box.classList.remove('show'); return; }
  IDX ||= searchIndex();
  const words = q.split(/\s+/);
  const hits = IDX.filter(r => words.every(w => (r.text + ' ' + r.where).toLowerCase().includes(w))).slice(0, 12);
  resSel = 0;
  box.innerHTML = hits.length ? hits.map((r, i) => `<div data-i="${i}" class="${i ? '' : 'sel'}">${esc(r.text)}<small>${esc(r.where)}${r.kind ? ' · ' + r.kind : ''}</small></div>`).join('')
    : `<div style="cursor:default;color:var(--mute)">Ничего не нашлось</div>`;
  box.classList.add('show');
  box._hits = hits;
}
$('uiSearch').addEventListener('input', runSearch);
$('uiSearch').addEventListener('keydown', e => {
  const box = $('uiResults'), hits = box._hits || [];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); resSel = (resSel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length); box.querySelectorAll('[data-i]').forEach(d => d.classList.toggle('sel', +d.dataset.i === resSel)); box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter' && hits[resSel]) { e.preventDefault(); goTo(hits[resSel]); }
  else if (e.key === 'Escape') { box.classList.remove('show'); $('uiSearch').blur(); }
});
$('uiResults').addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); goTo($('uiResults')._hits[+d.dataset.i]); } });
$('uiSearch').addEventListener('blur', () => setTimeout(() => $('uiResults').classList.remove('show'), 150));
// горячие клавиши: Alt+S — старт/стоп, Alt+1…9, 0 — вкладки, Ctrl+K или «/» — поиск
document.addEventListener('keydown', async e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' || (!typing && e.key === '/')) { e.preventDefault(); $('uiSearch').focus(); $('uiSearch').select(); return; }
  if (!e.altKey) return;
  if (e.code === 'KeyS') { e.preventDefault(); const { on = false } = await chrome.storage.local.get('on'); (on ? $('stop') : $('start')).click(); return; }
  const n = e.code === 'Digit0' ? 10 : +(e.code.match(/^Digit([1-9])$/) || [])[1];
  if (n) { e.preventDefault(); const b = document.querySelectorAll('nav button')[n - 1]; if (b) showTab(b.dataset.tab); }
});
// кнопки старт/стоп/сброс — короткое подтверждение
$('stop').addEventListener('click', () => toast('■ Бот остановлен', 'var(--bad)'));

cardify();
foldHints();
