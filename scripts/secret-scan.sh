#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCANNER_IMAGE=${GITLEAKS_IMAGE:-"zricethezav/gitleaks@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9"}
REPORT_ROOT=${SECRET_SCAN_REPORT_DIR:-"$ROOT_DIR/runtime/secret-scan"}
SCAN_TIMEOUT_SECONDS=${SECRET_SCAN_TIMEOUT_SECONDS:-900}
SCAN_MAX_TARGET_MEGABYTES=${SECRET_SCAN_MAX_TARGET_MEGABYTES:-32}
SCAN_MEMORY_LIMIT=${SECRET_SCAN_MEMORY_LIMIT:-2g}
SCAN_CPUS=${SECRET_SCAN_CPUS:-2}

usage() {
  printf '%s\n' "Usage: sh scripts/secret-scan.sh scan|verify-fixture"
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    printf '%s\n' "Secret scan requires Docker and the pinned Gitleaks image." >&2
    exit 2
  fi
}

validate_report_root() {
  # A producing report directory is never an application-input root. The
  # default lives beneath runtime/secret-scan, which is excluded only from the
  # runtime producing scan and is independently checked for redaction.
  case "$REPORT_ROOT" in
    "$ROOT_DIR/runtime/secret-scan"|/tmp/*) return 0 ;;
    "$ROOT_DIR"/runtime/*|"$ROOT_DIR"/memory/*|"$ROOT_DIR"/observability/*|"$ROOT_DIR"/deliverables/*|"$ROOT_DIR"/apps/frontend/dist/*|"$ROOT_DIR"/apps/generated-site/dist/*)
      printf '%s\n' "Secret scan report root is inside an active input root; use runtime/secret-scan or a directory outside scan inputs." >&2
      exit 2 ;;
    *) return 0 ;;
  esac
}

finding_count() {
  if [ ! -f "$1" ]; then
    printf '0'
    return
  fi
  { grep -o '"RuleID"' "$1" 2>/dev/null || true; } | wc -l | tr -d ' '
}

write_empty_report_if_needed() {
  if [ ! -f "$1" ]; then
    printf '%s\n' '[]' > "$1"
  fi
  return 0
}

verify_report_sanitation() {
  report_path=$1
  if ! command -v jq >/dev/null 2>&1; then
    printf '%s\n' "Secret scan requires jq to enforce redacted report fields." >&2
    exit 2
  fi
  if ! jq -e 'type == "array" and all(.[]; (.Secret == "REDACTED") and ((.Match | type) == "string") and (.Match | contains("REDACTED")))' "$report_path" >/dev/null; then
    # The report is generated evidence, not a user artifact. Do not retain a
    # report that failed the structural redaction guard, and never print it.
    rm -f "$report_path"
    printf '%s\n' "Secret scan rejected an unsafe or malformed generated report." >&2
    exit 2
  fi
}

run_scan() {
  scope=$1
  mode=$2
  source_host_path=$3
  source_path=$4
  report_path="$REPORT_DIR/$scope.gitleaks.json"
  started_at=$(date +%s)

  if [ "$mode" = "history" ]; then
    set +e
    docker run --rm \
      --memory="$SCAN_MEMORY_LIMIT" \
      --cpus="$SCAN_CPUS" \
      --pids-limit=256 \
      -v "$ROOT_DIR:/repo:ro" \
      -v "$REPORT_DIR:/reports" \
      "$SCANNER_IMAGE" detect \
      --source /repo \
      --log-opts="--all" \
      --config /repo/.gitleaks.toml \
      --redact=100 \
      --report-format json \
      --report-path "/reports/$scope.gitleaks.json" \
      --max-archive-depth=3 \
      --max-decode-depth=1 \
      --max-target-megabytes="$SCAN_MAX_TARGET_MEGABYTES" \
      --timeout="$SCAN_TIMEOUT_SECONDS" \
      --no-banner \
      --no-color > /dev/null 2>&1
    exit_code=$?
    set -e
  else
    set +e
    docker run --rm \
      --memory="$SCAN_MEMORY_LIMIT" \
      --cpus="$SCAN_CPUS" \
      --pids-limit=256 \
      -v "$ROOT_DIR:/repo:ro" \
      -v "$source_host_path:$source_path:ro" \
      -v "$REPORT_DIR:/reports" \
      "$SCANNER_IMAGE" detect \
      --source "$source_path" \
      --no-git \
      --config /repo/.gitleaks.toml \
      --redact=100 \
      --report-format json \
      --report-path "/reports/$scope.gitleaks.json" \
      --max-archive-depth=3 \
      --max-decode-depth=1 \
      --max-target-megabytes="$SCAN_MAX_TARGET_MEGABYTES" \
      --timeout="$SCAN_TIMEOUT_SECONDS" \
      --no-banner \
      --no-color > /dev/null 2>&1
    exit_code=$?
    set -e
  fi

  write_empty_report_if_needed "$report_path"
  verify_report_sanitation "$report_path"
  completed_at=$(date +%s)
  count=$(finding_count "$report_path")
  status=clean
  if [ "$exit_code" -ne 0 ]; then
    status=findings_or_scan_error
    OVERALL_FAILURE=1
  fi
  printf '{"scope":"%s","status":"%s","exitCode":%s,"durationSeconds":%s,"findingCount":%s,"report":"%s","reportRedacted":true}\n' \
    "$scope" "$status" "$exit_code" "$((completed_at - started_at))" "$count" "$(basename "$report_path")" >> "$REPORT_DIR/summary.jsonl"
}

prepare_worktree_staging() {
  WORKTREE_STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/plutonix-secret-worktree.XXXXXX")
  tracked_and_untracked=$(mktemp "${TMPDIR:-/tmp}/plutonix-secret-paths.XXXXXX")
  git -C "$ROOT_DIR" ls-files --cached --others --exclude-standard \
    | awk '!/^(runtime|memory|observability|deliverables|apps\/frontend\/dist|apps\/generated-site\/dist|apps\/desktop\/resources)(\/|$)/' \
    > "$tracked_and_untracked"
  find "$ROOT_DIR" \
    -path "$ROOT_DIR/.git" -prune -o \
    -type f \( -name '.env' -o -name '.env.*' \) -print \
    | sed "s#^$ROOT_DIR/##" >> "$tracked_and_untracked"
  sort -u "$tracked_and_untracked" \
    | rsync -a --files-from=- "$ROOT_DIR/" "$WORKTREE_STAGING_DIR/"
  rm -f "$tracked_and_untracked"
  return 0
}

prepare_runtime_staging() {
  RUNTIME_STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/plutonix-secret-runtime.XXXXXX")
  # Do not scan prior scanner reports as runtime application input. Their
  # schema is covered by verify_report_sanitation immediately after creation.
  rsync -a --exclude 'secret-scan/' "$ROOT_DIR/runtime/" "$RUNTIME_STAGING_DIR/"
}

inventory_unscannable_large_files() {
  : > "$REPORT_DIR/unscannable-large-files.tsv"
  find "$ROOT_DIR" \
    -path "$ROOT_DIR/.git" -prune -o \
    -type f -size "+${SCAN_MAX_TARGET_MEGABYTES}M" \
    -exec sh -c '
      root=$1
      shift
      for path in "$@"; do
        relative=${path#"$root"/}
        printf "%s\t%s\n" "$relative" "$(stat -f "%z" "$path")"
      done
    ' sh "$ROOT_DIR" {} + >> "$REPORT_DIR/unscannable-large-files.tsv"
  return 0
}

scan_repository() {
  require_docker
  validate_report_root
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  REPORT_DIR="$REPORT_ROOT/$timestamp"
  mkdir -p "$REPORT_DIR"
  : > "$REPORT_DIR/summary.jsonl"
  OVERALL_FAILURE=0
  inventory_unscannable_large_files
  prepare_worktree_staging

  # This temporary context includes current tracked, staged, untracked, and
  # environment files. Docker build contexts are a subset after .dockerignore.
  run_scan worktree directory "$WORKTREE_STAGING_DIR" /worktree
  rm -rf "$WORKTREE_STAGING_DIR"
  run_scan reachable-git-history history '' /repo

  for artifact_root in runtime memory observability deliverables apps/frontend/dist apps/generated-site/dist; do
    if [ -d "$ROOT_DIR/$artifact_root" ]; then
      scope=$(printf '%s' "$artifact_root" | tr '/' '-')
      if [ "$artifact_root" = "runtime" ]; then
        prepare_runtime_staging
        run_scan "$scope" directory "$RUNTIME_STAGING_DIR" /artifact
        rm -rf "$RUNTIME_STAGING_DIR"
      else
        run_scan "$scope" directory "$ROOT_DIR/$artifact_root" /artifact
      fi
    else
      printf '{"scope":"%s","status":"not_present","exitCode":0,"findingCount":0,"report":null,"reportRedacted":true}\n' \
        "$artifact_root" >> "$REPORT_DIR/summary.jsonl"
    fi
  done

  printf '%s\n' "$REPORT_DIR"
  return "$OVERALL_FAILURE"
}

verify_fixture() {
  require_docker
  fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/plutonix-secret-fixture.XXXXXX")
  trap 'rm -rf "$fixture_dir"' EXIT HUP INT TERM
  fake_prefix='plutonix_fake_secret_'
  fake_suffix='0123456789abcdef01234567'
  fake_token="${fake_prefix}${fake_suffix}"
  printf '%s\n' "$fake_token" > "$fixture_dir/fake-token.txt"

  set +e
  docker run --rm \
    -v "$ROOT_DIR:/repo:ro" \
    -v "$fixture_dir:/fixture" \
    "$SCANNER_IMAGE" detect \
    --source /fixture \
    --no-git \
    --config /repo/.gitleaks.toml \
    --redact=100 \
    --report-format json \
    --report-path /fixture/finding.json \
    --no-banner \
    --no-color > /dev/null 2>&1
  detected_exit=$?
  set -e

  if [ "$detected_exit" -ne 1 ] || ! grep -q 'plutonix-fake-secret' "$fixture_dir/finding.json" 2>/dev/null; then
    printf '%s\n' "Fake-token fixture was not detected by the pinned scanner." >&2
    exit 1
  fi
  verify_report_sanitation "$fixture_dir/finding.json"
  if grep -F "$fake_token" "$fixture_dir/finding.json" >/dev/null 2>&1; then
    printf '%s\n' "Fixture report was not fully redacted." >&2
    exit 1
  fi

  rm -f "$fixture_dir/fake-token.txt"
  set +e
  docker run --rm \
    -v "$ROOT_DIR:/repo:ro" \
    -v "$fixture_dir:/fixture" \
    "$SCANNER_IMAGE" detect \
    --source /fixture \
    --no-git \
    --config /repo/.gitleaks.toml \
    --redact=100 \
    --report-format json \
    --report-path /fixture/clean.json \
    --no-banner \
    --no-color > /dev/null 2>&1
  clean_exit=$?
  set -e
  if [ "$clean_exit" -ne 0 ]; then
    printf '%s\n' "Pinned scanner did not pass after the fake fixture was removed." >&2
    exit 1
  fi
  write_empty_report_if_needed "$fixture_dir/clean.json"
  verify_report_sanitation "$fixture_dir/clean.json"
  printf '%s\n' "Fake-token detection, redaction, failure, and post-removal pass verified."
}

case ${1:-} in
  scan) scan_repository ;;
  verify-fixture) verify_fixture ;;
  *) usage; exit 2 ;;
esac
