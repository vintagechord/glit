-- Certificate metadata for submissions
alter table if exists public.submissions
  add column if not exists certificate_b2_path text,
  add column if not exists certificate_original_name text,
  add column if not exists certificate_mime text,
  add column if not exists certificate_size bigint,
  add column if not exists certificate_uploaded_at timestamptz;
