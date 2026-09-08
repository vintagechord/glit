-- Isolated database only, after 0095, 0099 and 0100. All fixtures are rolled back.
begin;
insert into auth.users(id) values
  ('11000000-0000-4000-8000-000000000001'),
  ('11000000-0000-4000-8000-000000000002');
insert into public.profiles(user_id,role) values
  ('11000000-0000-4000-8000-000000000001','user'),
  ('11000000-0000-4000-8000-000000000002','user');
do $$
declare
  owner_a uuid='11000000-0000-4000-8000-000000000001';
  owner_b uuid='11000000-0000-4000-8000-000000000002';
  library_a uuid='21000000-0000-4000-8000-000000000001';
  library_b uuid='21000000-0000-4000-8000-000000000002';
  job_a uuid='31000000-0000-4000-8000-000000000001';
  job_b uuid='31000000-0000-4000-8000-000000000002';
  removed_job uuid='31000000-0000-4000-8000-000000000003';
  retained_job uuid='31000000-0000-4000-8000-000000000004';
  first_lease public.music_archive_jobs;
  second_lease public.music_archive_jobs;
  library public.music_archive_libraries;
  failed boolean;
  active_status text;
  document jsonb='{"schemaVersion":1,"artist":{"id":"artist-a","name":"빈티지코드"},"releases":[],"tracks":[],"tasks":[{"id":"private-task","memo":"Preserve owner edits"}],"connections":[{"provider":"apple","externalArtistId":"1259084205","confirmed":true},{"provider":"apple","externalArtistId":"1112117967","confirmed":true}]}';
  first_document jsonb;
  stale_document jsonb;
