-- Payment confirmation records paid funds and waits for material review.
-- Existing review/result states, ownership checks, locks and amount checks are preserved.
create or replace function public.confirm_submission_order_bank_payment(p_order_id uuid,p_actor_user_id uuid,p_admin_memo text default null)
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
  update public.submissions set payment_status='PAID',status=case when status in ('DRAFT','SUBMITTED','WAITING_PAYMENT') then 'PRE_REVIEW'::submission_status else status end,
    admin_memo=coalesce(p_admin_memo,admin_memo) where id=any(ids);
  update public.submission_orders set status='PAID',paid_at=now(),updated_at=now() where id=p_order_id;
  insert into public.submission_events(submission_id,actor_user_id,event_type,message)
  select x,p_actor_user_id,'PAYMENT_UPDATE','주문 전체의 무통장 입금이 확인되었습니다. 자료 확인 후 방송국·기관 접수를 진행합니다.' from unnest(ids) x;
  return query select unnest(ids);
end;
$$;

revoke all on function public.confirm_submission_order_bank_payment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_submission_order_bank_payment(uuid,uuid,text) to service_role;

-- Existing gateway approval implementations are preserved below. Only the
-- review-state projection changes; repeat callbacks preserve the current stage.

create or replace function public.approve_paypal_submission_payment(
  p_submission_id uuid,
  p_actor_user_id uuid,
  p_guest_token text,
  p_return_state text,
  p_order_id text,
  p_capture_id text,
  p_amount numeric,
  p_currency text,
  p_result_code text,
  p_raw_response jsonb,
  p_paid_at timestamptz
)
returns table(already_approved boolean, capture_id text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.submission_payments%rowtype;
  v_submission public.submissions%rowtype;
  v_already_approved boolean;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
begin
  if p_capture_id is null or btrim(p_capture_id) = ''
    or p_amount is null or p_amount <= 0
    or v_currency !~ '^[A-Z]{3}$'
  then
    raise exception 'INVALID_PAYPAL_CAPTURE'
      using errcode = '22023';
  end if;

  select *
    into v_payment
  from public.submission_payments payment
  where payment.order_id = p_order_id
  for update;

  if not found or v_payment.submission_id is distinct from p_submission_id then
    raise exception 'PAYPAL_PAYMENT_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  select *
    into v_submission
  from public.submissions submission
  where submission.id = p_submission_id
  for update;

  if not found then
    raise exception 'SUBMISSION_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if (
    v_submission.user_id is not null
    and v_submission.user_id is distinct from p_actor_user_id
  ) or (
    v_submission.user_id is null
    and (
      v_submission.guest_token is null
      or not (
        (
          p_guest_token is not null
          and v_submission.guest_token is not distinct from p_guest_token
        )
        or (
          length(btrim(coalesce(p_return_state, ''))) between 32 and 200
          and v_payment.raw_response ->> 'paypalReturnState'
            is not distinct from btrim(p_return_state)
        )
      )
    )
  ) then
    raise exception 'SUBMISSION_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  if lower(coalesce(v_payment.provider, '')) <> 'paypal'
    or v_submission.paypal_order_id is distinct from p_order_id
    or lower(coalesce(v_submission.payment_provider, '')) <> 'paypal'
    or v_payment.amount is null
    or abs(v_payment.amount - p_amount) > 0.005
    or v_submission.payment_amount is null
    or abs(v_submission.payment_amount - p_amount) > 0.005
    or upper(btrim(coalesce(v_payment.currency, ''))) <> v_currency
    or upper(btrim(coalesce(v_submission.payment_currency, ''))) <> v_currency
  then
    raise exception 'PAYPAL_PAYMENT_BINDING_MISMATCH'
      using errcode = '22000';
  end if;

  if v_payment.status not in ('REQUESTED', 'APPROVED') then
    raise exception 'PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;

  v_already_approved := v_payment.status = 'APPROVED';
  if v_already_approved
    and v_payment.paypal_capture_id is distinct from p_capture_id
  then
    raise exception 'PAYPAL_CAPTURE_ID_MISMATCH'
      using errcode = '22000';
  end if;

  if not v_already_approved then
    if v_payment.result_code is distinct from 'CAPTURE_IN_PROGRESS' then
      raise exception 'PAYPAL_CAPTURE_NOT_CLAIMED'
        using errcode = '55000';
    end if;

    update public.submission_payments payment
    set status = 'APPROVED',
        pg_tid = p_capture_id,
        paypal_capture_id = p_capture_id,
        result_code = coalesce(p_result_code, 'COMPLETED'),
        result_message = 'PayPal payment captured',
        raw_response = public.merge_submission_payment_raw_response(
          v_payment.raw_response,
          p_raw_response
        ),
        paid_at = coalesce(p_paid_at, now())
    where payment.id = v_payment.id
      and payment.status = 'REQUESTED';
  end if;

  update public.submissions submission
  set payment_status = 'PAID',
      payment_method = 'PAYPAL',
      payment_provider = 'paypal',
      paypal_order_id = p_order_id,
      paypal_capture_id = p_capture_id,
      status = case
        when not v_already_approved and submission.status in ('DRAFT', 'SUBMITTED', 'WAITING_PAYMENT')
          then 'PRE_REVIEW'::submission_status
        else submission.status
      end
  where submission.id = p_submission_id;

  insert into public.submission_events (submission_id, event_type, message)
  select
    p_submission_id,
    'PAYMENT',
    'PayPal payment captured for English submission.'
  where not exists (
    select 1
    from public.submission_events event
    where event.submission_id = p_submission_id
      and event.event_type = 'PAYMENT'
      and event.message = 'PayPal payment captured for English submission.'
  );

  return query select v_already_approved, p_capture_id;
