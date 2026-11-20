#!/usr/bin/env bash
# Disposable local PostgreSQL with synthetic records; no application secrets or remote DB connections.
set -euo pipefail
karaoke_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
karaoke_sql_container_id=""
cleanup_karaoke_sql() {
  if [[ -n "$karaoke_sql_container_id" ]]; then docker rm --force "$karaoke_sql_container_id" >/dev/null 2>&1 || true; fi
}
trap cleanup_karaoke_sql EXIT
karaoke_sql_container_id="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
karaoke_sql_ready=false
# Over TCP: the image's init-time server listens on the socket only and is
# restarted before the real one starts.
for karaoke_sql_attempt in {1..120}; do
  if docker exec "$karaoke_sql_container_id" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then karaoke_sql_ready=true; break; fi
  sleep 1
done
if [[ "$karaoke_sql_ready" != true ]]; then echo "Isolated PostgreSQL did not become ready." >&2; exit 1; fi
karaoke_psql() { docker exec --interactive "$karaoke_sql_container_id" psql -X -U postgres --set ON_ERROR_STOP=1 "$@"; }
karaoke_psql < "$karaoke_sql_root/tests/sql/karaoke-payment-bootstrap.sql"
for karaoke_sql_migration in \
  0033_karaoke_payments.sql \
  0082_karaoke_payment_integrity.sql \
  0084_payment_audit_privacy.sql \
  20261103133000_karaoke_approval_claim.sql \
  20261121102000_karaoke_payment_retry_after_abandoned_attempt.sql; do
  karaoke_psql --single-transaction < "$karaoke_sql_root/supabase/migrations/$karaoke_sql_migration"
done
karaoke_psql < "$karaoke_sql_root/tests/sql/karaoke-payment-integrity.sql"

# Committed fixtures for two real database connections racing each other.
karaoke_psql <<'SQL'
insert into auth.users (id, aud, role)
values ('96666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated');
insert into public.karaoke_requests (id, user_id, title, payment_method, payment_status, amount_krw) values
  ('97777777-7777-4777-8777-777777777777', '96666666-6666-4666-8666-666666666666', 'Claim race', 'CARD', 'UNPAID', 50000),
  ('98888888-8888-4888-8888-888888888888', '96666666-6666-4666-8666-666666666666', 'Supersede race', 'CARD', 'UNPAID', 50000);
select * from public.begin_karaoke_payment_order('97777777-7777-4777-8777-777777777777', '96666666-6666-4666-8666-666666666666',
  'KRP-RACE-CLAIMED', 50000, '{"closeState":"01234567-89ab-4cde-8fab-0123456789ab"}');
select * from public.begin_karaoke_payment_order('98888888-8888-4888-8888-888888888888', '96666666-6666-4666-8666-666666666666',
  'KRP-RACE-ABANDONED', 50000, '{"closeState":"01234567-89ab-4cde-8fab-0123456789ab"}');
SQL
# The holder sleeps 30 seconds so a slow docker exec still finds it holding the lock.
karaoke_wait_for_sleep() {
  local karaoke_wait_deadline=$((SECONDS + 120))
  while (( SECONDS < karaoke_wait_deadline )); do
    if [[ "$(karaoke_psql -Atc "select exists(select 1 from pg_stat_activity where application_name='$1' and wait_event='PgSleep')")" == t ]]; then return 0; fi
    sleep 0.2
  done
  echo "Race fixture $1 not ready" >&2
  return 1
}

# The gateway callback claims an attempt while the member presses pay again:
# begin waits for the claim's row lock, then refuses instead of superseding it.
karaoke_psql >/dev/null <<'SQL' &
set application_name='karaoke-claim-race';
begin;
select * from public.claim_inicis_karaoke_approval('KRP-RACE-CLAIMED','01234567-89ab-4cde-8fab-0123456789ab');
select pg_sleep(30);
commit;
SQL
karaoke_claim_pid=$!
karaoke_wait_for_sleep karaoke-claim-race
karaoke_psql <<'SQL'
do $$ declare refused boolean := false; started timestamptz := clock_timestamp(); begin
  begin
    perform public.begin_karaoke_payment_order('97777777-7777-4777-8777-777777777777', '96666666-6666-4666-8666-666666666666',
      'KRP-RACE-SECOND', 50000, '{"closeState":"01234567-89ab-4cde-8fab-0123456789ab"}');
  exception when sqlstate '55000' then
    if sqlerrm <> 'KARAOKE_PAYMENT_ALREADY_IN_PROGRESS' then raise; end if;
    refused := true;
  end;
  raise notice 'begin waited % for the approval claim', clock_timestamp() - started;
  if not refused or exists(select 1 from public.karaoke_payments where order_id='KRP-RACE-SECOND')
    or not exists(select 1 from public.karaoke_payments where order_id='KRP-RACE-CLAIMED' and status='REQUESTED' and result_code='APPROVAL_IN_PROGRESS') then
    raise exception 'A concurrent begin superseded an attempt that was being approved'; end if;
end $$;
SQL
wait "$karaoke_claim_pid"

# A late callback for the abandoned attempt arrives while a new begin
# supersedes it: the claim waits for begin, then finds the attempt closed.
karaoke_psql >/dev/null <<'SQL' &
set application_name='karaoke-supersede-race';
begin;
select * from public.begin_karaoke_payment_order('98888888-8888-4888-8888-888888888888', '96666666-6666-4666-8666-666666666666',
  'KRP-RACE-NEW', 50000, '{"closeState":"01234567-89ab-4cde-8fab-0123456789ab"}');
select pg_sleep(30);
commit;
SQL
karaoke_supersede_pid=$!
karaoke_wait_for_sleep karaoke-supersede-race
karaoke_psql <<'SQL'
do $$ declare refused boolean := false; started timestamptz := clock_timestamp(); begin
  begin
    perform public.claim_inicis_karaoke_approval('KRP-RACE-ABANDONED','01234567-89ab-4cde-8fab-0123456789ab');
  exception when sqlstate '55000' then refused := true;
  end;
  raise notice 'the late claim waited % for begin', clock_timestamp() - started;
  if not refused
    or not exists(select 1 from public.karaoke_payments where order_id='KRP-RACE-ABANDONED' and status='CANCELED' and result_code='SUPERSEDED')
    or not exists(select 1 from public.karaoke_requests where id='98888888-8888-4888-8888-888888888888' and order_id='KRP-RACE-NEW') then
    raise exception 'A late callback claimed an attempt that a new payment superseded'; end if;
end $$;
SQL
wait "$karaoke_supersede_pid"
echo "Karaoke payment SQL checks passed; disposable container will be removed."
