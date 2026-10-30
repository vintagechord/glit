\set ON_ERROR_STOP on
-- Isolated checks for supabase/migrations/20261031120000_open_fixes.sql.
-- The bootstrap fixture lacks a few application columns/tables the purge
-- function references; add inert stand-ins so the function bodies execute.
alter table public.submissions
  add column if not exists applicant_name text,
  add column if not exists applicant_phone text,
  add column if not exists guest_email text,
  add column if not exists guest_phone text,
  add column if not exists melon_url text;
create table if not exists public.album_tracks(id uuid primary key default gen_random_uuid(), submission_id uuid);
create table if not exists public.submission_upload_staging(id uuid primary key default gen_random_uuid(), submission_id uuid);
create table if not exists public.multipart_upload_grants(id uuid primary key default gen_random_uuid(), submission_id uuid);

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

-- 1. A claim whose process died becomes reconcilable; a live claim does not.
do $$
declare expired text[]; oid uuid;
begin
  if (select result_code from public.submission_payments where order_id='LEGACY-PENDING')<>'APPROVAL_IN_PROGRESS' then
    raise exception 'Fixture claim expected to be in progress'; end if;
  update public.submission_payments set approval_claimed_at=now()-interval '3 minutes' where order_id='LEGACY-PENDING';
  select array_agg(order_id) into expired from public.expire_stale_inicis_approval_claims();
  if expired is not null then raise exception 'A three minute old claim expired too early'; end if;
  perform pg_temp.expect_error('select * from public.expire_stale_inicis_approval_claims(interval ''30 seconds'')','22023');
  update public.submission_payments set approval_claimed_at=now()-interval '11 minutes' where order_id='LEGACY-PENDING';
  select array_agg(order_id) into expired from public.expire_stale_inicis_approval_claims();
  if expired is distinct from array['LEGACY-PENDING'] then raise exception 'Stale claim was not expired: %',expired; end if;
  select checkout_order_id into oid from public.submission_payments where order_id='LEGACY-PENDING';
  if (select result_code from public.submission_payments where order_id='LEGACY-PENDING')<>'APPROVAL_UNCERTAIN'
    or (select status from public.submission_orders where id=oid)<>'REVIEW_REQUIRED' then
    raise exception 'Expired claim did not enter the reconciliation state'; end if;
  if (select raw_response->'staleClaim'->>'expiredAt' from public.submission_payments where order_id='LEGACY-PENDING') is null then
    raise exception 'Stale claim audit missing'; end if;
  -- The existing operator path now accepts the row.
  perform * from public.resolve_uncertain_submission_payment('LEGACY-PENDING','99999999-9999-4999-8999-999999999999','FAILED',null,'console shows no approval');
  if (select status from public.submission_payments where order_id='LEGACY-PENDING')<>'FAILED'
    or (select status from public.submission_orders where id=oid)<>'FAILED' then
    raise exception 'Operator resolution after expiry failed'; end if;
  if has_function_privilege('authenticated','public.expire_stale_inicis_approval_claims(interval)','execute') then
    raise exception 'Expiry RPC exposed to members'; end if;
end;
$$;

-- 2. Bank orders record the depositor name and the promised deposit day.
do $$
declare sid uuid:='00000000-0000-4000-8000-00000000b001'; oid uuid; ids uuid[];
begin
  -- An MV row avoids the album price-snapshot checks that need package rows.
  insert into public.submissions(id,user_id,guest_token,type,status,payment_status,payment_method,amount_krw,title,album_price_tier,album_base_price_krw)
  values (sid,null,'bank-guest-token-0001','MV_DISTRIBUTION','SUBMITTED','UNPAID','BANK',50000,'Bank fixture',null,null);
  perform pg_temp.expect_error(format('select * from public.begin_submission_bank_payment(array[%L]::uuid[],null,'' '',now()+interval ''3 days'')',sid),'22023');
  perform pg_temp.expect_error(format('select * from public.begin_submission_bank_payment(array[%L]::uuid[],null,''홍길동'',now()+interval ''60 days'')',sid),'22023');
  perform pg_temp.expect_error(format('select * from public.begin_submission_bank_payment(array[%L]::uuid[],null,''홍길동'',null)',sid),'22023');
  if exists(select 1 from public.submissions where id=sid and current_order_id is not null) then raise exception 'Rejected bank request created an order'; end if;
  select array_agg(submission_id) into ids from public.begin_submission_bank_payment(array[sid],null,'  홍길동 ',now()+interval '3 days');
  select current_order_id into oid from public.submissions where id=sid;
  if ids is distinct from array[sid] or oid is null then raise exception 'Bank request did not create the order'; end if;
  if (select depositor_name from public.submission_orders where id=oid)<>'홍길동'
    or (select deposit_due_at from public.submission_orders where id=oid) is null
    or (select status from public.submission_orders where id=oid)<>'BANK_PENDING' then
    raise exception 'Depositor details were not stored on the order'; end if;
  if has_function_privilege('authenticated','public.begin_submission_bank_payment(uuid[],uuid,text,timestamptz)','execute') then
    raise exception 'Bank RPC exposed to members'; end if;
