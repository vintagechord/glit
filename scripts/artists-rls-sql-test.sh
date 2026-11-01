#!/usr/bin/env bash
# Fresh local PostgreSQL only. Never reads a production URL or credentials.
set -euo pipefail
artists_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
artists_sql_container_id=""
cleanup_artists_sql() {
  if [[ -n "$artists_sql_container_id" ]]; then
    docker rm --force "$artists_sql_container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup_artists_sql EXIT
artists_sql_container_id="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
artists_sql_ready=false
for artists_sql_attempt in {1..30}; do
  if docker exec "$artists_sql_container_id" pg_isready -U postgres >/dev/null 2>&1; then
    artists_sql_ready=true
    break
  fi
  sleep 1
done
if [[ "$artists_sql_ready" != true ]]; then
  echo "Isolated PostgreSQL did not become ready." >&2
  exit 1
fi
artists_psql() {
  docker exec --interactive "$artists_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 --quiet
}
artists_psql < "$artists_sql_root/tests/sql/artists-rls-bootstrap.sql"
artists_psql < "$artists_sql_root/supabase/migrations/0028_artists.sql"
artists_psql < "$artists_sql_root/tests/sql/artists-rls-before.sql"
artists_psql < "$artists_sql_root/supabase/migrations/20261101190000_artists_row_level_security.sql"
artists_psql < "$artists_sql_root/tests/sql/artists-rls.sql"
echo "artists row level security SQL test passed"
