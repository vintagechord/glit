-- MV options are priced and persisted as station reviews by their canonical
-- station code. Keep these rows outside album package mappings: they are only
-- selectable from the MV workflow.
insert into public.stations (name, code, is_active)
values
  ('ETN 연예TV', 'ETN', true),
  ('Mnet', 'MNET', true)
on conflict (code) do update
set name = excluded.name,
    is_active = excluded.is_active;
