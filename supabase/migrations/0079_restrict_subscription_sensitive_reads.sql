-- Reusable billing keys and raw PG callback bodies must never be selectable
-- directly by an account owner. The application exposes only an authenticated,
-- server-side summary projection. Keep administrator access for operations.

drop policy if exists "Subscription billing readable by owner or admin"
  on public.subscription_billing;
drop policy if exists "Subscription billing readable by admin"
  on public.subscription_billing;
create policy "Subscription billing readable by admin"
on public.subscription_billing
for select
using (public.is_admin());

drop policy if exists "Subscription history readable by owner or admin"
  on public.subscription_history;
drop policy if exists "Subscription history readable by admin"
  on public.subscription_history;
create policy "Subscription history readable by admin"
on public.subscription_history
for select
using (public.is_admin());
