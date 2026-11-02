'use strict';
// Test helper owned by core: builds a throw-away MV3 extension that contains the real shared core
// (shared/main/page-hook.js + shared/core/*.js in numeric order), optional test modules and a loader.
// The manifest has the same shape as DESIGN 1.2, so the harness runs it like ogamex-live / ogamex-infinity.
//   const { coreExt } = require('./core-ext');
//   const env = await T.launch({ ext: coreExt({ modules: { probe: 'OGX.module({...})' } }), scenario: 'vega' });
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'shared');

function coreFiles() {
  return fs.readdirSync(path.join(SHARED, 'core')).filter((f) => /^\d\d-.*\.js$/.test(f)).sort().map((f) => 'shared/core/' + f);
}

/**
 * name: extension name used for data-ogx-<name> and the isolated world ('live' or 'infinity' to look like the real ones).
 * modules: { moduleName: sourceCode } (each becomes modules/<name>/<name>.js, loaded in this order).
 * boot: loader source override; default `OGX.boot({ ext: name, modules: [...] })`.
 */
function coreExt({ name = 'live', modules = {}, boot } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ogx-core-${name}-`));
  fs.cpSync(SHARED, path.join(dir, 'shared'), { recursive: true });
  const modFiles = [];
  for (const [m, src] of Object.entries(modules)) {
    fs.mkdirSync(path.join(dir, 'modules', m), { recursive: true });
    fs.writeFileSync(path.join(dir, 'modules', m, m + '.js'), src);
    modFiles.push(`modules/${m}/${m}.js`);
  }
  fs.writeFileSync(path.join(dir, 'loader.js'), boot || `OGX.boot({ ext: ${JSON.stringify(name)}, modules: ${JSON.stringify(Object.keys(modules))} });\n`);
  // Background: the shared diagnostic journal store (importScripts in the Chrome service worker, "scripts" in Firefox) + ping.
  fs.writeFileSync(path.join(dir, 'background.js'),
    "try { if (typeof importScripts === 'function' && !self.OGXDiagBG) importScripts('shared/core/21-diaglib.js', 'shared/background/diag-bg.js'); } catch (e) { console.warn('diag-bg', e); }\n" +
    "chrome.runtime.onMessage.addListener((msg, sender, reply) => { if (msg && msg.type === 'ogx:ping') { reply({ ok: true }); } return false; });\n");
  // Popup with the shared "Логи для разбора" panel (auto-mounts into #ogx-diag-panel).
  fs.mkdirSync(path.join(dir, 'popup'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'popup', 'popup.html'), '<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="../shared/popup/diag-panel.css"></head>' +
    '<body style="margin:0;background:#0d1014"><div id="ogx-diag-panel"></div><script src="../shared/core/21-diaglib.js"></script><script src="../shared/popup/diag-panel.js"></script></body></html>\n');
  const manifest = {
    manifest_version: 3,
    name: `OGX core test (${name})`,
    version: '0.1.0',
    permissions: ['storage', 'unlimitedStorage'],
    background: { service_worker: 'background.js', scripts: ['shared/core/21-diaglib.js', 'shared/background/diag-bg.js', 'background.js'] },
    action: { default_popup: 'popup/popup.html' },
    content_scripts: [
      { matches: ['http://*/*', 'https://*/*'], exclude_matches: ['*://*.ogame.gameforge.com/*'], js: ['shared/main/page-hook.js'], run_at: 'document_start', world: 'MAIN', all_frames: false },
      { matches: ['http://*/*', 'https://*/*'], exclude_matches: ['*://*.ogame.gameforge.com/*'], js: [...coreFiles(), 'shared/popup/diag-panel.js', ...modFiles, 'loader.js'], run_at: 'document_end', all_frames: false },
    ],
    browser_specific_settings: { gecko: { id: `ogx-core-${name}@ogx.local`, strict_min_version: '128.0' } },
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { name, dir };
}

/** Loads the non-DOM core files (00..10) into a fresh Node context: for pure calc/format tests without a browser. */
function nodeCore() {
  const vm = require('vm');
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, URL, URLSearchParams, structuredClone };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of coreFiles()) {
    if (!/\/(0\d|10)-/.test(f)) continue;
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  const OGX = sandbox.OGX;
  OGX.time.serverNow = () => Date.now();
  return OGX;
}

module.exports = { coreExt, coreFiles, nodeCore, ROOT };
