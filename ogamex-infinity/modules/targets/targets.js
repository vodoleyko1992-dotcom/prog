/* ogamex-infinity/modules/targets/targets.js — Owner: infinity/targets.
 * Player search, target list, colour marks and notes (DESIGN §4.2.3).
 *   - Marks: 6 colours (setting markColors) + none, per body ("g:s:p:1" planet / "g:s:p:3" moon) and per player. Notes per
 *     body and per player. Stored in `targets.marks` (player scope):
 *       { v: 1, planets: { "<coords>:<1|3>": { color|null, note, playerId, playerName, planetName, addedAt, updatedAt, isTarget, spiedAt? } },
 *               players: { [id]: { color|null, note, name, updatedAt } } }
 *     Empty entries (no colour, no note, not a target) are dropped; at most 5000 bodies (oldest updatedAt dropped first,
 *     targets kept longest). A storage merger for `targets.marks` merges imports entry by entry by `updatedAt`.
 *   - Galaxy (/galaxy): on every `galaxy:render` (core relays the game's own POST /ajax/galaxy after its render) each occupied
 *     row gets one core row slot (OGX.galaxy.rowSlot, appended to #galaxyRowN — galaxy/index.blade.php:319) with a colour dot
 *     (click → colour menu for planet / moon / player), a note icon (click → note editor) and a star «в цели». The row gets
 *     `.ogx-i-targets-mark-<color>` (tinted background), removed on every re-render.
 *   - Highscore (/highscore): a colour dot before the name of marked players: rows `tr#position<playerId>` with
 *     `.highscoreNameHolder .playername` (highscore/players_points.blade.php:68,101). The game replaces `#stat_list_content`
 *     (highscore/index.blade.php:92) on paging, so the dots are re-applied by a debounced observer.
 *   - Tab «Цели» (order 30): table of marked bodies with status, rank (galaxy cache / player index), last spy report (read from
 *     `spy.reports`, loot = OGX.calc.loot 50 % / 75 % Discoverer), last activity (`stalk.log` samples and the galaxy cache),
 *     actions: spy (OGX.api.sendMiniFleet mission 6 → POST /ajax/fleet/dispatch/send-mini-fleet, routes/web.php:126;
 *     the server sends the player's probe setting, fleet.md §5), attack (OGX.fleet.prefill.open, mission 1, never sends),
 *     galaxy (GET /galaxy?galaxy=&system=&position=, GalaxyController::index), remove. Filters by colour and text.
 *   - Tab «Поиск» (order 35): POST /ajax/search {searchtext, category 2|3|4} (routes/web.php:240, SearchController:30-55);
 *     player card from POST /ajax/highscore searchRelId=<id> (routes/web.php:214, HighscoreController:80-85), known planets
 *     from OGX.galaxy.player(id) + planet search results with owner_id (category 3), status/activity from the galaxy cache,
 *     buttons «В цели», «Следить» (emits `targets:track` {playerId, playerName}; stalk handles it), «Открыть в галактике».
 *   - Bus: handles `targets:add` {coords, type, playerName, playerId?, planetName?} (spy module etc.).
 * Writes only `targets.marks` (+ settings). Reads `galaxy.*` (server scope), `spy.reports`, `stalk.log`, `player`, `bodies`.
 * Local helpers (no core API for them): colour menu popup, dynamic colour CSS, marks merger/normaliser.
 *
 * GALAXYZ (ogamex.eu, 2Moons fork; specs/galaxyz/galaxy.md, CORE_API §22):
 *   - galaxy: server-rendered page (`#galaxytableHead tr.row`), rows via OGX.galaxy.onRender / onSystem (boot-time event
 *     replayed); the core row slot sits inside `td.action` (no extra <td>). Own rows (`own: true`) have no player id on the page.
 *     Foreign rows carry ids from Dialog.Playercard/PM/Buddy [INFERRED]; a player without a known id is keyed `n:<name>` and
 *     moved under the numeric id as soon as a galaxy row shows both.
 *   - statistics (page=statistics, name 'highscore') is a full page [UPSTREAM markup]: dots before `a[onclick*=Dialog.Playercard(ID]`.
 *   - search: GET page=search (api.search) [UPSTREAM]; planet hits have no planet id but carry owner id + name; alliances have no id.
 *   - player card: GET page=playerCard (api.highscore searchRelId -> parse.highscorePlayers) [UPSTREAM]; no planet search.
 *   - spy: api.sendMiniFleet (fleetAjax, planetID resolved from the galaxy page / cache, never a galaxy view); unresolved ->
 *     the core's message + suggestion, nothing sent. Opening another system in the galaxy costs deuterium (said in the tooltips).
 */
