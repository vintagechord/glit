-- Additive, separate from the paid submission and order snapshot. No existing
-- file, track, price, station selection or result is overwritten on acceptance.
create table public.submission_supplement_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  note text not null check (char_length(btrim(note)) between 1 and 4000),
  status text not null default 'OPEN' check (status in ('OPEN', 'SUBMITTED', 'ACCEPTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submission_supplement_requests_submission_idx on public.submission_supplement_requests(submission_id, created_at);
create table public.submission_supplement_revisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.submission_supplement_requests(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
  note text not null default '' check (char_length(note) <= 4000),
  review_note text not null default '' check (char_length(review_note) <= 4000),
  submitted_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  unique (request_id, revision_no)
);
create unique index submission_supplement_one_draft_idx on public.submission_supplement_revisions(request_id) where status = 'DRAFT';
create table public.submission_supplement_files (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.submission_supplement_revisions(id) on delete cascade,
  grant_id uuid not null unique references public.multipart_upload_grants(id),
  original_name text not null,
  size_bytes bigint not null check (size_bytes between 1 and 4294967296),
  mime_type text not null,
  object_key text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'ABORTED')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index submission_supplement_files_revision_idx on public.submission_supplement_files(revision_id);
create table public.submission_supplement_notifications (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.submission_supplement_revisions(id) on delete cascade,
  state_key text not null,
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  outcome jsonb not null default '{}',
  last_attempt_at timestamptz,
  completed_at timestamptz,
  unique (revision_id, state_key)
);

alter table public.submission_supplement_requests enable row level security;
alter table public.submission_supplement_revisions enable row level security;
alter table public.submission_supplement_files enable row level security;
alter table public.submission_supplement_notifications enable row level security;
-- Guest ownership is proved by the server. Deny direct Data API access for all
-- browser roles, including authenticated users; the guarded API returns only
-- the necessary fields and issues short download URLs after authorization.
revoke all on public.submission_supplement_requests, public.submission_supplement_revisions, public.submission_supplement_files from public, anon, authenticated;
grant select, insert, update, delete on public.submission_supplement_requests, public.submission_supplement_revisions, public.submission_supplement_files to service_role;
revoke all on public.submission_supplement_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.submission_supplement_notifications to service_role;

create function public.mutate_submission_supplement(
  p_submission_id uuid, p_action text, p_actor_user_id uuid default null,
  p_guest_token text default null, p_request_id uuid default null,
  p_file_id uuid default null, p_note text default '', p_file jsonb default '{}'
)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  s public.submissions%rowtype;
  r public.submission_supplement_requests%rowtype;
  v public.submission_supplement_revisions%rowtype;
  f public.submission_supplement_files%rowtype;
  g public.multipart_upload_grants%rowtype;
  n public.submission_supplement_notifications%rowtype;
  actor_admin boolean;
  owner_key text;
begin
  -- This function is executable only by service_role. Actor values come from
  -- verified getUser/guest ownership checks; they are never accepted from JSON.
  select * into s from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'SUPPLEMENT_NOT_FOUND'; end if;
  select exists(select 1 from public.profiles where user_id = p_actor_user_id and role = 'admin') into actor_admin;
  if p_action in ('request', 'accept', 'reject', 'notify_claim', 'notify_finish') then
    if not actor_admin then raise exception 'SUPPLEMENT_FORBIDDEN' using errcode = '42501'; end if;
  elsif not coalesce((
    (s.user_id is not null and s.user_id = p_actor_user_id) or
    (s.user_id is null and s.guest_token is not null and s.guest_token = p_guest_token)
  ), false) then
    raise exception 'SUPPLEMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if p_action <> 'notify_finish' and s.payment_status is distinct from 'PAID' then raise exception 'SUPPLEMENT_PAYMENT_REQUIRED'; end if;
  if char_length(coalesce(p_note, '')) > 4000 then raise exception 'SUPPLEMENT_NOTE_INVALID'; end if;

  if p_action = 'request' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'SUPPLEMENT_NOTE_REQUIRED'; end if;
    insert into public.submission_supplement_requests(submission_id, requested_by, note)
      values (s.id, p_actor_user_id, btrim(p_note)) returning * into r;
    insert into public.submission_supplement_revisions(request_id, revision_no) values (r.id, 1) returning * into v;
    insert into public.submission_events(submission_id, actor_user_id, event_type, message)
      values (s.id, p_actor_user_id, 'SUPPLEMENT_REQUESTED', '자료 보완을 요청했습니다. 신청 내역에서 요청 내용을 확인해주세요.');
    return jsonb_build_object('requestId', r.id, 'revisionId', v.id);
  end if;

  if p_file_id is not null then
    select * into f from public.submission_supplement_files where id = p_file_id;
    select * into v from public.submission_supplement_revisions where id = f.revision_id;
    p_request_id := v.request_id;
  end if;
  select * into r from public.submission_supplement_requests where id = p_request_id and submission_id = s.id for update;
  if not found then raise exception 'SUPPLEMENT_NOT_FOUND'; end if;
  if p_file_id is null then
    select * into v from public.submission_supplement_revisions where request_id = r.id order by revision_no desc limit 1 for update;
  else
    select * into v from public.submission_supplement_revisions where id = v.id for update;
    select * into f from public.submission_supplement_files where id = p_file_id for update;
  end if;

  if p_action = 'notify_claim' then
    select * into n from public.submission_supplement_notifications
      where revision_id = v.id and state_key = r.status || ':' || v.status for update;
    if not found then
      insert into public.submission_supplement_notifications(revision_id, state_key)
        values(v.id, r.status || ':' || v.status) returning * into n;
    end if;
    if n.outcome->>'email' = 'API_ACCEPTED' and n.outcome->>'kakao' = 'API_ACCEPTED' then
      return jsonb_build_object('alreadyAccepted',true,'outcome',n.outcome);
    end if;
    if n.lease_until > now() or n.last_attempt_at > now() - interval '60 seconds' then raise exception 'SUPPLEMENT_NOTIFY_BUSY'; end if;
    update public.submission_supplement_notifications set attempts=attempts+1, lease_token=gen_random_uuid(),
      lease_until=now()+interval '2 minutes', last_attempt_at=now() where id=n.id returning * into n;
    return jsonb_build_object('notificationId',n.id,'leaseToken',n.lease_token,'state',r.status,'outcome',n.outcome);
  elsif p_action = 'notify_finish' then
    select * into n from public.submission_supplement_notifications where id=(p_file->>'notificationId')::uuid for update;
    if n.id is null or n.lease_token is distinct from (p_file->>'leaseToken')::uuid or not exists(
      select 1 from public.submission_supplement_revisions where id=n.revision_id and request_id=r.id
    ) then raise exception 'SUPPLEMENT_STATE_CONFLICT'; end if;
    if coalesce(p_file->'outcome'->>'email','') not in ('API_ACCEPTED','FAILED','SKIPPED')
      or coalesce(p_file->'outcome'->>'kakao','') not in ('API_ACCEPTED','FAILED','SKIPPED')
      then raise exception 'SUPPLEMENT_NOTIFY_RESULT_INVALID'; end if;
    update public.submission_supplement_notifications set outcome=p_file->'outcome', lease_token=null, lease_until=null, completed_at=now() where id=n.id;
    insert into public.submission_events(submission_id,actor_user_id,event_type,message)
      values(s.id,p_actor_user_id,'SUPPLEMENT_NOTIFICATION',
        '보완 안내 발송 요청 결과: 이메일 ' || (p_file->'outcome'->>'email') || ', 카카오 ' || (p_file->'outcome'->>'kakao') || '. API_ACCEPTED는 실제 수신 확인과 다릅니다.');
    return jsonb_build_object('ok',true);
  end if;

  if p_action in ('accept', 'reject') then
    if r.status <> 'SUBMITTED' or v.status <> 'SUBMITTED' then raise exception 'SUPPLEMENT_STATE_CONFLICT'; end if;
    if p_action = 'reject' and btrim(coalesce(p_note, '')) = '' then raise exception 'SUPPLEMENT_NOTE_REQUIRED'; end if;
    update public.submission_supplement_revisions set status = case when p_action = 'accept' then 'ACCEPTED' else 'REJECTED' end,
      review_note = coalesce(p_note, ''), reviewed_by = p_actor_user_id, reviewed_at = now() where id = v.id;
    update public.submission_supplement_requests set status = case when p_action = 'accept' then 'ACCEPTED' else 'OPEN' end,
      updated_at = now() where id = r.id;
    if p_action = 'reject' then
      insert into public.submission_supplement_revisions(request_id, revision_no) values (r.id, v.revision_no + 1);
    end if;
    insert into public.submission_events(submission_id, actor_user_id, event_type, message)
      values (s.id, p_actor_user_id, case when p_action = 'accept' then 'SUPPLEMENT_ACCEPTED' else 'SUPPLEMENT_REJECTED' end,
        case when p_action = 'accept' then '관리자가 보완 자료를 수락했습니다. 기존 결제·원본·결과 이력은 유지됩니다.' else '보완 자료의 추가 수정이 필요합니다. 요청 내용을 확인해주세요.' end);
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'verify' and f.status = 'VERIFIED' then return jsonb_build_object('ok', true); end if;
  if r.status <> 'OPEN' or v.status <> 'DRAFT' then raise exception 'SUPPLEMENT_STATE_CONFLICT'; end if;
  if p_action = 'attach' then
    if (select count(*) from public.submission_supplement_files where revision_id = v.id and status <> 'ABORTED') >= 20 then raise exception 'SUPPLEMENT_FILE_LIMIT'; end if;
    select * into g from public.multipart_upload_grants where id = (p_file->>'grantId')::uuid for update;
    owner_key := case when s.user_id is not null then 'user:' || s.user_id::text
      else 'guest:guest-' || substr(encode(sha256(convert_to(btrim(s.guest_token), 'UTF8')), 'hex'), 1, 32) end;
    if g.id is null or g.submission_id <> s.id or g.owner_key <> owner_key or g.status <> 'ACTIVE' or g.expires_at <= now()
      or g.object_key !~ ('(^|/)supplements/' || s.id::text || '/' || r.id::text || '/' || v.id::text || '/[0-9a-f-]{36}/[^/]+$')
      then raise exception 'SUPPLEMENT_GRANT_MISMATCH'; end if;
    insert into public.submission_supplement_files(revision_id, grant_id, original_name, size_bytes, mime_type, object_key)
      values (v.id, g.id, g.original_name, g.declared_size_bytes, g.mime_type, g.object_key) returning * into f;
    return jsonb_build_object('fileId', f.id);
  elsif p_action = 'verify' then
    select * into g from public.multipart_upload_grants where id = f.grant_id for update;
    if f.status <> 'PENDING' or g.status <> 'COMPLETING' or (p_file->>'sizeBytes')::bigint is distinct from f.size_bytes
      then raise exception 'SUPPLEMENT_STATE_CONFLICT'; end if;
    update public.submission_supplement_files set status = 'VERIFIED', verified_at = now() where id = f.id;
    update public.multipart_upload_grants set status = 'COMPLETED', consumed_at = now(), updated_at = now() where id = g.id;
    return jsonb_build_object('ok', true);
  elsif p_action in ('abort', 'invalidate') then
    select * into g from public.multipart_upload_grants where id = f.grant_id for update;
    if f.status = 'ABORTED' then return jsonb_build_object('ok', true); end if;
    if f.status <> 'PENDING' or g.status not in ('ACTIVE', 'COMPLETING', 'ABORTING', 'ABORTED', 'FAILED') then raise exception 'SUPPLEMENT_STATE_CONFLICT'; end if;
    update public.submission_supplement_files set status = 'ABORTED' where id = f.id;
    if p_action = 'invalidate' then
      update public.multipart_upload_grants set status = 'FAILED', updated_at = now() where id = g.id;
    elsif g.status in ('ACTIVE', 'COMPLETING') then
      update public.multipart_upload_grants set status = 'ABORTING', abort_attempts = abort_attempts + 1, last_abort_attempt_at = now(), updated_at = now() where id = g.id;
    end if;
    return jsonb_build_object('ok', true);
  elsif p_action = 'submit' then
    if not exists(select 1 from public.submission_supplement_files where revision_id = v.id and status = 'VERIFIED')
      or exists(select 1 from public.submission_supplement_files where revision_id = v.id and status = 'PENDING')
      then raise exception 'SUPPLEMENT_FILES_REQUIRED'; end if;
    update public.submission_supplement_revisions set status = 'SUBMITTED', note = coalesce(p_note, ''), submitted_by = p_actor_user_id, submitted_at = now() where id = v.id;
    update public.submission_supplement_requests set status = 'SUBMITTED', updated_at = now() where id = r.id;
    insert into public.submission_events(submission_id, actor_user_id, event_type, message)
      values (s.id, p_actor_user_id, 'SUPPLEMENT_SUBMITTED', '보완 자료를 제출했습니다. 관리자 확인을 기다리고 있습니다.');
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'SUPPLEMENT_ACTION_INVALID';
end;
$$;
revoke all on function public.mutate_submission_supplement(uuid,text,uuid,text,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.mutate_submission_supplement(uuid,text,uuid,text,uuid,uuid,text,jsonb) to service_role;
