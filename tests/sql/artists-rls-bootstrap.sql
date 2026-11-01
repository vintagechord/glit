-- Minimal Supabase-like roles and the submissions columns 0028 and the
-- artists policy use. Default privileges mirror Supabase: every new public
-- table is granted to the API roles, which is how 0028 left artists open.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create table public.submissions (
  id uuid primary key,
  user_id uuid,
  artist_name text
);
alter table public.submissions enable row level security;
create policy "Submissions readable" on public.submissions
for select using (user_id = auth.uid());

insert into public.submissions (id, user_id, artist_name) values
  ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Owner Artist'),
  ('a2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Other Artist'),
  ('a3333333-3333-4333-8333-333333333333', null, 'Guest Artist');
