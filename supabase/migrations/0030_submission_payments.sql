do $$ begin
  create type submission_payment_status as enum ('REQUESTED', 'APPROVED', 'FAILED', 'CANCELED');
exception when duplicate_object then null;
end $$;

create table if not exists public.submission_payments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  order_id text not null,
  amount_krw integer not null default 0,
  status submission_payment_status not null default 'REQUESTED',
  pg_tid text,
  result_code text,
  result_message text,
  raw_response jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists submission_payments_order_id_key on public.submission_payments (order_id);
create index if not exists submission_payments_submission_idx on public.submission_payments (submission_id);
create index if not exists submission_payments_user_idx on public.submission_payments (user_id);

drop trigger if exists set_submission_payments_updated_at on public.submission_payments;
create trigger set_submission_payments_updated_at
before update on public.submission_payments
for each row execute procedure public.set_updated_at();

alter table public.submission_payments enable row level security;

drop policy if exists "Submission payments readable by owner or admin" on public.submission_payments;
create policy "Submission payments readable by owner or admin"
on public.submission_payments
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Submission payments writeable by owner or admin" on public.submission_payments;
create policy "Submission payments writeable by owner or admin"
on public.submission_payments
for all
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());
