import { NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import { B2ConfigError, getB2Config } from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z
  .object({
    submissionId: z.string().uuid(),
    key: z.string().min(1).optional(),
    objectKey: z.string().min(1).optional(),
    filename: z.string().min(1).optional(),
    kind: z.string().optional(),
    mimeType: z.string().optional(),
    sizeBytes: z.number().int().positive(),
    guestToken: z.string().min(8).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.key && !data.objectKey) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: "key 또는 objectKey가 필요합니다.",
      });
    }
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

const inferKind = (filename: string | undefined, mimeType: string | undefined): "AUDIO" | "VIDEO" | "LYRICS" | "ETC" => {
  const mime = (mimeType || "").toLowerCase();
  const name = (filename || "").toLowerCase();
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.includes("text") || name.endsWith(".lrc") || name.endsWith(".txt")) return "LYRICS";
  if (name.match(/\.(wav|mp3|flac|aiff|aac|m4a|ogg)$/)) return "AUDIO";
  if (name.match(/\.(mp4|mov|mkv|webm)$/)) return "VIDEO";
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

  const { submissionId, guestToken, sizeBytes } = parsed.data;
  const rawKey = parsed.data.key ?? parsed.data.objectKey ?? "";
  const normalizedKey = rawKey;
  const normalizedFilename =
    parsed.data.filename ||
    (() => {
      const parts = normalizedKey.split("/");
      return parts[parts.length - 1] || normalizedKey;
    })();
  const normalizedMime = parsed.data.mimeType || "application/octet-stream";
  const normalizedKind = parsed.data.kind
    ? mapKind(parsed.data.kind)
    : inferKind(normalizedFilename, normalizedMime);

  if (!normalizedKey) {
    return NextResponse.json({ error: "업로드 정보를 확인해주세요." }, { status: 400 });
  }

  console.info("[Upload][complete] normalized", {
    submissionId,
    hadKey: Boolean(parsed.data.key),
    hadObjectKey: Boolean(parsed.data.objectKey),
    inferredKind: !parsed.data.kind,
  });

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
        Key: normalizedKey,
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
      kind: normalizedKind,
      file_path: normalizedKey,
      object_key: normalizedKey,
      original_name: normalizedFilename,
      mime: normalizedMime,
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
        key: normalizedKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    console.info("[Upload][complete] ok", {
      submissionId,
      kind: normalizedKind,
      key: normalizedKey,
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
      key: normalizedKey,
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
      kind: normalizedKind,
      key: normalizedKey,
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
