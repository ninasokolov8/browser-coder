# Production asset consistency fix

The build log shows that the missing files were created successfully inside
the GHCR image. The browser errors were caused by deployment inconsistency:
the production host could serve an old index document or route a request to a
replica with a different image. Missing `/assets/*` requests then fell through
to `index.html`, producing `text/html` instead of JavaScript/CSS.

Deploy with:

```bash
chmod +x deploy.sh docker-entrypoint.sh autoscaler.sh
./deploy.sh
```

The deployment now:
- uses `docker-compose.prod.yml` explicitly;
- pulls the latest GHCR image;
- recreates all API replicas from the same image;
- removes legacy unmanaged autoscaler containers;
- prevents missing assets from falling back to index.html;
- disables caching for index/navigation HTML;
- keeps hashed Vite assets immutable;
- verifies every JS/CSS path from the deployed index before declaring success.
