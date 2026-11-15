-- 확인 완료 for failed mail (2026-11-16). A bounced mail could not be cleared:
-- it kept the site monitor's warning until the 30-day purge. An administrator
-- now marks it handled; the record (status, bounce reason) stays as it was,
-- the warning counts skip it, and a later 재발송 clears the mark so a new
-- failure warns again. Queueing, claiming and finishing are unchanged.

alter table public.email_outbox
  add column acknowledged_at timestamptz,
  add column acknowledged_by uuid;

create or replace function public.email_outbox_stats() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'pending',count(*) filter(where status='pending'), 'sending',count(*) filter(where status='sending'),
    'retry',count(*) filter(where status='retry'), 'accepted',count(*) filter(where status='accepted'),
    'uncertain',count(*) filter(where status='uncertain' and acknowledged_at is null),
    'failed',count(*) filter(where status='failed' and acknowledged_at is null),
    'acknowledged',count(*) filter(where status in ('failed','uncertain') and acknowledged_at is not null),
    'expired',count(*) filter(where status='expired'),
    'oldestPendingAt',min(created_at) filter(where status in ('pending','retry'))
  ) into result from public.email_outbox;
  return result;
end $$;

create or replace function public.retry_email_outbox(p_id uuid, p_allow_uncertain boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare item public.email_outbox;
begin
  perform public.maintain_email_outbox();
  select * into item from public.email_outbox e where e.id=p_id for update;
  if not found then raise exception using errcode='P0002', message='Email not found'; end if;
  if item.status='uncertain' and not p_allow_uncertain then
    raise exception using errcode='22023', message='Explicit duplicate-risk acknowledgement required';
  end if;
  if item.status not in ('failed','retry','uncertain') or item.html is null or item.expires_at <= now() then
    raise exception using errcode='22023', message='Email is not retryable';
  end if;
  update public.email_outbox set status='pending', next_attempt_at=now(), updated_at=now(),
    max_attempts=greatest(max_attempts,attempt_count+1), lease_token=null, lease_expires_at=null,
    acknowledged_at=null, acknowledged_by=null
    where id=p_id;
  return jsonb_build_object('id',p_id,'status','pending');
end $$;

revoke all on function public.email_outbox_stats() from public, anon, authenticated;
revoke all on function public.retry_email_outbox(uuid,boolean) from public, anon, authenticated;
grant execute on function public.email_outbox_stats(), public.retry_email_outbox(uuid,boolean) to service_role;

create or replace function public.site_monitoring_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_cron jsonb := null;
  v_net jsonb := null;
begin
  select jsonb_build_object(
    'checkedAt', now(),
    'databaseBytes', pg_database_size(current_database()),
    'storageBuckets', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'objects', objects, 'bytes', bytes) order by bytes desc)
      from (
        select bucket_id, count(*) as objects, coalesce(sum((metadata->>'size')::bigint), 0) as bytes
        from storage.objects group by bucket_id
      ) buckets), '[]'::jsonb),
    'authUsers', (select count(*) from auth.users),
    'monthlyActiveUsers', (select count(*) from auth.users where last_sign_in_at >= date_trunc('month', now())),
    'latestActivityAt', greatest(
      (select max(created_at) from public.submissions),
      (select max(last_sign_in_at) from auth.users)),
    'emailOutbox', coalesce((
      select jsonb_object_agg(status, total) from (
        -- 확인 완료 mail is counted apart, so the desk's 실패·확인 필요 skips it.
        select case when acknowledged_at is not null then 'acknowledged' else status end as status, count(*) as total
        from public.email_outbox
        where created_at > now() - interval '30 days' group by 1) mails), '{}'::jsonb),
    'emailWorker', (
      select jsonb_build_object('enabled', enabled, 'lastStartedAt', last_started_at,
        'lastFinishedAt', last_finished_at, 'lastError', last_error)
      from public.email_worker_config where singleton),
    'musicArchiveJobs', coalesce((
      select jsonb_object_agg(status, total) from (
        select status, count(*) as total from public.music_archive_jobs
        where status in ('queued','running','blocked','failed') group by status) jobs), '{}'::jsonb),
    'reviewDocumentJobs', coalesce((
      select jsonb_object_agg(status, total) from (
        select status, count(*) as total from public.review_document_jobs
        where status in ('uploading','queued','extracting','translating','generating','validating','failed')
        group by status) jobs), '{}'::jsonb),
    'cashReceipts', coalesce((
      select jsonb_object_agg(status, total) from (
        select case when status = 'UNCERTAIN' then 'FAILED' else status end as status, count(*) as total
        from public.submission_order_cash_receipts
        where status in ('REQUESTED','ISSUING','FAILED','UNCERTAIN')
        group by 1) receipts), '{}'::jsonb),
    'pendingBankOrders', (select count(*) from public.submission_orders where status = 'BANK_PENDING')
  ) into v_result;

  -- pg_cron / pg_net are Supabase extensions; skip them where they are absent.
  if to_regclass('cron.job_run_details') is not null then
    execute $q$
      select jsonb_build_object(
        'failedLast24h', (select count(*) from cron.job_run_details
                          where status = 'failed' and start_time > now() - interval '24 hours'),
        'jobs', coalesce((select jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule,
                  'active', j.active, 'lastStatus', d.status, 'lastStartedAt', d.start_time) order by j.jobname)
                from cron.job j
                left join lateral (select status, start_time from cron.job_run_details r
                                   where r.jobid = j.jobid order by start_time desc limit 1) d on true), '[]'::jsonb))
    $q$ into v_cron;
  end if;
  if to_regclass('net._http_response') is not null then
    execute $q$
      select jsonb_build_object(
        'failedLast6h', (select count(*) from net._http_response
                         where created > now() - interval '6 hours'
                           and (error_msg is not null or status_code >= 400)),
        'totalLast6h', (select count(*) from net._http_response where created > now() - interval '6 hours'))
    $q$ into v_net;
  end if;
  return v_result || jsonb_build_object('cron', v_cron, 'net', v_net);
end $$;
revoke all on function public.site_monitoring_snapshot() from public, anon, authenticated;
grant execute on function public.site_monitoring_snapshot() to service_role;
