#!/usr/bin/env bash

set -Eeuo pipefail

PLUTOMIX_REPO_DIR="${PLUTOMIX_REPO_DIR:-/home/linuxuser/PlutoniXz}"
PLUTOMIX_BRANCH="${PLUTOMIX_BRANCH:-main}"
PLUTOMIX_PROJECT_NAME="${PLUTOMIX_PROJECT_NAME:-plutomix}"
PLUTOMIX_OVERRIDE_FILE="${PLUTOMIX_OVERRIDE_FILE:-compose.production.yaml}"
PLUTOMIX_LOCK_FILE="${PLUTOMIX_LOCK_FILE:-/tmp/plutomix-deploy.lock}"

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

[[ ${EUID} -ne 0 ]] || fail "Run this script as linuxuser, not root."

for command_name in docker git flock; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Required command not found: $command_name"
done

exec 9>"$PLUTOMIX_LOCK_FILE"
flock -n 9 || fail "Another PlutoMix deployment is already running."

[[ -d "$PLUTOMIX_REPO_DIR/.git" ]] || fail "Git repository not found: $PLUTOMIX_REPO_DIR"
cd "$PLUTOMIX_REPO_DIR"

PLUTOMIX_BASE_COMPOSE=""
for compose_candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  if [[ -f "$compose_candidate" ]]; then
    PLUTOMIX_BASE_COMPOSE="$compose_candidate"
    break
  fi
done

[[ -n "$PLUTOMIX_BASE_COMPOSE" ]] || fail "No Compose file found in $PLUTOMIX_REPO_DIR"
[[ -f "$PLUTOMIX_OVERRIDE_FILE" ]] || fail "Production override not found: $PLUTOMIX_OVERRIDE_FILE"
[[ -f .env ]] || fail ".env not found in $PLUTOMIX_REPO_DIR"

PLUTOMIX_POSTGRES_CA_PATH="$PLUTOMIX_REPO_DIR/.runtime-secrets/vultr-postgres-ca.crt"
PLUTOMIX_ORCHESTRATOR_ARCHIVE_PATH="$PLUTOMIX_REPO_DIR/orchestrator-temp/orchestrator-agent-001-main.zip"
[[ -f "$PLUTOMIX_POSTGRES_CA_PATH" ]] || \
  fail "PostgreSQL CA certificate must be a regular file: $PLUTOMIX_POSTGRES_CA_PATH"
[[ -r "$PLUTOMIX_POSTGRES_CA_PATH" ]] || \
  fail "PostgreSQL CA certificate is not readable: $PLUTOMIX_POSTGRES_CA_PATH"
[[ -f "$PLUTOMIX_ORCHESTRATOR_ARCHIVE_PATH" ]] || \
  fail "Project orchestrator archive must be a regular file: $PLUTOMIX_ORCHESTRATOR_ARCHIVE_PATH"
[[ -r "$PLUTOMIX_ORCHESTRATOR_ARCHIVE_PATH" ]] || \
  fail "Project orchestrator archive is not readable: $PLUTOMIX_ORCHESTRATOR_ARCHIVE_PATH"

PLUTOMIX_CURRENT_BRANCH="$(git branch --show-current)"
[[ "$PLUTOMIX_CURRENT_BRANCH" == "$PLUTOMIX_BRANCH" ]] || \
  fail "Expected branch '$PLUTOMIX_BRANCH', but found '$PLUTOMIX_CURRENT_BRANCH'."

if ! git diff --cached --quiet; then
  fail "Staged files exist on the server. Unstage and review them before deployment."
fi

mapfile -t PLUTOMIX_LOCAL_CHANGES < <(git diff --name-only)
for changed_path in "${PLUTOMIX_LOCAL_CHANGES[@]}"; do
  case "$changed_path" in
    .env)
      log "Preserving the server-specific .env change."
      ;;
    *)
      fail "Tracked source file has a local change: $changed_path"
      ;;
  esac
done

PLUTOMIX_COMPOSE=(
  docker compose
  --project-name "$PLUTOMIX_PROJECT_NAME"
  -f "$PLUTOMIX_BASE_COMPOSE"
  -f "$PLUTOMIX_OVERRIDE_FILE"
)

PLUTOMIX_WAS_STOPPED=0

recover_on_error() {
  local exit_code=$?
  trap - ERR

  log "Deployment failed with exit code $exit_code."
  if [[ $PLUTOMIX_WAS_STOPPED -eq 1 ]]; then
    log "Attempting to restart PlutoMix from locally available images."
    "${PLUTOMIX_COMPOSE[@]}" up -d --no-build --remove-orphans || true
    "${PLUTOMIX_COMPOSE[@]}" ps || true
  fi

  exit "$exit_code"
}

trap recover_on_error ERR

log "Fetching origin/$PLUTOMIX_BRANCH."
git fetch --prune origin "$PLUTOMIX_BRANCH"

if [[ ${#PLUTOMIX_LOCAL_CHANGES[@]} -gt 0 ]] && \
   git diff --name-only HEAD "origin/$PLUTOMIX_BRANCH" -- .env | grep -Fxq .env; then
  fail "origin/$PLUTOMIX_BRANCH also changes .env; deployment stopped to protect the server configuration."
fi

git merge --ff-only "origin/$PLUTOMIX_BRANCH"

log "Validating PlutoMix Compose configuration."
"${PLUTOMIX_COMPOSE[@]}" config --quiet

log "Stopping PlutoMix containers without deleting volumes."
"${PLUTOMIX_COMPOSE[@]}" down --remove-orphans
PLUTOMIX_WAS_STOPPED=1

log "Building PlutoMix images."
"${PLUTOMIX_COMPOSE[@]}" build --pull

log "Applying locked PostgreSQL migrations."
"${PLUTOMIX_COMPOSE[@]}" \
  --profile decision-continuity-production \
  run --rm decision-continuity-migrate

log "Starting PlutoMix."
"${PLUTOMIX_COMPOSE[@]}" up -d --remove-orphans
PLUTOMIX_WAS_STOPPED=0

log "Deployment completed at commit $(git rev-parse --short HEAD)."
"${PLUTOMIX_COMPOSE[@]}" ps

log "Recent PlutoMix logs follow."
"${PLUTOMIX_COMPOSE[@]}" logs --tail=100 --no-color
