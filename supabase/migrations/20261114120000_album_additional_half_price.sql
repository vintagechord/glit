-- Albums ordered together (owner, 2026-11-14): the first album is charged its
-- package price and every further album in the same order half of its own.
-- Two 100,000 won albums cost 150,000; three cost 200,000. Music videos are
-- never discounted.
--
-- An application keeps its list price while it sits in the cart. The discount
-- is written only when an order is created, inside the transaction that locks
-- the rows, and is undone when the order goes back to the cart. So a cart row
-- is always FULL, and an ADDITIONAL row always belongs to an order that also
-- holds its full-price album.
--
-- No existing row is changed by this migration.

-- 1. Price the albums of one order ---------------------------------------------
-- The caller holds the row locks. The highest list price is the full-price
-- album (ties: earliest application, then id), which is the smallest discount
-- a mixed-package order can get. src/lib/album-payment-discount.ts quotes the
-- same result for the cart and the card window.
--
-- Albums of a pre-2026-10-20 draft group (album_draft_group_id) keep the tiers
-- that group was saved with: validate_album_draft_group_binding still guards
-- them, and no application has been written into a group since.
create or replace function public.apply_album_checkout_discount(p_submission_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_full_id uuid;
begin
  select s.id into v_full_id
  from public.submissions s
  where s.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
    and s.type = 'ALBUM'
    and s.album_draft_group_id is null
    and s.package_id is not null
    and s.album_base_price_krw > 0
  order by s.album_base_price_krw desc, s.created_at, s.id
  limit 1;

  -- No album with a server-written price snapshot: nothing to price here.
  -- assert_album_price_snapshots still rejects an album without one.
  if v_full_id is null then
    return;
  end if;

  update public.submissions s
  set album_price_tier = pricing.tier,
      amount_krw = pricing.amount_krw,
      album_discount_base_submission_id = pricing.base_id
  from (
    select a.id,
      case when a.id = v_full_id then 'FULL' else 'ADDITIONAL' end as tier,
      case when a.id = v_full_id then a.album_base_price_krw
        else round(a.album_base_price_krw * 0.5)::integer end as amount_krw,
      case when a.id = v_full_id then null::uuid else v_full_id end as base_id
    from public.submissions a
    where a.id = any(p_submission_ids)
      and a.type = 'ALBUM'
      and a.album_draft_group_id is null
      and a.package_id is not null
      and a.album_base_price_krw > 0
  ) pricing
  where s.id = pricing.id
    and (
      s.album_price_tier is distinct from pricing.tier
      or s.amount_krw is distinct from pricing.amount_krw
      or s.album_discount_base_submission_id is distinct from pricing.base_id
    );
end;
$$;

revoke all on function public.apply_album_checkout_discount(uuid[])
  from public, anon, authenticated;
grant execute on function public.apply_album_checkout_discount(uuid[])
  to service_role;

-- 2. Order creation prices the albums before it totals them -----------------------
-- Latest definition: 0097. The only change is the apply_album_checkout_discount
-- call; the order total and the item snapshots then read the discounted rows.
create or replace function public.create_submission_checkout_order(p_ids uuid[],p_user_id uuid,p_method text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare ids uuid[]; oid uuid; total numeric; currency_value text; owner_id uuid;
begin
  if coalesce(cardinality(p_ids),0) not between 1 and 100 or p_method not in ('BANK','CARD','PAYPAL') then
    raise exception 'INVALID_ORDER' using errcode='22023'; end if;
  select array_agg(distinct x order by x) into ids from unnest(p_ids) x;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  if (select count(*) from public.submissions where id=any(ids))<>cardinality(ids) then
    raise exception 'SUBMISSION_NOT_FOUND' using errcode='P0002'; end if;
  if exists(select 1 from public.submissions s where s.id=any(ids) and (
    s.user_id is distinct from p_user_id or s.current_order_id is not null or s.user_deleted_at is not null
    or s.status not in ('SUBMITTED','WAITING_PAYMENT') or s.payment_status<>'UNPAID' or s.save_lease_token is not null)) then
    raise exception 'ORDER_ALREADY_EXISTS_OR_NOT_PAYABLE' using errcode='55000'; end if;
  if exists(select 1 from public.submissions s join public.submissions sibling
    on sibling.album_draft_group_id=s.album_draft_group_id and sibling.user_deleted_at is null
    where s.id=any(ids) and s.type='ALBUM' and not(sibling.id=any(ids))
      and sibling.payment_status<>'PAID') then
    raise exception 'ALBUM_GROUP_INCOMPLETE' using errcode='55000'; end if;
  if exists(select 1 from public.submission_payments p cross join unnest(ids) x
    where p.status in ('REQUESTED','APPROVED') and public.submission_payment_includes_submission(p.submission_id,p.raw_response,x)) then
    raise exception 'PAYMENT_ALREADY_IN_PROGRESS' using errcode='55000'; end if;
  perform public.apply_album_checkout_discount(ids);
  select case when p_method='PAYPAL' then sum(s.payment_amount) else sum(s.amount_krw) end,
    case when p_method='PAYPAL' then max(s.payment_currency) else 'KRW' end into total,currency_value
  from public.submissions s where s.id=any(ids);
  if total is null or total<=0 then raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode='22000'; end if;
  owner_id:=p_user_id;
  insert into public.submission_orders(user_id,payment_method,status,amount_krw,amount,currency)
  select owner_id,p_method,p_method||'_PENDING',sum(s.amount_krw),total,upper(currency_value)
  from public.submissions s where s.id=any(ids) returning id into oid;
  perform public.snapshot_submission_order_items(oid,ids);
  perform set_config('onside.checkout_order_write',oid::text,true);
  update public.submissions set current_order_id=oid where id=any(ids);
  return oid;
end;
$$;

-- 3. Payment start verifies what step 1 wrote ------------------------------------
-- Latest definition: 0093. A discounted album needs the order's full-price
-- album: same owner, never cheaper than the discounted one. Packages may
-- differ. An album paid earlier no longer unlocks a discount, and two
-- full-price albums in one request mean the pricing step was skipped.
create or replace function public.bind_album_payment_discount_eligibility(
  p_submission_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_discounted public.submissions%rowtype;
  v_base_submission_id uuid;
begin
  perform public.assert_album_price_snapshots(p_submission_ids);

  perform sibling.id
  from public.submissions sibling
  where sibling.album_draft_group_id in (
      select distinct requested.album_draft_group_id
      from public.submissions requested
      where requested.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
        and requested.type = 'ALBUM'
        and requested.album_draft_group_id is not null
    )
    and sibling.status in ('DRAFT', 'PRE_REVIEW', 'SUBMITTED', 'WAITING_PAYMENT')
    and sibling.payment_status <> 'PAID'
  order by sibling.id
  for update;

  if exists (
    select 1
    from public.submissions sibling
    where sibling.album_draft_group_id in (
        select distinct requested.album_draft_group_id
        from public.submissions requested
        where requested.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
          and requested.type = 'ALBUM'
          and requested.album_draft_group_id is not null
      )
      and sibling.status in ('DRAFT', 'PRE_REVIEW', 'SUBMITTED', 'WAITING_PAYMENT')
      and sibling.payment_status <> 'PAID'
      and not (sibling.id = any(coalesce(p_submission_ids, '{}'::uuid[])))
  ) then
    raise exception 'ALBUM_GROUP_INCOMPLETE' using errcode = '55000';
  end if;

  if (
    select count(*)
    from public.submissions album
    where album.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
      and album.type = 'ALBUM'
      and album.album_draft_group_id is null
      and album.album_price_tier = 'FULL'
  ) > 1 then
    raise exception 'ALBUM_DISCOUNT_NOT_APPLIED' using errcode = '55000';
  end if;

  for v_discounted in
    select discounted.*
    from public.submissions discounted
    where discounted.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
      and discounted.type = 'ALBUM'
      and discounted.album_price_tier = 'ADDITIONAL'
    order by discounted.id
  loop
    v_base_submission_id := null;

    select base.id
      into v_base_submission_id
    from public.submissions base
    where base.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
      and base.id <> v_discounted.id
      and base.type = 'ALBUM'
      and base.album_price_tier = 'FULL'
      and base.album_base_price_krw >= v_discounted.album_base_price_krw
      and base.amount_krw = base.album_base_price_krw
      and (
        (v_discounted.user_id is not null and base.user_id = v_discounted.user_id)
        or (v_discounted.user_id is null and base.user_id is null)
      )
    order by base.id
    limit 1;

    if v_base_submission_id is null then
      raise exception 'ALBUM_DISCOUNT_NOT_ELIGIBLE:%', v_discounted.id
        using errcode = '55000';
    end if;

    update public.submissions submission
    set album_discount_base_submission_id = v_base_submission_id
    where submission.id = v_discounted.id
      and submission.album_discount_base_submission_id
        is distinct from v_base_submission_id;
  end loop;

  update public.submissions submission
  set album_discount_base_submission_id = null
  where submission.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
    and submission.type = 'ALBUM'
    and submission.album_price_tier = 'FULL'
    and submission.album_discount_base_submission_id is not null;
end;
$function$;

-- 4. A discounted album is paid only beside its paid full-price album -------------
-- Latest definition: 0076. The bound album no longer has to share the package
-- or the release type; it must be the same owner's, paid in full, and at
-- least as expensive.
create or replace function public.enforce_paid_album_discount_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_paid_base boolean;
begin
  if tg_op = 'UPDATE'
    and old.payment_status is not distinct from new.payment_status
    and old.amount_krw is not distinct from new.amount_krw
    and old.package_id is not distinct from new.package_id
    and old.is_oneclick is not distinct from new.is_oneclick
    and old.user_id is not distinct from new.user_id
    and old.guest_token is not distinct from new.guest_token
    and old.album_base_price_krw is not distinct from new.album_base_price_krw
    and old.album_price_tier is not distinct from new.album_price_tier
    and old.album_discount_base_submission_id
      is not distinct from new.album_discount_base_submission_id
  then
    return new;
  end if;

  if new.type = 'ALBUM' and new.payment_status = 'PAID' then
    perform public.assert_album_price_snapshots(array[new.id]);

    if new.album_price_tier = 'ADDITIONAL' then
      select exists (
        select 1
        from public.submissions paid_base
        where paid_base.id = new.album_discount_base_submission_id
          and paid_base.id <> new.id
          and paid_base.type = 'ALBUM'
          and paid_base.payment_status = 'PAID'
          and paid_base.album_price_tier = 'FULL'
          and paid_base.album_base_price_krw >= new.album_base_price_krw
          and paid_base.amount_krw = paid_base.album_base_price_krw
          and (
            (new.user_id is not null and paid_base.user_id = new.user_id)
            or (new.user_id is null and paid_base.user_id is null)
          )
      ) into v_has_paid_base;

      if not coalesce(v_has_paid_base, false) then
        raise exception 'ALBUM_DISCOUNT_NOT_ELIGIBLE:%', new.id
          using errcode = '55000';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- 5. Back in the cart, an album is its list price again ---------------------------
-- Latest definition: 0097. The only change is the album columns in the UPDATE
-- that releases the applications, so the next order prices them afresh (the
-- customer may pay one album alone, or a different set).
create or replace function public.return_submission_order_to_cart(p_order_id uuid,p_user_id uuid,p_guest_tokens_by_submission_id jsonb default '{}')
returns table(submission_id uuid) language plpgsql security invoker set search_path=public as $$
declare o public.submission_orders%rowtype; ids uuid[]; p public.submission_payments%rowtype;
begin
  if jsonb_typeof(p_guest_tokens_by_submission_id) is distinct from 'object' then raise exception 'INVALID_OWNER_PROOF' using errcode='22023'; end if;
  -- Callback lock order is PG attempt, submissions, then order projection.
  -- Do not lock the projection first and invert approval's lock order.
  perform payment.id from public.submission_payments payment where payment.checkout_order_id=p_order_id order by payment.id for update;
  select array_agg(i.submission_ref order by i.submission_ref) into ids from public.submission_order_items i where i.order_id=p_order_id;
  if coalesce(cardinality(ids),0)=0 then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  select * into o from public.submission_orders where id=p_order_id for update;
  if not found or o.user_id is distinct from p_user_id then raise exception 'ORDER_OWNER_MISMATCH' using errcode='42501'; end if;
  if (select count(*) from public.submissions where id=any(ids))<>cardinality(ids)
    or exists(select 1 from public.submissions s where s.id=any(ids) and (
      s.user_id is distinct from p_user_id or (p_user_id is null and (
        nullif(s.guest_token,'') is null or (p_guest_tokens_by_submission_id->>s.id::text) is distinct from s.guest_token))))
  then raise exception 'ORDER_OWNER_MISMATCH' using errcode='42501'; end if;
  if o.returned_at is not null then
    if exists(select 1 from public.submissions s where s.id=any(ids) and s.current_order_id is not null) then
      raise exception 'ORDER_ALREADY_REPLACED' using errcode='55000'; end if;
    return query select unnest(ids); return;
  end if;
  if o.status not in ('BANK_PENDING','CARD_PENDING','PAYPAL_PENDING','FAILED','CANCELED')
    or exists(select 1 from public.submissions s where s.id=any(ids) and (
      s.current_order_id is distinct from p_order_id or s.user_deleted_at is not null
      or s.payment_status in ('PAID','REFUNDED') or s.status not in ('SUBMITTED','WAITING_PAYMENT')
      or nullif(btrim(s.result_status),'') is not null or s.result_notified_at is not null))
    or exists(select 1 from public.submission_payments payment cross join unnest(ids) x
      where payment.status='APPROVED' and public.submission_payment_includes_submission(payment.submission_id,payment.raw_response,x))
  then raise exception 'ORDER_NOT_RETURNABLE' using errcode='55000'; end if;
  perform r.id from public.station_reviews r where r.submission_id=any(ids) order by r.id for update;
  if exists(select 1 from public.station_reviews r where r.submission_id=any(ids) and r.status<>'NOT_SENT') then
    raise exception 'REVIEW_ALREADY_STARTED' using errcode='55000'; end if;
  if exists(select 1 from public.submission_payments payment where payment.checkout_order_id=p_order_id
    and payment.status='REQUESTED' and payment.result_code in ('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN','CAPTURE_IN_PROGRESS')) then
    raise exception 'PAYMENT_APPROVAL_IN_PROGRESS' using errcode='55000'; end if;

  perform set_config('onside.checkout_order_write',p_order_id::text,true);
  for p in select * from public.submission_payments where checkout_order_id=p_order_id and status='REQUESTED' order by id loop
    perform * from public.close_submission_payment_order(p.order_id,'CANCELED','RETURNED_TO_CART','주문을 장바구니로 돌리기 위해 결제 요청이 취소되었습니다.',p.raw_response);
  end loop;
  if o.status='BANK_PENDING' then
    perform * from public.reopen_submission_bank_payment_v96(ids,p_user_id,p_guest_tokens_by_submission_id);
  end if;
  update public.submissions s set current_order_id=null,payment_status='UNPAID',status='SUBMITTED',paypal_order_id=null,paypal_capture_id=null,
    amount_krw=case when s.type='ALBUM' and s.album_draft_group_id is null and s.album_price_tier='ADDITIONAL' and s.album_base_price_krw>0
      then s.album_base_price_krw else s.amount_krw end,
    album_price_tier=case when s.type='ALBUM' and s.album_draft_group_id is null and s.album_price_tier='ADDITIONAL' and s.album_base_price_krw>0
      then 'FULL' else s.album_price_tier end,
    album_discount_base_submission_id=case when s.type='ALBUM' and s.album_draft_group_id is null then null else s.album_discount_base_submission_id end
  where s.id=any(ids) and s.current_order_id=p_order_id;
  update public.submission_orders set status=case when status in ('FAILED','CANCELED') then status else 'CANCELED' end,
    returned_at=now(),updated_at=now() where id=p_order_id;
  insert into public.submission_events(submission_id,actor_user_id,event_type,message)
  select x,p_user_id,'ORDER_RETURN','주문 기록을 보존하고 신청서를 장바구니로 돌렸습니다.' from unnest(ids) x;
  return query select unnest(ids);
end;
$$;
