-- An Inicis issuance whose result never arrived (timeout, unreadable reply,
-- missing approval number) may already be registered with the National Tax
-- Service. It was stored as FAILED, which customers could edit or withdraw,
-- so a second number could be issued or the trace erased. It now has its own
-- status: customers can neither change nor withdraw it, and an administrator
-- records the outcome after checking the Inicis console.
-- The column check from 20261101120000 is named by Postgres
-- (submission_order_cash_receipts_status_check); drop it by definition so a
-- different generated name cannot leave the old status list in place.
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.submission_order_cash_receipts'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%''REQUESTED''%'
  loop
    execute format('alter table public.submission_order_cash_receipts drop constraint %I', v_name);
  end loop;
end $$;
alter table public.submission_order_cash_receipts
  add constraint submission_order_cash_receipts_status_check
  check (status in ('REQUESTED','ISSUING','ISSUED','FAILED','CANCELED','UNCERTAIN'));

-- Rows written before this change carry the "[결과 확인 필요]" prefix.
update public.submission_order_cash_receipts
set status = 'UNCERTAIN', updated_at = now()
where status = 'FAILED' and failure_message like '[결과 확인 필요]%';

-- The review desk warns on the FAILED count ("확인 필요"). Uncertain issuances
-- need the same attention, so they are counted under that key; the desk needs
-- no change. Everything else is the 20261101120000 definition.
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
        select status, count(*) as total from public.email_outbox
        where created_at > now() - interval '30 days' group by status) mails), '{}'::jsonb),
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
