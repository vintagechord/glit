-- Keep result publication, MV station state and its audit event in one transaction.
-- Only the trusted server may supply the actor obtained from requireAdmin/getUser.
create function public.save_submission_review_result(
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
