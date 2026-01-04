-- artists table and submission FK/backfill

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artists_name_unique unique (name)
);

create index if not exists artists_slug_idx on public.artists using btree (slug);

alter table public.submissions
  add column if not exists artist_id uuid references public.artists(id);

-- Simple slug generator
create or replace function public.slugify(input text)
returns text language sql immutable as $$
  select regexp_replace(lower(trim(input)), '[^a-z0-9]+', '-', 'g');
$$;

-- Seed artists from existing submissions (distinct names)
insert into public.artists (name, slug)
select distinct artist_name, public.slugify(artist_name)
from public.submissions
where artist_name is not null and trim(artist_name) <> ''
on conflict (name) do nothing;

-- Backfill submissions.artist_id
update public.submissions s
set artist_id = a.id
from public.artists a
where s.artist_name = a.name
  and s.artist_id is null;

