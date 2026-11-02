/* ogamex-suite/suite/00-suite.js — section registry of the combined extension «OgameX Suite». Owner: integration.
 * Loaded right after shared/core/*.js and before every module. Defines data only (no DOM, no storage, no timers), plus one
 * runtime message listener: the popup asks {type:'ogx:suite:status'} and gets whether THIS tab was detected as a game page
 * (OGX.page.detect, computed on request only) and why not; see OGX.suite.tabStatus().
 *
 * One extension, one shared core, one settings store, one diagnostic journal. Modules are grouped in sections:
 *   live      — ex «OgameX Live»      (sources: ogx/ogamex-live/modules/<m>/<m>.js,     shipped as modules/live/<m>/<m>.js)
 *   infinity  — ex «OgameX Infinity»  (sources: ogx/ogamex-infinity/modules/<m>/<m>.js, shipped as modules/infinity/<m>/<m>.js)
 *   bot       — «Бот», full automation (sources: ogx/ogamex-bot/modules/<m>/<m>.js,   shipped as modules/bot/<m>/<m>.js);
 *               contract specs/bot/BOT_CONTRACT.md, runtime OGX.bot (botcore), everything off + dry-run by default
 * The suite's own module 'suite' (suite/hub.js) owns the single menu entry and the side panel with the groups
 * Live / Infinity / Бот / Логи.
 *
 * EXTENSION POINT FOR THE BOT (full automation: auto-build, auto-research, expeditions, farming with auto-espionage
 * escort, debris harvesting, fleet-save). To add a bot module <m>:
 *   1. Write ogx/ogamex-bot/modules/<m>/<m>.js with OGX.module({ name: '<m>', title, pages, settings, init(ctx) })
 *      (DESIGN.md 2.2). ctx.ext is 'bot'; log lines read «[OGX Suite/<m>]». Use only the core API: OGX.fleet.send,
 *      OGX.api.*, OGX.state, OGX.flights, OGX.galaxy, OGX.messages. Record every decision with
 *      OGX.log.rec('B', '<m>', what, data) and wrap actions with OGX.log.wrap('<m>', fn, label) (specs/DIAG.md §6).
 *   2. Add '<m>' to SECTIONS.bot.modules below (order = init order) and
 *      'modules/bot/<m>/<m>.js' to manifest.json content_scripts[1].js after the Infinity modules, before loader.js.
 *      tests/sync.sh copies ogx/ogamex-bot/modules into modules/bot/ and checks that this list and the manifest agree.
 *   3. UI: a tab in the shared panel with group 'bot':
 *        OGX.suite.panel().addTab({ id: 'bot-<m>', label, group: 'bot', order: 10+, render(container) {...} })
 *      The tab «Бот» (order 1, suite/hub.js) stays as the section overview and lists the loaded bot modules. Add a
 *      Russian title to TITLES below; the popup then lists the module under «Бот» with its on/off switch.
 *   4. Safety: the bot is the only section that may act without a click per action. Keep every loop behind
 *      an explicit «Старт» with a visible «Стоп», respect OGX.storage.lock() across tabs, the core rate limits
 *      (core.httpGapMs) and never run when document.hidden unless the user enabled core.backgroundWhenHidden.
 */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';

  const SECTIONS = {
    live: { label: 'Live', title: 'OgameX Live: производство, ресурсы в полёте, стоимость, флот, экспедиции, полёты',
      modules: ['menu', 'planetbar', 'inflight', 'techcost', 'fleetinfo', 'expedition', 'timeline'] },
    infinity: { label: 'Infinity', title: 'OgameX Infinity: панель, империя, цели, шпионаж, статистика, слежка',
      modules: ['panel', 'empire', 'targets', 'spy', 'missiles', 'stats', 'stalk', 'flights', 'fleethelp', 'todo', 'mail', 'prefs'] },
    bot: { label: 'Бот', title: 'Полная автоматизация', dev: false,
      modules: ['botcore', 'botsim', 'botpanel', 'botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo'] },
  };
  const ORDER = ['live', 'infinity', 'bot'];          // load order (= manifest content_scripts order)
  const DISPLAY_ORDER = ['infinity', 'live', 'bot'];  // order shown to the user (panel groups, popup): Infinity first
  // Russian titles for the popup (the popup does not load the modules; in the page OGX.modules[n].title is used).
  const TITLES = {
    menu: 'Меню и обновление данных', planetbar: 'Производство на планетах', inflight: 'Ресурсы в полёте и прибывающие флоты',
    techcost: 'Стоимость построек', fleetinfo: 'Информация о флоте', expedition: 'Экспедиции', timeline: 'Хронология полётов',
    panel: 'Панель управления', empire: 'Империя', targets: 'Цели, метки и поиск', spy: 'Шпионские доклады и рейды', missiles: 'Межпланетные ракеты: снос обороны',
    stats: 'Статистика и анализ сообщений', stalk: 'Слежка за активностью', flights: 'Полёты: визуализация',
    fleethelp: 'Резерв, сбор ресурсов и помощь при отправке флота', todo: 'План построек', mail: 'Почта: новое меню сообщений', prefs: 'Настройки, горячие клавиши, экспорт/импорт',
    botcore: 'Бот: ядро', botsim: 'Бот: симулятор боя', botpanel: 'Бот: панель', botsave: 'Бот: сейв флота и защита',
    botfarm: 'Бот: фарм неактивных', botdebris: 'Бот: обломки и логистика', botbuild: 'Бот: стройка и исследования',
    botexpo: 'Бот: экспедиции и колонизация',
  };

  OGX.suite = {
    name: 'OgameX Suite',
    PANEL_ID: 'infinity',             // the side panel id the Infinity modules already use (shared, get-or-create)
    MENU_ID: 'ogx-suite-entry',
    GLOBAL_KEYS: { hosts: 'suite.hosts', modules: 'suite.modules' },   // global scope ('*|*|…'), written by the popup
    sections: SECTIONS,
    order: ORDER,
    displayOrder: DISPLAY_ORDER,
    titles: TITLES,
    globalOff: new Set(),             // filled by loader.js from '*|*|suite.modules' before the modules start
    /** 'live' | 'infinity' | 'bot' | null */
    sectionOf(name) { for (const s of ORDER) if (SECTIONS[s].modules.includes(name)) return s; return null; },
    /** All feature modules in init order (without the hub). */
    moduleList() { return ORDER.flatMap((s) => SECTIONS[s].modules); },
    /** { live: [...], infinity: [...], bot: [...] } for OGX.boot({ sections }). */
    sectionMap() { const o = {}; for (const s of ORDER) o[s] = SECTIONS[s].modules.slice(); return o; },
    /** The shared side panel (created on first use). */
    panel() { return OGX.dom.sidePanel(OGX.suite.PANEL_ID, { title: 'OgameX Suite', width: 440, maxWidth: 640 }); },
  };

  /** What the popup shows under «Эта вкладка»: detection result and boot state of this tab (no page data, no storage). */
  OGX.suite.tabStatus = function () {
    let det = null;
    try { det = OGX.page.detect(document, location); } catch (e) { det = { ok: false, reason: 'detect failed: ' + (e && e.message) }; }
    const out = {
      host: location.host, ok: !!det.ok, engine: det.engine || null, candidate: !!det.candidate, reason: det.reason || null,
      generator: det.generator || null, version: det.version || null, popup: !!det.popup,
      mark: (document.documentElement && document.documentElement.dataset.ogxSuite) || null,
      active: !!OGX.active, allowHosts: Array.isArray(OGX.suite.allowHosts) ? OGX.suite.allowHosts.slice() : [],
      core: OGX.version || null, modules: (OGX._ctxs || []).map((c) => c.def.name), errors: (OGX.errors || []).length,
    };
    if (det.ok) {
      try {
        const i = OGX.page.info();
        Object.assign(out, { page: i.raw || i.name, name: i.name, mode: i.mode || null, universe: i.universe || null, info: !!i.info });
      } catch (e) { /* ignore */ }
    }
    return out;
  };
  try {
    const rt = (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) ? browser.runtime
      : (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) ? chrome.runtime : null;
    // content script only (the popup and options pages load this file too)
    if (rt && typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && window.top === window) {
      rt.onMessage.addListener((msg, sender, reply) => {
        if (!msg || msg.type !== 'ogx:suite:status') return false;
        try { reply(OGX.suite.tabStatus()); } catch (e) { reply({ ok: false, reason: 'status failed: ' + (e && e.message) }); }
        return false;
      });
    }
  } catch (e) { /* no extension runtime (userscript) */ }

  // Only the hub's entry goes into the game menu; the Live «menu» and Infinity «panel» entries stay detached (07-dom.js).
  if (OGX.dom && typeof document !== 'undefined') OGX.dom.menuOwner = OGX.suite.MENU_ID;
})(window.OGX);
