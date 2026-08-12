#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUN_ID=${SECRET_SCAN_RUN_ID:?Set SECRET_SCAN_RUN_ID to the structurally redacted scan run ID.}
REPORT_DIR="$ROOT_DIR/runtime/secret-scan/$RUN_ID"
MANIFEST="$REPORT_DIR/canonical-inventory.08a1b.sanitized.json"
REPORTS='worktree reachable-git-history runtime memory observability deliverables apps-frontend-dist apps-generated-site-dist apps-desktop-resources'
SOURCE_ARGS=''
for report in $REPORTS; do
  path="$REPORT_DIR/$report.gitleaks.json"
  if [ ! -f "$path" ]; then printf '%s\n' "Missing sanitized report: $path" >&2; exit 2; fi
  SOURCE_ARGS="$SOURCE_ARGS --source-report $path"
done
config_sha=$(shasum -a 256 "$ROOT_DIR/.gitleaks.toml" | awk '{print $1}')
commit_boundary=$(git -C "$ROOT_DIR" rev-parse HEAD)
# shellcheck disable=SC2086
node "$ROOT_DIR/scripts/reconcile-secret-findings.mjs" $SOURCE_ARGS --output-json "$MANIFEST" --output-markdown "$ROOT_DIR/docs/production-readiness/evidence/08a-finding-reconciliation.md" --run-id "$RUN_ID" --scanner-version-or-digest "zricethezav/gitleaks@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9" --scanner-config-sha256 "$config_sha" --input-root worktree --input-root reachable-git-history --input-root runtime --input-root memory --input-root observability --input-root deliverables --input-root apps/frontend/dist --input-root apps/generated-site/dist --output-root runtime/secret-scan --commit-boundary "$commit_boundary"
# shellcheck disable=SC2086
node "$ROOT_DIR/scripts/verify-08a-reconciliation.mjs" $SOURCE_ARGS --manifest "$MANIFEST"
# shellcheck disable=SC2086
node "$ROOT_DIR/scripts/build-08a1b-evidence.mjs" $SOURCE_ARGS --manifest "$MANIFEST" --baseline-history-report "$ROOT_DIR/runtime/secret-scan/08a-manual-20260810/reachable-git-history.gitleaks.json" --scan-summary "$REPORT_DIR/summary.jsonl" --output-count-bridge "$ROOT_DIR/docs/production-readiness/evidence/08a-scan-count-bridge.md" --output-owner-action-inventory "$ROOT_DIR/docs/production-readiness/evidence/08a-owner-action-inventory.md"
