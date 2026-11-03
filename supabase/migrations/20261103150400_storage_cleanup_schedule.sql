-- First apply 20261103150000 to 20261103150300. pg_cron wakes the app's
-- storage cleanup (/api/internal/background-jobs with the storage-cleanup
-- task) every ten minutes, but only while something is due, mirroring the
-- conditions the app itself works through. The app answers 202 at once and
-- works in after(); the shared scheduler token is checked by
-- authorize_email_worker, as for dispatch_background_jobs.
create or replace function public.dispatch_storage_cleanup()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_config public.email_worker_config;
  v_request bigint;
begin
  select * into v_config from public.email_worker_config where singleton;
  if not found or not v_config.enabled then return; end if;

  if not exists (
       select 1 from public.submission_upload_staging staged
       where staged.expires_at <= now())
     and not exists (
       select 1 from public.upload_put_grants put_grant
       where (put_grant.status = 'PENDING' and put_grant.expires_at <= now())
          or (put_grant.status = 'COMPLETED' and put_grant.consumed_at <= now() - interval '1 day'))
     and not exists (
       select 1 from public.storage_object_cleanup_queue queued
       where queued.available_at <= now())
     -- Mirror lease_expired_multipart_upload_aborts.
     and not exists (
       select 1 from public.multipart_upload_grants grant_row
       where (grant_row.status = 'ACTIVE' and grant_row.expires_at <= now())
          or (grant_row.status = 'ABORTING'
            and coalesce(grant_row.last_abort_attempt_at, '-infinity'::timestamptz) <= now() - interval '5 minutes')
          or (grant_row.status = 'FAILED' and grant_row.updated_at <= now() - interval '5 minutes')
          or (grant_row.status = 'COMPLETING'
            and grant_row.expires_at <= now() - interval '1 day'
            and grant_row.updated_at <= now() - interval '1 day'))
     -- Purges marked at least 15 minutes ago without a confirmed delete.
     and not exists (
       select 1 from public.submission_files live
       where live.purged_at <= now() - interval '15 minutes' and live.purge_confirmed_at is null)
     and not exists (
       select 1 from public.submission_supplement_files supplement
       where supplement.purged_at <= now() - interval '15 minutes' and supplement.purge_confirmed_at is null)
     -- Mirror list_orphan_magazine_artwork.
     and not exists (
       select 1 from storage.objects artwork
       where artwork.bucket_id = 'magazine-artwork'
         and artwork.name ~ '^[0-9a-f-]{36}/uploads/[A-Za-z0-9._-]+$'
         and artwork.created_at <= now() - interval '1 day'
         and not exists (
           select 1 from public.magazine_requests request
           where strpos(coalesce(request.artwork_url, ''), '/magazine-artwork/' || artwork.name) > 0))
  then return; end if;

  select net.http_post(
    url := regexp_replace(v_config.endpoint_url, '/api/internal/email-outbox$', '/api/internal/background-jobs'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_config.token),
    body := '{"task":"storage-cleanup"}'::jsonb,
    timeout_milliseconds := 10000) into v_request;
end $$;

revoke all on function public.dispatch_storage_cleanup() from public, anon, authenticated;
-- Only postgres cron owns dispatch; the web worker cannot read net responses.

do $$ begin
  if exists(select 1 from pg_extension where extname = 'pg_cron')
     and exists(select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('onside-storage-cleanup', '*/10 * * * *', 'select public.dispatch_storage_cleanup()');
  end if;
end $$;
