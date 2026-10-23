insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222'), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.profiles values
 ('11111111-1111-4111-8111-111111111111','user'), ('22222222-2222-4222-8222-222222222222','user'), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin');
insert into public.submissions(id,user_id,payment_status) values ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','PAID');
insert into public.submissions(id,guest_token,payment_status) values ('88888888-8888-4888-8888-888888888888','fixture-guest-token','PAID');
insert into public.submission_files(submission_id,file_path,original_name) values ('99999999-9999-4999-8999-999999999999','original/locked.wav','Original.wav');

do $$ begin
  if has_table_privilege('anon','public.submission_supplement_files','SELECT')
    or has_table_privilege('authenticated','public.submission_supplement_requests','INSERT')
    or has_function_privilege('authenticated','public.mutate_submission_supplement(uuid,text,uuid,text,uuid,uuid,text,jsonb)','EXECUTE')
    or has_table_privilege('authenticated','public.submission_supplement_notifications','SELECT')
    or exists(select 1 from pg_class where relname in ('submission_supplement_requests','submission_supplement_revisions','submission_supplement_files','submission_supplement_notifications') and not relrowsecurity)
    then raise exception 'Direct client access or missing RLS'; end if;
end $$;

set role service_role;
set request.jwt.claim.role = 'service_role';
do $$
declare
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  other_id uuid := '22222222-2222-4222-8222-222222222222';
  admin_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  sid uuid := '99999999-9999-4999-8999-999999999999';
  guest_sid uuid := '88888888-8888-4888-8888-888888888888';
  req jsonb; rid uuid; vid uuid; fid uuid; old_fid uuid; gid uuid; guest_rid uuid;
  original jsonb; key text; notice jsonb; retry_notice jsonb;