end;
$$;

revoke all on function public.approve_paypal_submission_payment(
  uuid, uuid, text, text, text, text, numeric, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.approve_paypal_submission_payment(
  uuid, uuid, text, text, text, text, numeric, text, text, jsonb, timestamptz
) to service_role;

create or replace function public.approve_submission_payment_order(
  p_order_id text,
  p_pg_tid text,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb,
  p_paid_at timestamptz
)
returns table(
  primary_submission_id uuid,
  submission_ids uuid[],
  already_approved boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.submission_payments%rowtype;
  v_submission_ids uuid[];
  v_submission_count integer;
  v_amount_krw bigint;
  v_already_approved boolean;
begin
  select *
    into v_payment
  from public.submission_payments payment
  where payment.order_id = p_order_id
  for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  -- Only Inicis orders may enter the domestic approval path. Legacy card
  -- rows created before provider tagging have NULL here and remain valid.
  if lower(coalesce(v_payment.provider, 'inicis')) <> 'inicis'
  then
    raise exception 'PAYMENT_PROVIDER_MISMATCH'
      using errcode = '22000';
  end if;

  if v_payment.status not in ('REQUESTED', 'APPROVED') then
    raise exception 'PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;

  v_already_approved := v_payment.status = 'APPROVED';
  v_submission_ids := public.submission_payment_group_ids(
    v_payment.submission_id,
    v_payment.raw_response
  );

  perform submission.id
  from public.submissions submission
  where submission.id = any(v_submission_ids)
  order by submission.id
  for update;

  select count(*), coalesce(sum(submission.amount_krw), 0)
    into v_submission_count, v_amount_krw
  from public.submissions submission
  where submission.id = any(v_submission_ids);

  if v_submission_count <> cardinality(v_submission_ids) then
    raise exception 'PAYMENT_SUBMISSION_MISSING'
      using errcode = '55000';
  end if;

  if v_amount_krw <> v_payment.amount_krw then
    raise exception 'PAYMENT_AMOUNT_MISMATCH'
      using errcode = '22000';
  end if;

  if not v_already_approved then
    update public.submission_payments payment
    set status = 'APPROVED',
        pg_tid = p_pg_tid,
        result_code = p_result_code,
        result_message = p_result_message,
        raw_response = public.merge_submission_payment_raw_response(
          v_payment.raw_response,
          p_raw_response
        ),
        paid_at = coalesce(p_paid_at, now())
    where payment.id = v_payment.id
      and payment.status = 'REQUESTED';

    if not found then
      raise exception 'PAYMENT_STATE_CHANGED'
        using errcode = '40001';
    end if;
  end if;

  update public.submissions submission
  set payment_status = 'PAID',
      payment_method = 'CARD',
      status = case
        when not v_already_approved and submission.status in ('DRAFT', 'WAITING_PAYMENT', 'SUBMITTED')
          then 'PRE_REVIEW'::submission_status
        else submission.status
      end
  where submission.id = any(v_submission_ids);

  insert into public.submission_events (submission_id, event_type, message)
  select submission_id, 'PAYMENT', 'KG이니시스 카드 결제 완료'
  from unnest(v_submission_ids) as target(submission_id)
  where not exists (
    select 1
    from public.submission_events event
    where event.submission_id = target.submission_id
      and event.event_type = 'PAYMENT'
      and event.message = 'KG이니시스 카드 결제 완료'
  );

  return query
  select v_payment.submission_id, v_submission_ids, v_already_approved;
end;
$$;

revoke all on function public.approve_submission_payment_order(
  text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.approve_submission_payment_order(
  text, text, text, text, jsonb, timestamptz
) to service_role;
