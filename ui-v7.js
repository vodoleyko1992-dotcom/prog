/* Presentation-only enhancements for the modular Control Center. No game actions added. */
(() => {
  'use strict';
  const HELP = {
    chain:'После завершения боя по возможности продолжать охоту без возврата к выбору новой цели на карте.',
    searchQuest:'Искать на карте квестовых мобов (★) и цели квеста профессии — бот бьёт их первыми там, где стоит.',
    searchChamp:'Искать чемпионов на карте. Для обнаружения требуется периодически открывать карту.',
    deepEvery:'Раз в сколько боёв заходить на карту за целями (★ квесты, чемпионы). 0 — никогда: бот бьёт только тех, кого даёт цепочка «Охотиться дальше». Исключения: на точке фарма ресурса/рецепта карта раз в 5 боёв (не реже раза в 10 при большом числе) и РБ-режимы.',
    questStop:'Прекратить автоматическую охоту после выполнения поставленной квестовой цели.',
    lvlMin:'Минимальный уровень мобов для правила «Все по уровню» в приоритетах охоты.',
    lvlMax:'Максимальный уровень мобов для правила «Все по уровню» в приоритетах охоты.',
    maxPages:'Ограничивает число страниц списка целей, которые бот просматривает при поиске.',
    champHpMult:'Порог отношения HP к обычному мобу для дополнительного распознавания чемпиона.',
    lvlBelow:'Насколько ниже уровня персонажа могут быть цели при автоматическом подборе локации.',
    lvlAbove:'Насколько выше уровня персонажа могут быть цели при автоматическом подборе локации. 99 — почти без ограничения.',
    zoneAuto:'Автоматически выбирать подходящую локацию на основании накопленной эффективности и ограничений уровня.',
    debuffMinActs:'В режиме «Авто» дебафф вешается, только если по HP моба (с учётом удара кота) бой продлится ещё столько действий. Меньше — дебафф не окупит свой ход.',
    petAuto:'Бот сам призывает кота первым действием боя, держит его HP перепризывом или Servitor Heal и ставит баффы кота.',
    petSummon:'Какого кота призывать, когда кота нет или он при смерти. Авто — того же, что был.',
    petResummon:'Лечить кота перепризывом: один ход, полное HP. Выключено — только Servitor Heal.',
    petResummonAt:'При каком проценте HP кота перепризывать его (полное HP).',
    petHealAt:'При каком проценте HP кота лечить его Servitor Heal (если перепризыв выключен или не лечит).',
    petFinish:'Если удар кота добьёт моба — бесплатная «Атака» вместо заклинания; добивание считает удар кота.',
    petFinishMp:'Добивание котом — только когда MP ниже этого процента: при полной мане экономить нечего, а промах кота стоит хода.',
    petBuffAuto:'Ставить коту баффы из списка «Баффы кота» и обновлять их по времени и после нового призыва.',
    nPetBuffs:'Баффы на кота через запятую (Servitor Haste, Servitor Magic Shield…). «В бою эффекта нет» бот пропускает.',
    petBuffSec:'Сколько секунд держится бафф кота, если в справочнике нет длительности.',
    zoneTrial:'Сколько пробных боёв провести в зоне, прежде чем оценить её эффективность.',
    farmRes:'Название ресурса для целевого фарма по известным местам выпадения.',
    farmNeed:'Желаемое количество ресурса. Ноль означает отсутствие численного лимита.',
    recipeRes:'Название рецепта, который бот будет целенаправленно искать по базе выпадения.',
    recipeNeed:'Количество требуемых рецептов. Ноль — без ограничения.',
    recipeSpoil:'Учитывать добычу через Spoil, если у персонажа есть соответствующий навык.',
    catMode:'Разрешить самостоятельный фарм в катакомбах и некрополях.',
    catDungeon:'Авто — подобрать подземелье по уровню героя. Конкретное значение фиксирует выбор.',
    rbRestHp:'Минимальный процент HP перед началом попытки против обычного рейд-босса.',
    rbMaxAbove:'Предельная разница уровней: насколько РБ может быть выше персонажа.',
    rbMaxBelow:'Предельная разница уровней: насколько РБ может быть ниже персонажа.',
    rbUsePots:'Учитывать доступные банки HP в прогнозе выживаемости при сражении с РБ.',
    rbPotReserve:'Количество банок HP, которое обычно сохраняется как резерв для других задач.',
    rbMpPots:'Разрешить использование банок MP при битвах с рейд-боссами.',
    rbFast:'Уменьшает интервалы реакции в бою с РБ, увеличивая частоту проверки состояния.',
    epicMaxDeaths:'Сколько смертей на одном эпике за его появление допустимо (по умолчанию 3). Заходами после смерти бот идёт, только если подтверждено, что HP эпика сохраняется; каждая смерть стоит опыта и баффов.',
    epicCheck:'Включено — не лезть и при предупреждении «мало банок» даже на месте. Выключено — на месте после бесплатного прихода пробовать даже при предупреждении о банках. Перед оплатой проверка сил — всегда.',
    epicRetreatHp:'Желаемый порог HP для выхода по тактике «измором». Возможность зависит от игровых ограничений.',
    epicLvlUp:'Предпочтение боссов, которые ниже героя на заданное число уровней. Ноль отключает предпочтение.',
    epicMinHpPots:'Минимальный запас банок сверх резерва перед отправкой к эпику. Ноль — не проверять.',
    epicCoinDailyMax:'Coin of Luck — ценная валюта (донат, немного падает из Old Box и за TvT). Ноль — бот не тратит их никогда; число — не больше стольких за 24 часа (телепорты к эпикам и платный «Повний баф» — пока включён режим «Эпики», и между эпиками тоже).',
    epicCoinPerBoss:'Сколько платных заходов за Coin of Luck допустимо на одно появление эпика. После смерти или выхода из боя — только бесплатно или через логово.',
    epicCoinKeep:'Не тратить Coin of Luck, если после траты баланс станет ниже этого числа. Баланс неизвестен — не тратить. Ноль — не проверять.',
    epicMaxFightMin:'Не браться за эпика, если по оценке бой длится дольше стольких минут (HP босса / наш урон в секунду).',
    epicMaxRetreats:'Сколько подтверждённых выходов из боя («измором») допустимо на одно появление эпика, потом ждать следующего.',
    epicAdenaDailyMax:'Лимит аден на платные телепорты к эпикам за последние 24 часа. Ноль — лимита нет.',
    tvtOn:'Автоматически участвовать в доступных командных событиях TvT согласно правилам игрового режима.',
    autoRevive:'После смерти вернуться в город и продолжить работу, пока не достигнут лимит безопасности.',
    townBuffSet:'Выбор комплекта баффов у городского баффера. Платные наборы расходуют Coin of Luck (15 за раз). Пока включён режим «Эпики», платный набор берётся только в пределах лимита Coin of Luck на эпиков (0 — всегда бесплатный «Звичайний баф»), а во время эпика — только когда сам заход разрешён.',
    reactMin:'Нижняя граница задержки между обычными действиями бота, в миллисекундах.',
    reactMax:'Верхняя граница задержки между действиями. Не должна быть ниже минимальной.',
    nWeaponMain:'Основное оружие, которое бот стремится использовать в бою.',
    nWeaponBuff:'Дополнительное оружие, нужное для активации отдельных баффов.',
    weaponClassEquip:'Автоматически подбирать оружие, соответствующее классу персонажа.',
    weaponSwap:'Временно переключать оружие для навыка и возвращаться к основному.',
    autoRoles:'Распределять роли умений по найденным слотам панели боя.',
    fightMode:'ДПС стремится быстрее побеждать мобов; КПД экономит MP и расходники. Для РБ и TvT используются отдельные стратегии.',
    skillMpMin:'Минимальное количество MP для планирования части боевых умений.',
    stunEvery:'Минимальный интервал между попытками стана на особых целях.',
    buffSec:'Период повторной проверки и активации баффов, если они не обнаружены на персонаже.',
    nBuffs:'Перечень названий умений, которые считаются обычными баффами.',
    nKeyBuffs:'Особые значимые боевые баффы, например Frenzy, Guts или War Cry.',
    keyBuffBoss:'Ограничить раннее использование особых баффов боями с чемпионами и РБ.',
    rbFrenzyDive:'Разрешить снижение HP для активации Frenzy при атаке РБ. Повышенный риск смерти.',
    nToggles:'Названия постоянно действующих умений, расходующих MP во время активности.',
    toggleMpOff:'При падении MP ниже этого процента отключать расходующие ману постоянные умения.',
    toggleMpOn:'Вновь активировать постоянные умения при восстановлении MP выше порога.',
    nSpoil:'Название умения точечного Spoil для пометки противника.',
    nSpoilMass:'Название массового Spoil для нескольких противников.',
    nSweep:'Название умения сбора добычи после удачного Spoil.',
    spoilRb:'Разрешить попытки Spoil в боях с рейд-боссами.',
    drainHp:'При HP ниже этого процента отдавать приоритет лечащим уронным умениям.',
    nDrain:'Названия умений с поглощением здоровья от урона.',
    stopHp:'Критическая граница HP, при которой лечебные банки приоритетнее обычных действий.',
    hpPotAt:'Порог HP для обычного применения лечебной банки.',
    mpPotAt:'Уровень MP в единицах, ниже которого планируется восполнение маны.',
    rbPotAt:'Процент HP, при котором запускается серия лечения на РБ.',
    rbPotTo:'Процент HP, до которого бот старается восстановиться на РБ.',
    shopAuto:'Автоматически восполнять расходники при достижении заданных остатков.',
    shopHp:'Формат мин/до. Например, 300/1000 — при запасе меньше 300 пополнить до 1000.',
    shopMp:'Формат мин/до для банок MP.',
    shopShots:'Формат мин/до для зарядов оружия.',
    shopSpirit:'Формат мин/до для Spirit Ore.',
    shopSoul:'Формат мин/до для Soul Ore.',
    shopBait:'Формат мин/до для наживки в обычном магазине.',
    shopReserve:'Минимальная сумма аден, которую бот должен оставить после закупки.',
    shopMaxSpend:'Максимальная сумма аден, разрешённая на одну закупку.',
    fishBait:'Тип наживки. Хорошая наживка может требовать покупки за Proof.',
    fishShots:'Применять рыболовные заряды во время ловли.',
    fishAutoBuy:'Автоматически докупать рыболовные расходники за адены.',
    fishBuyPacks:'Количество пакетов обычной наживки на одну закупку.',
    fishShotAuto:'Автоматически подбирать количество зарядов в соответствии с ожидаемым расходом наживки.',
    fishShotPacks:'Число пакетов зарядов при отключённом автоматическом соотношении.',
    fishMaxCasts:'Ограничение числа забросов; ноль — без ограничения.',
    fishProcess:'Разделывать улов и обменивать материалы на Proof.',
    fishProcessEvery:'Через сколько пойманных рыб выполнять обработку улова.',
    fishOpenBoxes:'Автоматически открывать полученные Old Box при обработке улова.',
    rodEnchantTo:'Целевой уровень заточки удочки: по умолчанию +10. Бот проверяет текущую заточку и тратит Proof на свитки. Это отдельная задача: «Просто копим Proof» отключает покупки экипировки, но не заточку. Поставьте 0, чтобы не точить.',
    fishGoal:'Пустая очередь означает «Просто копим Proof». Покупка плащей, татуировок и поясов отключена. Заточка удочки настраивается отдельно.',
    dock:'Показывать панель управления справа внутри страницы игры.',
    indMode:'Формат индикатора состояния бота непосредственно в игре.',
    rec:'Вести журнал пользовательских кликов и действий бота для последующего анализа.',
    autoSnap:'Запоминать DOM-снимки страниц при изменении их состояния.',
    autoLearn:'Запоминать структуру игровых страниц и ответы серверных API.',
    netLog:'Включить подробную запись сетевых запросов и ответов сервера.',
    gameMsgLog:'Сохранять всплывающие сообщения игры и уведомления.',
    learnShots:'Сохранять скриншоты при обнаружении изменений страниц при наличии разрешения браузера.'
  };
  const titles = {
    overview:['Обзор','Сводка сессии: темп, РБ, рыбалка, запасы, кот'],
    hunt:['Охота','Фарм на месте, TvT, локации и автофарм, катакомбы'],
    autofarm:['Автофарм','Автоподбор локации для кача'],
    loc:['Локации','Ресурсы и рецепты'],
    rb:['РБ и эпики','Обычные РБ, тур по РБ, эпик-боссы'],
    epic:['Эпические боссы','Отдельная стратегия, ресурсы и ограничения'],
    dungeon:['Катакомбы','Автоматический фарм внутри подземелий'],
    fish:['Рыбалка','Оснастка, улов, обработка и Proof'],
    panel:['Бой и кот','Умения, кот, дебаффы, баффы, оружие, безопасность'],
    pet:['Слуга','Кот Warlock: призыв, лечение, баффы, статистика'],
    fight:['Тактика и герой','Безопасность, оборудование и городские сервисы'],
    supply:['Снабжение','Банки, закупка, добыча, эффективность'],
    loot:['Добыча','Учет и эффективность предметов'],
    log:['Диагностика','Журналы, API, снимки и автообучение'],
    svc:['Сервис','Автовход, память, настройки, журнал и диагностика']
  };
  // Large, discoverable tile menu: all 7 sections appear at once, no sideways scrolling.
  // Collapse after selection, preserving room for module settings in a 375px dock.
  const modeToggle = document.getElementById('modeToggle');
  const quickModes = document.getElementById('quickModeGrid');
  const modeSummary = document.getElementById('modeSummary');
  const updateModeSummary = () => {
    if (typeof paintModes === 'function') return;   // 7.1.31: сводку «режим · дополнения» пишет popup.js (paintModes)
    const active = [...(quickModes?.querySelectorAll('button.on') || [])]
      .map(b => (b.textContent || '').split(':')[0].replace(/^[^\wА-Яа-яЁё]+/u,'').trim())
      .filter(Boolean);
    if (modeSummary) modeSummary.textContent = active.length ? `Включено: ${active.join(', ')}` : 'Все режимы выключены';
  };
  modeToggle?.addEventListener('click', () => {
    const open = quickModes?.hidden;
    if (quickModes) quickModes.hidden = !open;
    modeToggle.setAttribute('aria-expanded',String(!!open));
  });
  if (quickModes) new MutationObserver(updateModeSummary).observe(quickModes,{subtree:true,attributes:true,attributeFilter:['class'],childList:true,characterData:true});
  updateModeSummary();
  const shell = document.querySelector('.app-shell');
  const navToggle = document.getElementById('navToggle');
  const navCurrentName = document.getElementById('navCurrentName');
  const setNavOpen = open => {
    shell?.classList.toggle('nav-collapsed', !open);
    navToggle?.setAttribute('aria-expanded', String(open));
  };
  navToggle?.addEventListener('click', () => setNavOpen(shell?.classList.contains('nav-collapsed')));
  document.querySelectorAll('#moduleNav button[data-tab]').forEach(b =>
    b.addEventListener('click', () => setNavOpen(false)));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !shell?.classList.contains('nav-collapsed')) {
      setNavOpen(false); navToggle?.focus();
    }
  });
  // Existing onClick/showTab handlers are owned by popup.js; listen without overriding.
  const title = document.getElementById('currentSectionTitle');
  const subtitle = document.getElementById('currentSectionDesc');
  const updateTab = tab => {
    const [name,desc] = titles[tab] || titles.overview;
    if (navCurrentName) navCurrentName.textContent = '· ' + name;
    if (title) title.textContent = name;
    if (subtitle) subtitle.textContent = desc;
    const sec = document.getElementById('tab-'+tab);
    if (sec) sec.scrollTop = 0;
  };
  document.addEventListener('l2:tabchange', e => updateTab(e.detail.tab));
  updateTab(document.querySelector('nav button.act')?.dataset.tab || 'overview');
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    const tab = b.dataset.goto;
    // 7.1.31: бывшие разделы (epic, dungeon…) — подразделы новых; showTab сам найдёт раздел и прокрутит к подразделу
    if (typeof showTab === 'function') { showTab(tab); document.documentElement.querySelector('.app-shell')?.classList.add('nav-collapsed'); return; }
    const nav = document.querySelector('nav button[data-tab="'+tab+'"]');
    if (nav) nav.click();
  }));
  for(const [id,description] of Object.entries(HELP)) {
    const el=document.getElementById(id);
    const label=el?.closest('label');
    if (!label || label.querySelector('.inline-info')) continue;
    const tip=document.createElement('button');
    tip.type='button';tip.className='inline-info';tip.textContent='i';
    tip.title='Объяснение настройки';tip.setAttribute('aria-label','Пояснение: '+(label.textContent||id).trim());
    tip.setAttribute('aria-expanded','false');
    const box=document.createElement('div');box.className='field-help';box.textContent=description;
    const ctrl=label.querySelector('input,select,textarea');
    if (ctrl) ctrl.before(tip); else label.appendChild(tip);
    label.after(box);
    tip.addEventListener('click', e => {
      e.preventDefault();e.stopPropagation();
      const open=!box.classList.contains('open');
      document.querySelectorAll('.field-help.open').forEach(e=>e.classList.remove('open'));
      document.querySelectorAll('.inline-info[aria-expanded=true]').forEach(e=>e.setAttribute('aria-expanded','false'));
      box.classList.toggle('open',open);tip.setAttribute('aria-expanded',String(open));
    });
  }
  // 8.0 (аудит меню): плитки «Обзора» и сводку рисует popup.js (renderDash) в общем цикле перерисовки —
  // здесь был второй опрос хранилища на каждую запись бота (и плитки-дубли счётчиков шапки)
})();
