import Busboy from "busboy";
import { NextRequest, NextResponse } from "next/server";
import { PassThrough, Readable } from "stream";
import { ReadableStream as NodeReadableStream } from "stream/web";
import { Upload } from "@aws-sdk/lib-storage";

import { B2ConfigError, getB2Config, sanitizeFileName } from "@/lib/b2";
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

type FilePart = {
  stream: PassThrough;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
};

type UploadMeta = {
  filenameRaw: string;
  mimeType: string;
  sizeBytes: number;
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

  const { id: submissionId } = await context.params;
  const admin = createAdminClient();
  const { data: submission } = await admin
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .maybeSingle();

  if (!submission) {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }

  const fields: Record<string, string> = {};
  let filePart: FilePart | null = null;
  let objectKey: string | null = null;
  let uploadPromise: Promise<unknown> | null = null;
  let parseErrorStatus: number | null = null;
  let parseErrorBody: { error: string; detail?: string } | null = null;
  let uploadMeta: UploadMeta | null = null;

  const busboy = Busboy({ headers: { "content-type": contentType } });
  busboy.on("field", (name, value) => {
    fields[name] = value;
    tryStartUpload();
  });
  const parsePromise = new Promise<void>((resolve, reject) => {
    busboy.on("finish", resolve);
    busboy.on("error", (error) => {
      if (parseErrorStatus === null) {
        parseErrorStatus = 400;
        parseErrorBody = {
          error: "업로드 데이터를 읽지 못했습니다.",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      reject(error);
    });
  });
  busboy.on("file", (_name, file, info) => {
    if (filePart) {
      file.resume();
      return;
    }
    const pass = new PassThrough();
    file.pipe(pass);
    filePart = {
      stream: pass,
      filename: info.filename,
      mimeType: info.mimeType,
      sizeBytes: Number(fields.sizeBytes ?? 0) || undefined,
    };
    tryStartUpload();
  });

  const tryStartUpload = () => {
    if (uploadPromise || parseErrorStatus !== null || !filePart) return;

    const filenameCandidate =
      fields.filename?.trim() || filePart.filename || "certificate";
    const filenameRaw = normalizeUploadedFilename(filenameCandidate);
    const mimeType = (
      filePart.mimeType ||
      fields.mimeType ||
      "application/octet-stream"
    ).toLowerCase();
    const sizeBytes = Number(fields.sizeBytes || filePart.sizeBytes || 0);

    if (!filenameRaw || !sizeBytes || Number.isNaN(sizeBytes)) {
      return;
    }

    if (!ALLOWED_TYPES.has(mimeType)) {
      parseErrorStatus = 400;
      parseErrorBody = { error: "허용되지 않은 파일 형식입니다." };
      filePart.stream.resume();
      return;
    }

    if (sizeBytes > MAX_SIZE_BYTES) {
      parseErrorStatus = 400;
      parseErrorBody = { error: "파일 크기가 허용 범위를 초과했습니다." };
      filePart.stream.resume();
      return;
    }

    try {
      const { client, bucket } = getB2Config();
      const safeName = sanitizeFileName(filenameRaw) || "certificate";
      const nextObjectKey = `submissions/${submissionId}/certificate/${Date.now()}_${safeName}`;

      objectKey = nextObjectKey;
      uploadMeta = {
        filenameRaw,
        mimeType,
        sizeBytes,
      };

      const uploader = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: nextObjectKey,
          Body: filePart.stream,
          ContentType: mimeType || undefined,
          ContentLength: sizeBytes,
        },
        leavePartsOnError: false,
      });

      uploadPromise = uploader.done();
    } catch (error) {
      const message =
        error instanceof B2ConfigError
          ? error.message
          : error instanceof Error
            ? error.message
            : "업로드 중 오류가 발생했습니다.";
      parseErrorStatus = 500;
      parseErrorBody = { error: message };
      filePart.stream.resume();
    }
  };

  try {
    const webStream = req.body as unknown as NodeReadableStream;
    Readable.fromWeb(webStream).pipe(busboy as unknown as NodeJS.WritableStream);
    await parsePromise;
  } catch (error) {
    return NextResponse.json(
      { error: "업로드 데이터를 읽지 못했습니다.", detail: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  tryStartUpload();

  if (parseErrorStatus !== null && parseErrorBody) {
    return NextResponse.json(parseErrorBody, { status: parseErrorStatus });
  }

  if (!filePart) {
    return NextResponse.json({ error: "파일이 포함되어 있지 않습니다." }, { status: 400 });
  }
  if (!objectKey || !uploadPromise || !uploadMeta) {
    return NextResponse.json(
      { error: "파일 업로드를 시작하지 못했습니다." },
      { status: 400 },
    );
  }

  const uploadedFile = uploadMeta as UploadMeta;
  const uploadedObjectKey = objectKey;
  const startedUpload = uploadPromise;

  try {
    await startedUpload;

    const { error: updateError } = await admin
      .from("submissions")
      .update({
        certificate_b2_path: uploadedObjectKey,
        certificate_original_name: uploadedFile.filenameRaw,
        certificate_mime: uploadedFile.mimeType,
        certificate_size: uploadedFile.sizeBytes,
        certificate_uploaded_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    if (updateError) {
      return NextResponse.json({ error: "필증 정보를 저장하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, objectKey });
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
