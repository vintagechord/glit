-- Detailed customer activity, for administrators only. Each result page visit,
-- each result file download (by file), each open of customer mail and each
-- click on a link in it becomes one row, with a coarse client category such
-- as "gmail" or "mobile". No IP address or raw user agent is stored.
--
-- The 20261105150000 functions stay unchanged so the deployment still running
-- while this migration is applied keeps recording.

-- Which signals a delivered mail carries: 'open' (the 1×1 image only, mail
-- delivered from 2026-11-05 20:02 KST) or 'open+click' (image and tracked
-- links). Null: delivered without tracking, so no open can ever be reported.
alter table public.email_outbox
  add column if not exists tracking text,
  add column if not exists clicked_at timestamptz,
  add column if not exists last_clicked_at timestamptz,
  add column if not exists click_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'email_outbox_tracking_check' and conrelid = 'public.email_outbox'::regclass) then
    alter table public.email_outbox
      add constraint email_outbox_tracking_check check (tracking is null or tracking in ('open', 'open+click'));
  end if;
end $$;

create table if not exists public.submission_customer_events (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in ('page_view', 'download', 'mail_open', 'mail_click')),
  -- page_view: member | guest; download: the file; mail_*: the mail operation.
  detail text check (detail is null or detail ~ '^[a-z0-9 _+-]{1,40}$'),
  -- No foreign key: mail rows are purged after 30 days, the event stays.
  outbox_id uuid,
  client text check (client is null or client ~ '^[a-z_]{1,24}$')
);
create index if not exists submission_customer_events_submission_idx
  on public.submission_customer_events (submission_id, occurred_at desc);
alter table public.submission_customer_events enable row level security;
revoke all on public.submission_customer_events from public, anon, authenticated;
grant select, insert, update, delete on public.submission_customer_events to service_role;

-- A result page visit or a result file download by the customer. The
-- aggregate row keeps its 20261105150000 rules (a visit after thirty quiet
-- minutes); an event is written for each new visit and for each download
-- (one per file within ten seconds, so a double click counts once). At most
-- 500 events per application a day.
create or replace function public.record_customer_activity(
  p_submission_id uuid, p_kind text, p_detail text default null, p_client text default null)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_detail text := case when p_detail ~ '^[a-z0-9 _+-]{1,40}$' then p_detail end;
  v_client text := case when p_client ~ '^[a-z_]{1,24}$' then p_client end;
  v_last_view timestamptz;
begin
  if p_kind is null or p_kind not in ('page_view', 'download') then return; end if;
  if not exists (select 1 from public.submissions s where s.id = p_submission_id) then return; end if;
  -- A repeated download of the same file is left out of the totals as well.
  if p_kind = 'download' and exists (
    select 1 from public.submission_customer_events e
     where e.submission_id = p_submission_id and e.kind = 'download'
       and e.detail is not distinct from v_detail and e.occurred_at > now() - interval '10 seconds'
  ) then return; end if;
  select v.last_viewed_at into v_last_view
    from public.submission_customer_views v where v.submission_id = p_submission_id;
  perform public.record_submission_customer_view(p_submission_id, p_kind = 'download');
  if p_kind = 'page_view' and v_last_view is not null and v_last_view >= now() - interval '30 minutes' then
    return;
  end if;
  if (select count(*) from public.submission_customer_events e
       where e.submission_id = p_submission_id and e.occurred_at > now() - interval '1 day') >= 500 then
    return;
  end if;
  insert into public.submission_customer_events (submission_id, kind, detail, client)
  values (p_submission_id, p_kind, v_detail, v_client);
end;
$$;
revoke all on function public.record_customer_activity(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_customer_activity(uuid, text, text, text) to service_role;

-- An open (image load) or a link click in customer mail. Opens within a
-- minute count once, clicks within ten seconds count once. A mail whose
-- delivery was left uncertain still records: an open proves it arrived.
create or replace function public.record_email_activity(p_id uuid, p_kind text, p_client text default null)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_client text := case when p_client ~ '^[a-z_]{1,24}$' then p_client end;
  v_submission uuid;
  v_operation text;
begin
  if p_kind = 'mail_open' then
    update public.email_outbox o
       set opened_at = coalesce(o.opened_at, now()), last_opened_at = now(), open_count = o.open_count + 1
     where o.id = p_id and o.status in ('accepted', 'uncertain')
       and (o.last_opened_at is null or o.last_opened_at < now() - interval '1 minute')
    returning o.submission_id, o.operation into v_submission, v_operation;
  elsif p_kind = 'mail_click' then
    update public.email_outbox o
       set clicked_at = coalesce(o.clicked_at, now()), last_clicked_at = now(), click_count = o.click_count + 1
     where o.id = p_id and o.status in ('accepted', 'uncertain')
       and (o.last_clicked_at is null or o.last_clicked_at < now() - interval '10 seconds')
    returning o.submission_id, o.operation into v_submission, v_operation;
  else
    return false;
  end if;
  if not found then return false; end if;
  if v_submission is not null and (
    select count(*) from public.submission_customer_events e
     where e.submission_id = v_submission and e.occurred_at > now() - interval '1 day') < 500 then
    insert into public.submission_customer_events (submission_id, kind, detail, outbox_id, client)
    values (v_submission, p_kind,
            case when v_operation ~ '^[a-z0-9 _+-]{1,40}$' then v_operation end, p_id, v_client);
  end if;
  return true;
end;
$$;
revoke all on function public.record_email_activity(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_email_activity(uuid, text, text) to service_role;
