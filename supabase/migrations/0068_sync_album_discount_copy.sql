update public.site_settings
set description = '음반 심의 전체 패키지 공통 할인율(%)'
where key = 'album_review_discount_percent';

update public.ad_banners
set title = '리뉴얼 기념 음반심의 30% 할인'
where title in (
  '리오픈 기념 음반심의 50% 할인',
  '리오픈 기념 음반심의 30% 할인',
  '리뉴얼 기념 음반심의 50% 할인'
);
