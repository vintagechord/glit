-- Historical requests keep the 1-credit price charged when they were created.
-- New requests record their 3-credit price so all balance readers and refunds
-- use the recorded charge, rather than multiplying historical request counts.
begin;

alter table public.magazine_requests
  add column credits_spent integer not null default 1
  check (credits_spent > 0);
alter table public.magazine_requests
  alter column credits_spent set default 3;

comment on column public.magazine_requests.credits_spent is
  'Credit charge recorded at creation. Legacy requests: 1; new magazine requests: 3. CANCELED requests do not consume credits.';

-- Preserve the RPC-only owner write boundary established by 0074.
drop policy if exists "Magazine requests insertable by owner" on public.magazine_requests;

create or replace function public.create_magazine_request(
  p_submission_id uuid,
  p_target_channel text,
  p_requester_name text,
  p_requester_email text,
  p_requester_phone text,
  p_album_title text,
  p_artist_name text,
  p_release_date date,
  p_artwork_url text,
  p_album_url text,
  p_video_url text,
  p_article_body text,
  p_credits_text text,
  p_notes text
)
returns public.magazine_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_credit_cost constant integer := 3;
  v_earned integer := 0;
  v_admin_granted integer := 0;
  v_magazine_used integer := 0;
  v_reward_used integer := 0;
  v_available integer := 0;
  v_request public.magazine_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'LOGIN_REQUIRED';
  end if;

  if p_target_channel not in ('DOMESTIC_NEWS', 'MEDIA') then
    raise exception 'INVALID_TARGET_CHANNEL';
  end if;

  if btrim(coalesce(p_requester_name, '')) = ''
    or btrim(coalesce(p_requester_email, '')) = '' then
    raise exception 'INVALID_CONTACT';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  select count(*)::integer
    into v_earned
  from public.submissions
  where user_id = v_user_id
    and type = 'ALBUM'
    and payment_status = 'PAID';

  select coalesce(sum(g.amount), 0)::integer
    into v_admin_granted
  from public.credit_grants g
  where g.user_id = v_user_id;

  select coalesce(sum(credits_spent), 0)::integer
    into v_magazine_used
  from public.magazine_requests
  where user_id = v_user_id
    and status <> 'CANCELED';

  select coalesce(sum(credits_spent), 0)::integer
    into v_reward_used
  from public.credit_reward_redemptions
  where user_id = v_user_id
    and status <> 'CANCELED';

  v_available := v_earned + v_admin_granted - v_magazine_used - v_reward_used;

  if v_available < v_credit_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  if p_submission_id is not null then
    if not exists (
      select 1
      from public.submissions s
      where s.id = p_submission_id
        and s.user_id = v_user_id
        and s.type = 'ALBUM'
        and s.payment_status = 'PAID'
    ) then
      raise exception 'INVALID_SUBMISSION';
    end if;

    if exists (
      select 1
      from public.magazine_requests mr
      where mr.submission_id = p_submission_id
        and mr.status <> 'CANCELED'
    ) then
      raise exception 'DUPLICATE_SUBMISSION';
    end if;
  end if;

  insert into public.magazine_requests (
    submission_id,
    user_id,
    target_channel,
    credits_spent,
    requester_name,
    requester_email,
    requester_phone,
    album_title,
    artist_name,
    release_date,
    artwork_url,
    album_url,
    video_url,
    article_body,
    credits_text,
    notes
  )
  values (
    p_submission_id,
    v_user_id,
    p_target_channel,
    v_credit_cost,
    btrim(p_requester_name),
    btrim(p_requester_email),
    nullif(btrim(coalesce(p_requester_phone, '')), ''),
    nullif(btrim(coalesce(p_album_title, '')), ''),
    nullif(btrim(coalesce(p_artist_name, '')), ''),
    p_release_date,
    nullif(btrim(coalesce(p_artwork_url, '')), ''),
    nullif(btrim(coalesce(p_album_url, '')), ''),
    nullif(btrim(coalesce(p_video_url, '')), ''),
    nullif(btrim(coalesce(p_article_body, '')), ''),
    nullif(btrim(coalesce(p_credits_text, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_request;

  return v_request;
end;
$$;

grant execute on function public.create_magazine_request(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

create or replace function public.redeem_credit_reward(p_reward_id uuid)
returns public.credit_reward_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reward public.credit_rewards%rowtype;
  v_earned integer := 0;
  v_admin_granted integer := 0;
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

  select coalesce(sum(g.amount), 0)::integer
    into v_admin_granted
  from public.credit_grants g
  where g.user_id = v_user_id;

  select coalesce(sum(credits_spent), 0)::integer
    into v_magazine_used
  from public.magazine_requests
  where user_id = v_user_id
    and status <> 'CANCELED';

  select coalesce(sum(credits_spent), 0)::integer
    into v_reward_used
  from public.credit_reward_redemptions
  where user_id = v_user_id
    and status <> 'CANCELED';

  v_available := v_earned + v_admin_granted - v_magazine_used - v_reward_used;

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
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reward public.credit_rewards%rowtype;
  v_earned integer := 0;
  v_admin_granted integer := 0;
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

  select count(*)::integer
    into v_earned
  from public.submissions
  where user_id = v_user_id
    and type = 'ALBUM'
    and payment_status = 'PAID';

  select coalesce(sum(g.amount), 0)::integer
    into v_admin_granted
  from public.credit_grants g
  where g.user_id = v_user_id;

  select coalesce(sum(credits_spent), 0)::integer
    into v_magazine_used
  from public.magazine_requests
  where user_id = v_user_id
    and status <> 'CANCELED';

  select coalesce(sum(credits_spent), 0)::integer
    into v_reward_used
  from public.credit_reward_redemptions
  where user_id = v_user_id
    and status <> 'CANCELED';

  v_available := v_earned + v_admin_granted - v_magazine_used - v_reward_used;

  if v_available < v_reward.credits_required then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_coupon_code :=
    'SR-' ||
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

-- Only authenticated callers can use these owner-scoped spending functions.
revoke all on function public.create_magazine_request(uuid,text,text,text,text,text,text,date,text,text,text,text,text,text) from public, anon;
revoke all on function public.redeem_credit_reward(uuid) from public, anon;
revoke all on function public.redeem_studio_reward(uuid,date,text,text,text,text,text) from public, anon;
grant execute on function public.create_magazine_request(uuid,text,text,text,text,text,text,date,text,text,text,text,text,text) to authenticated, service_role;
grant execute on function public.redeem_credit_reward(uuid) to authenticated, service_role;
grant execute on function public.redeem_studio_reward(uuid,date,text,text,text,text,text) to authenticated, service_role;

commit;
