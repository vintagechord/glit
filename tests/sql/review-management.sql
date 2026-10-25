do $$ begin
  if has_function_privilege('anon','public.save_station_review_result(uuid,uuid,uuid,timestamptz,text,text,jsonb,text)','execute')
    or has_function_privilege('authenticated','public.save_online_review_result(uuid,uuid,timestamptz,text,text,boolean)','execute')
    or has_function_privilege('authenticated','public.record_managed_submission_certificate(uuid,uuid,timestamptz,text,text,text,bigint,timestamptz)','execute') then raise exception 'browser RPC privilege leaked'; end if;
end $$;
set role service_role;
do $$
declare sid uuid := '55555555-5555-4555-8555-555555555555'; actor uuid := '22222222-2222-4222-8222-222222222222';
  kbs uuid := '66666666-6666-4666-8666-666666666666'; mbc uuid := '77777777-7777-4777-8777-777777777777'; wbs uuid := '88888888-8888-4888-8888-888888888888';
  result jsonb; revision timestamptz; before_events integer;
begin
  begin
    perform public.save_station_review_result(sid,kbs,'33333333-3333-4333-8333-333333333333',null,'SENT');
    raise exception 'non-admin actor accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_station_review_result(sid,wbs,actor,null,'SENT');
    raise exception 'unrequested station accepted';
  exception when others then if sqlerrm <> 'REVIEW_STATION_NOT_REQUESTED' then raise; end if; end;
  begin
    perform public.save_station_review_result(sid,kbs,actor,null,'APPROVED');
    raise exception 'missing age rating accepted';
  exception when others then if sqlerrm <> 'REVIEW_RATING_REQUIRED' then raise; end if; end;
  result := public.save_station_review_result(sid,kbs,actor,null,'APPROVED','KBS 완료','[]','12');
  if result->>'submissionStatus'<>'IN_PROGRESS' or result->'row'->>'age_rating'<>'12' then raise exception 'premature overall completion or lost rating'; end if;
  revision := (result->'row'->>'updated_at')::timestamptz;
  select count(*) into before_events from public.submission_events;
  result := public.save_station_review_result(sid,kbs,actor,revision,'APPROVED','KBS 완료','[]','12');
  if result->>'changed'<>'false' or (select count(*) from public.submission_events)<>before_events then raise exception 'no-op repeated audit'; end if;
  begin
    perform public.save_station_review_result(sid,kbs,actor,null,'APPROVED',null,'[]','19');
    raise exception 'stale writer accepted';
  exception when others then if sqlerrm <> 'REVIEW_CONFLICT' then raise; end if; end;
  -- A historic generic row must not count as an actual broadcaster or keep completion pending.
  insert into public.station_reviews(submission_id,station_id,status,updated_at) values (sid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','NOT_SENT',now());
  result := public.save_station_review_result(sid,mbc,actor,null,'APPROVED','MBC 완료','[]','15');
  if result->>'submissionStatus'<>'RESULT_READY' then raise exception 'all requested stations not complete'; end if;
  if not exists(select 1 from public.station_reviews where submission_id=sid and station_id=kbs and age_rating='12') then raise exception 'MBC overwrote KBS'; end if;
  begin
    perform public.save_submission_review_result(sid,actor,null,'APPROVED');
    raise exception 'global broadcast overwrite still allowed';
  exception when others then if sqlerrm <> 'REVIEW_BROADCAST_PER_STATION_REQUIRED' then raise; end if; end;
  result := public.save_station_review_result(sid,kbs,actor,revision,'NEEDS_FIX','영상 보완','[]',null);
  if result->>'submissionStatus'<>'IN_PROGRESS' or result->>'resultStatus'<>'NEEDS_FIX' or result->'row'->>'age_rating' is not null then raise exception 'reopened result not propagated'; end if;
end $$;
-- Album completeness and the selected WBS subset are independently enforced inside SQL.
do $$
declare sid uuid := '44444444-4444-4444-8444-444444444444'; actor uuid := '22222222-2222-4222-8222-222222222222';
  kbs uuid := '66666666-6666-4666-8666-666666666666'; wbs uuid := '88888888-8888-4888-8888-888888888888'; tracks jsonb; result jsonb;
begin
  select jsonb_agg(jsonb_build_object('track_id',id,'track_no',track_no,'status','APPROVED') order by track_no) into tracks from public.album_tracks where submission_id=sid;
  begin
    perform public.save_station_review_result(sid,wbs,actor,null,'APPROVED',null,tracks);
    raise exception 'unselected WBS track accepted';
  exception when others then if sqlerrm <> 'REVIEW_TRACK_INVALID' then raise; end if; end;
  result := public.save_station_review_result(sid,kbs,actor,null,'APPROVED',null,tracks);
  if result->>'submissionStatus'<>'IN_PROGRESS' then raise exception 'album completed before WBS'; end if;
  result := public.save_station_review_result(sid,wbs,actor,null,'APPROVED',null,tracks - 3);
  if result->>'submissionStatus'<>'RESULT_READY' then raise exception 'selected WBS result incomplete'; end if;
end $$;
-- Online CAS plus a certificate upload uses the same revision and preserves prior files.
do $$
declare sid uuid := '11111111-1111-4111-8111-111111111111'; actor uuid := '22222222-2222-4222-8222-222222222222';
  revision timestamptz; stale timestamptz; result jsonb; uploaded timestamptz := now(); before_events integer;
  object_key text := 'submissions/11111111-1111-4111-8111-111111111111/certificate/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_test.pdf';
begin
  select updated_at into revision from public.submissions where id=sid;
  stale := revision;
  result := public.save_online_review_result(sid,actor,revision,'15');
  if result->>'changed'<>'true' then raise exception 'online rating save failed'; end if;
  begin
    perform public.save_online_review_result(sid,actor,stale,'19');
    raise exception 'online stale writer accepted';
  exception when others then if sqlerrm <> 'REVIEW_CONFLICT' then raise; end if; end;
  select updated_at into revision from public.submissions where id=sid;
  result := public.record_managed_submission_certificate(sid,actor,revision,object_key,'test.pdf','application/pdf',100,uploaded);
  if result->>'changed'<>'true' then raise exception 'certificate failed'; end if;
  select count(*) into before_events from public.submission_events;
  result := public.record_managed_submission_certificate(sid,actor,stale,object_key,'test.pdf','application/pdf',100,uploaded + interval '1 minute');
  if result->>'changed'<>'false' or (result->>'uploadedAt')::timestamptz<>uploaded or (select count(*) from public.submission_events)<>before_events then raise exception 'certificate retry duplicated revision/history'; end if;
  begin
    perform public.record_managed_submission_certificate(sid,actor,stale,replace(object_key,'test.pdf','other.pdf'),'other.pdf','application/pdf',101,now());
    raise exception 'certificate stale replacement accepted';
  exception when others then if sqlerrm <> 'REVIEW_CONFLICT' then raise; end if; end;
  select updated_at into revision from public.submissions where id=sid;
  result := public.record_managed_submission_certificate(sid,actor,revision,replace(object_key,'test.pdf','other.pdf'),'other.pdf','application/pdf',101,now());
  if not exists(select 1 from public.submission_events where submission_id=sid and details->'previous'->>'objectKey'=object_key) then raise exception 'previous certificate not preserved'; end if;
end $$;
reset role;
-- Audit failure must roll back the per-station rating, parent aggregate and revision.
alter table public.submission_events add constraint fixture_audit_failure check(false) not valid;
set role service_role;
do $$
declare sid uuid := '55555555-5555-4555-8555-555555555555'; revision timestamptz;
begin
  select updated_at into revision from public.station_reviews where submission_id=sid and station_id='77777777-7777-4777-8777-777777777777';
  begin
    perform public.save_station_review_result(sid,'77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222',revision,'APPROVED',null,'[]','19');
    raise exception 'audit failure not atomic';
  exception when check_violation then null; end;
  if not exists(select 1 from public.station_reviews where submission_id=sid and station_id='77777777-7777-4777-8777-777777777777' and age_rating='15' and updated_at=revision) then raise exception 'failed audit left partial result'; end if;
end $$;
reset role;
