import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = String(body?.token ?? "").trim();
  if (!token || token.length < 8 || token.length > 120) {
    return NextResponse.json({ ok: false });
  }

  const admin = createAdminClient();
  const baseSelect = "id";

  const { data: guestMatch } = await admin
    .from("submissions")
    .select(baseSelect)
    .eq("guest_token", token)
    .maybeSingle();

  if (guestMatch) {
    return NextResponse.json({ ok: true });
  }

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      token,
    );
  if (isUuid) {
    const { data: idMatch } = await admin
      .from("submissions")
      .select(baseSelect)
      .eq("id", token)
      .maybeSingle();
    if (idMatch) {
      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ ok: false });
}
