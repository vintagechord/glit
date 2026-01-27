-- add mv_certificate_uploaded_at to submissions (nullable)
alter table if exists public.submissions
  add column if not exists mv_certificate_uploaded_at timestamptz;
