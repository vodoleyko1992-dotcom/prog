#!/usr/bin/env bash
# Wrapper around tests/run-all.js: bash tests/run-all.sh [filter]
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/run-all.js" "$@"
