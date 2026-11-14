\set ON_ERROR_STOP on
-- 2026-11-14: albums ordered together — the first at list price, every further
-- album at half of its own price. Music videos are never discounted.
begin;
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.expect_error(statement text,expected text default '55000',fragment text default null) returns void language plpgsql as $$
declare rejected boolean:=false;
begin
  begin execute statement; exception when others then
    if sqlstate<>expected or (fragment is not null and position(fragment in sqlerrm)=0) then
      raise exception 'Expected % %, got %: % for %',expected,fragment,sqlstate,sqlerrm,statement; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'Unsafe statement succeeded: %',statement; end if;
end;
$$;
create function pg_temp.album(p_id uuid,p_price integer,p_created timestamptz default now(),p_user uuid default '11111111-1111-4111-8111-111111111111',p_guest text default null)
returns void language sql as $$
  insert into public.submissions(id,user_id,guest_token,type,package_id,status,payment_status,payment_method,amount_krw,album_base_price_krw,album_price_tier,created_at)
  values(p_id,case when p_guest is null then p_user end,p_guest,'ALBUM','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID','CARD',p_price,p_price,'FULL',p_created);
$$;
create function pg_temp.priced(p_id uuid) returns text language sql as $$
  select album_price_tier||':'||amount_krw||':'||coalesce(album_discount_base_submission_id::text,'-') from public.submissions where id=p_id;
$$;

-- Two albums of 100,000 won cost 150,000; the earlier application is the full-price one.
select pg_temp.album('a0000000-0000-4000-8000-000000000001',100000,'2026-11-14 10:00+09');
select pg_temp.album('a0000000-0000-4000-8000-000000000002',100000,'2026-11-14 09:00+09');
select * from public.begin_submission_bank_payment(array['a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002']::uuid[],
  '11111111-1111-4111-8111-111111111111','홍길동',now()+interval '1 day');
do $$
declare oid uuid; ids uuid[]:=array['a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002']::uuid[];
begin
  select current_order_id into oid from public.submissions where id=ids[1];
  if pg_temp.priced(ids[2])<>'FULL:100000:-' or pg_temp.priced(ids[1])<>'ADDITIONAL:50000:'||ids[2]::text then
    raise exception 'Two-album pricing wrong: % / %',pg_temp.priced(ids[1]),pg_temp.priced(ids[2]); end if;
  if (select amount_krw from public.submission_orders where id=oid)<>150000 or (select amount from public.submission_orders where id=oid)<>150000
    or (select sum(amount_krw) from public.submission_order_items where order_id=oid)<>150000
    or (select amount_krw from public.submission_order_items where order_id=oid and submission_ref=ids[1])<>50000 then
    raise exception 'Order or snapshot does not carry the discounted amounts'; end if;
  -- The deposit confirmation pays the discounted album beside its full-price album.
  perform * from public.confirm_submission_order_bank_payment(oid,'99999999-9999-4999-8999-999999999999',null);
  set constraints all immediate;
  set constraints all deferred;
  if exists(select 1 from public.submissions where id=any(ids) and payment_status<>'PAID')
    or (select status from public.submission_orders where id=oid)<>'PAID' then raise exception 'Discounted bank order was not confirmed as a whole'; end if;
end $$;

-- Three albums cost 100,000 + 50,000 + 50,000; a music video in the same order keeps its price.
select pg_temp.album('a0000000-0000-4000-8000-000000000011',100000);
select pg_temp.album('a0000000-0000-4000-8000-000000000012',100000);
select pg_temp.album('a0000000-0000-4000-8000-000000000013',100000);
insert into public.submissions(id,user_id,type,status,payment_status,payment_method,amount_krw,album_base_price_krw,album_price_tier)
values('a0000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','MV_DISTRIBUTION','SUBMITTED','UNPAID','CARD',30000,null,null);
-- The card window must be opened with the discounted total: the list total is refused and changes nothing.
select pg_temp.expect_error($q$select * from public.begin_submission_payment_order('a0000000-0000-4000-8000-000000000011',
  array['a0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000013','a0000000-0000-4000-8000-000000000014']::uuid[],
  'HALF-LIST',330000,'11111111-1111-4111-8111-111111111111','{}')$q$,'22000','PAYMENT_AMOUNT_MISMATCH');
