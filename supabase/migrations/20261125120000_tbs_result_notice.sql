-- 2026-11-25 (owner): TBS stopped announcing review results over the Seoul
-- city budget and only accepts applications. The note shows on the TBS row of
-- the customer status page and of the 심의 현황 mail while TBS has no result
-- (src/lib/station-result-notices.ts). The administrator turns it off under
-- 패키지/방송국 설정 → 방송국 결과 안내 once TBS announces results again.
insert into public.site_settings (key, value, description)
values (
  'station_result_notices',
  jsonb_build_object(
    'notices',
    jsonb_build_object(
      'TBS',
      '서울시 예산 문제로 TBS의 심의 결과 안내가 멈춰 있어, 현재는 접수만 진행되고 있습니다.'
    )
  ),
  '방송국별 결과 안내 문구(결과가 없는 방송국 행에만 표시)'
)
on conflict (key) do nothing;
