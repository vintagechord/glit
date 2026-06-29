create table if not exists public.magazine_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions on delete cascade,
  user_id uuid references auth.users on delete set null,
  guest_token text,
  target_channel text not null default 'DOMESTIC_NEWS'
    check (target_channel in ('DOMESTIC_NEWS', 'MEDIA')),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'WRITING', 'PUBLISHED', 'CANCELED')),
  requester_name text not null,
  requester_email text not null,
  requester_phone text,
  album_title text,
  artist_name text,
  release_date date,
  artwork_url text,
  album_url text,
  video_url text,
  article_body text,
  credits_text text,
  notes text,
  published_url text,
  admin_memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists magazine_requests_submission_key
  on public.magazine_requests (submission_id);

create index if not exists magazine_requests_user_idx
  on public.magazine_requests (user_id);

create index if not exists magazine_requests_guest_token_idx
  on public.magazine_requests (guest_token)
  where guest_token is not null;

create index if not exists magazine_requests_status_idx
  on public.magazine_requests (status);

drop trigger if exists set_magazine_requests_updated_at on public.magazine_requests;
create trigger set_magazine_requests_updated_at
before update on public.magazine_requests
for each row execute procedure public.set_updated_at();

alter table public.magazine_requests enable row level security;

drop policy if exists "Magazine requests readable by owner or admin" on public.magazine_requests;
create policy "Magazine requests readable by owner or admin"
on public.magazine_requests
for select
using (
  public.is_admin()
  or user_id = auth.uid()
  or exists (
    select 1
    from public.submissions s
    where s.id = magazine_requests.submission_id
      and s.user_id = auth.uid()
  )
);

drop policy if exists "Magazine requests insertable by owner" on public.magazine_requests;
create policy "Magazine requests insertable by owner"
on public.magazine_requests
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.submissions s
    where s.id = magazine_requests.submission_id
      and s.user_id = auth.uid()
      and s.type = 'ALBUM'
      and s.payment_status = 'PAID'
  )
);

drop policy if exists "Magazine requests manageable by admin" on public.magazine_requests;
create policy "Magazine requests manageable by admin"
on public.magazine_requests
for all
using (public.is_admin())
with check (public.is_admin());
