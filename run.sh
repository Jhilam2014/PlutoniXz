#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

FRONTEND_URL="http://localhost:${FRONTEND_PORT:-5173}"
BACKEND_URL="http://localhost:${BACKEND_PORT:-8080}"
GENERATED_URL="http://localhost:${GENERATED_SITE_PORT:-5174}"

usage() {
  cat <<'EOF'
PlutoMix runner

Usage:
  ./run.sh              Build if needed and start all containers
  ./run.sh --no-build   Start without rebuilding images
  ./run.sh --stop       Stop containers
  ./run.sh --logs       Follow container logs
  ./run.sh --status     Show container status
  ./run.sh --help       Show this help
EOF
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Docker Compose is required but was not found." >&2
    exit 1
  fi
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local attempts=45

  printf "Waiting for %s at %s" "$name" "$url"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf " ready\n"
      return 0
    fi
    printf "."
    sleep 1
  done

  printf " failed\n"
  echo "$name did not become ready at $url" >&2
  return 1
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found." >&2
  exit 1
fi

case "${1:-}" in
  --help|-h)
    usage
    exit 0
    ;;
  --stop)
    compose down
    exit 0
    ;;
  --logs)
    compose logs -f
    exit 0
    ;;
  --status)
    compose ps
    exit 0
    ;;
  --no-build)
    compose up -d
    ;;
  "")
    compose up -d --build
    ;;
  *)
    echo "Unknown option: $1" >&2
    usage
    exit 1
    ;;
esac

wait_for_url "backend" "$BACKEND_URL/api/status"
wait_for_url "frontend" "$FRONTEND_URL"
wait_for_url "generated site" "$GENERATED_URL"

cat <<EOF

PlutoMix is running.

Frontend:       $FRONTEND_URL
Backend API:    $BACKEND_URL
Generated site: $GENERATED_URL

Useful commands:
  ./run.sh --logs
  ./run.sh --status
  ./run.sh --stop
EOF
