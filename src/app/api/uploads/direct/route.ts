import { NextResponse } from "next/server";
import { z } from "zod";

import { B2ConfigError, buildObjectKey, getB2Config } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";

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

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    console.error("[Upload][direct] form parse error", error);
    return NextResponse.json({ error: "업로드 데이터를 읽을 수 없습니다." }, { status: 400 });
  }

  const file = form.get("file");
  const parsed = schema.safeParse({
    submissionId: form.get("submissionId"),
    title: form.get("title"),
    guestToken: form.get("guestToken"),
    filename: typeof file === "object" && file && "name" in file ? (file as File).name : form.get("filename"),
    mimeType: typeof file === "object" && file && "type" in file ? (file as File).type : form.get("mimeType"),
    sizeBytes:
      typeof file === "object" && file && "size" in file ? (file as File).size : form.get("sizeBytes"),
  });

  if (!parsed.success || !(file instanceof File)) {
    console.error("[Upload][direct] validation failed", parsed.error?.flatten().fieldErrors);
    return NextResponse.json({ error: "업로드 정보를 확인해주세요." }, { status: 400 });
  }

  const { submissionId, title, guestToken, filename, mimeType, sizeBytes } = parsed.data;

  if (!user && !guestToken) {
    return NextResponse.json({ error: "로그인 또는 게스트 토큰이 필요합니다." }, { status: 401 });
  }

  if (sizeBytes > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "파일 용량이 허용 한도(1GB)를 초과했습니다." },
      { status: 400 },
    );
  }

  try {
    const objectKey = buildObjectKey({
      userId: user?.id ?? `guest-${guestToken}`,
      submissionId,
      title,
      filename,
    });

    const { client, bucket } = getB2Config();

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: fileBuffer,
      ContentType: mimeType || undefined,
    });

    await client.send(command);

    console.info("[Upload][direct] ok", {
      submissionId,
      objectKey,
      sizeBytes,
      user: user?.id ?? null,
      guest: Boolean(guestToken),
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
      submissionId,
      user: user?.id ?? null,
      guest: Boolean(parsed.data.guestToken),
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
