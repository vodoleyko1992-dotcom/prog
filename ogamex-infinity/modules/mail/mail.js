/* ogamex-infinity/modules/mail/mail.js — Owner: infinity/mail.
 * «Почта»: a full replacement of the GALAXYZ (ogamex.eu/Aeternum, 2Moons 1.8 fork) page=messages.
 *
 * The native page is a 2Moons table: a grid of 11 coloured category links, a <select> with seven bulk actions + «Confirm»,
 * and every message as two rows (tr.message_head + tr.messages_body); a spy report is a full-height block with every ship
 * type listed even at 0. This module hides that (the nodes stay in the DOM, «Старый вид» brings them back) and draws:
 *   - category tabs with unread / total (snapshot of the native grid; a loaded tab is read on the server, as with a click),
 *   - one compact line per message, a kind-specific summary (spy: loot 50 %, Battle Transporters needed, fleet / defence;
 *     combat: result, losses, loot, debris; expedition: outcome; transport / recycle / return: resources), click = expand,
 *   - search, «loot from» filter, «no fleet and no defence», «only new», sortable spy columns,
 *   - buttons instead of the <select>: select all, read, delete selected, delete spy reports below the loot filter, delete
 *     older than N hours, delete the whole category; row actions: Рейд (Battle Transporters only, OGX.fleet.send, core
 *     confirmation), Шпионить (OGX.api.sendMiniFleet mission 6), Симулятор (the report's own link), Атака (native link),
 *     Ракеты (OGX.missiles.openLaunch when the missiles module is loaded), Удалить,
 *   - hotkeys: ↑/↓ (j/k) move, Space/x select, Enter/o expand, Del delete, r raid, s spy, a select all, Esc clear. The row keys
 *     act only on a row the user focused himself (a click or ↑↓ / j k): the preview of the newest message in the full layout is
 *     not a focus. r / s and the row buttons always open a dialog with the plan first, whatever core.confirmActions says: one
 *     stray key or click must never send a fleet (a single raid then goes out through fleet.sendBatch(confirmed), bulk raids
 *     have their own summary dialog).
 *
 * Network: nothing on open (the page already carries the list of its category). A tab click = GET page=messages&mode=view
 * &messcat=N&site=S&ajax=1 (the game's own Message.getMessages request), pages 1..maxPages, more on «Загрузить ещё».
 * The fetched forms are kept in a hidden #ogx-mail-store inside #content, so OGX.messages.watch (spy reports store, badges)
 * sees them exactly like rows the game inserts. Bulk actions = the native form POST (mode=action, actionTop=<action>,
 * messageID[id]=1), see OGX.messages.gz.urls.actionBody. Deleting asks first (setting confirmDelete).
 * Raids follow John's rule: Battle Transporters (OGX.catalog.transportShip = 217) only, no fallback ship.
 * Storage: mail.ui { v:1, sort, dir } (player scope). Settings: mail.*.
 * OgameX (lanedirt) message pages are left alone: GALAXYZ only.
 */
