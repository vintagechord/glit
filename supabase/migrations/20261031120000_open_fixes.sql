-- Open-day fixes (2026-10-31):
-- 1. A card approval claim that lost its process is converted to the existing
--    reconciliation state instead of staying locked forever.
-- 2. Bank-transfer orders record the depositor name and the customer's
--    expected deposit date.
-- 3. Guest drafts written before login can be adopted by the account that
--    presents the exact guest tokens from that browser.
-- 4. Empty draft shells left by abandoned visits are purged on a schedule.

-- 1. Stale approval claims -----------------------------------------------------
alter table public.submission_payments add column if not exists approval_claimed_at timestamptz;

create or replace function public.claim_inicis_submission_approval(p_order_id text,p_callback_state text)
returns table(already_approved boolean,already_processing boolean)
language plpgsql security invoker set search_path=public as $$
declare p public.submission_payments%rowtype;
begin
  select * into p from public.submission_payments where order_id=p_order_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if coalesce(p.provider,'inicis')<>'inicis' or length(coalesce(p_callback_state,''))<32
    or (p.raw_response->>'closeState') is distinct from p_callback_state
  then raise exception 'CALLBACK_STATE_INVALID' using errcode='42501'; end if;
  if p.status='APPROVED' then return query select true,false; return; end if;
  if p.status<>'REQUESTED' then raise exception 'PAYMENT_TERMINAL_STATE' using errcode='55000'; end if;
  if p.result_code in ('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN') then
    return query select false,true; return;
  end if;
  if not exists(select 1 from public.submission_orders o where o.id=p.checkout_order_id
      and o.payment_method='CARD' and o.status='CARD_PENDING' and o.amount_krw=p.amount_krw)
    or not exists(select 1 from public.submission_order_items i where i.order_id=p.checkout_order_id)
    or exists(select 1 from public.submission_order_items i left join public.submissions s on s.id=i.submission_id
      where i.order_id=p.checkout_order_id and (s.id is null or s.current_order_id is distinct from p.checkout_order_id
        or s.payment_status is distinct from 'PAYMENT_PENDING' or s.status not in ('SUBMITTED','WAITING_PAYMENT')
        or s.user_deleted_at is not null or nullif(btrim(s.result_status),'') is not null or s.result_notified_at is not null))
    or exists(select 1 from public.submission_order_items i join public.station_reviews r on r.submission_id=i.submission_id
      where i.order_id=p.checkout_order_id and r.status<>'NOT_SENT')
  then raise exception 'CHECKOUT_ORDER_NOT_ACTIVE' using errcode='55000'; end if;
  update public.submission_payments set result_code='APPROVAL_IN_PROGRESS',
    result_message='Inicis approval is being confirmed.', approval_claimed_at=now() where id=p.id;
  return query select false,false;
end;
$$;

-- The gateway request behind a claim finishes within its 15 second timeout.
-- A claim still open after p_max_age belongs to a process that died, so the
-- outcome is unknown: hand it to the operator reconciliation path (never to
-- FAILED, because elapsed time is not proof that no charge happened). The
-- existing order projection trigger moves the order to REVIEW_REQUIRED.
create or replace function public.expire_stale_inicis_approval_claims(p_max_age interval default interval '10 minutes')
returns table(order_id text)
language plpgsql security invoker set search_path=public as $$
begin
  if p_max_age < interval '2 minutes' then raise exception 'STALE_CLAIM_AGE_TOO_SHORT' using errcode='22023'; end if;
  return query
  with stale as (
    select p.id from public.submission_payments p
    where p.status='REQUESTED' and p.result_code='APPROVAL_IN_PROGRESS'
      and coalesce(p.provider,'inicis')='inicis'
      and coalesce(p.approval_claimed_at,p.updated_at,p.created_at) < now()-p_max_age
    order by p.id
    for update skip locked
  ), expired as (
    update public.submission_payments p
    set result_code='APPROVAL_UNCERTAIN',
        result_message='승인 확인 처리가 중단되었습니다. 이니시스 거래 내역과 대조한 뒤 승인·미승인을 기록해주세요.',
        raw_response=public.merge_submission_payment_raw_response(p.raw_response,
          jsonb_build_object('staleClaim',jsonb_build_object('expiredAt',now(),'claimedAt',p.approval_claimed_at)))
    from stale where p.id=stale.id
    returning p.order_id
  )
  select expired.order_id from expired;
end;
$$;
revoke all on function public.expire_stale_inicis_approval_claims(interval) from public,anon,authenticated;
grant execute on function public.expire_stale_inicis_approval_claims(interval) to service_role;

