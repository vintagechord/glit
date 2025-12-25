create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  company text,
  phone text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, name, company, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'company', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (user_id) do update
    set name = excluded.name,
        company = excluded.company,
        phone = excluded.phone,
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;

create policy "Profiles are viewable by owner"
on public.profiles
for select
using (auth.uid() = user_id);

create policy "Profiles are insertable by owner"
on public.profiles
for insert
with check (auth.uid() = user_id);

create policy "Profiles are updatable by owner"
on public.profiles
for update
using (auth.uid() = user_id);
