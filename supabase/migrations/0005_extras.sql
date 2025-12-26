do $$ begin
  create type payment_method as enum ('BANK', 'CARD');
exception
  when duplicate_object then null;
end $$;

alter table public.submissions
  add column if not exists payment_method payment_method not null default 'BANK',
  add column if not exists mv_base_selected boolean not null default true;

alter table public.album_tracks
  add column if not exists arranger text,
  add column if not exists lyrics text;

create table if not exists public.ad_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  image_url text not null,
  link_url text,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_ad_banners_updated_at
before update on public.ad_banners
for each row execute procedure public.set_updated_at();

alter table public.ad_banners enable row level security;

create policy "Ad banners readable"
on public.ad_banners
for select
using (
  is_active
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
);

create policy "Admin manages ad banners"
on public.ad_banners
for all
using (public.is_admin())
with check (public.is_admin());
