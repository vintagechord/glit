insert into public.stations (name, code, is_active)
values
  ('KBS', 'KBS', true),
  ('MBC', 'MBC', true),
  ('SBS', 'SBS', true),
  ('EBS', 'EBS', true),
  ('KBS Joy', 'KBS_JOY', true),
  ('KBS2', 'KBS2', true),
  ('Mnet', 'MNET', true),
  ('tvN', 'TVN', true),
  ('JTBC', 'JTBC', true),
  ('Channel A', 'CHANNELA', true),
  ('MBN', 'MBN', true),
  ('YTN', 'YTN', true),
  ('SBS Plus', 'SBS_PLUS', true),
  ('MBC Music', 'MBC_MUSIC', true),
  ('KBS World', 'KBS_WORLD', true)
on conflict (code) do nothing;

insert into public.packages (name, station_count, price_krw, description, is_active)
values
  ('7곳 패키지', 7, 220000, '핵심 방송국 7곳 심의 접수', true),
  ('10곳 패키지', 10, 300000, '주요 방송국 + 케이블 채널 포함', true),
  ('13곳 패키지', 13, 380000, '대형 방송국 전체 커버', true),
  ('15곳 패키지', 15, 450000, '프리미엄 전체 방송국 패키지', true)
on conflict (name) do nothing;

with package_map as (
  select id, name from public.packages
),
station_map as (
  select id, code from public.stations
)
insert into public.package_stations (package_id, station_id)
select package_map.id, station_map.id
from package_map
join station_map on station_map.code in ('KBS', 'MBC', 'SBS', 'EBS', 'KBS2', 'MNET', 'JTBC')
where package_map.name = '7곳 패키지'
on conflict do nothing;

with package_map as (
  select id, name from public.packages
),
station_map as (
  select id, code from public.stations
)
insert into public.package_stations (package_id, station_id)
select package_map.id, station_map.id
from package_map
join station_map on station_map.code in (
  'KBS', 'MBC', 'SBS', 'EBS', 'KBS2', 'MNET', 'JTBC', 'TVN', 'MBN', 'CHANNELA'
)
where package_map.name = '10곳 패키지'
on conflict do nothing;

with package_map as (
  select id, name from public.packages
),
station_map as (
  select id, code from public.stations
)
insert into public.package_stations (package_id, station_id)
select package_map.id, station_map.id
from package_map
join station_map on station_map.code in (
  'KBS', 'MBC', 'SBS', 'EBS', 'KBS2', 'MNET', 'JTBC', 'TVN', 'MBN', 'CHANNELA',
  'YTN', 'SBS_PLUS', 'MBC_MUSIC'
)
where package_map.name = '13곳 패키지'
on conflict do nothing;

with package_map as (
  select id, name from public.packages
),
station_map as (
  select id, code from public.stations
)
insert into public.package_stations (package_id, station_id)
select package_map.id, station_map.id
from package_map
join station_map on station_map.code in (
  'KBS', 'MBC', 'SBS', 'EBS', 'KBS2', 'MNET', 'JTBC', 'TVN', 'MBN', 'CHANNELA',
  'YTN', 'SBS_PLUS', 'MBC_MUSIC', 'KBS_JOY', 'KBS_WORLD'
)
where package_map.name = '15곳 패키지'
on conflict do nothing;
