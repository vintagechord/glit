-- Operator paths for the two money states that previously required manual SQL:
-- (1) a card approval whose gateway outcome could not be confirmed, and
-- (2) a refund after the gateway/bank transfer was reversed outside the app.
-- Neither function contacts the payment gateway; the operator records what the
-- Inicis console (or the bank statement) already shows.

alter table public.submission_orders add column if not exists refunded_at timestamptz;

create function public.resolve_uncertain_submission_payment(
  p_order_id text, p_actor_user_id uuid, p_outcome text,
  p_pg_tid text default null, p_admin_memo text default null
) returns table(submission_id uuid, final_status text)
language plpgsql security invoker set search_path=public as $$
declare p public.submission_payments%rowtype; o public.submission_orders%rowtype; ids uuid[]; memo_text text;
  audit jsonb := jsonb_build_object('adminResolution', jsonb_build_object('actor', p_actor_user_id, 'memo', p_admin_memo, 'at', now()));
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_outcome not in ('APPROVED','FAILED') then raise exception 'INVALID_RESOLUTION' using errcode='22023'; end if;
  if p_outcome='APPROVED' and nullif(btrim(coalesce(p_pg_tid,'')),'') is null then
    raise exception 'PG_TID_REQUIRED' using errcode='22023'; end if;
  -- Same lock order as the callback: payment attempt, submissions, then the order projection.
  select * into p from public.submission_payments where order_id=p_order_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if lower(coalesce(p.provider,'inicis'))<>'inicis' then raise exception 'PAYMENT_PROVIDER_MISMATCH' using errcode='22000'; end if;
  if p.status<>'REQUESTED' or p.result_code is distinct from 'APPROVAL_UNCERTAIN' then
    raise exception 'PAYMENT_NOT_UNCERTAIN' using errcode='55000'; end if;
  if p.checkout_order_id is null then raise exception 'CHECKOUT_ORDER_REQUIRED' using errcode='55000'; end if;
  ids := public.submission_payment_group_ids(p.submission_id, p.raw_response);
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  select * into o from public.submission_orders where id=p.checkout_order_id for update;
  if o.status<>'REVIEW_REQUIRED' then raise exception 'ORDER_NOT_REVIEW_REQUIRED' using errcode='55000'; end if;
  memo_text := nullif(btrim(coalesce(p_admin_memo,'')),'');
  -- Release the reconciliation hold so the standard settle paths accept the row.
  update public.submission_payments set result_code='ADMIN_RECONCILED',
    result_message='관리자가 이니시스 거래 내역과 대조했습니다.' where id=p.id;
  if p_outcome='APPROVED' then
    perform * from public.approve_submission_payment_order(p_order_id, btrim(p_pg_tid), '0000',
      '관리자가 이니시스 거래 내역에서 승인을 확인했습니다.', audit, now());
    update public.submission_orders set status='PAID', paid_at=coalesce(paid_at, now()), updated_at=now(),
      note=coalesce(memo_text, o.note) where id=o.id;
  else
    perform * from public.close_submission_payment_order_v96(p_order_id, 'FAILED', 'ADMIN_CONFIRMED_FAILURE',
      coalesce(memo_text, '관리자가 이니시스 거래 내역에서 미승인을 확인했습니다.'), audit);
    update public.submission_orders set status='FAILED', updated_at=now(), note=coalesce(memo_text, o.note) where id=o.id;
  end if;
  insert into public.submission_events(submission_id, actor_user_id, event_type, message)
  select x, p_actor_user_id, 'PAYMENT_UPDATE',
    case when p_outcome='APPROVED' then '관리자가 카드 승인 결과를 확인해 결제 완료로 처리했습니다.'
      else '관리자가 카드 미승인을 확인했습니다. 주문내역에서 다시 결제할 수 있습니다.' end
  from unnest(ids) x;
  return query select x, p_outcome from unnest(ids) x;
end;
$$;
revoke all on function public.resolve_uncertain_submission_payment(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_uncertain_submission_payment(text,uuid,text,text,text) to service_role;

create function public.refund_submission_order(p_order_id uuid, p_actor_user_id uuid, p_admin_memo text default null)
returns table(submission_id uuid)
language plpgsql security invoker set search_path=public as $$
declare o public.submission_orders%rowtype; ids uuid[]; memo_text text;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  select array_agg(submission_ref order by submission_ref) into ids from public.submission_order_items where order_id=p_order_id;
  if coalesce(cardinality(ids),0)=0 then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  select * into o from public.submission_orders where id=p_order_id for update;
  if o.status='REFUNDED' then return query select unnest(ids); return; end if;
  if o.status<>'PAID' or o.returned_at is not null
    or (select count(*) from public.submissions where id=any(ids))<>cardinality(ids)
    or exists(select 1 from public.submissions s where s.id=any(ids)
      and (s.current_order_id is distinct from p_order_id or s.payment_status<>'PAID'))
  then raise exception 'ORDER_NOT_REFUNDABLE' using errcode='55000'; end if;
  memo_text := nullif(btrim(coalesce(p_admin_memo,'')),'');
  perform set_config('onside.checkout_order_write', p_order_id::text, true);
  update public.submissions set payment_status='REFUNDED', admin_memo=coalesce(memo_text, admin_memo) where id=any(ids);
  update public.submission_orders set status='REFUNDED', refunded_at=now(), updated_at=now(), note=coalesce(memo_text, o.note) where id=p_order_id;
  insert into public.submission_events(submission_id, actor_user_id, event_type, message)
  select x, p_actor_user_id, 'PAYMENT_UPDATE', '결제가 환불 처리되었습니다. 심의 진행은 중단되며, 문의는 고객센터로 연락해주세요.' from unnest(ids) x;
  return query select unnest(ids);
end;
$$;
revoke all on function public.refund_submission_order(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.refund_submission_order(uuid,uuid,text) to service_role;
