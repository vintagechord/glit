create table if not exists public.support_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  access_token text not null unique,
  user_id uuid references auth.users on delete set null,
  guest_name text,
  guest_email text,
  guest_phone text,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'WAITING_ADMIN', 'WAITING_VISITOR', 'CLOSED')),
  last_message_preview text,
  last_message_at timestamptz not null default now(),
  unread_admin_count integer not null default 0,
  unread_visitor_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_chat_conversations on delete cascade,
  sender_type text not null check (sender_type in ('VISITOR', 'ADMIN', 'SYSTEM')),
  sender_user_id uuid references auth.users on delete set null,
  sender_name text,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists support_chat_conversations_last_message_idx
  on public.support_chat_conversations (last_message_at desc);

create index if not exists support_chat_conversations_status_idx
  on public.support_chat_conversations (status);

create index if not exists support_chat_conversations_user_idx
  on public.support_chat_conversations (user_id)
  where user_id is not null;

create index if not exists support_chat_messages_conversation_idx
  on public.support_chat_messages (conversation_id, created_at asc);

drop trigger if exists set_support_chat_conversations_updated_at on public.support_chat_conversations;
create trigger set_support_chat_conversations_updated_at
before update on public.support_chat_conversations
for each row execute procedure public.set_updated_at();

alter table public.support_chat_conversations enable row level security;
alter table public.support_chat_messages enable row level security;

drop policy if exists "Support chat conversations readable by owner or admin" on public.support_chat_conversations;
create policy "Support chat conversations readable by owner or admin"
on public.support_chat_conversations
for select
using (public.is_admin() or user_id = auth.uid());

drop policy if exists "Support chat conversations manageable by admin" on public.support_chat_conversations;
create policy "Support chat conversations manageable by admin"
on public.support_chat_conversations
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Support chat messages readable by owner or admin" on public.support_chat_messages;
create policy "Support chat messages readable by owner or admin"
on public.support_chat_messages
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.support_chat_conversations c
    where c.id = support_chat_messages.conversation_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "Support chat messages manageable by admin" on public.support_chat_messages;
create policy "Support chat messages manageable by admin"
on public.support_chat_messages
for all
using (public.is_admin())
with check (public.is_admin());
