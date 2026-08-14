-- Serialize every karaoke-credit balance transition with the related
-- promotion/moderation rows. These RPCs are service-role only because the
-- application performs authentication and upload ownership checks first.

create or replace function public.create_karaoke_request_with_promotion(
  p_user_id uuid,
  p_title text,
  p_artist text,
  p_contact text,
  p_notes text,
  p_file_path text,
  p_payment_method public.payment_method,
  p_amount_krw integer,
  p_bank_depositor_name text,
  p_tj_requested boolean,
  p_ky_requested boolean,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_recommendation_public boolean,
  p_promotion_credits integer
)
returns table(result_request_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_balance integer;
  v_recommendation_public boolean := coalesce(p_recommendation_public, false);
  v_promotion_credits integer := coalesce(p_promotion_credits, 0);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'KARAOKE_REQUEST_RPC_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null
    or length(p_title) > 500
    or nullif(btrim(coalesce(p_contact, '')), '') is null
    or length(p_contact) > 500
    or length(coalesce(p_artist, '')) > 500
    or length(coalesce(p_notes, '')) > 20000
    or length(coalesce(p_file_path, '')) > 1024
  then
    raise exception 'KARAOKE_REQUEST_INPUT_INVALID' using errcode = '22023';
  end if;
  if p_amount_krw is null or p_amount_krw <= 0 or p_amount_krw > 100000000 then
    raise exception 'KARAOKE_REQUEST_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if p_payment_method = 'BANK'
    and nullif(btrim(coalesce(p_bank_depositor_name, '')), '') is null
  then
    raise exception 'KARAOKE_BANK_DEPOSITOR_REQUIRED' using errcode = '22023';
  end if;
  if p_user_id is null then
    if p_payment_method = 'CARD' then
      raise exception 'KARAOKE_CARD_LOGIN_REQUIRED' using errcode = '42501';
    end if;
    if nullif(btrim(coalesce(p_guest_name, '')), '') is null
      or nullif(btrim(coalesce(p_guest_email, '')), '') is null
      or length(coalesce(p_guest_name, '')) > 500
      or length(coalesce(p_guest_email, '')) > 320
      or length(coalesce(p_guest_phone, '')) > 100
    then
      raise exception 'KARAOKE_GUEST_INPUT_INVALID' using errcode = '22023';
    end if;
  end if;
  if v_promotion_credits < 0 or v_promotion_credits > 1000000 then
    raise exception 'KARAOKE_PROMOTION_CREDITS_INVALID' using errcode = '22023';
  end if;
  if v_recommendation_public then
    if p_user_id is null then
      raise exception 'KARAOKE_PROMOTION_LOGIN_REQUIRED' using errcode = '42501';
    end if;
    if v_promotion_credits < 1 then
      raise exception 'KARAOKE_PROMOTION_CREDITS_REQUIRED' using errcode = '22023';
    end if;
  elsif v_promotion_credits <> 0 then
    raise exception 'KARAOKE_HIDDEN_PROMOTION_CREDITS_INVALID'
      using errcode = '22023';
  end if;

  if v_recommendation_public then
    insert into public.karaoke_credits (user_id, balance)
    values (p_user_id, 0)
    on conflict (user_id) do nothing;

    select credit.balance
      into v_balance
    from public.karaoke_credits credit
    where credit.user_id = p_user_id
    for update;

    if coalesce(v_balance, 0) < v_promotion_credits then
      raise exception 'KARAOKE_CREDITS_INSUFFICIENT' using errcode = '22000';
    end if;
  end if;

  insert into public.karaoke_requests (
    user_id,
    guest_name,
    guest_email,
    guest_phone,
    title,
    artist,
    contact,
    notes,
    file_path,
    payment_method,
    payment_status,
    amount_krw,
    bank_depositor_name,
    tj_requested,
    ky_requested,
    recommendation_public,
    recommendation_url
  ) values (
    p_user_id,
    case when p_user_id is null then nullif(btrim(coalesce(p_guest_name, '')), '') else null end,
    case when p_user_id is null then nullif(btrim(coalesce(p_guest_email, '')), '') else null end,
    case when p_user_id is null then nullif(btrim(coalesce(p_guest_phone, '')), '') else null end,
    btrim(p_title),
    nullif(btrim(coalesce(p_artist, '')), ''),
    btrim(p_contact),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_file_path, '')), ''),
    p_payment_method,
    'PAYMENT_PENDING',
    p_amount_krw,
    case when p_payment_method = 'BANK'
      then btrim(p_bank_depositor_name)
      else null
    end,
    coalesce(p_tj_requested, true),
    coalesce(p_ky_requested, true),
    v_recommendation_public,
    null
  )
  returning id into v_request_id;

  if v_recommendation_public then
    update public.karaoke_credits credit
    set balance = credit.balance - v_promotion_credits
    where credit.user_id = p_user_id
      and credit.balance >= v_promotion_credits;
    if not found then
      raise exception 'KARAOKE_CREDITS_STATE_CHANGED' using errcode = '40001';
    end if;

    insert into public.karaoke_promotions (
      karaoke_request_id,
      submission_id,
      owner_user_id,
      status,
      credits_balance,
      credits_required,
      tj_enabled,
      ky_enabled,
      reference_url
    ) values (
      v_request_id,
      null,
      p_user_id,
      'ACTIVE',
      v_promotion_credits,
      1,
      coalesce(p_tj_requested, true),
      coalesce(p_ky_requested, true),
      null
    );

    insert into public.karaoke_credit_events (user_id, delta, reason)
    values (
      p_user_id,
      -v_promotion_credits,
      '노래방 추천 공개 크레딧 예치'
    );
  end if;

  return query select v_request_id;