(function (OGX) {
  'use strict';

  const NAME = 'mail';
  const P = 'ogx-i-mail-';
  const HOUR = 3600000;
  const isGz = () => !!(OGX.page && OGX.page.isGz && OGX.page.isGz());
  const h = (...a) => OGX.dom.h(...a);
  const num = (n) => OGX.fmt.num(n);
  const short = (n) => OGX.fmt.short(n);
  const rec = (src, what, data) => { try { return OGX.log.rec(src, NAME, what, data); } catch (e) { return null; } };

  // Russian tab labels by messcat (native names are English: "Spy reports", "Fight reports", ...). Order = tab order.
  const CAT_LABEL = [
    [0, 'Шпионаж'], [3, 'Бои'], [15, 'Экспедиции'], [5, 'Транспорт'], [4, 'Флот'], [1, 'Личные'], [2, 'Альянс'],
    [50, 'Игра'], [99, 'Стройка'], [100, 'Все'], [999, 'Исходящие'],
  ];
  const LABEL = new Map(CAT_LABEL);
  const KIND_LABEL = {
    spy_report: 'Шпионаж', spy_detected: 'Шпионаж у нас', combat: 'Бой', combat_expedition: 'Бой (эксп.)', missile: 'Ракеты',
    expedition: 'Экспедиция', transport_arrival: 'Транспорт', transport_received: 'Чужой транспорт', recycle: 'Переработка',
    deploy_arrival: 'Оставлен', return: 'Возврат', return_empty: 'Возврат', return_expedition: 'Возврат эксп.',
    return_expedition_dm: 'Возврат эксп.', colonisation: 'Колонизация', construction: 'Стройка', player: 'Личное',
    alliance: 'Альянс', game: 'Игра', outbox: 'Исходящее', system: 'Система', unknown: 'Сообщение',
  };
  const EXP_LABEL = {
    resources: 'Ресурсы', darkmatter: 'Тёмная материя', ships: 'Корабли', nothing: 'Ничего', delay: 'Задержка',
    speedup: 'Ускорение', battle_pirates: 'Пираты', battle_aliens: 'Чужие', fleet_lost: 'Флот потерян', unknown: '?',
  };
  const AGE_OPTIONS = [[1, '1 ч'], [6, '6 ч'], [24, '24 ч'], [72, '3 д'], [168, '7 д']];

  OGX.module({
    name: NAME,
    title: 'Почта: новое меню сообщений',
    pages: ['messages'],
    settings: {
      replace: { type: 'bool', default: true, label: 'Заменить страницу сообщений новым меню', hint: 'Выключено = родная таблица игры' },
      layout: { type: 'enum', default: 'full', label: 'Вид почты', options: [{ value: 'full', label: 'На весь экран: список + письмо справа' }, { value: 'inline', label: 'В колонке страницы, письмо раскрывается под строкой' }] },
      maxPages: { type: 'int', default: 5, min: 1, max: 50, label: 'Сколько страниц загружать при открытии вкладки', hint: 'Каждая страница = один запрос, как клик по номеру страницы в игре' },
      confirmDelete: { type: 'bool', default: true, label: 'Спрашивать перед удалением' },
      reservePct: { type: 'int', default: 10, min: 0, max: 100, label: 'Запас трюма для рейда, %' },
      minLoot: { type: 'string', default: '', hidden: true, label: 'Фильтр: добыча от' },
      clean: { type: 'bool', default: false, hidden: true, label: 'Фильтр: без флота и обороны' },
      onlyNew: { type: 'bool', default: false, hidden: true, label: 'Фильтр: только новые' },
      ageHours: { type: 'int', default: 24, hidden: true, label: 'Удалять старше, ч' },
      latestOnly: { type: 'bool', default: false, hidden: true, label: 'Фильтр: только свежий доклад по каждой цели' },
      autoClean: { type: 'bool', default: false, label: 'Автоочистка почты', hint: 'После загрузки вкладки сразу удаляет на сервере сообщения по включённым правилам. Бот сам читает шпионаж (0), бои (3) и экспедиции (15): пока он включён, свежие письма этих категорий не трогаются (запас ниже)' },
      autoCheap: { type: 'bool', default: true, label: 'Автоочистка: шпионские доклады с добычей меньше «Добыча от»' },
      autoOldDup: { type: 'bool', default: true, label: 'Автоочистка: старые доклады по той же цели (остаётся свежий)' },
      autoExpEmpty: { type: 'bool', default: true, label: 'Автоочистка: пустые экспедиции (ничего, задержка, ускорение)' },
      autoSpyDetected: { type: 'bool', default: false, label: 'Автоочистка: «у нас шпионили»' },
      autoReturns: { type: 'bool', default: false, label: 'Автоочистка: возвраты флота без ресурсов' },
      autoBotGraceMin: { type: 'int', default: 15, min: 0, max: 1440, label: 'Автоочистка: пока бот включён, не трогать письма бота моложе, мин', hint: 'Категории 0, 3 и 15 (шпионаж, бои, экспедиции) бот читает и чистит сам; письма без читаемого времени тоже остаются ему. 0 = без запаса' },
    },
    async init(ctx) {
      if (!isGz()) return;
      const m = new Mail(ctx);
      ctx._mail = m;
      await m.start();
    },
    dispose(ctx) { if (ctx._mail) ctx._mail.stop(); },
  });

  // ================================================================== helpers (pure)
  // Categories the bot (botcore, when loaded) reads itself: spy reports, combat reports, expedition results.
  const BOT_CATS = new Set([0, 3, 15]);
  /** The bot's main switch (OGX.bot.status().master): on = it reads and deletes its own mail, whatever its current state. */
  function botOn() {
    try { const b = OGX.bot; const s = b && typeof b.status === 'function' ? b.status() : null; return !!(s && s.master === true); } catch (e) { return false; }
  }
  /** "1,5 млрд", "500m", "2kkk", "3 трлн", "1.000.000" -> number | null. */
  function parseAmount(s) {
    s = String(s || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;
    const m = s.match(/^(\d+(?:[.,]\d+)?)(k+|к+|m|м|млн|b|g|млрд|t|трлн)?$/);
    if (!m) { const d = s.replace(/[^\d]/g, ''); return d ? +d : null; }
    let v = parseFloat(m[1].replace(',', '.'));
    const u = m[2] || '';
    if (/^[kк]+$/.test(u)) v *= Math.pow(1e3, u.length);
    else if (u === 'm' || u === 'м' || u === 'млн') v *= 1e6;
    else if (u === 'b' || u === 'g' || u === 'млрд') v *= 1e9;
    else if (u === 't' || u === 'трлн') v *= 1e12;
    return Math.round(v);
  }
  const sumUnits = (o) => Object.values(o || {}).reduce((s, v) => s + (+v || 0), 0);
  const coordsKey = (c) => (Array.isArray(c) ? c.join(':') : c || '');
  const textOf = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  // ================================================================== Mail
  function Mail(ctx) {
    this.ctx = ctx;
    this.log = ctx.log;
    this.cat = null;               // open messcat
    this.cats = [];                // [{ cat, label, unread, total }]
    this.rows = new Map();         // id -> row
    this.pages = { loaded: 0, total: 1 };
    this.sel = new Set();
    this.open = new Set();
    this.focus = null;             // id
    this.focusByUser = false;      // focus set by a click or ↑↓ / j k: only then the row hotkeys (r, s, Space, Del, Enter) act
    this.busy = false;
    this.ui = { v: 1, sort: 'ts', dir: -1 };
    this.env = { cargo: 0, reserve: 0.1 };
    this.offs = [];
    this.hidden = [];
    // One raid = fleet.sendBatch with ONE flight after the module's own dialog (confirmed: true): the plan and the risk warning are
    // in that dialog, so the core's confirmActions dialog is not asked a second time. Result = the flight's own result.
    this.wSend = OGX.log.wrap(NAME, (flight) => OGX.fleet.sendBatch([flight], { confirmed: true })
      .then((b) => (b && b.results && b.results[0]) || { success: false, message: (b && (b.message || b.abortReason)) || 'нет ответа' }), 'raid:send');
    this.wSpy = OGX.log.wrap(NAME, (q) => OGX.api.sendMiniFleet(q), 'spy:mini');
    this.wList = OGX.log.wrap(NAME, (cat, page) => OGX.api.messagesList(cat, null, page), 'list');
    this.wAction = OGX.log.wrap(NAME, (form) => OGX.http.post('messages', form, { expect: 'text' }), 'action');
  }
  Mail.prototype.set = function (k) { return this.ctx.settings.get(k); };

  Mail.prototype.start = async function () {
    const ctx = this.ctx;
    ctx.css(CSS);
    const ui = await ctx.store.get('ui', null);
    if (ui && ui.v === 1) this.ui = Object.assign(this.ui, ui);
    await this.loadEnv();
    this.content = document.getElementById('content') || document.getElementById('inhalt');
    if (!this.content) { this.log.warn('no #content'); return; }
    this.store = h('div', { id: 'ogx-mail-store', hidden: true });
    this.content.appendChild(this.store);
    this.readCategories(document);
    this.adoptNative();
    this.build();
    this.applyMode();
    this.offs.push(ctx.settings.onChange((key) => {
      if (key === 'replace' || key === 'layout') this.applyMode();
      else if (key === 'reservePct') { this.loadEnv().then(() => this.render()); }
    }));
    this.offs.push(OGX.state.onChange(['shipStats'], () => this.loadEnv().then(() => this.render())));
    this.offs.push(ctx.on(document, 'keydown', (e) => this.onKey(e)));
    if (this.set('autoClean') && this.set('replace') !== false) OGX.safe(() => this.autoClean({ auto: true }), 'mail:autoclean')();
    rec('B', 'init', { cat: this.cat, rows: this.rows.size, cats: this.cats.length });
  };

  Mail.prototype.stop = function () {
    for (const off of this.offs) { try { off && off(); } catch (e) { /* ignore */ } }
    this.offs = [];
    document.documentElement.classList.remove('ogx-mail-on');
    if (this.root) this.root.remove();
    if (this.store) this.store.remove();
  };

  Mail.prototype.loadEnv = async function () {
    const ship = OGX.catalog.transportShip || 217;
    let cargo = 0;
    try { const st = await OGX.state.shipStats(); cargo = st && st[ship] ? +st[ship].cargo || 0 : 0; } catch (e) { cargo = 0; }
    if (!cargo) { const o = OGX.catalog.get(ship); cargo = o && o.props ? +o.props.cargo || 0 : 0; }
    let cur = null;
    try { cur = OGX.state.current() || null; } catch (e) { cur = null; }
    this.env = { ship, cargo, reserve: (+this.set('reservePct') || 0) / 100, cur };
  };

  // ------------------------------------------------------------------ data
  /** Tabs from the native category grid (unread / total snapshot of the page load). */
  Mail.prototype.readCategories = function (doc) {
    const list = (OGX.messages.gz.categories(doc) || []).filter((c) => c && Number.isFinite(c.cat));
    const by = new Map(list.map((c) => [c.cat, c]));
    const cats = [];
    for (const [cat, label] of CAT_LABEL) {
      const c = by.get(cat);
      if (!c && list.length) continue;
      cats.push({ cat, label, name: c ? c.name : label, unread: c ? +c.unread || 0 : 0, total: c ? +c.total || 0 : 0 });
    }
    for (const c of list) if (!LABEL.has(c.cat)) cats.push({ cat: c.cat, label: c.name || String(c.cat), name: c.name, unread: +c.unread || 0, total: +c.total || 0 });
    this.cats = cats;
  };

  /** The list the page already shows (no request): its category becomes the open tab. Native nodes are hidden, not removed. */
  Mail.prototype.adoptNative = function () {
    const table = document.querySelector('#messagestable');
    const catsTable = (() => { const a = document.querySelector('a[onclick*="Message.getMessages("]'); return a ? a.closest('table') : null; })();
    this.native = [catsTable].concat(Array.from(this.content.querySelectorAll(':scope > form, :scope > .mainRS'))).filter(Boolean);
    this.cat = null;
    if (table) {
      const items = OGX.messages.gz.listItems(document);
      this.cat = items.cat ?? 100;
      this.rows.clear();
      for (const m of items) this.addRow(m);
      this.pages = { loaded: items.page || 1, total: items.totalPages || 1 };
    } else this.pages = { loaded: 0, total: 0 };
  };

  /** parse.list item -> row (summary by kind). Never throws. */
  Mail.prototype.addRow = function (m) {
    if (!m || !m.id) return null;
    const head = m.li || null;
    const bodyTr = head && head.nextElementSibling && head.nextElementSibling.matches('tr.messages_body') ? head.nextElementSibling : null;
    const subjCell = head ? head.children[3] : null;
    const r = {
      id: +m.id, cat: m.rowCat ?? m.cat, kind: m.kind || 'unknown', key: m.key, unread: !!(m.isNew || m.unread),
      date: m.date || '', ts: m.ts || null, from: m.from || '', subject: (m.subject || '').trim(),
      head, body: bodyTr ? bodyTr.querySelector('td') : null, reply: subjCell ? subjCell.querySelector('a[onclick*="Dialog.PM"]') : null,
      text: '', spy: null, combat: null, exp: null, fleet: null,
    };
    r.text = textOf(r.body);
    try {
      if (r.kind === 'spy_report') r.spy = this.derive(OGX.messages.parse.espionageFull(m));
      else if (r.kind === 'combat' || r.kind === 'combat_expedition') r.combat = OGX.messages.parse.battleShort(m);
      else if (r.kind === 'expedition') r.exp = OGX.messages.parse.expedition(m);
      else if (/^(transport|recycle|deploy|return|missile)/.test(r.kind)) r.fleet = OGX.messages.parse.fleetMessage(m);
    } catch (e) { this.log.warn('row not parsed', r.id, e && e.message); }
    this.rows.set(r.id, r);
    return r;
  };

  /** Spy report -> loot / transporters / fleet & defence flags. */
  Mail.prototype.derive = function (f) {
    if (!f || !f.target) return null;
    const res = f.resources || { metal: 0, crystal: 0, deuterium: 0 };
    const loot = OGX.calc.loot(res);
    const pct = OGX.calc.lootPct ? OGX.calc.lootPct() : 0.5;
    const lootable = { metal: (res.metal || 0) * pct, crystal: (res.crystal || 0) * pct, deuterium: (res.deuterium || 0) * pct };
    const cap = OGX.calc.lootCapacity ? OGX.calc.lootCapacity(lootable) : loot.total;
    const n = this.env.cargo > 0 && cap > 0 ? Math.ceil((cap * (1 + this.env.reserve)) / this.env.cargo) : 0;
    const fleet = f.known && f.known.ships ? sumUnits(f.ships) : null;
    const def = f.known && f.known.defense ? sumUnits(Object.fromEntries(Object.entries(f.defense || {}).filter(([id]) => +id < 500))) : null;
    const ap = f.attackParams || null;
    const target = ap ? { galaxy: ap.galaxy, system: ap.system, position: ap.position, type: +ap.type || 1 } : null;
    return {
      f, target, coords: f.target.coords, coordsStr: coordsKey(f.target.coords), name: f.target.name || '', type: f.target.planetType || 1,
      res, loot, ships: n, fleet, def, simHref: f.simHref || null, counter: f.counterEspionage,
    };
  };

  /** Fetch pages [from..to] of the open category into the hidden store (OGX.messages.watch sees them). */
  Mail.prototype.loadPages = async function (from, to) {
    const cat = this.cat;
    for (let p = from; p <= to; p++) {
      this.status('Загрузка: страница ' + p + (this.pages.total > 1 ? ' из ' + this.pages.total : '') + '…');
      const r = await this.wList(cat, p);
      if (this.cat !== cat) return;   // tab changed meanwhile
      if (!r || r.error) { this.status('Ошибка загрузки: ' + ((r && (r.error || r.status)) || '?'), 'bad'); return; }
      const box = h('div', { class: P + 'page', dataset: { cat, page: p } });
      const form = r.doc.querySelector('form') || r.doc.body;
      box.appendChild(document.importNode(form, true));
      this.store.appendChild(box);
      const items = OGX.messages.gz.listItems(box);
      for (const m of items) this.addRow(m);
      this.pages = { loaded: p, total: Math.max(items.totalPages || 1, p) };
      this.render();
      if (p >= this.pages.total) break;
    }
    this.status('');
  };

  Mail.prototype.openCat = async function (cat, { force = false } = {}) {
    if (this.busy) return;
    if (cat === this.cat && !force) return;
    rec('U', 'tab', { cat });
    this.busy = true;
    this.cat = cat;
    this.rows.clear(); this.sel.clear(); this.open.clear(); this.focus = null;
    this.store.textContent = '';
    this.pages = { loaded: 0, total: 1 };
    this.render();
    try {
      await this.loadPages(1, Math.max(1, +this.set('maxPages') || 1));
      const c = this.cats.find((x) => x.cat === cat);
      if (c) { c.unread = 0; if (this.pages.loaded >= this.pages.total) c.total = this.rows.size; }   // listing marks read
    } finally { this.busy = false; this.render(); }
    if (this.set('autoClean')) await this.autoClean({ auto: true });
  };

  Mail.prototype.loadMore = async function () {
    if (this.busy || this.pages.loaded >= this.pages.total) return;
    this.busy = true;
    try { await this.loadPages(this.pages.loaded + 1, Math.min(this.pages.total, this.pages.loaded + Math.max(1, +this.set('maxPages') || 1))); }
    finally { this.busy = false; this.render(); }
  };

  // ------------------------------------------------------------------ view model
  Mail.prototype.filters = function () {
    return {
      q: (this.qInput ? this.qInput.value : '').trim().toLowerCase(),
      minLoot: parseAmount(this.set('minLoot')),
      clean: !!this.set('clean'),
      onlyNew: !!this.set('onlyNew'),
    };
  };

  Mail.prototype.visible = function () {
    const f = this.filters();
    const out = [];
    const stale = this.set('latestOnly') ? this.staleIds() : null;
    for (const r of this.rows.values()) {
      if (stale && stale.has(r.id)) continue;
      if (f.onlyNew && !r.unread) continue;
      if (r.spy) {
        if (f.minLoot && r.spy.loot.total < f.minLoot) continue;
        if (f.clean && (r.spy.fleet !== 0 || r.spy.def !== 0)) continue;
      } else if (f.clean && this.cat === 0) continue;
      if (f.q) {
        const hay = [r.from, r.subject, r.text, r.spy && r.spy.coordsStr, r.spy && r.spy.name].join(' ').toLowerCase();
        if (!hay.includes(f.q)) continue;
      }
      out.push(r);
    }
    const k = this.ui.sort, d = this.ui.dir;
    const val = (r) => {
      if (k === 'ts') return r.ts || r.id;
      if (!r.spy) return -Infinity;
      if (k === 'loot') return r.spy.loot.total;
      if (k === 'ships') return r.spy.ships;
      if (k === 'fleet') return r.spy.fleet === null ? Infinity : r.spy.fleet;
      if (k === 'def') return r.spy.def === null ? Infinity : r.spy.def;
      if (k === 'coords') return r.spy.coords ? r.spy.coords[0] * 1e6 + r.spy.coords[1] * 1e3 + r.spy.coords[2] : 0;
      return 0;
    };
    out.sort((a, b) => ((val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : b.id - a.id)) * d);
    return out;
  };

  // ------------------------------------------------------------------ DOM
  Mail.prototype.applyMode = function () {
    const on = this.set('replace') !== false;
    const full = this.set('layout') !== 'inline';
    document.documentElement.classList.toggle('ogx-mail-on', on);
    document.documentElement.classList.toggle('ogx-mail-full', on && full);
    if (this.root) {
      this.root.classList.toggle(P + 'full', full);
      const host = full ? document.body : this.content;
      if (this.root.parentNode !== host) { if (full) document.body.appendChild(this.root); else this.content.insertBefore(this.root, this.oldBtn.nextSibling); }
    }
    for (const el of this.native) el.classList.toggle(P + 'hidden', on);
    if (this.root) this.root.hidden = !on;
    if (this.oldBtn) this.oldBtn.hidden = on;
    if (on) this.render();
  };

  Mail.prototype.build = function () {
    this.tabsEl = h('div', { class: P + 'tabs', role: 'tablist' });
    this.qInput = h('input', { type: 'search', class: 'ogx-input ' + P + 'q', placeholder: 'Поиск: координаты, имя, текст  ( / )', onInput: OGX.util.debounce(() => this.render(), 120) });
    const minLoot = h('input', { type: 'text', class: 'ogx-input ' + P + 'minloot', placeholder: 'напр. 1 млрд', value: this.set('minLoot') || '', title: 'Показывать шпионские доклады с добычей от (k, млн, млрд, трлн)',
      onChange: (e) => this.ctx.settings.set('minLoot', e.target.value) });
    const chk = (key, label, title) => h('label', { class: P + 'chk', title }, h('input', { type: 'checkbox', checked: !!this.set(key), onChange: (e) => this.ctx.settings.set(key, e.target.checked).then(() => this.render()) }), label);
    const age = h('select', { class: 'ogx-input ' + P + 'age', onChange: (e) => this.ctx.settings.set('ageHours', +e.target.value) },
      AGE_OPTIONS.map(([v, l]) => h('option', { value: v, selected: +this.set('ageHours') === v }, l)));
    this.offs.push(this.ctx.settings.onChange((k) => { if (k === 'minLoot') this.render(); }));
    this.selAll = h('input', { type: 'checkbox', class: P + 'selall', title: 'Выбрать все видимые (a)', onChange: (e) => this.selectVisible(e.target.checked) });
    const btn = (label, title, fn, cls) => h('button', { class: ['ogx-btn', cls], title, onClick: fn }, label);
    this.countEl = h('span', { class: P + 'count' });
    this.statusEl = h('span', { class: P + 'status', role: 'status' });
    this.listEl = h('div', { class: P + 'list' });
    this.moreEl = h('div', { class: P + 'more' });
    this.previewEl = h('div', { class: P + 'preview' });
    this.sumEl = h('div', { class: P + 'sum' });
    const full = () => this.set('layout') !== 'inline';
    this.root = h('div', { id: 'ogx-mail', class: ['ogx-root', P + 'root'] },
      h('div', { class: P + 'head' },
        h('span', { class: P + 'title' }, '✉ Почта'),
        this.qInput,
        h('span', { class: P + 'grp', title: 'Фильтр шпионских докладов' }, 'Добыча от ', minLoot),
        chk('clean', 'без флота и обороны', 'Только доклады, где флот и оборона видны и равны 0'),
        chk('onlyNew', 'только новые', 'Сообщения, которые были непрочитанными при загрузке'),
        chk('latestOnly', 'свежий по цели', 'Скрыть старые доклады, если по той же цели есть более новый'),
        h('span', { class: P + 'sp' }),
        h('button', { class: 'ogx-btn ' + P + 'lay', title: 'Переключить вид: на весь экран / в колонке страницы', onClick: () => this.ctx.settings.set('layout', full() ? 'inline' : 'full') }, '⇔'),
        h('button', { class: 'ogx-btn ' + P + 'old', title: 'Показать родную таблицу игры', onClick: () => this.ctx.settings.set('replace', false) }, 'Старый вид'),
        h('a', { class: 'ogx-btn ' + P + 'close', href: OGX.page.url('overview', {}), title: 'Закрыть почту (в обзор)' }, '✕')),
      h('div', { class: P + 'main' },
        h('div', { class: P + 'side' }, this.tabsEl, this.sumEl,
          h('div', { class: P + 'auto' },
            h('div', { class: P + 'stitle' }, 'Очистка по правилам'),
            chk('autoClean', 'сразу после загрузки', 'Удалять автоматически при открытии вкладки'),
            chk('autoCheap', 'добыча < «Добыча от»'), chk('autoOldDup', 'старые доклады по цели'),
            chk('autoExpEmpty', 'пустые экспедиции'), chk('autoSpyDetected', '«у нас шпионили»'), chk('autoReturns', 'пустые возвраты'),
            btn('Очистить сейчас', 'Удалить загруженные сообщения по отмеченным правилам', () => this.autoClean(), 'ogx-btn-danger ' + P + 'clean'))),
        h('div', { class: P + 'center' },
          h('div', { class: P + 'bar ' + P + 'actions' }, this.selAll, this.countEl,
            btn('Рейд по отмеченным', 'Рейды улучшенными транспортами на все отмеченные доклады (один общий диалог)', () => this.raidSelected(), 'ogx-btn-primary ' + P + 'braid'),
            btn('Зонды по отмеченным', 'Шпионить все отмеченные цели', () => this.spySelected(), P + 'bspy'),
            btn('Прочитано', 'Отметить выбранные прочитанными', () => this.bulk('readmarked')),
            btn('Удалить выбранные', 'Del', () => this.deleteIds([...this.sel], 'выбранные'), 'ogx-btn-danger'),
            btn('Удалить пустые', 'Удалить шпионские доклады с добычей меньше фильтра «Добыча от»', () => this.deleteCheap(), 'ogx-btn-danger'),
            h('span', { class: P + 'grp' }, btn('Удалить старше', 'Удалить загруженные сообщения старше выбранного срока', () => this.deleteOld(), 'ogx-btn-danger'), age),
            btn('Очистить вкладку', 'Удалить ВСЕ сообщения этой категории на сервере (deletetypeall)', () => this.deleteCategory(), 'ogx-btn-danger'),
            btn('⟳', 'Обновить вкладку', () => this.openCat(this.cat, { force: true }), 'ogx-btn-icon'),
            this.statusEl),
          this.listEl, this.moreEl,
          h('div', { class: P + 'keys' }, 'Клавиши: ↑↓ / j k — следующее / предыдущее, Пробел — отметить, Enter — раскрыть, Del — удалить, r — рейд (с подтверждением), s — шпионить (с подтверждением), a — отметить все, / — поиск, Esc — снять выбор')),
        this.previewEl));
    this.oldBtn = h('button', { class: 'ogx-btn ogx-root ' + P + 'back', hidden: true, onClick: () => this.ctx.settings.set('replace', true) }, 'Новое меню почты');
    const first = this.native[0] || this.content.firstChild;
    this.content.insertBefore(this.oldBtn, first);
    this.content.insertBefore(this.root, first);
  };

  Mail.prototype.status = function (text, type) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text || '';
    this.statusEl.dataset.type = type || '';
  };

  Mail.prototype.renderTabs = function () {
    this.tabsEl.textContent = '';
    for (const c of this.cats) {
      const active = c.cat === this.cat;
      this.tabsEl.appendChild(h('button', {
        class: [P + 'tab', active && P + 'tab-on', c.unread > 0 && P + 'tab-new'], role: 'tab', 'aria-selected': active ? 'true' : 'false',
        dataset: { cat: c.cat }, title: (c.name || c.label) + ': новых ' + c.unread + ', всего ' + c.total, onClick: () => this.openCat(c.cat),
      }, c.label, c.unread > 0 ? h('span', { class: P + 'n' }, String(c.unread)) : null, h('span', { class: P + 't' }, String(c.total))));
    }
  };

  Mail.prototype.render = function () {
    if (!this.root || this.root.hidden) return;
    this.renderTabs();
    const vis = this.visible();
    this.vis = vis;
    for (const id of [...this.sel]) if (!this.rows.has(id)) this.sel.delete(id);
    this.countEl.textContent = (this.sel.size ? 'выбрано ' + this.sel.size + ' · ' : '') + vis.length + (vis.length !== this.rows.size ? ' из ' + this.rows.size : '');
    this.selAll.checked = vis.length > 0 && vis.every((r) => this.sel.has(r.id));
    const spyMode = vis.some((r) => r.spy) && vis.every((r) => r.spy || r.kind === 'spy_detected');
    const mis = OGX.missiles && typeof OGX.missiles.plan === 'function';
    const sortTh = (key, label, title) => h('th', { class: [P + 'sort', this.ui.sort === key && P + 'sorted'], title: title || 'Сортировать', dataset: { sort: key }, onClick: () => this.sortBy(key) },
      label, this.ui.sort === key ? (this.ui.dir > 0 ? ' ▲' : ' ▼') : '');
    const head = spyMode
      ? h('tr', null, h('th', { class: P + 'cb' }), sortTh('coords', 'Цель'), sortTh('ts', 'Время'), sortTh('loot', 'Добыча 50%'),
        sortTh('ships', 'Ул. трансп.', 'Улучшенных транспортов на всю добычу (+ запас ' + Math.round(this.env.reserve * 100) + ' %)'),
        sortTh('fleet', 'Флот'), sortTh('def', 'Оборона'), mis ? h('th', { title: 'МПР на снос обороны (модуль ракет)' }, 'МПР') : null, h('th', { class: P + 'acts' }, 'Действия'))
      : h('tr', null, h('th', { class: P + 'cb' }), sortTh('ts', 'Время'), h('th', null, 'Тип'), h('th', null, 'Кратко'), h('th', { class: P + 'acts' }));
    const tbody = h('tbody');
    for (const r of vis) {
      tbody.appendChild(spyMode ? this.spyRow(r, mis) : this.genericRow(r));
      if (!this.isFull() && this.open.has(r.id)) tbody.appendChild(this.detailRow(r, spyMode ? (mis ? 9 : 8) : 5));
    }
    this.listEl.textContent = '';
    if (!vis.length) {
      this.listEl.appendChild(h('div', { class: P + 'empty' }, this.busy ? 'Загрузка…' : this.rows.size ? 'Ничего не подходит под фильтры' : this.cat === null ? 'Выберите вкладку' : 'Сообщений нет'));
    } else {
      this.listEl.appendChild(h('table', { class: [P + 'table', spyMode && P + 'spy'] }, h('thead', null, head), tbody));
    }
    // a focused row that is gone (deleted, filtered out) drops the focus; nothing is focused on the user's behalf
    if (this.focus !== null && !vis.some((r) => r.id === this.focus)) { this.focus = null; this.focusByUser = false; }
    this.renderPreview();
    this.renderSummary(vis);
    this.moreEl.textContent = '';
    if (this.pages.total > this.pages.loaded) {
      this.moreEl.appendChild(h('button', { class: 'ogx-btn', disabled: this.busy, onClick: () => this.loadMore() },
        'Загрузить ещё (загружено страниц ' + this.pages.loaded + ' из ' + this.pages.total + ')'));
    }
  };

  Mail.prototype.rowAttrs = function (r, extra) {
    return {
      class: [P + 'row', r.unread && P + 'unread', this.sel.has(r.id) && P + 'sel', this.focus === r.id && P + 'focus', extra],
      dataset: { id: r.id, kind: r.kind },
      onClick: (e) => { if (e.target.closest('a, button, input, select')) return; this.focus = r.id; this.focusByUser = true; if (this.isFull()) this.render(); else this.toggleOpen(r.id); },
    };
  };
  Mail.prototype.cb = function (r) {
    return h('td', { class: P + 'cb' }, h('input', { type: 'checkbox', checked: this.sel.has(r.id), onChange: (e) => { this.toggleSel(r.id, e.target.checked); } }));
  };
  Mail.prototype.timeCell = function (r) {
    return h('td', { class: P + 'time', title: r.date }, r.ts ? OGX.fmt.ago(r.ts).replace(' назад', '') : r.date || '—');
  };

  Mail.prototype.spyRow = function (r, mis) {
    const s = r.spy;
    if (!s) {
      // spy-detected (a probe of somebody at our planet) in the spy tab
      return h('tr', this.rowAttrs(r, P + 'muted'), this.cb(r), h('td', { colspan: 1 }, KIND_LABEL[r.kind] || r.subject), this.timeCell(r),
        h('td', { colspan: mis ? 5 : 4, class: P + 'txt' }, r.text.slice(0, 160)), h('td', { class: P + 'acts' }, this.delBtn(r)));
    }
    const flag = (v, word) => (v === null ? h('span', { class: P + 'unk', title: word + ': зонды не увидели (мало зондов)' }, '?')
      : v === 0 ? h('span', { class: P + 'ok' }, '—') : h('span', { class: P + 'bad', title: word + ': ' + num(v) + ' ед.' }, short(v)));
    const lootTitle = 'Металл ' + num(s.loot.metal) + '\nКристалл ' + num(s.loot.crystal) + '\nДейтерий ' + num(s.loot.deuterium) + '\n(на планете: ' + num(s.res.metal) + ' / ' + num(s.res.crystal) + ' / ' + num(s.res.deuterium) + ')';
    let misCell = null;
    if (mis) {
      let need = null, known = true;
      try { const p = OGX.missiles.plan(s.f); known = !(p && p.defenseKnown === false); need = p && Number.isFinite(+p.need) ? +p.need : null; } catch (e) { need = null; }
      misCell = h('td', { class: P + 'num' }, !known ? h('span', { class: P + 'unk', title: 'Оборона не видна в докладе' }, '?') : need === null ? '—' : num(need));
    }
    return h('tr', this.rowAttrs(r),
      this.cb(r),
      h('td', { class: P + 'target' }, h('a', { href: OGX.page.url('galaxy', { galaxy: s.coords[0], system: s.coords[1] }), title: 'Открыть систему' }, OGX.fmt.coords(s.coords, s.type)),
        ' ', h('span', { class: P + 'name' }, s.name)),
      this.timeCell(r),
      h('td', { class: P + 'num ' + P + 'loot', title: lootTitle }, short(s.loot.total)),
      h('td', { class: P + 'num', title: s.ships ? num(s.ships) + ' × ' + num(this.env.cargo) : 'Нет данных о трюме' }, s.ships ? num(s.ships) : '—'),
      h('td', { class: P + 'num' }, flag(s.fleet, 'Флот')),
      h('td', { class: P + 'num' }, flag(s.def, 'Оборона')),
      misCell,
      h('td', { class: P + 'acts' },
        h('button', { class: 'ogx-btn ogx-btn-primary ' + P + 'raid', title: 'Рейд улучшенными транспортами: ' + num(s.ships) + ' шт. (r)', disabled: !s.ships || !s.target, onClick: (e) => this.raid(r, e.currentTarget) }, 'Рейд'),
        h('button', { class: 'ogx-btn ' + P + 'spyb', title: 'Отправить зонды ещё раз (s)', disabled: !s.target, onClick: (e) => this.respy(r, e.currentTarget) }, 'Шпион'),
        s.simHref ? h('a', { class: 'ogx-btn ' + P + 'sim', href: s.simHref, target: '_blank', title: 'Симулятор боя игры' }, 'Сим') : null,
        mis && typeof OGX.missiles.openLaunch === 'function'
          ? h('button', { class: 'ogx-btn ' + P + 'mis', title: 'Ракетный удар', onClick: () => OGX.missiles.openLaunch({ coords: s.coords, planetType: s.type, report: s.f }) }, '🚀') : null,
        this.delBtn(r)));
  };

  Mail.prototype.summary = function (r) {
    if (r.combat) {
      const c = r.combat;
      const won = c.myResult === 'win' || c.winner === (c.myRole || 'attacker');
      const bits = [h('span', { class: won ? P + 'ok' : P + 'bad' }, (c.coords ? '[' + c.coords + '] ' : '') + (won ? 'победа' : c.winner === 'draw' ? 'ничья' : 'поражение'))];
      if (c.attacker && c.attacker.losses !== null) bits.push(' · потери: атака ' + short(c.attacker.losses) + ', защита ' + short(c.defender.losses));
      if (c.lootSum) bits.push(' · добыча ' + short(c.lootSum));
      if (c.debrisSum) bits.push(' · обломки ' + short(c.debrisSum));
      return bits;
    }
    if (r.exp) {
      const o = r.exp.outcome || 'unknown';
      const ships = r.exp.shipsByName ? Object.entries(r.exp.shipsByName).map(([n, v]) => n + ' ' + num(v)).join(', ') : '';
      return [h('span', { class: P + 'exp-' + o }, EXP_LABEL[o] || o), ships ? ' · ' + ships : ''];
    }
    if (r.fleet && r.fleet.resources) {
      const x = r.fleet.resources;
      const where = r.fleet.to || r.fleet.from;
      return [(where ? OGX.fmt.coords(where.coords, where.planetType) + ' ' : ''),
        'М ' + short(x.metal || 0) + ' · К ' + short(x.crystal || 0) + ' · Д ' + short(x.deuterium || 0) + (r.fleet.darkMatter ? ' · ТМ ' + short(r.fleet.darkMatter) : '')];
    }
    return [r.from && !/headquarters|department/i.test(r.from) ? h('b', null, r.from + ': ') : null, r.subject && r.kind !== 'unknown' && r.text.length < 20 ? r.subject + ' ' : '', r.text.slice(0, 180)];
  };

  Mail.prototype.genericRow = function (r) {
    return h('tr', this.rowAttrs(r),
      this.cb(r), this.timeCell(r),
      h('td', { class: P + 'kind' }, KIND_LABEL[r.kind] || r.subject || '—'),
      h('td', { class: P + 'txt' }, this.summary(r)),
      h('td', { class: P + 'acts' },
        r.combat && r.combat.detailsUrl ? h('a', { class: 'ogx-btn', href: r.combat.detailsUrl, target: '_blank', title: 'Полный боевой доклад' }, 'Доклад') : null,
        r.reply ? h('button', { class: 'ogx-btn', title: 'Ответить', onClick: () => r.reply.click() }, 'Ответить') : null,
        this.delBtn(r)));
  };

  Mail.prototype.delBtn = function (r) {
    return h('button', { class: 'ogx-btn ogx-btn-icon ' + P + 'del', title: 'Удалить (Del)', onClick: () => this.deleteIds([r.id], 'это сообщение') }, '✕');
  };

  /** Expanded message: a clean copy of the game's body (our own widgets of other modules removed: dead copies). */
  Mail.prototype.detailRow = function (r, cols) {
    const box = h('div', { class: P + 'body' });
    if (r.body) {
      const c = r.body.cloneNode(true);
      for (const el of c.querySelectorAll('[class*="ogx-"]')) el.remove();
      while (c.firstChild) box.appendChild(c.firstChild);
    } else box.textContent = r.text || '—';
    return h('tr', { class: P + 'detail', dataset: { for: r.id } }, h('td', { colspan: cols }, box));
  };

  /** Spy reports that have a newer report of the same target (coords + planet type) among the loaded rows. */
  Mail.prototype.staleIds = function () {
    const best = new Map(), stale = new Set();
    for (const r of this.rows.values()) {
      if (!r.spy) continue;
      const k = r.spy.coordsStr + ':' + r.spy.type;
      const b = best.get(k);
      if (!b) { best.set(k, r); continue; }
      const newer = ((r.ts || 0) - (b.ts || 0)) || (r.id - b.id);
      if (newer > 0) { stale.add(b.id); best.set(k, r); } else stale.add(r.id);
    }
    return stale;
  };

  /** Ids the enabled auto-clean rules match (loaded rows only). While the bot is on, rows of its categories (BOT_CATS)
   * younger than autoBotGraceMin — or without a readable time — are left to it (it matches reports by time and deletes
   * what it processed; a result removed between two of its reads never arrives): their count goes to this.keptForBot. */
  Mail.prototype.autoMatches = function () {
    const ids = new Set();
    const kept = new Set();
    const min = parseAmount(this.set('minLoot'));
    const grace = botOn() ? Math.max(0, +this.set('autoBotGraceMin') || 0) * 60000 : 0;
    const nowTs = OGX.time.serverNow();
    const catOf = (r) => (Number.isFinite(+r.cat) && r.cat !== null && r.cat !== '' ? +r.cat : (this.cat === null ? NaN : +this.cat));
    const add = (r) => { if (grace > 0 && BOT_CATS.has(catOf(r)) && (!r.ts || nowTs - r.ts < grace)) kept.add(r.id); else ids.add(r.id); };
    for (const r of this.rows.values()) {
      if (this.set('autoCheap') && min && r.spy && r.spy.loot.total < min) add(r);
      if (this.set('autoExpEmpty') && r.exp && ['nothing', 'delay', 'speedup'].includes(r.exp.outcome)) add(r);
      if (this.set('autoSpyDetected') && r.kind === 'spy_detected') add(r);
      if (this.set('autoReturns') && r.kind === 'return_empty') add(r);
    }
    if (this.set('autoOldDup')) for (const id of this.staleIds()) { const r = this.rows.get(id); if (r) add(r); }
    this.keptForBot = kept.size;
    return [...ids];
  };
  /** Runs the rules (explicit click, or after a load when autoClean is on). One POST. */
  Mail.prototype.autoClean = async function ({ auto = false } = {}) {
    const ids = this.autoMatches();
    const kept = this.keptForBot || 0;
    if (kept) rec('B', 'autoclean:bot-grace', { kept, auto, graceMin: +this.set('autoBotGraceMin') || 0 });
    if (!ids.length) {
      if (!auto) OGX.dom.toast(kept ? 'Под правила попали только свежие письма бота (' + kept + ') — оставлены ему' : 'Под правила очистки ничего не попало', { type: 'info', ms: 6000 });
      return 0;
    }
    if (!auto && !(await this.ask('Очистка по правилам: удалить ' + ids.length + ' сообщ.?'))) return 0;
    if (!(await this.post('deletemarked', ids))) return 0;
    this.dropRows(ids);
    rec('B', 'autoclean', { n: ids.length, auto });
    OGX.dom.toast((auto ? 'Автоочистка: ' : 'Очистка: ') + 'удалено ' + ids.length, { type: 'ok' });
    return ids.length;
  };

  Mail.prototype.selectedSpy = function () { return [...this.sel].map((id) => this.rows.get(id)).filter((r) => r && r.spy && r.spy.target); };

  /** Raids on every selected report: one summary dialog, then one dispatch per target (confirm: false), stops on the first failure. */
  Mail.prototype.raidSelected = async function () {
    const list = this.selectedSpy().filter((r) => r.spy.ships > 0);
    if (!list.length) { OGX.dom.toast('Отметьте шпионские доклады с добычей', { type: 'warn' }); return; }
    const total = list.reduce((a, r) => a + r.spy.ships, 0);
    const risky = list.filter((r) => r.spy.fleet !== 0 || r.spy.def !== 0).length;
    const body = h('div', { class: 'ogx-confirm-text' },
      h('div', null, 'Рейдов: ' + list.length + ', улучшенных транспортов: ' + num(total)),
      h('div', null, 'Добыча: ' + short(list.reduce((a, r) => a + r.spy.loot.total, 0))),
      risky ? h('div', { class: 'ogx-warn-text' }, '⚠ У ' + risky + ' целей есть или не видны флот/оборона') : null);
    if (!(await OGX.dom.confirm(body, { okLabel: 'Отправить все', title: 'Массовый рейд' }))) return;
    rec('U', 'raid:bulk', { n: list.length, ships: total });
    await this.loadEnv();
    const originId = this.env.cur ? this.env.cur.id : undefined;
    const flights = list.map((r) => ({ originId, galaxy: r.spy.target.galaxy, system: r.spy.target.system, position: r.spy.target.position, type: r.spy.target.type,
      mission: 1, ships: { [this.env.ship]: r.spy.ships }, speed: 10, key: 'mail:' + r.id, source: 'infinity/mail' }));
    this.abort = new AbortController();
    let n = 0;
    this.status('Рейды: 0 из ' + list.length + '…');
    let res;
    try {
      res = await OGX.fleet.sendBatch(flights, { confirmed: true, signal: this.abort.signal, onEach: (i, rr) => { n = i + 1; this.status('Рейды: ' + n + ' из ' + list.length + (rr.success ? '' : ' (ошибка)') + '…'); } });
    } catch (e) { res = { sent: 0, failed: 1, message: String(e && e.message || e) }; }
    this.abort = null;
    this.status('');
    const bad = (res.results || []).find((x) => !x.success);
    OGX.dom.toast('Рейдов отправлено: ' + (res.sent || 0) + ' из ' + list.length + (bad ? '. Ошибка: ' + bad.message : '') + (res.aborted ? ' (остановлено)' : ''),
      { type: res.sent === list.length ? 'ok' : 'error', ms: 8000 });
  };

  /** Probes to every selected target, one after another; stops on the first failure (no slots, no probes...). */
  Mail.prototype.spySelected = async function () {
    const seen = new Set();
    const list = this.selectedSpy().filter((r) => { const k = r.spy.coordsStr + ':' + r.spy.type; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!list.length) { OGX.dom.toast('Отметьте шпионские доклады', { type: 'warn' }); return; }
    // a batch send: one summary confirmation first (John's rule: explicit click + confirm for batches)
    const per = OGX.api.spyProbes ? OGX.api.spyProbes() : null;
    const ask = 'Отправить зонды на ' + list.length + ' целей' + (per ? ' (до ' + num(per) + ' зондов на цель, сколько точно — по настройке игры)' : '') + '?';
    if (!(await OGX.dom.confirm(ask, { okLabel: 'Отправить зонды', title: 'Зонды по отмеченным' }))) { rec('U', 'spy:bulk-cancel', { n: list.length }); return; }
    rec('U', 'spy:bulk', { n: list.length });
    let ok = 0;
    for (const r of list) {
      this.status('Зонды ' + (ok + 1) + ' из ' + list.length + '…');
      const res = await this.respy(r, null, { bulk: true });
      if (!res || !res.success) { this.status(''); OGX.dom.toast('Остановлено на ' + r.spy.coordsStr + ': ' + ((res && (res.message || res.suggestion)) || '?') + '. Отправлено ' + ok + ' из ' + list.length, { type: 'error', ms: 8000 }); return; }
      ok++;
    }
    this.status('');
    OGX.dom.toast('Зонды отправлены на ' + ok + ' целей', { type: 'ok', ms: 6000 });
  };

  Mail.prototype.isFull = function () { return this.set('layout') !== 'inline'; };

  /** Totals of the visible list in the side column (spy: loot / transporters; combat: loot; all: count). */
  Mail.prototype.renderSummary = function (vis) {
    this.sumEl.textContent = '';
    const spy = vis.filter((r) => r.spy);
    const line = (k, v, cls) => h('div', { class: P + 'sline' }, h('span', null, k), h('b', { class: cls }, v));
    const items = [line('Сообщений', num(vis.length))];
    if (spy.length) {
      items.push(line('Добыча всего', short(spy.reduce((a, r) => a + r.spy.loot.total, 0)), P + 'ok'));
      items.push(line('Ул. трансп.', num(spy.reduce((a, r) => a + (r.spy.ships || 0), 0))));
      items.push(line('Без защиты', num(spy.filter((r) => r.spy.fleet === 0 && r.spy.def === 0).length)));
    }
    const cmb = vis.filter((r) => r.combat);
    if (cmb.length) items.push(line('Добыча в боях', short(cmb.reduce((a, r) => a + (r.combat.lootSum || 0), 0)), P + 'ok'));
    const ex = vis.filter((r) => r.exp);
    if (ex.length) {
      const cnt = {};
      for (const r of ex) cnt[r.exp.outcome || 'unknown'] = (cnt[r.exp.outcome || 'unknown'] || 0) + 1;
      for (const [o, n] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) items.push(line('Эксп.: ' + (EXP_LABEL[o] || o), num(n), P + 'exp-' + o));
    }
    const fl = vis.filter((r) => r.fleet && r.fleet.resources);
    if (fl.length) items.push(line('Ресурсов привезено', short(fl.reduce((a, r) => a + (r.fleet.resources.metal || 0) + (r.fleet.resources.crystal || 0) + (r.fleet.resources.deuterium || 0), 0)), P + 'ok'));
    this.sumEl.appendChild(h('div', { class: P + 'stitle' }, 'Итого на вкладке'));
    for (const i of items) this.sumEl.appendChild(i);
  };

  /** Right pane (full layout): the focused message, spy reports as a readable card. */
  Mail.prototype.renderPreview = function () {
    const el = this.previewEl;
    el.textContent = '';
    if (!this.isFull()) return;
    // the focused row, else the newest visible message as a preview (a preview is not a focus: the hotkeys do not act on it)
    const r = this.focus !== null ? this.rows.get(this.focus) : (this.vis && this.vis.length ? this.vis[0] : null);
    if (!r) { el.appendChild(h('div', { class: P + 'empty' }, 'Выберите сообщение')); return; }
    el.dataset.id = r.id;
    el.appendChild(h('div', { class: P + 'ph' },
      h('div', { class: P + 'pk' }, KIND_LABEL[r.kind] || r.subject || 'Сообщение', r.unread ? h('span', { class: P + 'n' }, 'новое') : null),
      h('div', { class: P + 'pm' }, r.from + ' · ' + r.date + (r.ts ? ' (' + OGX.fmt.ago(r.ts) + ')' : ''))));
    const s = r.spy;
    if (s) {
      const res = (k, l) => h('tr', null, h('td', null, l), h('td', { class: P + 'num' }, num(s.res[k])), h('td', { class: P + 'num ' + P + 'ok' }, num(s.loot[k])));
      const units = (o, known, word) => {
        if (!known) return h('div', { class: P + 'unk' }, word + ': зонды не увидели');
        const list = Object.entries(o || {}).filter(([, n]) => +n > 0);
        if (!list.length) return h('div', { class: P + 'ok' }, word + ': нет');
        return h('div', null, h('b', { class: P + 'bad' }, word + ':'), ' ', list.map(([id, n]) => OGX.catalog.name(+id) + ' ' + num(n)).join(', '));
      };
      el.appendChild(h('div', { class: P + 'card' },
        h('div', { class: P + 'pt' }, h('a', { href: OGX.page.url('galaxy', { galaxy: s.coords[0], system: s.coords[1] }) }, OGX.fmt.coords(s.coords, s.type)), ' ', s.name),
        h('table', { class: P + 'res' }, h('tr', null, h('th'), h('th', null, 'На планете'), h('th', null, 'Добыча 50%')),
          res('metal', 'Металл'), res('crystal', 'Кристалл'), res('deuterium', 'Дейтерий'),
          h('tr', null, h('td', null, h('b', null, 'Всего')), h('td'), h('td', { class: P + 'num ' + P + 'ok' }, h('b', null, num(s.loot.total))))),
        h('div', { class: P + 'pline' }, 'Нужно улучшенных транспортов: ', h('b', null, s.ships ? num(s.ships) : '—'), ' (запас ' + Math.round(this.env.reserve * 100) + ' %)'),
        units(s.f.ships, s.f.known && s.f.known.ships, 'Флот'),
        units(Object.fromEntries(Object.entries(s.f.defense || {}).filter(([id]) => +id < 500)), s.f.known && s.f.known.defense, 'Оборона'),
        s.counter !== null && s.counter !== undefined ? h('div', { class: P + 'pm' }, 'Шанс обнаружения зондов: ' + s.counter + ' %') : null,
        h('div', { class: P + 'pacts' },
          h('button', { class: 'ogx-btn ogx-btn-primary', disabled: !s.ships, onClick: (e) => this.raid(r, e.currentTarget) }, 'Рейд (r)'),
          h('button', { class: 'ogx-btn', onClick: (e) => this.respy(r, e.currentTarget) }, 'Шпионить (s)'),
          s.simHref ? h('a', { class: 'ogx-btn', href: s.simHref, target: '_blank' }, 'Симулятор') : null,
          OGX.missiles && typeof OGX.missiles.openLaunch === 'function' ? h('button', { class: 'ogx-btn', onClick: () => OGX.missiles.openLaunch({ coords: s.coords, planetType: s.type, report: s.f }) }, '🚀 Ракеты') : null,
          h('button', { class: 'ogx-btn ogx-btn-danger', onClick: () => this.deleteIds([r.id], 'это сообщение') }, 'Удалить (Del)'))));
    } else {
      const sum = this.summary(r);
      if (r.combat || r.exp || r.fleet) el.appendChild(h('div', { class: P + 'card ' + P + 'pline' }, sum));
      el.appendChild(h('div', { class: P + 'pacts' },
        r.combat && r.combat.detailsUrl ? h('a', { class: 'ogx-btn ogx-btn-primary', href: r.combat.detailsUrl, target: '_blank' }, 'Полный боевой доклад') : null,
        r.reply ? h('button', { class: 'ogx-btn ogx-btn-primary', onClick: () => r.reply.click() }, 'Ответить') : null,
        h('button', { class: 'ogx-btn ogx-btn-danger', onClick: () => this.deleteIds([r.id], 'это сообщение') }, 'Удалить (Del)')));
    }
    const body = this.detailRow(r, 1).querySelector('.' + P + 'body');
    el.appendChild(s ? h('details', { class: P + 'raw' }, h('summary', null, 'Доклад игры целиком'), body) : body);
  };

  // ------------------------------------------------------------------ interaction
  Mail.prototype.sortBy = function (key) {
    if (this.ui.sort === key) this.ui.dir = -this.ui.dir; else { this.ui.sort = key; this.ui.dir = key === 'coords' ? 1 : -1; }
    this.ctx.store.set('ui', this.ui);
    this.render();
  };
  Mail.prototype.toggleSel = function (id, on) {
    if (on === undefined) on = !this.sel.has(id);
    if (on) this.sel.add(id); else this.sel.delete(id);
    this.render();
  };
  Mail.prototype.selectVisible = function (on) {
    for (const r of this.vis || this.visible()) { if (on) this.sel.add(r.id); else this.sel.delete(r.id); }
    this.render();
  };
  Mail.prototype.toggleOpen = function (id) {
    if (this.open.has(id)) this.open.delete(id); else this.open.add(id);
    this.render();
  };

  Mail.prototype.onKey = function (e) {
    if (!this.root || this.root.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) {
      if (e.key === 'Escape' && t === this.qInput) { t.blur(); }
      return;
    }
    if (document.querySelector('.ogx-modal-overlay')) return;
    const vis = this.vis || [];
    const i = vis.findIndex((r) => r.id === this.focus);
    const cur = i >= 0 && this.focusByUser ? vis[i] : null;
    const move = (d) => { const n = vis[Math.max(0, Math.min(vis.length - 1, (i < 0 ? (d > 0 ? -1 : vis.length) : i) + d))]; if (n) { this.focus = n.id; this.focusByUser = true; this.render(); this.scrollFocus(); } };
    let done = true;
    switch (e.key) {
      case 'ArrowDown': case 'j': move(1); break;
      case 'ArrowUp': case 'k': move(-1); break;
      case ' ': case 'x': if (cur) this.toggleSel(cur.id); else done = false; break;
      case 'Enter': case 'o': if (cur && !this.isFull()) this.toggleOpen(cur.id); else if (cur) this.previewEl.querySelector('details') && (this.previewEl.querySelector('details').open ^= 1); else done = false; break;
      case 'Delete': case 'Backspace':
        if (this.sel.size) this.deleteIds([...this.sel], 'выбранные'); else if (cur) this.deleteIds([cur.id], 'это сообщение'); else done = false; break;
      // r / s: only on a row the user focused, and always through the dialog of raid() / respy()
      case 'r': if (cur && cur.spy) this.raid(cur, null, { hotkey: true }); else if (!cur) this.hintFocus(); else done = false; break;
      case 's': if (cur && cur.spy) this.respy(cur, null, { hotkey: true }); else if (!cur) this.hintFocus(); else done = false; break;
      case 'a': this.selectVisible(!(vis.length && vis.every((r) => this.sel.has(r.id)))); break;
      case '/': this.qInput.focus(); break;
      case 'Escape': if (this.abort) this.abort.abort(); this.sel.clear(); this.focus = null; this.focusByUser = false; this.render(); break;
      default: done = false;
    }
    if (done) e.preventDefault();
  };
  Mail.prototype.hintFocus = function () {
    OGX.dom.toast('Сначала выберите доклад: ↑↓ / j k или клик по строке', { type: 'info', ms: 3000 });
  };
  Mail.prototype.scrollFocus = function () {
    const el = this.listEl.querySelector('.' + P + 'focus');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  };

  // ------------------------------------------------------------------ actions
  Mail.prototype.ask = async function (text) {
    if (this.set('confirmDelete') === false) return true;
    return OGX.dom.confirm(text, { okLabel: 'Удалить', danger: true, title: 'Почта' });
  };

  /** Native form POST: { mode: action, ajax: 1, messcat, side: 1, actionTop, submitTop: Confirm, messageID[id]: 1 ... }. */
  Mail.prototype.post = async function (action, ids) {
    const form = { mode: 'action', ajax: '1', messcat: String(this.cat === null ? 100 : this.cat), side: '1', actionTop: action, submitTop: 'Confirm' };
    for (const id of ids || []) form['messageID[' + id + ']'] = '1';
    let r;
    try { r = await this.wAction(form); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    rec('B', 'action', { action, n: (ids || []).length, cat: this.cat, ok: !!(r && r.ok) });
    if (!r || !r.ok) { OGX.dom.toast('Сервер не принял действие: ' + ((r && (r.error || r.status)) || '?'), { type: 'error' }); return false; }
    // other modules (the bot's read cache of the message lists): the mailbox changed behind their back
    if (/^delete/i.test(action)) { try { OGX.bus.emit('messages:deleted', { cat: this.cat === null ? 100 : this.cat, ids: (ids || []).map(Number), source: 'infinity/mail' }); } catch (e) { /* ignore */ } }
    return true;
  };

  Mail.prototype.dropRows = function (ids) {
    for (const id of ids) {
      const r = this.rows.get(id);
      if (r && r.head) { const b = r.head.nextElementSibling; if (b && b.matches('tr.messages_body')) b.remove(); r.head.remove(); }
      this.rows.delete(id); this.sel.delete(id); this.open.delete(id);
    }
    const c = this.cats.find((x) => x.cat === this.cat);
    if (c) c.total = Math.max(0, c.total - ids.length);
    const all = this.cats.find((x) => x.cat === 100);
    if (all && all !== c) all.total = Math.max(0, all.total - ids.length);
    this.render();
  };

  Mail.prototype.deleteIds = async function (ids, what) {
    ids = ids.filter((id) => this.rows.has(id));
    if (!ids.length) { OGX.dom.toast('Ничего не выбрано', { type: 'warn' }); return false; }
    if (!(await this.ask('Удалить ' + (ids.length > 1 ? ids.length + ' сообщ.' : what) + '?'))) return false;
    if (!(await this.post('deletemarked', ids))) return false;
    this.dropRows(ids);
    OGX.dom.toast('Удалено: ' + ids.length, { type: 'ok' });
    return true;
  };

  Mail.prototype.deleteCheap = async function () {
    const min = parseAmount(this.set('minLoot'));
    if (!min) { OGX.dom.toast('Укажите «Добыча от» — доклады с меньшей добычей будут удалены', { type: 'warn', ms: 5000 }); return; }
    const ids = [...this.rows.values()].filter((r) => r.spy && r.spy.loot.total < min).map((r) => r.id);
    if (!ids.length) { OGX.dom.toast('Нет докладов с добычей меньше ' + short(min), { type: 'info' }); return; }
    if (!(await this.ask('Удалить ' + ids.length + ' шпионских докладов с добычей меньше ' + short(min) + '?'))) return;
    if (await this.post('deletemarked', ids)) { this.dropRows(ids); OGX.dom.toast('Удалено: ' + ids.length, { type: 'ok' }); }
  };

  Mail.prototype.deleteOld = async function () {
    const hrs = +this.set('ageHours') || 24;
    const now = OGX.time.serverNow();
    const ids = [...this.rows.values()].filter((r) => r.ts && now - r.ts > hrs * HOUR).map((r) => r.id);
    if (!ids.length) { OGX.dom.toast('Нет загруженных сообщений старше ' + hrs + ' ч', { type: 'info' }); return; }
    if (!(await this.ask('Удалить ' + ids.length + ' сообщ. старше ' + hrs + ' ч?'))) return;
    if (await this.post('deletemarked', ids)) { this.dropRows(ids); OGX.dom.toast('Удалено: ' + ids.length, { type: 'ok' }); }
  };

  Mail.prototype.deleteCategory = async function () {
    if (this.cat === null) return;
    const c = this.cats.find((x) => x.cat === this.cat);
    const label = c ? c.label : String(this.cat);
    const total = c ? c.total : this.rows.size;
    // always asked, whatever confirmDelete says: this one also removes pages that are not loaded
    const ok = await OGX.dom.confirm('Удалить ВСЕ сообщения вкладки «' + label + '» на сервере (' + total + ' шт., включая незагруженные страницы)?', { okLabel: 'Удалить всё', danger: true, title: 'Почта' });
    if (!ok) return;
    const action = this.cat === 100 ? 'deleteall' : 'deletetypeall';
    if (!(await this.post(action, []))) return;
    const ids = [...this.rows.keys()];
    this.dropRows(ids);
    if (c) c.total = 0;
    this.pages = { loaded: 0, total: 0 };
    this.render();
  };

  Mail.prototype.bulk = async function (action) {
    const ids = [...this.sel].filter((id) => this.rows.has(id));
    if (!ids.length) { OGX.dom.toast('Ничего не выбрано', { type: 'warn' }); return; }
    if (!(await this.post(action, ids))) return;
    for (const id of ids) { const r = this.rows.get(id); if (r) r.unread = false; }
    this.sel.clear();
    this.render();
  };

  /** Raid: Battle Transporters only (John's rule), enough for the whole 50 % loot + reserve. A single raid (row button, preview
   * button, hotkey r) first shows its own dialog with the plan — target, transporters, loot, transporters on the planet, fleet /
   * defence seen or not — whatever core.confirmActions says, and then dispatches through fleet.sendBatch(confirmed) (no second
   * dialog). Bulk raids (raidSelected) have their one summary dialog instead (bulk: true). */
  Mail.prototype.raid = async function (r, btn, { bulk = false, hotkey = false } = {}) {
    const s = r && r.spy;
    if (!s || !s.target) return;
    await this.loadEnv();
    const d = this.derive(s.f);
    if (!d || !d.ships) { OGX.dom.toast('Нечего вывозить или неизвестен трюм улучшенного транспорта', { type: 'warn' }); return; }
    const originId = this.env.cur ? this.env.cur.id : undefined;
    if (!bulk) {
      const ok = await this.confirmRaid(d, originId, hotkey);
      rec('U', 'raid:confirm', { id: r.id, coords: d.coordsStr, n: d.ships, ok, hotkey });
      if (!ok) return { success: false, cancelled: true, message: 'Отменено' };
    }
    rec('U', 'raid', { id: r.id, coords: d.coordsStr, n: d.ships, ship: this.env.ship, hotkey });
    if (btn) btn.disabled = true;
    let res;
    try {
      res = await this.wSend({ galaxy: d.target.galaxy, system: d.target.system, position: d.target.position, type: d.target.type,
        mission: 1, ships: { [this.env.ship]: d.ships }, speed: 10, cargo: { metal: 0, crystal: 0, deuterium: 0 },
        originId, key: 'mail:' + r.id, source: 'infinity/mail' });
    } catch (e) { res = { success: false, message: String(e && e.message || e) }; }
    if (btn) btn.disabled = false;
    if (bulk) return res;
    OGX.dom.toast(res && res.success ? 'Рейд отправлен: ' + num(d.ships) + ' ул. трансп. на ' + OGX.fmt.coords(d.coords, d.type) : 'Рейд не отправлен: ' + ((res && res.message) || '?'),
      { type: res && res.success ? 'ok' : 'error', ms: 6000 });
    return res;
  };

  /** The dialog of a single raid: the plan and the warnings. true = «Отправить». */
  Mail.prototype.confirmRaid = async function (d, originId, hotkey) {
    const risky = d.fleet !== 0 || d.def !== 0;
    const what = [d.fleet === null ? 'флот не виден в докладе' : d.fleet ? 'флот ' + short(d.fleet) : null,
      d.def === null ? 'оборона не видна в докладе' : d.def ? 'оборона ' + short(d.def) : null].filter(Boolean).join(', ');
    // transporters on the origin (state of the last read; only when the ships of that body were read at all)
    // and the deuterium for the flight (the same pre-check as fleet.send, which sendBatch(confirmed) does not run)
    let have = null;
    let fuel = null;
    try {
      const bodies = await OGX.state.bodies();
      const origin = originId ? Object.values(bodies || {}).find((b) => b && b.id === originId) : null;
      if (origin && origin.shipsT && origin.ships) have = +origin.ships[this.env.ship] || 0;
      if (origin && origin.coords && origin.res) {
        const est = await OGX.fleet.estimate({ from: origin.coords, to: d.coordsStr, ships: { [this.env.ship]: d.ships }, mission: 1, speedPct: 10 });
        const p = OGX.state.projected(origin).res;
        const deut = p && p.deuterium ? p.deuterium.amount : null;
        if (deut !== null && est && est.fuelBudget > deut) fuel = { need: est.fuelBudget, have: deut };
      }
    } catch (e) { fuel = null; }
    const body = h('div', { class: 'ogx-confirm-text' },
      h('div', null, 'Рейд → ' + OGX.fmt.coords(d.coords, d.type) + (d.name ? ' ' + d.name : '')),
      h('div', null, 'Улучшенных транспортов: ' + num(d.ships) + ' × ' + num(this.env.cargo) + ', скорость 100 %'),
      h('div', null, 'Добыча 50 %: ' + short(d.loot.total) + ' (М ' + short(d.loot.metal) + ' · К ' + short(d.loot.crystal) + ' · Д ' + short(d.loot.deuterium) + ')'),
      have !== null && have < d.ships ? h('div', { class: 'ogx-warn-text' }, '⚠ На планете ' + num(have) + ' из ' + num(d.ships) + ' транспортов') : null,
      fuel ? h('div', { class: 'ogx-warn-text' }, '⚠ Дейтерия может не хватить: нужно ~' + num(fuel.need) + ', есть ' + num(fuel.have)) : null,
      risky ? h('div', { class: 'ogx-warn-text' }, '⚠ У цели: ' + what + '. Транспорты без прикрытия могут быть уничтожены') : null,
      hotkey ? h('div', { class: P + 'pm' }, 'Вызвано клавишей r') : null);
    return askSafe(body, { okLabel: 'Отправить', danger: risky, title: 'Рейд' });
  };

  /** OGX.dom.confirm with the keyboard focus on «Отмена»: dom.modal focuses the primary button, and in the mail Space / Enter are
   * row keys too, so a stray r or s followed by Space / Enter must cancel, not send. The click on the OK button still sends. */
  function askSafe(body, opts) {
    const p = OGX.dom.confirm(body, opts);
    // queued after dom.modal's own focus timer (same tick), so it wins
    setTimeout(() => {
      try {
        const boxes = document.querySelectorAll('.ogx-modal-overlay .ogx-modal');
        const box = boxes[boxes.length - 1];
        const c = box && box.querySelector('[data-role="cancel"]');
        if (c) c.focus();
      } catch (e) { /* ignore */ }
    }, 0);
    return p;
  }

  /** Probes to the report's target. A single send (row button, preview button, hotkey s) asks first; bulk sends (spySelected)
   * had their summary dialog. */
  Mail.prototype.respy = async function (r, btn, { bulk = false, hotkey = false } = {}) {
    const s = r && r.spy;
    if (!s || !s.target) return;
    if (!bulk) {
      const per = OGX.api.spyProbes ? OGX.api.spyProbes() : null;
      const ok = await askSafe('Отправить зонды на ' + OGX.fmt.coords(s.coords, s.type) + (s.name ? ' ' + s.name : '')
        + (per ? ' (до ' + num(per) + ' зондов, сколько точно — по настройке игры)' : '') + '?', { okLabel: 'Отправить зонды', title: 'Шпионаж' });
      rec('U', 'spy:confirm', { id: r.id, coords: s.coordsStr, ok, hotkey });
      if (!ok) return { success: false, cancelled: true, message: 'Отменено' };
    }
    if (btn) btn.disabled = true;
    let res;
    try { res = await this.wSpy({ mission: 6, galaxy: s.target.galaxy, system: s.target.system, position: s.target.position, type: s.target.type }); } catch (e) { res = { success: false, message: String(e && e.message || e) }; }
    if (btn) btn.disabled = false;
    rec('U', 'spy', { id: r.id, coords: s.coordsStr, ok: !!(res && res.success) });
    if (bulk) return res;
    const o = res && res.success && res.origin && !res.origin.current && res.origin.coords ? res.origin : null;
    OGX.dom.toast(res && res.success ? 'Зонды отправлены на ' + OGX.fmt.coords(s.coords, s.type) + (o ? ' с ' + (o.name ? o.name + ' ' : '') + '[' + o.coords + ']' : '') : 'Зонды не отправлены: ' + ((res && (res.message || res.suggestion)) || '?'),
      { type: res && res.success ? 'ok' : 'warn', ms: 6000 });
    return res;
  };

  Mail._test = { parseAmount };
  OGX.mailTest = Mail._test;

  // ================================================================== CSS
  const CSS = `
html.ogx-mail-on .${P}hidden { display: none !important; }
html.ogx-mail-full, html.ogx-mail-full body { overflow: hidden !important; }
.${P}full { position: fixed; inset: 0; z-index: 8000; margin: 0 !important; border-radius: 0; border: 0; display: flex; flex-direction: column; padding: 0 !important; }
.${P}head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 6px 0; }
.${P}full .${P}head { padding: 8px 12px; background: var(--ogx-panel-2, #1b2430); border-bottom: 1px solid var(--ogx-border, #2a3442); }
.${P}title { font-size: 15px; font-weight: bold; color: var(--ogx-text, #fff); margin-right: 6px; }
.${P}sp { flex: 1; }
.${P}close { text-decoration: none; }
.${P}main { display: flex; gap: 8px; align-items: flex-start; }
.${P}full .${P}main { flex: 1; min-height: 0; align-items: stretch; gap: 0; }
.${P}side { width: 150px; flex: none; }
.${P}full .${P}side { width: 190px; padding: 8px; border-right: 1px solid var(--ogx-border, #2a3442); overflow: auto; }
.${P}side .${P}tabs { flex-direction: column; }
.${P}side .${P}tab { justify-content: space-between; width: 100%; text-align: left; }
.${P}center { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.${P}full .${P}center { padding: 0 8px 8px; }
.${P}full .${P}list { flex: 1; max-height: none; min-height: 0; }
.${P}preview { display: none; }
.${P}full .${P}preview { display: block; width: 40%; min-width: 360px; max-width: 640px; flex: none; overflow: auto; padding: 10px 14px; border-left: 1px solid var(--ogx-border, #2a3442); background: var(--ogx-panel, #111820); }
.${P}ph { margin-bottom: 8px; }
.${P}pk { font-size: 14px; font-weight: bold; display: flex; gap: 8px; align-items: center; }
.${P}pm { color: var(--ogx-muted, #9aa6b5); font-size: 11px; margin-top: 2px; }
.${P}pt { font-size: 14px; margin-bottom: 6px; }
.${P}pt a { color: var(--ogx-accent, #6cb6ff); }
.${P}card { background: var(--ogx-bg, #0d1218); border: 1px solid var(--ogx-border, #2a3442); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
.${P}card > div { margin-top: 4px; }
.${P}res { border-collapse: collapse; width: 100%; }
.${P}res th { color: var(--ogx-muted, #9aa6b5); font-weight: normal; text-align: right; padding: 2px 6px; }
.${P}res td { padding: 2px 6px; }
.${P}pacts { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.${P}pacts .ogx-btn { text-decoration: none; }
.${P}raw summary { cursor: pointer; color: var(--ogx-muted, #9aa6b5); margin: 6px 0; }
.${P}sum { margin-top: 12px; border-top: 1px solid var(--ogx-border, #2a3442); padding-top: 8px; font-size: 11px; }
.${P}stitle { color: var(--ogx-muted, #9aa6b5); margin-bottom: 4px; }
.${P}auto { margin-top: 12px; border-top: 1px solid var(--ogx-border, #2a3442); padding-top: 8px; font-size: 11px; display: flex; flex-direction: column; gap: 3px; }
.${P}auto .ogx-btn { margin-top: 4px; }
.${P}table td { text-align: left; }
.${P}table td.${P}num { text-align: right; }
.${P}table td.${P}acts { text-align: right; }
.${P}sline { display: flex; justify-content: space-between; gap: 6px; padding: 1px 0; }
.${P}root { margin: 0 0 10px; font: 12px/1.35 Verdana, Arial, sans-serif; color: var(--ogx-text, #d8dde6); background: var(--ogx-bg, #0d1218);
  border: 1px solid var(--ogx-border, #2a3442); border-radius: 6px; padding: 8px; text-align: left; box-sizing: border-box; width: 100%; }
.${P}root * { box-sizing: border-box; }
.${P}back { margin: 0 0 8px; }
.${P}back[hidden], .${P}root[hidden] { display: none !important; }
.${P}top { display: flex; gap: 6px; align-items: flex-start; }
.${P}tabs { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
.${P}tab { background: var(--ogx-panel, #151c25); color: var(--ogx-muted, #9aa6b5); border: 1px solid var(--ogx-border, #2a3442); border-radius: 4px;
  padding: 4px 8px; cursor: pointer; font: inherit; display: inline-flex; gap: 5px; align-items: center; }
.${P}tab:hover { color: var(--ogx-text, #d8dde6); border-color: var(--ogx-accent, #4aa3ff); }
.${P}tab-on { background: var(--ogx-accent, #4aa3ff); color: #fff; border-color: var(--ogx-accent, #4aa3ff); }
.${P}tab-new { color: var(--ogx-text, #fff); font-weight: bold; }
.${P}n { background: var(--ogx-bad, #e5534b); color: #fff; border-radius: 8px; padding: 0 5px; font-size: 10px; }
.${P}t { opacity: .6; font-size: 10px; }
.${P}bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
.${P}q { flex: 1 1 200px; min-width: 160px; }
.${P}minloot { width: 90px; }
.${P}grp, .${P}chk { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
.${P}count { color: var(--ogx-muted, #9aa6b5); min-width: 60px; }
.${P}status { color: var(--ogx-muted, #9aa6b5); }
.${P}status[data-type="bad"] { color: var(--ogx-bad, #e5534b); }
.${P}list { margin-top: 8px; max-height: 70vh; overflow: auto; }
.${P}table { width: 100%; border-collapse: collapse; table-layout: auto; }
.${P}table th { position: sticky; top: 0; background: var(--ogx-panel-2, #1b2430); color: var(--ogx-muted, #9aa6b5); font-weight: normal; text-align: left; padding: 4px 5px; white-space: nowrap; z-index: 1; }
.${P}sort { cursor: pointer; user-select: none; }
.${P}sorted { color: var(--ogx-text, #fff) !important; }
.${P}table td { padding: 3px 5px; border-top: 1px solid var(--ogx-border, #222c38); vertical-align: middle; }
.${P}row { cursor: pointer; }
.${P}row:hover td { background: rgba(74,163,255,.07); }
.${P}unread td { font-weight: bold; }
.${P}unread td.${P}cb { box-shadow: inset 3px 0 0 var(--ogx-accent, #4aa3ff); }
.${P}sel td { background: rgba(74,163,255,.15) !important; }
.${P}focus td { outline: 1px solid var(--ogx-accent, #4aa3ff); outline-offset: -1px; }
.${P}muted td { color: var(--ogx-muted, #9aa6b5); font-weight: normal; }
.${P}cb { width: 22px; }
.${P}num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.${P}loot { color: var(--ogx-ok, #57c26e); }
.${P}time { white-space: nowrap; color: var(--ogx-muted, #9aa6b5); }
.${P}target { white-space: nowrap; }
.${P}target a { color: var(--ogx-accent, #6cb6ff); }
.${P}name { color: var(--ogx-muted, #9aa6b5); }
.${P}kind { white-space: nowrap; color: var(--ogx-muted, #9aa6b5); }
.${P}txt { word-break: break-word; }
.${P}acts { white-space: nowrap; text-align: right; }
.${P}acts .ogx-btn { padding: 1px 6px; margin-left: 2px; font-size: 11px; text-decoration: none; display: inline-block; }
.${P}ok { color: var(--ogx-ok, #57c26e); }
.${P}bad { color: var(--ogx-bad, #e5534b); }
.${P}unk { color: var(--ogx-warn, #e0b341); }
.${P}detail td { background: var(--ogx-panel, #111820); padding: 6px 8px 10px 28px; cursor: default; font-weight: normal; }
.${P}body { max-height: 420px; overflow: auto; }
.${P}empty { padding: 20px; text-align: center; color: var(--ogx-muted, #9aa6b5); }
.${P}more { margin-top: 6px; text-align: center; }
.${P}keys { margin-top: 6px; font-size: 10px; color: var(--ogx-muted, #7d8896); }
.${P}exp-resources, .${P}exp-darkmatter, .${P}exp-ships, .${P}exp-speedup { color: var(--ogx-ok, #57c26e); }
.${P}exp-battle_pirates, .${P}exp-battle_aliens, .${P}exp-fleet_lost { color: var(--ogx-bad, #e5534b); }
.${P}exp-delay, .${P}exp-nothing { color: var(--ogx-muted, #9aa6b5); }
`;
})(window.OGX);
