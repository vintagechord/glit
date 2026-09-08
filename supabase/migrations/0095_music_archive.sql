-- Optional member archive. This migration does not alter orders, payments or review results.
create table public.music_archive_libraries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  version integer not null default 1 check(version>0),
  data jsonb not null check(jsonb_typeof(data)='object' and data->>'schemaVersion'='1' and jsonb_typeof(data->'artist')='object' and jsonb_typeof(data->'tracks')='array' and jsonb_typeof(data->'releases')='array' and octet_length(data::text)<=16777216),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,owner_id)
);
create index music_archive_libraries_owner on public.music_archive_libraries(owner_id,updated_at desc);

-- Only the licensed CC0 MusicBrainz core subset is cached. Private owner records never enter this table.
create table public.music_archive_sources (
  provider text not null check(provider='musicbrainz'),
  external_id text not null check(length(external_id) between 1 and 256),
  kind text not null check(kind in ('artist','release','track','recording','work')),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=2097152),
  checked_at timestamptz not null default now(),
  primary key(provider,external_id,kind)
);
create table public.music_archive_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  library_id uuid not null,
  provider text not null check(provider='musicbrainz'),
  external_artist_id text not null check(length(external_artist_id) between 1 and 256),
  status text not null default 'queued' check(status in ('queued','running','partial','completed','blocked','failed','cancelled')),
  cursor jsonb not null default '{}' check(jsonb_typeof(cursor)='object' and octet_length(cursor::text)<=2097152),
  counts jsonb not null default '{}' check(jsonb_typeof(counts)='object'),
  error_code text check(length(error_code)<=100), error_message text check(length(error_message)<=2000),
  attempts integer not null default 0 check(attempts>=0),
  available_at timestamptz not null default now(),
  lease_token uuid, lease_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), checked_at timestamptz,
  foreign key(library_id,owner_id) references public.music_archive_libraries(id,owner_id)
);
create unique index music_archive_jobs_active on public.music_archive_jobs(library_id,provider) where status in ('queued','running','partial','blocked');
create index music_archive_jobs_queue on public.music_archive_jobs(available_at,created_at) where status in ('queued','running');
create index music_archive_jobs_owner on public.music_archive_jobs(owner_id,library_id,created_at desc);
create table public.music_archive_events (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id), library_id uuid references public.music_archive_libraries(id),
  actor_id uuid references auth.users(id),
  action text not null check(length(action) between 1 and 100),
  before_version integer, after_version integer,
  details jsonb not null default '{}' check(jsonb_typeof(details)='object' and octet_length(details::text)<=262144),
  created_at timestamptz not null default now()
);
create index music_archive_events_library on public.music_archive_events(library_id,created_at desc);
create table public.music_archive_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id), library_id uuid not null,
  task_id text not null check(length(task_id) between 1 and 256),
  object_key text not null unique check(length(object_key) between 1 and 1024),
  file_name text not null check(length(file_name) between 1 and 255),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check(size_bytes>0 and size_bytes<=10485760),
  created_at timestamptz not null default now(), deleted_at timestamptz,
  foreign key(library_id,owner_id) references public.music_archive_libraries(id,owner_id)
);
create index music_archive_attachments_library on public.music_archive_attachments(owner_id,library_id);
create table public.music_archive_guide_overrides (
  id text primary key check(length(id) between 1 and 100),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=30000),
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table public.music_archive_provider_limits (
  provider text primary key check(provider='musicbrainz'),
  next_request_at timestamptz not null default now()
);

