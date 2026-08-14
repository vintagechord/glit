-- Keep multi-submission card payments and their submissions in one coherent
-- state.  The server uses these RPCs with the service-role client so order
-- creation/finalisation is transactional, and the delete trigger closes the
-- race between a cart deletion and a payment window opening.

-- Remote migration sessions do not carry an application JWT. The privileged
-- field trigger installed in 0074 therefore fails closed unless this
-- transaction explicitly assumes the trusted migration role for the legacy
-- price snapshot backfill below.
select set_config('request.jwt.claim.role', 'service_role', true);

create index if not exists submission_payments_requested_created_idx
  on public.submission_payments (created_at)
  where status = 'REQUESTED';

-- Snapshot the server-calculated album price at submission time. Payment
-- authorization must not infer whether a row is a 50% additional-album item
-- from a caller-provided amount or from mutable package/settings data.
alter table public.submissions
  add column if not exists album_base_price_krw integer,
  add column if not exists album_price_tier text,
  add column if not exists album_discount_base_submission_id uuid;

alter table public.submissions
  drop constraint if exists submissions_album_base_price_nonnegative;
alter table public.submissions
  add constraint submissions_album_base_price_nonnegative
  check (album_base_price_krw is null or album_base_price_krw > 0);

alter table public.submissions
  drop constraint if exists submissions_album_price_tier_valid;
alter table public.submissions
  add constraint submissions_album_price_tier_valid
  check (album_price_tier is null or album_price_tier in ('FULL', 'ADDITIONAL'));

alter table public.submissions
  drop constraint if exists submissions_album_discount_base_submission_fkey;
alter table public.submissions
  add constraint submissions_album_discount_base_submission_fkey
  foreign key (album_discount_base_submission_id)
  references public.submissions(id)
  on delete set null;

create index if not exists submissions_album_discount_base_idx
  on public.submissions (album_discount_base_submission_id)
  where album_discount_base_submission_id is not null;

