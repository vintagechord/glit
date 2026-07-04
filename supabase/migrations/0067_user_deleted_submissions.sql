alter table public.submissions
  add column if not exists user_deleted_at timestamptz;

create index if not exists submissions_user_visible_idx
  on public.submissions (user_id, payment_status, updated_at desc)
  where user_deleted_at is null;
