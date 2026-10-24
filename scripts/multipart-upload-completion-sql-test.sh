#!/usr/bin/env bash
# No application environment, host ports, credentials or external database.
# postgres:17-alpine must already be present; --pull never avoids network.
set -euo pipefail
multipart_sql_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
multipart_sql_container=""
multipart_sql_logs="$(mktemp -d "${TMPDIR:-/tmp}/onside-multipart-sql.XXXXXX")"
multipart_sql_pids=()
cleanup_multipart_sql() {
  for multipart_sql_pid in "${multipart_sql_pids[@]:-}"; do
    if [[ -n "$multipart_sql_pid" ]]; then kill "$multipart_sql_pid" >/dev/null 2>&1 || true; fi
  done
  if [[ -n "$multipart_sql_container" ]]; then docker rm --force "$multipart_sql_container" >/dev/null 2>&1 || true; fi
  rm -rf -- "$multipart_sql_logs"
}
trap cleanup_multipart_sql EXIT
multipart_sql_container="$(docker run --pull never --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
for multipart_sql_attempt in {1..30}; do
  if docker exec "$multipart_sql_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
multipart_psql() { docker exec --interactive "$multipart_sql_container" psql -X -U postgres --set ON_ERROR_STOP=1 "$@"; }
multipart_psql < "$multipart_sql_root/tests/sql/cart-reopen-bootstrap.sql"
multipart_psql <<'SQL'
create schema auth;
create table auth.users(id uuid primary key);
create table public.profiles(user_id uuid primary key references auth.users(id), role text not null);
create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;
grant usage on schema auth to service_role;
grant select on auth.users, public.profiles to service_role;
SQL
multipart_psql < "$multipart_sql_root/supabase/migrations/0081_multipart_upload_grants.sql"
multipart_sql_legacy_before="$(multipart_psql -Atc "select md5(pg_get_functiondef('public.claim_multipart_upload_grant(uuid,uuid,text,text,text,integer[])'::regprocedure));")"
multipart_psql < "$multipart_sql_root/supabase/migrations/20261024075936_multipart_completion_manifest.sql"
multipart_sql_legacy_after="$(multipart_psql -Atc "select md5(pg_get_functiondef('public.claim_multipart_upload_grant(uuid,uuid,text,text,text,integer[])'::regprocedure));")"
[[ "$multipart_sql_legacy_before" == "$multipart_sql_legacy_after" ]] || { echo 'Legacy claim definition changed' >&2; exit 1; }
# Run the entire existing paid-supplement SQL regression with the new column.
multipart_psql < "$multipart_sql_root/supabase/migrations/20261023210008_submission_supplements.sql"
multipart_psql < "$multipart_sql_root/tests/sql/submission-supplements.sql"
multipart_psql < "$multipart_sql_root/tests/sql/multipart-upload-completion.sql"

wait_multipart_session() {
  local multipart_wait_app="$1" multipart_wait_kind="$2" multipart_wait_seen
  for multipart_wait_attempt in {1..60}; do
    if [[ "$multipart_wait_kind" == 'sleep' ]]; then
      multipart_wait_seen="$(multipart_psql -Atc "select count(*) from pg_stat_activity where application_name='$multipart_wait_app' and wait_event='PgSleep';")"
    else
      multipart_wait_seen="$(multipart_psql -Atc "select count(*) from pg_stat_activity where application_name='$multipart_wait_app' and wait_event_type='Lock';")"
    fi
    if [[ "$multipart_wait_seen" == '1' ]]; then return 0; fi
    sleep 0.05
  done
  echo "Expected database wait not observed: $multipart_wait_app / $multipart_wait_kind" >&2
  return 1
}

run_multipart_race() {
  local multipart_race_number="$1" multipart_race_second_hash="$2" multipart_race_expected="$3"
  local multipart_race_a="multipart_sql_${multipart_race_number}_a" multipart_race_b="multipart_sql_${multipart_race_number}_b"
  local multipart_race_a_pid multipart_race_b_pid
  multipart_psql -At > "$multipart_sql_logs/$multipart_race_a.log" 2>&1 <<SQL &
set application_name='$multipart_race_a';
begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.claim_multipart_upload_completion('44444444-4444-4444-8444-00000000000$multipart_race_number','dddddddd-dddd-4ddd-8ddd-dddddddddddd','manifest-sql-$multipart_race_number','fixture/manifest/$multipart_race_number.wav','user:11111111-1111-4111-8111-111111111111',array[1,2],repeat('a',64));
select pg_sleep(5);
commit;
SQL
  multipart_race_a_pid=$!
  multipart_sql_pids+=("$multipart_race_a_pid")
  wait_multipart_session "$multipart_race_a" sleep
  multipart_psql -At > "$multipart_sql_logs/$multipart_race_b.log" 2>&1 <<SQL &
set application_name='$multipart_race_b';
set role service_role;
set request.jwt.claim.role='service_role';
do \$\$
declare outcome text;
begin
  begin
    outcome := public.claim_multipart_upload_completion('44444444-4444-4444-8444-00000000000$multipart_race_number','dddddddd-dddd-4ddd-8ddd-dddddddddddd','manifest-sql-$multipart_race_number','fixture/manifest/$multipart_race_number.wav','user:11111111-1111-4111-8111-111111111111',array[1,2],repeat('$multipart_race_second_hash',64));
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'MULTIPART_MANIFEST_MISMATCH' then raise; end if;
    outcome := 'CONFLICT_REJECTED';
  end;
  if outcome <> '$multipart_race_expected' then raise exception 'Unexpected concurrent outcome: %',outcome; end if;
  raise notice 'RACE_RESULT:%',outcome;
end \$\$;
SQL
  multipart_race_b_pid=$!
  multipart_sql_pids+=("$multipart_race_b_pid")
  wait_multipart_session "$multipart_race_b" lock
  if ! wait "$multipart_race_a_pid"; then cat "$multipart_sql_logs/$multipart_race_a.log" >&2; return 1; fi
  if ! wait "$multipart_race_b_pid"; then cat "$multipart_sql_logs/$multipart_race_b.log" >&2; return 1; fi
  rg -q '^START$' "$multipart_sql_logs/$multipart_race_a.log"
  rg -q "RACE_RESULT:$multipart_race_expected" "$multipart_sql_logs/$multipart_race_b.log"
  multipart_psql <<SQL
do \$\$ begin
  if not exists (select 1 from public.multipart_upload_grants where id='44444444-4444-4444-8444-00000000000$multipart_race_number' and status='COMPLETING' and completion_manifest_hash=repeat('a',64) and consumed_at is null)
    then raise exception 'Concurrent claim corrupted grant'; end if;
end \$\$;
SQL
  echo "PASS: concurrent grant $multipart_race_number waited on row lock, then $multipart_race_expected."
}
run_multipart_race 6 a COMPLETING
run_multipart_race 7 b CONFLICT_REJECTED
multipart_sql_pids=()
echo 'Multipart completion SQL integration passed; isolated PostgreSQL 17 will be removed.'
