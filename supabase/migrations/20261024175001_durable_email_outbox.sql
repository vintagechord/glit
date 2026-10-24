-- Durable application mail; no browser role may read bodies or invoke workers.
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (idempotency_key ~ '^[a-f0-9]{64}$'),
  provider text not null check (provider in ('supabase-smtp', 'smtp', 'gmail', 'resend')),
  recipient_email text not null check (length(recipient_email) between 3 and 254),
  subject text not null check (length(subject) between 1 and 998),
  html text check (html is null or octet_length(html) <= 131072),
  reply_to text,
  operation text not null check (length(operation) between 1 and 80),
  submission_id uuid references public.submissions(id) on delete set null,
  mark_result_notified boolean not null default false,
  status text not null default 'pending' check (status in ('pending','sending','retry','accepted','uncertain','failed','expired')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 100000),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error_reason text check (last_error_reason in ('configuration','rate_limit','delivery')),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  last_attempt_at timestamptz,
  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_outbox_due_idx on public.email_outbox(next_attempt_at, created_at) where status in ('pending','retry');
create index email_outbox_lease_idx on public.email_outbox(lease_expires_at) where status = 'sending';
create index email_outbox_payload_expiry_idx on public.email_outbox(expires_at) where html is not null;
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.email_outbox to service_role;

create function public.maintain_email_outbox() returns integer
language plpgsql security invoker set search_path = '' as $$
declare changed integer := 0; affected integer;
begin
  -- A worker may have sent before it disappeared. Never reclaim such work as
  -- retryable: SMTP cannot prove whether the remote server already accepted it.
  update public.email_outbox set status='uncertain', lease_token=null, lease_expires_at=null,
    last_error_reason='delivery', last_error_code='lease_expired', updated_at=now()
  where status='sending' and lease_expires_at <= now();
  get diagnostics affected = row_count; changed := changed + affected;
  update public.email_outbox set status='expired', html=null, lease_token=null, lease_expires_at=null,
    last_error_code='payload_expired', updated_at=now()
  where status in ('pending','retry','failed','uncertain') and expires_at <= now();
  get diagnostics affected = row_count; changed := changed + affected;
  delete from public.email_outbox where status in ('accepted','failed','uncertain','expired')
    and created_at < now() - interval '30 days';
  get diagnostics affected = row_count;
  return changed + affected;
end $$;

create function public.enqueue_email_outbox(
  p_idempotency_key text, p_provider text, p_recipient_email text, p_subject text,
  p_html text, p_reply_to text, p_operation text, p_expires_at timestamptz,
  p_submission_id uuid default null, p_mark_result_notified boolean default false
) returns setof public.email_outbox
language plpgsql security invoker set search_path = '' as $$
declare inserted_id uuid;
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '24 hours 1 minute' then
    raise exception using errcode='22023', message='Invalid email expiry';
  end if;
  if p_html is null or length(trim(p_html)) = 0 then
    raise exception using errcode='22023', message='Email content is required';
  end if;
  if p_operation in ('signup verification','password reset') then
    perform pg_advisory_xact_lock(hashtextextended('email-auth:' || p_operation || ':' || lower(p_recipient_email),0));
  end if;
  insert into public.email_outbox(idempotency_key,provider,recipient_email,subject,html,reply_to,operation,expires_at,submission_id,mark_result_notified)
    values(p_idempotency_key,p_provider,p_recipient_email,p_subject,p_html,p_reply_to,p_operation,p_expires_at,p_submission_id,
      p_mark_result_notified and p_submission_id is not null and p_operation in ('review result','submission update'))
    on conflict (idempotency_key) do nothing returning id into inserted_id;
  if inserted_id is not null and p_operation in ('signup verification','password reset') then
    -- A newer auth token invalidates older waiting mail. Never deliver a stale
    -- queued link after the newest request. Already in-flight SMTP is not claimed
    -- to be cancellable and remains protected by its lease/uncertain handling.
    update public.email_outbox set status='expired',html=null,expires_at=now(),updated_at=now(),last_error_code='auth_superseded'
      where id<>inserted_id and operation=p_operation and lower(recipient_email)=lower(p_recipient_email)
        and status in ('pending','retry','failed','uncertain');
  end if;
  return query select e.* from public.email_outbox e where e.idempotency_key=p_idempotency_key;
end $$;

create function public.claim_email_outbox(p_limit integer default 5, p_id uuid default null)
returns setof public.email_outbox language plpgsql security invoker set search_path = '' as $$
begin
  perform public.maintain_email_outbox();
  return query
  with due as (
    select e.id from public.email_outbox e
    where e.status in ('pending','retry') and e.next_attempt_at <= now()
      and e.expires_at > now() and e.html is not null and e.attempt_count < e.max_attempts
      and (p_id is null or e.id=p_id)
    order by e.next_attempt_at,e.created_at
    limit least(greatest(coalesce(p_limit,5),1),20)
    for update skip locked
  ) update public.email_outbox e set status='sending', attempt_count=e.attempt_count+1,
      lease_token=gen_random_uuid(), lease_expires_at=now()+interval '90 seconds',
      last_attempt_at=now(), updated_at=now()
    from due where e.id=due.id returning e.*;
