-- Atomically transfer verified guest cart submissions to a signed-in member.
-- The public API calls this with the service-role client only after authenticating
-- the destination member. Every id/token pair must still match while rows are
-- locked or the entire claim is rolled back.
create or replace function public.claim_guest_cart_submissions(
  p_user_id uuid,
  p_entries jsonb
)
returns table (submission_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  expected_count integer;
  matched_count integer;
  claim_ids uuid[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Guest cart claim requires the service role.'
      using errcode = '42501';
  end if;

  if p_user_id is null or jsonb_typeof(p_entries) is distinct from 'object' then
    raise exception 'Invalid guest cart claim payload.'
      using errcode = '22023';
  end if;

  select count(*)
  into expected_count
  from jsonb_object_keys(p_entries);
  if expected_count < 1 or expected_count > 100 then
    raise exception 'Guest cart claim must contain between 1 and 100 entries.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each_text(p_entries) as entry
    where entry.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or length(btrim(entry.value)) < 8
      or length(btrim(entry.value)) > 120
  ) then
    raise exception 'Invalid guest cart claim entry.'
      using errcode = '22023';
  end if;

  select array_agg(entry.key::uuid order by entry.key::uuid)
  into claim_ids
  from jsonb_each_text(p_entries) as entry;

  perform submission.id
  from public.submissions as submission
  join jsonb_each_text(p_entries) as entry
    on submission.id = entry.key::uuid
   and submission.guest_token = entry.value
  where submission.user_id is null
    and submission.user_deleted_at is null
    and submission.status in ('SUBMITTED', 'WAITING_PAYMENT')
    and (
      submission.payment_status is null
      or submission.payment_status in ('UNPAID', 'PAYMENT_PENDING')
    )
  for update of submission;
  get diagnostics matched_count = row_count;

  if matched_count <> expected_count then
    raise exception 'One or more guest cart entries are no longer claimable.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.submission_payments as payment
    where payment.status = 'REQUESTED'
      and (
        payment.submission_id = any(claim_ids)
        or exists (
          select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(payment.raw_response #> '{paymentGroup,submissionIds}') = 'array'
                then payment.raw_response #> '{paymentGroup,submissionIds}'
              else '[]'::jsonb
            end
          ) as grouped(value)
          where grouped.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and grouped.value::uuid = any(claim_ids)
        )
        or exists (
          select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(payment.raw_response #> '{paymentGroup,relatedSubmissionIds}') = 'array'
                then payment.raw_response #> '{paymentGroup,relatedSubmissionIds}'
              else '[]'::jsonb
            end
          ) as related(value)
          where related.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and related.value::uuid = any(claim_ids)
        )
      )
  ) then
    raise exception 'PAYMENT_IN_PROGRESS'
      using errcode = '55000';
  end if;

  return query
  update public.submissions as submission
  set user_id = p_user_id,
      guest_token = null,
      updated_at = now()
  from jsonb_each_text(p_entries) as entry
  where submission.id = entry.key::uuid
    and submission.guest_token = entry.value
    and submission.user_id is null
    and submission.user_deleted_at is null
    and submission.status in ('SUBMITTED', 'WAITING_PAYMENT')
    and (
      submission.payment_status is null
      or submission.payment_status in ('UNPAID', 'PAYMENT_PENDING')
    )
  returning submission.id;
end;
$$;

revoke all on function public.claim_guest_cart_submissions(uuid, jsonb) from public;
revoke all on function public.claim_guest_cart_submissions(uuid, jsonb) from anon;
revoke all on function public.claim_guest_cart_submissions(uuid, jsonb) from authenticated;
grant execute on function public.claim_guest_cart_submissions(uuid, jsonb) to service_role;
