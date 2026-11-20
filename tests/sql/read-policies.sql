-- What the public API keys can read. Member uploads of magazine artwork must
-- not be listable (20261121100000), and members must not read the staff memo
-- on their own support inquiry, studio reservation or coupon redemption
-- (20261121101000). Administrators and the service role keep full access.

insert into auth.users (id) values
  ('c1111111-1111-4111-8111-111111111111'),
  ('c2222222-2222-4222-8222-222222222222'),
  ('c9999999-9999-4999-8999-999999999999');
insert into public.profiles (user_id, role) values
  ('c1111111-1111-4111-8111-111111111111', 'user'),
  ('c2222222-2222-4222-8222-222222222222', 'user'),
  ('c9999999-9999-4999-8999-999999999999', 'admin');

-- Uploads exactly as src/features/magazine/actions.ts names them.
insert into storage.objects (bucket_id, name, owner) values
  ('magazine-artwork', 'c1111111-1111-4111-8111-111111111111/uploads/1763600000000-0b7c1f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f-cover.png', 'c1111111-1111-4111-8111-111111111111'),
  ('magazine-artwork', 'c2222222-2222-4222-8222-222222222222/uploads/1763600000001-5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716-unreleased.png', 'c2222222-2222-4222-8222-222222222222');

insert into public.credit_rewards (id, title, credits_required)
values ('c3333333-3333-4333-8333-333333333333', 'Read policy reward', 1);
insert into public.credit_reward_redemptions (
  id, user_id, reward_id, reward_title, credits_spent, coupon_code, admin_memo
) values (
  'c4444444-4444-4444-8444-444444444444', 'c1111111-1111-4111-8111-111111111111',
  'c3333333-3333-4333-8333-333333333333', 'Read policy reward', 1, 'READ-POLICY-A', 'redemption staff memo'
);
insert into public.studio_reservation_requests (
  user_id, redemption_id, reward_id, reward_title, preferred_date, preferred_time,
  contact_name, contact_phone, approved_message, admin_memo
) values (
  'c1111111-1111-4111-8111-111111111111', 'c4444444-4444-4444-8444-444444444444',
  'c3333333-3333-4333-8333-333333333333', 'Read policy reward', current_date, '12:00',
  'Member A', '01000000000', '예약이 확정되었습니다.', 'studio staff memo'
);
insert into public.support_inquiries (user_id, title, body, contact, admin_memo)
values ('c1111111-1111-4111-8111-111111111111', '문의', '문의 본문', 'a@example.test', 'inquiry staff memo');

-- A signed-in member calls the Storage list endpoint and PostgREST directly
-- with the public anon key and their own session.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1111111-1111-4111-8111-111111111111', true);
do $$
declare problems text[] := '{}';
begin
  if exists (select 1 from storage.objects where bucket_id = 'magazine-artwork') then
    problems := array_append(problems, 'a member lists magazine-artwork uploads, other members'' included');
  end if;
  if exists (select 1 from public.support_inquiries where admin_memo is not null) then
    problems := array_append(problems, 'a member reads the staff memo on their own support inquiry');
  end if;
  if exists (select 1 from public.studio_reservation_requests where admin_memo is not null) then
    problems := array_append(problems, 'a member reads the staff memo on their own studio reservation');
  end if;
  if exists (select 1 from public.credit_reward_redemptions where admin_memo is not null) then
    problems := array_append(problems, 'a member reads the staff memo on their own coupon redemption');
  end if;
  if cardinality(problems) > 0 then
    raise exception 'Read policy leaks: %', array_to_string(problems, '; ');
  end if;
end;
$$;
rollback;

-- Anyone holding the public anon key.
begin;
set local role anon;
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'magazine-artwork') then
    raise exception 'Read policy leaks: anon lists magazine-artwork uploads';
  end if;
  if exists (select 1 from public.support_inquiries)
    or exists (select 1 from public.studio_reservation_requests)
    or exists (select 1 from public.credit_reward_redemptions) then
    raise exception 'Read policy leaks: anon reads member requests';
  end if;
end;
$$;
rollback;

-- Administrators keep everything through their FOR ALL policies.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c9999999-9999-4999-8999-999999999999', true);
do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'magazine-artwork') <> 2 then
    raise exception 'an administrator lost the magazine-artwork listing';
  end if;
  if (select admin_memo from public.support_inquiries) is distinct from 'inquiry staff memo'
    or (select admin_memo from public.studio_reservation_requests) is distinct from 'studio staff memo'
    or (select admin_memo from public.credit_reward_redemptions) is distinct from 'redemption staff memo' then
    raise exception 'an administrator lost a staff memo';
  end if;
end;
$$;
rollback;

-- Server code (service role): the orphan-artwork cleanup, the backup and
-- every app read of these tables. The bucket stays public, so artwork_url
-- links keep working without any storage.objects policy.
begin;
set local role service_role;
do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'magazine-artwork') <> 2 then
    raise exception 'the service role lost the magazine-artwork listing';
  end if;
  if (select count(*) from public.support_inquiries) <> 1
    or (select count(*) from public.studio_reservation_requests) <> 1
    or (select count(*) from public.credit_reward_redemptions) <> 1 then
    raise exception 'the service role lost member requests';
  end if;
  if not (select public from storage.buckets where id = 'magazine-artwork') then
    raise exception 'magazine-artwork is no longer a public bucket';
  end if;
end;
$$;
rollback;
