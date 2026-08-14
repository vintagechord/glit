begin;

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (id, aud, role) values
  ('61111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated'),
  ('62222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated');

insert into public.submissions (
  id, user_id, type, title, status, payment_status, amount_krw
) values (
  '63333333-3333-4333-8333-333333333333',
  '62222222-2222-4222-8222-222222222222',
  'ALBUM',
  'Other owner submission',
  'SUBMITTED',
  'UNPAID',
  1000
);

insert into public.karaoke_requests (
  id, user_id, title, payment_status, amount_krw
) values (
  '64444444-4444-4444-8444-444444444444',
  '62222222-2222-4222-8222-222222222222',
  'Other owner request',
  'UNPAID',
  50000
);

insert into public.karaoke_promotions (
  id, karaoke_request_id, owner_user_id, status, credits_required, credits_balance
) values (
  '65555555-5555-4555-8555-555555555555',
  '64444444-4444-4444-8444-444444444444',
  '62222222-2222-4222-8222-222222222222',
  'ACTIVE',
  10,
  10
);

insert into public.credit_rewards (
  id, title, credits_required, is_active
) values (
  '66666666-6666-4666-8666-666666666666',
  'Policy test reward',
  1,
  true
);

insert into public.credit_reward_redemptions (
  id, user_id, reward_id, reward_title, credits_spent, coupon_code
) values (
  '67777777-7777-4777-8777-777777777777',
  '62222222-2222-4222-8222-222222222222',
  '66666666-6666-4666-8666-666666666666',
  'Policy test reward',
  1,
  'POLICY-TEST-OTHER'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '61111111-1111-4111-8111-111111111111',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $test$
begin
  begin
    insert into public.karaoke_votes (
      request_id, voter_user_id, status
    ) values (
      '64444444-4444-4444-8444-444444444444',
      '61111111-1111-4111-8111-111111111111',
      'APPROVED'
    );
    raise exception 'expected raw karaoke vote insert to fail';
  exception when insufficient_privilege then null;
  end;

  insert into public.karaoke_votes (
    request_id, voter_user_id, status
  ) values (
    '64444444-4444-4444-8444-444444444444',
    '61111111-1111-4111-8111-111111111111',
    'PENDING'
  );

  begin
    insert into public.karaoke_promotions (
      submission_id, owner_user_id, status, credits_required, credits_balance
    ) values (
      '63333333-3333-4333-8333-333333333333',
      '61111111-1111-4111-8111-111111111111',
      'ACTIVE',
      1,
      999999
    );
    raise exception 'expected raw karaoke promotion insert to fail';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.karaoke_promotion_contributions (
      promotion_id, contributor_user_id, credits
    ) values (
      '65555555-5555-4555-8555-555555555555',
      '61111111-1111-4111-8111-111111111111',
      -100
    );
    raise exception 'expected raw contribution insert to fail';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.karaoke_promotion_recommendations (
      promotion_id, recommender_user_id, status
    ) values (
      '65555555-5555-4555-8555-555555555555',
      '61111111-1111-4111-8111-111111111111',
      'APPROVED'
    );
    raise exception 'expected raw recommendation insert to fail';
  exception when insufficient_privilege then null;
  end;

  insert into public.karaoke_promotion_recommendations (
    promotion_id, recommender_user_id, status
  ) values (
    '65555555-5555-4555-8555-555555555555',
    '61111111-1111-4111-8111-111111111111',
    'PENDING'
  );

  begin
    insert into public.magazine_requests (
      submission_id, user_id, status, requester_name, requester_email,
      published_url, admin_memo
    ) values (
      null,
      '61111111-1111-4111-8111-111111111111',
      'PUBLISHED',
      'Forged requester',
      'forged@example.com',
      'https://attacker.example/published',
      'forged admin memo'
    );
    raise exception 'expected raw magazine request insert to fail';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.studio_reservation_requests (
      user_id, redemption_id, reward_id, reward_title, status,
      preferred_date, preferred_time, contact_name, contact_phone,
      approved_message, admin_memo, approved_at
    ) values (
      '61111111-1111-4111-8111-111111111111',
      '67777777-7777-4777-8777-777777777777',
      '66666666-6666-4666-8666-666666666666',
      'Policy test reward',
      'APPROVED',
      current_date + 1,
      '12:00',
      'Forged requester',
      '01000000000',
      'forged approval',
      'forged memo',
      now()
    );
    raise exception 'expected raw studio reservation insert to fail';
  exception when insufficient_privilege then null;
  end;
end;
$test$;

rollback;
