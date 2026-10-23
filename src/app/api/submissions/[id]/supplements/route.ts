import { NextResponse } from "next/server";
import { z } from "zod";
import { readBoundedJsonBody } from "@/lib/request-body";
import { consumeRateLimit, getRequestIdentifier } from "@/lib/request-rate-limit";
import { supplementActionSchema } from "@/lib/submission-supplements/model";
import { getSupplementContext, listSupplements, performSupplementAction, SupplementError } from "@/lib/submission-supplements/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "cache-control": "no-store, max-age=0" };
type RouteContext = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
function failure(error: unknown) {
  if (error instanceof SupplementError) return json({ error: error.message }, error.status);
  console.error("[supplements] request failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
  return json({ error: "보완 자료 처리에 실패했습니다. 업로드 완료 확인은 다시 시도할 수 있습니다." }, 503);
}

export async function GET(request: Request, route: RouteContext) {
  try {
    const { id } = await route.params;
    if (!z.string().uuid().safeParse(id).success) return json({ error: "신청 번호를 확인해주세요." }, 400);
    return json(await listSupplements(await getSupplementContext(id, request)));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, route: RouteContext) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "잘못된 요청 출처입니다." }, 403);
    const limit = consumeRateLimit({ namespace: "submission-supplements", identifier: getRequestIdentifier(request.headers), limit: 300, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) return json({ error: "요청이 많습니다. 잠시 후 다시 시도해주세요." }, 429);
    const { id } = await route.params;
    if (!z.string().uuid().safeParse(id).success) return json({ error: "신청 번호를 확인해주세요." }, 400);
    const body = await readBoundedJsonBody(request, 256 * 1024);
    if (!body.ok) return json({ error: "보완 요청을 확인해주세요." }, body.reason === "too_large" ? 413 : 400);
    const parsed = supplementActionSchema.safeParse(body.value);
    if (!parsed.success) return json({ error: "파일 정보와 요청 내용을 확인해주세요. 파일은 0바이트 초과, 최대 4GB까지 가능합니다." }, 400);
    const context = await getSupplementContext(id, request);
    return json({ ok: true, ...await performSupplementAction(context, parsed.data) });
  } catch (error) { return failure(error); }
}
