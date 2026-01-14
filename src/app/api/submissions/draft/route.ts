import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  type: z.enum(["ALBUM", "MV_DISTRIBUTION", "MV_BROADCAST"]).default("ALBUM"),
  guestToken: z.string().min(8).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isGuest = !user;
  if (isGuest && !parsed.data.guestToken) {
    return NextResponse.json({ error: "로그인 또는 게스트 토큰이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const payload = {
    user_id: user?.id ?? null,
    guest_token: isGuest ? parsed.data.guestToken ?? null : null,
    type: parsed.data.type,
    status: "DRAFT",
    payment_status: "UNPAID",
    amount_krw: 0,
  };

  const { data, error } = await admin.from("submissions").insert(payload).select("id").maybeSingle();
  if (error || !data?.id) {
    return NextResponse.json({ error: "초안 생성을 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, submissionId: data.id });
}
