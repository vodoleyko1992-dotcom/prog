/* ogamex-suite/background.js — service worker (Chrome) / background script (Firefox) of «OgameX Suite». Owner: integration.
 * Hosts the diagnostic journal store (shared/background/diag-bg.js, IndexedDB 'ogx-diag' of the extension origin) and
 * answers {type:'ogx:ping'} (test harness, content scripts). Chrome loads the store with importScripts; Firefox lists
 * shared/core/21-diaglib.js and shared/background/diag-bg.js before this file in manifest background.scripts. */
try {
  if (typeof importScripts === 'function' && !self.OGXDiagBG) importScripts('shared/core/21-diaglib.js', 'shared/background/diag-bg.js');
} catch (e) { console.warn('[OGX Suite/background] diag store', e); }

(function () {
  'use strict';
  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : null);
  if (!api || !api.onMessage) return;
  api.onMessage.addListener((msg, sender, reply) => {
    if (msg && msg.type === 'ogx:ping') {
      let version = null;
      try { version = api.getManifest().version; } catch (e) { /* ignore */ }
      reply({ ok: true, ext: 'suite', version, diag: !!self.OGXDiagBG });
      return false;
    }
    return false; // ogx:diag:* are answered by diag-bg.js
  });
})();