alter table public.music_archive_libraries enable row level security;
alter table public.music_archive_sources enable row level security;
alter table public.music_archive_jobs enable row level security;
alter table public.music_archive_events enable row level security;
alter table public.music_archive_attachments enable row level security;
alter table public.music_archive_guide_overrides enable row level security;
alter table public.music_archive_provider_limits enable row level security;
revoke all on public.music_archive_libraries,public.music_archive_sources,public.music_archive_jobs,public.music_archive_events,public.music_archive_attachments,public.music_archive_guide_overrides,public.music_archive_provider_limits from public,anon,authenticated;
grant select on public.music_archive_libraries,public.music_archive_sources,public.music_archive_jobs,public.music_archive_events,public.music_archive_attachments,public.music_archive_guide_overrides to authenticated;
grant all on public.music_archive_libraries,public.music_archive_sources,public.music_archive_jobs,public.music_archive_events,public.music_archive_attachments,public.music_archive_guide_overrides,public.music_archive_provider_limits to service_role;
grant usage,select on sequence public.music_archive_events_id_seq to service_role;
create policy music_archive_libraries_owner_read on public.music_archive_libraries for select to authenticated using(owner_id=auth.uid());
create policy music_archive_jobs_owner_read on public.music_archive_jobs for select to authenticated using(owner_id=auth.uid());
create policy music_archive_events_owner_read on public.music_archive_events for select to authenticated using(owner_id=auth.uid());
create policy music_archive_attachments_owner_read on public.music_archive_attachments for select to authenticated using(owner_id=auth.uid() and deleted_at is null);
create policy music_archive_sources_read on public.music_archive_sources for select to authenticated using(true);
create policy music_archive_guides_read on public.music_archive_guide_overrides for select to authenticated using(true);

create function public.create_music_archive_library(p_id uuid,p_owner uuid,p_data jsonb)
returns public.music_archive_libraries language plpgsql security definer set search_path=public as $$
declare result public.music_archive_libraries;
begin
  perform pg_advisory_xact_lock(hashtextextended('music-archive-owner:'||p_owner::text,0));
  if (select count(*) from public.music_archive_libraries where owner_id=p_owner and archived_at is null)>=30 then raise exception 'MUSIC_ARCHIVE_LIBRARY_LIMIT'; end if;
  if (select count(*) from public.music_archive_libraries where owner_id=p_owner)>=300 then raise exception 'MUSIC_ARCHIVE_TOTAL_LIBRARY_LIMIT'; end if;
  insert into public.music_archive_libraries(id,owner_id,data) values(p_id,p_owner,p_data) returning * into result;
  insert into public.music_archive_events(owner_id,library_id,actor_id,action,after_version,details) values(p_owner,p_id,p_owner,'create',1,jsonb_build_object('artist',p_data->'artist'));
  return result;
end $$;

create function public.save_music_archive_library(p_id uuid,p_owner uuid,p_version integer,p_data jsonb,p_action text,p_actor uuid default null,p_archived_at timestamptz default null,p_details jsonb default '{}')
returns public.music_archive_libraries language plpgsql security definer set search_path=public as $$
declare result public.music_archive_libraries;
begin
  perform pg_advisory_xact_lock(hashtextextended('music-archive-owner:'||p_owner::text,0));
  select * into result from public.music_archive_libraries where id=p_id and owner_id=p_owner for update;
  if not found then raise exception 'MUSIC_ARCHIVE_NOT_FOUND' using errcode='P0002'; end if;
  if result.version<>p_version then raise exception 'MUSIC_ARCHIVE_VERSION_CONFLICT' using errcode='40001'; end if;
  if p_action='restore' and result.archived_at is not null and (select count(*) from public.music_archive_libraries where owner_id=p_owner and archived_at is null)>=30 then raise exception 'MUSIC_ARCHIVE_LIBRARY_LIMIT'; end if;
  if p_actor is not null and p_actor<>p_owner and not exists(select 1 from public.profiles where user_id=p_actor and role='admin') then raise exception 'MUSIC_ARCHIVE_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  update public.music_archive_libraries set data=p_data,version=version+1,updated_at=now(),
    archived_at=case when p_action='archive' then coalesce(p_archived_at,now()) when p_action='restore' then null else archived_at end
    where id=p_id returning * into result;
  insert into public.music_archive_events(owner_id,library_id,actor_id,action,before_version,after_version,details)
    values(p_owner,p_id,p_actor,p_action,p_version,result.version,coalesce(p_details,'{}'::jsonb));
  return result;
end $$;

