begin;

select set_config('request.jwt.claim.role', 'service_role', true);

do $test$
declare
  v_user_id uuid := 'a1111111-1111-4111-8111-111111111111';
  v_base_id uuid := 'a2222222-2222-4222-8222-222222222222';
  v_additional_id uuid := 'a3333333-3333-4333-8333-333333333333';
  v_single_base_id uuid := 'a4444444-4444-4444-8444-444444444444';
  v_single_additional_id uuid := 'a5555555-5555-4555-8555-555555555555';
  v_payment_base_id uuid := 'a6666666-6666-4666-8666-666666666666';
  v_payment_additional_id uuid := 'a7777777-7777-4777-8777-777777777777';
  v_package_id uuid;
  v_result jsonb;
  v_count integer;
begin
  assert not has_function_privilege(
    'anon',
    'public.delete_submission_drafts_atomic(text,uuid[],uuid,jsonb)',
    'EXECUTE'
  );
  assert has_function_privilege(
    'service_role',
    'public.delete_submission_drafts_atomic(text,uuid[],uuid,jsonb)',
    'EXECUTE'
  );

  insert into auth.users (id, aud, role)
  values (v_user_id, 'authenticated', 'authenticated');
  select id into v_package_id from public.packages order by station_count limit 1;
  assert v_package_id is not null;

  insert into public.submissions (
    id, user_id, type, package_id, amount_krw, album_base_price_krw,
    album_price_tier, album_draft_group_id, status, payment_status
  ) values
    (
      v_base_id, v_user_id, 'ALBUM', v_package_id, 50000, 50000,
      'FULL', v_base_id, 'DRAFT', 'UNPAID'
    ),
    (
      v_additional_id, v_user_id, 'ALBUM', v_package_id, 25000, 50000,
      'ADDITIONAL', v_base_id, 'DRAFT', 'UNPAID'
    );
  insert into public.submission_upload_staging (
    submission_id, kind, file_path, object_key, original_name, mime, size
  ) values (
    v_additional_id, 'AUDIO', 'submissions/test/group.wav',
    'submissions/test/group.wav', 'group.wav', 'audio/wav', 100
  );

  v_result := public.delete_submission_drafts_atomic(
    'ALBUM', array[v_base_id], v_user_id, '{}'::jsonb
  );
  assert jsonb_array_length(v_result -> 'deletedIds') = 2;
  assert jsonb_array_length(v_result -> 'b2ObjectRefs') = 1;
  select count(*) into v_count
  from public.submissions where id in (v_base_id, v_additional_id);
  assert v_count = 0;

  insert into public.submissions (
    id, user_id, type, package_id, amount_krw, album_base_price_krw,
    album_price_tier, album_draft_group_id, status, payment_status
  ) values
    (
      v_single_base_id, v_user_id, 'ALBUM', v_package_id, 50000, 50000,
      'FULL', v_single_base_id, 'DRAFT', 'UNPAID'
    ),
    (
      v_single_additional_id, v_user_id, 'ALBUM', v_package_id, 25000, 50000,
      'ADDITIONAL', v_single_base_id, 'DRAFT', 'UNPAID'
    );
  v_result := public.delete_submission_drafts_atomic(
    'ALBUM', array[v_single_additional_id], v_user_id, '{}'::jsonb
  );
  assert jsonb_array_length(v_result -> 'deletedIds') = 1;
  assert exists (
    select 1 from public.submissions where id = v_single_base_id
  );

  insert into public.submissions (
    id, user_id, type, package_id, amount_krw, album_base_price_krw,
    album_price_tier, album_draft_group_id, status, payment_status
  ) values
    (
      v_payment_base_id, v_user_id, 'ALBUM', v_package_id, 50000, 50000,
      'FULL', v_payment_base_id, 'SUBMITTED', 'UNPAID'
    ),
    (
      v_payment_additional_id, v_user_id, 'ALBUM', v_package_id, 25000, 50000,
      'ADDITIONAL', v_payment_base_id, 'SUBMITTED', 'UNPAID'
    );

  begin
    perform public.begin_submission_bank_payment(
      array[v_payment_base_id], v_user_id
    );
    assert false, 'partial album bundle payment must fail';
  exception
    when sqlstate '55000' then
      assert sqlerrm = 'ALBUM_GROUP_INCOMPLETE';
  end;

  perform public.begin_submission_bank_payment(
    array[v_payment_base_id, v_payment_additional_id], v_user_id
  );
  select count(*) into v_count
  from public.submissions
  where id in (v_payment_base_id, v_payment_additional_id)
    and status = 'WAITING_PAYMENT'
    and payment_status = 'PAYMENT_PENDING';
  assert v_count = 2;
end;
$test$;

rollback;
