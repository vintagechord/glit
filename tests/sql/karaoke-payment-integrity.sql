begin;

do $test$
declare
  v_user_id uuid := '91111111-1111-4111-8111-111111111111';
  v_request_id uuid := '92222222-2222-4222-8222-222222222222';
  v_cancel_request_id uuid := '93333333-3333-4333-8333-333333333333';
  v_legacy_request_id uuid := '94444444-4444-4444-8444-444444444444';
  v_state text := '01234567-89ab-4cde-8fab-0123456789ab';
  v_row record;
  v_payment public.karaoke_payments%rowtype;
  v_request public.karaoke_requests%rowtype;
begin
  assert not has_function_privilege(
    'anon',
    'public.begin_karaoke_payment_order(uuid,uuid,text,integer,jsonb)',
    'EXECUTE'
  );
  assert not has_function_privilege(
    'authenticated',
    'public.approve_karaoke_payment_order(text,integer,text,text,text,jsonb,timestamptz)',
    'EXECUTE'
  );
  assert has_function_privilege(
    'service_role',
    'public.close_karaoke_payment_order(text,text,text,text,text,jsonb)',
    'EXECUTE'
  );

  insert into auth.users (id, aud, role)
  values (v_user_id, 'authenticated', 'authenticated');

  insert into public.karaoke_requests (
    id,
    user_id,
    title,
    payment_method,
    payment_status,
    amount_krw
  ) values
    (v_request_id, v_user_id, 'Atomic karaoke payment', 'CARD', 'UNPAID', 50000),
    (v_cancel_request_id, v_user_id, 'Canceled karaoke payment', 'CARD', 'UNPAID', 50000),
    (
      v_legacy_request_id,
      v_user_id,
      'Legacy in-flight karaoke payment',
      'CARD',
      'PAYMENT_PENDING',
      50000
    );

  select * into v_row
  from public.begin_karaoke_payment_order(
    v_request_id,
    v_user_id,
    'KRP-TEST-APPROVE',
    50000,
    jsonb_build_object('closeState', v_state)
  );
  assert v_row.request_id = v_request_id;

  select * into v_payment
  from public.karaoke_payments
  where order_id = 'KRP-TEST-APPROVE';
  select * into v_request
  from public.karaoke_requests
  where id = v_request_id;
  assert v_payment.status = 'REQUESTED';
  assert v_request.payment_status = 'PAYMENT_PENDING';
  assert v_request.order_id = 'KRP-TEST-APPROVE';

  begin
    perform public.close_karaoke_payment_order(
      'KRP-TEST-APPROVE',
      'FAILED',
      'wrong-callback-state-that-is-long-enough',
      'INVALID',
      'must not persist',
      '{}'::jsonb
    );
    raise exception 'expected callback-state mismatch';
  exception
    when sqlstate '42501' then null;
  end;

  select * into v_row
  from public.approve_karaoke_payment_order(
    'KRP-TEST-APPROVE',
    50000,
    'TID-KARAOKE-APPROVE',
    '0000',
    'approved',
    '{"provider":"inicis"}'::jsonb,
    now()
  );
  assert v_row.final_status = 'APPROVED';
  assert v_row.already_approved = false;

  select * into v_row
  from public.approve_karaoke_payment_order(
    'KRP-TEST-APPROVE',
    50000,
    'TID-KARAOKE-APPROVE',
    '0000',
    'approved again',
    '{}'::jsonb,
    now()
  );
  assert v_row.already_approved = true;

  select * into v_row
  from public.close_karaoke_payment_order(
    'KRP-TEST-APPROVE',
    'FAILED',
    v_state,
    'LATE_FAIL',
    'late callback',
    '{}'::jsonb
  );
  assert v_row.final_status = 'APPROVED';
  assert v_row.transitioned = false;

  select * into v_payment
  from public.karaoke_payments
  where order_id = 'KRP-TEST-APPROVE';
  select * into v_request
  from public.karaoke_requests
  where id = v_request_id;
  assert v_payment.status = 'APPROVED';
  assert v_request.payment_status = 'PAID';
  assert v_payment.raw_response ->> 'closeState' = v_state;

  begin
    update public.karaoke_payments
    set status = 'FAILED'
    where order_id = 'KRP-TEST-APPROVE';
    raise exception 'expected direct terminal payment downgrade to fail';
  exception
    when sqlstate '55000' then null;
  end;

  begin
    update public.karaoke_requests
    set payment_status = 'UNPAID'
    where id = v_request_id;
    raise exception 'expected direct paid request downgrade to fail';
  exception
    when sqlstate '55000' then null;
  end;

  perform public.begin_karaoke_payment_order(
    v_cancel_request_id,
    v_user_id,
    'KRP-TEST-CANCEL',
    50000,
    jsonb_build_object('closeState', v_state)
  );
  select * into v_row
  from public.close_karaoke_payment_order(
    'KRP-TEST-CANCEL',
    'CANCELED',
    v_state,
    'CANCELED',
    'closed',
    '{}'::jsonb
  );
  assert v_row.final_status = 'CANCELED';
  assert v_row.transitioned = true;

  begin
    perform public.approve_karaoke_payment_order(
      'KRP-TEST-CANCEL',
      50000,
      'TID-KARAOKE-LATE',
      '0000',
      'late approval',
      '{}'::jsonb,
      now()
    );
    raise exception 'expected late approval after cancel to fail';
  exception
    when sqlstate '55000' then null;
  end;

  select * into v_payment
  from public.karaoke_payments
  where order_id = 'KRP-TEST-CANCEL';
  select * into v_request
  from public.karaoke_requests
  where id = v_cancel_request_id;
  assert v_payment.status = 'CANCELED';
  assert v_request.payment_status = 'UNPAID';

  -- A real gateway approval for an order already in flight before closeState
  -- rollout must remain payable, while its unauthenticated failure path stays
  -- disabled because close_karaoke_payment_order requires an exact state.
  update public.karaoke_requests
  set order_id = 'KRP-TEST-LEGACY'
  where id = v_legacy_request_id;
  insert into public.karaoke_payments (
    request_id,
    user_id,
    order_id,
    amount_krw,
    status,
    raw_response
  ) values (
    v_legacy_request_id,
    v_user_id,
    'KRP-TEST-LEGACY',
    50000,
    'REQUESTED',
    null
  );
  select * into v_row
  from public.approve_karaoke_payment_order(
    'KRP-TEST-LEGACY',
    50000,
    'TID-KARAOKE-LEGACY',
    '0000',
    'legacy approved',
    '{}'::jsonb,
    now()
  );
  assert v_row.final_status = 'APPROVED';
