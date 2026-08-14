import { NextResponse } from "next/server";
import { z } from "zod";

import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  token: z.string().trim().min(8).max(120),
});

export async function POST(request: Request) {
  const requestLimit = consumeRateLimit({
    namespace: "track-validate-ip",
    identifier: getRequestIdentifier(request.headers),
    limit: 30,
    windowMs: 15 * 60 * 1_000,
  });
  if (!requestLimit.allowed) {
    return NextResponse.json(
      { ok: false },
      {
        status: 429,
        headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
      },
    );
  }
  const body = await readBoundedJsonBody(request, 8 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { ok: false },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ ok: false });
  }
  const token = parsed.data.token;

  const admin = createAdminClient();
  const baseSelect = "id";

  const { data: guestMatch } = await admin
    .from("submissions")
    .select(baseSelect)
    .is("user_id", null)
    .eq("guest_token", token)
    .maybeSingle();

  if (guestMatch) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false });
}
