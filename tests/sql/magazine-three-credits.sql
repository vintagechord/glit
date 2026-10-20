do $test$
declare
  request public.magazine_requests;
  failed boolean;
  reward_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
begin
  assert (select credits_spent = 1 from public.magazine_requests where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),
    'Legacy request must remain one credit';
  assert not has_function_privilege('anon', 'public.create_magazine_request(uuid,text,text,text,text,text,text,date,text,text,text,text,text,text)', 'execute');
  assert has_function_privilege('authenticated', 'public.create_magazine_request(uuid,text,text,text,text,text,text,date,text,text,text,text,text,text)', 'execute');

  -- Two credits cannot buy a request, even when the browser skips its check.
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  failed := false;
  begin
    perform public.create_magazine_request(null,'MEDIA','Tester','test@example.test',null,null,null,null,null,null,null,null,null,null);
  exception when others then
    if sqlerrm <> 'INSUFFICIENT_CREDITS' then raise; end if;
    failed := true;
  end;
  assert failed and not exists(select 1 from public.magazine_requests where user_id = auth.uid());

  -- Exactly three credits succeeds and records three, not the old row-count cost.
  update public.credit_grants set amount = 3 where user_id = auth.uid();
  select * into request from public.create_magazine_request(null,'MEDIA','Tester','test@example.test',null,null,null,null,null,null,null,null,null,null);
  assert request.credits_spent = 3 and request.user_id = auth.uid();
  failed := false;
  begin
    perform public.redeem_credit_reward(reward_id);
  exception when others then
    if sqlerrm <> 'INSUFFICIENT_CREDITS' then raise; end if;
    failed := true;
  end;
  assert failed, 'Other credit rewards must see all three magazine credits spent';
  failed := false;
  begin
    perform public.redeem_studio_reward(reward_id,current_date,'12:00','Tester','01000000000',null,null);
  exception when others then
    if sqlerrm <> 'INSUFFICIENT_CREDITS' then raise; end if;
    failed := true;
  end;
  assert failed, 'Service requests must see all three magazine credits spent';

  -- Cancellation releases the recorded three credits for other services.
  update public.magazine_requests set status = 'CANCELED' where id = request.id;
  assert (select credits_spent = 3 from public.magazine_requests where id = request.id);
  perform public.redeem_credit_reward(reward_id);
  perform public.redeem_studio_reward(reward_id,current_date,'12:00','Tester','01000000000',null,null);
  assert (select sum(credits_spent) = 2 from public.credit_reward_redemptions where user_id = auth.uid());

  -- Historical one-credit + new three-credit usage consumes four exactly.
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  select * into request from public.create_magazine_request(null,'DOMESTIC_NEWS','Tester','test@example.test',null,null,null,null,null,null,null,null,null,null);
  assert (select sum(credits_spent) = 4 from public.magazine_requests where user_id = auth.uid() and status <> 'CANCELED');
  failed := false;
  begin
    perform public.redeem_credit_reward(reward_id);
  exception when others then
    if sqlerrm <> 'INSUFFICIENT_CREDITS' then raise; end if;
    failed := true;
  end;
  assert failed;
end;
$test$;

-- A caller cannot supply a discounted credit amount by inserting a row directly.
grant select, insert on public.magazine_requests to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $test$
declare failed boolean := false;
begin
  begin
    insert into public.magazine_requests (user_id,target_channel,requester_name,requester_email,credits_spent)
    values (auth.uid(),'MEDIA','Forged','test@example.test',1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'Raw inserts must not bypass the three-credit RPC';
end;
$test$;
reset role;
