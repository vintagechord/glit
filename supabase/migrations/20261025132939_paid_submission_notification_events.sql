-- Record receipt intent in the payment transaction; existing paid submissions
-- are deliberately not backfilled. Only future confirmations generate mail.
create table public.paid_submission_notification_events (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  payment_key text not null,
  created_at timestamptz not null default now(),
  enqueued_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz
);
create index paid_submission_notification_due_idx on public.paid_submission_notification_events(next_attempt_at)
  where enqueued_at is null;
alter table public.paid_submission_notification_events enable row level security;
revoke all on public.paid_submission_notification_events from public,anon,authenticated;
grant select,insert,update,delete on public.paid_submission_notification_events to service_role;

create function public.record_paid_submission_notification() returns trigger
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
    notification_key := coalesce(notification_key,'paid:' || new.id::text);
  end if;
  insert into public.paid_submission_notification_events(submission_id,payment_key)
    values(new.id,notification_key) on conflict(submission_id) do nothing;
  return new;
end $$;
revoke all on function public.record_paid_submission_notification() from public,anon,authenticated;
grant execute on function public.record_paid_submission_notification() to service_role;
create trigger record_paid_submission_notification after insert or update of payment_status on public.submissions
  for each row execute function public.record_paid_submission_notification();

create function public.claim_paid_submission_notifications(p_limit integer default 2)
returns setof public.paid_submission_notification_events
language plpgsql security invoker set search_path = '' as $$
begin
  return query with due as (
    select e.submission_id from public.paid_submission_notification_events e
      where e.enqueued_at is null and e.next_attempt_at <= now()
        and (e.lease_expires_at is null or e.lease_expires_at <= now())
      order by e.next_attempt_at,e.created_at limit least(greatest(coalesce(p_limit,2),1),5)
      for update skip locked
  ) update public.paid_submission_notification_events e set lease_token=gen_random_uuid(),
      lease_expires_at=now()+interval '5 minutes',attempt_count=e.attempt_count+1
    from due where e.submission_id=due.submission_id returning e.*;
end $$;
-- Reclaiming expired event leases is safe: events only create messages through
-- the durable outbox, whose unique keys and SMTP uncertainty protection apply.
create function public.finish_paid_submission_notification(p_submission_id uuid,p_lease_token uuid,p_recorded boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  update public.paid_submission_notification_events e set
    enqueued_at=case when p_recorded then now() else null end,
    next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(e.attempt_count-1,7))::integer)),
    lease_token=null,lease_expires_at=null
    where e.submission_id=p_submission_id and e.lease_token=p_lease_token and e.enqueued_at is null;
  get diagnostics affected = row_count;
  return affected=1;
end $$;
create function public.paid_submission_notification_stats()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('pending',count(*) filter(where enqueued_at is null),
    'oldestPendingAt',min(created_at) filter(where enqueued_at is null))
  from public.paid_submission_notification_events;
$$;
revoke all on function public.claim_paid_submission_notifications(integer) from public,anon,authenticated;
revoke all on function public.finish_paid_submission_notification(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.paid_submission_notification_stats() from public,anon,authenticated;
grant execute on function public.claim_paid_submission_notifications(integer) to service_role;
grant execute on function public.finish_paid_submission_notification(uuid,uuid,boolean) to service_role;
grant execute on function public.paid_submission_notification_stats() to service_role;

create or replace function public.dispatch_email_outbox()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_config public.email_worker_config; v_request bigint;
begin
  delete from public.email_rate_limits where reset_at < now() - interval '1 day';
  perform public.maintain_email_outbox();
  select * into v_config from public.email_worker_config where singleton;
  if not found or not v_config.enabled then return; end if;
  if not exists(select 1 from public.email_outbox where
       (status in ('pending','retry') and next_attempt_at <= now())
       or (status='sending' and lease_expires_at <= now()))
     and not exists(select 1 from public.paid_submission_notification_events where enqueued_at is null
       and next_attempt_at <= now() and (lease_expires_at is null or lease_expires_at <= now()))
     and v_config.last_finished_at > now()-interval '1 day' then return; end if;
  select net.http_post(url := v_config.endpoint_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_config.token),
    body := '{}'::jsonb,timeout_milliseconds := 60000) into v_request;
  update public.email_worker_config set last_request_id=v_request where singleton;
end $$;
revoke all on function public.dispatch_email_outbox() from public,anon,authenticated;
