-- Run against an isolated PostgreSQL/Supabase test database after 0095 only.
-- Requires auth.users, auth.uid(), profiles and Supabase roles. Never run on production.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002'),('10000000-0000-4000-8000-000000000003');
insert into public.profiles(user_id,role) values ('10000000-0000-4000-8000-000000000001','user'),('10000000-0000-4000-8000-000000000002','user'),('10000000-0000-4000-8000-000000000003','admin') on conflict(user_id) do update set role=excluded.role;
do $$
declare
  owner_a uuid='10000000-0000-4000-8000-000000000001'; owner_b uuid='10000000-0000-4000-8000-000000000002';
  library_a uuid='20000000-0000-4000-8000-000000000001'; library_b uuid='20000000-0000-4000-8000-000000000002';
  job_id uuid='30000000-0000-4000-8000-000000000001'; token uuid='40000000-0000-4000-8000-000000000001';
  document jsonb='{"schemaVersion":1,"artist":{"id":"a","name":"Same artist"},"releases":[],"tracks":[],"tasks":[{"id":"task-a"}],"connections":[{"provider":"musicbrainz","externalArtistId":"mbid-a","confirmed":true}]}';
  library public.music_archive_libraries; claimed public.music_archive_jobs; failed boolean; first_wait integer; second_wait integer;
