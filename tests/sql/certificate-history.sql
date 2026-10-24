insert into public.profiles values
  ('22222222-2222-4222-8222-222222222222', 'admin'),
  ('33333333-3333-4333-8333-333333333333', 'user');
insert into public.submissions(id,type,payment_status,result_status,certificate_b2_path,certificate_original_name,certificate_mime,certificate_size,certificate_uploaded_at)
values('11111111-1111-4111-8111-111111111111','MV_DISTRIBUTION','PAID','COMPLETED',
  'submissions/legacy/certificate.pdf','기존 필증.pdf','application/pdf',20,'2026-01-01T00:00:00Z');
insert into public.submission_files(submission_id,file_path,original_name)
values('11111111-1111-4111-8111-111111111111','submissions/original/master.mov','master.mov');
create temp table certificate_before as select to_jsonb(s) - array['certificate_b2_path','certificate_original_name','certificate_mime','certificate_size','certificate_uploaded_at'] as snapshot from public.submissions s;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if has_function_privilege(role_name, 'public.record_submission_certificate(uuid,uuid,text,text,text,bigint,timestamptz)', 'execute') then raise exception 'public certificate RPC exposed'; end if;
  end loop;
end;
$$;
set role authenticated;
do $$ begin
  begin
    perform public.record_submission_certificate('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','untrusted','x','application/pdf',1,now());
    raise exception 'browser role reached certificate RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
do $$
declare
  sid uuid := '11111111-1111-4111-8111-111111111111';
  actor uuid := '22222222-2222-4222-8222-222222222222';
  key_one text := 'custom/prefix/' || sid::text || '/certificate/44444444-4444-4444-8444-444444444444_one.pdf';
  key_two text := 'custom/prefix/' || sid::text || '/certificate/55555555-5555-4555-8555-555555555555_two.pdf';
  invalid_key text;
begin
  begin
    perform public.record_submission_certificate(sid,'33333333-3333-4333-8333-333333333333',key_one,'one.pdf','application/pdf',10,'2026-10-24T00:00:00Z');
    raise exception 'member actor accepted';
  exception when insufficient_privilege then null; end;
  perform public.record_submission_certificate(sid,actor,key_one,'첫 필증.pdf','application/pdf',10,'2026-10-24T00:00:00Z');
  perform public.record_submission_certificate(sid,actor,key_two,'새 필증.pdf','application/pdf',12,'2026-10-24T00:01:00Z');
  perform public.record_submission_certificate(sid,actor,key_two,'새 필증.pdf','application/pdf',12,'2026-10-24T00:01:00Z');
  if (select count(*) from public.submission_events) <> 2 then raise exception 'idempotency duplicated or lost result history'; end if;
  if not exists(select 1 from public.submission_events where details->'previous'->>'objectKey'='submissions/legacy/certificate.pdf' and details->'current'->>'objectKey'=key_one)
    or not exists(select 1 from public.submission_events where details->'previous'->>'objectKey'=key_one and details->'current'->>'objectKey'=key_two)
    then raise exception 'result version chain missing'; end if;
  if (select certificate_b2_path from public.submissions where id=sid) <> key_two then raise exception 'current certificate pointer wrong'; end if;
  if exists(select 1 from public.submission_events where actor_user_id is distinct from actor or event_type <> 'CERTIFICATE_UPLOADED'
    or message like '%custom/prefix%' or details::text like '%https://%') then raise exception 'audit actor/message/reference invalid'; end if;
  foreach invalid_key in array array['https://storage.invalid/file?signature=secret',replace(key_two,sid::text,'66666666-6666-4666-8666-666666666666')] loop
    begin
      perform public.record_submission_certificate(sid,actor,invalid_key,'file.pdf','application/pdf',10,now());
      raise exception 'invalid reference accepted';
    exception when raise_exception then
      if sqlerrm <> 'CERTIFICATE_FILE_INVALID' then raise; end if;
    end;
  end loop;
end;
$$;
reset role;

-- Inject an audit failure and prove the current pointer also rolls back.
alter table public.submission_events add constraint reject_certificate_test check (false) not valid;
set role service_role;
do $$ begin
  begin
    perform public.record_submission_certificate('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'custom/prefix/11111111-1111-4111-8111-111111111111/certificate/77777777-7777-4777-8777-777777777777_failed.pdf','failed.pdf','application/pdf',15,now());
    raise exception 'audit failure accepted';
  exception when check_violation then null; end;
end $$;
reset role;
alter table public.submission_events drop constraint reject_certificate_test;
do $$ begin
  if (select certificate_original_name from public.submissions) <> '새 필증.pdf' or (select count(*) from public.submission_events) <> 2 then raise exception 'audit failure partially committed'; end if;
  if (select to_jsonb(s) - array['certificate_b2_path','certificate_original_name','certificate_mime','certificate_size','certificate_uploaded_at'] from public.submissions s)
    is distinct from (select snapshot from certificate_before) then raise exception 'unrelated original/payment/result mutated'; end if;
  if (select file_path from public.submission_files) <> 'submissions/original/master.mov' then raise exception 'original file mutated'; end if;
end $$;
\echo 'Certificate privilege, prefix reference, replacement history, idempotency and atomic rollback assertions passed.'
