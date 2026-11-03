-- /admin/users listed 200 profiles and fetched only the first 1,000 auth users
-- for their emails, so later members showed "-". The page now paginates
-- profiles and asks for exactly the emails it shows, by id, and can search
-- by email. Only the service role may call these.
create or replace function public.admin_auth_user_emails(p_user_ids uuid[])
returns table(user_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text
    from auth.users u
   where u.id = any((coalesce(p_user_ids, '{}'::uuid[]))[1:200]);
$$;
revoke all on function public.admin_auth_user_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_auth_user_emails(uuid[]) to service_role;

-- Case-insensitive substring match on the account email. LIKE wildcards in
-- the query are matched literally.
create or replace function public.admin_search_auth_user_ids(p_query text, p_limit integer default 200)
returns table(user_id uuid)
language sql stable security definer set search_path = '' as $$
  select u.id
    from auth.users u
   where char_length(btrim(coalesce(p_query, ''))) between 1 and 254
     and u.email ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by u.created_at desc, u.id desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
revoke all on function public.admin_search_auth_user_ids(text, integer) from public, anon, authenticated;
grant execute on function public.admin_search_auth_user_ids(text, integer) to service_role;
