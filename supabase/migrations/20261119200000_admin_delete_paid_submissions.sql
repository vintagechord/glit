-- Administrators may delete any application, paid ones included (2026-11-19).
-- Until now a paid or refunded application could not be deleted
-- (PAID_SUBMISSION), so test orders and applications handled outside the site
-- stayed in 접수 관리 for good.
--
-- The money record is never deleted:
--   * the order and its item snapshots stay, with its status (PAID or
--     REFUNDED) unchanged, so 주문내역, refunds and cash receipts keep their
--     reference; other applications in the same order are left as they are;
--   * payment attempts of the deleted application are copied to
--     submission_payment_archive by archive_deleted_submission_payment;
--   * a requested cash receipt for money that was received stays requested.
-- Still refused: an approval the gateway is confirming right now or whose
-- outcome is unknown (settled under 결제 내역 first), since a late approval
-- would then charge for an application that no longer exists.
--
-- Latest definition: 20261119120000_admin_unpaid_card_order_resolution.sql.
create or replace function public.admin_delete_submissions(p_submission_ids uuid[], p_actor_user_id uuid)
returns table(submission_id uuid)
language plpgsql security invoker set search_path=public as $$
declare ids uuid[]; v_order_id uuid; v_order_status text; p public.submission_payments%rowtype;
  pending_orders uuid[] := '{}'::uuid[];
  settled_orders jsonb := '{}'::jsonb;
  paid_notice constant text := '관리자가 신청서를 삭제했습니다. 결제 내역은 그대로 남습니다.';
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

  for v_order_id in select distinct s.current_order_id from public.submissions s
    where s.id=any(ids) and s.current_order_id is not null order by 1 loop
    select o.status into v_order_status from public.submission_orders o where o.id=v_order_id for update;
    if v_order_status='REVIEW_REQUIRED' then
      raise exception 'PAYMENT_APPROVAL_IN_PROGRESS' using errcode='55000'; end if;
    if v_order_status in ('PAID','REFUNDED') then
      -- A settled order keeps its status; its other applications stay as they are.
      settled_orders := settled_orders || jsonb_build_object(v_order_id::text, v_order_status);
    else
      if exists(select 1 from public.submissions s where s.current_order_id=v_order_id and not (s.id=any(ids))) then
        raise exception 'ORDER_HAS_OTHER_SUBMISSIONS' using errcode='55000'; end if;
      -- Closing an attempt below turns its order CANCELED, so remember which
      -- orders were still waiting for payment.
      if v_order_status in ('BANK_PENDING','CARD_PENDING','PAYPAL_PENDING') then
        pending_orders := pending_orders || v_order_id; end if;
    end if;
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
    if settled_orders ? v_order_id::text then
      -- Closing a stale attempt above may have rewritten the order's status
      -- through sync_submission_payment_order; a settled order keeps its own.
      update public.submission_orders o set
        status=settled_orders->>v_order_id::text,
        note=case when position(paid_notice in coalesce(o.note,''))>0 then o.note
          else concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), paid_notice) end,
        updated_at=now()
      where o.id=v_order_id;
    else
      update public.submission_orders o set
        status=case when o.status in ('FAILED','CANCELED','REFUNDED') then o.status else 'CANCELED' end,
        returned_at=case when o.id=any(pending_orders) then coalesce(o.returned_at, now()) else o.returned_at end,
        note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), '관리자가 신청서를 삭제해 주문을 정리했습니다.'),
        updated_at=now()
      where o.id=v_order_id;
      update public.submission_order_cash_receipts r set status='CANCELED', canceled_at=now(),
        cancel_reason='신청서가 삭제되어 발급 신청을 취소했습니다.', issued_by=p_actor_user_id, updated_at=now()
      where r.order_id=v_order_id and r.status in ('REQUESTED','FAILED');
    end if;
  end loop;

  return query delete from public.submissions s where s.id=any(ids) returning s.id;
end;
$$;
revoke all on function public.admin_delete_submissions(uuid[],uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_submissions(uuid[],uuid) to service_role;
