/* ogamex-suite/loader.js — bootstrap of «OgameX Suite». Owner: integration. Runs last in the isolated world.
 * OGX.boot first detects the game (OGX.page.detect: GALAXYZ / 2Moons by meta generator + /game.php + serverTime +
 * #planetSelector, or lanedirt OgameX by metas + #planetList + marker) and returns at once anywhere else: the all-hosts
 * match costs another site the parse of the bundle, one detect() and nothing more (no storage, no timers, no DOM; the
 * page hook watches <head> until <body> starts, see shared/main/page-hook.js). Then the gate applies the optional host
 * allow-list from the popup
 * ('*|*|suite.hosts'; the built-in hosts in BUILTIN_HOSTS always pass, so ogamex.eu works without any setup), and the
 * filter applies the popup's global module switches ('*|*|suite.modules': { <name>: false }). The per-account switches
 * (<name>.enabled in settings) apply on top. */
(function (OGX) {
  'use strict';
  try {
    if (!OGX || !OGX.suite || typeof OGX.boot !== 'function') { console.error('[OGX Suite/loader] core not loaded'); return; }
    const S = OGX.suite;
    const gkey = (k) => '*|*|' + k;
    // Servers that always work, whatever the popup allow-list says (GALAXYZ: ogamex.eu and its universes).
    const BUILTIN_HOSTS = ['ogamex.eu', '*.ogamex.eu'];

    function readGlobal(keys) {
      return new Promise((resolve) => {
        try {
          const area = (typeof browser !== 'undefined' && browser.storage && browser.storage.local) ? browser.storage.local
            : (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
          if (area) {
            const r = area.get(keys, (v) => resolve(v || {}));
            if (r && typeof r.then === 'function') r.then((v) => resolve(v || {}), () => resolve({}));
            return;
          }
        } catch (e) { /* fall through to localStorage (userscript) */ }
        const out = {};
        try { for (const k of keys) { const v = localStorage.getItem('ogx.suite.' + k); if (v != null) out[k] = JSON.parse(v); } } catch (e) { /* blocked */ }
        resolve(out);
      });
    }
    /** host allow-list entry: 'ogx.example.org', 'localhost:8080', '*.example.org', '192.168.1.5' */
    function hostAllowed(list) {
      const host = location.host.toLowerCase();
      const name = location.hostname.toLowerCase();
      return list.some((raw) => {
        const e = String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
        if (!e) return false;
        if (e.startsWith('*.')) { const base = e.slice(2); return name === base || name.endsWith('.' + base); }
        return e === host || e === name;
      });
    }

    OGX.boot({
      ext: 'suite',
      modules: ['suite'].concat(S.moduleList()),
      sections: S.sectionMap(),
      gate: async () => {
        const g = await readGlobal([gkey(S.GLOBAL_KEYS.hosts), gkey(S.GLOBAL_KEYS.modules)]);
        const hosts = Array.isArray(g[gkey(S.GLOBAL_KEYS.hosts)]) ? g[gkey(S.GLOBAL_KEYS.hosts)].filter(Boolean) : [];
        S.allowHosts = hosts;
        if (hosts.length && !hostAllowed(hosts) && !hostAllowed(BUILTIN_HOSTS)) {
          // One line in the background journal so a «nothing works on my server» report shows why (no page data).
          try { if (OGX.diag && OGX.diag.recordGated) OGX.diag.recordGated('allow-list', { allowHosts: hosts }); } catch (e) { /* ignore */ }
          return false;
        }
        const mods = g[gkey(S.GLOBAL_KEYS.modules)];
        S.globalOff = new Set(mods && typeof mods === 'object' ? Object.keys(mods).filter((k) => mods[k] === false && k !== 'suite') : []);
        return true;
      },
      filter: (name) => name === 'suite' || !S.globalOff.has(name),
    }).catch((e) => { try { console.error('[OGX Suite/loader] boot failed', e); } catch (x) { /* ignore */ } });
  } catch (e) {
    try { console.error('[OGX Suite/loader]', e); } catch (x) { /* ignore */ }
  }
})(window.OGX);
