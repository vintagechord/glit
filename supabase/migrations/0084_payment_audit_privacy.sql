-- Payment gateway responses may contain bearer URLs, callback nonces, card
-- data and payer identity fields. Keep only reconciliation fields in audit
-- JSON, preserve internal payment-group/state metadata on server-only payment
-- rows, and remove direct owner reads of those rows.

create or replace function public.scrub_payment_audit_json(
  p_value jsonb,
  p_depth integer default 0
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
  v_key text;
  v_value jsonb;
  v_scrubbed jsonb;
  v_normalized_key text;
  v_allowed_keys constant text[] := array[
    'provider', 'kind', 'paypalorder', 'returnparams', 'approval',
    'signatureverification', 'compensation', 'inputs', 'data',
    'purchaseunits', 'payments', 'captures', 'amount', 'links',
    'linkrelations', 'issues', 'id', 'name', 'debugid', 'issue', 'rel',
    'method', 'status', 'resultcode', 'resultmsg', 'resultmessage', 'phase',
    'bindingerror', 'expected', 'received', 'expectedorderid',
    'approvedorderid', 'expectedamount', 'approvedamount', 'orderid',
    'ordernumber', 'moid', 'referenceid', 'customid', 'tid', 'pgtid',
    'captureid', 'cardtid', 'ptid', 'price', 'totprice', 'pamt', 'currency',
    'currencycode', 'value', 'mid', 'timestamp', 'tstamp', 'paymethod',
    'cardcode', 'cardquota', 'appldate', 'appltime', 'verifystatus',
    'sigmismatchreason', 'sigverified', 'securesignaturematches',
    'totpricesource', 'ok', 'skipped', 'at', 'closecallback',
    'paypalcancelreturn'
  ];
begin
  if p_value is null or p_depth > 6 then
    return null;
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      v_result := '{}'::jsonb;
      for v_key, v_value in
        select entry.key, entry.value
        from jsonb_each(p_value) entry
        order by entry.key
        limit 100
      loop
        v_normalized_key := regexp_replace(
          lower(v_key),
          '[^a-z0-9]',
          '',
          'g'
        );
        if v_normalized_key = any(v_allowed_keys) then
          v_scrubbed := public.scrub_payment_audit_json(
            v_value,
            p_depth + 1
          );
          if v_scrubbed is not null and v_scrubbed <> 'null'::jsonb then
            v_result := v_result || jsonb_build_object(v_key, v_scrubbed);
          end if;
        end if;
      end loop;
      return v_result;
    when 'array' then
      select coalesce(jsonb_agg(item.scrubbed order by item.ordinality), '[]'::jsonb)
        into v_result
      from (
        select
          element.ordinality,
          public.scrub_payment_audit_json(
            element.value,
            p_depth + 1
          ) as scrubbed
        from jsonb_array_elements(p_value) with ordinality element(value, ordinality)
        order by element.ordinality
        limit 20
      ) item
      where item.scrubbed is not null
        and item.scrubbed <> 'null'::jsonb;
      return v_result;
    when 'string' then
      return to_jsonb(left(p_value #>> '{}', 500));
    when 'number', 'boolean' then
      return p_value;
    else
      return null;
  end case;
end;
$$;

revoke all on function public.scrub_payment_audit_json(jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.scrub_payment_audit_json(jsonb, integer)
  to service_role;

create or replace function public.scrub_server_payment_raw_response(
  p_value jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when p_value is null then null
    else coalesce(
      public.scrub_payment_audit_json(
        p_value - array['paymentGroup', 'closeState', 'paypalReturnState'],
        0
      ),
      '{}'::jsonb
    )
    || case
      when p_value ? 'paymentGroup'
        then jsonb_build_object('paymentGroup', p_value -> 'paymentGroup')
      else '{}'::jsonb
    end
    || case
      when p_value ? 'closeState'
        then jsonb_build_object('closeState', p_value -> 'closeState')
      else '{}'::jsonb
    end
    || case
      when p_value ? 'paypalReturnState'
        then jsonb_build_object(
          'paypalReturnState',
          p_value -> 'paypalReturnState'
        )
      else '{}'::jsonb
    end
  end;
$$;

revoke all on function public.scrub_server_payment_raw_response(jsonb)
  from public, anon, authenticated;
grant execute on function public.scrub_server_payment_raw_response(jsonb)
  to service_role;

update public.submission_payments payment
set raw_response = public.scrub_server_payment_raw_response(payment.raw_response)
where payment.raw_response is not null;

update public.karaoke_payments payment
set raw_response = public.scrub_server_payment_raw_response(payment.raw_response)
where payment.raw_response is not null;

update public.karaoke_requests request
set payment_raw_response = public.scrub_payment_audit_json(
  request.payment_raw_response
    - array['paymentGroup', 'closeState', 'paypalReturnState'],
  0
)
where request.payment_raw_response is not null;

create or replace function public.enforce_payment_audit_privacy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.raw_response := public.scrub_server_payment_raw_response(
    new.raw_response
  );
  return new;
end;
$$;

drop trigger if exists enforce_submission_payment_audit_privacy
  on public.submission_payments;
create trigger enforce_submission_payment_audit_privacy
before insert or update of raw_response on public.submission_payments
for each row execute function public.enforce_payment_audit_privacy();

drop trigger if exists enforce_karaoke_payment_audit_privacy
  on public.karaoke_payments;
create trigger enforce_karaoke_payment_audit_privacy
before insert or update of raw_response on public.karaoke_payments
for each row execute function public.enforce_payment_audit_privacy();

revoke all on function public.enforce_payment_audit_privacy()
  from public, anon, authenticated;

create or replace function public.enforce_karaoke_request_audit_privacy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.payment_raw_response is not null then
    new.payment_raw_response := public.scrub_payment_audit_json(
      new.payment_raw_response
        - array['paymentGroup', 'closeState', 'paypalReturnState'],
      0
    );
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_karaoke_request_audit_privacy
  on public.karaoke_requests;
create trigger enforce_karaoke_request_audit_privacy
before insert or update of payment_raw_response on public.karaoke_requests
for each row execute function public.enforce_karaoke_request_audit_privacy();

revoke all on function public.enforce_karaoke_request_audit_privacy()
  from public, anon, authenticated;

drop policy if exists "Submission payments readable by owner or admin"
  on public.submission_payments;
drop policy if exists "Submission payments readable by admin"
  on public.submission_payments;
create policy "Submission payments readable by admin"
on public.submission_payments
for select
using (public.is_admin());

drop policy if exists "Karaoke payments readable"
  on public.karaoke_payments;
drop policy if exists "Karaoke payments readable by admin"
  on public.karaoke_payments;
create policy "Karaoke payments readable by admin"
on public.karaoke_payments
for select
using (public.is_admin());
