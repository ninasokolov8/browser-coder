#!/bin/bash
# Browser Coder - verified production deployment for GHCR releases.
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log() {
  printf '\n%s\n' "$1"
}

show_failure_context() {
  printf "${RED}Deployment failed.${NC}\n"
  docker compose -f "$COMPOSE_FILE" ps || true
  docker compose -f "$COMPOSE_FILE" logs --tail=200 api nginx || true
}
trap show_failure_context ERR

normalize_asset_path() {
  local value="$1"
  value="${value#./}"
  value="${value#/}"
  printf '/%s' "$value"
}

verify_content_type() {
  local asset_path="$1"
  local content_type="$2"

  case "$asset_path" in
    *.js)
      printf '%s' "$content_type" | grep -Eq 'javascript|ecmascript' || {
        echo "Wrong MIME type for $asset_path: $content_type"
        return 1
      }
      ;;
    *.css)
      printf '%s' "$content_type" | grep -q 'text/css' || {
        echo "Wrong MIME type for $asset_path: $content_type"
        return 1
      }
      ;;
    *.ttf|*.woff|*.woff2)
      printf '%s' "$content_type" | grep -Eq 'font/|application/(font|octet-stream)' || {
        echo "Wrong MIME type for $asset_path: $content_type"
        return 1
      }
      ;;
  esac
}

log "🚀 Browser Coder production deployment"

if [ -d .git ]; then
  log "📦 Pulling deployment configuration"
  git fetch origin main
  git reset --hard origin/main
fi

mkdir -p security/reports
chmod 770 security/reports 2>/dev/null || sudo chmod 770 security/reports

log "📥 Pulling production images"
docker compose -f "$COMPOSE_FILE" pull api nginx preview-storage-init

log "🛑 Removing previous production containers"
docker compose -f "$COMPOSE_FILE" down --remove-orphans

# Remove only legacy autoscaler-created containers. Compose-managed containers
# were already removed by `docker compose down` above.
while IFS= read -r container_id; do
  [ -z "$container_id" ] && continue
  compose_project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id" 2>/dev/null || true)"
  if [ -z "$compose_project" ]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
done < <(docker ps -aq --filter 'name=browser_coder-api-' || true)

log "🔐 Preparing persistent preview storage"
docker compose -f "$COMPOSE_FILE" up --no-deps --force-recreate preview-storage-init

log "🚀 Starting production services"
docker compose -f "$COMPOSE_FILE" up \
  -d \
  --no-build \
  --force-recreate \
  --remove-orphans \
  api nginx

log "⏳ Waiting for API health"
for attempt in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" ps api --format json 2>/dev/null | grep -q '"Health":"healthy"'; then
    printf "${GREEN}✓ API is healthy${NC}\n"
    break
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "API did not become healthy in time"
    exit 1
  fi
  sleep 2
done

log "🧪 Verifying generated URLs and every deployed Vite asset"
INDEX_HTML="$(curl -fsS -H 'Cache-Control: no-cache' http://127.0.0.1/)"

# The IDE is publicly mounted below /coder/. Root Vite URLs escape that mount
# and hit Arc Academy's Laravel app, which returns HTML/404 for JS, CSS and fonts.
# A correct build must therefore use document-relative ./assets/... references.
if ! printf '%s' "$INDEX_HTML" | grep -qE '(src|href)="\./assets/'; then
  echo "index.html does not contain document-relative ./assets/ URLs"
  exit 1
fi

if printf '%s' "$INDEX_HTML" | grep -qE '(src|href)="/assets/'; then
  echo "index.html still contains root /assets/ URLs"
  exit 1
fi

ASSET_FILES="$(
  docker compose -f "$COMPOSE_FILE" exec -T api \
    sh -c 'for file in /app/dist/assets/*; do [ -f "$file" ] && basename "$file"; done' \
    | sed '/^[[:space:]]*$/d' \
    | sort -u
)"

if [ -z "$ASSET_FILES" ]; then
  echo "No files were found in /app/dist/assets inside the production image"
  exit 1
fi

while IFS= read -r filename; do
  [ -z "$filename" ] && continue
  asset_path="$(normalize_asset_path "assets/$filename")"
  headers="$(curl -fsSI "http://127.0.0.1${asset_path}")"
  content_type="$(
    printf '%s\n' "$headers" \
      | awk -F': ' 'tolower($1)=="content-type" { print tolower($2) }' \
      | tr -d '\r' \
      | tail -n 1
  )"

  if [ -z "$content_type" ]; then
    echo "Missing Content-Type for $asset_path"
    exit 1
  fi

  if printf '%s' "$content_type" | grep -q 'text/html'; then
    echo "Asset incorrectly returned HTML: $asset_path"
    exit 1
  fi

  verify_content_type "$asset_path" "$content_type"
done <<< "$ASSET_FILES"

log "📊 Production status"
docker compose -f "$COMPOSE_FILE" ps

printf "\n${GREEN}✅ Deployment completed. Relative asset URLs, lazy chunks, Monaco workers, CSS and fonts are all reachable.${NC}\n"
