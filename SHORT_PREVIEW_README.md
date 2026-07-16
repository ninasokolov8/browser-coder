# Short shareable preview URLs

URLs are now short and look like:

`https://coder.example.com/preview/AbCdEfGhIjKlMnOpQrStUv`

The HTML is stored server-side instead of inside the URL hash. Each publish uses a new 128-bit random ID and atomic file creation, so previews do not overwrite one another.

Use the included Compose volume configuration. For multiple API replicas, `PREVIEW_STORAGE_DIR` must point to shared persistent storage visible to every replica (shared volume, NFS, or object-store-backed implementation). A container-local `/tmp` directory is not sufficient for multi-replica or restart persistence.

The obsolete stateless `/api/preview#...` route was removed to prevent long URLs from being generated or accepted.