do $$ begin
  if exists(select 1 from public.submissions where id::text like 'a0000000-0000-4000-8000-00000000001_'
    and (current_order_id is not null or (type='ALBUM' and (amount_krw<>100000 or album_price_tier<>'FULL')))) then
    raise exception 'A refused card start left discounted rows or an order behind'; end if;
end $$;
select * from public.begin_submission_payment_order('a0000000-0000-4000-8000-000000000011',
  array['a0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000013','a0000000-0000-4000-8000-000000000014']::uuid[],
  'HALF-THREE',230000,'11111111-1111-4111-8111-111111111111',
  '{"closeState":"11111111-1111-4111-8111-111111111111","paymentGroup":{"submissionIds":["a0000000-0000-4000-8000-000000000011","a0000000-0000-4000-8000-000000000012","a0000000-0000-4000-8000-000000000013","a0000000-0000-4000-8000-000000000014"]}}');
do $$
declare oid uuid;
begin
  select checkout_order_id into oid from public.submission_payments where order_id='HALF-THREE';
  if (select amount_krw from public.submission_orders where id=oid)<>230000
    or pg_temp.priced('a0000000-0000-4000-8000-000000000011')<>'FULL:100000:-'
    or pg_temp.priced('a0000000-0000-4000-8000-000000000012')<>'ADDITIONAL:50000:a0000000-0000-4000-8000-000000000011'
    or pg_temp.priced('a0000000-0000-4000-8000-000000000013')<>'ADDITIONAL:50000:a0000000-0000-4000-8000-000000000011'
    or (select amount_krw from public.submissions where id='a0000000-0000-4000-8000-000000000014')<>30000
    or (select album_price_tier from public.submissions where id='a0000000-0000-4000-8000-000000000014') is not null then
    raise exception 'Three albums and a music video were not priced 100000+50000+50000+30000'; end if;
  -- A failed card attempt keeps the order; back in the cart every album is its list price again.
  perform * from public.close_submission_payment_order('HALF-THREE','FAILED','TEST','Test failure','{}');
  if pg_temp.priced('a0000000-0000-4000-8000-000000000012')<>'ADDITIONAL:50000:a0000000-0000-4000-8000-000000000011' then
    raise exception 'A failed attempt repriced the order before it was returned'; end if;
  perform * from public.return_submission_order_to_cart(oid,'11111111-1111-4111-8111-111111111111','{}');
  if exists(select 1 from public.submissions where id::text like 'a0000000-0000-4000-8000-00000000001_' and type='ALBUM'
    and (current_order_id is not null or amount_krw<>100000 or album_price_tier<>'FULL' or album_discount_base_submission_id is not null))
    or (select amount_krw from public.submissions where id='a0000000-0000-4000-8000-000000000014')<>30000 then
    raise exception 'Returning the order did not restore list prices'; end if;
  if (select sum(amount_krw) from public.submission_order_items where order_id=oid)<>230000 then
    raise exception 'Returning the order rewrote its history'; end if;
end $$;
-- One of those albums paid alone is charged in full.
select * from public.begin_submission_payment_order('a0000000-0000-4000-8000-000000000012',array['a0000000-0000-4000-8000-000000000012']::uuid[],
  'HALF-ALONE',100000,'11111111-1111-4111-8111-111111111111','{"closeState":"11111111-1111-4111-8111-111111111111"}');
do $$ begin
  if pg_temp.priced('a0000000-0000-4000-8000-000000000012')<>'FULL:100000:-' then raise exception 'A single album was discounted'; end if;
end $$;
-- The remaining two are paid together by card and approved as one order.
select * from public.begin_submission_payment_order('a0000000-0000-4000-8000-000000000013',
  array['a0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000013']::uuid[],'HALF-PAIR',150000,'11111111-1111-4111-8111-111111111111',
  '{"closeState":"11111111-1111-4111-8111-111111111111","paymentGroup":{"submissionIds":["a0000000-0000-4000-8000-000000000011","a0000000-0000-4000-8000-000000000013"]}}');
