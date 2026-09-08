-- Small admin-only listing without transferring members' full private documents.
create or replace view public.music_archive_admin_libraries
with (security_invoker = true) as
select id, owner_id, version,
  data->'artist'->>'name' as artist_name,
  jsonb_array_length(coalesce(data->'releases', '[]'::jsonb)) as release_count,
  jsonb_array_length(coalesce(data->'tracks', '[]'::jsonb)) as track_count,
  archived_at, updated_at
from public.music_archive_libraries;

revoke all on public.music_archive_admin_libraries from public, anon, authenticated;
grant select on public.music_archive_admin_libraries to service_role;
