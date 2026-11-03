-- The scheduler token was compared with text "=", which stops at the first
-- differing byte. Compare SHA-256 digests instead: the digest of a guess has
-- no usable relation to the stored token, so response timing reveals nothing
-- about it. pgcrypto lives in the extensions schema (see 0078).
create or replace function public.authorize_email_worker(p_token text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select enabled
       and p_token is not null
       and extensions.digest(token, 'sha256') = extensions.digest(p_token, 'sha256')
      from public.email_worker_config
     where singleton
  ), false);
$$;
revoke all on function public.authorize_email_worker(text) from public, anon, authenticated;
grant execute on function public.authorize_email_worker(text) to service_role;
