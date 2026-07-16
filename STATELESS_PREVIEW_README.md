# Stateless shareable previews

This fix replaces the fragile file-backed preview lookup with a stateless URL:

`https://your-coder-host/api/preview#v1.<random-id>.<codec>.<compressed-site>`

Why this fixes `Preview not found`:

- The bundled site travels in the URL fragment.
- URL fragments are not sent to the server.
- No preview file must exist on the particular API replica serving the GET.
- No sticky sessions, Redis, shared disk, or cleanup job is required.
- Every preview gets a cryptographically random ID and cannot overwrite another preview.

The preview shell still runs user code in an opaque-origin sandboxed iframe.
