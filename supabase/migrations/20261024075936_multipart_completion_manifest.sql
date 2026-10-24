-- First apply 0081_multipart_upload_grants.sql. This additive receipt does not
-- change the existing claim RPC used by paid-material supplements.
alter table public.multipart_upload_grants
  add column if not exists completion_manifest_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.multipart_upload_grants'::regclass and conname = 'multipart_completion_manifest_hash_valid') then
    alter table public.multipart_upload_grants add constraint multipart_completion_manifest_hash_valid
      check (completion_manifest_hash is null or completion_manifest_hash ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- A unique name avoids overloaded PostgREST RPC resolution. The verified
-- server computes the manifest; browsers cannot execute this function or read
-- grants. A same-manifest replay never starts a second database claim.
create or replace function public.claim_multipart_upload_completion(
  p_grant_id uuid, p_submission_id uuid, p_upload_id text,
  p_object_key text, p_owner_key text, p_part_numbers integer[],
  p_manifest_hash text
)
returns text language plpgsql security invoker set search_path = public, pg_temp
as $$
declare g public.multipart_upload_grants%rowtype;
begin
  select * into g from public.multipart_upload_grants where id = p_grant_id for update;
  if not found or g.submission_id is distinct from p_submission_id
    or g.upload_id is distinct from p_upload_id or g.object_key is distinct from p_object_key
    or g.owner_key is distinct from p_owner_key then
    raise exception 'MULTIPART_GRANT_MISMATCH' using errcode = '42501';
  end if;
  if g.expires_at <= now() then raise exception 'MULTIPART_GRANT_EXPIRED' using errcode = '57014'; end if;
  if cardinality(coalesce(p_part_numbers, '{}'::integer[])) <> g.part_count
    or exists (select 1 from unnest(p_part_numbers) n where n is null or n < 1 or n > g.part_count)
    or (select count(distinct n) from unnest(p_part_numbers) n) <> g.part_count then
    raise exception 'MULTIPART_PARTS_MISMATCH' using errcode = '22023';
  end if;
  if p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'MULTIPART_MANIFEST_INVALID' using errcode = '22023';
  end if;
  if g.status = 'ACTIVE' then
    if g.completion_manifest_hash is not null and g.completion_manifest_hash <> p_manifest_hash then
      raise exception 'MULTIPART_MANIFEST_MISMATCH' using errcode = '55000';
    end if;
    update public.multipart_upload_grants set status = 'COMPLETING', completion_manifest_hash = p_manifest_hash, updated_at = now() where id = g.id;
    return 'START';
  end if;
  if g.status not in ('COMPLETING', 'COMPLETED') then
    raise exception 'MULTIPART_GRANT_NOT_ACTIVE' using errcode = '55000';
  end if;
  -- Legacy completions have no ETag receipt and cannot be safely replayed.
  if g.completion_manifest_hash is null or g.completion_manifest_hash <> p_manifest_hash then
    raise exception 'MULTIPART_MANIFEST_MISMATCH' using errcode = '55000';
  end if;
  return g.status;
end;
$$;
revoke all on function public.claim_multipart_upload_completion(uuid,uuid,text,text,text,integer[],text) from public, anon, authenticated;
grant execute on function public.claim_multipart_upload_completion(uuid,uuid,text,text,text,integer[],text) to service_role;
notify pgrst, 'reload schema';
