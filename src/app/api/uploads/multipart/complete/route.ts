import { NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import {
  B2ConfigError,
  completeMultipartUpload,
  getB2Config,
  presignGetUrl,
} from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  submissionId: z.string().uuid(),
  key: z.string().min(1),
  uploadId: z.string().min(1),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string().min(1),
      }),
    )
    .min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  kind: z.string().optional(),
  checksum: z.string().min(8).optional(),
  durationSeconds: z.number().nonnegative().optional(),
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

const inferKind = (filename: string, mimeType: string): "AUDIO" | "VIDEO" | "LYRICS" | "ETC" => {
  const mime = (mimeType || "").toLowerCase();
  const name = (filename || "").toLowerCase();
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.includes("text") || name.endsWith(".lrc") || name.endsWith(".txt")) return "LYRICS";
  if (name.match(/\.(wav|mp3|flac|aiff|aac|m4a|ogg)$/)) return "AUDIO";
  if (name.match(/\.(mp4|mov|mkv|webm)$/)) return "VIDEO";
  return "ETC";
};

const keyMatchesSubmission = (key: string, submissionId: string) =>
  key.includes(`/${submissionId}/`);

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

  const {
    submissionId,
    key,
    uploadId,
    parts,
    filename,
    mimeType,
    sizeBytes,
    kind,
    checksum,
    durationSeconds,
    guestToken,
  } = parsed.data;

  const normalizedKind = kind ? mapKind(kind) : inferKind(filename, mimeType);

  try {
    const { user, submission, error } = await ensureSubmissionOwner(
      submissionId,
      guestToken,
    );
    if (error === "NOT_FOUND") {
      return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    }
    if (error === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    if (error === "FORBIDDEN") {
      return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    }
    if (!keyMatchesSubmission(key, submissionId)) {
      return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    }

    await completeMultipartUpload({
      objectKey: key,
      uploadId,
      parts: parts.map((part) => ({
        partNumber: part.partNumber,
        etag: part.etag,
      })),
    });

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
    const accessUrl = await presignGetUrl(
      key,
      Number(process.env.B2_ACCESS_URL_EXPIRES_SECONDS ?? "86400"),
    ).catch(() => null);
    const payload = {
      submission_id: submissionId,
      kind: normalizedKind,
      file_path: key,
      object_key: key,
      original_name: filename,
      mime: mimeType,
      size: sizeBytes,
      checksum: checksum ?? null,
      duration_seconds: durationSeconds ?? null,
      access_url: accessUrl,
      storage_provider: "b2",
      status: "UPLOADED",
      uploaded_at: new Date().toISOString(),
    };
    let attachmentId: string | null = null;
    try {
      let insertPayload = { ...payload } as Record<string, unknown>;
      let inserted:
        | { id?: string | null }
        | null
        | undefined;
      let insertError: { code?: string; message?: string } | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const result = await admin
          .from("submission_files")
          .insert(insertPayload)
          .select("id")
          .maybeSingle();
        inserted = result.data as { id?: string | null } | null;
        insertError = result.error as { code?: string; message?: string } | null;
        if (!insertError) {
          break;
        }
        if (insertError.code === "PGRST204") {
          const match = insertError.message?.match(/column \"(.+?)\"/);
          const missing = match?.[1];
          if (missing && missing in insertPayload) {
            const nextPayload = { ...insertPayload };
            delete nextPayload[missing];
            insertPayload = nextPayload;
            continue;
          }
        }
        break;
      }
      if (insertError) {
        throw new Error(insertError.message || "파일 정보를 저장할 수 없습니다.");
      }
      attachmentId = inserted?.id ?? null;
    } catch (error) {
      console.error("[Upload][multipart][complete] failed to record file", {
        submissionId,
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    console.info("[Upload][multipart][complete] ok", {
      submissionId,
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
      accessUrl,
    });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "업로드 완료 처리 중 오류가 발생했습니다.";
    console.error("[Upload][multipart][complete] error", {
      submissionId,
      key,
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
