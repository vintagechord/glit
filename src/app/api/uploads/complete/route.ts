import { NextResponse } from "next/server";
import { z } from "zod";

import { B2ConfigError, headObject } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";

const schema = z.object({
  objectKey: z.string().min(1),
  submissionId: z.string().uuid().optional(),
  sizeBytes: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
  guestToken: z.string().min(8).optional(),
});

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "업로드 정보를 확인해주세요." },
      { status: 400 },
    );
  }

  const { objectKey, guestToken } = parsed.data;

  if (!user && !guestToken) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    await headObject(objectKey).catch(() => null);
  } catch (error) {
    if (error instanceof B2ConfigError) {
      return NextResponse.json(
        { error: "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요." },
        { status: 500 },
      );
    }
    // ignore other head errors; client already uploaded
  }

  return NextResponse.json({ ok: true });
}
