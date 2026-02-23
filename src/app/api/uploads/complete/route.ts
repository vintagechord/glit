import { NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import { B2ConfigError, getB2Config, presignGetUrl } from "@/lib/b2";
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
    checksum: z.string().min(8).optional(),
    durationSeconds: z.number().nonnegative().optional(),
    accessUrl: z.string().url().optional(),
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
  const providedAccessUrl = parsed.data.accessUrl;

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
    let accessUrl: string | null = providedAccessUrl ?? null;
    if (!accessUrl) {
      const expires = Number(process.env.B2_ACCESS_URL_EXPIRES_SECONDS ?? "86400");
      accessUrl = await presignGetUrl(normalizedKey, expires).catch(() => null);
    }
    const payload = {
      submission_id: submissionId,
      kind: normalizedKind,
      file_path: normalizedKey,
      object_key: normalizedKey,
      original_name: normalizedFilename,
      mime: normalizedMime,
      size: sizeBytes,
      checksum: parsed.data.checksum ?? null,
      duration_seconds: parsed.data.durationSeconds ?? null,
      access_url: accessUrl,
      storage_provider: "b2",
      status: "UPLOADED",
      uploaded_at: new Date().toISOString(),
    };
    let attachmentId: string | null = null;
    try {
      let existingId: string | null = null;
      const existingResult = await admin
        .from("submission_files")
        .select("id")
        .eq("submission_id", submissionId)
        .eq("kind", normalizedKind)
        .eq("file_path", normalizedKey)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!existingResult.error && existingResult.data?.id) {
        existingId = existingResult.data.id;
      }

      if (existingId) {
        let updatePayload = { ...payload } as Record<string, unknown>;
        let updateError: { code?: string; message?: string } | null = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const result = await admin
            .from("submission_files")
            .update(updatePayload)
            .eq("id", existingId);
          updateError = result.error as { code?: string; message?: string } | null;
          if (!updateError) {
            break;
          }
          if (updateError.code === "PGRST204") {
            const match = updateError.message?.match(/column \"(.+?)\"/);
            const missing = match?.[1];
            if (missing && missing in updatePayload) {
              const nextPayload = { ...updatePayload };
              delete nextPayload[missing];
              updatePayload = nextPayload;
              continue;
            }
          }
          break;
        }
        if (updateError) {
          throw new Error(updateError.message || "파일 정보를 갱신할 수 없습니다.");
        }
        attachmentId = existingId;
      } else {
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
      }
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
      accessUrl,
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
