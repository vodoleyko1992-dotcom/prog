/* ogamex-bot/modules/botpanel/botpanel.js — «Бот: панель», the «Бот» group of the OgameX Suite side panel. Owner: runtime agent.
 * Contract: specs/bot/BOT_CONTRACT.md C1, C2.8 (renderOverview / panelSection), C6 (botpanel:ui); design BOT_DESIGN §1.14.
 *   - OGX.bot.renderOverview(container): the «Бот» tab (hub.js delegates to it): «Старт/Стоп», «Пробный режим» (red banner while
 *     off), «Пауза/Продолжить», state line (leader tab, next worker, queue, limits, timer mode + degraded warning), last 10
 *     actions, threats with countdowns, the explainer «Бот работает, пока открыта вкладка с игрой…»;
 *   - one tab per bot module: its «включить» switch (<m>.on), its settings (OGX.dom.settingsForm) and the module's own status
 *     section (OGX.bot.panelSection); a tab «Общие» with the botcore limits;
 *   - «Журнал»: bot events of this page (module filter) + export «Логи для разбора» (OGX.diag.download('today')).
 * Turning master on, or dry-run off, asks OGX.dom.confirm with a Russian summary. Every user command is journaled as
 * B 'botpanel:ui'. Writes only settings (on clicks) and botpanel.* keys. */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';
  const NAME = 'botpanel';
  const P = 'ogx-b-bot-';
  const MODS = [
    { name: 'botsave', label: 'Сейв', order: 10 },
    { name: 'botfarm', label: 'Фарм', order: 11 },
    { name: 'botdebris', label: 'Обломки', order: 12 },
    { name: 'botbuild', label: 'Стройка', order: 13 },
    { name: 'botexpo', label: 'Экспедиции', order: 14 },
    { name: 'botmissiles', label: 'Ракеты', order: 15 },
  ];
  const TITLES = {
    botsave: 'Бот: сейв флота и защита', botfarm: 'Бот: фарм неактивных', botdebris: 'Бот: обломки и логистика',
    botbuild: 'Бот: стройка и исследования', botexpo: 'Бот: экспедиции и колонизация',
    botmissiles: 'Бот: ракеты',
  };
  const EXPLAINER = 'Бот работает, пока открыта вкладка с игрой. Лучше всего — закреплённая вкладка в отдельном окне; ' +
    'отключите «Экономию памяти» (Memory Saver) для ogamex.eu. Фоновые вкладки браузер притормаживает: бот использует отдельный ' +
    'таймер (Worker), но держите вкладку видимой для точных отправок.';
  const NO_MODULES = 'Ни один модуль не включён — бот ничего делать не будет. Включите нужные модули ниже.';
  const DRY_LINE = 'Пробный режим: ничего не отправляется';
  const SAFETY = 'С 0.3.2 все функции бота включены по умолчанию (максимальная автономность), «Пробный режим» выключен — бот действует в игре. ' +
    'Выключайте ненужное: главный выключатель, модули во вкладках ниже; в «Пробном режиме» бот только планирует и пишет в журнал.';

  const h = (...a) => OGX.dom.h(...a);
  const sget = (k) => { try { return OGX.settings.get(k); } catch (e) { return undefined; } };
  const now = () => { try { return OGX.time.serverNow(); } catch (e) { return Date.now(); } };
  function ui(what, data) { try { OGX.log.rec('B', NAME + ':ui', what, data); } catch (e) { /* journal off */ } }
  const stateRu = (s) => (OGX.bot && OGX.bot._stateRu ? OGX.bot._stateRu(s) : s);
  const typeRu = (t) => (OGX.bot && OGX.bot._typeRu ? OGX.bot._typeRu(t) : t);
  const fmtT = (ms) => { try { return OGX.fmt.time(ms); } catch (e) { return '—'; } };
  const fmtDT = (ms) => { try { return OGX.fmt.dateTime(ms); } catch (e) { return '—'; } };
  // user-facing names instead of internal ids (module / worker ids, refusal codes, journal event kinds)
  const MOD_RU = { botcore: 'Ядро', botpanel: 'Панель', botsim: 'Симулятор', botsave: 'Сейв', botfarm: 'Фарм', botdebris: 'Обломки', botbuild: 'Стройка', botexpo: 'Экспедиции', botmissiles: 'Ракеты' };
  function modRu(id) {
    const s0 = String(id || '');
    const base = s0.split(':')[0];
    return MOD_RU[base] || s0 || '—';
  }
  const REFUSED_RU = { dryRun: 'пробный режим', limit: 'лимит в час', slots: 'нет свободных слотов', threat: 'планета под угрозой', sleep: 'режим сна',
    duplicate: 'цель уже занята', expired: 'истёк срок', stopped: 'бот остановлен или на паузе', notLeader: 'не ведущая вкладка', fuel: 'не хватает дейтерия',
    cargo: 'не хватает места в трюме', ships: 'нет кораблей', userActive: 'вы в игре', attackLimit: 'лимит атак в сутки на цель',
    target: 'цели нет', noob: 'защита новичков', vacation: 'цель в отпуске', admin: 'цель — администратор', holdTime: 'неверное время удержания',
    blocked: 'отправка заблокирована', ownPlanet: 'своя планета', missionOff: 'миссия отключена' };
  const refusedRu = (r) => REFUSED_RU[r] || r || '';
  const EVENT_RU = {
    start: 'запуск', stop: 'остановка', leader: 'ведущая вкладка', 'leader-lost': 'вкладка больше не ведущая', state: 'состояние', sleep: 'сон', wake: 'пробуждение',
    pause: 'пауза', resume: 'продолжение', backoff: 'пауза после ошибки', limit: 'лимит', 'action-queued': 'в очереди', 'action-start': 'начато',
    'action-dry': 'пробно, не отправлено', 'action-done': 'выполнено', 'action-fail': 'ошибка', 'action-refused': 'отклонено', 'action-verify-fail': 'не подтверждено',
    'action-uncertain': 'результат неизвестен', 'timer-armed': 'таймер', 'timer-fired': 'таймер сработал', 'timer-late': 'таймер опоздал', 'timer-degraded': 'неточный таймер',
    slots: 'слоты', threat: 'угроза', 'threat-gone': 'угроза исчезла', lock: 'блокировка', unlock: 'разблокировка', logout: 'выход из игры', captcha: 'капча',
    vacation: 'режим отпуска', 'unknown-page': 'неизвестная страница', settings: 'настройки', 'cp-restore': 'планета возвращена', frozen: 'вкладка заморожена', resumed: 'вкладка ожила',
    decision: 'решение', skip: 'пропуск', ui: 'команда', error: 'ошибка',
    plan: 'расчёт ракет', build: 'заказ ракет', launch: 'запуск ракет', impact: 'ракеты долетели', cleared: 'оборона снесена', silo: 'нужна шахта',
    'threat-seen': 'угроза замечена', 'threat-ignored': 'угроза пропущена', 'save-planned': 'сейв запланирован', 'save-sent': 'сейв отправлен', 'save-failed': 'сейв не удался',
    'recall-planned': 'отзыв запланирован', 'recall-done': 'флот отозван', 'abm-ordered': 'ракеты заказаны', 'spy-attacker': 'шпионаж нападающего', 'sleep-save': 'сейв на ночь',
    scan: 'сканирование', target: 'цель', 'spy-sent': 'шпионаж отправлен', report: 'доклад', sim: 'симуляция', 'attack-planned': 'атака запланирована', 'attack-sent': 'атака отправлена',
    'escort-spy': 'сопровождающий шпионаж', 'escort-report': 'доклад сопровождения', 'attack-recalled': 'атака отозвана', 'build-ships': 'достройка кораблей', cooldown: 'пауза по цели',
    'debris-predicted': 'прогноз обломков', 'recyclers-planned': 'переработчики запланированы', 'recyclers-sent': 'переработчики отправлены', 'recyclers-late': 'переработчики опоздали',
    'harvest-own': 'сбор своего поля', 'transport-planned': 'перевозка запланирована', 'transport-sent': 'перевозка отправлена', repatriate: 'вывоз ресурсов',
    candidates: 'кандидаты', choose: 'выбор', 'build-start': 'стройка начата', 'build-verify': 'проверка стройки', 'research-start': 'исследование начато', energy: 'энергия',
    storage: 'хранилища', fields: 'поля', wait: 'ожидание', stage: 'этап застройки', 'expo-ev': 'оценка экспедиции', 'expo-sent': 'экспедиция отправлена', 'expo-result': 'итог экспедиции',
    'colonize-target': 'цель колонизации', 'colonize-sent': 'колонизатор отправлен', 'colonize-result': 'итог колонизации', 'colonizer-build': 'постройка колонизатора',
  };
  function kindRu(k) {
    const s0 = String(k || '');
    const i = s0.indexOf(':');
    if (i < 0) return s0;
    const ev = s0.slice(i + 1);
    return modRu(s0.slice(0, i)) + ': ' + (EVENT_RU[ev] || ev);
  }
  function tzLabel() {
    try { const m = Math.round((+OGX.time.tzOffsetMs || 0) / 60000); const a = Math.abs(m); return 'UTC' + (m < 0 ? '−' : '+') + Math.floor(a / 60) + (a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''); } catch (e) { return 'UTC'; }
  }

  // ------------------------------------------------------------------ commands (each journaled)
  function activeModules() { return MODS.filter((m) => sget(m.name + '.on') === true).map((m) => TITLES[m.name]); }
  async function cmdStart() {
    const dry = OGX.bot.isDryRun();
    const mods = activeModules();
    const seen = await OGX.storage.get(NAME + '.masterConfirmed', false);
    if (!dry || !seen) {
      const body = h('div', { class: P + 'confirm' },
        h('p', null, dry ? 'Бот запустится в пробном режиме: он будет планировать действия и писать их в журнал, но ничего не отправит в игру.'
          : 'Пробный режим выключен: бот будет САМ отправлять флот, заказывать постройки и исследования в игре.'),
        h('p', null, 'Включённые модули: ' + (mods.length ? mods.join(', ') : 'нет (ничего не будет делаться, пока вы не включите модуль)') + '.'),
        h('p', null, 'Лимиты: ' + sget('botcore.maxActionsPerHour') + ' действий/ч, ' + sget('botcore.maxFleetSendsPerHour') + ' отправок флота/ч, ' +
          sget('botcore.maxBuildsPerHour') + ' заказов/ч; резерв слотов ' + sget('botcore.slotsReserve') + '.'),
        h('p', null, EXPLAINER));
      const ok = await OGX.dom.confirm(body, { title: 'Запустить бота?', okLabel: 'Запустить', danger: !dry });
      ui(ok ? 'Старт подтверждён' : 'Старт отменён', { cmd: 'start', confirmed: ok, dryRun: dry, modules: mods });
      if (!ok) return;
      await OGX.storage.set(NAME + '.masterConfirmed', true);
    } else ui('Старт', { cmd: 'start', dryRun: dry, modules: mods });
    await OGX.bot.start();
    // still started (the user may switch a module on next), but say so clearly: in the panel (drawOverview) and in the journal
    if (!activeModules().length) {
      ui(NO_MODULES, { cmd: 'start', warn: 'noModules', modules: [] });
      try { OGX.dom.toast(NO_MODULES, { type: 'warn', ms: 8000 }); } catch (e) { /* ignore */ }
    }
  }
  async function cmdStop() { ui('Стоп', { cmd: 'stop' }); await OGX.bot.stop('manual'); }
  async function cmdPause() { ui('Пауза', { cmd: 'pause' }); await OGX.bot.pause('user'); }
  async function cmdResume() { ui('Продолжить', { cmd: 'resume' }); await OGX.bot.resume(); }
  async function cmdDryRun(on) {
    if (!on) {
      const mods = activeModules();
      const body = h('div', { class: P + 'confirm' },
        h('p', null, 'Выключить пробный режим? Бот начнёт действовать в игре сам: отправлять флот, заказывать постройки и исследования, отзывать флоты.'),
        h('p', null, 'Включённые модули: ' + (mods.length ? mods.join(', ') : 'нет') + '. Главный выключатель: ' + (sget('botcore.master') ? 'включён' : 'выключен') + '.'),
        h('p', null, 'Лимиты: ' + sget('botcore.maxFleetSendsPerHour') + ' отправок флота/ч, ' + sget('botcore.maxBuildsPerHour') + ' заказов/ч.'));
      const ok = await OGX.dom.confirm(body, { title: 'Боевой режим', okLabel: 'Выключить пробный режим', danger: true });
      ui(ok ? 'Пробный режим выключен' : 'Пробный режим оставлен', { cmd: 'dryRun', value: false, confirmed: ok });
      if (!ok) return false;
    } else ui('Пробный режим включён', { cmd: 'dryRun', value: true });
    await OGX.settings.set('botcore.dryRun', !!on);
    return true;
  }
  async function cmdModule(name, on) {
    ui((on ? 'Включён модуль ' : 'Выключен модуль ') + name, { cmd: 'module', module: name, on });
    await OGX.settings.set(name + '.on', !!on);
  }

  // ------------------------------------------------------------------ overview («Бот» tab)
  const views = new Set();   // mounted overview roots, re-drawn on status changes
  function renderOverview(container) {
    const root = h('div', { class: P + 'overview' });
    container.appendChild(root);
    views.add(root);
    drawOverview(root);
  }
  function drawOverview(root) {
    if (!root.isConnected && root.dataset.drawn) { views.delete(root); return; }
    root.dataset.drawn = '1';
    const st = OGX.bot.status();
    root.textContent = '';
    const master = st.master && st.state !== 'stopped';
    const stateText = (st.state === 'off' ? 'Бот выключен' : st.state === 'stopped' ? 'Бот остановлен: ' + stopRu(st.stopReason)
      : 'Бот ' + stateRu(st.state) + (st.state === 'paused' && st.pauseReason ? ' (' + pauseRu(st.pauseReason) + (st.pauseProbeAt ? ', сам проверит игру в ' + fmtT(st.pauseProbeAt) : '') + ')' : '')
        + (st.state !== 'paused' && st.pauseReason === 'limit' ? ' (лимит исчерпан)' : '')
        + (st.state !== 'paused' && st.pauseReason === 'userActive' ? ' (действия ждут: вы в игре)' : '')
      ) + (st.dryRun ? ' — ' + DRY_LINE : '');
    root.appendChild(h('div', { class: [P + 'state', P + 'state-' + st.state], dataset: { state: st.state } }, stateText));
    if (master && !activeModules().length) root.appendChild(h('div', { class: [P + 'warn', P + 'no-modules'], role: 'alert' }, NO_MODULES));
    if (!st.dryRun) root.appendChild(h('div', { class: P + 'live-banner', role: 'alert' }, 'Пробный режим выключен — бот действует в игре'));
    if (st.timer && st.timer.degraded) root.appendChild(h('div', { class: P + 'warn' }, 'Вкладка в фоне: точность таймера снижена, держите вкладку видимой.'));

    const startBtn = h('button', { type: 'button', class: ['ogx-btn', master ? 'ogx-btn-danger' : 'ogx-btn-primary', P + 'master'], dataset: { ogxAct: master ? 'bot:stop' : 'bot:start' },
      onClick: () => (master ? cmdStop() : cmdStart()) }, master ? 'Стоп' : 'Старт');
    const pauseBtn = h('button', { type: 'button', class: ['ogx-btn', P + 'pause'], disabled: !master, dataset: { ogxAct: st.state === 'paused' ? 'bot:resume' : 'bot:pause' },
      onClick: () => (st.state === 'paused' ? cmdResume() : cmdPause()) }, st.state === 'paused' ? 'Продолжить' : 'Пауза');
    const dry = h('input', { type: 'checkbox', class: P + 'dry', checked: st.dryRun, dataset: { ogxAct: 'bot:dryrun' },
      onChange: async (ev) => { const want = ev.target.checked; const done = await cmdDryRun(want); if (!done) ev.target.checked = !want; } });
    root.appendChild(h('div', { class: P + 'controls' }, startBtn, pauseBtn, h('label', { class: P + 'dry-label', title: 'Планировать и писать в журнал, ничего не отправлять' }, dry, ' Пробный режим')));

    // state line
    const workers = (st.workers || []).filter((w) => w.on && w.nextAt).sort((a, b) => a.nextAt - b.nextAt);
    const lim = st.limits || {};
    const limTxt = ['actions', 'fleetSends', 'builds', 'galaxyViews'].map((k) => {
      const l = lim[k] || { used: 0, max: 0 };
      return { actions: 'действия', fleetSends: 'флот', builds: 'стройка', galaxyViews: 'галактика' }[k] + ' ' + l.used + '/' + l.max;
    }).join(' · ');
    const info = [
      ['Ведущая вкладка', st.leader ? 'эта' : st.leaderTab ? 'другая' : '—'],
      ['Следующий запуск', workers.length ? modRu(workers[0].id) + ' в ' + fmtT(workers[0].nextAt) : '—'],
      ['Очередь', String((st.queue || []).length) + ((st.queue || []).length ? ': ' + st.queue.slice(0, 3).map((q) => typeRu(q.type)).join(', ') : '')],
      ['Лимиты за час', limTxt],
      ['Таймер', st.timer ? (st.timer.mode === 'worker' ? 'точный (отдельный поток)' : 'обычный') + (st.timer.degraded ? ' (неточно)' : '') : '—'],
    ];
    for (const x of st.limitsHit || []) info.push(['Лимит исчерпан', '«' + x.label + '» ' + x.used + '/' + x.max + ', действия ждут до ' + fmtT(x.reopensAt) + ' (увеличьте лимит в «Общие»)']);
    if (st.consecutiveErrors) info.push(['Ошибок подряд', String(st.consecutiveErrors) + (st.errors && Object.keys(st.errors).length ? ' (' + Object.entries(st.errors).map(([m, s]) => m + ' ' + s.n).join(', ') + ')' : '') + (st.backoffUntil ? ', откат до ' + fmtT(st.backoffUntil) : '')]);
    if (st.sleepUntil) info.push(['Сон до', fmtT(st.sleepUntil)]);
    if (sget('botcore.autoLogin') === true) {
      const al = OGX.bot.autoLoginInfo ? OGX.bot.autoLoginInfo() : null;
      const last = al && al.last && al.last.text ? al.last.text + ' (' + fmtT(al.last.t) + ')' : 'включён, вылетов не было';
      info.push(['Автовход', last]);
    }
    root.appendChild(h('table', { class: 'ogx-table ' + P + 'info' }, h('tbody', null, info.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v))))));
    // efficiency of the last hour: how many requests were reads, how many reads the shared cache answered
    const ef = st.efficiency || (OGX.bot.efficiency ? OGX.bot.efficiency() : null);
    if (ef) root.appendChild(h('div', { class: P + 'eff', title: 'За последний час: HTTP-запросы бота, из них чтения; «из кэша» — повторные чтения без запроса' },
      'Запросов: ' + (+ef.requests || 0) + ' (чтений ' + (+ef.reads || 0) + ', из кэша ' + (+ef.cached || 0) + '), построек ' + (+ef.builds || 0) + ', отправок ' + (+ef.sends || 0)));

    // threats
    const threats = OGX.bot.threats ? OGX.bot.threats() : [];
    const locked = OGX.bot.lockedBodies ? OGX.bot.lockedBodies() : {};
    root.appendChild(h('div', { class: P + 'h' }, 'Угрозы'));
    if (!threats.length) root.appendChild(h('div', { class: P + 'muted' }, 'Враждебных флотов не видно.'));
    else {
      root.appendChild(h('table', { class: 'ogx-table ' + P + 'threats' }, h('tbody', null, threats.map((t) => h('tr', { dataset: { key: t.key } },
        h('td', null, (OGX.catalog.missionName ? OGX.catalog.missionName(t.mission) : t.mission) + (t.probesOnly ? ' (зонды)' : '')),
        h('td', null, (t.from || '?') + ' → ' + (t.to || '?')),
        h('td', null, OGX.dom.countdown(t.arrival, { doneText: 'прибыл' })),
        h('td', null, t.bodyKey && locked[t.bodyKey] ? 'блок' : ''))))));
    }

    // last actions
    const acts = OGX.bot.recentActions ? OGX.bot.recentActions(10) : [];
    root.appendChild(h('div', { class: P + 'h' }, 'Последние действия'));
    if (!acts.length) root.appendChild(h('div', { class: P + 'muted' }, 'Пока ничего.'));
    else {
      root.appendChild(h('table', { class: 'ogx-table ' + P + 'actions' }, h('tbody', null, acts.map((a) => h('tr', { dataset: { phase: a.phase } },
        h('td', null, fmtT(a.t)), h('td', { title: a.module }, modRu(a.module)), h('td', null, typeRu(a.type)),
        h('td', { class: a.phase === 'done' ? 'ogx-ok' : a.phase === 'dry' ? '' : 'ogx-bad' }, phaseRu(a)),
        h('td', { class: P + 'why' }, a.why || ''))))));
    }

    root.appendChild(h('div', { class: P + 'explainer' }, h('div', null, SAFETY), h('div', null, EXPLAINER),
      h('div', null, 'Подробности каждого решения — во вкладке «Журнал» и в «Логи для разбора».')));
  }
  function phaseRu(a) {
    if (a.phase === 'dry') return 'пробно';
    if (a.phase === 'done') return a.verified ? 'готово ✓' : 'готово';
    if (a.phase === 'refused') return 'отказ: ' + refusedRu(a.refused);
    return 'ошибка' + (a.message ? ': ' + a.message : '');
  }
  function stopRu(r) { return { logout: 'выход из игры', captcha: 'капча', vacation: 'режим отпуска', unknownPage: 'неизвестная страница (5 раз подряд)', banned: 'аккаунт заблокирован', errors: 'ошибки', manual: 'вручную' }[r] || r || '—'; }
  function pauseRu(r) { return { user: 'вручную', errors: 'много ошибок подряд', limit: 'лимит', threat: 'угроза', userActive: 'вы в игре', logout: 'вылет из игры, ждёт автовход' }[r] || r; }

  let redrawTimer = null;
  function redrawAll() {
    if (redrawTimer) return;
    redrawTimer = setTimeout(() => {
      redrawTimer = null;
      for (const r of [...views]) { if (r.isConnected) drawOverview(r); else views.delete(r); }
      for (const t of [...modViews]) { if (t.el.isConnected) drawModuleStatus(t); else modViews.delete(t); }
      for (const el of [...gapHints]) { if (el.isConnected) drawGapHint(el); else gapHints.delete(el); }
    }, 300);
  }

  // ------------------------------------------------------------------ module tabs
  const modViews = new Set();
  function renderModule(container, m) {
    const on = sget(m.name + '.on') === true;
    const loaded = !!OGX.modules[m.name];
    const sw = h('input', { type: 'checkbox', class: P + 'mod-on', checked: on, dataset: { ogxAct: 'bot:module', module: m.name },
      onChange: (ev) => cmdModule(m.name, ev.target.checked) });
    container.appendChild(h('div', { class: P + 'mod', dataset: { module: m.name } },
      h('div', { class: P + 'h' }, TITLES[m.name]),
      h('label', { class: P + 'mod-switch' }, sw, ' Модуль работает (бот выполняет его действия)'),
      loaded ? null : h('div', { class: P + 'muted' }, 'Код модуля не загружен: он выключен в окне расширения (раздел «Модули»).'),
      h('div', { class: P + 'muted' }, 'Работает только при включённом боте (вкладка «Бот»). В пробном режиме модуль только планирует.')));
    const status = { el: h('div', { class: P + 'mod-status' }), module: m.name };
    container.appendChild(status.el);
    modViews.add(status);
    drawModuleStatus(status);
    const form = OGX.dom.settingsForm([m.name]);
    // '<m>.on' is the switch above; '<m>.enabled' (code loading, core-added) stays in the extension popup only: two similar
    // switches in one tab were easy to confuse
    for (const k of ['on', 'enabled']) for (const el of form.querySelectorAll('[data-key="' + m.name + '.' + k + '"]')) el.remove();
    container.appendChild(h('div', { class: P + 'h' }, 'Настройки'));
    clampHints(form);
    container.appendChild(form);
  }
  // a number typed outside the setting's range is stored clamped (OGX.settings validate): say so next to the field, the input
  // already shows the stored value after the save (audit rules-5)
  function clampHints(form) {
    form.addEventListener('change', (ev) => {
      const inp = ev.target;
      if (!inp || inp.type !== 'number') return;
      const box = inp.closest('[data-key]');
      const path = box && box.dataset.key;
      if (!path) return;
      let sp = null;
      try { const [ns, ...rest] = path.split('.'); sp = (OGX.settings.schema()[ns] || {})[rest.join('.')] || null; } catch (e) { sp = null; }
      const typed = Number(String(inp.value).replace(',', '.'));
      let hint = box.querySelector('.' + P + 'clamp-hint');
      const out = sp && Number.isFinite(typed) && ((sp.min != null && typed < sp.min) || (sp.max != null && typed > sp.max));
      if (!out) { if (hint) hint.remove(); return; }
      const stored = sp.max != null && typed > sp.max ? sp.max : sp.min;
      const text = 'Введено ' + typed + ' — сохранено ' + stored + ' (' + (typed > sp.max ? 'макс. ' + sp.max : 'мин. ' + sp.min) + ').';
      if (!hint) { hint = h('div', { class: [P + 'warn', P + 'clamp-hint'] }); box.appendChild(hint); }
      hint.textContent = text;
      ui('Значение ограничено: ' + path + ' ' + typed + ' -> ' + stored, { path, typed, stored, min: sp.min != null ? sp.min : null, max: sp.max != null ? sp.max : null });
    });
  }
  function drawModuleStatus(v) {
    v.el.textContent = '';
    const render = OGX.bot._panelSection ? OGX.bot._panelSection(v.module) : null;
    if (!render) { v.el.appendChild(h('div', { class: P + 'muted' }, 'Модуль не показывает своё состояние.')); return; }
    try { render(v.el); } catch (e) { v.el.appendChild(h('div', { class: 'ogx-bad' }, 'Ошибка отображения: ' + (e && e.message))); }
  }
  function renderCommon(container) {
    container.appendChild(h('div', { class: P + 'h' }, 'Общие настройки бота'));
    container.appendChild(h('div', { class: P + 'muted' }, 'Главный выключатель и пробный режим — на вкладке «Бот».'));
    const form = OGX.dom.settingsForm(['botcore']);
    for (const k of ['master', 'dryRun', 'enabled']) for (const el of form.querySelectorAll('[data-key="botcore.' + k + '"]')) el.remove();
    // the settings section is «Бот: общие» (C5), not the module title «Бот: ядро»
    const lg = form.querySelector('fieldset[data-ns="botcore"] > legend');
    if (lg) lg.textContent = 'Бот: общие';
    const hint = h('div', { class: [P + 'warn', P + 'gap-hint'] });
    gapHints.add(hint);
    drawGapHint(hint);
    container.appendChild(hint);
    clampHints(form);
    container.appendChild(form);
  }
  // max < min: the core uses max = min (OGX.bot.gapRange); say so next to the settings
  const gapHints = new Set();
  function drawGapHint(el) {
    const g = OGX.bot.gapRange ? OGX.bot.gapRange() : null;
    el.hidden = !(g && g.clamped);
    el.textContent = g && g.clamped ? 'Пауза «макс.» (' + g.setMax + ' мс) меньше «мин.» — бот использует макс. = мин. = ' + g.min + ' мс.' : '';
  }

  // ------------------------------------------------------------------ journal tab
  function renderJournal(container) {
    let filter = '';
    const sel = h('select', { class: P + 'jfilter', dataset: { ogxAct: 'bot:journal-filter' }, onChange: (ev) => { filter = ev.target.value; draw(); } },
      [['', 'все модули'], ['botcore', 'ядро'], ['botpanel', 'панель'], ...MODS.map((m) => [m.name, TITLES[m.name]])].map(([v, l]) => h('option', { value: v }, l)));
    const exportBtn = h('button', { type: 'button', class: 'ogx-btn', dataset: { ogxAct: 'bot:journal-export' },
      onClick: () => { ui('Экспорт журнала', { cmd: 'export' }); try { OGX.diag.download('today'); } catch (e) { OGX.dom.toast('Экспорт не удался: ' + e.message, { type: 'error' }); } } }, 'Логи для разбора (сегодня)');
    const list = h('div', { class: P + 'jlist' });
    container.appendChild(h('div', { class: P + 'jbar' }, sel, ' ', exportBtn));
    container.appendChild(h('div', { class: P + 'muted' }, 'События бота этой страницы (новые сверху). Время — серверное (' + tzLabel() + '). Полный журнал всех вкладок — в «Логи для разбора»; там время указано в UTC.'));
    container.appendChild(list);
    function draw() {
      const ev = (OGX.diag && OGX.diag.recent ? OGX.diag.recent({ s: 'B' }) : []).filter((e) => /^bot/.test(e.k || '') && (!filter || (e.k || '').startsWith(filter + ':'))).slice(-200).reverse();
      list.textContent = '';
      if (!ev.length) { list.appendChild(h('div', { class: P + 'muted' }, 'Событий пока нет.')); return; }
      list.appendChild(h('table', { class: 'ogx-table ' + P + 'journal' }, h('tbody', null, ev.map((e) => h('tr', { dataset: { kind: e.k } },
        h('td', null, fmtDT(e.t)), h('td', { title: e.k }, kindRu(e.k)), h('td', null, e.w || ''))))));
    }
    draw();
  }

  // ------------------------------------------------------------------ module
  OGX.bot = OGX.bot || {};
  OGX.bot.renderOverview = renderOverview;

  OGX.module({
    name: NAME,
    title: 'Бот: панель',
    pages: '*',
    async init(ctx) {
      ctx.css(CSS);
      if (OGX.bot.ready) await OGX.bot.ready;
      const panel = OGX.suite && OGX.suite.panel ? OGX.suite.panel() : null;
      if (panel) {
        panel.addTab({ id: 'bot-common', label: 'Общие', group: 'bot', order: 9, render: (c) => renderCommon(c) });
        for (const m of MODS) panel.addTab({ id: 'bot-' + m.name, label: m.label, group: 'bot', order: m.order, render: (c) => renderModule(c, m) });
        panel.addTab({ id: 'bot-log', label: 'Журнал', group: 'bot', order: 30, render: (c) => renderJournal(c) });
      }
      if (OGX.bot.onStatus) OGX.bot.onStatus(() => redrawAll());
      ctx.bus.on('bot:action', () => redrawAll());
      ctx.bus.on('bot:threat', () => redrawAll());
      ctx.bus.on('bot:panel-section', () => redrawAll());
      OGX.settings.onChange('*', (path) => { if (/^bot/.test(path || '')) redrawAll(); });
    },
  });

  const CSS = `
.${P}overview, .${P}mod { font-size: 12px; }
.${P}state { font-size: 14px; font-weight: bold; margin: 4px 0 8px; color: #fff; }
.${P}state-off, .${P}state-stopped { color: var(--ogx-muted, #8593a3); }
.${P}state-stopped { color: var(--ogx-bad, #e53935); }
.${P}state-running, .${P}state-idle { color: var(--ogx-ok, #4caf50); }
.${P}state-paused, .${P}state-sleeping { color: var(--ogx-warn, #ffb300); }
.${P}live-banner { background: #b71c1c; color: #fff; font-weight: bold; padding: 6px 8px; border-radius: 3px; margin: 6px 0; }
.${P}warn { background: rgba(255, 179, 0, .15); border: 1px solid var(--ogx-warn, #ffb300); padding: 4px 6px; margin: 6px 0; border-radius: 3px; }
.${P}controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0 10px; }
.${P}master { min-width: 80px; font-weight: bold; }
.${P}dry-label, .${P}mod-switch { cursor: pointer; }
.${P}h { font-weight: bold; color: #fff; margin: 10px 0 4px; }
.${P}muted { color: var(--ogx-muted, #8593a3); margin: 2px 0 6px; line-height: 1.4; }
.${P}info td:first-child { color: var(--ogx-muted, #8593a3); white-space: nowrap; padding-right: 8px; }
.${P}why { color: var(--ogx-muted, #8593a3); }
.${P}explainer { margin-top: 10px; padding: 6px; border: 1px solid var(--ogx-border, #2b3846); border-radius: 3px; color: var(--ogx-muted, #8593a3); line-height: 1.4; }
.${P}explainer div + div { margin-top: 4px; }
.${P}jbar { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
.${P}journal td { vertical-align: top; }
.${P}journal td:nth-child(2) { white-space: nowrap; color: var(--ogx-muted, #8593a3); }
.${P}confirm p { margin: 0 0 6px; line-height: 1.4; }
`;
})(window.OGX);
