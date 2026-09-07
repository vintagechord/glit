-- Standalone administrator tools. No submissions, orders or payment rows.
create table public.review_document_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  mode text not null check (mode in ('album','mv')),
  input_kind text not null check (input_kind in ('files','urls')),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'uploading' check (status in ('uploading','queued','extracting','translating','needs_review','generating','validating','completed','failed','cancelled','expired')),
  operation text not null default 'extract' check (operation in ('extract','reextract','translate','generate')),
  sources jsonb not null default '[]' check (jsonb_typeof(sources)='array' and jsonb_array_length(sources)<=8),
  application_date date not null default ((now() at time zone 'Asia/Seoul')::date),
  extracted_data jsonb, draft_data jsonb, snapshot_data jsonb,
  version integer not null default 1 check (version>0),
  result_version integer, outputs jsonb not null default '[]', zip_output jsonb,
  template_version text, counts jsonb, validation jsonb,
  error_code text, error_message text, retryable boolean not null default false,
  attempts integer not null default 0 check (attempts>=0 and attempts<=3),
  extraction_attempts integer not null default 0 check (extraction_attempts between 0 and 3),
  translation_requests integer not null default 0 check (translation_requests between 0 and 3),
  lease_token uuid, lease_until timestamptz,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  purged_at timestamptz
);
create unique index review_document_jobs_dedup on public.review_document_jobs(created_by,mode,fingerprint) where status <> 'expired';
create index review_document_jobs_queue on public.review_document_jobs(available_at,created_at) where status='queued';
create index review_document_jobs_owner on public.review_document_jobs(created_by,created_at desc);
create table public.review_document_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.review_document_jobs(id) on delete cascade,
  actor_id uuid references auth.users(id),
  status text not null, version integer not null, error_code text,
  created_at timestamptz not null default now()
);
create table public.review_document_worker_heartbeat (
  singleton boolean primary key default true check (singleton),
  updated_at timestamptz not null default now()
);
create table public.review_document_artifacts (
  id uuid primary key,
  job_id uuid not null references public.review_document_jobs(id) on delete cascade,
  object_key text not null unique,
  created_at timestamptz not null default now()
);
alter table public.review_document_jobs enable row level security;
alter table public.review_document_job_events enable row level security;
alter table public.review_document_worker_heartbeat enable row level security;
alter table public.review_document_artifacts enable row level security;
-- All writes pass server validation; even authenticated admins cannot forge jobs via PostgREST.
revoke all on public.review_document_jobs, public.review_document_job_events, public.review_document_worker_heartbeat from anon, authenticated;
revoke all on public.review_document_artifacts from anon, authenticated;
grant all on public.review_document_artifacts to service_role;
grant select on public.review_document_jobs, public.review_document_job_events to authenticated;
grant all on public.review_document_jobs, public.review_document_job_events, public.review_document_worker_heartbeat to service_role;
grant usage,select on sequence public.review_document_job_events_id_seq to service_role;
create policy review_document_jobs_owner_admin_read on public.review_document_jobs for select to authenticated
using(created_by=auth.uid() and public.is_admin());
create policy review_document_events_owner_admin_read on public.review_document_job_events for select to authenticated
using(exists(select 1 from public.review_document_jobs j where j.id=job_id and j.created_by=auth.uid() and public.is_admin()));

create function public.audit_review_document_job() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' or old.status is distinct from new.status or old.version is distinct from new.version then
    insert into public.review_document_job_events(job_id,actor_id,status,version,error_code)
    values(new.id,new.created_by,new.status,new.version,new.error_code);
  end if;
  return new;
end $$;
-- AFTER is necessary for the event foreign key on INSERT.
create trigger review_document_job_audit after insert or update on public.review_document_jobs
for each row execute function public.audit_review_document_job();

create function public.create_review_document_job(p_id uuid,p_owner uuid,p_mode text,p_kind text,p_fingerprint text,p_sources jsonb)
returns public.review_document_jobs language plpgsql security definer set search_path=public as $$
declare result public.review_document_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended('review-doc-owner:'||p_owner::text,0));
  select * into result from public.review_document_jobs where created_by=p_owner and mode=p_mode and fingerprint=p_fingerprint and status<>'expired';
  if found then
    if result.expires_at<=now() or result.error_code in ('UPLOAD_FAILED','UPLOAD_INTERRUPTED','UPLOAD_CANCELLED') then
      update public.review_document_jobs set status='expired',expires_at=now(),lease_token=null,lease_until=null,updated_at=now() where id=result.id;
    else return result;
    end if;
  end if;
  if (select count(*) from public.review_document_jobs where created_by=p_owner and status in ('uploading','queued','extracting','translating','generating','validating'))>=3 then
    raise exception 'REVIEW_JOB_LIMIT';
  end if;
  insert into public.review_document_jobs(id,created_by,mode,input_kind,fingerprint,sources,status)
  values(p_id,p_owner,p_mode,p_kind,p_fingerprint,p_sources,case when p_kind='urls' then 'queued' else 'uploading' end) returning * into result;
  return result;
end $$;

