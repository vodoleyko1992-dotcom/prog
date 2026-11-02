/* shared/core/07-dom.js — DOM helpers and UI widgets (menu entry, side panel, modal, toast, table, tooltip, settings form). Owner: core.
 * Rule: data is never parsed as HTML. h() creates text nodes for strings. */
(function (OGX) {
  'use strict';
  const dom = (OGX.dom = OGX.dom || {});
  const SVGNS = 'http://www.w3.org/2000/svg';

  // Every query is reported to the self-learning hit-rate counters (OGX.learn.sel; only the live document counts).
  const learnSel = (sel, found, root) => { try { if (OGX.learn && OGX.learn.sel) OGX.learn.sel(sel, found, root); } catch (e) { /* never break a query */ } };
  dom.$ = (sel, root = document) => {
    const el = root && root.querySelector ? root.querySelector(sel) : null;
    learnSel(sel, el, root);
    return el;
  };
  dom.$$ = (sel, root = document) => {
    const list = root && root.querySelectorAll ? Array.from(root.querySelectorAll(sel)) : [];
    learnSel(sel, list.length > 0, root);
    return list;
  };

  function append(el, child) {
    if (child === null || child === undefined || child === false || child === true) return;
    if (Array.isArray(child)) { for (const c of child) append(el, c); return; }
    if (child instanceof Node) { el.appendChild(child); return; }
    el.appendChild(document.createTextNode(String(child)));
  }
  dom._append = append;

  /** h('div', {class:['a','b'], style:{color:'red'}, dataset:{x:1}, onClick: fn, title:'t'}, 'text', node, [more]) */
  dom.h = function (tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs && (attrs instanceof Node || Array.isArray(attrs) || typeof attrs !== 'object')) { children.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class' || k === 'className') {
        const list = Array.isArray(v) ? v.filter(Boolean) : String(v).split(/\s+/).filter(Boolean);
        if (list.length) el.className = list.join(' ');
      } else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const [sk, sv] of Object.entries(v)) {
          if (sv === undefined || sv === null) continue;
          if (sk.startsWith('--') || sk.includes('-')) el.style.setProperty(sk, String(sv));
          else el.style[sk] = typeof sv === 'number' && !/^(opacity|zIndex|flex|fontWeight|lineHeight|order)$/.test(sk) ? sv + 'px' : sv;
        }
      } else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v)) if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv);
      } else if (/^on[A-Z]/.test(k) && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), OGX.safe(v, 'dom:' + tag + ':' + k));
      } else if (k === 'text') {
        el.textContent = String(v);
      } else if (k === 'value' && 'value' in el) {
        el.value = v;
      } else if ((k === 'checked' || k === 'disabled' || k === 'selected') && k in el) {
        el[k] = !!v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (tag === 'button' && !el.hasAttribute('type')) el.type = 'button';
    append(el, children);
    return el;
  };
  const h = dom.h;

  /** Wait for a selector (or predicate returning an element) to appear. Resolves null on timeout. */
  dom.waitFor = function (selectorOrFn, { root = document, timeout = 10000 } = {}) {
    const probe = () => {
      try { return typeof selectorOrFn === 'function' ? selectorOrFn() || null : root.querySelector(selectorOrFn); } catch (e) { return null; }
    };
    const report = (el) => { if (typeof selectorOrFn === 'string') learnSel(selectorOrFn, el, root); return el; };
    const now = probe();
    if (now) return Promise.resolve(report(now));
    return new Promise((resolve) => {
      let done = false;
      const target = root.nodeType === 9 ? root.documentElement || root : root;
      const mo = new MutationObserver(() => {
        if (done) return;
        const el = probe();
        if (el) { done = true; mo.disconnect(); clearTimeout(timer); resolve(report(el)); }
      });
      mo.observe(target, { childList: true, subtree: true, attributes: true });
      const timer = setTimeout(() => { if (!done) { done = true; mo.disconnect(); resolve(report(probe())); } }, timeout);
    });
  };

  /** Debounced MutationObserver. cb(mutations) gets all mutations collected during the debounce window. */
  dom.observe = function (target, cb, { debounce = 100, childList = true, subtree = true, attributes = false, characterData = false } = {}) {
    if (!target) return () => {};
    const safeCb = OGX.safe(cb, 'dom:observe');
    let batch = [];
    let timer = null;
    const mo = new MutationObserver((muts) => {
      batch.push(...muts);
      if (debounce <= 0) { const b = batch; batch = []; safeCb(b); return; }
      if (timer) return;
      timer = setTimeout(() => { timer = null; const b = batch; batch = []; safeCb(b); }, debounce);
    });
    mo.observe(target, { childList, subtree, attributes, characterData });
    return () => { mo.disconnect(); if (timer) clearTimeout(timer); timer = null; batch = []; };
  };

  dom.injectStyle = function (id, cssText) {
    let el = document.getElementById(id);
    if (!el || el.tagName !== 'STYLE') {
      el = document.createElement('style');
      el.id = id;
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== cssText) el.textContent = cssText || '';
    return el;
  };

  // ------------------------------------------------------------------ root container for floating widgets
  function root() {
    let r = document.getElementById('ogx-root');
    if (!r) {
      r = h('div', { id: 'ogx-root', class: 'ogx-root ogx-float-root' });
      (document.body || document.documentElement).appendChild(r);
    }
    return r;
  }
  dom.root = root;

  // ------------------------------------------------------------------ menu entry
  dom.menuOwner = dom.menuOwner || null;
  dom.menuEntries = dom.menuEntries || [];
  /**
   * Insertion points of the game layout (GALAXYZ: specs/galaxyz/layout.md §10; OgameX: specs/layout.md):
   * { menu: ul for menu entries, topBar, rightColumn (missing on GALAXYZ info pages and fleetStep3), content, footer,
   *   leftColumn: the floated left menu column (GALAXYZ #links, OgameX #left), menuEnd: the element to insert AFTER to sit
   *   under the left menu inside leftColumn (GALAXYZ #links > #menuTable, OgameX #left > #toolbarcomponent) }.
   * Floating widgets go to dom.root() on body. GALAXYZ ids #planetList/#OvfleetEvents are duplicated: never use them as anchors.
   */
  dom.anchors = function () {
    const q = (sel) => { try { return document.querySelector(sel); } catch (e) { return null; } };
    const gz = !!(OGX.page && OGX.page.isGz && OGX.page.isGz());
    return {
      leftColumn: gz ? q('#links') : q('#left'),
      menuEnd: gz ? q('#links > #menuTable') : q('#left > #toolbarcomponent'),
      menu: q('#menuTableTools') || q('#menuTable'),
      topBar: q('#bar > ul'),
      rightColumn: q('#rechts'),
      content: q('#inhalt') || q('#middle') || q('#content'),
      footer: q('#siteFooter .fright') || q('#siteFooter'),
    };
  };

  /**
   * Rows of the planet list, in page order: [{ row: .smallplanet, link: a.planetlink, planetId, moonLink: a.moonlink|null, moonId }].
   * OgameX: one #planetList, planet id in data-planet-id. GALAXYZ: one #planetList per planet (duplicated id), the planet id
   * only in a.planetlink[href*=cp=ID]. planetId is null when neither is readable.
   */
  dom.planetRows = function () {
    const cpOf = (a) => {
      const m = a ? /[?&]cp=(\d+)/.exec(a.getAttribute('href') || a.getAttribute('data-link') || '') : null;
      return m && +m[1] > 0 ? +m[1] : null;
    };
    let rows = [];
    try { rows = Array.from(document.querySelectorAll('#planetList > .smallplanet')); } catch (e) { /* ignore */ }
    return rows.map((row) => {
      const link = row.querySelector('a.planetlink');
      const moonLink = row.querySelector('a.moonlink');
      const attr = +row.getAttribute('data-planet-id');
      return { row, link, planetId: attr > 0 ? attr : cpOf(link), moonLink, moonId: cpOf(moonLink) };
    });
  };
  /** Every #planetList element (GALAXYZ: one per planet) and the last one, the anchor for blocks placed below the list. */
  dom.planetLists = function () {
    try { return Array.from(document.querySelectorAll('#planetList')); } catch (e) { return []; }
  };
  dom.planetListEnd = function () {
    const all = dom.planetLists();
    return all.length ? all[all.length - 1] : null;
  };

  dom.menuEntry = function ({ id, label, iconText = '◆', title, onClick, badge } = {}) {
    // OgameX: #menuTableTools; GALAXYZ: #menuTable (li > span.menu_icon + a.menubutton > span.textlabel, same markup)
    const ul = document.getElementById('menuTableTools') || document.getElementById('menuTable');
    const elId = id ? (String(id).startsWith('ogx-') ? id : 'ogx-menu-' + id) : null;
    let li = elId ? document.getElementById(elId) : null;
    if (li) li.remove();
    const badgeEl = h('span', { class: 'ogx-menu-badge', hidden: badge == null ? true : null }, badge == null ? '' : String(badge));
    const a = h('a', { class: 'menubutton ogx-menubutton', href: '#', title: title || label, dataset: { ogx: id || '' },
      onClick: (ev) => { ev.preventDefault(); if (onClick) return onClick(ev); } },
    h('span', { class: 'textlabel' }, label || ''), badgeEl);
    li = h('li', { id: elId, class: 'ogx-menu-entry' },
      h('span', { class: 'menu_icon' }, h('div', { class: 'menuImage ogx-menu-icon', title: title || label }, iconText)), a);
    // One menu entry per extension: when dom.menuOwner is set (OgameX Suite: 'ogx-suite-entry'), every other entry is
    // built but kept out of the game menu (detached); its badge stays readable through dom.menuEntries for the owner.
    const detached = !!(dom.menuOwner && elId !== dom.menuOwner);
    if (ul && !detached) ul.appendChild(li);
    if (detached) li.dataset.ogxDetached = '1';
    const rec = { id: elId, label: label || '', li, badgeEl, detached, onClick };
    const iOld = dom.menuEntries.findIndex((x) => x.id === elId && elId);
    if (iOld >= 0) dom.menuEntries.splice(iOld, 1, rec); else dom.menuEntries.push(rec);
    return {
      li,
      setBadge(text) { badgeEl.textContent = text == null ? '' : String(text); badgeEl.hidden = text == null || text === ''; },
      setActive(on) { a.classList.toggle('selected', !!on); li.classList.toggle('ogx-active', !!on); },
    };
  };

  // ------------------------------------------------------------------ side panel
  const panels = {};
  function hiddenSetting(key, type, def) {
    try {
      const sch = OGX.settings.schema('core').core || {};
      if (!sch[key]) OGX.settings.define('core', { [key]: { type, default: def, hidden: true, label: key } });
    } catch (e) { /* settings missing */ }
  }
  function sget(path, def) { try { const v = OGX.settings.get(path); return v === undefined ? def : v; } catch (e) { return def; } }
  function sset(path, v) { try { return OGX.settings.set(path, v); } catch (e) { return Promise.resolve(); } }

  // maxWidth: while the user has not resized it, the panel grows with the window (36vw) from `width` up to `maxWidth`.
  dom.sidePanel = function (id, { title = '', width = 360, maxWidth = 0, side = 'right' } = {}) {
    if (panels[id] && panels[id].el.isConnected) return panels[id];
    const kOpen = `panel.${id}.open`, kTab = `panel.${id}.tab`, kWidth = `panel.${id}.width`;
    hiddenSetting(kOpen, 'bool', false);
    hiddenSetting(kTab, 'string', '');
    hiddenSetting(kWidth, 'int', width);
    const tabs = [];
    let current = null;
    // Optional second level (OgameX Suite: Live / Infinity / Бот / Логи): panel.setGroups(groups, { defaultGroup, tabGroups }).
    let groups = null;
    let defaultGroup = null;
    let tabGroups = {};
    const lastInGroup = {};
    const groupBar = h('div', { class: 'ogx-tabs ogx-tab-groups', role: 'tablist', hidden: true });
    const tabBar = h('div', { class: 'ogx-tabs', role: 'tablist' });
    const status = h('div', { class: 'ogx-panel-status', hidden: true });
    const body = h('div', { class: 'ogx-panel-body' });
    const closeBtn = h('button', { class: 'ogx-btn ogx-btn-icon ogx-panel-close', title: 'Закрыть (Esc)' }, dom.icon('close'));
    const titleEl = h('div', { class: 'ogx-panel-title' }, title);
    const header = h('div', { class: 'ogx-panel-header' }, titleEl, closeBtn);
    const grip = h('div', { class: 'ogx-panel-grip', title: 'Изменить ширину' });
    const elId = String(id).startsWith('ogx-') ? id : 'ogx-panel-' + id;
    const el = h('div', { id: elId, class: ['ogx-root', 'ogx-panel', 'ogx-panel-' + side], hidden: true, tabindex: '-1' },
      grip, header, groupBar, tabBar, body, status);
    const w = +sget('core.' + kWidth, width) || width;
    el.style.width = maxWidth > width && w === width ? `min(max(${w}px, 36vw), ${maxWidth}px, 100vw)` : `min(${w}px, 100vw)`;
    (document.body || document.documentElement).appendChild(el);

    const panel = {
      el, header, body, tabBar, id,
      isOpen: () => !el.hidden,
      open() {
        if (!el.hidden) return;
        el.hidden = false;
        sset('core.' + kOpen, true);
        if (!current && tabs.length) panel.selectTab(sget('core.' + kTab, '') || firstTab().id);
        else if (current) renderTab(tabs.find((t) => t.id === current));
      },
      close() {
        if (el.hidden) return;
        el.hidden = true;
        sset('core.' + kOpen, false);
        const t = tabs.find((x) => x.id === current);
        if (t && t.onHide) OGX.safe(t.onHide, 'panel:onHide')();
      },
      toggle() { if (el.hidden) panel.open(); else panel.close(); },
      setTitle(t) { titleEl.textContent = t; },
      addTab(def) {
        const t = Object.assign({ order: 100 }, def);
        const badgeEl = h('span', { class: 'ogx-badge', hidden: t.badge == null }, t.badge == null ? '' : String(t.badge));
        t.btn = h('button', { class: 'ogx-tab', role: 'tab', dataset: { tab: t.id }, onClick: () => panel.selectTab(t.id) }, t.label, badgeEl);
        t.badgeEl = badgeEl;
        t.pane = h('div', { class: 'ogx-tab-pane', dataset: { tab: t.id }, hidden: true });
        const old = tabs.findIndex((x) => x.id === t.id);
        if (old >= 0) { tabs[old].btn.remove(); tabs[old].pane.remove(); tabs.splice(old, 1); }
        tabs.push(t);
        tabs.sort((a, b) => a.order - b.order);
        body.appendChild(t.pane);
        drawBars();
        if (!el.hidden) {
          const want = sget('core.' + kTab, '');
          if (!current || (want === t.id && current !== t.id)) panel.selectTab(want && tabs.some((x) => x.id === want) ? want : firstTab().id);
        }
        return {
          setBadge(text) { badgeEl.textContent = text == null ? '' : String(text); badgeEl.hidden = text == null || text === ''; },
          refresh() { if (current === t.id && !el.hidden) renderTab(t); else t.stale = true; },
        };
      },
      selectTab(tid) {
        const t = tabs.find((x) => x.id === tid) || firstTab();
        if (!t) return;
        const prev = tabs.find((x) => x.id === current);
        if (prev && prev !== t && prev.onHide) OGX.safe(prev.onHide, 'panel:onHide')();
        current = t.id;
        if (groups) lastInGroup[groupOf(t)] = t.id;
        drawBars();
        for (const x of tabs) {
          const on = x === t;
          x.btn.classList.toggle('ogx-active', on);
          x.btn.setAttribute('aria-selected', on ? 'true' : 'false');
          x.pane.hidden = !on;
        }
        // Only a tab that was asked for by id is remembered. Right after a page load the saved tab's module may not have added
        // it yet; the fallback shown meanwhile must not overwrite the choice (addTab switches to it once it arrives).
        if (t.id === tid && sget('core.' + kTab, '') !== t.id) sset('core.' + kTab, t.id);
        if (!el.hidden) renderTab(t);
      },
      currentTab: () => current,
      setGroups(list, opts = {}) {
        groups = Array.isArray(list) && list.length ? list.map((g, i) => Object.assign({ order: i * 10 }, g)).sort((a, b) => a.order - b.order) : null;
        defaultGroup = opts.defaultGroup || (groups ? groups[0].id : null);
        tabGroups = Object.assign({}, opts.tabGroups || {});
        for (const g of groups || []) {
          g.btn = h('button', { class: 'ogx-tab ogx-tab-group', role: 'tab', dataset: { group: g.id }, title: g.title || null, onClick: () => panel.selectGroup(g.id) }, g.label);
        }
        drawBars();
      },
      selectGroup(gid) {
        const inGroup = tabs.filter((x) => groupOf(x) === gid);
        if (!inGroup.length) return;
        const want = lastInGroup[gid];
        panel.selectTab(inGroup.some((x) => x.id === want) ? want : inGroup[0].id);
        if (el.hidden) panel.open();
      },
      currentGroup: () => { const t = tabs.find((x) => x.id === current); return t && groups ? groupOf(t) : null; },
      setStatus(text) { status.textContent = text == null ? '' : String(text); status.hidden = text == null || text === ''; },
    };
    // Fallback tab: the first tab of the default group (Infinity in the suite), else the first tab.
    function firstTab() {
      return (groups && tabs.find((x) => groupOf(x) === defaultGroup)) || tabs[0];
    }
    function groupOf(t) {
      if (!groups) return null;
      const g = t.group || tabGroups[t.id] || defaultGroup;
      return groups.some((x) => x.id === g) ? g : defaultGroup;
    }
    // Re-attaching the tab buttons (and clearing a pane) drops the keyboard focus to <body>: the panel's Esc handler would
    // stop working after a tab click. keepFocus puts it back on the same element, or on the panel itself.
    function keepFocus(fn) {
      const a = document.activeElement;
      const inside = !!(a && a !== el && el.contains(a));
      const r = fn();
      if (inside && !el.hidden && !(document.activeElement && el.contains(document.activeElement))) {
        try { if (a.isConnected && el.contains(a)) a.focus({ preventScroll: true }); else el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
      return r;
    }
    function drawBars() { return keepFocus(drawBarsNow); }
    function drawBarsNow() {
      tabBar.textContent = '';
      if (!groups) {
        groupBar.hidden = true;
        for (const x of tabs) tabBar.appendChild(x.btn);
        tabBar.hidden = tabs.length < 2;
        return;
      }
      const cur = tabs.find((x) => x.id === current);
      const curGroup = cur ? groupOf(cur) : defaultGroup;
      groupBar.textContent = '';
      for (const g of groups) {
        if (!tabs.some((x) => groupOf(x) === g.id)) continue;
        g.btn.classList.toggle('ogx-active', g.id === curGroup);
        g.btn.setAttribute('aria-selected', g.id === curGroup ? 'true' : 'false');
        groupBar.appendChild(g.btn);
      }
      groupBar.hidden = false;
      const visible = tabs.filter((x) => groupOf(x) === curGroup);
      for (const x of visible) tabBar.appendChild(x.btn);
      tabBar.hidden = visible.length < 2;
    }
    function renderTab(t) { return keepFocus(() => renderTabNow(t)); }
    function renderTabNow(t) {
      if (!t) return;
      t.stale = false;
      t.pane.textContent = '';
      const r = OGX.safe(t.render, 'panel:' + id + ':' + t.id)(t.pane, panel);
      if (t.onShow) OGX.safe(t.onShow, 'panel:onShow')();
      return r;
    }
    closeBtn.addEventListener('click', OGX.safe(() => panel.close(), 'panel:close'));
    el.addEventListener('keydown', OGX.safe((ev) => { if (ev.key === 'Escape') { panel.close(); ev.stopPropagation(); } }, 'panel:esc'));
    // Resize by dragging the inner edge.
    grip.addEventListener('mousedown', OGX.safe((ev) => {
      ev.preventDefault();
      const startX = ev.clientX, startW = el.getBoundingClientRect().width;
      const move = (e) => {
        const dx = side === 'right' ? startX - e.clientX : e.clientX - startX;
        el.style.width = `min(${Math.max(240, Math.round(startW + dx))}px, 100vw)`;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        sset('core.' + kWidth, Math.round(el.getBoundingClientRect().width));
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }, 'panel:resize'));
    panels[id] = panel;
    if (sget('core.' + kOpen, false)) setTimeout(OGX.safe(() => panel.open(), 'panel:restore'), 0);
    return panel;
  };
  dom._panels = panels;

  // ------------------------------------------------------------------ modal / confirm
  const modalStack = [];
  dom.modal = function ({ title = '', body = null, buttons = [{ label: 'Закрыть' }], width = 520, onClose } = {}) {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      const i = modalStack.indexOf(api);
      if (i >= 0) modalStack.splice(i, 1);
      if (onClose) OGX.safe(onClose, 'modal:onClose')();
    };
    const btnRow = h('div', { class: 'ogx-modal-buttons' },
      (buttons || []).map((b) => h('button', {
        class: ['ogx-btn', b.primary && 'ogx-btn-primary', b.danger && 'ogx-btn-danger'],
        dataset: { role: b.role || '' },
        onClick: () => { if (b.onClick) { const r = b.onClick(close); if (r !== false && b.keepOpen !== true && !b.manual) close(); } else close(); },
      }, b.label)));
    const box = h('div', { class: 'ogx-modal', role: 'dialog', 'aria-modal': 'true', style: { width: `min(${width}px, calc(100vw - 32px))` }, tabindex: '-1' },
      h('div', { class: 'ogx-modal-header' }, h('div', { class: 'ogx-modal-title' }, title),
        h('button', { class: 'ogx-btn ogx-btn-icon', title: 'Закрыть (Esc)', onClick: () => close() }, dom.icon('close'))),
      h('div', { class: 'ogx-modal-body' }, body),
      btnRow);
    const overlay = h('div', { class: 'ogx-root ogx-modal-overlay', onMousedown: (ev) => { if (ev.target === overlay) close(); } }, box);
    overlay.addEventListener('keydown', OGX.safe((ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }, 'modal:esc'));
    (document.body || document.documentElement).appendChild(overlay);
    const api = { el: overlay, box, close };
    modalStack.push(api);
    setTimeout(() => { try { (box.querySelector('.ogx-btn-primary') || box).focus(); } catch (e) { /* ignore */ } }, 0);
    return api;
  };

  dom.confirm = function (text, { okLabel = 'Да', cancelLabel = 'Отмена', danger = false, title = 'Подтверждение' } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (v) => { if (!answered) { answered = true; resolve(v); } };
      const body = text instanceof Node ? text : h('div', { class: 'ogx-confirm-text' }, String(text));
      dom.modal({
        title, body, width: 420,
        buttons: [
          { label: cancelLabel, role: 'cancel', onClick: () => done(false) },
          { label: okLabel, role: 'ok', primary: !danger, danger, onClick: () => done(true) },
        ],
        onClose: () => done(false),
      });
    });
  };

  // ------------------------------------------------------------------ toast
  dom.toast = function (text, { type = 'info', ms = 3500 } = {}) {
    let stack = document.getElementById('ogx-toasts');
    if (!stack) { stack = h('div', { id: 'ogx-toasts', class: 'ogx-root ogx-toasts', 'aria-live': 'polite' }); (document.body || document.documentElement).appendChild(stack); }
    const t = h('div', { class: ['ogx-toast', 'ogx-toast-' + type], role: type === 'error' ? 'alert' : 'status' }, String(text));
    t.addEventListener('click', () => t.remove());
    stack.appendChild(t);
    while (stack.children.length > 5) stack.firstChild.remove();
    if (ms > 0) setTimeout(() => t.remove(), ms);
  };

  // ------------------------------------------------------------------ tooltip
  let tipEl = null;
  function tip() {
    if (!tipEl || !tipEl.isConnected) {
      tipEl = h('div', { class: 'ogx-root ogx-tooltip', role: 'tooltip', hidden: true });
      (document.body || document.documentElement).appendChild(tipEl);
    }
    return tipEl;
  }
  dom.tooltip = function (el, content, { side = 'auto' } = {}) {
    if (!el) return () => {};
    const show = OGX.safe(() => {
      const t = tip();
      t.textContent = '';
      const c = typeof content === 'function' ? content() : content;
      if (c == null || c === '') return;
      append(t, c);
      t.hidden = false;
      const r = el.getBoundingClientRect();
      const tw = t.offsetWidth, th = t.offsetHeight;
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      let s = side;
      if (s === 'auto') s = r.top > th + 8 ? 'top' : 'bottom';
      let top = s === 'top' ? r.top - th - 6 : s === 'bottom' ? r.bottom + 6 : r.top + (r.height - th) / 2;
      let left = s === 'left' ? r.left - tw - 6 : s === 'right' ? r.right + 6 : r.left + (r.width - tw) / 2;
      left = Math.max(4, Math.min(vw - tw - 4, left));
      top = Math.max(4, Math.min(vh - th - 4, top));
      t.style.left = Math.round(left) + 'px';
      t.style.top = Math.round(top) + 'px';
    }, 'tooltip:show');
    const hide = () => { if (tipEl) tipEl.hidden = true; };
    el.addEventListener('mouseenter', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', show);
    el.addEventListener('blur', hide);
    return () => {
      el.removeEventListener('mouseenter', show);
      el.removeEventListener('mouseleave', hide);
      el.removeEventListener('focus', show);
      el.removeEventListener('blur', hide);
      hide();
    };
  };

  // ------------------------------------------------------------------ table
  dom.table = function ({ columns = [], rows = [], sortKey = null, sortDir = 'desc', rowKey, onRowClick, emptyText = 'Нет данных', maxRows, className } = {}) {
    let data = rows.slice();
    let key = sortKey, dir = sortDir;
    const thead = h('thead');
    const tbody = h('tbody');
    const el = h('table', { class: ['ogx-table', className] }, thead, tbody);
    const colVal = (c, r) => (c.value ? c.value(r) : r[c.key]);
    function header() {
      thead.textContent = '';
      const tr = h('tr');
      for (const c of columns) {
        const sortable = c.sortable !== false;
        const th = h('th', {
          class: [sortable && 'ogx-sortable', key === c.key && ('ogx-sorted-' + dir), c.align && 'ogx-' + c.align],
          title: c.title, style: c.width ? { width: c.width } : null, dataset: { key: c.key },
          onClick: sortable ? () => api.sortBy(c.key, key === c.key ? (dir === 'asc' ? 'desc' : 'asc') : (c.defaultDir || 'desc')) : null,
        }, c.label);
        tr.appendChild(th);
      }
      thead.appendChild(tr);
    }
    function cmp(a, b) {
      if (a === b) return 0;
      if (a === null || a === undefined || (typeof a === 'number' && Number.isNaN(a))) return 1;
      if (b === null || b === undefined || (typeof b === 'number' && Number.isNaN(b))) return -1;
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b), 'ru', { numeric: true });
    }
    function body() {
      tbody.textContent = '';
      let list = data.slice();
      const col = columns.find((c) => c.key === key);
      if (col) {
        list.sort((a, b) => {
          const va = colVal(col, a), vb = colVal(col, b);
          const nullA = va === null || va === undefined, nullB = vb === null || vb === undefined;
          if (nullA || nullB) return nullA && nullB ? 0 : nullA ? 1 : -1; // empty values always last
          const r = cmp(va, vb);
          return dir === 'asc' ? r : -r;
        });
      }
      if (maxRows && list.length > maxRows) list = list.slice(0, maxRows);
      if (!list.length) {
        tbody.appendChild(h('tr', { class: 'ogx-empty' }, h('td', { colspan: String(columns.length || 1) }, emptyText)));
        return;
      }
      for (const r of list) {
        const tr = h('tr', { dataset: rowKey ? { key: typeof rowKey === 'function' ? rowKey(r) : r[rowKey] } : null,
          class: onRowClick ? 'ogx-clickable' : null,
          onClick: onRowClick ? (ev) => onRowClick(r, ev) : null });
        for (const c of columns) {
          let content;
          try {
            content = c.render ? c.render(r) : r[c.key];
          } catch (e) { OGX._log.error('table render', e); content = '?'; }
          if (typeof content === 'number') content = OGX.fmt.num(content);
          tr.appendChild(h('td', { class: c.align ? 'ogx-' + c.align : null }, content));
        }
        tbody.appendChild(tr);
      }
    }
    const api = {
      el,
      setRows(r) { data = (r || []).slice(); body(); },
      sortBy(k, d = 'desc') { key = k; dir = d === 'asc' ? 'asc' : 'desc'; header(); body(); },
      get rows() { return data.slice(); },
      get sort() { return { key, dir }; },
    };
    header(); body();
    return api;
  };

  // ------------------------------------------------------------------ bar / countdown
  dom.bar = function (fraction, { cls, title } = {}) {
    const f = Number.isFinite(+fraction) ? Math.max(0, Math.min(1, +fraction)) : 0;
    const c = cls || (f >= 0.95 ? 'ogx-bad' : f >= 0.75 ? 'ogx-warn' : 'ogx-ok');
    return h('div', { class: ['ogx-bar', c], title, dataset: { fraction: f.toFixed(4) } },
      h('div', { class: 'ogx-bar-fill', style: { width: (f * 100).toFixed(1) + '%' } }));
  };

  dom.countdown = function (serverMsEnd, { doneText = 'Готово', short = false } = {}) {
    const el = h('span', { class: 'ogx-countdown', dataset: { end: String(Math.round(+serverMsEnd || 0)), done: doneText, short: short ? '1' : null } });
    renderCountdown(el, OGX.time && OGX.time.serverNow ? OGX.time.serverNow() : Date.now());
    return el;
  };
  function renderCountdown(el, now) {
    const end = +el.dataset.end;
    const secs = Math.ceil((end - now) / 1000);
    let txt;
    if (!Number.isFinite(end)) txt = '∞';
    else if (secs <= 0) { txt = el.dataset.done || 'Готово'; el.classList.add('ogx-done'); } else txt = el.dataset.short ? OGX.fmt.durationShort(secs) : OGX.fmt.duration(secs);
    if (el.textContent !== txt) el.textContent = txt;
  }
  dom.updateCountdowns = function (now = OGX.time.serverNow()) {
    for (const el of document.querySelectorAll('.ogx-countdown[data-end]')) renderCountdown(el, now);
  };

  // ------------------------------------------------------------------ settings form
  /** Legend of the core (non-module) settings namespaces in dom.settingsForm. */
  dom.NS_TITLES = { core: 'Общие настройки', diag: 'Журнал событий' };
  dom.settingsForm = function (nsList, { onChange, showHidden = false } = {}) {
    const form = h('form', { class: 'ogx-settings-form', onSubmit: (ev) => ev.preventDefault() });
    const all = OGX.settings.schema();
    for (const ns of nsList || []) {
      const schema = all[ns];
      if (!schema) continue;
      const mod = OGX.modules[ns];
      const fs = h('fieldset', { class: 'ogx-settings-ns', dataset: { ns } }, h('legend', null, dom.NS_TITLES[ns] || (mod && mod.title) || ns));
      // spec.engines: the setting only has an effect on these engines ('galaxyz' | 'ogamex'): not shown elsewhere
      let engine = 'ogamex';
      try { if (OGX.page.isGz && OGX.page.isGz()) engine = 'galaxyz'; } catch (e) { /* default */ }
      const keys = Object.keys(schema).filter((k) => (showHidden || !schema[k].hidden) && (!Array.isArray(schema[k].engines) || schema[k].engines.includes(engine)));
      keys.sort((a, b) => (a === 'enabled' ? -1 : b === 'enabled' ? 1 : 0));
      let lastSection = null;
      for (const k of keys) {
        const sp = schema[k];
        if (sp.section && sp.section !== lastSection && k !== 'enabled' && ns === 'core') { fs.appendChild(h('div', { class: 'ogx-settings-section' }, sp.section)); }
        lastSection = sp.section || lastSection;
        fs.appendChild(fieldFor(ns + '.' + k, sp, onChange));
      }
      form.appendChild(fs);
    }
    return form;
  };
  function fieldFor(path, sp, onChange) {
    const val = OGX.settings.get(path);
    const id = 'ogx-set-' + path.replace(/[^a-z0-9]+/gi, '-');
    const save = async (v) => { await OGX.settings.set(path, v); if (onChange) OGX.safe(onChange, 'settingsForm:onChange')(path, OGX.settings.get(path)); };
    let input;
    switch (sp.type) {
      case 'bool':
        input = h('input', { type: 'checkbox', id, checked: !!val, onChange: (e) => save(e.target.checked) });
        return h('label', { class: 'ogx-field ogx-field-bool', dataset: { key: path }, title: sp.hint }, input, ' ', sp.label || path);
      case 'enum':
        input = h('select', { id, onChange: (e) => { const o = (sp.options || [])[e.target.selectedIndex]; save(o ? o.value : e.target.value); } },
          (sp.options || []).map((o) => h('option', { value: String(o.value), selected: o.value === val }, o.label)));
        break;
      case 'int':
      case 'float':
        input = h('input', { type: 'number', id, value: String(val), min: sp.min, max: sp.max, step: sp.step || (sp.type === 'int' ? 1 : 'any'),
          onChange: (e) => save(e.target.value).then(() => { e.target.value = String(OGX.settings.get(path)); }) });
        break;
      case 'color':
        input = h('input', { type: 'color', id, value: val, onChange: (e) => save(e.target.value) });
        break;
      case 'hotkey':
        input = h('input', { type: 'text', id, value: val || '', placeholder: 'нет', readonly: true, class: 'ogx-hotkey',
          onKeydown: (e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') { e.target.value = ''; save(''); return; }
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
            const combo = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join('+');
            const n = OGX.settings.normalizeHotkey(combo);
            e.target.value = n; save(n);
          } });
        break;
      case 'json':
        input = h('textarea', { id, rows: '4', onChange: (e) => { try { save(JSON.parse(e.target.value)); e.target.classList.remove('ogx-invalid'); } catch (err) { e.target.classList.add('ogx-invalid'); } } },
          JSON.stringify(val, null, 1));
        break;
      default:
        input = h('input', { type: 'text', id, value: val == null ? '' : String(val), onChange: (e) => save(e.target.value) });
    }
    return h('div', { class: 'ogx-field', dataset: { key: path } },
      h('label', { for: id, title: sp.hint }, sp.label || path), input,
      sp.hint ? h('div', { class: 'ogx-hint' }, sp.hint) : null);
  }

  // ------------------------------------------------------------------ files and clipboard
  dom.download = function (filename, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename, style: 'display:none' });
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  };
  dom.pickFile = function ({ accept = '.json' } = {}) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept, style: 'display:none' });
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; input.remove(); resolve(v); } };
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) return finish(null);
        const r = new FileReader();
        r.onload = () => finish(String(r.result));
        r.onerror = () => finish(null);
        r.readAsText(f);
      });
      input.addEventListener('cancel', () => finish(null));
      (document.body || document.documentElement).appendChild(input);
      input.click();
    });
  };
  dom.copy = async function (text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(String(text)); return true; }
    } catch (e) { /* fall back */ }
    try {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' }, String(text));
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) { return false; }
  };

  // ------------------------------------------------------------------ icons (24x24 stroke paths)
  const ICONS = {
    gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    refresh: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15'],
    star: ['M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z'],
    eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    note: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8'],
    send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4z'],
    spy: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.4-4.4'],
    trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
    up: ['M18 15l-6-6-6 6'],
    down: ['M6 9l6 6 6-6'],
    close: ['M18 6L6 18', 'M6 6l12 12'],
    plus: ['M12 5v14', 'M5 12h14'],
  };
  dom.icon = function (name) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ogx-icon ogx-icon-' + name);
    for (const d of ICONS[name] || ICONS.plus) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  };
  dom.ICONS = Object.keys(ICONS);
})(window.OGX);
