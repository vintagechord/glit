-- Bind every B2 multipart upload to the exact server-authorized owner, object,
-- declared size and part layout. Only the service role can see or transition
-- grants; clients receive an opaque grant id and must still prove submission
-- ownership on every API call.

create table if not exists public.multipart_upload_grants (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  owner_key text not null,
  upload_id text not null unique,
  object_key text not null unique,
  original_name text not null,
  mime_type text not null,
  upload_kind text not null,
  declared_size_bytes bigint not null,
  part_size_bytes bigint not null,
  part_count integer not null,
  status text not null default 'ACTIVE',
  abort_attempts integer not null default 0,
  last_abort_attempt_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint multipart_upload_grants_owner_key_length
    check (char_length(owner_key) between 16 and 128),
  constraint multipart_upload_grants_upload_id_length
    check (char_length(upload_id) between 1 and 1024),
  constraint multipart_upload_grants_object_key_length
    check (char_length(object_key) between 1 and 1024),
  constraint multipart_upload_grants_original_name_length
    check (char_length(original_name) between 1 and 255),
  constraint multipart_upload_grants_mime_type_length
    check (char_length(mime_type) between 1 and 255),
  constraint multipart_upload_grants_upload_kind_valid
    check (upload_kind in ('audio', 'video')),
  constraint multipart_upload_grants_declared_size_valid
    check (declared_size_bytes between 1 and 4294967296),
  constraint multipart_upload_grants_part_size_valid
    check (part_size_bytes between 5242880 and 4294967296),
  constraint multipart_upload_grants_part_count_valid
    check (part_count between 1 and 10000),
  constraint multipart_upload_grants_layout_exact
    check (part_count = ceil(declared_size_bytes::numeric / part_size_bytes::numeric)),
  constraint multipart_upload_grants_status_valid
    check (status in ('ACTIVE', 'COMPLETING', 'COMPLETED', 'ABORTING', 'ABORTED', 'FAILED')),
  constraint multipart_upload_grants_abort_attempts_valid
    check (abort_attempts between 0 and 1000000),
  constraint multipart_upload_grants_expiry_valid
    check (expires_at > created_at),
  constraint multipart_upload_grants_consumed_state
    check ((status = 'COMPLETED') = (consumed_at is not null))
);

create index if not exists multipart_upload_grants_expiry_idx
  on public.multipart_upload_grants (expires_at)
  where status = 'ACTIVE';

create index if not exists multipart_upload_grants_submission_idx
  on public.multipart_upload_grants (submission_id, created_at desc);

alter table public.multipart_upload_grants enable row level security;
revoke all on table public.multipart_upload_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.multipart_upload_grants to service_role;

-- Atomically reserve a still-active grant for completion and reject partial,
-- duplicate or out-of-range part lists before B2 is allowed to assemble them.
create or replace function public.claim_multipart_upload_grant(
  p_grant_id uuid,
  p_submission_id uuid,
  p_upload_id text,
  p_object_key text,
  p_owner_key text,
  p_part_numbers integer[]
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant public.multipart_upload_grants%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Multipart grant transition requires the service role.'
      using errcode = '42501';
  end if;

  select *
    into v_grant
  from public.multipart_upload_grants
  where id = p_grant_id
  for update;

  if not found
    or v_grant.submission_id <> p_submission_id
    or v_grant.upload_id <> p_upload_id
    or v_grant.object_key <> p_object_key
    or v_grant.owner_key <> p_owner_key then
    raise exception 'MULTIPART_GRANT_MISMATCH' using errcode = 'P0001';
  end if;
  if v_grant.status <> 'ACTIVE' then
    raise exception 'MULTIPART_GRANT_NOT_ACTIVE' using errcode = '55000';
  end if;
  if v_grant.expires_at <= now() then
    raise exception 'MULTIPART_GRANT_EXPIRED' using errcode = '57014';
  end if;
  if cardinality(coalesce(p_part_numbers, '{}'::integer[])) <> v_grant.part_count
    or exists (
      select 1
      from unnest(coalesce(p_part_numbers, '{}'::integer[])) as supplied(part_number)
      where supplied.part_number < 1
        or supplied.part_number > v_grant.part_count
    )
    or (
      select count(distinct supplied.part_number)
      from unnest(coalesce(p_part_numbers, '{}'::integer[])) as supplied(part_number)
    ) <> v_grant.part_count then
    raise exception 'MULTIPART_PARTS_MISMATCH' using errcode = '22023';
  end if;

  update public.multipart_upload_grants
  set status = 'COMPLETING',
      updated_at = now()
  where id = v_grant.id;

  return true;
end;
$$;

revoke all on function public.claim_multipart_upload_grant(
  uuid, uuid, text, text, text, integer[]
) from public, anon, authenticated;
grant execute on function public.claim_multipart_upload_grant(
  uuid, uuid, text, text, text, integer[]
) to service_role;

-- Reserve an active upload for an explicit client/server abort. The actual B2
-- abort happens after this atomic state transition, then the route marks it
-- ABORTED (or FAILED when B2 could not be reached).
create or replace function public.claim_multipart_upload_abort(
  p_grant_id uuid,
  p_submission_id uuid,
  p_upload_id text,
  p_object_key text,
  p_owner_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Multipart grant transition requires the service role.'
      using errcode = '42501';
  end if;

  update public.multipart_upload_grants
  set status = 'ABORTING',
      abort_attempts = abort_attempts + 1,
      last_abort_attempt_at = now(),
      updated_at = now()
  where id = p_grant_id
    and submission_id = p_submission_id
    and upload_id = p_upload_id
    and object_key = p_object_key
    and owner_key = p_owner_key
    and status = 'ACTIVE';

  if not found then
    raise exception 'MULTIPART_GRANT_NOT_ACTIVE' using errcode = '55000';
  end if;
  return true;
end;
$$;

revoke all on function public.claim_multipart_upload_abort(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.claim_multipart_upload_abort(
  uuid, uuid, text, text, text
) to service_role;

-- Lease a small batch of expired/retryable uploads. Failed B2 abort calls stay
-- ABORTING and are retried after the lease interval; each request performs only
-- a bounded amount of cleanup work and concurrent workers use SKIP LOCKED.
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
