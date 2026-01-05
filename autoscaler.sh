#!/bin/bash
# ============================================
# Auto-Scaler for Browser Coder API
# 
# Monitors API containers and automatically
# scales up/down based on CPU, memory, and queue
# ============================================

set -e

# Configuration (from environment)
SERVICE_NAME="${SERVICE_NAME:-browser_coder-api}"
MIN_REPLICAS="${MIN_REPLICAS:-1}"
MAX_REPLICAS="${MAX_REPLICAS:-8}"
SCALE_UP_CPU="${SCALE_UP_CPU_THRESHOLD:-70}"
SCALE_DOWN_CPU="${SCALE_DOWN_CPU_THRESHOLD:-30}"
SCALE_UP_QUEUE="${SCALE_UP_QUEUE_THRESHOLD:-50}"
CHECK_INTERVAL="${CHECK_INTERVAL_SECONDS:-10}"
COOLDOWN="${COOLDOWN_SECONDS:-30}"

# State
LAST_SCALE_TIME=0

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

get_container_ids() {
    docker ps --filter "name=${SERVICE_NAME}" --format "{{.ID}}" 2>/dev/null || echo ""
}

get_replica_count() {
    docker ps --filter "name=${SERVICE_NAME}" --format "{{.ID}}" 2>/dev/null | wc -l | tr -d ' '
}

get_avg_cpu() {
    local containers=$(get_container_ids)
    if [ -z "$containers" ]; then
        echo "0"
        return
    fi
    
    local total_cpu=0
    local count=0
    
    for container in $containers; do
        local cpu=$(docker stats --no-stream --format "{{.CPUPerc}}" "$container" 2>/dev/null | tr -d '%' || echo "0")
        if [ -n "$cpu" ] && [ "$cpu" != "0" ]; then
            total_cpu=$(echo "$total_cpu + $cpu" | bc 2>/dev/null || echo "$total_cpu")
            count=$((count + 1))
        fi
    done
    
    if [ "$count" -gt 0 ]; then
        echo "scale=2; $total_cpu / $count" | bc 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

get_avg_memory() {
    local containers=$(get_container_ids)
    if [ -z "$containers" ]; then
        echo "0"
        return
    fi
    
    local total_mem=0
    local count=0
    
    for container in $containers; do
        local mem=$(docker stats --no-stream --format "{{.MemPerc}}" "$container" 2>/dev/null | tr -d '%' || echo "0")
        if [ -n "$mem" ] && [ "$mem" != "0" ]; then
            total_mem=$(echo "$total_mem + $mem" | bc 2>/dev/null || echo "$total_mem")
            count=$((count + 1))
        fi
    done
    
    if [ "$count" -gt 0 ]; then
        echo "scale=2; $total_mem / $count" | bc 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

get_api_queue_size() {
    local containers=$(get_container_ids)
    if [ -z "$containers" ]; then
        echo "0"
        return
    fi
    
    local container=$(echo "$containers" | head -1)
    local ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container" 2>/dev/null)
    
    if [ -n "$ip" ]; then
        local health=$(curl -s --max-time 2 "http://${ip}:3001/health" 2>/dev/null || echo "{}")
        local queue=$(echo "$health" | jq -r '.pool.queued // 0' 2>/dev/null || echo "0")
        echo "$queue"
    else
        echo "0"
    fi
}

scale_service() {
    local target=$1
    local current=$(get_replica_count)
    
    if [ "$target" -eq "$current" ]; then
        return 0
    fi
    
    # Check cooldown
    local now=$(date +%s)
    local elapsed=$((now - LAST_SCALE_TIME))
    if [ "$elapsed" -lt "$COOLDOWN" ]; then
        log "⏳ Cooldown active (${elapsed}s/${COOLDOWN}s), skipping scale"
        return 0
    fi
    
    log "🔄 Scaling ${SERVICE_NAME}: ${current} → ${target} replicas"
    
    # Scale by starting/stopping containers directly
    if [ "$target" -gt "$current" ]; then
        # Scale up - start more containers
        local to_add=$((target - current))
        for i in $(seq 1 $to_add); do
            docker run -d \
                --network browser_coder_default \
                --name "${SERVICE_NAME}-$(date +%s%N)" \
                -e NODE_ENV=production \
                -e PORT=3001 \
                -e RATE_LIMIT_MAX=200 \
                -e RUN_TIMEOUT_MS=10000 \
                --restart always \
                --memory=1g \
                browser_coder-api 2>/dev/null && log "✅ Started new API container" || log "⚠️ Failed to start container"
        done
    else
        # Scale down - stop excess containers
        local to_remove=$((current - target))
        local containers=$(docker ps --filter "name=${SERVICE_NAME}" --format "{{.ID}}" | tail -n $to_remove)
        for container in $containers; do
            docker stop "$container" >/dev/null 2>&1 && \
            docker rm "$container" >/dev/null 2>&1 && \
            log "✅ Stopped API container $container" || log "⚠️ Failed to stop container"
        done
    fi
    
    LAST_SCALE_TIME=$(date +%s)
}

main_loop() {
    log "🚀 Auto-Scaler started"
    log "📊 Config: MIN=${MIN_REPLICAS}, MAX=${MAX_REPLICAS}, CPU↑=${SCALE_UP_CPU}%, CPU↓=${SCALE_DOWN_CPU}%"
    
    # Wait for initial containers
    sleep 10
    
    while true; do
        local current=$(get_replica_count)
        local avg_cpu=$(get_avg_cpu)
        local avg_mem=$(get_avg_memory)
        local queue=$(get_api_queue_size)
        
        log "📈 Replicas: ${current}, CPU: ${avg_cpu}%, Memory: ${avg_mem}%, Queue: ${queue}"
        
        # Determine if we need to scale
        local target=$current
        
        # Scale up conditions
        if [ "$(echo "$avg_cpu > $SCALE_UP_CPU" | bc 2>/dev/null || echo 0)" -eq 1 ] || \
           [ "$(echo "$queue > $SCALE_UP_QUEUE" | bc 2>/dev/null || echo 0)" -eq 1 ]; then
            if [ "$current" -lt "$MAX_REPLICAS" ]; then
                target=$((current + 1))
                log "⬆️ Scale UP triggered (CPU: ${avg_cpu}% > ${SCALE_UP_CPU}% or Queue: ${queue} > ${SCALE_UP_QUEUE})"
            fi
        fi
        
        # Scale down conditions
        if [ "$(echo "$avg_cpu < $SCALE_DOWN_CPU" | bc 2>/dev/null || echo 0)" -eq 1 ] && \
           [ "$(echo "$queue < 5" | bc 2>/dev/null || echo 0)" -eq 1 ]; then
            if [ "$current" -gt "$MIN_REPLICAS" ]; then
                target=$((current - 1))
                log "⬇️ Scale DOWN triggered (CPU: ${avg_cpu}% < ${SCALE_DOWN_CPU}% and Queue: ${queue} < 5)"
            fi
        fi
        
        # Apply scaling
        if [ "$target" -ne "$current" ]; then
            scale_service "$target"
        fi
        
        sleep "$CHECK_INTERVAL"
    done
}

# Start
main_loop
