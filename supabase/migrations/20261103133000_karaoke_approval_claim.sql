-- Karaoke card approvals get the same claim as submission approvals
-- (0098, 20261031120000). Without it two concurrent deliveries of the same
-- return POST could both call the gateway with the shared authToken: one
-- approves and is recorded, the other gets a non-success reply and its net
-- cancel reverses the recorded charge. The claim is taken under the payment
-- row lock before any gateway request; an unknown outcome keeps the attempt
-- locked (the request stays PAYMENT_PENDING and no new card attempt can start)
-- until an administrator checks the Inicis console.
alter table public.karaoke_payments add column if not exists approval_claimed_at timestamptz;

create or replace function public.claim_inicis_karaoke_approval(p_order_id text, p_callback_state text)
returns table(already_approved boolean, already_processing boolean)
language plpgsql security invoker set search_path=public as $$
declare p public.karaoke_payments%rowtype;
begin
  select * into p from public.karaoke_payments where order_id=p_order_id for update;
  if not found then raise exception 'KARAOKE_PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if length(coalesce(p_callback_state,''))<32 or jsonb_typeof(p.raw_response) is distinct from 'object'
    or (p.raw_response->>'closeState') is distinct from p_callback_state
  then raise exception 'KARAOKE_CALLBACK_STATE_MISMATCH' using errcode='42501'; end if;
  if p.status='APPROVED' then return query select true,false; return; end if;
  if p.status<>'REQUESTED' then raise exception 'KARAOKE_PAYMENT_TERMINAL_STATE' using errcode='55000'; end if;
  if p.result_code in ('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN') then
    return query select false,true; return;
  end if;
  -- approve_karaoke_payment_order rejects a request that no longer matches
  -- the attempt; refuse before the gateway charges instead of after.
  if not exists(select 1 from public.karaoke_requests r where r.id=p.request_id
      and r.order_id is not distinct from p.order_id and r.user_id is not distinct from p.user_id
      and r.amount_krw is not distinct from p.amount_krw and r.payment_status='PAYMENT_PENDING')
  then raise exception 'KARAOKE_PAYMENT_NOT_ACTIVE' using errcode='55000'; end if;
  update public.karaoke_payments set result_code='APPROVAL_IN_PROGRESS',
    result_message='Inicis approval is being confirmed.', approval_claimed_at=now() where id=p.id;
  return query select false,false;
end;
$$;
revoke all on function public.claim_inicis_karaoke_approval(text,text) from public,anon,authenticated;
grant execute on function public.claim_inicis_karaoke_approval(text,text) to service_role;

-- Only the holder of the claim finishes it. FAILED is a confirmed rejection
-- or a confirmed net cancel; UNCERTAIN keeps the lock for reconciliation.
create or replace function public.settle_inicis_karaoke_approval(
  p_order_id text, p_callback_state text, p_outcome text, p_result_code text,
  p_result_message text, p_raw_response jsonb
)
returns table(final_status text)
language plpgsql security invoker set search_path=public as $$
declare p public.karaoke_payments%rowtype; v_message text;
begin
  if p_outcome not in ('FAILED','UNCERTAIN') then raise exception 'INVALID_APPROVAL_OUTCOME' using errcode='22023'; end if;
  select * into p from public.karaoke_payments where order_id=p_order_id for update;
  if not found then raise exception 'KARAOKE_PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if length(coalesce(p_callback_state,''))<32 or jsonb_typeof(p.raw_response) is distinct from 'object'
    or (p.raw_response->>'closeState') is distinct from p_callback_state
  then raise exception 'KARAOKE_CALLBACK_STATE_MISMATCH' using errcode='42501'; end if;
  if p.status in ('APPROVED','FAILED','CANCELED') then return query select p.status::text; return; end if;
  if p.result_code is distinct from 'APPROVAL_IN_PROGRESS' then
    raise exception 'APPROVAL_CLAIM_NOT_ACTIVE' using errcode='55000';
  end if;
  perform r.id from public.karaoke_requests r where r.id=p.request_id for update;
  if p_outcome='UNCERTAIN' then
    v_message := coalesce(nullif(btrim(coalesce(p_result_message,'')),''), 'Gateway outcome requires reconciliation.');
    update public.karaoke_payments set result_code='APPROVAL_UNCERTAIN', result_message=v_message,
      raw_response=public.merge_karaoke_payment_raw_response(p.raw_response,p_raw_response)
    where id=p.id;
    update public.karaoke_requests r set payment_result_code='APPROVAL_UNCERTAIN', payment_result_message=v_message
    where r.id=p.request_id and r.order_id=p.order_id;
    return query select 'REVIEW_REQUIRED'::text;
  else
    update public.karaoke_payments set status='FAILED', result_code=p_result_code, result_message=p_result_message,
      raw_response=public.merge_karaoke_payment_raw_response(p.raw_response,p_raw_response)
    where id=p.id and status='REQUESTED';
    update public.karaoke_requests r set payment_status='UNPAID', payment_result_code=p_result_code,
      payment_result_message=p_result_message,
      payment_raw_response=public.merge_karaoke_payment_raw_response(p.raw_response,p_raw_response)
    where r.id=p.request_id and r.order_id=p.order_id and r.payment_status='PAYMENT_PENDING';
    return query select 'FAILED'::text;
  end if;
