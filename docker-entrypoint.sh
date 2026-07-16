#!/bin/sh
# Repair only the writable runtime mounts, then immediately drop privileges.
set -e

for dir in /app/security/reports /app/tests/reports; do
  mkdir -p "$dir" 2>/dev/null || true
  chown -R app:app "$dir" 2>/dev/null || true
  chmod -R 770 "$dir" 2>/dev/null || true
done

if [ -n "${PREVIEW_STORAGE_DIR:-}" ]; then
  mkdir -p "$PREVIEW_STORAGE_DIR" 2>/dev/null || true
  chown -R app:app "$PREVIEW_STORAGE_DIR" 2>/dev/null || true
  chmod 770 "$PREVIEW_STORAGE_DIR" 2>/dev/null || true
fi

exec su-exec app:app "$@"
