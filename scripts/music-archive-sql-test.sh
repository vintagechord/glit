#!/usr/bin/env bash
# Only creates a fresh, isolated local PostgreSQL container. No production DB URL is used.
set -euo pipefail
archive_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
archive_sql_container_id=""
archive_sql_image="postgres:17-alpine"
cleanup_archive_sql() {
  if [[ -n "$archive_sql_container_id" ]]; then
    docker rm --force "$archive_sql_container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup_archive_sql EXIT
if ! docker image inspect "$archive_sql_image" >/dev/null 2>&1; then
  echo "Local test image missing. Run: docker pull postgres:17-alpine" >&2
  exit 1
fi
# No published ports, no network, no external credentials. Authentication is local to this disposable container.
archive_sql_container_id="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust "$archive_sql_image")"
archive_sql_ready=false
for archive_sql_attempt in {1..30}; do
  if docker exec "$archive_sql_container_id" pg_isready -U postgres >/dev/null 2>&1; then
    archive_sql_ready=true
    break
  fi
  sleep 1
done
if [[ "$archive_sql_ready" != true ]]; then
  echo "Isolated PostgreSQL did not become ready." >&2
  exit 1
fi
docker exec --interactive "$archive_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 <<'SQL'
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.profiles(user_id uuid primary key references auth.users(id),role text not null);
SQL
docker exec --interactive "$archive_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 < "$archive_sql_root/supabase/migrations/0095_music_archive.sql"
docker exec --interactive "$archive_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 < "$archive_sql_root/supabase/migrations/0099_music_archive_domestic_catalog.sql"
docker exec --interactive "$archive_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 < "$archive_sql_root/tests/sql/music-archive.sql"
docker exec --interactive "$archive_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 < "$archive_sql_root/tests/sql/music-archive-domestic.sql"
echo "Music archive SQL integration checks passed; disposable container will be removed."
