#!/usr/bin/env bash
# Fresh local PostgreSQL only. Never reads a production URL or credentials.
set -euo pipefail
reopen_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
reopen_sql_container_id=""
cleanup_reopen_sql() {
  if [[ -n "$reopen_sql_container_id" ]]; then
    docker rm --force "$reopen_sql_container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup_reopen_sql EXIT
reopen_sql_container_id="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
reopen_sql_ready=false
for reopen_sql_attempt in {1..30}; do
  if docker exec "$reopen_sql_container_id" pg_isready -U postgres >/dev/null 2>&1; then
    reopen_sql_ready=true
    break
  fi
  sleep 1
done
if [[ "$reopen_sql_ready" != true ]]; then
  echo "Isolated PostgreSQL did not become ready." >&2
  exit 1
fi
docker exec --interactive "$reopen_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 < "$reopen_sql_root/tests/sql/cart-reopen-bootstrap.sql"
# Use the existing production payment-group functions, including legacy IDs.
awk '
  /^create or replace function public.submission_payment_group_ids\(/ { copying = 1 }
  /^create or replace function public.merge_submission_payment_raw_response\(/ { copying = 0 }
  copying { print }
' "$reopen_sql_root/supabase/migrations/0076_submission_payment_integrity.sql" |
  docker exec --interactive "$reopen_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1
docker exec --interactive "$reopen_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 < "$reopen_sql_root/supabase/migrations/0096_reopen_submission_bank_payment.sql"
docker exec --interactive "$reopen_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 < "$reopen_sql_root/tests/sql/cart-reopen.sql"

# Race an administrator's deposit confirmation against a stale browser reopen.
# The second connection must wait for the row lock and then reject the now-paid row.
docker exec --interactive "$reopen_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 <<'SQL'
insert into public.submissions(id, user_id)
values ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111');
SQL
docker exec --interactive "$reopen_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set application_name = 'cart-reopen-test-deposit';
begin;
update public.submissions set payment_status = 'PAID'
where id = '99999999-9999-4999-8999-999999999999';
select pg_sleep(3);
commit;
SQL
reopen_sql_deposit_pid=$!
reopen_sql_lock_ready=false
for reopen_sql_attempt in {1..30}; do
  if [[ "$(docker exec "$reopen_sql_container_id" psql -U postgres -Atc "select exists(select 1 from pg_stat_activity where application_name = 'cart-reopen-test-deposit' and wait_event = 'PgSleep')")" == "t" ]]; then
    reopen_sql_lock_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$reopen_sql_lock_ready" != true ]]; then
  echo "Could not establish the concurrent payment fixture." >&2
  exit 1
fi
docker exec --interactive "$reopen_sql_container_id" psql -U postgres --set ON_ERROR_STOP=1 <<'SQL'
do $$
declare rejected boolean := false;
begin
  begin
    perform * from public.reopen_submission_bank_payment(
      array['99999999-9999-4999-8999-999999999999']::uuid[],
      '11111111-1111-4111-8111-111111111111', '{}'
    );
  exception when sqlstate '55000' then rejected := true;
  end;
  if not rejected
    or (select payment_status <> 'PAID' from public.submissions where id = '99999999-9999-4999-8999-999999999999')
    or exists(select 1 from public.submission_events)
  then raise exception 'Concurrent deposit confirmation was overwritten'; end if;
end;
$$;
SQL
wait "$reopen_sql_deposit_pid"
echo "Cart reopen SQL integration checks passed; disposable container will be removed."
