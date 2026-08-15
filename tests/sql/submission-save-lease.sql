begin;

do $test$
declare
  v_user_id uuid := '71111111-1111-4111-8111-111111111111';
  v_album_id uuid := '72222222-2222-4222-8222-222222222222';
  v_guest_id uuid := '73333333-3333-4333-8333-333333333333';
  v_atomic_id uuid := '74444444-4444-4444-8444-444444444444';
  v_payment_id uuid := '75555555-5555-4555-8555-555555555555';
  v_station_id uuid := '76666666-6666-4666-8666-666666666666';
  v_inactive_station_id uuid := '77777777-7777-4777-8777-777777777777';
  v_lease_a uuid := '78888888-8888-4888-8888-888888888888';
  v_lease_b uuid := '79999999-9999-4999-8999-999999999999';
  v_lease_c uuid := '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_lease_d uuid := '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_version timestamptz;
  v_row record;
  v_status public.submission_status;
  v_payment_status public.payment_status;
  v_token uuid;
  v_expiry timestamptz;
  v_count integer;
  v_text text;
begin
  assert not has_function_privilege(
    'anon',
    'public.claim_submission_save_lease(uuid,timestamptz,uuid,text,uuid)',
    'EXECUTE'
  );
  assert not has_function_privilege(
    'authenticated',
    'public.commit_submission_save(uuid,uuid,timestamptz,boolean,jsonb,boolean,text,jsonb,boolean,uuid[],public.submission_status,public.payment_status)',
    'EXECUTE'
  );
  assert has_function_privilege(
    'service_role',
    'public.release_submission_save_lease(uuid,uuid)',
    'EXECUTE'
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into auth.users (id, aud, role)
  values (v_user_id, 'authenticated', 'authenticated');
  insert into public.stations (id, name, code, is_active) values
    (v_station_id, 'Lease Test Active', 'LEASE_ACTIVE', true),
    (v_inactive_station_id, 'Lease Test Inactive', 'LEASE_INACTIVE', false);
  insert into public.submissions (
    id, user_id, type, title, artist_name, amount_krw, status, payment_status
  ) values
    (v_album_id, v_user_id, 'ALBUM', 'Old parent', 'Album Singer', 1000, 'SUBMITTED', 'UNPAID'),
    (v_guest_id, null, 'MV_BROADCAST', 'Guest parent', null, 1000, 'SUBMITTED', 'UNPAID'),
    (v_atomic_id, v_user_id, 'ALBUM', 'Atomic parent', 'Atomic Singer', 1000, 'SUBMITTED', 'UNPAID'),
    (v_payment_id, v_user_id, 'MV_BROADCAST', 'Payment parent', null, 1000, 'WAITING_PAYMENT', 'PAYMENT_PENDING');
  update public.submissions
  set guest_token = 'guest-lease-token-123456'
  where id = v_guest_id;
  insert into public.album_tracks (
    submission_id, track_no, track_title, composer, is_title
  ) values
    (v_album_id, 1, 'Old track', 'Old composer', true),
    (v_atomic_id, 1, 'Atomic old track', 'Old composer', true);

  select updated_at into v_version
  from public.submissions where id = v_album_id;
  select * into v_row
  from public.claim_submission_save_lease(
    v_album_id, v_version, v_user_id, null, v_lease_a
  );
  assert v_row.lease_token = v_lease_a;
  select status, payment_status, save_lease_token, save_lease_expires_at
    into v_status, v_payment_status, v_token, v_expiry
  from public.submissions where id = v_album_id;
  assert v_status = 'DRAFT';
  assert v_payment_status = 'UNPAID';
  assert v_token = v_lease_a;
  assert v_expiry > clock_timestamp();

  begin
    perform public.claim_submission_save_lease(
      v_album_id, v_row.staged_updated_at, v_user_id, null, v_lease_b
    );
    raise exception 'expected concurrent lease claim to fail';
  exception
    when sqlstate '55000' then
      assert sqlerrm like '%SUBMISSION_SAVE_IN_PROGRESS%';
  end;

  update public.submissions
  set title = 'New parent'
  where id = v_album_id
    and save_lease_token = v_lease_a;
  select updated_at into v_version
  from public.submissions where id = v_album_id;
  select * into v_row
  from public.commit_submission_save(
    v_album_id,
    v_lease_a,
    v_version,
    true,
    '[{"track_no":1,"track_title":"New track","performer":"Compilation Singer","composer":"New composer","is_title":true,"title_role":"MAIN","broadcast_selected":true},{"track_no":2,"track_title":"Second track","composer":"New composer"}]'::jsonb,
    true,
    'AUDIO',
    '[{"file_path":"submissions/user/lease-test/audio.wav","object_key":"submissions/user/lease-test/audio.wav","original_name":"audio.wav","mime":"audio/wav","size":123}]'::jsonb,
    true,
    array[v_station_id],
    'SUBMITTED',
    'UNPAID'
  );
  assert v_row.submission_id = v_album_id;
  select status, payment_status, save_lease_token
    into v_status, v_payment_status, v_token
  from public.submissions where id = v_album_id;
  assert v_status = 'SUBMITTED';
  assert v_payment_status = 'UNPAID';
  assert v_token is null;
  select track_title into v_text
  from public.album_tracks
  where submission_id = v_album_id and track_no = 1;
  assert v_text = 'New track';
  select string_agg(performer, ',' order by track_no) into v_text
  from public.album_tracks where submission_id = v_album_id;
  assert v_text = 'Compilation Singer,Album Singer';
  select count(*) into v_count
  from public.submission_files
  where submission_id = v_album_id
    and kind = 'AUDIO'
    and storage_provider = 'b2'
    and access_url is null;
  assert v_count = 1;
  select count(*) into v_count
  from public.station_reviews
  where submission_id = v_album_id
    and station_id = v_station_id
    and status = 'NOT_SENT';
  assert v_count = 1;

  -- A basic-information-only save omits track replacement and must preserve
  -- every existing compilation track.
  select updated_at into v_version
  from public.submissions where id = v_album_id;
  select * into v_row
  from public.claim_submission_save_lease(
    v_album_id, v_version, v_user_id, null, v_lease_b
  );
  update public.submissions
  set title = 'Basic information updated'
  where id = v_album_id and save_lease_token = v_lease_b;
  select updated_at into v_version
  from public.submissions where id = v_album_id;
  perform public.commit_submission_save(
    v_album_id, v_lease_b, v_version, false, '[]'::jsonb,
    false, 'AUDIO', '[]'::jsonb, false, '{}'::uuid[],
    'DRAFT', 'UNPAID'
  );
  select count(*) into v_count
  from public.album_tracks where submission_id = v_album_id;
  assert v_count = 2;

  begin
    perform public.commit_submission_save(
      v_album_id, v_lease_a, v_version, true, '[]'::jsonb,
      false, 'AUDIO', '[]'::jsonb, false, '{}'::uuid[],
      'SUBMITTED', 'UNPAID'
    );
    raise exception 'expected replayed commit to fail';
  exception
    when sqlstate '55000' then
      assert sqlerrm like '%SUBMISSION_SAVE_LEASE_INVALID%';
  end;

  select updated_at into v_version
  from public.submissions where id = v_guest_id;
  begin
    perform public.claim_submission_save_lease(
      v_guest_id, v_version, null, 'wrong-guest-token', v_lease_a
    );
    raise exception 'expected guest owner mismatch to fail';
  exception
    when sqlstate '42501' then
      assert sqlerrm like '%SUBMISSION_SAVE_OWNER_MISMATCH%';
  end;
  select * into v_row
  from public.claim_submission_save_lease(
    v_guest_id, v_version, null, 'guest-lease-token-123456', v_lease_b
  );
  update public.submissions
  set save_lease_expires_at = clock_timestamp() - interval '1 second'
  where id = v_guest_id and save_lease_token = v_lease_b;
  select updated_at into v_version
  from public.submissions where id = v_guest_id;
  select * into v_row
  from public.claim_submission_save_lease(
    v_guest_id, v_version, null, 'guest-lease-token-123456', v_lease_c
  );
  assert v_row.lease_token = v_lease_c;
  begin
    perform public.commit_submission_save(
      v_guest_id, v_lease_b, v_row.staged_updated_at,
      false, '[]'::jsonb, false, 'VIDEO', '[]'::jsonb,
      false, '{}'::uuid[], 'SUBMITTED', 'UNPAID'
    );
    raise exception 'expected stale lease token to fail';
  exception
    when sqlstate '55000' then null;
  end;
  assert public.release_submission_save_lease(v_guest_id, v_lease_c);
  select status, payment_status, save_lease_token
    into v_status, v_payment_status, v_token
  from public.submissions where id = v_guest_id;
  assert v_status = 'DRAFT';
  assert v_payment_status = 'UNPAID';
  assert v_token is null;

  -- Failure after track/file mutation must roll the whole commit back.
  select updated_at into v_version
  from public.submissions where id = v_atomic_id;
  select * into v_row
  from public.claim_submission_save_lease(
    v_atomic_id, v_version, v_user_id, null, v_lease_d
  );
  update public.submissions
  set title = 'Atomic staged parent'
  where id = v_atomic_id and save_lease_token = v_lease_d;
  select updated_at into v_version
  from public.submissions where id = v_atomic_id;
  begin
    perform public.commit_submission_save(
      v_atomic_id,
      v_lease_d,
      v_version,
      true,
      '[{"track_no":1,"track_title":"Must roll back","composer":"C","is_title":true}]'::jsonb,
      true,
      'AUDIO',
      '[{"file_path":"same-key","object_key":"same-key","original_name":"x.wav","size":1}]'::jsonb,
      true,
      array[v_inactive_station_id],
      'SUBMITTED',
      'UNPAID'
    );
    raise exception 'expected inactive station commit to fail';
  exception
    when sqlstate '22023' then
      assert sqlerrm like '%SUBMISSION_STATIONS_INVALID%';
  end;
  select track_title into v_text
  from public.album_tracks where submission_id = v_atomic_id;
  assert v_text = 'Atomic old track';
  select count(*) into v_count
  from public.submission_files where submission_id = v_atomic_id;
  assert v_count = 0;
  assert public.release_submission_save_lease(v_atomic_id, v_lease_d);

  insert into public.submission_payments (
    submission_id, user_id, order_id, amount_krw, status
  ) values (
    v_payment_id, v_user_id, 'SAVE-LEASE-PAYMENT-GUARD', 1000, 'REQUESTED'
  );
  select updated_at into v_version
  from public.submissions where id = v_payment_id;
  begin
    perform public.claim_submission_save_lease(
      v_payment_id, v_version, v_user_id, null, v_lease_a
    );
    raise exception 'expected in-flight payment to block save';
  exception
    when sqlstate '55000' then
      assert sqlerrm like '%PAYMENT_IN_PROGRESS%';
  end;

  -- Missing JWT claims must not bypass privileged field/role triggers even
  -- when a database superuser bypasses RLS during this functional test.
  perform set_config('request.jwt.claim.role', '', true);
  begin
    update public.profiles set role = 'admin' where user_id = v_user_id;
    raise exception 'expected missing-JWT role escalation to fail';
  exception
    when sqlstate '42501' then null;
  end;
  begin
    update public.submissions
    set amount_krw = amount_krw + 1
    where id = v_album_id;
    raise exception 'expected missing-JWT privileged update to fail';
  exception
    when sqlstate '42501' then null;
  end;
end;
$test$;

rollback;
