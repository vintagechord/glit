-- Storage that uploads leave behind is now cleaned on a schedule instead of
-- staying in B2 for good:
--  * Single PUTs and the small direct fallback get a server-side grant, as
--    multipart uploads already do. Completion stores the metadata approved
--    before the upload instead of what the browser sends afterwards, and an
--    upload nobody completes is found again when its grant expires.
--  * Objects of deleted grants, expired staging receipts (7 days) and
--    abandoned PUTs go to a durable queue. The app aborts any multipart
--    upload id and deletes the object unless a live, staged or verified
--    supplement row still uses the key; a failed attempt is retried later.
--  * Failed and abandoned COMPLETING multipart grants join the abort lease.
--  * Stored 24-hour download links are cleared; downloads are signed on
--    demand after their own permission check.

-- 1. Single PUT / direct upload grants ---------------------------------------
create table if not exists public.upload_put_grants (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  object_key text not null unique,
  original_name text not null,
  mime_type text not null,
  upload_kind text not null,
  declared_size_bytes bigint not null,
  status text not null default 'PENDING',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint upload_put_grants_object_key_length
    check (char_length(object_key) between 1 and 1024),
  constraint upload_put_grants_original_name_length
    check (char_length(original_name) between 1 and 255),
  constraint upload_put_grants_mime_type_length
    check (char_length(mime_type) between 1 and 255),
  constraint upload_put_grants_upload_kind_valid
    check (upload_kind in ('audio', 'video', 'etc')),
  -- /api/uploads/init signs at most 128MB; larger files use multipart.
  constraint upload_put_grants_declared_size_valid
    check (declared_size_bytes between 1 and 134217728),
  constraint upload_put_grants_status_valid
    check (status in ('PENDING', 'COMPLETED')),
  constraint upload_put_grants_consumed_state
    check ((status = 'COMPLETED') = (consumed_at is not null)),
  constraint upload_put_grants_expiry_valid
    check (expires_at > created_at)
);

create index if not exists upload_put_grants_pending_expiry_idx
  on public.upload_put_grants (expires_at)
  where status = 'PENDING';
create index if not exists upload_put_grants_consumed_idx
  on public.upload_put_grants (consumed_at)
  where status = 'COMPLETED';
create index if not exists upload_put_grants_submission_idx
  on public.upload_put_grants (submission_id);

alter table public.upload_put_grants enable row level security;
revoke all on table public.upload_put_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.upload_put_grants to service_role;

comment on table public.upload_put_grants is
  'Server-approved metadata of a single PUT or direct upload, read at completion.';

-- 2. Durable object cleanup queue --------------------------------------------
create table if not exists public.storage_object_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  object_key text not null,
  upload_id text,
  -- Not a foreign key: most rows outlive their submission on purpose.
  submission_id uuid,
  reason text not null,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint storage_object_cleanup_queue_object_key_length
    check (char_length(object_key) between 1 and 1024),
  constraint storage_object_cleanup_queue_upload_id_length
    check (upload_id is null or char_length(upload_id) between 1 and 1024),
  constraint storage_object_cleanup_queue_reason_valid
    check (reason in ('GRANT_DELETED', 'PUT_GRANT_ABANDONED', 'STAGING_EXPIRED')),
  constraint storage_object_cleanup_queue_attempts_valid
    check (attempts between 0 and 1000000)
);

create unique index if not exists storage_object_cleanup_queue_target_idx
  on public.storage_object_cleanup_queue (object_key, coalesce(upload_id, ''));
create index if not exists storage_object_cleanup_queue_available_idx
  on public.storage_object_cleanup_queue (available_at);

alter table public.storage_object_cleanup_queue enable row level security;
revoke all on table public.storage_object_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.storage_object_cleanup_queue to service_role;

comment on table public.storage_object_cleanup_queue is
  'B2 objects and multipart upload ids to abort/delete once no row references them.';

-- Reference checks look staged keys up by object_key.
create index if not exists submission_upload_staging_object_key_idx
  on public.submission_upload_staging (object_key);