begin
  select to_jsonb(s) into original from public.submissions s where id=sid;
  begin
    perform public.mutate_submission_supplement(sid,'request',owner_id,p_note=>'unauthorized');
    raise exception 'EXPECTED_FORBIDDEN';
  exception when insufficient_privilege then null; end;
  req := public.mutate_submission_supplement(sid,'request',admin_id,p_note=>'KBS 트랙 1 음원 파일을 보완해주세요.');
  rid := (req->>'requestId')::uuid; vid := (req->>'revisionId')::uuid;
  begin
    perform public.mutate_submission_supplement(sid,'submit',other_id,p_request_id=>rid);
    raise exception 'EXPECTED_FORBIDDEN';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mutate_submission_supplement(sid,'submit',p_request_id=>rid);
    raise exception 'EXPECTED_NULL_IDENTITY_FORBIDDEN';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mutate_submission_supplement(sid,'submit',owner_id,p_request_id=>rid);
    raise exception 'EXPECTED_FILES_REQUIRED';
  exception when raise_exception then if sqlerrm <> 'SUPPLEMENT_FILES_REQUIRED' then raise; end if; end;

  for attempt in 1..2 loop
    gid := gen_random_uuid();
    key := 'configured/prefix/supplements/'||sid||'/'||rid||'/'||vid||'/'||gen_random_uuid()||'/fixture.wav';
    insert into public.multipart_upload_grants(id,submission_id,owner_key,upload_id,object_key,original_name,mime_type,upload_kind,declared_size_bytes,part_size_bytes,part_count,expires_at)
      values(gid,sid,'user:'||owner_id,gid::text,key,'fixture.wav','audio/wav','audio',16,16777216,1,now()+interval '1 day');
    fid := (public.mutate_submission_supplement(sid,'attach',owner_id,p_request_id=>rid,p_file=>jsonb_build_object('grantId',gid))->>'fileId')::uuid;
    begin
      perform public.mutate_submission_supplement(sid,'submit',owner_id,p_request_id=>rid);
      raise exception 'EXPECTED_PENDING_BLOCK';
    exception when raise_exception then if sqlerrm <> 'SUPPLEMENT_FILES_REQUIRED' then raise; end if; end;
    perform public.claim_multipart_upload_grant(gid,sid,gid::text,key,'user:'||owner_id,array[1]);
    perform public.mutate_submission_supplement(sid,'verify',owner_id,p_file_id=>fid,p_file=>jsonb_build_object('sizeBytes',16));
    perform public.mutate_submission_supplement(sid,'verify',owner_id,p_file_id=>fid,p_file=>jsonb_build_object('sizeBytes',16));
    if (select status from public.multipart_upload_grants where id=gid) <> 'COMPLETED' then raise exception 'Grant not consumed'; end if;
    perform public.mutate_submission_supplement(sid,'submit',owner_id,p_request_id=>rid,p_note=>'수정 파일입니다.');
    begin
      perform public.mutate_submission_supplement(sid,'accept',other_id,p_request_id=>rid);
      raise exception 'EXPECTED_ADMIN_ONLY';
    exception when insufficient_privilege then null; end;
    if attempt=1 then
      begin
        perform public.mutate_submission_supplement(sid,'reject',admin_id,p_request_id=>rid);
        raise exception 'EXPECTED_REVIEW_REASON';
      exception when raise_exception then if sqlerrm <> 'SUPPLEMENT_NOTE_REQUIRED' then raise; end if; end;
      perform public.mutate_submission_supplement(sid,'reject',admin_id,p_request_id=>rid,p_note=>'전체 버전을 제출해주세요.');
      old_fid := fid;
      select id into vid from public.submission_supplement_revisions where request_id=rid and status='DRAFT';
      if vid is null then raise exception 'Retry revision missing'; end if;
    else
      perform public.mutate_submission_supplement(sid,'accept',admin_id,p_request_id=>rid);
    end if;
  end loop;
  if (select status from public.submission_supplement_files where id=old_fid) <> 'VERIFIED'
    or (select count(*) from public.submission_supplement_revisions where request_id=rid) <> 2
    or (select status from public.submission_supplement_requests where id=rid) <> 'ACCEPTED'
    or (select to_jsonb(s) from public.submissions s where id=sid) is distinct from original
    or (select file_path from public.submission_files where submission_id=sid) <> 'original/locked.wav'
    then raise exception 'Paid original or supplement history changed'; end if;
  begin
    perform public.mutate_submission_supplement(sid,'submit',owner_id,p_request_id=>rid);
    raise exception 'EXPECTED_STALE_WRITE_BLOCK';
  exception when raise_exception then if sqlerrm <> 'SUPPLEMENT_STATE_CONFLICT' then raise; end if; end;

  begin
    perform public.mutate_submission_supplement(sid,'notify_claim',owner_id,p_request_id=>rid);
    raise exception 'EXPECTED_NOTIFY_ADMIN_ONLY';
  exception when insufficient_privilege then null; end;
  notice := public.mutate_submission_supplement(sid,'notify_claim',admin_id,p_request_id=>rid);
  begin
    perform public.mutate_submission_supplement(sid,'notify_claim',admin_id,p_request_id=>rid);
    raise exception 'EXPECTED_NOTIFY_LEASE';
  exception when raise_exception then if sqlerrm <> 'SUPPLEMENT_NOTIFY_BUSY' then raise; end if; end;
  perform public.mutate_submission_supplement(sid,'notify_finish',admin_id,p_request_id=>rid,p_file=>notice || jsonb_build_object('outcome',jsonb_build_object('email','API_ACCEPTED','kakao','API_ACCEPTED','emailMessageId','fixture-id')));
  retry_notice := public.mutate_submission_supplement(sid,'notify_claim',admin_id,p_request_id=>rid);
  if retry_notice->>'alreadyAccepted' <> 'true' or retry_notice->'outcome'->>'emailMessageId' <> 'fixture-id' then raise exception 'Duplicate notification not blocked'; end if;

  guest_rid := (public.mutate_submission_supplement(guest_sid,'request',admin_id,p_note=>'비회원 자료 보완')->>'requestId')::uuid;
  notice := public.mutate_submission_supplement(guest_sid,'notify_claim',admin_id,p_request_id=>guest_rid);
  perform public.mutate_submission_supplement(guest_sid,'notify_finish',admin_id,p_request_id=>guest_rid,p_file=>notice || jsonb_build_object('outcome',jsonb_build_object('email','API_ACCEPTED','kakao','SKIPPED')));
  update public.submission_supplement_notifications set last_attempt_at=now()-interval '61 seconds' where id=(notice->>'notificationId')::uuid;
  retry_notice := public.mutate_submission_supplement(guest_sid,'notify_claim',admin_id,p_request_id=>guest_rid);
  if retry_notice->>'notificationId' <> notice->>'notificationId' or retry_notice->'outcome'->>'email' <> 'API_ACCEPTED' then raise exception 'Retry lost idempotency or accepted channel'; end if;
  begin
    perform public.mutate_submission_supplement(guest_sid,'notify_finish',admin_id,p_request_id=>guest_rid,p_file=>notice || jsonb_build_object('outcome',jsonb_build_object('email','FAILED','kakao','FAILED')));
    raise exception 'EXPECTED_STALE_NOTIFY_BLOCK';
  exception when raise_exception then if sqlerrm <> 'SUPPLEMENT_STATE_CONFLICT' then raise; end if; end;
  begin
    perform public.mutate_submission_supplement(guest_sid,'submit',p_guest_token=>'wrong-token',p_request_id=>guest_rid);
    raise exception 'EXPECTED_WRONG_GUEST_BLOCK';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mutate_submission_supplement(guest_sid,'submit',p_guest_token=>'fixture-guest-token',p_request_id=>rid);
    raise exception 'EXPECTED_CROSS_REQUEST_BLOCK';
  exception when raise_exception then if sqlerrm <> 'SUPPLEMENT_NOT_FOUND' then raise; end if; end;
  begin
    perform public.mutate_submission_supplement(guest_sid,'submit',p_guest_token=>'fixture-guest-token',p_request_id=>guest_rid);
    raise exception 'EXPECTED_GUEST_FILES_REQUIRED';
  exception when raise_exception then if sqlerrm <> 'SUPPLEMENT_FILES_REQUIRED' then raise; end if; end;

  -- Failed/uncertain completed uploads can be retired without changing a paid
  -- original. Old grants and objects remain identifiable, never overwritten.
  select id into vid from public.submission_supplement_revisions where request_id=guest_rid;
  for attempt in 1..2 loop
    gid := gen_random_uuid();
    key := 'configured/prefix/supplements/'||guest_sid||'/'||guest_rid||'/'||vid||'/'||gen_random_uuid()||'/fixture.wav';
    insert into public.multipart_upload_grants(id,submission_id,owner_key,upload_id,object_key,original_name,mime_type,upload_kind,declared_size_bytes,part_size_bytes,part_count,expires_at)
      values(gid,guest_sid,'guest:guest-'||substr(encode(sha256(convert_to('fixture-guest-token','UTF8')),'hex'),1,32),gid::text,key,'fixture.wav','audio/wav','audio',16,16777216,1,now()+interval '1 day');
    fid := (public.mutate_submission_supplement(guest_sid,'attach',p_guest_token=>'fixture-guest-token',p_request_id=>guest_rid,p_file=>jsonb_build_object('grantId',gid))->>'fileId')::uuid;
    update public.multipart_upload_grants set status='COMPLETING' where id=gid;
    perform public.mutate_submission_supplement(guest_sid,case when attempt=1 then 'abort' else 'invalidate' end,p_guest_token=>'fixture-guest-token',p_file_id=>fid);
    if (select status from public.submission_supplement_files where id=fid) <> 'ABORTED' then raise exception 'Uncertain upload blocks retry'; end if;
    if (select status from public.multipart_upload_grants where id=gid) <> (case when attempt=1 then 'ABORTING' else 'FAILED' end) then raise exception 'Grant recovery state missing'; end if;
    begin
      perform public.mutate_submission_supplement(guest_sid,'verify',p_guest_token=>'fixture-guest-token',p_file_id=>fid,p_file=>jsonb_build_object('sizeBytes',16));
      raise exception 'EXPECTED_ABORT_WINS';
    exception when raise_exception then if sqlerrm <> 'SUPPLEMENT_STATE_CONFLICT' then raise; end if; end;
  end loop;
end $$;
reset role;