end;
$$;
revoke all on function public.settle_inicis_karaoke_approval(text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.settle_inicis_karaoke_approval(text,text,text,text,text,jsonb) to service_role;

-- Latest definition: 0082_karaoke_payment_integrity.sql. A window close or a
-- failure reported outside the claim can no longer close a claimed attempt;
-- the claim holder settles it through settle_inicis_karaoke_approval.
create or replace function public.close_karaoke_payment_order(
  p_order_id text,
  p_status text,
  p_callback_state text,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb
)
returns table(
  request_id uuid,
  final_status text,
  transitioned boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.karaoke_payments%rowtype;
  v_request public.karaoke_requests%rowtype;
  v_stored_state text;
  v_transitioned boolean := false;
begin
  if p_status not in ('FAILED', 'CANCELED') then
    raise exception 'KARAOKE_PAYMENT_STATUS_INVALID'
      using errcode = '22023';
  end if;

  select payment.*
    into v_payment
  from public.karaoke_payments payment
  where payment.order_id = p_order_id
  for update;

  if not found then
    raise exception 'KARAOKE_PAYMENT_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  v_stored_state := case
    when jsonb_typeof(v_payment.raw_response) = 'object'
      then v_payment.raw_response ->> 'closeState'
    else null
  end;
  if v_stored_state is null
    or length(v_stored_state) < 32
    or length(v_stored_state) > 200
    or p_callback_state is distinct from v_stored_state
  then
    raise exception 'KARAOKE_CALLBACK_STATE_MISMATCH'
      using errcode = '42501';
  end if;

  if v_payment.status = 'REQUESTED'
    and v_payment.result_code in ('APPROVAL_IN_PROGRESS', 'APPROVAL_UNCERTAIN')
  then
    raise exception 'KARAOKE_PAYMENT_APPROVAL_IN_PROGRESS'
      using errcode = '55000';
  end if;

  select request.*
    into v_request
  from public.karaoke_requests request
  where request.id = v_payment.request_id
  for update;

  if not found then
    raise exception 'KARAOKE_REQUEST_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_payment.status = 'REQUESTED' then
    update public.karaoke_payments payment
    set status = p_status,
        result_code = p_result_code,
        result_message = p_result_message,
        raw_response = public.merge_karaoke_payment_raw_response(
          v_payment.raw_response,
          p_raw_response
        )
    where payment.id = v_payment.id
      and payment.status = 'REQUESTED';
    v_transitioned := found;

    if not v_transitioned then
      raise exception 'KARAOKE_PAYMENT_STATE_CHANGED'
        using errcode = '40001';
    end if;

    update public.karaoke_requests request
    set payment_status = 'UNPAID',
        payment_result_code = p_result_code,
        payment_result_message = p_result_message,
        payment_raw_response = public.merge_karaoke_payment_raw_response(
          v_payment.raw_response,
          p_raw_response
        )
    where request.id = v_request.id
      and request.order_id = v_payment.order_id
      and request.payment_status = 'PAYMENT_PENDING';

    v_payment.status := p_status;
  end if;

  return query
  select v_request.id, v_payment.status, v_transitioned;
end;
$$;

revoke all on function public.close_karaoke_payment_order(
  text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.close_karaoke_payment_order(
  text, text, text, text, text, jsonb
) to service_role;
