-- Runs after real card, PayPal and bank approval paths in the isolated DB.
do $$
declare claimed public.paid_submission_notification_events; n integer; before_count integer;
begin
  assert not has_table_privilege('anon','public.paid_submission_notification_events','SELECT');
  assert not has_table_privilege('authenticated','public.paid_submission_notification_events','INSERT');
  assert not has_function_privilege('authenticated','public.claim_paid_submission_notifications(integer)','EXECUTE');
  assert has_function_privilege('service_role','public.claim_paid_submission_notifications(integer)','EXECUTE');
  assert (select relrowsecurity from pg_class where oid='public.paid_submission_notification_events'::regclass);
  assert not exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_status<>'PAID'), 'unpaid submission generated receipt';
  assert exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_method='CARD'), 'card receipt missing';
  assert exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_method='PAYPAL' and e.payment_key like 'paypal:%'), 'PayPal receipt key missing';
  assert exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_method='BANK' and e.payment_key='bank:'||coalesce(s.current_order_id::text,s.id::text)), 'bank receipt key missing';
  assert not exists(select 1 from public.paid_submission_notification_events e join public.submissions s on s.id=e.submission_id where s.payment_method='CARD' and not exists(select 1 from public.submission_payments p where p.order_id=e.payment_key and p.status='APPROVED' and public.submission_payment_includes_submission(p.submission_id,p.raw_response,s.id))), 'card/group receipt key mismatch';
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
