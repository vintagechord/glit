create table if not exists public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  amount integer not null check (amount > 0),
  reason text,
  granted_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists credit_grants_user_idx
  on public.credit_grants (user_id, created_at desc);

alter table public.credit_grants enable row level security;

drop policy if exists "Credit grants readable" on public.credit_grants;
create policy "Credit grants readable"
on public.credit_grants
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Credit grants manageable by admin" on public.credit_grants;
create policy "Credit grants manageable by admin"
on public.credit_grants
for all
using (public.is_admin())
with check (public.is_admin());

create or replace function public.redeem_credit_reward(p_reward_id uuid)
returns public.credit_reward_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reward public.credit_rewards%rowtype;
  v_earned integer := 0;
  v_granted integer := 0;
  v_magazine_used integer := 0;
  v_reward_used integer := 0;
  v_available integer := 0;
  v_coupon_code text;
  v_redemption public.credit_reward_redemptions%rowtype;
begin
  if v_user_id is null then
    raise exception 'LOGIN_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  select *
    into v_reward
  from public.credit_rewards
  where id = p_reward_id
    and is_active = true;

  if not found then
    raise exception 'REWARD_NOT_FOUND';
  end if;

  select count(*)::integer
    into v_earned
  from public.submissions
  where user_id = v_user_id
    and type = 'ALBUM'
    and payment_status = 'PAID';

  select coalesce(sum(amount), 0)::integer
    into v_granted
  from public.credit_grants
  where user_id = v_user_id;

  select count(*)::integer
    into v_magazine_used
  from public.magazine_requests
  where user_id = v_user_id
    and status <> 'CANCELED';

  select coalesce(sum(credits_spent), 0)::integer
    into v_reward_used
  from public.credit_reward_redemptions
  where user_id = v_user_id
    and status <> 'CANCELED';

  v_available := v_earned + v_granted - v_magazine_used - v_reward_used;

  if v_available < v_reward.credits_required then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_coupon_code :=
    'ON-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) ||
    '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.credit_reward_redemptions (
    user_id,
    reward_id,
    reward_title,
    reward_description,
    credits_spent,
    coupon_code,
    expires_at
  )
  values (
    v_user_id,
    v_reward.id,
    v_reward.title,
    v_reward.description,
    v_reward.credits_required,
    v_coupon_code,
    case
      when v_reward.validity_days is null then null
      else now() + make_interval(days => v_reward.validity_days)
    end
  )
  returning * into v_redemption;

  return v_redemption;
end;
$$;

grant execute on function public.redeem_credit_reward(uuid) to authenticated;

create or replace function public.redeem_studio_reward(
  p_reward_id uuid,
  p_preferred_date date,
  p_preferred_time text,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text default null,
  p_notes text default null
)
returns public.studio_reservation_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reward public.credit_rewards%rowtype;
  v_earned integer := 0;
  v_granted integer := 0;
  v_magazine_used integer := 0;
  v_reward_used integer := 0;
  v_available integer := 0;
  v_coupon_code text;
  v_redemption public.credit_reward_redemptions%rowtype;
  v_request public.studio_reservation_requests%rowtype;
  v_preferred_time time;
begin
  if v_user_id is null then
    raise exception 'LOGIN_REQUIRED';
  end if;

  if p_preferred_date < current_date then
    raise exception 'INVALID_RESERVATION_DATE';
  end if;

  begin
    v_preferred_time := p_preferred_time::time;
  exception when others then
    raise exception 'INVALID_RESERVATION_TIME';
  end;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  select *
    into v_reward
  from public.credit_rewards
  where id = p_reward_id
    and is_active = true;

  if not found then
    raise exception 'REWARD_NOT_FOUND';
  end if;

  if v_reward.title not in (
    '빈티지하우스 메인 녹음실 1시간 권',
    '빈티지하우스 셀프 녹음실 1시간 권'
  ) then
    raise exception 'STUDIO_REWARD_REQUIRED';
  end if;

  select count(*)::integer
    into v_earned
  from public.submissions
  where user_id = v_user_id
    and type = 'ALBUM'
    and payment_status = 'PAID';

  select coalesce(sum(amount), 0)::integer
    into v_granted
  from public.credit_grants
  where user_id = v_user_id;

  select count(*)::integer
    into v_magazine_used
  from public.magazine_requests
  where user_id = v_user_id
    and status <> 'CANCELED';

  select coalesce(sum(credits_spent), 0)::integer
    into v_reward_used
  from public.credit_reward_redemptions
  where user_id = v_user_id
    and status <> 'CANCELED';

  v_available := v_earned + v_granted - v_magazine_used - v_reward_used;

  if v_available < v_reward.credits_required then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_coupon_code :=
    'ST-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) ||
    '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.credit_reward_redemptions (
    user_id,
    reward_id,
    reward_title,
    reward_description,
    credits_spent,
    coupon_code,
    expires_at
  )
  values (
    v_user_id,
    v_reward.id,
    v_reward.title,
    v_reward.description,
    v_reward.credits_required,
    v_coupon_code,
    case
      when v_reward.validity_days is null then null
      else now() + make_interval(days => v_reward.validity_days)
    end
  )
  returning * into v_redemption;

  insert into public.studio_reservation_requests (
    user_id,
    redemption_id,
    reward_id,
    reward_title,
    service_location,
    preferred_date,
    preferred_time,
    duration_hours,
    contact_name,
    contact_phone,
    contact_email,
    notes
  )
  values (
    v_user_id,
    v_redemption.id,
    v_reward.id,
    v_reward.title,
    v_reward.service_location,
    p_preferred_date,
    v_preferred_time,
    1,
    btrim(p_contact_name),
    btrim(p_contact_phone),
    nullif(btrim(coalesce(p_contact_email, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_request;

  return v_request;
end;
$$;

grant execute on function public.redeem_studio_reward(
  uuid,
  date,
  text,
  text,
  text,
  text,
  text
) to authenticated;
