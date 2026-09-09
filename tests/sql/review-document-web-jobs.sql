-- Isolated database only. Native and dedicated claimers must share one lease.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');
insert into public.review_document_jobs(created_by,mode,input_kind,fingerprint,status,sources,created_at) values
('10000000-0000-4000-8000-000000000001','album','files',repeat('a',64),'queued','[{"name":"legacy.hwp"}]',now()-interval '2 minutes'),
('10000000-0000-4000-8000-000000000001','album','files',repeat('b',64),'queued','[{"name":"modern.DOCX"}]',now()-interval '1 minute'),
('10000000-0000-4000-8000-000000000001','album','urls',repeat('c',64),'queued','[{"url":"https://www.melon.com/album/detail.htm?albumId=123"}]',now());
do $$
declare claimed public.review_document_jobs; docx_id uuid; event_count integer;
begin
  select count(*) into event_count from public.review_document_job_events;
  perform public.claim_review_document_web_job(gen_random_uuid(),true);
  if exists(select 1 from public.review_document_worker_heartbeat) or exists(select 1 from public.review_document_jobs where status<>'queued') or event_count<>(select count(*) from public.review_document_job_events) then raise exception 'readiness probe mutated state'; end if;
  select * into claimed from public.claim_review_document_web_job(gen_random_uuid());
  if claimed.sources->0->>'name'<>'modern.DOCX' then raise exception 'web claimed an unsupported format'; end if;
  docx_id=claimed.id;
  if exists(select 1 from public.review_document_worker_heartbeat) then raise exception 'web advertised full converters'; end if;
  if exists(select 1 from public.claim_review_document_web_job(gen_random_uuid())) then raise exception 'concurrent web lease allowed'; end if;
  if exists(select 1 from public.claim_review_document_job(gen_random_uuid())) then raise exception 'dedicated worker overlapped web lease'; end if;
  update public.review_document_worker_heartbeat set updated_at=now()-interval '2 minutes';
  update public.review_document_jobs set lease_until=now()-interval '1 second' where id=docx_id;
  select * into claimed from public.claim_review_document_web_job(gen_random_uuid());
  if claimed.id<>docx_id or claimed.attempts<>2 then raise exception 'web restart recovery failed'; end if;
  update public.review_document_jobs set status='needs_review',lease_token=null,lease_until=null where id=docx_id;
  select * into claimed from public.claim_review_document_web_job(gen_random_uuid());
  if claimed.input_kind<>'urls' then raise exception 'web did not process URL'; end if;
  update public.review_document_jobs set status='needs_review',lease_token=null,lease_until=null where id=claimed.id;
  update public.review_document_worker_heartbeat set updated_at=now();
  if exists(select 1 from public.claim_review_document_web_job(gen_random_uuid())) then raise exception 'web ignored dedicated worker preference'; end if;
  select * into claimed from public.claim_review_document_job(gen_random_uuid());
  if claimed.sources->0->>'name'<>'legacy.hwp' then raise exception 'dedicated HWP path lost'; end if;
  update public.review_document_jobs set status='queued',operation='generate',lease_token=null,lease_until=null where id=claimed.id;
  update public.review_document_worker_heartbeat set updated_at=now()-interval '2 minutes';
  select * into claimed from public.claim_review_document_web_job(gen_random_uuid());
  if claimed.operation<>'generate' or claimed.sources->0->>'name'<>'legacy.hwp' then raise exception 'web cannot generate already analyzed legacy input'; end if;
  if has_function_privilege('authenticated','public.claim_review_document_web_job(uuid,boolean)','EXECUTE') or has_function_privilege('anon','public.claim_review_document_web_job(uuid,boolean)','EXECUTE') then raise exception 'web claimer is public'; end if;
  raise notice 'web review jobs: read-only readiness, formats, shared lease, restart, dedicated priority, generation, grants PASS';
end $$;
rollback;
