#!/bin/sh
# Runs as root (before the app user takes over) so that bind-mounted
# report directories are always writable, no matter what UID/permissions
# they have on the host (fresh git clone, CI checkout, etc).
#
# Without this, `security/reports` and `tests/reports` mounted from the
# host can end up owned by root (or another UID) with no write access for
# the container's non-root "app" user, causing:
#   EACCES: permission denied, open '/app/security/reports/security-report-latest.json'
set -e

for dir in /app/security/reports /app/tests/reports; do
  mkdir -p "$dir" 2>/dev/null || true
  chown -R app:app "$dir" 2>/dev/null || true
  chmod -R 777 "$dir" 2>/dev/null || true
done

exec su-exec app:app "$@"
