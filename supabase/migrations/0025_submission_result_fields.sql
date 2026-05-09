-- Add submission-level result fields for admin result entry and notifications
alter table if exists public.submissions
  add column if not exists result_status text,
  add column if not exists result_memo text,
  add column if not exists result_notified_at timestamptz;

create index if not exists submissions_result_status_idx
  on public.submissions (result_status);

create index if not exists submissions_result_notified_at_idx
  on public.submissions (result_notified_at);
