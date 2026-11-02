#!/usr/bin/env bash
# Assemble the ONE browser extension «OgameX Suite» (ogx/ogamex-suite/) and sanity-check it.
#   ogx/shared/                      -> ogamex-suite/shared/            (core, page hook, background store, diag panel)
#   ogx/ogamex-live/modules/<m>/     -> ogamex-suite/modules/live/<m>/
#   ogx/ogamex-infinity/modules/<m>/ -> ogamex-suite/modules/infinity/<m>/
#   ogx/ogamex-bot/modules/<m>/      -> ogamex-suite/modules/bot/<m>/   (when that tree exists; extension point)
# The suite's own files (manifest.json, loader.js, background.js, suite/, popup/, options/, icons/) live in ogamex-suite/
# and are never overwritten. The generated parts (shared/, modules/) are git-ignored copies: edit the sources.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUITE="$ROOT/ogamex-suite"
mkdir -p "$ROOT/shared" "$SUITE"
# The module source trees are no longer extensions of their own: drop stale core copies from older layouts.
rm -rf "$ROOT/ogamex-live/shared" "$ROOT/ogamex-infinity/shared"
# Parallel test runs share this tree: serialize syncs and swap the generated dirs in with renames,
# so a running test never sees an empty shared/ or modules/.
exec 9>"$ROOT/.sync.lock"; flock 9
TMP="$SUITE/.gen.$$"; rm -rf "$TMP"
mkdir -p "$TMP/shared" "$TMP/modules/live" "$TMP/modules/infinity" "$TMP/modules/bot"
cp -R "$ROOT/shared/." "$TMP/shared/"
cp -R "$ROOT/ogamex-live/modules/." "$TMP/modules/live/"
cp -R "$ROOT/ogamex-infinity/modules/." "$TMP/modules/infinity/"
if [ -d "$ROOT/ogamex-bot/modules" ]; then cp -R "$ROOT/ogamex-bot/modules/." "$TMP/modules/bot/"; fi
for d in shared modules; do
  if [ -d "$SUITE/$d" ]; then mv "$SUITE/$d" "$TMP/old-$d"; fi
  mv "$TMP/$d" "$SUITE/$d"
done
rm -rf "$TMP"
# Syntax check every JS file (node can parse browser scripts that do not use DOM at load time).
find "$ROOT/shared" "$ROOT/ogamex-live" "$ROOT/ogamex-infinity" "$SUITE" -name '*.js' -not -path '*/node_modules/*' -print0 \
  | xargs -0 -r -n1 node --check
# Manifest: valid JSON, every referenced file exists, script order = core (numeric) + suite registry + hub + the
# section lists of suite/00-suite.js in order + loader.js last.
node -e '
  const fs=require("fs"),path=require("path"),vm=require("vm");let bad=0;
  const err=(...a)=>{console.error("sync:",...a);bad++;};
  const dir=process.argv[1], mfPath=path.join(dir,"manifest.json");
  let m; try { m=JSON.parse(fs.readFileSync(mfPath,"utf8")); } catch(e) { console.error("sync: manifest.json:",e.message); process.exit(1); }
  if (m.manifest_version!==3) err("manifest_version must be 3");
  // specs/DESIGN.md:128 / CORE_API.md §Diagnostics: storage + unlimitedStorage (no install prompt in Chrome or Firefox; without it
  // chrome.storage.local is capped at 10 MB and the bot state / galaxy cache / spy reports stop persisting silently)
  if (JSON.stringify(m.permissions)!==JSON.stringify(["storage","unlimitedStorage"])) err("permissions must be exactly [\"storage\",\"unlimitedStorage\"]");
  if (!(m.browser_specific_settings&&m.browser_specific_settings.gecko&&m.browser_specific_settings.gecko.id)) err("gecko id missing");
  const files=[];
  for (const cs of m.content_scripts||[]) files.push(...(cs.js||[]),...(cs.css||[]));
  const bg=m.background||{};
  files.push(...[bg.service_worker,...(bg.scripts||[]),m.action&&m.action.default_popup,m.options_ui&&m.options_ui.page].filter(Boolean));
  files.push(...Object.values(m.icons||{}),...Object.values((m.action&&m.action.default_icon)||{}));
  for (const f of files) if (!fs.existsSync(path.join(dir,f))) err("missing",f);
  // files referenced by the popup / options pages
  for (const page of [m.action&&m.action.default_popup,m.options_ui&&m.options_ui.page].filter(Boolean)) {
    const html=fs.readFileSync(path.join(dir,page),"utf8");
    for (const [,ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!fs.existsSync(path.join(dir,path.dirname(page),ref))) err("missing (from "+page+")",ref);
  }
  // content script order
  const iso=(m.content_scripts||[]).find((cs)=>cs.world!=="MAIN");
  const main=(m.content_scripts||[]).find((cs)=>cs.world==="MAIN");
  if (!main||JSON.stringify(main.js)!==JSON.stringify(["shared/main/page-hook.js"])||main.run_at!=="document_start") err("MAIN-world entry must be shared/main/page-hook.js at document_start");
  const sb={console}; sb.window=sb; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(dir,"suite/00-suite.js"),"utf8"),sb);
  const S=sb.OGX.suite;
  const core=fs.readdirSync(path.join(dir,"shared/core")).filter((f)=>/^\d\d-.*\.js$/.test(f)).sort().map((f)=>"shared/core/"+f);
  const want=[...core,"shared/popup/diag-panel.js","suite/00-suite.js","suite/hub.js"];
  for (const sec of S.order) for (const n of S.sections[sec].modules) want.push(`modules/${sec}/${n}/${n}.js`);
  want.push("loader.js");
  if (!iso||JSON.stringify(iso.js)!==JSON.stringify(want)) {
    err("content_scripts[isolated].js differs from the expected order");
    const have=iso?iso.js:[]; const n=Math.max(have.length,want.length);
    for (let i=0;i<n;i++) if (have[i]!==want[i]) console.error("   #"+i+" manifest:",have[i]||"-","expected:",want[i]||"-");
  }
  for (const cs of m.content_scripts||[]) {
    if (JSON.stringify(cs.matches)!==JSON.stringify(["http://*/*","https://*/*"])) err("matches must be http+https on all hosts");
    if (!(cs.exclude_matches||[]).includes("*://*.ogame.gameforge.com/*")) err("gameforge must be excluded");
  }
  // every module directory that was copied is listed (no dead code shipped)
  for (const sec of ["live","infinity","bot"]) {
    const d=path.join(dir,"modules",sec); if (!fs.existsSync(d)) continue;
    for (const n of fs.readdirSync(d)) if (!S.sections[sec].modules.includes(n)) err(`module ${sec}/${n} is copied but not listed in suite/00-suite.js`);
  }
  process.exit(bad?1:0);' "$SUITE"
echo "sync ok"
