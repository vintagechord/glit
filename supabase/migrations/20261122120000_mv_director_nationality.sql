-- The 영등위 online music video form asks for the director's nationality
-- (뮤직비디오 감독(국적)). The MV wizard now asks for it on online reviews and
-- the administrator's application view shows it next to the storyline.
-- No existing submissions are changed.
begin;

alter table public.submissions add column if not exists mv_director_nationality text;

-- Same function as 0102_archive_review_entry_context.sql except that the
-- wizard may now save mv_director_nationality.
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
    'mv_runtime', 'mv_format', 'mv_director', 'mv_director_nationality', 'mv_lead_actor',
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


-- Same function as 20261107120000_mv_online_without_etn.sql except that an
-- administrator's guest MV intake also stores the director's nationality.
create or replace function public.admin_register_guest_mv(
  p_actor_user_id uuid,
  p_guest_token text,
  p_type text,
  p_amount_krw integer,
  p_paid boolean,
  p_station_codes text[],
  p_parent jsonb
)
returns table(submission_id uuid, created boolean)
language plpgsql security invoker set search_path=public as $$
declare
  v_id uuid; v_user uuid; v_type text; v_title text; v_artist text; v_guest_name text;
  v_release text; v_production text; v_paid boolean := coalesce(p_paid, false);
  v_codes text[]; v_allowed text[]; v_station_ids uuid[];
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if coalesce(p_guest_token,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'GUEST_TOKEN_INVALID' using errcode='22023'; end if;
  if p_type not in ('MV_DISTRIBUTION','MV_BROADCAST') then
    raise exception 'MV_TYPE_INVALID' using errcode='22023'; end if;

  select s.id, s.user_id, s.type::text into v_id, v_user, v_type from public.submissions s where s.guest_token=p_guest_token;
  if found then
    if v_user is not null or v_type<>p_type then raise exception 'GUEST_TOKEN_TAKEN' using errcode='23505'; end if;
    return query select v_id, false; return;
  end if;

  if jsonb_typeof(coalesce(p_parent,'null'::jsonb))<>'object' then raise exception 'MV_FIELDS_REQUIRED' using errcode='22023'; end if;
  v_title := nullif(btrim(coalesce(p_parent->>'title','')),'');
  v_artist := nullif(btrim(coalesce(p_parent->>'artist_name','')),'');
  v_guest_name := nullif(btrim(coalesce(p_parent->>'guest_name','')),'');
  v_release := nullif(btrim(coalesce(p_parent->>'release_date','')),'');
  v_production := nullif(btrim(coalesce(p_parent->>'mv_production_date','')),'');
  if v_title is null or v_artist is null then raise exception 'MV_FIELDS_REQUIRED' using errcode='22023'; end if;
  if v_guest_name is null then raise exception 'GUEST_NAME_REQUIRED' using errcode='22023'; end if;
  if (v_release is not null and v_release !~ '^\d{4}-\d{2}-\d{2}$')
    or (v_production is not null and v_production !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'RELEASE_DATE_INVALID' using errcode='22023'; end if;
  if coalesce(p_amount_krw,0)<=0 then raise exception 'AMOUNT_INVALID' using errcode='22023'; end if;

  -- The same station choices the MV wizard offers (submission-station-selection.ts).
  -- ETN takes broadcast delivery (입고) only, so it is no longer an online add-on.
  v_allowed := case when p_type='MV_BROADCAST' then array['KBS','MBC','SBS','ETN'] else array['MNET'] end;
  select coalesce(array_agg(distinct upper(btrim(code))) filter (where nullif(btrim(code),'') is not null), '{}'::text[])
    into v_codes from unnest(coalesce(p_station_codes,'{}'::text[])) code;
  if not (v_codes <@ v_allowed) or (p_type='MV_BROADCAST' and cardinality(v_codes)=0) then
    raise exception 'MV_STATIONS_INVALID' using errcode='22023'; end if;
  select coalesce(array_agg(st.id order by st.code), '{}'::uuid[]) into v_station_ids
  from public.stations st where st.code=any(v_codes) and st.is_active;
  if cardinality(v_station_ids)<>cardinality(v_codes) then
    raise exception 'MV_STATIONS_INVALID' using errcode='22023'; end if;

  insert into public.submissions(
    user_id, guest_token, type, title, artist_name, artist_id, release_date, genre,
    mv_runtime, mv_director, mv_director_nationality, mv_lead_actor, mv_storyline, mv_production_company, mv_agency, mv_album_title,
    mv_production_date, mv_distribution_company, mv_business_reg_no, mv_usage, mv_desired_rating, mv_memo,
    mv_song_title, mv_song_title_kr, mv_song_title_en, mv_composer, mv_lyricist, mv_arranger, mv_lyrics,
    mv_base_selected, mv_selected_station_codes,
    applicant_name, applicant_email, applicant_phone, guest_name, guest_company, guest_email, guest_phone,
    amount_krw, payment_method, files_submitted_by_email, admin_memo, status, payment_status
  ) values (
    null, p_guest_token, p_type::public.submission_type, v_title, v_artist, nullif(p_parent->>'artist_id','')::uuid,
    v_release::date, nullif(btrim(coalesce(p_parent->>'genre','')),''),
    nullif(btrim(coalesce(p_parent->>'mv_runtime','')),''), nullif(btrim(coalesce(p_parent->>'mv_director','')),''),
    nullif(btrim(coalesce(p_parent->>'mv_director_nationality','')),''),
    nullif(btrim(coalesce(p_parent->>'mv_lead_actor','')),''), nullif(btrim(coalesce(p_parent->>'mv_storyline','')),''),
    nullif(btrim(coalesce(p_parent->>'mv_production_company','')),''), nullif(btrim(coalesce(p_parent->>'mv_agency','')),''),
    nullif(btrim(coalesce(p_parent->>'mv_album_title','')),''), v_production::date,
    nullif(btrim(coalesce(p_parent->>'mv_distribution_company','')),''), nullif(btrim(coalesce(p_parent->>'mv_business_reg_no','')),''),
    nullif(btrim(coalesce(p_parent->>'mv_usage','')),''),
    case when p_type='MV_DISTRIBUTION' then nullif(btrim(coalesce(p_parent->>'mv_desired_rating','')),'') end,
    nullif(btrim(coalesce(p_parent->>'mv_memo','')),''),
    v_title, nullif(btrim(coalesce(p_parent->>'mv_song_title_kr','')),''), nullif(btrim(coalesce(p_parent->>'mv_song_title_en','')),''),
    nullif(btrim(coalesce(p_parent->>'mv_composer','')),''), nullif(btrim(coalesce(p_parent->>'mv_lyricist','')),''),
    nullif(btrim(coalesce(p_parent->>'mv_arranger','')),''), nullif(btrim(coalesce(p_parent->>'mv_lyrics','')),''),
    p_type='MV_DISTRIBUTION', v_codes,
    nullif(btrim(coalesce(p_parent->>'applicant_name','')),''), nullif(btrim(coalesce(p_parent->>'applicant_email','')),''),
    nullif(btrim(coalesce(p_parent->>'applicant_phone','')),''),
    v_guest_name, nullif(btrim(coalesce(p_parent->>'guest_company','')),''), nullif(btrim(coalesce(p_parent->>'guest_email','')),''),
    nullif(btrim(coalesce(p_parent->>'guest_phone','')),''),
    p_amount_krw, 'BANK', true,
    nullif(btrim(coalesce(p_parent->>'admin_memo','')),''),
    case when v_paid then 'PRE_REVIEW' else 'SUBMITTED' end::public.submission_status,
    case when v_paid then 'PAID' else 'UNPAID' end::public.payment_status
  ) returning id into v_id;

  insert into public.station_reviews(submission_id, station_id, status)
  select v_id, station_id, 'NOT_SENT' from unnest(v_station_ids) station_id;

  insert into public.submission_events(submission_id, actor_user_id, event_type, message)
  values (v_id, p_actor_user_id, 'ADMIN_INTAKE', '관리자가 이메일 등으로 받은 자료로 비회원 뮤직비디오 심의를 대신 접수했습니다.');
  if v_paid then
    insert into public.submission_events(submission_id, actor_user_id, event_type, message)
    values (v_id, p_actor_user_id, 'PAYMENT', '관리자가 입금을 확인해 결제 완료로 등록했습니다.');
  end if;
  return query select v_id, true;
end;
$$;
revoke all on function public.admin_register_guest_mv(uuid,text,text,integer,boolean,text[],jsonb) from public,anon,authenticated;
grant execute on function public.admin_register_guest_mv(uuid,text,text,integer,boolean,text[],jsonb) to service_role;

commit;