begin
  perform public.create_music_archive_library(library_a,owner_a,document);
  perform public.create_music_archive_library(library_b,owner_b,document);
  insert into public.music_archive_jobs(id,owner_id,library_id,provider,external_artist_id,created_at)
    values(job_a,owner_a,library_a,'apple','1259084205',now()-interval '2 seconds'),
      (job_b,owner_a,library_a,'apple','1112117967',now()-interval '1 second');
  if (select count(*) from public.music_archive_jobs where library_id=library_a and status='queued')<>2 then
    raise exception 'Distinct profiles at the same provider cannot queue together';
  end if;
  -- Each active state must still prevent a second collection for the identical profile.
  foreach active_status in array array['queued','running','partial','blocked'] loop
    failed=false;
    begin
      insert into public.music_archive_jobs(owner_id,library_id,provider,external_artist_id,status)
        values(owner_a,library_a,'apple','1259084205',active_status);
    exception when unique_violation then failed=true;
    end;
    if not failed then raise exception 'Duplicate profile accepted in state %',active_status; end if;
  end loop;
  -- An external artist ID never authorizes access to another owner's library.
  failed=false;
  begin
    insert into public.music_archive_jobs(owner_id,library_id,provider,external_artist_id)
      values(owner_b,library_a,'apple','9999999999');
  exception when foreign_key_violation then failed=true;
  end;
  if not failed then raise exception 'Cross-owner profile job accepted'; end if;
  insert into public.music_archive_jobs(owner_id,library_id,provider,external_artist_id)
    values(owner_b,library_b,'apple','1259084205');

  select * into first_lease from public.lease_music_archive_job(gen_random_uuid(),library_a);
  select * into second_lease from public.lease_music_archive_job(gen_random_uuid(),library_a);
  if first_lease.id<>job_a or second_lease.id<>job_b then raise exception 'Separate profiles did not receive independent leases'; end if;
  if exists(select 1 from public.lease_music_archive_job(gen_random_uuid(),library_a)) then raise exception 'A third worker reclaimed a live profile lease'; end if;
  first_document=jsonb_set(jsonb_set(document,'{releases}','[{"id":"release-a","title":"Profile A album"}]'),'{tracks}','[{"id":"track-a","releaseId":"release-a"}]');
  stale_document=jsonb_set(jsonb_set(document,'{releases}','[{"id":"release-b","title":"Profile B album"}]'),'{tracks}','[{"id":"track-b","releaseId":"release-b"}]');
  perform public.commit_music_archive_step(job_a,first_lease.lease_token,1,first_document,'{"phase":"done"}','{"releases":1,"tracks":1}','completed',now());
  -- The second worker read the same original version. It must retry from current data.
  failed=false;
  begin
    perform public.commit_music_archive_step(job_b,second_lease.lease_token,1,stale_document,'{"phase":"done"}','{"releases":1,"tracks":1}','completed',now());
  exception when serialization_failure then failed=true;
  end;
  if not failed then raise exception 'Second profile overwrote the first profile using a stale version'; end if;
  if (select cursor from public.music_archive_jobs where id=job_b)<>'{}'::jsonb
    or (select status from public.music_archive_jobs where id=job_b)<>'running' then
    raise exception 'Stale profile commit advanced its checkpoint or released its lease';
  end if;
  select * into library from public.music_archive_libraries where id=library_a;
  document=jsonb_set(jsonb_set(library.data,'{releases}',(library.data->'releases')||(stale_document->'releases')),'{tracks}',(library.data->'tracks')||(stale_document->'tracks'));
  perform public.commit_music_archive_step(job_b,second_lease.lease_token,library.version,document,'{"phase":"done"}','{"releases":1,"tracks":1}','completed',now());
  select * into library from public.music_archive_libraries where id=library_a;
  if library.version<>3 or jsonb_array_length(library.data->'releases')<>2
    or jsonb_array_length(library.data->'tracks')<>2 or jsonb_array_length(library.data->'connections')<>2
    or library.data->'tasks'->0->>'memo'<>'Preserve owner edits' then
    raise exception 'Both profiles, their tracks, or private edits were not preserved';
  end if;
  if (select count(*) from public.music_archive_jobs where library_id=library_a and status='completed')<>2 then
    raise exception 'Both profile checkpoints did not complete';
  end if;
  if (select version from public.music_archive_libraries where id=library_b)<>1
    or (select jsonb_array_length(data->'releases') from public.music_archive_libraries where id=library_b)<>0 then
    raise exception 'Synchronization changed another owner with the same artist profiles';
  end if;

  -- Completed profiles may be collected again. Removing one connection cancels only its authority.
  insert into public.music_archive_jobs(id,owner_id,library_id,provider,external_artist_id,created_at)
    values(removed_job,owner_a,library_a,'apple','1259084205',now()-interval '2 seconds'),
      (retained_job,owner_a,library_a,'apple','1112117967',now()-interval '1 second');
  select * into first_lease from public.lease_music_archive_job(gen_random_uuid(),library_a);
  select * into second_lease from public.lease_music_archive_job(gen_random_uuid(),library_a);
  if first_lease.id<>removed_job or second_lease.id<>retained_job then raise exception 'Recollection leases targeted the wrong profile'; end if;
  document=jsonb_set(library.data,'{connections}','[{"provider":"apple","externalArtistId":"1112117967","confirmed":true}]');
  perform public.save_music_archive_library(library_a,owner_a,3,document,'remove_connection',owner_a);
  failed=false;
  begin
    perform public.commit_music_archive_step(removed_job,first_lease.lease_token,4,library.data,'{"phase":"done"}','{"releases":1}','completed',now());
  exception when serialization_failure then failed=sqlerrm='MUSIC_ARCHIVE_CONNECTION_CHANGED';
  end;
  if not failed then raise exception 'Removed profile committed or restored its connection'; end if;
  if (select version from public.music_archive_libraries where id=library_a)<>4
    or (select cursor from public.music_archive_jobs where id=removed_job)<>'{}'::jsonb then
    raise exception 'Removed profile advanced a private document or checkpoint';
  end if;
  document=jsonb_set(document,'{releases}',(document->'releases')||'[{"id":"release-b2","title":"Another Profile B album"}]'::jsonb);
  perform public.commit_music_archive_step(retained_job,second_lease.lease_token,4,document,'{"phase":"done"}','{"releases":2}','completed',now());
  select * into library from public.music_archive_libraries where id=library_a;
  if library.version<>5 or jsonb_array_length(library.data->'releases')<>3
    or jsonb_array_length(library.data->'connections')<>1
    or library.data->'connections'->0->>'externalArtistId'<>'1112117967' then
    raise exception 'Removing one profile interrupted another or erased previously imported releases';
  end if;
  if (select count(*) from public.music_archive_events where library_id=library_a and action='sync')<>3 then
    raise exception 'Failed profile commits generated document write audits';
  end if;
  raise notice 'Multiple profiles: distinct jobs, duplicate guards, concurrent versions, atomic checkpoints, selective connection removal and owner isolation PASS';
end $$;

grant usage on schema public,auth to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
do $$ begin
  if (select count(*) from public.music_archive_jobs)<>4 then raise exception 'Owner A cannot read all of their profile jobs'; end if;
  if exists(select 1 from public.music_archive_libraries where owner_id<>auth.uid())
    or exists(select 1 from public.music_archive_events where owner_id<>auth.uid()) then
    raise exception 'Multi-profile owner A RLS leaked private records';
  end if;
end $$;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.music_archive_jobs)<>1
    or exists(select 1 from public.music_archive_jobs where owner_id<>auth.uid()) then
    raise exception 'Multi-profile owner B RLS exposed other profile jobs';
  end if;
  if (select jsonb_array_length(data->'releases') from public.music_archive_libraries)<>0 then
    raise exception 'Same artist profile exposed another owner catalog';
  end if;
end $$;
reset role;
rollback;
