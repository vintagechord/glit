-- Admin-only directory: compact metadata plus member identity, never full archives.
create or replace view public.music_archive_admin_libraries
with (security_invoker = true) as
select library.id, library.owner_id, library.version,
  library.data->'artist'->>'name' as artist_name,
  jsonb_array_length(coalesce(library.data->'releases', '[]'::jsonb)) as release_count,
  jsonb_array_length(coalesce(library.data->'tracks', '[]'::jsonb)) as track_count,
  library.archived_at, library.updated_at,
  coalesce(profile.name, '') as member_name,
  coalesce(profile.company, '') as member_company
from public.music_archive_libraries library
left join public.profiles profile on profile.user_id = library.owner_id;
revoke all on public.music_archive_admin_libraries from public, anon, authenticated;
grant select on public.music_archive_admin_libraries to service_role;
grant select (user_id, name, company) on public.profiles to service_role;
create index if not exists music_archive_admin_active_updated
  on public.music_archive_libraries (updated_at desc, id) where archived_at is null;
