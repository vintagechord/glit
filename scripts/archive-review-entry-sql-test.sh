#!/usr/bin/env bash
# All production migrations on a disposable local PostgreSQL instance. No remote DB or secrets.
set -euo pipefail
archive_review_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
archive_review_sql_container_id=""
cleanup_archive_review_sql() { if [[ -n "$archive_review_sql_container_id" ]]; then docker rm --force "$archive_review_sql_container_id" >/dev/null 2>&1 || true; fi; }
trap cleanup_archive_review_sql EXIT
archive_review_sql_container_id="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
for archive_review_sql_attempt in {1..30}; do
  if docker exec "$archive_review_sql_container_id" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
archive_review_psql() { docker exec --interactive "$archive_review_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 "$@"; }
archive_review_psql <<'SQL'
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key, aud text, role text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user::text)$$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
SQL
for archive_review_migration in "$archive_review_sql_root"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$archive_review_migration")"
  archive_review_psql < "$archive_review_migration"
done
archive_review_psql < "$archive_review_sql_root/tests/sql/archive-review-entry.sql"
echo "Archive review entry SQL checks passed; disposable container will be removed."
