#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUN_ID=${SECRET_SCAN_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}
REPORT_DIR="$ROOT_DIR/runtime/secret-scan/$RUN_ID"
CONFIG_SHA=$(shasum -a 256 "$ROOT_DIR/.gitleaks.toml" | awk '{print $1}')
COMMIT_BOUNDARY=$(git -C "$ROOT_DIR" rev-parse HEAD)

mkdir -p "$REPORT_DIR"
node "$ROOT_DIR/scripts/reconstruct-08a1b-r2.mjs" \
  --live-scan \
  --repository-root "$ROOT_DIR" \
  --run-id "$RUN_ID" \
  --reviewed-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --scanner-config-sha256 "$CONFIG_SHA" \
  --commit-boundary "$COMMIT_BOUNDARY" \
  --report-directory "$REPORT_DIR" \
  --output-inventory "$REPORT_DIR/logical-credential-inventory.08a1b-r2.sanitized.json" \
  --output-logical-inventory-doc "$ROOT_DIR/docs/production-readiness/evidence/08a1b-r2-logical-credential-inventory.sanitized.json" \
  --output-provenance "$ROOT_DIR/docs/production-readiness/evidence/08a1b-r2-candidate-provenance.sanitized.json" \
  --output-equivalence "$ROOT_DIR/docs/production-readiness/evidence/08a1b-r2-equivalence-classes.sanitized.json" \
  --output-count-bridge "$ROOT_DIR/docs/production-readiness/evidence/08a1b-r2-count-and-provenance-bridge.md" \
  --output-reconciliation "$ROOT_DIR/docs/production-readiness/evidence/08a-finding-reconciliation.md" \
  --output-action-inventory "$ROOT_DIR/docs/production-readiness/evidence/08a-owner-action-inventory.md"
node "$ROOT_DIR/scripts/verify-08a1b-r2-reconstruction.mjs" \
  --inventory "$REPORT_DIR/logical-credential-inventory.08a1b-r2.sanitized.json" \
  --require-pass
