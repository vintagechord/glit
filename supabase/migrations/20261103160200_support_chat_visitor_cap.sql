-- A tokenless POST /api/chat opened a new conversation every time, so junk
-- threads could bury real ones in the admin list. The API now caps open
-- conversations per member, and per network address for guests. Guests are
-- matched by visitor_key: an HMAC of the client address computed by the app,
-- so the raw address is never stored.
alter table public.support_chat_conversations
  add column if not exists visitor_key text
    check (visitor_key is null or visitor_key ~ '^[a-f0-9]{64}$');

create index if not exists support_chat_conversations_open_visitor_idx
  on public.support_chat_conversations (visitor_key)
  where visitor_key is not null and visitor_left_at is null and status <> 'CLOSED';

create index if not exists support_chat_conversations_open_user_idx
  on public.support_chat_conversations (user_id)
  where user_id is not null and visitor_left_at is null and status <> 'CLOSED';

-- Admin list pages order by the latest message, newest first, with a stable
-- tiebreak so "load more" never repeats or skips a conversation.
create index if not exists support_chat_conversations_admin_list_idx
  on public.support_chat_conversations (last_message_at desc, id desc);

create index if not exists support_inquiries_admin_list_idx
  on public.support_inquiries (created_at desc, id desc);
