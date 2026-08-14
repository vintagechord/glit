begin;

select set_config('request.jwt.claim.role', 'service_role', true);

do $test$
declare
  v_user_id uuid := '11111111-1111-4111-8111-111111111111';
  v_other_user_id uuid := '22222222-2222-4222-8222-222222222222';
  v_billing_id uuid := '33333333-3333-4333-8333-333333333333';
  v_subscription_id uuid := '44444444-4444-4444-8444-444444444444';
  v_history_id uuid := '55555555-5555-4555-8555-555555555555';
  v_claim record;
  v_final record;
  v_history public.subscription_history%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_billing public.subscription_billing%rowtype;
begin
  insert into auth.users (id, aud, role) values
    (v_user_id, 'authenticated', 'authenticated'),
    (v_other_user_id, 'authenticated', 'authenticated');

  insert into public.subscription_billing (
    id,
    user_id,
    status,
    bill_key,
    pg_mid
  ) values (
    v_billing_id,
    v_user_id,
    'ACTIVE',
    'test-billing-key',
    'test-mid'
  );

  insert into public.subscriptions (
    id,
    user_id,
    billing_id,
    status,
    next_billing_at
  ) values (
    v_subscription_id,
    v_user_id,
    v_billing_id,
    'ACTIVE',
    now() + interval '1 month'
  );

  insert into public.subscription_history (
    id,
    subscription_id,
    billing_id,
    user_id,
    order_id,
    pg_tid,
    status,
    amount_krw
  ) values (
    v_history_id,
    v_subscription_id,
    v_billing_id,
    v_user_id,
    'SUB-REFUND-TEST-1',
    'TID-REFUND-TEST-1',
    'APPROVED',
    1000
  );

  begin
    perform public.claim_subscription_refund(
      'SUB-REFUND-TEST-1',
      'TID-DOES-NOT-MATCH',
      v_user_id,
      false
    );
    raise exception 'expected the mismatched TID claim to fail';
  exception
    when sqlstate 'P0002' then null;
  end;

  begin
    perform public.claim_subscription_refund(
      'SUB-REFUND-TEST-1',
      null,
      v_other_user_id,
      false
    );
    raise exception 'expected the non-owner claim to fail';
  exception
    when sqlstate '42501' then null;
  end;

  select *
    into v_claim
  from public.claim_subscription_refund(
    'SUB-REFUND-TEST-1',
    'TID-REFUND-TEST-1',
    v_user_id,
    false
  );

  assert v_claim.claim_token is not null;
  assert v_claim.claimed_pg_tid = 'TID-REFUND-TEST-1';
  assert v_claim.already_canceled = false;

  begin
    perform public.claim_subscription_refund(
      'SUB-REFUND-TEST-1',
      null,
      v_user_id,
      false
    );
    raise exception 'expected the concurrent claim to fail';
  exception
    when sqlstate '55000' then null;
  end;

  perform public.fail_subscription_refund(
    'SUB-REFUND-TEST-1',
    'TID-REFUND-TEST-1',
    v_claim.claim_token,
    v_user_id,
    false,
    'NETWORK_ERROR',
    'retryable failure',
    '{"provider":"inicis","resultCode":"NETWORK_ERROR"}'::jsonb
  );

  select * into v_history
  from public.subscription_history
  where id = v_history_id;
  assert v_history.status = 'APPROVED';
  assert v_history.refund_claim_token is null;
  assert v_history.refund_attempt_count = 1;

  select *
    into v_claim
  from public.claim_subscription_refund(
    'SUB-REFUND-TEST-1',
    null,
    v_user_id,
    false
  );

  select *
    into v_final
  from public.finalize_subscription_refund(
    'SUB-REFUND-TEST-1',
    'TID-REFUND-TEST-1',
    v_claim.claim_token,
    v_user_id,
    false,
    'requested by test owner',
    '00',
    'refunded',
    '{"provider":"inicis","resultCode":"00"}'::jsonb
  );

  assert v_final.final_status = 'CANCELED';

  select * into v_history
  from public.subscription_history
  where id = v_history_id;
  select * into v_subscription
  from public.subscriptions
  where id = v_subscription_id;
  select * into v_billing
  from public.subscription_billing
  where id = v_billing_id;

  assert v_history.status = 'CANCELED';
  assert v_history.refund_claim_token is null;
  assert v_history.refund_attempt_count = 2;
  assert v_history.refunded_at is not null;
  assert v_subscription.status = 'CANCELED';
  assert v_subscription.next_billing_at is null;
  assert v_billing.status = 'INACTIVE';
end;
$test$;

rollback;
