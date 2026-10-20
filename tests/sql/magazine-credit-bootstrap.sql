-- Isolated local test prerequisites; no production connection is used.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create function public.is_admin() returns boolean language sql stable as $$ select false; $$;
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create table public.profiles (user_id uuid primary key, role text);
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  guest_token text,
  type text not null default 'ALBUM',
  payment_status text not null default 'PAID'
);
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
