-- Converter-capable dispatch runs inside the existing web process.
-- The server only supplies extra formats after its opt-in local converter check.
-- Keep the native wrapper and the dedicated worker on the same global lease.
create or replace function public.claim_review_document_web_job(p_token uuid, p_check_only boolean, p_supported_formats text[])
returns setof public.review_document_jobs
language plpgsql security definer set search_path=public as $$
begin
  if p_check_only then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('review-doc-worker',0));
  -- A connected dedicated worker handles every format and takes precedence.
  if exists(select 1 from public.review_document_worker_heartbeat where singleton and updated_at>now()-interval '90 seconds') then return; end if;
  update public.review_document_jobs set status='failed',error_code='UPLOAD_INTERRUPTED',error_message='업로드가 중단되었습니다. 새 작업으로 파일을 다시 업로드해주세요.',updated_at=now()
    where status='uploading' and created_at<now()-interval '10 minutes';
  update public.review_document_jobs set status=case when attempts<3 and (operation not in ('extract','reextract') or extraction_attempts<3) then 'queued' else 'failed' end,
    retryable=attempts<3 and (operation not in ('extract','reextract') or extraction_attempts<3),lease_token=null,lease_until=null,error_code='WORKER_INTERRUPTED',
    error_message='작업 프로세스가 중단되었습니다. 재시도 횟수 내에서 자동 복구합니다.',available_at=now(),updated_at=now()
    where status in ('extracting','translating','generating','validating') and lease_until<now();
  if exists(select 1 from public.review_document_jobs where lease_until>now() and status in ('extracting','translating','generating','validating')) then return; end if;
  return query update public.review_document_jobs set status=case operation when 'generate' then 'generating' when 'translate' then 'translating' else 'extracting' end,
    lease_token=p_token,lease_until=now()+interval '90 seconds',attempts=attempts+1,
    extraction_attempts=extraction_attempts+case when operation in ('extract','reextract') then 1 else 0 end,updated_at=now()
    where id=(select id from public.review_document_jobs where status='queued' and available_at<=now() and expires_at>now() and attempts<3
      and (operation not in ('extract','reextract') or extraction_attempts<3)
      and (operation in ('generate','translate') or input_kind='urls' or (jsonb_array_length(sources)>0 and not exists(
        select 1 from jsonb_array_elements(sources) source where not exists(
          select 1 from unnest(p_supported_formats) format
          where format in ('doc','docx','hwp','pdf')
            and lower(coalesce(source->>'name','')) like '%.' || format
        )
      ))) order by created_at for update skip locked limit 1) returning *;
end $$;
revoke all on function public.claim_review_document_web_job(uuid,boolean,text[]) from public,anon,authenticated;
grant execute on function public.claim_review_document_web_job(uuid,boolean,text[]) to service_role;

-- No defaults on the three-argument overload: existing calls remain unambiguous
-- and cannot silently gain native converter privileges after deployment.
create or replace function public.claim_review_document_web_job(p_token uuid, p_check_only boolean default false)
returns setof public.review_document_jobs
language sql security definer set search_path=public as $$
  select * from public.claim_review_document_web_job(p_token, p_check_only, array['docx']::text[]);
$$;
revoke all on function public.claim_review_document_web_job(uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_review_document_web_job(uuid,boolean) to service_role;
notify pgrst, 'reload schema';
