/* ogamex-infinity/modules/prefs/prefs.js — Owner: infinity/prefs.
 * Settings, keyboard shortcuts, JSON export/import (PTRE replacement) — DESIGN §4.2.10.
 *   - Side-panel tab «Настройки» (order 100):
 *       · «Модули»: one enable toggle per Infinity module (setting `<module>.enabled`, takes effect after a reload);
 *       · «Резервная копия и обмен»: «Экспорт всего» (OGX.storage.exportAll, player + server scope unless
 *         prefs.exportIncludeServer = false), «Экспорт целей» (only `targets.*` + `stalk.*`, for allies; also «Копировать»),
 *         «Импорт из файла» / «Вставить JSON» → preview (source host/player/date, warning when they differ, keys grouped by
 *         owner with counts and new/changed/same state, group checkboxes) → mode merge | replace → OGX.storage.importAll;
 *       · «Горячие клавиши»: list of the active shortcuts, conflicts, rules;
 *       · the generated settings form (OGX.dom.settingsForm) for core + every Infinity module, collapsible, with a per-module
 *         «Сбросить» button.
 *   - Keyboard shortcuts (DESIGN §3.3): configurable `hotkey` settings; ignored in input/textarea/select/[contenteditable],
 *     inside .ui-dialog (jQuery UI dialogs), #chatBar (layouts/main.blade.php:1872) and our own modals. Arrow keys are never
 *     handled on /galaxy (the game binds them on keyup of documentElement, galaxy.md §2.1).
 *       · prev/next body: same URL with ?cp=<id> (planet-list links keep the query and replace cp, main.blade.php:1733-1735);
 *         order = #planetList > .smallplanet order (database order, layout.md §4.1). On a moon it cycles over moons.
 *       · planet ↔ moon: the a.moonlink / a.planetlink of the same .smallplanet (main.blade.php:1739-1820).
 *       · page jumps: /overview /resources /facilities /research /shipyard /fleet /galaxy /messages (routes/web.php, layout.md §10).
 *       · fleet select all / reset: clicks a#sendall / a#resetall (fleet/index.blade.php:944,949; handled by the game's
 *         delegated jQuery click handler, ingame bundle `elem.on('click', '#sendall' …)`).
 *   - Storage mergers (used by the import's merge mode): `settings` (per key, imported wins, local panel UI state kept),
 *     `galaxy.g*` / `galaxy.players` (per entry, newer `t` wins). Module data have their own mergers (targets, stalk, stats, todo).
 * Writes: settings only; the import writes any key (the sanctioned exception, DESIGN §2.5).
 * Local helpers (no core API): event → hotkey matching (by e.code and e.key), import preview/grouping, replace-mode cleanup.
 *
 * GALAXYZ (ogamex.eu, 2Moons fork; specs/galaxyz/layout.md, fleet.md, CORE_API §22):
 *   - page jumps go through OGX.page.url (translated to game.php?page=…): «Постройки» = page=buildings (mines, storage
 *     and facilities are one page), the second jump opens page=resources (production settings), «Империя» = page=imperium;
 *   - prev/next body and planet ↔ moon: the full body list of #planetSelector (OGX.parse.gz.bodies: planets and moons in
 *     the game's order; a moon belongs to the planet with the same coordinates); same page with &cp= like the game's
 *     selector (base.js:282), except fleetStep1-3 / info pages (-> page=fleetTable / overview) and the galaxy (a galaxy
 *     view costs deuterium -> overview);
 *   - fleet select all / reset: there is no #sendall / #resetall; on page=fleetTable (step 0) the core form filler
 *     OGX.fleet.gz.fillShips fills ship<ID> with every available ship / with nothing (nothing is submitted);
 *   - export file names / previews use the GALAXYZ storage identity (host 'ogamex.eu/aeternum', player 'n:<name>').
 */
