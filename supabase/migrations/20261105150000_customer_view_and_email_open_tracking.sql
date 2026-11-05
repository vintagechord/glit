-- Whether a customer saw a result. Two signals, both for administrators only:
--   1. Email opens: customer mail carries a 1×1 image; loading it stamps the
--      outbox row. Mail apps that block images never report, and some fetch
--      images on delivery, so an open is an indication, not proof.
--   2. Result page views and result file downloads by the customer (member or
--      guest code), recorded in their own table so the submission row and its
--      updated_at (used for review conflict checks) never change.

alter table public.email_outbox
  add column if not exists opened_at timestamptz,
  add column if not exists last_opened_at timestamptz,
  add column if not exists open_count integer not null default 0;

-- Repeated image loads within a minute (one mail open) count once.
create or replace function public.record_email_open(p_id uuid)
returns boolean
language sql security invoker set search_path = '' as $$
  with updated as (
    update public.email_outbox o
       set opened_at = coalesce(o.opened_at, now()),
           last_opened_at = now(),
           open_count = o.open_count + 1
     where o.id = p_id
       and o.status = 'accepted'
       and (o.last_opened_at is null or o.last_opened_at < now() - interval '1 minute')
    returning 1
  )
  select exists(select 1 from updated);
$$;
revoke all on function public.record_email_open(uuid) from public, anon, authenticated;
grant execute on function public.record_email_open(uuid) to service_role;

create table if not exists public.submission_customer_views (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  view_count integer not null default 1 check (view_count >= 0),
  last_download_at timestamptz,
  download_count integer not null default 0 check (download_count >= 0)
);
alter table public.submission_customer_views enable row level security;
revoke all on public.submission_customer_views from public, anon, authenticated;
grant select, insert, update, delete on public.submission_customer_views to service_role;

-- Pages refresh every minute while open: a view rewrites the row at most
-- every five minutes and counts as a new visit after thirty quiet minutes.
-- Every file download is recorded.
create or replace function public.record_submission_customer_view(p_submission_id uuid, p_download boolean default false)
returns void
language sql security invoker set search_path = '' as $$
  insert into public.submission_customer_views as v
    (submission_id, first_viewed_at, last_viewed_at, view_count, last_download_at, download_count)
  select s.id, now(), now(), 1,
         case when coalesce(p_download, false) then now() end,
         case when coalesce(p_download, false) then 1 else 0 end
    from public.submissions s
   where s.id = p_submission_id
  on conflict (submission_id) do update set
    last_viewed_at = now(),
    view_count = v.view_count + case when v.last_viewed_at < now() - interval '30 minutes' then 1 else 0 end,
    last_download_at = case when coalesce(p_download, false) then now() else v.last_download_at end,
    download_count = v.download_count + case when coalesce(p_download, false) then 1 else 0 end
  where coalesce(p_download, false) or v.last_viewed_at < now() - interval '5 minutes';
$$;
revoke all on function public.record_submission_customer_view(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_submission_customer_view(uuid, boolean) to service_role;
