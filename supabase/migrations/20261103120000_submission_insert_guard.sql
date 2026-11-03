-- A signed-in browser may insert an empty draft (the "Submissions insertable"
-- policy). The INSERT branch of protect_submission_privileged_fields checked
-- only status, payment and result fields, so a member could create a draft
-- with payment_amount/payment_currency (PayPal pricing reads them),
-- certificate paths, an order link, a save lease or a deletion mark already
-- set. Every protected column must start empty; trusted server code
-- (service_role) and admins are unaffected.
--
-- None of these columns has a default, and the only member insert
-- (/api/submissions/draft) sends user_id, type, status, payment_status and
-- amount_krw, so legitimate drafts still pass.
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
