import { NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import { B2ConfigError, getB2Config } from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  submissionId: z.string().uuid(),
  kind: z.string().min(1),
  key: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  guestToken: z.string().min(8).optional(),
});

const mapKind = (kind: string): "AUDIO" | "VIDEO" | "LYRICS" | "ETC" => {
  const upper = kind.toUpperCase();
  if (upper === "AUDIO" || upper === "VIDEO" || upper === "LYRICS" || upper === "ETC") {
    return upper as "AUDIO" | "VIDEO" | "LYRICS" | "ETC";
  }
  if (kind.toLowerCase() === "audio") return "AUDIO";
  if (kind.toLowerCase() === "video") return "VIDEO";
  if (kind.toLowerCase() === "lyrics") return "LYRICS";
  return "ETC";
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "업로드 정보를 확인해주세요." },
      { status: 400 },
    );
  }

  const { submissionId, kind, key, filename, mimeType, sizeBytes, guestToken } = parsed.data;

  try {
    const { user, submission, error } = await ensureSubmissionOwner(submissionId, guestToken);
    if (error === "NOT_FOUND") {
      return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    }
    if (error === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    if (error === "FORBIDDEN") {
      return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    }

    const { client, bucket } = getB2Config();
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    const contentLength = head.ContentLength ?? 0;
    if (contentLength !== sizeBytes) {
      return NextResponse.json(
        {
          error: "업로드된 파일 크기가 일치하지 않습니다.",
          expected: sizeBytes,
          actual: contentLength,
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const payload = {
      submission_id: submissionId,
      kind: mapKind(kind),
      file_path: key,
      object_key: key,
      original_name: filename,
      mime: mimeType,
      size: sizeBytes,
      storage_provider: "b2",
      status: "UPLOADED",
      uploaded_at: new Date().toISOString(),
    };
    let attachmentId: string | null = null;
    try {
      const { data: inserted } = await admin
        .from("submission_files")
        .insert(payload)
        .select("id")
        .maybeSingle();
      attachmentId = inserted?.id ?? null;
    } catch (error) {
      console.error("[Upload][complete] failed to record file", {
        submissionId,
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    console.info("[Upload][complete] ok", {
      submissionId,
      kind,
      key,
      sizeBytes,
      etag: head.ETag,
      user: user?.id ?? null,
      guest: Boolean(submission?.guest_token ?? guestToken),
      tookMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      verified: true,
      etag: head.ETag,
      contentLength,
      attachmentId,
      key,
      submissionId,
    });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "업로드 확인 중 오류가 발생했습니다.";
    console.error("[Upload][complete] error", {
      submissionId,
      kind,
      key,
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
