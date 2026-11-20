-- Run only in an isolated test database after the outbox migrations.
-- A result mail marks the result notified on acceptance only while the result
-- it described is unchanged; unrelated edits of the application (a corrected
-- recipient address, an album-info sync) no longer block it.
do $$
declare queued public.email_outbox; claimed public.email_outbox; result public.email_outbox;
  submission uuid := '22222222-2222-4222-8222-222222222222';
  station uuid := '33333333-3333-4333-8333-333333333333';
begin
  assert not has_function_privilege('anon','public.submission_result_fingerprint(uuid)','EXECUTE'), 'anonymous fingerprint access';
  assert not has_function_privilege('authenticated','public.submission_result_fingerprint(uuid)','EXECUTE'), 'member fingerprint access';
  assert has_function_privilege('service_role','public.submission_result_fingerprint(uuid)','EXECUTE'), 'service fingerprint grant missing';

  insert into public.submissions(id,status,result_status) values(submission,'RESULT_READY',null);
  insert into public.station_reviews(submission_id,station_id,status) values(submission,station,'APPROVED');

  -- 1. Bounced, recipient corrected, retried: the accepted retry marks the notice.
  select * into queued from public.enqueue_email_outbox(repeat('1',64),'supabase-smtp','typo@hanmail.met','result','body',null,'review result',now()+interval '1 hour',submission,true);
  assert queued.result_fingerprint = public.submission_result_fingerprint(submission), 'fingerprint not captured on enqueue';
  select * into claimed from public.claim_email_outbox(1,queued.id);
  perform public.finish_email_outbox(queued.id,claimed.lease_token,'failed',null,'delivery','smtp_permanent_rejection');
  update public.submissions set guest_email='fixed@hanmail.net', updated_at=now()+interval '1 second' where id=submission;
  update public.email_outbox set recipient_email='fixed@hanmail.net' where id=queued.id;
  assert public.retry_email_outbox(queued.id,false)->>'status'='pending';
  select * into claimed from public.claim_email_outbox(1,queued.id);
  select * into result from public.finish_email_outbox(queued.id,claimed.lease_token,'accepted','retry-fixture');
  assert result.status='accepted';
  assert (select result_notified_at is not null from public.submissions where id=submission), 'accepted retry after a recipient fix left the result unnotified';

  -- 2. A station result changed while the mail waited: the old mail does not mark it.
  update public.submissions set result_notified_at=null where id=submission;
  select * into queued from public.enqueue_email_outbox(repeat('2',64),'supabase-smtp','fixed@hanmail.net','result','body',null,'review result',now()+interval '1 hour',submission,true);
  update public.station_reviews set status='REJECTED' where submission_id=submission;
  select * into claimed from public.claim_email_outbox(1,queued.id);
  perform public.finish_email_outbox(queued.id,claimed.lease_token,'accepted','station-fixture');
  assert (select result_notified_at is null from public.submissions where id=submission), 'mail about an older station result marked the newer one notified';

  -- 3. The submission's own result changed while the mail waited.
  select * into queued from public.enqueue_email_outbox(repeat('3',64),'supabase-smtp','fixed@hanmail.net','result','body',null,'review result',now()+interval '1 hour',submission,true);
  update public.submissions set result_status='REJECTED' where id=submission;
  select * into claimed from public.claim_email_outbox(1,queued.id);
  perform public.finish_email_outbox(queued.id,claimed.lease_token,'accepted','result-fixture');
  assert (select result_notified_at is null from public.submissions where id=submission), 'mail about an older result marked the newer one notified';

  -- 4. Mail queued before fingerprints existed keeps the old rule: any later edit blocks.
  select * into queued from public.enqueue_email_outbox(repeat('4',64),'supabase-smtp','fixed@hanmail.net','result','body',null,'review result',now()+interval '1 hour',submission,true);
  update public.email_outbox set result_fingerprint=null where id=queued.id;
  update public.submissions set guest_email='other@hanmail.net', updated_at=now()+interval '2 seconds' where id=submission;
  select * into claimed from public.claim_email_outbox(1,queued.id);
  perform public.finish_email_outbox(queued.id,claimed.lease_token,'accepted','legacy-fixture');
  assert (select result_notified_at is null from public.submissions where id=submission), 'legacy mail ignored a later edit';

  -- 5. Mail that does not announce a result carries no fingerprint and marks nothing.
  select * into queued from public.enqueue_email_outbox(repeat('5',64),'supabase-smtp','fixed@hanmail.net','paid','body',null,'payment receipt',now()+interval '1 hour',submission,false);
  assert queued.result_fingerprint is null, 'non-result mail captured a fingerprint';
  select * into claimed from public.claim_email_outbox(1,queued.id);
  perform public.finish_email_outbox(queued.id,claimed.lease_token,'accepted','receipt-fixture');
  assert (select result_notified_at is null from public.submissions where id=submission), 'non-result mail marked the result notified';

  -- 6. NULLs keep their place: a value moved between two result fields is a change.
  update public.submissions set result_status=null, result_memo='x' where id=submission;
  select * into queued from public.enqueue_email_outbox(repeat('6',64),'supabase-smtp','fixed@hanmail.net','result','body',null,'review result',now()+interval '1 hour',submission,true);
  update public.submissions set result_status='x', result_memo=null where id=submission;
  assert queued.result_fingerprint <> public.submission_result_fingerprint(submission), 'fingerprint collides when a value moves between fields';
end $$;
