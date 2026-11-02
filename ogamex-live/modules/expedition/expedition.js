/* ogamex-live/modules/expedition/expedition.js — Owner: live/expedition.
 * One-click random expedition + expedition max find (DESIGN §4.1.6, OGame Live rows 16 and 17, OL §4.13, §5.6).
 *
 *  1. Button «Экспедиция» (a.ogx-l-expedition-btn) with a «± систем» input in #fleet2 #target .coords.
 *     Click: target [g : s + rand(-N..N) wrapped to 1..MAX_SYSTEM : 16] (s = origin system), mission 15, the remembered
 *     duration (clamped to the #expeditiontime options) and speed, all through the page bridge (fleetDispatcher).
 *     It submits (fleet.submit = trySubmitFleet2) only when the setting autoSubmit is on (default off).
 *     Duration and speed are remembered from every successful game send-fleet with position=16 & mission=15.
 *  2. Info box in #fleet1 and #fleet2: top-1 points (auto from /ajax/highscore via OGX.state.ensureTopScore, or the
 *     override), max find normal / rare (×3) / exceptional (×10) for M/C/D with OgameX rules (class, economy speed,
 *     Pathfinder in the selection, reward multiplier), minimum Battle Transporters (217) to carry each, whether the selected ships'
 *     cargo covers the normal max find, expedition slots used/max.
 *
 * OgameX facts (src/OGameX/...):
 *   resources/views/ingame/fleet/index.blade.php
 *     :171,178  MAX_POSITION = EXPEDITION_POSITION = 16 ; :170 MAX_SYSTEM (499)
 *     :797      first #slots (Fleets / Expeditions span.advice "1/2"); a second #slots at :822 (tactical retreat)
 *     :885-931  #fleet1 #technologies li[data-technology] > span.amount[data-value] + input[name=<class_name>]
 *     :940      #allornone ; :978 div.footer after it
 *     :981      #fleet2 (display:none until step 2) ; :1022 .ajax_loading (check-target in progress)
 *     :1056-1070 #fleet2 td#target > div.coords (galaxy/system/position inputs) — our button goes there
 *     :1310     select#expeditiontime (options 1..astrophysics level)
 *   resources/js/ingame/e7c74974620fa35b197315ebdbb8c2.js
 *     :34300 selectMission() re-reads #expeditiontime -> mission must be selected BEFORE setDuration
 *     :33552 setFleetPercent(1..10) ; :33266 trySubmitFleet2 ; :33811 submitFleet2 posts mission/speed/holdingtime
 *   app/GameMissions/ExpeditionMission.php:1020-1137 resource find (module-local lanedirtMaxFind)
 *   app/Http/Controllers/FleetController.php:529-562 speed 1..10 step 0.5, expedition hours 1..astrophysics
 *
 * GALAXYZ (ogamex.eu/Aeternum, 2Moons 1.8 fork; real fleetTable / fleetStep1 / fleetStep2 pages; rules [UPSTREAM]
 * MissionCaseExpedition, see the GALAXYZ section below). Class GzExpedition, everything through OGX.fleet.gz (never submits):
 *   - info box right below the game's «Continue» on page=fleetTable (selected ships), fleetStep1 (inline data.ships) and
 *     fleetStep2 ("Fleet points" = expedition points, data.fleetroom, cargo on board): resource find = min(free BASE cargo,
 *     fleet metal + crystal cost), ship finds (top-1 only sets the 4 500 / 6 000 points cap), dark matter, outcomes;
 *     expedition slots from the fleetTable header (stored for the other steps). No player class, no economy speed, no old
 *     OgameX top-1 table on GALAXYZ;
 *   - button «Экспедиция» + «±» in the form's header cell: fleetTable fills the hidden target [g : s ± N : 16] and
 *     target_mission 15 (the player picks ships and presses «Continue»), fleetStep1 fills the destination and the remembered speed;
 *   - fleetStep2: the box only when mission 15 is offered (2Moons offers only 15 for position 16); none chosen: selects it and the remembered
 *     select[name=staytime] option; the player submits;
 *   - speed and stay time are remembered from the player's own step1 / step2 form submits to position 16 / mission 15.
 * Data: reads state slots / server / factors / body ships, stored topScore (server scope; a page=statistics GET through
 * state.ensureTopScore only on the «узнать» click, free of deuterium); writes settings (randomSystems, rememberedDuration,
 * rememberedSpeed) and module storage (stayLabel). Step 2 ships and «Fleet points» come from core fleet.gz.state() (ships of
 * step 1 under the same token). No request without a click.
 */
