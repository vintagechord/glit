#!/usr/bin/env bash
# Runs only against a fresh, network-isolated local PostgreSQL container.
set -euo pipefail
magazine_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
magazine_sql_container=""
cleanup_magazine_sql() {
  if [[ -n "$magazine_sql_container" ]]; then
    docker rm --force "$magazine_sql_container" >/dev/null 2>&1 || true
  fi
}
trap cleanup_magazine_sql EXIT
magazine_sql_container="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
magazine_sql_ready=false
for magazine_sql_attempt in {1..30}; do
  if docker exec "$magazine_sql_container" pg_isready -U postgres >/dev/null 2>&1; then
    magazine_sql_ready=true
    break
  fi
  sleep 1
done
if [[ "$magazine_sql_ready" != true ]]; then
  echo "Isolated PostgreSQL did not become ready." >&2
  exit 1
fi
run_magazine_sql() {
  docker exec --interactive "$magazine_sql_container" psql -U postgres --set ON_ERROR_STOP=1 "$@"
}
run_magazine_sql < "$magazine_sql_root/tests/sql/magazine-credit-bootstrap.sql"
for magazine_sql_migration in \
  0048_magazine_requests.sql \
  0051_credit_rewards.sql \
  0054_credit_studio_reservations.sql \
  0059_admin_credit_grants.sql \
  0064_credit_grants_balance_and_magazine_reuse.sql \
  0066_magazine_free_credit_requests.sql \
  0070_generalize_credit_service_requests.sql; do
  run_magazine_sql < "$magazine_sql_root/supabase/migrations/$magazine_sql_migration"
done
run_magazine_sql <<'SQL'
insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.credit_grants(user_id,amount) values
  ('11111111-1111-4111-8111-111111111111',4),
  ('22222222-2222-4222-8222-222222222222',2),
  ('33333333-3333-4333-8333-333333333333',3);
insert into public.magazine_requests(id,user_id,target_channel,requester_name,requester_email)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','11111111-1111-4111-8111-111111111111','MEDIA','Legacy','test@example.test');
insert into public.credit_rewards(id,title,credits_required)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','One-credit service',1);
SQL
run_magazine_sql < "$magazine_sql_root/supabase/migrations/20261020092015_magazine_three_credit_requests.sql"
run_magazine_sql < "$magazine_sql_root/tests/sql/magazine-three-credits.sql"

# A simultaneous service redemption waits for the magazine transaction, then
# rejects the exhausted balance; the shared user lock prevents double spending.
run_magazine_sql >/dev/null <<'SQL' &
set application_name = 'magazine-credit-concurrency-test';
begin;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select public.create_magazine_request(null,'MEDIA','Race','test@example.test',null,null,null,null,null,null,null,null,null,null);
select pg_sleep(3);
commit;
SQL
magazine_sql_request_pid=$!
magazine_sql_lock_ready=false
for magazine_sql_attempt in {1..30}; do
  if [[ "$(run_magazine_sql -Atc "select exists(select 1 from pg_stat_activity where application_name = 'magazine-credit-concurrency-test' and wait_event = 'PgSleep')")" == "t" ]]; then
    magazine_sql_lock_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$magazine_sql_lock_ready" != true ]]; then
  echo "Could not establish concurrent magazine request." >&2
  exit 1
fi
run_magazine_sql <<'SQL'
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
do $test$
declare failed boolean := false;
begin
  begin
    perform public.redeem_credit_reward('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  exception when others then
    if sqlerrm <> 'INSUFFICIENT_CREDITS' then raise; end if;
    failed := true;
  end;
  assert failed, 'Concurrent service redemption overdraws magazine credits';
  assert (select sum(credits_spent) = 3 from public.magazine_requests where user_id = auth.uid());
  assert not exists(select 1 from public.credit_reward_redemptions where user_id = auth.uid());
end;
$test$;
SQL
wait "$magazine_sql_request_pid"
echo "Magazine credit SQL boundary, historical charge, cancellation and concurrency checks passed."
