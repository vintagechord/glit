import Busboy from "busboy";
import { NextResponse } from "next/server";
import { PassThrough, Readable } from "stream";
import { ReadableStream as NodeReadableStream } from "stream/web";
import { Upload } from "@aws-sdk/lib-storage";

import { B2ConfigError, buildObjectKey, getB2Config } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");

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

  const fields: Record<string, string> = {};
  let filePart:
    | {
        stream: PassThrough;
        filename?: string;
        mimeType?: string;
        sizeBytes?: number;
      }
    | null = null;

  const busboy = Busboy({ headers: { "content-type": contentType } });

  busboy.on("field", (name, value) => {
    fields[name] = value;
  });

  const parsePromise = new Promise<void>((resolve, reject) => {
    busboy.on("finish", resolve);
    busboy.on("error", reject);
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
      sizeBytes: Number(fields.sizeBytes ?? info.mimeType ? 0 : 0),
    };
  });

  try {
    const webStream = request.body as unknown as NodeReadableStream;
    Readable.fromWeb(webStream).pipe(busboy as unknown as NodeJS.WritableStream);
    await parsePromise;
  } catch (error) {
    return NextResponse.json(
      { error: "업로드 데이터를 읽지 못했습니다.", detail: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  if (!filePart) {
    return NextResponse.json({ error: "파일이 포함되어 있지 않습니다." }, { status: 400 });
  }

  const part = filePart!;
  const filename = part.filename || fields.filename || "unnamed";
  const mimeType = part.mimeType || fields.mimeType || "application/octet-stream";
  const sizeBytes = Number(fields.sizeBytes || part.sizeBytes || 0);
  if (!sizeBytes || Number.isNaN(sizeBytes)) {
    return NextResponse.json({ error: "파일 크기를 확인할 수 없습니다." }, { status: 400 });
  }

  const label = fields.label?.trim() || "free-upload";

  try {
    const { client, bucket } = getB2Config();
    const objectKey = buildObjectKey({
      userId: "admin-free",
      submissionId: undefined,
      title: label,
      filename,
    });

    const uploader = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: objectKey,
        Body: filePart.stream,
        ContentType: mimeType || undefined,
        ContentLength: sizeBytes,
      },
      leavePartsOnError: false,
    });

    await uploader.done();

    return NextResponse.json({ ok: true, objectKey, bucket });
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
