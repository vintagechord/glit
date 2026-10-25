-- Per-station broadcast ratings and shared transactional writes for web and Mac.
alter table public.station_reviews add column if not exists age_rating text;
alter table public.station_reviews add constraint station_reviews_age_rating_check
  check (age_rating is null or age_rating in ('ALL','12','15','19'));
comment on column public.station_reviews.age_rating is 'Final age rating issued by this requested broadcast station. Never inferred from another station.';

create function public.save_station_review_result(
  p_submission_id uuid, p_station_id uuid, p_actor_user_id uuid,
  p_expected_updated_at timestamptz, p_status text,
  p_result_note text default null, p_track_results jsonb default '[]'::jsonb,
  p_age_rating text default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  s public.submissions%rowtype;
  r public.station_reviews%rowtype;
  station_code text;
  station_name text;
  exists_row boolean;
  final_note text := nullif(btrim(p_result_note),'');
  final_rating text;
  final_tracks jsonb := coalesce(p_track_results,'[]'::jsonb);
  changed_at timestamptz := clock_timestamp();
  expected_count integer;
  complete_count integer;
  approved_count integer;
  rejected_count integer;
  fixes_count integer;
  next_status public.submission_status;
  next_result text;
  track_count integer;
  selected_count integer;
  result_count integer;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  select * into s from public.submissions where id=p_submission_id for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if s.type::text not in ('ALBUM','MV_BROADCAST') then raise exception 'REVIEW_TYPE_INVALID'; end if;
  if p_status not in ('NOT_SENT','SENT','RECEIVED','APPROVED','REJECTED','NEEDS_FIX') or p_status is null then raise exception 'REVIEW_STATUS_INVALID'; end if;
  if char_length(coalesce(final_note,''))>4000 then raise exception 'REVIEW_MEMO_INVALID'; end if;
  select code,name into station_code,station_name from public.stations where id=p_station_id;
  if not found then raise exception 'REVIEW_STATION_NOT_REQUESTED'; end if;
  if s.type::text='MV_BROADCAST' and station_code in ('MV_BROADCAST','MV_ONLINE') then raise exception 'REVIEW_STATION_NOT_REQUESTED'; end if;
  select * into r from public.station_reviews where submission_id=s.id and station_id=p_station_id for update;
  exists_row := found;
  if (exists_row and r.updated_at is distinct from p_expected_updated_at) or (not exists_row and p_expected_updated_at is not null) then raise exception 'REVIEW_CONFLICT'; end if;
  if not exists_row and not exists(select 1 from public.package_stations where package_id=s.package_id and station_id=p_station_id)
    and not (s.type::text='MV_BROADCAST' and station_code=any(coalesce(s.mv_selected_station_codes,'{}'::text[]))) then
    raise exception 'REVIEW_STATION_NOT_REQUESTED';
  end if;
  if jsonb_typeof(final_tracks)<>'array' or jsonb_array_length(final_tracks)>999 then raise exception 'REVIEW_TRACK_INVALID'; end if;
  if s.type::text='MV_BROADCAST' then
    if jsonb_array_length(final_tracks)>0 then raise exception 'REVIEW_TRACK_INVALID'; end if;
    final_rating := case when p_status='APPROVED' then p_age_rating else null end;
    if p_status='APPROVED' and final_rating is null then raise exception 'REVIEW_RATING_REQUIRED'; end if;
    if final_rating is not null and final_rating not in ('ALL','12','15','19') then raise exception 'REVIEW_RATING_INVALID'; end if;
  else
    if p_age_rating is not null then raise exception 'REVIEW_RATING_INVALID'; end if;
    if exists(select 1 from jsonb_array_elements(final_tracks) t
      where coalesce(t->>'status','') not in ('PENDING','APPROVED','REJECTED')
        or not exists(select 1 from public.album_tracks a where a.submission_id=s.id and a.id::text=t->>'track_id' and a.track_no::text=t->>'track_no'))
      or (select count(distinct t->>'track_id') from jsonb_array_elements(final_tracks) t) <> jsonb_array_length(final_tracks)
    then raise exception 'REVIEW_TRACK_INVALID'; end if;
    select count(*),count(*) filter(where broadcast_selected=true) into track_count,selected_count from public.album_tracks where submission_id=s.id;
    result_count := jsonb_array_length(final_tracks);
    if upper(station_code)='WBS' and track_count>3 then
      if selected_count between 1 and 3 then
        if result_count<>selected_count or exists(select 1 from jsonb_array_elements(final_tracks) t join public.album_tracks a on a.id::text=t->>'track_id' where a.broadcast_selected is distinct from true) then raise exception 'REVIEW_TRACK_INVALID'; end if;
      elsif (select count(*) from jsonb_array_elements(final_tracks) t where t->>'status'<>'PENDING')>3 then raise exception 'REVIEW_TRACK_INVALID';
      elsif result_count not in (3,track_count) then raise exception 'REVIEW_TRACK_INVALID';
      end if;
    elsif result_count<>track_count then raise exception 'REVIEW_TRACK_INVALID';
    end if;
    if p_status in ('APPROVED','REJECTED') and exists(select 1 from jsonb_array_elements(final_tracks) t where t->>'status'='PENDING') then raise exception 'REVIEW_TRACK_INVALID'; end if;
    if p_status='REJECTED' and exists(select 1 from jsonb_array_elements(final_tracks) t where t->>'status'='APPROVED') then raise exception 'REVIEW_TRACK_INVALID'; end if;
  end if;
  if exists_row and r.status::text=p_status and r.result_note is not distinct from final_note
    and coalesce(r.track_results_json,'[]'::jsonb)=final_tracks and r.age_rating is not distinct from final_rating then
    return jsonb_build_object('completed',true,'changed',false,'row',to_jsonb(r),'submissionStatus',s.status,'resultStatus',s.result_status);
  end if;
  if exists_row then
    update public.station_reviews set status=p_status::public.station_review_status,result_note=final_note,
      track_results_json=final_tracks,age_rating=final_rating,updated_at=changed_at where id=r.id returning * into r;
  else
    insert into public.station_reviews(submission_id,station_id,status,result_note,track_results_json,age_rating,updated_at)
      values(s.id,p_station_id,p_status::public.station_review_status,final_note,final_tracks,final_rating,changed_at) returning * into r;
  end if;
  select count(*) into expected_count from (
    select review.station_id from public.station_reviews review join public.stations station on station.id=review.station_id
      where review.submission_id=s.id and (s.type::text<>'MV_BROADCAST' or station.code not in ('MV_BROADCAST','MV_ONLINE'))
    union select station_id from public.package_stations where package_id=s.package_id
    union select id from public.stations where s.type::text='MV_BROADCAST' and code not in ('MV_BROADCAST','MV_ONLINE') and code=any(coalesce(s.mv_selected_station_codes,'{}'::text[]))
  ) requested;
  select count(*) filter(where status::text in ('APPROVED','REJECTED')),
    count(*) filter(where status::text='APPROVED'),count(*) filter(where status::text='REJECTED'),count(*) filter(where status::text='NEEDS_FIX')
    into complete_count,approved_count,rejected_count,fixes_count from public.station_reviews review
      join public.stations station on station.id=review.station_id
      where review.submission_id=s.id and (s.type::text<>'MV_BROADCAST' or station.code not in ('MV_BROADCAST','MV_ONLINE'));
  next_status := case when expected_count>0 and complete_count>=expected_count then 'RESULT_READY'
    when exists(select 1 from public.station_reviews where submission_id=s.id and status::text<>'NOT_SENT') then 'IN_PROGRESS' else 'SUBMITTED' end;
  next_result := case when expected_count>0 and complete_count>=expected_count then case when approved_count>0 then 'APPROVED' else 'REJECTED' end
    when fixes_count>0 then 'NEEDS_FIX' else null end;
  update public.submissions set status=next_status,result_status=next_result,result_notified_at=null,updated_at=changed_at where id=s.id;
  insert into public.submission_events(submission_id,actor_user_id,event_type,message)
    values(s.id,p_actor_user_id,'STATION_UPDATE',station_name||' 심의 상태: '||p_status||case when final_rating is not null then ' / 등급: '||final_rating else '' end);
  return jsonb_build_object('completed',true,'changed',true,'row',to_jsonb(r),'changeKey',changed_at,'submissionStatus',next_status,'resultStatus',next_result);
end;
$$;
revoke all on function public.save_station_review_result(uuid,uuid,uuid,timestamptz,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_station_review_result(uuid,uuid,uuid,timestamptz,text,text,jsonb,text) to service_role;

-- Keep result publication, MV station state and its audit event in one transaction.
-- Only the trusted server may supply the actor obtained from requireAdmin/getUser.
create or replace function public.save_submission_review_result(
  p_submission_id uuid,
  p_actor_user_id uuid,
  p_rating text default null,
  p_result_status text default null,
  p_result_memo text default null,
  p_set_result_memo boolean default false,
  p_allow_album boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.submissions%rowtype;
  final_rating text;
  final_result text;
  final_memo text;
  station_status public.station_review_status;
  station_count integer := 0;
  fallback_id uuid;
  changed boolean;
  changed_at timestamptz := clock_timestamp();
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  select * into s from public.submissions where id=p_submission_id for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if s.type::text='MV_BROADCAST' then raise exception 'REVIEW_BROADCAST_PER_STATION_REQUIRED'; end if;
  if s.type::text not in ('MV_DISTRIBUTION','MV_BROADCAST') and not p_allow_album then
    raise exception 'REVIEW_TYPE_INVALID';
  end if;
  if p_rating is not null and (s.type::text <> 'MV_DISTRIBUTION' or p_rating not in ('ALL','12','15','18','19','REJECT')) then
    raise exception 'REVIEW_RATING_INVALID';
  end if;
  final_rating := case when s.type::text='MV_DISTRIBUTION' then coalesce(p_rating,s.mv_desired_rating) else null end;
  final_result := coalesce(p_result_status, case when p_rating='REJECT' then 'REJECTED' when p_rating is not null then 'APPROVED' end, s.result_status);
  if final_result is null or final_result not in ('APPROVED','REJECTED','NEEDS_FIX') then raise exception 'REVIEW_RESULT_INVALID'; end if;
  final_memo := case when p_set_result_memo then nullif(btrim(p_result_memo),'') else s.result_memo end;
  if char_length(coalesce(final_memo,'')) > 4000 then raise exception 'REVIEW_MEMO_INVALID'; end if;
  station_status := final_result::public.station_review_status;
  changed := s.status::text is distinct from 'RESULT_READY'
    or s.result_status is distinct from final_result
    or s.result_memo is distinct from final_memo
    or (s.type::text like 'MV_%' and s.mv_desired_rating is distinct from final_rating);

  if s.type::text like 'MV_%' then
    perform 1 from public.station_reviews where submission_id=s.id order by id for update;
    select count(*) into station_count from public.station_reviews where submission_id=s.id;
    changed := changed or station_count=0 or exists(
      select 1 from public.station_reviews where submission_id=s.id
        and (status is distinct from station_status or result_note is distinct from final_memo)
    );
  end if;
  if not changed then
    return jsonb_build_object('completed',true,'changed',false,'stationCount',station_count,'resultStatus',final_result);
  end if;

  if s.type::text like 'MV_%' then
    if station_count=0 then
      insert into public.stations(code,name,is_active)
        values(case when s.type::text='MV_DISTRIBUTION' then 'MV_ONLINE' else 'MV_BROADCAST' end,
          case when s.type::text='MV_DISTRIBUTION' then '영상물등급위원회' else '신청 방송국' end,true)
        on conflict(code) do update set is_active=true
        returning id into fallback_id;
      insert into public.station_reviews(submission_id,station_id,status,result_note,updated_at)
        values(s.id,fallback_id,station_status,final_memo,changed_at);
      station_count := 1;
    else
      update public.station_reviews set status=station_status,result_note=final_memo,updated_at=changed_at
        where submission_id=s.id;
    end if;
  end if;
  update public.submissions set status='RESULT_READY',result_status=final_result,result_memo=final_memo,
    mv_desired_rating=case when s.type::text like 'MV_%' then final_rating else s.mv_desired_rating end,
    result_notified_at=null,updated_at=changed_at where id=s.id;
  insert into public.submission_events(submission_id,actor_user_id,event_type,message)
    values(s.id,p_actor_user_id,'RESULT_UPDATE','관리자가 심의 결과를 저장했습니다. 신청 내역에서 결과를 확인해주세요.');
  return jsonb_build_object('completed',true,'changed',true,'stationCount',station_count,'resultStatus',final_result,'changeKey',changed_at);
end;
$$;
revoke all on function public.save_submission_review_result(uuid,uuid,text,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.save_submission_review_result(uuid,uuid,text,text,text,boolean,boolean) to service_role;

-- An online result uses its displayed submission revision, and retains the same
-- atomic publication rules as the administrator's existing result flow.
create function public.save_online_review_result(
  p_submission_id uuid,p_actor_user_id uuid,p_expected_updated_at timestamptz,
  p_rating text,p_result_memo text default null,p_set_result_memo boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.submissions%rowtype;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then raise exception 'REVIEW_FORBIDDEN' using errcode='42501'; end if;
  select * into s from public.submissions where id=p_submission_id for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if s.type::text<>'MV_DISTRIBUTION' then raise exception 'REVIEW_TYPE_INVALID'; end if;
  if p_expected_updated_at is null or s.updated_at is distinct from p_expected_updated_at then raise exception 'REVIEW_CONFLICT'; end if;
  return public.save_submission_review_result(s.id,p_actor_user_id,p_rating,null,p_result_memo,p_set_result_memo,false);
end;
$$;
revoke all on function public.save_online_review_result(uuid,uuid,timestamptz,text,text,boolean) from public,anon,authenticated;
grant execute on function public.save_online_review_result(uuid,uuid,timestamptz,text,text,boolean) to service_role;

create function public.record_managed_submission_certificate(
  p_submission_id uuid,p_actor_user_id uuid,p_expected_updated_at timestamptz,
  p_object_key text,p_original_name text,p_mime_type text,p_size_bytes bigint,p_uploaded_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.submissions%rowtype; changed_at timestamptz;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then raise exception 'REVIEW_FORBIDDEN' using errcode='42501'; end if;
  select * into s from public.submissions where id=p_submission_id for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if s.type::text<>'MV_DISTRIBUTION' then raise exception 'REVIEW_TYPE_INVALID'; end if;
  if s.certificate_b2_path=p_object_key then
    if s.certificate_original_name is distinct from p_original_name or s.certificate_mime is distinct from p_mime_type or s.certificate_size is distinct from p_size_bytes then raise exception 'CERTIFICATE_METADATA_CONFLICT'; end if;
    return jsonb_build_object('completed',true,'changed',false,'uploadedAt',s.certificate_uploaded_at,'changeKey',s.certificate_uploaded_at,'updatedAt',s.updated_at);
  end if;
  if p_expected_updated_at is null or s.updated_at is distinct from p_expected_updated_at then raise exception 'REVIEW_CONFLICT'; end if;
  perform public.record_submission_certificate(s.id,p_actor_user_id,p_object_key,p_original_name,p_mime_type,p_size_bytes,p_uploaded_at);
  changed_at := clock_timestamp();
  update public.submissions set result_notified_at=null,updated_at=changed_at where id=s.id returning updated_at into changed_at;
  return jsonb_build_object('completed',true,'changed',true,'uploadedAt',p_uploaded_at,'changeKey',p_uploaded_at,'updatedAt',changed_at);
end;
$$;
revoke all on function public.record_managed_submission_certificate(uuid,uuid,timestamptz,text,text,text,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.record_managed_submission_certificate(uuid,uuid,timestamptz,text,text,text,bigint,timestamptz) to service_role;

-- Read-only deployment capability probe for the authenticated private Mac bridge.
create function public.review_desk_protocol_status() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('protocol',2) $$;
revoke all on function public.review_desk_protocol_status() from public,anon,authenticated;
grant execute on function public.review_desk_protocol_status() to service_role;
