-- Onside moved from a resident Render web process to Vercel Functions.
-- The former in-process dispatchers (music archive every 3 seconds, review
-- documents every 15 seconds) no longer exist, so pg_cron wakes the app only
-- while durable work is waiting. Both runners keep using their DB leases.

-- The email worker endpoint used the legacy Render host. Keep the existing
-- token and only move the public origin.
update public.email_worker_config
   set endpoint_url = 'https://iamonside.com/api/internal/email-outbox'
 where endpoint_url = 'https://glit-b1yn.onrender.com/api/internal/email-outbox';

create or replace function public.dispatch_background_jobs()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_config public.email_worker_config; v_request bigint;
begin
  select * into v_config from public.email_worker_config where singleton;
  if not found or not v_config.enabled then return; end if;
  -- Mirror lease_music_archive_job: queued work or an abandoned lease.
  if not exists(
       select 1 from public.music_archive_jobs j
       join public.music_archive_libraries l on l.id = j.library_id
       where l.archived_at is null
         and ((j.status = 'queued' and j.available_at <= now())
           or (j.status = 'running' and j.lease_until < now())))
     -- Mirror claim_review_document_web_job for the DOCX/URL web runner. A
     -- connected dedicated worker claims its own jobs; queued DOC/HWP/PDF
     -- files wait for it and must not wake the app every minute.
     and (exists(select 1 from public.review_document_worker_heartbeat
                 where singleton and updated_at > now() - interval '90 seconds')
       or not exists(
         select 1 from public.review_document_jobs r
         where (r.status = 'uploading' and r.created_at < now() - interval '10 minutes')
            or (r.status in ('extracting','translating','generating','validating') and r.lease_until < now())
            or (r.status = 'queued' and r.available_at <= now() and r.expires_at > now() and r.attempts < 3
              and (r.operation not in ('extract','reextract') or r.extraction_attempts < 3)
              and (r.operation in ('generate','translate') or r.input_kind = 'urls'
                or (jsonb_array_length(r.sources) > 0 and not exists(
                  select 1 from jsonb_array_elements(r.sources) source
                  where lower(coalesce(source->>'name','')) not like '%.docx'))))))
  then return; end if;
  -- The app answers 202 at once and keeps working in after(); the shared
  -- scheduler token is checked by authorize_email_worker.
  select net.http_post(
    url := regexp_replace(v_config.endpoint_url, '/api/internal/email-outbox$', '/api/internal/background-jobs'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_config.token),
    body := '{}'::jsonb, timeout_milliseconds := 10000) into v_request;
end $$;
revoke all on function public.dispatch_background_jobs() from public, anon, authenticated;
-- Only postgres cron owns dispatch; the web worker cannot read net responses.

do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') and exists(select 1 from pg_extension where extname='pg_net') then
    perform cron.schedule('onside-background-jobs','* * * * *','select public.dispatch_background_jobs()');
  end if;
end $$;
