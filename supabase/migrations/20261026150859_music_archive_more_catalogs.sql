-- Expand the existing owner-scoped durable queue; no new public access is granted.
alter table public.music_archive_sources drop constraint music_archive_sources_provider_check;
alter table public.music_archive_sources add constraint music_archive_sources_provider_check check(provider in ('musicbrainz','apple','melon','genie','spotify'));
alter table public.music_archive_jobs drop constraint music_archive_jobs_provider_check;
alter table public.music_archive_jobs add constraint music_archive_jobs_provider_check check(provider in ('musicbrainz','apple','melon','genie','spotify'));
alter table public.music_archive_provider_limits drop constraint music_archive_provider_limits_provider_check;
alter table public.music_archive_provider_limits add constraint music_archive_provider_limits_provider_check check(provider in ('musicbrainz','apple','melon','genie','spotify','youtube'));

create or replace function public.reserve_music_archive_provider_slot(p_provider text)
returns integer language plpgsql security definer set search_path=public as $$
declare next_slot timestamptz; current_at timestamptz; wait_ms integer;
begin
  if p_provider not in ('musicbrainz','apple','melon','genie','spotify','youtube') or p_provider is null then raise exception 'MUSIC_ARCHIVE_UNSUPPORTED_PROVIDER'; end if;
  insert into public.music_archive_provider_limits(provider) values(p_provider) on conflict(provider) do nothing;
  select next_request_at into next_slot from public.music_archive_provider_limits where provider=p_provider for update;
  current_at=clock_timestamp();
  wait_ms=greatest(0,ceil(extract(epoch from(next_slot-current_at))*1000)::integer);
  if wait_ms>5000 then return -1; end if;
  update public.music_archive_provider_limits set next_request_at=greatest(next_slot,current_at)+case when p_provider='apple' then interval '3100 milliseconds' else interval '1100 milliseconds' end where provider=p_provider;
  return wait_ms;
end $$;
-- The service worker alone may reserve slots; retain the existing privilege boundary.
revoke all on function public.reserve_music_archive_provider_slot(text) from public,anon,authenticated;
grant execute on function public.reserve_music_archive_provider_slot(text) to service_role;
