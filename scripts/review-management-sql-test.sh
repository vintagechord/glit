#!/usr/bin/env bash
# Disposable PostgreSQL with synthetic records; never reads production settings.
set -euo pipefail
review_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
review_sql_container=""
cleanup_review_sql() { if [[ -n "$review_sql_container" ]]; then docker rm --force "$review_sql_container" >/dev/null 2>&1 || true; fi; }
trap cleanup_review_sql EXIT
review_sql_container="$(docker run --pull never --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
# Over TCP: the image's init-time server listens on the socket only and is
# restarted before the real one starts.
for review_sql_attempt in {1..120}; do
  if docker exec "$review_sql_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
review_psql() { docker exec --interactive "$review_sql_container" psql -X -U postgres --set ON_ERROR_STOP=1 "$@"; }
review_psql < "$review_sql_root/tests/sql/review-management-bootstrap.sql"
# The real order-state guard from 0097, so a station save on an album paid
# through an order meets it as in production.
awk '/^create function public.protect_submission_order_state\(/ { copying=1 } copying { print } /^create trigger protect_submission_order_state / { exit }' \
  "$review_sql_root/supabase/migrations/0097_submission_orders.sql" | review_psql
review_psql < "$review_sql_root/supabase/migrations/20261023212253_certificate_result_history.sql"
review_psql < "$review_sql_root/supabase/migrations/20261025080739_station_review_management.sql"
review_psql < "$review_sql_root/supabase/migrations/20261025123610_station_review_bulk_save.sql"
review_psql < "$review_sql_root/supabase/migrations/20261026090000_station_review_status_preservation.sql"
review_psql < "$review_sql_root/supabase/migrations/20261119121000_station_review_keeps_result_stage.sql"
review_psql < "$review_sql_root/supabase/migrations/20261121103000_station_review_keeps_review_stage.sql"
review_psql < "$review_sql_root/tests/sql/review-management.sql"
review_psql < "$review_sql_root/tests/sql/station-review-bulk.sql"
echo "Shared web/Mac review SQL integration passed; disposable database will be removed."