begin
  select * into library from public.create_music_archive_library(library_a,owner_a,document);
  perform public.create_music_archive_library(library_b,owner_b,document);
  if library.version<>1 then raise exception 'initial version invalid'; end if;
  failed=false; begin perform public.save_music_archive_library(library_a,owner_b,1,document,'update_artist',owner_b); exception when sqlstate 'P0002' then failed=true; end;
  if not failed then raise exception 'cross-owner mutation allowed'; end if;
  select * into library from public.save_music_archive_library(library_a,owner_a,1,document,'update_artist',owner_a);
  if library.version<>2 then raise exception 'version not advanced'; end if;
  failed=false; begin perform public.save_music_archive_library(library_a,owner_a,1,document,'update_artist',owner_a); exception when serialization_failure then failed=true; end;
  if not failed then raise exception 'stale update allowed'; end if;
  if (select count(*) from public.music_archive_events where library_id=library_a and action='update_artist')<>1 then raise exception 'atomic audit not exactly once'; end if;
  failed=false; begin perform public.save_music_archive_library(library_a,owner_a,2,document,'update_artist',owner_b); exception when insufficient_privilege then failed=true; end;
  if not failed then raise exception 'forged actor accepted'; end if;
  insert into public.music_archive_jobs(id,owner_id,library_id,external_artist_id,provider) values(job_id,owner_a,library_a,'mbid-a','musicbrainz');
  failed=false; begin insert into public.music_archive_jobs(owner_id,library_id,external_artist_id,provider) values(owner_a,library_a,'mbid-a','musicbrainz'); exception when unique_violation then failed=true; end;
  if not failed then raise exception 'duplicate active job accepted'; end if;
  failed=false; begin insert into public.music_archive_jobs(owner_id,library_id,external_artist_id,provider) values(owner_a,library_b,'mbid-a','musicbrainz'); exception when foreign_key_violation then failed=true; end;
  if not failed then raise exception 'cross-owner background job accepted'; end if;
  select * into claimed from public.lease_music_archive_job(token,library_a);
  if claimed.id<>job_id or claimed.attempts<>1 then raise exception 'job lease failed'; end if;
  if exists(select 1 from public.lease_music_archive_job(gen_random_uuid(),library_a)) then raise exception 'concurrent lease accepted'; end if;
  update public.music_archive_jobs set lease_until=now()-interval '1 second' where id=job_id;
  failed=false; begin perform public.commit_music_archive_step(job_id,token,2,document,'{"offset":10}','{"releases":10}','partial',now()); exception when serialization_failure then failed=true; end;
  if not failed then raise exception 'expired worker committed'; end if;
  select * into claimed from public.lease_music_archive_job(gen_random_uuid(),library_a);
  if claimed.attempts<>2 then raise exception 'restart did not reclaim expired lease'; end if;
  failed=false; begin perform public.commit_music_archive_step(job_id,token,2,document,'{"offset":10}','{"releases":10}','partial',now()); exception when serialization_failure then failed=true; end;
  if not failed then raise exception 'stale token committed'; end if;
  failed=false; begin perform public.commit_music_archive_step(job_id,claimed.lease_token,1,document,'{"offset":10}','{"releases":10}','partial',now()); exception when serialization_failure then failed=true; end;
  if not failed then raise exception 'sync overwrote concurrent user'; end if;
  if (select cursor from public.music_archive_jobs where id=job_id)<>'{}'::jsonb then raise exception 'failed document save advanced cursor'; end if;
  perform public.commit_music_archive_step(job_id,claimed.lease_token,2,document,'{"offset":10}','{"releases":10}','partial',now());
  if (select version from public.music_archive_libraries where id=library_a)<>3 then raise exception 'sync not saved'; end if;
  if (select cursor->>'offset' from public.music_archive_jobs where id=job_id)<>'10' then raise exception 'cursor not committed'; end if;
  if exists(select 1 from public.lease_music_archive_job(gen_random_uuid(),library_a)) then raise exception 'partial job runs without explicit resume'; end if;
  update public.music_archive_jobs set status='queued' where id=job_id;
  select * into claimed from public.lease_music_archive_job(gen_random_uuid(),library_a);
  perform public.save_music_archive_library(library_a,owner_a,3,jsonb_set(document,'{connections}','[]'),'remove_connection',owner_a);
  failed=false; begin perform public.commit_music_archive_step(job_id,claimed.lease_token,4,document,'{"offset":20}','{"releases":20}','completed',now()); exception when serialization_failure then failed=true; end;
  if not failed then raise exception 'removed provider connection restored by worker'; end if;
  insert into public.music_archive_attachments(owner_id,library_id,task_id,object_key,file_name,mime_type,size_bytes)
    values(owner_a,library_a,'task-a','optional-prefix/review-doc-jobs/'||owner_a||'/'||library_a||'/50000000-0000-4000-8000-000000000001','evidence.pdf','application/pdf',100);
  failed=false; begin insert into public.music_archive_attachments(owner_id,library_id,task_id,object_key,file_name,mime_type,size_bytes)
    values(owner_b,library_a,'task-a','review-doc-jobs/'||owner_b||'/'||library_a||'/50000000-0000-4000-8000-000000000002','private.pdf','application/pdf',100); exception when others then failed=true; end;
  if not failed then raise exception 'cross-owner attachment accepted'; end if;
  failed=false; begin insert into public.music_archive_attachments(owner_id,library_id,task_id,object_key,file_name,mime_type,size_bytes)
    values(owner_a,library_a,'missing-task','review-doc-jobs/'||owner_a||'/'||library_a||'/50000000-0000-4000-8000-000000000003','private.pdf','application/pdf',100); exception when others then failed=true; end;
  if not failed then raise exception 'missing task attachment accepted'; end if;
  failed=false; begin insert into public.music_archive_attachments(owner_id,library_id,task_id,object_key,file_name,mime_type,size_bytes)
    values(owner_a,library_a,'task-a','some-other-private-prefix/object','private.pdf','application/pdf',100); exception when others then failed=true; end;
  if not failed then raise exception 'foreign storage prefix accepted'; end if;
  if not exists(select 1 from public.music_archive_events where library_id=library_a and action='attachment_add') then raise exception 'attachment audit missing'; end if;
  first_wait=public.reserve_music_archive_provider_slot('musicbrainz'); second_wait=public.reserve_music_archive_provider_slot('musicbrainz');
  if first_wait<>0 or second_wait<1000 then raise exception 'provider requests not globally spaced'; end if;
  perform public.reserve_music_archive_provider_slot('musicbrainz'); perform public.reserve_music_archive_provider_slot('musicbrainz'); perform public.reserve_music_archive_provider_slot('musicbrainz');
  if public.reserve_music_archive_provider_slot('musicbrainz')<>-1 then raise exception 'unbounded provider waiting room'; end if;
  failed=false; begin perform public.save_music_archive_guide('komca',owner_a,'{"visible":true}'); exception when insufficient_privilege then failed=true; end;
  if not failed then raise exception 'ordinary member changed official guidance'; end if;
  perform public.save_music_archive_guide('komca','10000000-0000-4000-8000-000000000003','{"visible":true}');
  if not exists(select 1 from public.music_archive_events where action='guide_update') then raise exception 'guide audit missing'; end if;
  if has_function_privilege('authenticated','public.save_music_archive_library(uuid,uuid,integer,jsonb,text,uuid,timestamptz,jsonb)','EXECUTE') then raise exception 'member can bypass validated commands'; end if;
  if has_function_privilege('authenticated','public.commit_music_archive_step(uuid,uuid,integer,jsonb,jsonb,jsonb,text,timestamptz)','EXECUTE') then raise exception 'worker write RPC exposed'; end if;
  if has_table_privilege('authenticated','public.music_archive_libraries','UPDATE') or has_table_privilege('authenticated','public.music_archive_attachments','INSERT') then raise exception 'direct private writes allowed'; end if;
  if has_table_privilege('anon','public.music_archive_libraries','SELECT') then raise exception 'anonymous private reads allowed'; end if;
  raise notice 'music archive SQL: owners, versions, audit, duplicate job, leases, checkpoint atomicity, provider change, attachments, rate slots and guides PASS';
