-- Isolated database only. Existing callers remain native; checked web callers
-- can process local converters while sharing the original global lease.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000002');
insert into public.review_document_jobs(created_by,mode,input_kind,fingerprint,status,sources,created_at) values
('10000000-0000-4000-8000-000000000002','album','files',repeat('a',64),'queued','[{"name":"unsupported.odt"}]',now()-interval '5 minutes'),
('10000000-0000-4000-8000-000000000002','album','files',repeat('b',64),'queued','[{"name":"native.DOCX"},{"name":"legacy.HWP"}]',now()-interval '4 minutes'),
('10000000-0000-4000-8000-000000000002','album','files',repeat('c',64),'queued','[{"name":"binary.DOC"}]',now()-interval '3 minutes'),
('10000000-0000-4000-8000-000000000002','album','files',repeat('d',64),'queued','[{"name":"scan.PDF"}]',now()-interval '2 minutes'),
('10000000-0000-4000-8000-000000000002','album','files',repeat('e',64),'queued','[{"name":"only.docx"}]',now()-interval '1 minute');
do $$
declare claimed public.review_document_jobs; event_count integer; first_id uuid; formats text[]=array['doc','docx','hwp','pdf'];
begin
  select count(*) into event_count from public.review_document_job_events;
  perform public.claim_review_document_web_job(gen_random_uuid(),true,formats);
  if exists(select 1 from public.review_document_worker_heartbeat) or exists(select 1 from public.review_document_jobs where status<>'queued') or event_count<>(select count(*) from public.review_document_job_events) then raise exception 'converter readiness mutated state'; end if;
  -- One-argument and two-argument compatibility use native DOCX only.
  select * into claimed from public.claim_review_document_web_job(gen_random_uuid());
  if claimed.sources->0->>'name'<>'only.docx' then raise exception 'legacy caller gained unsupported formats'; end if;
  update public.review_document_jobs set status='needs_review',lease_token=null,lease_until=null where id=claimed.id;
  select * into claimed from public.claim_review_document_web_job(gen_random_uuid(),false,formats);
  if claimed.sources->1->>'name'<>'legacy.HWP' then raise exception 'checked web could not claim mixed sources'; end if;
  first_id=claimed.id;
  if exists(select 1 from public.review_document_worker_heartbeat) then raise exception 'checked web forged dedicated heartbeat'; end if;
  if exists(select 1 from public.claim_review_document_web_job(gen_random_uuid(),false,formats)) or exists(select 1 from public.claim_review_document_web_job(gen_random_uuid(),false)) then raise exception 'web callers overlapped the global lease'; end if;
  if exists(select 1 from public.claim_review_document_job(gen_random_uuid())) then raise exception 'dedicated caller overlapped web converter'; end if;
  update public.review_document_worker_heartbeat set updated_at=now()-interval '2 minutes';
  update public.review_document_jobs set lease_until=now()-interval '1 second' where id=first_id;
  select * into claimed from public.claim_review_document_web_job(gen_random_uuid(),false,formats);
  if claimed.id<>first_id or claimed.attempts<>2 or claimed.extraction_attempts<>2 then raise exception 'converter lease recovery failed'; end if;
  update public.review_document_jobs set status='needs_review',lease_token=null,lease_until=null where id=claimed.id;
  select * into claimed from public.claim_review_document_web_job(gen_random_uuid(),false,formats);
  if claimed.sources->0->>'name'<>'binary.DOC' then raise exception 'DOC was not claimed'; end if;
  update public.review_document_jobs set status='needs_review',lease_token=null,lease_until=null where id=claimed.id;
  update public.review_document_worker_heartbeat set updated_at=now();
  if exists(select 1 from public.claim_review_document_web_job(gen_random_uuid(),false,formats)) then raise exception 'dedicated preference was lost'; end if;
  update public.review_document_worker_heartbeat set updated_at=now()-interval '2 minutes';
  select * into claimed from public.claim_review_document_web_job(gen_random_uuid(),false,formats);
  if claimed.sources->0->>'name'<>'scan.PDF' then raise exception 'PDF was not claimed'; end if;
  update public.review_document_jobs set status='needs_review',lease_token=null,lease_until=null where id=claimed.id;
  if exists(select 1 from public.claim_review_document_web_job(gen_random_uuid(),false,array['odt','pdf'])) then raise exception 'an unapproved format was claimed'; end if;
  if has_function_privilege('authenticated','public.claim_review_document_web_job(uuid,boolean,text[])','EXECUTE') or has_function_privilege('anon','public.claim_review_document_web_job(uuid,boolean,text[])','EXECUTE') then raise exception 'converter claimer is public'; end if;
  if not has_function_privilege('service_role','public.claim_review_document_web_job(uuid,boolean,text[])','EXECUTE') then raise exception 'service role cannot claim'; end if;
  raise notice 'converter web jobs: native compatibility, read-only probe, mixed formats, shared lease, restart, dedicated priority and grants PASS';
end $$;
rollback;
