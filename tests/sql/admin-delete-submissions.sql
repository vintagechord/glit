\set ON_ERROR_STOP on
-- Administrator deletion: unpaid orders are kept as canceled records, paid
-- money records and half-selected order groups are refused.
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
  pending uuid:=gen_random_uuid(); paid uuid:=gen_random_uuid(); first_item uuid:=gen_random_uuid(); second_item uuid:=gen_random_uuid(); plain uuid:=gen_random_uuid();
  oid uuid; paid_order uuid; group_order uuid; ids uuid[];
begin
  if has_function_privilege('authenticated','public.admin_delete_submissions(uuid[],uuid)','execute')
    or not has_function_privilege('service_role','public.admin_delete_submissions(uuid[],uuid)','execute') then
    raise exception 'admin_delete_submissions permissions incorrect'; end if;
  insert into public.submissions(id,user_id,package_id,status,payment_status) values
    (pending,member_id,package_id,'SUBMITTED','UNPAID'),(paid,member_id,package_id,'SUBMITTED','UNPAID'),
    (first_item,member_id,package_id,'SUBMITTED','UNPAID'),(second_item,member_id,package_id,'SUBMITTED','UNPAID'),
    (plain,member_id,package_id,'SUBMITTED','UNPAID');
  perform pg_temp.expect_error(format('select * from public.admin_delete_submissions(array[%L]::uuid[],%L)',plain,member_id),'42501');

  -- A pending bank deposit: the order stays as a canceled record with its item snapshot.
  perform * from public.begin_submission_bank_payment(array[pending],member_id);
  select current_order_id into oid from public.submissions where id=pending;
  select array_agg(submission_id) into ids from public.admin_delete_submissions(array[pending],admin_id);
  if ids is distinct from array[pending] or exists(select 1 from public.submissions where id=pending) then raise exception 'Pending bank submission was not deleted'; end if;
  if (select status from public.submission_orders where id=oid)<>'CANCELED' or (select returned_at from public.submission_orders where id=oid) is null
    or (select note from public.submission_orders where id=oid) not like '%관리자가 신청서를 삭제%' then raise exception 'Pending order was not closed as a record'; end if;
  if not exists(select 1 from public.submission_order_items where order_id=oid and submission_ref=pending and submission_id is null) then raise exception 'Order item snapshot lost'; end if;

  -- A paid order is refused and left untouched.
  perform * from public.begin_submission_bank_payment(array[paid],member_id);
  select current_order_id into paid_order from public.submissions where id=paid;
  perform * from public.confirm_submission_order_bank_payment(paid_order,admin_id,'fixture deposit');
  perform pg_temp.expect_error(format('select * from public.admin_delete_submissions(array[%L]::uuid[],%L)',paid,admin_id));
  if not exists(select 1 from public.submissions where id=paid and current_order_id=paid_order and payment_status='PAID')
    or (select status from public.submission_orders where id=paid_order)<>'PAID' then raise exception 'Paid order changed'; end if;

  -- One order with two submissions: deleting half is refused, deleting both succeeds.
  perform * from public.begin_submission_bank_payment(array[first_item,second_item],member_id);
  select current_order_id into group_order from public.submissions where id=first_item;
  perform pg_temp.expect_error(format('select * from public.admin_delete_submissions(array[%L]::uuid[],%L)',first_item,admin_id));
  if (select count(*) from public.submissions where current_order_id=group_order)<>2 then raise exception 'Refused group delete changed submissions'; end if;
  select array_agg(submission_id order by submission_id) into ids from public.admin_delete_submissions(array[first_item,second_item,plain],admin_id);
  if cardinality(ids)<>3 or exists(select 1 from public.submissions where id=any(array[first_item,second_item,plain])) then raise exception 'Group or plain delete incomplete'; end if;
  if (select status from public.submission_orders where id=group_order)<>'CANCELED' then raise exception 'Group order not closed'; end if;
end;
$$;
rollback;
