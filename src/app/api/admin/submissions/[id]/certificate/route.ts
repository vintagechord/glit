import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { B2ConfigError, deleteObject, getB2Config, sanitizeFileName } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

const detectCertificateMimeType = (body: Buffer) => {
  if (body.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (
    body.length >= 8 &&
    body.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
};

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
  const safeName = sanitizeFileName(filenameRaw) || "certificate";
  const uploadedAt = new Date().toISOString();
  const uploadedObjectKey = `submissions/${submissionId}/certificate/${Date.now()}_${safeName}`;

  try {
    const { client, bucket } = getB2Config();
    const body = Buffer.from(await fileValue.arrayBuffer());
    const detectedMimeType = detectCertificateMimeType(body);
    if (!detectedMimeType || detectedMimeType !== mimeType) {
      return NextResponse.json(
        { error: "파일 내용과 형식이 일치하지 않습니다." },
        { status: 400 },
      );
    }

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: uploadedObjectKey,
        Body: body,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      }),
    );

    const { error: updateError } = await admin
      .from("submissions")
      .update({
        certificate_b2_path: uploadedObjectKey,
        certificate_original_name: filenameRaw,
        certificate_mime: mimeType,
        certificate_size: sizeBytes,
        certificate_uploaded_at: uploadedAt,
      })
      .eq("id", submissionId);

    if (updateError) {
      await deleteObject(uploadedObjectKey).catch((cleanupError) => {
        console.warn("[certificate][upload] rollback delete failed", {
          uploadedObjectKey,
          cleanupError,
        });
      });
      return NextResponse.json({ error: "필증 정보를 저장하지 못했습니다." }, { status: 500 });
    }

    const previousObjectKey = submission.certificate_b2_path?.trim();
    if (previousObjectKey && previousObjectKey !== uploadedObjectKey) {
      await deleteObject(previousObjectKey).catch((cleanupError) => {
        console.warn("[certificate][upload] previous delete failed", {
          previousObjectKey,
          cleanupError,
        });
      });
    }

    return NextResponse.json({
      ok: true,
      certificate: {
        objectKey: uploadedObjectKey,
        originalName: filenameRaw,
        uploadedAt,
      },
    });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "업로드 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
