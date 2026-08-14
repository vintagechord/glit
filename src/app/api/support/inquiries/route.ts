import { NextResponse } from "next/server";
import { z } from "zod";

import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const MAX_INQUIRY_BODY_BYTES = 16 * 1024;
const INQUIRY_LIMIT = 5;
const INQUIRY_WINDOW_MS = 10 * 60_000;

const inquirySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
    contact: z.string().trim().min(1).max(160),
  })
  .strict();

export async function POST(request: Request) {
  const requestLimit = consumeRateLimit({
    namespace: "support-inquiry-write",
    identifier: getRequestIdentifier(request.headers),
    limit: INQUIRY_LIMIT,
    windowMs: INQUIRY_WINDOW_MS,
  });
  if (!requestLimit.allowed) {
    return NextResponse.json(
      { error: "문의 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
      },
    );
  }

  const body = await readBoundedJsonBody(request, MAX_INQUIRY_BODY_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      {
        error:
          body.reason === "too_large"
            ? "문의 요청 크기가 너무 큽니다."
            : "문의 제목, 내용, 연락처를 확인해주세요.",
      },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }

  const parsed = inquirySchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "문의 제목, 내용, 연락처를 확인해주세요." },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("support_inquiries")
    .insert({
      user_id: user?.id ?? null,
      title: parsed.data.title,
      body: parsed.data.body,
      contact: parsed.data.contact,
      status: "NEW",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("[support-inquiries][post] insert error", error);
    return NextResponse.json(
      { error: "문의 접수 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: data.id });
}