select * from public.claim_inicis_submission_approval('HALF-PAIR','11111111-1111-4111-8111-111111111111');
select * from public.approve_submission_payment_order('HALF-PAIR','tid-half-pair','00','ok','{}',now());
do $$ begin
  set constraints all immediate;
  set constraints all deferred;
  if exists(select 1 from public.submissions where id in ('a0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000013') and payment_status<>'PAID')
    or not exists(select 1 from public.submission_orders o join public.submission_payments p on p.checkout_order_id=o.id
      where p.order_id='HALF-PAIR' and o.status='PAID' and o.amount_krw=150000 and p.amount_krw=150000) then
    raise exception 'Discounted card order was not approved for 150000'; end if;
end $$;

-- Different packages: the dearest album is the full-price one, whatever the order of application.
select pg_temp.album('a0000000-0000-4000-8000-000000000021',50000,'2026-11-14 08:00+09');
select pg_temp.album('a0000000-0000-4000-8000-000000000022',150000,'2026-11-14 09:00+09');
select pg_temp.album('a0000000-0000-4000-8000-000000000023',70000,'2026-11-14 10:00+09');
select * from public.begin_submission_bank_payment(array['a0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000022','a0000000-0000-4000-8000-000000000023']::uuid[],
  '11111111-1111-4111-8111-111111111111');
do $$ declare oid uuid; begin
  select current_order_id into oid from public.submissions where id='a0000000-0000-4000-8000-000000000022';
  if pg_temp.priced('a0000000-0000-4000-8000-000000000022')<>'FULL:150000:-'
    or pg_temp.priced('a0000000-0000-4000-8000-000000000021')<>'ADDITIONAL:25000:a0000000-0000-4000-8000-000000000022'
    or pg_temp.priced('a0000000-0000-4000-8000-000000000023')<>'ADDITIONAL:35000:a0000000-0000-4000-8000-000000000022'
    or (select amount_krw from public.submission_orders where id=oid)<>210000 then
    raise exception 'Mixed packages were not priced 150000+25000+35000'; end if;
end $$;

-- Guests: every application has its own lookup code, and the order is still one order.
select pg_temp.album('a0000000-0000-4000-8000-000000000031',70000,now(),null,'guest-half-token-1');
select pg_temp.album('a0000000-0000-4000-8000-000000000032',70000,now(),null,'guest-half-token-2');
select * from public.begin_submission_bank_payment(array['a0000000-0000-4000-8000-000000000031','a0000000-0000-4000-8000-000000000032']::uuid[],null);
do $$ declare oid uuid; begin
  select current_order_id into oid from public.submissions where id='a0000000-0000-4000-8000-000000000031';
  if (select amount_krw from public.submission_orders where id=oid)<>105000
    or pg_temp.priced('a0000000-0000-4000-8000-000000000032')<>'ADDITIONAL:35000:a0000000-0000-4000-8000-000000000031' then
    raise exception 'Guest order was not priced 70000+35000'; end if;
  perform * from public.return_submission_order_to_cart(oid,null,
    '{"a0000000-0000-4000-8000-000000000031":"guest-half-token-1","a0000000-0000-4000-8000-000000000032":"guest-half-token-2"}');
  if pg_temp.priced('a0000000-0000-4000-8000-000000000032')<>'FULL:70000:-' then raise exception 'Guest return did not restore the list price'; end if;
end $$;

-- A cart row that somehow carries the half price is charged in full when paid alone.
select pg_temp.album('a0000000-0000-4000-8000-000000000041',100000);
update public.submissions set album_price_tier='ADDITIONAL',amount_krw=50000 where id='a0000000-0000-4000-8000-000000000041';
select * from public.begin_submission_bank_payment(array['a0000000-0000-4000-8000-000000000041']::uuid[],'11111111-1111-4111-8111-111111111111');
do $$ begin
  if pg_temp.priced('a0000000-0000-4000-8000-000000000041')<>'FULL:100000:-'
    or (select o.amount_krw from public.submission_orders o join public.submissions s on s.current_order_id=o.id where s.id='a0000000-0000-4000-8000-000000000041')<>100000 then
    raise exception 'A half-price album was payable on its own'; end if;
