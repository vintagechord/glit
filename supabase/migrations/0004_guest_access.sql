alter table public.submissions
  alter column user_id drop not null;

alter table public.submissions
  add column if not exists guest_name text,
  add column if not exists guest_company text,
  add column if not exists guest_email text,
  add column if not exists guest_phone text,
  add column if not exists guest_token text;

create unique index if not exists submissions_guest_token_key
  on public.submissions (guest_token);

alter table public.karaoke_requests
  alter column user_id drop not null;

alter table public.karaoke_requests
  add column if not exists guest_name text,
  add column if not exists guest_email text,
  add column if not exists guest_phone text;
