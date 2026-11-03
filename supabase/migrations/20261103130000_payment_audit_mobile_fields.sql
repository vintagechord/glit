-- The payment audit allowlist in the database lagged behind the application
-- allowlist (src/lib/inicis/payment-audit.ts). The INIpayMobile fields,
-- including the top-level `channel` marker that the mobile return handler
-- requires, and the stale-claim audit were dropped by the privacy trigger on
-- every write, so a mobile payment could never pass the channel check. The
-- list below is the 0084 list plus exactly the keys the application already
-- allows; card numbers, bearer URLs and buyer identity stay excluded.
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
    'paypalcancelreturn',
    -- INIpayMobile reconciliation fields and the stale-claim audit.
    'channel', 'pstatus', 'prmesg1', 'poid', 'pmid', 'ptype', 'pauthdt',
    'pauthno', 'pfncd1', 'pfnnm', 'idcname', 'staleclaim', 'expiredat',
    'claimedat'
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

-- Later writes replace the audit JSON but keep server metadata. The payment
-- channel is server metadata too: a replayed mobile result for an attempt
-- whose audit was rewritten (for example an uncertain approval) must still be
-- recognised as mobile. Only the two known values are carried forward.
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
        || case
          when p_existing_raw_response ->> 'channel' in ('pc', 'mobile')
            then jsonb_build_object(
              'channel',
              p_existing_raw_response -> 'channel'
            )
          else '{}'::jsonb
        end
  end;
$$;

revoke all on function public.merge_submission_payment_raw_response(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_submission_payment_raw_response(jsonb, jsonb)
  to service_role;
