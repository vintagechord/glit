#!/usr/bin/env bash
# Disposable local PostgreSQL only: no production credentials or network.
set -euo pipefail
supplement_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
supplement_sql_container=""
cleanup_supplement_sql() {
  if [[ -n "$supplement_sql_container" ]]; then docker rm --force "$supplement_sql_container" >/dev/null 2>&1 || true; fi
}
trap cleanup_supplement_sql EXIT
supplement_sql_container="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
for supplement_sql_attempt in {1..30}; do
  if docker exec "$supplement_sql_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
supplement_psql() { docker exec --interactive "$supplement_sql_container" psql -U postgres --set ON_ERROR_STOP=1 "$@"; }
supplement_psql < "$supplement_sql_root/tests/sql/cart-reopen-bootstrap.sql"
supplement_psql <<'SQL'
create schema auth;
create table auth.users(id uuid primary key);
create table public.profiles(user_id uuid primary key references auth.users(id), role text not null);
create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;
grant usage on schema auth to service_role;
grant select on auth.users, public.profiles to service_role;
SQL
supplement_psql < "$supplement_sql_root/supabase/migrations/0081_multipart_upload_grants.sql"
supplement_psql < "$supplement_sql_root/supabase/migrations/20261023210008_submission_supplements.sql"
supplement_psql < "$supplement_sql_root/tests/sql/submission-supplements.sql"
echo "Supplement SQL integration passed; disposable database will be removed."
