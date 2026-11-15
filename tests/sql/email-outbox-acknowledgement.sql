-- Run only in an isolated test database after the outbox and acknowledgement migrations.
-- An administrator's 확인 완료 takes a failed or uncertain mail out of the
-- warning counts; a later 재발송 clears it so a new failure warns again.
do $$
declare failed_row public.email_outbox; uncertain_row public.email_outbox; claimed public.email_outbox;
  stats jsonb; admin uuid := gen_random_uuid();
begin
  assert not has_column_privilege('authenticated','public.email_outbox','acknowledged_at','UPDATE'), 'member can acknowledge';
  assert not has_column_privilege('anon','public.email_outbox','acknowledged_at','UPDATE'), 'anonymous can acknowledge';
  assert has_column_privilege('service_role','public.email_outbox','acknowledged_at','UPDATE'), 'admin action cannot acknowledge';
  delete from public.email_outbox;

  select * into failed_row from public.enqueue_email_outbox(repeat('c',64),'supabase-smtp','typo@hanmail.invalid','bounced','body',null,'payment completed',now()+interval '1 hour');
  select * into claimed from public.claim_email_outbox(1,failed_row.id);
  select * into failed_row from public.finish_email_outbox(failed_row.id,claimed.lease_token,'failed',null,'delivery','relay_smtp_550_5_1_2');
  assert failed_row.status='failed' and failed_row.acknowledged_at is null;
  select * into uncertain_row from public.enqueue_email_outbox(repeat('d',64),'supabase-smtp','maybe@example.invalid','maybe','body',null,'submission update',now()+interval '1 hour');
  select * into claimed from public.claim_email_outbox(1,uncertain_row.id);
  select * into uncertain_row from public.finish_email_outbox(uncertain_row.id,claimed.lease_token,'uncertain',null,'delivery','smtp_timeout');

  stats := public.email_outbox_stats();
  assert (stats->>'failed')::int=1 and (stats->>'uncertain')::int=1 and (stats->>'acknowledged')::int=0, stats::text;

  update public.email_outbox set acknowledged_at=now(), acknowledged_by=admin where id in (failed_row.id, uncertain_row.id);
  stats := public.email_outbox_stats();
  assert (stats->>'failed')::int=0 and (stats->>'uncertain')::int=0 and (stats->>'acknowledged')::int=2, stats::text;
  -- The record itself is untouched: still failed, with the bounce reason.
  assert (select status='failed' and last_error_code='relay_smtp_550_5_1_2' from public.email_outbox where id=failed_row.id);

  -- 재발송 clears the mark; a second bounce counts again.
  assert public.retry_email_outbox(failed_row.id,false)->>'status'='pending';
  assert (select acknowledged_at is null and acknowledged_by is null from public.email_outbox where id=failed_row.id), 'retry kept acknowledgement';
  select * into claimed from public.claim_email_outbox(1,failed_row.id);
  perform public.finish_email_outbox(failed_row.id,claimed.lease_token,'failed',null,'delivery','relay_smtp_550_5_1_2');
  stats := public.email_outbox_stats();
  assert (stats->>'failed')::int=1 and (stats->>'acknowledged')::int=1, stats::text;

  -- Acknowledged uncertain mail still needs the duplicate acknowledgement to retry.
  begin perform public.retry_email_outbox(uncertain_row.id,false); assert false, 'uncertain retried without acknowledgement';
  exception when sqlstate '22023' then null; end;
  assert (select acknowledged_at is not null from public.email_outbox where id=uncertain_row.id), 'refused retry cleared acknowledgement';
  delete from public.email_outbox;
end $$;
