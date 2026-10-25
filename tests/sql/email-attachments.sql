do $$
declare refs jsonb; base jsonb; changed jsonb; row1 public.email_outbox; row2 public.email_outbox; leased public.email_outbox;
  rejected boolean; submission uuid := '11111111-1111-4111-8111-111111111111';
begin
  assert not has_function_privilege('anon','public.enqueue_email_outbox_with_attachments(text,text,text,text,text,text,text,timestamptz,uuid,boolean,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.enqueue_email_outbox_with_attachments(text,text,text,text,text,text,text,timestamptz,uuid,boolean,jsonb)','EXECUTE');
  assert has_function_privilege('service_role','public.enqueue_email_outbox_with_attachments(text,text,text,text,text,text,text,timestamptz,uuid,boolean,jsonb)','EXECUTE');
  base := jsonb_build_object('objectKey','submissions/email-attachments/fixture/object.pdf','filename','fixture.pdf','contentType','application/pdf',
    'bytes',10,'sha256',repeat('a',64),'submissionId',submission::text,'rating','12','certificateKey','submissions/'||submission::text||'/certificate/fixture.pdf');
  refs := jsonb_build_array(base||jsonb_build_object('kind','rating-image','contentType','image/png'), base||jsonb_build_object('kind','usage-guide'), base||jsonb_build_object('kind','certificate'));
  select * into row1 from public.enqueue_email_outbox_with_attachments(repeat('4',64),'supabase-smtp','attachments@example.invalid','result','html',null,'submission update',now()+interval '1 hour',submission,true,refs);
  assert row1.attachment_refs=refs and row1.status='pending';
  select * into row2 from public.enqueue_email_outbox_with_attachments(repeat('4',64),'supabase-smtp','attachments@example.invalid','result','html',null,'submission update',now()+interval '1 hour',submission,true,refs);
  assert row1.id=row2.id;
  rejected:=false;
  begin
    perform public.enqueue_email_outbox_with_attachments(repeat('4',64),'supabase-smtp','attachments@example.invalid','result','html',null,'submission update',now()+interval '1 hour',submission,true,jsonb_set(refs,'{0,sha256}',to_jsonb(repeat('b',64))));
  exception when sqlstate '22023' then rejected:=true; end;
  assert rejected, 'same key changed attachment snapshot';
  assert (select attachment_refs=refs from public.email_outbox where id=row1.id);
  foreach changed in array array[
    jsonb_set(refs,'{0,contentBase64}','"private bytes"'), jsonb_set(refs,'{0,bytes}','null'), jsonb_set(refs,'{0,bytes}','18874369'),
    jsonb_set(refs,'{0,kind}','"certificate"'), jsonb_set(refs,'{0,objectKey}','"https://external.invalid/file"'),
    jsonb_set(refs,'{0,rating}','"15"'), '[]'::jsonb
  ] loop
    rejected:=false;
    begin
      perform public.enqueue_email_outbox_with_attachments(repeat('5',64),'supabase-smtp','attachments@example.invalid','result','html',null,'submission update',now()+interval '1 hour',submission,true,changed);
    exception when sqlstate '22023' then rejected:=true; end;
    assert rejected, 'invalid attachment ref accepted';
  end loop;
  select * into leased from public.claim_email_outbox(1,row1.id);
  assert leased.attachment_refs=refs and leased.lease_expires_at>=now()+interval '179 seconds';
  perform public.finish_email_outbox(row1.id,leased.lease_token,'accepted','smtp-attachment-fixture');
  select * into row2 from public.email_outbox where id=row1.id;
  assert row2.status='accepted' and row2.html is null and row2.attachment_refs=refs;
  raise notice 'email attachment SQL assertions passed';
end $$;
