#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUN_ID=${SECRET_SCAN_RUN_ID:?Set SECRET_SCAN_RUN_ID to the validated 08A1B scan run ID.}
MANIFEST="$ROOT_DIR/runtime/secret-scan/$RUN_ID/canonical-inventory.08a1b.sanitized.json"
AUTHORITY_RECORDS="$ROOT_DIR/docs/production-readiness/evidence/08a-owner-authority-records.sanitized.json"
REPOSITORY_FACTS="$ROOT_DIR/docs/production-readiness/evidence/08a1c-repository-facts.sanitized.json"
BASELINE_MANIFEST="$ROOT_DIR/runtime/secret-scan/20260811T122836Z/canonical-inventory.08a1b.sanitized.json"

if [ ! -f "$MANIFEST" ]; then printf '%s\n' "Missing validated 08A1B manifest: $MANIFEST" >&2; exit 2; fi

node "$ROOT_DIR/scripts/discover-08a1c-repository-facts.mjs" \
  --repository-root "$ROOT_DIR" \
  --source-manifest "$MANIFEST" \
  --reviewed-at "$(node -e "process.stdout.write(require(process.argv[1]).reviewed_at)" "$AUTHORITY_RECORDS")" \
  --output "$REPOSITORY_FACTS"

node "$ROOT_DIR/scripts/build-08a1c-evidence.mjs" \
  --source-manifest "$MANIFEST" \
  --authority-records "$AUTHORITY_RECORDS" \
  --repository-facts "$REPOSITORY_FACTS" \
  --baseline-manifest "$BASELINE_MANIFEST" \
  --output-resolution "$ROOT_DIR/docs/production-readiness/evidence/08a-owner-dispositions.sanitized.json" \
  --output-authority-matrix "$ROOT_DIR/docs/production-readiness/evidence/08a-owner-authority-matrix.md" \
  --output-dispositions "$ROOT_DIR/docs/production-readiness/evidence/08a-owner-dispositions.md" \
  --output-action-inventory "$ROOT_DIR/docs/production-readiness/evidence/08a-owner-action-inventory.md" \
  --output-policy "$ROOT_DIR/docs/production-readiness/evidence/08a1c-evidence-path-policy.md" \
  --output-count-bridge "$ROOT_DIR/docs/production-readiness/evidence/08a1c-count-bridge.md" \
  --output-reconciliation "$ROOT_DIR/docs/production-readiness/evidence/08a-finding-reconciliation.md"

node "$ROOT_DIR/scripts/verify-08a1c-owner-dispositions.mjs" \
  --source-manifest "$MANIFEST" \
  --authority-records "$AUTHORITY_RECORDS" \
  --repository-facts "$REPOSITORY_FACTS" \
  --resolution "$ROOT_DIR/docs/production-readiness/evidence/08a-owner-dispositions.sanitized.json"
