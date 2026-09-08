import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Payment choices now create an order from the cart. This legacy endpoint
 * must never mutate a submission or bypass an existing order's payment state. */
export async function PATCH() {
  return NextResponse.json(
    {
      error: "결제 수단은 장바구니에서 선택해주세요. 진행 중인 결제는 주문 내역에서 확인할 수 있습니다.",
      cartHref: "/mypage/cart",
      ordersHref: "/mypage/orders",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export const POST = PATCH;
