-- A member-confirmed artist can have multiple catalog profiles at the same provider.
-- Keep one active collection per exact profile without changing existing jobs or private data.
drop index public.music_archive_jobs_active;
create unique index music_archive_jobs_active
  on public.music_archive_jobs(library_id,provider,external_artist_id)
  where status in ('queued','running','partial','blocked');
