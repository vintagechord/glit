-- Keep multi-album draft membership, payment entry, and deletion atomic.
-- Application-side preflight remains useful for friendly errors, but the
-- database is the final authority for concurrent tabs and requests.

create or replace function public.validate_album_draft_group_binding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_base public.submissions%rowtype;
begin
  if new.album_draft_group_id is null then
    return new;
  end if;

  if new.type <> 'ALBUM' then
    raise exception 'ALBUM_DRAFT_GROUP_TYPE_INVALID' using errcode = '23514';
  end if;

  -- The base row binds itself on its first atomic save. Its OLD database row
  -- is still the blank draft, so validate the complete NEW image directly;
  -- the row-level UPDATE already owns the required lock.
  if new.id = new.album_draft_group_id then
    if new.album_price_tier <> 'FULL'
      or new.status not in ('DRAFT', 'PRE_REVIEW', 'SUBMITTED')
      or new.payment_status <> 'UNPAID'
      or new.package_id is null
      or new.album_base_price_krw is null
      or new.album_base_price_krw <= 0
    then
      raise exception 'ALBUM_DRAFT_GROUP_BASE_INVALID' using errcode = '55000';
    end if;
    return new;
  end if;

  select base.*
    into v_base
  from public.submissions base
  where base.id = new.album_draft_group_id
  for update;

  if not found
    or v_base.type <> 'ALBUM'
    or v_base.album_price_tier <> 'FULL'
    or v_base.user_id is distinct from new.user_id
    or v_base.status not in ('DRAFT', 'PRE_REVIEW', 'SUBMITTED')
    or v_base.payment_status <> 'UNPAID'
    or v_base.package_id is distinct from new.package_id
    or v_base.is_oneclick is distinct from new.is_oneclick
    or v_base.album_base_price_krw is distinct from new.album_base_price_krw
    or v_base.album_draft_group_id not in (v_base.id)
  then
    raise exception 'ALBUM_DRAFT_GROUP_BASE_INVALID' using errcode = '55000';
  end if;

  if new.album_price_tier <> 'ADDITIONAL' then
    raise exception 'ALBUM_DRAFT_GROUP_TIER_INVALID' using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_album_draft_group_binding()
  from public, anon, authenticated;

drop trigger if exists submissions_validate_album_draft_group_binding
  on public.submissions;
create trigger submissions_validate_album_draft_group_binding
before insert or update of album_draft_group_id, package_id, is_oneclick,
  album_base_price_krw, album_price_tier, user_id
on public.submissions
for each row
when (new.album_draft_group_id is not null)
execute function public.validate_album_draft_group_binding();