end $$;

create function public.finish_email_outbox(
  p_id uuid, p_lease_token uuid, p_outcome text, p_message_id text default null,
  p_error_reason text default null, p_error_code text default null, p_retry_after_seconds integer default null
) returns setof public.email_outbox language plpgsql security invoker set search_path = '' as $$
declare item public.email_outbox; next_status text; delay_seconds integer;
begin
  if p_outcome not in ('accepted','retry','uncertain','failed') then
    raise exception using errcode='22023', message='Invalid email outcome';
  end if;
  select * into item from public.email_outbox e where e.id=p_id and e.status='sending'
    and e.lease_token=p_lease_token for update;
  if not found then return; end if;
  next_status := p_outcome;
  if p_outcome='retry' and item.attempt_count >= item.max_attempts then next_status := 'failed'; end if;
  if p_outcome <> 'accepted' and item.expires_at <= now() then next_status := 'expired'; end if;
  if p_outcome='accepted' and item.mark_result_notified and item.submission_id is not null then
    update public.submissions set result_notified_at=now()
      where id=item.submission_id and updated_at <= item.created_at;
  end if;
  delay_seconds := least(3600, greatest(30 * power(2, least(item.attempt_count-1,7))::integer,
    least(greatest(coalesce(p_retry_after_seconds,0),0),3600)));
  return query update public.email_outbox e set
    status=next_status,
    html=case when next_status in ('accepted','expired') then null else e.html end,
    provider_message_id=case when p_message_id ~ '^[A-Za-z0-9_-]{1,128}$' then p_message_id else null end,
    last_error_reason=case when p_outcome='accepted' then null else p_error_reason end,
    last_error_code=case when p_outcome='accepted' then null else p_error_code end,
    accepted_at=case when p_outcome='accepted' then now() else e.accepted_at end,
    next_attempt_at=case when next_status='retry' then now()+make_interval(secs=>delay_seconds) else e.next_attempt_at end,
    lease_token=null, lease_expires_at=null, updated_at=now()
    where e.id=item.id returning e.*;
end $$;

create function public.retry_email_outbox(p_id uuid, p_allow_uncertain boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare item public.email_outbox;
begin
  perform public.maintain_email_outbox();
  select * into item from public.email_outbox e where e.id=p_id for update;
  if not found then raise exception using errcode='P0002', message='Email not found'; end if;
  if item.status='uncertain' and not p_allow_uncertain then
    raise exception using errcode='22023', message='Explicit duplicate-risk acknowledgement required';
  end if;
  if item.status not in ('failed','retry','uncertain') or item.html is null or item.expires_at <= now() then
    raise exception using errcode='22023', message='Email is not retryable';
  end if;
  update public.email_outbox set status='pending', next_attempt_at=now(), updated_at=now(),
    max_attempts=greatest(max_attempts,attempt_count+1), lease_token=null, lease_expires_at=null
    where id=p_id;
  return jsonb_build_object('id',p_id,'status','pending');
end $$;

create function public.email_outbox_stats() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'pending',count(*) filter(where status='pending'), 'sending',count(*) filter(where status='sending'),
    'retry',count(*) filter(where status='retry'), 'accepted',count(*) filter(where status='accepted'),
    'uncertain',count(*) filter(where status='uncertain'), 'failed',count(*) filter(where status='failed'),
    'expired',count(*) filter(where status='expired'),
    'oldestPendingAt',min(created_at) filter(where status in ('pending','retry'))
  ) into result from public.email_outbox;
  return result;
end $$;

revoke all on function public.maintain_email_outbox() from public, anon, authenticated;
revoke all on function public.enqueue_email_outbox(text,text,text,text,text,text,text,timestamptz,uuid,boolean) from public, anon, authenticated;
revoke all on function public.claim_email_outbox(integer,uuid) from public, anon, authenticated;
revoke all on function public.finish_email_outbox(uuid,uuid,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.retry_email_outbox(uuid,boolean) from public, anon, authenticated;
revoke all on function public.email_outbox_stats() from public, anon, authenticated;
grant execute on function public.maintain_email_outbox(), public.enqueue_email_outbox(text,text,text,text,text,text,text,timestamptz,uuid,boolean),
  public.claim_email_outbox(integer,uuid), public.finish_email_outbox(uuid,uuid,text,text,text,text,integer),
  public.retry_email_outbox(uuid,boolean), public.email_outbox_stats() to service_role;
