import Busboy from "busboy";
import { NextResponse } from "next/server";
import { PassThrough, Readable } from "stream";
import { ReadableStream as NodeReadableStream } from "stream/web";
import { Upload } from "@aws-sdk/lib-storage";

import {
  B2ConfigError,
  buildObjectKey,
  deleteObject,
  getB2Config,
  presignGetUrl,
} from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

const getObjectKeyFromRequest = (request: Request) => {
  const url = new URL(request.url);
  const value = url.searchParams.get("objectKey")?.trim() ?? "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
};

const getAllowedKeyKind = (objectKey: string) => {
  try {
    const { prefix } = getB2Config();
    if (objectKey.startsWith(`${prefix}artist-thumbnails/`)) return "thumbnail";
    if (objectKey.startsWith(`${prefix}admin-free/`)) return "admin";
    return null;
  } catch {
    return null;
  }
};

const isAllowedAdminFreeKey = (objectKey: string) =>
  getAllowedKeyKind(objectKey) !== null;

const ensureAdmin = async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  return { user, isAdmin };
};

export async function GET(request: Request) {
  const objectKey = getObjectKeyFromRequest(request);
  const keyKind = objectKey ? getAllowedKeyKind(objectKey) : null;
  if (!keyKind) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Artist thumbnails are intentionally rendered in member-facing pages.
  // Other files in this admin upload area must never be anonymously presigned.
  if (keyKind === "admin") {
    const { user, isAdmin } = await ensureAdmin();
    if (!user || isAdmin !== true) {
      return new NextResponse("Not Found", { status: 404 });
    }
  }

  try {
    const signedUrl = await presignGetUrl(objectKey, 60 * 10);
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: {
        "Cache-Control": "private, max-age=300, stale-while-revalidate=60",
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}

export async function POST(request: Request) {
  const { user, isAdmin } = await ensureAdmin();

  if (!user || !isAdmin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "multipart/form-data 형식이 아닙니다." }, { status: 415 });
  }

  if (!request.body) {
    return NextResponse.json({ error: "업로드 데이터를 찾을 수 없습니다." }, { status: 400 });
  }

  type FilePart = {
    stream: PassThrough;
    filename?: string;
    mimeType?: string;
    sizeBytes: number;
  };

  const fields: Record<string, string> = {};
  let filePart: FilePart | null = null;
  let objectKey: string | null = null;
  let uploadPromise: Promise<unknown> | null = null;
  let parseErrorStatus: number | null = null;
  let parseErrorBody: { error: string; detail?: string } | null = null;

  const busboy = Busboy({
    headers: { "content-type": contentType },
    limits: {
      files: 1,
      fileSize: MAX_UPLOAD_SIZE_BYTES,
      fields: 16,
      fieldSize: 8 * 1024,
      parts: 17,
    },
  });

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
    if (filePart || parseErrorStatus !== null) {
      file.resume();
      return;
    }
    const pass = new PassThrough();
    const nextFilePart: FilePart = {
      stream: pass,
      filename: info.filename,
      mimeType: info.mimeType,
      sizeBytes: 0,
    };
    file.on("data", (chunk: Buffer) => {
      nextFilePart.sizeBytes += chunk.length;
    });
    file.on("limit", () => {
      parseErrorStatus = 413;
      parseErrorBody = { error: "파일 크기는 20MB 이하만 허용됩니다." };
    });
    file.pipe(pass);
    filePart = nextFilePart;
    tryStartUpload();
  });

  busboy.on("filesLimit", () => {
    parseErrorStatus = 400;
    parseErrorBody = { error: "파일은 하나만 업로드할 수 있습니다." };
  });
  busboy.on("fieldsLimit", () => {
    parseErrorStatus = 400;
    parseErrorBody = { error: "업로드 필드가 너무 많습니다." };
  });
  busboy.on("partsLimit", () => {
    parseErrorStatus = 400;
    parseErrorBody = { error: "업로드 항목이 너무 많습니다." };
  });

  const tryStartUpload = () => {
    if (uploadPromise || parseErrorStatus !== null || !filePart) return;

    const filename = filePart.filename || fields.filename || "unnamed";
    const mimeType = filePart.mimeType || fields.mimeType || "application/octet-stream";
    const label = fields.label?.trim() || "free-upload";
    const isArtistThumbnail = label === "artist-thumbnail";

    if (!filename) {
      return;
    }

    try {
      const { client, bucket } = getB2Config();
      const nextObjectKey = buildObjectKey({
        userId: "admin-free",
        submissionId: undefined,
        title: isArtistThumbnail ? "thumbnail" : label,
        filename,
        folder: isArtistThumbnail ? "artist-thumbnails" : "admin-free",
      });

      objectKey = nextObjectKey;
      const uploader = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: nextObjectKey,
          Body: filePart.stream,
          ContentType: mimeType || undefined,
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

  const cleanupStartedUpload = async () => {
    const startedUpload = uploadPromise as Promise<unknown> | null;
    const startedObjectKey = objectKey as string | null;
    await startedUpload?.catch(() => undefined);
    if (startedObjectKey) {
      await deleteObject(startedObjectKey).catch(() => undefined);
    }
  };

  try {
    const webStream = request.body as unknown as NodeReadableStream;
    Readable.fromWeb(webStream).pipe(busboy as unknown as NodeJS.WritableStream);
    await parsePromise;
  } catch (error) {
    await cleanupStartedUpload();
    return NextResponse.json(
      { error: "업로드 데이터를 읽지 못했습니다.", detail: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  tryStartUpload();

  if (parseErrorStatus !== null && parseErrorBody) {
    await cleanupStartedUpload();
    return NextResponse.json(parseErrorBody, { status: parseErrorStatus });
  }

  const parsedFilePart = filePart as FilePart | null;
  const startedObjectKey = objectKey as string | null;
  const startedUpload = uploadPromise as Promise<unknown> | null;

  if (!parsedFilePart) {
    return NextResponse.json({ error: "파일이 포함되어 있지 않습니다." }, { status: 400 });
  }

  if (!startedObjectKey || !startedUpload) {
    return NextResponse.json(
      { error: "파일 업로드를 시작하지 못했습니다." },
      { status: 400 },
    );
  }

  if (parsedFilePart.sizeBytes <= 0) {
    await startedUpload.catch(() => undefined);
    await deleteObject(startedObjectKey).catch(() => undefined);
    return NextResponse.json({ error: "빈 파일은 업로드할 수 없습니다." }, { status: 400 });
  }

  try {
    await startedUpload;
    const previewUrl = `/api/admin/uploads/free?objectKey=${encodeURIComponent(startedObjectKey)}`;
    return NextResponse.json({ ok: true, objectKey: startedObjectKey, previewUrl });
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

export async function DELETE(request: Request) {
  const { user, isAdmin } = await ensureAdmin();
  if (!user || !isAdmin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { objectKey?: string }
    | null;
  let objectKey = "";
  try {
    objectKey = decodeURIComponent(body?.objectKey?.trim() ?? "");
  } catch {
    objectKey = "";
  }

  if (!objectKey) {
    return NextResponse.json({ error: "objectKey가 필요합니다." }, { status: 400 });
  }
  if (!isAllowedAdminFreeKey(objectKey)) {
    return NextResponse.json(
      { error: "허용되지 않은 objectKey입니다." },
      { status: 400 },
    );
  }

  try {
    await deleteObject(objectKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "삭제 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
