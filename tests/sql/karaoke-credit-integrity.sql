create extension if not exists dblink;

drop role if exists karaoke_concurrency_test;
create role karaoke_concurrency_test login password 'local-karaoke-test-only';

select set_config('request.jwt.claim.role', 'service_role', false);

delete from auth.users
where id in (
  '51111111-1111-4111-8111-111111111111',
  '52222222-2222-4222-8222-222222222222',
  '53333333-3333-4333-8333-333333333333',
  '54444444-4444-4444-8444-444444444444'
);

insert into auth.users (id, aud, role) values
  ('51111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated'),
  ('52222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated'),
  ('53333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated'),
  ('54444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated');

insert into public.karaoke_credits (user_id, balance) values
  ('51111111-1111-4111-8111-111111111111', 5),
  ('52222222-2222-4222-8222-222222222222', 5),
  ('53333333-3333-4333-8333-333333333333', 0),
  ('54444444-4444-4444-8444-444444444444', 5);

insert into public.submissions (
  id, user_id, type, title, status, payment_status, amount_krw
) values
  (
    '55555555-5555-4555-8555-555555555555',
    '51111111-1111-4111-8111-111111111111',
    'ALBUM', 'Contribution target', 'SUBMITTED', 'UNPAID', 1000
  ),
  (
    '56666666-6666-4666-8666-666666666666',
    '51111111-1111-4111-8111-111111111111',
    'ALBUM', 'Moderation target', 'SUBMITTED', 'UNPAID', 1000
  ),
  (
    '57777777-7777-4777-8777-777777777777',
    '51111111-1111-4111-8111-111111111111',
    'ALBUM', 'Concurrency target', 'SUBMITTED', 'UNPAID', 1000
  );

do $test$
declare
  v_row record;
  v_request_id uuid;
  v_promotion_id uuid;
  v_balance integer;
  v_count integer;
  v_status text;
  v_tj_enabled boolean;
  v_reference_url text;
begin
  assert not has_function_privilege(
    'anon',
    'public.create_karaoke_request_with_promotion(uuid,text,text,text,text,text,public.payment_method,integer,text,boolean,boolean,text,text,text,boolean,integer)',
    'EXECUTE'
  );
  assert not has_function_privilege(
    'authenticated',
    'public.contribute_karaoke_promotion_credits(uuid,uuid,uuid,integer,boolean,boolean,text)',
    'EXECUTE'
  );
  assert has_function_privilege(
    'service_role',
    'public.set_karaoke_vote_status(uuid,text)',
    'EXECUTE'
  );

  select * into v_row
  from public.create_karaoke_request_with_promotion(
    '51111111-1111-4111-8111-111111111111',
    'Atomic request',
    'Artist',
    '01012345678',
    null,
    null,
    'BANK',
    50000,
    'Depositor',
    true,
    true,
    null,
    null,
    null,
    true,
    2
  );
  v_request_id := v_row.result_request_id;
  assert v_request_id is not null;
  select balance into v_balance
  from public.karaoke_credits
  where user_id = '51111111-1111-4111-8111-111111111111';
  assert v_balance = 3;
  select id, credits_balance, status
    into v_promotion_id, v_balance, v_status
  from public.karaoke_promotions
  where karaoke_request_id = v_request_id;
  assert v_balance = 2 and v_status = 'ACTIVE';
  select count(*) into v_count
  from public.karaoke_credit_events
  where user_id = '51111111-1111-4111-8111-111111111111'
    and delta = -2
    and reason = '노래방 추천 공개 크레딧 예치';
  assert v_count = 1;

  begin
    perform public.create_karaoke_request_with_promotion(
      '51111111-1111-4111-8111-111111111111',
      'Must roll back',
      null,
      '01012345678',
      null,
      null,
      'BANK',
      50000,
      'Depositor',
      true,
      true,
      null,
      null,
      null,
      true,
      4
    );
    raise exception 'expected insufficient request escrow to fail';
  exception when sqlstate '22000' then null;
  end;
  select count(*) into v_count
  from public.karaoke_requests where title = 'Must roll back';
  assert v_count = 0;

  update public.karaoke_credits set balance = 5
  where user_id = '51111111-1111-4111-8111-111111111111';
  select * into v_row
  from public.contribute_karaoke_promotion_credits(
    '51111111-1111-4111-8111-111111111111',
    '55555555-5555-4555-8555-555555555555',
    null,
    4,
    true,
    true,
    'https://owner.example/reference'
  );
  v_promotion_id := v_row.result_promotion_id;
  assert v_row.result_promotion_balance = 4;
  select balance into v_balance
  from public.karaoke_credits
  where user_id = '51111111-1111-4111-8111-111111111111';
  assert v_balance = 1;

  begin
    perform public.contribute_karaoke_promotion_credits(
      '51111111-1111-4111-8111-111111111111',
      null,
      v_promotion_id,
      4,
      null,
      null,
      null
    );
    raise exception 'expected insufficient contribution to fail';
  exception when sqlstate '22000' then null;
  end;
  select credits_balance into v_balance
  from public.karaoke_promotions where id = v_promotion_id;
  assert v_balance = 4;
  select count(*) into v_count
  from public.karaoke_promotion_contributions
  where promotion_id = v_promotion_id;
  assert v_count = 1;

  -- A non-owner may contribute, but cannot rewrite the owner's promotion
  -- options or reference link while doing so.
  perform public.contribute_karaoke_promotion_credits(
    '52222222-2222-4222-8222-222222222222',
    null,
    v_promotion_id,
    1,
    false,
    false,
    'https://attacker.example/rewrite'
  );
  select tj_enabled, reference_url
    into v_tj_enabled, v_reference_url
  from public.karaoke_promotions where id = v_promotion_id;
  assert v_tj_enabled = true;
  assert v_reference_url = 'https://owner.example/reference';

  insert into public.karaoke_promotions (
    id, submission_id, owner_user_id, status, credits_required, credits_balance
  ) values (
    '58888888-8888-4888-8888-888888888888',
    '56666666-6666-4666-8666-666666666666',
    '51111111-1111-4111-8111-111111111111',
    'ACTIVE',
    1,
    2
  );
  insert into public.karaoke_promotion_recommendations (
    id, promotion_id, recommender_user_id, status
  ) values (
    '59999999-9999-4999-8999-999999999999',
    '58888888-8888-4888-8888-888888888888',
    '53333333-3333-4333-8333-333333333333',
    'PENDING'
  );

  select * into v_row
  from public.set_karaoke_promotion_recommendation_status(
    '59999999-9999-4999-8999-999999999999', 'APPROVED'
  );
  assert v_row.result_credited = true;
  select * into v_row
  from public.set_karaoke_promotion_recommendation_status(
    '59999999-9999-4999-8999-999999999999', 'APPROVED'
  );
  assert v_row.result_credited = false;
  select balance into v_balance
  from public.karaoke_credits
  where user_id = '53333333-3333-4333-8333-333333333333';
  assert v_balance = 1;
  select credits_balance into v_balance
  from public.karaoke_promotions
  where id = '58888888-8888-4888-8888-888888888888';
  assert v_balance = 1;
  select count(*) into v_count
  from public.karaoke_credit_events
  where user_id = '53333333-3333-4333-8333-333333333333'
    and reason = '추천 인증 승인';
  assert v_count = 1;
  begin
    perform public.set_karaoke_promotion_recommendation_status(
      '59999999-9999-4999-8999-999999999999', 'REJECTED'
    );
    raise exception 'expected approved recommendation to be terminal';
  exception when sqlstate '55000' then null;
  end;

  insert into public.karaoke_votes (
    id, request_id, voter_user_id, status
  ) values (
    '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    v_request_id,
    '53333333-3333-4333-8333-333333333333',
    'PENDING'
  );
  select * into v_row
  from public.set_karaoke_vote_status(
    '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'APPROVED'
  );
  assert v_row.result_credited = true;
  select * into v_row
  from public.set_karaoke_vote_status(
    '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'APPROVED'
  );
  assert v_row.result_credited = false;
  select balance into v_balance
  from public.karaoke_credits
  where user_id = '53333333-3333-4333-8333-333333333333';
  assert v_balance = 2;
