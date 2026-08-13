#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUN_ID=${SECRET_SCAN_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}
REVIEWED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec node "$ROOT_DIR/scripts/publish-08a1b-r3-semantic-repair.mjs" \
  --repository-root "$ROOT_DIR" \
  --run-id "r3-semantic-repair-$RUN_ID" \
  --reviewed-at "$REVIEWED_AT"
