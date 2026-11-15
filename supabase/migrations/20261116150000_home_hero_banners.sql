-- 메인 배너 관리 (2026-11-16). The home page's main banner becomes a short
-- carousel. Each row pairs one of the designs drawn in the site's CSS
-- (record, url, certificate, reasons) with copy an administrator edits; the designs
-- themselves are code. Rows show in sort_order; the page falls back to the
-- built-in set when the table is empty (src/lib/home-hero-banners.ts), so the
-- seed below only makes the built-in four editable.
--
-- The ad placements in ad_banners (배너 관리) are separate and unchanged.

create table public.home_hero_banners (
  id uuid primary key default gen_random_uuid(),
  design text not null check (design in ('record', 'url', 'certificate', 'reasons')),
  badge text check (char_length(badge) <= 24),
  headline_1 text not null check (char_length(btrim(headline_1)) between 1 and 40),
  headline_2 text check (char_length(headline_2) <= 40),
  body text check (char_length(body) <= 60),
  badge_en text check (char_length(badge_en) <= 24),
  headline_1_en text check (char_length(headline_1_en) <= 40),
  headline_2_en text check (char_length(headline_2_en) <= 40),
  body_en text check (char_length(body_en) <= 120),
  -- An internal path or an https address; the page drops anything else.
  link_url text check (char_length(link_url) <= 300),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index home_hero_banners_order_idx
on public.home_hero_banners (is_active, sort_order, created_at);

create trigger set_home_hero_banners_updated_at
before update on public.home_hero_banners
for each row execute procedure public.set_updated_at();

alter table public.home_hero_banners enable row level security;

-- Public page content: anyone may read what is switched on.
create policy "Home hero banners readable"
on public.home_hero_banners
for select
using (is_active);

create policy "Home hero banners managed by admin"
on public.home_hero_banners
for all
using (public.is_admin())
with check (public.is_admin());

insert into public.home_hero_banners
  (design, badge, headline_1, headline_2, body, headline_1_en, headline_2_en, body_en, link_url, sort_order)
values
  ('record', 'Since 2017', '음반·뮤직비디오 심의,', '이제 더 간편하게', null,
   'Album & MV Reviews,', 'Now Made Simple', null, null, 10),
  ('url', null, '이미 발매된 음원은', 'URL만 입력하면 끝', null,
   'Already released?', 'Just paste the URL', null, '/dashboard/new/album', 20),
  ('certificate', null, '뮤직비디오 유통엔', '심의 필증이 필수', '온라인 심의로 미리 받아두세요',
   'Music videos need a', 'rating certificate', 'Get it ahead with an online review', '/guide/mv-review', 30),
  ('reasons', null, '심의 맡길 곳,', '왜 온사이드일까요', '온사이드를 고르는 이유 보기',
   'Why file your review', 'with Onside?', 'See the reasons', '/about', 40);

-- Seconds each banner stays before the next one comes up (4 to 20).
insert into public.site_settings (key, value, description)
values ('home_hero_carousel', jsonb_build_object('intervalSeconds', 7), '메인 배너 자동 넘김 간격(초)')
on conflict (key) do nothing;
