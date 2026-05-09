alter table public.karaoke_requests
  add column if not exists recommendation_public boolean not null default false,
  add column if not exists recommendation_url text;

alter table public.karaoke_promotions
  add column if not exists karaoke_request_id uuid references public.karaoke_requests on delete cascade;

alter table public.karaoke_promotions
  alter column submission_id drop not null;

create unique index if not exists karaoke_promotions_request_key
  on public.karaoke_promotions (karaoke_request_id)
  where karaoke_request_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'karaoke_promotions_target_required'
      and conrelid = 'public.karaoke_promotions'::regclass
  ) then
    alter table public.karaoke_promotions
      add constraint karaoke_promotions_target_required
      check (submission_id is not null or karaoke_request_id is not null);
  end if;
end $$;