end;
$$;

-- 3. Guest drafts move to the account that presents the exact token; carts and ordered rows do not.
do $$
declare draft_id uuid:='00000000-0000-4000-8000-00000000d001'; cart_id uuid:='00000000-0000-4000-8000-00000000d002'; other_id uuid:='00000000-0000-4000-8000-00000000d003'; claimed uuid[];
begin
  insert into public.submissions(id,user_id,guest_token,type,status,payment_status,payment_method,amount_krw,title)
  values (draft_id,null,'guest-draft-token-0001','ALBUM','DRAFT','UNPAID','BANK',0,'Draft in progress'),
         (cart_id,null,'guest-draft-token-0001','ALBUM','SUBMITTED','UNPAID','BANK',50000,'Already in cart'),
         (other_id,null,'guest-draft-token-0002','ALBUM','DRAFT','UNPAID','BANK',0,'Someone else');
  select array_agg(submission_id) into claimed from public.claim_guest_draft_submissions('11111111-1111-4111-8111-111111111111',array['guest-draft-token-0001','short']);
  if claimed is distinct from array[draft_id] then raise exception 'Unexpected draft claim result: %',claimed; end if;
  if (select user_id from public.submissions where id=draft_id) is distinct from '11111111-1111-4111-8111-111111111111'
    or (select guest_token from public.submissions where id=draft_id) is not null then raise exception 'Draft ownership not transferred'; end if;
  if (select user_id from public.submissions where id=cart_id) is not null or (select user_id from public.submissions where id=other_id) is not null then
    raise exception 'Cart item or another guest draft was claimed'; end if;
  if not exists(select 1 from public.submission_events where submission_id=draft_id and event_type='OWNER_CLAIM') then raise exception 'Claim event missing'; end if;
  select array_agg(submission_id) into claimed from public.claim_guest_draft_submissions('11111111-1111-4111-8111-111111111111',array['guest-draft-token-0001']);
  if claimed is not null then raise exception 'Second claim should find nothing'; end if;
  perform pg_temp.expect_error('select * from public.claim_guest_draft_submissions(null,array[''guest-draft-token-0002''])','22023');
  if has_function_privilege('authenticated','public.claim_guest_draft_submissions(uuid,text[])','execute') then
    raise exception 'Claim RPC exposed to members'; end if;
end;
$$;

-- 4. Only empty, old draft shells are purged.
do $$
declare empty_id uuid:='00000000-0000-4000-8000-00000000e001'; typed_id uuid:='00000000-0000-4000-8000-00000000e002'; fresh_id uuid:='00000000-0000-4000-8000-00000000e003'; filed_id uuid:='00000000-0000-4000-8000-00000000e004'; deleted integer;
begin
  -- The fixture table defaults artist/applicant fields to sample text; real
  -- empty shells have them blank, so clear them explicitly here.
  insert into public.submissions(id,user_id,guest_token,type,status,payment_status,payment_method,amount_krw,title,artist_name,applicant_email,created_at,updated_at)
  values (empty_id,null,'purge-token-0001','MV_DISTRIBUTION','DRAFT','UNPAID','BANK',0,null,null,null,now()-interval '2 days',now()-interval '2 days'),
         (typed_id,null,'purge-token-0002','MV_DISTRIBUTION','DRAFT','UNPAID','BANK',0,'Typed a title',null,null,now()-interval '2 days',now()-interval '2 days'),
         (fresh_id,null,'purge-token-0003','MV_DISTRIBUTION','DRAFT','UNPAID','BANK',0,null,null,null,now()-interval '2 hours',now()-interval '2 hours'),
         (filed_id,null,'purge-token-0004','ALBUM','DRAFT','UNPAID','BANK',0,null,null,null,now()-interval '2 days',now()-interval '2 days');
  insert into public.submission_upload_staging(submission_id) values (filed_id);
  select deleted_count into deleted from public.purge_empty_draft_submissions();
  if deleted<>1 or exists(select 1 from public.submissions where id=empty_id) then raise exception 'Empty draft shell was not purged (deleted %)',deleted; end if;
  if (select count(*) from public.submissions where id in (typed_id,fresh_id,filed_id))<>3 then raise exception 'Purge removed a draft with content, uploads or recent activity'; end if;
  perform pg_temp.expect_error('select * from public.purge_empty_draft_submissions(interval ''10 minutes'')','22023');
  if has_function_privilege('authenticated','public.purge_empty_draft_submissions(interval,integer)','execute') then
    raise exception 'Purge RPC exposed to members'; end if;
end;
$$;
rollback;
