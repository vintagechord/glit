create table if not exists public.support_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  contact text not null check (char_length(trim(contact)) between 1 and 160),
  status text not null default 'NEW'
    check (status in ('NEW', 'REVIEWING', 'ANSWERED', 'CLOSED')),
  admin_memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_inquiries_created_at_idx
  on public.support_inquiries (created_at desc);

create index if not exists support_inquiries_status_idx
  on public.support_inquiries (status);

create index if not exists support_inquiries_user_idx
  on public.support_inquiries (user_id)
  where user_id is not null;

drop trigger if exists set_support_inquiries_updated_at on public.support_inquiries;
create trigger set_support_inquiries_updated_at
before update on public.support_inquiries
for each row execute procedure public.set_updated_at();

alter table public.support_inquiries enable row level security;

drop policy if exists "Support inquiries readable by owner or admin" on public.support_inquiries;
create policy "Support inquiries readable by owner or admin"
on public.support_inquiries
for select
using (public.is_admin() or user_id = auth.uid());

drop policy if exists "Support inquiries manageable by admin" on public.support_inquiries;
create policy "Support inquiries manageable by admin"
on public.support_inquiries
for all
using (public.is_admin())
with check (public.is_admin());
