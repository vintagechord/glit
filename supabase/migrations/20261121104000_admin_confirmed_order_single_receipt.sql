-- An administrator who marks an unfinished card order paid
-- (admin_confirm_unpaid_order_payment, 20261119120000) closes its attempts
-- as CANCELED, so no APPROVED attempt exists and every application of the
-- order fell back to its own receipt key, 'paid:<application id>'. The
-- receipt mail is keyed by that event key and the order
-- (payment-approved:<key>:<order>:<recipient>), so the customer received one
-- identical "결제 완료" mail per application in the order. A gateway approval
-- (the attempt's order id) and a bank deposit ('bank:<order>') already share
-- one key per order.
--
-- The fallback now uses the order, 'order:<order id>', before the
-- application. Gateway, PayPal and bank keys are unchanged, and an
-- application without an order still gets 'paid:<application id>'.
--
-- Latest definition: 20261025132939_paid_submission_notification_events.sql.
-- Only the fallback key changed.
create or replace function public.record_paid_submission_notification() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare notification_key text;
begin
  if new.payment_status::text <> 'PAID' or new.type::text not in ('ALBUM','MV_DISTRIBUTION','MV_BROADCAST') then return new; end if;
  if tg_op = 'UPDATE' and old.payment_status::text = 'PAID' then return new; end if;
  if new.payment_method::text = 'BANK' then
    notification_key := 'bank:' || coalesce(new.current_order_id::text,new.id::text);
  else
    select p.order_id into notification_key from public.submission_payments p
      where p.status::text='APPROVED'
        and public.submission_payment_includes_submission(p.submission_id,p.raw_response,new.id)
      order by p.paid_at desc nulls last,p.created_at desc limit 1;
    if notification_key is not null and new.payment_method::text='PAYPAL' then
      notification_key := 'paypal:' || notification_key;
    end if;
    notification_key := coalesce(notification_key,'order:' || new.current_order_id::text,'paid:' || new.id::text);
  end if;
  insert into public.paid_submission_notification_events(submission_id,payment_key)
    values(new.id,notification_key) on conflict(submission_id) do nothing;
  return new;
end $$;
revoke all on function public.record_paid_submission_notification() from public,anon,authenticated;
grant execute on function public.record_paid_submission_notification() to service_role;
