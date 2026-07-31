# TLS

`docker-compose.prod.yml` publishes port 443, but nginx listened on 80 only, so the
mapped port answered nothing (blueprint V-42).

The fix is not a `listen 443 ssl` block in `nginx.conf`. **nginx refuses to start
when a referenced certificate file is missing**, so hardcoding one turns "no
certificate yet" into a total outage rather than a missing feature — including on a
fresh clone, in CI, and in the dev compose stack that has no certificates at all.

So `nginx.conf` ends with:

```nginx
include /etc/nginx/tls/*.conf;
```

An empty directory includes nothing and the deployment keeps serving port 80. Add a
file here and TLS is served on the next reload.

## Enabling it

1. Put the certificate and key where the container can read them, and mount them.
   In `docker-compose.prod.yml`, alongside the existing nginx volumes:

   ```yaml
       volumes:
         - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
         - ./nginx/tls:/etc/nginx/tls:ro
         - /etc/letsencrypt:/etc/letsencrypt:ro
   ```

2. Copy `server.conf.example` in this directory to `server.conf` and set
   `server_name` and the two certificate paths.

3. `docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload`

   Test **before** reloading. A bad path here stops nginx from starting again.

## Two things that are deliberately not done here

**No automatic HTTP→HTTPS redirect.** The IDE is embedded in an iframe by Step-Up. A
redirect on the health endpoint would also break the container healthcheck, which
requests `http://127.0.0.1/health`. Add the redirect once TLS is confirmed working,
and exclude `/health` from it.

**No HSTS.** `Strict-Transport-Security` is effectively irreversible for the duration
of its max-age: send it once with a long max-age and browsers refuse plain HTTP for
that host until it expires. It belongs in a deliberate decision after TLS has been
stable, not in a template.
