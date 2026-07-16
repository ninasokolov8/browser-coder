#!/bin/bash
# Browser Coder API autoscaler.
# Uses Docker Compose scaling so every replica inherits the current image,
# preview volume, limits, networks and security settings.
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/app/docker-compose.prod.yml}"
PROJECT_DIR="${PROJECT_DIR:-/app}"
SERVICE_NAME="${SERVICE_NAME:-api}"
MIN_REPLICAS="${MIN_REPLICAS:-1}"
MAX_REPLICAS="${MAX_REPLICAS:-8}"
SCALE_UP_CPU="${SCALE_UP_CPU_THRESHOLD:-70}"
SCALE_DOWN_CPU="${SCALE_DOWN_CPU_THRESHOLD:-30}"
CHECK_INTERVAL="${CHECK_INTERVAL_SECONDS:-10}"
COOLDOWN="${COOLDOWN_SECONDS:-30}"
LAST_SCALE_TIME=0

cd "$PROJECT_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

get_container_ids() {
  compose ps -q "$SERVICE_NAME" 2>/dev/null || true
}

get_replica_count() {
  get_container_ids | sed '/^$/d' | wc -l | tr -d ' '
}

get_avg_cpu() {
  local containers total count cpu
  containers="$(get_container_ids)"
  [ -z "$containers" ] && { echo 0; return; }
  total=0
  count=0
  for container in $containers; do
    cpu="$(docker stats --no-stream --format '{{.CPUPerc}}' "$container" 2>/dev/null | tr -d '%' || echo 0)"
    total="$(echo "$total + ${cpu:-0}" | bc)"
    count=$((count + 1))
  done
  [ "$count" -gt 0 ] && echo "scale=2; $total / $count" | bc || echo 0
}

scale_service() {
  local target="$1"
  local now elapsed
  now="$(date +%s)"
  elapsed=$((now - LAST_SCALE_TIME))
  [ "$elapsed" -lt "$COOLDOWN" ] && return 0

  log "Scaling ${SERVICE_NAME} to ${target} replicas"
  compose up -d --no-build --no-deps --scale "${SERVICE_NAME}=${target}" "$SERVICE_NAME"
  LAST_SCALE_TIME="$now"
}

log "Autoscaler started with Compose-managed replicas"
sleep 10

while true; do
  current="$(get_replica_count)"
  avg_cpu="$(get_avg_cpu)"
  target="$current"

  if [ "$(echo "$avg_cpu > $SCALE_UP_CPU" | bc)" -eq 1 ] && [ "$current" -lt "$MAX_REPLICAS" ]; then
    target=$((current + 1))
  elif [ "$(echo "$avg_cpu < $SCALE_DOWN_CPU" | bc)" -eq 1 ] && [ "$current" -gt "$MIN_REPLICAS" ]; then
    target=$((current - 1))
  fi

  [ "$target" -ne "$current" ] && scale_service "$target"
  sleep "$CHECK_INTERVAL"
done
