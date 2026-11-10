-- Mail the operations mailbox when a customer's chat message has waited a
-- minute without an administrator reading it, so a question is not missed
-- while nobody has /admin/chat open. An administrator who has the
-- conversation open reads new messages within seconds (realtime signal), so
-- no mail goes out during a live chat.
--
-- One notice per unanswered stretch: after a notice, the conversation is not
-- mailed again until an administrator reads or answers it. Only visitor
-- messages from the last day count, so old unread threads are not mailed
-- when this ships.

alter table public.support_chat_conversations
  add column if not exists admin_read_at timestamptz,
  add column if not exists admin_notified_at timestamptz;

comment on column public.support_chat_conversations.admin_read_at is
  'When an administrator last read or answered the conversation.';
comment on column public.support_chat_conversations.admin_notified_at is
  'When the operations mailbox was last told about unread visitor messages.';

create index if not exists support_chat_conversations_unread_admin_idx
  on public.support_chat_conversations (last_message_at)
  where unread_admin_count > 0;

create or replace function public.support_chat_admin_notice_due(
  p_conversation public.support_chat_conversations
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_conversation.unread_admin_count > 0
     and coalesce(p_conversation.admin_notified_at, '-infinity'::timestamptz)
         <= coalesce(p_conversation.admin_read_at, '-infinity'::timestamptz)
     and exists (
       select 1
         from public.support_chat_messages m
        where m.conversation_id = p_conversation.id
          and m.sender_type = 'VISITOR'
          and m.created_at > coalesce(p_conversation.admin_read_at, '-infinity'::timestamptz)
          and m.created_at > now() - interval '1 day'
          and m.created_at <= now() - interval '1 minute');
$$;

-- Claims due conversations by stamping admin_notified_at. The app mails each
-- claim and releases it (restoring the previous stamp) only when the mail
-- could not be stored in the outbox.
create or replace function public.claim_support_chat_admin_notices(p_limit integer default 20)
returns table (conversation_id uuid, claimed_at timestamptz, previous_notified_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  with due as (
    select c.id, c.admin_notified_at as previous
      from public.support_chat_conversations c
     where c.unread_admin_count > 0
       and public.support_chat_admin_notice_due(c)
     order by c.last_message_at
     limit greatest(1, least(coalesce(p_limit, 20), 50))
       for update of c skip locked
  )
  update public.support_chat_conversations c
     set admin_notified_at = now()
    from due
   where c.id = due.id
  returning c.id, c.admin_notified_at, due.previous;
end;
$$;

create or replace function public.release_support_chat_admin_notice(
  p_conversation_id uuid,
  p_claimed_at timestamptz,
  p_previous_notified_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_released integer;
begin
  update public.support_chat_conversations
     set admin_notified_at = p_previous_notified_at
   where id = p_conversation_id
     and admin_notified_at = p_claimed_at;
  get diagnostics v_released = row_count;
  return v_released > 0;
end;
$$;

revoke all on function public.support_chat_admin_notice_due(public.support_chat_conversations)
  from public, anon, authenticated;
revoke all on function public.claim_support_chat_admin_notices(integer)
  from public, anon, authenticated;
revoke all on function public.release_support_chat_admin_notice(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.support_chat_admin_notice_due(public.support_chat_conversations)
  to service_role;
grant execute on function public.claim_support_chat_admin_notices(integer)
  to service_role;
grant execute on function public.release_support_chat_admin_notice(uuid, timestamptz, timestamptz)
  to service_role;

-- pg_cron wakes the app (/api/internal/background-jobs with the
-- support-chat-notices task) every minute, but only while a notice is due.
-- The shared scheduler token is checked by authorize_email_worker.
create or replace function public.dispatch_support_chat_notices()
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
       select 1 from public.support_chat_conversations c
        where c.unread_admin_count > 0
          and public.support_chat_admin_notice_due(c))
  then return; end if;

  select net.http_post(
    url := regexp_replace(v_config.endpoint_url, '/api/internal/email-outbox$', '/api/internal/background-jobs'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_config.token),
    body := '{"task":"support-chat-notices"}'::jsonb,
    timeout_milliseconds := 10000) into v_request;
end;
$$;

revoke all on function public.dispatch_support_chat_notices() from public, anon, authenticated;
-- Only postgres cron owns dispatch; the web worker cannot read net responses.

do $$ begin
  if exists(select 1 from pg_extension where extname = 'pg_cron')
     and exists(select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('onside-support-chat-notices', '* * * * *', 'select public.dispatch_support_chat_notices()');
  end if;
end $$;
