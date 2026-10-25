-- Commit all selected broadcaster changes together, retaining per-row revision checks.
-- Existing station transaction validates requested stations, track ownership, WBS scope,
-- ratings and actor role; a failure anywhere rolls back this entire call.
create function public.save_station_review_results_bulk(
  p_submission_id uuid, p_actor_user_id uuid, p_updates jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  entry jsonb;
  saved jsonb;
  changed boolean := false;
  s public.submissions%rowtype;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  if p_updates is null or jsonb_typeof(p_updates)<>'array' or jsonb_array_length(p_updates) not between 1 and 50 then
    raise exception 'REVIEW_BULK_INVALID';
  end if;
  if exists(select 1 from jsonb_array_elements(p_updates) u where jsonb_typeof(u)<>'object' or coalesce(u->>'stationId','')='')
    or (select count(distinct u->>'stationId') from jsonb_array_elements(p_updates) u)<>jsonb_array_length(p_updates) then
    raise exception 'REVIEW_BULK_INVALID';
  end if;
  select * into s from public.submissions where id=p_submission_id for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  for entry in select value from jsonb_array_elements(p_updates) order by value->>'stationId' loop
    saved := public.save_station_review_result(
      p_submission_id, (entry->>'stationId')::uuid, p_actor_user_id,
      (entry->>'expectedUpdatedAt')::timestamptz, entry->>'status',
      entry->>'resultNote', coalesce(entry->'trackResults','[]'::jsonb), entry->>'ageRating'
    );
    changed := changed or coalesce((saved->>'changed')::boolean,false);
  end loop;
  select * into s from public.submissions where id=p_submission_id;
  return jsonb_build_object('completed',true,'changed',changed,'savedCount',jsonb_array_length(p_updates),'submissionStatus',s.status,'resultStatus',s.result_status);
end;
$$;
revoke all on function public.save_station_review_results_bulk(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_station_review_results_bulk(uuid,uuid,jsonb) to service_role;

create or replace function public.review_desk_protocol_status() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('protocol',2,'bulkStationResults',true) $$;
revoke all on function public.review_desk_protocol_status() from public,anon,authenticated;
grant execute on function public.review_desk_protocol_status() to service_role;
