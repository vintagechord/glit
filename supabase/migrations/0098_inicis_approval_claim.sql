-- Serialize external Inicis approval before contacting the gateway. Unknown
-- outcomes retain their request lock; elapsed time is not proof of no charge.
create function public.claim_inicis_submission_approval(p_order_id text,p_callback_state text)
returns table(already_approved boolean,already_processing boolean)
language plpgsql security invoker set search_path=public as $$
declare p public.submission_payments%rowtype;
begin
  select * into p from public.submission_payments where order_id=p_order_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if coalesce(p.provider,'inicis')<>'inicis' or length(coalesce(p_callback_state,''))<32
    or (p.raw_response->>'closeState') is distinct from p_callback_state
  then raise exception 'CALLBACK_STATE_INVALID' using errcode='42501'; end if;
  if p.status='APPROVED' then return query select true,false; return; end if;
  if p.status<>'REQUESTED' then raise exception 'PAYMENT_TERMINAL_STATE' using errcode='55000'; end if;
  if p.result_code in ('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN') then
    return query select false,true; return;
  end if;
  if not exists(select 1 from public.submission_orders o where o.id=p.checkout_order_id
      and o.payment_method='CARD' and o.status='CARD_PENDING' and o.amount_krw=p.amount_krw)
    or not exists(select 1 from public.submission_order_items i where i.order_id=p.checkout_order_id)
    or exists(select 1 from public.submission_order_items i left join public.submissions s on s.id=i.submission_id
      where i.order_id=p.checkout_order_id and (s.id is null or s.current_order_id is distinct from p.checkout_order_id
        or s.payment_status is distinct from 'PAYMENT_PENDING' or s.status not in ('SUBMITTED','WAITING_PAYMENT')
        or s.user_deleted_at is not null or nullif(btrim(s.result_status),'') is not null or s.result_notified_at is not null))
    or exists(select 1 from public.submission_order_items i join public.station_reviews r on r.submission_id=i.submission_id
      where i.order_id=p.checkout_order_id and r.status<>'NOT_SENT')
  then raise exception 'CHECKOUT_ORDER_NOT_ACTIVE' using errcode='55000'; end if;
  update public.submission_payments set result_code='APPROVAL_IN_PROGRESS',
    result_message='Inicis approval is being confirmed.' where id=p.id;
  return query select false,false;
end;
$$;

create function public.settle_inicis_submission_approval(
  p_order_id text,p_callback_state text,p_outcome text,p_result_code text,
  p_result_message text,p_raw_response jsonb
)
returns table(final_status text)
language plpgsql security invoker set search_path=public as $$
declare p public.submission_payments%rowtype;
begin
  if p_outcome not in ('FAILED','UNCERTAIN') then raise exception 'INVALID_APPROVAL_OUTCOME' using errcode='22023'; end if;
  select * into p from public.submission_payments where order_id=p_order_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if coalesce(p.provider,'inicis')<>'inicis' or length(coalesce(p_callback_state,''))<32
    or (p.raw_response->>'closeState') is distinct from p_callback_state
  then raise exception 'CALLBACK_STATE_INVALID' using errcode='42501'; end if;
  if p.status in ('APPROVED','FAILED','CANCELED') then return query select p.status::text; return; end if;
  if p.result_code is distinct from 'APPROVAL_IN_PROGRESS' then
    raise exception 'APPROVAL_CLAIM_NOT_ACTIVE' using errcode='55000';
  end if;
  if p_outcome='UNCERTAIN' then
    update public.submission_payments set result_code='APPROVAL_UNCERTAIN',
      result_message=coalesce(p_result_message,'Gateway outcome requires reconciliation.'),
      raw_response=public.merge_submission_payment_raw_response(p.raw_response,p_raw_response)
    where id=p.id;
    return query select 'REVIEW_REQUIRED'::text;
  else
    -- Only this service-role RPC may finish a claimed approval after a
    -- confirmed gateway rejection or confirmed network cancellation.
    perform * from public.close_submission_payment_order_v96(
      p_order_id,'FAILED',p_result_code,p_result_message,p_raw_response
    );
    return query select 'FAILED'::text;
  end if;
end;
$$;
revoke all on function public.claim_inicis_submission_approval(text,text) from public,anon,authenticated;
grant execute on function public.claim_inicis_submission_approval(text,text) to service_role;
revoke all on function public.settle_inicis_submission_approval(text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.settle_inicis_submission_approval(text,text,text,text,text,jsonb) to service_role;
