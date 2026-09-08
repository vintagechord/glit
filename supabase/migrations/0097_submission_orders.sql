-- Checkout history is independent of editable submissions and PG attempts.
create table public.submission_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  payment_method text not null check (payment_method in ('BANK','CARD','PAYPAL')),
  status text not null check (status in ('BANK_PENDING','CARD_PENDING','PAYPAL_PENDING','PAID','FAILED','CANCELED','REFUNDED','REVIEW_REQUIRED')),
  amount_krw integer,
  amount numeric(12,2),
  currency text not null default 'KRW',
  source text not null default 'live' check (source in ('live','legacy_payment','legacy_submission','legacy_anomaly')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  returned_at timestamptz
);
create table public.submission_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.submission_orders(id) on delete restrict,
  submission_id uuid references public.submissions(id) on delete set null,
  submission_ref uuid not null,
  type text,
  title text,
  artist_name text,
  package_name text,
  amount_krw integer,
  amount numeric(12,2),
  is_oneclick boolean,
  album_draft_group_id uuid,
  file_ids uuid[] not null default '{}',
  guest_token_hash text,
  created_at timestamptz not null default now(),
  unique(order_id, submission_ref)
);
alter table public.submissions add column current_order_id uuid references public.submission_orders(id) on delete restrict;
alter table public.submission_payments add column checkout_order_id uuid references public.submission_orders(id) on delete restrict;
create index submission_orders_owner_created_idx on public.submission_orders(user_id,created_at desc,id);
create index submission_order_items_submission_idx on public.submission_order_items(submission_id);
create index submission_order_items_ref_order_idx on public.submission_order_items(submission_ref,order_id);
create index submissions_current_order_idx on public.submissions(current_order_id) where current_order_id is not null;
create unique index submission_payments_checkout_order_idx on public.submission_payments(checkout_order_id) where checkout_order_id is not null;
alter table public.submission_orders enable row level security;
alter table public.submission_order_items enable row level security;
revoke all on public.submission_orders, public.submission_order_items from public, anon, authenticated, service_role;
grant select on public.submission_orders, public.submission_order_items to authenticated;
grant select,insert,update on public.submission_orders, public.submission_order_items to service_role;
create policy submission_orders_owner_read on public.submission_orders for select to authenticated
  using(user_id = auth.uid());
create policy submission_order_items_owner_read on public.submission_order_items for select to authenticated
  using(exists(select 1 from public.submission_orders o where o.id = order_id and o.user_id = auth.uid()));

create function public.snapshot_submission_order_items(p_order_id uuid,p_ids uuid[])
returns void language sql security invoker set search_path=public as $$
  insert into public.submission_order_items(order_id,submission_id,submission_ref,type,title,artist_name,package_name,amount_krw,amount,is_oneclick,album_draft_group_id,file_ids,guest_token_hash)
  select p_order_id,s.id,s.id,s.type::text,s.title,s.artist_name,p.name,s.amount_krw,
    case when o.currency='KRW' then s.amount_krw else s.payment_amount end,
    s.is_oneclick,s.album_draft_group_id,
    array(select f.id from public.submission_files f where f.submission_id=s.id order by f.id),
    case when s.user_id is null and nullif(s.guest_token,'') is not null then encode(sha256(convert_to(s.guest_token,'UTF8')),'hex') end
  from public.submissions s left join public.packages p on p.id=s.package_id
  join public.submission_orders o on o.id=p_order_id
  where s.id=any(p_ids)
  on conflict(order_id,submission_ref) do nothing;
$$;

