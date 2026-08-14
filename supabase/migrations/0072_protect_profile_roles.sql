create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is distinct from 'user' and not public.is_admin() then
      raise exception 'Only administrators can assign profile roles.'
        using errcode = '42501';
    end if;
  elsif new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only administrators can change profile roles.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_profile_role() from public;
revoke all on function public.protect_profile_role() from anon;
revoke all on function public.protect_profile_role() from authenticated;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
before insert or update of role on public.profiles
for each row execute function public.protect_profile_role();
