-- The purge marks purged_at before deleting the stored versions, so a
-- download is never offered for a file that is already gone. If the function
-- stopped between the two (a timeout or a killed instance), the rows stayed
-- marked and were never selected again while the objects stayed in B2.
-- purge_confirmed_at records that the delete finished; a row marked at least
-- 15 minutes ago without it is deleted again by the scheduled storage
-- cleanup. Deleting a key twice removes nothing the second time.
--
-- Like purged_at, the column is outside the list watched by
-- guard_submission_file_edit_state, so paid submissions accept it.
alter table public.submission_files
  add column if not exists purge_confirmed_at timestamptz;

alter table public.submission_supplement_files
  add column if not exists purge_confirmed_at timestamptz;

create index if not exists submission_files_purge_unconfirmed_idx
  on public.submission_files (purged_at)
  where purged_at is not null and purge_confirmed_at is null;

create index if not exists submission_supplement_files_purge_unconfirmed_idx
  on public.submission_supplement_files (purged_at)
  where purged_at is not null and purge_confirmed_at is null;
