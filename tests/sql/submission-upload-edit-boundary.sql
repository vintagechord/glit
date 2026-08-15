begin;

select set_config('request.jwt.claim.role', 'service_role', true);

do $test$
declare
  v_user_id uuid := '91111111-1111-4111-8111-111111111111';
  v_submission_id uuid := '92222222-2222-4222-8222-222222222222';
  v_review_id uuid := '93333333-3333-4333-8333-333333333333';
  v_lease_a uuid := '94444444-4444-4444-8444-444444444444';
  v_lease_b uuid := '95555555-5555-4555-8555-555555555555';
  v_lease_c uuid := '96666666-6666-4666-8666-666666666666';
  v_lease_d uuid := '97777777-7777-4777-8777-777777777777';
  v_version timestamptz;
  v_row record;
  v_count integer;
  v_kind public.file_kind;
  v_mime text;
begin
  insert into auth.users (id, aud, role)
  values (v_user_id, 'authenticated', 'authenticated');

  insert into public.submissions (
    id, user_id, type, title, amount_krw, status, payment_status
  ) values
    (v_submission_id, v_user_id, 'ALBUM', 'Upload guard', 1000, 'SUBMITTED', 'UNPAID'),
    (v_review_id, v_user_id, 'MV_BROADCAST', 'Review guard', 1000, 'IN_PROGRESS', 'UNPAID');

  -- A provisional document is normalized into the final AUDIO set only by
  -- the explicit atomic save.
  insert into public.submission_upload_staging (
    submission_id, kind, file_path, object_key, original_name, mime, size,
    purpose
  ) values
    (
      v_submission_id, 'ETC', 'submissions/test/application.docx',
      'submissions/test/application.docx', 'application.docx',
      'application/octet-stream', 123, 'SUBMISSION_FILE'
    ),
    (
      v_submission_id, 'ETC', 'submissions/test/business-registration.pdf',
      'submissions/test/business-registration.pdf',
      'business-registration.pdf', 'application/pdf', 321,
      'PAYMENT_DOCUMENT'
    );
  select count(*) into v_count from public.submission_files
  where submission_id = v_submission_id;
  assert v_count = 0;

  select updated_at into v_version from public.submissions
  where id = v_submission_id;
  select * into v_row from public.claim_submission_save_lease_v2(
    v_submission_id, v_version, v_user_id, null, v_lease_a
  );
  perform public.commit_submission_save_v2(
    v_submission_id, v_lease_a, v_row.staged_updated_at,
    '{"title":"Verified application","payment_document_type":"TAX_INVOICE"}'::jsonb,
    false, '[]'::jsonb, true, 'AUDIO',
    '[{"file_path":"submissions/test/application.docx","object_key":"submissions/test/application.docx","original_name":"application.docx","size":123}]'::jsonb,
    false, '{}'::uuid[], 'SUBMITTED', 'UNPAID'
  );
  select kind into v_kind from public.submission_files
  where submission_id = v_submission_id
    and file_path = 'submissions/test/application.docx';
  assert v_kind = 'AUDIO';
  select mime into v_mime from public.submission_files
  where submission_id = v_submission_id
    and file_path = 'submissions/test/application.docx';
  assert v_mime = 'application/octet-stream';
  select count(*) into v_count from public.submission_files
  where submission_id = v_submission_id
    and kind = 'ETC'
    and file_path = 'submissions/test/business-registration.pdf';
  assert v_count = 1;
  select count(*) into v_count from public.submission_upload_staging
  where submission_id = v_submission_id;
  assert v_count = 0;

  -- An unchanged live row is internally restaged during replacement; an
  -- omitted provisional file is retired only after commit succeeds.
  insert into public.submission_upload_staging (
    submission_id, kind, file_path, object_key, original_name, mime, size
  ) values (
    v_submission_id, 'AUDIO', 'submissions/test/cancelled.wav',
    'submissions/test/cancelled.wav', 'cancelled.wav', 'audio/wav', 456
  );
  select updated_at into v_version from public.submissions
  where id = v_submission_id;
  select * into v_row from public.claim_submission_save_lease_v2(
    v_submission_id, v_version, v_user_id, null, v_lease_b
  );
  perform public.commit_submission_save_v2(
    v_submission_id, v_lease_b, v_row.staged_updated_at,
    '{"title":"Unchanged verified application"}'::jsonb,
    false, '[]'::jsonb, true, 'AUDIO',
    '[{"file_path":"submissions/test/application.docx","object_key":"submissions/test/application.docx","original_name":"application.docx","mime":"application/octet-stream","size":123}]'::jsonb,
    false, '{}'::uuid[], 'SUBMITTED', 'UNPAID'
  );
  select count(*) into v_count from public.submission_files
  where submission_id = v_submission_id;
  assert v_count = 1;
  select count(*) into v_count from public.submission_upload_staging
  where submission_id = v_submission_id;
  assert v_count = 0;

  -- A verified path with forged metadata is rejected.
  insert into public.submission_upload_staging (
    submission_id, kind, file_path, object_key, original_name, mime, size
  ) values (
    v_submission_id, 'AUDIO', 'submissions/test/verified.wav',
    'submissions/test/verified.wav', 'verified.wav', 'audio/wav', 789
  );
  select updated_at into v_version from public.submissions
  where id = v_submission_id;
  select * into v_row from public.claim_submission_save_lease_v2(
    v_submission_id, v_version, v_user_id, null, v_lease_c
  );
  begin
    perform public.commit_submission_save_v2(
      v_submission_id, v_lease_c, v_row.staged_updated_at,
      '{"title":"Forged metadata"}'::jsonb,
      false, '[]'::jsonb, true, 'AUDIO',
      '[{"file_path":"submissions/test/verified.wav","object_key":"submissions/test/verified.wav","original_name":"verified.wav","mime":"audio/wav","size":999999}]'::jsonb,
      false, '{}'::uuid[], 'SUBMITTED', 'UNPAID'
    );
    raise exception 'expected forged metadata to fail';
  exception when sqlstate '22023' then
    assert sqlerrm like '%SUBMISSION_FILE_METADATA_MISMATCH%';
  end;
  perform public.release_submission_save_lease(v_submission_id, v_lease_c);

  -- Owner-looking paths without verified metadata are rejected too.
  select updated_at into v_version from public.submissions
  where id = v_submission_id;
  select * into v_row from public.claim_submission_save_lease_v2(
    v_submission_id, v_version, v_user_id, null, v_lease_d
  );
  begin
    perform public.commit_submission_save_v2(
      v_submission_id, v_lease_d, v_row.staged_updated_at,
      '{"title":"Unverified path"}'::jsonb,
      false, '[]'::jsonb, true, 'AUDIO',
      '[{"file_path":"submissions/test/fake.wav","object_key":"submissions/test/fake.wav","original_name":"fake.wav","mime":"audio/wav","size":1}]'::jsonb,
      false, '{}'::uuid[], 'SUBMITTED', 'UNPAID'
    );
    raise exception 'expected unverified path to fail';
  exception when sqlstate '22023' then
    assert sqlerrm like '%SUBMISSION_FILE_METADATA_UNVERIFIED%';
  end;
  perform public.release_submission_save_lease(v_submission_id, v_lease_d);

  begin
    insert into public.submission_files (
      submission_id, kind, file_path, object_key, original_name, size
    ) values (
      v_submission_id, 'AUDIO', 'submissions/test/direct.wav',
      'submissions/test/direct.wav', 'direct.wav', 1
    );
    raise exception 'expected lease-less live insert to fail';
  exception when sqlstate '55000' then
    assert sqlerrm like '%SUBMISSION_FILE_SAVE_LEASE_REQUIRED%';
  end;

  begin
    insert into public.submission_files (
      submission_id, kind, file_path, original_name, size
    ) values (
      v_review_id, 'VIDEO', 'submissions/test/review.mp4', 'review.mp4', 123
    );
    raise exception 'expected non-editable insert to fail';
  exception when sqlstate '55000' then
    assert sqlerrm like '%SUBMISSION_FILE_STATE_INVALID%';
  end;

  update public.submissions set payment_status = 'PAID'
  where id = v_submission_id;
  begin
    insert into public.submission_files (
      submission_id, kind, file_path, original_name, size
    ) values (
      v_submission_id, 'AUDIO', 'submissions/test/paid.wav', 'paid.wav', 123
    );
    raise exception 'expected paid insert to fail';
  exception when sqlstate '55000' then
    assert sqlerrm like '%SUBMISSION_FILE_PAID%';
  end;
end;
$test$;

rollback;
