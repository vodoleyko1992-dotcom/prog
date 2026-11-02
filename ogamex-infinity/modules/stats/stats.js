/* ogamex-infinity/modules/stats/stats.js — Owner: infinity/stats.
 * Statistics and message analysis (DESIGN §4.2.5).
 *   - Passive collection on /messages: OGX.messages.watch → every li.msg of the subtab panels combat_reports (#ui-id-16),
 *     expeditions (#ui-id-18), transport (#ui-id-20), other (#ui-id-22) and the economy tab (#ui-id-6) is classified
 *     (OGX.messages.classify, messages.md §3.4) and parsed with the core recipes (battleShort, expedition, fleetMessage).
 *     The communication tab is ignored: it holds static demo messages (ctab:604-700, messages.md §3.3).
 *   - Optional full combat reports (`fetchFullCombat`, default off): GET /ajax/messages/<id>?tab=fleets&subtab=combat_reports
 *     (routes/web.php:170, MessagesController::ajaxGetMessage) through the polite background queue, parsed with
 *     OGX.messages.parse.battleFull (exact loot/debris split, units lost, moon created). Reports the user opens in the
 *     game overlay are captured from the page XHR through the bridge.
 *   - «Сканировать сообщения» (explicit click + warning: reading marks messages as read, MessageService.php:208-212,
 *     messages.md §1): walks GET /ajax/messages?tab=…&subtab=…&pagination=N (routes/web.php:168; the parameter is
 *     `pagination`, MessagesController.php:136) for combat_reports, expeditions, transport, other and economy/economy
 *     (economy needs subtab=economy, messages.md §3.3), page by page until a page has only known ids (or all pages).
 *   - Tab «Статистика» (order 50): period selector, sections Бои / Экспедиции / Переработка / Транспорт (+ прочее),
 *     a daily bar chart (inline SVG) of the selected section.
 *   - Message analysis: a badge inside each analysed li (before message-footer.msg_actions, fleets/subtab.blade.php:53-56)
 *     and a per-page summary line at the top of ul.tab_inner of each panel.
 * OgameX facts used (messages.md §5, §7, §8): the battle list form has the winner as the class of the attacker span
 * (undermark = attacker won, middlemark = draw, overmark = defender won, BattleReport.php:395-429), losses in resource
 * units (formatNumberLong, exact < 1 Mn), loot sum formatNumberShort (lossy), debris sum, moon chance (row omitted when a
 * moon existed). Expedition battles: attacker "Pirates"/"Aliens", defender = me (ExpeditionMission.php:833-913).
 * `rawMessageData[data-raw-*]` is a static fake and never read (messages.md §5.4).
 * Writes: stats.combat, stats.expeditions, stats.fleet ({ v:1, items:{ [msgId]: record } }, each cap 20 000, oldest
 * dropped; storage mergers: union by id, the full combat record wins) and the settings stats.*.
 * Local helpers (not in core): SVG element builder (OGX.dom.h creates HTML elements only), server-day arithmetic.
 *
 * GALAXYZ (ogamex.eu/Aeternum, 2Moons 1.8 fork). Only spy reports were saved live; combat, expedition, transport and
 * return messages are [UPSTREAM] 2Moons templates (records carry `unverified: true`, the tab says so):
 *   - Rows: tr.message_head + tr.messages_body in #messagestable; MessageItem gives id/kind/key/body (no data-msg-id).
 *     Categories 3 combat (-> combat_reports), 15 expedition, 5 transport (transport, recycle, deploy), 4 system (returns,
 *     colonisation). Spy (0), construction (99), game (50) and player messages are ignored.
 *   - Combat list message: winner/my result by the raportWin/raportLose class, losses of both sides, loot and debris per
 *     resource (exact numbers); no names, no moon chance. Full report = page=raport popup (opt-in `fetchFullCombat`,
 *     messages.full -> battleFull shape, res.full; report id from the row).
 *   - Expedition results carry no amounts: the resources and dark matter arrive in the return message of the expedition
 *     fleet (kind return_expedition*, category 4); those are counted as the expedition find (expReturn records).
 *   - Missile impact: count, intercepted and destroyed defence from core parse.fleetMessage.
 *   - Scan: GET page=messages&mode=view&messcat=3|15|5|4&site=N&ajax=1 (marks the listed messages read; explicit click).
 *   - Badges go into the body cell; the per-page summary is a table row above the first message.
 */