-- Existing PG records are exact attempts, including canceled and failed ones.
-- A current parent is not rewritten to invent a historical financial result.
-- ADD COLUMN already holds the parent table lock until this migration commits.
-- Suspend only the old field-comparison trigger for the new pointer backfill;
-- it predates current_order_id and would reject an otherwise unchanged row.
alter table public.submissions disable trigger protect_requested_payment_submission_update;
do $$
declare p public.submission_payments%rowtype; ids uuid[]; oid uuid; n integer; owners integer; owner_id uuid; anomaly boolean;
begin
  for p in select * from public.submission_payments order by created_at,id loop
    ids := public.submission_payment_group_ids(p.submission_id,p.raw_response);
    select count(*),count(distinct coalesce(s.user_id::text,'guest')),min(s.user_id::text)::uuid
      into n,owners,owner_id from public.submissions s where s.id=any(ids);
    anomaly := n<>cardinality(ids) or owners<>1 or n=0
      or (coalesce(p.provider,'inicis')<>'paypal' and p.amount_krw is distinct from
        (select sum(s.amount_krw) from public.submissions s where s.id=any(ids)))
      or (p.status='APPROVED' and exists(select 1 from public.submissions s where s.id=any(ids) and s.payment_status not in ('PAID','REFUNDED')))
      or (p.status='APPROVED' and exists(select 1 from public.submissions s where s.id=any(ids) and s.payment_status='REFUNDED')
        and exists(select 1 from public.submissions s where s.id=any(ids) and s.payment_status<>'REFUNDED'))
      or (p.status='REQUESTED' and exists(select 1 from public.submissions s where s.id=any(ids)
        and (s.payment_status<>'PAYMENT_PENDING' or s.payment_method::text<>case when p.provider='paypal' then 'PAYPAL' else 'CARD' end)));
    insert into public.submission_orders(user_id,payment_method,status,amount_krw,amount,currency,source,note,created_at,updated_at,paid_at)
    values(case when owners=1 then owner_id when n=0 then p.user_id else null end,
      case when p.provider='paypal' then 'PAYPAL' else 'CARD' end,
      case when anomaly then 'REVIEW_REQUIRED' when p.status='APPROVED' and not exists(select 1 from public.submissions s where s.id=any(ids) and s.payment_status<>'REFUNDED') then 'REFUNDED'
        when p.status='APPROVED' then 'PAID'
        when p.status='REQUESTED' then case when p.provider='paypal' then 'PAYPAL_PENDING' else 'CARD_PENDING' end
        when p.status='FAILED' then 'FAILED' else 'CANCELED' end,
      p.amount_krw,case when p.provider='paypal' then p.amount else p.amount_krw end,
      case when p.provider='paypal' then coalesce(p.currency,'USD') else 'KRW' end,
      case when anomaly then 'legacy_anomaly' else 'legacy_payment' end,
      case when anomaly then '기존 결제와 현재 신청서의 소유권·묶음·금액 확인이 필요합니다.' else '기존 PG 결제 기록입니다. 항목 설명은 이관 당시 자료입니다.' end,
      p.created_at,p.updated_at,p.paid_at) returning id into oid;
    perform public.snapshot_submission_order_items(oid,ids);
    update public.submission_payments set checkout_order_id=oid where id=p.id;
    if p.status in ('REQUESTED','APPROVED') then
      if exists(select 1 from public.submissions s where s.id=any(ids) and s.current_order_id is not null) then
        update public.submission_orders set status='REVIEW_REQUIRED',source='legacy_anomaly',note='여러 진행·승인 결제가 연결되어 관리자 확인이 필요합니다.'
        where id=oid or id in(select current_order_id from public.submissions where id=any(ids));
      else
        update public.submissions set current_order_id=oid where id=any(ids);
      end if;
    end if;
  end loop;
end;
$$;

-- Bank requests had no PG row. Preserve known album groups, never infer a
-- multi-album bank order from coincident timestamps or invent historical totals.
do $$
declare s public.submissions%rowtype; ids uuid[]; oid uuid; anomaly boolean;
begin
  for s in select * from public.submissions where current_order_id is null
    and (payment_status in ('PAID','REFUNDED') or payment_status='PAYMENT_PENDING')
    order by created_at,id
  loop
    if exists(select 1 from public.submissions where id=s.id and current_order_id is not null) then continue; end if;
    select array_agg(c.id order by c.id) into ids from public.submissions c
    where c.current_order_id is null and (c.id=s.id or (s.type='ALBUM' and s.album_draft_group_id is not null
      and c.type='ALBUM' and c.album_draft_group_id=s.album_draft_group_id));
    anomaly := exists(select 1 from public.submissions c where c.id=any(ids)
      and (c.user_id is distinct from s.user_id or c.payment_status is distinct from s.payment_status
        or c.payment_method is distinct from s.payment_method or c.amount_krw is null or c.amount_krw<=0))
      or (s.payment_status='PAYMENT_PENDING' and s.payment_method<>'BANK');
    insert into public.submission_orders(user_id,payment_method,status,amount_krw,amount,currency,source,note,created_at,updated_at)
    select case when exists(select 1 from public.submissions c2 where c2.id=any(ids) and c2.user_id is distinct from s.user_id) then null else s.user_id end,coalesce(s.payment_method::text,'BANK'),
      case when anomaly then 'REVIEW_REQUIRED' when s.payment_status='PAID' then 'PAID'
        when s.payment_status='REFUNDED' then 'REFUNDED' else 'BANK_PENDING' end,
      sum(c.amount_krw),case when s.payment_method='PAYPAL' then sum(c.payment_amount) else sum(c.amount_krw) end,
      case when s.payment_method='PAYPAL' then coalesce(s.payment_currency,'USD') else 'KRW' end,
      case when anomaly then 'legacy_anomaly' else 'legacy_submission' end,
      '기존 신청서 상태를 이관한 내역입니다. 주문 생성·입금 시각은 별도로 확인되지 않았습니다.',min(c.created_at),max(c.updated_at)
    from public.submissions c where c.id=any(ids) returning id into oid;
    perform public.snapshot_submission_order_items(oid,ids);
    update public.submissions set current_order_id=oid where id=any(ids);
  end loop;
