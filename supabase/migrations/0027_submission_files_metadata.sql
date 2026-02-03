-- Add optional metadata for large uploads
alter table if exists public.submission_files
add column if not exists checksum text,
add column if not exists duration_seconds numeric,
add column if not exists access_url text;
