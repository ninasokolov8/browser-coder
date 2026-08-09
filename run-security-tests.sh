#!/bin/bash
#
# Run Security Tests in Docker
#
# Usage:
#   ./run-security-tests.sh
#
# This script:
#   1. Builds and starts the API container
#   2. Runs security tests against it
#   3. Generates HTML and JSON reports in ./security/reports/
#   4. Shows test results summary

set -e

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "                🔒 BROWSER CODER SECURITY TESTS"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Create reports directory.
#
# security/reports, which is what docker-compose.test.yml mounts. This script used
# to create and read tests/reports/ instead, so it reported whichever run happened
# to be sitting in the OTHER directory - which for a long time meant printing an
# old run as though it were today's result.
mkdir -p security/reports

# Stop any existing test containers
echo "🧹 Cleaning up existing containers..."
docker compose -f docker-compose.test.yml down --remove-orphans 2>/dev/null || true

# Build and run tests
echo ""
echo "🚀 Building and starting test environment..."
echo ""

docker compose -f docker-compose.test.yml up --build --abort-on-container-exit test-security

EXIT_CODE=$?

# Cleanup
echo ""
echo "🧹 Cleaning up..."
docker compose -f docker-compose.test.yml down --remove-orphans 2>/dev/null || true

# Show results
echo ""
echo "════════════════════════════════════════════════════════════════"

if [ -f "security/reports/security-report-latest.json" ]; then
    echo ""
    echo "📊 Reports generated:"

    # List dated reports
    LATEST_JSON=$(ls -t security/reports/*_security-report_*.json 2>/dev/null | head -1)
    LATEST_HTML=$(ls -t security/reports/*_security-report_*.html 2>/dev/null | head -1)

    if [ -n "$LATEST_JSON" ]; then
        echo "   • JSON: $LATEST_JSON"
    fi
    if [ -n "$LATEST_HTML" ]; then
        echo "   • HTML: $LATEST_HTML"
    fi
    echo "   • Latest: security/reports/security-report-latest.json"
    echo ""

    # Parse and show summary from JSON
    if command -v jq &> /dev/null; then
        PASSED=$(jq '.summary.passed' security/reports/security-report-latest.json)
        FAILED=$(jq '.summary.failed' security/reports/security-report-latest.json)
        TOTAL=$(jq '.summary.total' security/reports/security-report-latest.json)
        RATE=$(jq -r '.summary.passRate' security/reports/security-report-latest.json)

        echo "📋 Summary:"
        echo "   ✓ Passed: $PASSED"
        echo "   ✗ Failed: $FAILED"
        echo "   Total:   $TOTAL"
        echo "   Pass Rate: $RATE"
    fi
fi

echo ""
echo "════════════════════════════════════════════════════════════════"

exit $EXIT_CODE
