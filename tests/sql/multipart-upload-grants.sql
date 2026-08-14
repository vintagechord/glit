begin;

select set_config('request.jwt.claim.role', 'service_role', true);

do $test$
declare
  v_user_id uuid := '81111111-1111-4111-8111-111111111111';
  v_submission_id uuid := '82222222-2222-4222-8222-222222222222';
  v_claim_grant_id uuid := '83333333-3333-4333-8333-333333333333';
  v_mismatch_grant_id uuid := '84444444-4444-4444-8444-444444444444';
  v_expired_grant_id uuid := '85555555-5555-4555-8555-555555555555';
  v_abort_grant_id uuid := '86666666-6666-4666-8666-666666666666';
  v_retry_grant_id uuid := '87777777-7777-4777-8777-777777777777';
  v_owner_key text := 'user:81111111-1111-4111-8111-111111111111';
  v_status text;
  v_abort_attempts integer;
  v_leased_count integer;
begin
  insert into auth.users (id, aud, role)
  values (v_user_id, 'authenticated', 'authenticated');

  insert into public.submissions (id, user_id, type, title, amount_krw)
  values (v_submission_id, v_user_id, 'MV_BROADCAST', 'Multipart grant test', 1);

  insert into public.multipart_upload_grants (
    id,
    submission_id,
    owner_key,
    upload_id,
    object_key,
    original_name,
    mime_type,
    upload_kind,
    declared_size_bytes,
    part_size_bytes,
    part_count,
    status,
    created_at,
    expires_at
  ) values
    (
      v_claim_grant_id,
      v_submission_id,
      v_owner_key,
      'upload-claim',
      'submissions/member/file-claim.mp4',
      'claim.mp4',
      'video/mp4',
      'video',
      11534336,
      5242880,
      3,
      'ACTIVE',
      now(),
      now() + interval '1 hour'
    ),
    (
      v_mismatch_grant_id,
      v_submission_id,
      v_owner_key,
      'upload-mismatch',
      'submissions/member/file-mismatch.mp4',
      'mismatch.mp4',
      'video/mp4',
      'video',
      6291456,
      5242880,
      2,
      'ACTIVE',
      now(),
      now() + interval '1 hour'
    ),
    (
      v_expired_grant_id,
      v_submission_id,
      v_owner_key,
      'upload-expired',
      'submissions/member/file-expired.mp4',
      'expired.mp4',
      'video/mp4',
      'video',
      6291456,
      5242880,
      2,
      'ACTIVE',
      now() - interval '1 hour',
      now() - interval '1 second'
    ),
    (
      v_abort_grant_id,
      v_submission_id,
      v_owner_key,
      'upload-abort',
      'submissions/member/file-abort.mp4',
      'abort.mp4',
      'video/mp4',
      'video',
      6291456,
      5242880,
      2,
      'ACTIVE',
      now(),
      now() + interval '1 hour'
    ),
    (
      v_retry_grant_id,
      v_submission_id,
      v_owner_key,
      'upload-retry',
      'submissions/member/file-retry.mp4',
      'retry.mp4',
      'video/mp4',
      'video',
      6291456,
      5242880,
      2,
      'ABORTING',
      now() - interval '2 hours',
      now() + interval '1 hour'
    );

  update public.multipart_upload_grants
  set abort_attempts = 2,
      last_abort_attempt_at = now() - interval '10 minutes'
  where id = v_retry_grant_id;

  perform set_config('request.jwt.claim.role', 'service_role', true);

  perform public.claim_multipart_upload_grant(
    v_claim_grant_id,
    v_submission_id,
    'upload-claim',
    'submissions/member/file-claim.mp4',
    v_owner_key,
    array[3, 1, 2]
  );
  select status into v_status
  from public.multipart_upload_grants
  where id = v_claim_grant_id;
  assert v_status = 'COMPLETING';

  begin
    perform public.claim_multipart_upload_grant(
      v_claim_grant_id,
      v_submission_id,
      'upload-claim',
      'submissions/member/file-claim.mp4',
      v_owner_key,
      array[1, 2, 3]
    );
    raise exception 'expected replay to fail';
  exception
    when sqlstate '55000' then null;
  end;

  begin
    perform public.claim_multipart_upload_grant(
      v_mismatch_grant_id,
      v_submission_id,
      'upload-mismatch',
      'submissions/member/file-mismatch.mp4',
      'user:89999999-9999-4999-8999-999999999999',
      array[1, 2]
    );
    raise exception 'expected owner mismatch to fail';
  exception
    when sqlstate 'P0001' then null;
  end;

  begin
    perform public.claim_multipart_upload_grant(
      v_mismatch_grant_id,
      v_submission_id,
      'upload-mismatch',
      'submissions/member/file-mismatch.mp4',
      v_owner_key,
      array[1, 1]
    );
    raise exception 'expected duplicate parts to fail';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.claim_multipart_upload_grant(
      v_expired_grant_id,
      v_submission_id,
      'upload-expired',
      'submissions/member/file-expired.mp4',
      v_owner_key,
      array[1, 2]
    );
    raise exception 'expected expired grant to fail';
  exception
    when sqlstate '57014' then null;
  end;

  perform public.claim_multipart_upload_abort(
    v_abort_grant_id,
    v_submission_id,
    'upload-abort',
    'submissions/member/file-abort.mp4',
    v_owner_key
  );
  select status into v_status
  from public.multipart_upload_grants
  where id = v_abort_grant_id;
  assert v_status = 'ABORTING';

  select count(*) into v_leased_count
  from public.lease_expired_multipart_upload_aborts(5);
  assert v_leased_count = 2;
  select status, abort_attempts
    into v_status, v_abort_attempts
  from public.multipart_upload_grants
  where id = v_retry_grant_id;
  assert v_status = 'ABORTING';
  assert v_abort_attempts = 3;

  begin
    perform public.claim_multipart_upload_abort(
      v_abort_grant_id,
      v_submission_id,
      'upload-abort',
      'submissions/member/file-abort.mp4',
      v_owner_key
    );
    raise exception 'expected abort replay to fail';
  exception
    when sqlstate '55000' then null;
  end;

  perform set_config('request.jwt.claim.role', 'anon', true);
  begin
    perform public.claim_multipart_upload_abort(
      v_mismatch_grant_id,
      v_submission_id,
      'upload-mismatch',
      'submissions/member/file-mismatch.mp4',
      v_owner_key
    );
    raise exception 'expected non-service caller to fail';
  exception
    when sqlstate '42501' then null;
  end;
end;
$test$;

rollback;
