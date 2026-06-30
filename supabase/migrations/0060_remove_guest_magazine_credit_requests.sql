drop index if exists public.magazine_requests_guest_token_idx;

alter table if exists public.magazine_requests
  drop column if exists guest_token;
