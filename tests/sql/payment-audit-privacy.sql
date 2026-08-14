begin;

select set_config('request.jwt.claim.role', 'service_role', true);

do $test$
declare
  v_user_id uuid := 'a1111111-1111-4111-8111-111111111111';
  v_submission_id uuid := 'a2222222-2222-4222-8222-222222222222';
  v_request_id uuid := 'a3333333-3333-4333-8333-333333333333';
  v_payment_raw jsonb;
  v_request_raw jsonb;
begin
  assert not has_function_privilege(
    'anon',
    'public.scrub_payment_audit_json(jsonb,integer)',
    'EXECUTE'
  );
  assert not has_function_privilege(
    'authenticated',
    'public.scrub_server_payment_raw_response(jsonb)',
    'EXECUTE'
  );

  assert public.scrub_payment_audit_json(
    '{
      "resultCode":"0000",
      "MOID":"ORDER-1",
      "AUTH_TOKEN":"secret",
      "P_CARD_NUM":"4111111111111111",
      "P_BILL_KEY":"billing-secret",
      "buyerEmail":"payer@example.com",
      "signature":"signature-secret",
      "approval":{"TID":"TID-1","AuthSignature":"nested-secret"}
    }'::jsonb,
    0
  ) = '{
    "resultCode":"0000",
    "MOID":"ORDER-1",
    "approval":{"TID":"TID-1"}
  }'::jsonb;

  insert into auth.users (id, aud, role)
  values (v_user_id, 'authenticated', 'authenticated');

  insert into public.submissions (
    id,
    user_id,
    type,
    title,
    status,
    payment_status
  ) values (
    v_submission_id,
    v_user_id,
    'MV_DISTRIBUTION',
    'Audit privacy submission',
    'WAITING_PAYMENT',
    'PAYMENT_PENDING'
  );

  insert into public.submission_payments (
    submission_id,
    user_id,
    order_id,
    amount_krw,
    status,
    raw_response
  ) values (
    v_submission_id,
    v_user_id,
    'AUDIT-SUBMISSION-1',
    50000,
    'REQUESTED',
    '{
      "closeState":"server-state",
      "paypalReturnState":"paypal-state",
      "paymentGroup":{"submissionIds":["a2222222-2222-4222-8222-222222222222"]},
      "AUTH_TOKEN":"secret",
      "approval":{"resultCode":"0000","buyerEmail":"payer@example.com"}
    }'::jsonb
  );

  select raw_response into v_payment_raw
  from public.submission_payments
  where order_id = 'AUDIT-SUBMISSION-1';
  assert v_payment_raw ->> 'closeState' = 'server-state';
  assert v_payment_raw ->> 'paypalReturnState' = 'paypal-state';
  assert v_payment_raw ? 'paymentGroup';
  assert not (v_payment_raw ? 'AUTH_TOKEN');
  assert not ((v_payment_raw -> 'approval') ? 'buyerEmail');

  insert into public.karaoke_requests (
    id,
    user_id,
    title,
    payment_status,
    amount_krw,
    payment_raw_response
  ) values (
    v_request_id,
    v_user_id,
    'Audit privacy karaoke',
    'UNPAID',
    50000,
    '{
      "closeState":"must-not-be-owner-readable",
      "resultCode":"0000",
      "P_CARD_NUM":"4111111111111111"
    }'::jsonb
  );

  select payment_raw_response into v_request_raw
  from public.karaoke_requests
  where id = v_request_id;
  assert not (v_request_raw ? 'closeState');
  assert not (v_request_raw ? 'P_CARD_NUM');
  assert v_request_raw ->> 'resultCode' = '0000';

  assert not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'submission_payments'
      and policyname = 'Submission payments readable by owner or admin'
  );
  assert not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'karaoke_payments'
      and policyname = 'Karaoke payments readable'
  );
end;
$test$;

rollback;
