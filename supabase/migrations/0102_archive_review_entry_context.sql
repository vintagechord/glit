-- Persist the exact owner-selected archive scope through draft/cart reopening.
-- No existing submissions are changed. Writes remain service-role only.
begin;

alter table public.submissions add column if not exists archive_review_context jsonb;
alter table public.submissions add constraint submissions_archive_review_context_check check (
  archive_review_context is null or case
    when jsonb_typeof(archive_review_context) = 'object'
      and jsonb_typeof(archive_review_context->'trackIds') = 'array'
    then octet_length(archive_review_context::text) <= 30000
      and jsonb_typeof(archive_review_context->'libraryId') = 'string'
      and jsonb_typeof(archive_review_context->'releaseId') = 'string'
      and coalesce(archive_review_context->>'libraryId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(length(archive_review_context->>'releaseId'), 0) between 1 and 200
      and (not archive_review_context ? 'trackId' or (jsonb_typeof(archive_review_context->'trackId') = 'string' and length(archive_review_context->>'trackId') between 1 and 200))
      and jsonb_array_length(archive_review_context->'trackIds') between 1 and 100
      and not jsonb_path_exists(archive_review_context, '$.trackIds[*] ? (@.type() != "string")')
    else false end
);

create or replace function public.protect_archive_review_context()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT' and new.archive_review_context is not null)
    or (tg_op = 'UPDATE' and new.archive_review_context is distinct from old.archive_review_context)
  then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'ARCHIVE_REVIEW_CONTEXT_SERVER_ONLY' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_archive_review_context() from public, anon, authenticated;
create trigger protect_archive_review_context before insert or update on public.submissions
for each row execute function public.protect_archive_review_context();

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
    'user_id', 'type', 'title', 'artist_name', 'artist_id', 'archive_review_context',
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


commit;
