alter table public.ad_banners
  add column if not exists placement text not null default 'STRIP',
  add column if not exists description text,
  add column if not exists sort_order integer not null default 0;

create index if not exists ad_banners_placement_active_sort_idx
on public.ad_banners (placement, is_active, sort_order, created_at desc);

insert into public.ad_banners (
  title,
  description,
  image_url,
  link_url,
  placement,
  sort_order,
  is_active
)
select
  '리뉴얼 기념 음반심의 50% 할인',
  '할인 금액으로 바로 접수하세요.',
  '/media/banners/home-hero/album-discount.svg',
  '/dashboard/new/album',
  'HOME_HERO',
  10,
  true
where not exists (
  select 1 from public.ad_banners
  where placement = 'HOME_HERO'
    and title = '리뉴얼 기념 음반심의 50% 할인'
);

insert into public.ad_banners (
  title,
  description,
  image_url,
  link_url,
  placement,
  sort_order,
  is_active
)
select
  '심의 1건당 매거진 1크레딧',
  '워터멜론 매거진 발행 요청에 사용할 수 있어요.',
  '/media/banners/home-hero/magazine-credit.svg',
  '/magazine',
  'HOME_HERO',
  20,
  false
where not exists (
  select 1 from public.ad_banners
  where placement = 'HOME_HERO'
    and title = '심의 1건당 매거진 1크레딧'
);

insert into public.ad_banners (
  title,
  description,
  image_url,
  link_url,
  placement,
  sort_order,
  is_active
)
select
  '이전 온사이드도 페이지도 접속가능',
  '이전 사이트 사용이 편하시면 구버전에서 신청 가능합니다.',
  '/media/banners/home-hero/legacy-site.svg',
  'https://onside17.com/',
  'HOME_HERO',
  30,
  false
where not exists (
  select 1 from public.ad_banners
  where placement = 'HOME_HERO'
    and title = '이전 온사이드도 페이지도 접속가능'
);
