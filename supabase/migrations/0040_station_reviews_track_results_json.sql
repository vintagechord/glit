-- Align station_reviews track results column name with application code.
-- If track_results_json exists, leave it as-is.
-- If only track_results exists, rename it.
-- If neither exists, add track_results_json.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'station_reviews'
      and column_name = 'track_results_json'
  ) then
    -- no-op
    null;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'station_reviews'
      and column_name = 'track_results'
  ) then
    alter table public.station_reviews
      rename column track_results to track_results_json;
  else
    alter table public.station_reviews
      add column track_results_json jsonb;
  end if;

  alter table public.station_reviews
    alter column track_results_json set default '[]'::jsonb;

  comment on column public.station_reviews.track_results_json is
    'Array of per-track review results (id/title/no/status).';
end $$;
