-- Keep karaoke payment/order state coherent across concurrent payment-window,
-- return, and close callbacks. These functions are called only by the trusted
-- service-role application client.

create or replace function public.merge_karaoke_payment_raw_response(
  p_previous jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_previous jsonb := case
    when jsonb_typeof(p_previous) = 'object' then p_previous
    else '{}'::jsonb
  end;
  v_incoming jsonb := case
    when jsonb_typeof(p_incoming) = 'object' then p_incoming
    else '{}'::jsonb
  end;
  v_close_state jsonb;
begin
  v_close_state := v_previous -> 'closeState';
  -- Legacy in-flight orders created before callback-state rollout did not
  -- store closeState. They may still complete through a gateway-authenticated
  -- approval, but can never use the failure/close mutation path below.
  if jsonb_typeof(v_close_state) <> 'string' then
    return v_previous || v_incoming;
  end if;

  return (v_previous || v_incoming)
    || jsonb_build_object('closeState', v_close_state);
end;
$$;

revoke all on function public.merge_karaoke_payment_raw_response(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_karaoke_payment_raw_response(jsonb, jsonb)
  to service_role;

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

  perform payment.id
  from public.karaoke_payments payment
  where payment.request_id = p_request_id
    and payment.status = 'REQUESTED'
  order by payment.created_at desc, payment.id
  limit 1
  for update;

  if found then
    raise exception 'KARAOKE_PAYMENT_ALREADY_IN_PROGRESS'
      using errcode = '55000';
  end if;

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

create or replace function public.approve_karaoke_payment_order(
  p_order_id text,
  p_amount_krw integer,
  p_pg_tid text,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb,
  p_paid_at timestamptz
)
returns table(
  request_id uuid,
  final_status text,
  already_approved boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.karaoke_payments%rowtype;
  v_request public.karaoke_requests%rowtype;
  v_tid text := nullif(btrim(coalesce(p_pg_tid, '')), '');
  v_already_approved boolean;
begin
  if v_tid is null then
    raise exception 'KARAOKE_PAYMENT_TID_REQUIRED'
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
  if v_payment.status not in ('REQUESTED', 'APPROVED') then
    raise exception 'KARAOKE_PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;
  if v_payment.amount_krw is distinct from p_amount_krw then
    raise exception 'KARAOKE_PAYMENT_AMOUNT_MISMATCH'
      using errcode = '22000';
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
  if v_request.user_id is distinct from v_payment.user_id
    or v_request.amount_krw is distinct from v_payment.amount_krw
    or v_request.order_id is distinct from v_payment.order_id
  then
    raise exception 'KARAOKE_PAYMENT_BINDING_MISMATCH'
      using errcode = '22000';
  end if;

  v_already_approved := v_payment.status = 'APPROVED';
  if v_already_approved then
    if v_payment.pg_tid is distinct from v_tid then
      raise exception 'KARAOKE_PAYMENT_TID_MISMATCH'
        using errcode = '22000';
    end if;
  else
    update public.karaoke_payments payment
    set status = 'APPROVED',
        pg_tid = v_tid,
        result_code = p_result_code,
        result_message = p_result_message,
        raw_response = public.merge_karaoke_payment_raw_response(
          v_payment.raw_response,
          p_raw_response
        ),
        paid_at = coalesce(p_paid_at, now())
    where payment.id = v_payment.id
      and payment.status = 'REQUESTED';

    if not found then
      raise exception 'KARAOKE_PAYMENT_STATE_CHANGED'
        using errcode = '40001';
    end if;

    update public.karaoke_requests request
    set payment_status = 'PAID',
        payment_method = 'CARD',
        paid_at = coalesce(p_paid_at, now()),
        pg_tid = v_tid,
        payment_result_code = p_result_code,
        payment_result_message = p_result_message,
        payment_raw_response = public.merge_karaoke_payment_raw_response(
          v_payment.raw_response,
          p_raw_response
        )
    where request.id = v_request.id
      and request.order_id = v_payment.order_id;

    if not found then
      raise exception 'KARAOKE_REQUEST_STATE_CHANGED'
        using errcode = '40001';
    end if;
  end if;

  return query
  select v_request.id, 'APPROVED'::text, v_already_approved;
end;
$$;

revoke all on function public.approve_karaoke_payment_order(
  text, integer, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.approve_karaoke_payment_order(
  text, integer, text, text, text, jsonb, timestamptz
) to service_role;

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

-- Protect mixed-version deploys and any accidental future direct writes from
-- reviving a terminal payment or downgrading a paid karaoke request.
create or replace function public.protect_karaoke_payment_terminal_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status in ('APPROVED', 'FAILED', 'CANCELED')
    and new.status is distinct from old.status
  then
    raise exception 'KARAOKE_PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;
  if new.status not in ('REQUESTED', 'APPROVED', 'FAILED', 'CANCELED') then
    raise exception 'KARAOKE_PAYMENT_STATUS_INVALID'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_karaoke_payment_terminal_state
  on public.karaoke_payments;
create trigger protect_karaoke_payment_terminal_state
before update on public.karaoke_payments
for each row execute function public.protect_karaoke_payment_terminal_state();

revoke all on function public.protect_karaoke_payment_terminal_state()
  from public, anon, authenticated;

create or replace function public.protect_karaoke_request_paid_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.payment_status = 'PAID'
    and new.payment_status not in ('PAID', 'REFUNDED')
  then
    raise exception 'KARAOKE_REQUEST_PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;
  if old.payment_status = 'REFUNDED'
    and new.payment_status <> 'REFUNDED'
  then
    raise exception 'KARAOKE_REQUEST_PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_karaoke_request_paid_state
  on public.karaoke_requests;
create trigger protect_karaoke_request_paid_state
before update of payment_status on public.karaoke_requests
for each row execute function public.protect_karaoke_request_paid_state();

revoke all on function public.protect_karaoke_request_paid_state()
  from public, anon, authenticated;
