-- Isolated pre-migration fixtures. All mutations roll back after verification.
begin;
insert into auth.users(id) values('10000000-0000-4000-8000-000000000001');
insert into public.review_document_jobs(id,created_by,mode,input_kind,fingerprint,status,expires_at,purged_at,lease_token,lease_until,sources,outputs,draft_data,created_at)
select ('20000000-0000-4000-8000-00000000000'||i)::uuid,'10000000-0000-4000-8000-000000000001','album','files',repeat(i::text,64),
  case i when 3 then 'expired' when 5 then 'extracting' when 6 then 'failed' else 'completed' end,
  case when i=2 then now()-interval '1 day' else now()+interval '1 day' end,
  case when i=4 then now()-interval '1 hour' end,
  case when i=5 then '30000000-0000-4000-8000-000000000001'::uuid end,
  case when i=5 then now()+interval '1 minute' end,
  '[{"id":"source","objectKey":"fixture-source"}]','[{"id":"output","objectKey":"fixture-output"}]','{"albums":["retained"]}',now()-interval '100 days'
from generate_series(1,6) i;
create temporary table retention_before as select id,to_jsonb(j) as snapshot from public.review_document_jobs j;
\i supabase/migrations/20261024015746_review_documents_admin_retention.sql
do $$
declare new_job public.review_document_jobs;
begin
  if exists(select 1 from public.review_document_jobs where id in (
    '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000006') and expires_at<>'infinity'::timestamptz) then
    raise exception 'Live completed/active/failed job retention not extended';
  end if;
  if exists(select 1 from public.review_document_jobs j join retention_before b using(id)
    where (to_jsonb(j)-'expires_at') is distinct from (b.snapshot-'expires_at')) then
    raise exception 'Retention migration changed sources/results/history/lease or processing state';
  end if;
  if exists(select 1 from public.review_document_jobs j join retention_before b using(id)
    where j.id in ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004')
    and to_jsonb(j) is distinct from b.snapshot) then
    raise exception 'Expired or already-purged job was resurrected';
  end if;
  select * into new_job from public.create_review_document_job('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','album','urls',repeat('7',64),'[]');
  if new_job.expires_at<>'infinity'::timestamptz or new_job.status<>'queued' then raise exception 'New job has a finite retention deadline'; end if;
  if exists(select 1 from public.claim_review_document_job(gen_random_uuid())) then raise exception 'Retention change bypassed active processing lease'; end if;
  if has_table_privilege('authenticated','public.review_document_jobs','UPDATE')
    or has_table_privilege('authenticated','public.review_document_jobs','DELETE')
    or has_function_privilege('anon','public.claim_review_document_job(uuid)','EXECUTE') then
    raise exception 'Retention change weakened permissions';
  end if;
  raise notice 'retention: unbounded defaults, live completed jobs, no resurrection, payload/lease/permissions preserved PASS';
end $$;
rollback;
