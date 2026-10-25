import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { B2ConfigError } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOnlineMvResultNotificationById } from "@/lib/admin/submission-notifications";
import { MAX_CERTIFICATE_BYTES, saveManagedCertificate } from "@/lib/admin/certificate-save";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
const MAX_SIZE_BYTES = MAX_CERTIFICATE_BYTES;

const normalizeUploadedFilename = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "certificate";

  const likelyMojibake =
    /[\u0080-\u009F]/.test(trimmed) ||
    /(Ã.|Â.|á.|ì.|í.|ò.|ó.|ô.|õ.|ö.)/.test(trimmed);
  if (!likelyMojibake) return trimmed;

  try {
    const decoded = Buffer.from(trimmed, "latin1").toString("utf8").trim();
    return decoded || trimmed;
  } catch {
    return trimmed;
  }
};

const inferCertificateMimeType = (file: File, fallback?: string | null) => {
  const mimeType = (fallback || file.type || "").toLowerCase();
  if (ALLOWED_TYPES.has(mimeType)) return mimeType;

  const filename = file.name.toLowerCase();
  if (filename.endsWith(".pdf")) return "application/pdf";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  return mimeType || "application/octet-stream";
};

const readFormString = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
};

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");

  if (!user || isAdmin !== true) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "multipart/form-data 형식이 아닙니다." }, { status: 415 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "업로드 데이터를 찾을 수 없습니다." }, { status: 400 });
  }
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SIZE_BYTES + 64 * 1024) {
    return NextResponse.json(
      { error: "파일 크기가 허용 범위를 초과했습니다." },
      { status: 413 },
    );
  }

  const { id: submissionId } = await context.params;
  if (!z.string().uuid().safeParse(submissionId).success) {
    return NextResponse.json({ error: "유효하지 않은 접수 ID입니다." }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: submission } = await admin
    .from("submissions")
    .select("id, type, certificate_b2_path")
    .eq("id", submissionId)
    .maybeSingle();

  if (!submission) {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (submission.type !== "MV_DISTRIBUTION") {
    return NextResponse.json(
      { error: "온라인 업로드용 뮤직비디오 심의만 필증을 업로드할 수 있습니다." },
      { status: 400 },
    );
  }

  const formData = await req.formData().catch((error) => {
    console.error("[certificate][upload] formData parse failed", error);
    return null;
  });

  if (!formData) {
    return NextResponse.json(
      { error: "업로드 데이터를 읽지 못했습니다." },
      { status: 400 },
    );
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    return NextResponse.json({ error: "파일이 포함되어 있지 않습니다." }, { status: 400 });
  }

  const sizeBytes = fileValue.size;
  if (!sizeBytes || Number.isNaN(sizeBytes)) {
    return NextResponse.json(
      { error: "파일 크기를 확인할 수 없습니다." },
      { status: 400 },
    );
  }
  if (sizeBytes > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "파일 크기가 허용 범위를 초과했습니다." },
      { status: 400 },
    );
  }

  const mimeType = inferCertificateMimeType(
    fileValue,
    readFormString(formData, "mimeType"),
  );
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "허용되지 않은 파일 형식입니다." }, { status: 400 });
  }

  const filenameRaw = normalizeUploadedFilename(
    readFormString(formData, "filename") || fileValue.name || "certificate",
  );
  const expectedUpdatedAt = readFormString(formData, "expectedUpdatedAt");
  const requestId = readFormString(formData, "requestId");
  if (!z.string().datetime({ offset: true }).safeParse(expectedUpdatedAt).success || !z.string().uuid().safeParse(requestId).success) {
    return NextResponse.json({ error: "최신 변경 시각과 업로드 요청 정보를 확인해주세요." }, { status: 400 });
  }

  try {
    const saved = await saveManagedCertificate(admin, {
      actorUserId: user.id, submissionId, expectedUpdatedAt, requestId,
      body: Buffer.from(await fileValue.arrayBuffer()), filename: filenameRaw, declaredMime: mimeType,
    });
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
    for (const path of ["/admin/submissions", "/admin/submissions/detail", "/dashboard", "/mypage", "/track", `/dashboard/submissions/${submissionId}`]) revalidatePath(path);
    // Repeated upload requests use the same bundle key. A successful file save
    // can be retried after mail preparation fails without duplicating accepted mail.
    const notification = await sendOnlineMvResultNotificationById({ submissionId });
    return NextResponse.json({
      ok: true, unchanged: !saved.changed, certificate: saved.certificate,
      warning: notification.warning, pendingAssets: notification.pendingAssets,
      deliveredCount: notification.deliveredCount, queuedCount: notification.queuedCount ?? 0,
    });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
        : "업로드 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
