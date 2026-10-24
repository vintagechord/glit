#!/usr/bin/env bash
# Disposable local PostgreSQL only; no production credentials or network.
set -euo pipefail
certificate_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
certificate_sql_container=""
cleanup_certificate_sql() {
  if [[ -n "$certificate_sql_container" ]]; then docker rm --force "$certificate_sql_container" >/dev/null 2>&1 || true; fi
}
trap cleanup_certificate_sql EXIT
certificate_sql_container="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
for certificate_sql_attempt in {1..30}; do
  if docker exec "$certificate_sql_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
certificate_psql() { docker exec --interactive "$certificate_sql_container" psql -U postgres --set ON_ERROR_STOP=1 "$@"; }
certificate_psql < "$certificate_sql_root/tests/sql/cart-reopen-bootstrap.sql"
certificate_psql < "$certificate_sql_root/supabase/migrations/0037_certificate_fields.sql"
certificate_psql <<'SQL'
create table public.profiles(user_id uuid primary key, role text not null);
grant select on public.profiles to service_role;
SQL
certificate_psql < "$certificate_sql_root/supabase/migrations/20261023212253_certificate_result_history.sql"
certificate_psql < "$certificate_sql_root/tests/sql/certificate-history.sql"
echo "Certificate history SQL integration passed; disposable database will be removed."