create function public.lease_music_archive_job(p_lease_token uuid,p_library_id uuid default null)
returns setof public.music_archive_jobs language plpgsql security definer set search_path=public as $$
begin
  if p_lease_token is null then raise exception 'MUSIC_ARCHIVE_LEASE_TOKEN_REQUIRED'; end if;
  return query update public.music_archive_jobs set status='running',lease_token=p_lease_token,lease_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now()
  where id=(select j.id from public.music_archive_jobs j join public.music_archive_libraries l on l.id=j.library_id
    where l.archived_at is null and (p_library_id is null or j.library_id=p_library_id)
    and ((j.status='queued' and j.available_at<=now()) or (j.status='running' and j.lease_until<now()))
    order by j.available_at,j.created_at for update of j skip locked limit 1)
  returning *;
end $$;

-- Reserve globally spaced slots across search requests and all worker processes.
-- -1 means the bounded five-second waiting room is full; caller must retry later.
create function public.reserve_music_archive_provider_slot(p_provider text)
returns integer language plpgsql security definer set search_path=public as $$
declare next_slot timestamptz; current_at timestamptz; wait_ms integer;
begin
  if p_provider<>'musicbrainz' then raise exception 'MUSIC_ARCHIVE_UNSUPPORTED_PROVIDER'; end if;
  insert into public.music_archive_provider_limits(provider) values(p_provider) on conflict(provider) do nothing;
  select next_request_at into next_slot from public.music_archive_provider_limits where provider=p_provider for update;
  current_at=clock_timestamp();
  wait_ms=greatest(0,ceil(extract(epoch from(next_slot-current_at))*1000)::integer);
  if wait_ms>5000 then return -1; end if;
  update public.music_archive_provider_limits set next_request_at=greatest(next_slot,current_at)+interval '1100 milliseconds' where provider=p_provider;
  return wait_ms;
end $$;

create function public.save_music_archive_guide(p_id text,p_actor uuid,p_payload jsonb)
returns public.music_archive_guide_overrides language plpgsql security definer set search_path=public as $$
declare result public.music_archive_guide_overrides;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor and role='admin') then raise exception 'MUSIC_ARCHIVE_ADMIN_REQUIRED' using errcode='42501'; end if;
  insert into public.music_archive_guide_overrides(id,payload,updated_by) values(p_id,p_payload,p_actor)
    on conflict(id) do update set payload=excluded.payload,updated_by=excluded.updated_by,updated_at=now() returning * into result;
  insert into public.music_archive_events(actor_id,action,details) values(p_actor,'guide_update',jsonb_build_object('guideId',p_id,'payload',p_payload));
  return result;
end $$;

create function public.audit_music_archive_job() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' or old.status is distinct from new.status or old.error_code is distinct from new.error_code then
    insert into public.music_archive_events(owner_id,library_id,action,details)
      values(new.owner_id,new.library_id,'sync_status',jsonb_build_object('jobId',new.id,'status',new.status,'errorCode',new.error_code,'counts',new.counts));
  end if;
  return new;
end $$;
create trigger music_archive_job_audit after insert or update on public.music_archive_jobs for each row execute function public.audit_music_archive_job();

create function public.guard_music_archive_attachment() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('music-archive-evidence:'||new.owner_id::text,0));
    if (select count(*) from public.music_archive_attachments where owner_id=new.owner_id and deleted_at is null)>=100 then raise exception 'MUSIC_ARCHIVE_ATTACHMENT_LIMIT'; end if;
  end if;
  if not exists(select 1 from public.music_archive_libraries l cross join lateral jsonb_array_elements(l.data->'tasks') t
    where l.id=new.library_id and l.owner_id=new.owner_id and t->>'id'=new.task_id) then raise exception 'MUSIC_ARCHIVE_ATTACHMENT_TARGET_NOT_FOUND'; end if;
  if new.object_key !~ ('(^|/)review-doc-jobs/'||new.owner_id::text||'/'||new.library_id::text||'/[a-f0-9-]{36}$') then raise exception 'MUSIC_ARCHIVE_ATTACHMENT_KEY_FORBIDDEN'; end if;
  return new;
