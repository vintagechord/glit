import Busboy from "busboy";
import { NextResponse } from "next/server";
import { Readable } from "stream";
import { z } from "zod";

import { B2ConfigError, buildObjectKey, getB2Config } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

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
  let parseError: { status: number; body: { error: string } } | null = null;

  const busboy = Busboy({ headers: { "content-type": contentType } });
  busboy.on("field", (name, value) => {
    fields[name] = value;
  });

  busboy.on("file", (_name, file, info) => {
    if (uploadPromise) {
      file.resume();
      return;
    }

    const parsed = schema.safeParse({
      submissionId: fields.submissionId,
      title: fields.title,
      guestToken: fields.guestToken,
      filename: info.filename || fields.filename,
      mimeType: info.mimeType || fields.mimeType,
      sizeBytes: fields.sizeBytes,
    });

    if (!parsed.success) {
      console.error("[Upload][direct] validation failed", parsed.error.flatten().fieldErrors);
      parseError = { status: 400, body: { error: "업로드 정보를 확인해주세요." } };
      file.resume();
      return;
    }

    parsedData = parsed.data;

    if (!user && !parsed.data.guestToken) {
      parseError = { status: 401, body: { error: "로그인 또는 게스트 토큰이 필요합니다." } };
      file.resume();
      return;
    }

    if (parsed.data.sizeBytes > MAX_SIZE_BYTES) {
      parseError = {
        status: 400,
        body: { error: "파일 용량이 허용 한도(1GB)를 초과했습니다." },
      };
      file.resume();
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
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file,
        ContentType: parsed.data.mimeType || undefined,
        ContentLength: parsed.data.sizeBytes,
      });
      uploadPromise = client.send(command);
    } catch (error) {
      const message =
        error instanceof B2ConfigError
          ? error.message
          : error instanceof Error
            ? error.message
            : "업로드 중 오류가 발생했습니다.";
      parseError = { status: 500, body: { error: message } };
      console.error("[Upload][direct] error before upload", {
        submissionId: parsed.data.submissionId,
        user: user?.id ?? null,
        guest: Boolean(parsed.data.guestToken),
        message,
      });
      file.resume();
    }
  });

  const parsePromise = new Promise<void>((resolve, reject) => {
    busboy.on("finish", resolve);
    busboy.on("error", reject);
  });

  try {
    Readable.fromWeb(request.body as any).pipe(busboy);
    await parsePromise;
  } catch (error) {
    console.error("[Upload][direct] multipart parse error", {
      message: error instanceof Error ? error.message : String(error),
      contentType,
      contentLength,
    });
    return NextResponse.json({ error: "업로드 데이터를 읽을 수 없습니다." }, { status: 400 });
  }

  if (parseError) {
    return NextResponse.json(parseError.body, { status: parseError.status });
  }

  if (!parsedData || !uploadPromise || !objectKey) {
    console.error("[Upload][direct] missing file or parsed data", {
      contentType,
      contentLength,
      fieldNames: Object.keys(fields),
    });
    return NextResponse.json({ error: "업로드 정보를 확인해주세요." }, { status: 400 });
  }

  try {
    await uploadPromise;

    console.info("[Upload][direct] ok", {
      submissionId: parsedData.submissionId,
      objectKey,
      sizeBytes: parsedData.sizeBytes,
      user: user?.id ?? null,
      guest: Boolean(parsedData.guestToken),
    });

    return NextResponse.json({ objectKey });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "업로드 중 오류가 발생했습니다.";
    console.error("[Upload][direct] error", {
      submissionId: parsedData.submissionId,
      user: user?.id ?? null,
      guest: Boolean(parsedData.guestToken),
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
