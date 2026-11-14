-- Order history and payment mails mark the albums charged half price when
-- several albums are paid together (20261114120000). The application's own
-- price columns go back to the list price when an order returns to the cart,
-- so each order item keeps the album price tier and list price it was
-- charged at. Music videos leave both columns empty.
alter table public.submission_order_items
  add column if not exists album_price_tier text,
  add column if not exists album_base_price_krw integer;

-- Latest definition: 20261109120000. The only change is the two new columns.
-- CREATE OR REPLACE keeps the function's owner and its restricted grants.
create or replace function public.snapshot_submission_order_items(p_order_id uuid,p_ids uuid[])
returns void language sql security invoker set search_path=public as $$
  insert into public.submission_order_items(order_id,submission_id,submission_ref,type,title,artist_name,package_name,amount_krw,amount,is_oneclick,album_draft_group_id,file_ids,guest_token_hash,album_price_tier,album_base_price_krw)
  select p_order_id,s.id,s.id,s.type::text,s.title,
    case when s.type::text in ('MV_DISTRIBUTION','MV_BROADCAST')
      then coalesce(nullif(btrim(s.artist_name_kr),''),s.artist_name)
      else s.artist_name end,
    p.name,s.amount_krw,
    case when o.currency='KRW' then s.amount_krw else s.payment_amount end,
    s.is_oneclick,s.album_draft_group_id,
    array(select f.id from public.submission_files f where f.submission_id=s.id order by f.id),
    case when s.user_id is null and nullif(s.guest_token,'') is not null then encode(sha256(convert_to(s.guest_token,'UTF8')),'hex') end,
    case when s.type::text='ALBUM' then s.album_price_tier end,
    case when s.type::text='ALBUM' then s.album_base_price_krw end
  from public.submissions s left join public.packages p on p.id=s.package_id
  join public.submission_orders o on o.id=p_order_id
  where s.id=any(p_ids)
  on conflict(order_id,submission_ref) do nothing;
$$;

-- Existing album items take the tier and list price from the application
-- still attached to that order at the amount the item records. Items of
-- orders that went back to the cart stay empty: their applications no longer
-- carry the price they were ordered at. Amounts are not touched.
update public.submission_order_items i
set album_price_tier = s.album_price_tier,
    album_base_price_krw = s.album_base_price_krw
from public.submissions s
where s.id = i.submission_id
  and s.current_order_id = i.order_id
  and i.type = 'ALBUM'
  and i.album_price_tier is null
  and s.album_price_tier is not null
  and i.amount_krw is not distinct from s.amount_krw;
