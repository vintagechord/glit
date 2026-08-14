-- Serialize subscription bill-key callbacks and keep the gateway charge,
-- billing credential, subscription, and charge history bound to one order.

alter table public.subscription_history
  add column if not exists callback_state_hash text,
  add column if not exists callback_phase text not null default 'READY',
  add column if not exists callback_claim_token uuid,
  add column if not exists callback_claimed_at timestamptz,
  add column if not exists callback_channel text;

alter table public.subscription_billing
  add column if not exists billkey_issue_tid text;

do $$
begin
  alter table public.subscription_history
    add constraint subscription_history_callback_phase_check
    check (callback_phase in ('READY', 'PROCESSING', 'FINAL'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.subscription_history
    add constraint subscription_history_callback_channel_check
    check (callback_channel is null or callback_channel in ('PC', 'MOBILE'));
exception
  when duplicate_object then null;
end $$;

create index if not exists subscription_history_callback_processing_idx
  on public.subscription_history (user_id, callback_claimed_at)
  where callback_phase = 'PROCESSING';

create or replace function public.sanitize_subscription_payment_json(
  p_value jsonb
)
returns jsonb
language plpgsql
immutable
parallel safe
security invoker
set search_path = public
as $$
declare
  v_type text;
  v_result jsonb;
begin
  if p_value is null then
    return null;
  end if;

  v_type := jsonb_typeof(p_value);
  if v_type = 'object' then
    select coalesce(
      jsonb_object_agg(
        entry.key,
        case
          when regexp_replace(lower(entry.key), '[^a-z0-9]', '', 'g') ~
            '(billkey|authtoken|authurl|netcancelurl|authsignature|signature|hashdata|verification|mkey|cardnum|cardnumber|cardno|cardpw|cardmembernum|regno|buyeremail|buyertel|buyername|^p(uname|mobile|email)$|apikey|apiiv|signkey|data1|merchantreserved|merchantdata|callbackstate)'
            then '"[REDACTED]"'::jsonb
          else public.sanitize_subscription_payment_json(entry.value)
        end
      ),
      '{}'::jsonb
    )
    into v_result
    from jsonb_each(p_value) as entry;
    return v_result;
  end if;

  if v_type = 'array' then
    select coalesce(
      jsonb_agg(public.sanitize_subscription_payment_json(item.value)),
      '[]'::jsonb
    )
    into v_result
    from jsonb_array_elements(p_value) as item(value);
    return v_result;
  end if;

  return p_value;
end;
$$;

revoke all on function public.sanitize_subscription_payment_json(jsonb)
  from public, anon, authenticated;
grant execute on function public.sanitize_subscription_payment_json(jsonb)
  to service_role;

create or replace function public.claim_subscription_billing_callback(
  p_order_id text,
  p_callback_state text,
  p_channel text
)
returns table(
  history_id uuid,
  history_user_id uuid,
  history_amount_krw integer,
  history_product_name text,
  claim_token uuid,
  already_approved boolean,
  already_processing boolean
)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_history public.subscription_history%rowtype;
  v_claim_token uuid;
  v_state_hash text;
  v_channel text := upper(btrim(coalesce(p_channel, '')));
begin
  if p_order_id is null
    or btrim(p_order_id) = ''
    or length(btrim(coalesce(p_callback_state, ''))) < 32
    or length(btrim(coalesce(p_callback_state, ''))) > 200
    or v_channel not in ('PC', 'MOBILE')
  then
    raise exception 'INVALID_SUBSCRIPTION_CALLBACK'
      using errcode = '22023';
  end if;

  v_state_hash := encode(
    extensions.digest(btrim(p_callback_state), 'sha256'),
    'hex'
  );

  select *
    into v_history
  from public.subscription_history history
  where history.order_id = p_order_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_HISTORY_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_history.callback_state_hash is null
    or v_history.callback_state_hash is distinct from v_state_hash
  then
    raise exception 'SUBSCRIPTION_CALLBACK_STATE_MISMATCH'
      using errcode = '42501';
  end if;

  if v_history.status = 'APPROVED' then
    return query select
      v_history.id,
      v_history.user_id,
      v_history.amount_krw,
      v_history.product_name,
      null::uuid,
      true,
      false;
    return;
  end if;

  if v_history.callback_phase = 'PROCESSING'
    or v_history.status = 'BILLKEY_ISSUED'
  then
    return query select
      v_history.id,
      v_history.user_id,
      v_history.amount_krw,
      v_history.product_name,
      null::uuid,
      false,
      true;
    return;
  end if;

  if v_history.status <> 'REQUESTED'
    or v_history.callback_phase <> 'READY'
    or v_history.amount_krw <= 0
  then
    raise exception 'SUBSCRIPTION_CALLBACK_NOT_CLAIMABLE'
      using errcode = '55000';
  end if;

  -- One user cannot race two different checkout orders into two charges.
  perform pg_advisory_xact_lock(
    hashtextextended(v_history.user_id::text, 872341)
  );

  if exists (
    select 1
    from public.subscriptions subscription
    where subscription.user_id = v_history.user_id
      and subscription.status = 'ACTIVE'
  ) then
    raise exception 'SUBSCRIPTION_ALREADY_ACTIVE'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.subscription_history other_history
    where other_history.user_id = v_history.user_id
      and other_history.id <> v_history.id
      and other_history.callback_phase = 'PROCESSING'
  ) then
    raise exception 'SUBSCRIPTION_CALLBACK_ALREADY_PROCESSING'
      using errcode = '55000';
  end if;

  v_claim_token := gen_random_uuid();
  update public.subscription_history history
  set callback_phase = 'PROCESSING',
      callback_claim_token = v_claim_token,
      callback_claimed_at = now(),
      callback_channel = v_channel,
      result_code = 'CALLBACK_CLAIMED',
      result_message = 'Subscription callback is being processed.'
  where history.id = v_history.id
    and history.status = 'REQUESTED'
    and history.callback_phase = 'READY';

  if not found then
    raise exception 'SUBSCRIPTION_CALLBACK_STATE_CHANGED'
      using errcode = '40001';
  end if;

  return query select
    v_history.id,
    v_history.user_id,
    v_history.amount_krw,
    v_history.product_name,
    v_claim_token,
    false,
    false;
end;
$$;

revoke all on function public.claim_subscription_billing_callback(text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_subscription_billing_callback(text, text, text)
  to service_role;

create or replace function public.record_subscription_billkey_for_callback(
  p_order_id text,
  p_claim_token uuid,
  p_bill_key text,
  p_billkey_issue_tid text,
  p_pg_mid text,
  p_card_code text,
  p_card_name text,
  p_card_number text,
  p_card_quota text,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb
)
returns table(billing_id uuid, already_recorded boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_history public.subscription_history%rowtype;
  v_billing public.subscription_billing%rowtype;
begin
  if p_claim_token is null
    or p_bill_key is null or btrim(p_bill_key) = ''
    or p_billkey_issue_tid is null or btrim(p_billkey_issue_tid) = ''
    or p_pg_mid is null or btrim(p_pg_mid) = ''
  then
    raise exception 'INVALID_SUBSCRIPTION_BILLKEY'
      using errcode = '22023';
  end if;

  select *
    into v_history
  from public.subscription_history history
  where history.order_id = p_order_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_HISTORY_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_history.status = 'APPROVED'
    and v_history.callback_claim_token = p_claim_token
    and v_history.billing_id is not null
  then
    return query select v_history.billing_id, true;
    return;
  end if;

  if v_history.callback_phase <> 'PROCESSING'
    or v_history.callback_claim_token is distinct from p_claim_token
    or v_history.status not in ('REQUESTED', 'BILLKEY_ISSUED')
  then
    raise exception 'SUBSCRIPTION_CALLBACK_CLAIM_MISMATCH'
      using errcode = '55000';
  end if;

  if v_history.billing_id is not null then
    select *
      into v_billing
    from public.subscription_billing billing
    where billing.id = v_history.billing_id
    for update;

    if not found
      or v_billing.user_id is distinct from v_history.user_id
      or v_billing.bill_key is distinct from p_bill_key
      or v_billing.billkey_issue_tid is distinct from p_billkey_issue_tid
      or v_billing.pg_mid is distinct from p_pg_mid
    then
      raise exception 'SUBSCRIPTION_BILLKEY_BINDING_MISMATCH'
        using errcode = '22000';
    end if;

    return query select v_billing.id, true;
    return;
  end if;

  insert into public.subscription_billing (
    user_id,
    status,
    bill_key,
    pg_mid,
    pg_tid,
    billkey_issue_tid,
    card_code,
    card_name,
    card_number,
    card_quota,
    last_result_code,
    last_result_message
  ) values (
    v_history.user_id,
    'INACTIVE',
    p_bill_key,
    p_pg_mid,
    null,
    p_billkey_issue_tid,
    nullif(btrim(coalesce(p_card_code, '')), ''),
    nullif(btrim(coalesce(p_card_name, '')), ''),
    nullif(btrim(coalesce(p_card_number, '')), ''),
    nullif(btrim(coalesce(p_card_quota, '')), ''),
    p_result_code,
    p_result_message
  )
  returning * into v_billing;

  update public.subscription_history history
  set status = 'BILLKEY_ISSUED',
      billing_id = v_billing.id,
      result_code = p_result_code,
      result_message = p_result_message,
      raw_response = public.sanitize_subscription_payment_json(p_raw_response)
  where history.id = v_history.id;

  return query select v_billing.id, false;
end;
$$;

revoke all on function public.record_subscription_billkey_for_callback(
  text, uuid, text, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_subscription_billkey_for_callback(
  text, uuid, text, text, text, text, text, text, text, text, text, jsonb
) to service_role;

create or replace function public.fail_subscription_billing_callback(
  p_order_id text,
  p_claim_token uuid,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb
)
returns table(final_status public.subscription_charge_status)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_history public.subscription_history%rowtype;
begin
  select *
    into v_history
  from public.subscription_history history
  where history.order_id = p_order_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_HISTORY_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_history.status = 'FAILED'
    and v_history.callback_claim_token = p_claim_token
  then
    return query select v_history.status;
    return;
  end if;

  if v_history.status = 'APPROVED' then
    raise exception 'SUBSCRIPTION_ALREADY_APPROVED'
      using errcode = '55000';
  end if;

  if v_history.callback_phase <> 'PROCESSING'
    or v_history.callback_claim_token is distinct from p_claim_token
    or v_history.status not in ('REQUESTED', 'BILLKEY_ISSUED')
  then
    raise exception 'SUBSCRIPTION_CALLBACK_CLAIM_MISMATCH'
      using errcode = '55000';
  end if;

  -- A definitive gateway failure does not need the unused reusable payment
  -- credential. Ambiguous/network outcomes deliberately retain it for manual
  -- reconciliation without issuing another charge.
  if v_history.billing_id is not null then
    delete from public.subscription_billing billing
    where billing.id = v_history.billing_id
      and billing.user_id = v_history.user_id
      and billing.status = 'INACTIVE';
  end if;

  update public.subscription_history history
  set status = 'FAILED',
      callback_phase = 'FINAL',
      result_code = p_result_code,
      result_message = p_result_message,
      raw_response = public.sanitize_subscription_payment_json(p_raw_response)
  where history.id = v_history.id;

  return query select 'FAILED'::public.subscription_charge_status;
end;
$$;

revoke all on function public.fail_subscription_billing_callback(
  text, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.fail_subscription_billing_callback(
  text, uuid, text, text, jsonb
) to service_role;

create or replace function public.record_subscription_billing_uncertain(
  p_order_id text,
  p_claim_token uuid,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb
)
returns table(recorded boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_history public.subscription_history%rowtype;
begin
  select *
    into v_history
  from public.subscription_history history
  where history.order_id = p_order_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_HISTORY_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_history.status = 'APPROVED' then
    return query select false;
    return;
  end if;

  if v_history.callback_phase <> 'PROCESSING'
    or v_history.callback_claim_token is distinct from p_claim_token
    or v_history.status not in ('REQUESTED', 'BILLKEY_ISSUED')
  then
    raise exception 'SUBSCRIPTION_CALLBACK_CLAIM_MISMATCH'
      using errcode = '55000';
  end if;

  update public.subscription_history history
  set result_code = p_result_code,
      result_message = p_result_message,
      raw_response = public.sanitize_subscription_payment_json(p_raw_response)
  where history.id = v_history.id;

  return query select true;
end;
$$;

revoke all on function public.record_subscription_billing_uncertain(
  text, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_subscription_billing_uncertain(
  text, uuid, text, text, jsonb
) to service_role;

create or replace function public.finalize_subscription_billing_callback(
  p_order_id text,
  p_claim_token uuid,
  p_billing_tid text,
  p_amount_krw integer,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb,
  p_paid_at timestamptz
)
returns table(
  history_id uuid,
  billing_id uuid,
  subscription_id uuid,
  already_finalized boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_history public.subscription_history%rowtype;
  v_billing public.subscription_billing%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
begin
  if p_claim_token is null
    or p_billing_tid is null or btrim(p_billing_tid) = ''
    or p_amount_krw is null or p_amount_krw <= 0
  then
    raise exception 'INVALID_SUBSCRIPTION_FINALIZATION'
      using errcode = '22023';
  end if;

  select *
    into v_history
  from public.subscription_history history
  where history.order_id = p_order_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_HISTORY_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_history.status = 'APPROVED'
    and v_history.callback_claim_token = p_claim_token
    and v_history.pg_tid is not distinct from p_billing_tid
  then
    return query select
      v_history.id,
      v_history.billing_id,
      v_history.subscription_id,
      true;
    return;
  end if;

  if v_history.callback_phase <> 'PROCESSING'
    or v_history.callback_claim_token is distinct from p_claim_token
    or v_history.status <> 'BILLKEY_ISSUED'
    or v_history.billing_id is null
  then
    raise exception 'SUBSCRIPTION_CALLBACK_CLAIM_MISMATCH'
      using errcode = '55000';
  end if;

  if v_history.amount_krw is distinct from p_amount_krw then
    raise exception 'SUBSCRIPTION_AMOUNT_MISMATCH'
      using errcode = '22000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_history.user_id::text, 872341)
  );

  select *
    into v_billing
  from public.subscription_billing billing
  where billing.id = v_history.billing_id
  for update;

  if not found or v_billing.user_id is distinct from v_history.user_id then
    raise exception 'SUBSCRIPTION_BILLING_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  update public.subscription_billing billing
  set status = 'INACTIVE'
  where billing.user_id = v_history.user_id
    and billing.status = 'ACTIVE'
    and billing.id <> v_billing.id;

  update public.subscription_billing billing
  set status = 'ACTIVE',
      pg_tid = p_billing_tid,
      last_result_code = p_result_code,
      last_result_message = p_result_message,
      last_billed_at = v_paid_at
  where billing.id = v_billing.id;

  select *
    into v_subscription
  from public.subscriptions subscription
  where subscription.user_id = v_history.user_id
  order by
    case when subscription.status = 'ACTIVE' then 0 else 1 end,
    subscription.created_at desc
  limit 1
  for update;

  if found then
    update public.subscriptions subscription
    set status = 'ACTIVE',
        billing_id = v_billing.id,
        amount_krw = v_history.amount_krw,
        interval_months = 1,
        product_name = v_history.product_name,
        started_at = coalesce(subscription.started_at, v_paid_at),
        canceled_at = null,
        cancel_reason = null,
        next_billing_at = v_paid_at + interval '1 month',
        last_billed_at = v_paid_at
    where subscription.id = v_subscription.id
    returning * into v_subscription;
  else
    insert into public.subscriptions (
      user_id,
      billing_id,
      status,
      amount_krw,
      interval_months,
      product_name,
      started_at,
      last_billed_at,
      next_billing_at
    ) values (
      v_history.user_id,
      v_billing.id,
      'ACTIVE',
      v_history.amount_krw,
      1,
      v_history.product_name,
      v_paid_at,
      v_paid_at,
      v_paid_at + interval '1 month'
    )
    returning * into v_subscription;
  end if;

  update public.subscription_history history
  set status = 'APPROVED',
      callback_phase = 'FINAL',
      pg_tid = p_billing_tid,
      billing_id = v_billing.id,
      subscription_id = v_subscription.id,
      result_code = p_result_code,
      result_message = p_result_message,
      raw_response = public.sanitize_subscription_payment_json(p_raw_response),
      paid_at = v_paid_at
  where history.id = v_history.id;

  return query select
    v_history.id,
    v_billing.id,
    v_subscription.id,
    false;
end;
$$;

revoke all on function public.finalize_subscription_billing_callback(
  text, uuid, text, integer, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.finalize_subscription_billing_callback(
  text, uuid, text, integer, text, text, jsonb, timestamptz
) to service_role;
