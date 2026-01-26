import Busboy from "busboy";
import { NextResponse } from "next/server";
import { PassThrough, Readable } from "stream";
import { z } from "zod";

import { B2ConfigError, buildObjectKey, getB2Config } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";
import { Upload } from "@aws-sdk/lib-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  submissionId: z.string().uuid(),
  title: z.string().optional(),
  guestToken: z.string().min(8).optional(),
  filename: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.coerce.number().int().positive(),
});

const MAX_SIZE_BYTES = 1 * 1024 * 1024 * 1024; // 1GB

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const contentType = request.headers.get("content-type");
  const contentLength = request.headers.get("content-length");
  const userAgent = request.headers.get("user-agent");
  const forwardedFor = request.headers.get("x-forwarded-for");

  console.info("[Upload][direct] request received", {
    contentType,
    contentLength,
    userAgent,
    forwardedFor,
  });

  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    console.error("[Upload][direct] invalid content-type", { contentType });
    return NextResponse.json(
      {
        error: "업로드 데이터를 읽을 수 없습니다.",
        detail: "지원되지 않는 Content-Type",
        receivedContentType: contentType,
      },
      { status: 415 },
    );
  }
  if (!request.body || !contentType) {
    console.error("[Upload][direct] missing body or content-type", {
      contentType,
      contentLength,
    });
    return NextResponse.json({ error: "업로드 데이터를 읽을 수 없습니다." }, { status: 400 });
  }

  const fields: Record<string, string> = {};
  let parsedData: z.infer<typeof schema> | null = null;
  let objectKey: string | null = null;
  let uploadPromise: Promise<unknown> | null = null;
  let parseErrorStatus: number | null = null;
  let parseErrorBody: { error: string; detail?: string } | null = null;
  let filePart:
    | {
        stream: PassThrough;
        filename?: string;
        mimeType?: string;
      }
    | null = null;

  const busboy = Busboy({ headers: { "content-type": contentType } });
  busboy.on("field", (name, value) => {
    fields[name] = value;
    tryStartUpload();
  });

  busboy.on("file", (_name, file, info) => {
    if (filePart) {
      // Only accept the first file; drain the rest.
      file.resume();
      return;
    }

    const pass = new PassThrough();
    file.pipe(pass);
    filePart = {
      stream: pass,
      filename: info.filename,
      mimeType: info.mimeType,
    };
    tryStartUpload();
  });

  const parsePromise = new Promise<void>((resolve, reject) => {
    busboy.on("finish", resolve);
    busboy.on("error", (error) => {
      console.error("[Upload][direct] busboy error", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (parseErrorStatus === null) {
        parseErrorStatus = 400;
        parseErrorBody = {
          error: "업로드 데이터를 읽을 수 없습니다.",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      reject(error);
    });
  });

  const tryStartUpload = () => {
    if (uploadPromise || parseErrorStatus !== null || !filePart) return;
    if (!fields.submissionId || !fields.sizeBytes) return;

    const parsed = schema.safeParse({
      submissionId: fields.submissionId,
      title: fields.title,
      guestToken: fields.guestToken,
      filename: filePart.filename || fields.filename,
      mimeType: filePart.mimeType || fields.mimeType,
      sizeBytes: fields.sizeBytes,
    });

    if (!parsed.success) {
      console.error("[Upload][direct] validation failed", {
        errors: parsed.error.flatten().fieldErrors,
        submissionId: fields.submissionId,
        filename: filePart.filename ?? fields.filename,
        mimeType: filePart.mimeType ?? fields.mimeType,
        sizeBytes: fields.sizeBytes,
      });
      parseErrorStatus = 400;
      parseErrorBody = {
        error: "업로드 정보를 확인해주세요.",
        detail: parsed.error.message,
      };
      filePart.stream.resume();
      return;
    }

    parsedData = parsed.data;

    if (!user && !parsed.data.guestToken) {
      parseErrorStatus = 401;
      parseErrorBody = { error: "로그인 또는 게스트 토큰이 필요합니다." };
      filePart.stream.resume();
      return;
    }

    if (parsed.data.sizeBytes > MAX_SIZE_BYTES) {
      parseErrorStatus = 400;
      parseErrorBody = { error: "파일 용량이 허용 한도(1GB)를 초과했습니다." };
      filePart.stream.resume();
      return;
    }

    try {
      const key = buildObjectKey({
        userId: user?.id ?? `guest-${parsed.data.guestToken}`,
        submissionId: parsed.data.submissionId,
        title: parsed.data.title,
        filename: parsed.data.filename,
      });
      objectKey = key;

      const { client, bucket } = getB2Config();
      const uploader = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: filePart.stream,
          ContentType: parsed.data.mimeType || undefined,
          ContentLength: parsed.data.sizeBytes,
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
      console.error("[Upload][direct] error before upload", {
        submissionId: parsed.data.submissionId,
        user: user?.id ?? null,
        guest: Boolean(parsed.data.guestToken),
        message,
      });
      filePart.stream.resume();
    }
  };

  try {
    const webStream = request.body as unknown as import("stream/web").ReadableStream<any>;
    if (!webStream) {
      throw new Error("Request body is empty.");
    }
    Readable.fromWeb(webStream).pipe(busboy as any);
    await parsePromise;
  } catch (error) {
    console.error("[Upload][direct] multipart parse error", {
      message: error instanceof Error ? error.message : String(error),
      contentType,
      contentLength,
    });
    return NextResponse.json(
      { error: "업로드 데이터를 읽을 수 없습니다.", detail: String(error) },
      { status: 400 },
    );
  }

  // Attempt one last time in case required fields arrived after the file began streaming.
  tryStartUpload();

  if (parseErrorStatus !== null && parseErrorBody) {
    return NextResponse.json(parseErrorBody, { status: parseErrorStatus });
  }

  const uploadObjectKey = objectKey;
  const uploadPromiseResolved = uploadPromise;
  const missing: string[] = [];
  if (!parsedData) missing.push("fields");
  if (!filePart) missing.push("file");
  if (!uploadPromiseResolved) missing.push("upload");
  if (!uploadObjectKey) missing.push("objectKey");

  if (missing.length > 0) {
    console.error("[Upload][direct] missing file or parsed data", {
      contentType,
      contentLength,
      fieldNames: Object.keys(fields),
      missing,
    });
    return NextResponse.json({ error: "업로드 정보를 확인해주세요.", missing }, { status: 400 });
  }

  const uploadDetails = parsedData!;

  try {
    await uploadPromiseResolved;

    console.info("[Upload][direct] ok", {
      submissionId: uploadDetails.submissionId,
      objectKey: uploadObjectKey,
      sizeBytes: uploadDetails.sizeBytes,
      user: user?.id ?? null,
      guest: Boolean(uploadDetails.guestToken),
    });

    return NextResponse.json({ objectKey: uploadObjectKey });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "업로드 중 오류가 발생했습니다.";
    console.error("[Upload][direct] error", {
      submissionId: uploadDetails.submissionId,
      user: user?.id ?? null,
      guest: Boolean(uploadDetails.guestToken),
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