-- Backfill only legacy prices that can be derived exactly from trusted package
-- configuration. Before 0074, owners could write amount_krw, so arbitrary
-- legacy amounts must remain without a snapshot and fail closed at payment.
-- Recognized bases are: canonical original price, the discount configured at
-- migration time, and the known historical 50% campaign price. Exact base
-- matches are conservatively classified as FULL before half-price matches.
with discount_setting as (
  select least(
    100,
    greatest(
      0,
      round(
        coalesce(
          max(
            case
              when case
                when jsonb_typeof(setting.value) = 'object'
                  then setting.value ->> 'discountPercent'
                when jsonb_typeof(setting.value) = 'number'
                  then setting.value #>> '{}'
                else null
              end ~ '^-?[0-9]+(?:\.[0-9]+)?$'
              then case
                when jsonb_typeof(setting.value) = 'object'
                  then (setting.value ->> 'discountPercent')::numeric
                else (setting.value #>> '{}')::numeric
              end
              else 0
            end
          ),
          0
        )
      )
    )
  )::integer as discount_percent
  from public.site_settings setting
  where setting.key = 'album_review_discount_percent'
), legacy_album as (
  select
    submission.id,
    submission.amount_krw,
    case
      when submission.is_oneclick then case package.station_count
        when 7 then 100000
        when 10 then 130000
        when 13 then 150000
        when 15 then 170000
        else package.price_krw
      end
      else package.price_krw
    end::integer as original_base_price_krw,
    discount_setting.discount_percent
  from public.submissions submission
  join public.packages package
    on package.id = submission.package_id
   and package.is_active = true
  cross join discount_setting
  where submission.type = 'ALBUM'
    and submission.amount_krw > 0
    and (
      submission.album_base_price_krw is null
      or submission.album_price_tier is null
    )
), legacy_candidates as (
  select
    legacy.id,
    legacy.amount_krw,
    array[
      legacy.original_base_price_krw,
      round(
        legacy.original_base_price_krw
          * ((100 - legacy.discount_percent)::numeric / 100)
      )::integer,
      round(legacy.original_base_price_krw * 0.5)::integer
    ] as candidate_base_prices
  from legacy_album legacy
  where legacy.original_base_price_krw > 0
), legacy_match as (
  select
    candidate.id,
    coalesce(
      (
        select base_price
        from unnest(candidate.candidate_base_prices)
          with ordinality as full_candidate(base_price, priority)
        where base_price > 0
          and candidate.amount_krw = base_price
        order by priority
        limit 1
      ),
      (
        select base_price
        from unnest(candidate.candidate_base_prices)
          with ordinality as additional_candidate(base_price, priority)
        where base_price > 0
          and candidate.amount_krw::bigint * 2 = base_price::bigint
        order by priority
        limit 1
      )
    ) as base_price_krw,
    case
      when exists (
        select 1
        from unnest(candidate.candidate_base_prices) as full_candidate(base_price)
        where base_price > 0
          and candidate.amount_krw = base_price
      ) then 'FULL'
      when exists (
        select 1
        from unnest(candidate.candidate_base_prices)
          as additional_candidate(base_price)
        where base_price > 0
          and candidate.amount_krw::bigint * 2 = base_price::bigint
      ) then 'ADDITIONAL'
      else null
    end as price_tier
  from legacy_candidates candidate
)
update public.submissions submission
set album_base_price_krw = legacy_match.base_price_krw,
    album_price_tier = legacy_match.price_tier
from legacy_match
where submission.id = legacy_match.id
  and legacy_match.base_price_krw is not null
  and legacy_match.price_tier is not null;

create or replace function public.assert_album_price_snapshots(
  p_submission_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invalid_submission_id uuid;
begin
  -- All album amounts are checked against a server-written pricing snapshot.
  -- Legacy/null snapshots fail closed and can be refreshed by editing/saving
  -- the cart application before payment.
  select submission.id
    into v_invalid_submission_id
  from public.submissions submission
  where submission.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
    and submission.type = 'ALBUM'
    and (
      submission.package_id is null
      or submission.album_base_price_krw is null
      or submission.album_base_price_krw <= 0
      or submission.album_price_tier not in ('FULL', 'ADDITIONAL')
      or submission.amount_krw <> case submission.album_price_tier
        when 'FULL' then submission.album_base_price_krw
        when 'ADDITIONAL' then round(submission.album_base_price_krw * 0.5)::integer
        else -1
      end
    )
  limit 1;

  if v_invalid_submission_id is not null then
    raise exception 'ALBUM_PRICE_SNAPSHOT_INVALID:%', v_invalid_submission_id
      using errcode = '22000';
  end if;
end;
$$;

revoke all on function public.assert_album_price_snapshots(uuid[])
  from public, anon, authenticated;
grant execute on function public.assert_album_price_snapshots(uuid[])
  to service_role;

create or replace function public.bind_album_payment_discount_eligibility(
  p_submission_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_discounted public.submissions%rowtype;
  v_base_submission_id uuid;
begin
  perform public.assert_album_price_snapshots(p_submission_ids);

  -- A discounted item is payable only with an exact-owner, same-package full
  -- price companion in this atomic payment group, or after such a base album
  -- has already reached PAID. For guests, NULL user_id alone is never treated
  -- as shared historical ownership; the long random guest token must match.
  -- Inside this service-verified atomic group, guest submissions intentionally
  -- have distinct per-submission tokens, so both-null user IDs are sufficient.
  for v_discounted in
  select discounted.*
  from public.submissions discounted
  where discounted.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
    and discounted.type = 'ALBUM'
    and discounted.album_price_tier = 'ADDITIONAL'
  order by discounted.id
  loop
    v_base_submission_id := null;

    select base.id
      into v_base_submission_id
    from public.submissions base
    where base.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
      and base.id <> v_discounted.id
      and base.type = 'ALBUM'
      and base.package_id is not distinct from v_discounted.package_id
      and base.is_oneclick is not distinct from v_discounted.is_oneclick
      and base.album_price_tier = 'FULL'
      and base.album_base_price_krw = v_discounted.album_base_price_krw
      and base.amount_krw = v_discounted.album_base_price_krw
      and (
        (
          v_discounted.user_id is not null
          and base.user_id = v_discounted.user_id
        )
        or (
          v_discounted.user_id is null
          and base.user_id is null
        )
      )
    order by base.id
    limit 1;

    if v_base_submission_id is null then
      select paid_base.id
        into v_base_submission_id
      from public.submissions paid_base
      where paid_base.id <> v_discounted.id
        and paid_base.type = 'ALBUM'
        and paid_base.payment_status = 'PAID'
        and paid_base.package_id is not distinct from v_discounted.package_id
        and paid_base.is_oneclick is not distinct from v_discounted.is_oneclick
        and paid_base.album_price_tier = 'FULL'
        and paid_base.album_base_price_krw = v_discounted.album_base_price_krw
        and paid_base.amount_krw = v_discounted.album_base_price_krw
        and (
          (
            v_discounted.user_id is not null
            and paid_base.user_id = v_discounted.user_id
          )
          or (
            v_discounted.user_id is null
            and paid_base.user_id is null
            and v_discounted.guest_token is not null
            and paid_base.guest_token = v_discounted.guest_token
          )
        )
      order by paid_base.created_at desc, paid_base.id
      limit 1;
    end if;

    if v_base_submission_id is null then
      raise exception 'ALBUM_DISCOUNT_NOT_ELIGIBLE:%', v_discounted.id
        using errcode = '55000';
    end if;

    update public.submissions submission
    set album_discount_base_submission_id = v_base_submission_id
    where submission.id = v_discounted.id
      and submission.album_discount_base_submission_id
        is distinct from v_base_submission_id;
  end loop;

  update public.submissions submission
  set album_discount_base_submission_id = null
  where submission.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
    and submission.type = 'ALBUM'
    and submission.album_price_tier = 'FULL'
    and submission.album_discount_base_submission_id is not null;
end;
$$;

revoke all on function public.bind_album_payment_discount_eligibility(uuid[])
  from public, anon, authenticated;
grant execute on function public.bind_album_payment_discount_eligibility(uuid[])
  to service_role;

create or replace function public.submission_payment_group_ids(
  p_primary_submission_id uuid,
  p_raw_response jsonb
)
returns uuid[]
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(array_agg(distinct candidate.id order by candidate.id), '{}'::uuid[])
  from (
    select p_primary_submission_id as id
    union all
    select value::uuid
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_raw_response #> '{paymentGroup,submissionIds}') = 'array'
          then p_raw_response #> '{paymentGroup,submissionIds}'
        else '[]'::jsonb
      end
    ) as item(value)
    where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    union all
    select value::uuid
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_raw_response #> '{paymentGroup,relatedSubmissionIds}') = 'array'
          then p_raw_response #> '{paymentGroup,relatedSubmissionIds}'
        else '[]'::jsonb
      end
    ) as item(value)
    where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) as candidate
  where candidate.id is not null;
$$;

create or replace function public.submission_payment_includes_submission(
  p_primary_submission_id uuid,
  p_raw_response jsonb,
  p_submission_id uuid
)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select p_submission_id = any(
    public.submission_payment_group_ids(
      p_primary_submission_id,
      p_raw_response
    )
  );
$$;

revoke all on function public.submission_payment_group_ids(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.submission_payment_includes_submission(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.submission_payment_group_ids(uuid, jsonb)
  to service_role;
grant execute on function public.submission_payment_includes_submission(uuid, jsonb, uuid)
  to service_role;

create or replace function public.merge_submission_payment_raw_response(
  p_existing_raw_response jsonb,
  p_next_raw_response jsonb
)
returns jsonb
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when p_existing_raw_response is null
      then p_next_raw_response
    else
      coalesce(p_next_raw_response, '{}'::jsonb)
        || case
          when p_existing_raw_response ? 'paymentGroup'
            then jsonb_build_object(
              'paymentGroup',
              p_existing_raw_response -> 'paymentGroup'
            )
          else '{}'::jsonb
        end
        || case
          when p_existing_raw_response ? 'closeState'
            then jsonb_build_object(
              'closeState',
              p_existing_raw_response -> 'closeState'
            )
          else '{}'::jsonb
        end
        || case
          when p_existing_raw_response ? 'paypalReturnState'
            then jsonb_build_object(
              'paypalReturnState',
              p_existing_raw_response -> 'paypalReturnState'
            )
          else '{}'::jsonb
        end
  end;
$$;

revoke all on function public.merge_submission_payment_raw_response(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_submission_payment_raw_response(jsonb, jsonb)
  to service_role;

create or replace function public.has_requested_submission_payments(
  p_submission_ids uuid[]
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.submission_payments payment
    cross join unnest(coalesce(p_submission_ids, '{}'::uuid[])) as target(id)
    where payment.status = 'REQUESTED'
      and public.submission_payment_includes_submission(
        payment.submission_id,
        payment.raw_response,
        target.id
      )
  );
$$;

revoke all on function public.has_requested_submission_payments(uuid[])
  from public, anon, authenticated;
grant execute on function public.has_requested_submission_payments(uuid[])
  to service_role;

create or replace function public.begin_submission_payment_order(
  p_primary_submission_id uuid,
  p_submission_ids uuid[],
  p_order_id text,
  p_amount_krw integer,
  p_user_id uuid,
  p_raw_response jsonb
)
returns table(submission_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_submission_ids uuid[];
  v_submission_count integer;
  v_amount_krw bigint;
begin
  select array_agg(distinct requested.id order by requested.id)
    into v_submission_ids
  from unnest(coalesce(p_submission_ids, '{}'::uuid[])) as requested(id)
  where requested.id is not null;

  if p_primary_submission_id is null
    or p_order_id is null
    or btrim(p_order_id) = ''
    or coalesce(cardinality(v_submission_ids), 0) = 0
    or not (p_primary_submission_id = any(v_submission_ids))
  then
    raise exception 'INVALID_PAYMENT_GROUP'
      using errcode = '22023';
  end if;

  -- Row locks serialize order creation with submission edits/deletions.  The
  -- deterministic order avoids deadlocks for overlapping multi-item carts.
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
    raise exception 'SUBMISSION_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.submissions submission
    where submission.id = any(v_submission_ids)
      and (
        submission.user_id is distinct from p_user_id
        or submission.status not in ('SUBMITTED', 'WAITING_PAYMENT')
        or not (
          submission.payment_status = 'UNPAID'
          or (
            submission.payment_status = 'PAYMENT_PENDING'
            and submission.payment_method = 'CARD'
          )
        )
        or submission.amount_krw <= 0
      )
  ) then
    raise exception 'SUBMISSION_NOT_PAYABLE'
      using errcode = '55000';
  end if;

  perform public.bind_album_payment_discount_eligibility(v_submission_ids);

  if p_amount_krw <= 0 or v_amount_krw <> p_amount_krw then
    raise exception 'PAYMENT_AMOUNT_MISMATCH'
      using errcode = '22000';
  end if;

  if public.has_requested_submission_payments(v_submission_ids) then
    raise exception 'PAYMENT_ALREADY_IN_PROGRESS'
      using errcode = '55000';
  end if;

  insert into public.submission_payments (
    submission_id,
    user_id,
    order_id,
    amount_krw,
    provider,
    status,
    raw_response
  ) values (
    p_primary_submission_id,
    p_user_id,
    p_order_id,
    p_amount_krw,
    'inicis',
    'REQUESTED',
    p_raw_response
  );

  update public.submissions submission
  set payment_method = 'CARD',
      payment_status = 'PAYMENT_PENDING',
      status = 'WAITING_PAYMENT'
  where submission.id = any(v_submission_ids);

  return query select unnest(v_submission_ids);
end;
$$;

revoke all on function public.begin_submission_payment_order(
  uuid, uuid[], text, integer, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.begin_submission_payment_order(
  uuid, uuid[], text, integer, uuid, jsonb
) to service_role;

create or replace function public.begin_submission_bank_payment(
  p_submission_ids uuid[],
  p_user_id uuid
)
returns table(submission_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_submission_ids uuid[];
  v_submission_count integer;
begin
  select array_agg(distinct requested.id order by requested.id)
    into v_submission_ids
  from unnest(coalesce(p_submission_ids, '{}'::uuid[])) as requested(id)
  where requested.id is not null;

  if coalesce(cardinality(v_submission_ids), 0) = 0 then
    raise exception 'INVALID_PAYMENT_GROUP'
      using errcode = '22023';
  end if;

  perform submission.id
  from public.submissions submission
  where submission.id = any(v_submission_ids)
  order by submission.id
  for update;

  select count(*)
    into v_submission_count
  from public.submissions submission
  where submission.id = any(v_submission_ids);

  if v_submission_count <> cardinality(v_submission_ids) then
    raise exception 'SUBMISSION_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.submissions submission
    where submission.id = any(v_submission_ids)
      and (
        submission.user_id is distinct from p_user_id
        or submission.status not in ('SUBMITTED', 'WAITING_PAYMENT')
        or submission.payment_status <> 'UNPAID'
        or submission.amount_krw <= 0
      )
  ) then
    raise exception 'SUBMISSION_NOT_PAYABLE'
      using errcode = '55000';
  end if;

  perform public.bind_album_payment_discount_eligibility(v_submission_ids);

  if public.has_requested_submission_payments(v_submission_ids) then
    raise exception 'PAYMENT_ALREADY_IN_PROGRESS'
      using errcode = '55000';
  end if;

  update public.submissions submission
  set payment_method = 'BANK',
      payment_status = 'PAYMENT_PENDING',
      status = 'WAITING_PAYMENT'
  where submission.id = any(v_submission_ids);

  insert into public.submission_events (
    submission_id,
    actor_user_id,
    event_type,
    message
  )
  select
    target.submission_id,
    p_user_id,
    'PAYMENT_UPDATE',
    '장바구니에서 무통장 입금 대기 상태로 변경되었습니다.'
  from unnest(v_submission_ids) as target(submission_id);

  return query select unnest(v_submission_ids);
end;
$$;

revoke all on function public.begin_submission_bank_payment(uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.begin_submission_bank_payment(uuid[], uuid)
  to service_role;

create or replace function public.begin_paypal_submission_payment(
  p_submission_id uuid,
  p_actor_user_id uuid,
  p_guest_token text,
  p_order_id text,
  p_amount numeric,
  p_currency text,
  p_raw_response jsonb
)
returns table(payment_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_submission public.submissions%rowtype;
  v_payment_id uuid;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_return_state text := btrim(coalesce(p_raw_response ->> 'paypalReturnState', ''));
begin
  if p_submission_id is null
    or p_order_id is null
    or btrim(p_order_id) = ''
    or p_amount is null
    or p_amount <= 0
    or v_currency !~ '^[A-Z]{3}$'
    or length(v_return_state) < 32
    or length(v_return_state) > 200
  then
    raise exception 'INVALID_PAYPAL_ORDER'
      using errcode = '22023';
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
      or p_guest_token is null
      or v_submission.guest_token is distinct from p_guest_token
    )
  ) then
    raise exception 'SUBMISSION_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  if v_submission.status not in ('SUBMITTED', 'WAITING_PAYMENT')
    or not (
      v_submission.payment_status = 'UNPAID'
      or (
        v_submission.payment_status = 'PAYMENT_PENDING'
        and v_submission.payment_method = 'PAYPAL'
      )
    )
    or coalesce(lower(v_submission.payment_provider), 'paypal') <> 'paypal'
    or v_submission.payment_amount is null
    or abs(v_submission.payment_amount - p_amount) > 0.005
    or upper(btrim(coalesce(v_submission.payment_currency, ''))) <> v_currency
  then
    raise exception 'PAYPAL_SUBMISSION_NOT_PAYABLE'
      using errcode = '55000';
  end if;

  if public.has_requested_submission_payments(array[p_submission_id]) then
    raise exception 'PAYMENT_ALREADY_IN_PROGRESS'
      using errcode = '55000';
  end if;

  insert into public.submission_payments (
    submission_id,
    user_id,
    order_id,
    amount_krw,
    amount,
    currency,
    provider,
    status,
    raw_response
  ) values (
    p_submission_id,
    v_submission.user_id,
    p_order_id,
    0,
    p_amount,
    v_currency,
    'paypal',
    'REQUESTED',
    p_raw_response
  )
  returning id into v_payment_id;

  update public.submissions submission
  set paypal_order_id = p_order_id,
      paypal_capture_id = null,
      payment_provider = 'paypal',
      payment_status = 'PAYMENT_PENDING',
      payment_method = 'PAYPAL',
      status = 'WAITING_PAYMENT'
  where submission.id = p_submission_id;

  return query select v_payment_id;
end;
$$;

revoke all on function public.begin_paypal_submission_payment(
  uuid, uuid, text, text, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.begin_paypal_submission_payment(
  uuid, uuid, text, text, numeric, text, jsonb
) to service_role;

drop function if exists public.claim_paypal_submission_capture(
  uuid, uuid, text, text
);

create or replace function public.claim_paypal_submission_capture(
  p_submission_id uuid,
  p_actor_user_id uuid,
  p_guest_token text,
  p_return_state text,
  p_order_id text
)
returns table(
  expected_amount numeric,
  expected_currency text,
  already_approved boolean,
  already_processing boolean,
  capture_id text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.submission_payments%rowtype;
  v_submission public.submissions%rowtype;
  v_already_approved boolean;
  v_already_processing boolean := false;
begin
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
    or v_submission.payment_amount is null
    or abs(v_payment.amount - v_submission.payment_amount) > 0.005
    or upper(btrim(coalesce(v_payment.currency, '')))
      <> upper(btrim(coalesce(v_submission.payment_currency, '')))
  then
    raise exception 'PAYPAL_PAYMENT_BINDING_MISMATCH'
      using errcode = '22000';
  end if;

  if v_payment.status not in ('REQUESTED', 'APPROVED') then
    raise exception 'PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;

  v_already_approved := v_payment.status = 'APPROVED';
  if not v_already_approved then
    v_already_processing := coalesce(
      v_payment.result_code = 'CAPTURE_IN_PROGRESS'
      and v_payment.updated_at >= now() - interval '2 minutes',
      false
    );

    if not v_already_processing then
      update public.submission_payments payment
      set result_code = 'CAPTURE_IN_PROGRESS',
          result_message = 'PayPal capture request is in progress.'
      where payment.id = v_payment.id
        and payment.status = 'REQUESTED';
    end if;
  end if;

  return query
  select
    v_payment.amount,
    upper(btrim(v_payment.currency)),
    v_already_approved,
    v_already_processing,
    v_payment.paypal_capture_id;
end;
$$;

revoke all on function public.claim_paypal_submission_capture(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_paypal_submission_capture(uuid, uuid, text, text, text)
  to service_role;

drop function if exists public.approve_paypal_submission_payment(
  uuid, uuid, text, text, text, numeric, text, text, jsonb, timestamptz
);

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
        when submission.status in ('SUBMITTED', 'WAITING_PAYMENT')
          then 'IN_PROGRESS'::submission_status
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

drop function if exists public.close_paypal_submission_payment(
  uuid, uuid, text, text, public.submission_payment_status, text, text, jsonb
);

create or replace function public.close_paypal_submission_payment(
  p_submission_id uuid,
  p_actor_user_id uuid,
  p_guest_token text,
  p_return_state text,
  p_order_id text,
  p_status public.submission_payment_status,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb
)
returns table(final_status public.submission_payment_status)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.submission_payments%rowtype;
  v_submission public.submissions%rowtype;
begin
  if p_status not in ('FAILED', 'CANCELED') then
    raise exception 'INVALID_TERMINAL_PAYMENT_STATUS'
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
    or v_payment.amount is null
    or v_submission.payment_amount is null
    or abs(v_payment.amount - v_submission.payment_amount) > 0.005
    or upper(btrim(coalesce(v_payment.currency, '')))
      <> upper(btrim(coalesce(v_submission.payment_currency, '')))
  then
    raise exception 'PAYPAL_PAYMENT_BINDING_MISMATCH'
      using errcode = '22000';
  end if;

  if v_payment.status = 'APPROVED' then
    raise exception 'PAYMENT_ALREADY_APPROVED'
      using errcode = '55000';
  end if;

  if v_payment.status = p_status then
    return query select v_payment.status;
    return;
  end if;

  if v_payment.status <> 'REQUESTED' then
    raise exception 'PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;

  if v_submission.paypal_order_id is distinct from p_order_id
    or lower(coalesce(v_submission.payment_provider, '')) <> 'paypal'
  then
    raise exception 'PAYPAL_PAYMENT_BINDING_MISMATCH'
      using errcode = '22000';
  end if;

  if p_status = 'CANCELED'
    and v_payment.result_code = 'CAPTURE_IN_PROGRESS'
  then
    raise exception 'PAYPAL_CAPTURE_IN_PROGRESS'
      using errcode = '55000';
  end if;

  update public.submission_payments payment
  set status = p_status,
      result_code = p_result_code,
      result_message = p_result_message,
      raw_response = public.merge_submission_payment_raw_response(
        v_payment.raw_response,
        p_raw_response
      )
  where payment.id = v_payment.id
    and payment.status = 'REQUESTED';

  update public.submissions submission
  set payment_status = 'UNPAID',
      paypal_order_id = null,
      paypal_capture_id = null,
      status = case
        when submission.status in ('SUBMITTED', 'WAITING_PAYMENT')
          then 'WAITING_PAYMENT'::submission_status
        else submission.status
      end
  where submission.id = p_submission_id
    and submission.payment_status <> 'PAID';

  return query select p_status;
end;
$$;

revoke all on function public.close_paypal_submission_payment(
  uuid, uuid, text, text, text, public.submission_payment_status, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.close_paypal_submission_payment(
  uuid, uuid, text, text, text, public.submission_payment_status, text, text, jsonb
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
        when submission.status in ('WAITING_PAYMENT', 'SUBMITTED')
          then 'IN_PROGRESS'::submission_status
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

create or replace function public.close_submission_payment_order(
  p_order_id text,
  p_status public.submission_payment_status,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb
)
returns table(
  primary_submission_id uuid,
  submission_ids uuid[],
  final_status public.submission_payment_status,
  transitioned boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.submission_payments%rowtype;
  v_submission_ids uuid[];
  v_transitioned boolean := false;
  v_submission_id uuid;
begin
  if p_status not in ('FAILED', 'CANCELED') then
    raise exception 'INVALID_TERMINAL_PAYMENT_STATUS'
      using errcode = '22023';
  end if;

  select *
    into v_payment
  from public.submission_payments payment
  where payment.order_id = p_order_id
  for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  -- Editing a submission uses this generic close path for every provider.
  -- Once a PayPal capture has been claimed, cancellation must not win the
  -- race and turn a later successful capture into an untracked charge.
  if lower(coalesce(v_payment.provider, '')) = 'paypal'
    and v_payment.status = 'REQUESTED'
    and v_payment.result_code = 'CAPTURE_IN_PROGRESS'
  then
    raise exception 'PAYPAL_CAPTURE_IN_PROGRESS'
      using errcode = '55000';
  end if;

  v_submission_ids := public.submission_payment_group_ids(
    v_payment.submission_id,
    v_payment.raw_response
  );

  if v_payment.status = 'REQUESTED' then
    update public.submission_payments payment
    set status = p_status,
        result_code = p_result_code,
        result_message = p_result_message,
        raw_response = public.merge_submission_payment_raw_response(
          v_payment.raw_response,
          p_raw_response
        )
    where payment.id = v_payment.id
      and payment.status = 'REQUESTED';
    v_transitioned := found;
    if v_transitioned then
      v_payment.status := p_status;
    end if;
  end if;

  if v_transitioned then
    perform submission.id
    from public.submissions submission
    where submission.id = any(v_submission_ids)
    order by submission.id
    for update;

    foreach v_submission_id in array v_submission_ids loop
      if not exists (
        select 1
        from public.submission_payments payment
        where payment.status in ('REQUESTED', 'APPROVED')
          and public.submission_payment_includes_submission(
            payment.submission_id,
            payment.raw_response,
            v_submission_id
          )
      ) then
        update public.submissions submission
        set payment_status = 'UNPAID',
            status = case
              when submission.status in ('SUBMITTED', 'WAITING_PAYMENT')
                then 'WAITING_PAYMENT'::submission_status
              else submission.status
            end
        where submission.id = v_submission_id
          and submission.payment_status = 'PAYMENT_PENDING';
      end if;
    end loop;
  end if;

  return query
  select
    v_payment.submission_id,
    v_submission_ids,
    v_payment.status,
    v_transitioned;
end;
$$;

revoke all on function public.close_submission_payment_order(
  text, public.submission_payment_status, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.close_submission_payment_order(
  text, public.submission_payment_status, text, text, jsonb
) to service_role;

create or replace function public.cancel_requested_submission_payments_for_edit(
  p_submission_id uuid
)
returns table(payment_order_id text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_ids text[];
  v_order_id text;
  v_payment public.submission_payments%rowtype;
begin
  if p_submission_id is null then
    raise exception 'INVALID_SUBMISSION_ID'
      using errcode = '22023';
  end if;

  select array_agg(payment.order_id order by payment.id)
    into v_order_ids
  from public.submission_payments payment
  where payment.status = 'REQUESTED'
    and public.submission_payment_includes_submission(
      payment.submission_id,
      payment.raw_response,
      p_submission_id
    );

  foreach v_order_id in array coalesce(v_order_ids, '{}'::text[]) loop
    -- The close RPC locks and rechecks every payment. If an approval won the
    -- race, it remains terminal and cannot be overwritten by this edit path.
    select payment.*
      into v_payment
    from public.submission_payments payment
    where payment.order_id = v_order_id
    for update;

    if v_payment.status = 'REQUESTED' then
      perform *
      from public.close_submission_payment_order(
        v_order_id,
        'CANCELED',
        'SUPERSEDED',
        '신청서 수정으로 기존 결제 요청이 취소되었습니다.',
        v_payment.raw_response
      );
      payment_order_id := v_order_id;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.cancel_requested_submission_payments_for_edit(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_requested_submission_payments_for_edit(uuid)
  to service_role;

create or replace function public.prevent_requested_payment_submission_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.submission_payments payment
    where payment.status = 'REQUESTED'
      and public.submission_payment_includes_submission(
        payment.submission_id,
        payment.raw_response,
        old.id
      )
  ) then
    raise exception 'PAYMENT_IN_PROGRESS'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_requested_payment_submission_delete()
  from public, anon, authenticated;

drop trigger if exists prevent_requested_payment_submission_delete
  on public.submissions;
create trigger prevent_requested_payment_submission_delete
before delete on public.submissions
for each row execute function public.prevent_requested_payment_submission_delete();

create or replace function public.protect_requested_payment_submission_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_only_payment_start_fields_changed boolean;
begin
  if not exists (
    select 1
    from public.submission_payments payment
    where payment.status = 'REQUESTED'
      and public.submission_payment_includes_submission(
        payment.submission_id,
        payment.raw_response,
        old.id
      )
  ) then
    return new;
  end if;

  -- begin_submission_payment_order inserts the REQUESTED row before it marks
  -- the submissions pending. Permit exactly that state transition, while
  -- rejecting concurrent edits that would invalidate the bound amount/data.
  v_only_payment_start_fields_changed :=
    old.payment_status in ('UNPAID', 'PAYMENT_PENDING')
    and (
      old.payment_status = 'UNPAID'
      or old.payment_method in ('CARD', 'PAYPAL')
    )
    and new.payment_status = 'PAYMENT_PENDING'
    and new.payment_method in ('CARD', 'PAYPAL')
    and new.status = 'WAITING_PAYMENT'
    and (
      (
        new.payment_method = 'CARD'
        and new.paypal_order_id is not distinct from old.paypal_order_id
        and new.paypal_capture_id is not distinct from old.paypal_capture_id
        and new.payment_provider is not distinct from old.payment_provider
      )
      or (
        new.payment_method = 'PAYPAL'
        and lower(coalesce(new.payment_provider, '')) = 'paypal'
        and new.paypal_order_id is not null
        and new.paypal_capture_id is null
        and exists (
          select 1
          from public.submission_payments payment
          where payment.status = 'REQUESTED'
            and lower(coalesce(payment.provider, '')) = 'paypal'
            and payment.order_id = new.paypal_order_id
            and payment.submission_id = old.id
        )
      )
    )
    and (
      to_jsonb(new) - array[
        'payment_status',
        'payment_method',
        'status',
        'payment_provider',
        'paypal_order_id',
        'paypal_capture_id',
        'updated_at'
      ]::text[]
    ) is not distinct from (
      to_jsonb(old) - array[
        'payment_status',
        'payment_method',
        'status',
        'payment_provider',
        'paypal_order_id',
        'paypal_capture_id',
        'updated_at'
      ]::text[]
    );

  if not v_only_payment_start_fields_changed then
    raise exception 'PAYMENT_IN_PROGRESS'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_requested_payment_submission_update()
  from public, anon, authenticated;

drop trigger if exists protect_requested_payment_submission_update
  on public.submissions;
create trigger protect_requested_payment_submission_update
before update on public.submissions
for each row execute function public.protect_requested_payment_submission_update();

create or replace function public.enforce_paid_album_discount_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_paid_base boolean;
begin
  if tg_op = 'UPDATE'
    and old.payment_status is not distinct from new.payment_status
    and old.amount_krw is not distinct from new.amount_krw
    and old.package_id is not distinct from new.package_id
    and old.is_oneclick is not distinct from new.is_oneclick
    and old.user_id is not distinct from new.user_id
    and old.guest_token is not distinct from new.guest_token
    and old.album_base_price_krw is not distinct from new.album_base_price_krw
    and old.album_price_tier is not distinct from new.album_price_tier
    and old.album_discount_base_submission_id
      is not distinct from new.album_discount_base_submission_id
  then
    return new;
  end if;

  if new.type = 'ALBUM' and new.payment_status = 'PAID' then
    perform public.assert_album_price_snapshots(array[new.id]);

    if new.album_price_tier = 'ADDITIONAL' then
      -- The payment-start RPC wrote this immutable relationship while all
      -- selected rows were locked and ownership-checked. Requiring that exact
      -- base row to be PAID lets distinct-token guest cart items complete in
      -- one transaction without allowing a guest to borrow an unrelated paid
      -- row later.
      select exists (
        select 1
        from public.submissions paid_base
        where paid_base.id = new.album_discount_base_submission_id
          and paid_base.id <> new.id
          and paid_base.type = 'ALBUM'
          and paid_base.payment_status = 'PAID'
          and paid_base.package_id is not distinct from new.package_id
          and paid_base.is_oneclick is not distinct from new.is_oneclick
          and paid_base.album_price_tier = 'FULL'
          and paid_base.album_base_price_krw = new.album_base_price_krw
          and paid_base.amount_krw = new.album_base_price_krw
          and (
            (
              new.user_id is not null
              and paid_base.user_id = new.user_id
            )
            or (
              new.user_id is null
              and paid_base.user_id is null
            )
          )
      ) into v_has_paid_base;

      if not coalesce(v_has_paid_base, false) then
        raise exception 'ALBUM_DISCOUNT_NOT_ELIGIBLE:%', new.id
          using errcode = '55000';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_paid_album_discount_eligibility()
  from public, anon, authenticated;

drop trigger if exists enforce_paid_album_discount_eligibility
  on public.submissions;
create constraint trigger enforce_paid_album_discount_eligibility
after insert or update on public.submissions
deferrable initially deferred
for each row execute function public.enforce_paid_album_discount_eligibility();

create or replace function public.protect_submission_payment_terminal_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status in ('APPROVED', 'FAILED', 'CANCELED')
    and new.status is distinct from old.status
  then
    raise exception 'PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_submission_payment_terminal_state()
  from public, anon, authenticated;

drop trigger if exists protect_submission_payment_terminal_state
  on public.submission_payments;
create trigger protect_submission_payment_terminal_state
before update on public.submission_payments
for each row execute function public.protect_submission_payment_terminal_state();
