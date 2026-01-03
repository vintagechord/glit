-- Add Backblaze B2 metadata columns to submission_files
alter table if exists public.submission_files
add column if not exists storage_provider text default 'supabase',
add column if not exists object_key text,
add column if not exists status text default 'UPLOADED',
add column if not exists uploaded_at timestamptz;

-- Minimal helper index for admin lookup
create index if not exists submission_files_object_key_idx
  on public.submission_files (object_key);
