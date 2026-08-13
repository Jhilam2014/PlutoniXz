#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
EVIDENCE_DIR="$ROOT_DIR/docs/production-readiness/evidence"
RUN_ID=${SECRET_SCAN_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}
REVIEWED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

node "$ROOT_DIR/scripts/reconcile-08a1b-r2-r3-atomic.mjs" \
  --repository-root "$ROOT_DIR" \
  --run-id "$RUN_ID" \
  --reviewed-at "$REVIEWED_AT" \
  --frozen-inventory "$EVIDENCE_DIR/08a1b-r2-logical-credential-inventory.sanitized.json" \
  --archive-directory "$EVIDENCE_DIR/08a1b-r3-audit" \
  --archive-current "$EVIDENCE_DIR/08a1b-r3-semantic-classification.sanitized.json" \
  --archive-current "$EVIDENCE_DIR/08a1c-external-r4/current-semantic-triage-status.sanitized.json" \
  --archive-current "$EVIDENCE_DIR/08a-owner-authority-records.sanitized.json" \
  --archive-current "$EVIDENCE_DIR/08a-owner-dispositions.sanitized.json" \
  --output-inventory "$EVIDENCE_DIR/08a1b-r2-logical-credential-inventory.sanitized.json" \
  --output-provenance "$EVIDENCE_DIR/08a1b-r2-candidate-provenance.sanitized.json" \
  --output-equivalence "$EVIDENCE_DIR/08a1b-r2-equivalence-classes.sanitized.json" \
  --output-count-bridge "$EVIDENCE_DIR/08a1b-r2-count-and-provenance-bridge.md" \
  --output-reconciliation "$EVIDENCE_DIR/08a-finding-reconciliation.md" \
  --output-action-inventory "$EVIDENCE_DIR/08a-owner-action-inventory.md" \
  --output-classification "$EVIDENCE_DIR/08a1b-r3-semantic-classification.sanitized.json" \
  --output-policy "$EVIDENCE_DIR/08a1b-r3-semantic-policy.md" \
  --output-precision "$EVIDENCE_DIR/08a1b-r3-rule-precision-summary.md" \
  --output-summary "$EVIDENCE_DIR/08a1b-r3-semantic-classification.md"

node "$ROOT_DIR/scripts/build-08a1c-r4-semantic-supersession.mjs" \
  --classification "$EVIDENCE_DIR/08a1b-r3-semantic-classification.sanitized.json" \
  --r4-manifest "$EVIDENCE_DIR/08a1c-external-r4/external-action-manifest.r4-audit.sanitized.json" \
  --r4-resolution "$EVIDENCE_DIR/08a1c-r4-dispositions.r4-audit.sanitized.json" \
  --output-status "$EVIDENCE_DIR/08a1c-external-r4/current-semantic-triage-status.sanitized.json" \
  --output-projection "$EVIDENCE_DIR/08a-owner-authority-records.current-semantic.sanitized.json" \
  --output-dispositions "$EVIDENCE_DIR/08a-owner-dispositions.current-semantic.sanitized.json" \
  --output-markdown "$EVIDENCE_DIR/08a1b-r3-r4-queue-supersession.md"

node "$ROOT_DIR/scripts/materialize-08a1c-r4-semantic-status.mjs" \
  --semantic-status "$EVIDENCE_DIR/08a1c-external-r4/current-semantic-triage-status.sanitized.json" \
  --current-projection "$EVIDENCE_DIR/08a-owner-authority-records.current-semantic.sanitized.json" \
  --current-dispositions "$EVIDENCE_DIR/08a-owner-dispositions.current-semantic.sanitized.json" \
  --manifest "$EVIDENCE_DIR/08a1c-external-r4/external-action-manifest.sanitized.json" \
  --intake "$EVIDENCE_DIR/08a1c-external-r4/evidence-intake.sanitized.json" \
  --authority-projection "$EVIDENCE_DIR/08a-owner-authority-records.sanitized.json" \
  --r4-dispositions "$EVIDENCE_DIR/08a1c-r4-dispositions.sanitized.json"

node "$ROOT_DIR/scripts/build-08a1d-r3-semantic-gate.mjs" \
  --classification "$EVIDENCE_DIR/08a1b-r3-semantic-classification.sanitized.json" \
  --output "$EVIDENCE_DIR/08a1d-r3-semantic-gate.sanitized.json"

node "$ROOT_DIR/scripts/verify-08a1b-r3-semantic-triage.mjs" \
  --inventory "$EVIDENCE_DIR/08a1b-r2-logical-credential-inventory.sanitized.json" \
  --classification "$EVIDENCE_DIR/08a1b-r3-semantic-classification.sanitized.json" \
  --supersession "$EVIDENCE_DIR/08a1c-external-r4/current-semantic-triage-status.sanitized.json" \
  --current-manifest "$EVIDENCE_DIR/08a1c-external-r4/external-action-manifest.sanitized.json" \
  --current-authority "$EVIDENCE_DIR/08a-owner-authority-records.sanitized.json" \
  --artifact-gate "$EVIDENCE_DIR/08a1d-r3-semantic-gate.sanitized.json"
