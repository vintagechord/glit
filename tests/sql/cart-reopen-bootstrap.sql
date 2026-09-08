-- Minimal isolated schema matching the production columns used by 0096.
create role anon;
create role authenticated;
create role service_role bypassrls;
create type submission_type as enum ('ALBUM', 'MV_DISTRIBUTION', 'MV_BROADCAST');
create type submission_status as enum ('DRAFT', 'SUBMITTED', 'PRE_REVIEW', 'WAITING_PAYMENT', 'IN_PROGRESS', 'RESULT_READY', 'COMPLETED');
create type payment_status as enum ('UNPAID', 'PAYMENT_PENDING', 'PAID', 'REFUNDED');
create type payment_method as enum ('BANK', 'CARD', 'PAYPAL');
create type submission_payment_status as enum ('REQUESTED', 'APPROVED', 'FAILED', 'CANCELED');
create type station_review_status as enum ('NOT_SENT', 'SENT', 'RECEIVED', 'APPROVED', 'REJECTED', 'NEEDS_FIX');
create table public.submissions (
  id uuid primary key,
  user_id uuid,
  guest_token text,
  type submission_type not null default 'ALBUM',
  album_draft_group_id uuid,
  user_deleted_at timestamptz,
  status submission_status not null default 'WAITING_PAYMENT',
  payment_status payment_status not null default 'PAYMENT_PENDING',
  payment_method payment_method not null default 'BANK',
  result_status text,
  result_notified_at timestamptz,
  amount_krw integer not null default 50000,
  title text default 'Preserve this title',
  applicant_email text default 'fixture@example.test',
  album_price_tier text default 'FULL',
  album_base_price_krw integer default 50000
);
create table public.submission_payments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions,
  status submission_payment_status not null,
  raw_response jsonb
);
create table public.station_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions,
  status station_review_status not null default 'NOT_SENT'
);
create table public.submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions,
  actor_user_id uuid,
  event_type text not null,
  message text
);
create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions,
  file_path text not null,
  original_name text not null
);
grant usage on schema public to service_role;
grant select, insert, update on all tables in schema public to service_role;
