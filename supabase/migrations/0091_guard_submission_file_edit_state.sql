-- Object completion endpoints use the service role after authenticating the
-- owner in the application. Serialize the final metadata write with payment
-- and lifecycle changes as a database-level TOCTOU backstop: a stale API read
-- must never attach a new object after payment or review has made the record
-- immutable.

create table if not exists public.submission_upload_staging (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.submissions(id) on delete cascade,
  kind public.file_kind not null,
  file_path text not null,
  object_key text,
  original_name text,
  mime text,
  size bigint,
  checksum text,
  duration_seconds numeric,
  access_url text,
  storage_provider text not null default 'b2',
  status text not null default 'UPLOADED',
  purpose text not null default 'SUBMISSION_FILE',
  uploaded_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '7 days',
  unique (submission_id, file_path)
);

alter table public.submission_upload_staging
  add column if not exists purpose text not null default 'SUBMISSION_FILE';
alter table public.submission_upload_staging
  drop constraint if exists submission_upload_staging_purpose_check;
alter table public.submission_upload_staging
  add constraint submission_upload_staging_purpose_check
  check (purpose in ('SUBMISSION_FILE', 'PAYMENT_DOCUMENT'));

alter table public.submission_upload_staging enable row level security;
revoke all on table public.submission_upload_staging
  from public, anon, authenticated;
grant select, insert, update, delete on table public.submission_upload_staging
  to service_role;

create index if not exists submission_upload_staging_expires_at_idx
  on public.submission_upload_staging(expires_at);

create or replace function public.guard_submission_file_edit_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.submission_status;
  v_payment_status public.payment_status;
  v_save_lease_token uuid;
  v_save_lease_expires_at timestamptz;
  v_verified public.submission_upload_staging%rowtype;
begin
  -- Result attachments use a separate, admin-authenticated endpoint after the
  -- review has begun. They are not applicant-editable source files.
  if coalesce(auth.role(), '') = 'service_role'
    and new.kind::text = 'MV_RESULT_FILE'
  then
    return new;
  end if;

  select
    submission.status,
    submission.payment_status,
    submission.save_lease_token,
    submission.save_lease_expires_at
    into
      v_status,
      v_payment_status,
      v_save_lease_token,
      v_save_lease_expires_at
  from public.submissions submission
  where submission.id = new.submission_id
  -- A key-share lock still permits updates to non-key lifecycle columns.
  -- FOR UPDATE serializes this attachment write with payment/status changes,
  -- so the checks below cannot race a concurrent approval.
  for update;

  if not found then
    raise exception 'SUBMISSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_payment_status = 'PAID' then
    raise exception 'SUBMISSION_FILE_PAID' using errcode = '55000';
  end if;

  if v_payment_status = 'PAYMENT_PENDING' then
    raise exception 'SUBMISSION_FILE_STATE_INVALID' using errcode = '55000';
  end if;

  if v_status not in (
    'DRAFT', 'PRE_REVIEW', 'SUBMITTED', 'WAITING_PAYMENT'
  ) then
    raise exception 'SUBMISSION_FILE_STATE_INVALID' using errcode = '55000';
  end if;

  if tg_table_name = 'submission_files'
    and new.kind::text in ('AUDIO', 'VIDEO', 'LYRICS', 'ETC')
  then
    if v_save_lease_token is null
      or v_save_lease_expires_at is null
      or v_save_lease_expires_at <= clock_timestamp()
    then
      raise exception 'SUBMISSION_FILE_SAVE_LEASE_REQUIRED'
        using errcode = '55000';
    end if;

    select staged.*
      into v_verified
    from public.submission_upload_staging staged
    where staged.submission_id = new.submission_id
      and staged.file_path = new.file_path
      and staged.storage_provider = 'b2'
      and staged.status = 'UPLOADED'
    order by staged.uploaded_at desc, staged.id
    limit 1
    for update;

    if not found then
      raise exception 'SUBMISSION_FILE_METADATA_UNVERIFIED'
        using errcode = '22023';
    end if;

    if coalesce(v_verified.object_key, v_verified.file_path)
        is distinct from coalesce(new.object_key, new.file_path)
      or v_verified.original_name is distinct from new.original_name
      or (
        v_verified.mime is distinct from new.mime
        and not (
          v_verified.mime = 'application/octet-stream'
          and nullif(btrim(coalesce(new.mime, '')), '') is null
        )
      )
      or v_verified.size is distinct from new.size
      or v_verified.checksum is distinct from new.checksum
      or v_verified.duration_seconds is distinct from new.duration_seconds
    then
      raise exception 'SUBMISSION_FILE_METADATA_MISMATCH'
        using errcode = '22023';
    end if;

    -- Never persist client-supplied metadata. The completion endpoint already
    -- verified this authoritative row against B2.
    new.file_path := v_verified.file_path;
    new.object_key := coalesce(v_verified.object_key, v_verified.file_path);
    new.original_name := v_verified.original_name;
    new.mime := v_verified.mime;
    new.size := v_verified.size;
    new.checksum := v_verified.checksum;
    new.duration_seconds := v_verified.duration_seconds;
    new.access_url := v_verified.access_url;
    new.storage_provider := v_verified.storage_provider;
    new.status := v_verified.status;
    new.uploaded_at := v_verified.uploaded_at;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_submission_file_edit_state()
  from public, anon, authenticated;

drop trigger if exists guard_submission_file_edit_state
  on public.submission_files;
create trigger guard_submission_file_edit_state
before insert or update of submission_id, kind, file_path, object_key,
  original_name, mime, size, checksum, duration_seconds, access_url,
  storage_provider, status, uploaded_at
