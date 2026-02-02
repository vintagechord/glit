-- Ensure track_results column exists for per-track review outcomes.
alter table public.station_reviews
  add column if not exists track_results jsonb not null default '[]'::jsonb;

comment on column public.station_reviews.track_results is
  'Array of per-track review results (id/title/no/status). Ensured by migration 0038.';
