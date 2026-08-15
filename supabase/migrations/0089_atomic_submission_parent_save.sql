-- Keep the public submission lifecycle unchanged while an edit is in flight.
-- The v2 commit stages validated parent metadata and invokes the existing
-- tracks/files/reviews commit inside one database transaction. A crash after
-- claim therefore leaves the cart and its payment state visible and intact.

begin;

-- A lease claimed by the pre-v2 application has already overwritten the
-- public lifecycle without a snapshot. Abort the rollout rather than make
-- that state impossible to restore; retrying after the at-most-five-minute
-- lease window is safe.
lock table public.submissions in share row exclusive mode;

do $migration_guard$
begin
  if exists (
    select 1
    from public.submissions submission
    where submission.save_lease_token is not null
      and submission.save_lease_expires_at > clock_timestamp()
  ) then
    raise exception 'ACTIVE_SUBMISSION_SAVE_LEASES_RETRY_MIGRATION'
      using errcode = '55000';
  end if;
end;
$migration_guard$;

create table if not exists public.submission_save_lease_snapshots (
  submission_id uuid primary key
    references public.submissions(id) on delete cascade,
  lease_token uuid not null unique,
  lease_mode text not null default 'ATOMIC_V2'
    check (lease_mode in ('ATOMIC_V2', 'LEGACY_V1')),
  original_submission jsonb not null,
  original_updated_at timestamptz not null,
  lease_staged_updated_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.submission_save_lease_snapshots enable row level security;
revoke all on table public.submission_save_lease_snapshots
  from public, anon, authenticated;

-- Restore all ordinary parent columns. This primarily protects migration-time
-- v1 requests and defensive releases; v2 never writes parent metadata outside
-- its commit transaction. Runtime pg_attribute discovery also covers columns
-- added by later migrations.
create or replace function public.restore_submission_save_lease_snapshot(
  p_submission_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_assignments text;
  v_restored_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Submission save lease restore requires the service role.'
      using errcode = '42501';
  end if;
  if p_submission_id is null or p_lease_token is null then
    raise exception 'SUBMISSION_SAVE_LEASE_RESTORE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select snapshot.original_submission
    into v_snapshot
  from public.submission_save_lease_snapshots snapshot
  where snapshot.submission_id = p_submission_id
    and snapshot.lease_token = p_lease_token
  for update;

  if not found then
    return false;
  end if;

  select string_agg(
    format(
      '%1$I = (jsonb_populate_record(null::public.submissions, $1)).%1$I',
      attribute.attname
    ),
    ', ' order by attribute.attnum
  )
    into v_assignments
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.submissions'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = ''
    and attribute.attidentity = ''
    and attribute.attname not in (
      'id',
      'created_at',
      'updated_at',
      'save_lease_token',
      'save_lease_expires_at'
    );

  if nullif(v_assignments, '') is null then
    raise exception 'SUBMISSION_SAVE_LEASE_RESTORE_COLUMNS_MISSING'
      using errcode = '55000';
  end if;

  execute format(
    'update public.submissions submission
       set %s,
           save_lease_token = null,
           save_lease_expires_at = null
     where submission.id = $2
       and submission.save_lease_token = $3',
    v_assignments
  ) using v_snapshot, p_submission_id, p_lease_token;

  get diagnostics v_restored_count = row_count;
  return v_restored_count = 1;
end;
$$;

revoke all on function public.restore_submission_save_lease_snapshot(uuid, uuid)
  from public, anon, authenticated;

-- Both v1 and v2 commits clear their token transactionally. Snapshot cleanup
-- follows that exact transition in the same transaction.
create or replace function public.cleanup_submission_save_lease_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.save_lease_token is not null and new.save_lease_token is null then
    delete from public.submission_save_lease_snapshots snapshot
    where snapshot.submission_id = old.id
      and snapshot.lease_token = old.save_lease_token;
  end if;
  return new;
end;
$$;

revoke all on function public.cleanup_submission_save_lease_snapshot()
  from public, anon, authenticated;

drop trigger if exists cleanup_submission_save_lease_snapshot
  on public.submissions;
create trigger cleanup_submission_save_lease_snapshot
after update of save_lease_token on public.submissions
for each row execute function public.cleanup_submission_save_lease_snapshot();

-- A payment order cannot bind a submission while its parent/dependents are
-- being committed. The requested-payment trigger covers card and PayPal; the
-- lifecycle trigger also covers the bank flow, which has no payment row.
create or replace function public.prevent_payment_during_submission_save()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.save_lease_token is not null
    and old.save_lease_expires_at > clock_timestamp()
    and new.save_lease_token is not distinct from old.save_lease_token
    and (
      new.status is distinct from old.status
      or new.payment_status is distinct from old.payment_status
    )
    and not (
      coalesce(auth.role(), '') = 'service_role'
      and new.status = 'DRAFT'
      and new.payment_status = 'UNPAID'
    )
  then
    raise exception 'SUBMISSION_SAVE_IN_PROGRESS' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_payment_during_submission_save()
  from public, anon, authenticated;

drop trigger if exists prevent_payment_during_submission_save
  on public.submissions;
create trigger prevent_payment_during_submission_save
before update on public.submissions
for each row execute function public.prevent_payment_during_submission_save();

create or replace function public.prevent_requested_payment_during_submission_save()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'REQUESTED'
    and exists (
      select 1
      from public.submissions submission
      where submission.id = any(
        public.submission_payment_group_ids(
          new.submission_id,
          new.raw_response
        )
      )
        and submission.save_lease_token is not null
        and submission.save_lease_expires_at > clock_timestamp()
    )
  then
    raise exception 'SUBMISSION_SAVE_IN_PROGRESS' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_requested_payment_during_submission_save()
  from public, anon, authenticated;

drop trigger if exists prevent_requested_payment_during_submission_save
  on public.submission_payments;
create trigger prevent_requested_payment_during_submission_save
before insert or update of status, submission_id, raw_response
on public.submission_payments
for each row execute function public.prevent_requested_payment_during_submission_save();

-- v2 leaves status/payment and every author-visible parent field untouched.
-- recovery_required is returned instead of raised when an expired lease was
-- cleaned but the caller held a truly stale version, so cleanup can commit.
create or replace function public.claim_submission_save_lease_v2(
  p_submission_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_user_id uuid,
  p_expected_guest_token text,
  p_lease_token uuid
)
returns table(
  lease_token uuid,
  staged_updated_at timestamptz,
  recovery_required boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission public.submissions%rowtype;
  v_staged_updated_at timestamptz;
  v_observed_updated_at timestamptz;
  v_original_updated_at timestamptz;
  v_lease_staged_updated_at timestamptz;
  v_lease_mode text;
  v_recovered boolean := false;
  v_expected_version_matches_recovered_row boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Submission save lease requires the service role.'
      using errcode = '42501';
  end if;
  if p_submission_id is null
    or p_expected_updated_at is null
    or p_lease_token is null
  then
    raise exception 'SUBMISSION_SAVE_LEASE_INPUT_INVALID'
      using errcode = '22023';
  end if;
  if p_expected_user_id is null
    and (
      nullif(btrim(coalesce(p_expected_guest_token, '')), '') is null
      or length(btrim(p_expected_guest_token)) < 8
      or length(btrim(p_expected_guest_token)) > 120
    )
  then
    raise exception 'SUBMISSION_SAVE_OWNER_INVALID'
      using errcode = '42501';
  end if;

  select submission.*
    into v_submission
  from public.submissions submission
  where submission.id = p_submission_id
  for update;

  if not found then
    raise exception 'SUBMISSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (
    (
      p_expected_user_id is not null
      and v_submission.user_id = p_expected_user_id
    )
    or (
      p_expected_user_id is null
      and v_submission.user_id is null
      and v_submission.guest_token = p_expected_guest_token
    )
  ) then
    raise exception 'SUBMISSION_SAVE_OWNER_MISMATCH' using errcode = '42501';
  end if;

  if v_submission.save_lease_token is not null
    and v_submission.save_lease_expires_at > clock_timestamp()
  then
    raise exception 'SUBMISSION_SAVE_IN_PROGRESS' using errcode = '55000';
  end if;

  if v_submission.save_lease_token is not null then
    v_observed_updated_at := v_submission.updated_at;
    select
      snapshot.original_updated_at,
      snapshot.lease_staged_updated_at,
      snapshot.lease_mode
      into v_original_updated_at, v_lease_staged_updated_at, v_lease_mode
    from public.submission_save_lease_snapshots snapshot
    where snapshot.submission_id = p_submission_id
      and snapshot.lease_token = v_submission.save_lease_token;

    v_expected_version_matches_recovered_row :=
      p_expected_updated_at is not distinct from v_observed_updated_at
      or (
        (
          v_lease_mode is distinct from 'ATOMIC_V2'
          or v_observed_updated_at is not distinct from v_lease_staged_updated_at
        )
        and p_expected_updated_at is not distinct from v_original_updated_at
      );

    if v_lease_mode = 'LEGACY_V1' then
      v_recovered := public.restore_submission_save_lease_snapshot(
        p_submission_id,
        v_submission.save_lease_token
      );
    else
      -- v2 claim never changed parent data or lifecycle. Unlocking is the
      -- exact recovery and must not overwrite a concurrent trusted update.
      update public.submissions submission
      set save_lease_token = null,
          save_lease_expires_at = null
      where submission.id = p_submission_id
        and submission.save_lease_token = v_submission.save_lease_token;
      v_recovered := found;
    end if;
    if not v_recovered then
      update public.submissions submission
      set save_lease_token = null,
          save_lease_expires_at = null
      where submission.id = p_submission_id
        and submission.save_lease_token = v_submission.save_lease_token;
    end if;

    select submission.*
      into v_submission
    from public.submissions submission
    where submission.id = p_submission_id
    for update;

    if not v_expected_version_matches_recovered_row then
      return query select null::uuid, null::timestamptz, true;
      return;
    end if;
  elsif v_submission.updated_at is distinct from p_expected_updated_at then
    raise exception 'SUBMISSION_SAVE_VERSION_CHANGED' using errcode = '40001';
  end if;

  if v_submission.payment_status not in ('UNPAID', 'PAYMENT_PENDING')
    or v_submission.status not in (
      'DRAFT', 'PRE_REVIEW', 'SUBMITTED', 'WAITING_PAYMENT'
    )
  then
    raise exception 'SUBMISSION_SAVE_STATE_INVALID' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.submission_payments payment
    where payment.status = 'REQUESTED'
      and public.submission_payment_includes_submission(
        payment.submission_id,
        payment.raw_response,
        p_submission_id
      )
  ) then
    -- An expired token was already cleared above, so return rather than raise
    -- when recovery must persist. A live claim still fails closed.
    if v_recovered then
      return query select null::uuid, null::timestamptz, true;
      return;
    end if;
    raise exception 'PAYMENT_IN_PROGRESS' using errcode = '55000';
  end if;

  insert into public.submission_save_lease_snapshots (
    submission_id,
    lease_token,
    lease_mode,
    original_submission,
    original_updated_at
  ) values (
    p_submission_id,
    p_lease_token,
    'ATOMIC_V2',
    to_jsonb(v_submission),
    v_submission.updated_at
  );

  update public.submissions submission
  set save_lease_token = p_lease_token,
      save_lease_expires_at = clock_timestamp() + interval '5 minutes'
  where submission.id = p_submission_id
  returning submission.updated_at into v_staged_updated_at;

  update public.submission_save_lease_snapshots snapshot
  set lease_staged_updated_at = v_staged_updated_at
  where snapshot.submission_id = p_submission_id
    and snapshot.lease_token = p_lease_token;

  return query select p_lease_token, v_staged_updated_at, false;
end;
$$;

revoke all on function public.claim_submission_save_lease_v2(
  uuid, timestamptz, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.claim_submission_save_lease_v2(
  uuid, timestamptz, uuid, text, uuid
) to service_role;

-- Keep the old RPC safe during a rolling application deploy. It delegates
-- ownership/version/payment checks and snapshot creation to v2, then applies
-- the legacy DRAFT/UNPAID staging contract expected by old commit callers.
create or replace function public.claim_submission_save_lease(
  p_submission_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_user_id uuid,
  p_expected_guest_token text,
  p_lease_token uuid
)
returns table(lease_token uuid, staged_updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim record;
  v_staged_updated_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Submission save lease requires the service role.'
      using errcode = '42501';
  end if;

  select * into v_claim
  from public.claim_submission_save_lease_v2(
    p_submission_id,
    p_expected_updated_at,
    p_expected_user_id,
    p_expected_guest_token,
    p_lease_token
  );

  if v_claim.lease_token is null then
    return query select null::uuid, null::timestamptz;
    return;
  end if;

  update public.submission_save_lease_snapshots snapshot
  set lease_mode = 'LEGACY_V1'
  where snapshot.submission_id = p_submission_id
    and snapshot.lease_token = p_lease_token;

  if not found then
    raise exception 'SUBMISSION_SAVE_LEASE_SNAPSHOT_MISSING'
      using errcode = '55000';
  end if;

  update public.submissions submission
  set status = 'DRAFT',
      payment_status = 'UNPAID'
  where submission.id = p_submission_id
    and submission.save_lease_token = p_lease_token
    and submission.updated_at = v_claim.staged_updated_at
  returning submission.updated_at into v_staged_updated_at;

  if v_staged_updated_at is null then
    raise exception 'SUBMISSION_SAVE_VERSION_CHANGED' using errcode = '40001';
  end if;

  return query select p_lease_token, v_staged_updated_at;
end;
$$;

revoke all on function public.claim_submission_save_lease(
  uuid, timestamptz, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.claim_submission_save_lease(
  uuid, timestamptz, uuid, text, uuid
) to service_role;

-- Apply the parent payload, dependent rows, and final lifecycle state inside
-- this single RPC transaction. The existing commit function remains the one
-- canonical implementation for tracks/files/reviews validation and mutation.
create or replace function public.commit_submission_save_v2(
  p_submission_id uuid,
  p_lease_token uuid,
  p_expected_updated_at timestamptz,
  p_parent jsonb,
  p_replace_tracks boolean,
  p_tracks jsonb,
  p_replace_files boolean,
  p_file_kind text,
  p_files jsonb,
  p_sync_reviews boolean,
  p_station_ids uuid[],
  p_final_status public.submission_status,
  p_final_payment_status public.payment_status
)
returns table(
  submission_id uuid,
  final_status public.submission_status,
  final_payment_status public.payment_status
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission public.submissions%rowtype;
  v_parent_keys text[];
  v_allowed_parent_keys constant text[] := array[
    'user_id', 'type', 'title', 'artist_name', 'artist_id',
    'artist_name_kr', 'artist_name_en', 'release_date', 'genre',
    'distributor', 'production_company', 'applicant_name',
    'applicant_email', 'applicant_phone', 'previous_release',
    'artist_type', 'artist_gender', 'artist_members', 'is_oneclick',
    'melon_url', 'ai_used', 'package_id', 'amount_krw',
    'album_base_price_krw', 'album_price_tier',
    'album_discount_base_submission_id', 'album_draft_group_id',
    'guest_name', 'guest_company',
    'guest_email', 'guest_phone', 'guest_token', 'pre_review_requested',
    'karaoke_requested', 'payment_method', 'bank_depositor_name',
    'payment_document_type', 'cash_receipt_purpose', 'cash_receipt_phone',
    'cash_receipt_business_number', 'tax_invoice_business_number',
    'mv_runtime', 'mv_format', 'mv_director', 'mv_lead_actor',
    'mv_storyline', 'mv_production_company', 'mv_agency', 'mv_album_title',
    'mv_production_date', 'mv_distribution_company', 'mv_business_reg_no',
    'mv_usage', 'mv_desired_rating', 'mv_memo', 'mv_song_title',
    'mv_song_title_kr', 'mv_song_title_en', 'mv_song_title_official',
    'mv_composer', 'mv_lyricist', 'mv_arranger', 'mv_song_memo',
    'mv_lyrics', 'mv_base_selected', 'mv_selected_station_codes',
    'application_form_mode',
    'files_submitted_by_email'
  ]::text[];
  v_assignments text;
  v_parent_updated_at timestamptz;
  v_result record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Submission save commit requires the service role.'
      using errcode = '42501';
  end if;
  if p_submission_id is null
    or p_lease_token is null
    or p_expected_updated_at is null
    or jsonb_typeof(p_parent) <> 'object'
  then
    raise exception 'SUBMISSION_SAVE_COMMIT_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select submission.*
    into v_submission
  from public.submissions submission
  where submission.id = p_submission_id
  for update;

  if not found then
    raise exception 'SUBMISSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_submission.save_lease_token is distinct from p_lease_token
    or v_submission.save_lease_expires_at is null
    or v_submission.save_lease_expires_at <= clock_timestamp()
  then
    raise exception 'SUBMISSION_SAVE_LEASE_INVALID' using errcode = '55000';
  end if;
  if v_submission.updated_at is distinct from p_expected_updated_at then
    raise exception 'SUBMISSION_SAVE_VERSION_CHANGED' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.submission_payments payment
    where payment.status = 'REQUESTED'
      and public.submission_payment_includes_submission(
        payment.submission_id,
        payment.raw_response,
        p_submission_id
      )
  ) then
    raise exception 'PAYMENT_IN_PROGRESS' using errcode = '55000';
  end if;

  select coalesce(array_agg(key order by key), '{}'::text[])
    into v_parent_keys
  from jsonb_object_keys(p_parent) key;

  if cardinality(v_parent_keys) = 0
    or exists (
      select 1
      from unnest(v_parent_keys) key
      where not (key = any(v_allowed_parent_keys))
    )
  then
    raise exception 'SUBMISSION_PARENT_FIELDS_INVALID' using errcode = '22023';
  end if;

  select string_agg(
    format(
      '%1$I = (jsonb_populate_record(null::public.submissions, $1)).%1$I',
      attribute.attname
    ),
    ', ' order by attribute.attnum
  )
    into v_assignments
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.submissions'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = ''
    and attribute.attidentity = ''
    and attribute.attname = any(v_parent_keys);

  if nullif(v_assignments, '') is null
    or (
      select count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = 'public.submissions'::regclass
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attname = any(v_parent_keys)
    ) <> cardinality(v_parent_keys)
  then
    raise exception 'SUBMISSION_PARENT_COLUMNS_MISSING' using errcode = '55000';
  end if;

  execute format(
    'update public.submissions submission
       set %s,
           status = ''DRAFT'',
           payment_status = ''UNPAID''
     where submission.id = $2
       and submission.save_lease_token = $3
       and submission.updated_at = $4
     returning submission.updated_at',
    v_assignments
  )
  into v_parent_updated_at
  using p_parent, p_submission_id, p_lease_token, p_expected_updated_at;

  if v_parent_updated_at is null then
    raise exception 'SUBMISSION_SAVE_VERSION_CHANGED' using errcode = '40001';
  end if;

  if coalesce(p_replace_files, false)
    and to_regprocedure(
      'public.promote_verified_submission_etc_upload(uuid,jsonb,text)'
    ) is not null
  then
    execute
      'select public.promote_verified_submission_etc_upload($1, $2, $3)'
      using
        p_submission_id,
        coalesce(p_files, '[]'::jsonb),
        p_parent->>'payment_document_type';
  end if;

  select * into v_result
  from public.commit_submission_save(
    p_submission_id,
    p_lease_token,
    v_parent_updated_at,
    p_replace_tracks,
    p_tracks,
    p_replace_files,
    p_file_kind,
    p_files,
    p_sync_reviews,
    p_station_ids,
    p_final_status,
    p_final_payment_status
  );

  -- The file trigger in the follow-up upload-hardening migration preserves
  -- prior live rows in staging while replacement runs, and validates every
  -- inserted row against verified metadata. Only after the complete atomic
  -- commit succeeds may omitted/cancelled staging rows be retired. Dynamic
  -- SQL keeps this migration independently deployable before that table is
  -- introduced.
  if coalesce(p_replace_files, false)
    and to_regclass('public.submission_upload_staging') is not null
  then
    execute
      'delete from public.submission_upload_staging where submission_id = $1'
      using p_submission_id;
  end if;

  return query select
    v_result.submission_id,
    v_result.final_status,
    v_result.final_payment_status;
end;
$$;

revoke all on function public.commit_submission_save_v2(
  uuid, uuid, timestamptz, jsonb, boolean, jsonb, boolean, text, jsonb,
  boolean, uuid[], public.submission_status, public.payment_status
) from public, anon, authenticated;
grant execute on function public.commit_submission_save_v2(
  uuid, uuid, timestamptz, jsonb, boolean, jsonb, boolean, text, jsonb,
  boolean, uuid[], public.submission_status, public.payment_status
) to service_role;

create or replace function public.release_submission_save_lease(
  p_submission_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission public.submissions%rowtype;
  v_lease_mode text;
  v_released boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Submission save lease release requires the service role.'
      using errcode = '42501';
  end if;
  if p_submission_id is null or p_lease_token is null then
    raise exception 'SUBMISSION_SAVE_LEASE_RELEASE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select submission.*
    into v_submission
  from public.submissions submission
  where submission.id = p_submission_id
  for update;

  if not found
    or v_submission.save_lease_token is distinct from p_lease_token
  then
    return false;
  end if;
  if exists (
    select 1
    from public.submission_payments payment
    where payment.status = 'REQUESTED'
      and public.submission_payment_includes_submission(
        payment.submission_id,
        payment.raw_response,
        p_submission_id
      )
  ) then
    return false;
  end if;

  select snapshot.lease_mode
    into v_lease_mode
  from public.submission_save_lease_snapshots snapshot
  where snapshot.submission_id = p_submission_id
    and snapshot.lease_token = p_lease_token;

  if v_lease_mode = 'LEGACY_V1' then
    v_released := public.restore_submission_save_lease_snapshot(
      p_submission_id,
      p_lease_token
    );
  elsif v_lease_mode = 'ATOMIC_V2' then
    update public.submissions submission
    set save_lease_token = null,
        save_lease_expires_at = null
    where submission.id = p_submission_id
      and submission.save_lease_token = p_lease_token;
    v_released := found;
  end if;

  if not v_released then
    -- Compatibility for leases claimed by the pre-snapshot v1 function.
    update public.submissions submission
    set status = 'DRAFT',
        payment_status = 'UNPAID',
        save_lease_token = null,
        save_lease_expires_at = null
    where submission.id = p_submission_id
      and submission.save_lease_token = p_lease_token
      and submission.status = 'DRAFT'
      and submission.payment_status = 'UNPAID';
    v_released := found;
  end if;

  return v_released;
end;
$$;

revoke all on function public.release_submission_save_lease(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_submission_save_lease(uuid, uuid)
  to service_role;

commit;
