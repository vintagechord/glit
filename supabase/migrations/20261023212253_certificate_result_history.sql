-- Preserve replaced result references in the existing event history. Human
-- messages remain readable; details contain object keys, never signed URLs.
alter table public.submission_events add column if not exists details jsonb not null default '{}';

create function public.record_submission_certificate(
  p_submission_id uuid, p_actor_user_id uuid, p_object_key text,
  p_original_name text, p_mime_type text, p_size_bytes bigint,
  p_uploaded_at timestamptz
)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  s public.submissions%rowtype;
  previous_file jsonb;
begin
  -- Only the guarded server can call this function. Recheck the administrator
  -- supplied by getUser rather than trusting client-controlled profile metadata.
  if not exists(select 1 from public.profiles where user_id = p_actor_user_id and role = 'admin') then
    raise exception 'CERTIFICATE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into s from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
  if s.type <> 'MV_DISTRIBUTION' then raise exception 'CERTIFICATE_TYPE_INVALID'; end if;
  if p_object_key is null or length(p_object_key) > 1024
    or p_object_key ~ '[:?[:cntrl:]]' or p_object_key ~ '(^|/)\.\.(/|$)'
    or p_object_key !~ ('(^|/)' || s.id::text || '/certificate/[0-9a-f-]{36}_[A-Za-z0-9._-]{1,120}$')
    or coalesce(length(btrim(p_original_name)), 0) not between 1 and 255
    or p_mime_type is null or p_mime_type not in ('application/pdf', 'image/png', 'image/jpeg')
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520
    or p_uploaded_at is null then
    raise exception 'CERTIFICATE_FILE_INVALID';
  end if;
  if s.certificate_b2_path = p_object_key then
    if s.certificate_original_name is distinct from p_original_name
      or s.certificate_mime is distinct from p_mime_type
      or s.certificate_size is distinct from p_size_bytes
      or s.certificate_uploaded_at is distinct from p_uploaded_at then
      raise exception 'CERTIFICATE_FILE_CONFLICT';
    end if;
    return jsonb_build_object('ok', true);
  end if;
  previous_file := case when nullif(btrim(s.certificate_b2_path), '') is not null then
    jsonb_build_object('objectKey', s.certificate_b2_path, 'originalName', s.certificate_original_name,
      'mimeType', s.certificate_mime, 'sizeBytes', s.certificate_size, 'uploadedAt', s.certificate_uploaded_at)
    else null end;
  update public.submissions set certificate_b2_path = p_object_key,
    certificate_original_name = p_original_name, certificate_mime = p_mime_type,
    certificate_size = p_size_bytes, certificate_uploaded_at = p_uploaded_at
    where id = s.id;
  insert into public.submission_events(submission_id, actor_user_id, event_type, message, details)
    values(s.id, p_actor_user_id, 'CERTIFICATE_UPLOADED',
      case when previous_file is null then '필증을 등록했습니다.' else '필증을 교체했습니다. 이전 결과 파일과 이력은 보존됩니다.' end,
      jsonb_build_object('previous', previous_file, 'current', jsonb_build_object(
        'objectKey', p_object_key, 'originalName', p_original_name, 'mimeType', p_mime_type,
        'sizeBytes', p_size_bytes, 'uploadedAt', p_uploaded_at)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.record_submission_certificate(uuid,uuid,text,text,text,bigint,timestamptz) from public, anon, authenticated;
grant execute on function public.record_submission_certificate(uuid,uuid,text,text,text,bigint,timestamptz) to service_role;
