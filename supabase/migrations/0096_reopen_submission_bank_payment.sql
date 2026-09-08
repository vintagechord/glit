-- An explicit, owner-authorized cancellation of a bank request before deposit.
-- No migration-time submission updates: existing requests remain unchanged.
create or replace function public.reopen_submission_bank_payment(
  p_submission_ids uuid[],
  p_user_id uuid,
  p_guest_tokens_by_submission_id jsonb default '{}'::jsonb
)
returns table(submission_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_submission_ids uuid[];
  v_group_ids uuid[];
begin
  if coalesce(cardinality(p_submission_ids), 0) not between 1 and 100
    or array_position(p_submission_ids, null) is not null
    or jsonb_typeof(p_guest_tokens_by_submission_id) is distinct from 'object'
  then
    raise exception 'INVALID_REOPEN_REQUEST' using errcode = '22023';
  end if;
  select array_agg(distinct requested.id order by requested.id)
    into v_submission_ids
  from unnest(p_submission_ids) as requested(id);

  select array_agg(distinct submission.album_draft_group_id)
    into v_group_ids
  from public.submissions submission
  where submission.id = any(v_submission_ids)
    and submission.type = 'ALBUM'
    and submission.album_draft_group_id is not null;

  -- Lock selected rows and their entire album groups in the same deterministic
  -- order as payment creation. Ownership/state are rechecked after waiting.
  perform submission.id
  from public.submissions submission
  where submission.id = any(v_submission_ids)
    or (submission.type = 'ALBUM'
      and submission.album_draft_group_id = any(coalesce(v_group_ids, '{}'::uuid[]))
      and submission.user_deleted_at is null)
  order by submission.id
  for update;

  if (select count(*) from public.submissions where id = any(v_submission_ids))
      <> cardinality(v_submission_ids)
  then
    raise exception 'SUBMISSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.submissions submission
    where submission.id = any(v_submission_ids)
      and (submission.user_id is distinct from p_user_id
        or (p_user_id is null and (
          nullif(submission.guest_token, '') is null
          or (p_guest_tokens_by_submission_id ->> submission.id::text)
            is distinct from submission.guest_token
        )))
  ) then
    raise exception 'SUBMISSION_OWNER_MISMATCH' using errcode = '42501';
  end if;

  -- Recompute group membership from locked rows, rather than trusting the
  -- earlier snapshot or client-supplied group IDs.
  if exists (
    select 1 from public.submissions selected
    join public.submissions member
      on member.album_draft_group_id = selected.album_draft_group_id
      and member.type = 'ALBUM'
      and member.user_deleted_at is null
    where selected.id = any(v_submission_ids)
      and selected.type = 'ALBUM'
      and not (member.id = any(v_submission_ids))
  ) then
    raise exception 'ALBUM_GROUP_INCOMPLETE' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.submissions submission
    where submission.id = any(v_submission_ids)
      and (submission.user_deleted_at is not null
        or submission.status not in ('SUBMITTED', 'WAITING_PAYMENT')
        or submission.payment_status is distinct from 'PAYMENT_PENDING'
        or submission.payment_method is distinct from 'BANK'
        or nullif(btrim(submission.result_status), '') is not null
        or submission.result_notified_at is not null)
  ) then
    raise exception 'BANK_REQUEST_NOT_REOPENABLE' using errcode = '55000';
  end if;

  -- A completed payment can never be reset even if a legacy parent row is
  -- inconsistent. Group metadata includes non-primary payment submissions.
  if exists (
    select 1 from public.submission_payments payment
    cross join unnest(v_submission_ids) as target(id)
    where payment.status in ('REQUESTED', 'APPROVED')
      and public.submission_payment_includes_submission(
        payment.submission_id, payment.raw_response, target.id
      )
  ) then
    raise exception 'PAYMENT_IN_PROGRESS_OR_APPROVED' using errcode = '55000';
  end if;
  perform review.id from public.station_reviews review
  where review.submission_id = any(v_submission_ids)
  order by review.id for update;
  if exists (
    select 1 from public.station_reviews review
    where review.submission_id = any(v_submission_ids)
      and review.status <> 'NOT_SENT'
  ) then
    raise exception 'REVIEW_ALREADY_STARTED' using errcode = '55000';
  end if;

  update public.submissions submission
  set status = 'SUBMITTED', payment_status = 'UNPAID'
  where submission.id = any(v_submission_ids);

  insert into public.submission_events (
    submission_id, actor_user_id, event_type, message
  )
  select target.id, p_user_id, 'PAYMENT_UPDATE',
    '입금 전 결제 수단 재선택을 위해 무통장 입금 신청이 취소되었습니다.'
  from unnest(v_submission_ids) as target(id);

  return query select unnest(v_submission_ids);
end;
$$;

revoke all on function public.reopen_submission_bank_payment(uuid[], uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.reopen_submission_bank_payment(uuid[], uuid, jsonb)
  to service_role;
