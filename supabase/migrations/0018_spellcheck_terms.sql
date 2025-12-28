create table if not exists public.spellcheck_terms (
  id uuid primary key default gen_random_uuid(),
  from_text text not null,
  to_text text not null,
  language text not null default 'KO',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spellcheck_terms_language_idx
  on public.spellcheck_terms (language);

create index if not exists spellcheck_terms_active_idx
  on public.spellcheck_terms (is_active);

alter table public.spellcheck_terms enable row level security;

do $$
begin
  create policy "Public read spellcheck terms"
    on public.spellcheck_terms
    for select
    using (is_active = true);
exception
  when duplicate_object then
    null;
end $$;