end;
$$;
-- Drain the existing deferred price-integrity trigger before further table DDL.
-- Pointer-only updates leave its financial fields unchanged.
set constraints all immediate;
alter table public.submissions enable trigger protect_requested_payment_submission_update;

create function public.create_submission_checkout_order(p_ids uuid[],p_user_id uuid,p_method text)
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

-- Keep the mature gateway/discount checks unchanged inside private wrappers.
alter function public.begin_submission_payment_order(uuid,uuid[],text,integer,uuid,jsonb) rename to begin_submission_payment_order_v96;
alter function public.begin_submission_bank_payment(uuid[],uuid) rename to begin_submission_bank_payment_v96;
alter function public.begin_paypal_submission_payment(uuid,uuid,text,text,numeric,text,jsonb) rename to begin_paypal_submission_payment_v96;
alter function public.reopen_submission_bank_payment(uuid[],uuid,jsonb) rename to reopen_submission_bank_payment_v96;
alter function public.close_submission_payment_order(text,public.submission_payment_status,text,text,jsonb) rename to close_submission_payment_order_v96;

create function public.close_submission_payment_order(p_order_id text,p_status public.submission_payment_status,p_result_code text,p_result_message text,p_raw_response jsonb)
returns table(primary_submission_id uuid,submission_ids uuid[],final_status public.submission_payment_status,transitioned boolean)
language plpgsql security invoker set search_path=public as $$
declare p public.submission_payments%rowtype;
begin
  select * into p from public.submission_payments where order_id=p_order_id for update;
  if p.status='REQUESTED' and p.result_code in ('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN','CAPTURE_IN_PROGRESS') then
    raise exception 'PAYMENT_APPROVAL_IN_PROGRESS' using errcode='55000'; end if;
  return query select * from public.close_submission_payment_order_v96(p_order_id,p_status,p_result_code,p_result_message,p_raw_response);
end;
$$;

create function public.begin_submission_payment_order(p_primary_submission_id uuid,p_submission_ids uuid[],p_order_id text,p_amount_krw integer,p_user_id uuid,p_raw_response jsonb)
returns table(submission_id uuid) language plpgsql security invoker set search_path=public as $$
begin
  perform public.create_submission_checkout_order(p_submission_ids,p_user_id,'CARD');
  return query select * from public.begin_submission_payment_order_v96(p_primary_submission_id,p_submission_ids,p_order_id,p_amount_krw,p_user_id,p_raw_response);
end;
$$;
create function public.begin_submission_bank_payment(p_submission_ids uuid[],p_user_id uuid)
returns table(submission_id uuid) language plpgsql security invoker set search_path=public as $$
begin
  perform public.create_submission_checkout_order(p_submission_ids,p_user_id,'BANK');
  return query select * from public.begin_submission_bank_payment_v96(p_submission_ids,p_user_id);
