import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { clearDashboardStatusCache } from "@/lib/dashboard-status";
import { readBoundedJsonBody } from "@/lib/request-body";
import { consumeRateLimit, getRequestIdentifier } from "@/lib/request-rate-limit";
import { reopenSubmissionCart } from "@/lib/submission-cart-reopen";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";
import { getBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  submissionIds: z.array(z.string().uuid()).min(1).max(100),
  guestTokensBySubmissionId: z.record(
    z.string().uuid(),
    z.string().min(8).max(120).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)),
  ).optional(),
}).strict().refine(value => Object.keys(value.guestTokensBySubmissionId ?? {})
  .every(id => value.submissionIds.includes(id)));

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // Render's internal URL can differ from the configured public HTTPS origin.
  // Forwarded host headers are deliberately excluded from this allowlist.
  if (
    (origin && origin !== new URL(request.url).origin && origin !== getBaseUrl()) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return NextResponse.json({ error: "같은 사이트에서 다시 요청해주세요." }, { status: 403 });
  }
  const rateLimit = consumeRateLimit({
    namespace: "cart-reopen-ip",
    identifier: getRequestIdentifier(request.headers),
    limit: 20,
    windowMs: 15 * 60 * 1_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "결제 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }
  const body = await readBoundedJsonBody(request, 32 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "결제 수단을 다시 선택할 신청서를 확인해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "결제 수단을 다시 선택할 신청서를 확인해주세요." },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);
  const result = await reopenSubmissionCart(createAdminClient(), {
    submissionIds: parsed.data.submissionIds,
    userId: user?.id ?? null,
    guestTokensBySubmissionId: parsed.data.guestTokensBySubmissionId ?? {},
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  for (const prefix of ["", "/en"]) {
    for (const area of ["/dashboard", "/mypage"]) {
      revalidatePath(`${prefix}${area}/cart`);
      revalidatePath(`${prefix}${area}`);
      for (const id of result.reopenedIds) {
        revalidatePath(`${prefix}${area}/submissions/${id}`);
      }
    }
  }
  if (user) clearDashboardStatusCache(user.id);
  return NextResponse.json(result);
}
