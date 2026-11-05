import { revalidatePath } from "next/cache";

import { requireAdminForApi } from "@/lib/admin/api-auth";
import { directIntakeSchema, MV_BROADCAST_CODES, registerDirectIntake } from "@/lib/admin/direct-intake";
import { listGuestAlbumIntakePackages } from "@/lib/admin/guest-album-intake";
import { readBoundedJsonBody } from "@/lib/request-body";
import { ensureArtistByName } from "@/lib/artist";
import { createAdminClient } from "@/lib/supabase/admin";
import { MV_BASE_ONLINE_PRICE_KRW, MV_ONLINE_OPTION_CODES, MV_STATION_PRICE_KRW } from "@/lib/submission-station-selection";
import { buildUrl, getBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Packages and MV prices for the direct intake form. */
export async function GET() {
  const auth = await requireAdminForApi();
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    return json({
      packages: await listGuestAlbumIntakePackages(createAdminClient()),
      mv: {
        basePriceKrw: MV_BASE_ONLINE_PRICE_KRW,
        onlineOptions: MV_ONLINE_OPTION_CODES.map((code) => ({ code, priceKrw: MV_STATION_PRICE_KRW[code] })),
        broadcastStations: MV_BROADCAST_CODES.map((code) => ({ code, priceKrw: MV_STATION_PRICE_KRW[code] })),
      },
    });
  } catch {
    return json({ error: "패키지 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }
}

/** Creates the guest submission from the checked draft. */
export async function POST(request: Request) {
  const auth = await requireAdminForApi();
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return json({ error: "JSON 형식으로 요청해주세요." }, 415);
  }
  const body = await readBoundedJsonBody(request, 3 * 1024 * 1024);
  if (!body.ok) return json({ error: body.reason === "too_large" ? "입력 내용이 너무 큽니다." : "접수 정보를 확인해주세요." }, body.reason === "too_large" ? 413 : 400);
  const parsed = directIntakeSchema.safeParse(body.value);
  if (!parsed.success) {
    return json({ error: "접수 정보를 확인해주세요. 제목·아티스트·고객 이름이 필요하고, 음반은 곡 제목이 있는 트랙이 1곡 이상 있어야 합니다. 이메일과 날짜(2026-11-05) 형식도 확인해주세요." }, 400);
  }
  const result = await registerDirectIntake(createAdminClient(), parsed.data, {
    actorUserId: auth.user.id,
    ensureArtist: ensureArtistByName,
  });
  if (!result.ok) return json({ error: result.error }, result.status);
  for (const path of ["/admin", "/admin/submissions", `/admin/submissions/${result.submissionId}`]) revalidatePath(path);
  return json({
    ok: true,
    created: result.created,
    submissionId: result.submissionId,
    guestToken: result.guestToken,
    trackUrl: buildUrl(`/track/${encodeURIComponent(result.guestToken)}`, getBaseUrl()),
    detailPath: `/admin/submissions/${encodeURIComponent(result.submissionId)}`,
  });
}
