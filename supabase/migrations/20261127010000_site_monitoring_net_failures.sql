-- 사이트 관리 데스크의 "앱 호출 실패(6시간)" 항목이 실패 건수만 보여 줘서
-- 무엇이 왜 실패했는지 알 수 없었다. pg_net 응답은 6시간 뒤 지워지므로
-- 그 안에 최근 실패 3건의 시각·상태·오류와 마지막 성공 시각, 가장 최근
-- 호출의 실패 여부를 함께 돌려준다. 나머지 항목은 20261116090000과 같다.
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
      with recent as (
        select id, created, status_code, timed_out, error_msg, content,
               coalesce(error_msg is not null or status_code >= 400 or timed_out, false) as failed
        from net._http_response
        where created > now() - interval '6 hours')
      select jsonb_build_object(
        'failedLast6h', (select count(*) from recent where failed),
        'totalLast6h', (select count(*) from recent),
        'latestFailed', (select failed from recent order by created desc, id desc limit 1),
        'lastSucceededAt', (select max(created) from recent where not failed),
        'recentFailures', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'at', f.created, 'status', f.status_code, 'timedOut', coalesce(f.timed_out, false),
                   'error', left(f.error_msg, 160),
                   'body', case when f.status_code >= 400 then left(f.content, 120) end)
                 order by f.created desc, f.id desc)
          from (select * from recent where failed order by created desc, id desc limit 3) f), '[]'::jsonb))
    $q$ into v_net;
  end if;
  return v_result || jsonb_build_object('cron', v_cron, 'net', v_net);
end $$;
revoke all on function public.site_monitoring_snapshot() from public, anon, authenticated;
grant execute on function public.site_monitoring_snapshot() to service_role;