end $$;
create trigger music_archive_attachment_guard before insert or update on public.music_archive_attachments for each row execute function public.guard_music_archive_attachment();

revoke all on function public.create_music_archive_library(uuid,uuid,jsonb),public.save_music_archive_library(uuid,uuid,integer,jsonb,text,uuid,timestamptz,jsonb),public.lease_music_archive_job(uuid,uuid),public.reserve_music_archive_provider_slot(text),public.save_music_archive_guide(text,uuid,jsonb),public.audit_music_archive_job(),public.guard_music_archive_attachment() from public,anon,authenticated;
grant execute on function public.create_music_archive_library(uuid,uuid,jsonb),public.save_music_archive_library(uuid,uuid,integer,jsonb,text,uuid,timestamptz,jsonb),public.lease_music_archive_job(uuid,uuid),public.reserve_music_archive_provider_slot(text),public.save_music_archive_guide(text,uuid,jsonb) to service_role;

-- The document and cursor checkpoint commit together. An expired/stolen lease cannot write.
create function public.commit_music_archive_step(p_job uuid,p_token uuid,p_version integer,p_data jsonb,p_cursor jsonb,p_counts jsonb,p_status text,p_checked_at timestamptz)
returns public.music_archive_jobs language plpgsql security definer set search_path=public as $$
declare job public.music_archive_jobs; library public.music_archive_libraries;
begin
  select * into job from public.music_archive_jobs where id=p_job for update;
  if not found or job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=clock_timestamp() then raise exception 'MUSIC_ARCHIVE_LEASE_LOST' using errcode='40001'; end if;
  if p_status not in ('queued','partial','completed') then raise exception 'MUSIC_ARCHIVE_INVALID_STEP_STATUS'; end if;
  -- Match normal save lock ordering: owner first, then library.
  perform pg_advisory_xact_lock(hashtextextended('music-archive-owner:'||job.owner_id::text,0));
  select * into library from public.music_archive_libraries where id=job.library_id and owner_id=job.owner_id for update;
  if not found or library.archived_at is not null then raise exception 'MUSIC_ARCHIVE_NOT_FOUND' using errcode='P0002'; end if;
  if not exists(select 1 from jsonb_array_elements(library.data->'connections') c where c->>'provider'=job.provider and c->>'externalArtistId'=job.external_artist_id and c->>'confirmed'='true') then raise exception 'MUSIC_ARCHIVE_CONNECTION_CHANGED' using errcode='40001'; end if;
  perform public.save_music_archive_library(library.id,job.owner_id,p_version,p_data,'sync',null,null,jsonb_build_object('jobId',job.id,'counts',p_counts,'conflicts',jsonb_array_length(coalesce(p_data->'conflicts','[]'::jsonb))));
  update public.music_archive_jobs set cursor=p_cursor,counts=p_counts,status=p_status,checked_at=p_checked_at,
    lease_token=null,lease_until=null,available_at=now(),updated_at=now(),error_code=null,error_message=null where id=p_job returning * into job;
  return job;
end $$;

create function public.audit_music_archive_attachment() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    insert into public.music_archive_events(owner_id,library_id,actor_id,action,details)
      values(old.owner_id,old.library_id,old.owner_id,'attachment_delete',jsonb_build_object('attachmentId',old.id,'taskId',old.task_id));
    return old;
  end if;
  insert into public.music_archive_events(owner_id,library_id,actor_id,action,details)
    values(new.owner_id,new.library_id,new.owner_id,case when tg_op='INSERT' then 'attachment_add' else 'attachment_update' end,jsonb_build_object('attachmentId',new.id,'taskId',new.task_id));
  return new;
end $$;
create trigger music_archive_attachment_audit after insert or update or delete on public.music_archive_attachments for each row execute function public.audit_music_archive_attachment();
revoke all on function public.commit_music_archive_step(uuid,uuid,integer,jsonb,jsonb,jsonb,text,timestamptz),public.audit_music_archive_attachment() from public,anon,authenticated;
grant execute on function public.commit_music_archive_step(uuid,uuid,integer,jsonb,jsonb,jsonb,text,timestamptz) to service_role;

