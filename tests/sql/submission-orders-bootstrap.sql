create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user::text)$$;
create table public.profiles(user_id uuid primary key references auth.users,role text not null);
create table public.packages(id uuid primary key,name text);
-- Production 0071 deletes submission children atomically; new order snapshots
-- introduced later deliberately use SET NULL instead.
do $$ declare t text; begin
  foreach t in array array['submission_payments','station_reviews','submission_events','submission_files'] loop
    execute format('alter table public.%I drop constraint %I',t,t||'_submission_id_fkey');
    execute format('alter table public.%I add foreign key(submission_id) references public.submissions(id) on delete cascade',t);
  end loop;
end $$;
alter table public.submissions
  add column artist_name text default 'Fixture artist',
  add column package_id uuid references public.packages,
  add column is_oneclick boolean not null default false,
  add column payment_provider text,
  add column payment_currency text,
  add column payment_amount numeric(12,2),
  add column paypal_order_id text,
  add column paypal_capture_id text,
  add column album_discount_base_submission_id uuid,
  add column admin_memo text,
  add column save_lease_token uuid,
  add column save_lease_expires_at timestamptz,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();
alter table public.submission_payments
  add column user_id uuid,
  add column order_id text unique,
  add column amount_krw integer,
  add column provider text,
  add column amount numeric(12,2),
  add column currency text,
  add column paypal_capture_id text,
  add column pg_tid text,
  add column result_code text,
  add column result_message text,
  add column paid_at timestamptz,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();
grant usage on schema auth to authenticated,service_role;
grant select on auth.users to service_role;
grant select,insert,update on all tables in schema public to service_role;
insert into auth.users values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('99999999-9999-4999-8999-999999999999');
insert into public.profiles values ('99999999-9999-4999-8999-999999999999','admin'),('11111111-1111-4111-8111-111111111111','user');
insert into public.packages values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture package');
-- Backfill coverage: one pending PG, one failed PG, one legacy bank group.
insert into public.submissions(id,user_id,package_id,payment_method,payment_status,status,album_draft_group_id) values
 ('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CARD','PAYMENT_PENDING','WAITING_PAYMENT',null),
 ('00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CARD','UNPAID','SUBMITTED',null),
 ('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BANK','PAYMENT_PENDING','WAITING_PAYMENT','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('00000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BANK','PAYMENT_PENDING','WAITING_PAYMENT','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.submission_payments(submission_id,user_id,order_id,amount_krw,provider,status,raw_response) values
 ('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','LEGACY-PENDING',50000,'inicis','REQUESTED','{"closeState":"11111111-1111-4111-8111-111111111111"}'),
 ('00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','LEGACY-FAILED',50000,'inicis','FAILED','{}');
