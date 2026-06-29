update public.ad_banners
set is_active = false
where placement = 'HOME_HERO'
  and image_url in (
    '/media/banners/home-hero/magazine-credit.svg',
    '/media/banners/home-hero/legacy-site.svg'
  );

update public.ad_banners
set is_active = true
where placement = 'HOME_HERO'
  and image_url = '/media/banners/home-hero/album-discount.svg';