-- Overview payload is bounded; full owner documents are loaded only on artist detail.
create function public.list_music_archive_libraries(p_owner uuid,p_offset integer default 0,p_limit integer default 20)
returns table(id uuid,owner_id uuid,version integer,data jsonb,archived_at timestamptz,created_at timestamptz,updated_at timestamptz,summary jsonb)
language sql stable security definer set search_path=public as $$
  with selected as (
    select l.* from public.music_archive_libraries l where l.owner_id=p_owner
    order by l.updated_at desc,l.id limit least(greatest(p_limit,1),20) offset greatest(p_offset,0)
  )
  select l.id,l.owner_id,l.version,
    jsonb_build_object('schemaVersion',1,'artist',l.data->'artist','releases',coalesce(recent.releases,'[]'::jsonb),
      'tracks','[]'::jsonb,'recordings','[]'::jsonb,'works','[]'::jsonb,'tasks','[]'::jsonb,'reviewLinks','[]'::jsonb,
      'connections','[]'::jsonb,'affiliations','[]'::jsonb,'conflicts','[]'::jsonb),
    l.archived_at,l.created_at,l.updated_at,
    jsonb_build_object('releaseCount',metrics.release_count,'trackCount',metrics.track_count,'needsCheck',metrics.needs_check,
      'inProgress',metrics.in_progress,'needsChanges',metrics.needs_changes,'awaitingResult',metrics.awaiting_result)
  from selected l
  cross join lateral (
    select jsonb_agg(r.item order by r.item->>'releaseDate' desc nulls last,r.item->>'id') as releases
    from (select item from jsonb_array_elements(l.data->'releases') item where coalesce(item->>'excluded','false')<>'true' and item->>'mergedInto' is null
      order by item->>'releaseDate' desc nulls last,item->>'id' limit 12) r
  ) recent
  cross join lateral (
    with active_releases as materialized (
      select r->>'id' as release_id from jsonb_array_elements(l.data->'releases') r
      where coalesce(r->>'excluded','false')<>'true' and r->>'mergedInto' is null
    ), active_tracks as materialized (
      select t->>'id' as track_id from jsonb_array_elements(l.data->'tracks') t
      where coalesce(t->>'managed','true')='true' and coalesce(t->>'excluded','false')<>'true' and t->>'mergedInto' is null
        and t->>'releaseId' in(select release_id from active_releases)
    ), latest_tasks as materialized (
      select distinct on(t.item->>'trackId',t.item->>'kind',t.item->>'agency',coalesce(t.item->>'participant',''),coalesce(t.item->>'role',''),coalesce(t.item->>'recordingId',''),coalesce(t.item->>'workId','')) t.item
      from jsonb_array_elements(coalesce(l.data->'tasks','[]'::jsonb)) with ordinality as t(item,position)
      where t.item->>'trackId' in(select track_id from active_tracks)
      order by t.item->>'trackId',t.item->>'kind',t.item->>'agency',coalesce(t.item->>'participant',''),coalesce(t.item->>'role',''),coalesce(t.item->>'recordingId',''),coalesce(t.item->>'workId',''),t.position desc
    )
    select
      (select count(*) from active_releases) as release_count,
      (select count(*) from active_tracks) as track_count,
      (select count(*) from latest_tasks where item->>'status'='needs_check')+(select count(*) from active_tracks a where not exists(select 1 from latest_tasks t where t.item->>'trackId'=a.track_id)) as needs_check,
      (select count(*) from latest_tasks where item->>'status' in ('preparing','submitted','processing')) as in_progress,
      (select count(*) from latest_tasks where item->>'status'='needs_changes') as needs_changes,
      (select count(*) from latest_tasks where item->>'status' in ('submitted','processing') and coalesce(item->>'result','unknown')='unknown') as awaiting_result
  ) metrics;
$$;
revoke all on function public.list_music_archive_libraries(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.list_music_archive_libraries(uuid,integer,integer) to service_role;
