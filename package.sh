#!/usr/bin/env bash
# Packages «OgameX Suite» into dist/:
#   ogamex-suite-<ver>-chrome.zip    Chrome / Edge / Opera / Яндекс (MV3, background.service_worker)
#   ogamex-suite-<ver>-firefox.zip   Firefox 128+ (MV3, background.scripts + browser_specific_settings.gecko)
#   ogamex-suite.user.js             Tampermonkey / Violentmonkey userscript (@grant none, localStorage)
#   ogamex-suite-<ver>-src.zip       source tree: every tracked + untracked, not ignored file (git ls-files -co
#                                    --exclude-standard), so no dist/, node_modules/, tests/out/ or generated copies
#   SHA256SUMS
# Usage: bash package.sh            (runs tests/sync.sh first; the tests themselves: bash tests/run-all.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SUITE="$ROOT/ogamex-suite"
DIST="$ROOT/dist"
BUILD="$DIST/.build"

bash "$ROOT/tests/sync.sh"

VERSION="$(node -p 'require(process.argv[1]).version' "$SUITE/manifest.json")"
VNAME="$(node -p 'require(process.argv[1]).version_name || ""' "$SUITE/manifest.json")"
[ "$VERSION" = "0.3.3" ] || { echo "package: manifest version is $VERSION, expected 0.3.3" >&2; exit 1; }
[ "$VNAME" = "0.3.3 beta" ] || { echo "package: version_name is '$VNAME', expected '0.3.3 beta'" >&2; exit 1; }
TAG="${VERSION}-beta"

rm -rf "$DIST"
mkdir -p "$BUILD"

stage() { # stage <browser>
  local dir="$BUILD/$1"
  mkdir -p "$dir"
  # only what the extension needs at runtime (no sources of other trees, no tests, no dot files)
  (cd "$SUITE" && tar --exclude='.*' --exclude='*.map' -cf - manifest.json background.js loader.js suite popup options icons shared modules) | (cd "$dir" && tar -xf -)
  node -e '
    const fs=require("fs"), p=process.argv[1], b=process.argv[2];
    const m=JSON.parse(fs.readFileSync(p,"utf8"));
    if (b==="chrome") {
      // Chrome: service worker only (it importScripts the diag store); no Firefox-only keys -> no warnings.
      m.background={ service_worker: m.background.service_worker };
      delete m.browser_specific_settings;
    } else {
      // Firefox: event page with the same scripts; Firefox does not run MV3 service workers.
      m.background={ scripts: m.background.scripts };
      delete m.version_name;   // Chrome-only key: Firefox warns «unexpected property»
    }
    fs.writeFileSync(p, JSON.stringify(m,null,2)+"\n");' "$dir/manifest.json" "$1"
  find "$dir" -name '*.js' -print0 | xargs -0 -r -n1 node --check
  local zipf="$DIST/ogamex-suite-$TAG-$1.zip"
  (cd "$dir" && zip -q -X -r "$zipf" .)
  echo "package: $zipf ($(stat -c %s "$zipf") bytes)"
}
stage chrome
stage firefox

node "$ROOT/tools/build-userscript.js" "$SUITE" "$DIST/ogamex-suite.user.js"
node --check "$DIST/ogamex-suite.user.js"

rm -rf "$BUILD"
SRCZIP="$DIST/ogamex-suite-$VERSION-src.zip"
(cd "$ROOT" && git ls-files -co --exclude-standard -z | xargs -0 zip -q -X "$SRCZIP")
echo "package: $SRCZIP ($(stat -c %s "$SRCZIP") bytes)"
(cd "$DIST" && sha256sum ogamex-suite-*.zip ogamex-suite.user.js > SHA256SUMS)
echo "package ok: $DIST"
ls -l "$DIST"
