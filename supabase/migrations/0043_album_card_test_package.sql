insert into public.packages (name, station_count, price_krw, description, is_active)
values (
  '[테스트] 카드 결제 테스트 1,000원',
  1,
  1000,
  '카드 결제 검증용 가상 음반심의 상품입니다. 테스트 완료 후 관리자 설정에서 삭제할 수 있습니다.',
  true
)
on conflict (name) do update
set station_count = excluded.station_count,
    price_krw = excluded.price_krw,
    description = excluded.description,
    is_active = excluded.is_active;
