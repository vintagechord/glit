create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_site_settings_updated_at on public.site_settings;
create trigger set_site_settings_updated_at
before update on public.site_settings
for each row execute procedure public.set_updated_at();

alter table public.site_settings enable row level security;

drop policy if exists "Site settings readable" on public.site_settings;
create policy "Site settings readable"
on public.site_settings
for select
using (true);

drop policy if exists "Admin manages site settings" on public.site_settings;
create policy "Admin manages site settings"
on public.site_settings
for all
using (public.is_admin())
with check (public.is_admin());

insert into public.site_settings (key, value, description)
values (
  'album_review_discount_percent',
  jsonb_build_object('discountPercent', 50),
  '음반 심의 기본 할인율(%), 3곳/7곳 패키지는 40% 우선 적용'
)
on conflict (key) do nothing;
