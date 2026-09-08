begin;
do $test$
declare
  actor uuid := '81111111-1111-4111-8111-111111111111';
  submission uuid := '82222222-2222-4222-8222-222222222222';
  lease uuid := '83333333-3333-4333-8333-333333333333';
  context jsonb := '{"libraryId":"84444444-4444-4444-8444-444444444444","releaseId":"release-one","trackId":"track-two","trackIds":["track-two"]}';
  invalid jsonb;
  lease_result record;
  version timestamptz;
  failures integer := 0;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into auth.users(id, aud, role) values(actor, 'authenticated', 'authenticated');
  insert into public.submissions(id,user_id,type,status,payment_status,title,artist_name)
    values(submission,actor,'ALBUM','DRAFT','UNPAID','앨범','가수');
  select updated_at into version from public.submissions where id=submission;
  select * into lease_result from public.claim_submission_save_lease_v2(submission,version,actor,null,lease);
  perform * from public.commit_submission_save_v2(submission,lease,lease_result.staged_updated_at,
    jsonb_build_object('archive_review_context',context,'title','저장된 범위'),
    true,'[{"track_no":1,"track_title":"선택한 곡","is_title":true}]',false,'AUDIO','[]',false,'{}','DRAFT','UNPAID');
  assert (select archive_review_context from public.submissions where id=submission) = context;
  assert (select count(*) from public.album_tracks where submission_id=submission) = 1;
  assert not exists(select 1 from public.submission_orders);
  assert not exists(select 1 from public.submission_payments where submission_id=submission);
  assert (select payment_status from public.submissions where id=submission) = 'UNPAID';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    update public.submissions set archive_review_context=null where id=submission;
    raise exception 'member modified server snapshot';
  exception when insufficient_privilege then failures:=failures+1; end;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  foreach invalid in array array['{}'::jsonb,context||'{"trackIds":[]}',context||'{"trackIds":[1]}',context||'{"libraryId":"bad"}',context||'{"releaseId":""}'] loop
    begin
      update public.submissions set archive_review_context=invalid where id=submission;
      raise exception 'invalid snapshot accepted';
    exception when check_violation then failures:=failures+1; end;
  end loop;
  assert failures=6;
  assert (select archive_review_context from public.submissions where id=submission)=context;
  assert not has_function_privilege('authenticated','public.commit_submission_save_v2(uuid,uuid,timestamptz,jsonb,boolean,jsonb,boolean,text,jsonb,boolean,uuid[],public.submission_status,public.payment_status)','EXECUTE');
end;
$test$;
rollback;
