-- An order whose card (or PayPal) window was opened and never finished keeps
-- its attempt in REQUESTED forever. Two triggers
-- (protect_requested_payment_submission_update and
-- prevent_requested_payment_submission_delete) then refuse every change to the
-- application with PAYMENT_IN_PROGRESS, so an administrator could neither
-- delete it nor record a payment received another way: the delete function
-- detached the order while the attempt was still open, and the only
-- "mark paid" path accepted bank orders.
--
-- An attempt without an approval claim cannot charge the customer later: the
-- gateway callback must first claim it (APPROVAL_IN_PROGRESS), and a closed
-- attempt cannot be claimed. Attempts that are being approved right now, or
-- whose outcome is unknown, stay protected here; those are settled under
-- 결제 내역 (resolve_uncertain_submission_payment).

-- 1. Delete: close open attempts first ------------------------------------------
-- Latest definition: 20261103132000_order_money_integrity.sql.
create or replace function public.admin_delete_submissions(p_submission_ids uuid[], p_actor_user_id uuid)
returns table(submission_id uuid)
language plpgsql security invoker set search_path=public as $$
declare ids uuid[]; v_order_id uuid; v_order_status text; p public.submission_payments%rowtype;
  pending_orders uuid[] := '{}'::uuid[];
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  select array_agg(distinct x order by x) into ids from unnest(coalesce(p_submission_ids,'{}'::uuid[])) x where x is not null;
  if coalesce(cardinality(ids),0)=0 then return; end if;

  -- Same lock order as the approval callbacks: payment attempts, submissions, then orders.
  perform pay.id from public.submission_payments pay
  where pay.checkout_order_id in (select s.current_order_id from public.submissions s where s.id=any(ids) and s.current_order_id is not null)
     or pay.submission_id=any(ids)
  order by pay.id for update;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  if exists(select 1 from public.submissions s where s.id=any(ids) and s.payment_status='PAID') then
    raise exception 'PAID_SUBMISSION' using errcode='55000'; end if;

  for v_order_id in select distinct s.current_order_id from public.submissions s
    where s.id=any(ids) and s.current_order_id is not null order by 1 loop
    select o.status into v_order_status from public.submission_orders o where o.id=v_order_id for update;
    if v_order_status in ('PAID','REVIEW_REQUIRED') then
      raise exception 'PAID_SUBMISSION' using errcode='55000'; end if;
    if exists(select 1 from public.submissions s where s.current_order_id=v_order_id and not (s.id=any(ids))) then
      raise exception 'ORDER_HAS_OTHER_SUBMISSIONS' using errcode='55000'; end if;
    -- Closing an attempt below turns its order CANCELED, so remember which
    -- orders were still waiting for payment.
    if v_order_status in ('BANK_PENDING','CARD_PENDING','PAYPAL_PENDING') then
      pending_orders := pending_orders || v_order_id; end if;
  end loop;

  -- Every open attempt that covers a selected application, with or without an
  -- order (attempts from before orders existed have none).
  if exists(select 1 from public.submission_payments pay cross join unnest(ids) x
    where pay.status='REQUESTED' and pay.result_code in ('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN','CAPTURE_IN_PROGRESS')
      and public.submission_payment_includes_submission(pay.submission_id, pay.raw_response, x)) then
    raise exception 'PAYMENT_APPROVAL_IN_PROGRESS' using errcode='55000'; end if;
  for p in select distinct on (pay.id) pay.* from public.submission_payments pay cross join unnest(ids) x
    where pay.status='REQUESTED' and public.submission_payment_includes_submission(pay.submission_id, pay.raw_response, x)
    order by pay.id loop
    perform * from public.close_submission_payment_order(p.order_id, 'CANCELED', 'ADMIN_DELETED',
      '관리자가 신청서를 삭제해 결제 요청을 닫았습니다.', p.raw_response);
  end loop;

  for v_order_id in select distinct s.current_order_id from public.submissions s
    where s.id=any(ids) and s.current_order_id is not null order by 1 loop
    perform set_config('onside.checkout_order_write', v_order_id::text, true);
    update public.submissions s set current_order_id=null where s.id=any(ids) and s.current_order_id=v_order_id;
    update public.submission_orders o set
      status=case when o.status in ('FAILED','CANCELED','REFUNDED') then o.status else 'CANCELED' end,
      returned_at=case when o.id=any(pending_orders) then coalesce(o.returned_at, now()) else o.returned_at end,
      note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), '관리자가 신청서를 삭제해 주문을 정리했습니다.'),
      updated_at=now()
    where o.id=v_order_id;
    update public.submission_order_cash_receipts r set status='CANCELED', canceled_at=now(),
      cancel_reason='신청서가 삭제되어 발급 신청을 취소했습니다.', issued_by=p_actor_user_id, updated_at=now()
    where r.order_id=v_order_id and r.status in ('REQUESTED','FAILED');
  end loop;

  return query delete from public.submissions s where s.id=any(ids) returning s.id;
