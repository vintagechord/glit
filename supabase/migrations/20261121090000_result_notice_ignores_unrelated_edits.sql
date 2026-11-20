-- A result mail accepted after an unrelated edit of the application never
-- marked the result notified. finish_email_outbox compared the submission's
-- updated_at, which every update bumps, with the time the mail was queued:
-- correcting a bounced recipient address and pressing 재발송 left the album in
-- 결과 안내 대기 for good (and its 7-day customer-file retention never started),
-- as did an album-info sync or a review-document save while the mail waited.
--
-- The guard exists so that a mail about an older result never marks a newer
-- one notified. It now compares the result itself: a fingerprint of the
-- submission's result fields and of every station result, taken when the
-- mail is queued and again when it is accepted. Mail queued before this
-- migration has no fingerprint and keeps the old updated_at rule.

create or replace function public.submission_result_fingerprint(p_submission_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select md5(jsonb_build_array(
    s.status, s.result_status, s.result_memo, s.mv_rating, s.mv_desired_rating,
    s.certificate_b2_path, s.mv_certificate_object_key,
    coalesce((
      select jsonb_agg(
        jsonb_build_array(r.station_id, r.status, r.result_note, r.track_results_json, r.age_rating)
        order by r.station_id, r.id)
      from public.station_reviews r
      where r.submission_id = s.id
    ), '[]'::jsonb)
  )::text)
  from public.submissions s
  where s.id = p_submission_id
$$;

revoke all on function public.submission_result_fingerprint(uuid) from public, anon, authenticated;
grant execute on function public.submission_result_fingerprint(uuid) to service_role;

alter table public.email_outbox add column if not exists result_fingerprint text;

comment on column public.email_outbox.result_fingerprint is
  'submission_result_fingerprint() when a result-announcing mail was queued; acceptance marks the result notified only while it still matches.';

create or replace function public.capture_email_outbox_result_fingerprint()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.result_fingerprint := case
    when new.mark_result_notified and new.submission_id is not null
      then public.submission_result_fingerprint(new.submission_id)
  end;
  return new;
end $$;

revoke all on function public.capture_email_outbox_result_fingerprint() from public, anon, authenticated;

drop trigger if exists capture_email_outbox_result_fingerprint on public.email_outbox;
create trigger capture_email_outbox_result_fingerprint
  before insert on public.email_outbox
  for each row execute function public.capture_email_outbox_result_fingerprint();

-- Identical to 20261024175001 except for the result-notice condition.
create or replace function public.finish_email_outbox(
  p_id uuid, p_lease_token uuid, p_outcome text, p_message_id text default null,
  p_error_reason text default null, p_error_code text default null, p_retry_after_seconds integer default null
) returns setof public.email_outbox language plpgsql security invoker set search_path = '' as $$
declare item public.email_outbox; next_status text; delay_seconds integer;
begin
  if p_outcome not in ('accepted','retry','uncertain','failed') then
    raise exception using errcode='22023', message='Invalid email outcome';
  end if;
  select * into item from public.email_outbox e where e.id=p_id and e.status='sending'
    and e.lease_token=p_lease_token for update;
  if not found then return; end if;
  next_status := p_outcome;
  if p_outcome='retry' and item.attempt_count >= item.max_attempts then next_status := 'failed'; end if;
  if p_outcome <> 'accepted' and item.expires_at <= now() then next_status := 'expired'; end if;
  if p_outcome='accepted' and item.mark_result_notified and item.submission_id is not null then
    update public.submissions s set result_notified_at=now()
      where s.id=item.submission_id
        and case
          when item.result_fingerprint is null then s.updated_at <= item.created_at
          else public.submission_result_fingerprint(s.id) = item.result_fingerprint
        end;
  end if;
  delay_seconds := least(3600, greatest(30 * power(2, least(item.attempt_count-1,7))::integer,
    least(greatest(coalesce(p_retry_after_seconds,0),0),3600)));
  return query update public.email_outbox e set
    status=next_status,
    html=case when next_status in ('accepted','expired') then null else e.html end,
    provider_message_id=case when p_message_id ~ '^[A-Za-z0-9_-]{1,128}$' then p_message_id else null end,
    last_error_reason=case when p_outcome='accepted' then null else p_error_reason end,
    last_error_code=case when p_outcome='accepted' then null else p_error_code end,
    accepted_at=case when p_outcome='accepted' then now() else e.accepted_at end,
    next_attempt_at=case when next_status='retry' then now()+make_interval(secs=>delay_seconds) else e.next_attempt_at end,
    lease_token=null, lease_expires_at=null, updated_at=now()
    where e.id=item.id returning e.*;
end $$;
