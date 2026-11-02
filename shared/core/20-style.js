/* shared/core/20-style.js — base CSS for ogx- widgets (injected by OGX.boot as <style id="ogx-core">). Owner: core.
 * Every selector is scoped to own ogx- classes; game elements are never restyled globally. */
(function (OGX) {
  'use strict';
  OGX.style = OGX.style || {};
  OGX.style.core = `
.ogx-root, .ogx-panel, .ogx-modal-overlay, .ogx-toasts, .ogx-tooltip, .ogx-banner, .ogx-settings-form, .ogx-table, .ogx-gx-slot {
  --ogx-bg: #0d1014; --ogx-panel: #161c24; --ogx-panel-2: #1c242e; --ogx-border: #2b3846; --ogx-text: #cfd8e3; --ogx-muted: #8593a3;
  --ogx-accent: #6f9fd8; --ogx-ok: #4caf50; --ogx-warn: #ff9800; --ogx-bad: #f44336;
  --ogx-metal: #a9b5c4; --ogx-crystal: #79c2e8; --ogx-deuterium: #7fe0b4; --ogx-energy: #f2d16b;
  font: 11px/1.4 Verdana, Arial, sans-serif; color: var(--ogx-text); box-sizing: border-box;
  /* GALAXYZ centres everything from body (and 2Moons skins set letter-spacing / uppercase on links): reset for own widgets */
  text-align: left; letter-spacing: normal; text-transform: none; text-shadow: none;
}
.ogx-root *, .ogx-panel *, .ogx-modal-overlay * { box-sizing: border-box; }
.ogx-root [hidden], .ogx-panel[hidden], .ogx-panel [hidden], .ogx-tooltip[hidden], .ogx-menu-badge[hidden], .ogx-badge[hidden] { display: none !important; }
.ogx-float-root { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 9000; }

/* buttons */
.ogx-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 22px; padding: 2px 8px; border: 1px solid var(--ogx-border);
  border-radius: 3px; background: var(--ogx-panel-2); color: var(--ogx-text); font: inherit; cursor: pointer; white-space: nowrap; }
.ogx-btn:hover { border-color: var(--ogx-accent); color: #fff; }
.ogx-btn:focus-visible { outline: 1px solid var(--ogx-accent); outline-offset: 1px; }
.ogx-btn:disabled { opacity: .5; cursor: default; }
.ogx-btn-primary { background: #24486e; border-color: var(--ogx-accent); color: #fff; }
.ogx-btn-danger { background: #5a1f1c; border-color: var(--ogx-bad); color: #fff; }
.ogx-btn-icon { min-width: 22px; padding: 2px 4px; }
.ogx-icon { display: inline-block; vertical-align: middle; flex: none; }

/* menu entry (OgameX ul#menuTableTools; GALAXYZ ul#menuTable: li 176x29, span.menu_icon floats right, 38px wide) */
.ogx-menu-entry .ogx-menu-icon { display: flex; align-items: center; justify-content: center; color: var(--ogx-accent, #6f9fd8); font-size: 14px; background: none; }
.ogx-menu-entry a.menubutton { position: relative; }
#menuTable > li.ogx-menu-entry .ogx-menu-icon { width: 27px; height: 27px; margin: 1px 0 0 4px; border-radius: 4px; font-size: 16px; line-height: 27px;
  text-shadow: 0 0 6px rgba(111,159,216,.8); cursor: pointer; }
#menuTable > li.ogx-menu-entry a.menubutton .ogx-menu-badge { position: absolute; top: 2px; right: 4px; line-height: 13px; }
.ogx-menu-badge { display: inline-block; margin-left: 4px; padding: 0 4px; border-radius: 7px; background: #f44336; color: #fff; font-size: 9px; line-height: 13px; }

/* side panel */
.ogx-panel { position: fixed; top: 0; bottom: 0; z-index: 9000; width: min(360px, 100vw); max-width: 100vw; display: flex; flex-direction: column;
  background: var(--ogx-panel); border: 1px solid var(--ogx-border); box-shadow: 0 0 18px rgba(0,0,0,.6); }
.ogx-panel-right { right: 0; border-right: 0; }
.ogx-panel-left { left: 0; border-left: 0; }
.ogx-panel-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--ogx-border); background: var(--ogx-bg); }
.ogx-panel-title { flex: 1; font-weight: bold; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ogx-panel-body { flex: 1; overflow: auto; padding: 6px 8px; }
.ogx-panel-status { padding: 4px 8px; border-top: 1px solid var(--ogx-border); color: var(--ogx-muted); }
.ogx-panel-grip { position: absolute; top: 0; bottom: 0; width: 5px; cursor: ew-resize; }
.ogx-panel-right .ogx-panel-grip { left: -3px; }
.ogx-panel-left .ogx-panel-grip { right: -3px; }

/* tabs */
.ogx-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px 6px 0; border-bottom: 1px solid var(--ogx-border); background: var(--ogx-bg); }
.ogx-tab { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid transparent; border-bottom: 0; border-radius: 3px 3px 0 0;
  background: transparent; color: var(--ogx-muted); font: inherit; cursor: pointer; }
.ogx-tab:hover { color: var(--ogx-text); }
.ogx-tab.ogx-active { background: var(--ogx-panel); border-color: var(--ogx-border); color: #fff; }
.ogx-tab-groups { padding-top: 5px; }
.ogx-tab-groups .ogx-tab { font-weight: bold; letter-spacing: .3px; }
.ogx-tab-groups .ogx-tab.ogx-active { color: var(--ogx-accent); }
.ogx-badge { display: inline-block; min-width: 14px; padding: 0 4px; border-radius: 7px; background: var(--ogx-accent); color: #000; font-size: 9px; line-height: 14px; text-align: center; }
.ogx-badge.ogx-bad { background: var(--ogx-bad); color: #fff; }

/* tables */
.ogx-table { width: 100%; border-collapse: collapse; background: var(--ogx-panel); }
.ogx-table th, .ogx-table td { padding: 3px 5px; border-bottom: 1px solid var(--ogx-border); text-align: left; vertical-align: middle; }
.ogx-table thead th { position: sticky; top: 0; z-index: 1; background: var(--ogx-bg); color: #fff; font-weight: bold; white-space: nowrap; }
.ogx-table tbody tr:nth-child(even) td { background: rgba(255,255,255,.025); }
.ogx-table tbody tr:hover td { background: rgba(111,159,216,.12); }
.ogx-table th.ogx-sortable { cursor: pointer; user-select: none; }
.ogx-table th.ogx-sortable::after { content: ''; display: inline-block; margin-left: 4px; opacity: .4; }
.ogx-table th.ogx-sorted-asc::after { content: '▲'; opacity: 1; font-size: 8px; }
.ogx-table th.ogx-sorted-desc::after { content: '▼'; opacity: 1; font-size: 8px; }
.ogx-table .ogx-right { text-align: right; font-variant-numeric: tabular-nums; }
.ogx-table .ogx-center { text-align: center; }
.ogx-table tr.ogx-clickable { cursor: pointer; }
.ogx-table tr.ogx-empty td { color: var(--ogx-muted); text-align: center; padding: 10px; }

/* modal */
.ogx-modal-overlay { position: fixed; inset: 0; z-index: 9500; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.55); }
.ogx-modal { max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: var(--ogx-panel); border: 1px solid var(--ogx-border);
  border-radius: 4px; box-shadow: 0 6px 30px rgba(0,0,0,.7); }
.ogx-modal-header { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--ogx-border); background: var(--ogx-bg); }
.ogx-modal-title { flex: 1; font-weight: bold; color: #fff; }
.ogx-modal-body { padding: 10px; overflow: auto; }
.ogx-modal-buttons { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--ogx-border); }
.ogx-confirm-text > div + div { margin-top: 3px; }
.ogx-warn-text { color: var(--ogx-warn); }

/* toasts */
.ogx-toasts { position: fixed; right: 16px; bottom: 16px; z-index: 9600; display: flex; flex-direction: column; gap: 6px; max-width: min(360px, calc(100vw - 32px)); }
.ogx-toast { padding: 8px 10px; border-radius: 3px; border-left: 3px solid var(--ogx-accent); background: var(--ogx-panel); color: var(--ogx-text);
  box-shadow: 0 2px 10px rgba(0,0,0,.6); cursor: pointer; }
.ogx-toast-ok { border-left-color: var(--ogx-ok); }
.ogx-toast-warn { border-left-color: var(--ogx-warn); }
.ogx-toast-error { border-left-color: var(--ogx-bad); }

/* tooltip */
.ogx-tooltip { position: fixed; z-index: 9700; max-width: 360px; padding: 6px 8px; border: 1px solid var(--ogx-border); border-radius: 3px;
  background: #0b0e12; color: var(--ogx-text); box-shadow: 0 2px 10px rgba(0,0,0,.7); pointer-events: none; white-space: normal; }

/* bars, countdowns, colours */
.ogx-bar { position: relative; height: 4px; min-width: 30px; border-radius: 2px; background: #26303b; overflow: hidden; }
.ogx-bar-fill { height: 100%; background: var(--ogx-ok); }
.ogx-bar.ogx-warn .ogx-bar-fill { background: var(--ogx-warn); }
.ogx-bar.ogx-bad .ogx-bar-fill { background: var(--ogx-bad); }
.ogx-countdown { font-variant-numeric: tabular-nums; white-space: nowrap; }
.ogx-countdown.ogx-done { color: var(--ogx-ok); }
.ogx-ok-text, .ogx-root .ogx-ok-text { color: var(--ogx-ok); }
.ogx-bad-text { color: var(--ogx-bad); }
.ogx-muted { color: var(--ogx-muted); }
.ogx-metal { color: var(--ogx-metal); } .ogx-crystal { color: var(--ogx-crystal); } .ogx-deuterium { color: var(--ogx-deuterium); } .ogx-energy { color: var(--ogx-energy); }

/* forms */
.ogx-settings-form fieldset { margin: 0 0 8px; padding: 6px 8px; border: 1px solid var(--ogx-border); border-radius: 3px; }
.ogx-settings-form legend { padding: 0 4px; color: #fff; font-weight: bold; }
.ogx-settings-section { margin: 6px 0 2px; color: var(--ogx-accent); font-weight: bold; }
.ogx-field { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 4px 0; }
.ogx-field > label { flex: 1 1 180px; }
.ogx-field-bool { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.ogx-hint { flex-basis: 100%; color: var(--ogx-muted); font-size: 10px; }
.ogx-root input[type=text], .ogx-root input[type=search], .ogx-root input[type=number], .ogx-root select, .ogx-root textarea,
.ogx-panel input[type=search],
.ogx-settings-form input[type=text], .ogx-settings-form input[type=search], .ogx-settings-form input[type=number], .ogx-settings-form select, .ogx-settings-form textarea,
.ogx-input { min-height: 20px; padding: 1px 4px; border: 1px solid var(--ogx-border); border-radius: 2px; background: var(--ogx-bg); color: var(--ogx-text); font: inherit; }
.ogx-root input[type=checkbox], .ogx-root input[type=radio] { margin: 0 4px 0 0; vertical-align: middle; }
.ogx-settings-form input[type=number] { width: 90px; }
.ogx-settings-form textarea { width: 100%; font-family: monospace; }
.ogx-invalid { border-color: var(--ogx-bad) !important; }

/* banner (fleet prefill and module notices) */
.ogx-banner { display: flex; align-items: center; gap: 8px; margin: 4px 0; padding: 6px 8px; border: 1px solid var(--ogx-accent); border-radius: 3px;
  background: rgba(36,72,110,.85); color: #fff; }
.ogx-banner > .ogx-btn { margin-left: auto; }

/* galaxy row slot (direct child of #galaxyRowN, survives cell re-render) */
.ogx-gx-slot { display: inline-flex; align-items: center; gap: 2px; margin-left: 2px; vertical-align: middle; }
.ogx-gx-slot:empty { display: none; }
.ogx-gx-header { display: inline-flex; gap: 4px; margin-left: 6px; vertical-align: middle; }
`;
})(window.OGX);
