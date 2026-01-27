import { NextResponse } from "next/server";

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

  const body = (await request.json().catch(() => null)) as { objectKey?: string } | null;
  const objectKey = body?.objectKey?.trim();
  if (!objectKey) {
    return NextResponse.json({ error: "objectKey가 필요합니다." }, { status: 400 });
  }

  try {
    const url = await presignGetUrl(objectKey, 60 * 10);
    return NextResponse.json({ url });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "URL을 생성하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
