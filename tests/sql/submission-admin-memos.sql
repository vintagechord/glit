\set ON_ERROR_STOP on
-- Staff notes live in the administrator-only submission_admin_memos table.
-- Old writers of submissions.admin_memo (order RPCs, the refund recorder,
-- the guest album intake) are routed into it and the column stays null.
begin;
do $$
declare
  admin_id uuid:='99999999-9999-4999-8999-999999999999'; member_id uuid:='11111111-1111-4111-8111-111111111111';
  package_id uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  item uuid:=gen_random_uuid(); rejected boolean:=false;
begin
  if has_table_privilege('authenticated','public.submission_admin_memos','select')
    or has_table_privilege('anon','public.submission_admin_memos','select')
    or not has_table_privilege('service_role','public.submission_admin_memos','select') then
    raise exception 'submission_admin_memos privileges incorrect'; end if;
  if exists(select 1 from public.submissions where admin_memo is not null) then
    raise exception 'Existing notes were not moved off submissions'; end if;

  perform set_config('request.jwt.claim.role','service_role',true);
  -- Guest intake style: the note arrives with the insert.
  insert into public.submissions(id,user_id,package_id,status,payment_status,admin_memo)
    values (item,member_id,package_id,'SUBMITTED','UNPAID','intake note');
  if (select admin_memo from public.submissions where id=item) is not null
    or (select memo from public.submission_admin_memos where submission_id=item) is distinct from 'intake note' then
    raise exception 'Inserted note was not routed'; end if;
  -- A prefilled edit form sends the whole note: it replaces.
  update public.submissions set admin_memo='intake note'||E'\n'||'checked' where id=item;
  if (select memo from public.submission_admin_memos where submission_id=item) is distinct from 'intake note'||E'\n'||'checked' then
    raise exception 'Extended note was not replaced'; end if;
  -- A refund line (unrelated text) is appended, keeping earlier notes.
  update public.submissions set admin_memo='[환불 2026-11-03 · 계좌 송금]' where id=item;
  if (select memo from public.submission_admin_memos where submission_id=item) is distinct from 'intake note'||E'\n'||'checked'||E'\n'||'[환불 2026-11-03 · 계좌 송금]' then
    raise exception 'Refund line was not appended'; end if;
  if (select admin_memo from public.submissions where id=item) is not null then raise exception 'Column kept a note'; end if;
  -- coalesce(null, admin_memo) style writes change nothing.
  update public.submissions set admin_memo=coalesce(null, admin_memo) where id=item;
  if (select count(*) from public.submission_admin_memos where submission_id=item)<>1 then raise exception 'Null write changed the note'; end if;

  -- A member session cannot plant a note.
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  begin
    update public.submissions set admin_memo='member text' where id=item;
  exception when sqlstate '42501' then rejected:=true; end;
  if not rejected then raise exception 'Member wrote a staff note'; end if;

  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claim.sub','',true);
  delete from public.submissions where id=item;
  if exists(select 1 from public.submission_admin_memos where submission_id=item) then raise exception 'Note outlived its submission'; end if;
end;
$$;
rollback;
