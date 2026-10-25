import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getReviewSummaryEmailPreviewById, sendReviewSummaryNotificationById } from "@/lib/admin/submission-notifications";
import { readBoundedDeskBody } from "@/lib/admin/review-desk-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const sendSchema = z.object({ requestId: z.string().uuid(), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), expectedUpdatedAt: z.string().datetime({ offset: true }) });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function authorize(context: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase();
  const [{ data: { user } }, { data: admin, error }] = await Promise.all([supabase.auth.getUser(), supabase.rpc("is_admin")]);
  if (!user || error || admin !== true) return { error: json({ error: "관리자 권한이 필요합니다." }, 403) };
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return { error: json({ error: "접수 ID를 확인해주세요." }, 400) };
  return { id };
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(context);
  if (auth.error) return auth.error;
  try { return json(await getReviewSummaryEmailPreviewById({ submissionId: auth.id! })); }
  catch (error) {
    if (error instanceof Error && error.name === "ReviewEmailPreviewError" && "status" in error && typeof error.status === "number") return json({ error: error.message }, error.status);
    return json({ error: "이메일 미리보기를 불러오지 못했습니다. 다시 시도해주세요." }, 503);
  }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(context);
  if (auth.error) return auth.error;
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "JSON 형식으로 요청해주세요." }, 415);
  let bytes: Buffer;
  try { bytes = await readBoundedDeskBody(request, 4096); }
  catch { return json({ error: "요청 크기를 확인해주세요." }, 413); }
  const parsed = sendSchema.safeParse(await Promise.resolve().then(() => JSON.parse(bytes.toString("utf8"))).catch(() => null));
  if (!parsed.success) return json({ error: "최신 이메일 미리보기를 확인한 뒤 발송해주세요." }, 400);
  try {
    const notification = await sendReviewSummaryNotificationById({ submissionId: auth.id!, ...parsed.data });
    if (notification.errorCode) return json({ error: notification.error, errorCode: notification.errorCode }, notification.errorCode === "CONFLICT" ? 409 : notification.errorCode === "LOAD_FAILED" ? 503 : 400);
    revalidatePath("/admin/submissions/detail");
    return json({ ok: true, notification, warning: notification.warning });
  } catch { return json({ error: "이메일 발송 상태를 확인하지 못했습니다. 발송 내역을 확인해주세요." }, 503); }
}
