do $$
declare
  target record;
  constraint_name text;
begin
  for target in
    select *
    from (
      values
        ('album_tracks', 'submission_id'),
        ('submission_files', 'submission_id'),
        ('station_reviews', 'submission_id'),
        ('submission_events', 'submission_id'),
        ('submission_payments', 'submission_id'),
        ('karaoke_promotions', 'submission_id'),
        ('magazine_requests', 'submission_id')
    ) as t(table_name, column_name)
  loop
    if to_regclass(format('public.%I', target.table_name)) is null then
      continue;
    end if;

    select con.conname
      into constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join unnest(con.conkey) with ordinality as cols(attnum, ordinality) on true
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = cols.attnum
    where con.contype = 'f'
      and nsp.nspname = 'public'
      and rel.relname = target.table_name
      and con.confrelid = 'public.submissions'::regclass
      and att.attname = target.column_name
    limit 1;

    if constraint_name is not null then
      execute format(
        'alter table public.%I drop constraint %I',
        target.table_name,
        constraint_name
      );
    end if;

    execute format(
      'delete from public.%I child where child.%I is not null and not exists (select 1 from public.submissions s where s.id = child.%I)',
      target.table_name,
      target.column_name,
      target.column_name
    );

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.submissions(id) on delete cascade',
      target.table_name,
      target.table_name || '_' || target.column_name || '_fkey',
      target.column_name
    );
  end loop;
end $$;
