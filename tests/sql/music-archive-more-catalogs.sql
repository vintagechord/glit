-- Disposable local test database only. Run after the more_catalogs migration.
begin;
insert into auth.users(id) values ('13000000-0000-4000-8000-000000000001'),('13000000-0000-4000-8000-000000000002');
insert into public.profiles(user_id,role) values ('13000000-0000-4000-8000-000000000001','user'),('13000000-0000-4000-8000-000000000002','user');
insert into public.music_archive_libraries(id,owner_id,data) values
  ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','{"schemaVersion":1,"artist":{"id":"a","name":"Artist A"},"releases":[],"tracks":[],"tasks":[],"connections":[]}'),
  ('23000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000002','{"schemaVersion":1,"artist":{"id":"b","name":"Artist B"},"releases":[],"tracks":[],"tasks":[],"connections":[]}');

do $$
declare relation text; role_name text;
begin
  if not has_function_privilege('service_role','public.reserve_music_archive_provider_slot(text)','EXECUTE') then raise exception 'Service worker cannot reserve provider slots'; end if;
  foreach role_name in array array['anon','authenticated'] loop
    if has_function_privilege(role_name,'public.reserve_music_archive_provider_slot(text)','EXECUTE') then raise exception '% can reserve shared provider slots',role_name; end if;
    foreach relation in array array['music_archive_sources','music_archive_jobs','music_archive_provider_limits'] loop
      if has_table_privilege(role_name,'public.'||relation,'INSERT') or has_table_privilege(role_name,'public.'||relation,'UPDATE') or has_table_privilege(role_name,'public.'||relation,'DELETE') then raise exception '% can write directly to %',role_name,relation; end if;
      if not (select relrowsecurity from pg_class where oid=('public.'||relation)::regclass) then raise exception '% no longer has RLS',relation; end if;
    end loop;
  end loop;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.reserve_music_archive_provider_slot(text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PUBLIC inherited execute on provider slots'; end if;
  if not exists(select 1 from pg_proc where oid='public.reserve_music_archive_provider_slot(text)'::regprocedure and prosecdef and proconfig @> array['search_path=public']) then raise exception 'Slot function execution context changed'; end if;
end $$;

-- Exercise actual execution privileges, not only ACL inspection.
grant usage on schema public,auth to anon,authenticated,service_role;
set local role anon;
do $$ declare rejected boolean=false; begin
  begin perform public.reserve_music_archive_provider_slot('melon'); exception when insufficient_privilege then rejected=true; end;
  if not rejected then raise exception 'Anonymous slot reservation executed'; end if;
end $$;
reset role;
set local role authenticated;
do $$ declare rejected boolean=false; begin
  begin perform public.reserve_music_archive_provider_slot('genie'); exception when insufficient_privilege then rejected=true; end;
  if not rejected then raise exception 'Member slot reservation executed'; end if;
end $$;
reset role;

set local role service_role;
do $$
declare
  provider_name text; rejected boolean; first_wait integer; second_wait integer;
  first_slot timestamptz; next_slot timestamptz; interval_ms integer;
  owner_a uuid='13000000-0000-4000-8000-000000000001'; owner_b uuid='13000000-0000-4000-8000-000000000002';
  library_a uuid='23000000-0000-4000-8000-000000000001'; library_b uuid='23000000-0000-4000-8000-000000000002';
begin
  foreach provider_name in array array['musicbrainz','apple','melon','genie','spotify','youtube'] loop
    first_wait=public.reserve_music_archive_provider_slot(provider_name);
    select next_request_at into first_slot from public.music_archive_provider_limits where provider=provider_name;
    second_wait=public.reserve_music_archive_provider_slot(provider_name);
    select next_request_at into next_slot from public.music_archive_provider_limits where provider=provider_name;
    interval_ms=case when provider_name='apple' then 3100 else 1100 end;
    if first_wait<>0 or second_wait not between 1 and interval_ms or next_slot-first_slot<>interval_ms*interval '1 millisecond' then raise exception '% shared rate spacing changed',provider_name; end if;
    -- A saturated queue must neither extend its reservation nor wait forever.
    update public.music_archive_provider_limits set next_request_at=clock_timestamp()+interval '10 seconds' where provider=provider_name returning next_request_at into first_slot;
    if public.reserve_music_archive_provider_slot(provider_name)<>-1 then raise exception '% did not reject a saturated queue',provider_name; end if;
    if (select next_request_at from public.music_archive_provider_limits where provider=provider_name) is distinct from first_slot then raise exception '% saturated queue advanced its slot',provider_name; end if;
  end loop;
  foreach provider_name in array array['bugs','unknown','',null::text] loop
    rejected=false;
    begin perform public.reserve_music_archive_provider_slot(provider_name); exception when raise_exception then rejected=sqlerrm='MUSIC_ARCHIVE_UNSUPPORTED_PROVIDER'; end;
    if not rejected then raise exception 'Invalid provider slot was accepted: %',provider_name; end if;
  end loop;

  foreach provider_name in array array['musicbrainz','apple','melon','genie','spotify'] loop
    -- Identical provider-local IDs remain distinct in both cache and job queue.
    insert into public.music_archive_sources(provider,external_id,kind,payload) values(provider_name,'shared-id','release','{"title":"Public metadata"}');
    insert into public.music_archive_jobs(owner_id,library_id,provider,external_artist_id) values(owner_a,library_a,provider_name,'shared-id'),(owner_b,library_b,provider_name,'shared-id');
    rejected=false;
    begin insert into public.music_archive_jobs(owner_id,library_id,provider,external_artist_id) values(owner_a,library_a,provider_name,'shared-id'); exception when unique_violation then rejected=true; end;
    if not rejected then raise exception '% duplicate active profile job accepted',provider_name; end if;
    rejected=false;
    begin insert into public.music_archive_jobs(owner_id,library_id,provider,external_artist_id) values(owner_a,library_b,provider_name,'different-id'); exception when foreign_key_violation then rejected=true; end;
    if not rejected then raise exception '% cross-owner profile job accepted',provider_name; end if;
  end loop;
  if (select count(*) from public.music_archive_sources where external_id='shared-id')<>5 then raise exception 'Provider source IDs were conflated'; end if;
  if (select count(*) from public.music_archive_jobs where external_artist_id='shared-id')<>10 then raise exception 'Provider or owner job IDs were conflated'; end if;
  foreach provider_name in array array['youtube','bugs','unknown'] loop
    rejected=false;
    begin insert into public.music_archive_sources(provider,external_id,kind,payload) values(provider_name,'forbidden','release','{}'); exception when check_violation then rejected=true; end;
    if not rejected then raise exception '% was accepted as an album cache provider',provider_name; end if;
    rejected=false;
    begin insert into public.music_archive_jobs(owner_id,library_id,provider,external_artist_id) values(owner_a,library_a,provider_name,'forbidden'); exception when check_violation then rejected=true; end;
    if not rejected then raise exception '% was accepted as an album sync provider',provider_name; end if;
  end loop;
  rejected=false;
  begin insert into public.music_archive_provider_limits(provider) values('unknown'); exception when check_violation then rejected=true; end;
  if not rejected then raise exception 'Unknown throttle row accepted'; end if;
end $$;
reset role;

-- Expanded provider choices must retain owner-filtered job reads.
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
do $$ begin
  if (select count(*) from public.music_archive_jobs)<>5 or exists(select 1 from public.music_archive_jobs where owner_id<>auth.uid()) then raise exception 'Expanded providers leaked another owner jobs'; end if;
  if (select count(*) from public.music_archive_sources where external_id='shared-id')<>5 then raise exception 'Public source metadata became inaccessible to members'; end if;
end $$;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.music_archive_jobs)<>5 or exists(select 1 from public.music_archive_jobs where owner_id<>auth.uid()) then raise exception 'Second owner cannot read only their own provider jobs'; end if;
end $$;
reset role;
do $$ begin raise notice 'Expanded catalogs: provider constraints, source/job separation, owner RLS, service-only slots, bounded global throttling PASS'; end $$;
rollback;
