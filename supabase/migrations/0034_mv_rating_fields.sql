-- Add MV rating and certificate fields to submissions
alter table public.submissions
  add column if not exists mv_rating varchar(10),
  add column if not exists mv_certificate_object_key text,
  add column if not exists mv_certificate_filename text,
  add column if not exists mv_certificate_mime_type text,
  add column if not exists mv_certificate_size_bytes bigint;
