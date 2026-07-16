# Production preview deployment

These are complete replacement files. Existing code execution, language
support, load balancing, reports, and static frontend behavior are preserved.

## Deploy

```bash
docker compose -f docker-compose.prod.yml stop api nginx
docker compose -f docker-compose.prod.yml rm -f api nginx preview-storage-init
docker compose -f docker-compose.prod.yml build --no-cache --pull api
docker compose -f docker-compose.prod.yml up -d --force-recreate preview-storage-init
docker compose -f docker-compose.prod.yml up -d --force-recreate api nginx
docker compose -f docker-compose.prod.yml logs --tail=200 -f api nginx
```

Do not use `down -v`; that removes the preview volume.

## Security behavior

- Preview HTML is stored as data and never executed by the API process.
- User JavaScript runs only in an opaque-origin sandboxed iframe.
- Forms, downloads, popups, external requests, workers, frames, camera,
  microphone, geolocation, payment, USB and related permissions are blocked.
- Publishing requires a same-site browser request marker.
- Nginx and Node both rate-limit publishing.
- Preview size defaults to 512 KiB.
- Preview lifetime defaults to 7 days.
- Storage is capped at 1 GiB / 50,000 previews with oldest-first eviction.
- The API remains non-root and read-only except for its dedicated preview
  volume and existing temporary/report mounts.
