/* ogamex-infinity/modules/empire/empire.js — Owner: infinity/empire.
 * Empire view (DESIGN §4.2.2): tab «Империя» (order 20) of the shared side panel OGX.dom.sidePanel('infinity') with the
 * sub-views Ресурсы, Постройки, Станции, Исследования, Флот, Оборона. Each is a matrix bodies (columns) × objects (rows)
 * with levels/amounts, a totals column, queued targets (`22 →23`), dimmed cells for data older than `staleHours`
 * (age in the title) and «нет данных» for never-seen data. Research is one column (player-wide).
 *   - «Обновить всё»: OGX.state.refreshBodies({ include: pages of the chosen sub-views }) after the one-time ?cp= notice
 *     (DESIGN decision 3), with progress bar and cancel (AbortController).
 *   - «Обновить эту планету»: the same for the current body only. When the ?cp= notice was never accepted, the current body
 *     is re-read WITHOUT ?cp= (local helper refreshCurrentDirect: the pages are fetched as they are, so the server's current
 *     body does not change and no notice is needed — DESIGN §4.2.2 "no cp switch needed").
 *   - Production check: OGX.calc.production(...) for each planet vs the reported per-hour production
 *     (inline reloadResources data, layout.md §6.3); shown as a hint when they differ by more than 2%.
 * Passive collection (levels, ships, defence, queues, percents) is done by core OGX.state.merge on every visited page.
 *
 * OgameX facts used (src/OGameX):
 *   - Pages fetched for the refresh: GET /resources, /resources/settings, /facilities, /research, /shipyard, /defense
 *     (routes/web.php; buildings.md §1). Any request with ?cp=<id> persistently switches the current body:
 *     app/Http/Middleware/GlobalGame.php:43-46 (layout.md §5) — hence the notice before refresh-all.
 *   - Satellites (212) and crawlers (217) are listed on /resources (resources/index.blade.php, buildings.md §3.1); the
 *     shipyard page lists every ship incl. 212/217 — so the «Флот» view refreshes through /shipyard (not /fleet, whose
 *     shipsOnPlanet has only flying ships, fleet.md §1).
 *   - Queue targets: the active building/research box `table.construction.active` + `table.queue` and the unit box
 *     `new CountdownTimerUnit('shipyardCountdownUnit', perUnit, remaining, techId, ...)` (buildings.md §4.2-4.3);
 *     parsed by core parse.queueTimers and stored in Body.queues / research.queue.
 *   - Moons have no mines / base income (PlanetService.php:2166-2192, buildings.md §11) — the production check skips them.
 *   - Planet-list links keep the query and replace cp (layouts/main.blade.php:1733-1735) — the column headers do the same.
 * Writes: settings only (empire.*). No game-state changes: the only requests are the explicit refresh GETs.
 *
 * GALAXYZ (ogamex.eu, 2Moons fork; specs/galaxyz/empire.md, CORE_API §14/§22):
 *   - page=imperium (OGX.page.urlFor('empire')) shows every body in one table; core state.merge stores its levels, ships,
 *     defence (no missiles 502/503), fields, stock and research for every body. So «Обновить всё» / «Обновить эту планету»
 *     fetch page=imperium ONCE, without ?cp= (no planet switch, no notice). Only the «Ресурсы» view also wants the
 *     production of each planet (storage and per-hour rate are not on page=imperium): page=resources per body, with ?cp=
 *     after the notice (all) or without cp for the current body.
 *   - bodies seen only on page=imperium: stock without storage/production (null) -> «—» with a hint, never 0;
 *   - production check: OGX.calc.production with the officers (page=officier), no player class, no economy speed;
 *   - missiles 502/503 are not on page=imperium: «—» unless page=shipyard&mode=defense was opened;
 *   - 217 is the Battle Transporter on GALAXYZ (no crawler): no /resources fallback for 212/217;
 *   - column links keep the page like the game's planet selector, except fleetStep*, info pages and the galaxy.
 */
