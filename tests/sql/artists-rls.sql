do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.artists'::regclass) then
    raise exception 'artists must have row level security enabled';
  end if;
end;
$$;

-- Anonymous API callers can neither read nor change artists.
begin;
set local role anon;
do $$
declare denied integer := 0;
begin
  begin perform 1 from public.artists; exception when insufficient_privilege then denied := denied + 1; end;
  begin insert into public.artists (name) values ('Anon Insert'); exception when insufficient_privilege then denied := denied + 1; end;
  begin update public.artists set name = 'Anon Rename'; exception when insufficient_privilege then denied := denied + 1; end;
  begin delete from public.artists; exception when insufficient_privilege then denied := denied + 1; end;
  if denied <> 4 then raise exception 'anon kept % of 4 artist privileges', 4 - denied; end if;
end;
$$;
rollback;

-- A member reads only the artist linked to their own submission, including
-- through the submissions join the dashboard history embed performs.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$
declare denied integer := 0;
begin
  if (select array_agg(name order by name) from public.artists) is distinct from array['Owner Artist'] then
    raise exception 'member must see only their own artist';
  end if;
  if (
    select array_agg(a.name order by a.name)
    from public.submissions s
    left join public.artists a on a.id = s.artist_id
  ) is distinct from array['Owner Artist'] then
    raise exception 'member history join must keep their own artist name';
  end if;
  begin insert into public.artists (name) values ('Member Insert'); exception when insufficient_privilege then denied := denied + 1; end;
  begin update public.artists set name = 'Member Rename'; exception when insufficient_privilege then denied := denied + 1; end;
  begin delete from public.artists; exception when insufficient_privilege then denied := denied + 1; end;
  if denied <> 3 then raise exception 'member kept % of 3 artist write privileges', 3 - denied; end if;
end;
$$;
rollback;

-- A member without submissions sees no artists at all.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
begin
  if exists (select 1 from public.artists) then
    raise exception 'member without submissions must not see artists';
  end if;
end;
$$;
rollback;

-- Server code keeps full access through the service role.
begin;
set local role service_role;
do $$
declare created uuid;
begin
  if (select count(*) from public.artists) <> 3 then
    raise exception 'service role must read every artist';
  end if;
  insert into public.artists (name, slug) values ('Service Artist', 'service-artist') returning id into created;
  update public.artists set name = 'Service Artist Renamed' where id = created;
  delete from public.artists where id = created;
  if exists (select 1 from public.artists where id = created) then
    raise exception 'service role delete did not apply';
  end if;
end;
$$;
rollback;
