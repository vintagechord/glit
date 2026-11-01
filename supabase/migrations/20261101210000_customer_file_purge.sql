-- Administrators delete customer uploads once a review has finished, to free
-- B2 storage. The rows stay as the record of what was submitted; purged_at
-- marks that the stored object is gone and downloads must stop.
--
-- purged_at is deliberately outside the column list watched by
-- guard_submission_file_edit_state, so a paid submission accepts the marker
-- while its file metadata stays locked.
alter table public.submission_files
  add column if not exists purged_at timestamptz;

alter table public.submission_supplement_files
  add column if not exists purged_at timestamptz;
