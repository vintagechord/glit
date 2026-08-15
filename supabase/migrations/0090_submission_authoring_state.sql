-- Preserve the mutually-exclusive authoring choice and explicit email-file
-- handoff across reloads, cart edits, and devices. These values are written by
-- the trusted submission save action together with the rest of the parent row.

alter table public.submissions
  add column if not exists application_form_mode text,
  add column if not exists files_submitted_by_email boolean not null default false,
  add column if not exists mv_selected_station_codes text[] not null default '{}'::text[],
  add column if not exists album_draft_group_id uuid;

alter table public.submissions
  drop constraint if exists submissions_album_draft_group_id_fkey;

alter table public.submissions
  add constraint submissions_album_draft_group_id_fkey
  foreign key (album_draft_group_id)
  references public.submissions(id)
  on delete set null;

create index if not exists submissions_album_draft_group_id_idx
  on public.submissions(album_draft_group_id)
  where album_draft_group_id is not null;

alter table public.submissions
  drop constraint if exists submissions_application_form_mode_check;

alter table public.submissions
  add constraint submissions_application_form_mode_check
  check (
    application_form_mode is null
    or application_form_mode in ('online', 'upload')
  );

alter table public.submissions
  drop constraint if exists submissions_mv_selected_station_codes_count_check;

alter table public.submissions
  add constraint submissions_mv_selected_station_codes_count_check
  check (cardinality(mv_selected_station_codes) <= 32);

update public.submissions submission
set application_form_mode = 'upload'
where submission.application_form_mode is null
  and exists (
    select 1
    from public.submission_files file
    where file.submission_id = submission.id
      and lower(coalesce(file.original_name, '')) ~ '\.(hwp|doc|docx)$'
  );

update public.submissions
set application_form_mode = 'online'
where application_form_mode is null
  and is_oneclick is true;

update public.submissions submission
set mv_selected_station_codes = coalesce((
  select array_agg(distinct station.code order by station.code)
  from public.station_reviews review
  join public.stations station on station.id = review.station_id
  where review.submission_id = submission.id
    and station.code is not null
), '{}'::text[])
where submission.type in ('MV_DISTRIBUTION', 'MV_BROADCAST')
  and cardinality(submission.mv_selected_station_codes) = 0;

comment on column public.submissions.application_form_mode is
  'Chosen submission form path: online fields or an uploaded application form.';
comment on column public.submissions.files_submitted_by_email is
  'User explicitly chose the email file handoff instead of an attached media file.';
comment on column public.submissions.mv_selected_station_codes is
  'Canonical MV option codes persisted while a draft has no station review rows.';
comment on column public.submissions.album_draft_group_id is
  'Stable base submission id used to resume a multi-album draft as one bundle.';

create or replace function public.protect_submission_authoring_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.application_form_mode is not null
      or new.files_submitted_by_email
      or cardinality(new.mv_selected_station_codes) > 0
      or new.album_draft_group_id is not null
    then
      raise exception 'Submission authoring state requires the service role.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.application_form_mode is distinct from new.application_form_mode
    or old.files_submitted_by_email is distinct from new.files_submitted_by_email
    or old.mv_selected_station_codes is distinct from new.mv_selected_station_codes
    or old.album_draft_group_id is distinct from new.album_draft_group_id
  then
    raise exception 'Submission authoring state requires the service role.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_protect_authoring_state
  on public.submissions;
create trigger submissions_protect_authoring_state
before insert or update on public.submissions
for each row execute function public.protect_submission_authoring_state();