(function (OGX) {
  'use strict';

  const NAME = 'prefs';
  const P = 'ogx-i-prefs-';
  const PANEL_ID = 'infinity';
  const INFINITY_MODULES = ['panel', 'empire', 'targets', 'spy', 'stats', 'stalk', 'flights', 'fleethelp', 'todo', 'prefs'];
  const FORM_NS = ['core'].concat(INFINITY_MODULES);
  const MODULE_RU = { panel: 'Панель управления', empire: 'Империя', targets: 'Цели, метки и поиск', spy: 'Шпионские доклады и рейды', stats: 'Статистика',
    stalk: 'Слежка за игроками', flights: 'Полёты', fleethelp: 'Помощник флота', todo: 'План построек', prefs: 'Настройки, горячие клавиши, экспорт/импорт' };
  const SHARE_PREFIXES = ['targets.', 'stalk.'];
  const PREVIEW_MAX_ROWS = 400;

  // GALAXYZ is detected cheaply at load (page.detect: generator meta + game.php), so the hotkey labels name the right pages.
  const GZ_AT_LOAD = (() => { try { const d = OGX.page.detect(); return !!(d && d.ok && d.engine === 'galaxyz'); } catch (e) { return false; } })();
  const isGz = () => { try { return OGX.page.isGz && OGX.page.isGz() ? true : GZ_AT_LOAD; } catch (e) { return GZ_AT_LOAD; } };
  // page jumps (layout.md §10, routes/web.php; GALAXYZ: OGX.page.url translates the paths, galaxyz/layout.md §2).
  // gzPath / gzLabel: GALAXYZ has one page=buildings for /resources + /facilities, so the second key opens page=resources.
  const JUMPS = [
    { key: 'keyOverview', path: '/overview', label: 'Обзор', def: 'Alt+Shift+1' },
    { key: 'keyResources', path: '/resources', label: 'Сырьё', gzLabel: 'Постройки (рудники, склады, фабрики)', def: 'Alt+Shift+2' },
    { key: 'keyFacilities', path: '/facilities', label: 'Постройки', gzPath: '/resources/settings', gzLabel: 'Сырьё (настройки добычи)', def: 'Alt+Shift+3' },
    { key: 'keyResearch', path: '/research', label: 'Исследования', def: 'Alt+Shift+4' },
    { key: 'keyShipyard', path: '/shipyard', label: 'Верфь', def: 'Alt+Shift+5' },
    { key: 'keyFleet', path: '/fleet', label: 'Флот', def: 'Alt+Shift+6' },
    { key: 'keyGalaxy', path: '/galaxy', label: 'Галактика', def: 'Alt+Shift+7' },
    { key: 'keyMessages', path: '/messages', label: 'Сообщения', def: 'Alt+Shift+8' },
    { key: 'keyEmpire', path: '/empire', label: 'Империя', def: 'Alt+Shift+9' },
  ];
  for (const j of JUMPS) if (GZ_AT_LOAD && j.gzLabel) j.label = j.gzLabel;
  const jumpPath = (a) => (isGz() && a.gzPath ? a.gzPath : a.path);
  /** action id -> { key (setting), label, def } in display order. */
  const ACTIONS = [
    { id: 'panel', key: 'keyPanel', label: 'Открыть/закрыть панель ' + (OGX.suite ? 'OgameX Suite' : 'Infinity'), def: 'Alt+Shift+I' },   // OGX.suite: suite/00-suite.js loads before the modules
    { id: 'prevBody', key: 'keyPrevBody', label: 'Предыдущая планета (луна)', def: 'Alt+PageUp' },
    { id: 'nextBody', key: 'keyNextBody', label: 'Следующая планета (луна)', def: 'Alt+PageDown' },
    { id: 'moon', key: 'keyMoon', label: 'Планета ↔ луна', def: 'Alt+Shift+M' },
  ].concat(JUMPS.map((j) => ({ id: 'go:' + j.path, key: j.key, label: 'Перейти: ' + j.label, def: j.def, path: j.path, gzPath: j.gzPath })))
    .concat([
      { id: 'fleetAll', key: 'keyFleetAll', label: 'Флот: выбрать все корабли', def: 'Alt+Shift+A' },
      { id: 'fleetReset', key: 'keyFleetReset', label: 'Флот: сбросить выбор', def: 'Alt+Shift+R' },
    ])
    .concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: 'tab' + n, key: 'keyTab' + n, label: 'Вкладка панели ' + n, def: '', tab: n })));

  const SETTINGS = {
    exportIncludeServer: { type: 'bool', default: true, label: 'В «Экспорт всего» включать кэш галактики и список игроков', section: 'Экспорт' },
  };
  for (const a of ACTIONS) SETTINGS[a.key] = { type: 'hotkey', default: a.def, label: a.label, section: 'Горячие клавиши', hint: a.tab ? 'По умолчанию не назначено' : undefined };
  for (const k of Object.keys(SETTINGS)) if (SETTINGS[k].hint === undefined) delete SETTINGS[k].hint;

  OGX.module({
    name: NAME,
    title: 'Настройки, горячие клавиши, экспорт/импорт',
    pages: '*',
    settings: SETTINGS,
    async init(ctx) {
      const p = new Prefs(ctx);
      ctx._prefs = p;
      await p.start();
    },
    dispose(ctx) {
      if (ctx._prefs) ctx._prefs.dispose();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);
  const num = (n) => (fin(n) ? OGX.fmt.num(n) : '—');
  const rec = (src, what, data) => { try { OGX.log.rec(src, NAME, what, data); } catch (e) { /* journal off */ } };
  const learnValue = (name, v, o) => { try { return OGX.learn ? OGX.learn.value(name, v, o) : true; } catch (e) { return true; } };
  const learnCheck = (name, o) => { try { return OGX.learn ? OGX.learn.check(name, o) : true; } catch (e) { return true; } };
  const norm = (s) => { try { return OGX.settings.normalizeHotkey(s); } catch (e) { return ''; } };
  const now = () => { try { return OGX.time.serverNow(); } catch (e) { return Date.now(); } };
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  /** Storage player id for display: GALAXYZ keys are 'n:<name>' (the own numeric id is not on the pages). */
  const playerText = (id) => (id == null ? '—' : String(id).replace(/^n:/, ''));

  /** Hotkey strings an event can stand for: by e.code (layout independent: KeyM → M, Digit1 → 1) and by e.key. */
  function combosFromEvent(e) {
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
    const keys = new Set();
    const code = String(e.code || '');
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) keys.add(m[1]);
    else if ((m = /^(?:Digit|Numpad)(\d)$/.exec(code))) keys.add(m[1]);
    const k = String(e.key || '');
    if (k && k !== 'Unidentified' && k !== 'Dead' && !['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(k)) keys.add(k === ' ' ? 'Space' : k);
    const out = [];
    for (const key of keys) { const c = norm(mods.concat(key).join('+')); if (c && !out.includes(c)) out.push(c); }
    return out;
  }
  const isArrowCombo = (c) => /(^|\+)Arrow(Left|Right|Up|Down)$/.test(String(c || ''));

  /** True when the key event must be left to the page (typing, game dialogs, chat, our modals). DESIGN §3.3. */
  function ignoredTarget(t) {
    if (!t || t.nodeType !== 1) return false;
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (t.isContentEditable || (t.closest && t.closest('[contenteditable=""], [contenteditable="true"]'))) return true;
    if (t.closest && t.closest('.ui-dialog, #chatBar, .ogx-modal-overlay')) return true;
    return false;
  }

  function ymd(ms) {
    const tz = (OGX.time && fin(OGX.time.tzOffsetMs)) ? OGX.time.tzOffsetMs : 0;
    const d = new Date(ms + tz);
    return String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  }
  const safeName = (s) => String(s == null ? '' : s).replace(/[^a-z0-9.-]+/gi, '_').replace(/^_+|_+$/g, '') || 'x';
  function exportFileName(kind, host, playerId, ms) {
    return ['ogamex-infinity', kind === 'targets' ? 'targets' : null, safeName(host), safeName(playerId), ymd(ms)].filter(Boolean).join('-') + '.json';
  }
  /** Number of entries of a stored value (for previews). */
  function entryCount(v) {
    if (Array.isArray(v)) return v.length;
    if (isObj(v)) {
      // module stores keep their collection under a known field ({ v, planets, players } / { v, items } …)
      let n = 0, coll = false;
      for (const [k, x] of Object.entries(v)) {
        if (k === 'v') continue;
        if (Array.isArray(x)) { n += x.length; coll = true; } else if (isObj(x) && Object.values(x).every((y) => isObj(y) || Array.isArray(y))) { n += Object.keys(x).length; coll = true; }
      }
      return coll ? n : Object.keys(v).filter((k) => k !== 'v').length;
    }
    return v == null ? 0 : 1;
  }
  /** Group of a key: module/core owner (text before the first '.'), core keys by name. */
  function groupOf(key) {
    const s = String(key);
    const i = s.indexOf('.');
    return i < 0 ? s : s.slice(0, i);
  }
  const GROUP_LABELS = {
    settings: 'Настройки', bodies: 'Планеты (данные)', research: 'Исследования', player: 'Игрок', slots: 'Слоты флота', shipStats: 'Характеристики кораблей',
    flights: 'Полёты (кэш)', prefill: 'Предзаполнение флота', diag: 'Диагностика', galaxy: 'Галактика (кэш)', server: 'Настройки вселенной',
    titles: 'Названия объектов', topScore: 'Лучший результат', targets: 'Цели и метки', stalk: 'Слежка', spy: 'Шпионские доклады', stats: 'Статистика',
    empire: 'Империя', todo: 'План построек', fleethelp: 'Помощник флота', flights_: 'Полёты', panel: 'Панель', prefs: 'Настройки модуля',
  };
  function groupLabel(g) {
    if (GROUP_LABELS[g]) return GROUP_LABELS[g];
    const m = OGX.modules && OGX.modules[g];
    return (m && m.title) || g;
  }

  /** Summary of an export file against the current storage: rows per key + groups. */
  async function summarize(file) {
    const rows = [];
    for (const scope of ['player', 'server', 'global']) {
      const part = file && file.data && file.data[scope];
      if (!isObj(part)) continue;
      for (const [key, value] of Object.entries(part)) {
        if (key.startsWith('lock.')) continue;
        let old = null;
        try { old = await OGX.storage.get(key, null, { scope }); } catch (e) { old = null; }
        const state = old === null || old === undefined ? 'new' : JSON.stringify(old) === JSON.stringify(value) ? 'same' : 'changed';
        let size = 0;
        try { size = JSON.stringify(value).length; } catch (e) { size = 0; }
        rows.push({ scope, key, group: groupOf(key), count: entryCount(value), localCount: old == null ? 0 : entryCount(old), state, size });
      }
    }
    const groups = {};
    for (const r of rows) {
      const g = groups[r.group] || (groups[r.group] = { id: r.group, label: groupLabel(r.group), keys: 0, count: 0, size: 0, states: { new: 0, changed: 0, same: 0 } });
      g.keys++; g.count += r.count; g.size += r.size; g.states[r.state]++;
    }
    return { rows, groups: Object.values(groups).sort((a, b) => a.label.localeCompare(b.label, 'ru')) };
  }
  /** Copy of the file restricted to the chosen groups. */
  function filterFile(file, groupIds) {
    const want = new Set(groupIds);
    const out = Object.assign({}, file, { data: {} });
    for (const [scope, part] of Object.entries(file.data || {})) {
      if (!isObj(part)) continue;
      out.data[scope] = {};
      for (const [k, v] of Object.entries(part)) if (want.has(groupOf(k))) out.data[scope][k] = v;
    }
    return out;
  }
  function parseExport(text) {
    let file;
    try { file = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch (e) { return { error: 'Файл не является JSON: ' + e.message }; }
    if (!isObj(file) || file.format !== 'ogx-export' || !isObj(file.data)) return { error: 'Это не файл экспорта OgameX (нет format: "ogx-export")' };
    return { file };
  }

  // ------------------------------------------------------------------ storage mergers (import, merge mode)
  /** settings: nested { ns: { key: v } }; imported values win per key, the local side-panel UI state is kept. */
  function mergeSettings(oldV, impV) {
    const out = {};
    const a = isObj(oldV) ? oldV : {}, b = isObj(impV) ? impV : {};
    for (const ns of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (isObj(a[ns]) || isObj(b[ns])) out[ns] = Object.assign({}, isObj(a[ns]) ? a[ns] : {}, isObj(b[ns]) ? b[ns] : {});
      else out[ns] = ns in b ? b[ns] : a[ns];
    }
    if (isObj(a.core)) {
      for (const k of Object.keys(out.core || {})) if (/^panel\./.test(k) || k === 'cpConfirmed') { if (k in a.core) out.core[k] = a.core[k]; else delete out.core[k]; }
    }
    return out;
  }
  /** { id: { t, … } } maps (galaxy cache per galaxy, player directory): the newer `t` wins, ties: imported. */
  function mergeByT(oldV, impV) {
    if (!isObj(oldV)) return impV;
    if (!isObj(impV)) return oldV;
    const out = Object.assign({}, oldV);
    for (const [k, v] of Object.entries(impV)) {
      const o = oldV[k];
      const to = isObj(o) && fin(+o.t) ? +o.t : -Infinity;
      const ti = isObj(v) && fin(+v.t) ? +v.t : -Infinity;
      out[k] = !o ? v : ti >= to ? v : o;
    }
    return out;
  }
  let mergersRegistered = false;
  function registerMergers() {
    if (mergersRegistered || !OGX.storage || typeof OGX.storage.registerMerger !== 'function') return;
    OGX.storage.registerMerger('settings', mergeSettings);
    OGX.storage.registerMerger('galaxy.g', mergeByT);
    OGX.storage.registerMerger('galaxy.players', mergeByT);
    mergersRegistered = true;
  }

  // test/debug surface (pure functions only)
  OGX.prefsLib = { combosFromEvent, ignoredTarget, exportFileName, entryCount, groupOf, filterFile, parseExport, mergeSettings, mergeByT, ACTIONS };

  // ------------------------------------------------------------------ module
  class Prefs {
    constructor(ctx) {
      this.ctx = ctx;
      this.log = ctx.log;
      this.offs = [];
      this.map = new Map();      // normalized combo -> action
      // every add-on action is a timed B event
      this.exportAll = OGX.log.wrap(NAME, this._exportAll.bind(this), 'exportAll');
      this.exportTargets = OGX.log.wrap(NAME, this._exportTargets.bind(this), 'exportTargets');
      this.copyTargets = OGX.log.wrap(NAME, this._copyTargets.bind(this), 'copyTargets');
      this.loadImport = OGX.log.wrap(NAME, this._loadImport.bind(this), 'importPreview');
      this.applyImport = OGX.log.wrap(NAME, this._applyImport.bind(this), 'importApply');
      this.runAction = OGX.log.wrap(NAME, this._runAction.bind(this), 'hotkey');
      this.resetNs = OGX.log.wrap(NAME, this._resetNs.bind(this), 'resetSettings');
    }

    async start() {
      const ctx = this.ctx;
      ctx.css(CSS);
      registerMergers();
      this.rebuildMap();
      this.offs.push(OGX.settings.onChange(NAME, () => { this.rebuildMap(); this.refreshHelp(); }));
      ctx.on(document, 'keydown', (ev) => this.onKey(ev));

      this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
      this.tab = this.panel.addTab({ id: 'prefs', label: 'Настройки', order: 100, render: (c) => this.render(c) });
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* ignore */ } }
      this.offs = [];
    }

    // ---------------------------------------------------------------- hotkeys
    rebuildMap() {
      const map = new Map();
      const conflicts = [];
      for (const a of ACTIONS) {
        const c = norm(this.ctx.settings.get(a.key));
        if (!c) continue;
        if (map.has(c)) { conflicts.push({ combo: c, a: map.get(c).label, b: a.label }); continue; }
        map.set(c, a);
      }
      this.map = map;
      this.conflicts = conflicts;
      if (conflicts.length) this.log.warn('hotkey conflicts', conflicts.map((x) => x.combo).join(', '));
    }

    onKey(ev) {
      if (!ev || ev.defaultPrevented || ev.isComposing || ev.repeat) return;
      if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(ev.key)) return;
      if (!this.map.size) return;
      if (ignoredTarget(ev.target) || ignoredTarget(document.activeElement)) return;
      const combos = combosFromEvent(ev);
      let action = null, combo = null;
      for (const c of combos) if (this.map.has(c)) { action = this.map.get(c); combo = c; break; }
      if (!action) return;
      // never bind the arrow keys on /galaxy (the game navigates systems with them, galaxy.md §2.1)
      if (isArrowCombo(combo) && OGX.page.is('galaxy')) return;
      ev.preventDefault();
      rec('U', 'hotkey', { combo, action: action.id });
      this.runAction(action.id);
    }

    async _runAction(id) {
      const a = ACTIONS.find((x) => x.id === id);
      if (!a) return { ok: false, error: 'unknown action' };
      if (id === 'panel') { this.panel.toggle(); return { ok: true, open: this.panel.isOpen() }; }
      if (id === 'prevBody' || id === 'nextBody') return this.stepBody(id === 'nextBody' ? 1 : -1);
      if (id === 'moon') return this.switchMoon();
      if (a.path) { const path = jumpPath(a); this.navigate(OGX.page.url(path)); return { ok: true, path }; }
      if (id === 'fleetAll' || id === 'fleetReset') return this.fleetButton(id === 'fleetAll' ? '#sendall' : '#resetall');
      if (a.tab) return this.selectPanelTab(a.tab);
      return { ok: false };
    }

    navigate(url) {
      rec('B', 'navigate', { url: String(url).replace(location.origin, '') });
      location.assign(url);
    }

    /** Bodies in planet-list order (layout.md §4.1): [{ planetId, moonId }]. */
    bodies() {
      const out = [];
      if (isGz()) {
        // GALAXYZ: #planetSelector lists every body (moons too) in the game's order; a moon goes with its planet's coords
        let list = [];
        try { list = (OGX.parse.gz.bodies(document) || {}).list || []; } catch (e) { list = []; }
        for (const b of list) if (!b.isMoon && b.id > 0) out.push({ planetId: b.id, moonId: null, coords: b.coords });
        for (const b of list) {
          if (!b.isMoon || !(b.id > 0)) continue;
          const pl = out.find((x) => x.coords && x.coords === b.coords && !x.moonId);
          if (pl) pl.moonId = b.id;
        }
        learnValue('prefs.bodyCount', out.length, { min: 0, int: true });
        return out;
      }
      for (const el of OGX.dom.$$('#planetList > .smallplanet')) {
        const id = +el.getAttribute('data-planet-id');
        const moonA = el.querySelector('a.moonlink');
        let moonId = null;
        if (moonA) { try { moonId = +new URL(moonA.getAttribute('href') || moonA.getAttribute('data-link'), location.href).searchParams.get('cp') || null; } catch (e) { moonId = null; } }
        if (id > 0) out.push({ planetId: id, moonId });
      }
      learnValue('prefs.bodyCount', out.length, { min: 0, int: true });
      return out;
    }
    /** Current body: core state first, then meta ogame-planet-id (layout.md §3) + planet list. */
    current(list) {
      let cur = null;
      try { cur = OGX.state.current(); } catch (e) { cur = null; }
      let id = cur && +cur.id;
      if (!(id > 0)) { const m = OGX.dom.$('meta[name="ogame-planet-id"]'); id = m ? +m.getAttribute('content') : 0; }
      if (!(id > 0)) return null;
      const asMoon = list.findIndex((b) => b.moonId === id);
      if (asMoon >= 0) return { id, isMoon: true, index: asMoon };
      const asPlanet = list.findIndex((b) => b.planetId === id);
      return asPlanet >= 0 ? { id, isMoon: false, index: asPlanet } : null;
    }
    /** Same page, other body (core page.bodyUrl: like the game's selector; fleetStep1-3 -> fleetTable, info/galaxy -> overview). */
    urlForBody(id) { return OGX.page.bodyUrl(id); }
    stepBody(dir) {
      const list = this.bodies();
      const cur = this.current(list);
      if (!cur || list.length < 2) { OGX.dom.toast('Нет другой планеты для переключения', { type: 'warn' }); return { ok: false, reason: 'single' }; }
      const pool = cur.isMoon ? list.map((b, i) => ({ i, id: b.moonId })).filter((x) => x.id) : list.map((b, i) => ({ i, id: b.planetId }));
      if (pool.length < 2) { OGX.dom.toast('Нет другой луны для переключения', { type: 'warn' }); return { ok: false, reason: 'single-moon' }; }
      const pos = pool.findIndex((x) => x.i === cur.index);
      const next = pool[(pos + dir + pool.length) % pool.length];
      this.navigate(this.urlForBody(next.id));
      return { ok: true, from: cur.id, to: next.id };
    }
    switchMoon() {
      const list = this.bodies();
      const cur = this.current(list);
      if (!cur) return { ok: false, reason: 'no-current' };
      const b = list[cur.index];
      const to = cur.isMoon ? b.planetId : b.moonId;
      if (!to) { OGX.dom.toast('У этой планеты нет луны', { type: 'warn' }); return { ok: false, reason: 'no-moon' }; }
      this.navigate(this.urlForBody(to));
      return { ok: true, from: cur.id, to };
    }
    fleetButton(sel) {
      if (!OGX.page.is('fleet')) { OGX.dom.toast('Работает только на странице «Флот»', { type: 'warn' }); return { ok: false, reason: 'page' }; }
      if (isGz()) return this.gzFleetButton(sel === '#sendall');
      const a = OGX.dom.$(sel);   // fleet/index.blade.php:944 (#sendall), :949 (#resetall)
      if (!a) { OGX.dom.toast('Кнопка выбора кораблей не найдена (нет кораблей на планете?)', { type: 'warn' }); return { ok: false, reason: 'missing' }; }
      a.click();
      return { ok: true, sel };
    }
    /** GALAXYZ fleetTable (step 0): no #sendall/#resetall; fill ship<ID> through the core form filler (never submits). */
    gzFleetButton(all) {
      const G = OGX.fleet && OGX.fleet.gz;
      let st = null;
      try { st = G && G.state ? G.state() : null; } catch (e) { st = null; }
      if (!G || !st || st.step !== 0) {
        OGX.dom.toast('Выбор кораблей работает на первом шаге отправки флота («Флот»)', { type: 'warn' });
        return { ok: false, reason: 'step' };
      }
      const avail = st.available || {};
      const ships = {};
      if (all) for (const [id, n] of Object.entries(avail)) if (+n > 0) ships[id] = +n;
      if (all && !Object.keys(ships).length) { OGX.dom.toast('На планете нет кораблей, которые могут лететь', { type: 'warn' }); return { ok: false, reason: 'missing' }; }
      const r = G.fillShips(ships, { reset: true });
      return { ok: !!(r && r.ok), all, ships: r && r.ships };
    }

    selectPanelTab(n) {
      const btns = this.panel.tabBar ? Array.from(this.panel.tabBar.querySelectorAll('.ogx-tab')) : [];
      const b = btns[n - 1];
      if (!b) return { ok: false, reason: 'no-tab' };
      this.panel.open();
      this.panel.selectTab(b.dataset.tab);
      return { ok: true, tab: b.dataset.tab };
    }

    // ---------------------------------------------------------------- export
    async buildExport(kind) {
      const includeServer = this.ctx.settings.get('exportIncludeServer') !== false;
      const opts = kind === 'targets' ? { scopes: ['player'], prefixes: SHARE_PREFIXES } : { scopes: includeServer ? ['player', 'server'] : ['player'] };
      const file = await OGX.storage.exportAll(opts);
      file.kind = kind;
      file.source = OGX.ext === 'suite' ? 'OgameX Suite' : 'OgameX Infinity';
      const keys = Object.values(file.data || {}).reduce((n, part) => n + Object.keys(part || {}).length, 0);
      learnValue('prefs.exportKeys', keys, { min: 0, int: true });
      const ns = OGX.storage.ns || {};
      return { file, keys, name: exportFileName(kind, file.host || ns.host || location.host, file.playerId != null ? file.playerId : ns.playerId, file.exportedAt || now()) };
    }
    async _exportAll() {
      const r = await this.buildExport('all');
      OGX.dom.download(r.name, JSON.stringify(r.file));
      this.lastExport = { name: r.name, keys: r.keys };
      OGX.dom.toast(`Экспорт сохранён: ${r.name} (${num(r.keys)} ${OGX.fmt.plural(r.keys, ['ключ', 'ключа', 'ключей'])})`, { type: 'ok' });
      this.setStatus(`Экспорт всего: ${num(r.keys)} ${OGX.fmt.plural(r.keys, ['ключ', 'ключа', 'ключей'])}`);
      return { ok: true, name: r.name, keys: r.keys };
    }
    async _exportTargets() {
      const r = await this.buildExport('targets');
      if (!r.keys) { OGX.dom.toast('Нет целей и данных слежки для экспорта', { type: 'warn' }); return { ok: false, keys: 0 }; }
      OGX.dom.download(r.name, JSON.stringify(r.file));
      this.lastExport = { name: r.name, keys: r.keys };
      OGX.dom.toast(`Цели сохранены: ${r.name}`, { type: 'ok' });
      this.setStatus(`Экспорт целей: ${num(r.keys)} ${OGX.fmt.plural(r.keys, ['ключ', 'ключа', 'ключей'])}`);
      return { ok: true, name: r.name, keys: r.keys };
    }
    async _copyTargets() {
      const r = await this.buildExport('targets');
      if (!r.keys) { OGX.dom.toast('Нет целей и данных слежки для экспорта', { type: 'warn' }); return { ok: false, keys: 0 }; }
      const ok = await OGX.dom.copy(JSON.stringify(r.file));
      OGX.dom.toast(ok ? 'Цели скопированы в буфер обмена (JSON)' : 'Не удалось скопировать в буфер обмена', { type: ok ? 'ok' : 'error' });
      return { ok, keys: r.keys };
    }

    // ---------------------------------------------------------------- import
    async _loadImport(text, source) {
      if (text == null) return { ok: false, cancelled: true };
      const p = parseExport(text);
      if (p.error) { OGX.dom.toast(p.error, { type: 'error', ms: 6000 }); this.log.warn('import: ' + p.error); return { ok: false, error: p.error }; }
      const sum = await summarize(p.file);
      learnCheck('prefs.importSummary', { keys: sum.rows.length, groups: sum.groups.length, count: sum.rows.reduce((n, r) => n + r.count, 0) });
      if (!sum.rows.length) { OGX.dom.toast('В файле нет данных для импорта', { type: 'warn' }); return { ok: false, error: 'empty' }; }
      this.showPreview(p.file, sum, source);
      return { ok: true, keys: sum.rows.length, groups: sum.groups.map((g) => g.id) };
    }
    /** Writes the chosen groups. Replace mode: imported values win and keys of a chosen module group missing in the file are removed. */
    async _applyImport(file, groupIds, mode) {
      const part = filterFile(file, groupIds);
      let removed = 0;
      if (mode === 'replace') {
        for (const g of groupIds) {
          if (!INFINITY_MODULES.includes(g)) continue;       // only module data; core keys are replaced key by key
          const inFile = new Set(Object.keys((part.data && part.data.player) || {}));
          const local = await OGX.storage.keys(g + '.', { scope: 'player' });
          for (const k of local) if (!inFile.has(k)) { await OGX.storage.remove(k, { scope: 'player' }); removed++; }
        }
      }
      const r = await OGX.storage.importAll(part, { mode: mode === 'replace' ? 'replace' : 'merge' });
      await OGX.storage.flush();
      learnValue('prefs.importWritten', r.written, { min: 0, int: true });
      return { ok: true, written: r.written, skipped: r.skipped, removed, mode };
    }

    showPreview(file, sum, source) {
      const ns = OGX.storage.ns || {};
      const host = String(ns.host || location.host).toLowerCase();
      const pid = ns.playerId;
      const warns = [];
      if (file.host && String(file.host).toLowerCase() !== host) warns.push(`Файл с другого сервера: ${file.host} (текущий ${host}).`);
      if (file.playerId != null && pid != null && String(file.playerId) !== String(pid)) warns.push(`Файл другого аккаунта: игрок ${playerText(file.playerId)} (текущий ${playerText(pid)}).`);
      // OgameX Suite (ext 'suite') holds the Infinity modules with the same keys: its files and ours are interchangeable.
      if (file.ext && file.ext !== 'infinity' && file.ext !== 'suite') warns.push(`Файл создан расширением «${file.ext === 'live' ? 'OgameX Live' : file.ext}».`);
      if (warns.length) warns.push('Данные будут записаны в текущий аккаунт на этом сервере.');

      const checks = new Map();
      const defaultOn = (g) => g.id !== 'diag' && g.id !== 'prefill' && g.id !== 'flights';
      const groupRows = sum.groups.map((g) => {
        const cb = h('input', { type: 'checkbox', class: P + 'grp-cb', checked: defaultOn(g), dataset: { group: g.id, ogxAct: 'prefs:import-group' } });
        checks.set(g.id, cb);
        const st = [g.states.new && `новых ${num(g.states.new)}`, g.states.changed && `изменённых ${num(g.states.changed)}`, g.states.same && `без изменений ${num(g.states.same)}`].filter(Boolean).join(', ');
        return h('tr', { class: P + 'grp', dataset: { group: g.id } },
          h('td', null, h('label', null, cb, ' ', g.label)),
          h('td', { class: P + 'r' }, num(g.keys)),
          h('td', { class: P + 'r' }, num(g.count)),
          h('td', { class: P + 'r' }, num(Math.max(1, Math.ceil(g.size / 1024))) + ' КБ'),
          h('td', null, st));
      });
      const keyRows = sum.rows.slice(0, PREVIEW_MAX_ROWS).map((r) => h('tr', { dataset: { key: r.key, state: r.state } },
        h('td', null, r.key), h('td', null, r.scope === 'server' ? 'сервер' : r.scope === 'global' ? 'общие' : 'игрок'),
        h('td', { class: P + 'r' }, num(r.count)), h('td', { class: P + 'r' }, num(r.localCount)),
        h('td', { class: P + 'st-' + r.state }, r.state === 'new' ? 'новый' : r.state === 'same' ? 'без изменений' : 'изменён')));
      const modeMerge = h('input', { type: 'radio', name: P + 'mode', value: 'merge', checked: true, class: P + 'mode', dataset: { ogxAct: 'prefs:import-mode-merge' } });
      const modeReplace = h('input', { type: 'radio', name: P + 'mode', value: 'replace', class: P + 'mode', dataset: { ogxAct: 'prefs:import-mode-replace' } });
      const exported = fin(+file.exportedAt) ? OGX.fmt.dateTime(+file.exportedAt) : '—';
      const body = h('div', { class: P + 'preview' },
        h('div', { class: P + 'src' },
          h('div', null, 'Источник: ', h('b', null, String(file.host || '—')), ', игрок ', h('b', null, playerText(file.playerId)),
            file.kind === 'targets' ? ' · только цели и слежка' : ''),
          h('div', null, 'Создан: ', exported, ' · версия ', String(file.version || '—'), source ? ' · ' + source : '')),
        warns.length ? h('div', { class: ['ogx-banner', P + 'warn'] }, warns.map((w) => h('div', null, w))) : null,
        h('table', { class: ['ogx-table', P + 'groups'] },
          h('thead', null, h('tr', null, h('th', null, 'Раздел'), h('th', null, 'Ключей'), h('th', null, 'Записей'), h('th', null, 'Объём'), h('th', null, 'Состояние'))),
          h('tbody', null, groupRows)),
        h('details', { class: P + 'keys' }, h('summary', null, `Ключи (${num(sum.rows.length)})`),
          h('table', { class: ['ogx-table', P + 'keytable'] },
            h('thead', null, h('tr', null, h('th', null, 'Ключ'), h('th', null, 'Область'), h('th', null, 'В файле'), h('th', null, 'Сейчас'), h('th', null, ''))),
            h('tbody', null, keyRows)),
          sum.rows.length > PREVIEW_MAX_ROWS ? h('div', { class: 'ogx-hint' }, `Показаны первые ${num(PREVIEW_MAX_ROWS)}`) : null),
        h('div', { class: P + 'modes' },
          h('label', null, modeMerge, ' Объединить — новые записи добавляются, при совпадении остаётся более свежая'),
          h('label', null, modeReplace, ' Заменить — данные выбранных разделов заменяются содержимым файла')));
      const result = { done: false };
      OGX.dom.modal({
        title: 'Импорт данных', body, width: 640,
        buttons: [
          { label: 'Отмена', onClick: () => { rec('U', 'import-cancel'); } },
          {
            label: 'Импортировать', primary: true, manual: true,
            onClick: (close) => {
              const groups = [...checks.entries()].filter(([, cb]) => cb.checked).map(([g]) => g);
              const mode = modeReplace.checked ? 'replace' : 'merge';
              if (!groups.length) { OGX.dom.toast('Не выбран ни один раздел', { type: 'warn' }); return false; }
              rec('U', 'import-confirm', { groups, mode });
              const go = async () => {
                if (mode === 'replace' && !(await OGX.dom.confirm('Заменить данные выбранных разделов содержимым файла? Текущие данные этих разделов будут потеряны.', { okLabel: 'Заменить', danger: true }))) return;
                close();
                const r = await this.applyImport(file, groups, mode);
                result.done = true;
                this.lastImport = r;
                const txt = `Импорт завершён: записано ${num(r.written)}, без изменений ${num(r.skipped)}` + (r.removed ? `, удалено ${num(r.removed)}` : '');
                OGX.dom.toast(txt, { type: 'ok', ms: 6000 });
                this.setStatus(txt + '. Перезагрузите страницу.');
                this.showReloadHint(txt);
              };
              OGX.safe(go, 'prefs:import')();
              return false;
            },
          },
        ],
      });
    }
    showReloadHint(txt) {
      const box = this.container && this.container.querySelector('.' + P + 'result');
      if (!box) return;
      box.textContent = '';
      box.appendChild(h('div', null, txt + '. Модули прочитают новые данные после перезагрузки.'));
      box.appendChild(h('button', { type: 'button', class: ['ogx-btn', P + 'reload'], dataset: { ogxAct: 'prefs:reload' }, onClick: () => location.reload() }, 'Перезагрузить страницу'));
      box.hidden = false;
    }

    // ---------------------------------------------------------------- reset
    async _resetNs(ns) {
      await OGX.settings.reset(ns);
      return { ok: true, ns };
    }

    // ---------------------------------------------------------------- tab
    setStatus(t) { try { this.panel.setStatus(t); } catch (e) { /* ignore */ } }

    render(c) {
      this.container = c;
      c.classList.add(P + 'tab');
      c.appendChild(this.renderModules());
      c.appendChild(this.renderBackup());
      c.appendChild(this.renderHotkeys());
      c.appendChild(this.renderForm());
    }

    renderModules() {
      const rows = INFINITY_MODULES.map((m) => {
        const def = OGX.modules[m];
        const on = OGX.settings.get(m + '.enabled') !== false;
        const cb = h('input', { type: 'checkbox', class: P + 'mod-cb', checked: on, disabled: !def, dataset: { mod: m, ogxAct: 'prefs:module-toggle' },
          onChange: (ev) => OGX.safe(async () => {
            const val = ev.target.checked;
            if (!val && m === NAME && !(await OGX.dom.confirm('Выключить модуль настроек? Вкладка «Настройки» и горячие клавиши пропадут; включить снова можно на странице настроек расширения.', { okLabel: 'Выключить', danger: true }))) { ev.target.checked = true; return; }
            rec('U', 'module-toggle', { module: m, on: val });
            await OGX.settings.set(m + '.enabled', val);
            this.setStatus('Изменения вступят в силу после перезагрузки страницы');
            const note = this.container && this.container.querySelector('.' + P + 'reload-note');
            if (note) note.classList.add(P + 'pending');
          }, 'prefs:module-toggle')() });
        return h('label', { class: P + 'mod', dataset: { mod: m }, title: def ? '' : 'Модуль не загружен в этой сборке' },
          cb, ' ', (def && def.title) || MODULE_RU[m] || m, def ? null : h('span', { class: P + 'muted' }, ' (не загружен)'));
      });
      return h('section', { class: P + 'sec', dataset: { sec: 'modules' } },
        h('h3', null, 'Модули'),
        h('div', { class: P + 'mods' }, rows),
        h('div', { class: ['ogx-hint', P + 'reload-note'] }, 'Включение и выключение модулей вступает в силу после перезагрузки страницы. ',
          h('button', { type: 'button', class: ['ogx-btn', P + 'reload'], dataset: { ogxAct: 'prefs:reload' }, onClick: () => location.reload() }, 'Перезагрузить')));
    }

    renderBackup() {
      const paste = h('textarea', { class: P + 'paste', rows: '3', placeholder: 'Вставьте сюда JSON экспорта (например, цели от союзника)' });
      const pasteBtn = h('button', { type: 'button', class: ['ogx-btn', P + 'paste-btn'], dataset: { ogxAct: 'prefs:import-paste' },
        onClick: () => { const t = paste.value.trim(); if (!t) { OGX.dom.toast('Поле пустое', { type: 'warn' }); return; } this.loadImport(t, 'из буфера'); } }, 'Импорт из текста');
      return h('section', { class: P + 'sec', dataset: { sec: 'backup' } },
        h('h3', null, 'Резервная копия и обмен'),
        h('div', { class: 'ogx-hint' }, 'Все данные хранятся только в браузере. Экспорт заменяет PTRE: сохраните файл или передайте цели союзнику.'),
        h('div', { class: P + 'btns' },
          h('button', { type: 'button', class: ['ogx-btn', 'ogx-btn-primary', P + 'export-all'], dataset: { ogxAct: 'prefs:export-all' }, onClick: () => this.exportAll() }, 'Экспорт всего'),
          h('button', { type: 'button', class: ['ogx-btn', P + 'export-targets'], dataset: { ogxAct: 'prefs:export-targets' }, onClick: () => this.exportTargets() }, 'Экспорт целей'),
          h('button', { type: 'button', class: ['ogx-btn', P + 'copy-targets'], dataset: { ogxAct: 'prefs:copy-targets' }, onClick: () => this.copyTargets() }, 'Копировать цели'),
          h('button', { type: 'button', class: ['ogx-btn', P + 'import'], dataset: { ogxAct: 'prefs:import-file' },
            onClick: () => OGX.safe(async () => { const t = await OGX.dom.pickFile({ accept: '.json,application/json' }); if (t != null) await this.loadImport(t, 'файл'); }, 'prefs:pick')() }, 'Импорт из файла…')),
        h('div', { class: P + 'pastebox' }, paste, pasteBtn),
        h('div', { class: ['ogx-banner', P + 'result'], hidden: true }));
    }

    renderHotkeys() {
      const list = h('div', { class: P + 'help' });
      this.helpEl = list;
      this.fillHelp();
      return h('section', { class: P + 'sec', dataset: { sec: 'hotkeys' } },
        h('h3', null, 'Горячие клавиши'),
        list,
        h('div', { class: 'ogx-hint' }, 'Изменить: щёлкните по полю в разделе «Настройки, горячие клавиши, экспорт/импорт» ниже и нажмите сочетание; Esc или Backspace — отключить. ' +
          'Клавиши не срабатывают при вводе текста, в окнах игры и в чате; стрелки на странице «Галактика» всегда остаются за игрой.'));
    }
    fillHelp() {
      const el = this.helpEl;
      if (!el) return;
      el.textContent = '';
      const rows = ACTIONS.map((a) => ({ a, c: norm(this.ctx.settings.get(a.key)) })).filter((x) => x.c);
      if (!rows.length) el.appendChild(h('div', { class: P + 'muted' }, 'Все сочетания отключены'));
      for (const { a, c } of rows) {
        el.appendChild(h('div', { class: P + 'hk', dataset: { action: a.id } }, h('kbd', null, c), ' ', a.label,
          isArrowCombo(c) ? h('span', { class: P + 'muted' }, ' (не действует в «Галактике»)') : null));
      }
      for (const x of this.conflicts || []) {
        el.appendChild(h('div', { class: P + 'conflict' }, `Конфликт: ${x.combo} назначено для «${x.a}» и «${x.b}» — работает только первое`));
      }
    }
    refreshHelp() { OGX.safe(() => this.fillHelp(), 'prefs:help')(); }

    renderForm() {
      const form = OGX.dom.settingsForm(FORM_NS, { onChange: (path, v) => { rec('U', 'setting', { key: path, value: typeof v === 'string' && v.length > 40 ? '(' + v.length + ')' : v }); } });
      form.classList.add(P + 'form');
      for (const fs of form.querySelectorAll('fieldset.ogx-settings-ns')) {
        const ns = fs.dataset.ns;
        const legend = fs.querySelector('legend');
        if (legend) {
          legend.classList.add(P + 'legend');
          legend.title = 'Свернуть / развернуть';
          legend.addEventListener('click', OGX.safe(() => fs.classList.toggle(P + 'collapsed'), 'prefs:collapse'));
        }
        if (ns !== 'core') fs.classList.add(P + 'collapsed');
        fs.appendChild(h('div', { class: P + 'fs-tools' },
          h('button', { type: 'button', class: ['ogx-btn', P + 'reset'], dataset: { ns, ogxAct: 'prefs:reset-ns' },
            onClick: () => OGX.safe(async () => {
              if (!(await OGX.dom.confirm(`Сбросить настройки раздела «${legend ? legend.textContent : ns}» к значениям по умолчанию?`, { okLabel: 'Сбросить', danger: true }))) return;
              await this.resetNs(ns);
              this.tab.refresh();
            }, 'prefs:reset')() }, 'Сбросить раздел')));
      }
      return h('section', { class: P + 'sec', dataset: { sec: 'form' } },
        h('h3', null, 'Все настройки'),
        h('div', { class: 'ogx-hint' }, 'Щёлкните по заголовку раздела, чтобы развернуть его. Изменения сохраняются сразу; включение модулей — после перезагрузки.'),
        form);
    }
  }

  const CSS = `
.${P}tab { display: flex; flex-direction: column; gap: 10px; }
.${P}sec { border: 1px solid var(--ogx-border); border-radius: 4px; padding: 6px 8px; background: var(--ogx-panel); }
.${P}sec h3 { margin: 0 0 6px; font-size: 12px; color: var(--ogx-accent); }
.${P}mods { display: grid; grid-template-columns: 1fr; gap: 3px; }
.${P}mod { cursor: pointer; }
.${P}muted { color: var(--ogx-muted); }
.${P}reload-note { margin-top: 6px; }
.${P}reload-note.${P}pending { color: var(--ogx-warn); }
.${P}btns { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.${P}pastebox { display: flex; gap: 4px; align-items: flex-start; }
.${P}paste { flex: 1; min-height: 34px; resize: vertical; font-size: 10px; }
.${P}result { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.${P}result[hidden] { display: none; }
.${P}help { display: grid; gap: 2px; }
.${P}hk kbd { display: inline-block; min-width: 90px; padding: 0 4px; border: 1px solid var(--ogx-border); border-radius: 3px; background: var(--ogx-bg); font-family: inherit; font-size: 10px; }
.${P}conflict { color: var(--ogx-bad); }
.${P}legend { cursor: pointer; user-select: none; }
.${P}legend::before { content: '▾ '; }
.${P}collapsed > .${P}legend::before { content: '▸ '; }
.${P}collapsed > :not(legend) { display: none !important; }
.${P}fs-tools { margin-top: 4px; text-align: right; }
.${P}preview { display: flex; flex-direction: column; gap: 8px; max-height: 70vh; overflow: auto; }
.${P}warn { color: var(--ogx-warn); border-color: var(--ogx-warn); }
.${P}r { text-align: right; }
.${P}modes { display: flex; flex-direction: column; gap: 3px; }
.${P}st-new { color: var(--ogx-ok); }
.${P}st-changed { color: var(--ogx-warn); }
.${P}st-same { color: var(--ogx-muted); }
.${P}keytable td:first-child { word-break: break-all; }
`;
})(window.OGX);
