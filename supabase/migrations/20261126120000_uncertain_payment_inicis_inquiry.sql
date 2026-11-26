-- Uncertain card approvals: "승인됨" is recorded only with the Inicis
-- transaction inquiry (INIAPI v2 /v2/pg/inquiry) the server ran for the
-- entered TID. Until now a TID typed from the console was recorded as approved
-- with no lookup, so a typo or another order's TID completed an unpaid order.
--
-- The evidence must show the same TID, this attempt's order number and amount,
-- approved and not cancelled. It is kept on the attempt as raw_response
-- `approval` (kind INIAPI_V2_INQUIRY), using only keys the payment audit
-- privacy trigger (scrub_payment_audit_json) keeps. FAILED is unchanged.
--
-- Previous definition: 20261103132000_order_money_integrity.sql. The old
-- five-argument signature is dropped so no caller can skip the evidence.

drop function if exists public.resolve_uncertain_submission_payment(text,uuid,text,text,text);

create function public.resolve_uncertain_submission_payment(
  p_order_id text, p_actor_user_id uuid, p_outcome text,
  p_pg_tid text default null, p_admin_memo text default null,
  p_gateway_evidence jsonb default null
) returns table(submission_id uuid, final_status text)
language plpgsql security invoker set search_path=public as $$
declare p public.submission_payments%rowtype; o public.submission_orders%rowtype; ids uuid[]; memo_text text;
  evidence_price bigint;
  audit jsonb := jsonb_build_object('adminResolution', jsonb_build_object('actor', p_actor_user_id, 'memo', p_admin_memo, 'at', now()));
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_outcome not in ('APPROVED','FAILED') then raise exception 'INVALID_RESOLUTION' using errcode='22023'; end if;
  if p_outcome='APPROVED' and nullif(btrim(coalesce(p_pg_tid,'')),'') is null then
    raise exception 'PG_TID_REQUIRED' using errcode='22023'; end if;
  if p_outcome='APPROVED' and (p_gateway_evidence is null or jsonb_typeof(p_gateway_evidence)<>'object') then
    raise exception 'GATEWAY_EVIDENCE_REQUIRED' using errcode='22023'; end if;
  -- Same lock order as the callback: payment attempt, submissions, then the order projection.
  select * into p from public.submission_payments where order_id=p_order_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if lower(coalesce(p.provider,'inicis'))<>'inicis' then raise exception 'PAYMENT_PROVIDER_MISMATCH' using errcode='22000'; end if;
  if p.status<>'REQUESTED' or p.result_code is distinct from 'APPROVAL_UNCERTAIN' then
    raise exception 'PAYMENT_NOT_UNCERTAIN' using errcode='55000'; end if;
  if p.checkout_order_id is null then raise exception 'CHECKOUT_ORDER_REQUIRED' using errcode='55000'; end if;
  if p_outcome='APPROVED' then
    evidence_price := case when (p_gateway_evidence->>'priceKrw') ~ '^[0-9]{1,12}$'
      then (p_gateway_evidence->>'priceKrw')::bigint end;
    if p_gateway_evidence->>'source' is distinct from 'INIAPI_V2_INQUIRY'
      or p_gateway_evidence->>'tid' is distinct from btrim(p_pg_tid)
      or p_gateway_evidence->>'oid' is distinct from p.order_id
      or p_gateway_evidence->>'status' is distinct from 'APPROVED'
      or evidence_price is distinct from p.amount_krw::bigint
    then raise exception 'GATEWAY_EVIDENCE_MISMATCH' using errcode='22000'; end if;
    audit := audit || jsonb_build_object('approval', jsonb_strip_nulls(jsonb_build_object(
      'kind', 'INIAPI_V2_INQUIRY', 'phase', 'ADMIN_RECONCILIATION',
      'tid', p_gateway_evidence->>'tid', 'moid', p_gateway_evidence->>'oid', 'mid', p_gateway_evidence->>'mid',
      'price', evidence_price, 'status', p_gateway_evidence->>'transactionStatus',
      'paymethod', p_gateway_evidence->>'payMethod', 'applDate', p_gateway_evidence->>'approvedAt',
      'at', p_gateway_evidence->>'checkedAt')));
  end if;
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
      '이니시스 거래조회로 승인을 확인했습니다.', audit, now());
    update public.submission_orders set status='PAID', paid_at=coalesce(paid_at, now()), updated_at=now(),
      note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), '카드 결제 승인이 확인되었습니다.') where id=o.id;
  else
    perform * from public.close_submission_payment_order_v96(p_order_id, 'FAILED', 'ADMIN_CONFIRMED_FAILURE',
      '관리자가 이니시스 거래 내역에서 미승인을 확인했습니다.', audit);
    update public.submission_orders set status='FAILED', updated_at=now(),
      note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), '카드 결제가 승인되지 않은 것으로 확인되었습니다. 다시 결제할 수 있습니다.') where id=o.id;
  end if;
  if memo_text is not null then
    update public.submissions s set admin_memo=concat_ws(E'\n', nullif(btrim(coalesce(s.admin_memo,'')),''),
      format('[카드 %s 확인 %s] %s', case when p_outcome='APPROVED' then '승인' else '미승인' end,
        to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'), memo_text))
    where s.id=any(ids);
  end if;
  insert into public.submission_events(submission_id, actor_user_id, event_type, message)
  select x, p_actor_user_id, 'PAYMENT_UPDATE',
    case when p_outcome='APPROVED' then '관리자가 카드 승인 결과를 확인해 결제 완료로 처리했습니다.'
      else '관리자가 카드 미승인을 확인했습니다. 주문내역에서 다시 결제할 수 있습니다.' end
  from unnest(ids) x;
  return query select x, p_outcome from unnest(ids) x;
end;
$$;
revoke all on function public.resolve_uncertain_submission_payment(text,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.resolve_uncertain_submission_payment(text,uuid,text,text,text,jsonb) to service_role;
