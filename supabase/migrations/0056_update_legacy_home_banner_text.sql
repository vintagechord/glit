update public.ad_banners
set
  title = '이전 온사이드도 페이지도 접속가능',
  description = '이전 사이트 사용이 편하시면 구버전에서 신청 가능합니다.'
where placement = 'HOME_HERO'
  and image_url = '/media/banners/home-hero/legacy-site.svg';
