-- Order money integrity (audit 2026-11-03):
-- 1. Deleted payment attempts are archived, so an administrator deleting a
--    refunded test order keeps the card approval record (TID, paid_at, audit).
-- 2. A card approval that lands after its stale claim was handed to
--    reconciliation moves the order to PAID instead of stranding it in
--    REVIEW_REQUIRED, and only a claimed attempt can be approved.
-- 3. Administrator memos stay out of the customer-visible order note. Orders
--    get fixed notices; the free text is appended to the admin memo (with the
--    date) instead of overwriting earlier memos.
-- 4. Refunds and administrator deletion close cash-receipt requests that were
--    not issued. Issued receipts are left for the Hometax cancellation, which
--    the admin cash-receipt view now lists.

-- 1. Payment archive -------------------------------------------------------------
-- submission_payments.submission_id cascades on delete (0071). The archive
-- keeps a copy of every deleted attempt. Only the service role reads it and
-- nobody can change it; the trigger below is its only writer.
create table if not exists public.submission_payment_archive (
  payment_id uuid primary key,
  order_id text not null,
  submission_id uuid,
  checkout_order_id uuid,
  user_id uuid,
  provider text,
  status text not null,
  amount_krw integer,
  amount numeric(12,2),
  currency text,
  pg_tid text,
  paypal_capture_id text,
  result_code text,
  result_message text,
  paid_at timestamptz,
  payment_created_at timestamptz,
  payment_updated_at timestamptz,
  payment_row jsonb not null,
  archived_at timestamptz not null default now()
);
create index if not exists submission_payment_archive_checkout_order_idx
  on public.submission_payment_archive(checkout_order_id);
create index if not exists submission_payment_archive_archived_idx
  on public.submission_payment_archive(archived_at desc);
alter table public.submission_payment_archive enable row level security;
revoke all on public.submission_payment_archive from public, anon, authenticated, service_role;
grant select on public.submission_payment_archive to service_role;

create or replace function public.archive_deleted_submission_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.submission_payment_archive(
    payment_id, order_id, submission_id, checkout_order_id, user_id, provider, status,
    amount_krw, amount, currency, pg_tid, paypal_capture_id, result_code, result_message,
    paid_at, payment_created_at, payment_updated_at, payment_row
  ) values (
    old.id, old.order_id, old.submission_id, old.checkout_order_id, old.user_id, old.provider, old.status::text,
    old.amount_krw, old.amount, old.currency, old.pg_tid, old.paypal_capture_id, old.result_code, old.result_message,
    old.paid_at, old.created_at, old.updated_at, to_jsonb(old)
  ) on conflict (payment_id) do nothing;
  return old;
end $$;
revoke all on function public.archive_deleted_submission_payment() from public, anon, authenticated;
drop trigger if exists archive_deleted_submission_payment on public.submission_payments;
create trigger archive_deleted_submission_payment before delete on public.submission_payments
  for each row execute function public.archive_deleted_submission_payment();

