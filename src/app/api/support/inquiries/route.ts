import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const inquirySchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  contact: z.string().trim().min(1).max(160),
});

export async function POST(request: Request) {
  const parsed = inquirySchema.safeParse(await request.json().catch(() => null));
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