create or replace function public.delete_submission_drafts_atomic(
  p_type text,
  p_requested_ids uuid[],
  p_user_id uuid,
  p_guest_tokens_by_submission_id jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_requested_ids uuid[];
  v_delete_ids uuid[] := '{}'::uuid[];
  v_group_ids uuid[] := '{}'::uuid[];
  v_deleted_ids uuid[] := '{}'::uuid[];
  v_requested_count integer := 0;
  v_row record;
  v_refs jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'DRAFT_DELETE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_type not in ('ALBUM', 'MV') then
    raise exception 'DRAFT_DELETE_TYPE_INVALID' using errcode = '22023';
  end if;

  select coalesce(array_agg(requested.id order by requested.id), '{}'::uuid[])
    into v_requested_ids
  from (
    select distinct id
    from unnest(coalesce(p_requested_ids, '{}'::uuid[])) as input(id)
    where id is not null
  ) requested;

  if cardinality(v_requested_ids) = 0 or cardinality(v_requested_ids) > 100 then
    raise exception 'DRAFT_DELETE_COUNT_INVALID' using errcode = '22023';
  end if;

  -- Lock and authorize every explicitly requested row before expanding a
  -- FULL album row to its protected bundle.
  for v_row in
    select submission.*
    from public.submissions submission
    where submission.id = any(v_requested_ids)
    order by submission.id
    for update
  loop
    v_requested_count := v_requested_count + 1;
    if (p_type = 'ALBUM' and v_row.type <> 'ALBUM')
      or (p_type = 'MV' and v_row.type not in ('MV_DISTRIBUTION', 'MV_BROADCAST'))
      or v_row.status not in ('DRAFT', 'PRE_REVIEW')
      or v_row.payment_status <> 'UNPAID'
    then
      raise exception 'DRAFT_DELETE_NOT_EDITABLE' using errcode = '55000';
    end if;

    if p_user_id is not null then
      if v_row.user_id is distinct from p_user_id then
        raise exception 'DRAFT_DELETE_OWNER_MISMATCH' using errcode = '42501';
      end if;
    elsif v_row.user_id is not null
      or coalesce(p_guest_tokens_by_submission_id ->> v_row.id::text, '')
        is distinct from coalesce(v_row.guest_token, '')
    then
      raise exception 'DRAFT_DELETE_OWNER_MISMATCH' using errcode = '42501';
    end if;

    v_delete_ids := array_append(v_delete_ids, v_row.id);
    if p_type = 'ALBUM'
      and v_row.album_price_tier = 'FULL'
      and v_row.album_draft_group_id is not null
    then
      v_group_ids := array_append(v_group_ids, v_row.album_draft_group_id);
    end if;
  end loop;

  if v_requested_count <> cardinality(v_requested_ids) then
    raise exception 'DRAFT_DELETE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if cardinality(v_group_ids) > 0 then
    for v_row in
      select submission.*
      from public.submissions submission
      where submission.type = 'ALBUM'
        and submission.album_draft_group_id = any(v_group_ids)
      order by submission.id
      for update
    loop
      if v_row.status not in ('DRAFT', 'PRE_REVIEW')
        or v_row.payment_status <> 'UNPAID'
        or (
          p_user_id is not null
          and v_row.user_id is distinct from p_user_id
        )
        or (
          p_user_id is null
          and v_row.user_id is not null
        )
      then
        raise exception 'DRAFT_DELETE_BUNDLE_NOT_EDITABLE' using errcode = '55000';
      end if;
      if not (v_row.id = any(v_delete_ids)) then
        v_delete_ids := array_append(v_delete_ids, v_row.id);
      end if;
    end loop;
  end if;

  if cardinality(v_delete_ids) > 100 then
    raise exception 'DRAFT_DELETE_COUNT_INVALID' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(distinct source.ref), '[]'::jsonb)
    into v_refs
  from (
    select jsonb_build_object(
      'submissionId', live.submission_id::text,
      'objectKey', coalesce(nullif(live.object_key, ''), live.file_path)
    ) as ref
    from public.submission_files live
    where live.submission_id = any(v_delete_ids)
      and lower(coalesce(live.storage_provider, '')) = 'b2'
      and coalesce(nullif(live.object_key, ''), live.file_path) <> ''
    union all
    select jsonb_build_object(
      'submissionId', staged.submission_id::text,
      'objectKey', coalesce(nullif(staged.object_key, ''), staged.file_path)
    ) as ref
    from public.submission_upload_staging staged
    where staged.submission_id = any(v_delete_ids)
      and lower(coalesce(staged.storage_provider, '')) = 'b2'
      and coalesce(nullif(staged.object_key, ''), staged.file_path) <> ''
  ) source;

  with deleted as (
    delete from public.submissions submission
    where submission.id = any(v_delete_ids)
    returning submission.id
  )
  select coalesce(array_agg(deleted.id order by deleted.id), '{}'::uuid[])
    into v_deleted_ids
  from deleted;

  if cardinality(v_deleted_ids) <> cardinality(v_delete_ids) then
    raise exception 'DRAFT_DELETE_VERSION_CHANGED' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'deletedIds', to_jsonb(v_deleted_ids),
    'b2ObjectRefs', v_refs
  );
end;
$function$;

/* Remaining permission and payment-function statements are applied by 0093.
   Keeping this historical draft below commented documents the complete
   transaction contract without asking the migration driver to prepare two
   PL/pgSQL definitions as one statement.

revoke all on function public.delete_submission_drafts_atomic(
  text, uuid[], uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.delete_submission_drafts_atomic(
  text, uuid[], uuid, jsonb
) to service_role;

-- Payment functions already call this helper inside their row-locked
-- transaction. Lock and assert all active members of every requested album
-- bundle here so a sibling cannot be attached between HTTP preflight and the
-- final payment transition.
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

revoke all on function public.bind_album_payment_discount_eligibility(uuid[])
  from public, anon, authenticated;
grant execute on function public.bind_album_payment_discount_eligibility(uuid[])
  to service_role;

comment on function public.delete_submission_drafts_atomic(text, uuid[], uuid, jsonb)
  is 'Locks, authorizes, expands, captures storage refs, and deletes draft bundles in one transaction.';
*/