end;
$$;

revoke all on function public.create_karaoke_request_with_promotion(
  uuid, text, text, text, text, text, public.payment_method, integer,
  text, boolean, boolean, text, text, text, boolean, integer
) from public, anon, authenticated;
grant execute on function public.create_karaoke_request_with_promotion(
  uuid, text, text, text, text, text, public.payment_method, integer,
  text, boolean, boolean, text, text, text, boolean, integer
) to service_role;

create or replace function public.contribute_karaoke_promotion_credits(
  p_user_id uuid,
  p_submission_id uuid,
  p_promotion_id uuid,
  p_credits integer,
  p_tj_enabled boolean,
  p_ky_enabled boolean,
  p_reference_url text
)
returns table(
  result_promotion_id uuid,
  result_promotion_balance integer,
  result_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission public.submissions%rowtype;
  v_promotion public.karaoke_promotions%rowtype;
  v_credit_balance integer;
  v_next_promotion_balance bigint;
  v_next_status text;
  v_can_edit_options boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'KARAOKE_CREDIT_RPC_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'KARAOKE_CREDIT_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if p_promotion_id is null and p_submission_id is null then
    raise exception 'KARAOKE_PROMOTION_TARGET_REQUIRED' using errcode = '22023';
  end if;
  if p_credits is null or p_credits <= 0 or p_credits > 1000000 then
    raise exception 'KARAOKE_PROMOTION_CREDITS_INVALID' using errcode = '22023';
  end if;
  if length(coalesce(p_reference_url, '')) > 2048 then
    raise exception 'KARAOKE_PROMOTION_REFERENCE_INVALID' using errcode = '22023';
  end if;

  if p_promotion_id is not null then
    select promotion.*
      into v_promotion
    from public.karaoke_promotions promotion
    where promotion.id = p_promotion_id
    for update;
    if not found then
      raise exception 'KARAOKE_PROMOTION_NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    select submission.*
      into v_submission
    from public.submissions submission
    where submission.id = p_submission_id
    for update;
    if not found then
      raise exception 'KARAOKE_SUBMISSION_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_submission.user_id is distinct from p_user_id then
      raise exception 'KARAOKE_SUBMISSION_OWNER_MISMATCH' using errcode = '42501';
    end if;

    select promotion.*
      into v_promotion
    from public.karaoke_promotions promotion
    where promotion.submission_id = p_submission_id
    for update;

    if not found then
      insert into public.karaoke_promotions (
        submission_id,
        owner_user_id,
        status,
        credits_balance,
        credits_required,
        tj_enabled,
        ky_enabled,
        reference_url
      ) values (
        v_submission.id,
        p_user_id,
        'PENDING',
        0,
        10,
        coalesce(p_tj_enabled, true),
        coalesce(p_ky_enabled, true),
        nullif(btrim(coalesce(p_reference_url, '')), '')
      )
      returning * into v_promotion;
    end if;
  end if;

  if coalesce(v_promotion.credits_balance, 0) < 0
    or coalesce(v_promotion.credits_required, 0) <= 0
  then
    raise exception 'KARAOKE_PROMOTION_STATE_INVALID' using errcode = '55000';
  end if;

  insert into public.karaoke_credits (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;
  select credit.balance
    into v_credit_balance
  from public.karaoke_credits credit
  where credit.user_id = p_user_id
  for update;
  if coalesce(v_credit_balance, 0) < p_credits then
    raise exception 'KARAOKE_CREDITS_INSUFFICIENT' using errcode = '22000';
  end if;

  v_next_promotion_balance := v_promotion.credits_balance::bigint + p_credits;
  if v_next_promotion_balance > 2147483647 then
    raise exception 'KARAOKE_PROMOTION_BALANCE_OVERFLOW' using errcode = '22003';
  end if;
  v_next_status := case
    when v_promotion.status = 'ACTIVE'
      or v_next_promotion_balance >= v_promotion.credits_required
      then 'ACTIVE'
    else 'PENDING'
  end;
  v_can_edit_options := v_promotion.owner_user_id = p_user_id;

  update public.karaoke_credits credit
  set balance = credit.balance - p_credits
  where credit.user_id = p_user_id
    and credit.balance >= p_credits;
  if not found then
    raise exception 'KARAOKE_CREDITS_STATE_CHANGED' using errcode = '40001';
  end if;

  update public.karaoke_promotions promotion
  set credits_balance = v_next_promotion_balance::integer,
      status = v_next_status,
      tj_enabled = case
        when v_can_edit_options then coalesce(p_tj_enabled, promotion.tj_enabled)
        else promotion.tj_enabled
      end,
      ky_enabled = case
        when v_can_edit_options then coalesce(p_ky_enabled, promotion.ky_enabled)
        else promotion.ky_enabled
      end,
      reference_url = case
        when v_can_edit_options
          then coalesce(
            nullif(btrim(coalesce(p_reference_url, '')), ''),
            promotion.reference_url
          )
        else promotion.reference_url
      end
  where promotion.id = v_promotion.id;

  insert into public.karaoke_promotion_contributions (
    promotion_id, contributor_user_id, credits
  ) values (v_promotion.id, p_user_id, p_credits);

  insert into public.karaoke_credit_events (user_id, delta, reason)
  values (p_user_id, -p_credits, '노래방 추천 노출 크레딧 사용');

  return query
  select v_promotion.id, v_next_promotion_balance::integer, v_next_status;
end;
$$;

revoke all on function public.contribute_karaoke_promotion_credits(
  uuid, uuid, uuid, integer, boolean, boolean, text
) from public, anon, authenticated;
grant execute on function public.contribute_karaoke_promotion_credits(
  uuid, uuid, uuid, integer, boolean, boolean, text
) to service_role;

create or replace function public.set_karaoke_promotion_recommendation_status(
  p_recommendation_id uuid,
  p_status text
)
returns table(result_status text, result_credited boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recommendation public.karaoke_promotion_recommendations%rowtype;
  v_promotion public.karaoke_promotions%rowtype;
  v_credit_balance integer;
  v_next_promotion_balance integer;
  v_next_promotion_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'KARAOKE_MODERATION_RPC_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;
  if p_status not in ('PENDING', 'APPROVED', 'REJECTED') then
    raise exception 'KARAOKE_RECOMMENDATION_STATUS_INVALID'
      using errcode = '22023';
  end if;

  select recommendation.*
    into v_recommendation
  from public.karaoke_promotion_recommendations recommendation
  where recommendation.id = p_recommendation_id
  for update;
  if not found then
    raise exception 'KARAOKE_RECOMMENDATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_recommendation.status = 'APPROVED' then
    if p_status = 'APPROVED' then
      return query select 'APPROVED'::text, false;
      return;
    end if;
    raise exception 'KARAOKE_RECOMMENDATION_APPROVAL_TERMINAL'
      using errcode = '55000';
  end if;
  if p_status <> 'APPROVED' then
    update public.karaoke_promotion_recommendations recommendation
    set status = p_status
    where recommendation.id = v_recommendation.id;
    return query select p_status, false;
    return;
  end if;
  if v_recommendation.recommender_user_id is null then
    raise exception 'KARAOKE_RECOMMENDER_REQUIRED' using errcode = '55000';
  end if;

  select promotion.*
    into v_promotion
  from public.karaoke_promotions promotion
  where promotion.id = v_recommendation.promotion_id
  for update;
  if not found then
    raise exception 'KARAOKE_PROMOTION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if coalesce(v_promotion.credits_balance, 0) <= 0 then
    raise exception 'KARAOKE_PROMOTION_CREDITS_EXHAUSTED'
      using errcode = '22000';
  end if;

  v_next_promotion_balance := v_promotion.credits_balance - 1;
  v_next_promotion_status := case
    when v_next_promotion_balance <= 0 then 'EXHAUSTED'
    when v_promotion.status = 'ACTIVE' then 'ACTIVE'
    when v_next_promotion_balance >= v_promotion.credits_required then 'ACTIVE'
    else 'PENDING'
  end;

  insert into public.karaoke_credits (user_id, balance)
  values (v_recommendation.recommender_user_id, 0)
  on conflict (user_id) do nothing;
  select credit.balance
    into v_credit_balance
  from public.karaoke_credits credit
  where credit.user_id = v_recommendation.recommender_user_id
  for update;
  if v_credit_balance >= 2147483647 then
    raise exception 'KARAOKE_CREDIT_BALANCE_OVERFLOW' using errcode = '22003';
  end if;

  update public.karaoke_promotions promotion
  set credits_balance = v_next_promotion_balance,
      status = v_next_promotion_status
  where promotion.id = v_promotion.id
    and promotion.credits_balance = v_promotion.credits_balance;
  if not found then
    raise exception 'KARAOKE_PROMOTION_STATE_CHANGED' using errcode = '40001';
  end if;

  update public.karaoke_credits credit
  set balance = credit.balance + 1
  where credit.user_id = v_recommendation.recommender_user_id;

  insert into public.karaoke_credit_events (user_id, delta, reason)
  values (v_recommendation.recommender_user_id, 1, '추천 인증 승인');

  update public.karaoke_promotion_recommendations recommendation
  set status = 'APPROVED'
  where recommendation.id = v_recommendation.id
    and recommendation.status <> 'APPROVED';
  if not found then
    raise exception 'KARAOKE_RECOMMENDATION_STATE_CHANGED'
      using errcode = '40001';
  end if;

  return query select 'APPROVED'::text, true;
end;
$$;

revoke all on function public.set_karaoke_promotion_recommendation_status(
  uuid, text
) from public, anon, authenticated;
grant execute on function public.set_karaoke_promotion_recommendation_status(
  uuid, text
) to service_role;

create or replace function public.set_karaoke_vote_status(
  p_vote_id uuid,
  p_status text
)
returns table(result_status text, result_credited boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vote public.karaoke_votes%rowtype;
  v_credit_balance integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'KARAOKE_MODERATION_RPC_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;
  if p_status not in ('PENDING', 'APPROVED', 'REJECTED') then
    raise exception 'KARAOKE_VOTE_STATUS_INVALID' using errcode = '22023';
  end if;

  select vote.*
    into v_vote
  from public.karaoke_votes vote
  where vote.id = p_vote_id
  for update;
  if not found then
    raise exception 'KARAOKE_VOTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_vote.status = 'APPROVED' then
    if p_status = 'APPROVED' then
      return query select 'APPROVED'::text, false;
      return;
    end if;
    raise exception 'KARAOKE_VOTE_APPROVAL_TERMINAL' using errcode = '55000';
  end if;
  if p_status <> 'APPROVED' then
    update public.karaoke_votes vote
    set status = p_status
    where vote.id = v_vote.id;
    return query select p_status, false;
    return;
  end if;
  if v_vote.voter_user_id is null then
    raise exception 'KARAOKE_VOTER_REQUIRED' using errcode = '55000';
  end if;

  insert into public.karaoke_credits (user_id, balance)
  values (v_vote.voter_user_id, 0)
  on conflict (user_id) do nothing;
  select credit.balance
    into v_credit_balance
  from public.karaoke_credits credit
  where credit.user_id = v_vote.voter_user_id
  for update;
  if v_credit_balance >= 2147483647 then
    raise exception 'KARAOKE_CREDIT_BALANCE_OVERFLOW' using errcode = '22003';
  end if;

  update public.karaoke_credits credit
  set balance = credit.balance + 1
  where credit.user_id = v_vote.voter_user_id;

  insert into public.karaoke_credit_events (user_id, delta, reason)
  values (v_vote.voter_user_id, 1, '추천 승인');

  update public.karaoke_votes vote
  set status = 'APPROVED'
  where vote.id = v_vote.id
    and vote.status <> 'APPROVED';
  if not found then
    raise exception 'KARAOKE_VOTE_STATE_CHANGED' using errcode = '40001';
  end if;

  return query select 'APPROVED'::text, true;
end;
$$;

revoke all on function public.set_karaoke_vote_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_karaoke_vote_status(uuid, text)
  to service_role;
