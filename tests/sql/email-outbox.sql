-- Run only in an isolated test database after the outbox and worker migrations.
do $$
declare row1 public.email_outbox; row2 public.email_outbox; claimed public.email_outbox;
  result public.email_outbox; count_rows integer; stats jsonb; denied boolean := false;
  submission uuid := '11111111-1111-4111-8111-111111111111';
begin
  assert not has_table_privilege('anon','public.email_outbox','SELECT'), 'anonymous body access';
  assert not has_table_privilege('authenticated','public.email_outbox','SELECT'), 'member body access';
  assert not has_function_privilege('authenticated','public.claim_email_outbox(integer,uuid)','EXECUTE'), 'member worker access';
  assert not has_function_privilege('anon','public.retry_email_outbox(uuid,boolean)','EXECUTE'), 'anonymous retry access';
  assert has_function_privilege('service_role','public.claim_email_outbox(integer,uuid)','EXECUTE'), 'service worker missing grant';
  assert (select relrowsecurity from pg_class where oid='public.email_outbox'::regclass), 'RLS disabled';
  insert into public.submissions(id) values(submission);

  select * into row1 from public.enqueue_email_outbox(repeat('a',64),'supabase-smtp','fixture@example.invalid','result','sensitive-body',null,'review result',now()+interval '1 hour',submission,true);
  select * into row2 from public.enqueue_email_outbox(repeat('a',64),'supabase-smtp','fixture@example.invalid','different','replacement-body',null,'review result',now()+interval '1 hour');
  assert row1.id=row2.id and row2.html='sensitive-body', 'dedupe replaced existing content';
  select * into claimed from public.claim_email_outbox(1,row1.id);
  assert claimed.status='sending' and claimed.attempt_count=1 and claimed.lease_token is not null;
  select count(*) into count_rows from public.claim_email_outbox(1,row1.id);
  assert count_rows=0, 'active lease claimed twice';
  select count(*) into count_rows from public.finish_email_outbox(row1.id,gen_random_uuid(),'accepted','fixture-id');
  assert count_rows=0, 'wrong lease can acknowledge';
  select * into result from public.finish_email_outbox(row1.id,claimed.lease_token,'accepted','fixture-id');
  assert result.status='accepted' and result.html is null and result.provider_message_id='fixture-id';
  assert (select result_notified_at is not null from public.submissions where id=submission), 'result timestamp missing';

  select * into row1 from public.enqueue_email_outbox(repeat('8',64),'supabase-smtp','fixture@example.invalid','MV change','body',null,'submission update',now()+interval '1 hour',submission,true);
  update public.submissions set result_notified_at=null,updated_at=now()+interval '1 second' where id=submission;
  select * into claimed from public.claim_email_outbox(1,row1.id);
  perform public.finish_email_outbox(row1.id,claimed.lease_token,'accepted','late-fixture-id');
  assert (select result_notified_at is null from public.submissions where id=submission), 'old acceptance marked newer result notified';

  select * into row1 from public.enqueue_email_outbox(repeat('b',64),'supabase-smtp','retry@example.invalid','retry','body',null,'submission update',now()+interval '1 hour');
  for i in 1..5 loop
    update public.email_outbox set next_attempt_at=now()-interval '1 second' where id=row1.id;
    select * into claimed from public.claim_email_outbox(1,row1.id);
    select * into result from public.finish_email_outbox(row1.id,claimed.lease_token,'retry',null,'rate_limit','smtp_temporary_rejection');
    assert result.attempt_count=i;
    if i<5 then
      assert result.status='retry' and result.next_attempt_at >= now()+make_interval(secs=>30*power(2,i-1)::integer), 'retry backoff missing';
    else assert result.status='failed', 'retry bound missing'; end if;
  end loop;
  assert public.retry_email_outbox(row1.id,false)->>'status'='pending';
  select * into claimed from public.claim_email_outbox(1,row1.id);
  assert claimed.attempt_count=6, 'manual retry loses attempt history';
  update public.email_outbox set lease_expires_at=now()-interval '1 second' where id=row1.id;
  perform public.maintain_email_outbox();
  assert (select status='uncertain' from public.email_outbox where id=row1.id), 'abandoned send retried';
  select count(*) into count_rows from public.claim_email_outbox(1,row1.id);
  assert count_rows=0;
  begin perform public.retry_email_outbox(row1.id,false); exception when sqlstate '22023' then denied := true; end;
  assert denied, 'uncertain retry omitted explicit acknowledgement';
  assert public.retry_email_outbox(row1.id,true)->>'status'='pending';
  update public.email_outbox set expires_at=now()-interval '1 second' where id=row1.id;
  perform public.maintain_email_outbox();
  assert (select status='expired' and html is null from public.email_outbox where id=row1.id), 'expired body retained';

  select * into row1 from public.enqueue_email_outbox(repeat('c',64),'supabase-smtp','auth@example.invalid','auth','old-token',null,'password reset',now()+interval '10 minutes');
  select * into row2 from public.enqueue_email_outbox(repeat('d',64),'supabase-smtp','auth@example.invalid','auth','new-token',null,'password reset',now()+interval '10 minutes');
  assert (select status='expired' and html is null and last_error_code='auth_superseded' from public.email_outbox where id=row1.id), 'old auth token remains queued';
  perform public.enqueue_email_outbox(repeat('c',64),'supabase-smtp','auth@example.invalid','auth','old-token',null,'password reset',now()+interval '10 minutes');
  assert (select status='pending' from public.email_outbox where id=row2.id), 'duplicate old request cancelled newest token';
  update public.email_outbox set status='failed',created_at=now()-interval '31 days',updated_at=now()-interval '31 days',html=null where id=row1.id;
  perform public.maintain_email_outbox();
  assert not exists(select 1 from public.email_outbox where id=row1.id), 'terminal metadata retained beyond retention';
  stats := public.email_outbox_stats();
  assert (stats->>'accepted')::integer=2 and (stats->>'pending')::integer=1, 'stats incorrect';

  assert not has_table_privilege('anon','public.email_worker_config','SELECT'), 'worker secret public';
  assert not has_function_privilege('authenticated','public.consume_email_rate_limit(text,integer,integer,integer)','EXECUTE'), 'member can reset limits';
  assert public.authorize_email_worker(repeat('0',64))=false, 'absent worker authenticated';
  assert (public.consume_email_rate_limit(repeat('e',64),2,60000)->>'allowed')::boolean;
  assert (public.consume_email_rate_limit(repeat('e',64),2,60000)->>'allowed')::boolean;
  assert not (public.consume_email_rate_limit(repeat('e',64),2,60000)->>'allowed')::boolean;
  raise notice 'email outbox SQL assertions passed';
end $$;
