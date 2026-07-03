alter table public.support_chat_conversations
  add column if not exists visitor_left_at timestamptz;

create index if not exists support_chat_conversations_active_user_idx
  on public.support_chat_conversations (user_id, last_message_at desc)
  where user_id is not null and visitor_left_at is null;

create index if not exists support_chat_conversations_active_token_idx
  on public.support_chat_conversations (access_token)
  where visitor_left_at is null;