end;
$$;
revoke all on function public.admin_delete_submissions(uuid[],uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_submissions(uuid[],uuid) to service_role;

-- 2. Mark an unfinished card or PayPal order as paid -------------------------------
-- The administrator decides that the order is paid (the money arrived another
-- way, or the review goes ahead regardless). No gateway request is made. Bank
-- orders keep confirm_submission_order_bank_payment.
create or replace function public.admin_confirm_unpaid_order_payment(
  p_order_id uuid, p_actor_user_id uuid, p_admin_memo text default null
) returns table(submission_id uuid)
language plpgsql security invoker set search_path=public as $$
declare o public.submission_orders%rowtype; ids uuid[]; p public.submission_payments%rowtype;
  memo_text text := nullif(btrim(coalesce(p_admin_memo,'')),'');
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  -- Same lock order as the approval callbacks: payment attempts, submissions, then the order.
  perform pay.id from public.submission_payments pay where pay.checkout_order_id=p_order_id order by pay.id for update;
  select array_agg(i.submission_ref order by i.submission_ref) into ids from public.submission_order_items i where i.order_id=p_order_id;
  if coalesce(cardinality(ids),0)=0 then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  select * into o from public.submission_orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;

  if o.status='PAID' and not exists(select 1 from public.submissions s where s.id=any(ids)
    and (s.current_order_id is distinct from p_order_id or s.payment_status<>'PAID')) then
    return query select unnest(ids); return;
  end if;
  if o.payment_method not in ('CARD','PAYPAL') or o.returned_at is not null
    or o.status not in ('CARD_PENDING','PAYPAL_PENDING','FAILED','CANCELED')
    or (select count(*) from public.submissions where id=any(ids))<>cardinality(ids)
    or exists(select 1 from public.submissions s where s.id=any(ids) and (
      s.current_order_id is distinct from p_order_id or s.user_deleted_at is not null
      or s.payment_status in ('PAID','REFUNDED')))
  then raise exception 'ORDER_NOT_CONFIRMABLE' using errcode='55000'; end if;
  if exists(select 1 from public.submission_payments pay cross join unnest(ids) x
    where pay.status='REQUESTED' and pay.result_code in ('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN','CAPTURE_IN_PROGRESS')
      and public.submission_payment_includes_submission(pay.submission_id, pay.raw_response, x)) then
    raise exception 'PAYMENT_APPROVAL_IN_PROGRESS' using errcode='55000'; end if;
  if exists(select 1 from public.submission_payments pay cross join unnest(ids) x
    where pay.status='APPROVED' and public.submission_payment_includes_submission(pay.submission_id, pay.raw_response, x)) then
    raise exception 'PAYMENT_ALREADY_APPROVED' using errcode='55000'; end if;

  for p in select distinct on (pay.id) pay.* from public.submission_payments pay cross join unnest(ids) x
    where pay.status='REQUESTED' and public.submission_payment_includes_submission(pay.submission_id, pay.raw_response, x)
    order by pay.id loop
    perform * from public.close_submission_payment_order(p.order_id, 'CANCELED', 'ADMIN_MARKED_PAID',
      '관리자가 결제 완료로 처리해 결제 요청을 닫았습니다.', p.raw_response);
  end loop;

  perform set_config('onside.checkout_order_write', p_order_id::text, true);
  update public.submissions set payment_status='PAID',
    status=case when status in ('DRAFT','SUBMITTED','WAITING_PAYMENT') then 'PRE_REVIEW'::submission_status else status end,
    admin_memo=case when memo_text is null or position(memo_text in coalesce(admin_memo,''))>0 then admin_memo
      else concat_ws(E'\n', nullif(btrim(coalesce(admin_memo,'')),''),
        format('[결제 완료 처리 %s] %s', to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'), memo_text)) end
  where id=any(ids);
  update public.submission_orders set status='PAID', paid_at=now(), updated_at=now() where id=p_order_id;
  insert into public.submission_events(submission_id, actor_user_id, event_type, message)
  select x, p_actor_user_id, 'PAYMENT_UPDATE', '결제가 확인되었습니다. 자료 확인 후 방송국·기관 접수를 진행합니다.' from unnest(ids) x;
  return query select unnest(ids);
end;
$$;
revoke all on function public.admin_confirm_unpaid_order_payment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_confirm_unpaid_order_payment(uuid,uuid,text) to service_role;
