\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_reopen_rejected(
  ids uuid[], owner_id uuid, tokens jsonb, expected_state text
) returns void language plpgsql as $$
declare
  before_submissions jsonb;
  before_events bigint;
  rejected boolean := false;
begin
  select jsonb_agg(to_jsonb(s) order by s.id) into before_submissions from public.submissions s;
  select count(*) into before_events from public.submission_events;
  begin
    perform * from public.reopen_submission_bank_payment(ids, owner_id, tokens);
  exception when others then
    if sqlstate <> expected_state then
      raise exception 'Expected SQLSTATE %, received %: %', expected_state, sqlstate, sqlerrm;
    end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Unsafe reopen unexpectedly succeeded'; end if;
  if before_submissions is distinct from (select jsonb_agg(to_jsonb(s) order by s.id) from public.submissions s)
    or before_events <> (select count(*) from public.submission_events)
  then raise exception 'Rejected operation changed a submission or audit history'; end if;
end;
$$;

insert into public.submissions (id, user_id, album_draft_group_id) values
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('00000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', null);
insert into public.submissions (id, guest_token, album_draft_group_id) values
  ('00000000-0000-4000-8000-000000000004', 'guest-token-four', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('00000000-0000-4000-8000-000000000005', 'guest-token-five', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.submission_files(submission_id, file_path, original_name)
  values ('00000000-0000-4000-8000-000000000001', 'existing/private/master.wav', 'master.wav');
insert into public.station_reviews(submission_id)
  values ('00000000-0000-4000-8000-000000000001');

do $$
begin
  if has_function_privilege('anon', 'public.reopen_submission_bank_payment(uuid[],uuid,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.reopen_submission_bank_payment(uuid[],uuid,jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.reopen_submission_bank_payment(uuid[],uuid,jsonb)', 'execute')
  then raise exception 'RPC execution is not restricted to the service role'; end if;
end;
$$;

-- Member ownership, complete groups, missing/unknown rows and guest token maps.
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000001']::uuid[], '11111111-1111-4111-8111-111111111111', '{}', '55000');
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000003']::uuid[], '11111111-1111-4111-8111-111111111111', '{}', '42501');
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000099']::uuid[], '11111111-1111-4111-8111-111111111111', '{}', 'P0002');
select pg_temp.expect_reopen_rejected(array[]::uuid[], null, '{}', '22023');
select pg_temp.expect_reopen_rejected(array[null]::uuid[], null, '{}', '22023');
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005']::uuid[], null,
  '{"00000000-0000-4000-8000-000000000004":"guest-token-five","00000000-0000-4000-8000-000000000005":"guest-token-four"}', '42501');
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005']::uuid[], null,
  '{"00000000-0000-4000-8000-000000000004":"guest-token-four"}', '42501');

-- Execute success as the real RPC caller role, not as the fixture superuser.
set local role service_role;
select * from public.reopen_submission_bank_payment(
  array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']::uuid[],
  '11111111-1111-4111-8111-111111111111', '{}'
);
reset role;
do $$
begin
  if (select count(*) from public.submissions where status = 'SUBMITTED' and payment_status = 'UNPAID') <> 2
    or (select count(*) from public.submission_events where actor_user_id = '11111111-1111-4111-8111-111111111111'
      and event_type = 'PAYMENT_UPDATE'
      and message = '입금 전 결제 수단 재선택을 위해 무통장 입금 신청이 취소되었습니다.') <> 2
    or exists(select 1 from public.submissions where amount_krw <> 50000 or payment_method <> 'BANK'
      or title <> 'Preserve this title' or applicant_email <> 'fixture@example.test'
      or album_price_tier <> 'FULL' or album_base_price_krw <> 50000)
    or (select file_path from public.submission_files limit 1) <> 'existing/private/master.wav'
  then raise exception 'Successful reopen lost data or failed to audit the whole group'; end if;
end;
$$;
-- Repeated clicks cannot create additional audit events or alter ordinary unpaid rows.
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']::uuid[], '11111111-1111-4111-8111-111111111111', '{}', '55000');
select * from public.reopen_submission_bank_payment(
  array['00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005']::uuid[], null,
  '{"00000000-0000-4000-8000-000000000004":"guest-token-four","00000000-0000-4000-8000-000000000005":"guest-token-five"}'
);

-- Every invalid parent lifecycle rejects the whole batch, never just one row.
update public.submissions set status = 'WAITING_PAYMENT', payment_status = 'PAYMENT_PENDING';
do $$
declare
  ids uuid[] := array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']::uuid[];
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  bad_status text;
begin
  foreach bad_status in array array['DRAFT','PRE_REVIEW','IN_PROGRESS','RESULT_READY','COMPLETED'] loop
    update public.submissions set status = bad_status::submission_status where id = ids[2];
    perform pg_temp.expect_reopen_rejected(ids, owner_id, '{}', '55000');
  end loop;
  update public.submissions set status = 'WAITING_PAYMENT' where id = ids[2];
  foreach bad_status in array array['UNPAID','PAID','REFUNDED'] loop
    update public.submissions set payment_status = bad_status::payment_status where id = ids[2];
    perform pg_temp.expect_reopen_rejected(ids, owner_id, '{}', '55000');
  end loop;
  update public.submissions set payment_status = 'PAYMENT_PENDING' where id = ids[2];
  foreach bad_status in array array['CARD','PAYPAL'] loop
    update public.submissions set payment_method = bad_status::payment_method where id = ids[2];
    perform pg_temp.expect_reopen_rejected(ids, owner_id, '{}', '55000');
  end loop;
  update public.submissions set payment_method = 'BANK', result_status = 'APPROVED' where id = ids[2];
  perform pg_temp.expect_reopen_rejected(ids, owner_id, '{}', '55000');
  update public.submissions set result_status = null, result_notified_at = now() where id = ids[2];
  perform pg_temp.expect_reopen_rejected(ids, owner_id, '{}', '55000');
  update public.submissions set result_notified_at = null, user_deleted_at = now() where id = ids[2];
  perform pg_temp.expect_reopen_rejected(ids, owner_id, '{}', '55000');
  update public.submissions set user_deleted_at = null where id = ids[2];
end;
$$;

-- Payment group membership must include both current and legacy related IDs.
insert into public.submission_payments(submission_id, status, raw_response) values
  ('00000000-0000-4000-8000-000000000003', 'REQUESTED', '{"paymentGroup":{"relatedSubmissionIds":["00000000-0000-4000-8000-000000000002"]}}');
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']::uuid[], '11111111-1111-4111-8111-111111111111', '{}', '55000');
update public.submission_payments set status = 'APPROVED', raw_response = '{"paymentGroup":{"submissionIds":["00000000-0000-4000-8000-000000000002"]}}';
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']::uuid[], '11111111-1111-4111-8111-111111111111', '{}', '55000');
update public.submission_payments set status = 'CANCELED';
update public.station_reviews set status = 'APPROVED';
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']::uuid[], '11111111-1111-4111-8111-111111111111', '{}', '55000');
update public.station_reviews set status = 'NOT_SENT';

-- Audit insertion failure rolls back the state transition as one transaction.
alter table public.submission_events add constraint reject_test_events check (false) not valid;
select pg_temp.expect_reopen_rejected(array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']::uuid[], '11111111-1111-4111-8111-111111111111', '{}', '23514');
alter table public.submission_events drop constraint reject_test_events;
select * from public.reopen_submission_bank_payment(
  array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']::uuid[],
  '11111111-1111-4111-8111-111111111111', '{}'
);
rollback;
\echo 'Cart reopen ownership, lifecycle, group, payment, audit and role assertions passed.'
