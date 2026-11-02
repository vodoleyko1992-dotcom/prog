'use strict';
// Builds the Tampermonkey/Violentmonkey userscript of «OgameX Suite» from the assembled extension (ogx/ogamex-suite).
//   node tools/build-userscript.js <suiteDir> <out.user.js>
// Layout of the result:
//   1. MAIN-world page hook (shared/main/page-hook.js) runs at document-start. It is idempotent and only relays
//      OgameX endpoints when meta[name="ogame-version"] exists, so it is harmless on other sites.
//   2. Every isolated-world content script of the manifest, in manifest order, each in its own function scope,
//      runs after DOMContentLoaded and only when the page looks like OgameX or GALAXYZ/2Moons (cheap pre-check: meta
//      ogame-version, or meta generator GALAXYZ/2Moons on /game.php, plus a planet list; OGX.boot then runs the
//      full detection OGX.page.isOgx). With @grant none there is no chrome.storage: the core falls back to
//      localStorage, the diagnostic journal to page-origin IndexedDB, and all CSS is injected by the modules via
//      <style> tags (ctx.css), so no extension resources are needed.
const fs = require('fs');
const path = require('path');

const [suiteDir, outFile] = process.argv.slice(2);
if (!suiteDir || !outFile) { console.error('usage: build-userscript.js <suiteDir> <out.user.js>'); process.exit(2); }
const m = JSON.parse(fs.readFileSync(path.join(suiteDir, 'manifest.json'), 'utf8'));
const main = m.content_scripts.find((cs) => cs.world === 'MAIN');
const iso = m.content_scripts.find((cs) => cs.world !== 'MAIN');
if (iso.css && iso.css.length) { console.error('build-userscript: manifest CSS files are not supported (inject CSS via ctx.css)'); process.exit(1); }
const read = (f) => fs.readFileSync(path.join(suiteDir, f), 'utf8').replace(/^﻿/, '');
const wrap = (f) => `// ---------------------------------------------------------------- ${f}\n` +
  `try { (function () {\n${read(f)}\n}).call(window); } catch (e) { try { console.error('[OGX Suite/userscript] ${f}', e); } catch (x) { /* ignore */ } }\n`;

const header = `// ==UserScript==
// @name         OgameX Suite
// @namespace    ogamex-suite@ogx.local
// @version      ${m.version_name ? m.version_name.replace(/\s+/g, '-') : m.version}
// @description  ${m.description}
// @author       OgameX Suite
// @match        *://*/*
// @exclude      *://*.ogame.gameforge.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==
/* Сборка из ogx/ogamex-suite (manifest ${m.version}). Скрипт работает на любом домене, но включается только на страницах
 * OgameX или GALAXYZ/2Moons (meta ogame-version или meta generator GALAXYZ на game.php + список планет). Чтобы ограничить его своим сервером, замените
 * строку @match выше, например: // @match http://192.168.1.10:8080/*  */
`;

let out = header;
out += '(function () {\n  \'use strict\';\n';
out += '  if (window.top !== window.self) return;\n';
out += '  if (/(^|\\.)ogame\\.gameforge\\.com$/i.test(location.hostname)) return;\n';
out += '  // 1) page hook (document-start)\n';
for (const f of main.js) out += wrap(f);
out += '  // 2) core + modules + loader (document-end), only on OgameX pages\n';
out += '  function ogxSuiteStart() {\n';
out += '    try {\n';
out += '      var gen = document.querySelector(\'meta[name="generator"]\');\n';
out += '      var gz = !!gen && /^(GALAXYZ|2Moons)\\b/i.test(gen.getAttribute(\'content\') || \'\') && /\\/game\\.php$/i.test(location.pathname);\n';
out += '      if (!gz && !document.querySelector(\'meta[name="ogame-version"]\')) return;\n';
out += '      if (!document.querySelector(\'#planetList\') && !document.querySelector(\'#planetSelector\')) return;\n';
out += '    } catch (e) { return; }\n';
out += '    if (window.__ogxSuiteUserscript) return;\n';
out += '    window.__ogxSuiteUserscript = true;\n';
for (const f of iso.js) out += wrap(f);
out += '  }\n';
out += '  if (document.readyState === \'loading\') document.addEventListener(\'DOMContentLoaded\', ogxSuiteStart, { once: true });\n';
out += '  else ogxSuiteStart();\n';
out += '})();\n';
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
console.log(`userscript: ${outFile} (${main.js.length + iso.js.length} files, ${out.length} bytes)`);
