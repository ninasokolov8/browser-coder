# Shareable HTML previews

Preview URLs now use the Browser Coder host:

`https://your-coder-domain/preview/<27-character-random-id>`

Each publish creates a new immutable preview. Atomic file creation prevents collisions and overwrites.

## Production scaling

For multiple replicas, point every instance at the same persistent volume:

`PREVIEW_STORAGE_DIR=/shared/browser-coder-previews`

Configuration:

- `PREVIEW_MAX_BYTES` — default 5 MiB
- `PREVIEW_TTL_MS` — default 30 days
- `PREVIEW_CLEANUP_INTERVAL_MS` — default 1 hour
- `PREVIEW_STORAGE_DIR` — default `data/previews`

User HTML is served inside an opaque-origin sandboxed iframe so it cannot access Browser Coder cookies, local storage, parent DOM, or authenticated API context.
