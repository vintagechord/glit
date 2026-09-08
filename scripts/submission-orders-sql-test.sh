#!/usr/bin/env bash
# Disposable local PostgreSQL; no application secrets or remote DB connections.
set -euo pipefail
order_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
order_sql_container_id=""
cleanup_order_sql() {
  if [[ -n "$order_sql_container_id" ]]; then docker rm --force "$order_sql_container_id" >/dev/null 2>&1 || true; fi
}
trap cleanup_order_sql EXIT
order_sql_container_id="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
for order_sql_attempt in {1..30}; do
  if docker exec "$order_sql_container_id" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
order_psql() { docker exec --interactive "$order_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 "$@"; }
order_psql < "$order_sql_root/tests/sql/cart-reopen-bootstrap.sql"
order_psql < "$order_sql_root/tests/sql/submission-orders-bootstrap.sql"
order_psql < "$order_sql_root/supabase/migrations/0075_claim_guest_cart_submissions.sql"
# All real 0076 RPC/trigger definitions, excluding only its historical price backfill.
awk '/^create or replace function public.assert_album_price_snapshots\(/ { copying=1 } copying { print }' \
  "$order_sql_root/supabase/migrations/0076_submission_payment_integrity.sql" | order_psql
order_psql < "$order_sql_root/supabase/migrations/0096_reopen_submission_bank_payment.sql"
order_psql --single-transaction < "$order_sql_root/supabase/migrations/0097_submission_orders.sql"
order_psql --single-transaction < "$order_sql_root/supabase/migrations/0098_inicis_approval_claim.sql"
order_psql < "$order_sql_root/tests/sql/submission-orders.sql"

# Two real database connections compete for the same external approval claim.
order_psql >/dev/null <<'SQL' &
set application_name='orders-claim-race';
begin;
select * from public.claim_inicis_submission_approval('LEGACY-PENDING','11111111-1111-4111-8111-111111111111');
select pg_sleep(3);
commit;
SQL
order_claim_pid=$!
order_claim_ready=false
for order_sql_attempt in {1..30}; do
  if [[ "$(order_psql -Atc "select exists(select 1 from pg_stat_activity where application_name='orders-claim-race' and wait_event='PgSleep')")" == t ]]; then order_claim_ready=true; break; fi
  sleep 0.1
done
if [[ "$order_claim_ready" != true ]]; then echo 'Claim race fixture not ready' >&2; exit 1; fi
order_psql <<'SQL'
do $$ declare r record; begin
  select * into r from public.claim_inicis_submission_approval('LEGACY-PENDING','11111111-1111-4111-8111-111111111111');
  if not r.already_processing or r.already_approved then raise exception 'Concurrent claim acquired twice'; end if;
end $$;
SQL
wait "$order_claim_pid"

# A deposit confirmation winning the parent locks must prevent stale return.
order_psql >/dev/null <<'SQL' &
set application_name='orders-bank-race';
begin;
select * from public.confirm_submission_order_bank_payment(
  (select current_order_id from public.submissions where id='00000000-0000-4000-8000-000000000003'),
  '99999999-9999-4999-8999-999999999999',null);
select pg_sleep(3);
commit;
SQL
order_bank_pid=$!
order_bank_ready=false
for order_sql_attempt in {1..30}; do
  if [[ "$(order_psql -Atc "select exists(select 1 from pg_stat_activity where application_name='orders-bank-race' and wait_event='PgSleep')")" == t ]]; then order_bank_ready=true; break; fi
  sleep 0.1
done
if [[ "$order_bank_ready" != true ]]; then echo 'Bank race fixture not ready' >&2; exit 1; fi
order_psql <<'SQL'
do $$ declare oid uuid; rejected boolean:=false; begin
  select current_order_id into oid from public.submissions where id='00000000-0000-4000-8000-000000000003';
  begin
    perform * from public.return_submission_order_to_cart(oid,'11111111-1111-4111-8111-111111111111','{}');
  exception when sqlstate '55000' then rejected:=true; end;
  if not rejected or (select status from public.submission_orders where id=oid)<>'PAID'
    or exists(select 1 from public.submissions where current_order_id=oid and payment_status<>'PAID') then
    raise exception 'Concurrent bank confirmation was overwritten'; end if;
end $$;
SQL
wait "$order_bank_pid"
echo "Submission orders SQL checks passed; disposable container will be removed."
