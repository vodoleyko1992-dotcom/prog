/* ogamex-live/modules/menu/menu.js — Owner: live/menu.
 * Menu entry «OgameX Live» in ul#menuTableTools, settings modal (data freshness per body, server data,
 * settings of every Live module, diagnostics), «Обновить данные всех планет» (OGX.state.refreshBodies after the
 * one-time ?cp= notice, with progress and cancel), galaxy footer clock, coexistence note for OgameX Infinity.
 * OGame Live porting rows 21-24 (specs/ogamelive.md §7), DESIGN §4.1.1. Writes only settings.
 *
 * OgameX facts used here:
 *  - ul#menuTableTools is empty and made for tool links: src/OGameX/resources/views/ingame/layouts/main.blade.php:766-768.
 *  - Galaxy footer: .galaxyRow.ctGalaxyFooter > #colonized: src/OGameX/resources/views/ingame/galaxy/index.blade.php:505-506.
 *  - Any ?cp=<id> switches the current body persistently server-side (layout.md §5), hence the notice before refresh-all.
 * GALAXYZ 1.8 (ogamex.eu, 2Moons fork; specs/galaxyz/layout.md, galaxy.md, CORE_API §22):
 *  - menu: the left ul#menuTable (OGX.dom.anchors().menu); inside OgameX Suite the entry is built detached and the hub
 *    mirrors its badge (dom.menuOwner).
 *  - galaxy footer: tfoot tr.info > td > span#colonized "(1 Existing planets)" (galaxy.html:1033), no .ctGalaxyFooter.
 *  - refresh-all: page=imperium once (levels, ships, defense, stock of every body) + page=buildings per body (resource
 *    tickers, queues) [+ page=resources per planet for the production %]; the fleet page is not needed (imperium has ships).
 *  - no server settings page: economy/research speed unknown (economySpeedKnown false -> «неизвестно», never "x0"),
 *    fleet speed from fleetStep1 `gamespeed`, resources x22000 from calc.gz; ensureServer() makes no request, so the
 *    «Обновить» button is hidden there.
 */
