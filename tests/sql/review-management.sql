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
  -- A station reopened for a fix reports NEEDS_FIX; the album stays in 결과 준비
  -- until the administrator moves it back (20261119121000).
  result := public.save_station_review_result(sid,kbs,actor,revision,'NEEDS_FIX','영상 보완','[]',null);
  if result->>'submissionStatus'<>'RESULT_READY' or result->>'resultStatus'<>'NEEDS_FIX' or result->'row'->>'age_rating' is not null then raise exception 'reopened result not propagated'; end if;
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

-- Station rows never rewrite the intake/payment stage, and a closed application stays closed.
alter table public.submission_events drop constraint fixture_audit_failure;
set role service_role;
do $$
declare sid uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; actor uuid := '22222222-2222-4222-8222-222222222222';
  kbs uuid := '66666666-6666-4666-8666-666666666666'; result jsonb; revision timestamptz;
begin
  insert into public.submissions(id,type,status,payment_status,mv_selected_station_codes,package_id) values (sid,'MV_BROADCAST','PRE_REVIEW','PAID','{KBS}',null);
  result := public.save_station_review_result(sid,kbs,actor,null,'NOT_SENT','접수 준비 메모');
  if result->>'submissionStatus'<>'PRE_REVIEW' then raise exception 'memo-only save rewrote a paid application as %', result->>'submissionStatus'; end if;
  revision := (result->'row'->>'updated_at')::timestamptz;
  result := public.save_station_review_result(sid,kbs,actor,revision,'APPROVED','KBS 완료','[]','12');
  if result->>'submissionStatus'<>'RESULT_READY' then raise exception 'completed station did not publish results'; end if;
  revision := (result->'row'->>'updated_at')::timestamptz;
  update public.submissions set status='COMPLETED' where id=sid;
  result := public.save_station_review_result(sid,kbs,actor,revision,'APPROVED','KBS 완료 · 메모 수정','[]','12');
  if result->>'submissionStatus'<>'COMPLETED' then raise exception 'memo edit reopened a closed application as %', result->>'submissionStatus'; end if;
  revision := (result->'row'->>'updated_at')::timestamptz;
  -- Reopening a station of a closed application keeps it closed (20261119121000).
  result := public.save_station_review_result(sid,kbs,actor,revision,'NEEDS_FIX','보완','[]',null);
  if result->>'submissionStatus'<>'COMPLETED' or result->>'resultStatus'<>'NEEDS_FIX' then raise exception 'a reopened station moved a closed application to %', result->>'submissionStatus'; end if;
  revision := (result->'row'->>'updated_at')::timestamptz;
  result := public.save_station_review_result(sid,kbs,actor,revision,'NOT_SENT',null,'[]',null);
  if result->>'submissionStatus'<>'COMPLETED' then raise exception 'a station set back to NOT_SENT moved a closed application to %', result->>'submissionStatus'; end if;
end $$;

-- 2026-11-21: a paid album in 심의진행 whose stations are all 접수예정 stays in
-- 심의진행: the administrator moved it there before sending a station, or set
-- the only 접수완료 station back to 접수예정. Rewriting it as PRE_REVIEW moved
-- the stage backwards, and for an album paid through an order the order-state
-- guard (0097) refused the write, so every station save failed.
do $$
declare actor uuid := '22222222-2222-4222-8222-222222222222'; kbs uuid := '66666666-6666-4666-8666-666666666666';
  ordered uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; intake uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  refunded uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff'; result jsonb; revision timestamptz;
begin
  insert into public.submissions(id,type,status,payment_status,payment_method,mv_selected_station_codes,package_id,current_order_id) values
    (ordered,'MV_BROADCAST','IN_PROGRESS','PAID','CARD','{KBS}',null,'d0000000-0000-4000-8000-000000000001'),
    (intake,'MV_BROADCAST','IN_PROGRESS','PAID','BANK','{KBS}',null,null),
    (refunded,'MV_BROADCAST','IN_PROGRESS','REFUNDED','CARD','{KBS}',null,null);
  -- A note on the 접수예정 station of an album paid through an order.
  result := public.save_station_review_result(ordered,kbs,actor,null,'NOT_SENT','접수 준비 메모');
  if result->>'submissionStatus'<>'IN_PROGRESS' then raise exception 'a note moved an album in review to %', result->>'submissionStatus'; end if;
  -- A mistaken 접수완료 set back to 접수예정.
  revision := (result->'row'->>'updated_at')::timestamptz;
  result := public.save_station_review_result(ordered,kbs,actor,revision,'SENT',null);
  revision := (result->'row'->>'updated_at')::timestamptz;
  result := public.save_station_review_result(ordered,kbs,actor,revision,'NOT_SENT',null);
  if result->>'submissionStatus'<>'IN_PROGRESS'
    or (select status::text from public.submissions where id=ordered)<>'IN_PROGRESS'
    or (select status::text from public.station_reviews where submission_id=ordered and station_id=kbs)<>'NOT_SENT' then
    raise exception 'setting 접수완료 back to 접수예정 left the album at %', result->>'submissionStatus'; end if;
  -- The same for a paid album without an order (administrator intake).
  result := public.save_station_review_result(intake,kbs,actor,null,'NOT_SENT','접수 준비 메모');
  if result->>'submissionStatus'<>'IN_PROGRESS' then raise exception 'a note moved an intake album in review to %', result->>'submissionStatus'; end if;
  -- An application that is not paid still becomes SUBMITTED, as before.
  result := public.save_station_review_result(refunded,kbs,actor,null,'NOT_SENT',null);
  if result->>'submissionStatus'<>'SUBMITTED' then raise exception 'an unpaid application in review became %', result->>'submissionStatus'; end if;
end $$;
reset role;
-- Restore the audit-failure fixture for the bulk-save suite that runs next.
alter table public.submission_events add constraint fixture_audit_failure check(false) not valid;
