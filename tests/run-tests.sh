#!/bin/bash

# Browser Coder Test Runner
# Usage: ./run-tests.sh [security|languages|stress|features|all]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Server URL (can be overridden with SERVER_URL env var)
SERVER_URL="${SERVER_URL:-http://localhost:3001}"

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              BROWSER CODER TEST SUITE                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${BLUE}Server: ${SERVER_URL}${NC}"
echo ""

# Check if server is running
echo -e "${YELLOW}Checking server connectivity...${NC}"
if curl -s --max-time 5 "${SERVER_URL}/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server is running${NC}"
else
    echo -e "${RED}✗ Server is not running at ${SERVER_URL}${NC}"
    echo -e "${YELLOW}Start the server first with: npm run dev${NC}"
    exit 1
fi

echo ""

# Determine which tests to run
TEST_TYPE="${1:-all}"

run_security_tests() {
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}                    SECURITY TESTS                             ${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    node security/security-tests.mjs --server="${SERVER_URL}"
}

run_language_tests() {
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}                    LANGUAGE TESTS                             ${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -f "languages/language-tests.mjs" ]; then
        node languages/language-tests.mjs --server="${SERVER_URL}"
    else
        echo -e "${YELLOW}Language tests not yet implemented${NC}"
    fi
}

run_stress_tests() {
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}                    STRESS TESTS                               ${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -f "stress/stress-tests.mjs" ]; then
        node stress/stress-tests.mjs --server="${SERVER_URL}"
    else
        echo -e "${YELLOW}Stress tests not yet implemented${NC}"
    fi
}

run_feature_tests() {
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}                    FEATURE TESTS                              ${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -f "features/feature-tests.mjs" ]; then
        node features/feature-tests.mjs --server="${SERVER_URL}"
    else
        echo -e "${YELLOW}Feature tests not yet implemented${NC}"
    fi
}

case "$TEST_TYPE" in
    security)
        run_security_tests
        ;;
    languages)
        run_language_tests
        ;;
    stress)
        run_stress_tests
        ;;
    features)
        run_feature_tests
        ;;
    all)
        run_security_tests
        echo ""
        run_language_tests
        echo ""
        run_stress_tests
        echo ""
        run_feature_tests
        ;;
    *)
        echo -e "${RED}Unknown test type: ${TEST_TYPE}${NC}"
        echo "Usage: $0 [security|languages|stress|features|all]"
        exit 1
        ;;
esac

echo ""
echo -e "${BOLD}${GREEN}Test suite completed!${NC}"
echo -e "${BLUE}Reports saved to: tests/reports/${NC}"