(function (OGX) {
  'use strict';

  const NAME = 'expedition';
  const P = 'ogx-l-expedition-';
  const POS = 16;            // UniverseConstants::EXPEDITION_POSITION (fleet/index.blade.php:178)
  const MISSION = 15;        // MISSION_EXPEDITION
  const TS = (OGX.catalog && OGX.catalog.transportShip) || 217, PF = 219;   // every cargo count is in Battle Transporters (217)
  const RES = ['metal', 'crystal', 'deuterium'];
  const RES_RU = { metal: 'Металл', crystal: 'Кристалл', deuterium: 'Дейтерий' };
  const CLASS_RU = { miner: 'Коллекционер', warrior: 'Генерал', explorer: 'Первооткрыватель', none: 'без класса' };

  OGX.module({
    name: NAME,
    title: 'Экспедиции',
    pages: ['fleet'],
    settings: {
      randomSystems: { type: 'int', default: 0, min: 0, max: 99, label: 'Случайный разброс систем для кнопки «Экспедиция» (±)' },
      autoSubmit: { type: 'bool', default: false, label: 'Сразу отправлять флот после кнопки «Экспедиция»', hint: 'Только OgameX. Выключено: кнопка только заполняет цель, миссию, длительность и скорость, отправляете вы сами. На GALAXYZ кнопка всегда только заполняет форму' },
      topPointsOverride: { type: 'int', default: 0, min: 0, max: 1e13, label: 'Очки игрока №1 вручную (0 = из статистики)', hint: 'Сервер берёт максимум очков среди всех игроков, включая скрытых в статистике. GALAXYZ: важно только для находки кораблей (порог 5 млн)' },
      rewardMultiplier: { type: 'float', default: 1, min: 0.1, max: 1000, step: 0.1, label: 'Множитель находок ресурсов сервера', hint: 'Только OgameX: настройка администратора expedition_reward_multiplier_resources (обычно 1)' },
      rememberedDuration: { type: 'int', default: 1, min: 1, max: 99, label: 'Длительность экспедиции (запомнено)', hidden: true },
      rememberedSpeed: { type: 'float', default: 10, min: 0.5, max: 10, step: 0.5, label: 'Скорость экспедиции (запомнено)', hidden: true },
    },

    async init(ctx) {
      if (OGX.page.isGz && OGX.page.isGz()) {
        const step = OGX.fleet && OGX.fleet.gz ? OGX.fleet.gz.step() : null;
        if (step !== 0 && step !== 1 && step !== 2) { ctx.log.debug('GALAXYZ: no fleet selection or dispatch step, nothing to do'); return; }
        if (step === 0 && !gzShipForm()) { ctx.log.debug('GALAXYZ fleetTable without ships on the body, nothing to do'); return; }
        if (step === 2) {
          // fleetStep2 lists the missions the server allows for this target; without 15 (any target but position 16) the box would be noise
          let st = null;
          try { st = OGX.fleet.gz.state(); } catch (e) { st = null; }
          const missions = st && Array.isArray(st.missions) ? st.missions : [];
          if (!missions.some((m) => m.id === MISSION)) { ctx.log.debug('GALAXYZ fleetStep2 without mission 15 (' + missions.map((m) => m.id).join(',') + '), nothing to do'); return; }
        }
        ctx.css(CSS);
        const ex = new GzExpedition(ctx, step);
        ctx._ex = ex;
        await ex.start();
        return;
      }
      if (!OGX.dom.$('#fleet1') && !OGX.dom.$('#fleet2')) {
        ctx.log.debug('no #fleet1/#fleet2, nothing to do');
        return;
      }
      ctx.css(CSS);
      const ex = new Expedition(ctx);
      ctx._ex = ex;
      await ex.start();
    },

    dispose(ctx) {
      if (ctx._ex) ctx._ex.dispose();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);
  const rec = (src, what, data) => { try { OGX.log.rec(src, NAME, what, data); } catch (e) { /* journal off */ } };

  /** lanedirt OgameX ExpeditionMission resource find upper bound (app/GameMissions/ExpeditionMission.php:1020-1137). Module-local since
   * core calc.expeditionMaxFind follows 2Moons (GALAXYZ) now. metal/crystal/deuterium = the normal find (OL §5.6 recipe). */
  const LANEDIRT_STEPS = [[1e4, 4e4], [1e5, 5e5], [1e6, 12e5], [5e6, 18e5], [25e6, 24e5], [5e7, 3e6], [75e6, 36e5], [1e8, 42e5]];
  function lanedirtMaxFind({ topPoints = 0, playerClass, economySpeed = 1, hasPathfinder = false, rewardMultiplier = 1 } = {}) {
    let base = 5e6;
    for (const [lim, v] of LANEDIRT_STEPS) if (topPoints < lim) { base = v; break; }
    let max = Math.floor(base * (playerClass === 'explorer' ? 1.5 * (economySpeed || 1) : 1));
    if (hasPathfinder) max *= 2;
    max = Math.floor(max * (rewardMultiplier || 1));
    const res = (m) => ({ metal: m, crystal: Math.floor((m * 2) / 3), deuterium: Math.floor(m / 3) });
    const normal = res(max);
    return Object.assign({}, normal, { min: Math.max(1, Math.floor(base * 0.1)), base, normal, rare: res(max * 3), exceptional: res(max * 10) });
  }

  /** Local helper (not in core): wrap a system number into 1..max (OL's `% nb_systems` could give 0, OL §4.13). */
  function wrapSystem(s, max) {
    const m = Math.max(1, Math.floor(max) || 499);
    return ((((Math.floor(s) - 1) % m) + m) % m) + 1;
  }
  /** Uniform integer in [-n, n]. */
  function randOffset(n) {
    n = Math.max(0, Math.floor(n) || 0);
    return n ? Math.floor(Math.random() * (2 * n + 1)) - n : 0;
  }
  function pctText(speed) {
    return OGX.fmt.num(Math.round(speed * 10)) + '%';
  }
  function hoursText(hrs) {
    return OGX.fmt.num(hrs) + ' ч';
  }

  /** GALAXYZ page=fleetTable ship selection form (posts to fleetStep1, holds input#ship<ID>_input). */
  function gzShipForm() {
    return OGX.dom.$$('form[action*="page=fleetStep1"]').find((f) => f.querySelector('input[id^="ship"][id$="_input"]')) || null;
  }
  /** Sets a game form field and fires the event its inline handler listens to (onkeyup / onchange = updateVars()). */
  function setField(el, value, type) {
    if (!el) return false;
    el.value = String(value);
    el.dispatchEvent(new Event(type, { bubbles: true }));
    return true;
  }

  // ------------------------------------------------------------------ main
  class Expedition {
    constructor(ctx) {
      this.ctx = ctx;
      this.offs = [];
      this.boxes = [];
      this.btn = null;
      this.randInput = null;
      this.fp = null;
      this.player = null;
      this.server = null;
      this.stats = {};
      this.top = null;          // { points, t } from core
      this.topLoading = false;
      this.topError = false;
      this.busy = false;
      this.renderSoon = OGX.util.debounce(() => OGX.safe(() => this.render(), 'expedition:render')(), 120);
      // Every action performed by the add-on becomes a timed B event (+ S error with stack when it throws).
      this.sendRandom = OGX.log.wrap(NAME, this._sendRandom.bind(this), 'randomExpedition');
      this.remember = OGX.log.wrap(NAME, this._remember.bind(this), 'remember');
    }

    async start() {
      const ctx = this.ctx;
      this.fp = this.readFleetPage();
      await this.loadState();
      this.mountBoxes();
      this.mountButton();
      this.render();

      // selection changes (game inputs in #fleet1; game JS also fills them on icon click / #sendall / #resetall)
      const onSel = (e) => {
        const t = e && e.target;
        if (!t || !t.closest) return;
        if (t.closest('[class*="ogx-"]')) return;
        if (t.closest('#fleet1 #technologies') || t.closest('#sendall') || t.closest('#resetall') || t.closest('#fleet1 #allornone')) this.renderSoon();
      };
      for (const type of ['input', 'keyup', 'change', 'focusout', 'click']) this.offs.push(ctx.on(document, type, onSel, true));
      // values set by the game without events (template select, max buttons): cheap DOM re-read
      this.offs.push(ctx.every(2000, () => this.renderIfSelectionChanged()));

      this.offs.push(OGX.state.onChange(['shipStats', 'research', 'player', 'server'], () => { this.loadState().then(() => this.renderSoon()); }));
      this.offs.push(ctx.settings.onChange((key) => {
        if (key === 'topPointsOverride') this.ensureTop();
        if (key === 'rememberedDuration' || key === 'rememberedSpeed' || key === 'randomSystems') this.updateButton();
        this.renderSoon();
      }));
      // Remember duration and speed from the game's own successful expedition sends (bridge relay of the XHR).
      this.offs.push(OGX.bridge.onXhr(/^\/ajax\/fleet\/dispatch\/send-fleet$/, (x) => this.onSendFleet(x)));

      this.ensureTop();
    }

    dispose() {
      for (const off of this.offs.splice(0)) { try { off && off(); } catch (e) { /* ignore */ } }
      if (this.renderSoon.cancel) this.renderSoon.cancel();
    }

    // ---------------------------------------------------------------- data
    readFleetPage() {
      const snap = OGX.state.snapshot && OGX.state.snapshot();
      let fp = snap && snap.fleetPage;
      if (!fp) { try { fp = OGX.parse.fleetPage(document); } catch (e) { this.ctx.log.warn('parse.fleetPage failed', e); fp = null; } }
      fp = fp || {};
      // sanity checks -> learning alerts when the markup drifts
      if (fp.expSlots) {
        OGX.learn.value('expedition.expSlots.used', fp.expSlots.used, { min: 0, int: true });
        OGX.learn.value('expedition.expSlots.max', fp.expSlots.max, { min: 0, int: true });
      } else if (OGX.dom.$('#fleet1')) {
        this.ctx.log.warn('expedition slots not found in #fleet1 #slots');
        rec('S', 'expSlots-missing', { url: location.pathname });
      }
      if (fp.maxSystem !== null && fp.maxSystem !== undefined) OGX.learn.value('expedition.maxSystem', fp.maxSystem, { min: 1, max: 100000, int: true });
      return fp;
    }

    async loadState() {
      const [player, server, stats] = await Promise.all([OGX.state.player(), OGX.state.server(), OGX.state.shipStats()]);
      this.player = player || {};
      this.server = server || {};
      this.stats = stats || {};
      OGX.learn.value('expedition.economySpeed', +this.server.economySpeed || 1, { min: 0.01, max: 10000 });
    }

    async ensureTop() {
      if (this.ctx.settings.get('topPointsOverride') > 0) { this.renderSoon(); return; }
      if (this.topLoading) return;
      this.topLoading = true;
      this.renderSoon();
      try {
        const r = await OGX.state.ensureTopScore();
        if (r && fin(r.points)) {
          this.top = r;
          this.topError = false;
          OGX.learn.value('expedition.topPoints', r.points, { min: 0 });
        } else {
          this.topError = !this.top;
          if (!r) this.ctx.log.warn('top score unavailable (highscore request failed or no rank-1 row)');
        }
      } catch (e) {
        this.topError = !this.top;
        this.ctx.log.warn('ensureTopScore failed', e);
      } finally {
        this.topLoading = false;
        this.renderSoon();
      }
    }

    topPoints() {
      const ov = +this.ctx.settings.get('topPointsOverride') || 0;
      if (ov > 0) return { points: ov, manual: true };
      if (this.top && fin(this.top.points)) return { points: this.top.points, manual: false, t: this.top.t };
      return null;
    }

    /** Ships typed into #fleet1 inputs (clamped to the amount on the body). */
    readSelection() {
      const out = {};
      for (const li of OGX.dom.$$('#fleet1 #technologies li[data-technology]')) {
        const id = +li.dataset.technology;
        const inp = li.querySelector('input[type="text"], input:not([type])');
        if (!id || !inp) continue;
        const raw = String(inp.value || '').trim();
        if (!raw) continue;
        let n = Math.floor(OGX.util.parseGameNumber(raw));
        if (!fin(n) || n <= 0) continue;
        const am = li.querySelector('span.amount');
        const have = am ? parseInt(am.dataset.value, 10) : NaN;
        if (fin(have) && have >= 0) n = Math.min(n, have);
        if (n > 0) out[id] = n;
      }
      return out;
    }

    renderIfSelectionChanged() {
      const key = JSON.stringify(this.readSelection());
      if (key !== this.lastSelKey) this.renderSoon();
    }

    compute() {
      const sel = this.readSelection();
      this.lastSelKey = JSON.stringify(sel);
      const top = this.topPoints();
      const playerClass = OGX.calc.normClass(this.player && this.player.playerClass);
      const economySpeed = +this.server.economySpeed || 1;
      const rewardMultiplier = +this.ctx.settings.get('rewardMultiplier') || 1;
      const hasPathfinder = (sel[PF] || 0) > 0;
      const out = { sel, top, playerClass, economySpeed, rewardMultiplier, hasPathfinder };
      if (!top) return out;
      const find = lanedirtMaxFind({ topPoints: top.points, playerClass, economySpeed, hasPathfinder, rewardMultiplier });
      out.find = find;
      out.rows = [
        { key: 'normal', label: 'Обычная', hint: 'вероятность 89%, множитель ×1', res: find.normal },
        { key: 'rare', label: 'Редкая', hint: 'вероятность 10%, множитель ×2..3 (показан максимум ×3)', res: find.rare },
        { key: 'exceptional', label: 'Исключительная', hint: 'вероятность 1%, множитель ×5..10 (показан максимум ×10)', res: find.exceptional },
      ].map((r) => Object.assign(r, { ships: OGX.calc.expeditionMinShips(r.res.metal, this.stats, [TS]) }));
      out.cargo = OGX.calc.fleetCargo(sel, this.stats);
      out.selCount = OGX.util.shipsTotal(sel);
      out.need = find.normal.metal;
      out.covered = out.cargo >= out.need;
      const capTS = (this.stats[TS] && this.stats[TS].cargo) || 0;
      out.extraTS = !out.covered && capTS > 0 ? Math.ceil((out.need - out.cargo) / capTS) : 0;
      // the pathfinder doubles the find: what if the user adds one
      const pfOnBody = this.fp && this.fp.shipsOnPlanet ? +this.fp.shipsOnPlanet[PF] || 0 : 0;
      out.pfHint = !hasPathfinder && pfOnBody > 0;
      OGX.learn.check('expedition.find', { metal: find.normal.metal, crystal: find.normal.crystal, deuterium: find.normal.deuterium, cargo: out.cargo });
      return out;
    }

    // ---------------------------------------------------------------- UI: info boxes
    mountBoxes() {
      const f1 = OGX.dom.$('#fleet1');
      if (f1) {
        const box = h('div', { class: [P + 'box', P + 'box1'], id: P + 'box1' });
        const allornone = OGX.dom.$('#fleet1 #allornone');         // fleet/index.blade.php:940
        const warning = OGX.dom.$('#fleet1 #warning');             // no ships on the body
        if (allornone && allornone.parentNode) {
          const footer = [...allornone.parentNode.children].find((c) => c.classList && c.classList.contains('footer'));   // :978
          if (footer) allornone.parentNode.insertBefore(box, footer); else allornone.insertAdjacentElement('afterend', box);
        } else if (warning) warning.insertAdjacentElement('afterend', box);
        else f1.appendChild(box);
        this.boxes.push(box);
      }
      const f2 = OGX.dom.$('#fleet2');                              // :981
      if (f2) {
        const box = h('div', { class: [P + 'box', P + 'box2'], id: P + 'box2' });
        f2.appendChild(box);
        this.boxes.push(box);
      }
    }

    render() {
      if (!this.boxes.length) return;
      const c = this.compute();
      for (const box of this.boxes) {
        if (!box.isConnected) continue;
        const focused = box.contains(document.activeElement);
        if (focused) continue;    // never rebuild under the user's cursor (top points override input)
        box.textContent = '';
        box.appendChild(this.renderBox(c, box.classList.contains(P + 'box2')));
      }
    }

    renderBox(c, box2) {
      const fmt = OGX.fmt;
      const frag = document.createDocumentFragment();
      frag.appendChild(h('div', { class: P + 'title' }, 'Экспедиция: максимальная находка'));

      // --- parameters line
      const params = h('div', { class: P + 'params' });
      let topText;
      if (c.top) topText = fmt.num(c.top.points) + (c.top.manual ? ' (вручную)' : c.top.t ? ' (статистика, ' + fmt.ago(c.top.t) + ')' : ' (статистика)');
      else if (this.topLoading) topText = 'загрузка…';
      else topText = 'нет данных';
      const ovInput = h('input', {
        type: 'number', min: '0', step: '1', class: P + 'topinput', title: 'Очки игрока №1 вручную (пусто или 0 = из статистики)',
        placeholder: 'авто', value: (+this.ctx.settings.get('topPointsOverride') || '') + '',
        'aria-label': 'Очки игрока №1 вручную',
        onChange: (e) => this.setTopOverride(e.target.value),
        onKeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
        onKeyup: (e) => e.stopPropagation(),
      });
      params.appendChild(h('span', { class: P + 'param' }, 'Топ-1: ', h('b', { class: P + 'top' }, topText), ' ', ovInput));
      params.appendChild(h('span', { class: P + 'param' }, 'Класс: ', h('b', null, CLASS_RU[c.playerClass] || c.playerClass)));
      if (c.playerClass === 'explorer') params.appendChild(h('span', { class: P + 'param' }, 'Скорость экономики: ', h('b', null, 'x' + fmt.num(c.economySpeed))));
      params.appendChild(h('span', { class: [P + 'param', c.hasPathfinder ? 'ogx-ok' : null], title: 'Первопроходец во флоте удваивает находку' },
        OGX.catalog.shortName(PF) || 'Первопроходец', ': ', h('b', null, c.hasPathfinder ? 'да (×2)' : 'нет')));
      if (c.rewardMultiplier !== 1) params.appendChild(h('span', { class: P + 'param' }, 'Множитель сервера: ', h('b', null, '×' + String(c.rewardMultiplier).replace('.', ','))));
      if (this.btn && box2) {
        params.appendChild(h('span', { class: P + 'param', title: 'Запоминается при каждой отправке экспедиции' },
          'Кнопка «Экспедиция»: ', h('b', { class: P + 'btninfo' }, `${hoursText(this.ctx.settings.get('rememberedDuration'))}, ${pctText(this.ctx.settings.get('rememberedSpeed'))}`
            + (this.ctx.settings.get('autoSubmit') ? ', сразу отправить' : ''))));
      }
      const slots = this.fp && this.fp.expSlots;
      if (slots) {
        const full = slots.used >= slots.max;
        params.appendChild(h('span', { class: [P + 'param', P + 'slots', full ? 'ogx-bad' : 'ogx-ok'], title: full ? 'Все слоты экспедиций заняты' : 'Свободно слотов: ' + (slots.max - slots.used) },
          'Слоты экспедиций: ', h('b', null, `${slots.used}/${slots.max}`)));
      }
      frag.appendChild(params);

      if (!c.find) {
        frag.appendChild(h('div', { class: P + 'empty' }, this.topLoading ? 'Загружаю очки игрока №1 из статистики…'
          : 'Нет очков игрока №1: откройте статистику или введите значение вручную.'));
        return frag;
      }

      // --- find table
      const capOf = (id) => (this.stats[id] && this.stats[id].cargo) || 0;
      const thead = h('tr', null, h('th', null, 'Находка'), ...RES.map((k) => h('th', { class: 'ogx-' + k }, RES_RU[k])),
        h('th', { title: 'Минимум кораблей, чтобы увезти максимум металла (самый крупный тип находки)' }, 'Мин. ' + (OGX.catalog.shortName(TS) || 'Ул. трансп.')));
      const rows = c.rows.map((r) => h('tr', { class: P + 'row-' + r.key, title: r.hint },
        h('td', null, r.label),
        ...RES.map((k) => h('td', { class: [P + 'num', P + k] }, fmt.num(r.res[k]))),
        h('td', { class: [P + 'num', P + 'ships'] }, capOf(TS) ? fmt.num(r.ships[TS]) : '—')));
      frag.appendChild(h('table', { class: P + 'table' }, h('thead', null, thead), h('tbody', null, ...rows)));

      // --- selection coverage
      const cov = h('div', { class: [P + 'cover', c.selCount ? (c.covered ? 'ogx-ok' : 'ogx-warn') : null] });
      if (!c.selCount) {
        cov.appendChild(document.createTextNode(`Выберите корабли: для обычной максимальной находки нужно ${fmt.num(c.need)} грузоподъёмности `
          + `(${fmt.num(c.rows[0].ships[TS])} ${OGX.catalog.shortName(TS) || 'Ул. трансп.'}).`));
      } else if (c.covered) {
        cov.appendChild(document.createTextNode(`Грузоподъёмность выбранных кораблей ${fmt.num(c.cargo)} — хватает для обычной максимальной находки (${fmt.num(c.need)}).`));
      } else {
        cov.appendChild(document.createTextNode(`Грузоподъёмность выбранных кораблей ${fmt.num(c.cargo)} — не хватает ${fmt.num(c.need - c.cargo)}`
          + (c.extraTS ? ` (ещё ${fmt.num(c.extraTS)} ${OGX.catalog.shortName(TS) || 'Ул. трансп.'})` : '') + '.'));
      }
      frag.appendChild(cov);
      if (c.pfHint) frag.appendChild(h('div', { class: P + 'hint' }, `На планете есть ${OGX.catalog.name(PF) || 'Первопроходец'}: с ним во флоте находка удваивается.`));
      frag.appendChild(h('div', { class: P + 'note' }, 'Ресурс находки выбирается случайно (металл, кристалл или дейтерий); сервер ограничивает находку свободным местом во флоте.'));
      return frag;
    }

    async setTopOverride(v) {
      const n = Math.max(0, Math.floor(OGX.util.parseGameNumber(String(v || '0')) || 0));
      rec('U', 'topOverride', { value: n });
      await this.ctx.settings.set('topPointsOverride', n);
      // input still focused at change time on some browsers: re-render after blur
      setTimeout(() => this.renderSoon(), 0);
    }

    // ---------------------------------------------------------------- UI: button
    mountButton() {
      const coords = OGX.dom.$('#fleet2 #target .coords');           // fleet/index.blade.php:1056-1070
      if (!coords) {
        if (OGX.dom.$('#fleet2')) this.ctx.log.warn('#fleet2 #target .coords not found, expedition button not shown');
        return;
      }
      const n = this.ctx.settings.get('randomSystems');
      this.randInput = h('input', {
        type: 'number', min: '0', max: '99', step: '1', value: String(n), class: P + 'rand',
        title: 'Случайное смещение системы: ± столько систем от текущей', 'aria-label': 'Разброс систем',
        onChange: (e) => this.onRandChange(e.target),
        // keep the game's step-2 key handlers (Enter = send) away from our own input
        onKeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
        onKeyup: (e) => e.stopPropagation(),
      });
      this.btn = h('a', {
        href: '#', role: 'button', class: P + 'btn', dataset: { ogxAct: 'expedition:random' },
        onClick: (e) => { e.preventDefault(); this.onButton(); },
      }, 'Экспедиция');
      // #target is a fixed-height cell (130 px): one compact row; duration/speed are shown in the #fleet2 info box
      // and in the button title.
      const wrap = h('div', { class: P + 'wrap' }, this.btn, h('label', { class: P + 'randlbl', title: this.randInput.title }, '±', this.randInput));
      coords.appendChild(wrap);
      this.updateButton();
    }

    updateButton() {
      if (!this.btn) return;
      const dur = this.ctx.settings.get('rememberedDuration');
      const sp = this.ctx.settings.get('rememberedSpeed');
      const n = this.ctx.settings.get('randomSystems');
      const o = this.origin();
      this.btn.title = `Цель: [${o.galaxy}:${n ? (o.system + '±' + n) : o.system}:${POS}], миссия «${OGX.catalog.missionName(MISSION) || 'Экспедиция'}», `
        + `длительность ${hoursText(dur)}, скорость ${pctText(sp)}. `
        + (this.ctx.settings.get('autoSubmit') ? 'Флот будет отправлен сразу.' : 'Отправку подтверждаете кнопкой игры.');
      if (this.randInput && document.activeElement !== this.randInput && String(this.randInput.value) !== String(n)) this.randInput.value = String(n);
      this.renderSoon();
    }

    async onRandChange(input) {
      let n = Math.floor(+input.value);
      if (!fin(n) || n < 0) n = 0;
      if (n > 99) n = 99;
      input.value = String(n);
      await this.ctx.settings.set('randomSystems', n);
      this.updateButton();
    }

    /** Origin coordinates: inline var currentPlanet (fleet/index.blade.php:226-232), else the current body. */
    origin() {
      const cp = this.fp && this.fp.currentPlanet;
      if (cp && +cp.galaxy && +cp.system) return { galaxy: +cp.galaxy, system: +cp.system };
      const cur = OGX.state.current && OGX.state.current();
      const arr = cur && OGX.util.coordsArr(cur.coords);
      if (arr) return { galaxy: arr[0], system: arr[1] };
      const g = OGX.dom.$('#fleet2 #galaxy'), s = OGX.dom.$('#fleet2 #system');
      return { galaxy: +(g && g.value) || 1, system: +(s && s.value) || 1 };
    }

    maxExpeditionHours() {
      const opts = OGX.dom.$$('#fleet2 select#expeditiontime option').map((o) => +o.value).filter((v) => fin(v) && v > 0);
      return opts.length ? Math.max(...opts) : null;
    }

    async onButton() {
      if (this.busy) return;
      // the number in the input counts even when the user has not left it yet
      if (this.randInput) {
        const n = Math.max(0, Math.min(99, Math.floor(+this.randInput.value) || 0));
        if (n !== this.ctx.settings.get('randomSystems')) await this.ctx.settings.set('randomSystems', n);
      }
      this.busy = true;
      if (this.btn) this.btn.classList.add(P + 'busy');
      try {
        const r = await this.sendRandom();
        if (r && r.ok) {
          OGX.dom.toast(`Экспедиция: цель [${r.target.galaxy}:${r.target.system}:${POS}], ${hoursText(r.duration)}, ${pctText(r.speed)}`
            + (r.submitted ? ' — отправка…' : ' — проверьте и нажмите «Отправить»'), { type: 'ok' });
        } else if (r && r.message) {
          OGX.dom.toast(r.message, { type: 'error', ms: 6000 });
        }
      } catch (e) {
        this.ctx.log.error('random expedition failed', e);
        OGX.dom.toast('Экспедиция: ошибка — ' + (e && e.message ? e.message : e), { type: 'error', ms: 6000 });
      } finally {
        this.busy = false;
        if (this.btn) this.btn.classList.remove(P + 'busy');
      }
    }

    /** Wrapped by OGX.log.wrap (B expedition randomExpedition). Returns { ok, target, duration, speed, submitted } | { ok:false, message }. */
    async _sendRandom() {
      const bridge = OGX.bridge;
      const s = this.ctx.settings;
      const n = s.get('randomSystems');
      const o = this.origin();
      const maxSystem = (this.fp && this.fp.maxSystem) || +this.server.systems || 499;
      const off = randOffset(n);
      const target = { galaxy: o.galaxy, system: wrapSystem(o.system + off, maxSystem), position: POS, type: 1 };   // UI sends type=1 for expeditions (fleet.md §4.1)
      let duration = Math.max(1, Math.floor(s.get('rememberedDuration')) || 1);
      const maxH = this.maxExpeditionHours();
      if (maxH && duration > maxH) duration = maxH;
      const speed = Math.min(10, Math.max(0.5, Math.round((+s.get('rememberedSpeed') || 10) * 2) / 2));
      rec('B', 'random-target', { origin: o, offset: off, range: n, target, duration, speed, autoSubmit: !!s.get('autoSubmit') });

      const st = await bridge.call('fleet.state').catch((e) => ({ ok: false, error: e.message }));
      if (!st || !st.ok) {
        this.ctx.log.warn('fleetDispatcher unavailable', st && st.error);
        return { ok: false, message: 'Экспедиция: диспетчер флота игры недоступен (страница ещё загружается?)' };
      }
      if (Array.isArray(st.shipsToSend) && st.shipsToSend.length === 0 && st.currentPage === 'fleet1') {
        return { ok: false, message: 'Экспедиция: сначала выберите корабли' };
      }
      const call = async (m, ...a) => {
        const r = await bridge.call(m, ...a);
        if (!r || r.ok === false) throw new Error('bridge ' + m + ' failed');
        return r;
      };
      if (st.currentPage !== 'fleet2') await call('fleet.goStep', 2);
      await call('fleet.setTarget', target);
      await this.waitLoaded();
      // selectMission re-reads #expeditiontime (bundle :34300), so set the duration after it
      await call('fleet.selectMission', MISSION);
      await call('fleet.setDuration', duration);
      await call('fleet.setSpeed', speed);
      let submitted = false;
      if (s.get('autoSubmit')) {
        await call('fleet.submit');
        submitted = true;
      }
      return { ok: true, target, duration, speed, submitted };
    }

    /** Wait for the check-target triggered by updateTarget (debounced 500 ms) to finish: #fleet2 .ajax_loading hidden. */
    async waitLoaded() {
      await OGX.util.sleep(650);
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const busy = OGX.dom.$$('#fleet2 .ajax_loading').some((el) => el.style.display !== 'none' && el.offsetParent !== null);   // index.blade.php:1022
        if (!busy) return true;
        await OGX.util.sleep(150);
      }
      this.ctx.log.warn('check-target still loading after 5 s, continuing');
      return false;
    }

    // ---------------------------------------------------------------- remember duration and speed
    onSendFleet(x) {
      const f = (x && x.form) || {};
      if (+f.position !== POS || +f.mission !== MISSION) return;
      if (x.json && x.json.success === false) return;
      if (x.status && x.status >= 400) return;
      this.remember(+f.holdingtime, +f.speed);
    }

    async _remember(hours, speed) {
      const s = this.ctx.settings;
      const out = {};
      if (fin(hours) && hours >= 1) { await s.set('rememberedDuration', Math.floor(hours)); out.duration = Math.floor(hours); }
      if (fin(speed) && speed >= 0.5 && speed <= 10) { await s.set('rememberedSpeed', speed); out.speed = speed; }
      if (!('duration' in out) && !('speed' in out)) return { ok: false, reason: 'implausible', hours, speed };
      OGX.learn.value('expedition.remember.hours', hours, { min: 1, int: true });
      this.updateButton();
      return Object.assign({ ok: true }, out);
    }
  }


  // ------------------------------------------------------------------ GALAXYZ
  // Rules [UPSTREAM 2Moons 1.8 includes/classes/missions/MissionCaseExpedition.class.php, EndStayEvent], not confirmed by the fork:
  //   expedition points = sum((metal + crystal) x 5 / 1000) per ship  (= fleetStep2 "Fleet points": 150 for 1 colony ship [REAL])
  //   free cargo        = sum(pricelist capacity x n) - cargo on board   (BASE capacity: no Storage expert 607 bonus)
  //   event             = mt_rand(1, 9): 1 resources, 2 dark matter, 3 ships, 4 pirates/aliens, 5 fleet lost, 6 flight time, 7-9 nothing
  //   resources         = round(min(free cargo, min(maxFactor, max(200, factor)) x points)); factor <= 200 and maxFactor >= 2400, so
  //                       always min(free cargo, 200 x points) = min(free cargo, fleet metal + crystal cost), whatever the event size or
  //                       resource (metal 3/6, crystal 2/6, deuterium 1/6); the top-1 score does not matter here
  //   dark matter       = 100..300 (eventSize 11..100), 301..600 (1..10), 601..3000 (0)
  //   ships             = max(round(size x min(points, top1 < 5e6 ? 4500 : 6000)), 10000) of metal + crystal; size 10..50 / 52..100 /
  //                       102..200; only types already in the fleet, never 208, 209, 214
  //   staytime options  = 1..astrophysics (value i, label round(i / halt_speed, 2) h) [UPSTREAM class.FleetFunctions.php GetFleetMissions]
  const GZ_SHIP_SIZES = [['normal', 'обычная'], ['rare', 'редкая'], ['exceptional', 'исключительная']];   // core calc.expeditionShipFind
  const GZ_NO_SHIPFIND = [208, 209, 214];
  const GZ_CARGO_SHIPS = [(OGX.catalog && OGX.catalog.transportShip) || 217];   // suggestion when the cargo limits the find: Battle Transporters only
  const TOP_RETRY_MS = 6 * 3600 * 1000;
  
  const mcCost = (id) => { const o = OGX.catalog.get(+id); return o && o.price ? (o.price.metal || 0) + (o.price.crystal || 0) : 0; };
  const baseCargo = (id) => { try { return OGX.calc.baseCargo({ [id]: 1 }) || 0; } catch (e) { return 0; } };   // no officers (2Moons)

  class GzExpedition {
    constructor(ctx, step) {
      this.ctx = ctx;
      this.step = step;             // 0 fleetTable | 1 fleetStep1 | 2 fleetStep2
      this.offs = [];
      this.box = null;
      this.btn = null;
      this.randInput = null;
      this.slots = null;            // { used, max, src: 'page'|'stored', t }
      this.server = {};
      this.factors = null;
      this.bodyShips = null;        // ships on the current body (stored), for the cargo suggestions
      this.top = null;              // { points, manual?, t? }
      this.topState = 'idle';       // idle | loading | done | failed
      this.prefilled = null;        // step 2: { mission, hours } set by us
      this.renderSoon = OGX.util.debounce(() => OGX.safe(() => this.render(), 'expedition:render')(), 120);
      this.fillTarget = OGX.log.wrap(NAME, this._fillTarget.bind(this), 'randomExpedition');
      this.remember = OGX.log.wrap(NAME, this._remember.bind(this), 'remember');
    }

    async start() {
      const ctx = this.ctx;
      await this.loadState();
      this.stayLabel = await ctx.store.get('stayLabel', null);
      this.mountBox();
      if (this.step === 0 || this.step === 1) this.mountButton();
      if (this.step === 2) this.preselectStep2();
      this.render();
      const form = this.form();
      if (form) {
        for (const type of ['input', 'keyup', 'change', 'click']) this.offs.push(ctx.on(form, type, (e) => { if (!(e.target && e.target.closest && e.target.closest('[class*="ogx-"]'))) this.renderSoon(); }));
        this.offs.push(ctx.on(form, 'submit', () => this.onSubmit(form)));
      }
      this.offs.push(ctx.every(2000, () => this.renderIfChanged()));   // the game's max / all ships links set inputs without events
      this.offs.push(OGX.state.onChange(['research', 'server', 'slots', 'player', 'bodies'], () => { this.loadState().then(() => this.renderSoon()); }));
      this.offs.push(ctx.settings.onChange((key) => {
        if (key === 'randomSystems' && this.randInput && document.activeElement !== this.randInput) this.randInput.value = String(ctx.settings.get('randomSystems'));
        if (key === 'topPointsOverride') this.ensureTop();
        this.updateButton();
      }));
      this.ensureTop();
    }

    dispose() {
      for (const off of this.offs.splice(0)) { try { off && off(); } catch (e) { /* ignore */ } }
      if (this.renderSoon.cancel) this.renderSoon.cancel();
    }

    /** The form of this page: fleetTable ship form (-> fleetStep1), fleetStep1 form#form (-> fleetStep2), fleetStep2 (-> fleetStep3). */
    form() {
      if (this.step === 1) return OGX.dom.$('form[action*="page=fleetStep2"]');
      if (this.step === 2) return OGX.dom.$('form[action*="page=fleetStep3"]');
      return gzShipForm();
    }
    st() { try { return OGX.fleet.gz.state(); } catch (e) { this.ctx.log.warn('fleet.gz.state failed', e); return { ok: false }; } }

    async loadState() {
      const [slots, server, factors] = await Promise.all([OGX.state.slots(), OGX.state.server(), OGX.state.factors ? OGX.state.factors() : null]);
      this.server = server || {};
      this.factors = factors || null;
      const st = this.step === 0 ? this.st() : null;
      // fleetTable: its own header "0 / 2 expedition" (fleet.gz.state); other steps: what fleetTable stored (no header there)
      if (st && st.expeditions && fin(+st.expeditions.max)) this.slots = { used: +st.expeditions.used, max: +st.expeditions.max, src: 'page' };
      else if (slots && slots.expedition && fin(+slots.expedition.max)) this.slots = { used: +slots.expedition.used, max: +slots.expedition.max, src: 'stored', t: slots.expeditionT || slots.t };
      else this.slots = null;
      try {
        const cur = OGX.state.current && OGX.state.current();
        const body = cur && cur.key ? await OGX.state.body(cur.key) : null;
        this.bodyShips = body && body.ships ? body.ships : null;
      } catch (e) { this.bodyShips = null; }
    }

    // ---------------------------------------------------------------- top-1 (ship finds only)
    /** Stored top-1 only (manual override, or a page=statistics the user opened / fetched): no request on page load. */
    async ensureTop() {
      const ov = +this.ctx.settings.get('topPointsOverride') || 0;
      if (ov > 0) { this.top = { points: ov, manual: true }; this.topState = 'done'; this.renderSoon(); return; }
      let cur = null;
      try { cur = await OGX.storage.get('topScore', null, { scope: 'server' }); } catch (e) { cur = null; }
      this.top = cur && fin(cur.points) ? cur : null;
      if (this.topState !== 'failed') this.topState = this.top ? 'done' : 'idle';
      this.renderSoon();
    }

    /** User click «узнать»: one GET of page=statistics (free, no deuterium) through state.ensureTopScore. */
    async fetchTop() {
      if (this.topState === 'loading') return;
      this.topState = 'loading';
      this.renderSoon();
      try {
        const r = await OGX.state.ensureTopScore({ maxAgeMs: TOP_RETRY_MS });
        this.top = r && fin(r.points) ? r : null;
        this.topState = this.top ? 'done' : 'failed';
        if (this.top) OGX.learn.value('expedition.topPoints', this.top.points, { min: 0 });
      } catch (e) {
        this.ctx.log.warn('ensureTopScore failed', e);
        this.topState = 'failed';
      }
      this.renderSoon();
    }

    // ---------------------------------------------------------------- data
    /** { ships|null, count, points, cost, cargoBase, loaded, free, approx, src } of the fleet on this page. */
    fleet() {
      const st = this.st();
      let ships = null, points = null, approx = false, src;
      if (this.step === 0) {
        ships = {};
        const av = st.available || {};
        for (const [id, n] of Object.entries(st.ships || {})) { const c = Math.min(+n || 0, av[id] !== undefined ? +av[id] : Infinity); if (c > 0) ships[id] = c; }
        src = 'fleetTable';
      } else if (this.step === 1) {
        ships = Object.assign({}, st.ships || {});
        src = 'fleetStep1';
      } else {
        // core: step 2 «Fleet points» (span#fleetPoints) and the ships step 1 showed under the same token
        if (st.shipsSrc && Object.keys(st.ships || {}).length) ships = Object.assign({}, st.ships);
        if (fin(st.fleetPoints)) points = st.fleetPoints;          // the page's own number wins
        src = 'fleetStep2';
      }
      if (ships && points === null) points = OGX.calc.expeditionPoints(ships);
      if (ships && fin(points)) OGX.learn.check('expedition.points', { points, calc: OGX.calc.expeditionPoints(ships) });
      const cost = fin(points) ? Math.round(points * 200) : null;      // 200 x (M+C) x 5 / 1000 = M+C
      let cargoBase = null;
      if (ships) cargoBase = OGX.calc.baseCargo(ships);
      else if (st.capacity !== null && st.capacity !== undefined && fin(+st.capacity)) {
        // fleetroom includes Storage expert 607: back to the base capacity the expedition uses
        const f = this.factors && fin(+this.factors.ShipStorage) ? +this.factors.ShipStorage : 0;
        cargoBase = Math.floor(+st.capacity / (1 + f));
        approx = true;
      }
      const c = st.cargo || {};
      const loaded = (+c.metal || 0) + (+c.crystal || 0) + (+c.deuterium || 0);
      const free = cargoBase === null ? null : Math.max(0, cargoBase - loaded);
      const count = ships ? OGX.util.shipsTotal(ships) : null;
      return { ships, count, points, cost, cargoBase, loaded, free, approx, src, capacityGame: fin(+st.capacity) ? +st.capacity : null, st };
    }

    compute() {
      const f = this.fleet();
      const out = f;
      if (!fin(f.cost) || f.cost <= 0) { out.empty = true; return out; }
      out.find = f.free === null ? f.cost : Math.round(Math.min(f.free, f.cost));
      out.limitedByCargo = f.free !== null && f.free < f.cost;
      // how many more cargo ships of a type lift the cargo limit: every ship adds its cargo AND its own metal + crystal cost
      out.extra = [];
      if (out.limitedByCargo) {
        const deficit = f.cost - f.free;
        const have = this.availableShips();
        const all = GZ_CARGO_SHIPS.filter((id) => baseCargo(id) - mcCost(id) > 0)
          .map((id) => ({ id, n: Math.ceil(deficit / (baseCargo(id) - mcCost(id))), have: have ? +have[id] || 0 : null }));
        const onBody = all.filter((x) => x.have > 0);
        out.extra = onBody.length ? onBody : all;      // none on the planet: name them all, each with «есть 0»
      }
      // ship finds: cap of the points by the top-1 score
      const top = this.top && fin(this.top.points) ? this.top.points : null;
      // top-1 unknown: both columns (below / above 5 M)
      const finds = (top !== null ? [top] : [0, 5e6]).map((tp) => OGX.calc.expeditionShipFind({ points: f.points, topPoints: tp }));
      const caps = finds.map((x) => x.cap);
      const eligible = !f.ships || Object.keys(f.ships).some((id) => !GZ_NO_SHIPFIND.includes(+id) && f.ships[id] > 0);
      out.shipFind = { caps, eligible, rows: GZ_SHIP_SIZES.map(([key, label]) => ({ key, label, values: finds.map((x) => x[key]) })) };
      out.pointsCapped = top !== null && finds[0].capped;
      return out;
    }

    /** Ships on the planet: fleetTable lists them, else the stored body (fleetTable / imperium). null = unknown. */
    availableShips() {
      if (this.step === 0) { const st = this.st(); return st.available || null; }
      return this.bodyShips && Object.keys(this.bodyShips).length ? this.bodyShips : null;
    }

    renderIfChanged() {
      const st = this.st();
      const key = JSON.stringify([st.ships, st.cargo, st.target, st.speed, st.staytime]);
      if (key !== this.lastKey) { this.lastKey = key; this.renderSoon(); }
    }

    // ---------------------------------------------------------------- UI: box
    mountBox() {
      const form = this.form();
      if (!form) { this.ctx.log.debug('GALAXYZ: no fleet form for the expedition box'); return; }
      this.box = h('div', { class: [P + 'box', P + 'gz'], id: P + 'box-gz' });
      // right below the game's «Continue»: fleetTable = after the ship table (the bonus table follows), steps 1 and 2 = after the form
      const first = this.step === 0 ? form.querySelector('table') : null;
      if (first) first.insertAdjacentElement('afterend', this.box);
      else form.insertAdjacentElement('afterend', this.box);
      // same width and left edge as the game's table above
      const ref = first || form.querySelector('table');
      const w = ref ? Math.round(ref.getBoundingClientRect().width) : 0;
      if (w > 100) {
        this.box.style.width = w + 'px';
        const dx = Math.round(ref.getBoundingClientRect().left - this.box.getBoundingClientRect().left);
        if (dx) this.box.style.marginLeft = (parseFloat(getComputedStyle(this.box).marginLeft) || 0) + dx + 'px';
      }
    }

    render() {
      if (!this.box || !this.box.isConnected) return;
      const c = this.compute();
      const fmt = OGX.fmt;
      const n = (v) => (fin(v) ? fmt.num(Math.round(v)) : '—');
      const frag = document.createDocumentFragment();
      const head = h('div', { class: P + 'title' }, 'Экспедиция: возможная находка');
      if (this.slots) {
        const full = this.slots.used >= this.slots.max;
        head.appendChild(h('span', { class: [P + 'slots', full ? 'ogx-bad' : 'ogx-ok'],
          title: (this.slots.src === 'page' ? 'Из заголовка этой страницы' : 'Со страницы флота' + (this.slots.t ? ', ' + fmt.ago(this.slots.t) : '') + '; отправленные с тех пор не учтены')
            + (full ? '. Все слоты экспедиций заняты: сервер откажет в отправке' : '. Свободно: ' + (this.slots.max - this.slots.used)) },
        'Слоты экспедиций: ', h('b', null, `${this.slots.used}/${this.slots.max}`)));
      }
      frag.appendChild(head);

      const params = h('div', { class: P + 'params' });
      if (!c.empty) this.fleetParams(params, c);
      if (this.btn) {
        params.appendChild(h('span', { class: P + 'param', title: 'Скорость и время удержания запоминаются при каждой отправке экспедиции' },
          'Кнопка «Экспедиция»: ', h('b', { class: P + 'btninfo' }, this.buttonInfo())));
      }
      frag.appendChild(params);
      this.renderFinds(frag, c);
      const times = this.timesLine();
      if (times) frag.appendChild(times);
      if (this.step === 2) {
        const m = this.step2Line();
        if (m) frag.appendChild(m);
      }
      frag.appendChild(h('div', { class: P + 'note' }, 'Исходы — по 1/9: ресурсы, ТМ, корабли, бой с пиратами или чужими, потеря флота, изменение времени возврата; 3/9 — ничего. '
        + 'Правила из исходного кода 2Moons 1.8, сервером GALAXYZ не подтверждены.'));
      this.box.textContent = '';
      this.box.appendChild(frag);
    }

    fleetParams(params, c) {
      const fmt = OGX.fmt;
      const n = (v) => (fin(v) ? fmt.num(Math.round(v)) : '—');
      if (c.count !== null) params.appendChild(h('span', { class: P + 'param' }, 'Кораблей: ', h('b', { class: P + 'count' }, n(c.count))));
      params.appendChild(h('span', { class: P + 'param', title: 'Сумма металла и кристалла в цене кораблей флота = 200 × очки экспедиции' + (this.step === 2 ? ' («Fleet points» этой страницы)' : '') },
        'Стоимость флота (М+К): ', h('b', { class: P + 'cost' }, n(c.cost)), ' (очки экспедиции ', h('b', { class: P + 'points' }, fin(c.points) ? fmt.num(Math.round(c.points * 100) / 100) : '—'), ')'));
      params.appendChild(h('span', { class: P + 'param', title: 'Базовая грузоподъёмность флота без бонуса офицера минус груз на борту: так считает сервер 2Moons'
          + (c.approx ? '. Корабли неизвестны (шаг 1 не открыт в этой вкладке): трюм игры «fleetroom» без бонуса офицера' : '')
          + (c.capacityGame !== null && c.capacityGame !== c.cargoBase ? '. Трюм в игре: ' + n(c.capacityGame) : '') },
        'Свободный трюм для находки: ', h('b', { class: P + 'free' }, n(c.free)), c.loaded > 0 ? ` (груз ${n(c.loaded)})` : ''));
    }

    renderFinds(frag, c) {
      const fmt = OGX.fmt;
      const n = (v) => (fin(v) ? fmt.num(Math.round(v)) : '—');
      if (c.empty) {
        frag.appendChild(h('div', { class: P + 'cover' }, 'Выберите корабли: находка ресурсов = меньшее из свободного трюма и стоимости флота (металл + кристалл).'));
      } else {
        // resources
        const res = h('div', { class: [P + 'cover', P + 'res', c.limitedByCargo ? 'ogx-warn' : 'ogx-ok'] });
        res.appendChild(document.createTextNode('Ресурсы: до '));
        res.appendChild(h('b', { class: P + 'find' }, n(c.find)));
        res.appendChild(document.createTextNode(' металла, кристалла или дейтерия (одна сумма для любого размера находки). '));
        if (c.limitedByCargo) {
          const parts = c.extra.map((x) => `${fmt.num(x.n)} × ${OGX.catalog.name(x.id)}` + (x.have !== null && x.have < x.n ? ` (есть ${fmt.num(x.have)})` : ''));
          res.title = 'Каждый добавленный корабль увеличивает и трюм, и стоимость флота. Грузоподъёмность кораблей 213–220 взята из 2Moons: на сервере GALAXYZ не проверена.';
          res.appendChild(document.createTextNode(`Ограничивает трюм: до стоимости флота не хватает ${n(c.cost - c.free)}`
            + (parts.length ? ` — добавьте ${parts.join(' или ')}.` : '.')));
        } else {
          res.appendChild(document.createTextNode('Ограничивает стоимость флота: трюма хватает; дороже флот — больше находка.'));
        }
        frag.appendChild(res);
        // ships
        const sf = c.shipFind;
        const ships = h('div', { class: [P + 'line', P + 'shipfind'] });
        if (!sf.eligible) ships.appendChild(document.createTextNode('Корабли: не найдутся — находят только типы из флота, кроме колонизатора, переработчика и звезды смерти.'));
        else {
          ships.appendChild(document.createTextNode('Корабли (по стоимости М+К): '));
          sf.rows.forEach((r, i) => {
            if (i) ships.appendChild(document.createTextNode(' / '));
            ships.appendChild(h('b', { class: P + 'ship-' + r.key, title: r.label }, r.values.length > 1 && r.values[0] !== r.values[1] ? `${fmt.num(r.values[0])}–${fmt.num(r.values[1])}` : fmt.num(r.values[0])));
          });
          ships.appendChild(document.createTextNode(' (обычная / редкая / исключительная)'));
          const known = this.top && fin(this.top.points);
          const topTxt = known
            ? `; очки флота сверх ${fmt.num(sf.caps[0])} не учитываются (топ-1: ${fmt.num(this.top.points)}${this.top.manual ? ', вручную' : this.top.t ? ', ' + fmt.ago(this.top.t) : ''})`
            : this.topState === 'loading' ? '; загружаю очки топ-1…'
              : '; очки топ-1 неизвестны' + (this.topState === 'failed' ? ' (статистика не прочитана)' : '') + ': предел 4 500 очков флота (топ-1 < 5 млн) или 6 000';
          ships.appendChild(h('span', { class: P + 'topinfo' }, topTxt + '.'));
          if (!known && this.topState !== 'loading') {
            ships.appendChild(document.createTextNode(' '));
            ships.appendChild(h('a', { href: '#', role: 'button', class: P + 'toplink', dataset: { ogxAct: 'expedition:top' },
              title: 'Один запрос страницы статистики (дейтерий не тратится). Или впишите очки вручную в настройках модуля',
              onClick: (e) => { e.preventDefault(); this.fetchTop(); } }, 'узнать'));
          }
        }
        frag.appendChild(ships);
        frag.appendChild(h('div', { class: P + 'line' }, 'Тёмная материя: 100–300, редко 301–600, исключительно 601–3 000.'));
      }
    }

    /** Step 1, target at position 16: flight both ways and the remembered stay. */
    timesLine() {
      if (this.step !== 1) return null;
      const st = this.st();
      if (!st.target || +st.target.position !== POS || !fin(st.duration)) return null;
      const fmt = OGX.fmt;
      const hrs = this.stayHours();
      const total = 2 * st.duration + (fin(hrs) ? hrs * 3600 : 0);
      return h('div', { class: [P + 'line', P + 'times'] }, `Время: полёт ${fmt.duration(st.duration)} × 2 + удержание ${fin(hrs) ? hoursText(hrs) : '—'} = `, h('b', null, fmt.duration(total)),
        fin(st.consumption) ? `, дейтерий ${fmt.num(st.consumption)}` : '');
    }

    step2Line() {
      const st = this.st();
      const offered = (st.missions || []).some((m) => m.id === MISSION);
      if (!offered) return null;
      if (this.prefilled) {
        return h('div', { class: [P + 'line', P + 'prefilled'] }, `Дополнение выбрало миссию «${OGX.catalog.missionName(MISSION)}»`
          + (fin(this.prefilled.hours) ? ` и удержание ${hoursText(this.prefilled.hours)}` : '') + '. Проверьте и нажмите «Continue».');
      }
      if (st.mission !== MISSION) return h('div', { class: [P + 'line', 'ogx-warn'] }, `Выберите миссию «${OGX.catalog.missionName(MISSION)}»: без миссии сервер выберет «Транспорт» и откажет.`);
      return null;
    }

    // ---------------------------------------------------------------- remembered speed / stay time
    speed10() { return Math.min(10, Math.max(1, Math.round(+this.ctx.settings.get('rememberedSpeed') || 10))); }
    /** The remembered stay option value (1..astrophysics); hours = its label when step 2 told us (halt_speed may differ from 1). */
    stayValue() { return Math.max(1, Math.floor(+this.ctx.settings.get('rememberedDuration') || 1)); }
    stayHours() { const v = this.stayValue(); const l = this.stayLabel; return l && l.value === v && fin(l.hours) ? l.hours : v; }
    buttonInfo() {
      const n = this.ctx.settings.get('randomSystems');
      const o = this.origin();
      return `[${o.galaxy}:${n ? o.system + '±' + n : o.system}:${POS}], ${pctText(this.speed10())}, ${hoursText(this.stayHours())}`;
    }

    // ---------------------------------------------------------------- button (fleetTable hidden target, fleetStep1 destination)
    mountButton() {
      const form = this.form();
      const th = form && form.querySelector('table th');
      if (!th) { this.ctx.log.debug('GALAXYZ: no header cell for the expedition button'); return; }
      this.randInput = h('input', {
        type: 'number', min: '0', max: '99', step: '1', value: String(this.ctx.settings.get('randomSystems')), class: P + 'rand',
        title: 'Случайное смещение системы: ± столько систем от текущей', 'aria-label': 'Разброс систем',
        onChange: (e) => this.onRandChange(e.target),
        onKeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
        onKeyup: (e) => e.stopPropagation(),
      });
      this.btn = h('a', { href: '#', role: 'button', class: P + 'btn', dataset: { ogxAct: 'expedition:random' }, onClick: (e) => { e.preventDefault(); this.onButton(); } }, 'Экспедиция');
      // a zero-height anchor in the header cell: the button sits at its right edge without changing the row height or centring
      const anchor = h('div', { class: P + 'hanchor' }, h('div', { class: [P + 'wrap', P + 'wrap-gz'] }, this.btn, h('label', { class: P + 'randlbl', title: this.randInput.title }, '±', this.randInput)));
      th.insertBefore(anchor, th.firstChild);
      this.updateButton();
    }

    origin() {
      const st = this.st();
      const d = st.data && st.data.planet;
      if (d && +d.galaxy && +d.system) return { galaxy: +d.galaxy, system: +d.system };
      const cur = OGX.state.current && OGX.state.current();
      const arr = cur && OGX.util.coordsArr(cur.coords);
      if (arr) return { galaxy: arr[0], system: arr[1] };
      if (this.step === 0 && st.target && st.target.galaxy) return { galaxy: st.target.galaxy, system: st.target.system };
      return { galaxy: 1, system: 1 };
    }

    updateButton() {
      if (!this.btn) return;
      const what = this.step === 0
        ? `Заполнить цель флота ${this.buttonInfo().split(',')[0]} и миссию «${OGX.catalog.missionName(MISSION)}». Выберите корабли и нажмите «Continue»: дополнение ничего не отправляет.`
        : `Заполнить цель ${this.buttonInfo().split(',')[0]} и скорость ${pctText(this.speed10())}. Отправку подтверждаете кнопкой игры «Continue».`;
      this.btn.title = what;
      this.renderSoon();
    }

    async onRandChange(input) {
      let n = Math.floor(+input.value);
      if (!fin(n) || n < 0) n = 0;
      if (n > 99) n = 99;
      input.value = String(n);
      if (n !== this.ctx.settings.get('randomSystems')) await this.ctx.settings.set('randomSystems', n);
    }

    async onButton() {
      if (this.randInput) await this.onRandChange(this.randInput);
      const r = await this.fillTarget();
      if (r && r.ok) {
        OGX.dom.toast(`Экспедиция: цель [${r.target.galaxy}:${r.target.system}:${POS}]` + (r.speed ? `, ${pctText(r.speed)}` : '')
          + (this.step === 0 ? ' — выберите корабли и нажмите «Continue»' : ' — проверьте и нажмите «Continue»'), { type: 'ok' });
      } else if (r && r.message) OGX.dom.toast(r.message, { type: 'error', ms: 6000 });
      this.renderSoon();
    }

    /** Wrapped (B expedition randomExpedition): fills the form through OGX.fleet.gz, never submits it. */
    _fillTarget() {
      const G = OGX.fleet.gz;
      const n = this.ctx.settings.get('randomSystems');
      const o = this.origin();
      const off = randOffset(n);
      const target = { galaxy: o.galaxy, system: wrapSystem(o.system + off, +this.server.systems || 499), position: POS, type: 1 };
      const t = G.setTarget(target);
      if (!t || !t.ok) return { ok: false, message: 'Экспедиция: форма цели не найдена' + (t && t.error ? ' (' + t.error + ')' : '') };
      let speed = null;
      if (this.step === 0) {
        const m = G.selectMission(MISSION);
        if (!m || !m.ok) return { ok: false, message: 'Экспедиция: не удалось выбрать миссию' };
      } else {
        const sp = G.setSpeed(this.speed10());
        speed = sp && sp.ok ? sp.speed : null;
      }
      rec('B', 'random-target', { step: this.step, origin: o, offset: off, range: n, target, speed });
      return { ok: true, target, speed, submitted: false };
    }

    // ---------------------------------------------------------------- step 2: mission + stay time prefill
    preselectStep2() {
      const st = this.st();
      const offered = (st.missions || []).some((m) => m.id === MISSION);   // 2Moons offers only mission 15 for position 16
      if (!offered || st.mission) return;
      const m = OGX.fleet.gz.selectMission(MISSION);
      if (!m || !m.ok) return;
      let hours = null;
      const opts = st.stayOptions || [];
      if (opts.length) {
        const want = this.stayValue();
        const o = opts.find((x) => x.value === want) || opts.filter((x) => x.value <= want).pop() || opts[0];
        const sel = this.form() && this.form().querySelector('select[name="staytime"]');
        if (sel && o) { sel.value = String(o.value); sel.dispatchEvent(new Event('change', { bubbles: true })); hours = fin(o.hours) ? o.hours : o.value; }
      }
      this.prefilled = { mission: MISSION, hours };
      rec('B', 'step2-prefill', { mission: MISSION, staytime: hours });
    }

    onSubmit(form) {
      if (this.step === 1) {
        const p = form.querySelector('input#planet'), sp = form.querySelector('select#speed');
        if (p && +p.value === POS && sp) this.remember(null, +sp.value);
      } else if (this.step === 2) {
        const r = form.querySelector('input[name="mission"]:checked'), stay = form.querySelector('select[name="staytime"]');
        if (r && +r.value === MISSION && stay) {
          const opt = stay.options[stay.selectedIndex];
          this.remember(+stay.value, null, opt ? parseFloat(opt.textContent) : null);
        }
      }
    }

    async _remember(value, speed, hours) {
      const s = this.ctx.settings;
      const out = {};
      if (fin(value) && value >= 1) {
        await s.set('rememberedDuration', Math.floor(value)); out.duration = Math.floor(value);
        if (fin(hours)) { this.stayLabel = { value: Math.floor(value), hours }; await this.ctx.store.set('stayLabel', this.stayLabel); }
      }
      if (fin(speed) && speed >= 1 && speed <= 10) { await s.set('rememberedSpeed', Math.round(speed)); out.speed = Math.round(speed); }
      return Object.assign({ ok: Object.keys(out).length > 0 }, out);
    }
  }

  const CSS = `
.${P}box { margin: 6px 8px; padding: 6px 8px; border: 1px solid #2c3a48; border-radius: 3px; background: rgba(13,16,20,.85); color: #c8d0d8; font-size: 11px; line-height: 1.45; clear: both; }
.${P}box2 { margin: 8px 10px; }
.${P}title { font-weight: bold; color: #9fc4e8; margin-bottom: 3px; }
.${P}params { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-bottom: 4px; align-items: center; }
.${P}param b { color: #fff; font-weight: normal; }
.${P}param.ogx-ok b { color: #6dcb6d; }
.${P}param.ogx-bad b { color: #e06060; }
.${P}topinput { width: 86px; height: 16px; padding: 0 3px; font-size: 11px; background: #0d1014; color: #c8d0d8; border: 1px solid #2c3a48; }
.${P}table { width: 100%; border-collapse: collapse; margin: 2px 0 4px; }
.${P}table th, .${P}table td { padding: 1px 4px; border-bottom: 1px solid #1f2933; text-align: left; white-space: nowrap; }
.${P}table th { color: #8a96a3; font-weight: normal; }
.${P}num { text-align: right !important; }
.${P}table th.ogx-metal { color: #a9b7c9; } .${P}table th.ogx-crystal { color: #7fb8e8; } .${P}table th.ogx-deuterium { color: #7fd8c0; }
.${P}row-rare td:first-child { color: #d8c070; }
.${P}row-exceptional td:first-child { color: #e09050; }
.${P}cover.ogx-ok { color: #6dcb6d; }
.${P}cover.ogx-warn { color: #e0a040; }
.${P}hint { color: #d8c070; }
.${P}note { color: #6f7b88; font-size: 10px; margin-top: 2px; }
.${P}wrap { margin-top: 3px; display: flex; flex-wrap: nowrap; justify-content: center; align-items: center; gap: 4px; height: 18px; }
/* game rule "#fleet2 #target a:not(.dropdown a)" (ingame css) gives every link a 44x36 sprite, float and block: undo it for ours */
a.${P}btn { float: none !important; display: inline-block !important; width: auto !important; height: 16px !important; padding: 0 8px; line-height: 16px; font-size: 11px; text-decoration: none; cursor: pointer;
  background: #2a4a6a none !important; color: #fff !important; border: 1px solid #4f7fae; border-radius: 3px; font-weight: bold; }
a.${P}btn:hover { background: #35608a none !important; }
a.${P}btn.${P}busy { opacity: .6; pointer-events: none; }
.${P}wrap-gz { justify-content: flex-end; }
.${P}gz .${P}title { display: flex; justify-content: space-between; gap: 8px; }
.${P}gz .${P}slots { font-weight: normal; color: #c8d0d8; }
.${P}gz .${P}slots.ogx-ok b { color: #6dcb6d; } .${P}gz .${P}slots.ogx-bad b { color: #e06060; }
.${P}gz { text-align: left; box-sizing: border-box; margin: 6px auto; max-width: 100%; }
.${P}gz .${P}cover b, .${P}gz .${P}line b { color: #fff; font-weight: bold; }
.${P}gz .${P}line { margin: 1px 0; }
.${P}gz .${P}topinfo { color: #8a96a3; }
.${P}gz a.${P}toplink { color: #9fc4e8; text-decoration: underline; cursor: pointer; }
.${P}gz .${P}prefilled { color: #6dcb6d; }
.${P}gz .ogx-warn { color: #e0a040; }
.${P}hanchor { position: relative; height: 0; text-align: left; font-weight: normal; }
.${P}hanchor > .${P}wrap { position: absolute; right: 2px; top: -1px; margin: 0; }
.${P}hanchor a.${P}btn { float: none; }
.${P}randlbl { color: #c8d0d8; font-size: 11px; }
.${P}rand { width: 34px; height: 16px; padding: 0 3px; font-size: 11px; background: #0d1014; color: #c8d0d8; border: 1px solid #2c3a48; }
`;
})(window.OGX);
