-- Staff notes were stored in submissions.admin_memo. The owner SELECT policy
-- on submissions is row-level only, so a member session could read its own
-- rows' internal notes with select('admin_memo').
--
-- Column privileges were the other option, but they would break every member
-- select('*'), insert().select() and embedded submissions(*) read, and every
-- later "add column" to submissions would silently stay unreadable unless its
-- migration also remembered a grant. Notes move to an administrator-only
-- table instead and the member surface of submissions does not change.
--
-- submissions.admin_memo stays (always null) so existing RPCs keep working:
-- confirm_submission_order_bank_payment and refund_submission_order set it,
-- admin_record_refund appends a refund line to it, and the guest album intake
-- inserts it. A trigger moves any such write into the new table:
--   * the incoming text replaces the note when it is the same note or extends
--     it (an edit form that was prefilled with the current note);
--   * any other text is appended on a new line, so a refund line never wipes
--     earlier staff notes.
-- The admin screens write the table directly and replace the whole note.

create table if not exists public.submission_admin_memos (
  -- Deferred so the BEFORE INSERT trigger can record a note for a submission
  -- whose row is being inserted by the same statement.
  submission_id uuid primary key
    references public.submissions(id) on delete cascade
    deferrable initially deferred,
  memo text not null check (char_length(btrim(memo)) > 0),
  updated_at timestamptz not null default now()
);

alter table public.submission_admin_memos enable row level security;
revoke all on public.submission_admin_memos from public, anon, authenticated;
grant select, insert, update, delete on public.submission_admin_memos to service_role;

drop policy if exists "Submission admin memos managed by admin" on public.submission_admin_memos;
create policy "Submission admin memos managed by admin"
on public.submission_admin_memos
for all
using (public.is_admin())
with check (public.is_admin());

create or replace function public.route_submission_admin_memo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incoming text := nullif(btrim(coalesce(new.admin_memo, '')), '');
  v_existing text;
begin
  if new.admin_memo is null then
    return new;
  end if;
  -- protect_submission_privileged_fields fires first and already rejects
  -- these writers; repeat the check so the trigger order cannot matter.
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'Submission field admin_memo requires administrator privileges.'
      using errcode = '42501';
  end if;
  new.admin_memo := null;
  if v_incoming is null then
    return new;
  end if;
  -- An UPDATE already holds the submission row lock, so writers of one
  -- submission's note are serialized.
  select m.memo into v_existing
    from public.submission_admin_memos m
   where m.submission_id = new.id
   for update;
  insert into public.submission_admin_memos as m (submission_id, memo, updated_at)
  values (
    new.id,
    case
      when v_existing is null or starts_with(v_incoming, btrim(v_existing)) then v_incoming
      else v_existing || E'\n' || v_incoming
    end,
    now()
  )
  on conflict (submission_id) do update
    set memo = excluded.memo, updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function public.route_submission_admin_memo() from public, anon, authenticated;

-- Named to sort after protect_submission_privileged_fields: BEFORE triggers
-- fire in name order, and the privileged-field guard must see the write.
drop trigger if exists route_submission_admin_memo on public.submissions;
create trigger route_submission_admin_memo
before insert or update of admin_memo on public.submissions
for each row
when (new.admin_memo is not null)
execute function public.route_submission_admin_memo();

-- Move existing notes. CREATE/DISABLE TRIGGER hold a lock that blocks other
-- submission writes until this migration commits. User triggers stay off for
-- the clearing update so it neither bumps updated_at nor trips the
-- payment-state guards.
alter table public.submissions disable trigger user;

insert into public.submission_admin_memos (submission_id, memo, updated_at)
select s.id, s.admin_memo, now()
  from public.submissions s
 where nullif(btrim(coalesce(s.admin_memo, '')), '') is not null
on conflict (submission_id) do update
  set memo = excluded.memo, updated_at = excluded.updated_at;

update public.submissions
   set admin_memo = null
 where admin_memo is not null;

alter table public.submissions enable trigger user;