-- 3. Grants that disappear (with their submission) keep their storage -------
-- A submission delete cascades its grants. An ACTIVE grant still holds a B2
-- upload id whose parts are billed until aborted, and a failed or unfinished
-- completion may have assembled an object. Queue both; the cleanup keeps an
-- object any surviving row still references.
create or replace function public.queue_deleted_multipart_upload_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.storage_object_cleanup_queue (object_key, upload_id, submission_id, reason)
  values (old.object_key, old.upload_id, old.submission_id, 'GRANT_DELETED')
  on conflict do nothing;
  return old;
end;
$$;

revoke all on function public.queue_deleted_multipart_upload_cleanup()
  from public, anon, authenticated;

drop trigger if exists queue_deleted_multipart_upload_cleanup
  on public.multipart_upload_grants;
create trigger queue_deleted_multipart_upload_cleanup
after delete on public.multipart_upload_grants
for each row execute function public.queue_deleted_multipart_upload_cleanup();

-- A PENDING PUT grant was never completed: its object, if the browser sent
-- one, has no receipt. A COMPLETED grant's object belongs to its receipt.
create or replace function public.queue_abandoned_put_upload_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'PENDING' then
    insert into public.storage_object_cleanup_queue (object_key, upload_id, submission_id, reason)
    values (old.object_key, null, old.submission_id, 'PUT_GRANT_ABANDONED')
    on conflict do nothing;
  end if;
  return old;
end;
$$;

revoke all on function public.queue_abandoned_put_upload_cleanup()
  from public, anon, authenticated;

drop trigger if exists queue_abandoned_put_upload_cleanup
  on public.upload_put_grants;
create trigger queue_abandoned_put_upload_cleanup
after delete on public.upload_put_grants
for each row execute function public.queue_abandoned_put_upload_cleanup();

-- 4. Multipart abort lease (latest 0081 definition, plus FAILED/COMPLETING) --
create index if not exists multipart_upload_grants_retry_idx
  on public.multipart_upload_grants (updated_at)
  where status in ('ABORTING', 'FAILED', 'COMPLETING');

create or replace function public.lease_expired_multipart_upload_aborts(
  p_limit integer default 5
)
returns setof public.multipart_upload_grants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Multipart grant transition requires the service role.'
      using errcode = '42501';
  end if;

  return query
  with candidates as (
    select candidate_grant.id
    from public.multipart_upload_grants as candidate_grant
    where (
      candidate_grant.status = 'ACTIVE'
      and candidate_grant.expires_at <= now()
    ) or (
      candidate_grant.status = 'ABORTING'
      and coalesce(candidate_grant.last_abort_attempt_at, '-infinity'::timestamptz)
        <= now() - interval '5 minutes'
    ) or (
      -- Rejected parts, size or signature. The route retires these at once;
      -- this catches one that stopped before it could.
      candidate_grant.status = 'FAILED'
      and candidate_grant.updated_at <= now() - interval '5 minutes'
    ) or (
      -- A completion nobody finished. The main flow cannot complete after
      -- expiry; a supplement recheck gets one more day.
      candidate_grant.status = 'COMPLETING'
      and candidate_grant.expires_at <= now() - interval '1 day'
      and candidate_grant.updated_at <= now() - interval '1 day'
    )
    order by candidate_grant.expires_at, candidate_grant.created_at
    for update skip locked
    limit least(20, greatest(1, coalesce(p_limit, 5)))
  )
  update public.multipart_upload_grants as target_grant
  set status = 'ABORTING',
      abort_attempts = target_grant.abort_attempts + 1,
      last_abort_attempt_at = now(),
      updated_at = now()
  from candidates
  where target_grant.id = candidates.id
  returning target_grant.*;
end;
$$;

revoke all on function public.lease_expired_multipart_upload_aborts(integer)
  from public, anon, authenticated;
grant execute on function public.lease_expired_multipart_upload_aborts(integer)
  to service_role;

