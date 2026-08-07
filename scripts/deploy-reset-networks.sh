#!/bin/bash
#
# Make the project's Docker networks match the compose file, including when that
# means destroying and recreating them.
#
# ## Why this exists
#
# A Docker network's attributes are fixed at creation. `internal: true` - the V-07
# fix that removes NAT egress, so a student's program cannot reach the internet from
# inside the sandbox - cannot be turned on for a network that already exists. So when
# that line was added, `docker compose up` had to delete the network and make a new
# one, and deleting a network requires every endpoint to be detached first.
#
# Two kinds of container were still attached, and `up` stops neither:
#
#   1. Services behind a `profiles:` gate. `docker compose up` without the profile
#      does not manage them, so it never stops the autoscaler - but the autoscaler
#      is still holding the network open.
#   2. Containers created OUTSIDE compose entirely. deploy.sh already had to clean up
#      "legacy autoscaler-created containers" with no compose project label, so these
#      demonstrably exist on this host.
#
# The deploy died at exactly that point, after stopping nginx and api and before
# starting anything, which is the worst place to stop: the site was down and a plain
# re-run failed the same way.
#
# ## Why it fails loudly
#
# `docker compose down` reports "Resource is still in use" for a network it cannot
# remove and then EXITS 0. The deploy would carry on and `up` would either fail the
# same way or - if the timing differed - succeed against the OLD network, silently
# without `internal: true`. A sandbox with egress, reported as a green deploy.
#
# So this refuses to continue instead. A failed deploy is recoverable; a deployment
# that quietly lost a security control is not, because nothing afterwards says so.
#
# ## What it does NOT do
#
# It never touches volumes. `down` without `-v` leaves named volumes alone - verified,
# because they hold published previews, share snapshots and the asset cache. There is
# no path through this script that can delete a student's work.
#
#   usage: bash scripts/deploy-reset-networks.sh [compose-file]

set -Eeuo pipefail

COMPOSE_FILE="${1:-docker-compose.prod.yml}"

# Compose's default project name is the directory name. The observed network was
# `browser-coder_internal` from ~/browser-coder, which confirms it. An explicit
# COMPOSE_PROJECT_NAME wins, as it does for compose itself.
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"

echo "→ reconciling networks for project '${PROJECT}' (${COMPOSE_FILE})"

# Everything in the project, including services behind a profile gate.
#
# `down` works from the project label rather than from the service list `up` would
# use, so it reaches the autoscaler that `up` leaves running. Deliberately not `-v`.
docker compose -f "$COMPOSE_FILE" down --remove-orphans

# Whatever compose could not remove is now dealt with directly.
#
# Selected by compose's own project label rather than by name, so a network this
# script has never heard of is still handled.
networks="$(docker network ls \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --format '{{.Name}}' || true)"

if [ -z "$networks" ]; then
  echo "→ no project networks remain; compose will create them fresh"
  exit 0
fi

for network in $networks; do
  endpoints="$(docker network inspect "$network" \
    -f '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || true)"

  for endpoint in $endpoints; do
    echo "  detaching ${endpoint} from ${network}"
    # -f because the container is running; this does not stop or delete it. A
    # container compose manages is restarted by the `up` that follows. One it does
    # not manage - the profile-gated autoscaler, or a container created outside
    # compose - is left running but off this network, which is the correct outcome:
    # it is not part of the deployment and must not block it.
    docker network disconnect -f "$network" "$endpoint" || true
  done

  echo "  removing ${network}"
  docker network rm "$network" || true
done

# Refuse to deploy against a network we could not replace.
remaining="$(docker network ls \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --format '{{.Name}}' || true)"

if [ -n "$remaining" ]; then
  echo "" >&2
  echo "Could not remove these project networks:" >&2
  for network in $remaining; do
    echo "  ${network} - still attached: $(docker network inspect "$network" \
      -f '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || echo '?')" >&2
  done
  echo "" >&2
  echo "Refusing to deploy: a network that survives here keeps the settings it was" >&2
  echo "created with, so 'internal: true' would not be applied and the sandbox would" >&2
  echo "have internet egress (V-07) while the deploy reported success." >&2
  exit 1
fi

echo "→ networks cleared; compose will recreate them from ${COMPOSE_FILE}"
