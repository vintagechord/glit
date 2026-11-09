-- The 아티스트명 공식 표기 is the artist name customers and staff read. The MV
-- form files it in artist_name_kr and keeps 아티스트명 (한글/영문) in
-- artist_name for reference; albums file the official credit in artist_name.
-- Order items snapshot the name shown in order history and payment receipts.
-- CREATE OR REPLACE keeps the function's owner and its restricted grants.
create or replace function public.snapshot_submission_order_items(p_order_id uuid,p_ids uuid[])
returns void language sql security invoker set search_path=public as $$
  insert into public.submission_order_items(order_id,submission_id,submission_ref,type,title,artist_name,package_name,amount_krw,amount,is_oneclick,album_draft_group_id,file_ids,guest_token_hash)
  select p_order_id,s.id,s.id,s.type::text,s.title,
    case when s.type::text in ('MV_DISTRIBUTION','MV_BROADCAST')
      then coalesce(nullif(btrim(s.artist_name_kr),''),s.artist_name)
      else s.artist_name end,
    p.name,s.amount_krw,
    case when o.currency='KRW' then s.amount_krw else s.payment_amount end,
    s.is_oneclick,s.album_draft_group_id,
    array(select f.id from public.submission_files f where f.submission_id=s.id order by f.id),
    case when s.user_id is null and nullif(s.guest_token,'') is not null then encode(sha256(convert_to(s.guest_token,'UTF8')),'hex') end
  from public.submissions s left join public.packages p on p.id=s.package_id
  join public.submission_orders o on o.id=p_order_id
  where s.id=any(p_ids)
  on conflict(order_id,submission_ref) do nothing;
$$;

-- Existing MV order items take the official credit as well. Only the display
-- name changes; amounts and references stay as recorded.
update public.submission_order_items i
set artist_name = btrim(s.artist_name_kr)
from public.submissions s
where s.id = i.submission_id
  and i.type in ('MV_DISTRIBUTION','MV_BROADCAST')
  and nullif(btrim(s.artist_name_kr),'') is not null
  and i.artist_name is distinct from btrim(s.artist_name_kr);