(function (OGX) {
  'use strict';

  const NAME = 'menu';
  const P = 'ogx-l-menu-';

  OGX.module({
    name: NAME,
    title: 'Меню и обновление данных',
    pages: '*',
    settings: {
      galaxyClock: { type: 'bool', default: true, label: 'Часы сервера в подвале галактики', hint: 'Время сервера и последний пинг под таблицей галактики' },
      refreshIncludeSettings: { type: 'bool', default: false, label: 'При обновлении всех планет загружать и настройки добычи', hint: 'Дополнительно открывает страницу настроек добычи каждой планеты (проценты производства; в GALAXYZ — Resources)' },
    },
    async init(ctx) {
      ctx.css(CSS);
      const log = ctx.log;
      const dom = OGX.dom;
      const h = dom.h;
      const fmt = OGX.fmt;
      const gz = !!(OGX.page.isGz && OGX.page.isGz());

      // ------------------------------------------------------------------ shared run state (refresh-all)
      const run = { active: false, controller: null, done: 0, total: 0, key: null, last: null, listeners: new Set() };
      const notifyRun = () => { for (const fn of run.listeners) OGX.safe(fn, 'menu:runListener')(); };

      // Local helper: action log (B) without throwing when diagnostics are off.
      const rec = (src, what, data) => { try { OGX.log.rec(src, NAME, what, data); } catch (e) { /* journal unavailable */ } };

      // ------------------------------------------------------------------ menu entry
      // OgameX: ul#menuTableTools (main.blade.php:767); GALAXYZ: ul#menuTable (left menu). In OgameX Suite the entry is
      // detached and the suite entry mirrors its badge.
      const ul = dom.anchors().menu;
      let entry = null;
      let alertsSeen = 0;
      if (ul) {
        entry = dom.menuEntry({
          id: P + 'entry',
          label: 'OgameX Live',
          iconText: '⚙',
          title: 'OgameX Live: настройки и данные',
          onClick: () => openModal('menu'),
        });
        const a = entry.li.querySelector('a');
        if (a) a.dataset.ogxAct = 'menu:open';
        // Self-learning alerts (markup / API drift): mark the entry so the user knows to hand over the logs.
        ctx.bus.on('learn:alert', (batch) => {
          const n = Array.isArray(batch) ? batch.length : 1;
          alertsSeen += n;
          if (!run.active) entry.setBadge('!');
          entry.li.title = `Самообучение: ${alertsSeen} ${fmt.plural(alertsSeen, ['предупреждение', 'предупреждения', 'предупреждений'])} — откройте и скачайте журнал`;
        });
      } else {
        log.debug('no game menu (#menuTableTools / #menuTable): no menu entry on this page');
      }

      run.listeners.add(() => {
        if (!entry) return;
        if (run.active) entry.setBadge(`${run.done}/${run.total || '?'}`);
        else entry.setBadge(alertsSeen ? '!' : null);
      });

      // ------------------------------------------------------------------ galaxy footer clock (OL§4.1, porting row 21)
      let clockEl = null;
      let lastClockSec = null;
      function lastPingMs() {
        try {
          if (!OGX.diag || typeof OGX.diag.recent !== 'function') return null;
          const ev = OGX.diag.recent({ s: 'N' });
          for (let i = ev.length - 1; i >= 0; i--) {
            const d = ev[i] && ev[i].d;
            if (d && Number.isFinite(+d.ms) && d.st >= 200 && d.st < 400) return +d.ms;
          }
        } catch (e) { /* diag not ready */ }
        return null;
      }
      function renderClock(now) {
        if (!clockEl) return;
        const sec = Math.floor(now / 1000);
        if (sec === lastClockSec) return;
        lastClockSec = sec;
        const ping = lastPingMs();
        clockEl.querySelector('.' + P + 'clock-time').textContent = fmt.time(now);
        const pingEl = clockEl.querySelector('.' + P + 'clock-ping');
        pingEl.textContent = ping == null ? '' : ` · пинг ${fmt.num(Math.round(ping))} мс`;
        pingEl.classList.toggle('ogx-warn', ping != null && ping >= 500 && ping < 1500);
        pingEl.classList.toggle('ogx-bad', ping != null && ping >= 1500);
      }
      function mountClock() {
        if (!OGX.page.is('galaxy') || !ctx.settings.get('galaxyClock')) return;
        if (clockEl && clockEl.isConnected) return;
        // OgameX: .ctGalaxyFooter #colonized (galaxy/index.blade.php:505-506); GALAXYZ: tfoot tr.info span#colonized (galaxy.html:1033)
        const colonized = dom.$('.ctGalaxyFooter #colonized') || dom.$('tr.info #colonized') || dom.$('#colonized');
        if (!colonized) return;
        const now = OGX.time.serverNow();
        if (OGX.learn) OGX.learn.value('menu.serverNow', now, { min: 946684800000, max: 4102444800000 }); // 2000..2100
        clockEl = h('div', { id: P + 'clock', class: P + 'clock', title: 'Время сервера (OgameX Live)' },
          h('span', { class: P + 'clock-label' }, 'Сервер: '),
          h('span', { class: P + 'clock-time' }, ''),
          h('span', { class: P + 'clock-ping' }, ''));
        colonized.insertAdjacentElement('afterend', clockEl);
        lastClockSec = null;
        renderClock(now);
        rec('B', 'clock:mount', { page: 'galaxy' });
      }
      function unmountClock() {
        if (clockEl) clockEl.remove();
        clockEl = null;
      }
      if (OGX.page.is('galaxy')) {
        mountClock();
        ctx.every(1000, (now) => {
          if (!ctx.settings.get('galaxyClock')) return;
          if (!clockEl || !clockEl.isConnected) mountClock();
          renderClock(now);
        });
        ctx.settings.onChange((key, value) => {
          if (key !== 'galaxyClock' && key !== 'menu.galaxyClock') return;
          if (value) mountClock(); else unmountClock();
        });
      }

      // ------------------------------------------------------------------ freshness table
      const ageText = (t) => (t != null && Number.isFinite(+t) && +t > 0 ? fmt.ago(+t) : '—');
      const ageTitle = (t) => (t != null && Number.isFinite(+t) && +t > 0 ? fmt.dateTime(+t) : 'нет данных');
      function ageCell(t, staleMs) {
        const now = OGX.time.serverNow();
        const has = t != null && Number.isFinite(+t) && +t > 0;
        const age = has ? now - +t : Infinity;
        if (has) OGX.learn && OGX.learn.value('menu.dataAgeSec', Math.round(age / 1000), { min: -3600 }); // future stamp = clock bug
        const cls = !has ? 'ogx-bad' : age > staleMs * 4 ? 'ogx-bad' : age > staleMs ? 'ogx-warn' : 'ogx-ok';
        return h('span', { class: [P + 'age', cls], title: ageTitle(t), dataset: { t: has ? String(+t) : '' } }, ageText(t));
      }
      async function freshnessRows() {
        const list = await OGX.state.bodyList();
        const rows = [];
        for (const { planet, moon } of list) {
          for (const b of [planet, moon]) {
            if (!b) continue;
            rows.push({
              key: b.key,
              isMoon: b.type === 'moon',
              name: b.name || (b.type === 'moon' ? 'Луна' : 'Планета'),
              coords: b.coords,
              seenAt: b.seenAt,
              resT: b.res && b.res.t,
              shipsT: b.shipsT,
              percentsT: b.type === 'moon' ? null : b.percentsT,
            });
          }
        }
        OGX.learn && OGX.learn.value('menu.bodies', rows.length, { min: rows.length ? 1 : 0, max: 60, int: true });
        OGX.learn && OGX.learn.check('menu.freshness', rows.map((r) => ({ seenAt: r.seenAt || 0, resT: r.resT || 0, shipsT: r.shipsT || 0 })));
        return rows;
      }
      function freshnessTable(rows) {
        const H = 3600e3;
        const cur = OGX.state.current && OGX.state.current();
        return dom.table({
          className: P + 'fresh',
          rowKey: 'key',
          sortKey: null,
          emptyText: 'Планеты ещё не известны: откройте любую страницу игры',
          columns: [
            { key: 'name', label: 'Тело', sortable: false, render: (r) => h('span', { class: [P + 'body', r.isMoon && P + 'moon', cur && cur.key === r.key && P + 'current'] },
              (r.isMoon ? '☾ ' : '') + r.name + ' ', h('span', { class: P + 'coords' }, fmt.coords(r.coords, r.isMoon ? 'moon' : undefined))) },
            { key: 'seenAt', label: 'Посещено', title: 'Когда страница этого тела открывалась последний раз', sortable: false, render: (r) => ageCell(r.seenAt, 6 * H) },
            { key: 'resT', label: 'Ресурсы', title: 'Возраст данных о ресурсах', sortable: false, render: (r) => ageCell(r.resT, 6 * H) },
            { key: 'shipsT', label: 'Флот', title: gz ? 'Возраст данных о кораблях (страницы Fleet, Hangar или Empire)' : 'Возраст данных о кораблях (страница «Флот» или «Верфь»)', sortable: false, render: (r) => ageCell(r.shipsT, 12 * H) },
            { key: 'percentsT', label: 'Добыча %', title: gz ? 'Возраст процентов производства (страница Resources)' : 'Возраст процентов производства (страница «Настройки добычи»)', sortable: false,
              render: (r) => (r.isMoon ? h('span', { class: P + 'na' }, '—') : ageCell(r.percentsT, 7 * 24 * H)) },
          ],
          rows,
        });
      }

      // ------------------------------------------------------------------ refresh all bodies (decision 3, OL§4.7, row 24)
      const CP_NOTICE = [
        'Игра не умеет отдавать данные другой планеты без переключения на неё. Поэтому дополнение по очереди откроет ',
        gz ? 'страницу Empire (все планеты сразу) и страницу Buildings каждой планеты и луны с параметром cp=…'
          : 'страницы «Флот» и «Сырьё» каждой планеты и луны с параметром ?cp=…',
        ' — сервер на это время считает выбранной ту планету.',
        '\n\nПосле обновления дополнение вернёт выбранную сейчас планету. Пока идёт обновление, не отправляйте флоты и не стройте в других вкладках: ',
        'их действие может уйти с другой планеты. Обновление запускается только по вашему нажатию, запросы идут по одному с паузой.',
      ].join('');

      const doRefresh = OGX.log.wrap(NAME, async function refreshAll(include) {
        return OGX.state.refreshBodies({
          include,
          signal: run.controller.signal,
          onProgress: (done, total, key) => {
            run.done = done; run.total = total; run.key = key;
            notifyRun();
          },
        });
      }, 'refreshAll');

      async function startRefresh() {
        if (run.active) return null;
        if (!OGX.settings.get('core.cpConfirmed')) {
          const ok = await dom.confirm(h('div', { class: P + 'notice' }, CP_NOTICE), { okLabel: 'Понятно, обновить', cancelLabel: 'Отмена', title: 'Обновление данных всех планет' });
          rec('U', 'cp-notice', { ok });
          if (!ok) return null;
          await OGX.settings.set('core.cpConfirmed', true);
        }
        // GALAXYZ: page=imperium carries levels, ships and defense of every body in one request, page=buildings the exact
        // resource tickers and queues of one body: 1 + N requests instead of 2N.
        const include = gz ? ['empire', 'resources'] : ['fleet', 'resources'];
        if (ctx.settings.get('refreshIncludeSettings')) include.push('settings');
        const bodiesCount = (await OGX.state.bodyList()).reduce((n, x) => n + 1 + (x.moon ? 1 : 0), 0);
        run.active = true;
        run.controller = new AbortController();
        run.done = 0;
        run.total = 0;
        run.key = null;
        run.last = null;
        notifyRun();
        rec('B', 'refresh:start', { include, bodies: bodiesCount });
        let result;
        try {
          result = await doRefresh(include);
        } catch (e) {
          log.error('refresh-all failed', e);
          result = { done: run.done, errors: [{ key: null, error: String((e && e.message) || e) }], restored: false };
        }
        const aborted = run.controller.signal.aborted;
        run.active = false;
        run.last = Object.assign({ aborted, total: run.total, at: OGX.time.serverNow() }, result || {});
        OGX.learn && OGX.learn.value('menu.refreshDone', run.last.done, { min: 0, max: Math.max(run.total, 0), int: true });
        const errs = (run.last.errors || []).filter((e) => e.error !== 'aborted');
        rec('B', 'refresh:end', { done: run.last.done, total: run.total, errors: errs.length, aborted, restored: !!run.last.restored });
        if (errs.length) log.warn('refresh-all errors', JSON.stringify(errs.slice(0, 10)));
        if (!run.last.restored && run.last.done > 0) log.warn('refresh-all: original body was not restored');
        dom.toast(summaryText(run.last), { type: aborted ? 'warn' : errs.length ? 'warn' : 'ok', ms: 5000 });
        notifyRun();
        return run.last;
      }
      function cancelRefresh() {
        if (!run.active || !run.controller) return;
        rec('U', 'refresh:cancel', { done: run.done, total: run.total });
        run.controller.abort();
        notifyRun();
      }
      function summaryText(r) {
        if (!r) return '';
        const errs = (r.errors || []).filter((e) => e.error !== 'aborted');
        let s = r.aborted ? `Обновление отменено: выполнено ${fmt.num(r.done)} из ${fmt.num(r.total)} запросов.`
          : `Обновлено: ${fmt.num(r.ok !== undefined ? r.ok : r.done)} из ${fmt.num(r.total)} ${fmt.plural(r.total, ['запроса', 'запросов', 'запросов'])}.`;
        if (errs.length) s += ` Ошибок: ${fmt.num(errs.length)}.`;
        if (r.errors && r.errors.some((e) => e.error === 'cpConfirmed')) s = 'Обновление не подтверждено.';
        if (!r.restored && r.done > 0) s += ' Не удалось вернуть выбранную планету — откройте её вручную.';
        return s;
      }

      // ------------------------------------------------------------------ server data (row 24: replaces OL's daily serverData.xml)
      // A number is shown only when it is a real number: null/'' must not print "x0" (Number(null) === 0).
      const known = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v);
      function serverBlock(srv) {
        const tz = known(srv.tzOffsetMs) ? +srv.tzOffsetMs / 60000 : null;
        const tzText = tz == null ? '—' : 'UTC' + (tz >= 0 ? '+' : '−') + String(Math.floor(Math.abs(tz) / 60)).padStart(2, '0') + ':' + String(Math.abs(tz) % 60).padStart(2, '0');
        const x = (v) => (known(v) ? 'x' + String(+v).replace('.', ',') : '—');
        const pct = (v) => (known(v) ? fmt.num(+v) + '%' : '—');
        // [value, title]: a value the engine does not publish reads «неизвестно» with the reason in the tooltip.
        const unknown = ['неизвестно', 'Игра нигде не показывает это значение'];
        const speed = (v, flag) => (flag === false || !known(v) ? unknown : [x(v), '']);
        let items;
        if (gz) {
          const info = OGX.page.info ? OGX.page.info() : {};
          const mult = OGX.calc.gz && known(OGX.calc.gz.resourceMultiplier) ? OGX.calc.gz.resourceMultiplier : null;
          items = [
            ['Вселенная', srv.universeName || info.universe || '—'],
            ['Движок', 'GALAXYZ ' + (srv.version || '')],
            ['Добыча ресурсов', mult ? [x(mult), 'Множитель добычи шахт (выведен из реальной выработки на странице Resources)'] : unknown],
            ['Экономика (скорость построек)', speed(srv.economySpeed, srv.economySpeedKnown)],
            ['Исследования', speed(srv.researchSpeed, srv.researchSpeedKnown)],
            ['Скорость флота', known(srv.fleetSpeed) ? [x(srv.fleetSpeed), srv.fleetSpeedKnown ? 'Со страницы отправки флота (шаг 1, gamespeed)' : 'Значение по умолчанию: откройте отправку флота (шаг 1), чтобы уточнить'] : unknown],
            // galaxies/systems only once a page showed them (core galaxiesKnown/systemsKnown), never the 2Moons defaults
            ...(srv.galaxiesKnown || srv.systemsKnown ? [['Галактик / систем', `${srv.galaxiesKnown ? fmt.num(+srv.galaxies) : '—'} / ${srv.systemsKnown ? fmt.num(+srv.systems) : '—'}`]] : []),
            ['Обломки: флот / оборона', [`${pct(srv.debrisFleetPct)} / ${pct(srv.debrisDefensePct)}`, 'Правило 2Moons; сервер этого не показывает']],
            ['Часовой пояс сервера', tzText],
            ['Обновлено', srv.t ? [fmt.ago(srv.t), 'Данные берутся со страниц игры, которые вы открываете: отдельной страницы настроек сервера в GALAXYZ нет'] : 'нет данных'],
          ];
        } else {
          items = [
            ['Вселенная', srv.universeName || '—'],
            ['Экономика', speed(srv.economySpeed, srv.economySpeedKnown)],
            ['Исследования', speed(srv.researchSpeed, srv.researchSpeedKnown)],
            ['Флот: атака / удержание / мирные', `${x(srv.fleetSpeedWar)} / ${x(srv.fleetSpeedHolding)} / ${x(srv.fleetSpeedPeaceful)}`],
            ['Галактик / систем', `${known(srv.galaxies) ? fmt.num(+srv.galaxies) : '—'} / ${known(srv.systems) ? fmt.num(+srv.systems) : '—'}`],
            ['Обломки: флот / оборона', `${pct(srv.debrisFleetPct)} / ${pct(srv.debrisDefensePct)}`],
            ['Часовой пояс сервера', tzText],
            ['Обновлено', srv.settingsT ? fmt.ago(srv.settingsT) : 'ещё не загружались'],
          ];
        }
        OGX.learn && OGX.learn.check('menu.server', { economySpeed: +srv.economySpeed || 0, galaxies: +srv.galaxies || 0, systems: +srv.systems || 0 });
        return h('dl', { class: P + 'server' }, items.map(([k, v]) => {
          const [text, title] = Array.isArray(v) ? v : [v, ''];
          return [h('dt', null, k), h('dd', { title: title || null, class: text === 'неизвестно' ? P + 'unknown' : null, dataset: { k } }, String(text))];
        }));
      }

      // ------------------------------------------------------------------ modal
      let modal = null;
      async function openModal(source) {
        if (modal && modal.el.isConnected) { modal.box.focus(); return modal; }
        rec('U', 'modal:open', { from: source });
        const version = extVersion();
        const body = h('div', { id: P + 'modal', class: P + 'modal' });
        const reloadBtn = h('button', { type: 'button', class: 'ogx-btn', hidden: true, dataset: { ogxAct: 'menu:reload' }, onClick: () => { rec('U', 'reload', {}); location.reload(); } }, 'Перезагрузить страницу');

        // header line
        body.appendChild(h('div', { class: P + 'head' },
          h('span', { class: P + 'title' }, `OgameX Live ${version}`),
          h('span', { class: P + 'sub' }, ` · ядро ${OGX.version || '?'} · ${location.host}`)));
        // Two separate extensions only; inside OgameX Suite Live and Infinity are sections of one extension.
        if (!OGX.suite && document.documentElement.hasAttribute('data-ogx-infinity')) {
          body.appendChild(h('div', { id: P + 'coexist', class: ['ogx-banner', P + 'coexist'] },
            'Также работает OgameX Infinity. Расширения совместимы: значки Infinity в списке планет отключены, чтобы не перекрывать панель производства Live.'));
        }

        // data freshness + refresh-all
        const freshBox = h('div', { class: P + 'fresh-box' }, h('div', { class: P + 'muted' }, 'Загрузка…'));
        const progBar = h('div', { class: P + 'prog-bar' });
        const progText = h('span', { class: P + 'prog-text' });
        const cancelBtn = h('button', { type: 'button', id: P + 'cancel', class: 'ogx-btn ogx-btn-danger', dataset: { ogxAct: 'menu:refresh-cancel' }, onClick: cancelRefresh }, 'Отменить');
        const progress = h('div', { id: P + 'progress', class: P + 'progress', hidden: true }, progBar, h('div', { class: P + 'prog-row' }, progText, cancelBtn));
        const resultEl = h('div', { id: P + 'result', class: P + 'result', hidden: true });
        const refreshBtn = h('button', { type: 'button', id: P + 'refresh', class: 'ogx-btn ogx-btn-primary', dataset: { ogxAct: 'menu:refresh-all' },
          onClick: () => { startRefresh().then(() => renderFresh()); } }, 'Обновить данные всех планет');
        const includeNote = h('span', { class: P + 'muted' });
        const updateIncludeNote = () => {
          const more = ctx.settings.get('refreshIncludeSettings');
          includeNote.textContent = gz ? (more ? 'Страницы: Empire, Buildings, Resources.' : 'Страницы: Empire (один раз), Buildings.')
            : (more ? 'Страницы: «Флот», «Сырьё», «Настройки добычи».' : 'Страницы: «Флот», «Сырьё».');
        };
        updateIncludeNote();

        async function renderFresh() {
          if (!body.isConnected && modal) return;
          const rows = await freshnessRows();
          freshBox.textContent = '';
          freshBox.appendChild(freshnessTable(rows).el);
        }
        const renderRun = () => {
          refreshBtn.disabled = run.active;
          progress.hidden = !run.active;
          if (run.active) {
            const f = run.total ? run.done / run.total : 0;
            progBar.textContent = '';
            progBar.appendChild(dom.bar(f, { cls: 'ogx-ok', title: `${run.done} из ${run.total}` }));
            const b = run.key ? bodyLabel(run.key) : '';
            progText.textContent = run.controller && run.controller.signal.aborted ? 'Отмена… дождитесь возврата на текущую планету'
              : `Выполнено ${fmt.num(run.done)} из ${run.total ? fmt.num(run.total) : '…'}${b ? ' · ' + b : ''}`;
            cancelBtn.disabled = !!(run.controller && run.controller.signal.aborted);
          }
          if (run.last && !run.active) {
            resultEl.hidden = false;
            resultEl.textContent = '';
            resultEl.appendChild(h('div', null, summaryText(run.last)));
            const errs = (run.last.errors || []).filter((e) => e.error !== 'aborted' && e.error !== 'cpConfirmed');
            if (errs.length) {
              resultEl.appendChild(h('ul', { class: P + 'errors' }, errs.slice(0, 8).map((e) => h('li', { class: 'ogx-bad', title: String(e.error || '') },
                `${e.key ? bodyLabel(e.key) : 'Общее'}: ${e.text || OGX.state.refreshErrorText(e.error)}`))));
            }
            resultEl.classList.toggle('ogx-warn', !!(errs.length || run.last.aborted));
          }
        };
        let labels = {};
        function bodyLabel(key) { return labels[key] || key; }
        OGX.state.bodyList().then((list) => {
          for (const { planet, moon } of list) {
            if (planet) labels[planet.key] = `${planet.name || 'Планета'} ${fmt.coords(planet.coords)}`;
            if (moon) labels[moon.key] = `${moon.name || 'Луна'} ${fmt.coords(moon.coords || planet.coords, 'moon')}`;
          }
        }).catch((e) => log.warn('bodyList', e));
        run.listeners.add(renderRun);
        const offState = OGX.state.onChange(['bodies'], OGX.util.debounce(() => { if (body.isConnected && !run.active) renderFresh(); }, 300));

        body.appendChild(section('Данные планет', [
          h('div', { class: P + 'muted' }, 'Возраст данных по каждой планете и луне. Данные обновляются сами при посещении страниц; кнопка ниже обновляет все тела сразу.'),
          freshBox,
          h('div', { class: P + 'actions' }, refreshBtn, ' ', includeNote),
          progress,
          resultEl,
        ], 'fresh'));

        // server data
        const srvBox = h('div', { class: P + 'srv-box' }, h('div', { class: P + 'muted' }, 'Загрузка…'));
        const srvBtn = h('button', { type: 'button', id: P + 'server-refresh', class: 'ogx-btn', dataset: { ogxAct: 'menu:server-refresh' }, onClick: OGX.safe(async () => {
          srvBtn.disabled = true;
          const fetchSrv = OGX.log.wrap(NAME, () => OGX.state.ensureServer({ maxAgeMs: 0 }), 'serverSettings');
          try {
            const srv = await fetchSrv();
            srvBox.textContent = '';
            srvBox.appendChild(serverBlock(srv || {}));
            dom.toast(srv && srv.settingsT ? 'Настройки сервера обновлены' : 'Не удалось загрузить настройки сервера', { type: srv && srv.settingsT ? 'ok' : 'warn' });
          } finally { srvBtn.disabled = false; }
        }, 'menu:serverRefresh') }, 'Обновить');
        // GALAXYZ has no server settings page (ensureServer makes no request): no button that would do nothing.
        body.appendChild(section('Данные сервера', gz
          ? [srvBox, h('div', { class: P + 'muted' }, 'В GALAXYZ нет страницы настроек сервера: значения собираются со страниц игры, которые вы открываете.')]
          : [srvBox, h('div', { class: P + 'actions' }, srvBtn)], 'server'));
        OGX.state.ensureServer().then((srv) => { srvBox.textContent = ''; srvBox.appendChild(serverBlock(srv || {})); })
          .catch((e) => { log.warn('ensureServer', e); srvBox.textContent = 'Нет данных'; });

        // settings of all Live modules
        const nsList = settingsNamespaces();
        const form = dom.settingsForm(nsList, {
          onChange: (path, value) => {
            rec('U', 'setting', { key: path, value: typeof value === 'string' && value.length > 40 ? '[len ' + value.length + ']' : value });
            reloadBtn.hidden = false;
            if (path === 'menu.refreshIncludeSettings') updateIncludeNote();
          },
        });
        form.id = P + 'settings';
        body.appendChild(section('Настройки', [
          h('div', { class: P + 'muted' }, 'Изменения сохраняются сразу. Часть из них применяется после перезагрузки страницы.'),
          form,
          h('div', { class: P + 'actions' }, reloadBtn),
        ], 'settings'));

        // diagnostics ("в случае чего — логи")
        const diagBox = h('div', { class: P + 'diag' });
        let mounted = null;
        try { if (OGX.diag && typeof OGX.diag.mountPanel === 'function') mounted = OGX.diag.mountPanel(diagBox); } catch (e) { log.warn('diag panel', e); mounted = null; }
        if (!mounted) {
          const dl = (what) => OGX.safe(async () => {
            rec('U', 'diag:download', { what });
            if (what === 'log') await OGX.log.download();
            else if (OGX.diag && OGX.diag.download) await OGX.diag.download(what);
          }, 'menu:diagDownload');
          diagBox.appendChild(h('div', { class: P + 'actions' },
            h('button', { type: 'button', class: 'ogx-btn', dataset: { ogxAct: 'menu:diag-new' }, onClick: dl('new') }, 'Журнал: новое'),
            ' ', h('button', { type: 'button', class: 'ogx-btn', dataset: { ogxAct: 'menu:diag-snaps' }, onClick: dl('snaps') }, 'Снимки страниц'),
            ' ', h('button', { type: 'button', class: 'ogx-btn', dataset: { ogxAct: 'menu:diag-learn' }, onClick: dl('learn') }, 'Отчёт самообучения'),
            ' ', h('button', { type: 'button', class: 'ogx-btn', dataset: { ogxAct: 'menu:diag-log' }, onClick: dl('log') }, 'Скачать журнал')));
        }
        body.appendChild(section('Логи для разбора', [
          h('div', { class: P + 'muted' }, alertsSeen
            ? `На этой странице самообучение заметило изменения разметки или API (${alertsSeen}). Скачайте журнал и снимки и передайте их для исправления.`
            : 'Если что-то сломалось — скачайте журнал (и снимки страниц) и передайте их для исправления.'),
          diagBox,
        ], 'diag'));

        modal = dom.modal({
          title: 'OgameX Live',
          body,
          width: 720,
          buttons: [{ label: 'Закрыть' }],
          onClose: () => {
            run.listeners.delete(renderRun);
            offState();
            rec('U', 'modal:close', {});
            modal = null;
          },
        });
        renderRun();
        await renderFresh();
        return modal;
      }

      function section(title, children, id) {
        return h('section', { class: P + 'section', dataset: { sec: id } }, h('h3', { class: P + 'h' }, title), children);
      }
      function settingsNamespaces() {
        const schema = OGX.settings.schema();
        const list = ['core'];
        // In OgameX Suite only the Live section (Infinity has its own «Настройки» tab).
        const mine = (n) => !OGX.suite || OGX.suite.sectionOf(n) === 'live';
        for (const n of Object.keys(OGX.modules || {})) if (schema[n] && !list.includes(n) && mine(n)) list.push(n);
        if (schema.diag && !list.includes('diag')) list.push('diag');
        return list.filter((n) => schema[n]);
      }
      function extVersion() {
        try {
          const rt = (typeof chrome !== 'undefined' && chrome.runtime) || (typeof browser !== 'undefined' && browser.runtime);
          const m = rt && rt.getManifest && rt.getManifest();
          if (m && m.version) return m.version;
        } catch (e) { /* userscript */ }
        return OGX.version || '';
      }

      // Test / integration hooks (isolated world only).
      OGX.liveMenu = { open: () => openModal('api'), refreshAll: startRefresh, cancel: cancelRefresh, runState: () => ({ active: run.active, done: run.done, total: run.total, last: run.last }) };
    },
  });

  const CSS = `
.${P}modal { font-size: 12px; line-height: 1.45; }
.${P}head { margin-bottom: 8px; }
.${P}title { font-weight: bold; color: var(--ogx-accent, #6cf); }
.${P}sub, .${P}muted { color: var(--ogx-muted, #8a96a3); }
.${P}muted { font-size: 11px; margin: 2px 0 6px; }
.${P}coexist { margin: 6px 0 10px; }
.${P}section { border-top: 1px solid var(--ogx-border, #2a3440); padding: 8px 0 6px; }
.${P}h { margin: 0 0 6px; font-size: 13px; color: var(--ogx-text, #dde); }
.${P}fresh { width: 100%; }
.${P}fresh td, .${P}fresh th { white-space: nowrap; }
.${P}coords { color: var(--ogx-muted, #8a96a3); }
.${P}current { font-weight: bold; }
.${P}moon { padding-left: 10px; }
.${P}age.ogx-ok { color: var(--ogx-ok, #6c6); }
.${P}age.ogx-warn { color: var(--ogx-warn, #fc6); }
.${P}age.ogx-bad { color: var(--ogx-bad, #f66); }
.${P}actions { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.${P}progress { margin-top: 8px; }
.${P}prog-row { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; gap: 8px; }
.${P}result { margin-top: 8px; }
.${P}result.ogx-warn { color: var(--ogx-warn, #fc6); }
.${P}errors { margin: 4px 0 0 16px; padding: 0; }
.${P}server { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; }
.${P}server dt { color: var(--ogx-muted, #8a96a3); }
.${P}server dd { margin: 0; }
.${P}server dd.${P}unknown { color: var(--ogx-muted, #8a96a3); font-style: italic; }
.${P}notice { white-space: pre-line; }
.${P}clock { display: inline-block; margin-left: 12px; color: #9c0; font-size: 11px; }
.${P}clock-ping.ogx-warn { color: #fc6; }
.${P}clock-ping.ogx-bad { color: #f66; }
`;
})(window.OGX);