end;
$test$;

insert into public.karaoke_promotions (
  id, submission_id, owner_user_id, status, credits_required, credits_balance
) values (
  '5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '57777777-7777-4777-8777-777777777777',
  '51111111-1111-4111-8111-111111111111',
  'PENDING',
  10,
  0
);

create or replace function public._test_hold_karaoke_contribution()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.contribute_karaoke_promotion_credits(
    '54444444-4444-4444-8444-444444444444',
    null,
    '5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    4,
    null,
    null,
    null
  );
  perform pg_sleep(1);
  return 1;
end;
$$;

select dblink_connect(
  'karaoke_credit_a',
  'host=host.docker.internal port=54322 dbname=postgres user=karaoke_concurrency_test password=local-karaoke-test-only'
);
select dblink_send_query(
  'karaoke_credit_a',
  'select public._test_hold_karaoke_contribution()'
);
select pg_sleep(0.2);

do $concurrent$
begin
  begin
    perform public.contribute_karaoke_promotion_credits(
      '54444444-4444-4444-8444-444444444444',
      null,
      '5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      4,
      null,
      null,
      null
    );
    raise exception 'expected concurrent double-spend to fail';
  exception when sqlstate '22000' then
    assert sqlerrm like '%KARAOKE_CREDITS_INSUFFICIENT%';
  end;
end;
$concurrent$;

select *
from dblink_get_result('karaoke_credit_a') as result(value integer);
select dblink_disconnect('karaoke_credit_a');

do $verify_concurrent$
declare
  v_balance integer;
  v_count integer;
begin
  select balance into v_balance
  from public.karaoke_credits
  where user_id = '54444444-4444-4444-8444-444444444444';
  assert v_balance = 1;
  select count(*) into v_count
  from public.karaoke_promotion_contributions
  where promotion_id = '5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  assert v_count = 1;
end;
$verify_concurrent$;

drop function public._test_hold_karaoke_contribution();
delete from auth.users
where id in (
  '51111111-1111-4111-8111-111111111111',
  '52222222-2222-4222-8222-222222222222',
  '53333333-3333-4333-8333-333333333333',
  '54444444-4444-4444-8444-444444444444'
);
drop extension dblink;
drop role karaoke_concurrency_test;
