\set ON_ERROR_STOP on
-- 2026-11-14: order items keep the album price tier and list price they were
-- charged at, so order history and payment mails can mark the half-price
-- albums. scripts/submission-orders-sql-test.sh splices the migration in at
-- the marker below; everything runs in one transaction and is rolled back.
begin;
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.album(p_id uuid,p_price integer,p_created timestamptz default now())
returns void language sql as $$
  insert into public.submissions(id,user_id,type,package_id,status,payment_status,payment_method,amount_krw,album_base_price_krw,album_price_tier,created_at)
  values(p_id,'11111111-1111-4111-8111-111111111111','ALBUM','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID','CARD',p_price,p_price,'FULL',p_created);
$$;

-- Orders placed before the columns existed: two albums and a music video,
-- and a second order that has already gone back to the cart.
select pg_temp.album('b0000000-0000-4000-8000-000000000001',100000,'2026-11-14 09:00+09');
select pg_temp.album('b0000000-0000-4000-8000-000000000002',100000,'2026-11-14 10:00+09');
insert into public.submissions(id,user_id,type,status,payment_status,payment_method,amount_krw,album_base_price_krw,album_price_tier)
values('b0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','MV_DISTRIBUTION','SUBMITTED','UNPAID','CARD',30000,null,null);
select * from public.begin_submission_bank_payment(array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003']::uuid[],
  '11111111-1111-4111-8111-111111111111');
select pg_temp.album('b0000000-0000-4000-8000-000000000011',70000,'2026-11-14 09:00+09');
select pg_temp.album('b0000000-0000-4000-8000-000000000012',70000,'2026-11-14 10:00+09');
select * from public.begin_submission_bank_payment(array['b0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000012']::uuid[],
  '11111111-1111-4111-8111-111111111111');
create temp table returned_order on commit drop as
  select current_order_id as id from public.submissions where id='b0000000-0000-4000-8000-000000000011';
select * from public.return_submission_order_to_cart((select id from returned_order),'11111111-1111-4111-8111-111111111111','{}');

-- @apply-migration

create function pg_temp.item(p_id uuid,p_order uuid default null) returns text language sql as $$
  select coalesce(album_price_tier,'-')||':'||coalesce(album_base_price_krw::text,'-')||':'||amount_krw
  from public.submission_order_items
  where submission_ref=p_id and (p_order is null or order_id=p_order)
  order by created_at desc limit 1;
$$;
do $$ begin
  -- Filled from the applications still attached to the order.
  if pg_temp.item('b0000000-0000-4000-8000-000000000001')<>'FULL:100000:100000'
    or pg_temp.item('b0000000-0000-4000-8000-000000000002')<>'ADDITIONAL:100000:50000'
    or pg_temp.item('b0000000-0000-4000-8000-000000000003')<>'-:-:30000' then
    raise exception 'Backfill wrong: % / % / %',pg_temp.item('b0000000-0000-4000-8000-000000000001'),
      pg_temp.item('b0000000-0000-4000-8000-000000000002'),pg_temp.item('b0000000-0000-4000-8000-000000000003'); end if;
  -- A returned order's applications are back at list price: nothing to copy, amounts untouched.
  if pg_temp.item('b0000000-0000-4000-8000-000000000012')<>'-:-:35000' then
    raise exception 'Returned order was backfilled from repriced applications: %',pg_temp.item('b0000000-0000-4000-8000-000000000012'); end if;
end $$;

-- New orders record the tier and list price at checkout and keep them after
-- the applications return to the cart at list price.
select * from public.begin_submission_bank_payment(array['b0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000012']::uuid[],
  '11111111-1111-4111-8111-111111111111');
do $$
declare oid uuid;
begin
  select current_order_id into oid from public.submissions where id='b0000000-0000-4000-8000-000000000012';
  if pg_temp.item('b0000000-0000-4000-8000-000000000011',oid)<>'FULL:70000:70000'
    or pg_temp.item('b0000000-0000-4000-8000-000000000012',oid)<>'ADDITIONAL:70000:35000' then
    raise exception 'New order snapshot wrong: % / %',pg_temp.item('b0000000-0000-4000-8000-000000000011',oid),
      pg_temp.item('b0000000-0000-4000-8000-000000000012',oid); end if;
  perform * from public.return_submission_order_to_cart(oid,'11111111-1111-4111-8111-111111111111','{}');
  if (select album_price_tier from public.submissions where id='b0000000-0000-4000-8000-000000000012')<>'FULL'
    or pg_temp.item('b0000000-0000-4000-8000-000000000012',oid)<>'ADDITIONAL:70000:35000' then
    raise exception 'Returning the order rewrote its item snapshot'; end if;
end $$;

-- The snapshot function keeps its restricted grants.
do $$ begin
  if has_function_privilege('authenticated','public.snapshot_submission_order_items(uuid,uuid[])','execute')
    or has_function_privilege('anon','public.snapshot_submission_order_items(uuid,uuid[])','execute') then
    raise exception 'Snapshot function became callable by clients'; end if;
end $$;
set constraints all immediate;
rollback;
\echo 'Order item album discount assertions passed.'
