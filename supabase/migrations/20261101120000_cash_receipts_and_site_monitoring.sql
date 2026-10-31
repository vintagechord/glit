-- Cash receipts (현금영수증) for bank-transfer orders, one per order. Customers
-- request one at checkout or from their order list; an administrator issues it
-- through KG Inicis or records an issuance made in Hometax. Identifiers stay
-- server-side: only the service role reads this table.
create table if not exists public.submission_order_cash_receipts (
  order_id uuid primary key references public.submission_orders(id) on delete cascade,
  purpose text not null check (purpose in ('INCOME_DEDUCTION','EXPENSE_PROOF')),
  identifier text not null check (identifier ~ '^[0-9]{10,19}$'),
  status text not null default 'REQUESTED' check (status in ('REQUESTED','ISSUING','ISSUED','FAILED','CANCELED')),
  issue_method text check (issue_method in ('INICIS','MANUAL')),
  approval_number text check (approval_number is null or approval_number ~ '^[0-9A-Za-z-]{1,40}$'),
  provider_tid text check (provider_tid is null or length(provider_tid) <= 80),
  issued_at timestamptz,
  amount_krw integer check (amount_krw is null or amount_krw >= 0),
  supply_krw integer check (supply_krw is null or supply_krw >= 0),
  vat_krw integer check (vat_krw is null or vat_krw >= 0),
  failure_message text check (failure_message is null or length(failure_message) <= 500),
  issued_by uuid references auth.users(id) on delete set null,
  canceled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submission_order_cash_receipts_issued_fields check (
    status not in ('ISSUED','CANCELED') or issue_method is null or
    (approval_number is not null and issued_at is not null and amount_krw is not null)
  )
);
create index if not exists submission_order_cash_receipts_status_idx
  on public.submission_order_cash_receipts(status, requested_at);
alter table public.submission_order_cash_receipts enable row level security;
revoke all on public.submission_order_cash_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.submission_order_cash_receipts to service_role;

-- Read-only operating snapshot for the Mac review desk "사이트 관리" view:
-- free-plan usage (database, storage, monthly sign-ins) and queue health.
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
        select status, count(*) as total from public.submission_order_cash_receipts
        where status in ('REQUESTED','ISSUING','FAILED') group by status) receipts), '{}'::jsonb),
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