-- 2. Bank transfer details -----------------------------------------------------
alter table public.submission_orders
  add column if not exists depositor_name text,
  add column if not exists deposit_due_at timestamptz;

create or replace function public.begin_submission_bank_payment(p_submission_ids uuid[],p_user_id uuid,p_depositor_name text,p_deposit_due_at timestamptz)
returns table(submission_id uuid) language plpgsql security invoker set search_path=public as $$
declare oid uuid; depositor text := nullif(btrim(coalesce(p_depositor_name,'')),'');
begin
  if depositor is null or length(depositor)>40 or p_deposit_due_at is null
    or p_deposit_due_at < now()-interval '1 day' or p_deposit_due_at > now()+interval '31 days' then
    raise exception 'INVALID_BANK_ORDER_DETAILS' using errcode='22023'; end if;
  oid := public.create_submission_checkout_order(p_submission_ids,p_user_id,'BANK');
  update public.submission_orders set depositor_name=depositor,deposit_due_at=p_deposit_due_at,updated_at=now() where id=oid;
  return query select * from public.begin_submission_bank_payment_v96(p_submission_ids,p_user_id);
end;
$$;
revoke all on function public.begin_submission_bank_payment(uuid[],uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.begin_submission_bank_payment(uuid[],uuid,text,timestamptz) to service_role;

-- 3. Guest draft adoption ------------------------------------------------------
-- Only unpaid, unordered drafts still owned by nobody move. Album bundles are
-- re-pointed base row first so the group binding trigger sees a matching owner.
create or replace function public.claim_guest_draft_submissions(p_user_id uuid,p_guest_tokens text[])
returns table(submission_id uuid) language plpgsql security invoker set search_path=public as $$
declare tokens text[]; ids uuid[];
begin
  if p_user_id is null then raise exception 'USER_REQUIRED' using errcode='22023'; end if;
  select array_agg(distinct t) into tokens from unnest(coalesce(p_guest_tokens,'{}'::text[])) t
    where t is not null and length(t) between 8 and 120 and t !~ '[[:cntrl:]]';
  if coalesce(cardinality(tokens),0)=0 or cardinality(tokens)>100 then return; end if;
  perform s.id from public.submissions s
    where s.user_id is null and s.guest_token=any(tokens) and s.status in ('DRAFT','PRE_REVIEW')
      and s.payment_status='UNPAID' and s.current_order_id is null and s.user_deleted_at is null
    order by s.id for update;
  select array_agg(s.id order by s.id) into ids from public.submissions s
    where s.user_id is null and s.guest_token=any(tokens) and s.status in ('DRAFT','PRE_REVIEW')
      and s.payment_status='UNPAID' and s.current_order_id is null and s.user_deleted_at is null
      and s.save_lease_token is null;
  if coalesce(cardinality(ids),0)=0 then return; end if;
  update public.submissions set user_id=p_user_id,guest_token=null
    where id=any(ids) and (album_draft_group_id is null or album_draft_group_id=id or coalesce(album_price_tier,'FULL')='FULL');
  update public.submissions set user_id=p_user_id,guest_token=null where id=any(ids) and user_id is null;
  insert into public.submission_events(submission_id,actor_user_id,event_type,message)
  select x,p_user_id,'OWNER_CLAIM','비회원으로 작성 중이던 신청서를 로그인 계정에 연결했습니다.' from unnest(ids) x;
  return query select unnest(ids);
end;
$$;
revoke all on function public.claim_guest_draft_submissions(uuid,text[]) from public,anon,authenticated;
grant execute on function public.claim_guest_draft_submissions(uuid,text[]) to service_role;

-- 4. Empty draft purge ---------------------------------------------------------
-- A draft row with no customer content, files, uploads, tracks, payment or
-- order after p_min_age is a shell left by an abandoned visit. Anything the
-- customer typed or uploaded keeps the row. Dependent rows cascade (0071).
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
      and not exists(select 1 from public.album_tracks t where t.submission_id=s.id)
      and not exists(select 1 from public.submission_files f where f.submission_id=s.id)
      and not exists(select 1 from public.submission_upload_staging u where u.submission_id=s.id)
      and not exists(select 1 from public.multipart_upload_grants g where g.submission_id=s.id)
      and not exists(select 1 from public.submission_payments p where p.submission_id=s.id)
      and not exists(select 1 from public.submission_order_items i where i.submission_id=s.id)
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

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('onside-stale-approval-claims','*/5 * * * *','select public.expire_stale_inicis_approval_claims()');
    perform cron.schedule('onside-purge-empty-drafts','17 * * * *','select public.purge_empty_draft_submissions()');
  end if;
end $$;
