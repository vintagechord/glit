-- An administrator registers an album review that a customer sent by email
-- as a guest (비회원) submission. One transaction creates the submission,
-- its tracks and one NOT_SENT review per active package station, so the
-- customer can follow results at /track/<guest_token> and the admin pages and
-- review desk save results the usual way. The desk's request ID is the guest
-- token, so a retried request returns the first result instead of a copy.
create or replace function public.admin_register_guest_album(
  p_actor_user_id uuid,
  p_guest_token text,
  p_package_id uuid,
  p_amount_krw integer,
  p_paid boolean,
  p_parent jsonb,
  p_tracks jsonb
)
returns table(submission_id uuid, created boolean)
language plpgsql security invoker set search_path=public as $$
declare
  v_id uuid; v_user uuid; v_type text; v_station_count integer; v_station_ids uuid[];
  v_title text; v_artist text; v_guest_name text; v_release text; v_paid boolean := coalesce(p_paid, false);
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if coalesce(p_guest_token,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'GUEST_TOKEN_INVALID' using errcode='22023'; end if;

  select s.id, s.user_id, s.type::text into v_id, v_user, v_type from public.submissions s where s.guest_token=p_guest_token;
  if found then
    if v_user is not null or v_type<>'ALBUM' then raise exception 'GUEST_TOKEN_TAKEN' using errcode='23505'; end if;
    return query select v_id, false; return;
  end if;

  if jsonb_typeof(coalesce(p_parent,'null'::jsonb))<>'object' then raise exception 'ALBUM_FIELDS_REQUIRED' using errcode='22023'; end if;
  v_title := nullif(btrim(coalesce(p_parent->>'title','')),'');
  v_artist := nullif(btrim(coalesce(p_parent->>'artist_name','')),'');
  v_guest_name := nullif(btrim(coalesce(p_parent->>'guest_name','')),'');
  v_release := nullif(btrim(coalesce(p_parent->>'release_date','')),'');
  if v_title is null or v_artist is null then raise exception 'ALBUM_FIELDS_REQUIRED' using errcode='22023'; end if;
  if v_guest_name is null then raise exception 'GUEST_NAME_REQUIRED' using errcode='22023'; end if;
  if v_release is not null and v_release !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'RELEASE_DATE_INVALID' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_tracks,'null'::jsonb))<>'array' or jsonb_array_length(p_tracks) not between 1 and 100
    or exists(select 1 from jsonb_array_elements(p_tracks) t where jsonb_typeof(t)<>'object' or nullif(btrim(coalesce(t->>'track_title','')),'') is null) then
    raise exception 'ALBUM_TRACKS_INVALID' using errcode='22023'; end if;
  if coalesce(p_amount_krw,0)<=0 then raise exception 'AMOUNT_INVALID' using errcode='22023'; end if;

  select p.station_count into v_station_count from public.packages p where p.id=p_package_id and p.is_active;
  if not found then raise exception 'PACKAGE_INVALID' using errcode='22023'; end if;
  select coalesce(array_agg(ps.station_id order by ps.station_id), '{}'::uuid[]) into v_station_ids
  from public.package_stations ps join public.stations st on st.id=ps.station_id and st.is_active
  where ps.package_id=p_package_id;
  if cardinality(v_station_ids)=0 or cardinality(v_station_ids)<>v_station_count then
    raise exception 'PACKAGE_STATIONS_INVALID' using errcode='22023'; end if;

  insert into public.submissions(
    user_id, guest_token, type, title, artist_name, artist_id, artist_name_kr, artist_name_en, release_date, genre,
    distributor, production_company, previous_release, artist_type, artist_members,
    applicant_name, applicant_email, applicant_phone, guest_name, guest_company, guest_email, guest_phone,
    package_id, amount_krw, album_base_price_krw, album_price_tier, payment_method, files_submitted_by_email,
    admin_memo, status, payment_status
  ) values (
    null, p_guest_token, 'ALBUM', v_title, v_artist, nullif(p_parent->>'artist_id','')::uuid,
    nullif(btrim(coalesce(p_parent->>'artist_name_kr','')),''), nullif(btrim(coalesce(p_parent->>'artist_name_en','')),''),
    v_release::date, nullif(btrim(coalesce(p_parent->>'genre','')),''),
    nullif(btrim(coalesce(p_parent->>'distributor','')),''), nullif(btrim(coalesce(p_parent->>'production_company','')),''),
    nullif(btrim(coalesce(p_parent->>'previous_release','')),''), nullif(btrim(coalesce(p_parent->>'artist_type','')),''),
    nullif(btrim(coalesce(p_parent->>'artist_members','')),''),
    nullif(btrim(coalesce(p_parent->>'applicant_name','')),''), nullif(btrim(coalesce(p_parent->>'applicant_email','')),''),
    nullif(btrim(coalesce(p_parent->>'applicant_phone','')),''),
    v_guest_name, nullif(btrim(coalesce(p_parent->>'guest_company','')),''), nullif(btrim(coalesce(p_parent->>'guest_email','')),''),
    nullif(btrim(coalesce(p_parent->>'guest_phone','')),''),
    p_package_id, p_amount_krw, p_amount_krw, 'FULL', 'BANK', true,
    nullif(btrim(coalesce(p_parent->>'admin_memo','')),''),
    case when v_paid then 'PRE_REVIEW' else 'SUBMITTED' end::public.submission_status,
    case when v_paid then 'PAID' else 'UNPAID' end::public.payment_status
  ) returning id into v_id;

  insert into public.album_tracks(
    submission_id, track_no, track_title, performer, featuring, composer, lyricist, arranger,
    lyrics, translated_lyrics, notes, is_title, title_role, broadcast_selected
  )
  select v_id, row_number() over (order by t.ordinality)::integer, btrim(t.value->>'track_title'),
    coalesce(nullif(btrim(coalesce(t.value->>'performer','')),''), v_artist),
    nullif(btrim(coalesce(t.value->>'featuring','')),''), nullif(btrim(coalesce(t.value->>'composer','')),''),
    nullif(btrim(coalesce(t.value->>'lyricist','')),''), nullif(btrim(coalesce(t.value->>'arranger','')),''),
    nullif(btrim(coalesce(t.value->>'lyrics','')),''), nullif(btrim(coalesce(t.value->>'translated_lyrics','')),''),
    nullif(btrim(coalesce(t.value->>'notes','')),''),
    coalesce((t.value->>'is_title')::boolean, false),
    case when t.value->>'title_role' in ('MAIN','SUB') then t.value->>'title_role' end,
    coalesce((t.value->>'broadcast_selected')::boolean, false)
  from jsonb_array_elements(p_tracks) with ordinality t(value, ordinality);

  insert into public.station_reviews(submission_id, station_id, status)
  select v_id, station_id, 'NOT_SENT' from unnest(v_station_ids) station_id;

  insert into public.submission_events(submission_id, actor_user_id, event_type, message)
  values (v_id, p_actor_user_id, 'ADMIN_INTAKE', '관리자가 이메일 등으로 받은 자료로 비회원 음반 심의를 대신 접수했습니다.');
  if v_paid then
    insert into public.submission_events(submission_id, actor_user_id, event_type, message)
    values (v_id, p_actor_user_id, 'PAYMENT', '관리자가 입금을 확인해 결제 완료로 등록했습니다.');
  end if;
  return query select v_id, true;
end;
$$;
revoke all on function public.admin_register_guest_album(uuid,text,uuid,integer,boolean,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.admin_register_guest_album(uuid,text,uuid,integer,boolean,jsonb,jsonb) to service_role;
