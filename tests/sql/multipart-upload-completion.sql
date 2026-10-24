-- Run only through scripts/multipart-upload-completion-sql-test.sh in its
-- disposable, network-isolated PostgreSQL. All IDs and files are fixtures.
do $$
declare rpc regprocedure := 'public.claim_multipart_upload_completion(uuid,uuid,text,text,text,integer[],text)'::regprocedure;
begin
  if (select prosecdef from pg_proc where oid=rpc)
    or not (select relrowsecurity from pg_class where oid='public.multipart_upload_grants'::regclass)
    or has_function_privilege('anon',rpc,'EXECUTE')
    or has_function_privilege('authenticated',rpc,'EXECUTE')
    or not has_function_privilege('service_role',rpc,'EXECUTE')
    or has_table_privilege('anon','public.multipart_upload_grants','SELECT')
    or has_table_privilege('authenticated','public.multipart_upload_grants','UPDATE')
    then raise exception 'Multipart receipt privileges or RLS changed'; end if;
end $$;

set role anon;
do $$ begin
  begin
    perform public.claim_multipart_upload_completion(null,null,null,null,null,null,null);
    raise exception 'Expected anonymous RPC denial';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.multipart_upload_grants limit 0;
    raise exception 'Expected anonymous table denial';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
-- A JWT claim string cannot grant the database role's EXECUTE privilege.
set request.jwt.claim.role = 'service_role';
do $$ begin
  begin
    perform public.claim_multipart_upload_completion(null,null,null,null,null,null,null);
    raise exception 'Expected authenticated RPC denial';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.multipart_upload_grants limit 0;
    raise exception 'Expected authenticated table denial';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
reset request.jwt.claim.role;

insert into public.submissions(id,user_id,payment_status,payment_method,title)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','UNPAID','CARD','Multipart SQL fixture: preserve original');
insert into public.submission_files(submission_id,file_path,original_name)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','fixture/original.wav','original.wav');
insert into public.multipart_upload_grants(
  id,submission_id,owner_key,upload_id,object_key,original_name,mime_type,upload_kind,
  declared_size_bytes,part_size_bytes,part_count,created_at,expires_at
)
select ('44444444-4444-4444-8444-'||lpad(n::text,12,'0'))::uuid,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd','user:11111111-1111-4111-8111-111111111111',
  'manifest-sql-'||n,'fixture/manifest/'||n||'.wav','fixture.wav','audio/wav','audio',
  10485760,5242880,2,
  case when n=3 then now()-interval '2 days' else now() end,
  case when n=3 then now()-interval '1 day' else now()+interval '1 day' end
from generate_series(1,7) n;

-- Roll back single-session state assertions so grants 6 and 7 remain ACTIVE
-- for the runner's independently connected concurrency tests.
begin;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
do $$
declare
  sid uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  gid uuid := '44444444-4444-4444-8444-000000000001';
  owner_key text := 'user:11111111-1111-4111-8111-111111111111';
  hash_a text := repeat('a',64);
  hash_b text := repeat('b',64);
  bad_parts integer[];
  bad_hash text;
  bad_state text;
  original_submission jsonb;
  original_files jsonb;
  original_grant jsonb;
  outcome text;
  legacy_outcome boolean;
