#!/usr/bin/env bash
# Disposable PostgreSQL with synthetic records; never reads production settings.
set -euo pipefail
review_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
review_sql_container=""
cleanup_review_sql() { if [[ -n "$review_sql_container" ]]; then docker rm --force "$review_sql_container" >/dev/null 2>&1 || true; fi; }
trap cleanup_review_sql EXIT
review_sql_container="$(docker run --pull never --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
for review_sql_attempt in {1..30}; do
  if docker exec "$review_sql_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
review_psql() { docker exec --interactive "$review_sql_container" psql -X -U postgres --set ON_ERROR_STOP=1 "$@"; }
review_psql < "$review_sql_root/tests/sql/review-management-bootstrap.sql"
review_psql < "$review_sql_root/supabase/migrations/20261023212253_certificate_result_history.sql"
review_psql < "$review_sql_root/supabase/migrations/20261025080739_station_review_management.sql"
review_psql < "$review_sql_root/tests/sql/review-management.sql"
echo "Shared web/Mac review SQL integration passed; disposable database will be removed."