end $$;

-- The payment-start checks stand on their own: two full-price albums mean the
-- pricing step was skipped, and a half-price album needs the order's full-price album.
select pg_temp.album('a0000000-0000-4000-8000-000000000051',100000);
select pg_temp.album('a0000000-0000-4000-8000-000000000052',100000);
select pg_temp.expect_error($q$select public.bind_album_payment_discount_eligibility(array['a0000000-0000-4000-8000-000000000051','a0000000-0000-4000-8000-000000000052']::uuid[])$q$,'55000','ALBUM_DISCOUNT_NOT_APPLIED');
update public.submissions set album_price_tier='ADDITIONAL',amount_krw=50000 where id='a0000000-0000-4000-8000-000000000052';
select pg_temp.expect_error($q$select public.bind_album_payment_discount_eligibility(array['a0000000-0000-4000-8000-000000000052']::uuid[])$q$,'55000','ALBUM_DISCOUNT_NOT_ELIGIBLE');
-- A cheaper album cannot be the full-price one beside a dearer half-price album.
update public.submissions set album_base_price_krw=150000,amount_krw=75000 where id='a0000000-0000-4000-8000-000000000052';
select pg_temp.expect_error($q$select public.bind_album_payment_discount_eligibility(array['a0000000-0000-4000-8000-000000000051','a0000000-0000-4000-8000-000000000052']::uuid[])$q$,'55000','ALBUM_DISCOUNT_NOT_ELIGIBLE');
-- A wrong amount for the tier is still refused first.
update public.submissions set amount_krw=60000 where id='a0000000-0000-4000-8000-000000000052';
select pg_temp.expect_error($q$select public.bind_album_payment_discount_eligibility(array['a0000000-0000-4000-8000-000000000051','a0000000-0000-4000-8000-000000000052']::uuid[])$q$,'22000','ALBUM_PRICE_SNAPSHOT_INVALID');

-- A half-price album can never be recorded as paid without its paid full-price album.
select pg_temp.album('a0000000-0000-4000-8000-000000000061',100000);
select pg_temp.album('a0000000-0000-4000-8000-000000000062',100000);
update public.submissions set album_price_tier='ADDITIONAL',amount_krw=50000,album_discount_base_submission_id='a0000000-0000-4000-8000-000000000061'
  where id='a0000000-0000-4000-8000-000000000062';
select pg_temp.expect_error($q$do $x$ begin
  update public.submissions set payment_status='PAID' where id='a0000000-0000-4000-8000-000000000062';
  set constraints all immediate;
end $x$$q$,'55000','ALBUM_DISCOUNT_NOT_ELIGIBLE');
set constraints all deferred;

-- PayPal pays one application; an album paid that way is its list price.
insert into public.submissions(id,user_id,type,package_id,status,payment_status,payment_method,payment_provider,payment_amount,payment_currency,amount_krw,album_base_price_krw,album_price_tier)
values('a0000000-0000-4000-8000-000000000071','11111111-1111-4111-8111-111111111111','ALBUM','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SUBMITTED','UNPAID','PAYPAL','paypal',90,'USD',100000,100000,'FULL');
select * from public.begin_paypal_submission_payment('a0000000-0000-4000-8000-000000000071','11111111-1111-4111-8111-111111111111',null,'HALF-PAYPAL',90,'USD','{"paypalReturnState":"11111111-1111-4111-8111-111111111111"}');
do $$ begin
  if pg_temp.priced('a0000000-0000-4000-8000-000000000071')<>'FULL:100000:-' then raise exception 'PayPal album was repriced'; end if;
end $$;

do $$ begin
  if has_function_privilege('authenticated','public.apply_album_checkout_discount(uuid[])','execute')
    or has_function_privilege('anon','public.apply_album_checkout_discount(uuid[])','execute')
    or not has_function_privilege('service_role','public.apply_album_checkout_discount(uuid[])','execute') then
    raise exception 'Album pricing RPC permissions incorrect'; end if;
end $$;
set constraints all immediate;
rollback;
\echo 'Album additional half-price assertions passed.'
