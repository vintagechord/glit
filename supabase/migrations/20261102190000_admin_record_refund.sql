-- Records a refund the administrator already made outside the app: a card
-- payment cancelled in the KG Inicis console, or a bank transfer back to the
-- customer. A submission tied to an order refunds the whole order (every
-- application paid together); a submission without an order (legacy rows, or
-- an administrator-registered guest album) refunds on its own.
--
-- Customers can read their own submissions, events and orders, so they only
-- get a fixed refund notice. The administrator's free-text note is appended
-- to admin_memo with the date and method, keeping any earlier memo.
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
