insert into public.site_settings (key, value, description)
values (
  'mv_rating_images',
  jsonb_build_object('images', jsonb_build_object()),
  '뮤직비디오 연령등급 이미지 설정'
)
on conflict (key) do nothing;
