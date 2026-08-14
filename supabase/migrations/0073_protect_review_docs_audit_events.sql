create or replace function public.protect_review_docs_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type = 'REVIEW_DOCS_GENERATED'
    and auth.uid() is not null
    and not public.is_admin()
  then
    raise exception 'Only administrators can create review document audit events.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_review_docs_audit_event() from public;
revoke all on function public.protect_review_docs_audit_event() from anon;
revoke all on function public.protect_review_docs_audit_event() from authenticated;

drop trigger if exists protect_review_docs_audit_event on public.submission_events;
create trigger protect_review_docs_audit_event
before insert on public.submission_events
for each row execute function public.protect_review_docs_audit_event();
