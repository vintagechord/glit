\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
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
begin
  if (select count(*) from public.submission_orders)<>3 then raise exception 'Legacy backfill lost attempts or grouped bank request'; end if;
  if (select current_order_id from public.submissions where id='00000000-0000-4000-8000-000000000002') is not null then raise exception 'Legacy failed attempt took over an unpaid cart'; end if;
  if (select count(*) from public.submission_orders where status='BANK_PENDING' and amount_krw=100000)<>1 then raise exception 'Bank group amount incorrect'; end if;
  if (select current_order_id from public.submissions where id='00000000-0000-4000-8000-000000000001') is null then raise exception 'Legacy active PG was left in cart'; end if;
  if exists(select 1 from public.submission_payments where checkout_order_id is null) then raise exception 'PG backfill missing binding'; end if;
  if has_function_privilege('authenticated','public.return_submission_order_to_cart(uuid,uuid,jsonb)','execute')
    or has_function_privilege('anon','public.confirm_submission_order_bank_payment(uuid,uuid,text)','execute')
    or not has_function_privilege('service_role','public.begin_submission_payment_order(uuid,uuid[],text,integer,uuid,jsonb)','execute') then raise exception 'RPC permissions incorrect'; end if;
end;
$$;

-- Bank confirmation is one whole order, idempotent, and cannot be reopened.
do $$
declare oid uuid; ids uuid[]; n integer;
begin
  select current_order_id into oid from public.submissions where id='00000000-0000-4000-8000-000000000003';
  perform pg_temp.expect_error(format('select * from public.confirm_submission_order_bank_payment(%L,%L)',oid,'11111111-1111-4111-8111-111111111111'),'42501');
  perform set_config('onside.checkout_order_write','',true);
  perform pg_temp.expect_error('update public.submissions set payment_status=''PAID'' where id=''00000000-0000-4000-8000-000000000003''');
  select array_agg(submission_id) into ids from public.confirm_submission_order_bank_payment(oid,'99999999-9999-4999-8999-999999999999','Verified fixture');
  if cardinality(ids)<>2 or exists(select 1 from public.submissions where id=any(ids) and (payment_status<>'PAID' or status<>'PRE_REVIEW')) then raise exception 'Partial bank confirmation or review started before materials were checked'; end if;
  select count(*) into n from public.submission_events;
  perform * from public.confirm_submission_order_bank_payment(oid,'99999999-9999-4999-8999-999999999999',null);
  if (select count(*) from public.submission_events)<>n then raise exception 'Idempotent confirmation duplicated history'; end if;
  perform pg_temp.expect_error(format('select * from public.return_submission_order_to_cart(%L,%L)',oid,'11111111-1111-4111-8111-111111111111'));
end;
$$;

