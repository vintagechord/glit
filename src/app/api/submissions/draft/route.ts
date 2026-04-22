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

const draftStatuses = ["DRAFT", "PRE_REVIEW"] as const;

async function findExistingDraftId(
  admin: ReturnType<typeof createAdminClient>,
  params: { type: "ALBUM" | "MV_DISTRIBUTION" | "MV_BROADCAST"; guestToken?: string; userId?: string },
) {
  let query = admin
    .from("submissions")
    .select("id")
    .in("status", [...draftStatuses])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (params.type === "ALBUM") {
    query = query.eq("type", "ALBUM");
  } else {
    query = query.in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"]);
  }

  if (params.userId) {
    query = query.eq("user_id", params.userId);
  } else if (params.guestToken) {
    query = query.eq("guest_token", params.guestToken);
  }

  const { data } = await query.maybeSingle();
  return data?.id ?? null;
}

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

  const insertQuery = isGuest
    ? admin
        .from("submissions")
        .upsert(payload, { onConflict: "guest_token" })
        .select("id")
        .maybeSingle()
    : supabase
        .from("submissions")
        .insert(payload)
        .select("id")
        .maybeSingle();

  const { data, error } = await insertQuery;
  if (error || !data?.id) {
    const fallbackId = await findExistingDraftId(admin, {
      type: parsed.data.type,
      guestToken: parsed.data.guestToken,
      userId: user?.id,
    });
    if (fallbackId) {
      return NextResponse.json({ ok: true, submissionId: fallbackId });
    }

    if (!isGuest && user?.id) {
      const fallback = await admin
        .from("submissions")
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (fallback.data?.id) {
        return NextResponse.json({ ok: true, submissionId: fallback.data.id });
      }
    }

    console.error("[Draft] failed to create submission draft", {
      type: parsed.data.type,
      isGuest,
      code: error?.code,
      message: error?.message,
    });
    return NextResponse.json({ error: "초안 생성을 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, submissionId: data.id });
}
