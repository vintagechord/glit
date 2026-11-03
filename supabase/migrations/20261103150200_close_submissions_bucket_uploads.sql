-- Applicant files go to B2 through owner-bound, size-limited grants, and
-- /api/upload-url, the last route that signed Supabase uploads, answers 410.
-- The 0003 policy still let any signed-in member write objects of any size
-- under submissions/<own uid>/ straight from the browser. No code uploads to
-- this bucket any more: the app only creates signed downloads for legacy
-- files, which the select policy and the service role keep serving.
do $$
begin
  drop policy if exists "Submission files are insertable by owner" on storage.objects;
exception
  when insufficient_privilege then
    raise notice 'Skipping policy drop (insufficient_privilege) on storage.objects: Submission files are insertable by owner';
end $$;