end;
$$;
create function public.begin_paypal_submission_payment(p_submission_id uuid,p_actor_user_id uuid,p_guest_token text,p_order_id text,p_amount numeric,p_currency text,p_raw_response jsonb)
returns table(payment_id uuid) language plpgsql security invoker set search_path=public as $$
declare owner_id uuid;
begin
  select user_id into owner_id from public.submissions where id=p_submission_id for update;
  if owner_id is not null and owner_id is distinct from p_actor_user_id then raise exception 'SUBMISSION_ACCESS_DENIED' using errcode='42501'; end if;
  perform public.create_submission_checkout_order(array[p_submission_id],owner_id,'PAYPAL');
  return query select * from public.begin_paypal_submission_payment_v96(p_submission_id,p_actor_user_id,p_guest_token,p_order_id,p_amount,p_currency,p_raw_response);
end;
$$;

create function public.link_submission_payment_order() returns trigger language plpgsql security invoker set search_path=public as $$
declare oid uuid; ids uuid[]; expected_ids uuid[]; o public.submission_orders%rowtype;
begin
  select current_order_id into oid from public.submissions where id=new.submission_id;
  if oid is null then raise exception 'CHECKOUT_ORDER_REQUIRED' using errcode='55000'; end if;
  if new.checkout_order_id is not null and new.checkout_order_id<>oid then raise exception 'ORDER_BINDING_MISMATCH' using errcode='22000'; end if;
  select * into o from public.submission_orders where id=oid;
  ids:=public.submission_payment_group_ids(new.submission_id,new.raw_response);
  select array_agg(submission_ref order by submission_ref) into expected_ids from public.submission_order_items where order_id=oid;
  if ids is distinct from expected_ids or o.status not in ('CARD_PENDING','PAYPAL_PENDING')
    or (o.payment_method='CARD' and (coalesce(new.provider,'inicis')<>'inicis' or new.amount_krw is distinct from o.amount_krw))
    or (o.payment_method='PAYPAL' and (new.provider is distinct from 'paypal' or new.amount is distinct from o.amount or upper(new.currency)<>o.currency))
  then raise exception 'ORDER_BINDING_MISMATCH' using errcode='22000'; end if;
  new.checkout_order_id:=oid;
  return new;
end;
$$;
create trigger link_submission_payment_order before insert on public.submission_payments for each row execute function public.link_submission_payment_order();

create function public.sync_submission_payment_order() returns trigger language plpgsql security invoker set search_path=public as $$
declare next_status text;
begin
  if new.checkout_order_id is null then return new; end if;
  if tg_op='UPDATE' and new.checkout_order_id is distinct from old.checkout_order_id then
    raise exception 'ORDER_BINDING_IMMUTABLE' using errcode='55000'; end if;
  perform set_config('onside.checkout_order_write',new.checkout_order_id::text,true);
  next_status:=case when new.status='REQUESTED' and new.result_code='APPROVAL_UNCERTAIN' then 'REVIEW_REQUIRED'
    when new.status='APPROVED' then 'PAID' when new.status='FAILED' then 'FAILED'
    when new.status='CANCELED' then 'CANCELED' when new.provider='paypal' then 'PAYPAL_PENDING' else 'CARD_PENDING' end;
  update public.submission_orders set status=next_status,paid_at=case when new.status='APPROVED' then new.paid_at else paid_at end,updated_at=now()
  where id=new.checkout_order_id and status<>'REVIEW_REQUIRED';
  return new;
end;
$$;
create trigger sync_submission_payment_order after insert or update on public.submission_payments for each row execute function public.sync_submission_payment_order();

create function public.protect_submission_order_state() returns trigger language plpgsql security invoker set search_path=public as $$
declare oid uuid; allowed boolean;
begin
  oid:=case when tg_op='DELETE' then old.current_order_id else coalesce(old.current_order_id,new.current_order_id) end;
  if oid is null then return case when tg_op='DELETE' then old else new end; end if;
  if tg_op='DELETE' then raise exception 'RETURN_ORDER_TO_CART_BEFORE_DELETE' using errcode='55000'; end if;
  allowed:=current_setting('onside.checkout_order_write',true)=oid::text;
  if not coalesce(allowed,false) and (
    new.current_order_id is distinct from old.current_order_id or new.payment_status is distinct from old.payment_status
    or new.payment_method is distinct from old.payment_method or new.user_id is distinct from old.user_id
    or new.guest_token is distinct from old.guest_token or new.amount_krw is distinct from old.amount_krw
    or new.payment_amount is distinct from old.payment_amount or new.payment_currency is distinct from old.payment_currency
    or new.album_draft_group_id is distinct from old.album_draft_group_id or new.package_id is distinct from old.package_id
    or new.is_oneclick is distinct from old.is_oneclick
    or (new.save_lease_token is not null and new.save_lease_token is distinct from old.save_lease_token)
    or (new.status in ('DRAFT','PRE_REVIEW') and new.status is distinct from old.status)
    or (old.payment_status<>'PAID' and new.status in ('IN_PROGRESS','RESULT_READY','COMPLETED'))
  ) then raise exception 'ORDER_STATE_REQUIRES_ATOMIC_ACTION' using errcode='55000'; end if;
  return new;
