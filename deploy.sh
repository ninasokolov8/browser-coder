#!/bin/bash
# Browser Coder - One Command Production Deployment
# Usage: ./deploy.sh
#
# This script:
# 1. Pulls latest code
# 2. Ensures correct permissions
# 3. Builds and starts all containers
# 4. Verifies health

set -e

echo "🚀 Browser Coder - Production Deployment"
echo "=========================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "📦 Step 1: Pulling latest code..."
git pull origin main || echo "Git pull skipped (not a git repo or no changes)"

echo ""
echo "📁 Step 2: Ensuring directories and permissions..."
mkdir -p security/reports
chmod -R 777 security/reports 2>/dev/null || sudo chmod -R 777 security/reports

echo ""
echo "🛑 Step 3: Stopping existing containers..."
docker compose down --remove-orphans 2>/dev/null || true

echo ""
echo "🔨 Step 4: Building all images..."
docker compose build --no-cache

echo ""
echo "🚀 Step 5: Starting all services..."
docker compose up -d

echo ""
echo "⏳ Step 6: Waiting for services to be healthy..."
sleep 5

# Check health
MAX_ATTEMPTS=30
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    
    # Check if api is healthy
    API_HEALTH=$(docker compose ps api --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || echo "")
    
    if echo "$API_HEALTH" | grep -q "healthy"; then
        echo -e "${GREEN}✓ API is healthy${NC}"
        break
    else
        echo "  Waiting for API... (attempt $ATTEMPT/$MAX_ATTEMPTS)"
        sleep 2
    fi
done

# Final status
echo ""
echo "=========================================="
echo "📊 Service Status:"
docker compose ps

echo ""
echo "=========================================="

# Check if site is accessible
if curl -s -o /dev/null -w "%{http_code}" http://localhost/health | grep -q "200"; then
    echo -e "${GREEN}✅ Site is UP and running!${NC}"
    echo ""
    echo "🌐 Access your site at: http://localhost"
    echo "🔓 Hack Lab (Reports): http://localhost/reports/"
else
    echo -e "${YELLOW}⚠️  Site may still be starting. Check logs:${NC}"
    echo "   docker compose logs -f"
fi

echo ""
echo "📝 Useful commands:"
echo "   View logs:      docker compose logs -f"
echo "   View API logs:  docker compose logs -f api"
echo "   Restart:        docker compose restart"
echo "   Stop:           docker compose down"
echo ""
