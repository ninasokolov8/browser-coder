#!/bin/bash
# Browser Coder - Production deployment for GHCR-based automatic releases.
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { printf "\n%s\n" "$1"; }
fail() {
  printf "${RED}Deployment failed.${NC}\n"
  docker compose -f "$COMPOSE_FILE" ps || true
  docker compose -f "$COMPOSE_FILE" logs --tail=200 api nginx || true
}
trap fail ERR

log "🚀 Browser Coder production deployment"

if [ -d .git ]; then
  log "📦 Pulling deployment configuration"
  git fetch origin main
  git reset --hard origin/main
fi

mkdir -p security/reports
chmod 770 security/reports 2>/dev/null || sudo chmod 770 security/reports

log "📥 Pulling the exact latest production images"
docker compose -f "$COMPOSE_FILE" pull api nginx preview-storage-init

log "🛑 Removing the previous production containers"
docker compose -f "$COMPOSE_FILE" down --remove-orphans

# Remove only legacy autoscaler-created containers. Compose containers have
# the com.docker.compose.project label and are already removed above.
while IFS= read -r container_id; do
  [ -z "$container_id" ] && continue
  if [ -z "$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id" 2>/dev/null)" ]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
done < <(docker ps -aq --filter "name=browser_coder-api-" || true)

log "🔐 Preparing persistent preview storage"
docker compose -f "$COMPOSE_FILE" up --no-deps --force-recreate preview-storage-init

log "🚀 Starting every service from the same pulled image"
docker compose -f "$COMPOSE_FILE" up   -d   --no-build   --force-recreate   --remove-orphans   api nginx

log "⏳ Waiting for API health"
for attempt in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" ps api --format json 2>/dev/null |
      grep -q '"Health":"healthy"'; then
    printf "${GREEN}✓ API is healthy${NC}\n"
    break
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "API did not become healthy in time"
    exit 1
  fi
  sleep 2
done

log "🧪 Verifying deployed asset consistency"
INDEX_HTML="$(curl -fsS -H 'Cache-Control: no-cache' http://127.0.0.1/)"
ASSET_PATHS="$(printf '%s' "$INDEX_HTML" |
  grep -oE '/assets/[^"'"'"' ]+\.(js|css)' |
  sort -u)"

if [ -z "$ASSET_PATHS" ]; then
  echo "No JavaScript or CSS assets were found in the deployed index.html"
  exit 1
fi

while IFS= read -r asset; do
  [ -z "$asset" ] && continue
  status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1${asset}")"
  content_type="$(curl -sSI "http://127.0.0.1${asset}" |
    awk -F': ' 'tolower($1)=="content-type"{print tolower($2)}' |
    tr -d '\r')"

  if [ "$status" != "200" ]; then
    echo "Missing deployed asset: $asset (HTTP $status)"
    exit 1
  fi

  case "$asset" in
    *.js)
      echo "$content_type" | grep -Eq 'javascript|ecmascript' || {
        echo "Wrong MIME type for $asset: $content_type"
        exit 1
      }
      ;;
    *.css)
      echo "$content_type" | grep -q 'text/css' || {
        echo "Wrong MIME type for $asset: $content_type"
        exit 1
      }
      ;;
  esac
done <<< "$ASSET_PATHS"

log "📊 Production status"
docker compose -f "$COMPOSE_FILE" ps

printf "\n${GREEN}✅ Deployment completed and all current Vite assets are reachable.${NC}\n"
