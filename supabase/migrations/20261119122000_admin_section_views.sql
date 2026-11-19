-- 관리 메뉴의 "확인하지 않은 항목" 배지 (2026-11-19). Customer requests that
-- arrive without any alert (노래방 등록, 매거진 발행, 1:1 문의, 크레딧 서비스
-- 예약) were only noticed when the administrator happened to open that page.
-- The admin home now shows, on each menu card, how many pending requests
-- arrived since this administrator last opened the page. This table holds
-- that "last opened" time per administrator and page.
--
-- Chat (unread counters), mail (확인 완료) and payments already record what
-- was handled; they are counted from their own tables and need no row here.
create table if not exists public.admin_section_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  section text not null check (section ~ '^[a-z_]{1,40}$'),
  seen_at timestamptz not null default now(),
  primary key (user_id, section)
);

comment on table public.admin_section_views is
  'When each administrator last opened an admin page that lists customer requests. Read only by the admin home to count requests that arrived since.';

-- Written and read by the server with the service role, after the admin check.
alter table public.admin_section_views enable row level security;
revoke all on public.admin_section_views from public, anon, authenticated;
grant select, insert, update, delete on public.admin_section_views to service_role;