end $$;
savepoint library_limits;
do $$
declare document jsonb; failed boolean;
begin
  select data into document from public.music_archive_libraries where id='20000000-0000-4000-8000-000000000002';
  insert into public.music_archive_libraries(owner_id,data) select '10000000-0000-4000-8000-000000000002',document from generate_series(1,29);
  perform public.save_music_archive_library('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',1,document,'archive','10000000-0000-4000-8000-000000000002');
  perform public.create_music_archive_library(gen_random_uuid(),'10000000-0000-4000-8000-000000000002',document);
  failed=false; begin perform public.save_music_archive_library('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',2,document,'restore','10000000-0000-4000-8000-000000000002'); exception when others then failed=sqlerrm='MUSIC_ARCHIVE_LIBRARY_LIMIT'; end;
  if not failed then raise exception 'restore bypassed active library cap'; end if;
  if (select version from public.music_archive_libraries where id='20000000-0000-4000-8000-000000000002')<>2 then raise exception 'failed restore changed version'; end if;
  insert into public.music_archive_libraries(owner_id,data,archived_at) select '10000000-0000-4000-8000-000000000003',document,now() from generate_series(1,300);
  failed=false; begin perform public.create_music_archive_library(gen_random_uuid(),'10000000-0000-4000-8000-000000000003',document); exception when others then failed=sqlerrm='MUSIC_ARCHIVE_TOTAL_LIBRARY_LIMIT'; end;
  if not failed then raise exception 'archived libraries bypass total storage cap'; end if;
  raise notice 'music archive limits: restore respects active30; total archive cap300 PASS';
end $$;
rollback to library_limits;
savepoint bounded_overview;
do $$
declare overview record; document jsonb; releases jsonb; tracks jsonb; jobs jsonb;
begin
  select jsonb_agg(jsonb_build_object('id','release-'||n,'title','release-'||n,'releaseDate',('2026-08-01'::date+n)::text)) into releases from generate_series(1,15) n;
  select jsonb_agg(jsonb_build_object('id','track-'||n,'releaseId','release-'||n,'title','track-'||n,'managed',n<>15)) into tracks from generate_series(1,15) n;
  jobs='[{"id":"old","trackId":"track-1","kind":"review","agency":"KBS","status":"needs_changes","result":"unknown","memo":"private"},{"id":"task-a","trackId":"track-1","kind":"review","agency":"KBS","status":"completed","result":"eligible","memo":"private"},{"id":"pending","trackId":"track-2","kind":"karaoke","agency":"TJ","status":"processing","result":"unknown"}]';
  select data into document from public.music_archive_libraries where id='20000000-0000-4000-8000-000000000001';
  document=jsonb_set(jsonb_set(jsonb_set(document,'{releases}',releases),'{tracks}',tracks),'{tasks}',jobs);
  update public.music_archive_libraries set data=document where id='20000000-0000-4000-8000-000000000001';
  select * into overview from public.list_music_archive_libraries('10000000-0000-4000-8000-000000000001',0,20);
  if jsonb_array_length(overview.data->'releases')<>12 or overview.data->'tracks'<>'[]'::jsonb or overview.data->'tasks'<>'[]'::jsonb then raise exception 'overview full private document transmitted'; end if;
  if overview.data->'releases'->0->>'id'<>'release-15' then raise exception 'recent release order incorrect'; end if;
  if overview.summary->>'releaseCount'<>'15' or overview.summary->>'trackCount'<>'14' then raise exception 'overview managed scope counts incorrect'; end if;
  if overview.summary->>'needsCheck'<>'12' or overview.summary->>'needsChanges'<>'0' or overview.summary->>'inProgress'<>'1' or overview.summary->>'awaitingResult'<>'1' then raise exception 'overview old history or missing scopes counted incorrectly'; end if;
  if exists(select 1 from public.list_music_archive_libraries('10000000-0000-4000-8000-000000000002',0,20) where id='20000000-0000-4000-8000-000000000001') then raise exception 'overview cross-owner leak'; end if;
  if exists(select 1 from public.list_music_archive_libraries('10000000-0000-4000-8000-000000000001',1,20)) then raise exception 'overview offset ignored'; end if;
  if has_function_privilege('authenticated','public.list_music_archive_libraries(uuid,integer,integer)','EXECUTE') then raise exception 'owner-parameter overview RPC public'; end if;
  raise notice 'music archive overview: bounded response, recent order, current history, managed scope and owner isolation PASS';
end $$;
rollback to bounded_overview;
grant usage on schema public,auth to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ begin
  if (select count(*) from public.music_archive_libraries)<>1 then raise exception 'owner A RLS failed'; end if;
  if (select count(*) from public.music_archive_attachments)<>1 then raise exception 'owner A attachment read failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.music_archive_libraries)<>1 then raise exception 'owner B RLS failed'; end if;
  if exists(select 1 from public.music_archive_jobs) or exists(select 1 from public.music_archive_attachments) then raise exception 'other owner private data exposed'; end if;
  if exists(select 1 from public.music_archive_events where owner_id<>'10000000-0000-4000-8000-000000000002') then raise exception 'other owner audit exposed'; end if;
end $$;
reset role;
rollback;
