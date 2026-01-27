import Busboy from "busboy";
import { NextRequest, NextResponse } from "next/server";
import { PassThrough, Readable } from "stream";
import { ReadableStream as NodeReadableStream } from "stream/web";
import { Upload } from "@aws-sdk/lib-storage";

import { B2ConfigError, buildObjectKey, getB2Config } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type FilePart = {
  stream: PassThrough;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
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

  if (!user || !isAdmin) {
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
  const fields: Record<string, string> = {};
  let filePart: FilePart | null = null;

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
      sizeBytes: Number(fields.sizeBytes ?? 0) || undefined,
    };
  });

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

  if (!filePart) {
    return NextResponse.json({ error: "파일이 포함되어 있지 않습니다." }, { status: 400 });
  }

  const part = filePart as FilePart;
  const filename = part.filename || fields.filename || "certificate";
  const mimeType = part.mimeType || fields.mimeType || "application/octet-stream";
  const sizeBytes = Number(fields.sizeBytes || part.sizeBytes || 0);
  if (!sizeBytes || Number.isNaN(sizeBytes)) {
    return NextResponse.json({ error: "파일 크기를 확인할 수 없습니다." }, { status: 400 });
  }

  try {
    const { data: submission } = await supabase
      .from("submissions")
      .select("id, mv_rating")
      .eq("id", submissionId)
      .maybeSingle();

    if (!submission) {
      return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    }

    const { client, bucket } = getB2Config();
    const objectKey = buildObjectKey({
      userId: "admin-certificate",
      submissionId,
      title: submission.mv_rating ?? "certificate",
      filename,
    });

    const uploader = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: objectKey,
        Body: part.stream,
        ContentType: mimeType || undefined,
        ContentLength: sizeBytes,
      },
      leavePartsOnError: false,
    });

    await uploader.done();

    const { error } = await supabase
      .from("submissions")
      .update({
        mv_certificate_object_key: objectKey,
        mv_certificate_filename: filename,
        mv_certificate_mime_type: mimeType,
        mv_certificate_size_bytes: sizeBytes,
        mv_certificate_uploaded_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    if (error) {
      return NextResponse.json({ error: "필증 정보를 저장하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      objectKey,
      filename,
      mimeType,
      sizeBytes,
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
