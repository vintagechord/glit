-- Some long-lived environments recorded migration 0027 before all three
-- optional upload metadata columns were present. Keep this repair idempotent
-- so the atomic submission-save function from 0083 compiles and runs against
-- both fresh and drifted databases.
alter table if exists public.submission_files
  add column if not exists checksum text,
  add column if not exists duration_seconds numeric,
  add column if not exists access_url text;
