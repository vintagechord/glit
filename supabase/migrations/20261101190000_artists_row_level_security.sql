-- public.artists was created in 0028 without row level security, so the
-- default Supabase grants let the public anon key read and change every row.
-- Server code writes artists with the service role. Members only read the
-- artists linked to their own submissions (dashboard history embeds them).

alter table public.artists enable row level security;

revoke all on table public.artists from public, anon, authenticated;
grant select on table public.artists to authenticated;
grant all on table public.artists to service_role;

drop policy if exists "Artists readable by submission owners" on public.artists;
create policy "Artists readable by submission owners"
on public.artists
for select
to authenticated
using (
  exists (
    select 1 from public.submissions s
    where s.artist_id = artists.id
      and s.user_id = (select auth.uid())
  )
);

create index if not exists submissions_artist_id_idx on public.submissions (artist_id);
