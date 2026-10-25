-- Backward-compatible additive API: normal mail keeps the existing enqueue RPC.
-- Attachment payloads remain private B2 objects; no base64 enters the database.
alter table public.email_outbox add column attachment_refs jsonb not null default '[]'::jsonb;
alter table public.email_outbox add constraint email_attachment_refs_bounded check (
  jsonb_typeof(attachment_refs) = 'array' and jsonb_array_length(attachment_refs) in (0,3)
  and octet_length(attachment_refs::text) <= 16000
);

create function public.enqueue_email_outbox_with_attachments(
  p_idempotency_key text, p_provider text, p_recipient_email text, p_subject text,
  p_html text, p_reply_to text, p_operation text, p_expires_at timestamptz,
  p_submission_id uuid, p_mark_result_notified boolean, p_attachment_refs jsonb
) returns setof public.email_outbox
language plpgsql security invoker set search_path = '' as $$
declare item public.email_outbox; entry jsonb; total_bytes bigint := 0; kinds text[] := '{}';
begin
  if p_operation not in ('review result','submission update') or p_submission_id is null
    or jsonb_typeof(p_attachment_refs) is distinct from 'array'
    or jsonb_array_length(p_attachment_refs) <> 3 or octet_length(p_attachment_refs::text) > 16000 then
    raise exception using errcode='22023', message='Invalid result attachments';
  end if;
  for entry in select value from jsonb_array_elements(p_attachment_refs) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or not (entry ?& array['kind','objectKey','filename','contentType','bytes','sha256','submissionId','rating','certificateKey'])
      or (select count(*) from jsonb_object_keys(entry)) <> 9
      or jsonb_typeof(entry->'bytes') is distinct from 'number'
      or exists(select 1 from jsonb_each(entry) fields where fields.key <> 'bytes' and jsonb_typeof(fields.value) <> 'string')
      or entry->>'kind' not in ('rating-image','usage-guide','certificate')
      or entry->>'submissionId' <> p_submission_id::text
      or entry->>'rating' not in ('ALL','12','15','18','19')
      or entry->>'sha256' !~ '^[a-f0-9]{64}$'
      or entry->>'bytes' !~ '^[1-9][0-9]{0,8}$'
      or entry->>'contentType' not in ('image/png','image/jpeg','application/pdf')
      or length(entry->>'filename') not between 1 and 180
      or entry->>'objectKey' ~ '(^/|://|\.\.|[[:cntrl:]])'
      or length(entry->>'objectKey') not between 1 and 1200
      or entry->>'certificateKey' is distinct from p_attachment_refs->0->>'certificateKey'
      or entry->>'rating' is distinct from p_attachment_refs->0->>'rating' then
      raise exception using errcode='22023', message='Invalid attachment reference';
    end if;
    kinds := array_append(kinds, entry->>'kind');
    total_bytes := total_bytes + (entry->>'bytes')::bigint;
  end loop;
  if total_bytes > 18874368 or (select count(distinct k) from unnest(kinds) k) <> 3 then
    raise exception using errcode='22023', message='Attachment bundle too large or incomplete';
  end if;
  select * into item from public.enqueue_email_outbox(p_idempotency_key,p_provider,p_recipient_email,p_subject,
    p_html,p_reply_to,p_operation,p_expires_at,p_submission_id,p_mark_result_notified);
  if item.attachment_refs <> '[]'::jsonb and item.attachment_refs is distinct from p_attachment_refs then
    raise exception using errcode='22023', message='Idempotency key attachment mismatch';
  end if;
  if item.attachment_refs = '[]'::jsonb then
    if item.status <> 'pending' or item.attempt_count <> 0 then
      raise exception using errcode='22023', message='Cannot attach after delivery started';
    end if;
    update public.email_outbox set attachment_refs=p_attachment_refs where id=item.id;
  end if;
  return query select e.* from public.email_outbox e where e.id=item.id;
end $$;
revoke all on function public.enqueue_email_outbox_with_attachments(text,text,text,text,text,text,text,timestamptz,uuid,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_email_outbox_with_attachments(text,text,text,text,text,text,text,timestamptz,uuid,boolean,jsonb) to service_role;

-- Attachments are downloaded and verified before SMTP begins; allow enough
-- lease time for bounded reads plus the relay's 55-second physical attempt.
create or replace function public.claim_email_outbox(p_limit integer default 5, p_id uuid default null)
returns setof public.email_outbox language plpgsql security invoker set search_path = '' as $$
begin
  perform public.maintain_email_outbox();
  return query
  with due as (
    select e.id from public.email_outbox e where e.status in ('pending','retry') and e.next_attempt_at <= now()
      and e.expires_at > now() and e.html is not null and e.attempt_count < e.max_attempts
      and (p_id is null or e.id=p_id)
    order by e.next_attempt_at,e.created_at limit least(greatest(coalesce(p_limit,5),1),20) for update skip locked
  ) update public.email_outbox e set status='sending',attempt_count=e.attempt_count+1,
      lease_token=gen_random_uuid(),lease_expires_at=now()+interval '180 seconds',last_attempt_at=now(),updated_at=now()
    from due where e.id=due.id returning e.*;
end $$;
