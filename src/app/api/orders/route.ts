import { z } from "zod";

import { readBoundedJsonBody } from "@/lib/request-body";
import { listSubmissionOrders } from "@/lib/submission-orders";
import { checkOrderRequest, orderGuestTokensSchema, orderJson, orderOffsetSchema } from "@/lib/submission-orders-http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const readSchema = z.object({ guestTokensBySubmissionId: orderGuestTokensSchema.default({}), offset: orderOffsetSchema }).strict();

export async function GET(request: Request) {
  const denied = checkOrderRequest(request);
  if (denied) return denied;
  const offset = orderOffsetSchema.safeParse(new URL(request.url).searchParams.get("offset") ?? 0);
  if (!offset.success) return orderJson({ error: "주문 조회 범위를 확인해주세요." }, 400);
  const user = await getServerSessionUser(await createServerSupabase());
  if (!user) return orderJson({ error: "로그인 또는 비회원 주문 정보가 필요합니다." }, 401);
  try {
    return orderJson(await listSubmissionOrders(createAdminClient(), { userId: user.id, guestTokensBySubmissionId: {} }, offset.data));
  } catch {
    return orderJson({ error: "주문내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." }, 500);
  }
}

export async function POST(request: Request) {
  const denied = checkOrderRequest(request);
  if (denied) return denied;
  const body = await readBoundedJsonBody(request, 32 * 1024);
  if (!body.ok) return orderJson({ error: "주문 조회 정보를 확인해주세요." }, body.reason === "too_large" ? 413 : 400);
  const parsed = readSchema.safeParse(body.value);
  if (!parsed.success) return orderJson({ error: "주문 조회 정보를 확인해주세요." }, 400);
  const user = await getServerSessionUser(await createServerSupabase());
  try {
    return orderJson(await listSubmissionOrders(createAdminClient(), {
      userId: user?.id ?? null, guestTokensBySubmissionId: parsed.data.guestTokensBySubmissionId,
    }, parsed.data.offset));
  } catch {
    return orderJson({ error: "주문내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." }, 500);
  }
}
