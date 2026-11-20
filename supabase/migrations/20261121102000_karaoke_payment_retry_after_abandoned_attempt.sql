-- A karaoke card payment could never be retried once an attempt was left in
-- REQUESTED: begin_karaoke_payment_order refused every new attempt while any
-- REQUESTED one existed, however old, and nothing ever closed it. The close
-- callback needs the payment window's own closeState, so a window closed
-- with the tab, one that never opened, or a lost close call left the request
-- answering "이미 생성된 결제 요청이 있습니다" to every retry.
--
-- An attempt nobody claimed has not charged anything: the return handler
-- claims it (claim_inicis_karaoke_approval) under the row lock before it
-- calls the gateway, and a closed attempt can no longer be claimed or
-- approved. begin now locks the request's open attempts first, still refuses
-- while one is being approved or its outcome is unknown
-- (APPROVAL_IN_PROGRESS, APPROVAL_UNCERTAIN), and otherwise closes the older
-- attempts as CANCELED / SUPERSEDED before it opens the new one.
--
-- Latest definition: 0082_karaoke_payment_integrity.sql. Only the in-progress
-- check changed.
create or replace function public.begin_karaoke_payment_order(
  p_request_id uuid,
  p_user_id uuid,
  p_order_id text,
  p_amount_krw integer,
  p_raw_response jsonb
)
returns table(request_id uuid, order_id text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request public.karaoke_requests%rowtype;
  v_close_state text;
begin
  if p_user_id is null then
    raise exception 'KARAOKE_PAYMENT_OWNER_REQUIRED'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_order_id, '')), '') is null
    or length(p_order_id) > 200
  then
    raise exception 'KARAOKE_PAYMENT_ORDER_INVALID'
      using errcode = '22023';
  end if;
  if p_amount_krw is null or p_amount_krw <= 0 then
    raise exception 'KARAOKE_PAYMENT_AMOUNT_INVALID'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_raw_response) <> 'object' then
    raise exception 'KARAOKE_PAYMENT_METADATA_INVALID'
      using errcode = '22023';
  end if;

  v_close_state := p_raw_response ->> 'closeState';
  if v_close_state is null
    or length(v_close_state) < 32
    or length(v_close_state) > 200
  then
    raise exception 'KARAOKE_CALLBACK_STATE_INVALID'
      using errcode = '22023';
  end if;

  select request.*
    into v_request
  from public.karaoke_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'KARAOKE_REQUEST_NOT_FOUND'
      using errcode = 'P0002';
  end if;
  if v_request.user_id is distinct from p_user_id then
    raise exception 'KARAOKE_PAYMENT_OWNER_MISMATCH'
      using errcode = '42501';
  end if;
  if v_request.payment_status in ('PAID', 'REFUNDED') then
    raise exception 'KARAOKE_PAYMENT_ALREADY_TERMINAL'
      using errcode = '55000';
  end if;
  if v_request.payment_method = 'BANK' then
    raise exception 'KARAOKE_BANK_PAYMENT_SELECTED'
      using errcode = '55000';
  end if;
  if v_request.amount_krw is distinct from p_amount_krw then
    raise exception 'KARAOKE_PAYMENT_AMOUNT_MISMATCH'
      using errcode = '22000';
  end if;

  -- Lock every open attempt first: an approval claim that holds one is
  -- waited for, and the check below then sees its claim.
  perform payment.id
  from public.karaoke_payments payment
  where payment.request_id = p_request_id
    and payment.status = 'REQUESTED'
  order by payment.id
  for update;

  if exists (
    select 1
    from public.karaoke_payments payment
    where payment.request_id = p_request_id
      and payment.status = 'REQUESTED'
      and payment.result_code in ('APPROVAL_IN_PROGRESS', 'APPROVAL_UNCERTAIN')
  ) then
    raise exception 'KARAOKE_PAYMENT_ALREADY_IN_PROGRESS'
      using errcode = '55000';
  end if;

  update public.karaoke_payments payment
  set status = 'CANCELED',
      result_code = 'SUPERSEDED',
      result_message = '새 결제 요청으로 대체되었습니다.'
  where payment.request_id = p_request_id
    and payment.status = 'REQUESTED'
    and coalesce(payment.result_code, '') not in ('APPROVAL_IN_PROGRESS', 'APPROVAL_UNCERTAIN');

  insert into public.karaoke_payments (
    request_id,
    user_id,
    order_id,
    amount_krw,
    status,
    raw_response
  ) values (
    v_request.id,
    v_request.user_id,
    p_order_id,
    p_amount_krw,
    'REQUESTED',
    p_raw_response
  );

  update public.karaoke_requests request
  set payment_method = 'CARD',
      payment_status = 'PAYMENT_PENDING',
      order_id = p_order_id,
      payment_result_code = null,
      payment_result_message = null,
      payment_raw_response = null
  where request.id = v_request.id;

  if not found then
    raise exception 'KARAOKE_REQUEST_STATE_CHANGED'
      using errcode = '40001';
  end if;

  return query select v_request.id, p_order_id;
end;
$$;

revoke all on function public.begin_karaoke_payment_order(
  uuid, uuid, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.begin_karaoke_payment_order(
  uuid, uuid, text, integer, jsonb
) to service_role;