-- 5. Expired staging receipts and PUT grants ---------------------------------
-- 0091 gave staging rows a 7-day expires_at that nothing enforced. Expired
-- rows are deleted; their object is queued only when no live row and no
-- other staged row still names it. The cleanup checks references again
-- before it deletes anything.
create or replace function public.retire_expired_upload_storage(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(500, greatest(1, coalesce(p_limit, 100)));
  v_staging integer := 0;
  v_put integer := 0;
  v_completed integer := 0;
begin
  with expired as (
    select staged.id
    from public.submission_upload_staging staged
    where staged.expires_at <= now()
    order by staged.expires_at
    for update skip locked
    limit v_limit
  ), removed as (
    delete from public.submission_upload_staging staged
    using expired
    where staged.id = expired.id
    returning
      staged.submission_id,
      coalesce(nullif(btrim(staged.object_key), ''), staged.file_path) as object_key,
      staged.storage_provider
  ), queued as (
    insert into public.storage_object_cleanup_queue (object_key, submission_id, reason)
    select distinct on (removed.object_key)
      removed.object_key, removed.submission_id, 'STAGING_EXPIRED'
    from removed
    where lower(coalesce(removed.storage_provider, '')) = 'b2'
      and nullif(btrim(removed.object_key), '') is not null
      and not exists (
        select 1 from public.submission_files live
        where live.object_key = removed.object_key
      )
      -- Every CTE sees the rows before this delete; skip the batch itself.
      and not exists (
        select 1 from public.submission_upload_staging other
        where other.object_key = removed.object_key
          and other.id not in (select expired.id from expired)
      )
    on conflict do nothing
    returning 1
  )
  select count(*) into v_staging from removed;

  -- Never completed: the delete trigger queues the object.
  with expired as (
    select pending.id
    from public.upload_put_grants pending
    where pending.status = 'PENDING'
      and pending.expires_at <= now()
    order by pending.expires_at
    for update skip locked
    limit v_limit
  )
  delete from public.upload_put_grants grant_row
  using expired
  where grant_row.id = expired.id;
  get diagnostics v_put = row_count;

  -- Completed grants only answer idempotent completion retries.
  with done as (
    select completed.id
    from public.upload_put_grants completed
    where completed.status = 'COMPLETED'
      and completed.consumed_at <= now() - interval '1 day'
    order by completed.consumed_at
    for update skip locked
    limit v_limit
  )
  delete from public.upload_put_grants grant_row
  using done
  where grant_row.id = done.id;
  get diagnostics v_completed = row_count;

  return jsonb_build_object(
    'staging', v_staging,
    'putGrants', v_put,
    'completedPutGrants', v_completed
  );
end;
$$;

revoke all on function public.retire_expired_upload_storage(integer)
  from public, anon, authenticated;
grant execute on function public.retire_expired_upload_storage(integer)
  to service_role;

-- 6. Queue lease ---------------------------------------------------------------
-- The lease doubles as backoff: a row whose cleanup failed, or whose worker
-- stopped, comes back after 5 minutes, then 10, 20 … up to a day.
create or replace function public.lease_storage_object_cleanup(
  p_limit integer default 20
)
returns setof public.storage_object_cleanup_queue
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select queued.id
    from public.storage_object_cleanup_queue queued
    where queued.available_at <= now()
    order by queued.available_at, queued.created_at
    for update skip locked
    limit least(50, greatest(1, coalesce(p_limit, 20)))
  )
  update public.storage_object_cleanup_queue as target_row
  set attempts = target_row.attempts + 1,
      available_at = now() + least(
        interval '1 day',
        interval '5 minutes' * power(2, least(target_row.attempts, 9))
      )
  from candidates
  where target_row.id = candidates.id
  returning target_row.*;
end;
$$;

revoke all on function public.lease_storage_object_cleanup(integer)
  from public, anon, authenticated;
grant execute on function public.lease_storage_object_cleanup(integer)
  to service_role;

-- 7. Stored download links -------------------------------------------------------
-- Completion used to save a presigned GET (24 hours by default, up to 7 days)
-- in access_url. Nothing downloads through it. The edit guards would refuse
-- this update for paid or ordered submissions, so they are paused for this
-- one statement block only; a failure rolls the whole block back.
do $$
begin
  alter table public.submission_files disable trigger guard_submission_file_edit_state;
  alter table public.submission_files disable trigger protect_ordered_submission_file;
  update public.submission_files set access_url = null where access_url is not null;
  alter table public.submission_files enable trigger guard_submission_file_edit_state;
  alter table public.submission_files enable trigger protect_ordered_submission_file;

  alter table public.submission_upload_staging disable trigger guard_submission_upload_staging_edit_state;
  update public.submission_upload_staging set access_url = null where access_url is not null;
  alter table public.submission_upload_staging enable trigger guard_submission_upload_staging_edit_state;
end $$;

notify pgrst, 'reload schema';
