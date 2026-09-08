import { revalidatePath } from "next/cache";
import { z } from "zod";

import { clearDashboardStatusCache } from "@/lib/dashboard-status";
import { readBoundedJsonBody } from "@/lib/request-body";
import { returnSubmissionOrderToCart } from "@/lib/submission-orders";
import { checkOrderRequest, orderGuestTokensSchema, orderJson } from "@/lib/submission-orders-http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const returnSchema = z.object({ orderId: z.string().uuid(), guestTokensBySubmissionId: orderGuestTokensSchema.default({}) }).strict();

export async function POST(request: Request) {
  const denied = checkOrderRequest(request, true);
  if (denied) return denied;
  const body = await readBoundedJsonBody(request, 32 * 1024);
  if (!body.ok) return orderJson({ error: "변경할 주문 정보를 확인해주세요." }, body.reason === "too_large" ? 413 : 400);
  const parsed = returnSchema.safeParse(body.value);
  if (!parsed.success) return orderJson({ error: "변경할 주문 정보를 확인해주세요." }, 400);
  const user = await getServerSessionUser(await createServerSupabase());
  try {
    const result = await returnSubmissionOrderToCart(createAdminClient(), parsed.data.orderId, {
      userId: user?.id ?? null, guestTokensBySubmissionId: parsed.data.guestTokensBySubmissionId,
    });
    if (!result.ok) return orderJson({ error: result.error }, result.status);
    for (const prefix of ["", "/en"]) for (const area of ["/mypage", "/dashboard"]) {
      revalidatePath(`${prefix}${area}`);
      revalidatePath(`${prefix}${area}/orders`);
      revalidatePath(`${prefix}${area}/cart`);
      for (const id of result.submissionIds) revalidatePath(`${prefix}${area}/submissions/${id}`);
    }
    if (user) clearDashboardStatusCache(user.id);
    return orderJson(result);
  } catch {
    return orderJson({ error: "주문 상태를 변경하지 못했습니다. 새로고침 후 다시 시도해주세요." }, 500);
  }
}
