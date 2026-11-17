#!/usr/bin/env bash
# Сборка: Chrome — manifest.json как есть (service_worker); Firefox — отдельный zip
# (background.scripts + gecko id). Один manifest на оба браузера Chrome показывает с ошибкой
# «'background.scripts' requires manifest version of 2 or lower» (жалоба John 17.11).
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT=${1:-../builds}; mkdir -p "$OUT"
FILES="manifest.json background.js src icons data README-RU.md CHANGELOG.md"
rm -f "$OUT/l2mobi-bot-v$V.zip" "$OUT/l2mobi-bot-v$V-firefox.zip"
zip -qr "$OUT/l2mobi-bot-v$V.zip" $FILES
T=$(mktemp -d); cp -r $FILES "$T/"
python3 - "$T/manifest.json" <<'PY'
import json,sys
p=sys.argv[1]; m=json.load(open(p,encoding='utf-8'))
m['background']={'scripts':['background.js']}
m['browser_specific_settings']={'gecko':{'id':'l2mobi-bot@local','strict_min_version':'121.0'}}
json.dump(m,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
PY
(cd "$T" && zip -qr - $FILES) > "$OUT/l2mobi-bot-v$V-firefox.zip"
rm -rf "$T"
ls -la "$OUT"/l2mobi-bot-v$V*.zip
