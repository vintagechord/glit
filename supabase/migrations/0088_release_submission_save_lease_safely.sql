-- A failed save must never leave an editable submission exposed in a partial
-- lifecycle state or locked until the lease expires. The caller can release
-- only the exact random lease token it claimed, and an active payment remains
-- a hard stop.

-- Recover leases left behind by an interrupted or older application save.
-- The parent remains an editable draft; dependent rows were already protected
-- by the atomic commit transaction.
do $migration$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  update public.submissions submission
  set status = 'DRAFT',
      payment_status = 'UNPAID',
      save_lease_token = null,
      save_lease_expires_at = null
  where submission.save_lease_token is not null
    and submission.save_lease_expires_at <= clock_timestamp()
    and submission.status in ('DRAFT', 'PRE_REVIEW', 'SUBMITTED')
    and submission.payment_status = 'UNPAID'
    and not exists (
      select 1
      from public.submission_payments payment
      where payment.status = 'REQUESTED'
        and public.submission_payment_includes_submission(
          payment.submission_id,
          payment.raw_response,
          submission.id
        )
    );
end;
$migration$;

create or replace function public.release_submission_save_lease(
  p_submission_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Submission save lease release requires the service role.'
      using errcode = '42501';
  end if;
  if p_submission_id is null or p_lease_token is null then
    raise exception 'SUBMISSION_SAVE_LEASE_RELEASE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  update public.submissions submission
  set status = 'DRAFT',
      payment_status = 'UNPAID',
      save_lease_token = null,
      save_lease_expires_at = null
  where submission.id = p_submission_id
    and submission.save_lease_token = p_lease_token
    and submission.status in ('DRAFT', 'PRE_REVIEW', 'SUBMITTED')
    and submission.payment_status = 'UNPAID'
    and not exists (
      select 1
      from public.submission_payments payment
      where payment.status = 'REQUESTED'
        and public.submission_payment_includes_submission(
          payment.submission_id,
          payment.raw_response,
          p_submission_id
        )
    );

  return found;
end;
$$;

revoke all on function public.release_submission_save_lease(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_submission_save_lease(uuid, uuid)
  to service_role;
