insert into public.stations (name, code, is_active)
values
  ('KBS', 'KBS', true),
  ('MBC', 'MBC', true),
  ('SBS', 'SBS', true),
  ('YTN', 'YTN', true),
  ('CBS 기독교방송', 'CBS', true),
  ('WBS 원음방송', 'WBS', true),
  ('TBS 교통방송', 'TBS', true),
  ('PBC 평화방송', 'PBC', true),
  ('BBS 불교방송', 'BBS', true),
  ('Arirang 방송', 'ARIRANG', true),
  ('경인 iFM', 'GYEONGIN_IFM', true),
  ('TBN 한국교통방송', 'TBN', true),
  ('KISS 디지털 라디오 음악방송', 'KISS', true),
  ('극동방송(Only CCM)', 'FEBC', true),
  ('국악방송(Only 국악)', 'GUGAK', true)
on conflict (code) do update
set name = excluded.name,
    is_active = excluded.is_active;

update public.stations
set is_active = false
where code not in (
  'KBS', 'MBC', 'SBS', 'YTN',
  'CBS', 'WBS', 'TBS', 'PBC', 'BBS',
  'ARIRANG', 'GYEONGIN_IFM', 'TBN', 'KISS',
  'FEBC', 'GUGAK'
);

update public.packages set station_count = 7 where name = '7곳 패키지';
update public.packages set station_count = 10 where name = '10곳 패키지';
update public.packages set station_count = 13 where name = '13곳 패키지';

insert into public.packages (name, station_count, price_krw, description, is_active)
values ('15곳 패키지', 15, 150000, '방송국 15곳 심의 접수', true)
on conflict (name) do update
set station_count = excluded.station_count,
    is_active = excluded.is_active;

delete from public.package_stations
where package_id in (
  select id
  from public.packages
  where name in ('7곳 패키지', '10곳 패키지', '13곳 패키지', '15곳 패키지')
);

with package_map as (
  select id, name from public.packages
),
station_map as (
  select id, code from public.stations
)
insert into public.package_stations (package_id, station_id)
select package_map.id, station_map.id
from package_map
join station_map on station_map.code in ('KBS', 'MBC', 'SBS', 'CBS', 'WBS', 'TBS', 'YTN')
where package_map.name = '7곳 패키지';

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
  'KBS', 'MBC', 'SBS', 'TBS', 'CBS', 'WBS', 'PBC', 'BBS', 'YTN', 'ARIRANG'
)
where package_map.name = '10곳 패키지';

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
  'KBS', 'MBC', 'SBS', 'TBS', 'CBS', 'WBS', 'PBC', 'BBS', 'YTN',
  'GYEONGIN_IFM', 'TBN', 'ARIRANG', 'KISS'
)
where package_map.name = '13곳 패키지';

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
  'KBS', 'MBC', 'SBS', 'TBS', 'CBS', 'WBS', 'PBC', 'BBS', 'YTN',
  'GYEONGIN_IFM', 'TBN', 'ARIRANG', 'KISS', 'FEBC', 'GUGAK'
)
where package_map.name = '15곳 패키지';