end;
$$;
create trigger protect_submission_order_state before update or delete on public.submissions for each row execute function public.protect_submission_order_state();

create function public.return_submission_order_to_cart(p_order_id uuid,p_user_id uuid,p_guest_tokens_by_submission_id jsonb default '{}')
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
  update public.submissions set current_order_id=null,payment_status='UNPAID',status='SUBMITTED',paypal_order_id=null,paypal_capture_id=null
  where id=any(ids) and current_order_id=p_order_id;
  update public.submission_orders set status=case when status in ('FAILED','CANCELED') then status else 'CANCELED' end,
    returned_at=now(),updated_at=now() where id=p_order_id;
  insert into public.submission_events(submission_id,actor_user_id,event_type,message)
  select x,p_user_id,'ORDER_RETURN','주문 기록을 보존하고 신청서를 장바구니로 돌렸습니다.' from unnest(ids) x;
  return query select unnest(ids);
end;
$$;

-- Compatibility for the previously deployed bank re-selection API.
create function public.reopen_submission_bank_payment(p_submission_ids uuid[],p_user_id uuid,p_guest_tokens_by_submission_id jsonb default '{}')
returns table(submission_id uuid) language plpgsql security invoker set search_path=public as $$
declare oid uuid; ids uuid[];
begin
  select array_agg(distinct x order by x) into ids from unnest(p_submission_ids) x;
  select current_order_id into oid from public.submissions where id=any(ids) order by id limit 1;
  if oid is null then
    return query select * from public.reopen_submission_bank_payment_v96(ids,p_user_id,p_guest_tokens_by_submission_id); return;
  end if;
  if ids is distinct from (select array_agg(submission_ref order by submission_ref) from public.submission_order_items where order_id=oid)
    or not exists(select 1 from public.submission_orders where id=oid and status='BANK_PENDING')
  then raise exception 'ALBUM_GROUP_INCOMPLETE' using errcode='55000'; end if;
  return query select * from public.return_submission_order_to_cart(oid,p_user_id,p_guest_tokens_by_submission_id);
end;
$$;

create function public.confirm_submission_order_bank_payment(p_order_id uuid,p_actor_user_id uuid,p_admin_memo text default null)
returns table(submission_id uuid) language plpgsql security invoker set search_path=public as $$
declare o public.submission_orders%rowtype; ids uuid[];
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  select array_agg(submission_ref order by submission_ref) into ids from public.submission_order_items where order_id=p_order_id;
  if coalesce(cardinality(ids),0)=0 then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  select * into o from public.submission_orders where id=p_order_id for update;
  if o.payment_method<>'BANK' or o.returned_at is not null or o.status not in ('BANK_PENDING','PAID')
    or (select count(*) from public.submissions where id=any(ids))<>cardinality(ids)
    or exists(select 1 from public.submissions s where s.id=any(ids) and (
      s.current_order_id is distinct from p_order_id or s.user_id is distinct from o.user_id
      or s.payment_method<>'BANK' or s.user_deleted_at is not null
      or s.payment_status is distinct from case when o.status='PAID' then 'PAID'::payment_status else 'PAYMENT_PENDING'::payment_status end))
  then raise exception 'BANK_ORDER_NOT_CONFIRMABLE' using errcode='55000'; end if;
  if o.status='PAID' then return query select unnest(ids); return; end if;
  if o.amount_krw is distinct from (select sum(s.amount_krw) from public.submissions s where s.id=any(ids))
    or exists(select 1 from public.submission_order_items i join public.submissions s on s.id=i.submission_id
      where i.order_id=p_order_id and i.amount_krw is distinct from s.amount_krw)
  then raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode='22000'; end if;
  if exists(select 1 from public.submission_payments p cross join unnest(ids) x
    where p.status in ('REQUESTED','APPROVED') and public.submission_payment_includes_submission(p.submission_id,p.raw_response,x)) then
    raise exception 'PAYMENT_ALREADY_IN_PROGRESS' using errcode='55000'; end if;
  perform set_config('onside.checkout_order_write',p_order_id::text,true);
  update public.submissions set payment_status='PAID',status=case when status in ('SUBMITTED','WAITING_PAYMENT') then 'IN_PROGRESS'::submission_status else status end,
    admin_memo=coalesce(p_admin_memo,admin_memo) where id=any(ids);
  update public.submission_orders set status='PAID',paid_at=now(),updated_at=now() where id=p_order_id;
  insert into public.submission_events(submission_id,actor_user_id,event_type,message)
  select x,p_actor_user_id,'PAYMENT_UPDATE','주문 전체의 무통장 입금이 확인되었습니다.' from unnest(ids) x;
  return query select unnest(ids);
