/* Permissions are applied after the function definition so the migration
   driver's PL/pgSQL statement splitter sees the function first.
do $permissions$
begin
  execute 'revoke all on function public.delete_submission_drafts_atomic(text, uuid[], uuid, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.delete_submission_drafts_atomic(text, uuid[], uuid, jsonb) to service_role';
  execute 'comment on function public.delete_submission_drafts_atomic(text, uuid[], uuid, jsonb) is ''Locks, authorizes, expands, captures storage refs, and deletes draft bundles in one transaction.''';
end;
$permissions$;
*/

-- Payment functions call this helper from inside their row-locked
-- transaction. Lock and assert every active member of a requested album
-- bundle here so a sibling cannot appear between HTTP preflight and payment.
create or replace function public.bind_album_payment_discount_eligibility(
  p_submission_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_discounted public.submissions%rowtype;
  v_base_submission_id uuid;
begin
  perform public.assert_album_price_snapshots(p_submission_ids);

  perform sibling.id
  from public.submissions sibling
  where sibling.album_draft_group_id in (
      select distinct requested.album_draft_group_id
      from public.submissions requested
      where requested.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
        and requested.type = 'ALBUM'
        and requested.album_draft_group_id is not null
    )
    and sibling.status in ('DRAFT', 'PRE_REVIEW', 'SUBMITTED', 'WAITING_PAYMENT')
    and sibling.payment_status <> 'PAID'
  order by sibling.id
  for update;

  if exists (
    select 1
    from public.submissions sibling
    where sibling.album_draft_group_id in (
        select distinct requested.album_draft_group_id
        from public.submissions requested
        where requested.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
          and requested.type = 'ALBUM'
          and requested.album_draft_group_id is not null
      )
      and sibling.status in ('DRAFT', 'PRE_REVIEW', 'SUBMITTED', 'WAITING_PAYMENT')
      and sibling.payment_status <> 'PAID'
      and not (sibling.id = any(coalesce(p_submission_ids, '{}'::uuid[])))
  ) then
    raise exception 'ALBUM_GROUP_INCOMPLETE' using errcode = '55000';
  end if;

  for v_discounted in
    select discounted.*
    from public.submissions discounted
    where discounted.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
      and discounted.type = 'ALBUM'
      and discounted.album_price_tier = 'ADDITIONAL'
    order by discounted.id
  loop
    v_base_submission_id := null;

    select base.id
      into v_base_submission_id
    from public.submissions base
    where base.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
      and base.id <> v_discounted.id
      and base.type = 'ALBUM'
      and base.package_id is not distinct from v_discounted.package_id
      and base.is_oneclick is not distinct from v_discounted.is_oneclick
      and base.album_price_tier = 'FULL'
      and base.album_base_price_krw = v_discounted.album_base_price_krw
      and base.amount_krw = v_discounted.album_base_price_krw
      and (
        (v_discounted.user_id is not null and base.user_id = v_discounted.user_id)
        or (v_discounted.user_id is null and base.user_id is null)
      )
    order by base.id
    limit 1;

    if v_base_submission_id is null then
      select paid_base.id
        into v_base_submission_id
      from public.submissions paid_base
      where paid_base.id <> v_discounted.id
        and paid_base.type = 'ALBUM'
        and paid_base.payment_status = 'PAID'
        and paid_base.package_id is not distinct from v_discounted.package_id
        and paid_base.is_oneclick is not distinct from v_discounted.is_oneclick
        and paid_base.album_price_tier = 'FULL'
        and paid_base.album_base_price_krw = v_discounted.album_base_price_krw
        and paid_base.amount_krw = v_discounted.album_base_price_krw
        and (
          (v_discounted.user_id is not null and paid_base.user_id = v_discounted.user_id)
          or (
            v_discounted.user_id is null
            and paid_base.user_id is null
            and v_discounted.guest_token is not null
            and paid_base.guest_token = v_discounted.guest_token
          )
        )
      order by paid_base.created_at desc, paid_base.id
      limit 1;
    end if;

    if v_base_submission_id is null then
      raise exception 'ALBUM_DISCOUNT_NOT_ELIGIBLE:%', v_discounted.id
        using errcode = '55000';
    end if;

    update public.submissions submission
    set album_discount_base_submission_id = v_base_submission_id
    where submission.id = v_discounted.id
      and submission.album_discount_base_submission_id
        is distinct from v_base_submission_id;
  end loop;

  update public.submissions submission
  set album_discount_base_submission_id = null
  where submission.id = any(coalesce(p_submission_ids, '{}'::uuid[]))
    and submission.type = 'ALBUM'
    and submission.album_price_tier = 'FULL'
    and submission.album_discount_base_submission_id is not null;
end;
$function$;

do $permissions$
begin
  execute 'revoke all on function public.delete_submission_drafts_atomic(text, uuid[], uuid, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.delete_submission_drafts_atomic(text, uuid[], uuid, jsonb) to service_role';
  execute 'comment on function public.delete_submission_drafts_atomic(text, uuid[], uuid, jsonb) is ''Locks, authorizes, expands, captures storage refs, and deletes draft bundles in one transaction.''';
end;
$permissions$;