end;
$test$;

-- 2026-11-21: a card attempt nobody claimed (the window was abandoned, or it
-- never opened and its close call was lost) no longer refuses every later
-- payment of the request: the next begin supersedes it. An attempt whose
-- approval is being confirmed, or whose outcome is unknown, still keeps the
-- request locked until it is settled.
do $test$
declare
  v_user_id uuid := '91111111-1111-4111-8111-111111111111';
  v_request_id uuid := '95555555-5555-4555-8555-555555555555';
  v_state text := '01234567-89ab-4cde-8fab-0123456789ab';
  v_row record;
  v_payment public.karaoke_payments%rowtype;
  v_request public.karaoke_requests%rowtype;
  v_refused boolean;
begin
  insert into public.karaoke_requests (
    id, user_id, title, payment_method, payment_status, amount_krw
  ) values (
    v_request_id, v_user_id, 'Abandoned karaoke card window', 'CARD', 'UNPAID', 50000
  );

  perform public.begin_karaoke_payment_order(
    v_request_id, v_user_id, 'KRP-TEST-ABANDONED', 50000,
    jsonb_build_object('closeState', v_state)
  );
  -- The member presses pay again on the same request.
  select * into v_row
  from public.begin_karaoke_payment_order(
    v_request_id, v_user_id, 'KRP-TEST-RETRY', 50000,
    jsonb_build_object('closeState', v_state)
  );
  assert v_row.order_id = 'KRP-TEST-RETRY';

  select * into v_payment
  from public.karaoke_payments
  where order_id = 'KRP-TEST-ABANDONED';
  assert v_payment.status = 'CANCELED' and v_payment.result_code = 'SUPERSEDED',
    'the abandoned attempt was not superseded';
  select * into v_request
  from public.karaoke_requests
  where id = v_request_id;
  assert v_request.order_id = 'KRP-TEST-RETRY'
    and v_request.payment_status = 'PAYMENT_PENDING';

  -- A late callback for the superseded attempt can neither be claimed nor
  -- approved, so it can never charge the card.
  v_refused := false;
  begin
    perform public.claim_inicis_karaoke_approval('KRP-TEST-ABANDONED', v_state);
  exception
    when sqlstate '55000' then v_refused := true;
  end;
  assert v_refused, 'a superseded attempt could still be claimed';
  v_refused := false;
  begin
    perform public.approve_karaoke_payment_order(
      'KRP-TEST-ABANDONED', 50000, 'TID-KARAOKE-SUPERSEDED', '0000',
      'late approval', '{}'::jsonb, now()
    );
  exception
    when sqlstate '55000' then v_refused := true;
  end;
  assert v_refused, 'a superseded attempt could still be approved';

  -- The gateway callback claims the new attempt: a begin now must neither
  -- supersede it nor start a second attempt.
  select * into v_row
  from public.claim_inicis_karaoke_approval('KRP-TEST-RETRY', v_state);
  assert not v_row.already_approved and not v_row.already_processing;
  v_refused := false;
  begin
    perform public.begin_karaoke_payment_order(
      v_request_id, v_user_id, 'KRP-TEST-WHILE-CLAIMED', 50000,
      jsonb_build_object('closeState', v_state)
    );
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'KARAOKE_PAYMENT_ALREADY_IN_PROGRESS' then raise; end if;
      v_refused := true;
  end;
  assert v_refused, 'begin superseded an attempt that is being approved';

  -- An unknown gateway outcome keeps the lock as well.
  perform public.settle_inicis_karaoke_approval(
    'KRP-TEST-RETRY', v_state, 'UNCERTAIN', 'TIMEOUT',
    'Unknown gateway state', '{}'::jsonb
  );
  v_refused := false;
  begin
    perform public.begin_karaoke_payment_order(
      v_request_id, v_user_id, 'KRP-TEST-WHILE-UNCERTAIN', 50000,
      jsonb_build_object('closeState', v_state)
    );
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'KARAOKE_PAYMENT_ALREADY_IN_PROGRESS' then raise; end if;
      v_refused := true;
  end;
  assert v_refused, 'begin superseded an attempt whose outcome is unknown';

  select * into v_payment
  from public.karaoke_payments
  where order_id = 'KRP-TEST-RETRY';
  assert v_payment.status = 'REQUESTED'
    and v_payment.result_code = 'APPROVAL_UNCERTAIN';
  assert not exists (
    select 1 from public.karaoke_payments
    where order_id in ('KRP-TEST-WHILE-CLAIMED', 'KRP-TEST-WHILE-UNCERTAIN')
  );
  select * into v_request
  from public.karaoke_requests
  where id = v_request_id;
  assert v_request.order_id = 'KRP-TEST-RETRY'
    and v_request.payment_status = 'PAYMENT_PENDING';
end;
$test$;

rollback;
