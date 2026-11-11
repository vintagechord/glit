-- Administrators open the original of every mail sent to a customer, so the
-- body stays with its outbox row until the row's 30-day retention ends.
-- Sign-up verification and password reset mail carry live sign-in links;
-- their bodies are still removed as soon as they are delivered or expire.
-- Nothing re-sends a kept body: claim_email_outbox takes only pending/retry
-- rows and retry_email_outbox refuses accepted and expired ones.

create or replace function public.maintain_email_outbox() returns integer
language plpgsql security invoker set search_path = '' as $$
declare changed integer := 0; affected integer;
begin
  -- A worker may have sent before it disappeared. Never reclaim such work as
  -- retryable: SMTP cannot prove whether the remote server already accepted it.
  update public.email_outbox set status='uncertain', lease_token=null, lease_expires_at=null,
    last_error_reason='delivery', last_error_code='lease_expired', updated_at=now()
  where status='sending' and lease_expires_at <= now();
  get diagnostics affected = row_count; changed := changed + affected;
  update public.email_outbox set status='expired',
    html=case when operation in ('signup verification','password reset') then null else html end,
    lease_token=null, lease_expires_at=null, last_error_code='payload_expired', updated_at=now()
  where status in ('pending','retry','failed','uncertain') and expires_at <= now();
  get diagnostics affected = row_count; changed := changed + affected;
  delete from public.email_outbox where status in ('accepted','failed','uncertain','expired')
    and created_at < now() - interval '30 days';
  get diagnostics affected = row_count;
  return changed + affected;
end $$;

create or replace function public.finish_email_outbox(
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
    html=case when next_status in ('accepted','expired')
      and e.operation in ('signup verification','password reset') then null else e.html end,
    provider_message_id=case when p_message_id ~ '^[A-Za-z0-9_-]{1,128}$' then p_message_id else null end,
    last_error_reason=case when p_outcome='accepted' then null else p_error_reason end,
    last_error_code=case when p_outcome='accepted' then null else p_error_code end,
    accepted_at=case when p_outcome='accepted' then now() else e.accepted_at end,
    next_attempt_at=case when next_status='retry' then now()+make_interval(secs=>delay_seconds) else e.next_attempt_at end,
    lease_token=null, lease_expires_at=null, updated_at=now()
    where e.id=item.id returning e.*;
end $$;

revoke all on function public.maintain_email_outbox() from public, anon, authenticated;
revoke all on function public.finish_email_outbox(uuid,uuid,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.maintain_email_outbox(), public.finish_email_outbox(uuid,uuid,text,text,text,text,integer) to service_role;