create function public.change_review_document_job(p_id uuid,p_owner uuid,p_version integer,p_action text,p_data jsonb default null)
returns public.review_document_jobs language plpgsql security definer set search_path=public as $$
declare j public.review_document_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended('review-doc-owner:'||p_owner::text,0));
  select * into j from public.review_document_jobs where id=p_id and created_by=p_owner for update;
  if not found then raise exception 'REVIEW_JOB_NOT_FOUND'; end if;
  if j.expires_at<=now() or j.status='expired' then raise exception 'REVIEW_JOB_EXPIRED'; end if;
  if j.version<>p_version then raise exception 'REVIEW_JOB_VERSION_CONFLICT'; end if;
  if p_action in ('generate','translate','retry') and
    (select count(*) from public.review_document_jobs where created_by=p_owner and status in ('uploading','queued','extracting','translating','generating','validating'))>=3 then
    raise exception 'REVIEW_JOB_LIMIT';
  end if;
  if p_action='cancel' then
    if j.status not in ('uploading','queued','extracting','translating','generating','validating') then raise exception 'REVIEW_JOB_STATE_CONFLICT'; end if;
    update public.review_document_jobs set status='cancelled',
      error_code=case when status='uploading' then 'UPLOAD_CANCELLED' else error_code end,
      error_message=case when status='uploading' then '업로드가 취소되었습니다. 파일을 다시 업로드해주세요.' else error_message end,
      lease_token=null,lease_until=null,updated_at=now() where id=p_id returning * into j;
  elsif p_action='save' then
    if j.status not in ('needs_review','completed','failed','cancelled') or p_data is null then raise exception 'REVIEW_JOB_STATE_CONFLICT'; end if;
    update public.review_document_jobs set draft_data=p_data,version=version+1,status='needs_review',error_code=null,error_message=null,retryable=false,updated_at=now() where id=p_id returning * into j;
  elsif p_action in ('generate','translate') then
    if j.status not in ('needs_review','completed','failed','cancelled') or coalesce(j.draft_data,j.extracted_data) is null then raise exception 'REVIEW_JOB_STATE_CONFLICT'; end if;
    if p_action='translate' and j.translation_requests>=3 then raise exception 'REVIEW_TRANSLATION_LIMIT'; end if;
    update public.review_document_jobs set snapshot_data=coalesce(draft_data,extracted_data),operation=p_action,status='queued',attempts=0,
      translation_requests=translation_requests+case when p_action='translate' then 1 else 0 end,
      available_at=now(),error_code=null,error_message=null,retryable=false,updated_at=now() where id=p_id returning * into j;
  elsif p_action='retry' then
    if j.status='needs_review' then
      if j.extraction_attempts>=3 or coalesce(j.draft_data,j.extracted_data) is null then raise exception 'REVIEW_JOB_STATE_CONFLICT'; end if;
      update public.review_document_jobs set snapshot_data=coalesce(draft_data,extracted_data),operation='reextract',status='queued',attempts=0,
        available_at=now(),lease_token=null,lease_until=null,error_code=null,error_message=null,updated_at=now() where id=p_id returning * into j;
      return j;
    end if;
    if j.status not in ('failed','cancelled') or (not j.retryable and j.status<>'cancelled') or j.attempts>=3 then raise exception 'REVIEW_JOB_STATE_CONFLICT'; end if;
    if j.operation in ('extract','reextract') and j.extraction_attempts>=3 then raise exception 'REVIEW_JOB_STATE_CONFLICT'; end if;
    if j.error_code in ('UPLOAD_FAILED','UPLOAD_INTERRUPTED','UPLOAD_CANCELLED') then raise exception 'REVIEW_JOB_STATE_CONFLICT'; end if;
    if j.extracted_data is not null and j.operation='extract' then raise exception 'REVIEW_JOB_STATE_CONFLICT'; end if;
    update public.review_document_jobs set status='queued',available_at=now(),lease_token=null,lease_until=null,error_code=null,error_message=null,updated_at=now() where id=p_id returning * into j;
  else raise exception 'REVIEW_JOB_INVALID_ACTION';
  end if;
  return j;
end $$;

-- A single DB-wide lease bounds conversions across restarts and multiple worker instances.
create function public.claim_review_document_job(p_token uuid) returns setof public.review_document_jobs
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('review-doc-worker',0));
  insert into public.review_document_worker_heartbeat(singleton,updated_at) values(true,now()) on conflict(singleton) do update set updated_at=now();
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
    where id=(select id from public.review_document_jobs where status='queued' and available_at<=now() and expires_at>now() and attempts<3 and (operation not in ('extract','reextract') or extraction_attempts<3) order by created_at for update skip locked limit 1) returning *;
end $$;

revoke all on function public.audit_review_document_job(),public.create_review_document_job(uuid,uuid,text,text,text,jsonb),public.change_review_document_job(uuid,uuid,integer,text,jsonb),public.claim_review_document_job(uuid) from public,anon,authenticated;
grant execute on function public.create_review_document_job(uuid,uuid,text,text,text,jsonb),public.change_review_document_job(uuid,uuid,integer,text,jsonb),public.claim_review_document_job(uuid) to service_role;
