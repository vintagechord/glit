-- Add a documented, keyless metadata catalog. Existing private documents and provider IDs stay intact.
alter table public.music_archive_sources drop constraint music_archive_sources_provider_check;
alter table public.music_archive_sources add constraint music_archive_sources_provider_check check(provider in ('musicbrainz','apple'));
alter table public.music_archive_jobs drop constraint music_archive_jobs_provider_check;
alter table public.music_archive_jobs add constraint music_archive_jobs_provider_check check(provider in ('musicbrainz','apple'));
alter table public.music_archive_provider_limits drop constraint music_archive_provider_limits_provider_check;
alter table public.music_archive_provider_limits add constraint music_archive_provider_limits_provider_check check(provider in ('musicbrainz','apple'));

create or replace function public.reserve_music_archive_provider_slot(p_provider text)
returns integer language plpgsql security definer set search_path=public as $$
declare next_slot timestamptz; current_at timestamptz; wait_ms integer;
begin
  if p_provider not in ('musicbrainz','apple') or p_provider is null then raise exception 'MUSIC_ARCHIVE_UNSUPPORTED_PROVIDER'; end if;
  insert into public.music_archive_provider_limits(provider) values(p_provider) on conflict(provider) do nothing;
  select next_request_at into next_slot from public.music_archive_provider_limits where provider=p_provider for update;
  current_at=clock_timestamp();
  wait_ms=greatest(0,ceil(extract(epoch from(next_slot-current_at))*1000)::integer);
  if wait_ms>5000 then return -1; end if;
  update public.music_archive_provider_limits set next_request_at=greatest(next_slot,current_at)+case when p_provider='apple' then interval '3100 milliseconds' else interval '1100 milliseconds' end where provider=p_provider;
  return wait_ms;
end $$;
revoke all on function public.reserve_music_archive_provider_slot(text) from public,anon,authenticated;
grant execute on function public.reserve_music_archive_provider_slot(text) to service_role;

-- Only actual public catalog candidates are stored here, never member names, files or review records.
create table public.music_archive_artist_index (
  provider text not null check(provider='apple'),
  external_id text not null check(external_id ~ '^[1-9][0-9]{0,19}$'),
  normalized_name text not null check(length(normalized_name)<=500),
  normalized_alias text not null check(length(normalized_alias)<=500),
  initials text not null check(length(initials)<=500),
  alias_initials text not null default '' check(length(alias_initials)<=500),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=10000),
  checked_at timestamptz not null default now(),
  primary key(provider,external_id)
);
create index music_archive_artist_initials on public.music_archive_artist_index(initials text_pattern_ops);
create index music_archive_artist_alias_initials on public.music_archive_artist_index(alias_initials text_pattern_ops);
create index music_archive_artist_name on public.music_archive_artist_index(normalized_name text_pattern_ops);
create index music_archive_artist_alias on public.music_archive_artist_index(normalized_alias text_pattern_ops);
create table public.music_archive_search_cache (
  query_key text primary key check(length(query_key)<=64),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=2097152),
  expires_at timestamptz not null
);
alter table public.music_archive_artist_index enable row level security;
alter table public.music_archive_search_cache enable row level security;
revoke all on public.music_archive_artist_index,public.music_archive_search_cache from public,anon,authenticated;
grant all on public.music_archive_artist_index,public.music_archive_search_cache to service_role;
