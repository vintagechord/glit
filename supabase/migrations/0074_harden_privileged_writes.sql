-- Financial and review workflow state must only be written by trusted server
-- code. Owners keep the read access required by their dashboards.

-- A signed-in browser may create only an empty draft. All later submission
-- writes go through server-side ownership checks and the service-role client.
drop policy if exists "Submissions insertable" on public.submissions;
create policy "Submissions insertable"
on public.submissions
for insert
with check (
  auth.uid() is not null
  and user_id = auth.uid()
  and status = 'DRAFT'
  and payment_status = 'UNPAID'
  and amount_krw = 0
  and admin_memo is null
  and result_status is null
  and result_memo is null
  and result_notified_at is null
);

drop policy if exists "Submissions updatable" on public.submissions;
create policy "Submissions updatable by admin"
on public.submissions
for update
using (public.is_admin())
with check (public.is_admin());

-- Submission child rows are also persisted by the trusted save action. If an
-- owner could insert arbitrary file metadata, they could turn the download
-- action into a signer for another B2 object key.
drop policy if exists "Tracks insertable" on public.album_tracks;
drop policy if exists "Tracks updatable" on public.album_tracks;
drop policy if exists "Tracks deletable" on public.album_tracks;
drop policy if exists "Tracks writable by admin" on public.album_tracks;
create policy "Tracks writable by admin"
on public.album_tracks
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Files insertable" on public.submission_files;
drop policy if exists "Files deletable" on public.submission_files;
drop policy if exists "Files writable by admin" on public.submission_files;
create policy "Files writable by admin"
on public.submission_files
for all
using (public.is_admin())
with check (public.is_admin());

-- Defense in depth: if a broader owner update policy is added later, it still
-- cannot be used to forge prices, payment state, review results or certificates.
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
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is distinct from auth.uid()
      or new.status is distinct from 'DRAFT'
      or new.payment_status is distinct from 'UNPAID'
      or new.amount_krw is distinct from 0
      or new_row ->> 'album_base_price_krw' is not null
      or new_row ->> 'album_price_tier' is not null
      or new_row ->> 'album_discount_base_submission_id' is not null
      or new.admin_memo is not null
      or new.result_status is not null
      or new.result_memo is not null
      or new.result_notified_at is not null
    then
      raise exception 'Privileged submission fields require a trusted server.'
        using errcode = '42501';
    end if;
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

drop trigger if exists protect_submission_privileged_fields on public.submissions;
create trigger protect_submission_privileged_fields
before insert or update on public.submissions
for each row execute function public.protect_submission_privileged_fields();

-- Payment and subscription rows contain authoritative gateway state and, for
-- billing, reusable payment credentials. Owners may read but never write them.
drop policy if exists "Submission payments writeable by owner or admin"
  on public.submission_payments;
drop policy if exists "Submission payments writable by admin"
  on public.submission_payments;
create policy "Submission payments writable by admin"
on public.submission_payments
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Subscription billing writeable by owner or admin"
  on public.subscription_billing;
drop policy if exists "Subscription billing writable by admin"
  on public.subscription_billing;
create policy "Subscription billing writable by admin"
on public.subscription_billing
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Subscriptions writeable by owner or admin"
  on public.subscriptions;
drop policy if exists "Subscriptions writable by admin"
  on public.subscriptions;
create policy "Subscriptions writable by admin"
on public.subscriptions
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Subscription history writeable by owner or admin"
  on public.subscription_history;
drop policy if exists "Subscription history writable by admin"
  on public.subscription_history;
create policy "Subscription history writable by admin"
on public.subscription_history
for all
using (public.is_admin())
with check (public.is_admin());

-- Remove the later public-read policy which exposed guest contact details,
-- notes and private file paths. The original owner/admin read policy remains.
drop policy if exists "Karaoke requests public readable"
  on public.karaoke_requests;
drop policy if exists "Karaoke requests insertable"
  on public.karaoke_requests;
create policy "Karaoke requests insertable by admin"
on public.karaoke_requests
for insert
with check (public.is_admin());

drop policy if exists "Karaoke requests updatable"
  on public.karaoke_requests;
create policy "Karaoke requests updatable by admin"
on public.karaoke_requests
for update
using (public.is_admin())
with check (public.is_admin());

-- These tables carry credit balances, moderation state, and relationships to
-- other users' submissions/promotions. Their public Server Actions validate
-- the caller and persist through the trusted server client, so direct owner
-- INSERT policies would only provide a bypass around those checks.
drop policy if exists "Karaoke votes insertable" on public.karaoke_votes;
drop policy if exists "Karaoke promotions insertable" on public.karaoke_promotions;
drop policy if exists "Karaoke contributions insertable"
  on public.karaoke_promotion_contributions;
drop policy if exists "Karaoke recommendations insertable"
  on public.karaoke_promotion_recommendations;

-- Keep old application instances functional during a DB-first rollout, but
-- permit only inert PENDING evidence rows. Credit and moderation transitions
-- remain server-only and are serialized by the later atomic RPC migration.
create policy "Karaoke votes pending insert"
on public.karaoke_votes
for insert
with check (
  voter_user_id = auth.uid()
  and voter_guest_email is null
  and status = 'PENDING'
  and (proof_path is null or length(proof_path) <= 1024)
);

create policy "Karaoke recommendations pending insert"
on public.karaoke_promotion_recommendations
for insert
with check (
  recommender_user_id = auth.uid()
  and status = 'PENDING'
  and (proof_path is null or length(proof_path) <= 1024)
  and exists (
    select 1
    from public.karaoke_promotions promotion
    where promotion.id = karaoke_promotion_recommendations.promotion_id
      and promotion.status = 'ACTIVE'
      and promotion.credits_balance > 0
      and promotion.owner_user_id is distinct from auth.uid()
  )
);

-- Magazine and studio requests are created only by their SECURITY DEFINER
-- RPCs, which atomically verify ownership and available credits. Blocking raw
-- table inserts prevents forged moderation state and cross-owner redemption
-- links while keeping the supported RPC flows intact.
drop policy if exists "Magazine requests insertable by owner"
  on public.magazine_requests;
drop policy if exists "Studio reservations insertable by owner"
  on public.studio_reservation_requests;

-- Review state and audit history are produced by trusted submission/payment
-- flows. Owners retain SELECT access through the policies from 0002_core.sql.
drop policy if exists "Station reviews insertable" on public.station_reviews;
drop policy if exists "Station reviews updatable" on public.station_reviews;
drop policy if exists "Station reviews writable by admin" on public.station_reviews;
create policy "Station reviews writable by admin"
on public.station_reviews
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Submission events insertable" on public.submission_events;
drop policy if exists "Submission events insertable by admin" on public.submission_events;
create policy "Submission events insertable by admin"
on public.submission_events
for insert
with check (public.is_admin());
