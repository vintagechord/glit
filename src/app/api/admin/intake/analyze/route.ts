import { requireAdminForApi } from "@/lib/admin/api-auth";
import { analyzeReferenceFile, intakeKinds, ReferenceImportError, type IntakeKind } from "@/lib/admin/reference-import";
import { SERVER_UPLOAD_MAX_BYTES, SERVER_UPLOAD_MAX_LABEL } from "@/lib/server-upload-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Reads a reference application form and returns an editable draft. Nothing is saved. */
export async function POST(request: Request) {
  const auth = await requireAdminForApi();
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "같은 사이트에서 다시 요청해주세요." }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > SERVER_UPLOAD_MAX_BYTES + 64 * 1024) {
    return json({ error: `신청서 파일은 ${SERVER_UPLOAD_MAX_LABEL} 이하만 분석할 수 있습니다.` }, 413);
  }
  let form: FormData;
  try { form = await request.formData(); }
  catch { return json({ error: "신청서 파일을 다시 선택해주세요." }, 400); }
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");
  if (!intakeKinds.includes(kind as IntakeKind)) return json({ error: "음반 또는 뮤직비디오 심의 유형을 선택해주세요." }, 400);
  if (!(file instanceof File) || !file.size) return json({ error: "신청서 파일을 선택해주세요." }, 400);
  if (file.size > SERVER_UPLOAD_MAX_BYTES) return json({ error: `신청서 파일은 ${SERVER_UPLOAD_MAX_LABEL} 이하만 분석할 수 있습니다.` }, 413);
  try {
    const draft = await analyzeReferenceFile({
      body: Buffer.from(await file.arrayBuffer()),
      fileName: file.name.slice(0, 255) || "reference",
      kind: kind as IntakeKind,
    });
    return json({ draft });
  } catch (error) {
    if (error instanceof ReferenceImportError) return json({ error: error.message, code: error.code }, error.status);
    console.error("[admin-intake] reference analysis failed", { name: error instanceof Error ? error.name : "unknown" });
    return json({ error: "신청서를 분석하지 못했습니다. DOCX로 저장해 다시 올리거나 직접 입력해주세요." }, 500);
  }
}
