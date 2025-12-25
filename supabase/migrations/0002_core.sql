create extension if not exists "pgcrypto";

do $$ begin
  create type submission_type as enum ('ALBUM', 'MV_DISTRIBUTION', 'MV_BROADCAST');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type payment_status as enum ('UNPAID', 'PAYMENT_PENDING', 'PAID', 'REFUNDED');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type submission_status as enum ('DRAFT', 'SUBMITTED', 'PRE_REVIEW', 'WAITING_PAYMENT', 'IN_PROGRESS', 'RESULT_READY', 'COMPLETED');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type file_kind as enum ('AUDIO', 'VIDEO', 'LYRICS', 'ETC');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type station_review_status as enum ('NOT_SENT', 'SENT', 'RECEIVED', 'APPROVED', 'REJECTED', 'NEEDS_FIX');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  station_count integer not null,
  price_krw integer not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists packages_name_key on public.packages (name);

create table if not exists public.stations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists stations_code_key on public.stations (code);

create table if not exists public.package_stations (
  package_id uuid not null references public.packages on delete cascade,
  station_id uuid not null references public.stations on delete cascade,
  primary key (package_id, station_id)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  type submission_type not null,
  title text,
  artist_name text,
  release_date date,
  genre text,
  package_id uuid references public.packages,
  amount_krw integer not null default 0,
  pre_review_requested boolean not null default false,
  karaoke_requested boolean not null default false,
  payment_status payment_status not null default 'UNPAID',
  status submission_status not null default 'DRAFT',
  bank_depositor_name text,
  admin_memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.album_tracks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions on delete cascade,
  track_no integer not null,
  track_title text,
  featuring text,
  composer text,
  lyricist text,
  notes text,
  is_title boolean not null default false
);

create table if not exists public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions on delete cascade,
  kind file_kind not null,
  file_path text not null,
  original_name text,
  mime text,
  size bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.station_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions on delete cascade,
  station_id uuid not null references public.stations on delete cascade,
  status station_review_status not null default 'NOT_SENT',
  result_note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions on delete cascade,
  actor_user_id uuid references auth.users on delete set null,
  event_type text not null,
  message text,
  created_at timestamptz not null default now()
);

create trigger set_submissions_updated_at
before update on public.submissions
for each row execute procedure public.set_updated_at();

create trigger set_station_reviews_updated_at
before update on public.station_reviews
for each row execute procedure public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.can_access_submission(target_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.submissions s
    where s.id = target_id
      and (s.user_id = auth.uid() or public.is_admin())
  );
$$;

alter table public.packages enable row level security;
alter table public.stations enable row level security;
alter table public.package_stations enable row level security;
alter table public.submissions enable row level security;
alter table public.album_tracks enable row level security;
alter table public.submission_files enable row level security;
alter table public.station_reviews enable row level security;
alter table public.submission_events enable row level security;

create policy "Packages readable"
on public.packages
for select
using (true);

create policy "Stations readable"
on public.stations
for select
using (true);

create policy "Package stations readable"
on public.package_stations
for select
using (true);

create policy "Admin manages packages"
on public.packages
for all
using (public.is_admin())
with check (public.is_admin());

create policy "Admin manages stations"
on public.stations
for all
using (public.is_admin())
with check (public.is_admin());

create policy "Admin manages package stations"
on public.package_stations
for all
using (public.is_admin())
with check (public.is_admin());

create policy "Submissions readable"
on public.submissions
for select
using (user_id = auth.uid() or public.is_admin());

create policy "Submissions insertable"
on public.submissions
for insert
with check (user_id = auth.uid());

create policy "Submissions updatable"
on public.submissions
for update
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create policy "Tracks readable"
on public.album_tracks
for select
using (public.can_access_submission(submission_id));

create policy "Tracks insertable"
on public.album_tracks
for insert
with check (public.can_access_submission(submission_id));

create policy "Tracks updatable"
on public.album_tracks
for update
using (public.can_access_submission(submission_id))
with check (public.can_access_submission(submission_id));

create policy "Tracks deletable"
on public.album_tracks
for delete
using (public.can_access_submission(submission_id));

create policy "Files readable"
on public.submission_files
for select
using (public.can_access_submission(submission_id));

create policy "Files insertable"
on public.submission_files
for insert
with check (public.can_access_submission(submission_id));

create policy "Files deletable"
on public.submission_files
for delete
using (public.can_access_submission(submission_id));

create policy "Station reviews readable"
on public.station_reviews
for select
using (public.can_access_submission(submission_id));

create policy "Station reviews insertable"
on public.station_reviews
for insert
with check (public.can_access_submission(submission_id) and status = 'NOT_SENT');

create policy "Station reviews updatable"
on public.station_reviews
for update
using (public.is_admin())
with check (public.is_admin());

create policy "Submission events readable"
on public.submission_events
for select
using (public.can_access_submission(submission_id));

create policy "Submission events insertable"
on public.submission_events
for insert
with check (public.can_access_submission(submission_id));
