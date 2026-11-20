-- Support inquiries, studio reservations and coupon redemptions each carry
-- admin_memo, a note staff write while handling the request (/admin/inquiries
-- labels it "처리 메모"; customers get approved_message instead). Their owner
-- SELECT policies are row-level only, so a member who called PostgREST with
-- the public anon key and their own session read the staff memo on their own
-- rows. 20261103160000 moved submissions.admin_memo out for the same reason.
--
-- The app reads these tables only with the service role (createAdminClient),
-- and the member RPCs that touch them (redeem_credit_reward,
-- redeem_studio_reward, create_magazine_request) are SECURITY DEFINER, so the
-- owner policies serve no screen. Administrators keep every row through the
-- existing FOR ALL "... manageable by admin" policies.
drop policy if exists "Support inquiries readable by owner or admin" on public.support_inquiries;
drop policy if exists "Studio reservations readable" on public.studio_reservation_requests;
drop policy if exists "Credit reward redemptions readable" on public.credit_reward_redemptions;
