#!/bin/sh
# Ensures the Digger API route exists in the running Caddy config via the local admin API.
# Idempotent: exits quietly when the route is already present. Run from a systemd user timer
# so the route survives Caddy reloads until the snippet is added to /etc/caddy/Caddyfile.
ADMIN=http://127.0.0.1:2019
SERVER=srv0
PREFIX=/onni/digger/api
UPSTREAM=127.0.0.1:8796

if curl -s "$ADMIN/config/apps/http/servers/$SERVER/routes" | grep -q "\"$PREFIX/\*\""; then
  exit 0
fi
curl -s -o /dev/null -w "caddy route insert: HTTP %{http_code}\n" -X PUT "$ADMIN/config/apps/http/servers/$SERVER/routes/0" \
  -H 'Content-Type: application/json' \
  -d "{\"match\":[{\"host\":[\"pikos.org\"],\"path\":[\"$PREFIX/*\"]}],\"handle\":[{\"handler\":\"rewrite\",\"strip_path_prefix\":\"$PREFIX\"},{\"handler\":\"reverse_proxy\",\"upstreams\":[{\"dial\":\"$UPSTREAM\"}]}],\"terminal\":true}"