(function (OGX) {
  'use strict';

  const NAME = 'stats';
  const P = 'ogx-i-stats-';
  const PANEL_ID = 'infinity';
  const RES = ['metal', 'crystal', 'deuterium'];
  const CAP = 20000;
  const DAY = 86400000;
  const KEYS = { combat: 'combat', exp: 'expeditions', fleet: 'fleet' };
  const SUBTABS = ['combat_reports', 'expeditions', 'transport', 'other', 'economy'];
  const SCAN_LIST = [['fleets', 'combat_reports'], ['fleets', 'expeditions'], ['fleets', 'transport'], ['fleets', 'other'], ['economy', 'economy']];
  const SCAN_MAX_PAGES = 100;
  const NPC = new Set(['Pirates', 'Aliens']); // ExpeditionMission.php: attacker ids -1/-2
  const isGz = () => !!(OGX.page && OGX.page.isGz && OGX.page.isGz());
  // GALAXYZ categories scanned (messcat) and the OgameX subtab aliases they map to (messages.gz.aliasOf)
  const GZ_SCAN = [[3, 'combat_reports'], [15, 'expeditions'], [5, 'transport'], [4, 'other']];
  // GALAXYZ native kinds this module records (others of the same aliases — construction, game, system — are ignored)
  const GZ_COMBAT = new Set(['combat', 'combat_expedition', 'missile']);
  const GZ_FLEET = new Set(['transport_arrival', 'transport_received', 'recycle', 'deploy_arrival', 'return', 'return_empty', 'return_expedition', 'return_expedition_dm', 'colonisation']);
  // OgameX expedition keys -> outcome (GALAXYZ native outcomes are named differently: darkmatter, battle_pirates, ...)
  const EXP_OUTCOME = {
    expedition_gain_resources: 'resources', expedition_gain_dark_matter: 'dark_matter', expedition_gain_ships: 'ships', expedition_gain_item: 'item',
    expedition_merchant: 'merchant', expedition_failed: 'nothing', expedition_failed_and_delay: 'delay', expedition_failed_and_speedup: 'speedup',
    expedition_battle_pirates: 'pirates', expedition_battle_aliens: 'aliens', expedition_loss_of_fleet: 'fleet_lost', expedition_unknown: 'unknown',
  };

  const OUTCOMES = ['resources', 'dark_matter', 'ships', 'item', 'merchant', 'nothing', 'delay', 'speedup', 'pirates', 'aliens', 'battle', 'fleet_lost', 'unknown'];
  const OUTCOME_RU = {
    resources: 'Ресурсы', dark_matter: 'Тёмная материя', ships: 'Корабли', item: 'Предмет', merchant: 'Торговец',
    nothing: 'Ничего', delay: 'Задержка', speedup: 'Ускорение', pirates: 'Пираты', aliens: 'Чужие', battle: 'Бой',
    fleet_lost: 'Чёрная дыра', unknown: 'Не распознано',
  };
  const OUTCOME_CLS = { resources: 'good', dark_matter: 'good', ships: 'good', item: 'good', merchant: 'neutral', nothing: 'neutral', delay: 'warn', speedup: 'good', pirates: 'bad', aliens: 'bad', battle: 'bad', fleet_lost: 'bad', unknown: 'neutral' };
  const ROLE_RU = { attack: 'Атака', defense: 'Защита', expedition: 'Экспедиция', other: 'Чужой бой' };
  const RESULT_RU = { win: 'Победа', loss: 'Поражение', draw: 'Ничья', unknown: '?' };
  const FLEET_KEY_RU = {
    transport_arrived: 'Транспорт доставлен', transport_received: 'Получено от игрока', return_of_fleet_with_resources: 'Возврат с ресурсами',
    return_of_fleet: 'Возврат флота', fleet_deployment_with_resources: 'Оставлен с ресурсами', fleet_deployment: 'Оставлен',
    debris_field_harvest: 'Переработка', acs_defend_arrival_sender: 'Флот прибыл (удержание)', acs_defend_arrival_host: 'Чужой флот на удержании',
    fleet_union_invite: 'Приглашение в САБ', colony_established: 'Колония основана', colony_establish_fail_astrophysics: 'Колонизация не удалась',
    planet_relocation_success: 'Планета перемещена', wreck_field_repair_completed: 'Обломки флота восстановлены', unknown: 'Не распознано',
    colonisation: 'Колонизация',
  };
  const ECONOMY_KEYS = new Set(['colony_established', 'colony_establish_fail_astrophysics', 'planet_relocation_success', 'wreck_field_repair_completed']);
  const PERIODS = [
    { value: 'today', label: 'Сегодня' }, { value: 'yesterday', label: 'Вчера' }, { value: '7d', label: '7 дней' },
    { value: '30d', label: '30 дней' }, { value: 'all', label: 'Всё время' }, { value: 'custom', label: 'Свой интервал' },
  ];
  const SECTIONS = [
    { value: 'combat', label: 'Бои', metric: 'Чистый итог боёв (ЕМ)' },
    { value: 'expeditions', label: 'Экспедиции', metric: 'Найдено ресурсов в экспедициях (ЕМ)' },
    { value: 'harvest', label: 'Переработка', metric: 'Переработано (ЕМ)' },
    { value: 'transport', label: 'Транспорт', metric: 'Получено от игроков и возвращено с ресурсами (ЕМ)' },
  ];

  const rec = (src, what, data) => { try { return OGX.log.rec(src, NAME, what, data); } catch (e) { return null; } };
  const learnValue = (name, v, o) => { try { return OGX.learn ? OGX.learn.value(name, v, o) : true; } catch (e) { return true; } };
  const learnCheck = (name, o) => { try { return OGX.learn ? OGX.learn.check(name, o) : true; } catch (e) { return true; } };
  const h = (...a) => OGX.dom.h(...a);
  const num = (n) => OGX.fmt.num(Math.round(n || 0));
  const short = (n) => OGX.fmt.short(Math.round(n || 0));
  const zeroRes = () => ({ metal: 0, crystal: 0, deuterium: 0 });
  const addRes = (a, b) => { if (b) for (const k of RES) a[k] += +b[k] || 0; return a; };
  const resTotal = (r) => (r ? RES.reduce((s, k) => s + (+r[k] || 0), 0) : 0);
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const clone = (o) => JSON.parse(JSON.stringify(o));

  OGX.module({
    name: NAME,
    title: 'Статистика и анализ сообщений',
    pages: '*',
    settings: {
      fetchFullCombat: { type: 'bool', default: false, label: 'Загружать полные боевые доклады', hint: 'Точная добыча, обломки и потери. OgameX: открытие доклада помечает его прочитанным; GALAXYZ: один запрос page=raport на бой (без дейтерия)' },
      defaultPeriod: { type: 'enum', default: '7d', label: 'Период по умолчанию', options: PERIODS.filter((p) => p.value !== 'custom') },
      msuRates: { type: 'string', default: '', label: 'Курс для единиц металла (М:К:Д)', hint: 'Например 1:2:4 или 1:1.5:3 (по металлу). Пусто = курс торговца сервера (Aeternum 1:2:4). Используется и в «Шпионаже»' },
      showBadges: { type: 'bool', default: true, label: 'Значки анализа в списке сообщений' },
      showSummary: { type: 'bool', default: true, label: 'Итог по странице над списком сообщений' },
      period: { type: 'string', default: '', hidden: true, label: 'Выбранный период' },
      customFrom: { type: 'string', default: '', hidden: true, label: 'Период: с' },
      customTo: { type: 'string', default: '', hidden: true, label: 'Период: по' },
      chart: { type: 'enum', default: 'expeditions', hidden: true, label: 'График', options: SECTIONS.map((s) => ({ value: s.value, label: s.label })) },
    },
    async init(ctx) {
      const s = new Stats(ctx);
      ctx._stats = s;
      await s.start();
    },
    dispose(ctx) { if (ctx._stats) ctx._stats.stop(); },
  });

  // ================================================================== storage shapes
  function migrate(v) {
    if (!v || typeof v !== 'object' || v.v !== 1 || !v.items || typeof v.items !== 'object') return { v: 1, items: {} };
    return v;
  }
  function prune(o) {
    const ids = Object.keys(o.items);
    if (ids.length > CAP) {
      ids.sort((a, b) => ((o.items[b] && o.items[b].t) || 0) - ((o.items[a] && o.items[a].t) || 0));
      for (const id of ids.slice(CAP)) delete o.items[id];
    }
    return o;
  }
  /** Union by id; for combat a full report wins over a short one, otherwise the newer write (`at`) wins. */
  function mergeStore(old, imported) {
    const a = migrate(old), b = migrate(imported);
    const out = { v: 1, items: Object.assign({}, a.items) };
    for (const [id, r] of Object.entries(b.items)) {
      const cur = out.items[id];
      if (!cur) { out.items[id] = r; continue; }
      if (cur.full && !r.full) continue;
      if (r.full && !cur.full) { out.items[id] = Object.assign({}, cur, r); continue; }
      if ((r.at || 0) > (cur.at || 0)) out.items[id] = r;
    }
    return prune(out);
  }
  let mergersDone = false;
  function registerMergers() {
    if (mergersDone || !OGX.storage || !OGX.storage.registerMerger) return;
    mergersDone = true;
    for (const k of Object.values(KEYS)) OGX.storage.registerMerger(NAME + '.' + k, mergeStore);
  }

  // ================================================================== local helpers
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, ...children) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
    for (const c of children) if (c !== null && c !== undefined) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
  }
  const tz = () => (OGX.time && Number.isFinite(+OGX.time.tzOffsetMs) ? +OGX.time.tzOffsetMs : 0);
  /** Server-wall day index of a ServerMs. */
  const dayIdx = (ms) => Math.floor((ms + tz()) / DAY);
  const dayStart = (idx) => idx * DAY - tz();
  const dayLabel = (idx) => { const d = new Date(idx * DAY); return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
  const isoDay = (idx) => new Date(idx * DAY).toISOString().slice(0, 10);
  const parseIsoDay = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY) : null; };
  function parseRates(s) {
    const a = String(s || '').split(/[:;/ ]+/).map((x) => parseFloat(String(x).replace(',', '.')));
    return a.length === 3 && a.every((x) => Number.isFinite(x) && x > 0) ? a : null;
  }
  function placeMini(p) {
    if (!p) return null;
    const c = p.coordsStr || (Array.isArray(p.coords) ? p.coords.join(':') : p.coords || null);
    return { coords: c, type: p.planetType || 1, kind: p.type || null, name: p.name || null };
  }
  const posOf = (c) => { const m = String(c || '').match(/:(\d+)$/); return m ? +m[1] : null; };

  // ================================================================== Stats
  function Stats(ctx) {
    this.ctx = ctx;
    this.log = ctx.log;
    this.data = { combat: { v: 1, items: {} }, exp: { v: 1, items: {} }, fleet: { v: 1, items: {} } };
    this.pending = { combat: {}, exp: {}, fleet: {} };
    this.flushSoon = OGX.util.debounce(OGX.safe(() => this.flush(), 'stats:flush'), 150);
    this.refreshSoon = OGX.util.debounce(OGX.safe(() => this.refresh(), 'stats:refresh'), 200);
    this.badges = new Map();     // msgId -> { li, el, kind }
    this.summaries = new Map();  // ul.tab_inner -> { el, subtab, ids:Set }
    this.summarySoon = OGX.util.debounce(OGX.safe(() => this.updateSummaries(), 'stats:summary'), 120);
    this.queue = [];
    this.queued = new Set();
    this.busy = false;
    this.scanning = null;
    this.offs = [];
    this.me = { name: null, coords: new Set() };
    this.collected = { combat: 0, exp: 0, fleet: 0 };
    // Every add-on action is a timed B event (CORE_API §21.1).
    this.wList = OGX.log.wrap(NAME, (tab, subtab, page) => OGX.messages.fetchList(tab, subtab, page, { background: true }), 'scan:list');
    this.wDetail = OGX.log.wrap(NAME, (id) => OGX.messages.fetchDetail(id, 'fleets', 'combat_reports', { background: true }), 'combat:fetch');
    this.wScan = OGX.log.wrap(NAME, (opts) => this.runScan(opts), 'scan');
    this.wClear = OGX.log.wrap(NAME, () => this.clearData(), 'clear');
  }

  Stats.prototype.set = function (k) { return this.ctx.settings.get(k); };

  Stats.prototype.start = async function () {
    const ctx = this.ctx;
    ctx.css(CSS);
    registerMergers();
    this.data.combat = migrate(await ctx.store.get(KEYS.combat, null));
    this.data.exp = migrate(await ctx.store.get(KEYS.exp, null));
    this.data.fleet = migrate(await ctx.store.get(KEYS.fleet, null));
    await this.loadMe();

    this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
    this.tab = this.panel.addTab({ id: 'stats', label: 'Статистика', order: 50, render: (c) => this.render(c) });

    const sub = (kind) => ctx.store.subscribe(KEYS[kind], (v, meta) => {
      if (meta && !meta.remote) return;
      this.data[kind] = migrate(v);
      this.refreshSoon();
    });
    this.offs.push(sub('combat'), sub('exp'), sub('fleet'));
    this.offs.push(OGX.state.onChange(['player', 'bodies'], () => this.loadMe()));
    this.offs.push(ctx.settings.onChange((key) => {
      if (/(period|customFrom|customTo|chart)$/.test(String(key))) return;
      this.refreshSoon();
      this.refreshBadges();
      this.summarySoon();
    }));
    if (!isGz() && OGX.bridge && OGX.bridge.onXhr) {
      // Combat reports opened in the game's own detail overlay (page XHR GET /ajax/messages/<id>, routes/web.php:170).
      this.offs.push(OGX.bridge.onXhr(/^\/ajax\/messages\/\d+$/, (ev) => this.onDetailXhr(ev)));
    }
    if (OGX.page.is('messages')) this.offs.push(OGX.messages.watch((item) => this.onItem(item)));
    rec('B', 'init', { combat: Object.keys(this.data.combat.items).length, expeditions: Object.keys(this.data.exp.items).length, fleet: Object.keys(this.data.fleet.items).length, page: OGX.page.info().name });
  };

  Stats.prototype.stop = function () {
    for (const off of this.offs) { try { off && off(); } catch (e) { /* ignore */ } }
    this.offs = [];
    if (this.scanning) this.scanning.abort = true;
    try { this.flush(); } catch (e) { /* ignore */ }
  };

  Stats.prototype.loadMe = async function () {
    const [player, bodies] = await Promise.all([OGX.state.player(), OGX.state.bodies()]);
    let name = player && player.name;
    if (!name) { try { name = (OGX.parse.metas(document) || {}).playerName || null; } catch (e) { name = null; } }
    const coords = new Set();
    for (const b of Object.values(bodies || {})) if (b && b.coords) coords.add(b.coords);
    this.me = { name: name || null, coords };
  };

  // ================================================================== store writes
  Stats.prototype.put = function (kind, id, r) {
    if (!r || !id) return;
    r.at = Date.now();
    this.data[kind].items[id] = r;
    this.pending[kind][id] = r;
    this.collected[kind]++;
    this.flushSoon();
  };

  /** Writes the pending records (merged with what other tabs stored meanwhile). Resolves when written. */
  Stats.prototype.flush = async function () {
    const c = this.collected;
    if (c.combat + c.exp + c.fleet) { rec('B', 'collect', c); this.collected = { combat: 0, exp: 0, fleet: 0 }; }
    const work = [];
    for (const kind of Object.keys(this.pending)) {
      const items = this.pending[kind];
      if (!Object.keys(items).length) continue;
      this.pending[kind] = {};
      work.push(this.ctx.store.update(KEYS[kind], (old) => mergeStore(old, { v: 1, items }), null).then((v) => {
        // keep records put while this write was in flight (they are in the next flush)
        this.data[kind] = migrate(v);
        Object.assign(this.data[kind].items, this.pending[kind]);
      }));
    }
    if (!work.length) return;
    try { await Promise.all(work); } catch (e) { this.log.error('store write failed', e && e.message); }
    this.refreshSoon();
    this.summarySoon();
    if (this.badges.size) this.refreshBadges();
  };
  Stats.prototype.flushNow = function () {
    this.flushSoon.cancel && this.flushSoon.cancel();
    return this.flush();
  };

  Stats.prototype.known = function (id) {
    return !!(this.data.combat.items[id] || this.data.exp.items[id] || this.data.fleet.items[id]);
  };

  // ================================================================== parsing (one li.msg)
  const liTs = (li) => {
    const s = txt(li.querySelector('.msg_head .msg_date') || li.querySelector('.msg_date'));
    let v = null;
    try { v = s ? OGX.time.parseServerWall(s) : null; } catch (e) { v = null; }
    return v || null;
  };

  /** -> { kind: 'combat'|'exp'|'fleet', id, record } | null */
  Stats.prototype.parseLi = function (li, subtab) {
    if (!li || !li.dataset || !SUBTABS.includes(subtab)) return null;
    if (!li.querySelector('.msg_content')) return null;
    const id = parseInt(li.dataset.msgId, 10);
    if (!id) return null;
    let key;
    try { key = OGX.messages.classify(li, subtab); } catch (e) { this.log.warn('classify failed', id, e && e.message); return null; }
    if (subtab === 'combat_reports') return { kind: 'combat', id, record: this.parseCombat(li, key, id) };
    if (subtab === 'expeditions') return { kind: 'exp', id, record: this.parseExpedition(li, id) };
    return { kind: 'fleet', id, record: this.parseFleet(li, key, id) };
  };

  // ================================================================== parsing (GALAXYZ row)
  /**
   * GALAXYZ message (MessageItem of watch, or a fetchList item { id, li, item }) -> { kind, id, record } | null.
   * The row is tr.message_head (with its tr.messages_body); ids come from the item, never from li.dataset.
   */
  Stats.prototype.parseGz = function (x) {
    const it = x && x.item ? x.item : x;
    const li = x && x.li;
    const id = +((x && x.id) || (it && it.id));
    if (!id || !li || !it) return null;
    const kind = it.kind;
    if (GZ_COMBAT.has(kind)) return { kind: 'combat', id, record: kind === 'missile' ? this.parseGzMissile(li, id) : this.parseGzCombat(li, id) };
    if (kind === 'expedition') return { kind: 'exp', id, record: this.parseGzExpedition(li, id, it.key) };
    if (GZ_FLEET.has(kind)) return { kind: 'fleet', id, record: this.parseGzFleet(li, id, kind, it.key) };
    return null;
  };

  /** Combat message of the list [UPSTREAM MissionCaseAttack]: my result by class, both losses, loot and debris per resource. */
  Stats.prototype.parseGzCombat = function (li, id) {
    const b = OGX.messages.parse.battleShort(li);
    if (!b) { learnValue('stats.battle.parsed', 0, { min: 1 }); this.log.warn('gz combat message not parsed', id); return null; }
    const coords = b.coords || null;
    let side = b.myRole || null;
    if (!side) side = coords && this.me.coords.has(coords) ? 'defender' : 'attacker';   // a draw names nobody: by my coordinates
    const role = b.expedition ? 'expedition' : side === 'attacker' ? 'attack' : 'defense';
    const result = b.myResult || (b.winner === 'draw' ? 'draw' : 'unknown');
    const r = {
      id, t: b.ts || null, kind: 'battle', coords, coordsType: (b.defenderPlace && b.defenderPlace.planetType) || 1, side, role, result, winner: b.winner || null,
      attacker: null, defender: null, opponent: null, reportId: b.reportId || null,
      loot: Object.assign(zeroRes(), b.loot || {}), lootSplit: !!b.loot, lootPct: null,
      debris: Object.assign(zeroRes(), b.debris || {}), debrisSplit: !!b.debris,
      lossesOwn: (side === 'defender' ? b.defender.losses : b.attacker.losses) || 0, lossesEnemy: (side === 'defender' ? b.attacker.losses : b.defender.losses) || 0,
      lossesOwnRes: null, lossesEnemyRes: null, lostUnitsOwn: null, lostUnitsEnemy: null,
      repaired: 0, moonChance: null, moonCreated: null, rounds: null, approx: false, full: false, unverified: true,
    };
    for (const k of RES) { r.loot[k] = +r.loot[k] || 0; r.debris[k] = +r.debris[k] || 0; }
    r.loot.total = resTotal(r.loot);
    r.debris.total = resTotal(r.debris);
    learnValue('stats.battle.lossesAttacker', b.attacker.losses, { min: 0 });
    learnValue('stats.battle.lossesDefender', b.defender.losses, { min: 0 });
    if (!b.winner) { learnValue('stats.battle.winner', 0, { min: 1 }); this.log.warn('gz battle winner not parsed', id); }
    return r;
  };

  /**
   * Missile impact [UPSTREAM MissionCaseMIP]: core parse.fleetMessage gives { missiles, intercepted, destroyed: { defenceId: n },
   * from, to }. The same text goes to both players: the direction comes from my coordinates.
   */
  Stats.prototype.parseGzMissile = function (li, id) {
    const p = OGX.messages.parse.fleetMessage(li) || {};
    const destroyed = Object.assign({}, p.destroyed || {});
    for (const t of p.unknownTitles || []) this.log.warn('unknown defence title in missile message', id, t);
    const missiles = p.missiles != null ? +p.missiles : null;
    const from = p.from && p.from.coordsStr, to = p.to && p.to.coordsStr;
    const attack = from ? this.me.coords.has(from) : !(to && this.me.coords.has(to));
    const value = OGX.calc.unitsValue(destroyed);
    const vres = { metal: value.metal, crystal: value.crystal, deuterium: value.deuterium };
    learnValue('stats.missile.count', missiles, { min: 0, int: true });
    return {
      id, t: p.ts || null, kind: attack ? 'missile_attack' : 'missile_defense', coords: to || null, coordsType: 1, side: attack ? 'attacker' : 'defender',
      role: attack ? 'attack' : 'defense', result: attack ? 'win' : 'loss', winner: 'attacker', attacker: null, defender: null, opponent: null,
      missiles, intercepted: p.intercepted != null ? +p.intercepted : null, destroyed, approx: false, full: false, unverified: true,
      loot: Object.assign(zeroRes(), { total: 0 }), lootSplit: false, lootPct: null, debris: Object.assign(zeroRes(), { total: 0 }), debrisSplit: false,
      lossesOwn: attack ? 0 : value.total, lossesEnemy: attack ? value.total : 0, lossesOwnRes: attack ? null : vres, lossesEnemyRes: attack ? vres : null,
      lostUnitsOwn: null, lostUnitsEnemy: null, repaired: 0, moonChance: null, moonCreated: null, rounds: null,
    };
  };

  /** Expedition result [UPSTREAM texts]: outcome by the OgameX key; ships found are listed, resources/DM come with the return. */
  Stats.prototype.parseGzExpedition = function (li, id, key) {
    const e = OGX.messages.parse.expedition(li) || {};
    const k = e.key || key || 'expedition_unknown';
    const outcome = EXP_OUTCOME[k] || 'unknown';
    if (outcome === 'unknown') { learnValue('stats.expedition.classified', 0, { min: 1 }); this.log.warn('gz expedition text not recognised', id); }
    for (const n of Object.keys(e.shipsByName || {})) if (!OGX.catalog.idFromTitle(n)) this.log.warn('unknown ship title in expedition', id, n);
    return { id, t: e.ts || null, key: k, outcome, resources: zeroRes(), darkMatter: 0, ships: Object.assign({}, e.ships || {}), unverified: true, amountsInReturn: true };
  };

  /** Transport / recycle / deploy / return / colonisation [UPSTREAM texts] -> the OgameX fleet record shape. */
  Stats.prototype.parseGzFleet = function (li, id, kind, key) {
    const p = OGX.messages.parse.fleetMessage(li) || {};
    const k = p.key || key || 'unknown';
    const res = p.resources ? Object.assign(zeroRes(), p.resources) : null;
    if (res) for (const x of RES) res[x] = +res[x] || 0;
    const r = { id, t: p.ts || null, key: k, kind, from: placeMini(p.from), to: placeMini(p.to), resources: res, unverified: true };
    if (kind === 'recycle') {
      // "your Recyclers collect M Metal and C Crystal": no field size, no ship count
      r.harvest = { ship: null, ships: 0, capacity: 0, field: null, harvested: res || zeroRes() };
      r.resources = null;
      if (!res) { learnValue('stats.harvest.parsed', 0, { min: 1 }); this.log.warn('harvest numbers not parsed', id); }
    }
    if (kind === 'return_expedition' || kind === 'return_expedition_dm') {
      r.expReturn = true;
      r.darkMatter = +p.darkMatter || 0;
    }
    if (/^(transport|deploy|return$|return_expedition$)/.test(kind) && !res) { learnValue('stats.fleet.resources', null); this.log.warn('resources not parsed', id, kind); }
    return r;
  };

  /** Who am I in a battle: by name (meta ogame-player-name), else by my body coordinates. */
  Stats.prototype.side = function (attName, defName, defCoords) {
    const me = this.me.name;
    if (me && attName === me) return 'attacker';
    if (me && defName === me) return 'defender';
    if (!me && defCoords && this.me.coords.has(defCoords)) return 'defender';
    if (!me && attName && NPC.has(attName)) return 'defender';
    if (!me) return 'attacker';
    return null;
  };

  Stats.prototype.battleBase = function ({ id, t, coords, coordsType, attName, defName, winner }) {
    const side = this.side(attName, defName, coords);
    const role = side === 'attacker' ? 'attack' : side === 'defender' ? (NPC.has(attName) ? 'expedition' : 'defense') : 'other';
    const result = winner === 'draw' ? 'draw' : !side ? 'unknown' : (side === 'attacker') === (winner === 'attacker') ? 'win' : 'loss';
    return {
      id, t, kind: 'battle', coords, coordsType: coordsType || 1, side, role, result, winner,
      attacker: attName || null, defender: defName || null, opponent: side === 'attacker' ? defName : side === 'defender' ? attName : `${attName} / ${defName}`,
      loot: Object.assign(zeroRes(), { total: 0 }), lootSplit: false, lootPct: null,
      debris: Object.assign(zeroRes(), { total: 0 }), debrisSplit: false,
      lossesOwn: 0, lossesEnemy: 0, lossesOwnRes: null, lossesEnemyRes: null, lostUnitsOwn: null, lostUnitsEnemy: null,
      repaired: 0, moonChance: null, moonCreated: null, rounds: null, approx: true, full: false,
    };
  };

  Stats.prototype.parseCombat = function (li, key, id) {
    const t = liTs(li);
    if (key === 'battle_report') {
      const b = OGX.messages.parse.battleShort(li);
      const place = b.defenderPlace || {};
      const r = this.battleBase({ id, t: b.ts || t, coords: b.coords, coordsType: place.planetType, attName: b.attacker.name, defName: b.defender.name, winner: b.winner });
      const own = r.side === 'defender' ? b.defender : b.attacker;
      const enemy = r.side === 'defender' ? b.attacker : b.defender;
      r.lossesOwn = own.losses || 0;
      r.lossesEnemy = enemy.losses || 0;
      r.loot.total = b.lootSum || 0;
      r.lootPct = b.lootPct;
      r.debris.total = b.debrisSum || 0;
      r.repaired = b.repaired || 0;
      r.moonChance = b.moonChance; // null: the target already had a moon
      r.approx = true;             // loot sum is formatNumberShort (lossy)
      // sanity checks → learning alerts (L 'implausible')
      learnValue('stats.battle.lootPct', b.lootPct, { min: 0, max: 100, int: true });
      learnValue('stats.battle.lossesAttacker', b.attacker.losses, { min: 0 });
      learnValue('stats.battle.lossesDefender', b.defender.losses, { min: 0 });
      learnValue('stats.battle.debris', b.debrisSum, { min: 0 });
      if (b.moonChance !== null && b.moonChance !== undefined) learnValue('stats.battle.moonChance', b.moonChance, { min: 0, max: 100 });
      if (!b.attacker.name || !b.defender.name || !b.winner) { learnValue('stats.battle.names', 0, { min: 1 }); this.log.warn('battle names not parsed', id); }
      if (!r.side) this.log.debug('battle without me', id, b.attacker.name, b.defender.name);
      return r;
    }
    const body = li.querySelector('.msg_content');
    const bodyTxt = txt(body);
    const links = [...body.querySelectorAll('a.txt_link')].map((a) => placeMini(OGX.messages.parse.placeLink(a)));
    const titleLink = li.querySelector('.msg_title a.txt_link');
    if (key === 'fleet_lost_contact') {
      const p = placeMini(titleLink ? OGX.messages.parse.placeLink(titleLink) : null);
      const r = this.battleBase({ id, t, coords: p ? p.coords : null, coordsType: p ? p.type : 1, attName: this.me.name, defName: null, winner: 'defender' });
      return Object.assign(r, { kind: 'lost_contact', side: 'attacker', role: 'attack', result: 'loss', opponent: null });
    }
    if (key === 'missile_attack_report' || key === 'missile_defense_report') {
      const html = body.innerHTML;
      const destroyed = {};
      const re = /<span style="display:inline-block;min-width:200px;">([^<]+)<\/span>\s*(\d+)\(-(\d+)\)/g; // MissileAttackReport.php:36-111
      let m;
      while ((m = re.exec(html))) {
        const uid = OGX.catalog.idFromTitle(m[1].trim());
        if (uid) destroyed[uid] = (destroyed[uid] || 0) + +m[3];
        else this.log.warn('unknown defence title in missile report', id, m[1]);
      }
      const value = OGX.calc.unitsValue(destroyed);
      const icp = bodyTxt.match(/Missiles Intercepted:\s*([\d,]+)/);
      const intercepted = icp ? +icp[1].replace(/,/g, '') : 0;
      const attack = key === 'missile_attack_report';
      const cnt = attack ? bodyTxt.match(/^([\d,]+) missiles?/) : bodyTxt.match(/Incoming Missiles:\s*([\d,]+)/);
      const missiles = cnt ? +cnt[1].replace(/,/g, '') : null;
      learnValue('stats.missile.count', missiles, { min: 0, int: true });
      const target = attack ? links[1] : links[0];
      const b = body.querySelector('b');
      const r = this.battleBase({ id, t, coords: target ? target.coords : null, coordsType: target ? target.type : 1, attName: attack ? this.me.name : null, defName: attack ? null : this.me.name, winner: 'attacker' });
      return Object.assign(r, {
        kind: attack ? 'missile_attack' : 'missile_defense', side: attack ? 'attacker' : 'defender', role: attack ? 'attack' : 'defense',
        result: attack ? 'win' : 'loss', opponent: attack ? null : (b && !/Incoming|Missiles|Defenses/.test(b.textContent) ? b.textContent.trim() : null),
        missiles, intercepted, destroyed, approx: false,
        lossesOwn: attack ? 0 : value.total, lossesEnemy: attack ? value.total : 0,
        lossesOwnRes: attack ? null : { metal: value.metal, crystal: value.crystal, deuterium: value.deuterium },
        lossesEnemyRes: attack ? { metal: value.metal, crystal: value.crystal, deuterium: value.deuterium } : null,
      });
    }
    // moon destruction variants (no fixture; subject text only, messages.md §6)
    const r = this.battleBase({ id, t, coords: links[0] ? links[0].coords : null, attName: null, defName: null, winner: null });
    return Object.assign(r, { kind: 'moon_destruction', role: 'other', result: 'unknown', title: txt(li.querySelector('.msg_title')), approx: false });
  };

  /** Applies a parsed full combat report (parse.battleFull) to a record (or builds one). */
  Stats.prototype.applyFull = function (prev, f) {
    const winner = f.attacker && f.attacker.mark === 'undermark' ? 'attacker' : f.attacker && f.attacker.mark === 'middlemark' ? 'draw' : 'defender';
    const coords = f.defenderPlanet && Array.isArray(f.defenderPlanet.coords) ? f.defenderPlanet.coords.join(':') : null;
    const r = prev && prev.kind === 'battle' ? clone(prev)
      : this.battleBase({ id: f.id, t: f.ts || null, coords, attName: f.attacker && f.attacker.name, defName: f.defender && f.defender.name, winner });
    if (!r.coords && coords) r.coords = coords;
    const clean = (o) => { const x = Object.assign(zeroRes(), o); for (const k of RES) x[k] = +x[k] || 0; return x; };   // GALAXYZ debris has no deuterium (null)
    if (f.loot) { r.loot = clean(f.loot); r.loot.total = resTotal(r.loot); r.lootSplit = true; }
    if (f.debris) { r.debris = clean(f.debris); r.debris.total = resTotal(r.debris); r.debrisSplit = true; }
    if (!r.attacker && f.attacker && f.attacker.name) r.attacker = f.attacker.name;
    if (!r.defender && f.defender && f.defender.name) r.defender = f.defender.name;
    if (!r.opponent && r.side) r.opponent = (r.side === 'attacker' ? r.defender : r.attacker) || null;
    r.moonCreated = !!f.moonCreated;
    r.rounds = f.rounds;
    if (f.unitsLost && f.unitsLost.attacker && f.unitsLost.defender && r.side) {
      const own = r.side === 'defender' ? f.unitsLost.defender : f.unitsLost.attacker;
      const enemy = r.side === 'defender' ? f.unitsLost.attacker : f.unitsLost.defender;
      const vo = OGX.calc.unitsValue(own), ve = OGX.calc.unitsValue(enemy);
      r.lostUnitsOwn = own; r.lostUnitsEnemy = enemy;
      r.lossesOwnRes = { metal: vo.metal, crystal: vo.crystal, deuterium: vo.deuterium };
      r.lossesEnemyRes = { metal: ve.metal, crystal: ve.crystal, deuterium: ve.deuterium };
      // the list value is exact below 1 Mn (formatNumberLong); above it the unit value is more precise
      if (!r.lossesOwn || r.lossesOwn >= 1e6) r.lossesOwn = vo.total;
      if (!r.lossesEnemy || r.lossesEnemy >= 1e6) r.lossesEnemy = ve.total;
      for (const [uid, n] of Object.entries(Object.assign({}, own, enemy))) learnValue('stats.battle.unitsLost', n, { min: 0, int: true });
      for (const uid of Object.keys(Object.assign({}, own, enemy))) if (!OGX.catalog.get(+uid)) this.log.warn('unknown unit id in combat report', f.id, uid);
    }
    learnCheck('stats.battle.full', { loot: r.loot, debris: r.debris });
    const big = (o) => RES.some((k) => (o[k] || 0) >= 1e6);
    r.approx = isGz() ? false : big(r.loot) || big(r.debris);   // GALAXYZ numbers are exact (pretty_number of integers)
    r.full = true;
    return r;
  };

  Stats.prototype.parseExpedition = function (li, id) {
    const e = OGX.messages.parse.expedition(li);
    const r = {
      id, t: e.ts || liTs(li), key: e.key, outcome: OUTCOMES.includes(e.outcome) ? e.outcome : 'unknown',
      resources: Object.assign(zeroRes(), e.resources || {}), darkMatter: e.darkMatter || 0, ships: Object.assign({}, e.ships || {}),
    };
    if (r.outcome === 'unknown') {
      // the body did not match the expedition text table (messages-expedition-texts.json): server texts changed?
      learnValue('stats.expedition.classified', 0, { min: 1 });
      this.log.warn('expedition text not recognised', id);
    }
    if (e.key === 'expedition_gain_resources') learnValue('stats.expedition.resources', resTotal(r.resources), { min: 1, int: true });
    if (e.key === 'expedition_gain_dark_matter') learnValue('stats.expedition.darkMatter', e.darkMatter, { min: 1, int: true });
    if (e.key === 'expedition_gain_ships') {
      const names = Object.keys(e.shipsByName || {});
      if (!names.length) learnValue('stats.expedition.ships', 0, { min: 1 });
      for (const n of names) {
        if (!OGX.catalog.idFromTitle(n)) { this.log.warn('unknown ship title in expedition', id, n); learnValue('stats.expedition.shipTitle', 0, { min: 1 }); }
        learnValue('stats.expedition.shipCount', e.shipsByName[n], { min: 1, int: true });
      }
    }
    learnCheck('stats.expedition', { resources: r.resources, darkMatter: r.darkMatter });
    return r;
  };

  Stats.prototype.parseFleet = function (li, key, id) {
    const t = liTs(li);
    const body = li.querySelector('.msg_content');
    if (!key || /^unknown/.test(key)) {
      this.log.warn('message not recognised', id, String(key).slice(0, 80));
      learnValue('stats.fleet.classified', 0, { min: 1 });
      return { id, t, key: 'unknown', title: txt(li.querySelector('.msg_title')), from: null, to: null, resources: null };
    }
    if (key === 'fleet_union_invite') return { id, t, key, from: null, to: null, resources: null };
    if (ECONOMY_KEYS.has(key)) {
      const links = [...body.querySelectorAll('a.txt_link')].map((a) => placeMini(OGX.messages.parse.placeLink(a)));
      const plain = txt(body).match(/(\d+):(\d+):(\d+)/);
      const r = { id, t, key, from: null, to: links[links.length - 1] || (plain ? { coords: `${plain[1]}:${plain[2]}:${plain[3]}`, type: 1, kind: 'coordinates', name: null } : null), resources: null };
      if (key === 'wreck_field_repair_completed') {
        const m = txt(body).match(/([\d,]+) ships? ha(?:ve|s) been put back/);
        r.shipsRepaired = m ? +m[1].replace(/,/g, '') : null;
        learnValue('stats.wreck.ships', r.shipsRepaired, { min: 0, int: true });
      }
      return r;
    }
    const p = OGX.messages.parse.fleetMessage(li, key);
    const r = { id, t: p.ts || t, key, from: placeMini(p.from), to: placeMini(p.to), resources: p.resources ? Object.assign(zeroRes(), p.resources) : null };
    if (p.harvest) {
      r.harvest = { ship: p.harvest.ship || null, ships: p.harvest.ships || 0, capacity: p.harvest.capacity || 0, field: Object.assign(zeroRes(), p.harvest.field || {}), harvested: Object.assign(zeroRes(), p.harvest.harvested || {}) };
      learnCheck('stats.harvest', r.harvest);
    } else if (key === 'debris_field_harvest') {
      learnValue('stats.harvest.parsed', 0, { min: 1 });
      this.log.warn('harvest numbers not parsed', id);
    }
    if (/_with_resources$|^transport_/.test(key)) {
      if (!r.resources) { learnValue('stats.fleet.resources', null); this.log.warn('resources not parsed', id, key); }
      else learnCheck('stats.fleet.resources', r.resources);
    }
    return r;
  };

  // ================================================================== collection
  Stats.prototype.onItem = function (item) {
    if (!item || !item.li || !SUBTABS.includes(item.subtab)) return;
    if (item.tab === 'communication') return;
    const id = +item.id;
    const gz = item.engine === 'galaxyz' || isGz();
    let parsed = null;
    try { parsed = gz ? this.parseGz(item) : this.parseLi(item.li, item.subtab); } catch (e) { this.log.error('parse failed', id, item.subtab, e && e.message); return; }
    if (!parsed || !parsed.record) return;
    const have = this.data[parsed.kind].items[id];
    if (!have) this.put(parsed.kind, id, parsed.record);
    const r = this.data[parsed.kind].items[id];
    if (parsed.kind === 'combat' && r && r.kind === 'battle' && !r.full && !r.raportMismatch && this.set('fetchFullCombat')) this.enqueue(id);
    if (this.set('showBadges')) this.badge(id, item.li, parsed.kind, item.body);
    this.trackSummary(item.li, item.subtab, id);
  };

  /** it = fetchList item { id, li, item } (OgameX: li.msg; GALAXYZ: tr.message_head of the fetched list). */
  Stats.prototype.ingest = function (it, subtab) {
    const li = it && it.li;
    const id = +((it && it.id) || (li && li.dataset && li.dataset.msgId));
    if (!id || this.known(id)) return false;
    const parsed = isGz() ? this.parseGz(it) : this.parseLi(li, subtab);
    if (!parsed || !parsed.record) return false;
    this.put(parsed.kind, parsed.id, parsed.record);
    return parsed.kind;
  };

  Stats.prototype.enqueue = function (id) {
    if (this.queued.has(id)) return;
    this.queued.add(id);
    this.queue.push(id);
    this.pump();
  };

  Stats.prototype.pump = async function () {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift();
        const cur = this.data.combat.items[id];
        if (cur && cur.full) continue;
        const res = await this.wDetail(id);
        if (!res || res.error) { this.log.warn('combat report not loaded', id, res && (res.status || res.error)); continue; }
        if (isGz()) this.fromGzFull(res.full, (res.full && res.full.id) || id);
        else this.fromDetail(res.doc, res.html, id);
      }
    } finally { this.busy = false; }
  };

  Stats.prototype.fromDetail = function (doc, html, expectId) {
    if (!doc || !doc.querySelector('.detail_msg .combat_participant')) return false;
    let f;
    try { f = OGX.messages.parse.battleFull(doc, html); } catch (e) { this.log.warn('full combat report not parsed', expectId, e && e.message); learnValue('stats.battle.fullParsed', 0, { min: 1 }); return false; }
    if (!f || !f.id) return false;
    const r = this.applyFull(this.data.combat.items[f.id], f);
    this.put('combat', f.id, r);
    rec('B', 'combat:full', { id: f.id, loot: r.loot.total, moon: r.moonCreated });
    setTimeout(OGX.safe(() => this.refreshBadge(f.id), 'stats:badge'), 200);
    this.summarySoon();
    return true;
  };

  /** GALAXYZ: page=raport parsed by the core (messages.fetchDetail(...).full, battleFull shape [UPSTREAM]; full.id = the message id). */
  Stats.prototype.fromGzFull = function (f, id) {
    if (!f || f.error || !id) { if (f && f.error) this.log.warn('combat report not usable', id, f.error); return false; }
    const prev = this.data.combat.items[id];
    // the raport must be the battle of this message: same defender coordinates (a stale/foreign report id is not applied)
    const fc = f.defenderPlanet && Array.isArray(f.defenderPlanet.coords) ? f.defenderPlanet.coords.join(':') : null;
    if (prev && prev.coords && fc && prev.coords !== fc) {
      this.log.warn('combat report does not match the message', id, prev.coords, fc);
      this.put('combat', id, Object.assign(clone(prev), { raportMismatch: fc }));   // not requested again
      return false;
    }
    let r;
    try { r = this.applyFull(prev, f.id === id ? f : Object.assign({}, f, { id })); } catch (e) { this.log.warn('full combat report not applied', id, e && e.message); return false; }
    r.unverified = true;
    this.put('combat', id, r);
    rec('B', 'combat:full', { id, loot: r.loot.total, moon: r.moonCreated });
    setTimeout(OGX.safe(() => this.refreshBadge(id), 'stats:badge'), 200);
    this.summarySoon();
    return true;
  };

  Stats.prototype.onDetailXhr = function (ev) {
    if (!ev || !ev.responseText || ev.status >= 400) return;
    if (!/combat_participant/.test(ev.responseText)) return;
    const doc = new DOMParser().parseFromString(ev.responseText, 'text/html');
    if (this.fromDetail(doc, ev.responseText)) rec('B', 'combat:captured', { path: ev.path });
  };

  // ================================================================== explicit scan
  Stats.prototype.scanClick = async function () {
    if (this.scanning) { this.scanning.abort = true; rec('U', 'scan:stop'); return; }
    const all = h('input', { type: 'checkbox', class: P + 'scan-all', 'data-ogx-act': 'stats:scan-all' });
    const body = h('div', { class: P + 'confirm' },
      h('p', null, isGz()
        ? 'Будут загружены страницы категорий «Боевые» (Combat), «Экспедиции» (Expedition), «Транспорт» (Transport) и «Системные» (System). '
          + 'Сервер игры пометит все загруженные сообщения прочитанными.'
        : 'Будут загружены страницы разделов «Боевые доклады», «Экспедиции», «Транспорт», «Прочее» и вкладка «Экономика». '
        + 'Сервер OgameX пометит все загруженные сообщения прочитанными.'),
      this.set('fetchFullCombat') ? h('p', null, 'Включена загрузка полных боевых докладов: каждый новый бой — ещё один запрос' + (isGz() ? ' (page=raport).' : '.')) : null,
      h('label', { class: P + 'check' }, all, ' Все страницы (не останавливаться на уже известных сообщениях)'));
    const ok = await OGX.dom.confirm(body, { okLabel: 'Сканировать', title: 'Сканирование сообщений' });
    rec('U', 'scan:confirm', { ok, all: all.checked });
    if (!ok) return;
    await this.wScan({ all: all.checked });
  };

  Stats.prototype.runScan = async function ({ all = false } = {}) {
    if (this.scanning) return { busy: true };
    const st = (this.scanning = { abort: false, added: { combat: 0, exp: 0, fleet: 0 }, pages: 0, errors: 0 });
    this.refreshSoon();
    try {
      const list = isGz() ? GZ_SCAN.map(([cat, sub]) => [cat, sub]) : SCAN_LIST;
      for (const [tab, subtab] of list) {
        let page = 1, pages = 1;
        do {
          if (st.abort) break;
          this.status(`Сканирование: ${subtabRu(subtab)}, страница ${page}${pages > 1 ? ' из ' + pages : ''}…`);
          // GALAXYZ: tab is the messcat number (subtab is only the OgameX alias used for the labels)
          const r = isGz() ? await this.wList(tab, null, page) : await this.wList(tab, subtab, page);
          if (!r || r.error) {
            st.errors++;
            this.log.warn('list not loaded', tab, subtab, page, r && (r.status || r.error));
            if (r && r.loggedOut) { st.abort = true; OGX.dom.toast('Сессия истекла: войдите в игру снова', { type: 'error' }); }
            break;
          }
          st.pages++;
          pages = Math.min(r.pages || 1, SCAN_MAX_PAGES);
          learnValue('stats.scan.pages', r.pages, { min: 1, int: true });
          let fresh = 0;
          for (const it of r.items || []) {
            try {
              const kind = this.ingest(it, subtab);
              if (kind) { fresh++; st.added[kind]++; }
              const cur = this.data.combat.items[it.id];
              if (cur && cur.kind === 'battle' && !cur.full && !cur.raportMismatch && subtab === 'combat_reports' && this.set('fetchFullCombat')) this.enqueue(+it.id);
            } catch (e) { this.log.error('scan item failed', it && it.id, e && e.message); }
          }
          if (!all && fresh === 0) break; // a page with only known ids: the rest is older and known
          page++;
        } while (page <= pages && !st.abort);
        if (st.abort) break;
      }
    } finally {
      await this.flushNow();
      this.status(null);
      this.scanning = null;
      this.refreshSoon();
    }
    const a = st.added;
    OGX.dom.toast(`${st.abort ? 'Сканирование остановлено' : 'Сканирование завершено'}: новых боёв ${num(a.combat)}, экспедиций ${num(a.exp)}, других сообщений ${num(a.fleet)}`
      + (st.errors ? ` · ошибок: ${st.errors}` : ''), { type: st.errors ? 'warn' : 'ok', ms: 6000 });
    return { added: a, pages: st.pages, errors: st.errors, aborted: st.abort };
  };

  Stats.prototype.status = function (text) {
    try { this.panel.setStatus(text); } catch (e) { /* ignore */ }
    const el = document.querySelector('.' + P + 'progress');
    if (el) { el.textContent = text || ''; el.hidden = !text; }
  };

  Stats.prototype.clearClick = async function () {
    const ok = await OGX.dom.confirm('Удалить всю собранную статистику (бои, экспедиции, переработка, транспорт) из дополнения? Сообщения в игре не изменятся.', { danger: true, okLabel: 'Очистить', title: 'Очистка статистики' });
    rec('U', 'clear:confirm', { ok });
    if (ok) await this.wClear();
  };
  Stats.prototype.clearData = async function () {
    this.pending = { combat: {}, exp: {}, fleet: {} };
    for (const kind of Object.keys(KEYS)) { this.data[kind] = { v: 1, items: {} }; await this.ctx.store.set(KEYS[kind], { v: 1, items: {} }); }
    this.refreshBadges();
    this.summarySoon();
    this.refreshSoon();
    OGX.dom.toast('Статистика очищена', { type: 'ok' });
    return true;
  };

  // ================================================================== aggregation
  Stats.prototype.rates = function () {
    const txt = this.set('msuRates');
    if (String(txt || '').trim() && !parseRates(txt) && !this._ratesWarned) { this._ratesWarned = true; this.log.warn('bad msuRates setting', txt); }
    return OGX.calc.msuRates(txt);   // empty or invalid -> the server's trader rate
  };

  /** Net result of one battle record in MSU, from my point of view. */
  Stats.prototype.battleNet = function (r, rates) {
    const lootMsu = r.lootSplit ? OGX.calc.msu(r.loot, rates) : (r.loot.total || 0) * rates[0];
    const lossMsu = r.lossesOwnRes ? OGX.calc.msu(r.lossesOwnRes, rates) : (r.lossesOwn || 0) * rates[0];
    if (r.role === 'attack') return lootMsu - lossMsu;
    if (r.role === 'defense') return -lootMsu - lossMsu;
    if (r.role === 'expedition') return -lossMsu;
    return 0;
  };

  Stats.prototype.range = function () {
    const now = OGX.time.serverNow();
    const today = dayIdx(now);
    let p = this.set('period') || this.set('defaultPeriod') || '7d';
    if (!PERIODS.some((x) => x.value === p)) p = '7d';
    switch (p) {
      case 'today': return { p, from: dayStart(today), to: Infinity, d0: today, d1: today };
      case 'yesterday': return { p, from: dayStart(today - 1), to: dayStart(today), d0: today - 1, d1: today - 1 };
      case '30d': return { p, from: dayStart(today - 29), to: Infinity, d0: today - 29, d1: today };
      case 'all': return { p, from: -Infinity, to: Infinity, d0: null, d1: today };
      case 'custom': {
        let a = parseIsoDay(this.set('customFrom')), b = parseIsoDay(this.set('customTo'));
        if (a === null) a = today - 6;
        if (b === null) b = today;
        if (b < a) [a, b] = [b, a];
        return { p, from: dayStart(a), to: dayStart(b + 1), d0: a, d1: b };
      }
      default: return { p: '7d', from: dayStart(today - 6), to: Infinity, d0: today - 6, d1: today };
    }
  };

  Stats.prototype.compute = function (range) {
    const rates = this.rates();
    const inR = (r) => r && Number.isFinite(r.t) && r.t >= range.from && r.t < range.to;
    const days = new Map(); // dayIdx -> { combat, expeditions, harvest, transport, n: {...} }
    const day = (t) => {
      const k = dayIdx(t);
      if (!days.has(k)) days.set(k, { combat: 0, expeditions: 0, harvest: 0, transport: 0, n: { combat: 0, expeditions: 0, harvest: 0, transport: 0 } });
      return days.get(k);
    };
    // --- battles
    const C = {
      count: 0, approx: false, full: 0,
      byRole: { attack: { win: 0, loss: 0, draw: 0, unknown: 0 }, defense: { win: 0, loss: 0, draw: 0, unknown: 0 }, expedition: { win: 0, loss: 0, draw: 0, unknown: 0 }, other: { win: 0, loss: 0, draw: 0, unknown: 0 } },
      lootGained: Object.assign(zeroRes(), { total: 0 }), lootLost: Object.assign(zeroRes(), { total: 0 }), lootSplitUnknown: false,
      lossesOwn: 0, lossesEnemy: 0, debris: Object.assign(zeroRes(), { total: 0 }), debrisSplitUnknown: false,
      moonsCreated: 0, moonChances: 0, moonExpected: 0, net: 0,
      lostContact: 0, missileAttacks: 0, missileDefenses: 0, missilesLossEnemy: 0, missilesLossOwn: 0, moonDestruction: 0,
    };
    for (const r of Object.values(this.data.combat.items)) {
      if (!inR(r)) continue;
      if (r.kind === 'lost_contact') { C.lostContact++; continue; }
      if (r.kind === 'missile_attack') { C.missileAttacks++; C.missilesLossEnemy += r.lossesEnemy || 0; continue; }
      if (r.kind === 'missile_defense') { C.missileDefenses++; C.missilesLossOwn += r.lossesOwn || 0; continue; }
      if (r.kind === 'moon_destruction') { C.moonDestruction++; continue; }
      if (r.kind !== 'battle') continue;
      C.count++;
      if (r.full) C.full++;
      if (r.approx) C.approx = true;
      const role = C.byRole[r.role] ? r.role : 'other';
      C.byRole[role][r.result in C.byRole[role] ? r.result : 'unknown']++;
      const lootTarget = r.role === 'attack' ? C.lootGained : r.role === 'defense' ? C.lootLost : null;
      if (lootTarget) {
        lootTarget.total += r.loot.total || 0;
        if (r.lootSplit) addRes(lootTarget, r.loot); else if (r.loot.total) C.lootSplitUnknown = true;
      }
      if (r.role !== 'other') { C.lossesOwn += r.lossesOwn || 0; C.lossesEnemy += r.lossesEnemy || 0; }
      C.debris.total += r.debris.total || 0;
      if (r.debrisSplit) addRes(C.debris, r.debris); else if (r.debris.total) C.debrisSplitUnknown = true;
      if (r.moonCreated) C.moonsCreated++;
      if (r.moonChance > 0) { C.moonChances++; C.moonExpected += r.moonChance / 100; }
      const net = this.battleNet(r, rates);
      C.net += net;
      const d = day(r.t); d.combat += net; d.n.combat++;
    }
    // --- expeditions
    const E = { count: 0, outcomes: {}, resources: zeroRes(), darkMatter: 0, ships: {}, blackHoles: 0, battles: 0, shipsValue: 0, returns: 0, amountsInReturn: false };
    for (const o of OUTCOMES) E.outcomes[o] = 0;
    for (const r of Object.values(this.data.exp.items)) {
      if (!inR(r)) continue;
      E.count++;
      E.outcomes[r.outcome in E.outcomes ? r.outcome : 'unknown']++;
      if (r.amountsInReturn) E.amountsInReturn = true;
      addRes(E.resources, r.resources);
      E.darkMatter += r.darkMatter || 0;
      for (const [sid, n] of Object.entries(r.ships || {})) E.ships[sid] = (E.ships[sid] || 0) + n;
      if (r.outcome === 'fleet_lost') E.blackHoles++;
      if (r.outcome === 'pirates' || r.outcome === 'aliens' || r.outcome === 'battle') E.battles++;
      const d = day(r.t); d.expeditions += OGX.calc.msu(r.resources, rates); d.n.expeditions++;
    }
    const sv = OGX.calc.unitsValue(E.ships);
    E.shipsValue = OGX.calc.msu(sv, rates);
    // --- harvest / transport / other
    const H = { count: 0, harvested: zeroRes(), field: zeroRes(), fieldKnown: false, ships: {}, capacity: 0 };
    const Tr = {
      received: zeroRes(), receivedN: 0, delivered: zeroRes(), deliveredN: 0, returns: zeroRes(), returnsN: 0, returnsExp: 0,
      deployed: zeroRes(), deployedN: 0, returnsEmpty: 0, deployEmpty: 0, acs: 0, invites: 0,
      colonies: 0, colonyFails: 0, relocations: 0, wreckRepairs: 0, wreckShips: 0, unknown: 0,
    };
    for (const r of Object.values(this.data.fleet.items)) {
      if (!inR(r)) continue;
      const res = r.resources || zeroRes();
      switch (r.key) {
        case 'debris_field_harvest':
          H.count++;
          if (r.harvest) {
            addRes(H.harvested, r.harvest.harvested);
            if (r.harvest.field) { addRes(H.field, r.harvest.field); H.fieldKnown = true; }   // GALAXYZ: no field size in the message
            H.capacity += r.harvest.capacity || 0;
            if (r.harvest.ship) H.ships[r.harvest.ship] = (H.ships[r.harvest.ship] || 0) + (r.harvest.ships || 0);
          }
          { const d = day(r.t); d.harvest += r.harvest ? OGX.calc.msu(r.harvest.harvested, rates) : 0; d.n.harvest++; }
          break;
        case 'transport_received': Tr.receivedN++; addRes(Tr.received, res); { const d = day(r.t); d.transport += OGX.calc.msu(res, rates); d.n.transport++; } break;
        case 'transport_arrived': Tr.deliveredN++; addRes(Tr.delivered, res); break;
        case 'return_of_fleet_with_resources':
          Tr.returnsN++; addRes(Tr.returns, res);
          if (r.expReturn || (r.from && posOf(r.from.coords) === 16)) Tr.returnsExp++;
          if (r.expReturn) {
            // GALAXYZ: the expedition find arrives with the return of the expedition fleet (its cargo)
            addRes(E.resources, res); E.darkMatter += r.darkMatter || 0; E.returns++;
            const d = day(r.t); d.expeditions += OGX.calc.msu(res, rates); d.n.expeditions++;
          }
          { const d = day(r.t); d.transport += OGX.calc.msu(res, rates); d.n.transport++; }
          break;
        case 'fleet_deployment_with_resources': Tr.deployedN++; addRes(Tr.deployed, res); break;
        case 'return_of_fleet':
          Tr.returnsEmpty++;
          if (r.expReturn && r.darkMatter) { E.darkMatter += r.darkMatter; E.returns++; }
          break;
        case 'colonisation': Tr.colonies++; break;
        case 'fleet_deployment': Tr.deployEmpty++; break;
        case 'acs_defend_arrival_sender': case 'acs_defend_arrival_host': Tr.acs++; break;
        case 'fleet_union_invite': Tr.invites++; break;
        case 'colony_established': Tr.colonies++; break;
        case 'colony_establish_fail_astrophysics': Tr.colonyFails++; break;
        case 'planet_relocation_success': Tr.relocations++; break;
        case 'wreck_field_repair_completed': Tr.wreckRepairs++; Tr.wreckShips += r.shipsRepaired || 0; break;
        default: Tr.unknown++;
      }
    }
    E.resourcesMsu = OGX.calc.msu(E.resources, rates);   // after the fleet loop: GALAXYZ expedition returns add to it
    return { range, rates, C, E, H, Tr, days };
  };

  // ================================================================== tab UI
  Stats.prototype.refresh = function () { if (this.tab) this.tab.refresh(); };

  Stats.prototype.render = function (container) {
    const self = this;
    const range = this.range();
    const S = this.compute(range);
    const root = h('div', { class: P + 'root' });
    container.appendChild(root);

    // --- toolbar: period, custom range, scan, clear
    const periodSel = h('select', { class: 'ogx-select ' + P + 'period', 'data-ogx-act': 'stats:period', title: 'Период' },
      PERIODS.map((p) => h('option', { value: p.value, selected: p.value === range.p }, p.label)));
    periodSel.addEventListener('change', OGX.safe(async () => {
      rec('U', 'period', { value: periodSel.value });
      await self.ctx.settings.set('period', periodSel.value);
      self.refresh();
    }, 'stats:period'));
    const dateInput = (key, val, title) => {
      const el = h('input', { type: 'date', class: 'ogx-input ' + P + key, value: val, title, 'data-ogx-act': 'stats:' + key });
      el.addEventListener('change', OGX.safe(async () => { rec('U', key, { value: el.value }); await self.ctx.settings.set(key, el.value); self.refresh(); }, 'stats:' + key));
      return el;
    };
    const custom = range.p === 'custom' ? h('span', { class: P + 'custom' },
      dateInput('customFrom', isoDay(range.d0), 'С (день сервера)'), ' — ', dateInput('customTo', isoDay(range.d1), 'По (включительно)')) : null;
    const scanBtn = h('button', { type: 'button', class: ['ogx-btn', this.scanning ? 'ogx-btn-danger' : 'ogx-btn-primary', P + 'scan'], 'data-ogx-act': this.scanning ? 'stats:scan-stop' : 'stats:scan',
      title: isGz() ? 'Загрузить категории «Боевые», «Экспедиции», «Транспорт», «Системные» и добавить их в статистику (пометит их прочитанными)' : 'Загрузить сообщения разделов флота и экономики и добавить их в статистику', onClick: () => self.scanClick() }, this.scanning ? 'Остановить' : 'Сканировать сообщения');
    const clearBtn = h('button', { type: 'button', class: ['ogx-btn', P + 'clear'], 'data-ogx-act': 'stats:clear', title: 'Удалить собранную статистику из дополнения', onClick: () => self.clearClick() }, 'Очистить');
    const stored = `Сохранено: боёв ${num(Object.values(this.data.combat.items).filter((r) => r && r.kind === 'battle').length)}, экспедиций ${num(Object.keys(this.data.exp.items).length)}, других ${num(Object.keys(this.data.fleet.items).length)}`;
    root.appendChild(h('div', { class: P + 'head' },
      h('div', { class: P + 'tools' }, h('span', { class: P + 'lbl' }, 'Период:'), periodSel, custom, h('span', { class: P + 'grow' }), scanBtn, clearBtn),
      h('div', { class: P + 'info' }, stored, ` · курс ${S.rates.map((x) => String(x).replace('.', ',')).join(':')}`),
      h('div', { class: P + 'progress', hidden: !this.scanning }, ''),
      isGz() ? h('div', { class: P + 'note', 'data-k': 'gz-note' }, 'GALAXYZ: формат боевых, экспедиционных и транспортных сообщений взят из исходников 2Moons и ещё не сверен с живым сервером. '
        + 'Находки экспедиций (ресурсы и ТМ) приходят в сообщении о возвращении флота.') : null));

    // --- chart
    root.appendChild(this.renderChart(S));

    // --- sections
    root.appendChild(this.renderCombat(S));
    root.appendChild(this.renderExpeditions(S));
    root.appendChild(this.renderHarvest(S));
    root.appendChild(this.renderTransport(S));
    if (!S.C.count && !S.E.count && !S.H.count && !S.Tr.receivedN && !S.Tr.returnsN && !S.Tr.deliveredN) {
      root.appendChild(h('div', { class: P + 'empty' }, 'За выбранный период данных нет. Откройте раздел «Сообщения» или нажмите «Сканировать сообщения».'));
    }
  };

  const kv = (k, label, value, opts = {}) => h('div', { class: [P + 'kv', opts.cls], dataset: { k } },
    h('span', { class: P + 'k' }, label), h('span', { class: [P + 'v', opts.vcls], title: opts.title || null }, value));
  const resLine = (r, approx) => {
    const pre = approx ? '≈' : '';
    return h('span', { class: P + 'res' },
      h('span', { class: P + 'm' }, 'М ' + pre + num(r.metal)), ' · ', h('span', { class: P + 'c' }, 'К ' + pre + num(r.crystal)), ' · ', h('span', { class: P + 'd' }, 'Д ' + pre + num(r.deuterium)));
  };
  const sec = (id, title, ...children) => h('section', { class: P + 'sec', dataset: { sec: id } }, h('h3', { class: P + 'h' }, title), ...children);
  const signedCls = (n) => (n > 0 ? P + 'pos' : n < 0 ? P + 'neg' : null);

  Stats.prototype.renderCombat = function (S) {
    const C = S.C;
    const ap = C.approx ? '≈' : '';
    const roleRow = (role) => {
      const x = C.byRole[role];
      const n = x.win + x.loss + x.draw + x.unknown;
      return h('tr', { dataset: { role } }, h('td', null, ROLE_RU[role]), h('td', { class: P + 'pos' }, num(x.win)), h('td', { class: P + 'neg' }, num(x.loss)), h('td', null, num(x.draw)), h('td', null, num(n)));
    };
    const roles = ['attack', 'defense', 'expedition'].concat(C.byRole.other.win + C.byRole.other.loss + C.byRole.other.draw + C.byRole.other.unknown ? ['other'] : []);
    const table = h('table', { class: 'ogx-table ' + P + 'roles' },
      h('thead', null, h('tr', null, h('th', null, 'Роль'), h('th', null, 'Победы'), h('th', null, 'Поражения'), h('th', null, 'Ничьи'), h('th', null, 'Всего'))),
      h('tbody', null, roles.map(roleRow)));
    const extra = [];
    if (C.lostContact) extra.push(`потеря связи: ${num(C.lostContact)}`);
    if (C.missileAttacks) extra.push(`ракетные удары: ${num(C.missileAttacks)} (урон ${short(C.missilesLossEnemy)})`);
    if (C.missileDefenses) extra.push(`ракетные атаки на нас: ${num(C.missileDefenses)} (потери ${short(C.missilesLossOwn)})`);
    if (C.moonDestruction) extra.push(`уничтожение лун: ${num(C.moonDestruction)}`);
    return sec('combat', 'Бои',
      kv('combat-count', 'Боёв', num(C.count) + (C.count ? ` (полных докладов: ${num(C.full)})` : '')),
      C.count ? table : null,
      kv('combat-loot', 'Добыча', h('span', null, ap + num(C.lootGained.total), ' ', C.lootSplitUnknown ? null : resLine(C.lootGained))),
      C.lootLost.total ? kv('combat-loot-lost', 'Украдено у нас', ap + num(C.lootLost.total), { vcls: P + 'neg' }) : null,
      kv('combat-losses-own', 'Наши потери', num(C.lossesOwn), { vcls: C.lossesOwn ? P + 'neg' : null, title: 'Стоимость уничтоженных юнитов (металл + кристалл + дейтерий)' }),
      kv('combat-losses-enemy', 'Потери противника', num(C.lossesEnemy)),
      kv('combat-debris', 'Обломки', h('span', null, num(C.debris.total), ' ', C.debrisSplitUnknown || !C.debris.total ? null : resLine(C.debris))),
      kv('combat-moons', 'Луны', `создано ${isGz() && C.count && !C.full ? 'неизвестно' : num(C.moonsCreated)}${C.moonChances ? ` · боёв с шансом: ${num(C.moonChances)}, ожидаемо ${OGX.fmt.num(Math.round(C.moonExpected * 100) / 100)}` : ''}`,
        { title: 'Создание луны видно только в полном докладе' }),
      kv('combat-net', 'Итог (ЕМ)', (C.approx || C.lootSplitUnknown ? '≈' : '') + OGX.fmt.signed(Math.round(C.net)), { vcls: signedCls(C.net), title: 'Добыча − наши потери − украденное у нас, в единицах металла по курсу' }),
      extra.length ? h('div', { class: P + 'note' }, extra.join(' · ')) : null);
  };

  Stats.prototype.renderExpeditions = function (S) {
    const E = S.E;
    const n = E.count || 0;
    const rows = OUTCOMES.filter((o) => E.outcomes[o] || (o !== 'unknown' && o !== 'battle')).map((o) => {
      const c = E.outcomes[o];
      const frac = n ? c / n : 0;
      return h('div', { class: [P + 'orow', P + 'o-' + OUTCOME_CLS[o]], dataset: { outcome: o } },
        h('span', { class: P + 'olabel' }, OUTCOME_RU[o]),
        h('span', { class: P + 'obar' }, OGX.dom.bar(frac, { cls: OUTCOME_CLS[o] === 'bad' ? 'ogx-bad' : OUTCOME_CLS[o] === 'warn' ? 'ogx-warn' : 'ogx-ok', title: OGX.fmt.pct(frac, 1) })),
        h('span', { class: P + 'ocount' }, num(c)),
        h('span', { class: P + 'opct' }, n ? OGX.fmt.pct(frac) : '—'));
    });
    const shipIds = Object.keys(E.ships).sort((a, b) => E.ships[b] - E.ships[a]);
    const shipList = shipIds.length ? h('div', { class: P + 'ships' }, shipIds.map((id) => h('span', { class: P + 'ship', dataset: { ship: id } }, `${OGX.catalog.name(+id) || id}: ${num(E.ships[id])}`))) : '—';
    return sec('expeditions', 'Экспедиции',
      kv('exp-count', 'Экспедиций', num(n)),
      h('div', { class: P + 'outcomes' }, rows),
      kv('exp-resources', 'Найдено ресурсов', resLine(E.resources), E.amountsInReturn || E.returns ? { title: `По сообщениям о возвращении экспедиций (груз флота): ${num(E.returns)}` } : {}),
      kv('exp-dm', 'Тёмная материя', num(E.darkMatter)),
      kv('exp-ships', 'Найдено кораблей', shipList, { title: E.shipsValue ? `Стоимость: ${num(E.shipsValue)} ЕМ` : null }),
      kv('exp-avg', 'В среднем за экспедицию', n ? `${num(E.resourcesMsu / n)} ЕМ ресурсов · ${num(E.darkMatter / n)} ТМ · ${num((E.resourcesMsu + E.shipsValue) / n)} ЕМ с кораблями` : '—'),
      kv('exp-blackholes', 'Чёрные дыры', num(E.blackHoles), { vcls: E.blackHoles ? P + 'neg' : null }),
      E.battles ? kv('exp-battles', 'Бои в экспедициях', num(E.battles)) : null);
  };

  Stats.prototype.renderHarvest = function (S) {
    const H = S.H;
    const ships = Object.keys(H.ships).map((s) => `${s}: ${num(H.ships[s])}`).join(', ');
    return sec('harvest', 'Переработка',
      kv('harvest-count', 'Переработок', num(H.count)),
      kv('harvest-total', 'Собрано', h('span', null, num(resTotal(H.harvested)), ' ', resLine(H.harvested))),
      H.count && H.fieldKnown ? kv('harvest-field', 'Было в полях', num(resTotal(H.field)), { title: `${OGX.fmt.res(H.field)}\nВместимость флотов: ${num(H.capacity)}` }) : null,
      ships ? kv('harvest-ships', 'Флоты', ships) : null);
  };

  Stats.prototype.renderTransport = function (S) {
    const T = S.Tr;
    const other = [];
    if (T.returnsEmpty) other.push(`возвратов без груза: ${num(T.returnsEmpty)}`);
    if (T.deployEmpty) other.push(`оставлено без груза: ${num(T.deployEmpty)}`);
    if (T.acs) other.push(`удержание: ${num(T.acs)}`);
    if (T.invites) other.push(`приглашений САБ: ${num(T.invites)}`);
    if (T.colonies) other.push(`колоний основано: ${num(T.colonies)}`);
    if (T.colonyFails) other.push(`неудачных колонизаций: ${num(T.colonyFails)}`);
    if (T.relocations) other.push(`перемещений планет: ${num(T.relocations)}`);
    if (T.wreckRepairs) other.push(`восстановлено из обломков флота: ${num(T.wreckShips)} кор.`);
    if (T.unknown) other.push(`не распознано: ${num(T.unknown)}`);
    return sec('transport', 'Транспорт',
      kv('tr-received', `Получено от игроков (${num(T.receivedN)})`, resLine(T.received)),
      kv('tr-delivered', `Доставлено (${num(T.deliveredN)})`, resLine(T.delivered)),
      kv('tr-returns', `Возвраты с ресурсами (${num(T.returnsN)}${T.returnsExp ? ', из экспедиций ' + num(T.returnsExp) : ''})`, resLine(T.returns), { title: 'Груз вернувшихся флотов: добыча и остатки' }),
      T.deployedN ? kv('tr-deployed', `Оставлено с грузом (${num(T.deployedN)})`, resLine(T.deployed), { title: 'Дейтерий включает возврат половины топлива' }) : null,
      other.length ? h('div', { class: P + 'note' }, 'Прочее: ' + other.join(' · ')) : null);
  };

  Stats.prototype.renderChart = function (S) {
    const self = this;
    let which = this.set('chart');
    if (!SECTIONS.some((s) => s.value === which)) which = 'expeditions';
    const meta = SECTIONS.find((s) => s.value === which);
    const chips = h('div', { class: P + 'chips', role: 'tablist' }, SECTIONS.map((s) => h('button', {
      type: 'button', class: ['ogx-btn', P + 'chip', s.value === which && P + 'chip-on'], 'data-ogx-act': 'stats:chart-' + s.value, 'aria-pressed': s.value === which ? 'true' : 'false',
      onClick: async () => { await self.ctx.settings.set('chart', s.value); self.refresh(); },
    }, s.label)));
    // day axis
    let d0 = S.range.d0, d1 = S.range.d1;
    if (d0 === null) { const keys = [...S.days.keys()]; d0 = keys.length ? Math.min(...keys) : d1; }
    if (d1 - d0 > 89) d0 = d1 - 89;
    const days = [];
    for (let d = d0; d <= d1; d++) days.push({ d, v: S.days.has(d) ? S.days.get(d)[which] : 0, n: S.days.has(d) ? S.days.get(d).n[which] : 0 });
    const W = 400, Hh = 130, padL = 44, padB = 16, padT = 6;
    const vMax = Math.max(0, ...days.map((x) => x.v)), min = Math.min(0, ...days.map((x) => x.v));
    const empty = vMax === 0 && min === 0;
    // all zero: the 0 line goes to the bottom (a scale of 0..1), and only one «0» label is drawn
    const max = empty ? 1 : vMax;
    const span = max - min || 1;
    const y = (v) => padT + (max - v) / span * (Hh - padT - padB);
    const bw = (W - padL) / Math.max(1, days.length);
    const g = svg('svg', { class: P + 'chart', viewBox: `0 0 ${W} ${Hh}`, width: '100%', role: 'img', 'aria-label': meta.metric, preserveAspectRatio: 'none' });
    g.appendChild(svg('line', { x1: padL, x2: W, y1: y(0), y2: y(0), class: P + 'axis' }));
    if (vMax > 0) g.appendChild(svg('text', { x: padL - 3, y: y(max) + 8, 'text-anchor': 'end', class: P + 'tick' }, short(max)));
    if (min < 0) g.appendChild(svg('text', { x: padL - 3, y: y(min), 'text-anchor': 'end', class: P + 'tick' }, short(min)));
    g.appendChild(svg('text', { x: padL - 3, y: y(0) + 3, 'text-anchor': 'end', class: P + 'tick' }, '0'));
    if (empty) g.appendChild(svg('text', { x: (padL + W) / 2, y: (padT + Hh - padB) / 2 + 4, 'text-anchor': 'middle', class: P + 'tick ' + P + 'chart-empty' }, 'Нет данных за период'));
    const every = Math.max(1, Math.ceil(days.length / 8));
    days.forEach((x, i) => {
      const x0 = padL + i * bw + Math.min(1, bw * 0.15);
      const top = Math.min(y(x.v), y(0)), hgt = Math.max(x.v ? 1 : 0, Math.abs(y(x.v) - y(0)));
      const bar = svg('rect', { x: x0.toFixed(1), y: top.toFixed(1), width: Math.max(1, bw - Math.min(2, bw * 0.3)).toFixed(1), height: hgt.toFixed(1), class: P + 'bar ' + (x.v < 0 ? P + 'bar-neg' : P + 'bar-pos'), 'data-day': isoDay(x.d), 'data-v': Math.round(x.v) },
        svg('title', null, `${dayLabel(x.d)}: ${OGX.fmt.num(Math.round(x.v))} ЕМ · сообщений ${x.n}`));
      g.appendChild(bar);
      if (i % every === 0) g.appendChild(svg('text', { x: (x0 + bw / 2).toFixed(1), y: Hh - 3, 'text-anchor': 'middle', class: P + 'tick' }, dayLabel(x.d)));
    });
    return h('div', { class: P + 'chartbox', dataset: { chart: which } }, chips, h('div', { class: P + 'metric' }, meta.metric + ' по дням'), g);
  };

  // ================================================================== message badges
  Stats.prototype.recordFor = function (id, kind) {
    if (kind) return this.data[kind].items[id] || null;
    return this.data.combat.items[id] || this.data.exp.items[id] || this.data.fleet.items[id] || null;
  };

  Stats.prototype.badge = function (id, li, kind, bodyCell) {
    const old = this.badges.get(id);
    if (old && old.li === li && old.el.isConnected) { this.fillBadge(id); return; }
    const el = h('div', { class: P + 'badge ogx-root', dataset: { msgId: String(id) } });
    if (li.matches && li.matches('tr.message_head')) {
      // GALAXYZ: top of the body cell (a div in the tr would become a table cell and squeeze the table)
      const next = li.nextElementSibling;
      const td = bodyCell || (next && next.matches('tr.messages_body') ? next.querySelector('td') : null);
      if (!td) return;
      td.insertBefore(el, td.firstChild);
    } else {
      // inside li.msg, before message-footer.msg_actions (fleets/subtab.blade.php:53-56); fallback: end of li
      const footer = li.querySelector(':scope > message-footer');
      if (footer) li.insertBefore(el, footer); else li.appendChild(el);
    }
    this.badges.set(id, { li, el, kind });
    this.fillBadge(id);
  };

  Stats.prototype.refreshBadge = function (id) { if (this.badges.has(id)) this.fillBadge(id); };
  Stats.prototype.refreshBadges = function () {
    for (const [id, b] of this.badges) {
      if (!this.set('showBadges')) { b.el.remove(); this.badges.delete(id); continue; }
      this.fillBadge(id);
    }
  };

  Stats.prototype.fillBadge = function (id) {
    const b = this.badges.get(id);
    if (!b) return;
    if (!b.el.isConnected) { this.badges.delete(id); return; }
    const r = this.recordFor(id, b.kind);
    b.el.textContent = '';
    const parts = this.describe(r, b.kind);
    if (!parts) { b.el.remove(); this.badges.delete(id); return; }
    b.el.append(...spaced(parts));
  };

  /** Badge content for one record -> Node[] | null */
  Stats.prototype.describe = function (r, kind) {
    if (!r) return null;
    const rates = this.rates();
    const tag = (cls, text, title) => h('span', { class: [P + 'tag', cls && P + cls], title: title || null }, text);
    if (kind === 'exp') {
      const out = [tag('o-' + OUTCOME_CLS[r.outcome], OUTCOME_RU[r.outcome] || r.outcome, 'Экспедиция: ' + (r.key || ''))];
      if (resTotal(r.resources)) out.push(tag('amt', OGX.fmt.res(r.resources)));
      if (r.darkMatter) out.push(tag('amt', 'ТМ ' + num(r.darkMatter)));
      const ships = Object.entries(r.ships || {});
      if (ships.length) out.push(tag('amt', ships.map(([sid, n]) => `${OGX.catalog.shortName(+sid) || sid} ${num(n)}`).join(', ')));
      if (r.amountsInReturn && (r.outcome === 'resources' || r.outcome === 'dark_matter')) out.push(tag('muted', 'количество — в сообщении о возвращении флота'));
      return out;
    }
    if (kind === 'combat') {
      if (r.kind === 'battle') {
        const net = this.battleNet(r, rates);
        const ap = r.approx || (!r.lootSplit && r.loot.total) ? '≈' : '';
        return [
          tag(r.result === 'win' ? 'o-good' : r.result === 'loss' ? 'o-bad' : 'o-neutral', `${ROLE_RU[r.role] || ''}: ${RESULT_RU[r.result] || ''}`, r.opponent ? 'Противник: ' + r.opponent : null),
          r.role !== 'expedition' && r.loot.total ? tag('amt', `Добыча ${ap}${num(r.loot.total)}`, r.lootSplit ? OGX.fmt.res(r.loot) : 'Точная разбивка — в полном докладе') : null,
          tag('amt', `Потери ${num(r.lossesOwn)} / противник ${num(r.lossesEnemy)}`),
          r.debris.total ? tag('amt', `Обломки ${num(r.debris.total)}`) : null,
          r.moonCreated ? tag('o-good', 'Луна!') : r.moonChance ? tag('amt', `Шанс луны ${r.moonChance}%`) : null,
          r.role !== 'other' ? tag(net > 0 ? 'pos' : net < 0 ? 'neg' : null, `Итог ${ap}${OGX.fmt.signed(Math.round(net))}`, 'В единицах металла по курсу ' + rates.join(':')) : null,
        ].filter(Boolean);
      }
      if (r.kind === 'missile_attack' || r.kind === 'missile_defense') {
        return [tag(r.kind === 'missile_attack' ? 'o-good' : 'o-bad', r.kind === 'missile_attack' ? 'Ракетный удар' : 'Ракетная атака на нас'),
          tag('amt', `Ракет ${r.missiles == null ? '—' : num(r.missiles)}, перехвачено ${r.intercepted == null ? '—' : num(r.intercepted)}`),
          tag('amt', `Уничтожено обороны на ${num(r.kind === 'missile_attack' ? r.lossesEnemy : r.lossesOwn)}`)];
      }
      if (r.kind === 'lost_contact') return [tag('o-bad', 'Флот уничтожен в первом раунде')];
      return null;
    }
    // fleet / economy
    const out = [tag('o-neutral', FLEET_KEY_RU[r.key] || r.key)];
    if (r.harvest) {
      out.push(tag('amt', 'Собрано ' + OGX.fmt.res(r.harvest.harvested)));
      if (r.harvest.ship) out.push(tag('amt', `${r.harvest.ship} ${num(r.harvest.ships)}, трюм ${num(r.harvest.capacity)}`));
    }
    else if (r.resources && resTotal(r.resources)) out.push(tag('amt', OGX.fmt.res(r.resources)), tag('amt', '= ' + num(resTotal(r.resources))));
    if (r.expReturn || (r.key === 'return_of_fleet_with_resources' && r.from && posOf(r.from.coords) === 16)) out.push(tag('o-good', 'из экспедиции'));
    if (r.expReturn && r.darkMatter) out.push(tag('amt', 'ТМ ' + num(r.darkMatter)));
    if (r.shipsRepaired) out.push(tag('amt', `Кораблей ${num(r.shipsRepaired)}`));
    return out;
  };

  // ================================================================== per-page summary
  Stats.prototype.trackSummary = function (li, subtab, id) {
    if (!this.set('showSummary')) return;
    const ul = li.parentElement;
    if (!ul) return;
    // GALAXYZ: one tbody holds every row (the "All" list mixes categories): one summary per subtab of that table
    const gz = li.matches && li.matches('tr.message_head');
    const key = gz ? 'gz:' + subtab : ul;
    let s = this.summaries.get(key);
    if (s && s.ul !== ul) { if (s.el) s.el.remove(); s = null; }
    if (!s) { s = { el: null, subtab, ids: new Set(), ul, gz }; this.summaries.set(key, s); }
    s.ids.add(id);
    this.summarySoon();
  };

  Stats.prototype.updateSummaries = function () {
    const rates = this.rates();
    for (const [key, s] of this.summaries) {
      const ul = s.ul || key;
      if (!ul.isConnected || !this.set('showSummary')) { if (s.el) s.el.remove(); this.summaries.delete(key); continue; }
      if (!s.el || !s.el.isConnected) {
        if (s.gz) {
          // GALAXYZ: a table row (td colspan=4) before the first message row of #messagestable
          s.box = h('div', { class: P + 'summary ogx-root', dataset: { subtab: s.subtab } });
          s.el = h('tr', { class: P + 'summary-row' }, h('td', { colspan: '4', class: P + 'summary-cell' }, s.box));
          const first = ul.querySelector(':scope > tr.message_head');
          ul.insertBefore(s.el, first || null);
        } else {
          // a li at the top of ul.tab_inner, before the first message (fleets/subtab.blade.php: ul.pagination, input, li.msg…)
          s.el = h('li', { class: P + 'summary ogx-root', dataset: { subtab: s.subtab } });
          s.box = s.el;
          const first = ul.querySelector(':scope > li.msg');
          ul.insertBefore(s.el, first || null);
        }
      }
      s.box.textContent = '';
      s.box.append(...spaced(this.summaryParts(s, rates)));
    }
  };

  Stats.prototype.summaryParts = function (s, rates) {
    const out = [h('span', { class: P + 'sum-title' }, 'На странице:')];
    const add = (text, cls) => out.push(h('span', { class: [P + 'sum-item', cls && P + cls] }, text));
    const ids = [...s.ids];
    if (s.subtab === 'expeditions') {
      const recs = ids.map((id) => this.data.exp.items[id]).filter(Boolean);
      const res = zeroRes(); let dm = 0; const ships = {}; const oc = {};
      for (const r of recs) { addRes(res, r.resources); dm += r.darkMatter || 0; for (const [k, n] of Object.entries(r.ships || {})) ships[k] = (ships[k] || 0) + n; oc[r.outcome] = (oc[r.outcome] || 0) + 1; }
      add(`${num(recs.length)} ${OGX.fmt.plural(recs.length, ['экспедиция', 'экспедиции', 'экспедиций'])}`);
      if (resTotal(res)) add(OGX.fmt.res(res));
      if (dm) add('ТМ ' + num(dm));
      const sc = OGX.util.shipsTotal(ships);
      if (sc) add(`кораблей ${num(sc)}`);
      add(OUTCOMES.filter((o) => oc[o]).map((o) => `${OUTCOME_RU[o]} ${oc[o]}`).join(', '), 'muted');
    } else if (s.subtab === 'combat_reports') {
      const recs = ids.map((id) => this.data.combat.items[id]).filter((r) => r && r.kind === 'battle');
      let win = 0, loss = 0, loot = 0, lossOwn = 0, net = 0, approx = false;
      for (const r of recs) {
        if (r.result === 'win') win++; else if (r.result === 'loss') loss++;
        if (r.role === 'attack') loot += r.loot.total || 0;
        lossOwn += r.role !== 'other' ? r.lossesOwn || 0 : 0;
        net += this.battleNet(r, rates);
        if (r.approx || !r.lootSplit) approx = true;
      }
      add(`${num(recs.length)} ${OGX.fmt.plural(recs.length, ['бой', 'боя', 'боёв'])}: побед ${win}, поражений ${loss}`);
      add(`добыча ${approx ? '≈' : ''}${num(loot)}`);
      add(`потери ${num(lossOwn)}`);
      add(`итог ${approx ? '≈' : ''}${OGX.fmt.signed(Math.round(net))} ЕМ`, net > 0 ? 'pos' : net < 0 ? 'neg' : null);
    } else {
      const recs = ids.map((id) => this.data.fleet.items[id]).filter(Boolean);
      const res = zeroRes(), harv = zeroRes(); let nh = 0;
      for (const r of recs) { if (r.harvest) { addRes(harv, r.harvest.harvested); nh++; } else if (r.resources) addRes(res, r.resources); }
      add(`${num(recs.length)} ${OGX.fmt.plural(recs.length, ['сообщение', 'сообщения', 'сообщений'])}`);
      if (resTotal(res)) add('ресурсы ' + OGX.fmt.res(res));
      if (nh) add(`переработка (${nh}): ${OGX.fmt.res(harv)}`);
    }
    return out;
  };

  /** Nodes separated by a space text node (the flex gap is visual only; textContent stays readable/copyable). */
  function spaced(nodes) {
    const out = [];
    nodes.forEach((n, i) => { if (i) out.push(document.createTextNode(' ')); out.push(n); });
    return out;
  }

  function subtabRu(s) {
    return { combat_reports: 'боевые доклады', expeditions: 'экспедиции', transport: 'транспорт', other: 'прочее', economy: 'экономика' }[s] || s;
  }

  const CSS = `
.${P}root { display: flex; flex-direction: column; gap: 8px; }
.${P}head { display: flex; flex-direction: column; gap: 4px; }
.${P}tools { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.${P}grow { flex: 1 1 auto; }
.${P}lbl, .${P}info, .${P}metric, .${P}note, .${P}empty { color: var(--ogx-muted, #8a99ab); }
.${P}progress { color: var(--ogx-accent, #6f9fd8); }
.${P}custom input { width: 120px; }
/* the game hides every <select> (body.ogame select { visibility: hidden }) for its own dropdown widget */
.${P}tools select.${P}period { visibility: visible; }
.${P}sec { border: 1px solid var(--ogx-border, #2b3846); border-radius: 3px; padding: 4px 6px; background: var(--ogx-panel, #161c24); }
.${P}h { margin: 0 0 4px; font-size: 12px; color: var(--ogx-accent, #6f9fd8); }
.${P}kv { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; border-bottom: 1px dotted rgba(255,255,255,0.06); }
.${P}k { color: var(--ogx-muted, #8a99ab); }
.${P}v { text-align: right; }
.${P}m { color: var(--ogx-metal, #a9b5c4); } .${P}c { color: var(--ogx-crystal, #79c2e8); } .${P}d { color: var(--ogx-deuterium, #7fe0b4); }
.${P}pos { color: var(--ogx-ok, #4caf50); } .${P}neg { color: var(--ogx-bad, #f44336); }
.${P}roles { width: 100%; margin: 3px 0; } .${P}roles td, .${P}roles th { text-align: right; } .${P}roles td:first-child, .${P}roles th:first-child { text-align: left; }
.${P}outcomes { display: flex; flex-direction: column; gap: 1px; margin: 3px 0; }
.${P}orow { display: grid; grid-template-columns: 110px 1fr 40px 36px; gap: 6px; align-items: center; }
.${P}ocount, .${P}opct { text-align: right; }
.${P}ships { display: flex; flex-wrap: wrap; gap: 2px 8px; justify-content: flex-end; }
.${P}chartbox { display: flex; flex-direction: column; gap: 3px; }
.${P}chips { display: flex; gap: 3px; flex-wrap: wrap; }
.${P}chip { padding: 1px 6px; font-size: 10px; } .${P}chip-on { border-color: var(--ogx-accent, #6f9fd8); color: var(--ogx-accent, #6f9fd8); }
.${P}chart { height: 130px; background: var(--ogx-panel, #161c24); border: 1px solid var(--ogx-border, #2b3846); }
.${P}axis { stroke: var(--ogx-border, #2b3846); stroke-width: 1; }
.${P}tick { fill: var(--ogx-muted, #8a99ab); font-size: 9px; }
.${P}bar-pos { fill: var(--ogx-accent, #6f9fd8); } .${P}bar-neg { fill: var(--ogx-bad, #f44336); }
.${P}confirm p { margin: 0 0 6px; } .${P}check { display: flex; gap: 4px; align-items: center; }
.${P}badge, .${P}summary { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0; padding: 3px 6px; border: 1px solid var(--ogx-border, #2b3846);
  background: var(--ogx-panel, #161c24); color: var(--ogx-text, #cfd8e3); font-size: 11px; border-radius: 3px; list-style: none; }
.${P}summary { border-color: var(--ogx-accent, #6f9fd8); }
.${P}badge, .${P}summary { box-sizing: border-box; max-width: 100%; text-align: left; }
td.${P}summary-cell { padding: 0 2px; }
.${P}note { font-size: 10px; }
.${P}sum-title { font-weight: bold; color: var(--ogx-accent, #6f9fd8); }
.${P}muted { color: var(--ogx-muted, #8a99ab); }
.${P}tag { white-space: nowrap; }
.${P}o-good { color: var(--ogx-ok, #4caf50); font-weight: bold; } .${P}o-bad { color: var(--ogx-bad, #f44336); font-weight: bold; }
.${P}o-warn { color: var(--ogx-warn, #ff9800); font-weight: bold; } .${P}o-neutral { color: var(--ogx-muted, #8a99ab); font-weight: bold; }
`;
})(window.OGX);
