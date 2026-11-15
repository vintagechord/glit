-- 결과 통보 완료 with a station still pending (2026-11-16). An album reaches
-- RESULT_READY only when every requested station is 적격 or 부적격, so one
-- broadcaster that cannot announce results (TBS, for now) kept albums in
-- "심의 진행 중" although every other result was in and the customer had been
-- told. An administrator now marks such an album as sent on.
--
-- The mark is the only thing written. status stays IN_PROGRESS, so customer
-- pages keep showing the open station as pending, and save_station_review_result
-- is unchanged: when the last result is saved the album becomes RESULT_READY
-- and waits for its result mail like any other. The admin stage reads the mark
-- only while the album is PAID and IN_PROGRESS (src/lib/admin/submission-stages.ts).

alter table public.submissions
  add column partial_result_notified_at timestamptz;

comment on column public.submissions.partial_result_notified_at is
  'When an administrator moved this album to 결과 통보 완료 while a station still had no result. Read only while the album is PAID and IN_PROGRESS.';

-- Review workflow state: same protection as result_notified_at. The function
-- is otherwise identical to 20261103120000.
create or replace function public.protect_submission_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb;
  new_row jsonb := to_jsonb(new);
  protected_key text;
  protected_keys constant text[] := array[
    'amount_krw',
    'album_base_price_krw',
    'album_price_tier',
    'album_discount_base_submission_id',
    'payment_status',
    'status',
    'admin_memo',
    'result_status',
    'result_memo',
    'result_notified_at',
    'partial_result_notified_at',
    'mv_rating',
    'mv_rating_file_path',
    'mv_certificate_object_key',
    'mv_certificate_filename',
    'mv_certificate_mime_type',
    'mv_certificate_size_bytes',
    'mv_certificate_uploaded_at',
    'certificate_b2_path',
    'certificate_original_name',
    'certificate_mime',
    'certificate_size',
    'certificate_uploaded_at',
    'payment_provider',
    'payment_currency',
    'payment_amount',
    'paypal_order_id',
    'paypal_capture_id'
  ];
  -- Must be null on a browser insert. status, payment_status and amount_krw
  -- are checked against their draft values below instead.
  insert_empty_keys constant text[] := array[
    'album_base_price_krw',
    'album_price_tier',
    'album_discount_base_submission_id',
    'admin_memo',
    'result_status',
    'result_memo',
    'result_notified_at',
    'partial_result_notified_at',
    'mv_rating',
    'mv_rating_file_path',
    'mv_certificate_object_key',
    'mv_certificate_filename',
    'mv_certificate_mime_type',
    'mv_certificate_size_bytes',
    'mv_certificate_uploaded_at',
    'certificate_b2_path',
    'certificate_original_name',
    'certificate_mime',
    'certificate_size',
    'certificate_uploaded_at',
    'payment_provider',
    'payment_currency',
    'payment_amount',
    'paypal_order_id',
    'paypal_capture_id',
    'current_order_id',
    'save_lease_token',
    'save_lease_expires_at',
    'user_deleted_at',
    'guest_token',
    'artist_id'
  ];
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is distinct from auth.uid()
      or new.status is distinct from 'DRAFT'
      or new.payment_status is distinct from 'UNPAID'
      or new.amount_krw is distinct from 0
    then
      raise exception 'Privileged submission fields require a trusted server.'
        using errcode = '42501';
    end if;
    foreach protected_key in array insert_empty_keys loop
      -- jsonb null (not just a missing key) also counts as empty.
      if coalesce(new_row -> protected_key, 'null'::jsonb) <> 'null'::jsonb then
        raise exception 'Privileged submission fields require a trusted server.'
          using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;

  old_row := to_jsonb(old);
  foreach protected_key in array protected_keys loop
    if new_row -> protected_key is distinct from old_row -> protected_key then
      raise exception 'Submission field % requires administrator privileges.', protected_key
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.protect_submission_privileged_fields() from public;
revoke all on function public.protect_submission_privileged_fields() from anon;
revoke all on function public.protect_submission_privileged_fields() from authenticated;
