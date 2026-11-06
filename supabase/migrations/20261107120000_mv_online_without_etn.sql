-- ETN only accepts broadcast delivery (입고) now (owner, 2026-11-07), so an
-- administrator's guest MV intake no longer offers ETN on online
-- distribution reviews; it stays a broadcast choice at the same 30,000원.
-- Same function as 20261105120000 except for the allowed online codes.
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
    mv_runtime, mv_director, mv_lead_actor, mv_storyline, mv_production_company, mv_agency, mv_album_title,
    mv_production_date, mv_distribution_company, mv_business_reg_no, mv_usage, mv_desired_rating, mv_memo,
    mv_song_title, mv_song_title_kr, mv_song_title_en, mv_composer, mv_lyricist, mv_arranger, mv_lyrics,
    mv_base_selected, mv_selected_station_codes,
    applicant_name, applicant_email, applicant_phone, guest_name, guest_company, guest_email, guest_phone,
    amount_krw, payment_method, files_submitted_by_email, admin_memo, status, payment_status
  ) values (
    null, p_guest_token, p_type::public.submission_type, v_title, v_artist, nullif(p_parent->>'artist_id','')::uuid,
    v_release::date, nullif(btrim(coalesce(p_parent->>'genre','')),''),
    nullif(btrim(coalesce(p_parent->>'mv_runtime','')),''), nullif(btrim(coalesce(p_parent->>'mv_director','')),''),
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
