-- Existing suite finishes with an audit-failure fixture; restore the test table.
alter table public.submission_events drop constraint fixture_audit_failure;
do $$ begin
  if has_function_privilege('anon','public.save_station_review_results_bulk(uuid,uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.save_station_review_results_bulk(uuid,uuid,jsonb)','execute') then raise exception 'bulk RPC leaked'; end if;
  if not has_function_privilege('service_role','public.save_station_review_results_bulk(uuid,uuid,jsonb)','execute') then raise exception 'server cannot bulk save'; end if;
end $$;
set role service_role;
do $$
declare sid uuid := '55555555-5555-4555-8555-555555555555'; actor uuid := '22222222-2222-4222-8222-222222222222';
  kbs uuid := '66666666-6666-4666-8666-666666666666'; mbc uuid := '77777777-7777-4777-8777-777777777777';
  updates jsonb; saved jsonb; before_rows jsonb; before_submission jsonb; before_events integer;
begin
  select jsonb_agg(to_jsonb(r) order by station_id) into before_rows from public.station_reviews r where submission_id=sid;
  select to_jsonb(s) into before_submission from public.submissions s where id=sid;
  select count(*) into before_events from public.submission_events;
  select jsonb_agg(jsonb_build_object('stationId',station_id,'expectedUpdatedAt',updated_at,'status','SENT','resultNote',result_note,'trackResults','[]'::jsonb,'ageRating',null) order by station_id)
    into updates from public.station_reviews where submission_id=sid and station_id in(kbs,mbc);
  -- First row would change; stale second row must roll back it, aggregate and audit.
  begin
    perform public.save_station_review_results_bulk(sid,actor,jsonb_set(updates,'{1,expectedUpdatedAt}','null'));
    raise exception 'stale second row accepted';
  exception when others then if sqlerrm <> 'REVIEW_CONFLICT' then raise; end if; end;
  if (select jsonb_agg(to_jsonb(r) order by station_id) from public.station_reviews r where submission_id=sid) is distinct from before_rows then raise exception 'partial bulk write survived'; end if;
  if (select to_jsonb(s) from public.submissions s where id=sid) is distinct from before_submission or (select count(*) from public.submission_events) <> before_events then raise exception 'bulk failure changed parent or audit'; end if;
  saved := public.save_station_review_results_bulk(sid,actor,updates);
  if saved->>'savedCount'<>'2' or saved->>'changed'<>'true' then raise exception 'bulk success missing'; end if;
  if exists(select 1 from public.station_reviews where submission_id=sid and station_id in(kbs,mbc) and (status<>'SENT' or age_rating is not null)) then raise exception 'bulk result incorrect'; end if;
  begin
    perform public.save_station_review_results_bulk(sid,actor,jsonb_build_array(updates->0,updates->0));
    raise exception 'duplicate accepted';
  exception when others then if sqlerrm <> 'REVIEW_BULK_INVALID' then raise; end if; end;
  begin
    perform public.save_station_review_results_bulk(sid,'33333333-3333-4333-8333-333333333333',updates);
    raise exception 'nonadministrator accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
