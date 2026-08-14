import { NextResponse } from "next/server";
import { z } from "zod";

import { B2ConfigError, presignGetUrl } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");

  if (!user || !isAdmin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const parsed = z
    .object({
      objectKey: z.string().trim().min(1).max(1024).refine(
        (value) => !/^https?:\/\//i.test(value),
        "objectKey에는 URL을 사용할 수 없습니다.",
      ),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "objectKey가 필요합니다." }, { status: 400 });
  }
  const objectKey = parsed.data.objectKey;

  try {
    const url = await presignGetUrl(objectKey, 60 * 10);
    return NextResponse.json({ url });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요."
        : error instanceof Error
          ? error.message
          : "URL을 생성하지 못했습니다.";
    return NextResponse.json(
      { error: message },
      { status: error instanceof B2ConfigError ? 503 : 500 },
    );
  }
}