end;
$$;

create function public.transfer_returned_submission_order_owner() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if old.user_id is null and new.user_id is not null then
    update public.submission_orders o set user_id=new.user_id,updated_at=now()
    where o.user_id is null and o.returned_at is not null
      and exists(select 1 from public.submission_order_items i where i.order_id=o.id and i.submission_id=new.id)
      and not exists(select 1 from public.submission_order_items i left join public.submissions s on s.id=i.submission_id
        where i.order_id=o.id and (s.id is null or s.user_id is distinct from new.user_id));
  end if;
  return new;
end;
$$;
create trigger transfer_returned_submission_order_owner after update of user_id on public.submissions for each row execute function public.transfer_returned_submission_order_owner();

create function public.protect_ordered_submission_file() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if exists(select 1 from public.submissions s join public.submission_orders o on o.id=s.current_order_id
    where o.status not in ('PAID','REFUNDED')
    and s.id in(case when tg_op<>'INSERT' then old.submission_id end,case when tg_op<>'DELETE' then new.submission_id end)) then
    raise exception 'RETURN_ORDER_TO_CART_BEFORE_EDIT' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger protect_ordered_submission_file before insert or update or delete on public.submission_files for each row execute function public.protect_ordered_submission_file();

alter function public.claim_guest_cart_submissions(uuid,jsonb) rename to claim_guest_cart_submissions_v96;
create function public.claim_guest_cart_submissions(p_user_id uuid,p_entries jsonb)
returns table(submission_id uuid) language plpgsql security invoker set search_path=public as $$
declare ids uuid[];
begin
  if jsonb_typeof(p_entries) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_entries) x
    where x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception 'INVALID_OWNER_PROOF' using errcode='22023'; end if;
  select array_agg(x::uuid order by x::uuid) into ids from jsonb_object_keys(p_entries) x;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  if exists(select 1 from public.submissions s where s.id=any(ids)
    and (s.current_order_id is not null or s.payment_status<>'UNPAID')) then
    raise exception 'RETURN_ORDER_TO_CART_BEFORE_CLAIM' using errcode='55000'; end if;
  return query select * from public.claim_guest_cart_submissions_v96(p_user_id,p_entries);
end;
$$;

-- RPCs and trigger helpers are server-only. Renamed implementations retain
-- service access for the wrappers but are never exposed to member credentials.
do $$
declare signature regprocedure;
begin
  for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'snapshot_submission_order_items','create_submission_checkout_order',
    'begin_submission_payment_order','begin_submission_bank_payment','begin_paypal_submission_payment',
    'begin_submission_payment_order_v96','begin_submission_bank_payment_v96','begin_paypal_submission_payment_v96',
    'reopen_submission_bank_payment','reopen_submission_bank_payment_v96',
    'close_submission_payment_order','close_submission_payment_order_v96',
    'link_submission_payment_order','sync_submission_payment_order','protect_submission_order_state',
    'return_submission_order_to_cart','confirm_submission_order_bank_payment','transfer_returned_submission_order_owner',
    'protect_ordered_submission_file','claim_guest_cart_submissions','claim_guest_cart_submissions_v96'
  ) loop
    execute format('revoke all on function %s from public,anon,authenticated',signature);
    execute format('grant execute on function %s to service_role',signature);
  end loop;
end;
$$;
