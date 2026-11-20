-- Runs after real card, PayPal and bank approval paths in the isolated DB.

-- An administrator marks an unfinished two-application card order paid
-- (admin_confirm_unpaid_order_payment). No attempt was approved, so both
-- applications must share the order's receipt key; one key per application
-- sends the customer one identical '결제 완료' mail per application.
do $$
declare ids uuid[]:=array['50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002']::uuid[];
  oid uuid; keys text[];
begin
  insert into public.submissions(id,user_id,package_id,type,status,payment_status,payment_method,amount_krw,album_base_price_krw,album_price_tier)
  select x,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','MV_DISTRIBUTION','SUBMITTED','UNPAID','CARD',30000,null,null
  from unnest(ids) x;
  perform * from public.begin_submission_payment_order(ids[1],ids,'ADMIN-PAID-PAIR',60000,'11111111-1111-4111-8111-111111111111',
    jsonb_build_object('closeState','11111111-1111-4111-8111-111111111111','paymentGroup',jsonb_build_object('submissionIds',to_jsonb(ids))));
  select current_order_id into oid from public.submissions where id=ids[1];
  perform * from public.admin_confirm_unpaid_order_payment(oid,'99999999-9999-4999-8999-999999999999',null);
  perform set_config('onside.checkout_order_write','',true);
  if exists(select 1 from public.submissions where id=any(ids) and (payment_status<>'PAID' or current_order_id is distinct from oid))
    or exists(select 1 from public.submission_payments where order_id='ADMIN-PAID-PAIR' and status<>'CANCELED') then
    raise exception 'Fixture: the administrator did not settle the card order'; end if;
  select array_agg(distinct e.payment_key) into keys from public.paid_submission_notification_events e where e.submission_id=any(ids);
  if (select count(*) from public.paid_submission_notification_events where submission_id=any(ids))<>2
    or keys is distinct from array['order:'||oid::text] then
    raise exception 'Admin-confirmed card order recorded receipt keys %, expected the single key order:%',keys,oid; end if;
end $$;

do $$
declare claimed public.paid_submission_notification_events; n integer; before_count integer;
begin
  assert not has_table_privilege('anon','public.paid_submission_notification_events','SELECT');
  assert not has_table_privilege('authenticated','public.paid_submission_notification_events','INSERT');
  assert not has_function_privilege('authenticated','public.claim_paid_submission_notifications(integer)','EXECUTE');
  assert has_function_privilege('service_role','public.claim_paid_submission_notifications(integer)','EXECUTE');
  assert (select relrowsecurity from pg_class where oid='public.paid_submission_notification_events'::regclass);
  assert not exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_status not in ('PAID','REFUNDED')), 'unpaid submission generated receipt';
  assert exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_method='CARD'), 'card receipt missing';
  assert exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_method='PAYPAL' and e.payment_key like 'paypal:%'), 'PayPal receipt key missing';
  assert exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_method='BANK' and e.payment_key='bank:'||coalesce(s.current_order_id::text,s.id::text)), 'bank receipt key missing';
  -- A card receipt is keyed by its approved attempt; without one (an order the
  -- administrator marked paid) by its order.
  assert not exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_method='CARD' and not exists(select 1 from public.submission_payments p where p.order_id=e.payment_key and p.status='APPROVED' and public.submission_payment_includes_submission(p.submission_id,p.raw_response,s.id))
    and not (e.payment_key='order:'||s.current_order_id::text and not exists(select 1 from public.submission_payments p where p.status='APPROVED' and public.submission_payment_includes_submission(p.submission_id,p.raw_response,s.id)))), 'card/group receipt key mismatch';
  select count(*) into before_count from public.paid_submission_notification_events;
  update public.submissions set payment_status=payment_status where payment_status='PAID';
  assert (select count(*) from public.paid_submission_notification_events)=before_count, 'payment replay created duplicate receipt';
  select * into claimed from public.claim_paid_submission_notifications(1);
  assert claimed.lease_token is not null and claimed.attempt_count=1;
  assert not public.finish_paid_submission_notification(claimed.submission_id,gen_random_uuid(),true), 'wrong lease acknowledged';
  select count(*) into n from public.claim_paid_submission_notifications(5) x where x.submission_id=claimed.submission_id;
  assert n=0, 'active event lease claimed twice';
  assert public.finish_paid_submission_notification(claimed.submission_id,claimed.lease_token,false);
  assert (select enqueued_at is null and next_attempt_at>now() from public.paid_submission_notification_events where submission_id=claimed.submission_id), 'enqueue failure lost receipt intent';
  update public.paid_submission_notification_events set next_attempt_at=now()-interval '1 second' where submission_id=claimed.submission_id;
  select * into claimed from public.claim_paid_submission_notifications(1);
  assert claimed.attempt_count=2;
  -- Crash before acknowledgement is recoverable because message keys are stable.
  update public.paid_submission_notification_events set lease_expires_at=now()-interval '1 second' where submission_id=claimed.submission_id;
  select * into claimed from public.claim_paid_submission_notifications(1);
  assert claimed.attempt_count=3;
  assert public.finish_paid_submission_notification(claimed.submission_id,claimed.lease_token,true);
  assert (select enqueued_at is not null from public.paid_submission_notification_events where submission_id=claimed.submission_id);
  raise notice 'Paid receipt transaction, dedupe, retry, lease and ACL assertions passed';
end $$;
