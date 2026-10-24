-- Retain administrator conversion sources, outputs and history until an
-- explicit administrator deletion. Processing leases/timeouts are unchanged.
alter table public.review_document_jobs
  alter column expires_at set default 'infinity'::timestamptz;

-- Only still-live, unpurged jobs qualify. Do not resurrect expired jobs or
-- data already removed by the former retention policy; preserve all payloads.
update public.review_document_jobs
set expires_at = 'infinity'::timestamptz
where purged_at is null
  and status <> 'expired'
  and expires_at > now()
  and expires_at <> 'infinity'::timestamptz;