-- Deposit confirmation must preserve real review/results, including legacy
-- pending bank rows that already reached a later stage. It never alters the
-- original order snapshot; repeat confirmations preserve both stage and log.
do $$
declare sid uuid; oid uuid; before_status submission_status; expected submission_status; snapshot_before jsonb; event_count integer;
begin
  foreach before_status in array enum_range(null::submission_status) loop
    sid:=gen_random_uuid();
    insert into public.submissions(id,user_id,package_id,status,payment_status)
    values(sid,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID');
    perform * from public.begin_submission_bank_payment(array[sid],'11111111-1111-4111-8111-111111111111');
    select current_order_id into oid from public.submissions where id=sid;
    -- Fixture only: reconstruct each historical bank/review combination.
    perform set_config('onside.checkout_order_write',oid::text,true);
    update public.submissions set status=before_status where id=sid;
    select to_jsonb(i) into snapshot_before from public.submission_order_items i where order_id=oid and submission_ref=sid;
    perform set_config('onside.checkout_order_write','',true);
    perform * from public.confirm_submission_order_bank_payment(oid,'99999999-9999-4999-8999-999999999999',null);
    expected:=case when before_status in ('DRAFT','SUBMITTED','WAITING_PAYMENT') then 'PRE_REVIEW'::submission_status else before_status end;
    if not exists(select 1 from public.submissions where id=sid and payment_status='PAID' and status=expected) then
      raise exception 'Deposit changed % to wrong review state; expected %',before_status,expected;
    end if;
    if snapshot_before is distinct from (select to_jsonb(i) from public.submission_order_items i where order_id=oid and submission_ref=sid) then
      raise exception 'Deposit rewrote original order snapshot';
    end if;
    select count(*) into event_count from public.submission_events where submission_id=sid;
    perform * from public.confirm_submission_order_bank_payment(oid,'99999999-9999-4999-8999-999999999999',null);
    if (select status from public.submissions where id=sid)<>expected or
       (select count(*) from public.submission_events where submission_id=sid)<>event_count then
      raise exception 'Repeated deposit confirmation changed stage or duplicated events';
    end if;
  end loop;
end;
$$;

-- New bank order remains outside the cart until an explicit return. Neither
-- failure/ordinary saves nor repeated checkout can steal its current pointer.
insert into public.submissions(id,user_id,package_id,status,payment_status,album_draft_group_id) values
 ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
 ('10000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into public.submission_files(submission_id,file_path,original_name) values ('10000000-0000-4000-8000-000000000001','private/master.wav','master.wav');
select pg_temp.expect_error($q$select * from public.begin_submission_bank_payment(array['10000000-0000-4000-8000-000000000001']::uuid[],'11111111-1111-4111-8111-111111111111')$q$);
select * from public.begin_submission_bank_payment(array['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002']::uuid[],'11111111-1111-4111-8111-111111111111');
do $$
declare oid uuid; old_count integer; ids uuid[]:=array['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002']::uuid[];
begin
  select current_order_id into oid from public.submissions where id=ids[1];
  if exists(select 1 from public.submission_order_items where order_id=oid and amount_krw<>50000) then raise exception 'Snapshot amount changed'; end if;
  if (select cardinality(file_ids) from public.submission_order_items where order_id=oid and submission_ref=ids[1])<>1 then raise exception 'File IDs not preserved'; end if;
  perform pg_temp.expect_error(format('select * from public.begin_submission_bank_payment(%L::uuid[],%L)',ids,'11111111-1111-4111-8111-111111111111'));
  perform set_config('onside.checkout_order_write','',true);
  perform pg_temp.expect_error(format('update public.submissions set save_lease_token=gen_random_uuid() where id=%L',ids[1]));
  perform pg_temp.expect_error(format('delete from public.submission_files where submission_id=%L',ids[1]));
  perform pg_temp.expect_error(format('select * from public.return_submission_order_to_cart(%L,%L)',oid,'22222222-2222-4222-8222-222222222222'),'42501');
  perform * from public.return_submission_order_to_cart(oid,'11111111-1111-4111-8111-111111111111','{}');
  if exists(select 1 from public.submissions where id=any(ids) and (current_order_id is not null or payment_status<>'UNPAID' or status<>'SUBMITTED')) then raise exception 'Return did not release cart'; end if;
  if not exists(select 1 from public.submission_orders where id=oid and status='CANCELED' and returned_at is not null) then raise exception 'Return deleted history'; end if;
  select count(*) into old_count from public.submission_orders;
  perform * from public.begin_submission_bank_payment(ids,'11111111-1111-4111-8111-111111111111');
  if (select count(*) from public.submission_orders)<>old_count+1 then raise exception 'Retry reused historical order'; end if;
end;
$$;

-- Real 0076 card start, authenticated close, final approval and new 0098 claim.
insert into public.submissions(id,user_id,package_id,status,payment_status) values
 ('20000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID'),
 ('20000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID'),
 ('20000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID');
select pg_temp.expect_error($q$select * from public.begin_submission_payment_order('20000000-0000-4000-8000-000000000001',array['20000000-0000-4000-8000-000000000001']::uuid[],'BAD-AMOUNT',1,'11111111-1111-4111-8111-111111111111','{}')$q$,'22000');
select * from public.begin_submission_payment_order('20000000-0000-4000-8000-000000000001',array['20000000-0000-4000-8000-000000000001']::uuid[],'CARD-ONE',50000,'11111111-1111-4111-8111-111111111111','{"closeState":"11111111-1111-4111-8111-111111111111"}');
select * from public.close_submission_payment_order('CARD-ONE','FAILED','TEST','Test failure','{}');
do $$
declare oid uuid;
begin
  select current_order_id into oid from public.submissions where id='20000000-0000-4000-8000-000000000001';
  if oid is null or not exists(select 1 from public.submission_orders where id=oid and status='FAILED' and returned_at is null) then raise exception 'Failed attempt returned to cart implicitly'; end if;
  perform * from public.return_submission_order_to_cart(oid,'11111111-1111-4111-8111-111111111111','{}');
  perform pg_temp.expect_error($q$select * from public.approve_submission_payment_order('CARD-ONE','tid','00','ok','{}',now())$q$);
end;
$$;
select * from public.begin_submission_payment_order('20000000-0000-4000-8000-000000000002',array['20000000-0000-4000-8000-000000000002']::uuid[],'CARD-TWO',50000,'11111111-1111-4111-8111-111111111111','{"closeState":"11111111-1111-4111-8111-111111111111"}');
select pg_temp.expect_error($q$select * from public.claim_inicis_submission_approval('CARD-TWO','22222222-2222-4222-8222-222222222222')$q$,'42501');
select * from public.claim_inicis_submission_approval('CARD-TWO','11111111-1111-4111-8111-111111111111');
do $$
declare r record; oid uuid;
begin
  select * into r from public.claim_inicis_submission_approval('CARD-TWO','11111111-1111-4111-8111-111111111111');
  if not r.already_processing or r.already_approved then raise exception 'Duplicate approval was not held'; end if;
  select checkout_order_id into oid from public.submission_payments where order_id='CARD-TWO';
  perform pg_temp.expect_error(format('select * from public.return_submission_order_to_cart(%L,%L)',oid,'11111111-1111-4111-8111-111111111111'));
  perform pg_temp.expect_error($q$select * from public.close_submission_payment_order('CARD-TWO','CANCELED','TEST','unsafe','{}')$q$);
end;
$$;
select * from public.approve_submission_payment_order('CARD-TWO','tid-2','00','ok','{}',now());
select * from public.approve_submission_payment_order('CARD-TWO','tid-2','00','ok','{}',now());
do $$ begin
  if not exists(select 1 from public.submission_orders o join public.submission_payments p on p.checkout_order_id=o.id
    where p.order_id='CARD-TWO' and o.status='PAID' and p.status='APPROVED') then raise exception 'PG approval not atomic with order'; end if;
  if (select status from public.submissions where id='20000000-0000-4000-8000-000000000002')<>'PRE_REVIEW' then
    raise exception 'Card approval started review before materials were checked'; end if;
end $$;
select * from public.begin_submission_payment_order('20000000-0000-4000-8000-000000000003',array['20000000-0000-4000-8000-000000000003']::uuid[],'CARD-UNKNOWN',50000,'11111111-1111-4111-8111-111111111111','{"closeState":"11111111-1111-4111-8111-111111111111"}');
select * from public.claim_inicis_submission_approval('CARD-UNKNOWN','11111111-1111-4111-8111-111111111111');
select * from public.settle_inicis_submission_approval('CARD-UNKNOWN','11111111-1111-4111-8111-111111111111','UNCERTAIN','TIMEOUT','Unknown gateway state','{}');
do $$ declare oid uuid; begin
  select checkout_order_id into oid from public.submission_payments where order_id='CARD-UNKNOWN';
  if (select status from public.submission_orders where id=oid)<>'REVIEW_REQUIRED' then raise exception 'Unknown payment was presented as retryable'; end if;
  perform pg_temp.expect_error(format('select * from public.return_submission_order_to_cart(%L,%L)',oid,'11111111-1111-4111-8111-111111111111'));
end $$;

-- Guest orders require each exact token; deleted cart rows retain history proof.
insert into public.submissions(id,guest_token,package_id,status,payment_status) values
 ('30000000-0000-4000-8000-000000000001','guest-private-token','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID');
select * from public.begin_submission_bank_payment(array['30000000-0000-4000-8000-000000000001']::uuid[],null);
do $$ declare oid uuid; begin
  select current_order_id into oid from public.submissions where id='30000000-0000-4000-8000-000000000001';
  perform pg_temp.expect_error(format('select * from public.return_submission_order_to_cart(%L,null,%L)',oid,'{}'),'42501');
  perform pg_temp.expect_error($q$select * from public.claim_guest_cart_submissions('11111111-1111-4111-8111-111111111111','{"30000000-0000-4000-8000-000000000001":"guest-private-token"}')$q$);
  perform * from public.return_submission_order_to_cart(oid,null,'{"30000000-0000-4000-8000-000000000001":"guest-private-token"}');
  delete from public.submissions where id='30000000-0000-4000-8000-000000000001';
  if not exists(select 1 from public.submission_order_items where order_id=oid and submission_id is null
    and guest_token_hash=encode(sha256(convert_to('guest-private-token','UTF8')),'hex')) then raise exception 'Deleted guest submission lost order snapshot/access proof'; end if;
end $$;

-- PayPal keeps its existing capture claim, order binding and financial checks.
insert into public.submissions(id,user_id,package_id,status,payment_status,payment_method,payment_provider,payment_amount,payment_currency)
values ('40000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID','PAYPAL','paypal',90,'USD');
select * from public.begin_paypal_submission_payment('40000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',null,'PAYPAL-ONE',90,'USD','{"paypalReturnState":"11111111-1111-4111-8111-111111111111"}');
select * from public.claim_paypal_submission_capture('40000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',null,null,'PAYPAL-ONE');
do $$ declare oid uuid; begin
  select current_order_id into oid from public.submissions where id='40000000-0000-4000-8000-000000000001';
  perform pg_temp.expect_error(format('select * from public.return_submission_order_to_cart(%L,%L)',oid,'11111111-1111-4111-8111-111111111111'));
  perform pg_temp.expect_error($q$select * from public.close_submission_payment_order('PAYPAL-ONE','CANCELED','TEST','unsafe','{}')$q$);
end $$;
select * from public.approve_paypal_submission_payment('40000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',null,null,'PAYPAL-ONE','CAPTURE-ONE',90,'USD','COMPLETED','{}',now());
do $$ begin
  if not exists(select 1 from public.submission_orders o join public.submission_payments p on p.checkout_order_id=o.id
    where p.order_id='PAYPAL-ONE' and p.status='APPROVED' and o.status='PAID' and o.amount=90 and o.currency='USD') then raise exception 'PayPal order projection mismatch'; end if;
  if (select status from public.submissions where id='40000000-0000-4000-8000-000000000001')<>'PRE_REVIEW' then
    raise exception 'PayPal approval started review before materials were checked'; end if;
end $$;

-- Reconstruct historical pending gateway rows for every review-state enum.
-- Only fixture preparation bypasses the edit guard; both guards are enabled
-- before approval, so locks/financial writes/order projection run normally.
do $$
declare sid uuid; oid uuid; gateway text; external_order text; before_status submission_status;
  expected submission_status; original_snapshot jsonb;
begin
  foreach gateway in array array['CARD','PAYPAL'] loop
    foreach before_status in array enum_range(null::submission_status) loop
      sid:=gen_random_uuid(); external_order:='MATRIX-'||gateway||'-'||before_status::text;
      insert into public.submissions(id,user_id,package_id,status,payment_status,payment_method,payment_provider,payment_amount,payment_currency)
      values(sid,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID',gateway::payment_method,lower(gateway),90,'USD');
      if gateway='CARD' then
        perform * from public.begin_submission_payment_order(sid,array[sid],external_order,50000,'11111111-1111-4111-8111-111111111111','{"closeState":"11111111-1111-4111-8111-111111111111"}');
        perform * from public.claim_inicis_submission_approval(external_order,'11111111-1111-4111-8111-111111111111');
      else
        perform * from public.begin_paypal_submission_payment(sid,'11111111-1111-4111-8111-111111111111',null,external_order,90,'USD','{"paypalReturnState":"11111111-1111-4111-8111-111111111111"}');
        perform pg_temp.expect_error(format('select * from public.approve_paypal_submission_payment(%L,%L,null,null,%L,%L,90,''USD'',''COMPLETED'',''{}'',now())',sid,'11111111-1111-4111-8111-111111111111',external_order,'capture-'||external_order));
        perform * from public.claim_paypal_submission_capture(sid,'11111111-1111-4111-8111-111111111111',null,null,external_order);
      end if;
      select current_order_id into oid from public.submissions where id=sid;
      select to_jsonb(i) into original_snapshot from public.submission_order_items i where order_id=oid and submission_ref=sid;
      set constraints all immediate;
      alter table public.submissions disable trigger protect_requested_payment_submission_update;
      perform set_config('onside.checkout_order_write',oid::text,true);
      update public.submissions set status=before_status where id=sid;
      alter table public.submissions enable trigger protect_requested_payment_submission_update;
      set constraints all deferred;
      perform set_config('onside.checkout_order_write','',true);
      if gateway='CARD' then
        perform * from public.approve_submission_payment_order(external_order,'tid-'||external_order,'00','ok','{}',now());
      else
        perform pg_temp.expect_error(format('select * from public.approve_paypal_submission_payment(%L,%L,null,null,%L,%L,91,''USD'',''COMPLETED'',''{}'',now())',sid,'11111111-1111-4111-8111-111111111111',external_order,'capture-'||external_order),'22000');
        perform * from public.approve_paypal_submission_payment(sid,'11111111-1111-4111-8111-111111111111',null,null,external_order,'capture-'||external_order,90,'USD','COMPLETED','{}',now());
      end if;
      expected:=case when before_status in ('DRAFT','SUBMITTED','WAITING_PAYMENT') then 'PRE_REVIEW'::submission_status else before_status end;
      if not exists(select 1 from public.submissions where id=sid and payment_status='PAID' and status=expected)
        or not exists(select 1 from public.submission_orders where id=oid and status='PAID') then
        raise exception '% approval changed % to wrong state; expected %',gateway,before_status,expected;
      end if;
      if original_snapshot is distinct from (select to_jsonb(i) from public.submission_order_items i where order_id=oid and submission_ref=sid) then
        raise exception '% approval rewrote original order snapshot',gateway;
      end if;
    end loop;
  end loop;
end $$;

-- Real callback replays must preserve all existing review/result stages and
-- immutable order snapshots, even when legacy approved data has an early stage.
-- Reset the transaction-local write marker before each callback so this also
-- exercises the live order guard on repeated approval (no payment UPDATE).
do $$
declare before_status submission_status; card_id uuid:='20000000-0000-4000-8000-000000000002';
  paypal_id uuid:='40000000-0000-4000-8000-000000000001'; card_order uuid; paypal_order uuid;
  card_snapshot jsonb; paypal_snapshot jsonb; event_count integer;
begin
  select current_order_id into card_order from public.submissions where id=card_id;
  select current_order_id into paypal_order from public.submissions where id=paypal_id;
  select to_jsonb(i) into card_snapshot from public.submission_order_items i where order_id=card_order and submission_ref=card_id;
  select to_jsonb(i) into paypal_snapshot from public.submission_order_items i where order_id=paypal_order and submission_ref=paypal_id;
  select count(*) into event_count from public.submission_events where submission_id in (card_id,paypal_id);
  foreach before_status in array enum_range(null::submission_status) loop
    perform set_config('onside.checkout_order_write',card_order::text,true);
    update public.submissions set status=before_status where id=card_id;
    perform set_config('onside.checkout_order_write',paypal_order::text,true);
    update public.submissions set status=before_status where id=paypal_id;
    perform set_config('onside.checkout_order_write','',true);
    perform * from public.approve_submission_payment_order('CARD-TWO','tid-2','00','ok','{}',now());
    perform * from public.approve_paypal_submission_payment(paypal_id,'11111111-1111-4111-8111-111111111111',null,null,'PAYPAL-ONE','CAPTURE-ONE',90,'USD','COMPLETED','{}',now());
    if exists(select 1 from public.submissions where id in (card_id,paypal_id) and (status<>before_status or payment_status<>'PAID')) then
      raise exception 'Repeated gateway approval regressed existing % stage',before_status;
    end if;
  end loop;
  if card_snapshot is distinct from (select to_jsonb(i) from public.submission_order_items i where order_id=card_order and submission_ref=card_id)
    or paypal_snapshot is distinct from (select to_jsonb(i) from public.submission_order_items i where order_id=paypal_order and submission_ref=paypal_id)
    or (select count(*) from public.submission_events where submission_id in (card_id,paypal_id))<>event_count then
    raise exception 'Gateway callback rewrote snapshot or duplicated audit events';
  end if;
  if has_function_privilege('authenticated','public.approve_submission_payment_order(text,text,text,text,jsonb,timestamptz)','execute')
    or has_function_privilege('anon','public.approve_paypal_submission_payment(uuid,uuid,text,text,text,text,numeric,text,text,jsonb,timestamptz)','execute') then
    raise exception 'Gateway approval RPC exposed to public caller';
  end if;
end $$;

-- Check actual owner SELECT policies, rather than only catalog privileges.
-- Operators resolve an uncertain card approval from the Inicis console; approval
-- completes the order, failure reopens it for the customer, refunds are whole-order.
do $$ declare oid uuid; ids uuid[]; failed_oid uuid; begin
  select checkout_order_id into oid from public.submission_payments where order_id='CARD-UNKNOWN';
  perform pg_temp.expect_error($q$select * from public.resolve_uncertain_submission_payment('CARD-UNKNOWN','11111111-1111-4111-8111-111111111111','APPROVED','tid-u')$q$,'42501');
  perform pg_temp.expect_error($q$select * from public.resolve_uncertain_submission_payment('CARD-UNKNOWN','99999999-9999-4999-8999-999999999999','APPROVED',null)$q$,'22023');
  perform pg_temp.expect_error($q$select * from public.resolve_uncertain_submission_payment('CARD-UNKNOWN','99999999-9999-4999-8999-999999999999','REFUNDED')$q$,'22023');
  perform pg_temp.expect_error($q$select * from public.resolve_uncertain_submission_payment('CARD-TWO','99999999-9999-4999-8999-999999999999','FAILED')$q$);
  select array_agg(submission_id) into ids from public.resolve_uncertain_submission_payment('CARD-UNKNOWN','99999999-9999-4999-8999-999999999999','APPROVED','tid-u','콘솔 승인 확인');
  if ids<>array['20000000-0000-4000-8000-000000000003']::uuid[] then raise exception 'Resolution did not return the order group'; end if;
  if (select status from public.submission_orders where id=oid)<>'PAID' or (select paid_at from public.submission_orders where id=oid) is null
    or not exists(select 1 from public.submission_payments where order_id='CARD-UNKNOWN' and status='APPROVED' and pg_tid='tid-u')
    or not exists(select 1 from public.submissions where id='20000000-0000-4000-8000-000000000003' and payment_status='PAID' and status='PRE_REVIEW' and current_order_id=oid)
  then raise exception 'Admin approval resolution incomplete'; end if;
  perform pg_temp.expect_error($q$select * from public.resolve_uncertain_submission_payment('CARD-UNKNOWN','99999999-9999-4999-8999-999999999999','FAILED')$q$);

  -- A second uncertain attempt is confirmed as not approved: the customer pays again.
  insert into public.submissions(id,user_id,package_id,status,payment_status) values
   ('20000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID');
  perform * from public.begin_submission_payment_order('20000000-0000-4000-8000-000000000008',array['20000000-0000-4000-8000-000000000008']::uuid[],'CARD-UNKNOWN-2',50000,'11111111-1111-4111-8111-111111111111','{"closeState":"11111111-1111-4111-8111-111111111111"}');
  perform * from public.claim_inicis_submission_approval('CARD-UNKNOWN-2','11111111-1111-4111-8111-111111111111');
  perform * from public.settle_inicis_submission_approval('CARD-UNKNOWN-2','11111111-1111-4111-8111-111111111111','UNCERTAIN','TIMEOUT','Unknown gateway state','{}');
  select checkout_order_id into failed_oid from public.submission_payments where order_id='CARD-UNKNOWN-2';
  perform * from public.resolve_uncertain_submission_payment('CARD-UNKNOWN-2','99999999-9999-4999-8999-999999999999','FAILED',null,'콘솔 미승인 확인');
  if (select status from public.submission_orders where id=failed_oid)<>'FAILED'
    or not exists(select 1 from public.submission_payments where order_id='CARD-UNKNOWN-2' and status='FAILED' and result_code='ADMIN_CONFIRMED_FAILURE')
    or not exists(select 1 from public.submissions where id='20000000-0000-4000-8000-000000000008' and payment_status='UNPAID' and status='WAITING_PAYMENT' and current_order_id=failed_oid)
  then raise exception 'Admin failure resolution incomplete'; end if;
  perform * from public.return_submission_order_to_cart(failed_oid,'11111111-1111-4111-8111-111111111111','{}');
  if (select current_order_id from public.submissions where id='20000000-0000-4000-8000-000000000008') is not null then raise exception 'Failed order could not be returned to the cart'; end if;

  -- Refund records the reversal for the whole order, idempotently, only after payment.
  perform pg_temp.expect_error(format('select * from public.refund_submission_order(%L,%L)',oid,'11111111-1111-4111-8111-111111111111'),'42501');
  perform pg_temp.expect_error(format('select * from public.refund_submission_order(%L,%L)',(select checkout_order_id from public.submission_payments where order_id='LEGACY-FAILED'),'99999999-9999-4999-8999-999999999999'));
  select array_agg(submission_id) into ids from public.refund_submission_order(oid,'99999999-9999-4999-8999-999999999999','PG 취소 완료');
  if ids<>array['20000000-0000-4000-8000-000000000003']::uuid[]
    or (select status from public.submission_orders where id=oid)<>'REFUNDED' or (select refunded_at from public.submission_orders where id=oid) is null
    or exists(select 1 from public.submissions where current_order_id=oid and payment_status<>'REFUNDED')
    or not exists(select 1 from public.submission_events where submission_id='20000000-0000-4000-8000-000000000003' and message like '%환불%')
  then raise exception 'Refund not recorded on the whole order'; end if;
  perform * from public.refund_submission_order(oid,'99999999-9999-4999-8999-999999999999',null);
  if (select count(*) from public.submission_events where submission_id='20000000-0000-4000-8000-000000000003' and message like '%환불%')<>1 then raise exception 'Idempotent refund duplicated history'; end if;
end $$;

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.submission_orders)
    or exists(select 1 from public.submission_orders where user_id is distinct from auth.uid())
    or exists(select 1 from public.submission_order_items i where not exists(select 1 from public.submission_orders o where o.id=i.order_id))
  then raise exception 'Order RLS ownership leak or missing owner visibility'; end if;
end $$;
reset role;
set constraints all immediate;
rollback;
\echo 'Submission orders/backfill/payment/ownership/approval assertions passed.'
