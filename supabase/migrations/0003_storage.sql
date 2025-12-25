insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

create policy "Submission files are readable by owner"
on storage.objects
for select
using (
  bucket_id = 'submissions'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

create policy "Submission files are insertable by owner"
on storage.objects
for insert
with check (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Submission files are deletable by admin"
on storage.objects
for delete
using (
  bucket_id = 'submissions'
  and public.is_admin()
);
