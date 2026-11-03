-- The hourly empty-draft purge (20261031120000_open_fixes.sql) judged a draft
-- empty from its album/contact text alone. An MV draft with a director,
-- storyline and selected stations but no title yet, or an album draft with a
-- chosen package, genre or release date, was deleted after 24 hours. Every
-- column the save action writes from the customer's form now keeps the row:
-- the package and price, artist link, release metadata, all MV fields and
-- stations, the authoring method, the email-file handoff and the payment
-- details. Arguments, defaults, grants and the pg_cron job are unchanged.
create or replace function public.purge_empty_draft_submissions(p_min_age interval default interval '24 hours',p_limit integer default 500)
returns table(deleted_count integer) language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
  if p_min_age < interval '1 hour' or p_limit not between 1 and 5000 then raise exception 'INVALID_PURGE_ARGUMENTS' using errcode='22023'; end if;
  with candidates as (
    select s.id from public.submissions s
    where s.status='DRAFT' and s.payment_status='UNPAID' and s.current_order_id is null
      and s.save_lease_token is null and s.album_draft_group_id is null
      and s.created_at < now()-p_min_age and s.updated_at < now()-p_min_age
      and nullif(btrim(coalesce(s.title,'')),'') is null
      and nullif(btrim(coalesce(s.artist_name,'')),'') is null
      and nullif(btrim(coalesce(s.applicant_name,'')),'') is null
      and nullif(btrim(coalesce(s.applicant_email,'')),'') is null
      and nullif(btrim(coalesce(s.applicant_phone,'')),'') is null
      and nullif(btrim(coalesce(s.guest_email,'')),'') is null
      and nullif(btrim(coalesce(s.guest_phone,'')),'') is null
      and nullif(btrim(coalesce(s.melon_url,'')),'') is null
      -- Product, price and release metadata chosen in the form.
      and s.package_id is null
      and coalesce(s.amount_krw,0)=0
      and s.artist_id is null
      and s.release_date is null
      and s.archive_review_context is null
      and nullif(btrim(coalesce(s.genre,'')),'') is null
      and nullif(btrim(coalesce(s.artist_name_kr,'')),'') is null
      and nullif(btrim(coalesce(s.artist_name_en,'')),'') is null
      and nullif(btrim(coalesce(s.distributor,'')),'') is null
      and nullif(btrim(coalesce(s.production_company,'')),'') is null
      and nullif(btrim(coalesce(s.previous_release,'')),'') is null
      and nullif(btrim(coalesce(s.artist_members,'')),'') is null
      and nullif(btrim(coalesce(s.guest_name,'')),'') is null
      and nullif(btrim(coalesce(s.guest_company,'')),'') is null
      and nullif(btrim(coalesce(s.bank_depositor_name,'')),'') is null
      -- Every music video field and the selected stations.
      and nullif(btrim(coalesce(s.mv_runtime,'')),'') is null
      and nullif(btrim(coalesce(s.mv_format,'')),'') is null
      and nullif(btrim(coalesce(s.mv_director,'')),'') is null
      and nullif(btrim(coalesce(s.mv_lead_actor,'')),'') is null
      and nullif(btrim(coalesce(s.mv_storyline,'')),'') is null
      and nullif(btrim(coalesce(s.mv_production_company,'')),'') is null
      and nullif(btrim(coalesce(s.mv_agency,'')),'') is null
      and nullif(btrim(coalesce(s.mv_album_title,'')),'') is null
      and s.mv_production_date is null
      and nullif(btrim(coalesce(s.mv_distribution_company,'')),'') is null
      and nullif(btrim(coalesce(s.mv_business_reg_no,'')),'') is null
      and nullif(btrim(coalesce(s.mv_usage,'')),'') is null
      and nullif(btrim(coalesce(s.mv_desired_rating,'')),'') is null
      and nullif(btrim(coalesce(s.mv_memo,'')),'') is null
      and nullif(btrim(coalesce(s.mv_song_title,'')),'') is null
      and nullif(btrim(coalesce(s.mv_song_title_kr,'')),'') is null
      and nullif(btrim(coalesce(s.mv_song_title_en,'')),'') is null
      and nullif(btrim(coalesce(s.mv_song_title_official,'')),'') is null
      and nullif(btrim(coalesce(s.mv_composer,'')),'') is null
      and nullif(btrim(coalesce(s.mv_lyricist,'')),'') is null
      and nullif(btrim(coalesce(s.mv_arranger,'')),'') is null
      and nullif(btrim(coalesce(s.mv_song_memo,'')),'') is null
      and nullif(btrim(coalesce(s.mv_lyrics,'')),'') is null
      and coalesce(cardinality(s.mv_selected_station_codes),0)=0
      -- The authoring choice and the "files follow by email" handoff.
      and s.application_form_mode is null
      and coalesce(s.files_submitted_by_email,false)=false
      and not exists(select 1 from public.album_tracks t where t.submission_id=s.id)
      and not exists(select 1 from public.submission_files f where f.submission_id=s.id)
      and not exists(select 1 from public.submission_upload_staging u where u.submission_id=s.id)
      and not exists(select 1 from public.multipart_upload_grants g where g.submission_id=s.id)
      and not exists(select 1 from public.submission_payments p where p.submission_id=s.id)
      and not exists(select 1 from public.submission_order_items i where i.submission_id=s.id)
      and not exists(select 1 from public.station_reviews r where r.submission_id=s.id)
    order by s.created_at
    limit p_limit
    for update skip locked
  )
  delete from public.submissions s using candidates c where s.id=c.id;
  get diagnostics n=row_count;
  return query select n;
end;
$$;
revoke all on function public.purge_empty_draft_submissions(interval,integer) from public,anon,authenticated;
grant execute on function public.purge_empty_draft_submissions(interval,integer) to service_role;

-- Re-assert the hourly job under its existing name (cron.schedule replaces a
-- job of the same name); the function signature and call are unchanged.
do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('onside-purge-empty-drafts','17 * * * *','select public.purge_empty_draft_submissions()');
  end if;
end $$;
