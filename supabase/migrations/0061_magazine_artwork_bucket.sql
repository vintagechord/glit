insert into storage.buckets (id, name, public)
values ('magazine-artwork', 'magazine-artwork', true)
on conflict (id) do update
set public = excluded.public;

do $$
begin
  create policy "Magazine artwork public readable"
    on storage.objects
    for select
    using (bucket_id = 'magazine-artwork');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "Admin manages magazine artwork"
    on storage.objects
    for all
    using (bucket_id = 'magazine-artwork' and public.is_admin())
    with check (bucket_id = 'magazine-artwork' and public.is_admin());
exception
  when duplicate_object then null;
end $$;
