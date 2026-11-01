-- The fixture must reproduce the production exposure before the fix runs.
begin;
set local role anon;
do $$
begin
  if (select count(*) from public.artists) <> 3 then
    raise exception 'fixture: anon should read every artist before the fix';
  end if;
end;
$$;
insert into public.artists (name) values ('Anon Write Before Fix');
rollback;
