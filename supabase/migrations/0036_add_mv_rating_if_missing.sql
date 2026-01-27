-- Ensure mv_rating column exists for submissions
alter table if exists public.submissions
  add column if not exists mv_rating varchar(10);
