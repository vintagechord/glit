do $$ begin
  create type subscription_status as enum ('PENDING', 'ACTIVE', 'PAUSED', 'CANCELED', 'FAILED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type subscription_billing_status as enum ('ACTIVE', 'INACTIVE');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type subscription_charge_status as enum ('REQUESTED', 'BILLKEY_ISSUED', 'APPROVED', 'FAILED', 'CANCELED');
exception when duplicate_object then null;
end $$;

create table if not exists public.subscription_billing (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  status subscription_billing_status not null default 'ACTIVE',
  bill_key text not null,
  pg_mid text not null,
  pg_tid text,
  card_code text,
  card_name text,
  card_number text,
  card_quota text,
  last_result_code text,
  last_result_message text,
  last_billed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscription_billing_active_user_idx
  on public.subscription_billing (user_id)
  where status = 'ACTIVE';

drop trigger if exists set_subscription_billing_updated_at on public.subscription_billing;
create trigger set_subscription_billing_updated_at
before update on public.subscription_billing
for each row execute procedure public.set_updated_at();

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  billing_id uuid references public.subscription_billing on delete set null,
  status subscription_status not null default 'PENDING',
  amount_krw integer not null default 0,
  interval_months integer not null default 1,
  product_name text,
  next_billing_at timestamptz,
  last_billed_at timestamptz,
  started_at timestamptz not null default now(),
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

drop trigger if exists set_subscriptions_updated_at_new on public.subscriptions;
create trigger set_subscriptions_updated_at_new
before update on public.subscriptions
for each row execute procedure public.set_updated_at();

create table if not exists public.subscription_history (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions on delete set null,
  billing_id uuid references public.subscription_billing on delete set null,
  user_id uuid not null references auth.users on delete cascade,
  order_id text not null,
  pg_tid text,
  status subscription_charge_status not null default 'REQUESTED',
  amount_krw integer not null default 0,
  product_name text,
  result_code text,
  result_message text,
  raw_response jsonb,
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists subscription_history_order_id_idx
  on public.subscription_history (order_id);

create index if not exists subscription_history_user_idx
  on public.subscription_history (user_id);

alter table public.subscription_billing enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_history enable row level security;

drop policy if exists "Subscription billing readable by owner or admin" on public.subscription_billing;
create policy "Subscription billing readable by owner or admin"
on public.subscription_billing
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Subscription billing writeable by owner or admin" on public.subscription_billing;
create policy "Subscription billing writeable by owner or admin"
on public.subscription_billing
for all
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Subscriptions readable by owner or admin" on public.subscriptions;
create policy "Subscriptions readable by owner or admin"
on public.subscriptions
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Subscriptions writeable by owner or admin" on public.subscriptions;
create policy "Subscriptions writeable by owner or admin"
on public.subscriptions
for all
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Subscription history readable by owner or admin" on public.subscription_history;
create policy "Subscription history readable by owner or admin"
on public.subscription_history
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Subscription history writeable by owner or admin" on public.subscription_history;
create policy "Subscription history writeable by owner or admin"
on public.subscription_history
for all
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());
