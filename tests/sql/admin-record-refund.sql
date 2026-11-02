\set ON_ERROR_STOP on
-- Recording a refund made outside the app: the whole order, a fixed customer
-- notice, the admin note appended to admin_memo, and an idempotent repeat.
begin;
create function pg_temp.expect_error(statement text,expected text default '55000') returns void language plpgsql as $$
declare rejected boolean:=false;
begin
  begin execute statement; exception when others then
    if sqlstate<>expected then raise exception 'Expected %, got %: % for %',expected,sqlstate,sqlerrm,statement; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'Unsafe statement succeeded: %',statement; end if;
end;
$$;
do $$
declare
  admin_id uuid:='99999999-9999-4999-8999-999999999999'; member_id uuid:='11111111-1111-4111-8111-111111111111';
  package_id uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  first_item uuid:=gen_random_uuid(); second_item uuid:=gen_random_uuid(); unpaid uuid:=gen_random_uuid();
  oid uuid; ids uuid[]; n integer;
begin
  if has_function_privilege('authenticated','public.admin_record_refund(uuid,uuid,text,text)','execute')
    or not has_function_privilege('service_role','public.admin_record_refund(uuid,uuid,text,text)','execute') then
    raise exception 'admin_record_refund permissions incorrect'; end if;
  insert into public.submissions(id,user_id,package_id,status,payment_status,admin_memo) values
    (first_item,member_id,package_id,'SUBMITTED','UNPAID','기존 메모'),(second_item,member_id,package_id,'SUBMITTED','UNPAID',null),
    (unpaid,member_id,package_id,'SUBMITTED','UNPAID',null);
  perform * from public.begin_submission_bank_payment(array[first_item,second_item],member_id);
  select current_order_id into oid from public.submissions where id=first_item;
  perform * from public.confirm_submission_order_bank_payment(oid,admin_id,null);

  perform pg_temp.expect_error(format('select * from public.admin_record_refund(%L,%L,%L,null)',first_item,member_id,'BANK_TRANSFER'),'42501');
  perform pg_temp.expect_error(format('select * from public.admin_record_refund(%L,%L,%L,null)',first_item,admin_id,'CASH'),'22023');
  perform pg_temp.expect_error(format('select * from public.admin_record_refund(%L,%L,%L,null)',unpaid,admin_id,'BANK_TRANSFER'));

  select array_agg(submission_id order by submission_id) into ids from public.admin_record_refund(first_item,admin_id,'BANK_TRANSFER','송금 완료');
  if cardinality(ids)<>2 or exists(select 1 from public.submissions where id=any(ids) and payment_status<>'REFUNDED') then raise exception 'Whole order not refunded'; end if;
  if (select status from public.submission_orders where id=oid)<>'REFUNDED' or (select refunded_at from public.submission_orders where id=oid) is null
    or (select note from public.submission_orders where id=oid) like '%송금 완료%' then raise exception 'Order record incorrect'; end if;
  if (select admin_memo from public.submissions where id=first_item) not like '기존 메모'||E'\n'||'[환불 %계좌 송금] 송금 완료' then raise exception 'Admin memo was not appended'; end if;
  select count(*) into n from public.submission_events;
  if (select count(*) from public.admin_record_refund(second_item,admin_id,'BANK_TRANSFER',null))<>2 then raise exception 'Repeat returned wrong IDs'; end if;
  if (select count(*) from public.submission_events)<>n then raise exception 'Repeat added history'; end if;
  if (select count(*) from public.admin_delete_submissions(array[first_item,second_item],admin_id))<>2 then raise exception 'Refunded order could not be deleted'; end if;
end;
$$;
rollback;
