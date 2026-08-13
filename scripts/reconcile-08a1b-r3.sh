#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
EVIDENCE_DIR="$ROOT_DIR/docs/production-readiness/evidence"
REVIEWED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

node "$ROOT_DIR/scripts/run-08a1b-r3-semantic-triage.mjs" \
  --repository-root "$ROOT_DIR" \
  --inventory "$EVIDENCE_DIR/08a1b-r2-logical-credential-inventory.sanitized.json" \
  --reviewed-at "$REVIEWED_AT" \
  --output-classification "$EVIDENCE_DIR/08a1b-r3-semantic-classification.sanitized.json" \
  --output-policy "$ROOT_DIR/docs/evidence/08a1b-r3-semantic-policy.md" \
  --output-policy-secondary "$EVIDENCE_DIR/08a1b-r3-semantic-policy.md" \
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

node "$ROOT_DIR/scripts/verify-08a1b-r3-semantic-triage.mjs" \
  --inventory "$EVIDENCE_DIR/08a1b-r2-logical-credential-inventory.sanitized.json" \
  --classification "$EVIDENCE_DIR/08a1b-r3-semantic-classification.sanitized.json" \
  --supersession "$EVIDENCE_DIR/08a1c-external-r4/current-semantic-triage-status.sanitized.json" \
  --current-manifest "$EVIDENCE_DIR/08a1c-external-r4/external-action-manifest.sanitized.json" \
  --current-authority "$EVIDENCE_DIR/08a-owner-authority-records.sanitized.json" \
  --artifact-gate "$EVIDENCE_DIR/08a1d-r3-semantic-gate.sanitized.json"
