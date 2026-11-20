-- An administrator may delete a paid application (20261119200000; the order
-- keeps the money record). Deleting only the full-price album of a paid
-- multi-album order always failed: the foreign key's ON DELETE SET NULL clears
-- the half-price album's base pointer, and this deferred check then found no
-- paid full-price album at commit and rolled the deletion back
-- (ALBUM_DISCOUNT_NOT_ELIGIBLE), shown as 접수 삭제에 실패했습니다.
--
-- Identical to 20261114120000 except for the second early return: a pointer
-- cleared because its full-price album no longer exists, with nothing about
-- the payment changing, is not a new payment to check. Clearing it while the
-- full-price album exists, or any change that makes the album paid or alters
-- its price, is still checked.
create or replace function public.enforce_paid_album_discount_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_paid_base boolean;
begin
  if tg_op = 'UPDATE'
    and old.payment_status is not distinct from new.payment_status
    and old.amount_krw is not distinct from new.amount_krw
    and old.package_id is not distinct from new.package_id
    and old.is_oneclick is not distinct from new.is_oneclick
    and old.user_id is not distinct from new.user_id
    and old.guest_token is not distinct from new.guest_token
    and old.album_base_price_krw is not distinct from new.album_base_price_krw
    and old.album_price_tier is not distinct from new.album_price_tier
    and old.album_discount_base_submission_id
      is not distinct from new.album_discount_base_submission_id
  then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.album_discount_base_submission_id is not null
    and new.album_discount_base_submission_id is null
    and old.payment_status is not distinct from new.payment_status
    and old.amount_krw is not distinct from new.amount_krw
    and old.package_id is not distinct from new.package_id
    and old.is_oneclick is not distinct from new.is_oneclick
    and old.user_id is not distinct from new.user_id
    and old.guest_token is not distinct from new.guest_token
    and old.album_base_price_krw is not distinct from new.album_base_price_krw
    and old.album_price_tier is not distinct from new.album_price_tier
    and not exists (
      select 1 from public.submissions base
      where base.id = old.album_discount_base_submission_id
    )
  then
    return new;
  end if;

  if new.type = 'ALBUM' and new.payment_status = 'PAID' then
    perform public.assert_album_price_snapshots(array[new.id]);

    if new.album_price_tier = 'ADDITIONAL' then
      select exists (
        select 1
        from public.submissions paid_base
        where paid_base.id = new.album_discount_base_submission_id
          and paid_base.id <> new.id
          and paid_base.type = 'ALBUM'
          and paid_base.payment_status = 'PAID'
          and paid_base.album_price_tier = 'FULL'
          and paid_base.album_base_price_krw >= new.album_base_price_krw
          and paid_base.amount_krw = paid_base.album_base_price_krw
          and (
            (new.user_id is not null and paid_base.user_id = new.user_id)
            or (new.user_id is null and paid_base.user_id is null)
          )
      ) into v_has_paid_base;

      if not coalesce(v_has_paid_base, false) then
        raise exception 'ALBUM_DISCOUNT_NOT_ELIGIBLE:%', new.id
          using errcode = '55000';
      end if;
    end if;
  end if;
  return new;
end;
$$;