on public.submission_files
for each row execute function public.guard_submission_file_edit_state();

drop trigger if exists guard_submission_upload_staging_edit_state
  on public.submission_upload_staging;
create trigger guard_submission_upload_staging_edit_state
before insert or update on public.submission_upload_staging
for each row execute function public.guard_submission_file_edit_state();

-- The atomic replacement deletes the previous live set before inserting the
-- requested set. Preserve those already-verified rows in staging so unchanged
-- files can be reinserted without trusting metadata echoed by the browser.
create or replace function public.stage_submission_file_before_replace()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_active_lease boolean := false;
begin
  select (
    submission.save_lease_token is not null
    and submission.save_lease_expires_at > clock_timestamp()
  )
    into v_has_active_lease
  from public.submissions submission
  where submission.id = old.submission_id;

  if coalesce(v_has_active_lease, false)
    and old.kind::text in ('AUDIO', 'VIDEO', 'LYRICS', 'ETC')
    and lower(coalesce(old.storage_provider, '')) = 'b2'
    and nullif(btrim(coalesce(old.object_key, old.file_path, '')), '') is not null
  then
    insert into public.submission_upload_staging (
      submission_id, kind, file_path, object_key, original_name, mime, size,
      checksum, duration_seconds, access_url, storage_provider, status,
      purpose, uploaded_at
    ) values (
      old.submission_id,
      old.kind,
      old.file_path,
      coalesce(old.object_key, old.file_path),
      old.original_name,
      old.mime,
      old.size,
      old.checksum,
      old.duration_seconds,
      old.access_url,
      'b2',
      coalesce(old.status, 'UPLOADED'),
      case
        when old.kind::text = 'ETC' then 'PAYMENT_DOCUMENT'
        else 'SUBMISSION_FILE'
      end,
      coalesce(old.uploaded_at, old.created_at, clock_timestamp())
    )
    on conflict (submission_id, file_path) do nothing;
  end if;

  return old;
end;
$$;

revoke all on function public.stage_submission_file_before_replace()
  from public, anon, authenticated;

drop trigger if exists stage_submission_file_before_replace
  on public.submission_files;
create trigger stage_submission_file_before_replace
before delete on public.submission_files
for each row execute function public.stage_submission_file_before_replace();

-- Tax-invoice business registration uploads historically relied on the
-- completion endpoint's immediate ETC insert and are intentionally separate
-- from the album AUDIO / MV VIDEO list. Promote only the newest verified ETC
-- row that is not already part of p_files; ordinary application documents in
-- p_files remain normalized by the main kind-specific replacement.
create or replace function public.promote_verified_submission_etc_upload(
  p_submission_id uuid,
  p_files jsonb,
  p_payment_document_type text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verified public.submission_upload_staging%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Submission ETC promotion requires the service role.'
      using errcode = '42501';
  end if;
  if p_submission_id is null
    or jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array'
  then
    raise exception 'SUBMISSION_FILES_INVALID' using errcode = '22023';
  end if;

  if coalesce(p_payment_document_type, '') <> 'TAX_INVOICE' then
    delete from public.submission_files file
    where file.submission_id = p_submission_id
      and file.kind = 'ETC';
    return;
  end if;

  select staged.*
    into v_verified
  from public.submission_upload_staging staged
  where staged.submission_id = p_submission_id
    and staged.kind = 'ETC'
    and staged.purpose = 'PAYMENT_DOCUMENT'
    and staged.storage_provider = 'b2'
    and staged.status = 'UPLOADED'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) requested
      where nullif(btrim(requested->>'file_path'), '') = staged.file_path
        or nullif(btrim(requested->>'object_key'), '') = staged.file_path
    )
  order by staged.uploaded_at desc, staged.id desc
  limit 1
  for update;

  -- A cart edit that keeps its prior tax document need not re-upload it.
  if not found then
    return;
  end if;

  delete from public.submission_files file
  where file.submission_id = p_submission_id
    and file.kind = 'ETC';

  insert into public.submission_files (
    submission_id, kind, file_path, object_key, storage_provider, status,
    uploaded_at, original_name, mime, size, checksum, duration_seconds,
    access_url
  ) values (
    p_submission_id,
    'ETC',
    v_verified.file_path,
    coalesce(v_verified.object_key, v_verified.file_path),
    v_verified.storage_provider,
    v_verified.status,
    v_verified.uploaded_at,
    v_verified.original_name,
    v_verified.mime,
    v_verified.size,
    v_verified.checksum,
    v_verified.duration_seconds,
    v_verified.access_url
  );
end;
$$;

revoke all on function public.promote_verified_submission_etc_upload(
  uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.promote_verified_submission_etc_upload(
  uuid, jsonb, text
) to service_role;

-- Once the atomic submission save creates the authoritative file row, retire
-- its staging record in the same transaction. A failed save rolls both back.
create or replace function public.cleanup_committed_submission_upload_staging()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.submission_upload_staging staged
  where staged.submission_id = new.submission_id
    and staged.file_path = new.file_path;
  return new;
end;
$$;

revoke all on function public.cleanup_committed_submission_upload_staging()
  from public, anon, authenticated;

drop trigger if exists cleanup_committed_submission_upload_staging
  on public.submission_files;
create trigger cleanup_committed_submission_upload_staging
after insert or update of submission_id, file_path on public.submission_files
for each row execute function public.cleanup_committed_submission_upload_staging();

comment on function public.guard_submission_file_edit_state() is
  'Rejects file metadata mutation when the parent submission is paid or no longer editable.';

comment on table public.submission_upload_staging is
  'Verified applicant-upload objects awaiting an explicit atomic submission save.';
