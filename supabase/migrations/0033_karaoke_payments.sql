create table if not exists public.karaoke_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.karaoke_requests on delete cascade,
  user_id uuid references auth.users on delete set null,
  order_id text not null,
  amount_krw integer not null default 0,
  status text not null default 'REQUESTED',
  pg_tid text,
  result_code text,
  result_message text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create unique index if not exists karaoke_payments_order_id_key
  on public.karaoke_payments (order_id);

create index if not exists karaoke_payments_request_idx
  on public.karaoke_payments (request_id);

alter table public.karaoke_payments enable row level security;

do $$
begin
  create policy "Karaoke payments readable"
    on public.karaoke_payments
    for select
    using (user_id = auth.uid() or public.is_admin());
exception
  when duplicate_object then
    null;
end $$;

do $$
begin
  create policy "Karaoke payments manageable by admin"
    on public.karaoke_payments
    for all
    using (public.is_admin())
    with check (public.is_admin());
exception
  when duplicate_object then
    null;
end $$;

alter table public.karaoke_requests
  add column if not exists order_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists pg_tid text,
  add column if not exists payment_result_code text,
  add column if not exists payment_result_message text,
  add column if not exists payment_raw_response jsonb;

create index if not exists karaoke_requests_order_id_idx
  on public.karaoke_requests (order_id);
