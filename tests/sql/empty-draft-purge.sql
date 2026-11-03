\set ON_ERROR_STOP on
-- Isolated checks for supabase/migrations/20261103140000_empty_draft_purge_content.sql.
-- Runs after tests/sql/open-fixes.sql, which already added the contact
-- columns and the dependent tables. Add inert stand-ins for the remaining
-- form columns the widened predicate reads.
alter table public.submissions
  add column if not exists artist_id uuid,
  add column if not exists release_date date,
  add column if not exists archive_review_context jsonb,
  add column if not exists genre text,
  add column if not exists artist_name_kr text,
  add column if not exists artist_name_en text,
  add column if not exists distributor text,
  add column if not exists production_company text,
  add column if not exists previous_release text,
  add column if not exists artist_members text,
  add column if not exists guest_name text,
  add column if not exists guest_company text,
  add column if not exists bank_depositor_name text,
  add column if not exists mv_runtime text,
  add column if not exists mv_format text,
  add column if not exists mv_director text,
  add column if not exists mv_lead_actor text,
  add column if not exists mv_storyline text,
  add column if not exists mv_production_company text,
  add column if not exists mv_agency text,
  add column if not exists mv_album_title text,
  add column if not exists mv_production_date date,
  add column if not exists mv_distribution_company text,
  add column if not exists mv_business_reg_no text,
  add column if not exists mv_usage text,
  add column if not exists mv_desired_rating text,
  add column if not exists mv_memo text,
  add column if not exists mv_song_title text,
  add column if not exists mv_song_title_kr text,
  add column if not exists mv_song_title_en text,
  add column if not exists mv_song_title_official text,
  add column if not exists mv_composer text,
  add column if not exists mv_lyricist text,
  add column if not exists mv_arranger text,
  add column if not exists mv_song_memo text,
  add column if not exists mv_lyrics text,
  add column if not exists mv_selected_station_codes text[] not null default '{}'::text[],
  add column if not exists application_form_mode text,
  add column if not exists files_submitted_by_email boolean not null default false;

begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare
  empty_id uuid:='00000000-0000-4000-8000-00000000f001';
  mv_id uuid:='00000000-0000-4000-8000-00000000f002';
  album_id uuid:='00000000-0000-4000-8000-00000000f003';
  mode_id uuid:='00000000-0000-4000-8000-00000000f004';
  email_id uuid:='00000000-0000-4000-8000-00000000f005';
  priced_id uuid:='00000000-0000-4000-8000-00000000f006';
  deleted integer;
begin
  insert into public.submissions(id,user_id,guest_token,type,status,payment_status,payment_method,amount_krw,title,artist_name,applicant_email,created_at,updated_at)
  values (empty_id,null,'purge-wide-token-0001','MV_DISTRIBUTION','DRAFT','UNPAID','BANK',0,null,null,null,now()-interval '2 days',now()-interval '2 days'),
         (mv_id,null,'purge-wide-token-0002','MV_BROADCAST','DRAFT','UNPAID','BANK',0,null,null,null,now()-interval '2 days',now()-interval '2 days'),
         (album_id,null,'purge-wide-token-0003','ALBUM','DRAFT','UNPAID','BANK',0,null,null,null,now()-interval '2 days',now()-interval '2 days'),
         (mode_id,null,'purge-wide-token-0004','MV_DISTRIBUTION','DRAFT','UNPAID','BANK',0,null,null,null,now()-interval '2 days',now()-interval '2 days'),
         (email_id,null,'purge-wide-token-0005','ALBUM','DRAFT','UNPAID','BANK',0,null,null,null,now()-interval '2 days',now()-interval '2 days'),
         (priced_id,null,'purge-wide-token-0006','ALBUM','DRAFT','UNPAID','BANK',0,null,null,null,now()-interval '2 days',now()-interval '2 days');
  -- A saved MV draft with a director and stations but no title yet.
  update public.submissions set mv_director='Director', mv_selected_station_codes=array['KBS'] where id=mv_id;
  update public.submissions set genre='Rock', release_date=current_date where id=album_id;
  update public.submissions set application_form_mode='online' where id=mode_id;
  update public.submissions set files_submitted_by_email=true where id=email_id;
  update public.submissions set package_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', amount_krw=50000 where id=priced_id;
  -- The updates above ran now(); restore the abandoned-for-two-days clock.
  update public.submissions set updated_at=now()-interval '2 days' where id in (empty_id,mv_id,album_id,mode_id,email_id,priced_id);

  select deleted_count into deleted from public.purge_empty_draft_submissions();
  if exists(select 1 from public.submissions where id=empty_id) then
    raise exception 'Empty draft shell was not purged (deleted %)',deleted; end if;
  if (select count(*) from public.submissions where id in (mv_id,album_id,mode_id,email_id,priced_id))<>5 then
    raise exception 'Purge removed a draft with saved MV, album, mode, email-handoff or package content'; end if;
  perform 1 from public.purge_empty_draft_submissions(interval '24 hours', 500);
  if has_function_privilege('authenticated','public.purge_empty_draft_submissions(interval,integer)','execute') then
    raise exception 'Purge RPC exposed to members'; end if;
end;
$$;
rollback;
