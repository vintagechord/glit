-- Administrators need to see how each member signed up (email, Naver, Kakao,
-- Google) and which other sign-in methods are linked. The earliest auth
-- identity is the sign-up method; app metadata is the fallback for accounts
-- without identity rows. Read-only, at most 200 ids, service role only.
create or replace function public.admin_auth_user_accounts(p_user_ids uuid[])
returns table(user_id uuid, email text, signup_provider text, providers text[])
language sql stable security definer set search_path = '' as $$
  select u.id,
         u.email::text,
         coalesce(
           (select i.provider from auth.identities i where i.user_id = u.id order by i.created_at asc, i.provider asc limit 1),
           nullif(u.raw_app_meta_data->>'provider', '')
         ),
         coalesce(
           (select array_agg(p.provider order by p.first_at, p.provider)
              from (select i.provider, min(i.created_at) as first_at
                      from auth.identities i where i.user_id = u.id group by i.provider) p),
           (select array_agg(value order by ordinality)
              from jsonb_array_elements_text(
                     case when jsonb_typeof(u.raw_app_meta_data->'providers') = 'array'
                          then u.raw_app_meta_data->'providers' else '[]'::jsonb end
                   ) with ordinality),
           '{}'::text[]
         )
    from auth.users u
   where u.id = any((coalesce(p_user_ids, '{}'::uuid[]))[1:200]);
$$;
revoke all on function public.admin_auth_user_accounts(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_auth_user_accounts(uuid[]) to service_role;
