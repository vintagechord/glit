-- Administrators delete submissions in one transaction. A submission tied to
-- an unpaid order (bank deposit pending, card window, failed or canceled
-- attempt) is detached first; the order row stays as a canceled record so
-- order history and cash receipts keep their reference. Paid orders and
-- orders whose payment approval is still being confirmed are refused, so no
-- money record disappears.
create or replace function public.admin_delete_submissions(p_submission_ids uuid[], p_actor_user_id uuid)
returns table(submission_id uuid)
language plpgsql security invoker set search_path=public as $$
declare ids uuid[]; v_order_id uuid; v_order_status text;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  select array_agg(distinct x order by x) into ids from unnest(coalesce(p_submission_ids,'{}'::uuid[])) x where x is not null;
  if coalesce(cardinality(ids),0)=0 then return; end if;

  -- Same lock order as the approval callbacks: payment attempts, submissions, then orders.
  perform p.id from public.submission_payments p
  where p.checkout_order_id in (select s.current_order_id from public.submissions s where s.id=any(ids) and s.current_order_id is not null)
  order by p.id for update;
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
    if exists(select 1 from public.submission_payments p where p.checkout_order_id=v_order_id and p.status='REQUESTED'
      and p.result_code in ('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN','CAPTURE_IN_PROGRESS')) then
      raise exception 'PAYMENT_APPROVAL_IN_PROGRESS' using errcode='55000'; end if;
    perform set_config('onside.checkout_order_write', v_order_id::text, true);
    update public.submissions s set current_order_id=null where s.id=any(ids) and s.current_order_id=v_order_id;
    update public.submission_orders o set
      status=case when o.status in ('FAILED','CANCELED','REFUNDED') then o.status else 'CANCELED' end,
      returned_at=case when o.status in ('BANK_PENDING','CARD_PENDING','PAYPAL_PENDING') then coalesce(o.returned_at, now()) else o.returned_at end,
      note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), '관리자가 신청서를 삭제해 주문을 정리했습니다.'),
      updated_at=now()
    where o.id=v_order_id;
  end loop;

  return query delete from public.submissions s where s.id=any(ids) returning s.id;
end;
$$;
revoke all on function public.admin_delete_submissions(uuid[],uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_submissions(uuid[],uuid) to service_role;
