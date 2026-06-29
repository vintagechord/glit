create table if not exists public.credit_rewards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  credits_required integer not null check (credits_required > 0),
  service_location text,
  validity_days integer check (validity_days is null or validity_days > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  reward_id uuid references public.credit_rewards on delete set null,
  reward_title text not null,
  reward_description text,
  credits_spent integer not null check (credits_spent > 0),
  coupon_code text not null unique,
  status text not null default 'ISSUED'
    check (status in ('ISSUED', 'USED', 'CANCELED')),
  expires_at timestamptz,
  admin_memo text,
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_rewards_active_sort_idx
  on public.credit_rewards (is_active, sort_order, created_at);

create index if not exists credit_reward_redemptions_user_idx
  on public.credit_reward_redemptions (user_id, created_at desc);

create index if not exists credit_reward_redemptions_status_idx
  on public.credit_reward_redemptions (status, created_at desc);

drop trigger if exists set_credit_rewards_updated_at on public.credit_rewards;
create trigger set_credit_rewards_updated_at
before update on public.credit_rewards
for each row execute procedure public.set_updated_at();

drop trigger if exists set_credit_reward_redemptions_updated_at on public.credit_reward_redemptions;
create trigger set_credit_reward_redemptions_updated_at
before update on public.credit_reward_redemptions
for each row execute procedure public.set_updated_at();

alter table public.credit_rewards enable row level security;
alter table public.credit_reward_redemptions enable row level security;

drop policy if exists "Credit rewards readable" on public.credit_rewards;
create policy "Credit rewards readable"
on public.credit_rewards
for select
using (is_active or public.is_admin());

drop policy if exists "Credit rewards manageable by admin" on public.credit_rewards;
create policy "Credit rewards manageable by admin"
on public.credit_rewards
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Credit reward redemptions readable" on public.credit_reward_redemptions;
create policy "Credit reward redemptions readable"
on public.credit_reward_redemptions
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Credit reward redemptions manageable by admin" on public.credit_reward_redemptions;
create policy "Credit reward redemptions manageable by admin"
on public.credit_reward_redemptions
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

  v_available := v_earned - v_magazine_used - v_reward_used;

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

insert into public.credit_rewards (
  title,
  description,
  credits_required,
  service_location,
  validity_days,
  sort_order,
  is_active
)
select
  '빈티지하우스 메인 녹음실 1시간 권',
  '온사이드 크레딧 10개로 교환 가능한 빈티지하우스 메인 녹음실 1시간 이용권입니다.',
  10,
  '빈티지하우스 메인 녹음실',
  90,
  10,
  true
where not exists (
  select 1
  from public.credit_rewards
  where title = '빈티지하우스 메인 녹음실 1시간 권'
);

insert into public.credit_rewards (
  title,
  description,
  credits_required,
  service_location,
  validity_days,
  sort_order,
  is_active
)
select
  '빈티지하우스 셀프 녹음실 1시간 권',
  '온사이드 크레딧 3개로 교환 가능한 빈티지하우스 셀프 녹음실 1시간 이용권입니다.',
  3,
  '빈티지하우스 셀프 녹음실',
  90,
  20,
  true
where not exists (
  select 1
  from public.credit_rewards
  where title = '빈티지하우스 셀프 녹음실 1시간 권'
);
