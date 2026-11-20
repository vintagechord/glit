-- Supabase-like roles, auth helpers and storage tables for the read-policy
-- suite. Grants mirror a Supabase project: every new public table is granted
-- to the API roles, and storage.objects is granted to them as well, so row
-- level security alone decides what a caller may read or list. The Storage
-- API lists a bucket as the caller's role; public downloads and signed
-- uploads run as its superuser and need no storage.objects policy.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- 0001_profiles.sql and 0002_core.sql definitions the migrations below use.
create table public.profiles (
  user_id uuid primary key references auth.users,
  role text not null default 'user'
);
create function public.set_updated_at() returns trigger
language plpgsql
as $$ begin new.updated_at := now(); return new; end; $$;
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