begin
  select to_jsonb(s) into original_submission from public.submissions s where id=sid;
  select jsonb_agg(to_jsonb(f) order by id) into original_files from public.submission_files f where submission_id=sid;
  begin
    update public.multipart_upload_grants set completion_manifest_hash='bad' where id=gid;
    raise exception 'Expected hash CHECK constraint';
  exception when check_violation then null; end;

  -- Every component of the authorized tuple, including NULLs, is checked.
  for bad_state in select unnest(array['grant','submission','upload','object','owner','null-owner']) loop
    begin
      perform public.claim_multipart_upload_completion(
        case when bad_state='grant' then 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid else gid end,
        case when bad_state='submission' then 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid else sid end,
        case when bad_state='upload' then 'wrong' else 'manifest-sql-1' end,
        case when bad_state='object' then 'wrong' else 'fixture/manifest/1.wav' end,
        case when bad_state='owner' then 'user:wrong-fixture-owner' when bad_state='null-owner' then null else owner_key end,
        array[1,2],hash_a);
      raise exception 'Expected tuple mismatch: %',bad_state;
    exception when insufficient_privilege then
      if sqlerrm <> 'MULTIPART_GRANT_MISMATCH' then raise; end if;
    end;
  end loop;

  for bad_parts in
    select null::integer[] union all select '{}'::integer[] union all
    select array[1] union all select array[1,1] union all select array[1,null] union all
    select array[0,2] union all select array[1,3]
  loop
    begin
      perform public.claim_multipart_upload_completion(gid,sid,'manifest-sql-1','fixture/manifest/1.wav',owner_key,bad_parts,hash_a);
      raise exception 'Expected exact parts rejection';
    exception when invalid_parameter_value then
      if sqlerrm <> 'MULTIPART_PARTS_MISMATCH' then raise; end if;
    end;
  end loop;
  for bad_hash in select unnest(array[null,'',repeat('A',64),repeat('a',63),repeat('a',65),'not-a-hash']) loop
    begin
      perform public.claim_multipart_upload_completion(gid,sid,'manifest-sql-1','fixture/manifest/1.wav',owner_key,array[1,2],bad_hash);
      raise exception 'Expected manifest format rejection';
    exception when invalid_parameter_value then
      if sqlerrm <> 'MULTIPART_MANIFEST_INVALID' then raise; end if;
    end;
  end loop;

  begin
    perform public.claim_multipart_upload_completion('44444444-4444-4444-8444-000000000003',sid,'manifest-sql-3','fixture/manifest/3.wav',owner_key,array[1,2],hash_a);
    raise exception 'Expected expired grant rejection';
  exception when query_canceled then
    if sqlerrm <> 'MULTIPART_GRANT_EXPIRED' then raise; end if;
  end;
  for bad_state in select unnest(array['ABORTING','ABORTED','FAILED']) loop
    update public.multipart_upload_grants set status=bad_state where id='44444444-4444-4444-8444-000000000004';
    begin
      perform public.claim_multipart_upload_completion('44444444-4444-4444-8444-000000000004',sid,'manifest-sql-4','fixture/manifest/4.wav',owner_key,array[1,2],hash_a);
      raise exception 'Expected terminal grant rejection';
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'MULTIPART_GRANT_NOT_ACTIVE' then raise; end if;
    end;
  end loop;
  update public.multipart_upload_grants set completion_manifest_hash=hash_a where id='44444444-4444-4444-8444-000000000005';
  begin
    perform public.claim_multipart_upload_completion('44444444-4444-4444-8444-000000000005',sid,'manifest-sql-5','fixture/manifest/5.wav',owner_key,array[1,2],hash_b);
    raise exception 'Expected active manifest binding rejection';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'MULTIPART_MANIFEST_MISMATCH' then raise; end if;
  end;

  outcome := public.claim_multipart_upload_completion(gid,sid,'manifest-sql-1','fixture/manifest/1.wav',owner_key,array[2,1],hash_a);
  if outcome is distinct from 'START'
    or (select completion_manifest_hash from public.multipart_upload_grants where id=gid) is distinct from hash_a
    then raise exception 'Initial claim did not bind manifest'; end if;
  select to_jsonb(g) into original_grant from public.multipart_upload_grants g where id=gid;
  outcome := public.claim_multipart_upload_completion(gid,sid,'manifest-sql-1','fixture/manifest/1.wav',owner_key,array[1,2],hash_a);
  if outcome is distinct from 'COMPLETING'
    or (select to_jsonb(g) from public.multipart_upload_grants g where id=gid) is distinct from original_grant
    then raise exception 'In-flight replay changed grant'; end if;
  begin
    perform public.claim_multipart_upload_completion(gid,sid,'manifest-sql-1','fixture/manifest/1.wav',owner_key,array[1,2],hash_b);
    raise exception 'Expected competing manifest rejection';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'MULTIPART_MANIFEST_MISMATCH' then raise; end if;
  end;
  update public.multipart_upload_grants set status='COMPLETED',consumed_at=now() where id=gid;
  select to_jsonb(g) into original_grant from public.multipart_upload_grants g where id=gid;
  outcome := public.claim_multipart_upload_completion(gid,sid,'manifest-sql-1','fixture/manifest/1.wav',owner_key,array[1,2],hash_a);
  if outcome is distinct from 'COMPLETED'
    or (select to_jsonb(g) from public.multipart_upload_grants g where id=gid) is distinct from original_grant
    then raise exception 'Completed replay changed grant'; end if;
  begin
    perform public.claim_multipart_upload_completion(gid,sid,'manifest-sql-1','fixture/manifest/1.wav',owner_key,array[1,2],hash_b);
    raise exception 'Expected completed manifest rejection';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'MULTIPART_MANIFEST_MISMATCH' then raise; end if;
  end;

  -- The paid supplement path still uses the original six-argument RPC.
  gid := '44444444-4444-4444-8444-000000000002';
  legacy_outcome := public.claim_multipart_upload_grant(gid,sid,'manifest-sql-2','fixture/manifest/2.wav',owner_key,array[1,2]);
  if legacy_outcome is distinct from true
    or (select status from public.multipart_upload_grants where id=gid) is distinct from 'COMPLETING'
    or (select completion_manifest_hash from public.multipart_upload_grants where id=gid) is not null
    then raise exception 'Legacy claim compatibility broken'; end if;
  foreach bad_state in array array['COMPLETING','COMPLETED'] loop
    update public.multipart_upload_grants set status=bad_state,
      consumed_at=case when bad_state='COMPLETED' then now() else null end where id=gid;
    begin
      perform public.claim_multipart_upload_completion(gid,sid,'manifest-sql-2','fixture/manifest/2.wav',owner_key,array[1,2],hash_a);
      raise exception 'Expected legacy receipt replay denial';
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'MULTIPART_MANIFEST_MISMATCH' then raise; end if;
    end;
  end loop;
  if (select to_jsonb(s) from public.submissions s where id=sid) is distinct from original_submission
    or (select jsonb_agg(to_jsonb(f) order by id) from public.submission_files f where submission_id=sid) is distinct from original_files
    then raise exception 'Completion claim mutated original submission or files'; end if;
end $$;
rollback;
\echo 'PASS: permissions, validation, replay immutability, legacy null-manifest compatibility.'
