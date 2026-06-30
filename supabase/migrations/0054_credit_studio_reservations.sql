create table if not exists public.studio_reservation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  redemption_id uuid not null references public.credit_reward_redemptions on delete cascade,
  reward_id uuid references public.credit_rewards on delete set null,
  reward_title text not null,
  service_location text,
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'APPROVED', 'CANCELED')),
  preferred_date date not null,
  preferred_time time not null,
  duration_hours numeric(4, 2) not null default 1
    check (duration_hours > 0),
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  notes text,
  approved_message text,
  admin_memo text,
  approved_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (redemption_id)
);

create index if not exists studio_reservation_requests_user_idx
  on public.studio_reservation_requests (user_id, created_at desc);

create index if not exists studio_reservation_requests_status_idx
  on public.studio_reservation_requests (status, created_at desc);

drop trigger if exists set_studio_reservation_requests_updated_at
  on public.studio_reservation_requests;
create trigger set_studio_reservation_requests_updated_at
before update on public.studio_reservation_requests
for each row execute procedure public.set_updated_at();

alter table public.studio_reservation_requests enable row level security;

drop policy if exists "Studio reservations readable" on public.studio_reservation_requests;
create policy "Studio reservations readable"
on public.studio_reservation_requests
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Studio reservations insertable by owner" on public.studio_reservation_requests;
create policy "Studio reservations insertable by owner"
on public.studio_reservation_requests
for insert
with check (user_id = auth.uid());

drop policy if exists "Studio reservations manageable by admin" on public.studio_reservation_requests;
create policy "Studio reservations manageable by admin"
on public.studio_reservation_requests
for all
using (public.is_admin())
with check (public.is_admin());

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