(function (OGX) {
  'use strict';

  const NAME = 'targets';
  const P = 'ogx-i-targets-';
  const PANEL_ID = 'infinity';
  const KEY = 'marks';
  const CAP = 5000;
  const NOTE_MAX = 2000;

  const DEFAULT_COLORS = [
    { id: 'red', label: 'красный', color: '#e53935' },
    { id: 'orange', label: 'оранжевый', color: '#fb8c00' },
    { id: 'yellow', label: 'жёлтый', color: '#fdd835' },
    { id: 'green', label: 'зелёный', color: '#43a047' },
    { id: 'blue', label: 'голубой', color: '#29b6f6' },
    { id: 'purple', label: 'фиолетовый', color: '#ab47bc' },
  ];
  const STATUS_RU = { A: 'администратор', b: 'заблокирован', v: 'режим отпуска', I: 'неактивен 28+ дней', i: 'неактивен 7+ дней', n: 'новичок (слабый)', s: 'сильный игрок' };
  const SEARCH_CATS = [{ id: 2, label: 'Игроки' }, { id: 3, label: 'Планеты' }, { id: 4, label: 'Альянсы' }];

  OGX.module({
    name: NAME,
    title: 'Цели, метки и поиск',
    pages: '*',
    settings: {
      markColors: { type: 'json', default: DEFAULT_COLORS, label: 'Цвета меток (JSON: id, label, color)', hint: 'Шесть цветов: id латиницей, подпись и цвет #rrggbb' },
      showRowTools: { type: 'bool', default: true, label: 'Метки, заметки и «в цели» в строках галактики' },
      tintRows: { type: 'bool', default: true, label: 'Подсвечивать строки галактики цветом метки' },
    },
    async init(ctx) {
      const t = new Targets(ctx);
      ctx._targets = t;
      await t.start();
    },
    dispose(ctx) {
      if (ctx._targets) ctx._targets.dispose();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);
  const now = () => OGX.time.serverNow();
  const num = (n) => (fin(n) ? OGX.fmt.num(Math.floor(n)) : '—');
  const rec = (src, what, data) => { try { OGX.log.rec(src, NAME, what, data); } catch (e) { /* journal off */ } };
  const learnValue = (name, v, o) => { try { return OGX.learn ? OGX.learn.value(name, v, o) : true; } catch (e) { return true; } };
  const learnCheck = (name, o) => { try { return OGX.learn ? OGX.learn.check(name, o) : true; } catch (e) { return true; } };
  const normType = (t) => (t === 3 || t === '3' || t === 'moon' || t === 'm' ? 3 : 1);
  /** 'g:s:p' from a string ("[1:45:6]", "1:45:6") or an array [g, s, p]. */
  function normCoords(c) {
    if (Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every((x) => Number.isFinite(+x) && +x > 0)) return c.slice(0, 3).map((x) => +x).join(':');
    if (c && typeof c === 'object' && c.galaxy) return [c.galaxy, c.system, c.position].join(':');
    return typeof c === 'string' || typeof c === 'number' ? OGX.util.coords(String(c)) : null;
  }
  const pkey = (coords, type) => coords + ':' + normType(type);
  function parsePkey(k) {
    const m = /^(\d+):(\d+):(\d+):([13])$/.exec(String(k));
    return m ? { coords: `${m[1]}:${m[2]}:${m[3]}`, type: +m[4], g: +m[1], s: +m[2], p: +m[3] } : null;
  }
  const safeId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  function hexToRgba(hex, a) {
    let x = String(hex || '').replace('#', '');
    if (x.length === 3) x = x.split('').map((c) => c + c).join('');
    const n = parseInt(x.slice(0, 6), 16);
    if (!Number.isFinite(n)) return `rgba(128,128,128,${a})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function coordsKeySort(c) {
    const a = OGX.util.coordsArr(c) || [0, 0, 0];
    return a.map((n) => String(n).padStart(3, '0')).join(':');
  }
  function agoText(t) { return fin(t) ? OGX.fmt.ago(t) : '—'; }
  const isGz = () => { try { return !!(OGX.page.isGz && OGX.page.isGz()); } catch (e) { return false; } };
  /** Player key of module data: the numeric id when known, else 'n:<name>' (GALAXYZ rows/cards without an id). */
  function playerKey(id, name) {
    if (fin(+id) && +id > 0) return String(+id);
    const n = name ? String(name).trim().slice(0, 80) : '';
    return n ? 'n:' + n : null;
  }
  const validPlayerKey = (k) => (/^\d+$/.test(String(k)) && +k > 0) || /^n:\S/.test(String(k));
  const keyName = (k) => (/^n:/.test(String(k)) ? String(k).slice(2) : null);
  /** Tooltip suffix for links that open another galaxy system. */
  const GZ_COST = ' (на этом сервере просмотр чужой системы стоит дейтерий)';
  const galaxyTitle = (t) => t + (isGz() ? GZ_COST : '');

  // ------------------------------------------------------------------ data model
  function emptyData() { return { v: 1, planets: {}, players: {} }; }
  function cleanPlanet(e) {
    if (!e || typeof e !== 'object') return null;
    const o = {
      color: e.color ? safeId(e.color) || null : null,
      note: typeof e.note === 'string' ? e.note.slice(0, NOTE_MAX) : '',
      playerId: fin(+e.playerId) && +e.playerId > 0 ? +e.playerId : null,
      playerName: e.playerName ? String(e.playerName).slice(0, 80) : null,
      planetName: e.planetName ? String(e.planetName).slice(0, 80) : null,
      addedAt: fin(+e.addedAt) ? +e.addedAt : null,
      updatedAt: fin(+e.updatedAt) ? +e.updatedAt : 0,
      isTarget: !!e.isTarget,
    };
    if (fin(+e.spiedAt)) o.spiedAt = +e.spiedAt;
    return o;
  }
  function cleanPlayer(e) {
    if (!e || typeof e !== 'object') return null;
    return {
      color: e.color ? safeId(e.color) || null : null,
      note: typeof e.note === 'string' ? e.note.slice(0, NOTE_MAX) : '',
      name: e.name ? String(e.name).slice(0, 80) : null,
      updatedAt: fin(+e.updatedAt) ? +e.updatedAt : 0,
    };
  }
  /** Any stored value (older versions, imports) -> current schema. */
  function normalize(raw) {
    const out = emptyData();
    if (!raw || typeof raw !== 'object') return out;
    // v0 (no version): { "<coords>": {...} } flat map of planets
    const planets = raw.v ? raw.planets : (raw.planets || raw);
    for (const [k, e] of Object.entries(planets || {})) {
      let key = parsePkey(k) ? k : (normCoords(k) ? pkey(normCoords(k), e && e.type) : null);
      if (!key) continue;
      const c = cleanPlanet(e);
      if (c) out.planets[key] = c;
    }
    for (const [id, e] of Object.entries((raw.v && raw.players) || {})) {
      if (!validPlayerKey(id)) continue;
      const c = cleanPlayer(e);
      if (c) out.players[/^n:/.test(id) ? id : String(+id)] = c;
    }
    return out;
  }
  const isEmptyPlanet = (e) => !e.color && !e.note && !e.isTarget;
  const isEmptyPlayer = (e) => !e.color && !e.note;
  function prune(d) {
    for (const [k, e] of Object.entries(d.planets)) if (isEmptyPlanet(e)) delete d.planets[k];
    for (const [k, e] of Object.entries(d.players)) if (isEmptyPlayer(e)) delete d.players[k];
    const keys = Object.keys(d.planets);
    if (keys.length > CAP) {
      keys.sort((a, b) => (d.planets[b].isTarget - d.planets[a].isTarget) || (d.planets[b].updatedAt - d.planets[a].updatedAt));
      for (const k of keys.slice(CAP)) delete d.planets[k];
    }
    return d;
  }
  /** Storage merger: entry-wise, the newer updatedAt wins (ties: the imported one). */
  function mergeMarks(oldV, impV) {
    const a = normalize(oldV), b = normalize(impV);
    const out = emptyData();
    for (const part of ['planets', 'players']) {
      const keys = new Set([...Object.keys(a[part]), ...Object.keys(b[part])]);
      for (const k of keys) {
        const x = a[part][k], y = b[part][k];
        out[part][k] = !x ? y : !y ? x : ((y.updatedAt || 0) >= (x.updatedAt || 0) ? y : x);
      }
    }
    return prune(out);
  }
  let mergerRegistered = false;

  // ------------------------------------------------------------------ module
  class Targets {
    constructor(ctx) {
      this.ctx = ctx;
      this.log = ctx.log;
      this.data = emptyData();
      this.lastSys = null;
      this.offs = [];
      this.menu = null;
      this.filter = { color: 'all', text: '' };
      this.search = { term: '', cat: 2, results: null, error: null, busy: false };
      this.card = null;          // { id, name, loading, hs, planets: [...], error }
      this.planetHits = {};      // owner_id -> [coords] from planet searches of this page
      this.colorStyle = null;

      // Every add-on action is a timed B event (OGX.log.wrap).
      this.setBodyColor = OGX.log.wrap(NAME, this._setBodyColor.bind(this), 'setBodyColor');
      this.setPlayerColor = OGX.log.wrap(NAME, this._setPlayerColor.bind(this), 'setPlayerColor');
      this.saveNotes = OGX.log.wrap(NAME, this._saveNotes.bind(this), 'saveNotes');
      this.toggleTarget = OGX.log.wrap(NAME, this._toggleTarget.bind(this), 'toggleTarget');
      this.addTargets = OGX.log.wrap(NAME, this._addTargets.bind(this), 'addTargets');
      this.removeBody = OGX.log.wrap(NAME, this._removeBody.bind(this), 'removeBody');
      this.spy = OGX.log.wrap(NAME, this._spy.bind(this), 'spy');
      this.attack = OGX.log.wrap(NAME, this._attack.bind(this), 'attack');
      this.doSearch = OGX.log.wrap(NAME, this._doSearch.bind(this), 'search');
      this.loadCard = OGX.log.wrap(NAME, this._loadCard.bind(this), 'playerCard');
      this.renderRows = OGX.log.wrap(NAME, this._renderRows.bind(this), 'galaxyRows');
      this.applyHighscore = OGX.log.wrap(NAME, this._applyHighscore.bind(this), 'highscoreDots');
    }

    async start() {
      const ctx = this.ctx;
      ctx.css(CSS);
      if (!mergerRegistered) { OGX.storage.registerMerger(NAME + '.' + KEY, mergeMarks); mergerRegistered = true; }
      this.data = normalize(await ctx.store.get(KEY, null));
      this.updateColorCss();

      // other tabs / imports (local writes already refresh through mutate)
      this.offs.push(ctx.store.subscribe(KEY, (v, info) => {
        if (info && info.remote === false && this.writing) return;
        const nd = normalize(v);
        if (JSON.stringify(nd) === JSON.stringify(this.data)) return;
        this.data = nd;
        this.changed(false);
      }));
      this.offs.push(ctx.settings.onChange((key) => {
        if (key.endsWith('markColors')) this.updateColorCss();
        this.changed(false);
      }));
      this.offs.push(OGX.bus.on('targets:add', (p) => this.onAddEvent(p)));

      // side panel tabs (get-or-create, independent of the panel module's init order)
      this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
      this.tabTargets = this.panel.addTab({ id: 'targets', label: 'Цели', order: 30, render: (c) => this.renderTargetsTab(c) });
      this.tabSearch = this.panel.addTab({ id: 'search', label: 'Поиск', order: 35, render: (c) => this.renderSearchTab(c) });
      this.updateBadge();

      ctx.on(document, 'mousedown', (ev) => { if (this.menu && !this.menu.contains(ev.target)) this.closeMenu(); }, true);
      ctx.on(document, 'keydown', (ev) => { if (ev.key === 'Escape' && this.menu) this.closeMenu(); });

      if (OGX.page.is('galaxy')) this.initGalaxy();
      if (OGX.page.is('highscore')) this.initHighscore();
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* ignore */ } }
      this.offs = [];
      this.closeMenu();
    }

    // ---------------------------------------------------------------- colours
    colors() {
      let list = null;
      try { list = this.ctx.settings.get('markColors'); } catch (e) { list = null; }
      const out = [];
      if (Array.isArray(list)) {
        for (const c of list) {
          const id = c && safeId(c.id);
          if (!id || out.some((x) => x.id === id)) continue;
          const color = /^#[0-9a-f]{3,8}$/i.test(String(c.color || '')) ? c.color : '#888888';
          out.push({ id, label: String(c.label || id).slice(0, 30), color });
        }
      }
      if (!out.length) {
        if (list !== null && list !== undefined) this.log.warn('markColors invalid, using defaults');
        return DEFAULT_COLORS.slice();
      }
      return out.slice(0, 12);
    }
    colorOf(id) { return id ? this.colors().find((c) => c.id === id) || null : null; }
    updateColorCss() {
      const css = this.colors().map((c) => [
        `#galaxyContent .galaxyRow.${P}mark-${c.id} { background-color: ${hexToRgba(c.color, 0.22)} !important; box-shadow: inset 3px 0 0 ${c.color}; }`,
        // GALAXYZ: tr.row of #galaxytableHead (cells paint their own background, so the tint goes on the cells)
        `#galaxytableHead > tbody > tr.row.${P}mark-${c.id} > td { background-color: ${hexToRgba(c.color, 0.22)} !important; }`,
        `#galaxytableHead > tbody > tr.row.${P}mark-${c.id} > td:first-child { box-shadow: inset 3px 0 0 ${c.color}; }`,
        `.${P}c-${c.id} { background: ${c.color} !important; border-color: ${c.color} !important; }`,
        `.${P}tr-${c.id} > td:first-child { box-shadow: inset 3px 0 0 ${c.color}; }`,
      ].join('\n')).join('\n');
      if (!this.colorStyle || !this.colorStyle.isConnected) this.colorStyle = OGX.dom.injectStyle('ogx-i-targets-colors', css);
      this.colorStyle.textContent = css;
    }

    // ---------------------------------------------------------------- data mutation
    async mutate(fn, what) {
      this.writing = (this.writing || 0) + 1;
      let res;
      try {
        res = await this.ctx.store.update(KEY, (old) => {
          const d = normalize(old);
          fn(d);
          return prune(d);
        }, null);
      } finally {
        this.writing--;
      }
      this.data = normalize(res);
      rec('B', 'marks:' + what, { planets: Object.keys(this.data.planets).length, players: Object.keys(this.data.players).length });
      this.changed(true);
      return this.data;
    }
    ensurePlanet(d, key, meta = {}) {
      const t = now();
      const e = d.planets[key] || { color: null, note: '', playerId: null, playerName: null, planetName: null, addedAt: t, updatedAt: t, isTarget: false };
      if (meta.playerId && +meta.playerId > 0) e.playerId = +meta.playerId;
      if (meta.playerName) e.playerName = String(meta.playerName).slice(0, 80);
      if (meta.planetName) e.planetName = String(meta.planetName).slice(0, 80);
      e.updatedAt = t;
      d.planets[key] = e;
      return e;
    }
    ensurePlayer(d, id, name) {
      const e = d.players[String(id)] || { color: null, note: '', name: null, updatedAt: 0 };
      if (name) e.name = String(name).slice(0, 80);
      e.updatedAt = now();
      d.players[String(id)] = e;
      return e;
    }
    _setBodyColor(key, color, meta) {
      return this.mutate((d) => { this.ensurePlanet(d, key, meta).color = color || null; }, 'color');
    }
    /** id: numeric id or a player key ('n:<name>'). */
    _setPlayerColor(id, color, name) {
      const k = playerKey(/^n:/.test(String(id)) ? null : id, keyName(id) || name);
      if (!k) return Promise.resolve(this.data);
      return this.mutate((d) => { this.ensurePlayer(d, k, name).color = color || null; }, 'playerColor');
    }
    _saveNotes({ key, note, meta, playerId, playerNote, playerName }) {
      return this.mutate((d) => {
        if (key) this.ensurePlanet(d, key, meta).note = String(note || '').slice(0, NOTE_MAX);
        const pk = playerId ? playerKey(/^n:/.test(String(playerId)) ? null : playerId, keyName(playerId) || playerName) : null;
        if (pk && playerNote !== undefined) this.ensurePlayer(d, pk, playerName).note = String(playerNote || '').slice(0, NOTE_MAX);
      }, 'notes');
    }
    _toggleTarget(key, meta, value) {
      return this.mutate((d) => {
        const e = this.ensurePlanet(d, key, meta);
        e.isTarget = value === undefined ? !e.isTarget : !!value;
      }, 'target');
    }
    /** list: [{ coords, type, playerId, playerName, planetName }] -> all become targets. */
    _addTargets(list) {
      const items = (list || []).map((x) => ({ x, c: normCoords(x.coords) })).filter((o) => o.c);
      if (!items.length) return Promise.resolve(0);
      return this.mutate((d) => {
        for (const { x, c } of items) this.ensurePlanet(d, pkey(c, x.type), x).isTarget = true;
      }, 'addTargets').then(() => items.length);
    }
    _removeBody(key) {
      return this.mutate((d) => { delete d.planets[key]; }, 'remove');
    }
    changed(local) {
      this.updateBadge();
      OGX.safe(() => this.refreshGalaxy(), 'targets:refreshGalaxy')();
      if (OGX.page.is('highscore')) OGX.safe(() => this.applyHighscore(), 'targets:hs')();
      if (this.tabTargets) this.tabTargets.refresh();
      if (this.cardEl && this.cardEl.isConnected) this.renderCard(this.cardEl);
      if (!local) this.closeMenu();
    }
    updateBadge() {
      if (!this.tabTargets) return;
      const n = Object.values(this.data.planets).filter((e) => e.isTarget).length;
      this.tabTargets.setBadge(n ? String(n) : null);
    }

    onAddEvent(p) {
      if (!p) return;
      const c = normCoords(p.coords);
      if (!c) { this.log.warn('targets:add without coords', p); learnValue('targets.add.coords', NaN); return; }
      rec('B', 'event:targets:add', { coords: c, type: normType(p.type) });
      this.addTargets([{ coords: c, type: p.type, playerId: p.playerId, playerName: p.playerName || p.player, planetName: p.planetName || p.name }])
        .then(() => OGX.dom.toast(`${OGX.fmt.coords(c, normType(p.type))} добавлена в цели`, { type: 'ok' }));
    }

    // ---------------------------------------------------------------- colour menu (local widget)
    closeMenu() {
      if (this.menu) { this.menu.remove(); this.menu = null; }
    }
    /** sections: [{ label, current, onPick(colorId|null), act }] */
    openMenu(anchor, sections) {
      this.closeMenu();
      const colors = this.colors();
      const menu = h('div', { class: ['ogx-root', P + 'menu'], role: 'menu' },
        sections.map((s) => h('div', { class: P + 'menu-sec' },
          h('div', { class: P + 'menu-label' }, s.label),
          h('div', { class: P + 'menu-row' },
            colors.map((c) => h('button', {
              type: 'button', class: [P + 'sw', P + 'c-' + c.id, s.current === c.id ? P + 'sw-on' : null], title: c.label,
              dataset: { color: c.id, ogxAct: `targets:${s.act}:${c.id}` },
              onClick: () => { this.closeMenu(); rec('U', s.act, { color: c.id }); s.onPick(c.id); },
            })),
            h('button', {
              type: 'button', class: [P + 'sw', P + 'sw-none', !s.current ? P + 'sw-on' : null], title: 'без метки',
              dataset: { color: '', ogxAct: `targets:${s.act}:none` },
              onClick: () => { this.closeMenu(); rec('U', s.act, { color: null }); s.onPick(null); },
            }, '×')))));
      OGX.dom.root().appendChild(menu);
      const r = anchor.getBoundingClientRect();
      const mw = 220;
      menu.style.left = Math.max(4, Math.min(window.innerWidth - mw - 4, r.left)) + 'px';
      menu.style.top = Math.max(4, Math.min(window.innerHeight - 40 - 46 * sections.length, r.bottom + 4)) + 'px';
      this.menu = menu;
      return menu;
    }

    /** Note editor modal for a body and/or its player. */
    openNoteEditor({ key, meta = {}, playerId, playerName }) {
      const bk = key ? parsePkey(key) : null;
      const pe = key ? this.data.planets[key] : null;
      const pk = playerId ? playerKey(/^n:/.test(String(playerId)) ? null : playerId, keyName(playerId) || playerName) : null;
      const pl = pk ? this.data.players[pk] : null;
      const taBody = key ? h('textarea', { class: P + 'note-body', maxlength: String(NOTE_MAX), rows: '4', placeholder: 'Заметка о планете…' }) : null;
      if (taBody) taBody.value = (pe && pe.note) || '';
      const taPlayer = pk ? h('textarea', { class: P + 'note-player', maxlength: String(NOTE_MAX), rows: '3', placeholder: 'Заметка об игроке…' }) : null;
      if (taPlayer) taPlayer.value = (pl && pl.note) || '';
      const body = h('div', { class: P + 'note-form' },
        bk ? h('label', null, (bk.type === 3 ? 'Луна ' : 'Планета ') + OGX.fmt.coords(bk.coords, bk.type) + (meta.planetName ? ' «' + meta.planetName + '»' : '')) : null,
        taBody,
        taPlayer ? h('label', null, 'Игрок ' + (playerName || keyName(pk) || '#' + playerId)) : null,
        taPlayer);
      OGX.dom.modal({
        title: 'Заметки', body, width: 440,
        buttons: [
          { label: 'Отмена' },
          {
            label: 'Сохранить', primary: true, onClick: () => {
              rec('U', 'note:save', { key, playerId: pk, len: (taBody ? taBody.value.length : 0) + (taPlayer ? taPlayer.value.length : 0) });
              this.saveNotes({ key, note: taBody ? taBody.value : undefined, meta, playerId: taPlayer ? pk : null, playerNote: taPlayer ? taPlayer.value : undefined, playerName })
                .then(() => OGX.dom.toast('Заметка сохранена', { type: 'ok', ms: 1500 }));
            },
          },
        ],
      });
      // focus the first field unless the user (or a test driver) already focused one of them
      setTimeout(() => { try { if (!body.contains(document.activeElement)) (taBody || taPlayer).focus(); } catch (e) { /* ignore */ } }, 30);
    }

    // ---------------------------------------------------------------- galaxy integration
    initGalaxy() {
      // galaxy.onSystem / onRender replay the event the core emitted at boot (GALAXYZ: before the modules start)
      this.offs.push(OGX.galaxy.onSystem((ev) => { if (ev && ev.source === 'page' && ev.system) this.lastSys = ev.system; }));
      this.offs.push(OGX.galaxy.onRender((ev) => this.renderRows(ev)));
      if (!isGz()) {
        // OgameX: a render that finished before our init: use the cached system (no request).
        const cur = OGX.galaxy.current();
        const rendered = OGX.dom.$('#galaxyContent .galaxyRow .cellPlanet .microplanet');
        if (cur && rendered && !OGX.galaxy.last('render')) this.refreshGalaxy();
      }
    }
    rowsMap() { return OGX.galaxy.rows(); }
    refreshGalaxy() {
      if (!OGX.page.is('galaxy')) return;
      const sys = this.lastSys;
      const cur = OGX.galaxy.current();
      if (sys && (!cur || (cur.galaxy === sys.galaxy && cur.system === sys.system))) return this.renderRows({ galaxy: sys.galaxy, system: sys.system, rows: this.rowsMap() });
      if (cur) return this.renderRows({ galaxy: cur.galaxy, system: cur.system, rows: this.rowsMap() });
      return null;
    }
    async _renderRows(ev) {
      if (!ev || !ev.rows) return 0;
      let sys = this.lastSys && this.lastSys.galaxy === +ev.galaxy && this.lastSys.system === +ev.system ? this.lastSys : null;
      if (!sys) sys = await OGX.galaxy.cached(+ev.galaxy, +ev.system);
      const showTools = this.ctx.settings.get('showRowTools') !== false;
      const tint = this.ctx.settings.get('tintRows') !== false;
      const me = await this.me();
      const moves = [];
      let n = 0;
      for (const [pos, row] of ev.rows) {
        for (const c of Array.from(row.classList)) if (c.startsWith(P + 'mark-')) row.classList.remove(c);
        const p = sys && sys.positions.find((x) => x.position === pos);
        // GALAXYZ: the slot is inside td.action (not a direct child of the row)
        const slot = row.querySelector('.ogx-gx-slot[data-owner="targets"]');
        const own = !!(p && this.isOwn(p, me));
        const uKey = p ? playerKey(p.playerId, p.playerName) : null;
        if (!p || p.destroyed || (!uKey && !own)) { if (slot) slot.remove(); continue; }
        if (p.playerId) learnValue('targets.galaxy.playerId', +p.playerId, { min: 1, int: true });
        // a player marked by name before its id was known: move the entry under the id
        if (+p.playerId > 0 && p.playerName && this.data.players['n:' + p.playerName] && !this.data.players[String(+p.playerId)]) moves.push([String(+p.playerId), 'n:' + p.playerName]);
        const keyP = pkey(p.coords, 1), keyM = p.moon ? pkey(p.coords, 3) : null;
        const eP = this.data.planets[keyP], eM = keyM ? this.data.planets[keyM] : null;
        const eU = own ? null : this.playerEntry(p.playerId, p.playerName);
        const color = (eP && eP.color) || (eM && eM.color) || (eU && eU.color) || null;
        if (tint && color && this.colorOf(color)) row.classList.add(P + 'mark-' + color);
        if (!showTools) { if (slot) slot.remove(); continue; }
        const el = OGX.galaxy.rowSlot(row, 'targets');
        el.textContent = '';
        el.classList.add(P + 'slot');
        el.appendChild(this.rowTools(p, { own, eP, eM, eU, uKey }));
        n++;
      }
      rec('B', 'galaxy:rows', { g: +ev.galaxy, s: +ev.system, slots: n, cached: !!sys });
      if (moves.length) {
        this.mutate((d) => {
          for (const [id, nk] of moves) if (d.players[nk] && !d.players[id]) { d.players[id] = d.players[nk]; delete d.players[nk]; }
          for (const e of Object.values(d.planets)) {
            const mv = moves.find(([, nk]) => !e.playerId && e.playerName && nk === 'n:' + e.playerName);
            if (mv) e.playerId = +mv[0];
          }
        }, 'playerId').catch((e) => this.log.warn('player key move failed', e && e.message));
      }
      return n;
    }
    /** Entry of a player: by id, else by name ('n:<name>'). */
    playerEntry(id, name) {
      const k = playerKey(id, name);
      return (k && this.data.players[k]) || (name && this.data.players['n:' + name]) || null;
    }
    /** { id, name } of the user: OgameX meta / numeric id; GALAXYZ name (id only after page=tournament). */
    async me() {
      let id = null, name = null;
      try { const s = OGX.state.snapshot(); if (s && s.metas && +s.metas.playerId) id = +s.metas.playerId; if (s && s.player) { id = id || +s.player.id || null; name = s.player.name || null; } } catch (e) { /* no snapshot */ }
      try { const pl = await OGX.state.player(); if (pl) { id = id || +pl.id || null; name = name || pl.name || null; } } catch (e) { /* not stored */ }
      if (!id && OGX.storage.ns && +OGX.storage.ns.playerId) id = +OGX.storage.ns.playerId;
      return { id, name };
    }
    isOwn(p, me) { return OGX.galaxy.isOwnRow(p, me); }
    rowTools(p, { own, eP, eM, eU, uKey }) {
      const meta = { playerId: p.playerId, playerName: p.playerName, planetName: p.planetName };
      const keyP = pkey(p.coords, 1), keyM = p.moon ? pkey(p.coords, 3) : null;
      const color = (eP && eP.color) || (eM && eM.color) || null;
      const pcolor = eU && eU.color;
      const notes = [eP && eP.note ? 'Планета: ' + eP.note : null, eM && eM.note ? 'Луна: ' + eM.note : null, eU && eU.note ? 'Игрок: ' + eU.note : null].filter(Boolean);
      const isTarget = !!((eP && eP.isTarget) || (eM && eM.isTarget));
      const dot = h('button', {
        type: 'button', class: [P + 'dot', color ? P + 'c-' + color : null, pcolor ? P + 'ring' : null], dataset: { ogxAct: 'targets:galaxy-color', pos: p.position },
        title: 'Метка' + (color ? ': ' + (this.colorOf(color) || {}).label : '') + (pcolor ? ' · игрок: ' + (this.colorOf(pcolor) || {}).label : ''),
        style: pcolor && this.colorOf(pcolor) ? { outlineColor: this.colorOf(pcolor).color } : null,
        onClick: (ev) => {
          ev.preventDefault();
          const secs = [{ label: 'Планета ' + OGX.fmt.coords(p.coords), current: eP && eP.color, act: 'color-planet', onPick: (c) => this.setBodyColor(keyP, c, meta) }];
          if (keyM) secs.push({ label: 'Луна ' + OGX.fmt.coords(p.coords, 3), current: eM && eM.color, act: 'color-moon', onPick: (c) => this.setBodyColor(keyM, c, Object.assign({}, meta, { planetName: p.moon.name })) });
          if (!own && uKey) secs.push({ label: 'Игрок ' + (p.playerName || ''), current: eU && eU.color, act: 'color-player', onPick: (c) => this.setPlayerColor(uKey, c, p.playerName) });
          this.openMenu(dot, secs);
        },
      });
      const note = h('button', {
        type: 'button', class: [P + 'note', notes.length ? P + 'has-note' : null], dataset: { ogxAct: 'targets:galaxy-note', pos: p.position },
        title: notes.length ? notes.join('\n') : 'Добавить заметку',
        onClick: (ev) => { ev.preventDefault(); this.openNoteEditor({ key: keyP, meta, playerId: own ? null : uKey, playerName: p.playerName }); },
      }, OGX.dom.icon('note'));
      const parts = [dot, note];
      if (!own) {
        parts.push(h('button', {
          type: 'button', class: [P + 'star', isTarget ? P + 'star-on' : null], dataset: { ogxAct: 'targets:galaxy-star', pos: p.position },
          title: isTarget ? 'В целях — убрать из целей' : 'Добавить в цели',
          onClick: (ev) => {
            ev.preventDefault();
            rec('U', 'galaxy-star', { coords: p.coords, on: !isTarget });
            this.toggleTarget(keyP, meta, !isTarget).then(() => OGX.dom.toast(isTarget ? `${OGX.fmt.coords(p.coords)} убрана из целей` : `${OGX.fmt.coords(p.coords)} добавлена в цели`, { type: 'ok', ms: 1500 }));
          },
        }, OGX.dom.icon('star')));
      }
      return h('span', { class: P + 'tools' }, parts);
    }

    // ---------------------------------------------------------------- highscore
    initHighscore() {
      this.applyHighscore();
      if (isGz()) return;   // page=statistics is a full page: paging reloads it (no observer needed)
      const host = OGX.dom.$('#stat_list_content') || OGX.dom.$('#ranks');
      if (host) this.offs.push(OGX.dom.observe(host, () => {
        // skip mutations caused by our own dots
        if (OGX.dom.$$('#ranks > tbody > tr[id^="position"]').some((tr) => !tr.dataset.ogxT)) this.applyHighscore();
      }, { debounce: 150 }));
    }
    /** Rows of the ranking on this page: [{ tr, id, name, holder }] (OgameX #ranks, GALAXYZ statistics links [UPSTREAM]). */
    highscoreRows() {
      const out = [];
      if (isGz()) {
        // player ranking only (who=1); the alliance ranking has alliance links instead of Dialog.Playercard
        const who = OGX.dom.$('select[name="who"]');
        if (who && String(who.value) !== '1') return out;
        for (const a of OGX.dom.$$('#content a[onclick*="Dialog.Playercard("]')) {
          const m = /Dialog\.Playercard\(\s*(\d+)/.exec(a.getAttribute('onclick') || '');
          const tr = a.closest('tr');
          if (!tr) continue;
          out.push({ tr, id: m ? +m[1] : null, name: a.textContent.trim() || null, holder: a });
        }
        return out;
      }
      if (!document.querySelector('#ranks.userHighscore, #ranks:not(.allyHighscore)') || document.querySelector('#ranks.allyHighscore')) return out;
      for (const tr of OGX.dom.$$('#ranks > tbody > tr[id^="position"]')) {
        const id = parseInt(tr.id.slice(8), 10);
        const name = tr.querySelector('.highscoreNameHolder .playername') || tr.querySelector('.playername');
        out.push({ tr, id, name: name ? name.textContent.trim() : null, holder: name ? name.closest('a') || name : null });
      }
      return out;
    }
    _applyHighscore() {
      const rows = this.highscoreRows();
      if (!rows.length) return 0;
      const byPlayer = {};
      for (const e of Object.values(this.data.planets)) {
        if (!e.color) continue;
        const k = playerKey(e.playerId, e.playerName);
        if (k && !byPlayer[k]) byPlayer[k] = e.color;
        if (e.playerName && !byPlayer['n:' + e.playerName]) byPlayer['n:' + e.playerName] = e.color;
      }
      let n = 0;
      for (const { tr, id, name, holder } of rows) {
        tr.dataset.ogxT = '1';
        for (const d of Array.from(tr.querySelectorAll('.' + P + 'hsdot'))) d.remove();
        if (!(id > 0) && !name) { learnValue('targets.hs.playerId', id, { min: 1, int: true }); continue; }
        const u = this.playerEntry(id, name);
        const color = (u && u.color) || byPlayer[playerKey(id, name)] || (name && byPlayer['n:' + name]) || null;
        const c = this.colorOf(color);
        const targets = Object.values(this.data.planets).filter((e) => e.isTarget && ((id > 0 && e.playerId === id) || (name && e.playerName === name))).length;
        if (!c && !targets && !(u && u.note)) continue;
        if (!holder || !holder.parentNode) continue;
        const dot = h('span', {
          class: [P + 'hsdot', c ? P + 'c-' + c.id : P + 'hsdot-plain'], dataset: { color: c ? c.id : '' },
          title: [c ? 'Метка: ' + c.label : null, targets ? 'Целей: ' + targets : null, u && u.note ? 'Заметка: ' + u.note : null].filter(Boolean).join('\n'),
        }, targets ? '★' : '');
        holder.parentNode.insertBefore(dot, holder);
        n++;
      }
      return n;
    }

    // ---------------------------------------------------------------- tab «Цели»
    renderTargetsTab(container) {
      const colors = this.colors();
      const sel = h('select', { class: [P + 'f-color', P + 'sel'], dataset: { ogxAct: 'targets:filter-color' }, title: 'Фильтр по цвету',
        onChange: () => { this.filter.color = sel.value; rec('U', 'filter-color', { v: sel.value }); this.fillTable(); } },
      h('option', { value: 'all' }, 'Все отмеченные'),
      h('option', { value: 'target' }, 'Только цели ★'),
      colors.map((c) => h('option', { value: c.id }, c.label)),
      h('option', { value: 'none' }, 'Без цвета'));
      sel.value = this.filter.color;
      if (sel.value !== this.filter.color) { this.filter.color = 'all'; sel.value = 'all'; }
      const txt = h('input', { type: 'search', class: P + 'f-text', placeholder: 'Координаты, игрок, заметка…', value: this.filter.text, dataset: { ogxAct: 'targets:filter-text' },
        onInput: OGX.util.debounce(() => { this.filter.text = txt.value; this.fillTable(); }, 200) });
      this.countEl = h('span', { class: P + 'count' });
      this.tableHost = h('div', { class: P + 'table-host' }, h('div', { class: P + 'muted' }, 'Загрузка…'));
      container.appendChild(h('div', { class: P + 'tab' },
        h('div', { class: P + 'bar' }, sel, txt, this.countEl),
        this.tableHost,
        h('div', { class: P + 'hint' }, 'Метки ставятся в галактике (точка, заметка, ★), из поиска и из шпионских докладов. «Шпионить» отправляет зонды (сколько задано в настройках игры), «Атака» только открывает отправку флота.')));
      this.fillTable();
    }

    async collectRows() {
      const [spy, stalk, players, player] = await Promise.all([
        OGX.storage.get('spy.reports', null), OGX.storage.get('stalk.log', null),
        OGX.storage.get('galaxy.players', {}, { scope: 'server' }), OGX.state.player(),
      ]);
      const attackerClass = (player && player.playerClass) || 'none';
      // last spy report per body key
      const spyBy = {};
      for (const r of Object.values((spy && spy.items) || {})) {
        if (!r) continue;
        const ap = r.attackParams || {};
        const c = normCoords(ap.galaxy ? ap : null) || normCoords(r.target && (r.target.coordsStr || r.target.coords)) || normCoords(r.coords);
        if (!c) continue;
        const k = pkey(c, ap.type || (r.target && (r.target.planetType || r.target.type)) || r.type);
        const t = fin(+r.ts) ? +r.ts : fin(+r.fetchedAt) ? +r.fetchedAt : null;
        if (!spyBy[k] || (t || 0) > (spyBy[k].t || 0)) spyBy[k] = { t, r };
      }
      const systems = new Map();
      const rows = [];
      for (const [key, e] of Object.entries(this.data.planets)) {
        const pk = parsePkey(key);
        if (!pk) continue;
        const sk = pk.g + ':' + pk.s;
        if (!systems.has(sk)) systems.set(sk, await OGX.galaxy.cached(pk.g, pk.s));
        const sys = systems.get(sk);
        const pos = sys && sys.positions.find((x) => x.position === pk.p);
        const pidx = players ? ((e.playerId && players[e.playerId]) || (e.playerName && players['n:' + e.playerName]) || (pos && pos.playerId && players[pos.playerId]) || null) : null;
        const row = {
          key, coords: pk.coords, type: pk.type, e, sortCoords: coordsKeySort(pk.coords) + ':' + pk.type,
          playerId: e.playerId || (pos && pos.playerId) || null,
          playerName: e.playerName || (pos && pos.playerName) || (pidx && pidx.name) || null,
          planetName: pk.type === 3 ? ((pos && pos.moon && pos.moon.name) || 'Луна') : (e.planetName || (pos && pos.planetName) || null),
          status: (pos && pos.status) || (pidx && pidx.status) || '',
          rank: (pos && pos.rank) || (pidx && pidx.rank) || null,
          color: null, ownColor: e.color, note: e.note || '', playerNote: '',
          spy: null, act: null,
        };
        if (pos && e.playerId && pos.playerId && +pos.playerId !== +e.playerId) row.ownerChanged = pos.playerName || true;
        else if (pos && !e.playerId && e.playerName && pos.playerName && pos.playerName !== e.playerName) row.ownerChanged = pos.playerName;
        row.playerKey = playerKey(row.playerId, row.playerName);
        const u = this.playerEntry(row.playerId, row.playerName);
        row.color = e.color || (u && u.color) || null;
        row.playerNote = (u && u.note) || '';
        // last spy report
        const s = spyBy[key];
        if (s && s.r.resources) {
          const res = { metal: +s.r.resources.metal || 0, crystal: +s.r.resources.crystal || 0, deuterium: +s.r.resources.deuterium || 0 };
          const loot = OGX.calc.loot(res, { attackerClass });
          learnCheck('targets.spyLoot', { metal: loot.metal, crystal: loot.crystal, deuterium: loot.deuterium, total: loot.total });
          row.spy = { t: s.t, loot, res, id: s.r.id };
        }
        // last activity: stalk samples and the galaxy cache
        const acts = [];
        if (pos && sys && fin(sys.t)) {
          const a = pk.type === 3 ? (pos.moon ? pos.moon.activity : null) : pos.activity;
          if (a === '*') acts.push({ t: sys.t, v: '*', at: sys.t, src: 'галактика' });
          else if (fin(+a) && a !== null) acts.push({ t: sys.t - a * 60000, v: +a, at: sys.t, src: 'галактика' });
          else acts.push({ t: null, v: null, at: sys.t, src: 'галактика' });
        }
        const samples = (stalk && stalk.items && ((row.playerId && stalk.items[row.playerId]) || (row.playerName && stalk.items['n:' + row.playerName]))) || [];
        for (const smp of Array.isArray(samples) ? samples : []) {
          if (!smp || smp.self || normCoords(smp.coords) !== pk.coords || (smp.body === 'm' ? 3 : 1) !== pk.type) continue;
          const seen = fin(+smp.lastSeen) && smp.lastSeen !== null ? +smp.lastSeen : null;
          acts.push({ t: seen, v: smp.activity, at: +smp.t, src: 'слежка' });
        }
        if (acts.length) {
          const seen = acts.filter((a) => fin(a.t)).sort((a, b) => b.t - a.t)[0];
          const latest = acts.slice().sort((a, b) => (b.at || 0) - (a.at || 0))[0];
          row.act = { lastSeen: seen ? seen.t : null, v: seen ? seen.v : null, checkedAt: latest.at, src: (seen || latest).src };
        }
        rows.push(row);
      }
      return rows;
    }

    async fillTable() {
      const host = this.tableHost;
      if (!host || !host.isConnected) return;
      const token = (this.fillToken = (this.fillToken || 0) + 1);
      let rows;
      try {
        rows = await this.collectRows();
      } catch (e) {
        this.log.error('targets table', e);
        host.textContent = '';
        host.appendChild(h('div', { class: P + 'error' }, 'Не удалось собрать таблицу целей: ' + (e.message || e)));
        return;
      }
      if (token !== this.fillToken || !host.isConnected) return;
      const total = rows.length;
      const f = this.filter;
      const q = String(f.text || '').trim().toLowerCase();
      rows = rows.filter((r) => {
        if (f.color === 'target' && !r.e.isTarget) return false;
        if (f.color === 'none' && r.ownColor) return false;
        if (f.color !== 'all' && f.color !== 'target' && f.color !== 'none' && r.color !== f.color) return false;
        if (q) {
          const hay = [r.coords, OGX.fmt.coords(r.coords, r.type), r.playerName, r.planetName, r.note, r.playerNote].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      if (this.countEl) this.countEl.textContent = rows.length === total ? `${total} ${OGX.fmt.plural(total, ['запись', 'записи', 'записей'])}` : `${rows.length} из ${total}`;
      const table = OGX.dom.table({
        className: P + 'table',
        rowKey: 'key',
        sortKey: 'coords', sortDir: 'asc',
        emptyText: total ? 'Ничего не найдено' : 'Целей пока нет. Отметьте планету в галактике или найдите игрока во вкладке «Поиск».',
        columns: [
          { key: 'coords', label: 'Коорд.', value: (r) => r.sortCoords, defaultDir: 'asc', render: (r) => this.coordsCell(r) },
          { key: 'player', label: 'Игрок', value: (r) => (r.playerName || '').toLowerCase() || null, defaultDir: 'asc', render: (r) => this.playerCell(r) },
          { key: 'status', label: 'Ст.', title: 'Статус игрока', value: (r) => r.status || null, render: (r) => this.statusCell(r.status) },
          { key: 'rank', label: 'Место', value: (r) => r.rank, defaultDir: 'asc', align: 'right', render: (r) => (fin(r.rank) ? num(r.rank) : '—') },
          { key: 'mark', label: 'Метка', value: (r) => (r.e.isTarget ? 'a' : 'b') + (r.color || 'z'), render: (r) => this.markCell(r) },
          { key: 'note', label: 'Заметка', sortable: false, render: (r) => this.noteCell(r) },
          { key: 'spy', label: 'Шпионаж', title: 'Последний шпионский доклад: возраст и добыча', value: (r) => (r.spy ? r.spy.t : null), render: (r) => this.spyCell(r) },
          { key: 'act', label: 'Активность', title: 'Последняя замеченная активность', value: (r) => (r.act ? r.act.lastSeen : null), render: (r) => this.actCell(r) },
          { key: 'actions', label: '', sortable: false, render: (r) => this.actionsCell(r) },
        ],
        rows,
      });
      if (this.tableSort) table.sortBy(this.tableSort.key, this.tableSort.dir);
      table.el.addEventListener('click', () => { this.tableSort = table.sort; });
      host.textContent = '';
      host.appendChild(table.el);
      // colour rows by mark
      for (const tr of Array.from(table.el.querySelectorAll('tbody tr[data-key]'))) {
        const r = rows.find((x) => x.key === tr.dataset.key);
        if (r && r.color && this.colorOf(r.color)) tr.classList.add(P + 'tr-' + r.color);
      }
    }
    coordsCell(r) {
      return h('a', {
        class: P + 'coords', href: OGX.page.url('/galaxy', { galaxy: r.coords.split(':')[0], system: r.coords.split(':')[1], position: r.coords.split(':')[2] }),
        title: galaxyTitle((r.planetName ? r.planetName + ' — ' : '') + 'открыть в галактике'), dataset: { ogxAct: 'targets:row-coords' },
      }, OGX.fmt.coords(r.coords, r.type));
    }
    playerCell(r) {
      if (!r.playerName && !r.playerId) return '—';
      const parts = [h('a', {
        href: '#', class: P + 'plink', dataset: { ogxAct: 'targets:row-player' }, title: 'Карточка игрока',
        onClick: (ev) => { ev.preventDefault(); this.openCard(r.playerId, r.playerName); },
      }, r.playerName || '#' + r.playerId)];
      if (r.ownerChanged) parts.push(h('span', { class: P + 'warn', title: 'В кэше галактики у этой позиции другой владелец: ' + (r.ownerChanged === true ? '?' : r.ownerChanged) }, ' ⚠'));
      return h('span', null, parts);
    }
    statusCell(s) {
      if (!s) return h('span', { class: P + 'muted' }, '—');
      return h('span', { class: P + 'status', title: s.split('').map((c) => c + ' — ' + (STATUS_RU[c] || c)).join('\n') }, s);
    }
    markCell(r) {
      const dot = h('button', {
        type: 'button', class: [P + 'dot', r.ownColor ? P + 'c-' + r.ownColor : null], dataset: { ogxAct: 'targets:row-color' },
        title: r.ownColor ? 'Метка: ' + (this.colorOf(r.ownColor) || {}).label : 'Поставить метку',
        onClick: () => {
          const meta = { playerId: r.playerId, playerName: r.playerName };
          const secs = [{ label: (r.type === 3 ? 'Луна ' : 'Планета ') + OGX.fmt.coords(r.coords, r.type), current: r.ownColor, act: 'color-planet', onPick: (c) => this.setBodyColor(r.key, c, meta) }];
          if (r.playerKey) secs.push({ label: 'Игрок ' + (r.playerName || '#' + r.playerId), current: (this.playerEntry(r.playerId, r.playerName) || {}).color, act: 'color-player', onPick: (c) => this.setPlayerColor(r.playerKey, c, r.playerName) });
          this.openMenu(dot, secs);
        },
      });
      const star = h('button', {
        type: 'button', class: [P + 'star', r.e.isTarget ? P + 'star-on' : null], dataset: { ogxAct: 'targets:row-star' },
        title: r.e.isTarget ? 'Цель — убрать отметку' : 'Сделать целью',
        onClick: () => this.toggleTarget(r.key, {}, !r.e.isTarget),
      }, OGX.dom.icon('star'));
      return h('span', { class: P + 'markcell' }, dot, star);
    }
    noteCell(r) {
      const text = [r.note, r.playerNote ? 'Игрок: ' + r.playerNote : ''].filter(Boolean).join(' · ');
      return h('button', {
        type: 'button', class: [P + 'notecell', text ? null : P + 'muted'], dataset: { ogxAct: 'targets:row-note' }, title: text || 'Добавить заметку',
        onClick: () => this.openNoteEditor({ key: r.key, meta: { playerId: r.playerId, playerName: r.playerName }, playerId: r.playerKey, playerName: r.playerName }),
      }, text ? (text.length > 40 ? text.slice(0, 39) + '…' : text) : '+');
    }
    spyCell(r) {
      const sent = r.e.spiedAt ? 'Зонды отправлены ' + OGX.fmt.dateTime(r.e.spiedAt) : null;
      if (!r.spy) return h('span', { class: P + 'muted', title: sent || 'Доклада нет' }, sent ? 'зонды ' + agoText(r.e.spiedAt) : '—');
      const L = r.spy.loot;
      const pct = Math.round(((L.total || 0) / Math.max(1, r.spy.res.metal + r.spy.res.crystal + r.spy.res.deuterium)) * 100);
      return h('span', {
        class: P + 'spy', dataset: { loot: String(Math.floor(L.total || 0)) },
        title: [`Доклад ${fin(r.spy.t) ? OGX.fmt.dateTime(r.spy.t) : ''}`, `Ресурсы: ${OGX.fmt.res(r.spy.res)}`, `Добыча ${pct}%: ${OGX.fmt.res(L)}`, sent].filter(Boolean).join('\n'),
      }, h('span', { class: P + 'age' }, agoText(r.spy.t)), ' · ', h('b', { class: P + 'loot' }, num(L.total)));
    }
    actCell(r) {
      const a = r.act;
      if (!a) return h('span', { class: P + 'muted', title: 'Нет данных: откройте систему в галактике или включите слежку' }, '—');
      const title = `Источник: ${a.src}` + (fin(a.checkedAt) ? `\nПроверено ${OGX.fmt.dateTime(a.checkedAt)}` : '') + (fin(a.lastSeen) ? `\nАктивность ≈ ${OGX.fmt.dateTime(a.lastSeen)}` : '');
      if (!fin(a.lastSeen)) return h('span', { class: P + 'muted', title }, '> 60 мин (' + agoText(a.checkedAt) + ')');
      const fresh = now() - a.lastSeen < 15 * 60000;
      return h('span', { class: [P + 'act', fresh ? P + 'act-on' : null], title }, (a.v === '*' ? '* ' : '') + agoText(a.lastSeen));
    }
    actionsCell(r) {
      const [g, s, p] = r.coords.split(':').map(Number);
      const spyBtn = h('button', {
        type: 'button', class: ['ogx-btn', 'ogx-btn-icon', P + 'a-spy'], dataset: { ogxAct: 'targets:spy' }, title: 'Шпионить (в GALAXYZ число зондов задаётся в настройках игры, нужно «Зондов на шпионаж» из настроек дополнения)',
        onClick: async () => {
          spyBtn.disabled = true;
          try { await this.spy(r); } finally { spyBtn.disabled = false; }
        },
      }, OGX.dom.icon('spy'));
      return h('span', { class: P + 'actions' },
        spyBtn,
        h('button', { type: 'button', class: ['ogx-btn', 'ogx-btn-icon', P + 'a-attack'], dataset: { ogxAct: 'targets:attack' }, title: 'Атака: открыть отправку флота с этой целью', onClick: () => this.attack(r) }, OGX.dom.icon('send')),
        h('button', {
          type: 'button', class: ['ogx-btn', 'ogx-btn-icon', P + 'a-galaxy'], dataset: { ogxAct: 'targets:galaxy' }, title: galaxyTitle('Открыть в галактике'),
          onClick: () => { rec('U', 'open-galaxy', { coords: r.coords }); OGX.page.go('/galaxy', { galaxy: g, system: s, position: p }); },
        }, OGX.dom.icon('eye')),
        h('button', {
          type: 'button', class: ['ogx-btn', 'ogx-btn-icon', P + 'a-remove'], dataset: { ogxAct: 'targets:remove' }, title: 'Удалить из списка',
          onClick: async () => {
            const ok = await OGX.dom.confirm(`Удалить ${OGX.fmt.coords(r.coords, r.type)} вместе с меткой и заметкой?`, { okLabel: 'Удалить', danger: true });
            if (ok) await this.removeBody(r.key);
          },
        }, OGX.dom.icon('trash')));
    }

    async _spy(r) {
      const [galaxy, system, position] = r.coords.split(':').map(Number);
      const res = await OGX.api.sendMiniFleet({ mission: 6, galaxy, system, position, type: r.type, shipCount: OGX.api.spyProbes() });
      const where = OGX.fmt.coords(r.coords, r.type);
      if (res && res.success) {
        if (fin(res.shipsSent)) learnValue('targets.spy.shipsSent', +res.shipsSent, { min: 1, int: true });
        const n = fin(res.shipsSent) && res.shipsSent > 0 ? `: ${num(res.shipsSent)} шт.` : '';
        const o = res.origin && !res.origin.current && res.origin.coords ? res.origin : null;
        OGX.dom.toast(`Зонды отправлены на ${where}${n}` + (o ? ` с ${o.name ? o.name + ' ' : ''}[${o.coords}]` : '') + (res.mismatch ? ` — сервер назвал другие координаты (${res.targetCoords}): данные галактики устарели` : ''),
          { type: res.mismatch ? 'warn' : 'ok', ms: res.mismatch ? 8000 : 3000 });
        await this.mutate((d) => { const e = d.planets[r.key]; if (e) { e.spiedAt = now(); e.updatedAt = now(); } }, 'spied');
      } else if (res && res.unresolved) {
        // GALAXYZ: the target's planet id is unknown (no galaxy view of that system yet): nothing was sent
        this.showUnresolved(r, res);
      } else {
        OGX.dom.toast(`Шпионаж не отправлен: ${(res && res.message) || 'ошибка сервера'} (${where})`, { type: 'error', ms: 6000 });
      }
      return res;
    }
    showUnresolved(r, res) {
      const [g, s] = r.coords.split(':');
      const body = h('div', { class: P + 'unresolved' },
        h('p', null, res.message || 'Идентификатор цели неизвестен.'),
        res.suggestion ? h('p', { class: P + 'muted' }, res.suggestion) : null,
        h('p', null, h('a', { href: res.galaxyUrl || OGX.page.url('/galaxy', { galaxy: g, system: s }), class: P + 'gal-link', dataset: { ogxAct: 'targets:unresolved-galaxy' } },
          `Открыть систему [${g}:${s}] в галактике`), isGz() ? h('span', { class: P + 'muted' }, ' — стоит дейтерий') : null));
      OGX.dom.modal({ title: 'Шпионаж не отправлен', body, width: 420, buttons: [{ label: 'Закрыть', primary: true }] });
    }

    async _attack(r) {
      const [galaxy, system, position] = r.coords.split(':').map(Number);
      const cur = OGX.state.current();
      let ships = {};
      let note = 'атака ' + OGX.fmt.coords(r.coords, r.type);
      if (r.spy && r.spy.loot && r.spy.loot.total > 0) {
        // Battle Transporters (217) for the loot of the last report (+10 % reserve), limited to what the current body has.
        // Aeternum: raids go only with 217 (user decision 2026-10-31); its cargo comes from the catalog/Storage expert.
        const RS = 217;
        let cap = 0;
        try { const st = await OGX.state.shipStats(); cap = st && st[RS] ? +st[RS].cargo : 0; } catch (e) { cap = 0; }
        if (!(cap > 0) && !isGz()) {
          // OgameX fallback (GALAXYZ: shipStats includes the Storage expert officer, the only correct source)
          const [research, player] = await Promise.all([OGX.state.research(), OGX.state.player()]);
          cap = OGX.calc.cargoCapacity(RS, research.levels || {}, (player && player.playerClass) || 'none');
        }
        if (cap > 0) {
          // GALAXYZ: the 2Moons calculateSteal fill order (metal <= 1/3 of the cargo, crystal <= 1/2 of the rest, ...) needs more
          // room than the loot sum: core calc.lootCapacity, the same cargo the Spy tab's «Трюмы» uses. OgameX: the sum.
          const need = isGz() ? OGX.calc.lootCapacity(r.spy.loot) : r.spy.loot.total;
          const want = Math.ceil((need * 1.1) / cap);
          let n = want;
          learnValue('targets.attack.lc', n, { min: 0, int: true });
          const body = cur ? await OGX.state.body(cur.key) : null;
          const have = body && body.ships && fin(+body.ships[RS]) ? +body.ships[RS] : null;
          if (have !== null) n = Math.min(n, have);
          if (n > 0) { ships = { [RS]: n }; note += ` · ${num(n)} ${OGX.catalog.shortName(RS)} под добычу ${num(r.spy.loot.total)}`; }
          if (have !== null && have < want) note += ` · не хватает ${num(want - have)} ${OGX.catalog.shortName(RS)}`;
        }
      }
      await OGX.fleet.prefill.open({ originId: cur ? cur.id : undefined, target: { galaxy, system, position, type: r.type }, mission: 1, ships, speed: 10, source: NAME, note });
      return { ok: true, ships };
    }

    // ---------------------------------------------------------------- tab «Поиск»
    renderSearchTab(container) {
      const st = this.search;
      const cats = SEARCH_CATS.concat(isGz() ? [{ id: 5, label: 'Тег альянса' }] : []);
      const input = h('input', { type: 'search', class: P + 'q', placeholder: 'Имя игрока, планеты или альянса', value: st.term, maxlength: '60' });
      const cat = h('select', { class: [P + 'cat', P + 'sel'], dataset: { ogxAct: 'targets:search-cat' } }, cats.map((c) => h('option', { value: String(c.id) }, c.label)));
      cat.value = String(st.cat);
      const submit = () => {
        rec('U', 'search', { cat: +cat.value, len: input.value.length });
        this.doSearch(input.value, +cat.value);
      };
      const form = h('form', { class: P + 'sform', onSubmit: (ev) => { ev.preventDefault(); submit(); } },
        input, cat, h('button', { type: 'submit', class: ['ogx-btn', 'ogx-btn-primary', P + 'go'], dataset: { ogxAct: 'targets:search' } }, 'Найти'));
      this.resultsEl = h('div', { class: P + 'results' });
      this.cardEl = h('div', { class: P + 'card-host' });
      container.appendChild(h('div', { class: P + 'tab' }, form, this.resultsEl, this.cardEl,
        isGz() ? h('div', { class: P + 'hint' }, 'Поиск и карточка игрока — страницы игры (без затрат дейтерия). Их разметка на этом сервере не проверена: если что-то не распознано, будет показана ошибка.') : null));
      this.renderResults();
      this.renderCard(this.cardEl);
    }

    async _doSearch(term, cat) {
      const st = this.search;
      st.term = String(term || '').trim();
      st.cat = [2, 3, 4].includes(+cat) || (+cat === 5 && isGz()) ? +cat : 2;
      st.busy = true; st.error = null; st.results = null;
      this.renderResults();
      const r = await OGX.api.search(st.term, st.cat);
      st.busy = false;
      if (!r || (r.error && r.status !== 'error')) {
        st.error = 'Ошибка запроса поиска' + (r && r.status ? ' (HTTP ' + r.status + ')' : '');
      } else if (r.status !== 'success') {
        st.error = /no search term/i.test(r.message || '') || !st.term ? 'Введите текст для поиска' : 'Сервер: ' + (r.message || 'ошибка');
      } else if (!Array.isArray(r.results)) {
        st.error = 'Неожиданный ответ сервера';
        learnValue('targets.search.results', NaN);
      } else {
        st.results = r.results.slice(0, 50);
        st.unverified = !!r.unverified;
        for (const x of st.results) {
          if (x.id !== null && x.id !== undefined) learnValue('targets.search.id', +x.id, { min: 1, int: true });
          if (x.type === 'planet' && +x.owner_id > 0) {
            const c = normCoords(x.coordinates);
            if (!c) { learnValue('targets.search.coords', NaN); continue; }
            const list = (this.planetHits[x.owner_id] = this.planetHits[x.owner_id] || []);
            if (!list.includes(c)) list.push(c);
          }
        }
        if (st.cat === 3) {
          // owner names: GALAXYZ results carry them; OgameX from the player index (no extra requests)
          const idx = (await OGX.storage.get('galaxy.players', {}, { scope: 'server' })) || {};
          for (const x of st.results) x._ownerName = x.owner_name || (x.owner_id && idx[x.owner_id] ? idx[x.owner_id].name : null);
        }
      }
      this.renderResults();
      return { ok: !st.error, n: st.results ? st.results.length : 0 };
    }

    renderResults() {
      const host = this.resultsEl;
      if (!host || !host.isConnected) return;
      const st = this.search;
      host.textContent = '';
      if (st.busy) { host.appendChild(h('div', { class: P + 'muted' }, 'Поиск…')); return; }
      if (st.error) { host.appendChild(h('div', { class: P + 'error' }, st.error)); return; }
      if (!st.results) return;
      if (!st.results.length) { host.appendChild(h('div', { class: P + 'muted' }, 'Ничего не найдено')); return; }
      const list = h('div', { class: P + 'rlist' });
      for (const x of st.results) {
        if (x.type === 'player' || (!x.type && st.cat === 2)) {
          const home = normCoords(x.coordinates);
          list.appendChild(h('div', { class: [P + 'ritem', P + 'rplayer'], dataset: { id: x.id } },
            h('a', { href: '#', class: P + 'rname', dataset: { ogxAct: 'targets:result-player' }, title: 'Карточка игрока',
              onClick: (ev) => { ev.preventDefault(); this.openCard(x.id, x.name); } }, x.name || '#' + x.id),
            this.playerDot(x.id, x.name),
            home ? h('span', { class: P + 'muted', title: (x.planetName ? x.planetName + ' — ' : '') + 'главная планета' }, ' ' + OGX.fmt.coords(home)) : null,
            fin(+x.rank) && x.rank !== null ? h('span', { class: P + 'muted' }, ' · место ' + num(+x.rank)) : null,
            h('span', { class: P + 'rbtns' },
              h('button', { type: 'button', class: 'ogx-btn', dataset: { ogxAct: 'targets:result-card' }, onClick: () => this.openCard(x.id, x.name) }, 'Карточка'))));
        } else if (x.type === 'planet' || (!x.type && st.cat === 3)) {
          const c = normCoords(x.coordinates);
          const [g, s, p] = c ? c.split(':') : [];
          const owner = x._ownerName || x.owner_name || null;
          list.appendChild(h('div', { class: [P + 'ritem', P + 'rplanet'], dataset: { id: x.id === null ? '' : x.id } },
            c ? h('a', { class: P + 'coords', href: OGX.page.url('/galaxy', { galaxy: g, system: s, position: p }), title: galaxyTitle('Открыть в галактике'), dataset: { ogxAct: 'targets:result-coords' } }, OGX.fmt.coords(c)) : '?',
            ' ',
            isGz() && x.name ? h('span', { class: P + 'rpname' }, x.name + ' · ') : null,
            h('a', { href: '#', class: P + 'rname', dataset: { ogxAct: 'targets:result-owner' }, title: 'Карточка владельца',
              onClick: (ev) => { ev.preventDefault(); this.openCard(x.owner_id, owner); } }, owner || 'игрок #' + x.owner_id),
            h('span', { class: P + 'rbtns' },
              c ? h('button', {
                type: 'button', class: 'ogx-btn', dataset: { ogxAct: 'targets:result-add' },
                onClick: () => this.addTargets([{ coords: c, type: 1, playerId: x.owner_id, playerName: owner, planetName: isGz() ? x.name : undefined }]).then(() => OGX.dom.toast(`${OGX.fmt.coords(c)} добавлена в цели`, { type: 'ok' })),
              }, 'В цели') : null)));
        } else {
          const members = fin(+x.member_count) ? +x.member_count : fin(+x.members) && x.members !== null ? +x.members : null;
          const parts = [];
          if (members !== null) parts.push(`${num(members)} ${OGX.fmt.plural(members, ['участник', 'участника', 'участников'])}`);
          if (x.rank !== undefined && x.rank !== null) parts.push('место ' + (x.rank === '?' ? '?' : num(+x.rank)));
          if (fin(+x.points) && x.points !== null) parts.push(`${num(+x.points)} очк.`);
          if (x.is_open !== undefined) parts.push(x.is_open ? 'набор открыт' : 'набор закрыт');
          const hasId = fin(+x.id) && +x.id > 0;
          list.appendChild(h('div', { class: [P + 'ritem', P + 'rally'], dataset: { id: hasId ? x.id : '' } },
            h('b', null, '[' + (x.tag || '') + '] '), h('span', null, x.name || ''),
            parts.length ? h('span', { class: P + 'muted' }, ' · ' + parts.join(' · ')) : null,
            h('span', { class: P + 'rbtns' },
              hasId ? h('a', { class: 'ogx-btn', href: OGX.page.url('/alliance/info/' + (+x.id)), target: '_blank', rel: 'noopener', dataset: { ogxAct: 'targets:result-ally' } }, 'Страница')
                : h('span', { class: P + 'muted', title: 'Результат поиска на этом сервере не содержит id альянса — страницу альянса откройте из галактики или рейтинга' }, 'нет ссылки'))));
          if (x.points !== undefined && x.points !== null) learnValue('targets.search.allyPoints', +x.points, { min: 0 });
        }
      }
      host.appendChild(list);
    }
    playerDot(id, name) {
      const u = this.playerEntry(id, name);
      const c = u && this.colorOf(u.color);
      return c ? h('span', { class: [P + 'hsdot', P + 'c-' + c.id], title: 'Метка: ' + c.label }) : null;
    }

    /** Player card by id; without an id (GALAXYZ name-only entries) the id is looked up by an exact player search. */
    openCard(id, name) {
      if (!(+id > 0) && !name) return;
      rec('U', 'open-card', { id: +id || null });
      this.panel.open();
      if (this.panel.currentTab() !== 'search') this.panel.selectTab('search');
      this.loadCard(+id > 0 ? +id : null, name || null);
    }

    async _loadCard(id, name) {
      const card = this.card = { id, name: name || null, loading: true, error: null, hs: null, planets: [], entry: null };
      if (this.cardEl && this.cardEl.isConnected) this.renderCard(this.cardEl);
      if (!id && name) {
        const sr = await OGX.api.search(name, 2);
        const hit = sr && Array.isArray(sr.results) ? sr.results.find((x) => x && x.name && x.name.toLowerCase() === String(name).toLowerCase() && +x.id > 0) : null;
        if (hit) card.id = id = +hit.id;
        else card.error = 'Id игрока неизвестен' + (sr && sr.message ? ' (поиск: ' + sr.message + ')' : '');
      }
      // 1) rank, points, home coordinates, alliance: OgameX highscore page of this player, GALAXYZ page=playerCard [UPSTREAM]
      if (id) {
        const html = await OGX.api.highscore({ category: 1, type: 0, searchRelId: id });
        if (typeof html === 'string') {
          const hs = OGX.parse.highscorePlayers(html);
          const row = (hs.rows || []).find((r) => r.id === id) || null;
          if (row) {
            if (fin(row.points)) learnValue('targets.card.points', +row.points, { min: 0 });
            if (fin(row.rank)) learnValue('targets.card.rank', +row.rank, { min: 1, int: true });
            card.hs = row;
            card.name = card.name || row.name;
          } else if ((hs.rows || []).length) {
            card.hsMissing = true;
          } else {
            learnValue('targets.card.hsRows', 0, { min: 1 });
            if (hs.error) card.error = 'Карточка игрока не распознана: ' + hs.error;
          }
          if ((hs.rows || []).length) await OGX.galaxy.indexHighscore(hs);
        } else {
          card.error = (isGz() ? 'Карточка игрока недоступна' : 'Рейтинг недоступен') + (html && html.status ? ' (HTTP ' + html.status + ')' : '');
        }
      }
      // 2) planets from the player index (galaxy views) + planet search hits (owner_id)
      const entry = await OGX.galaxy.player(id || card.name);
      card.entry = entry;
      if (!card.name && entry) card.name = entry.name;
      if (card.name && id && !isGz()) {
        // OgameX: planet names often carry the player name. GALAXYZ: a planet-name search by the player's name finds nothing useful.
        const r3 = await OGX.api.search(card.name, 3);
        if (r3 && r3.status === 'success' && Array.isArray(r3.results)) {
          for (const x of r3.results) {
            if (+x.owner_id !== id) continue;
            const c = normCoords(x.coordinates);
            if (!c) continue;
            const list = (this.planetHits[id] = this.planetHits[id] || []);
            if (!list.includes(c)) list.push(c);
          }
        }
      }
      const byCoords = new Map();
      const add = (coords, src, extra) => {
        const c = normCoords(coords);
        if (!c) return;
        const o = byCoords.get(c) || { coords: c, src: [], moonId: null, planetId: null };
        if (!o.src.includes(src)) o.src.push(src);
        Object.assign(o, extra || {});
        byCoords.set(c, o);
      };
      for (const p of (entry && entry.planets) || []) add(p.coords, 'галактика', { planetId: p.planetId, moonId: p.moonId });
      for (const c of (id && this.planetHits[id]) || []) add(c, 'поиск');
      if (card.hs && card.hs.homeCoords) add(card.hs.homeCoords, isGz() ? 'карточка' : 'рейтинг');
      // activity / names from the galaxy cache
      for (const o of byCoords.values()) {
        const [g, s, p] = o.coords.split(':').map(Number);
        const sys = await OGX.galaxy.cached(g, s);
        const pos = sys && sys.positions.find((x) => x.position === p);
        const same = pos && ((id && +pos.playerId === id) || (!pos.playerId && card.name && pos.playerName === card.name));
        if (same) {
          o.planetName = pos.planetName; o.activity = pos.activity; o.checkedAt = sys.t;
          o.moon = pos.moon ? { name: pos.moon.name, activity: pos.moon.activity } : null;
          if (!card.status) card.status = pos.status;
        } else if (pos && (pos.playerId || pos.playerName)) {
          o.otherOwner = pos.playerName || '?';
        }
      }
      card.planets = Array.from(byCoords.values()).sort((a, b) => coordsKeySort(a.coords).localeCompare(coordsKeySort(b.coords)));
      if (!card.status && entry) card.status = entry.status || '';
      card.loading = false;
      if (this.card === card && this.cardEl && this.cardEl.isConnected) this.renderCard(this.cardEl);
      return { ok: !card.error, planets: card.planets.length };
    }

    renderCard(host) {
      host.textContent = '';
      const c = this.card;
      if (!c) return;
      if (c.loading) { host.appendChild(h('div', { class: [P + 'card', P + 'muted'] }, 'Загрузка карточки ' + (c.name || '#' + c.id) + '…')); return; }
      const uKey = playerKey(c.id, c.name);
      const u = this.playerEntry(c.id, c.name) || {};
      const hs = c.hs;
      const ally = hs && hs.allianceTag ? hs.allianceTag : (c.entry && c.entry.allianceTag) || (hs && hs.allianceName) || (c.entry && c.entry.allianceName) || null;
      const dot = h('button', {
        type: 'button', class: [P + 'dot', u.color ? P + 'c-' + u.color : null], dataset: { ogxAct: 'targets:card-color' }, title: 'Метка игрока',
        onClick: () => this.openMenu(dot, [{ label: 'Игрок ' + (c.name || ''), current: u.color, act: 'color-player', onPick: (col) => this.setPlayerColor(uKey, col, c.name) }]),
      });
      const planets = c.planets.filter((p) => !p.otherOwner);
      const home = (hs && hs.homeCoords) || (planets[0] && planets[0].coords) || null;
      const kv = (k, v) => h('div', { class: P + 'kv' }, h('span', { class: P + 'k' }, k + ':'), ' ', h('span', { class: P + 'v' }, v));
      const ptable = h('table', { class: ['ogx-table', P + 'ptable'] },
        h('thead', null, h('tr', null, h('th', null, 'Коорд.'), h('th', null, 'Планета'), h('th', null, 'Активность'), h('th', null, 'Откуда'), h('th', null, ''))),
        h('tbody', null, c.planets.length ? c.planets.map((p) => {
          const key = pkey(p.coords, 1);
          const e = this.data.planets[key];
          const [g, s, pp] = p.coords.split(':');
          const actTxt = p.otherOwner ? 'сейчас у ' + p.otherOwner : p.activity === '*' ? '* (< 15 мин)' : fin(p.activity) ? p.activity + ' мин' : p.checkedAt ? '> 60 мин' : '—';
          return h('tr', { dataset: { coords: p.coords } },
            h('td', null, h('a', { href: OGX.page.url('/galaxy', { galaxy: g, system: s, position: pp }), title: galaxyTitle('Открыть в галактике'), dataset: { ogxAct: 'targets:card-coords' } }, OGX.fmt.coords(p.coords)), p.moon ? ' Л' : ''),
            h('td', null, p.planetName || '—'),
            h('td', { title: p.checkedAt ? 'Данные галактики от ' + OGX.fmt.dateTime(p.checkedAt) : 'Система не просматривалась' }, actTxt),
            h('td', { class: P + 'muted' }, p.src.join(', ')),
            h('td', null, h('button', {
              type: 'button', class: [P + 'star', e && e.isTarget ? P + 'star-on' : null], dataset: { ogxAct: 'targets:card-star' },
              title: e && e.isTarget ? 'Цель — убрать' : 'Добавить в цели',
              onClick: () => this.toggleTarget(key, { playerId: c.id, playerName: c.name, planetName: p.planetName }, !(e && e.isTarget)),
            }, OGX.dom.icon('star'))));
        }) : h('tr', { class: 'ogx-empty' }, h('td', { colspan: '5' }, 'Планеты неизвестны: откройте систему игрока в галактике' + (isGz() ? ' (стоит дейтерий)' : '')))));
      const pts = hs && hs.card && hs.card.points ? hs.card.points : null;
      host.appendChild(h('div', { class: P + 'card', dataset: { playerId: c.id || '' } },
        h('div', { class: P + 'card-head' }, dot, h('b', { class: P + 'card-name' }, c.name || '#' + c.id), ally ? h('span', { class: P + 'muted' }, ' [' + ally + ']') : null,
          c.status ? h('span', { class: P + 'card-status' }, ' ', this.statusCell(c.status)) : null),
        c.error ? h('div', { class: P + 'error' }, c.error) : null,
        kv('Место', hs && fin(hs.rank) ? num(hs.rank) : '—'),
        kv('Очки', hs && fin(hs.points) ? num(hs.points) : '—'),
        pts ? kv('Постройки / исслед.', `${num(pts.buildings)} / ${num(pts.research)}`) : null,
        pts ? kv('Флот / оборона', `${num(pts.fleet)} / ${num(pts.defense)}`) : null,
        kv('Главная планета', hs && hs.homeCoords ? OGX.fmt.coords(hs.homeCoords) : '—'),
        kv('Статус', c.status ? c.status.split('').map((x) => STATUS_RU[x] || x).join(', ') : 'активен / нет данных'),
        u.note ? kv('Заметка', u.note) : null,
        ptable,
        h('div', { class: P + 'card-btns' },
          h('button', {
            type: 'button', class: ['ogx-btn', 'ogx-btn-primary', P + 'c-add'], dataset: { ogxAct: 'targets:card-add' }, disabled: !planets.length,
            title: planets.length ? 'Добавить все известные планеты игрока в цели' : 'Планеты игрока неизвестны',
            onClick: () => this.addTargets(planets.map((p) => ({ coords: p.coords, type: 1, playerId: c.id, playerName: c.name, planetName: p.planetName })))
              .then((n) => OGX.dom.toast(`В цели: ${n} ${OGX.fmt.plural(n, ['планета', 'планеты', 'планет'])} игрока ${c.name || ''}`, { type: 'ok' })),
          }, 'В цели'),
          h('button', {
            type: 'button', class: ['ogx-btn', P + 'c-track'], dataset: { ogxAct: 'targets:card-track' }, title: 'Следить за активностью игрока (вкладка «Слежка»)',
            disabled: !uKey,
            onClick: () => {
              const listeners = OGX.bus.count('targets:track');
              rec('B', 'emit:targets:track', { playerId: c.id, listeners });
              // GALAXYZ: the card's home system saves stalk a second page=playerCard request
              OGX.bus.emit('targets:track', Object.assign({ playerId: c.id, playerName: c.name }, isGz() && home ? { systems: [home] } : {}));
              OGX.dom.toast(listeners ? `${c.name || 'Игрок'}: слежка включена` : 'Модуль «Слежка» выключен — включите его в настройках', { type: listeners ? 'ok' : 'warn' });
            },
          }, 'Следить'),
          h('button', {
            type: 'button', class: ['ogx-btn', P + 'c-galaxy'], dataset: { ogxAct: 'targets:card-galaxy' }, disabled: !home, title: galaxyTitle('Открыть в галактике'),
            onClick: () => { const [g, s, p] = home.split(':'); OGX.page.go('/galaxy', { galaxy: g, system: s, position: p }); },
          }, 'Открыть в галактике'),
          h('button', {
            type: 'button', class: ['ogx-btn', P + 'c-note'], dataset: { ogxAct: 'targets:card-note' }, disabled: !uKey,
            onClick: () => this.openNoteEditor({ key: null, playerId: uKey, playerName: c.name }),
          }, 'Заметка'))));
    }
  }

  const CSS = `
.${P}slot { gap: 3px; }
#galaxytableHead td.action .ogx-gx-slot.${P}slot { display: inline-flex; vertical-align: middle; margin-left: 3px; }
.${P}unresolved p { margin: 0 0 6px; }
.${P}tools { display: inline-flex; align-items: center; gap: 3px; }
.${P}dot { width: 12px; height: 12px; min-width: 12px; padding: 0; border-radius: 50%; border: 1px solid #6b7a8c; background: transparent; cursor: pointer; vertical-align: middle; outline-offset: 1px; }
.${P}dot.${P}ring { outline: 2px solid #888; }
.${P}note, .${P}star { background: transparent; border: 0; padding: 0 1px; cursor: pointer; color: #6b7a8c; line-height: 0; vertical-align: middle; }
.${P}note svg, .${P}star svg { width: 12px; height: 12px; }
.${P}note.${P}has-note { color: #f2d16b; }
.${P}star.${P}star-on { color: #fdd835; }
.${P}star.${P}star-on svg { fill: #fdd835; }
.${P}hsdot { display: inline-block; min-width: 10px; height: 10px; border-radius: 5px; margin-right: 4px; vertical-align: middle; font-size: 8px; line-height: 10px; text-align: center; color: #000; }
.${P}hsdot-plain { background: #5d6b7a; }
.${P}menu { position: fixed; z-index: 100000; background: #161c24; border: 1px solid #2b3846; border-radius: 4px; padding: 6px; width: 220px; box-sizing: border-box; box-shadow: 0 4px 16px rgba(0,0,0,.6); }
.${P}menu-sec + .${P}menu-sec { margin-top: 6px; }
.${P}menu-label { color: #8593a3; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.${P}menu-row { display: flex; gap: 4px; flex-wrap: wrap; }
.${P}sw { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #2b3846; cursor: pointer; padding: 0; background: #0d1014; color: #8593a3; font-size: 12px; line-height: 14px; }
.${P}sw.${P}sw-on { box-shadow: 0 0 0 2px #fff; }
.${P}tab { display: flex; flex-direction: column; gap: 6px; }
.${P}bar, .${P}sform { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
/* the game's CSS sets visibility:hidden on native selects (it replaces them with its own dropdowns) */
select.${P}sel { visibility: visible !important; display: inline-block !important; }
.${P}f-text, .${P}q { flex: 1 1 120px; min-width: 100px; }
/* colours of type=search inputs come from the core (20-style); only the padding is local */
input.${P}f-text, input.${P}q { padding: 3px 6px; }
.${P}table-host { overflow-x: auto; max-width: 100%; }
.${P}table th, .${P}table td { padding: 3px 4px; }
.${P}tab a:not(.ogx-btn), .${P}unresolved a { color: var(--ogx-accent, #6f9fd8); }
.${P}count, .${P}muted { color: var(--ogx-muted, #8593a3); }
.${P}hint { color: var(--ogx-muted, #8593a3); font-size: 10px; }
.${P}error { color: var(--ogx-bad, #f44336); }
.${P}warn { color: var(--ogx-warn, #ff9800); }
.${P}table td { white-space: nowrap; }
.${P}table tr.ogx-empty td { white-space: normal; }
.${P}markcell, .${P}actions { display: inline-flex; gap: 3px; align-items: center; }
.${P}notecell { background: transparent; border: 0; color: inherit; cursor: pointer; max-width: 140px; overflow: hidden; text-overflow: ellipsis; text-align: left; padding: 0; }
.${P}loot { color: var(--ogx-ok, #4caf50); }
.${P}act-on { color: var(--ogx-bad, #f44336); font-weight: bold; }
.${P}status { color: var(--ogx-warn, #ff9800); }
.${P}rlist { display: flex; flex-direction: column; gap: 2px; }
.${P}ritem { display: flex; gap: 4px; align-items: center; padding: 2px 4px; border-bottom: 1px solid var(--ogx-border, #2b3846); }
.${P}rbtns { margin-left: auto; display: inline-flex; gap: 3px; }
.${P}card { border: 1px solid var(--ogx-border, #2b3846); border-radius: 4px; padding: 6px; display: flex; flex-direction: column; gap: 3px; }
.${P}card-head { display: flex; align-items: center; gap: 5px; font-size: 12px; }
.${P}kv { display: flex; gap: 6px; }
.${P}k { color: var(--ogx-muted, #8593a3); min-width: 110px; }
.${P}card-btns { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.${P}note-form { display: flex; flex-direction: column; gap: 4px; }
.${P}note-form textarea { width: 100%; resize: vertical; }
`;

  // exposed for tests and other modules (read-only helpers)
  OGX.targetsLib = { normalize, mergeMarks, pkey, parsePkey };
})(window.OGX);
