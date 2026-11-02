/* ogamex-suite/suite/hub.js — module 'suite' of «OgameX Suite». Owner: integration.
 * Initialised first (loader order), on every in-game page:
 *   - the ONE menu entry «OgameX Suite» in the game menu, OGX.dom.anchors().menu (GALAXYZ: the left menu ul#menuTable;
 *     OgameX: ul#menuTableTools; no menu -> a small fixed launcher button). The Live «menu» and Infinity «panel» entries
 *     are built detached, see OGX.dom.menuOwner; its badge mirrors theirs (refresh-all progress, «!» on self-learning alerts,
 *     hostile fleets);
 *   - the ONE side panel (id 'infinity', shared with the Infinity tabs) titled «OgameX Suite», with the groups
 *     Live / Infinity / Бот / Логи (OGX.dom sidePanel.setGroups):
 *       Live      tab «Обзор»: Live modules with their state on this page and per-account switches, buttons
 *                 «Окно OgameX Live» (OGX.liveMenu.open) and «Обновить данные всех планет» (OGX.liveMenu.refreshAll);
 *       Infinity  the Infinity module tabs (Планеты, Империя, Цели, …, Настройки);
 *       Бот       tab «Бот» = OGX.bot.renderOverview (botpanel) when the bot runtime is loaded, else the placeholder below;
 *       Логи      the shared «Логи для разбора» panel (OGX.diag.addPanelTab, tab id 'diag') and «Скан страниц»
 *                 (OGX.pagescan.addPanelTab, tab id 'pagescan', GALAXYZ only).
 * Writes only settings (<module>.enabled of Live modules, on a click). */