-- 2. Card approval ---------------------------------------------------------------
-- Latest definition: 20261023212202_payment_pre_review.sql. Changes: an
-- unapproved attempt must hold an approval claim (APPROVAL_IN_PROGRESS), be
-- the stale claim expire_stale_inicis_approval_claims handed over
-- (APPROVAL_UNCERTAIN), or be released by resolve_uncertain_submission_payment
-- (ADMIN_RECONCILED). When the stale claim's own approval arrives late, the
-- order it moved to REVIEW_REQUIRED becomes PAID together with the attempt;
-- the projection trigger deliberately skips REVIEW_REQUIRED orders.
create or replace function public.approve_submission_payment_order(
  p_order_id text,
  p_pg_tid text,
  p_result_code text,
  p_result_message text,
  p_raw_response jsonb,
  p_paid_at timestamptz
)
returns table(
  primary_submission_id uuid,
  submission_ids uuid[],
  already_approved boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.submission_payments%rowtype;
  v_submission_ids uuid[];
  v_submission_count integer;
  v_amount_krw bigint;
  v_already_approved boolean;
begin
  select *
    into v_payment
  from public.submission_payments payment
  where payment.order_id = p_order_id
  for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  -- Only Inicis orders may enter the domestic approval path. Legacy card
  -- rows created before provider tagging have NULL here and remain valid.
  if lower(coalesce(v_payment.provider, 'inicis')) <> 'inicis'
  then
    raise exception 'PAYMENT_PROVIDER_MISMATCH'
      using errcode = '22000';
  end if;

  if v_payment.status not in ('REQUESTED', 'APPROVED') then
    raise exception 'PAYMENT_TERMINAL_STATE'
      using errcode = '55000';
  end if;

  v_already_approved := v_payment.status = 'APPROVED';
  if not v_already_approved
    and v_payment.result_code is distinct from 'APPROVAL_IN_PROGRESS'
    and v_payment.result_code is distinct from 'APPROVAL_UNCERTAIN'
    and v_payment.result_code is distinct from 'ADMIN_RECONCILED'
  then
    raise exception 'PAYMENT_APPROVAL_NOT_CLAIMED'
      using errcode = '55000';
  end if;
  v_submission_ids := public.submission_payment_group_ids(
    v_payment.submission_id,
    v_payment.raw_response
  );

  perform submission.id
  from public.submissions submission
  where submission.id = any(v_submission_ids)
  order by submission.id
  for update;

  select count(*), coalesce(sum(submission.amount_krw), 0)
    into v_submission_count, v_amount_krw
  from public.submissions submission
  where submission.id = any(v_submission_ids);

  if v_submission_count <> cardinality(v_submission_ids) then
    raise exception 'PAYMENT_SUBMISSION_MISSING'
      using errcode = '55000';
  end if;

  if v_amount_krw <> v_payment.amount_krw then
    raise exception 'PAYMENT_AMOUNT_MISMATCH'
      using errcode = '22000';
  end if;

  if not v_already_approved then
    update public.submission_payments payment
    set status = 'APPROVED',
        pg_tid = p_pg_tid,
        result_code = p_result_code,
        result_message = p_result_message,
        raw_response = public.merge_submission_payment_raw_response(
          v_payment.raw_response,
          p_raw_response
        ),
        paid_at = coalesce(p_paid_at, now())
    where payment.id = v_payment.id
      and payment.status = 'REQUESTED';

    if not found then
      raise exception 'PAYMENT_STATE_CHANGED'
        using errcode = '40001';
    end if;
  end if;

  update public.submissions submission
  set payment_status = 'PAID',
      payment_method = 'CARD',
      status = case
        when not v_already_approved and submission.status in ('DRAFT', 'WAITING_PAYMENT', 'SUBMITTED')
          then 'PRE_REVIEW'::submission_status
        else submission.status
      end
  where submission.id = any(v_submission_ids);

  -- The stale claim's approval: the projection trigger left the order in
  -- REVIEW_REQUIRED, while the attempt and every item are now paid.
  if not v_already_approved and v_payment.result_code = 'APPROVAL_UNCERTAIN'
    and v_payment.checkout_order_id is not null
  then
    update public.submission_orders o
    set status = 'PAID', paid_at = coalesce(p_paid_at, now()), updated_at = now()
    where o.id = v_payment.checkout_order_id and o.status = 'REVIEW_REQUIRED';
  end if;

  insert into public.submission_events (submission_id, event_type, message)
  select submission_id, 'PAYMENT', 'KG이니시스 카드 결제 완료'
  from unnest(v_submission_ids) as target(submission_id)
  where not exists (
    select 1
    from public.submission_events event
    where event.submission_id = target.submission_id
      and event.event_type = 'PAYMENT'
      and event.message = 'KG이니시스 카드 결제 완료'
  );

  return query
  select v_payment.submission_id, v_submission_ids, v_already_approved;
end;
$$;

revoke all on function public.approve_submission_payment_order(
  text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.approve_submission_payment_order(
  text, text, text, text, jsonb, timestamptz
) to service_role;

-- 3. Administrator memos ---------------------------------------------------------
-- Bank deposit confirmation. Latest definition: 20261023212202. The memo is
-- appended to each item's admin memo once instead of replacing every item's
-- memo with the edited item's text.
create or replace function public.confirm_submission_order_bank_payment(p_order_id uuid,p_actor_user_id uuid,p_admin_memo text default null)
returns table(submission_id uuid) language plpgsql security invoker set search_path=public as $$
declare o public.submission_orders%rowtype; ids uuid[]; memo_text text := nullif(btrim(coalesce(p_admin_memo,'')),'');
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  select array_agg(submission_ref order by submission_ref) into ids from public.submission_order_items where order_id=p_order_id;
  if coalesce(cardinality(ids),0)=0 then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  select * into o from public.submission_orders where id=p_order_id for update;
  if o.payment_method<>'BANK' or o.returned_at is not null or o.status not in ('BANK_PENDING','PAID')
    or (select count(*) from public.submissions where id=any(ids))<>cardinality(ids)
    or exists(select 1 from public.submissions s where s.id=any(ids) and (
      s.current_order_id is distinct from p_order_id or s.user_id is distinct from o.user_id
      or s.payment_method<>'BANK' or s.user_deleted_at is not null
      or s.payment_status is distinct from case when o.status='PAID' then 'PAID'::payment_status else 'PAYMENT_PENDING'::payment_status end))
  then raise exception 'BANK_ORDER_NOT_CONFIRMABLE' using errcode='55000'; end if;
  if o.status='PAID' then return query select unnest(ids); return; end if;
  if o.amount_krw is distinct from (select sum(s.amount_krw) from public.submissions s where s.id=any(ids))
    or exists(select 1 from public.submission_order_items i join public.submissions s on s.id=i.submission_id
      where i.order_id=p_order_id and i.amount_krw is distinct from s.amount_krw)
  then raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode='22000'; end if;
  if exists(select 1 from public.submission_payments p cross join unnest(ids) x
    where p.status in ('REQUESTED','APPROVED') and public.submission_payment_includes_submission(p.submission_id,p.raw_response,x)) then
    raise exception 'PAYMENT_ALREADY_IN_PROGRESS' using errcode='55000'; end if;
  perform set_config('onside.checkout_order_write',p_order_id::text,true);
  update public.submissions set payment_status='PAID',status=case when status in ('DRAFT','SUBMITTED','WAITING_PAYMENT') then 'PRE_REVIEW'::submission_status else status end,
    admin_memo=case when memo_text is null or position(memo_text in coalesce(admin_memo,''))>0 then admin_memo
      else concat_ws(E'\n', nullif(btrim(coalesce(admin_memo,'')),''),
        format('[입금 확인 %s] %s', to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'), memo_text)) end
  where id=any(ids);
  update public.submission_orders set status='PAID',paid_at=now(),updated_at=now() where id=p_order_id;
  insert into public.submission_events(submission_id,actor_user_id,event_type,message)
  select x,p_actor_user_id,'PAYMENT_UPDATE','주문 전체의 무통장 입금이 확인되었습니다. 자료 확인 후 방송국·기관 접수를 진행합니다.' from unnest(ids) x;
  return query select unnest(ids);
end;
$$;
revoke all on function public.confirm_submission_order_bank_payment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_submission_order_bank_payment(uuid,uuid,text) to service_role;

-- Uncertain card approvals. Latest definition: 20261026120000. Customers see
-- a fixed notice on the order; the operator's memo goes to the admin memo
-- after the attempt is settled (an open attempt locks its submissions).
create or replace function public.resolve_uncertain_submission_payment(
  p_order_id text, p_actor_user_id uuid, p_outcome text,
  p_pg_tid text default null, p_admin_memo text default null
) returns table(submission_id uuid, final_status text)
language plpgsql security invoker set search_path=public as $$
declare p public.submission_payments%rowtype; o public.submission_orders%rowtype; ids uuid[]; memo_text text;
  audit jsonb := jsonb_build_object('adminResolution', jsonb_build_object('actor', p_actor_user_id, 'memo', p_admin_memo, 'at', now()));
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_outcome not in ('APPROVED','FAILED') then raise exception 'INVALID_RESOLUTION' using errcode='22023'; end if;
  if p_outcome='APPROVED' and nullif(btrim(coalesce(p_pg_tid,'')),'') is null then
    raise exception 'PG_TID_REQUIRED' using errcode='22023'; end if;
  -- Same lock order as the callback: payment attempt, submissions, then the order projection.
  select * into p from public.submission_payments where order_id=p_order_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if lower(coalesce(p.provider,'inicis'))<>'inicis' then raise exception 'PAYMENT_PROVIDER_MISMATCH' using errcode='22000'; end if;
  if p.status<>'REQUESTED' or p.result_code is distinct from 'APPROVAL_UNCERTAIN' then
    raise exception 'PAYMENT_NOT_UNCERTAIN' using errcode='55000'; end if;
  if p.checkout_order_id is null then raise exception 'CHECKOUT_ORDER_REQUIRED' using errcode='55000'; end if;
  ids := public.submission_payment_group_ids(p.submission_id, p.raw_response);
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  select * into o from public.submission_orders where id=p.checkout_order_id for update;
  if o.status<>'REVIEW_REQUIRED' then raise exception 'ORDER_NOT_REVIEW_REQUIRED' using errcode='55000'; end if;
  memo_text := nullif(btrim(coalesce(p_admin_memo,'')),'');
  -- Release the reconciliation hold so the standard settle paths accept the row.
  update public.submission_payments set result_code='ADMIN_RECONCILED',
    result_message='관리자가 이니시스 거래 내역과 대조했습니다.' where id=p.id;
  if p_outcome='APPROVED' then
    perform * from public.approve_submission_payment_order(p_order_id, btrim(p_pg_tid), '0000',
      '관리자가 이니시스 거래 내역에서 승인을 확인했습니다.', audit, now());
    update public.submission_orders set status='PAID', paid_at=coalesce(paid_at, now()), updated_at=now(),
      note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), '카드 결제 승인이 확인되었습니다.') where id=o.id;
  else
    perform * from public.close_submission_payment_order_v96(p_order_id, 'FAILED', 'ADMIN_CONFIRMED_FAILURE',
      '관리자가 이니시스 거래 내역에서 미승인을 확인했습니다.', audit);
    update public.submission_orders set status='FAILED', updated_at=now(),
      note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), '카드 결제가 승인되지 않은 것으로 확인되었습니다. 다시 결제할 수 있습니다.') where id=o.id;
  end if;
  if memo_text is not null then
    update public.submissions s set admin_memo=concat_ws(E'\n', nullif(btrim(coalesce(s.admin_memo,'')),''),
      format('[카드 %s 확인 %s] %s', case when p_outcome='APPROVED' then '승인' else '미승인' end,
        to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'), memo_text))
    where s.id=any(ids);
  end if;
  insert into public.submission_events(submission_id, actor_user_id, event_type, message)
  select x, p_actor_user_id, 'PAYMENT_UPDATE',
    case when p_outcome='APPROVED' then '관리자가 카드 승인 결과를 확인해 결제 완료로 처리했습니다.'
      else '관리자가 카드 미승인을 확인했습니다. 주문내역에서 다시 결제할 수 있습니다.' end
  from unnest(ids) x;
  return query select x, p_outcome from unnest(ids) x;
end;
$$;
revoke all on function public.resolve_uncertain_submission_payment(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_uncertain_submission_payment(text,uuid,text,text,text) to service_role;

-- Refund recorded from the submission edit form. Latest definition:
-- 20261026120000. Fixed order notice, memo appended to the admin memo, and
-- receipt requests that were never issued are closed (4).
create or replace function public.refund_submission_order(p_order_id uuid, p_actor_user_id uuid, p_admin_memo text default null)
returns table(submission_id uuid)
language plpgsql security invoker set search_path=public as $$
declare o public.submission_orders%rowtype; ids uuid[]; memo_text text;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  select array_agg(submission_ref order by submission_ref) into ids from public.submission_order_items where order_id=p_order_id;
  if coalesce(cardinality(ids),0)=0 then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  select * into o from public.submission_orders where id=p_order_id for update;
  if o.status='REFUNDED' then return query select unnest(ids); return; end if;
  if o.status<>'PAID' or o.returned_at is not null
    or (select count(*) from public.submissions where id=any(ids))<>cardinality(ids)
    or exists(select 1 from public.submissions s where s.id=any(ids)
      and (s.current_order_id is distinct from p_order_id or s.payment_status<>'PAID'))
  then raise exception 'ORDER_NOT_REFUNDABLE' using errcode='55000'; end if;
  memo_text := nullif(btrim(coalesce(p_admin_memo,'')),'');
  perform set_config('onside.checkout_order_write', p_order_id::text, true);
  update public.submissions s set payment_status='REFUNDED',
    admin_memo=case when memo_text is null or position(memo_text in coalesce(s.admin_memo,''))>0 then s.admin_memo
      else concat_ws(E'\n', nullif(btrim(coalesce(s.admin_memo,'')),''),
        format('[환불 %s] %s', to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'), memo_text)) end
  where s.id=any(ids);
  update public.submission_orders set status='REFUNDED', refunded_at=now(), updated_at=now(),
    note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), '환불 완료') where id=p_order_id;
  update public.submission_order_cash_receipts r set status='CANCELED', canceled_at=now(),
    cancel_reason='주문이 환불되어 발급 신청을 취소했습니다.', issued_by=p_actor_user_id, updated_at=now()
  where r.order_id=p_order_id and r.status in ('REQUESTED','FAILED');
  insert into public.submission_events(submission_id, actor_user_id, event_type, message)
  select x, p_actor_user_id, 'PAYMENT_UPDATE', '결제가 환불 처리되었습니다. 심의 진행은 중단되며, 문의는 고객센터로 연락해주세요.' from unnest(ids) x;
  return query select unnest(ids);
end;
$$;
revoke all on function public.refund_submission_order(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.refund_submission_order(uuid,uuid,text) to service_role;

-- 4. Cash receipts on refund and deletion ------------------------------------------
-- Refund recorded from the admin refund panel. Latest definition:
-- 20261102190000. Adds only the closing of unissued receipt requests.
create or replace function public.admin_record_refund(
  p_submission_id uuid,
  p_actor_user_id uuid,
  p_method text,
  p_note text default null
)
returns table(submission_id uuid)
language plpgsql security invoker set search_path=public as $$
declare
  v_order_id uuid; v_ids uuid[]; v_order public.submission_orders%rowtype; v_status text;
  v_method_label text; v_note text; v_line text;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  v_method_label := case p_method when 'CARD_CANCEL' then '카드 결제 취소' when 'BANK_TRANSFER' then '계좌 송금' when 'OTHER' then '기타' end;
  if v_method_label is null then raise exception 'REFUND_METHOD_INVALID' using errcode='22023'; end if;
  v_note := nullif(btrim(coalesce(p_note,'')),'');
  if char_length(coalesce(v_note,''))>500 then raise exception 'REFUND_NOTE_INVALID' using errcode='22023'; end if;

  select s.current_order_id, s.payment_status::text into v_order_id, v_status from public.submissions s where s.id=p_submission_id;
  if not found then raise exception 'SUBMISSION_NOT_FOUND' using errcode='P0002'; end if;

  if v_order_id is null then
    perform 1 from public.submissions s where s.id=p_submission_id for update;
    select s.payment_status::text into v_status from public.submissions s where s.id=p_submission_id;
    if v_status='REFUNDED' then return query select p_submission_id; return; end if;
    if v_status<>'PAID' then raise exception 'NOT_REFUNDABLE' using errcode='55000'; end if;
    v_ids := array[p_submission_id];
  else
    -- Same lock order as the approval callbacks: payment attempts, submissions, then the order.
    perform p.id from public.submission_payments p where p.checkout_order_id=v_order_id order by p.id for update;
    select array_agg(i.submission_ref order by i.submission_ref) into v_ids from public.submission_order_items i where i.order_id=v_order_id;
    perform s.id from public.submissions s where s.id=any(v_ids) order by s.id for update;
    select * into v_order from public.submission_orders o where o.id=v_order_id for update;
    if not found then raise exception 'NOT_REFUNDABLE' using errcode='55000'; end if;
    if v_order.status='REFUNDED' then return query select x from unnest(v_ids) x where exists(select 1 from public.submissions s where s.id=x); return; end if;
    if v_order.status<>'PAID' or v_order.returned_at is not null
      or exists(select 1 from public.submissions s where s.id=any(v_ids) and s.current_order_id=v_order_id and s.payment_status<>'PAID') then
      raise exception 'NOT_REFUNDABLE' using errcode='55000'; end if;
    -- Applications deleted earlier keep their order item snapshot only.
    select array_agg(s.id order by s.id) into v_ids from public.submissions s where s.id=any(v_ids) and s.current_order_id=v_order_id;
    perform set_config('onside.checkout_order_write', v_order_id::text, true);
    update public.submission_orders o set status='REFUNDED', refunded_at=now(), updated_at=now(),
      note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), format('환불 완료 (%s)', v_method_label))
    where o.id=v_order_id;
    -- An issued receipt stays ISSUED until it is cancelled in Hometax; the
    -- admin cash-receipt view lists it as needing that cancellation.
    update public.submission_order_cash_receipts r set status='CANCELED', canceled_at=now(),
      cancel_reason='주문이 환불되어 발급 신청을 취소했습니다.', issued_by=p_actor_user_id, updated_at=now()
    where r.order_id=v_order_id and r.status in ('REQUESTED','FAILED');
  end if;

  v_line := format('[환불 %s · %s]%s', to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'), v_method_label, case when v_note is null then '' else ' '||v_note end);
  update public.submissions s set payment_status='REFUNDED',
    admin_memo=concat_ws(E'\n', nullif(btrim(coalesce(s.admin_memo,'')),''), v_line)
  where s.id=any(v_ids);
  insert into public.submission_events(submission_id, actor_user_id, event_type, message)
  select x, p_actor_user_id, 'PAYMENT_UPDATE', '결제가 환불 처리되었습니다. 심의 진행은 중단되며, 문의는 고객센터로 연락해주세요.' from unnest(v_ids) x;
  return query select x from unnest(v_ids) x;
end;
$$;
revoke all on function public.admin_record_refund(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_record_refund(uuid,uuid,text,text) to service_role;

-- Administrator deletion. Latest definition: 20261102170000. Adds the closing
-- of unissued receipt requests on every detached order. Payment attempts the
-- cascade removes are archived by archive_deleted_submission_payment (1) in
-- this same transaction.
create or replace function public.admin_delete_submissions(p_submission_ids uuid[], p_actor_user_id uuid)
returns table(submission_id uuid)
language plpgsql security invoker set search_path=public as $$
declare ids uuid[]; v_order_id uuid; v_order_status text;
begin
  if not exists(select 1 from public.profiles where user_id=p_actor_user_id and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  select array_agg(distinct x order by x) into ids from unnest(coalesce(p_submission_ids,'{}'::uuid[])) x where x is not null;
  if coalesce(cardinality(ids),0)=0 then return; end if;

  -- Same lock order as the approval callbacks: payment attempts, submissions, then orders.
  perform p.id from public.submission_payments p
  where p.checkout_order_id in (select s.current_order_id from public.submissions s where s.id=any(ids) and s.current_order_id is not null)
  order by p.id for update;
  perform s.id from public.submissions s where s.id=any(ids) order by s.id for update;
  if exists(select 1 from public.submissions s where s.id=any(ids) and s.payment_status='PAID') then
    raise exception 'PAID_SUBMISSION' using errcode='55000'; end if;

  for v_order_id in select distinct s.current_order_id from public.submissions s
    where s.id=any(ids) and s.current_order_id is not null order by 1 loop
    select o.status into v_order_status from public.submission_orders o where o.id=v_order_id for update;
    if v_order_status in ('PAID','REVIEW_REQUIRED') then
      raise exception 'PAID_SUBMISSION' using errcode='55000'; end if;
    if exists(select 1 from public.submissions s where s.current_order_id=v_order_id and not (s.id=any(ids))) then
      raise exception 'ORDER_HAS_OTHER_SUBMISSIONS' using errcode='55000'; end if;
    if exists(select 1 from public.submission_payments p where p.checkout_order_id=v_order_id and p.status='REQUESTED'
      and p.result_code in ('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN','CAPTURE_IN_PROGRESS')) then
      raise exception 'PAYMENT_APPROVAL_IN_PROGRESS' using errcode='55000'; end if;
    perform set_config('onside.checkout_order_write', v_order_id::text, true);
    update public.submissions s set current_order_id=null where s.id=any(ids) and s.current_order_id=v_order_id;
    update public.submission_orders o set
      status=case when o.status in ('FAILED','CANCELED','REFUNDED') then o.status else 'CANCELED' end,
      returned_at=case when o.status in ('BANK_PENDING','CARD_PENDING','PAYPAL_PENDING') then coalesce(o.returned_at, now()) else o.returned_at end,
      note=concat_ws(E'\n', nullif(btrim(coalesce(o.note,'')),''), '관리자가 신청서를 삭제해 주문을 정리했습니다.'),
      updated_at=now()
    where o.id=v_order_id;
    update public.submission_order_cash_receipts r set status='CANCELED', canceled_at=now(),
      cancel_reason='신청서가 삭제되어 발급 신청을 취소했습니다.', issued_by=p_actor_user_id, updated_at=now()
    where r.order_id=v_order_id and r.status in ('REQUESTED','FAILED');
  end loop;

  return query delete from public.submissions s where s.id=any(ids) returning s.id;
end;
$$;
revoke all on function public.admin_delete_submissions(uuid[],uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_submissions(uuid[],uuid) to service_role;
