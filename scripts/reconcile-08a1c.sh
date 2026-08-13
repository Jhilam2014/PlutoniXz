#!/usr/bin/env sh
set -eu

# R4 is an immutable-R2 validation flow. It never rescans candidates, reads an
# environment file, or issues an external/provider action.
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
EVIDENCE_DIR="$ROOT_DIR/docs/production-readiness/evidence"
INVENTORY="$EVIDENCE_DIR/08a1b-r2-logical-credential-inventory.sanitized.json"

node "$ROOT_DIR/scripts/verify-08a1b-r2-reconstruction.mjs" --inventory "$INVENTORY" --require-pass
node "$ROOT_DIR/scripts/verify-08a1a-owner-evidence.mjs"
node "$ROOT_DIR/scripts/verify-08a1c-r4-reconstruction.mjs" \
  --source-inventory "$INVENTORY" \
  --resolution "$EVIDENCE_DIR/08a1c-r4-dispositions.sanitized.json" \
  --actions "$EVIDENCE_DIR/08a1c-external-r4/external-action-manifest.sanitized.json" \
  --bridge "$EVIDENCE_DIR/08a1c-r4-supersession-bridge.sanitized.json"
