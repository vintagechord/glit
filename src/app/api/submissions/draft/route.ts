import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  type: z.enum(["ALBUM", "MV_DISTRIBUTION", "MV_BROADCAST"]).default("ALBUM"),
  // New guest drafts must use a cryptographically random identifier. Legacy
  // lookup tokens remain supported by read/edit routes.
  guestToken: z.string().uuid().optional(),
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
    query = query
      .is("user_id", null)
      .eq("guest_token", params.guestToken);
  }

  const { data } = await query.maybeSingle();
  return data?.id ?? null;
}

export async function POST(request: Request) {
  const requestLimit = consumeRateLimit({
    namespace: "submission-draft-create-ip",
    identifier: getRequestIdentifier(request.headers),
    limit: 60,
    windowMs: 60 * 60 * 1_000,
  });
  if (!requestLimit.allowed) {
    return NextResponse.json(
      { error: "초안 생성 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
      },
    );
  }
  const body = await readBoundedJsonBody(request, 8 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "요청 정보를 확인해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = schema.safeParse(body.value ?? {});
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

  if (isGuest) {
    const fallbackId = await findExistingDraftId(admin, {
      type: parsed.data.type,
      guestToken: parsed.data.guestToken,
    });
    if (fallbackId) {
      return NextResponse.json({
        ok: true,
        submissionId: fallbackId,
        guestToken: parsed.data.guestToken,
      });
    }

    let guestToken = parsed.data.guestToken;
    let lastError: { code?: string; message?: string } | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data, error } = await admin
        .from("submissions")
        .insert({
          ...payload,
          guest_token: guestToken,
        })
        .select("id, guest_token")
        .maybeSingle();

      if (data?.id) {
        return NextResponse.json({
          ok: true,
          submissionId: data.id,
          guestToken: data.guest_token ?? guestToken,
        });
      }

      lastError = error as { code?: string; message?: string } | null;
      if (lastError?.code === "23505") {
        guestToken = randomUUID();
        continue;
      }
      break;
    }

    console.error("[Draft] failed to create guest submission draft", {
      type: parsed.data.type,
      code: lastError?.code,
      message: lastError?.message,
    });
    return NextResponse.json({ error: "초안 생성을 실패했습니다." }, { status: 500 });
  }

  const insertQuery = supabase
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
