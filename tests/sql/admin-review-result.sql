do $$ begin
  if has_function_privilege('anon','public.save_submission_review_result(uuid,uuid,text,text,text,boolean,boolean)','execute')
    or has_function_privilege('authenticated','public.save_submission_review_result(uuid,uuid,text,text,text,boolean,boolean)','execute') then raise exception 'browser RPC privilege leaked'; end if;
end $$;
set role service_role;
do $$
declare sid uuid := '11111111-1111-4111-8111-111111111111'; actor uuid := '22222222-2222-4222-8222-222222222222'; result jsonb;
begin
  begin
    perform public.save_submission_review_result(sid,'33333333-3333-4333-8333-333333333333','15','APPROVED');
    raise exception 'non-admin actor accepted';
  exception when insufficient_privilege then null; end;
  result := public.save_submission_review_result(sid,actor,'15','APPROVED');
  if result->>'changed' <> 'true' or result->>'stationCount' <> '1' then raise exception 'initial result not committed'; end if;
  if not exists(select 1 from public.submissions where id=sid and status='RESULT_READY' and result_status='APPROVED' and mv_desired_rating='15')
    or not exists(select 1 from public.station_reviews where submission_id=sid and status='APPROVED') then raise exception 'atomic state missing'; end if;
  result := public.save_submission_review_result(sid,actor,'15','APPROVED');
  if result->>'changed' <> 'false' or (select count(*) from public.submission_events) <> 1 then raise exception 'duplicate result repeated event'; end if;
  -- A legacy partial save must be repaired even though the submission already matches.
  update public.station_reviews set status='SENT' where submission_id=sid;
  result := public.save_submission_review_result(sid,actor,'15','APPROVED');
  if result->>'changed' <> 'true' or not exists(select 1 from public.station_reviews where submission_id=sid and status='APPROVED') then raise exception 'partial state not repaired'; end if;
  result := public.save_submission_review_result('44444444-4444-4444-8444-444444444444',actor,null,'NEEDS_FIX','고객에게 공개할 결과',true,true);
  if result->>'changed' <> 'true' or result->>'stationCount' <> '0' then raise exception 'album result failed'; end if;
end $$;
reset role;
-- Simulate a failing station write: result/rating/audit must all roll back.
alter table public.station_reviews add constraint fixture_station_failure check(status <> 'REJECTED') not valid;
set role service_role;
do $$ begin
  begin
    perform public.save_submission_review_result('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','REJECT','REJECTED');
    raise exception 'station failure did not abort';
  exception when check_violation then null; end;
  if exists(select 1 from public.submissions where id='11111111-1111-4111-8111-111111111111' and (result_status <> 'APPROVED' or mv_desired_rating <> '15'))
    or (select count(*) from public.submission_events) <> 3 then raise exception 'station failure left partial commit'; end if;
end $$;
reset role;
alter table public.station_reviews drop constraint fixture_station_failure;
-- An audit insert failure must roll back both station and submission updates.
alter table public.submission_events add constraint fixture_audit_failure check(false) not valid;
set role service_role;
do $$ begin
  begin
    perform public.save_submission_review_result('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','REJECT','REJECTED');
    raise exception 'audit failure did not abort';
  exception when check_violation then null; end;
  if exists(select 1 from public.submissions where id='11111111-1111-4111-8111-111111111111' and (result_status <> 'APPROVED' or mv_desired_rating <> '15'))
    or exists(select 1 from public.station_reviews where submission_id='11111111-1111-4111-8111-111111111111' and status <> 'APPROVED')
    or (select count(*) from public.submission_events) <> 3 then raise exception 'audit failure left partial commit'; end if;
end $$;
reset role;
