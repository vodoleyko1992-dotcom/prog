const $ = id => document.getElementById(id);
// All menu runtime updates are serialized with bot updates, never rewrite stale snapshots.
async function menuPatch(rtPatch, extra = {}) {
  const response = await Promise.race([chrome.runtime.sendMessage({ cmd: 'menuPatch', rtPatch, ...extra }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Фоновый процесс не отвечает (15 с)')), 15000))]);
  if (!response?.ok) throw new Error('Не удалось сохранить изменение: ' + (response?.reason || 'фон недоступен'));
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
    $('status').textContent = '⚠ ' + result.reason;
    if (typeof toast === 'function') toast('⚠ ' + result.reason);
  }
  if (result.ok && typeof toast === 'function') toast('▶ ' + result.status);
  return result;
}
async function activateMode(rtPatch, cfgPatch) {
  await menuPatch({ ...rtPatch, manualKickAt: Date.now() }, { cfgPatch, on: true });
  return showWakeResult();
}

const NUM  = ['debuffMinActs', 'petFinishMp', 'petResummonAt', 'petHealAt', 'petBuffSec', 'epicMinHpPots', 'epicCoinDailyMax', 'epicAdenaDailyMax', 'epicRetreatHp', 'epicLvlUp', 'epicMaxDeaths', 'rbPotTo', 'rbPotAt', 'rbChipMaxAttempts', 'drainHp', 'toggleMpOff', 'toggleMpOn', 'campaignEvery', 'rbMaxAbove', 'rbMaxBelow', 'rbRetreatHp', 'rbRestHp', 'deepEvery', 'lvlMin', 'lvlMax', 'lvlAbove', 'lvlBelow', 'maxPages', 'champHpMult', 'reactMin', 'reactMax',
              'stopHp', 'skillMpMin', 'mpPotAt', 'hpPotAt', 'stunEvery', 'buffSec', 'rbPotReserve', 'rodEnchantTo', 'fishTimeMin', 'fishBuyPacks', 'fishShotPacks', 'fishMaxCasts', 'fishProcessEvery', 'shopReserve', 'shopMaxSpend', 'zoneTrial', 'farmNeed', 'recipeNeed'];
const TXT  = ['petSummon', 'nPetBuffs', 'priority', 'champMark', 'bossMark',
              'combatProfile', 'nAttack', 'nPower', 'nStun', 'nBuffs', 'nShots', 'nMpPot', 'nHpPot', 'nHeal', 'nWeaponMain', 'nWeaponBuff', 'nCharge', 'nForce', 'nDebuff', 'debuffMode', 'fishBait', 'fishGoal', 'fishTimePack', 'shopHp', 'shopMp', 'shopShots', 'shopSpirit', 'shopSoul', 'shopBait', 'farmRes', 'townBuffSet', 'faBuffs', 'resQuests', 'indMode', 'recipeRes', 'catDungeon', 'nKeyBuffs', 'nToggles', 'nSpoil', 'nSpoilMass', 'nSweep', 'nUltra', 'nDrain', 'ultMode', 'fightMode', 'epicList'];
const BOOL = ['petAuto', 'petResummon', 'petFinish', 'petBuffAuto', 'autoMagister', 'debuffAuto', 'rbValueTour', 'rbBandAuto', 'rbCharge', 'rbChipRetreat', 'epicCheck', 'dock', 'tvtOn', 'rbFrenzyDive', 'catMode', 'keyBuffBoss', 'spoilRb', 'autoRevive', 'chain', 'searchQuest', 'searchChamp', 'rec', 'autoSnap', 'questStop', 'autoRoles', 'weaponSwap', 'rbUsePots', 'weaponClassEquip', 'fishShots', 'fishAutoBuy', 'fishProcess', 'fishOpenBoxes', 'shopAuto', 'zoneAuto', 'rbMpPots', 'rbFast', 'fishShotAuto', 'fishTimeAuto', 'autoLearn', 'netLog', 'gameMsgLog', 'learnShots', 'recipeSpoil'];
const DEF = { debuffMinActs: 10, petAuto: true, petSummon: '', petResummon: true, petResummonAt: 25, petHealAt: 50, petFinish: false, petFinishMp: 80, petBuffAuto: true, nPetBuffs: '', petBuffSec: 1200, autoMagister: false, debuffAuto: true, debuffMode: 'auto', nDebuff: '', epicMode: false, epicList: 'ak,core,orfen,baium,valakas,antharas,frintezza,zaken', epicMaxDeaths: 10, epicCheck: false, epicRetreatHp: 35, epicLvlUp: 0, epicCoinDailyMax: 0, epicAdenaDailyMax: 0, epicMinHpPots: 0, fightMode: 'dps', combatProfile: 'auto', tvtOn: true, rbPotAt: 75, rbPotTo: 80, rbValueTour: false, rbBandAuto: true, rbCharge: true, rbChipRetreat: false, rbChipMaxAttempts: 3, rbFrenzyDive: false, nUltra: '', ultMode: 'big', nDrain: '', drainHp: 85, nKeyBuffs: '', keyBuffBoss: true, nToggles: '', toggleMpOff: 10, toggleMpOn: 30, nSpoil: '', nSpoilMass: '', nSweep: '', spoilRb: false, catMode: false, catDungeon: 'auto', recipeRes: '', recipeNeed: 0, recipeSpoil: false, indMode: 'full', autoLearn: true, netLog: true, gameMsgLog: true, learnShots: false, dock: true, campaign: false, autoRevive: true, campaignEvery: 25, autoRoles: true, weaponSwap: true, weaponClassEquip: true, weaponManual: false, nWeaponMain: '', nWeaponBuff: '', rbMode: false, rbMaxAbove: 15, rbRetreatHp: 20, rbRestHp: 95, autoSnap: true,
              chain: true, searchQuest: true, searchChamp: true, rec: true, questStop: false, deepEvery: 10,
              priority: '[квест]\n[чемп]\n[все]', champMark: 'чемпион', bossMark: 'босс, boss, рейд',
              lvlMin: 1, lvlMax: 99, lvlAbove: 99, lvlBelow: 3, maxPages: 3, champHpMult: 1.5, reactMin: 150, reactMax: 450,
              stopHp: 25, skillMpMin: 35, mpPotAt: 70, hpPotAt: 50, stunEvery: 15, buffSec: 118,
              nAttack: 'Атака', nPower: 'Iron Punch', nStun: 'Stunning Fist', nBuffs: 'Totem Spirit Bear',
              nShots: 'Заряд душі, Заряд души, Soulshot', nMpPot: 'Зілля мани, Зелье маны, Mana Potion', nHpPot: '', nHeal: '',
              nCharge: 'Focused Force', nForce: 'Hurricane Assault=2, Force Blaster=1', rbUsePots: true, rbPotReserve: 10,
              fishMode: false, rodEnchantTo: 10, fishTimeAuto: false, fishTimePack: '1h', fishTimeMin: 5, fishBait: 'basic', fishShots: true, fishAutoBuy: true, fishBuyPacks: 100, fishShotPacks: 75, fishShotAuto: true, fishMaxCasts: 0, fishProcess: true, fishProcessEvery: 100, fishOpenBoxes: true, fishGoal: '',
              shopAuto: true, shopReserve: 200000, shopMaxSpend: 2000000, shopHp: '300/1000', shopMp: '20/100', shopShots: '500/3000', shopSpirit: '0/1000', shopSoul: '0/1000', shopBait: '0/0', zoneAuto: false, zoneTrial: 20, zoneAbove: 10, rbMaxBelow: 15, townBuffSet: 'basic', faBuffs: '', resQuests: '', rbMpPots: true, rbFast: true, rbTour: true, farmRes: '', farmNeed: 0 };
const fmt = n => (n || 0).toLocaleString('ru');
// подтверждение опасных кнопок вторым нажатием (4 с). confirm() во встроенном меню не работает:
// меню — iframe расширения на странице игры, и Chrome молча блокирует там диалоги (confirm сразу возвращает «Отмена»)
function confirmClick(id, fn) {
  const b = $(id); let t = null;
  b.onclick = async () => {
    if (!t) {
      b.dataset.txt = b.textContent; b.textContent = '⚠ Нажмите ещё раз — подтвердить';
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
if (/dock=1/.test(location.search)) {
  document.documentElement.classList.add('docked');
  // v5.2: «я жива» для страницы игры раз в 3 с — если панель упадёт (грустный листок), бот перезапустит её сам
  const hb = () => { try { parent.postMessage({ __l2dock: 'hb' }, '*'); } catch (e) {} };
  hb(); setInterval(hb, 3000);
}

async function load() {
  const { cfg = {}, rt = {}, on = false, paused = null, reccount = 0, snapcount = 0, wdog = [], hbBg = null, lock = null } = await chrome.storage.local.get(['cfg', 'rt', 'on', 'paused', 'reccount', 'snapcount', 'wdog', 'hbBg', 'lock']);
  const d = { ...DEF, ...cfg };
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    fillWeapons(rt, d);                            // списки оружия выставляют выбор сами
    TXT.forEach(k => { if (!/^nWeapon/.test(k)) $(k).value = d[k] ?? ''; });
    NUM.forEach(k => $(k).value = d[k]);
    BOOL.forEach(k => $(k).checked = !!d[k]);
  }
  // v5: шапка — герой, версия, состояние; статус и итоги — «чипами»
  const ver = chrome.runtime.getManifest().version, eh = expHour(rt).replace(/^\s*·\s*/, ''), hl = healthLine(rt, wdog).trim();
  const chip = (ic, v, t) => `<span class="chip" title="${t}">${ic} <b>${v}</b></span>`;
  const heartbeatValid = !!on && !!lock?.tab && !!hbBg?.tab && lock.tab === hbBg.tab && Date.now() - (+lock.t || 0) < 85000 && Date.now() - (+hbBg.t || 0) < 70000;
  const booting = !!on && Date.now() - (+rt.manualKickAt || 0) < 15000;
  const failing = !!on && ['retry','reload','cooldown'].includes(rt.health?.action) &&
    Date.now() - (+rt.health.updatedAt || 0) < 45000;
  const runningLabel = !on && paused ? '⏸ Пауза' : !on ? '○ Остановлен' : failing ? 'Ошибка · восстановление' :
    heartbeatValid ? 'Движок активен' : booting ? 'Запускается' : 'Нет сигнала движка';
  $('heroLine').innerHTML = `<span class="hero">👤 ${esc(rt.char || 'Персонаж')}${rt.lvl ? ` · ${rt.lvl} ур.` : ''}</span><span class="ver">v${esc(ver)}</span>`
    + `<span class="state ${heartbeatValid ? 'on' : 'off'}">${runningLabel}</span>`;
  $('status').innerHTML = `<div class="st">${esc(rt.status || '—')}</div><div class="chips">`
    + chip('⚔', rt.kills || 0, 'Боёв за сессию') + chip('✨', '+' + fmt(rt.exp), 'Опыт за сессию') + chip('📘', '+' + fmt(rt.sp), 'SP за сессию')
    + chip('💰', '+' + fmt(rt.adena), 'Адена за сессию') + (rt.rbKills ? chip('👑', rt.rbKills, 'РБ убито') : '') + (eh ? chip('⏱', esc(eh), 'Темп опыта') : '')
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
  $('mobNames').innerHTML = [...new Set(Object.values(rt.spawns || {}).map(x => x[0]))].sort()
    .map(n => `<option value="${n.replace(/"/g, '&quot;')}">`).join('');
  showCounts(reccount, snapcount);

  // режим РБ
  $('rbToggle').classList.toggle('on', !!d.rbMode);
  $('rbToggle').dataset.on = d.rbMode ? '1' : '0';
  $('epicToggle2').textContent = `🐉 Эпики: ${d.epicMode ? 'ВКЛ' : 'ВЫКЛ'}`; $('epicToggle2').classList.toggle('on', !!d.epicMode);
  paintModes(d, on);
  paintCls(d, rt);
  { const on = String(d.epicList ?? DEF.epicList).split(','); document.querySelectorAll('.epicChk').forEach(c => c.checked = on.includes(c.dataset.epic)); }
  { const E = rt.epic || {}, db = rt.epicDb || {}, NM = { ak: 'АК', core: 'Ядро', orfen: 'Орфен', baium: 'Баюм', valakas: 'Валакас', antharas: 'Антарас', frintezza: 'Фринтеза', zaken: 'Закен' };
    const ST = { pick: 'выбор цели', prep: 'банки, бафф, хил', go: 'полёт', arrive: 'ищу на карте', fight: 'бой' };
    const L = E.hpLog || [], last = L[L.length - 1];
    $('epicBox').textContent = (d.epicMode ? '▶ Идёт' : '■ Выключено') + (E.step ? ' · ' + (ST[E.step] || E.step) : '') + (E.name && E.step !== 'pick' ? `: ${E.name}` : '')
      + (E.deaths ? ` · смертей ${E.deaths}` : '') + (last?.max ? ` · у него ${Math.round(last.cur / last.max * 1000) / 10} %` : '') + (E.last ? `\n${E.last}` : '')
      + (Object.keys(db).length ? '\n' + Object.entries(db).map(([k, x]) => `${NM[k] || k}: ${x.skipT > Date.now() ? '⏸ ' + (x.why || 'отложен') : x.alive === false ? '💀 ' + (x.status || '') : '✅ жив'}${x.kills ? ' · убит ' + x.kills + '×' : ''}`).join('\n') : ''); }
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
      + goalLine(d, rt);
  } else $('fishBox').textContent = 'Ещё не рыбачил';
  if (!document.activeElement?.closest?.('#goalGrid')) renderGoals(rt);
  renderFishTgt(rt, d);
  renderRodGoal(rt, d);
  const C = rt.campaign;
  $('campBox').textContent = C ? `${C.title}\n` + C.targets.map(t => `${t.ok ? '✅' : '★'} ${t.name}${t.lvl ? ' (' + t.lvl + ')' : ''}: ${t.est ? '≈' : ''}${t.done}/${t.total}${t.ok ? '' : ' · осталось ' + (t.total - t.done)}${t.loc && !t.ok ? ' · ' + t.loc : ''}`).join('\n')
    + `\nпроверено ${new Date(C.t).toLocaleTimeString('ru')}${C.live ? ' · по логу боя ' + new Date(C.live).toLocaleTimeString('ru') : ''}${rt.campaignDue ? ' · ⏳ скоро проверка' : ''}`
    : rt.questList?.length ? rt.questList.map(q => `${q.title}\n${q.lines.join('\n')}`).join('\n') : 'Ещё не проверялась';

  renderDps(rt);
  renderPet(rt);
  renderEff(rt);
  renderFa(rt, d); renderPots(rt, d);
  renderZones(rt, d);
  renderLoot(rt);
  // 🩺 v5.2: самопроверка баффов (пишет бот в бою раз в 15 с)
  if ($('buffAudit')) { const A = rt.buffAudit, ic = { ok: '✅', info: 'ℹ️', wait: '⏳', miss: '⚠️', bad: '❌' };
    $('buffAudit').textContent = A?.list?.length ? `🩺 Проверка баффов (${new Date(A.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}):\n`
      + A.list.map(x => `${ic[x.st] || '•'} ${x.bn} — ${x.why}`).join('\n') : (d.nBuffs ? '🩺 Проверка баффов — появится в первом бою' : ''); }
  renderRes(rt, d);
  renderFarm(rt, d); renderRecipes(rt, d); renderCat(rt, d);
  $('shopBox').textContent = rt.shop ? `⏳ Сейчас закупаюсь (${rt.shop.step === 'count' ? 'считаю сумку' : 'покупаю'})…`
    : rt.shopLast ? `Последняя закупка ${new Date(rt.shopLast.t).toLocaleString('ru')}: ${rt.shopLast.text}` : '';

  // квесты: прогресс, частота дропа, прогноз боёв
  const rate = q => (q.drops + 1) / (q.kills + 2);
  // в кампании — только цели текущей главы (прошлая глава могла оставить «Ol Mahum Raider 39/40»)
  const campNames = cfg?.campaign && rt.campaign?.targets?.length ? rt.campaign.targets.filter(t => !t.objective).map(t => (t.name || '').toLowerCase()) : null;
  const inCamp = mob => !campNames || campNames.some(n => n.includes(mob.toLowerCase()) || mob.toLowerCase().includes(n));
  const qs = Object.entries(rt.quests || {}).filter(([mob, q]) => q.total && inCamp(mob));
  // «На локации» — только когда бот ищет квестовых (галочка или Кампания); защита от мусора в старых данных
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
function renderDps(rt) {
  const box = $('dpsBox');
  if (!box) return;
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
    + `Ход ≈${turn.toFixed(2)} с · энергия ⚡${rt.force?.n ?? 0}${rt.force?.max ? '/' + rt.force.max : ''}\n`
    + (rows.length ? rows.map(r => `• ${r.name}: ≈${Math.round(r.dmg)} урона${r.cd ? ` · КД ${r.cd} с` : ''} · ${Math.round(r.per)}/с`
      + `${r.mp ? ` · MP ${Math.round(r.mp)}` : ''}${r.mpEff != null ? ` · ${r.mpEff > 0 ? '+' + Math.round(r.mpEff) : Math.round(r.mpEff)} урона/MP сверх атаки${r.mpEff < 20 ? ' ⚠ невыгодно при нехватке MP' : ''}` : ''}${r.force ? ` · −${r.force} эн. → ${Math.round(r.eff)} за ход` : ''}`).join('\n')
      : 'Удары ещё не изучены — бот выучит их в бою')
    + totemLines(rt)
    + '\nСтратегия: добивание самым дешёвым ударом → иначе самый сильный готовый → в паузах КД копит энергию → мощный удар, как только хватает энергии. MP < 35 % и банки нет — только скиллы с лучшей отдачей на 1 MP. Урон считается по текущему бою (против сильного моба атака почти 0 — тогда заряд ценнее атаки). Мобов выше героя больше чем на N ур. не выбирает.';
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
const GEAR_INFO = {
  cloak_d: ['Плащ рибалки', 'HP +250 · P.Def +70 · M.Def +70'], cloak_c: ['Плащ мисливця моря', 'HP +450 · P.Def +110 · M.Def +110'],
  cloak_b: ['Плащ глибокого моря', 'HP +700 · P.Def +170 · M.Def +170'], cloak_a: ['Плащ стража океану', 'HP +1000 · P.Def +240 · M.Def +240'],
  cloak_s: ['Плащ Левіафан', 'HP +1400 · P.Def +320 · M.Def +320'],
  tattoo_d: ['Татуювання річки', 'P.Atk/M.Atk +150 · скорость атаки/каста +1%'], tattoo_c: ['Татуювання озера', 'P.Atk/M.Atk +250 · скорость +2%'],
  tattoo_b: ['Татуювання моря', 'P.Atk/M.Atk +400 · скорость +3%'], tattoo_a: ['Татуювання глибокого моря', 'P.Atk/M.Atk +700 · скорость +4%'],
  tattoo_s: ['Татуювання Левіафан', 'P.Atk/M.Atk +1000 · скорость +5%'],
  belt_d: ['Пояс рибалки', 'HP +250 · бег +3 · крит +0.9%'], belt_c: ['Пояс досвідченого рибалки', 'HP +450 · бег +5 · крит +1.5%'],
  belt_b: ['Пояс ветерана рибалки', 'HP +700 · бег +7 · крит +2.4%'], belt_a: ['Пояс майстра рибалки', 'HP +1000 · бег +9 · крит +3.3%'],
  belt_s: ['Пояс Левіафан', 'HP +1400 · бег +12 · крит +4.5%'],
};
const goalList = v => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(x => GEAR_INFO[x]);
let goalItemsMode = null;                         // «Покупать вещи» нажато, но вещи ещё не выбраны
function renderRodGoal(rt, d) {
  const lvl = Number.isFinite(rt.rodLvl) ? `+${rt.rodLvl}` : 'пока неизвестен';
  const active = !!rt.rodGoalActive && (rt.rodLvl == null || rt.rodLvl < 10);
  $('fishRodGoalStatus').textContent = active
    ? `Цель +10: текущий уровень ${lvl}. ${rt.rodGoalWaitingProof ? 'Накапливаю Proof для следующего свитка.' : 'Заточка продолжится автоматически.'}`
    : rt.rodLvl >= 10 ? 'Удочка +10: цель достигнута. Рыбалка и накопление Proof продолжаются.'
    : `Удочка ${lvl}. Для запуска полной цепочки нажмите кнопку.`;
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
function fishSessLine(rt, F) {
  const S = rt.fishSess; if (!S?.n) return '';
  const h = Math.max(1, (S.last || Date.now()) - S.t0) / 3600000;
  const C = rt.fishCdStat || {}, D = rt.fishDmg || {};
  const avg = k => D[k]?.n ? Math.round(D[k].sum / D[k].n) : null;
  const bait = F.caught ? F.casts / F.caught : 0, shots = (S.shots || 0) / S.n;
  return `\nСессия: ${S.n} рыб · ${Math.round(S.n / h)}/ч · откат ${(rt.fishCdLen || 1.22).toFixed(2)} с${C.rej ? ` · отказов ${C.rej}/${(C.ok || 0) + C.rej}` : ''}`
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
function renderCat(rt, d) {
  if (!$('catBox')) return;
  const lv = id => { const k = rt.catLv?.[id]; return k?.n >= 3 ? `${k.lo}–${k.hi} ур. (видел)` : `≈${CAT_NM[id][1]}–${CAT_NM[id][2]} ур. (прикидка)`; };
  const cur = rt.catIn || rt.catCur, now = Date.now();
  const seen = Object.keys(CAT_NM).filter(id => rt.catLv?.[id]);
  $('catBox').textContent = (d.catMode ? `${rt.catIn ? '🏛 Внутри: ' : cur ? '➜ Цель: ' : '⏳ Цель выберу по уровню героя'}${cur ? CAT_NM[cur]?.[0] + ' · ' + lv(cur) : ''}` : 'Выключено')
    + (seen.length ? `\nУвиденные подземелья: ${seen.map(id => `${CAT_NM[id][0]} ${lv(id).replace(/ \(.*\)/, '')}${now - (rt.catBad?.[id] || 0) < 3600000 ? ' (пропускаю)' : ''}`).join(' · ')}` : '');
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
async function renderFarm(rt, d) {
  const db = await dbGet('farmDb', { res: {} });
  const keys = Object.keys(db.res || {});
  if (dlSig.farm !== db) { dlSig.farm = db; $('farmResList').innerHTML = keys.map(k => `<option value="${String(db.res[k].name ?? '').replace(/"/g, '&quot;')}">${(db.res[k].cat || '').replace(/</g, '&lt;')}</option>`).join(''); }
  const L = rt.lvl || 0, k = (d.farmRes || '').trim().toLowerCase(), r = db.res[k];
  let txt = keys.length ? `В базе ресурсов: ${keys.length} (обновлено ${new Date(db.t).toLocaleString('ru')})` : 'База пуста — нажмите «Обновить базу ресурсов» (бот откроет форум и раскроет строки по одной).';
  if (k && !r) txt += `\n⚠ «${d.farmRes}» нет в базе`;
  if (r?.bosses?.length) txt += `\n${r.name}: падает с РБ — ${r.bosses.slice(0, 6).map(([n, l, c]) => `${n} ${l} ур. ${c}%`).join(' · ')}${r.drop?.length ? '' : ' (бот полетит к живому РБ из списка, если включён «👑 Фарм РБ»)'}`;
  if (r && L) {
    const above = d.lvlAbove ?? 30, fit = l => l >= L - 3 && l <= L + 3 ? 1 : l < L - 3 ? Math.max(0.5, 1 - (L - 3 - l) * 0.07) : Math.max(0.5, 1 - (l - L - 3) * 0.1);
    const by = {};
    for (const [mob, lvl, ch, a, b, tp, loc] of r.drop) {
      if (lvl > L + above || lvl < L - 10) continue;
      const e = ch / 100 * (a + b) / 2, z = (by[tp] ||= { loc, mobs: {} });
      if (!z.mobs[mob] || z.mobs[mob].e < e) z.mobs[mob] = { lvl, e, ch };
    }
    for (const z of Object.values(by)) { const m = Object.values(z.mobs); z.e = m.reduce((s, x) => s + x.e, 0) / m.length; z.score = m.reduce((s, x) => s + x.e * fit(x.lvl), 0) / m.length * (1 + 0.1 * Math.min(m.length, 5)); }
    const top = Object.entries(by).sort((x, y) => y[1].score - x[1].score).slice(0, 3);
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
  const L = rt.lvl || 0, cat = rt.zoneCat || {}, S = rt.zoneStat || {};
  const name = id => cat[id]?.name || String(id).replace(/^out:/, 'Окрестности: ');
  // v4.59: желаемое окно уровней мобов (от героя −lvlBelow до +lvlAbove, по умолчанию −3…+15) — зона подходит, если её мобы в него попадают
  const wLo = L - (d.lvlBelow ?? 3), wHi = L + Math.min(d.lvlAbove ?? 15, 15), wMid = (wLo + wHi) / 2;
  if ($('lvlWin')) $('lvlWin').textContent = L ? `Герой ${L} ур. → бьёт мобов ${(d.lvlAbove ?? 99) >= 99 ? `от ${Math.max(1, wLo)} ур. и выше (без верхнего предела; слишком сильных — бой > 45 с — сам пропускает на 2 ч)` : `${Math.max(1, wLo)}–${L + (d.lvlAbove ?? 15)} ур.`} · зону для кача выбирает до ${wHi} ур.` : '';
  const fits = id => { const c = cat[id]; return !!c?.lo && L && c.lo <= wHi && c.hi >= wLo; };
  // насколько зона «в окне»: доля её диапазона внутри окна, затем близость середины к середине окна
  const inWin = c => c?.lo ? (Math.min(c.hi, wHi) - Math.max(c.lo, wLo) + 1) / (c.hi - c.lo + 1) : 0;
  const ids = [...new Set([...Object.keys(S), ...Object.keys(cat).filter(fits)])];
  if (!ids.length) { box.innerHTML = `<div class="hint">Пока нет данных — бот считает опыт в каждой зоне, где охотится.${Object.keys(cat).length ? '' : ' Нажмите «Обновить список зон», чтобы узнать уровни мобов всех Окрестностей.'}</div>`; return; }
  const rows = ids.map(id => ({ id, r: L ? zoneRateP(rt, id, L) : null, c: cat[id] || {} }))
    .sort((a, b) => (b.r?.exp || 0) - (a.r?.exp || 0) || (fits(b.id) - fits(a.id)) || (inWin(b.c) - inWin(a.c)) || (Math.abs((a.c.lo + a.c.hi) / 2 - wMid) - Math.abs((b.c.lo + b.c.hi) / 2 - wMid)));
  const best = rows.find(x => x.r?.exp);
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(1) + ' М' : n >= 1e3 ? Math.round(n / 1e3) + ' К' : Math.round(n);
  box.innerHTML = `<table><tr><th>Зона</th><th>Мобы</th><th>EXP/ч</th><th>%/ч</th><th>Боёв</th><th></th></tr>`
    + rows.slice(0, 14).map(x => `<tr class="${x.id === rt.zone ? 'cur' : ''} ${best && x.id === best.id ? 'best' : ''}">`
      + `<td>${x.id === rt.zone ? '📍 ' : ''}${h(name(x.id))}</td><td>${x.c.lo ? `${x.c.lo}-${x.c.hi}` : '—'}</td>`
      + `<td>${x.r?.exp ? k(x.r.exp) + (x.r.near ? '*' : '') : x.r?.few ? '…' : fits(x.id) ? '?' : '—'}</td><td>${x.r?.pct != null ? x.r.pct.toFixed(1) : '—'}</td>`
      + `<td>${x.r?.n || Object.values(S[x.id] || {}).reduce((a, e) => a + e.n, 0) || ''}</td>`
      + `<td>${x.id !== rt.zone && !/^out:/.test(x.id) ? `<button data-zone="${h(x.id)}" title="Лететь (телепорт ${x.c.price ? x.c.price.toLocaleString('ru') + ' аден' : ''})">✈</button>` : ''}</td></tr>`).join('')
    + '</table>';
  const fresh = rows.filter(x => fits(x.id) && !x.r?.exp).map(x => `${name(x.id)} (${x.c.lo}-${x.c.hi})`);
  const cur = rows.find(x => x.id === rt.zone);
  box.innerHTML += `<div class="rec">${L ? `Герой ${L} ур.` : ''}${best ? ` · лучшая: ${h(name(best.id))} — ${k(best.r.exp)} EXP/ч${best.r.pct != null ? `, ${best.r.pct.toFixed(1)} %/ч (≈${100 / best.r.pct < 1 ? Math.round(6000 / best.r.pct) + ' мин' : (100 / best.r.pct).toFixed(1) + ' ч'} на уровень)` : ''}` : ''}`
    + `${cur?.r?.exp && best && best.id !== cur.id ? `\nТекущая: ${k(cur.r.exp)} EXP/ч — ${Math.round((1 - cur.r.exp / best.r.exp) * 100)} % хуже лучшей` : ''}`
    + `${fresh.length ? `\n🔍 Не изучены, но по уровню подходят: ${h(fresh.slice(0, 5).join(', '))}` : ''}`
    + `\n<span class="hint">* — по соседнему уровню героя · «…» — меньше 5 боёв · «?» — не охотился</span></div>`;
}

// 💎 баффы за Fast Aden: выбор из списка «+», порядок ▲▼, ✕; баланс и стоимость круга
const FA_KNOWN = { 1363: ['Chant of Victory', 5], 1356: ['Prophecy of Fire', 1], 1357: ['Prophecy of Wind', 1], 1355: ['Prophecy of Water', 1], 1413: ["Magnus' Chant", 1], 1414: ["Victories of Pa'agrio", 1], 1323: ['Noblesse Blessing', 5] };
const faIds = () => ($('faBuffs').value || '').split(/[,\s]+/).map(x => +x).filter(x => x > 0);
const faSet = async ids => { $('faBuffs').value = [...new Set(ids)].join(', '); await save({ target: $('faBuffs') }); };
function faInfo(rt, id) { const c = rt.faCat?.[id]; return { name: c?.name || FA_KNOWN[id]?.[0] || 'skill ' + id, cost: c?.cost || FA_KNOWN[id]?.[1] || 1, known: !!c } }
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
  const sortCls = l => [...l].sort((a, b) => (inClass(b) - inClass(a)) || ((b.pa || 0) - (a.pa || 0)));
  build('nWeaponMain', sortCls(uniq), d.nWeaponMain || '');
  build('nWeaponBuff', uniq.filter(w => w.wt === 'кастеты'), d.nWeaponBuff || '');
  const eq = W.find(w => w.where === 'надето');
  $('weapBox').textContent = !rt.weaponsT ? 'Инвентарь ещё не проверялся — нажмите «🔍 Проверить инвентарь»'
    : `Профессия: ${rt.prof || '?'}${R.lv ? ' · ' + R.lv + ' ур.' : ''} · в класс: ${types[0] === '#mage' ? 'маг (по M.Atk)' : types.join(' / ') || '?'}${R.src && !/^профессия/.test(R.src) ? ' (' + R.src + ')' : ''}
`
      + `Надето: ${eq ? `${eq.name} [${eq.wt}, ${eq.g}]${inClass(eq) ? ' ⭐ в класс' : ' — не в класс'}` : 'ничего'}
`
      + `Рекомендую: ${R.main || 'оружия в класс нет в инвентаре'}${R.buff ? ' · для баффов: ' + R.buff : ''}${R.wore ? '\n✅ Надел: ' + R.wore : R.keptEq ? '\nℹ «В класс» не надето: слабее текущего больше чем на 15 %' : ''}
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
  await menuPatch({}, { cfgPatch: { ...(R.main ? { nWeaponMain: R.main } : {}), ...(R.buff ? { nWeaponBuff: R.buff } : {}), weaponManual: false, weaponClassEquip: true } });
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
const TAB_GROUP = { autofarm: 'hunt', dungeon: 'hunt', loc: 'hunt', pet: 'panel', fight: 'panel', epic: 'rb', loot: 'supply', log: 'svc' };
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
function renderPrio(text) {
  prio = text.split('\n').map(s => s.trim()).filter(Boolean).map(parseLine);
  $('prioList').innerHTML = prio.length ? prio.map((r, i) => `
    <div class="rule${r.neg ? ' neg' : ''}"><span class="n">${r.neg ? '🚫' : i + 1}</span><span class="t">${labelOf(r).replace(/</g, '&lt;')}</span>
      <button data-a="up" data-i="${i}" title="Выше">▲</button><button data-a="down" data-i="${i}" title="Ниже">▼</button>
      ${r.name ? `<button data-a="champ" data-i="${i}" title="Только чемпион этого вида">⚔</button>` : ''}
      <button data-a="neg" data-i="${i}" title="Исключить / вернуть">🚫</button><button data-a="del" data-i="${i}" title="Удалить">✕</button></div>`).join('')
    : '<div class="hint">Пусто — бот не будет выбирать цели на карте</div>';
}
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
    const s = seen[id] || {}, d = db[id] || {}, m = MARK[d.verdict] || (s.inRange === false ? ['⛔', 'вне уровня героя'] : ['❔', 'не проверен']);
    const chipNow = rt.rb?.[id] ? ` · у него ${rt.rb[id].hpAfter}/${rt.rb[id].max}` : '';
    const z = d.zone || s.zone, zn = z ? (rt.zoneCat?.[z]?.name || String(z).replace(/^out:/, 'Окрестности: ')) : '';
    return `<div class="rb"><span class="m">${m[0]}</span><div><b>${(d.name || s.name || id).replace(/</g, '&lt;')}</b> (${d.lvl || s.lvl || '?'}) — ${m[1]}`
      + `<div class="d">${zn ? '📍 ' + zn.replace(/</g, '&lt;') + (z === rt.zone ? ' (здесь)' : '') + ' · ' : ''}${s.seenT ? 'видел ' + new Date(s.seenT).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) + ' · ' : ''}${d.tries ? `попыток ${d.tries}` : ''}${d.kills ? ` · убит ${d.kills}×` : ''}${d.heroLvl ? ` · проверен на ур. ${d.heroLvl}` : ''}${chipNow}`
      + `${d.note ? '<br>' + d.note.replace(/</g, '&lt;') : ''}</div></div></div>`;
  }).join('') : '<div class="hint">Пусто — включите «Фарм РБ» и зайдите на карту</div>';
  const F = Object.values(rt.rbForum || {}), V = Object.entries(rt.rbZoneVisit || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const ok = Object.values(db).filter(d => d.verdict === 'ok').length, no = Object.values(db).filter(d => d.verdict === 'no').length;
  const RL = Object.values(rt.rbList || {}), L = rt.lvl || 0;
  const rlLine = RL.length ? `Список РБ игры: ${RL.length} · живых ${RL.filter(x => x.alive).length} · разрешено мне ${RL.filter(x => x.alive && !x.deny).length} (обновлён ${new Date(rt.rbListT).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })})${rt.rbGo ? ` · ✈ лечу к ${rt.rbGo.name}` : ''}\n` : 'Список РБ игры ещё не читал — прочитаю при включении «Фарм РБ»\n';
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
  const ok = all.filter(x => !x.why), skip = all.filter(x => x.why && x.lvl >= L - 20 && x.lvl <= hi).slice(0, 8);
  $('huntQueue').textContent = `Очередь (${d.rbOrder === 'down' ? 'с сильных' : 'со слабых'}, окно ${lo}–${hi}): ` + (ok.length ? ok.slice(0, 6).map(x => `${x.name} ${x.lvl}${db[x.id]?.verdict === 'ok' ? ' ✅' : ''}`).join(' → ') + (ok.length > 6 ? ` … ещё ${ok.length - 6}` : '') : 'подходящих нет')
    + (skip.length ? `\nПропускаю: ` + skip.map(x => `${x.name} ${x.lvl} — ${x.why}`).join(' · ') : '');
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

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }

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
const ROLE_RU = { nWeaponMain: 'Основное оружие', nWeaponBuff: 'Оружие для баффов', nAttack: 'Атака', nPower: 'Силовые', nStun: 'Станы', nBuffs: 'Баффы', nShots: 'Соски', nMpPot: 'Банка MP', nHpPot: 'Банка HP', nHeal: 'Лечение', nKeyBuffs: 'Важные баффы', nToggles: 'Постоянные баффы', nSpoil: 'Спойл', nSpoilMass: 'Масс-спойл', nSweep: 'Сбор спойла', nUltra: 'Сверхсильные', nDrain: 'Вампиризм', nCharge: 'Копит энергию', nForce: 'Тратит энергию', nDebuff: 'Дебаффы' };
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
  return d.epicMode ? 'epic' : d.rbHuntMode ? 'rb' : d.fishMode ? 'fish' : d.catMode && !d.campaign ? 'cat' : d.zoneAuto ? 'auto' : 'farm';
}
const MODE_NAME = { farm: '⚔ Фарм на месте', auto: '🗺 Автофарм', rb: '👑 Тур по РБ', epic: '🐉 Эпики', fish: '🎣 Рыбалка', cat: '🏛 Катакомбы' };
function paintModes(d, on) {
  const m = currentMode(d);
  document.querySelectorAll('#quickModeGrid [data-mode]').forEach(b => { b.classList.toggle('on', b.dataset.mode === m); b.classList.toggle('stopped', b.dataset.mode === m && !on); });
  $('campToggle').classList.toggle('on', !!d.campaign); $('rbToggle').classList.toggle('on', !!d.rbMode); $('tvtToggle').classList.toggle('on', !!d.tvtOn);
  $('rbToggle').dataset.on = d.rbMode ? '1' : '0';
  const mods = [d.campaign && '📜 кампания', d.rbMode && m !== 'rb' && '👑 РБ между мобами', d.tvtOn && '⚔ TvT'].filter(Boolean);
  const ms = $('modeSummary'); if (ms) ms.textContent = `${MODE_NAME[m]}${on ? '' : ' (бот стоит)'}${mods.length ? ' · + ' + mods.join(', ') : ''}`;
}
// 7.1.31: меню под класс — у мага скрыты воинские блоки (энергия силы, спойл, тотемы/Frenzy, станы, кастеты…), у воина — «Слуга» и дебаффы мага.
// Класс — как у движка (combatProfileKind): профиль из «Боя» или профессия героя. «👁 Показать настройки всех классов» — всё сразу
const MAGE_PROF = /\b(?:mage|mystic|wizard|warlock|summoner|arcana lord|sorcer|necromancer|bishop|prophet|cleric|spellhowler|spellsinger|oracle|elder|shaman|overlord|warcryer)\b/i;
function heroCls(d, rt) {
  if (d.combatProfile === 'fighter') return 'fighter';
  if (d.combatProfile === 'mage_summoner') return 'mage';
  return rt.prof ? (MAGE_PROF.test(String(rt.prof)) ? 'mage' : 'fighter') : '';
}
let showAllCls = (() => { try { return localStorage.getItem('showAllCls') === '1'; } catch (e) { return false; } })();
// 7.2: спойлер (гном: Dwarven Fighter/Scavenger/Bounty Hunter/Fortune Seeker или спойл в роли «Спойл») — блок «Спойл» виден только ему
const SPOIL_PROF = /\b(?:dwarven fighter|scavenger|bounty hunter|fortune seeker)\b/i;
function paintCls(d, rt) {
  const cls = heroCls(d, rt), root = document.documentElement, spoil = SPOIL_PROF.test(String(rt.prof || '')) || !!String(d.nSpoil || '').trim();
  root.classList.toggle('cls-mage', cls === 'mage'); root.classList.toggle('cls-fighter', cls === 'fighter'); root.classList.toggle('cls-spoil', spoil); root.classList.toggle('show-all', showAllCls);
  const b = $('showAllCls'); if (b) b.textContent = showAllCls ? '🙈 Только настройки моего класса' : '👁 Показать настройки всех классов';
  const n = $('clsNote'); if (n) n.textContent = !cls ? '' : showAllCls ? 'Показаны настройки всех классов.' : cls === 'mage'
    ? `Класс: маг (${rt.prof || 'профиль'}) — скрыты воинские настройки: энергия силы, сверхсильные скиллы, важные баффы, спойл, станы, кастеты.`
    : spoil ? `Класс: спойлер (${rt.prof || 'профиль'}) — скрыты «Слуга» и дебаффы мага; «Спойл» на виду.`
    : `Класс: воин (${rt.prof || 'профиль'}) — скрыты «Слуга», дебаффы мага и спойл.`;
}
$('showAllCls').onclick = async () => {
  showAllCls = !showAllCls; try { localStorage.setItem('showAllCls', showAllCls ? '1' : '0'); } catch (e) {}
  const { cfg = {}, rt = {} } = await chrome.storage.local.get(['cfg', 'rt']); paintCls({ ...DEF, ...cfg }, rt);
};
// выбор режима запускает бота (как и прежние кнопки) и выключает остальные режимы; дополнения не трогаем
const MODES_OFF = { epicMode: false, rbHuntMode: false, fishMode: false, catMode: false };
async function setMode(m) {
  await save();
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  const now = Date.now(), leaveEpic = cfg.epicMode && m !== 'epic' ? { epic: { step: 'pick', t: now, last: 'режим выключен' } } : {};
  const leaveHunt = cfg.rbHuntMode && m !== 'rb' ? { rbHunt: { step: 'pick', t: now, last: 'тур выключен' }, rbGo: null } : {};
  const leave = { ...leaveEpic, ...leaveHunt };
  if (m === 'farm') await activateMode({ ...leave, zoneAutoKick: null, zoneGo: null }, { ...MODES_OFF, zoneAuto: false });
  // с автофармом включаем и цепочку «Охотиться дальше»: ≈5,4 с на моба против ≈11,4 с через карту
  else if (m === 'auto') await activateMode({ ...leave, zoneAutoKick: now, zoneGoT: 0, zoneLvlT: 0 }, { ...MODES_OFF, zoneAuto: true, chain: true });
  else if (m === 'rb') await activateMode({ ...leaveEpic, rbHunt: { step: 'pick', t: now, last: 'тур запущен' }, rbGo: null, rbWant: null, rbListT: 0 }, { ...MODES_OFF, rbHuntMode: true, rbMode: true, campaign: false });
  else if (m === 'epic') await activateMode({ ...leaveHunt, epic: { step: 'pick', t: now, last: 'режим запущен' }, epicListT: 0, rbWant: null }, { ...MODES_OFF, epicMode: true, rbMode: false, campaign: false });
  else if (m === 'fish') await activateMode({ ...leave, fishTgt: null }, { ...MODES_OFF, fishMode: true, rbMode: false, campaign: false });
  else if (m === 'cat') await activateMode({ ...leave }, { ...MODES_OFF, catMode: true, campaign: false });
  toast(`Режим: ${MODE_NAME[m]}`);
}
document.querySelectorAll('#quickModeGrid [data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode).catch(e => toast(String(e?.message || e))); });
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
  $('status').textContent = on ? '🎒 Бот пересчитает сумку после боя' : '🎒 Пересчёт после ▶ Старт';
};
confirmClick('lootReset', async () => {               // обнулить статистику добычи
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ lootStat: {}, mobKills: {}, lootStatT0: Date.now() });
});
$('farmScan').onclick = async () => {
  const { rt = {}, on = false } = await chrome.storage.local.get(['rt', 'on']);
  await menuPatch({ farmScan: true });
  $('status').textContent = on ? 'База ресурсов: бот откроет форум после боя' : 'База обновится после ▶ Старт (или раскройте строки на странице «Фарм ресурсов» сами — они сохранятся)';
};
$('farmReset').onclick = async () => {
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ farmGot: {} });
};
$('petStatReset').onclick = async () => {
  if (!confirm('Сбросить статистику котов?')) return;
  await menuPatch({ petStat: {}, petAdvice: null });
  $('status').textContent = '🐱 Статистика котов сброшена';
};
$('zoneScan').onclick = async () => {
  const { rt = {}, on = false } = await chrome.storage.local.get(['rt', 'on']);
  await menuPatch({ zoneScan: true });
  $('status').textContent = on ? 'Список зон: бот откроет «Телепорт» после боя' : 'Список зон обновится после ▶ Старт (или откройте «Телепорт» — зоны читаются сами)';
};
$('zoneBox').onclick = async e => {
  const b = e.target.closest('[data-zone]');
  if (!b) return;
  const { rt = {}, on = false } = await chrome.storage.local.get(['rt', 'on']);
  await menuPatch({ zoneGo: { id: b.dataset.zone, t: Date.now(), why: 'вручную' }, zoneGoT: 0 });
  $('status').textContent = on ? `✈ Лечу: ${rt.zoneCat?.[b.dataset.zone]?.name || b.dataset.zone}` : '✈ Полёт начнётся после ▶ Старт';
};
// ⚙ рекомендуемые (базовые) настройки рыбалки — выбраны игроком (v4.52): обычная наживка, заряды, докупка,
// 100 пакетов наживки (1000 шт. ≈ 680 рыб) и заряды под наживку (≈75 пакетов, кончаются вместе) — v4.56, без лимита, разделка каждые 100, Old Box
$('fishBest').onclick = async () => {
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  await menuPatch({}, { cfgPatch: { fishBait: 'basic', fishShots: true, fishAutoBuy: true, fishBuyPacks: 100, fishShotPacks: 75, fishShotAuto: true, fishMaxCasts: 0, fishProcess: true, fishProcessEvery: 100, fishOpenBoxes: true } });
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
if ($('shopNowTop')) $('shopNowTop').onclick = shopNowGo;
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
$('reset').onclick = async () => {
  const { rt = {} } = await chrome.storage.local.get('rt');
  await menuPatch({ kills: 0, exp: 0, sp: 0, adena: 0, buffAt: {}, buffSeen: {}, quests: {}, rb: {}, rbBad: {}, rbKills: 0, loot: {}, lootSpecial: {}, lootValue: 0 });
};

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

async function exportLog(rows, title, markNew) {
  if (!rows.length) { $('recCount').textContent = `${title}: событий нет`; return; }
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
  if (!list.length) { $('recCount').textContent = `${title}: нет — походите по разделам игры с включённой записью`; return; }
  list.sort((a, b) => a.t - b.t);
  const f = fitTail(list.map(x => `\n<!-- ===== ${x.state || x.key} · ${new Date(x.t).toLocaleString('ru')} · ${x.key} ===== -->\n${x.html}`), EXPORT_MAX - 200000);
  const inc = list.slice(f.cut);
  download(`l2wap-pages-${stamp()}.html`, [`<!-- L2wap: ${title}, ${inc.length} шт.${f.cut ? ` (ещё ${f.cut} старых не вошли — лимит 20 МБ)` : ''}:\n${inc.map(x => '  ' + (x.state || x.key)).join('\n')}\n-->\n`, f.keep.join('\n')], 'text/html');
  await chrome.storage.local.set({ exSnapT: Math.max(...list.map(x => x.t)) });
  load();
}
$('snapNew').onclick = async () => { const { exSnapT = 0 } = await chrome.storage.local.get('exSnapT'); exportSnaps(await readSnaps(exSnapT), 'новые снимки'); };
$('snapAll').onclick = async () => exportSnaps(await readSnaps(0), 'все снимки');

$('recDom').onclick = async () => {
  try {
    const r = await chrome.tabs.sendMessage((await activeTab()).id, { cmd: 'dom' });
    download(`l2wap-${r.page}-${stamp()}.html`, r.html, 'text/html');
  } catch { $('status').textContent = '⚠ Откройте вкладку l2wap.com'; }
};
// ---------- 💾 память бота: сохранить в файл / загрузить из файла (переживает переустановку расширения) ----------
const MEM_SKIP = new Set(['auth', 'on', 'reccount', 'snapcount', 'exLogKey', 'exSnapT', 'hbBg', 'wdog']);   // логин/пароль и служебное — не сохраняем
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
$('learnReport').onclick = async () => {
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
};
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
$('memFile').onchange = async e => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j?.l2bot || !j.data?.cfg) throw new Error('это не файл памяти L2wap Bot');
    const data = Object.fromEntries(Object.entries(j.data).filter(([k]) => !MEM_SKIP.has(k)));
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
  const patch = { rbHunt: { step: 'pick', t: Date.now(), last: v ? 'тур запущен' : 'тур выключен' }, rbGo: null, rbWant: null, ...(v ? { rbListT: 0 } : {}) };
  const mode = { rbHuntMode: v, ...(v ? { fishMode: false, rbMode: true, epicMode: false, catMode: false, campaign: false } : {}) };
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
document.querySelectorAll('.epicChk').forEach(c => c.addEventListener('change', () => {
  $('epicList').value = [...document.querySelectorAll('.epicChk')].filter(x => x.checked).map(x => x.dataset.epic).join(',');
  save({ target: $('epicList') });
}));
$('huntToggle2').onclick = huntToggle;
$('rbToggle').onclick = async () => {
  const { cfg = {}, rt = {} } = await chrome.storage.local.get(['cfg', 'rt']);
  const v = !cfg.rbMode;
  // выключение — сразу: никаких ожиданий РБ, бот возвращается к обычным мобам.
  // включение (v4.27) — сразу в работу: свежий список РБ игры, тур, и бот запускается, если стоял
  const patch = { sinceRb: v ? 999 : 0, rbPending: v, rbCur: null, rbTourWhy: '', ...(v ? { rbListT: 0, rbZoneVisit: {} } : { rbGo: null, rbWant: null }) };
  const mode = { rbMode: v, ...(v ? { rbTour: cfg.rbTour !== false, fishMode: false, epicMode: false, catMode: false, campaign: false } : { rbHuntMode: false }) };
  if (v) await activateMode(patch, mode); else await menuPatch(patch, { cfgPatch: mode });
};

// перерисовка меню — не чаще 3 раз в секунду и только когда его видно: бот пишет состояние часто,
// а полная перерисовка панели на каждую запись тормозила вкладку игры
let loadT = 0, loadTimer = null, loadPending = false;
function loadSoon() {
  if (document.hidden) { loadPending = true; return; }   // перерисуем, когда меню снова покажут
  loadPending = false;
  const wait = Math.max(0, 350 - (Date.now() - loadT));
  if (loadTimer) return;
  loadTimer = setTimeout(() => { loadTimer = null; loadT = Date.now(); load(); }, wait);
}
chrome.storage.onChanged.addListener(ch => { if (ch.cfg || ch.rt || ch.on || ch.paused || ch.reccount || ch.snapcount || ch.wdog) loadSoon(); });
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
    if (prev?.matches('details.help')) { prev.appendChild(h); return; }   // подряд идущие пояснения — под одним «ⓘ»
    const d = document.createElement('details'); d.className = 'help'; if (h.dataset.cls) d.dataset.cls = h.dataset.cls;
    const s = document.createElement('summary'); s.textContent = 'Как это работает';
    h.replaceWith(d); d.append(s, h);
  });
}
// уведомление внизу
let toastT = null;
function toast(msg, color) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.style.borderLeftColor = color || 'var(--ok)'; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1400);
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
