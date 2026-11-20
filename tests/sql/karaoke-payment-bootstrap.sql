-- Supabase-like roles and the karaoke_requests columns that the karaoke
-- payment migrations (0033, 0082, 0084, 20261103133000 and later) build on.
-- The runner applies those migrations themselves on top of this.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key, aud text, role text);
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;

create type public.payment_method as enum ('BANK', 'CARD', 'PAYPAL');
create type public.payment_status as enum ('UNPAID', 'PAYMENT_PENDING', 'PAID', 'REFUNDED');
create type public.karaoke_status as enum ('REQUESTED', 'IN_REVIEW', 'COMPLETED');

create table public.profiles (user_id uuid primary key, role text not null default 'user');
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- 0002, 0004, 0007 and 0010 columns; 0033 adds the payment columns.
create table public.karaoke_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  title text not null,
  status public.karaoke_status not null default 'REQUESTED',
  payment_method public.payment_method not null default 'BANK',
  payment_status public.payment_status not null default 'UNPAID',
  amount_krw integer not null default 50000,
  created_at timestamptz not null default now()
);
alter table public.karaoke_requests enable row level security;

-- 0084 also scrubs submission payment rows; only raw_response matters here.
create table public.submission_payments (
  id uuid primary key default gen_random_uuid(),
  raw_response jsonb
);
alter table public.submission_payments enable row level security;
