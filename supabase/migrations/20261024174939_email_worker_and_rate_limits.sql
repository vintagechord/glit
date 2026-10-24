-- Server-only request limits and scheduler credentials. No customer/session role
-- can read tokens or call these functions; existing service_role is the worker.
create table if not exists public.email_rate_limits (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  used bigint not null default 0,
  reset_at timestamptz not null
);
alter table public.email_rate_limits enable row level security;
revoke all on public.email_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.email_rate_limits to service_role;

create or replace function public.consume_email_rate_limit(p_key text, p_limit integer, p_window_ms integer, p_cost integer default 1)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_row public.email_rate_limits; v_now timestamptz := clock_timestamp(); v_allowed boolean;
begin
  if p_key !~ '^[a-f0-9]{64}$' or p_limit < 1 or p_cost < 1 or p_window_ms not between 1000 and 86400000 then
    raise exception 'Invalid rate limit';
  end if;
  insert into public.email_rate_limits(key, used, reset_at)
  values(p_key, 0, v_now + p_window_ms * interval '1 millisecond') on conflict do nothing;
  select * into v_row from public.email_rate_limits where key=p_key for update;
  if v_row.reset_at <= v_now then
    v_row.used := 0;
    v_row.reset_at := v_now + p_window_ms * interval '1 millisecond';
  end if;
  v_allowed := v_row.used + p_cost <= p_limit;
  if v_allowed then v_row.used := v_row.used + p_cost; end if;
  update public.email_rate_limits set used=v_row.used, reset_at=v_row.reset_at where key=p_key;
  return jsonb_build_object('allowed', v_allowed, 'remaining', greatest(0,p_limit-v_row.used),
    'retryAfterSeconds', case when v_allowed then 0 else greatest(1,ceil(extract(epoch from(v_row.reset_at-v_now)))) end,
    'resetAt', floor(extract(epoch from v_row.reset_at)*1000));
end $$;
revoke all on function public.consume_email_rate_limit(text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_email_rate_limit(text,integer,integer,integer) to service_role;

create table if not exists public.email_worker_config (
  singleton boolean primary key default true check(singleton),
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') check(token ~ '^[a-f0-9]{64}$'),
  endpoint_url text not null check(endpoint_url ~ '^https://[a-zA-Z0-9.-]+/api/internal/email-outbox$'),
  enabled boolean not null default false,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_error boolean not null default false,
  last_request_id bigint
);
alter table public.email_worker_config enable row level security;
revoke all on public.email_worker_config from public, anon, authenticated;
grant select, insert, update on public.email_worker_config to service_role;

create or replace function public.authorize_email_worker(p_token text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select enabled and token = p_token from public.email_worker_config where singleton),false);
$$;
revoke all on function public.authorize_email_worker(text) from public, anon, authenticated;
grant execute on function public.authorize_email_worker(text) to service_role;

-- Extensions are standard Supabase modules. On other Postgres installations the
-- application/table migration still works; an external scheduler can POST.
do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists(select 1 from pg_available_extensions where name='pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

create or replace function public.dispatch_email_outbox()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_config public.email_worker_config; v_request bigint;
begin
  delete from public.email_rate_limits where reset_at < now() - interval '1 day';
  if to_regprocedure('public.maintain_email_outbox()') is not null then
    perform public.maintain_email_outbox();
  end if;
  select * into v_config from public.email_worker_config where singleton;
  if not found or not v_config.enabled then return; end if;
  -- Avoid waking the web service when idle. A daily worker run also handles
  -- expiry/retention; abandoned leases must be marked uncertain, never resent.
  if not exists(select 1 from public.email_outbox where
       (status in ('pending','retry') and next_attempt_at <= now())
       or (status='sending' and lease_expires_at <= now()))
     and v_config.last_finished_at > now()-interval '1 day' then return; end if;
  select net.http_post(url := v_config.endpoint_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_config.token),
    body := '{}'::jsonb, timeout_milliseconds := 60000) into v_request;
  update public.email_worker_config set last_request_id=v_request where singleton;
end $$;
revoke all on function public.dispatch_email_outbox() from public, anon, authenticated;
-- Only postgres cron owns dispatch; the web worker cannot read net responses.

do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') and exists(select 1 from pg_extension where extname='pg_net') then
    perform cron.schedule('onside-email-outbox','* * * * *','select public.dispatch_email_outbox()');
  end if;
end $$;
