-- Serialize subscription refunds around the external PG call. A claim keeps
-- the charge APPROVED while it is in flight; a failed refund releases the
-- claim so it can be retried, and a successful finalization updates the
-- history, subscription, and reusable billing credential atomically.

alter table public.subscription_history
  add column if not exists refund_claim_token uuid,
  add column if not exists refund_claimed_at timestamptz,
  add column if not exists refund_attempt_count integer not null default 0,
  add column if not exists refund_result_code text,
  add column if not exists refund_result_message text,
  add column if not exists refund_raw_response jsonb,
  add column if not exists refunded_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.subscription_history'::regclass
      and conname = 'subscription_history_refund_attempt_count_nonnegative'
  ) then
    alter table public.subscription_history
      add constraint subscription_history_refund_attempt_count_nonnegative
      check (refund_attempt_count >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.subscription_history'::regclass
      and conname = 'subscription_history_refund_claim_pair'
  ) then
    alter table public.subscription_history
      add constraint subscription_history_refund_claim_pair
      check (
        (refund_claim_token is null and refund_claimed_at is null)
        or
        (refund_claim_token is not null and refund_claimed_at is not null)
      );
  end if;
end $$;

create unique index if not exists subscription_history_refund_claim_token_idx
  on public.subscription_history (refund_claim_token)
  where refund_claim_token is not null;