(function (OGX) {
  'use strict';

  const NAME = 'empire';
  const P = 'ogx-i-empire-';
  const PANEL_ID = 'infinity';
  const RES = ['metal', 'crystal', 'deuterium'];
  const RES_NAME = { metal: 'Металл', crystal: 'Кристалл', deuterium: 'Дейтерий' };
  const HOUR = 3600000;
  const PROD_TOLERANCE = 0.02; // 2 %

  // Sub-views: id, label, pages to fetch on refresh (OGX.state.refreshBodies include keys), data timestamp field.
  const VIEWS = [
    { id: 'resources', label: 'Ресурсы', pages: ['resources', 'settings'], hint: 'Сырьё и настройки добычи' },
    { id: 'buildings', label: 'Постройки', pages: ['resources'], hint: 'Сырьё' },
    { id: 'stations', label: 'Станции', pages: ['facilities'], hint: 'Фабрики' },
    { id: 'research', label: 'Исследования', pages: ['research'], hint: 'Исследования (один раз на аккаунт)' },
    { id: 'fleet', label: 'Флот', pages: ['shipyard'], hint: 'Верфь' },
    { id: 'defense', label: 'Оборона', pages: ['defense'], hint: 'Оборона' },
  ];
  const VIEW_IDS = VIEWS.map((v) => v.id);
  const PAGE_RU = { resources: 'Сырьё', settings: 'Настройки добычи', facilities: 'Фабрики', research: 'Исследования', shipyard: 'Верфь', defense: 'Оборона', fleet: 'Флот', empire: 'Империя' };
  // Paths/page names of the include keys (same table as core 14-state.js PAGE_PATH; used by the no-cp helper).
  const PAGE_PATH = { resources: '/resources', settings: '/resources/settings', facilities: '/facilities', research: '/research', shipyard: '/shipyard', defense: '/defense', fleet: '/fleet', empire: '/empire' };
  const PAGE_NAME = { resources: 'resources', settings: 'resourceSettings', facilities: 'facilities', research: 'research', shipyard: 'shipyard', defense: 'defense', fleet: 'fleet', empire: 'empire' };
  // GALAXYZ: page=imperium carries every view; the production (storage, per hour, %) of a planet only its own page=resources.
  const GZ_VIEW_PAGES = { resources: ['empire', 'settings'], buildings: ['empire'], stations: ['empire'], research: ['empire'], fleet: ['empire'], defense: ['empire'] };
  const GZ_PAGE_RU = { empire: 'Империя', settings: 'Сырьё (настройки добычи)' };
  const MISSILES = [502, 503];
  const isGz = () => { try { return !!(OGX.page.isGz && OGX.page.isGz()); } catch (e) { return false; } };
  const pagesOf = (v) => (isGz() ? GZ_VIEW_PAGES[v.id] || ['empire'] : v.pages);
  const pageRu = (p) => (isGz() && GZ_PAGE_RU[p]) || PAGE_RU[p] || p;

  const CP_NOTICE_GZ = [
    'Выработку и ёмкость хранилищ планеты игра показывает только на странице этой планеты («Империя» их не содержит). ',
    'Поэтому «Обновить всё» для раздела «Ресурсы» по очереди откроет «Сырьё» каждой планеты с параметром &cp=… — сервер на это время считает выбранной ту планету.',
    '\n\nПосле обновления дополнение вернёт выбранную сейчас планету. Пока идёт обновление, не отправляйте флоты и не стройте в других вкладках: ',
    'действие может уйти с другой планеты. Каждый запрос — обычная страница игры (без затрат дейтерия); запросы идут по одному с паузой и только по вашему нажатию.',
  ].join('');
  const CP_NOTICE = [
    'OgameX отдаёт страницы другой планеты только после переключения на неё. Поэтому «Обновить всё» по очереди откроет нужные страницы ',
    'каждой планеты и луны с параметром ?cp=… — сервер на это время считает выбранной ту планету.',
    '\n\nПосле обновления дополнение вернёт выбранную сейчас планету. Пока идёт обновление, не отправляйте флоты и не стройте в других вкладках: ',
    'действие может уйти с другой планеты. Запросы идут по одному с паузой и только по вашему нажатию.',
  ].join('');

  OGX.module({
    name: NAME,
    title: 'Империя',
    pages: '*',
    settings: {
      defaultView: {
        type: 'enum', default: 'resources', label: 'Вкладка империи по умолчанию',
        options: VIEWS.map((v) => ({ value: v.id, label: v.label })),
      },
      staleHours: { type: 'int', default: 24, min: 1, max: 720, label: 'Затемнять данные старше, ч' },
      showMoons: { type: 'bool', default: true, label: 'Показывать луны в империи' },
      hideEmptyRows: { type: 'bool', default: false, label: 'Скрывать пустые строки (флот, оборона)' },
      refreshViews: { type: 'json', default: VIEW_IDS.slice(), hidden: true, label: 'Что обновлять (вкладки)' },
    },

    async init(ctx) {
      const e = new Empire(ctx);
      ctx._empire = e;
      await e.start();
    },

    dispose(ctx) {
      if (ctx._empire) ctx._empire.dispose();
    },
  });

  // ------------------------------------------------------------------ small helpers
  const h = (...a) => OGX.dom.h(...a);
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);
  const now = () => OGX.time.serverNow();
  const num = (n) => (fin(n) ? OGX.fmt.num(Math.floor(n)) : '—');
  const rec = (src, what, data) => { try { OGX.log.rec(src, NAME, what, data); } catch (e) { /* journal off */ } };
  const learnValue = (name, v, o) => { try { return OGX.learn ? OGX.learn.value(name, v, o) : true; } catch (e) { return true; } };
  const learnCheck = (name, o) => { try { return OGX.learn ? OGX.learn.check(name, o) : true; } catch (e) { return true; } };
  const viewDef = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];
  function ageText(t) {
    if (!fin(t)) return 'нет данных';
    return OGX.fmt.dateTime(t) + ' (' + OGX.fmt.ago(t) + ')';
  }
  function positionOf(coords) {
    const a = OGX.util.coordsArr(coords);
    return a ? a[2] : 0;
  }
  /** Include list (refreshBodies keys) for the chosen views, deduplicated, stable order. */
  function includeFor(viewIds) {
    const out = [];
    for (const v of VIEWS) if (viewIds.includes(v.id)) for (const p of pagesOf(v)) if (!out.includes(p)) out.push(p);
    return out;
  }
  /** Same page with cp replaced, like the game's selector (core page.bodyUrl: fleetStep1-3 -> fleetTable, info/galaxy -> overview). */
  const bodyHref = (id) => OGX.page.bodyUrl(id);
  const known = (v) => v !== null && v !== undefined && fin(+v);
  /** Object applies to a body type? planetType: 'planet'|'moon'|'both'. */
  function applies(obj, isMoon) {
    if (!obj) return false;
    if (obj.planetType === 'both') return true;
    return isMoon ? obj.planetType === 'moon' : obj.planetType === 'planet';
  }

  /** Queue targets of a body: { levels: {id: {target, active, endsAt, downgrade}}, units: {id: delta} }. */
  function queueTargets(body) {
    const out = { levels: {}, units: {} };
    const q = body && body.queues;
    if (!q) return out;
    if (q.building && q.building.objectId) {
      const b = q.building;
      out.levels[b.objectId] = { target: b.targetLevel, active: true, endsAt: b.endsAt, downgrade: !!b.downgrade };
      for (const x of b.queued || []) {
        if (!x || !x.objectId || !fin(x.targetLevel)) continue;
        const cur = out.levels[x.objectId];
        if (!cur || x.targetLevel > cur.target) out.levels[x.objectId] = { target: x.targetLevel, active: false, endsAt: null, downgrade: false };
      }
    }
    if (q.unit) {
      const u = q.unit;
      if (u.techId && fin(u.remaining)) out.units[u.techId] = (out.units[u.techId] || 0) + u.remaining;
      for (const x of u.queued || []) if (x && x.id && fin(x.amount)) out.units[x.id] = (out.units[x.id] || 0) + x.amount;
    }
    return out;
  }

  /** Computed production of a planet (null when the levels are unknown or the body is a moon). */
  function computedProduction(body, research, player, server) {
    if (!body || body.type === 'moon') return null;
    if (!body.levelsT || !body.levelsT.resources) return null;
    // GALAXYZ: Geologist (601, +5 %/level) and Engineer (603, energy) change the production a lot; without page=officier
    // the computed value would be wrong by design: no check until the officers are known.
    if (isGz() && !(player && player.officers)) return null;
    const out = OGX.calc.production({
      levels: body.levels || {},
      percents: body.percents || {},
      ships: { 212: (body.ships && body.ships[212]) || 0, 217: (body.ships && body.ships[217]) || 0 },
      tempMin: body.tempMin, tempMax: body.tempMax,
      position: positionOf(body.coords),
      isMoon: false,
      research: (research && research.levels) || {},
      playerClass: player ? player.playerClass : 'none',
      officers: (player && player.officers) || undefined,     // GALAXYZ: Geologist 601, Engineer 603 (page=officier)
      server: { economySpeed: (server && +server.economySpeed) || 1 },
    });
    return Object.assign(out, { percentsKnown: !!body.percentsT });
  }

  // ------------------------------------------------------------------ model (pure; one function per view)
  // Model = { columns: [{ key, label, sub, isMoon, body, href }], rows: [Row], notes: [string], totalLabel }
  // Row = { id, label, title, section?, cells: [Cell], total: Cell|null, empty }
  // Cell = { text, title, cls: [], value, na, stale }

  function cellFor(value, t, staleMs, { target = null, titleExtra = '', unknownTitle = 'Нет данных' } = {}) {
    if (!fin(t)) return { text: '—', title: unknownTitle, cls: [P + 'unknown'], value: null };
    const age = now() - t;
    const stale = age > staleMs;
    let text = num(value);
    const cls = [];
    if (target) { text += ' ' + target.text; cls.push(P + 'queued'); if (target.cls) cls.push(target.cls); }
    if (stale) cls.push(P + 'stale');
    const title = (titleExtra ? titleExtra + '\n' : '') + 'Данные: ' + ageText(t) + (target && target.title ? '\n' + target.title : '');
    return { text, title, cls, value: fin(value) ? value : 0, stale };
  }
  const naCell = () => ({ text: '', title: 'Не строится на этом типе тела', cls: [P + 'na'], value: null, na: true });

  function columnsFor(list, showMoons) {
    const cols = [];
    const hrefFor = bodyHref;
    for (const { planet, moon } of list) {
      cols.push({ key: planet.key, label: planet.name || ('#' + planet.id), sub: OGX.fmt.coords(planet.coords), isMoon: false, body: planet, href: hrefFor(planet.id) });
      if (moon && showMoons) cols.push({ key: moon.key, label: moon.name || 'Луна', sub: OGX.fmt.coords(moon.coords, 'moon'), isMoon: true, body: moon, href: hrefFor(moon.id) });
    }
    return cols;
  }

  function levelRows(cols, type, tField, staleMs, opts) {
    const rows = [];
    const at = now();
    for (const obj of OGX.catalog.list(type)) {
      const cells = [];
      let sum = 0, max = 0, any = false;
      for (const c of cols) {
        if (!applies(obj, c.isMoon)) { cells.push(naCell()); continue; }
        const b = c.body;
        const t = b.levelsT ? b.levelsT[tField] : null;
        const lvl = b.levels ? b.levels[obj.id] : undefined;
        const qt = queueTargets(b).levels[obj.id];
        let target = null;
        if (qt && fin(qt.target)) {
          const done = qt.active && fin(qt.endsAt) && qt.endsAt <= at;
          target = {
            text: (qt.downgrade ? '↓' : '→') + qt.target + (done ? ' ✓' : ''),
            title: qt.active ? (qt.downgrade ? 'Снос до уровня ' : 'Строится до уровня ') + qt.target +
              (fin(qt.endsAt) ? (done ? ' — завершено по таймеру' : ', готово ' + OGX.fmt.dateTime(qt.endsAt)) : '') : 'В очереди: уровень ' + qt.target,
            cls: done ? P + 'done' : null,
          };
        }
        const unknownTitle = isGz() ? 'Нет данных — откройте «Империю» или нажмите «Обновить всё»'
          : `Нет данных — откройте «${PAGE_RU[tField === 'facilities' ? 'facilities' : 'resources']}» на этом теле или нажмите «Обновить всё»`;
        const cell = cellFor(fin(lvl) ? lvl : (fin(t) ? 0 : null), fin(t) ? t : null, staleMs, { target, unknownTitle });
        if (fin(t)) {
          const v = fin(lvl) ? lvl : 0;
          learnValue('empire.level', v, { min: 0, max: 100, int: true });
          sum += v; max = Math.max(max, v); any = true;
        }
        cells.push(cell);
      }
      rows.push({
        id: obj.id, label: obj.ruShort || obj.ru, title: obj.ru, cells, empty: !any || max === 0,
        total: any ? { text: num(sum), title: `Сумма уровней: ${num(sum)}, максимум: ${num(max)}`, cls: [P + 'total'], value: sum } : { text: '—', title: 'Нет данных', cls: [P + 'total'], value: null },
      });
    }
    // Fields used/max row (planet list tooltip, every page)
    rows.unshift({
      id: 'fields', label: 'Поля', title: 'Занято/всего полей', section: true,
      cells: cols.map((c) => {
        const b = c.body;
        if (!fin(b.fieldsMax)) return { text: '—', title: 'Нет данных о полях', cls: [P + 'unknown'], value: null };
        const full = b.fieldsUsed >= b.fieldsMax;
        return { text: `${num(b.fieldsUsed)}/${num(b.fieldsMax)}`, title: `Поля: ${num(b.fieldsUsed)} из ${num(b.fieldsMax)}`, cls: full ? [P + 'bad'] : [], value: b.fieldsUsed };
      }),
      total: null,
    });
    if (opts && opts.points) rows.push(pointsRow(cols, type, 'levels', tField));
    return rows;
  }

  function unitRows(cols, ids, field, tField, staleMs, playerClass, unknownPage) {
    const rows = [];
    for (const id of ids) {
      const obj = OGX.catalog.get(id);
      if (!obj) continue;
      const cells = [];
      let sum = 0, any = false, hasTarget = false;
      for (const c of cols) {
        if (!applies(obj, c.isMoon)) { cells.push(naCell()); continue; }
        const b = c.body;
        let t = b[tField];
        let val = b[field] ? b[field][id] : undefined;
        // OgameX: 212/217 (crawler) also come from /resources (levelsT.resources) when /shipyard was never visited.
        if (!isGz() && !fin(t) && field === 'ships' && (id === 212 || id === 217) && b.levelsT && fin(b.levelsT.resources)) t = b.levelsT.resources;
        // GALAXYZ: page=imperium has no missiles; their amount is known only from page=shipyard&mode=defense.
        if (isGz() && MISSILES.includes(id) && !known(val)) {
          cells.push({ text: '—', title: 'Ракеты не показываются на странице «Империя»: откройте «Оборону» этой планеты', cls: [P + 'unknown'], value: null });
          continue;
        }
        const delta = queueTargets(b).units[id];
        let target = null;
        const cur = fin(val) ? val : 0;
        if (delta > 0) {
          hasTarget = true;
          target = { text: '→' + num(cur + delta), title: `В производстве: ${num(delta)} шт.` };
        }
        const cell = cellFor(fin(t) ? cur : null, fin(t) ? t : null, staleMs, { target, unknownTitle: `Нет данных — откройте «${isGz() ? 'Империю' : unknownPage}» на этом теле или нажмите «Обновить всё»` });
        if (fin(t)) { learnValue('empire.amount', cur, { min: 0, max: 1e10, int: true }); sum += cur; any = true; }
        cells.push(cell);
      }
      const classMismatch = obj.classOnly && obj.classOnly !== OGX.calc.normClass(playerClass);
      rows.push({
        id, label: obj.ruShort || obj.ru, title: obj.ru + (obj.classOnly ? ' (только для класса)' : ''), cells,
        empty: (!any || sum === 0) && !hasTarget, classMismatch: classMismatch && sum === 0 && !hasTarget,
        total: any ? { text: num(sum), title: `Всего: ${num(sum)} шт.`, cls: [P + 'total'], value: sum } : { text: '—', title: 'Нет данных', cls: [P + 'total'], value: null },
      });
    }
    rows.push(pointsRow(cols, null, field, tField, ids));
    return rows;
  }

  /** «Стоимость, тыс.» row (id 'points'): resources spent on the levels/units per body, in thousands. Not the game's
   *  points: GALAXYZ shows 489 points for an account whose buildings alone cost 2.5 bn (specs/galaxyz/mechanics.md,
   *  divisor unknown), so the row is labelled as a cost. */
  function pointsRow(cols, type, field, tField, ids) {
    let total = 0, any = false;
    const cells = cols.map((c) => {
      const b = c.body;
      let pts = 0, known = false;
      if (field === 'levels') {
        if (b.levelsT && fin(b.levelsT[tField])) {
          known = true;
          for (const obj of OGX.catalog.list(type)) {
            const L = b.levels ? b.levels[obj.id] : 0;
            if (L > 0) { const r = OGX.calc.costRange(obj.id, 0, L); pts += (r.metal + r.crystal + r.deuterium) / 1000; }
          }
        }
      } else if (fin(b[tField])) {
        known = true;
        for (const id of ids) {
          const n = b[field] ? b[field][id] : 0;
          if (n > 0) { const r = OGX.calc.unitCost(id, n); pts += (r.metal + r.crystal + r.deuterium) / 1000; }
        }
      }
      if (!known) return { text: '—', title: 'Нет данных', cls: [P + 'unknown'], value: null };
      any = true; total += pts;
      return { text: num(pts), title: 'Металл + кристалл + дейтерий, потраченные на это тело, в тысячах (не игровые очки)', cls: [P + 'points'], value: Math.floor(pts) };
    });
    return { id: 'points', label: 'Стоимость, тыс.', title: 'Стоимость построенного (металл + кристалл + дейтерий) в тысячах ресурсов; это не игровые очки', cells, section: true, total: any ? { text: num(total), title: 'Стоимость всего, тыс.', cls: [P + 'total'], value: Math.floor(total) } : null };
  }

  function resourcesModel(cols, research, player, server, staleMs) {
    const at = now();
    const rows = [];
    const notes = [];
    const proj = cols.map((c) => (c.body.res ? OGX.state.projected(c.body, at) : null));
    const comp = cols.map((c) => computedProduction(c.body, research, player, server));
    const addRow = (id, label, title, fn, totalFn, section) => {
      const cells = cols.map((c, i) => OGX.safe(fn, 'empire:resources:' + id)(c, i) || { text: '—', title: 'Нет данных', cls: [P + 'unknown'], value: null });
      let total = null;
      if (totalFn) total = totalFn(cells);
      rows.push({ id, label, title, cells, total, section: !!section });
    };
    const sumTotal = (cells, title) => {
      const vals = cells.filter((x) => fin(x.value));
      if (!vals.length) return { text: '—', title: 'Нет данных', cls: [P + 'total'], value: null };
      const s = vals.reduce((a, x) => a + x.value, 0);
      return { text: num(s), title: title + ': ' + num(s), cls: [P + 'total'], value: s };
    };
    const resT = (c) => (c.body.res ? c.body.res.t : null);
    const unknownRes = 'Нет данных — тело ещё не открывалось';
    // GALAXYZ: a body seen only on page=imperium has its stock, but storage and production are null (never 0)
    const NO_PROD = 'Неизвестно: «Империя» не показывает выработку и хранилища — откройте эту планету в игре или обновите раздел «Ресурсы»';

    for (const r of RES) {
      addRow('stock-' + r, RES_NAME[r], 'Запас сейчас (с учётом выработки)', (c, i) => {
        const p = proj[i];
        if (!p || !p.res || !p.res[r]) return { text: '—', title: unknownRes, cls: [P + 'unknown'], value: null };
        const a = p.res[r].amount, st = p.res[r].storage;
        learnValue('empire.stock', a, { min: 0, max: 1e13 });
        const fill = st > 0 ? a / st : 0;
        const cell = cellFor(a, resT(c), staleMs, { titleExtra: known(st) ? `${RES_NAME[r]}: ${num(a)} из ${num(st)} (${OGX.fmt.pct(fill)})`
          : `${RES_NAME[r]}: ${num(a)} — запас со страницы «Империя», без выработки с того момента (хранилище и выработка неизвестны)` });
        cell.cls.push(P + 'res-' + r);
        if (st > 0 && a >= st) cell.cls.push(P + 'bad'); else if (st > 0 && fill >= 0.9) cell.cls.push(P + 'warn');
        cell.live = { key: c.key, res: r };
        return cell;
      }, (cells) => sumTotal(cells, 'Всего'), r === 'metal');
    }
    addRow('stock-sum', 'Σ запас', 'Сумма М+К+Д', (c, i) => {
      const p = proj[i];
      if (!p || !p.res) return null;
      const s = RES.reduce((a, r) => a + ((p.res[r] && p.res[r].amount) || 0), 0);
      const cell = cellFor(s, resT(c), staleMs);
      cell.live = { key: c.key, res: 'sum' };
      return cell;
    }, (cells) => sumTotal(cells, 'Всего'));

    for (const r of RES) {
      addRow('storage-' + r, 'Хран. ' + RES_NAME[r].slice(0, 1), 'Ёмкость хранилища: ' + RES_NAME[r], (c) => {
        const res = c.body.res;
        if (!res || !res[r]) return null;
        if (!known(res[r].storage)) return { text: '—', title: NO_PROD, cls: [P + 'unknown'], value: null };
        return cellFor(res[r].storage, res.t, staleMs);
      }, (cells) => sumTotal(cells, 'Ёмкость всего (известные)'), r === 'metal');
    }

    const diffs = [];
    const compared = new Set();   // bodies whose game production was compared with the computed one
    for (const r of RES) {
      addRow('prod-' + r, RES_NAME[r] + '/ч', 'Выработка в час (по данным игры)', (c, i) => {
        const res = c.body.res;
        if (!res || !res[r]) return null;
        if (!known(res[r].perHour)) {
          const cp0 = comp[i];
          const cell = { text: '—', title: NO_PROD, cls: [P + 'unknown'], value: null };
          if (cp0 && fin(cp0.perHour[r])) { cell.text = '≈' + num(cp0.perHour[r]); cell.title += `\nРасчёт по уровням: ${num(cp0.perHour[r])}/ч` + (cp0.percentsKnown ? '' : ' (проценты добычи неизвестны — приняты 100%)'); cell.computed = cp0.perHour[r]; cell.cls.push(P + 'calc'); }
          return cell;
        }
        const rep = +res[r].perHour || 0;
        learnValue('empire.perHour', rep, { min: -1e9, max: 1e10 });
        const cell = cellFor(rep, res.t, staleMs);
        cell.text = (rep > 0 ? '+' : '') + num(rep);
        const cp = comp[i];
        if (cp) {
          const calcV = cp.perHour[r];
          const diff = Math.abs(calcV - rep) / Math.max(Math.abs(rep), 1);
          cell.computed = calcV;
          compared.add(c.key);
          cell.title += `\nРасчёт: ${num(calcV)}/ч` + (cp.percentsKnown ? '' : ' (проценты добычи неизвестны — приняты 100%)');
          if (diff > PROD_TOLERANCE && !(Math.abs(calcV - rep) < 2)) {
            cell.cls.push(P + 'mismatch');
            cell.text += ' ⚠';
            cell.title += `\nРасхождение с игрой: ${OGX.fmt.pct(diff, 1)}`;
            diffs.push({ key: c.key, label: c.label, res: r, reported: rep, computed: calcV, diff });
            learnValue('empire.prodDiffPct', Math.round(diff * 100), { min: 0, max: 50 });
          }
        }
        return cell;
      }, (cells) => sumTotal(cells, 'Выработка всего'), r === 'metal');
    }
    addRow('prod-day', 'Σ в сутки', 'Выработка М+К+Д за 24 ч', (c) => {
      const res = c.body.res;
      if (!res) return null;
      if (!RES.every((r) => res[r] && known(res[r].perHour))) return { text: '—', title: NO_PROD, cls: [P + 'unknown'], value: null };
      const s = RES.reduce((a, r) => a + ((res[r] && +res[r].perHour) || 0), 0) * 24;
      return cellFor(s, res.t, staleMs);
    }, (cells) => sumTotal(cells, 'В сутки всего'));

    addRow('energy', 'Энергия', 'Свободная энергия (выработка − потребление)', (c) => {
      const e = c.body.energy;
      if (e && !fin(e.available) && fin(e.production)) {
        // GALAXYZ page=imperium: energy production only (no consumption)
        const cell = cellFor(e.production, e.t, staleMs, { titleExtra: `Выработка энергии: ${num(e.production)} (со страницы «Империя»; потребление неизвестно)` });
        cell.text = '⚡' + num(e.production);
        cell.value = null;
        return cell;
      }
      if (!e || !fin(e.available)) return null;
      const cell = cellFor(e.available, e.t, staleMs, { titleExtra: `Выработка: ${num(e.production)}, потребление: ${num(e.consumption)}` });
      if (e.available < 0) cell.cls.push(P + 'bad');
      cell.text = (e.available > 0 ? '+' : '') + num(e.available);
      return cell;
    }, (cells) => sumTotal(cells, 'Баланс всего'), true);
    addRow('factor', 'Коэфф.', 'Коэффициент производства (энергия), %', (c, i) => {
      const b = c.body;
      if (c.isMoon) return { text: '', title: 'На луне нет добычи', cls: [P + 'na'], value: null, na: true };
      let f = fin(b.factor) ? b.factor : null, t = b.percentsT, src = 'настройки добычи';
      if (f === null && comp[i]) { f = Math.round(comp[i].factor * 100); t = b.levelsT.resources; src = 'расчёт'; }
      if (f === null) return { text: '—', title: 'Нет данных — откройте «Настройки добычи»', cls: [P + 'unknown'], value: null };
      learnValue('empire.factor', f, { min: 0, max: 100 });
      const cell = cellFor(f, t, staleMs, { titleExtra: 'Источник: ' + src });
      cell.text = f + '%';
      if (f < 100) cell.cls.push(f < 70 ? P + 'bad' : P + 'warn');
      cell.value = null; // no total for a percentage
      return cell;
    }, null);

    if (diffs.length) {
      notes.push({ cls: P + 'mismatch-note', text: 'Расчётная выработка отличается от игровой больше чем на 2%: ' +
        diffs.map((d) => `${d.label} — ${RES_NAME[d.res].toLowerCase()}: игра ${num(d.reported)}, расчёт ${num(d.computed)}`).join('; ') +
        '. Возможные причины: устаревшие уровни, неизвестные проценты добычи или бонусы сервера.' });
    }
    if (isGz() && !(player && player.officers)) {
      notes.push({ cls: P + 'officers-note', text: 'Расчёт выработки по уровням недоступен: неизвестны уровни офицеров (Геолог, Инженер). Откройте страницу «Офицеры» один раз.' });
    }
    const checked = compared.size;
    if (checked && !diffs.length) notes.push({ cls: P + 'match-note', text: `Расчёт выработки совпадает с игрой (проверено планет: ${checked}).` });
    learnCheck('empire.resources', rows.map((r) => ({ id: r.id, total: r.total && fin(r.total.value) ? Math.max(0, r.total.value) : 0 })));
    return { rows, notes, diffs };
  }

  function researchModel(research, staleMs) {
    const at = now();
    const t = research && research.t;
    const q = research && research.queue;
    const rows = [];
    let sum = 0, any = false;
    for (const obj of OGX.catalog.list('research')) {
      const lvl = research && research.levels ? research.levels[obj.id] : undefined;
      let target = null;
      if (q && q.objectId === obj.id && fin(q.targetLevel)) {
        const done = fin(q.endsAt) && q.endsAt <= at;
        target = { text: '→' + q.targetLevel + (done ? ' ✓' : ''), title: 'Исследуется до уровня ' + q.targetLevel + (fin(q.endsAt) ? (done ? ' — завершено по таймеру' : ', готово ' + OGX.fmt.dateTime(q.endsAt)) : ''), cls: done ? P + 'done' : null };
      }
      const v = fin(lvl) ? lvl : 0;
      const cell = cellFor(fin(t) ? v : null, fin(t) ? t : null, staleMs, { target, unknownTitle: 'Нет данных — откройте «Исследования» или нажмите «Обновить всё»' });
      if (fin(t)) { learnValue('empire.research', v, { min: 0, max: 100, int: true }); sum += v; any = true; }
      rows.push({ id: obj.id, label: obj.ruShort || obj.ru, title: obj.ru, cells: [cell], total: null, empty: !any });
    }
    let pts = 0;
    for (const obj of OGX.catalog.list('research')) {
      const L = research && research.levels ? research.levels[obj.id] : 0;
      if (L > 0) { const r = OGX.calc.costRange(obj.id, 0, L); pts += (r.metal + r.crystal + r.deuterium) / 1000; }
    }
    rows.push({ id: 'sum', label: 'Σ уровней', title: 'Сумма уровней исследований', section: true, cells: [any ? { text: num(sum), title: 'Сумма уровней', cls: [P + 'total'], value: sum } : { text: '—', title: 'Нет данных', cls: [P + 'unknown'], value: null }], total: null });
    rows.push({ id: 'points', label: 'Стоимость, тыс.', title: 'Стоимость исследований (металл + кристалл + дейтерий) в тысячах ресурсов; это не игровые очки', cells: [any ? { text: num(pts), title: 'Стоимость исследований, тыс.', cls: [P + 'points'], value: Math.floor(pts) } : { text: '—', title: 'Нет данных', cls: [P + 'unknown'], value: null }], total: null });
    return { rows, notes: [] };
  }

  // Exposed for tests / fault injection (owned by this module): each builder may throw; the renderer isolates it.
  const BUILDERS = {
    resources: (d) => resourcesModel(d.cols, d.research, d.player, d.server, d.staleMs),
    buildings: (d) => ({ rows: levelRows(d.cols, 'building', 'resources', d.staleMs, { points: true }), notes: [] }),
    stations: (d) => ({ rows: levelRows(d.cols, 'station', 'facilities', d.staleMs, { points: true }), notes: [] }),
    research: (d) => researchModel(d.research, d.staleMs),
    fleet: (d) => ({ rows: unitRows(d.cols, OGX.catalog.shipIds, 'ships', 'shipsT', d.staleMs, d.player && d.player.playerClass, 'Верфь'), notes: [] }),
    defense: (d) => ({ rows: unitRows(d.cols, OGX.catalog.defenseIds, 'defense', 'defenseT', d.staleMs, d.player && d.player.playerClass, 'Оборона'), notes: [] }),
  };
  if (OGX.modules && OGX.modules[NAME]) OGX.modules[NAME]._views = BUILDERS;

  // ------------------------------------------------------------------ module instance
  class Empire {
    constructor(ctx) {
      this.ctx = ctx;
      this.log = ctx.log;
      this.view = VIEW_IDS.includes(ctx.settings.get('defaultView')) ? ctx.settings.get('defaultView') : 'resources';
      this.run = { active: false, controller: null, done: 0, total: 0, key: null, scope: null, last: null };
      this.offs = [];
      this.tab = null;
      this.pane = null;
      this.modal = null;
      this.liveCells = [];
      this.data = null;
    }

    async start() {
      const ctx = this.ctx;
      ctx.css(CSS);
      this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
      this.tab = this.panel.addTab({
        id: NAME, label: 'Империя', order: 20,
        render: (container) => this.render(container),
        onHide: () => { this.pane = null; this.liveCells = []; },
      });
      const refresh = OGX.util.debounce(() => this.refreshViews(), 250);
      this.offs.push(OGX.state.onChange(['bodies', 'research', 'player', 'server'], () => refresh()));
      this.offs.push(ctx.settings.onChange(() => refresh()));
      ctx.every(1000, (t) => this.tick(t));
      rec('S', 'empire:init', { view: this.view });
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* ignore */ } }
      this.offs = [];
      if (this.run.controller && this.run.active) this.run.controller.abort();
    }

    refreshViews() {
      if (this.tab) this.tab.refresh();
      if (this.modal && this.modal.body && this.modal.body.isConnected) OGX.safe(() => this.renderMatrixInto(this.modal.body, true), 'empire:renderModal')();
    }

    async loadData() {
      const [list, research, player, server] = await Promise.all([
        OGX.state.bodyList(), OGX.state.research(), OGX.state.player(), OGX.state.server(),
      ]);
      const showMoons = this.ctx.settings.get('showMoons') !== false;
      const staleMs = Math.max(1, +this.ctx.settings.get('staleHours') || 24) * HOUR;
      const cols = columnsFor(list, showMoons);
      learnValue('empire.bodies', cols.length, { min: 0, max: 60, int: true });
      this.data = { list, research, player, server, cols, staleMs };
      return this.data;
    }

    // ---------------------------------------------------------------- render (tab)
    render(container) {
      this.pane = container;
      container.classList.add(P + 'pane');
      const head = h('div', { class: P + 'head' });
      container.appendChild(head);
      head.appendChild(this.viewSwitcher(false));
      head.appendChild(this.controls());
      const progress = h('div', { class: P + 'progress', hidden: true });
      container.appendChild(progress);
      this.progressEl = progress;
      this.renderProgress();
      const body = h('div', { class: P + 'body' }, h('div', { class: P + 'loading' }, 'Загрузка…'));
      container.appendChild(body);
      OGX.safe(() => this.renderMatrixInto(body, false), 'empire:render')();
    }

    viewSwitcher(inModal) {
      const bar = h('div', { class: P + 'views', role: 'tablist' });
      for (const v of VIEWS) {
        bar.appendChild(h('button', {
          type: 'button', class: ['ogx-btn', P + 'view', v.id === this.view ? 'ogx-btn-primary' : null], dataset: { view: v.id, ogxAct: 'empire:view:' + v.id },
          'aria-selected': v.id === this.view ? 'true' : 'false', title: 'Показать: ' + v.label,
          onClick: () => this.setView(v.id, inModal),
        }, v.label));
      }
      return bar;
    }

    setView(id, inModal) {
      if (!VIEW_IDS.includes(id) || id === this.view) return;
      rec('U', 'view', { view: id, from: this.view, modal: !!inModal });
      this.view = id;
      this.refreshViews();
    }

    controls() {
      const run = this.run;
      const chosen = this.chosenViews();
      const box = h('div', { class: P + 'controls' });
      box.appendChild(h('button', {
        type: 'button', class: ['ogx-btn', P + 'refresh-all'], disabled: run.active, dataset: { ogxAct: 'empire:refresh-all' },
        title: isGz() ? 'Загрузить «Империю» игры (все планеты одной страницей)' + (includeFor(chosen).includes('settings') ? ' и «Сырьё» каждой планеты (&cp=…)' : '')
          : 'Загрузить выбранные страницы всех планет и лун (?cp=…)', onClick: () => this.startRefresh('all'),
      }, OGX.dom.icon('refresh'), 'Обновить всё'));
      box.appendChild(h('button', {
        type: 'button', class: ['ogx-btn', P + 'refresh-current'], disabled: run.active, dataset: { ogxAct: 'empire:refresh-current' },
        title: 'Загрузить выбранные страницы текущей планеты' + (isGz() ? ' (без смены планеты)' : ''), onClick: () => this.startRefresh('current'),
      }, 'Обновить эту планету'));
      const gameUrl = OGX.page.urlFor ? OGX.page.urlFor('empire') : null;
      if (gameUrl) {
        box.appendChild(h('a', { class: ['ogx-btn', P + 'game-link'], href: gameUrl, dataset: { ogxAct: 'empire:open-game' },
          title: 'Открыть страницу «Империя» игры: ' + (isGz() ? 'дополнение запомнит с неё данные всех планет' : 'все планеты в одной таблице') }, 'Империя игры'));
      }
      box.appendChild(h('button', {
        type: 'button', class: ['ogx-btn', 'ogx-btn-icon', P + 'expand'], dataset: { ogxAct: 'empire:expand' }, title: 'Открыть таблицу во всё окно',
        onClick: () => this.openModal(),
      }, '⤢'));
      const det = h('details', { class: P + 'what' });
      det.appendChild(h('summary', { title: 'Какие страницы загружать при обновлении' }, `Что обновлять (${chosen.length}/${VIEWS.length})`));
      for (const v of VIEWS) {
        const cb = h('input', {
          type: 'checkbox', class: P + 'what-cb', checked: chosen.includes(v.id), dataset: { view: v.id, ogxAct: 'empire:what:' + v.id },
          onChange: (ev) => this.toggleChosen(v.id, ev.target.checked),
        });
        det.appendChild(h('label', { class: P + 'what-item', title: 'Страница: ' + pagesOf(v).map(pageRu).join(', ') }, cb, ' ' + v.label));
      }
      box.appendChild(det);
      return box;
    }

    chosenViews() {
      const v = this.ctx.settings.get('refreshViews');
      const arr = Array.isArray(v) ? v.filter((x) => VIEW_IDS.includes(x)) : VIEW_IDS.slice();
      return arr;
    }

    async toggleChosen(id, on) {
      const cur = new Set(this.chosenViews());
      if (on) cur.add(id); else cur.delete(id);
      const list = VIEW_IDS.filter((x) => cur.has(x));
      rec('U', 'refresh-views', { view: id, on: !!on, list });
      await this.ctx.settings.set('refreshViews', list);
    }

    async renderMatrixInto(target, inModal) {
      let d;
      try {
        d = await this.loadData();
      } catch (e) {
        this.log.error('load data', e);
        target.textContent = '';
        target.appendChild(h('div', { class: P + 'error' }, 'Не удалось прочитать сохранённые данные: ' + ((e && e.message) || e)));
        return;
      }
      if (!target.isConnected && !inModal) return;
      target.textContent = '';
      if (!inModal) this.liveCells = [];
      if (!d.cols.length && this.view !== 'research') {
        target.appendChild(h('div', { class: P + 'empty' }, 'Нет данных о планетах. Откройте любую страницу игры.'));
        return;
      }
      let model;
      try {
        model = BUILDERS[this.view](d);
      } catch (e) {
        this.log.error('view ' + this.view + ' failed', e);
        rec('S', 'view-error', { view: this.view, message: String((e && e.message) || e) });
        target.appendChild(h('div', { class: P + 'error', dataset: { view: this.view } },
          `Ошибка в разделе «${viewDef(this.view).label}»: ${(e && e.message) || e}. Остальные разделы работают; скачайте журнал во вкладке «Логи».`));
        return;
      }
      const cols = this.view === 'research' ? [{ key: 'account', label: 'Аккаунт', sub: 'на все планеты', isMoon: false, href: null }] : d.cols;
      const hideEmpty = !!this.ctx.settings.get('hideEmptyRows') && (this.view === 'fleet' || this.view === 'defense');
      target.appendChild(this.table(model, cols, { hideEmpty, inModal }));
      for (const n of model.notes || []) target.appendChild(h('div', { class: [P + 'note', n.cls] }, n.text));
      target.appendChild(this.legend(d));
    }

    table(model, cols, { hideEmpty, inModal }) {
      const showTotal = cols.length > 1;
      const thead = h('thead', null, h('tr', null,
        h('th', { class: P + 'corner' }, viewDef(this.view).label),
        cols.map((c) => h('th', { class: [P + 'col', c.isMoon ? P + 'moon' : null], dataset: { key: c.key } },
          c.href ? h('a', { href: c.href, class: P + 'col-link', dataset: { ogxAct: 'empire:goto-body' }, title: 'Перейти на ' + c.label + ' ' + c.sub }, c.label) : h('span', null, c.label),
          h('div', { class: P + 'sub' }, c.sub))),
        showTotal ? h('th', { class: P + 'total-h', title: 'Итого по всем телам' }, 'Итого') : null));
      const tbody = h('tbody');
      for (const r of model.rows) {
        if (hideEmpty && r.empty && r.id !== 'points') continue;
        if (r.classMismatch && r.empty) continue;
        const tr = h('tr', { class: [P + 'row', r.section ? P + 'section' : null], dataset: { id: String(r.id) } },
          h('th', { class: P + 'label', title: r.title || '' }, r.label));
        r.cells.forEach((c, i) => {
          const td = h('td', { class: [P + 'cell'].concat(c.cls || []), title: c.title || null, dataset: { key: cols[i] ? cols[i].key : '' } }, c.text);
          if (c.live && !inModal) this.liveCells.push({ td, key: c.live.key, res: c.live.res, queued: '' });
          if (fin(c.computed)) td.dataset.computed = String(c.computed);
          tr.appendChild(td);
        });
        if (showTotal) {
          const t = r.total;
          tr.appendChild(h('td', { class: [P + 'cell', P + 'total'].concat(t && t.cls ? t.cls : []), title: t ? t.title : null }, t ? t.text : ''));
        }
        tbody.appendChild(tr);
      }
      return h('div', { class: P + 'scroll' }, h('table', { class: [P + 'table', P + 'v-' + this.view] }, thead, tbody));
    }

    legend(d) {
      const hours = Math.round(d.staleMs / HOUR);
      let unknown = 0;
      if (this.view !== 'research') {
        for (const c of d.cols) {
          const b = c.body;
          const t = { resources: b.res && b.res.t, buildings: b.levelsT && b.levelsT.resources, stations: b.levelsT && b.levelsT.facilities, fleet: b.shipsT, defense: b.defenseT }[this.view];
          if (!fin(t)) unknown++;
        }
      } else if (!fin(d.research.t)) unknown = 1;
      return h('div', { class: P + 'legend' },
        h('span', { class: P + 'stale-sample' }, 'серым'), ` — данные старше ${hours} ${OGX.fmt.plural(hours, ['часа', 'часов', 'часов'])}; `,
        h('span', { class: P + 'queued-sample' }, '→N'), ' — цель в очереди; «—» — нет данных.',
        unknown ? h('span', { class: P + 'unknown-count' }, ` Без данных: ${unknown} — нажмите «Обновить всё».`) : null);
    }

    openModal() {
      rec('U', 'expand', { view: this.view });
      const body = h('div', { class: ['ogx-root', P + 'modal-body'] });
      const wrap = h('div', null, this.viewSwitcher(true), body);
      const m = OGX.dom.modal({
        title: 'Империя', body: wrap, width: Math.min(1400, Math.max(600, window.innerWidth - 60)),
        buttons: [{ label: 'Закрыть', onClick: (close) => close() }],
        onClose: () => { this.modal = null; },
      });
      m.el.classList.add(P + 'modal');
      this.modal = { el: m.el, body, wrap, close: m.close };
      // the switcher inside the modal is rebuilt on every view change
      const origRefresh = () => {
        if (!this.modal) return;
        const sw = wrap.firstChild;
        const fresh = this.viewSwitcher(true);
        wrap.replaceChild(fresh, sw);
      };
      this.modal.syncSwitcher = origRefresh;
      OGX.safe(() => this.renderMatrixInto(body, true), 'empire:renderModal')();
    }

    // ---------------------------------------------------------------- live stock ticking
    tick(t) {
      if (this.modal && this.modal.syncSwitcher && this.modal.el && !this.modal.el.isConnected) this.modal = null;
      if (this.modal && this.modal.syncSwitcher) {
        const sel = this.modal.wrap.querySelector('.' + P + 'view.ogx-btn-primary');
        if (!sel || sel.dataset.view !== this.view) this.modal.syncSwitcher();
      }
      if (!this.pane || !this.pane.isConnected || this.view !== 'resources' || !this.data || !this.liveCells.length) return;
      const byKey = {};
      for (const c of this.data.cols) byKey[c.key] = c.body;
      for (const lc of this.liveCells) {
        const b = byKey[lc.key];
        if (!b || !b.res) continue;
        const p = OGX.state.projected(b, t);
        const v = lc.res === 'sum' ? RES.reduce((a, r) => a + ((p.res[r] && p.res[r].amount) || 0), 0) : p.res[lc.res] && p.res[lc.res].amount;
        const txt = num(v);
        if (lc.td.textContent !== txt) lc.td.textContent = txt;
      }
    }

    // ---------------------------------------------------------------- refresh
    renderProgress() {
      const el = this.progressEl;
      if (!el || !el.isConnected) return;
      const run = this.run;
      el.textContent = '';
      if (run.active) {
        el.hidden = false;
        const frac = run.total ? run.done / run.total : 0;
        const label = run.total ? `Обновление: ${num(run.done)} из ${num(run.total)}` + (run.key ? ` (${this.bodyLabel(run.key)})` : '') : 'Обновление: подготовка…';
        el.appendChild(h('div', { class: P + 'progress-text' }, label));
        el.appendChild(OGX.dom.bar(frac, { cls: 'ogx-ok', title: label }));
        el.appendChild(h('button', {
          type: 'button', class: ['ogx-btn', 'ogx-btn-danger', P + 'cancel'], dataset: { ogxAct: 'empire:refresh-cancel' },
          disabled: run.controller && run.controller.signal.aborted, onClick: () => this.cancelRefresh(),
        }, run.controller && run.controller.signal.aborted ? 'Отменяется…' : 'Отмена'));
      } else if (run.last) {
        el.hidden = false;
        el.appendChild(h('div', { class: [P + 'progress-text', P + 'result'] }, this.summaryText(run.last)));
      } else el.hidden = true;
    }

    bodyLabel(key) {
      const c = this.data && this.data.cols.find((x) => x.key === key);
      return c ? `${c.label} ${c.sub}` : key;
    }

    summaryText(r) {
      if (!r) return '';
      if (r.errors && r.errors.some((e) => e.error === 'cpConfirmed')) return 'Обновление не подтверждено.';
      const errs = (r.errors || []).filter((e) => e.error !== 'aborted');
      let s = r.aborted ? `Обновление отменено: выполнено ${num(r.done)} из ${num(r.total)} запросов.`
        : `Обновлено: ${num(r.ok !== undefined ? r.ok : r.done)} из ${num(r.total)} ${OGX.fmt.plural(r.total, ['запроса', 'запросов', 'запросов'])}.`;
      if (errs.length) s += ` Ошибок: ${num(errs.length)}.`;
      if (r.scope === 'all' && !r.restored && r.done > 0 && !r.direct) s += ' Не удалось вернуть выбранную планету — откройте её вручную.';
      return s;
    }

    async startRefresh(scope) {
      const run = this.run;
      if (run.active) return null;
      rec('U', 'refresh', { scope });
      const views = this.chosenViews();
      const include = includeFor(views);
      if (!include.length) {
        OGX.dom.toast('Не выбрано, что обновлять: отметьте разделы в «Что обновлять».', { type: 'warn' });
        return null;
      }
      const cur = OGX.state.current();
      if (scope === 'current' && !(cur && cur.key)) {
        OGX.dom.toast('Текущая планета не определена.', { type: 'warn' });
        return null;
      }
      const confirmed = !!OGX.settings.get('core.cpConfirmed');
      const gz = isGz();
      // GALAXYZ: page=imperium (every body) needs no cp; only page=resources per body (production) does.
      const perBody = gz ? include.filter((x) => x !== 'empire') : include;
      const direct = (scope === 'current' && !confirmed) || (gz && scope === 'current');   // current body: no ?cp= needed
      if (scope === 'all' && !confirmed && !direct && perBody.length) {
        const ok = await OGX.dom.confirm(h('div', { class: P + 'notice' }, gz ? CP_NOTICE_GZ : CP_NOTICE), { okLabel: 'Понятно, обновить', cancelLabel: 'Отмена', title: 'Обновление данных всех планет' });
        rec('U', 'cp-notice', { ok });
        if (!ok) return null;
        await OGX.settings.set('core.cpConfirmed', true);
      }
      run.active = true;
      run.scope = scope;
      run.controller = new AbortController();
      run.done = 0; run.total = 0; run.key = null; run.last = null;
      this.renderAllControls();
      rec('B', 'refresh:start', { scope, include, direct });
      const onProgress = (done, total, key) => { run.done = done; run.total = total; run.key = key; this.renderProgress(); };
      let result;
      try {
        if (direct) result = await this.doRefreshDirect(include, run.controller.signal, onProgress);
        // GALAXYZ: core refreshBodies fetches page=imperium once without cp first, then the per-body pages through ?cp= (one restore)
        else result = await this.doRefresh({ keys: scope === 'current' ? [cur.key] : undefined, include, signal: run.controller.signal, onProgress });
      } catch (e) {
        this.log.error('refresh failed', e);
        result = { done: run.done, errors: [{ key: null, error: String((e && e.message) || e) }], restored: false };
      }
      const aborted = run.controller.signal.aborted;
      run.active = false;
      run.last = Object.assign({ aborted, scope, direct, total: run.total, at: now() }, result || {});
      learnValue('empire.refreshDone', run.last.done, { min: 0, max: Math.max(run.total, run.last.done || 0, 0), int: true });
      const errs = (run.last.errors || []).filter((e) => e.error !== 'aborted');
      rec('B', 'refresh:end', { scope, done: run.last.done, total: run.total, errors: errs.length, aborted, restored: !!run.last.restored });
      if (errs.length) this.log.warn('refresh errors', JSON.stringify(errs.slice(0, 10)));
      OGX.dom.toast(this.summaryText(run.last), { type: aborted || errs.length ? 'warn' : 'ok', ms: 5000 });
      this.renderAllControls();
      this.refreshViews();
      return run.last;
    }

    renderAllControls() {
      if (this.pane && this.pane.isConnected) {
        const old = this.pane.querySelector('.' + P + 'controls');
        if (old) old.replaceWith(this.controls());
      }
      this.renderProgress();
    }

    cancelRefresh() {
      const run = this.run;
      if (!run.active || !run.controller) return;
      rec('U', 'refresh:cancel', { done: run.done, total: run.total });
      run.controller.abort();
      this.renderProgress();
    }
  }

  // B events: every refresh is a timed, journaled action.
  Empire.prototype.doRefresh = OGX.log.wrap(NAME, function refreshBodies(opts) { return OGX.state.refreshBodies(opts); }, 'refreshBodies');

  /** Local helper (core has no "refresh the current body without cp"): GET each page WITHOUT ?cp=, check that the server
   * rendered the expected body, and hand the snapshot to OGX.state.merge (the state store stays core-owned). */
  Empire.prototype.doRefreshDirect = OGX.log.wrap(NAME, async function refreshCurrentDirect(include, signal, onProgress) {
    const cur = OGX.state.current();
    const errors = [];
    let done = 0;
    let ok = 0;
    // GALAXYZ: page=imperium first (every body), then the current body's own pages; never with cp
    const jobs = include.filter((inc) => !(cur.isMoon && inc === 'settings')).sort((a, b) => (b === 'empire') - (a === 'empire'));
    for (const inc of jobs) {
      if (signal && signal.aborted) { errors.push({ key: cur.key, error: 'aborted' }); break; }
      const r = await OGX.api.page(PAGE_PATH[inc], { background: true });
      if (r.error) { errors.push({ key: cur.key, error: r.error }); if (r.loggedOut) break; } else {
        try {
          const s = OGX.state.snapshotSync(r.doc, PAGE_NAME[inc]);
          // page=imperium lists every body: the selected one does not matter; other pages must show the current body
          if (inc !== 'empire' && (!s.current || s.current.id !== cur.id)) throw new Error('body mismatch ' + (s.current && s.current.id) + ' != ' + cur.id);
          if (inc === 'empire' && isGz() && !s.empire) throw new Error('page=imperium not readable');
          const wall = s.serverTimeString ? OGX.time.parseServerWall(s.serverTimeString) : null;
          await OGX.state.merge(s, { t: wall || OGX.time.serverNow() });
          ok++;
        } catch (e) { errors.push({ key: cur.key, error: String(e.message || e) }); }
      }
      done++;
      if (onProgress) OGX.safe(onProgress, 'empire:onProgress')(done, jobs.length, cur.key);
    }
    OGX.bus.emit('state:updated', { keys: ['bodies', 'research'] });
    for (const e of errors) e.text = OGX.state.refreshErrorText(e.error);
    return { done, ok, errors, restored: true };
  }, 'refreshCurrentDirect');

  const CSS = `
.${P}pane { display: flex; flex-direction: column; gap: 6px; }
.${P}head { display: flex; flex-direction: column; gap: 4px; }
.${P}views { display: flex; flex-wrap: wrap; gap: 2px; }
.${P}view { padding: 1px 6px; }
.${P}controls { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.${P}what { color: var(--ogx-muted); }
.${P}what summary { cursor: pointer; }
.${P}what-item { display: inline-flex; align-items: center; margin-right: 8px; white-space: nowrap; }
.${P}progress { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px; border: 1px solid var(--ogx-border); border-radius: 3px; }
.${P}progress .ogx-bar { flex: 1 1 120px; min-width: 80px; }
.${P}progress-text { flex: 1 1 100%; }
.${P}scroll { overflow: auto; max-height: calc(100vh - 230px); border: 1px solid var(--ogx-border); }
.${P}modal .${P}scroll { max-height: calc(100vh - 220px); }
.${P}table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-size: 11px; }
.${P}table th, .${P}table td { padding: 2px 3px; border-bottom: 1px solid var(--ogx-border); white-space: nowrap; }
/* the right-aligned last column (Итого) would otherwise end flush on the scroll box border */
.${P}table th:last-child, .${P}table td:last-child { padding-right: 6px; }
.${P}table thead th { position: sticky; top: 0; background: var(--ogx-bg); z-index: 2; text-align: right; vertical-align: bottom; }
.${P}table th.${P}label, .${P}table th.${P}corner { position: sticky; left: 0; background: var(--ogx-panel); text-align: left; z-index: 1; }
.${P}table thead th.${P}corner { z-index: 3; background: var(--ogx-bg); }
.${P}col-link { color: var(--ogx-accent); text-decoration: none; }
.${P}col-link:hover { text-decoration: underline; }
.${P}moon { color: var(--ogx-muted); }
.${P}sub { color: var(--ogx-muted); font-weight: normal; font-size: 10px; }
.${P}cell { text-align: right; font-variant-numeric: tabular-nums; }
.${P}total { font-weight: bold; color: #fff; }
.${P}section > th, .${P}section > td { border-top: 1px solid var(--ogx-muted); }
.${P}stale { opacity: .45; }
.${P}unknown { color: var(--ogx-muted); }
.${P}na { background: rgba(255,255,255,.03); }
.${P}queued { color: var(--ogx-energy); }
.${P}done { color: var(--ogx-ok); }
.${P}warn { color: var(--ogx-warn); }
.${P}bad { color: var(--ogx-bad); }
.${P}mismatch { color: var(--ogx-warn); text-decoration: underline dotted; }
.${P}res-metal { color: var(--ogx-metal); }
.${P}res-crystal { color: var(--ogx-crystal); }
.${P}res-deuterium { color: var(--ogx-deuterium); }
.${P}res-metal.${P}warn, .${P}res-crystal.${P}warn, .${P}res-deuterium.${P}warn { color: var(--ogx-warn); }
.${P}res-metal.${P}bad, .${P}res-crystal.${P}bad, .${P}res-deuterium.${P}bad { color: var(--ogx-bad); }
.${P}points { color: var(--ogx-muted); }
.${P}calc { color: var(--ogx-muted); font-style: italic; }
.${P}game-link { text-decoration: none; }
.${P}note { padding: 4px; color: var(--ogx-muted); }
.${P}mismatch-note { color: var(--ogx-warn); }
.${P}error { padding: 6px; border: 1px solid var(--ogx-bad); color: var(--ogx-bad); border-radius: 3px; }
.${P}empty, .${P}loading { padding: 8px; color: var(--ogx-muted); }
.${P}legend { color: var(--ogx-muted); font-size: 10px; }
.${P}stale-sample { opacity: .45; }
.${P}queued-sample { color: var(--ogx-energy); }
.${P}unknown-count { color: var(--ogx-warn); }
.${P}notice { white-space: pre-line; }
`;
})(window.OGX);
