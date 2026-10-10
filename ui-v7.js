/* Presentation-only enhancements for the modular Control Center. No game actions added. */
(() => {
  'use strict';
  const HELP = {
    campaignEvery:'Через указанное количество боёв бот проверяет прогресс текущей сюжетной главы. Минимум — 5.',
    chain:'После завершения боя по возможности продолжать охоту без возврата к выбору новой цели на карте.',
    searchQuest:'Искать на карте квестовых противников и цели сюжетной кампании.',
    searchChamp:'Искать чемпионов на карте. Для обнаружения требуется периодически открывать карту.',
    deepEvery:'Интервал проверки карты в боях. Ноль — проверять при каждой возможности.',
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
    epicMaxDeaths:'После указанного числа смертей на одном эпике перейти к следующему. Учитывай возможную потерю опыта.',
    epicCheck:'Оценить перспективность боя до начала попытки; бесперспективные цели откладывать.',
    epicRetreatHp:'Желаемый порог HP для выхода по тактике «измором». Возможность зависит от игровых ограничений.',
    epicLvlUp:'Предпочтение боссов, которые ниже героя на заданное число уровней. Ноль отключает предпочтение.',
    epicMinHpPots:'Минимальный запас банок сверх резерва перед отправкой к эпику. Ноль — не проверять.',
    epicCoinDailyMax:'Лимит Coin of Luck на платные телепорты к эпикам за последние 24 часа. Ноль — лимита нет.',
    epicAdenaDailyMax:'Лимит аден на платные телепорты к эпикам за последние 24 часа. Ноль — лимита нет.',
    tvtOn:'Автоматически участвовать в доступных командных событиях TvT согласно правилам игрового режима.',
    autoRevive:'После смерти вернуться в город и продолжить работу, пока не достигнут лимит безопасности.',
    townBuffSet:'Выбор комплекта баффов у городского баффера. Платные наборы расходуют Coin of Luck.',
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
    overview:['Обзор','Состояние, режимы и быстрые переходы'],
    hunt:['Фарм мобов','Приоритеты целей, кампания и охота'],
    autofarm:['Автофарм','Автоподбор локации для кача'],
    loc:['Локации','Ресурсы и рецепты'],
    rb:['Рейд-боссы','Обычные РБ, тур и оценка силы'],
    epic:['Эпические боссы','Отдельная стратегия, ресурсы и ограничения'],
    dungeon:['Катакомбы','Автоматический фарм внутри подземелий'],
    fish:['Рыбалка','Оснастка, улов, обработка и Proof'],
    panel:['Боевой движок','Умения, приоритеты, баффы и откаты'],
    pet:['Слуга','Кот Warlock: призыв, лечение, баффы, статистика'],
    fight:['Тактика и герой','Безопасность, оборудование и городские сервисы'],
    supply:['Расходники','Лечение, закупка и финансовые лимиты'],
    loot:['Добыча','Учет и эффективность предметов'],
    log:['Диагностика','Журналы, API, снимки и автообучение'],
    svc:['Сервис','Память, настройки и восстановление']
  };
  // Large, discoverable tile menu: all 15 sections appear at once, no sideways scrolling.
  // Collapse after selection, preserving room for module settings in a 375px dock.
  const modeToggle = document.getElementById('modeToggle');
  const quickModes = document.getElementById('quickModeGrid');
  const modeSummary = document.getElementById('modeSummary');
  const updateModeSummary = () => {
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
  const set=(id,value)=>{const e=document.getElementById(id); if (e)e.textContent=value;};
  const integer=n=>Number(n||0).toLocaleString('ru-RU');
  async function overview() {
    if (document.hidden) return;
    try {
      const {cfg={},rt={},on=false}=await chrome.storage.local.get(['cfg','rt','on']);
      set('overviewKills',integer(rt.kills));set('overviewExp',integer(rt.exp));set('overviewAdena',integer(rt.adena));
      set('overviewState',on?'В работе':'Остановлен');
      const state=(id,enabled)=>{const el=document.getElementById(id);if(el){el.textContent=enabled?'● Включён':'Открыть ↗';el.style.color=enabled?'#7be9be':'';}};
      state('modeRbState',cfg.rbMode||cfg.rbHuntMode);
      state('modeEpicState',cfg.epicMode);
      state('modeCatState',cfg.catMode);
      state('modeFishState',cfg.fishMode);
    } catch(e) { /* The normal popup controller reports backend failures. */ }
  }
  overview();
  let scheduled=false;
  chrome.storage.onChanged.addListener(ch=>{
    if (!(ch.cfg||ch.rt||ch.on)||scheduled) return;
    scheduled=true;
    setTimeout(()=>{scheduled=false;overview();},300);
  });
})();