(function (OGX) {
  'use strict';
  const NAME = 'suite';
  const P = 'ogx-s-hub-';

  OGX.module({
    name: NAME,
    title: 'OgameX Suite: меню и панель',
    pages: '*',
    settings: {
      enabled: { type: 'bool', default: true, hidden: true, label: 'OgameX Suite' },
    },
    init(ctx) {
      ctx.css(CSS);
      const dom = OGX.dom;
      const h = dom.h;
      const S = OGX.suite;
      const rec = (src, what, data) => { try { OGX.log.rec(src, NAME, what, data); } catch (e) { /* journal off */ } };

      // ------------------------------------------------------------------ panel and groups
      const panel = S.panel();
      // A page that already carries our panel markup (a copy saved while the extension ran, a second instance): every
      // #ogx-panel-<id> that is not the live element is a dead duplicate beside the real one — drop it, one journal line.
      try {
        const dead = [...document.querySelectorAll('#' + panel.el.id)].filter((x) => x !== panel.el);
        if (dead.length) { dead.forEach((x) => x.remove()); rec('S', 'stale-panel', { n: dead.length }); }
      } catch (e) { /* ignore */ }
      // The Infinity «panel» module titles the shared panel «OgameX Infinity» when it starts; the suite name wins.
      const title = () => { if (panel.setTitle) panel.setTitle('OgameX Suite'); };
      title();
      ctx.bus.on('ready', title);
      panel.setGroups([
        ...S.displayOrder.map((id) => ({ id, label: S.sections[id].label, title: S.sections[id].title })),
        { id: 'logs', label: 'Логи', title: 'Логи для разбора' },
      ], { defaultGroup: 'infinity', tabGroups: { diag: 'logs', pagescan: 'logs' } });

      const liveTab = panel.addTab({ id: 'live', label: 'Обзор', group: 'live', order: 1, render: (c) => renderLive(c) });
      panel.addTab({ id: 'bot', label: 'Бот', group: 'bot', order: 1, render: (c) => renderBot(c) });
      try { if (OGX.diag && typeof OGX.diag.addPanelTab === 'function') OGX.diag.addPanelTab(panel); } catch (e) { ctx.log.warn('diag tab', e); }
      try { if (OGX.pagescan && typeof OGX.pagescan.addPanelTab === 'function' && OGX.page.isGz && OGX.page.isGz()) OGX.pagescan.addPanelTab(panel); } catch (e) { ctx.log.warn('pagescan tab', e); }
      const toggle = (how) => {
        rec('U', 'panel:toggle', Object.assign({ open: !panel.isOpen() }, how));
        panel.toggle();
        if (panel.isOpen()) { try { panel.el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      };
      // Esc also when the focus fell back to <body> (switching a group re-draws the bars and drops the focused button).
      ctx.on(document, 'keydown', (ev) => {
        if (ev.key !== 'Escape' || !panel.isOpen() || document.querySelector('.ogx-modal-overlay')) return;
        if (ev.target === document.body || ev.target === document.documentElement || panel.el.contains(ev.target)) panel.close();
      });

      // ------------------------------------------------------------------ the single menu entry
      // GALAXYZ: ul#menuTable (left menu, specs/galaxyz/layout.md §10); OgameX: ul#menuTableTools. Without a menu (a page
      // the game renders without its chrome) a small fixed launcher opens the same panel.
      let entry = null;
      if (dom.anchors().menu) {
        entry = dom.menuEntry({
          id: S.MENU_ID, label: 'OgameX Suite', iconText: '✦', title: 'OgameX Suite: Infinity, Live, Бот, Логи',
          onClick: () => toggle({}),
        });
        const a = entry.li.querySelector('a');
        if (a) a.dataset.ogxAct = 'suite:toggle';
        const icon = entry.li.querySelector('.menu_icon');
        if (icon) ctx.on(icon, 'click', (ev) => { ev.preventDefault(); toggle({ icon: true }); });
        let last = null;
        const mirror = () => {
          const parts = [];
          for (const x of dom.menuEntries || []) {
            if (!x.detached || !x.badgeEl || x.badgeEl.hidden) continue;
            const t = String(x.badgeEl.textContent || '').trim();
            if (t && !parts.includes(t)) parts.push(t);
          }
          const text = parts.length ? parts.join(' · ') : null;
          if (text !== last) { last = text; entry.setBadge(text); }
        };
        mirror();
        ctx.every(1000, mirror);
        ctx.bus.on('ready', mirror);
      } else {
        const btn = h('button', { type: 'button', id: P + 'launcher', class: 'ogx-root ogx-btn ogx-btn-primary ' + P + 'launcher', title: 'OgameX Suite: Infinity, Live, Бот, Логи',
          dataset: { ogxAct: 'suite:toggle' }, onClick: () => toggle({ launcher: true }) }, '✦ Suite');
        dom.root().appendChild(btn);
      }

      // ------------------------------------------------------------------ Live overview tab
      function moduleState(name) {
        const def = OGX.modules[name];
        if (!def) return { cls: 'ogx-bad', text: 'не загружен' };
        const global = !(S.globalOff && S.globalOff.has(name)); // set by loader.js from the popup's switches
        const account = OGX.settings.get(name + '.enabled') !== false;
        const active = (OGX._ctxs || []).some((c) => c.def.name === name);
        if (!global && account) return { cls: 'ogx-muted', text: 'выключен в окне расширения', globalOff: true };
        if (!account) return { cls: 'ogx-muted', text: 'выключен для этого аккаунта' };
        if (active) return { cls: 'ogx-ok', text: 'работает на этой странице' };
        return { cls: 'ogx-muted', text: 'не для этой страницы' };
      }
      function renderLive(c) {
        const live = S.sections.live.modules;
        const note = h('div', { class: P + 'note', hidden: true }, 'Изменения применятся после перезагрузки страницы. ',
          h('button', { type: 'button', class: 'ogx-btn', dataset: { ogxAct: 'suite:reload' }, onClick: () => location.reload() }, 'Перезагрузить'));
        const rows = live.map((name) => {
          const def = OGX.modules[name] || { title: name };
          const st = moduleState(name);
          const cb = h('input', { type: 'checkbox', checked: OGX.settings.get(name + '.enabled') !== false, disabled: !!st.globalOff,
            dataset: { ogxAct: 'suite:live-toggle', module: name },
            onChange: async (ev) => {
              rec('U', 'module:toggle', { module: name, on: ev.target.checked });
              await OGX.settings.set(name + '.enabled', ev.target.checked);
              note.hidden = false;
            } });
          return h('tr', { dataset: { module: name } },
            h('td', null, h('label', null, cb, ' ', def.title || name)),
            h('td', { class: [P + 'state', st.cls] }, st.text));
        });
        const openBtn = h('button', { type: 'button', class: 'ogx-btn ogx-btn-primary', dataset: { ogxAct: 'suite:live-open' }, disabled: !OGX.liveMenu,
          title: OGX.liveMenu ? 'Данные планет, данные сервера, настройки модулей Live' : 'Модуль «Меню и обновление данных» выключен',
          onClick: () => { rec('U', 'live:open', {}); if (OGX.liveMenu) OGX.liveMenu.open(); } }, 'Окно OgameX Live');
        const refreshBtn = h('button', { type: 'button', class: 'ogx-btn', dataset: { ogxAct: 'suite:live-refresh' }, disabled: !OGX.liveMenu,
          onClick: () => { rec('U', 'live:refresh-all', {}); if (OGX.liveMenu) { OGX.liveMenu.open(); OGX.liveMenu.refreshAll(); } } }, 'Обновить данные всех планет');
        c.appendChild(h('div', { class: P + 'live' },
          h('div', { class: P + 'h' }, 'OgameX Live'),
          h('div', { class: P + 'muted' }, 'Производство и склады в списке планет, ресурсы в полёте, стоимость построек, информация о флоте, экспедиции и шкала полётов. Всё считается из страниц игры, которые вы открываете.'),
          h('div', { class: P + 'actions' }, openBtn, ' ', refreshBtn),
          h('table', { class: 'ogx-table ' + P + 'modules' }, h('thead', null, h('tr', null, h('th', null, 'Модуль'), h('th', null, 'Состояние'))), h('tbody', null, rows)),
          note,
          h('div', { class: P + 'muted' }, 'Здесь модули включаются для текущего аккаунта. Для всех серверов сразу — в окне расширения (значок на панели браузера).')));
      }

      // ------------------------------------------------------------------ Bot tab: botpanel's overview (OGX.bot.renderOverview), else the placeholder
      function renderBot(c) {
        if (OGX.bot && typeof OGX.bot.renderOverview === 'function' && OGX.modules.botcore) {
          try { OGX.bot.renderOverview(c); return; } catch (e) { ctx.log.warn('bot overview', e); c.textContent = ''; }
        }
        // botcore not loaded (module switched off in the popup or failed to start): explain, never act
        c.appendChild(h('div', { class: P + 'bot' },
          h('div', { class: P + 'h' }, 'Бот не загружен'),
          h('div', { class: P + 'muted' }, 'Ядро бота («Бот: ядро») выключено или не запустилось на этой странице. Включите его в окне расширения (значок на панели браузера → «Модули» → «Бот») и обновите страницу. Пока ядро не загружено, бот ничего не делает в игре.')));
      }

      rec('S', 'hub', 'ready', { sections: S.order.map((s) => s + ':' + S.sections[s].modules.filter((n) => (OGX._ctxs || []).some((x) => x.def.name === n)).length) });
      OGX.suite.hub = { panel, entry, liveTab };
    },
  });

  const CSS = `
.${P}h { font-weight: bold; color: #fff; margin: 4px 0 6px; font-size: 13px; }
.${P}muted { color: var(--ogx-muted, #8593a3); margin: 4px 0 8px; line-height: 1.4; }
.${P}actions { margin: 6px 0 10px; display: flex; gap: 6px; flex-wrap: wrap; }
.${P}modules { margin: 4px 0 8px; }
.${P}modules label { cursor: pointer; }
.${P}state.ogx-ok { color: var(--ogx-ok, #4caf50); }
.${P}state.ogx-muted { color: var(--ogx-muted, #8593a3); }
.${P}note { margin: 6px 0; padding: 6px; border: 1px solid var(--ogx-border, #2b3846); border-radius: 3px; }
.${P}list { margin: 4px 0 8px 18px; padding: 0; list-style: disc; }
.${P}list li { margin: 2px 0; }
.${P}launcher { position: fixed; left: 8px; bottom: 8px; z-index: 8990; }
`;
})(window.OGX);