create or replace function public.claim_subscription_refund(
  p_order_id text,
  p_pg_tid text,
  p_actor_user_id uuid,
  p_allow_admin boolean
)
returns table(
  history_id uuid,
  claimed_order_id text,
  claimed_pg_tid text,
  claimed_subscription_id uuid,
  claimed_billing_id uuid,
  claim_token uuid,
  already_canceled boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id text := nullif(btrim(coalesce(p_order_id, '')), '');
  v_pg_tid text := nullif(btrim(coalesce(p_pg_tid, '')), '');
  v_history public.subscription_history%rowtype;
  v_claim_token uuid;
  v_tid_match_count integer;
begin
  if p_actor_user_id is null then
    raise exception 'SUBSCRIPTION_REFUND_UNAUTHENTICATED'
      using errcode = '42501';
  end if;

  if v_order_id is null and v_pg_tid is null then
    raise exception 'SUBSCRIPTION_REFUND_TARGET_REQUIRED'
      using errcode = '22023';
  end if;

  -- Legacy callers may identify a charge by TID only. Refuse an ambiguous TID
  -- rather than selecting an arbitrary history row.
  if v_order_id is null then
    select count(*)
      into v_tid_match_count
    from public.subscription_history history
    where history.pg_tid = v_pg_tid;

    if v_tid_match_count > 1 then
      raise exception 'SUBSCRIPTION_REFUND_TID_NOT_UNIQUE'
        using errcode = '21000';
    end if;
  end if;

  select history.*
    into v_history
  from public.subscription_history history
  where (v_order_id is null or history.order_id = v_order_id)
    and (v_pg_tid is null or history.pg_tid = v_pg_tid)
  order by history.requested_at desc, history.id desc
  limit 1
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_REFUND_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if not coalesce(p_allow_admin, false)
    and v_history.user_id is distinct from p_actor_user_id
  then
    raise exception 'SUBSCRIPTION_REFUND_FORBIDDEN'
      using errcode = '42501';
  end if;

  if v_history.status = 'CANCELED' then
    return query
    select
      v_history.id,
      v_history.order_id,
      v_history.pg_tid,
      v_history.subscription_id,
      v_history.billing_id,
      null::uuid,
      true;
    return;
  end if;

  if v_history.status <> 'APPROVED' then
    raise exception 'SUBSCRIPTION_REFUND_NOT_ALLOWED'
      using errcode = '55000';
  end if;

  if v_history.pg_tid is null or btrim(v_history.pg_tid) = '' then
    raise exception 'SUBSCRIPTION_REFUND_TID_MISSING'
      using errcode = '22023';
  end if;

  if v_history.refund_claim_token is not null then
    raise exception 'SUBSCRIPTION_REFUND_IN_PROGRESS'
      using errcode = '55000';
  end if;

  v_claim_token := gen_random_uuid();

  update public.subscription_history history
  set refund_claim_token = v_claim_token,
      refund_claimed_at = now(),
      refund_attempt_count = history.refund_attempt_count + 1,
      refund_result_code = null,
      refund_result_message = null,
      refund_raw_response = null
  where history.id = v_history.id
    and history.status = 'APPROVED'
    and history.refund_claim_token is null;

  if not found then
    raise exception 'SUBSCRIPTION_REFUND_IN_PROGRESS'
      using errcode = '55000';
  end if;

  return query
  select
    v_history.id,
    v_history.order_id,
    v_history.pg_tid,
    v_history.subscription_id,
    v_history.billing_id,
    v_claim_token,
    false;
end;
$$;

create or replace function public.fail_subscription_refund(
  p_order_id text,
  p_pg_tid text,
  p_claim_token uuid,
  p_actor_user_id uuid,
  p_allow_admin boolean,
  p_result_code text,
  p_result_message text,
  p_refund_response jsonb
)
returns table(final_status public.subscription_charge_status)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_history public.subscription_history%rowtype;
begin
  select history.*
    into v_history
  from public.subscription_history history
  where history.order_id = nullif(btrim(coalesce(p_order_id, '')), '')
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_REFUND_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if p_actor_user_id is null
    or (
      not coalesce(p_allow_admin, false)
      and v_history.user_id is distinct from p_actor_user_id
    )
  then
    raise exception 'SUBSCRIPTION_REFUND_FORBIDDEN'
      using errcode = '42501';
  end if;

  if v_history.status <> 'APPROVED'
    or v_history.pg_tid is distinct from nullif(btrim(coalesce(p_pg_tid, '')), '')
    or p_claim_token is null
    or v_history.refund_claim_token is distinct from p_claim_token
  then
    raise exception 'SUBSCRIPTION_REFUND_CLAIM_MISMATCH'
      using errcode = '55000';
  end if;

  update public.subscription_history history
  set refund_claim_token = null,
      refund_claimed_at = null,
      refund_result_code = left(nullif(btrim(coalesce(p_result_code, '')), ''), 120),
      refund_result_message = left(nullif(btrim(coalesce(p_result_message, '')), ''), 500),
      refund_raw_response = coalesce(p_refund_response, '{}'::jsonb)
  where history.id = v_history.id;

  return query select 'APPROVED'::public.subscription_charge_status;
end;
$$;

create or replace function public.finalize_subscription_refund(
  p_order_id text,
  p_pg_tid text,
  p_claim_token uuid,
  p_actor_user_id uuid,
  p_allow_admin boolean,
  p_reason text,
  p_result_code text,
  p_result_message text,
  p_refund_response jsonb
)
returns table(
  final_status public.subscription_charge_status,
  finalized_subscription_id uuid,
  finalized_billing_id uuid,
  already_canceled boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_history public.subscription_history%rowtype;
  v_reason text := left(
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'user requested'),
    500
  );
begin
  select history.*
    into v_history
  from public.subscription_history history
  where history.order_id = nullif(btrim(coalesce(p_order_id, '')), '')
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_REFUND_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if p_actor_user_id is null
    or (
      not coalesce(p_allow_admin, false)
      and v_history.user_id is distinct from p_actor_user_id
    )
  then
    raise exception 'SUBSCRIPTION_REFUND_FORBIDDEN'
      using errcode = '42501';
  end if;

  if v_history.status = 'CANCELED' then
    return query
    select
      v_history.status,
      v_history.subscription_id,
      v_history.billing_id,
      true;
    return;
  end if;

  if v_history.status <> 'APPROVED'
    or v_history.pg_tid is distinct from nullif(btrim(coalesce(p_pg_tid, '')), '')
    or p_claim_token is null
    or v_history.refund_claim_token is distinct from p_claim_token
  then
    raise exception 'SUBSCRIPTION_REFUND_CLAIM_MISMATCH'
      using errcode = '55000';
  end if;

  -- Lock related rows before changing any of them. The function transaction
  -- guarantees that partial subscription/billing cancellation cannot commit.
  if v_history.subscription_id is not null then
    perform subscription.id
    from public.subscriptions subscription
    where subscription.id = v_history.subscription_id
      and subscription.user_id = v_history.user_id
    for update;

    if not found then
      raise exception 'SUBSCRIPTION_REFUND_SUBSCRIPTION_MISMATCH'
        using errcode = '55000';
    end if;
  end if;

  if v_history.billing_id is not null then
    perform billing.id
    from public.subscription_billing billing
    where billing.id = v_history.billing_id
      and billing.user_id = v_history.user_id
    for update;

    if not found then
      raise exception 'SUBSCRIPTION_REFUND_BILLING_MISMATCH'
        using errcode = '55000';
    end if;
  end if;

  update public.subscription_history history
  set status = 'CANCELED',
      result_code = left(nullif(btrim(coalesce(p_result_code, '')), ''), 120),
      result_message = left(
        coalesce(
          nullif(btrim(coalesce(p_result_message, '')), ''),
          '정상 취소되었습니다.'
        ),
        500
      ),
      refund_claim_token = null,
      refund_claimed_at = null,
      refund_result_code = left(nullif(btrim(coalesce(p_result_code, '')), ''), 120),
      refund_result_message = left(nullif(btrim(coalesce(p_result_message, '')), ''), 500),
      refund_raw_response = coalesce(p_refund_response, '{}'::jsonb),
      refunded_at = now()
  where history.id = v_history.id;

  if v_history.subscription_id is not null then
    update public.subscriptions subscription
    set status = 'CANCELED',
        cancel_reason = v_reason,
        canceled_at = now(),
        next_billing_at = null
    where subscription.id = v_history.subscription_id
      and subscription.user_id = v_history.user_id;
  end if;

  if v_history.billing_id is not null then
    update public.subscription_billing billing
    set status = 'INACTIVE'
    where billing.id = v_history.billing_id
      and billing.user_id = v_history.user_id;
  end if;

  return query
  select
    'CANCELED'::public.subscription_charge_status,
    v_history.subscription_id,
    v_history.billing_id,
    false;
end;
$$;

revoke all on function public.claim_subscription_refund(text, text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.fail_subscription_refund(
  text, text, uuid, uuid, boolean, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.finalize_subscription_refund(
  text, text, uuid, uuid, boolean, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.claim_subscription_refund(text, text, uuid, boolean)
  to service_role;
grant execute on function public.fail_subscription_refund(
  text, text, uuid, uuid, boolean, text, text, jsonb
) to service_role;
grant execute on function public.finalize_subscription_refund(
  text, text, uuid, uuid, boolean, text, text, text, jsonb
) to service_role;
