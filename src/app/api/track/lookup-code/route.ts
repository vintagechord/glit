import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sendGuestSubmissionLookupEmail } from "@/lib/email";
import { matchesGuestLookupIdentity } from "@/lib/guest-lookup-match";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildUrl, getBaseUrl } from "@/lib/url";

const lookupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
});

const normalizeName = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

const normalizeEmail = (value: string) => value.trim().toLowerCase();

type GuestLookupRow = {
  id: string;
  guest_token: string | null;
  title: string | null;
  type: string | null;
  created_at: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  applicant_name?: string | null;
  applicant_email?: string | null;
};

const mergeRows = (rows: GuestLookupRow[]) => {
  const map = new Map<string, GuestLookupRow>();
  for (const row of rows) {
    if (!row?.id) continue;
    if (!map.has(row.id)) {
      map.set(row.id, row);
      continue;
    }
    const current = map.get(row.id)!;
    map.set(row.id, {
      ...current,
      ...row,
    });
  }
  return Array.from(map.values());
};

const genericLookupMessage =
  "입력한 정보와 일치하는 접수가 있으면 해당 이메일로 조회 코드를 보내드립니다.";

export async function POST(request: NextRequest) {
  const requestIdentifier = getRequestIdentifier(request.headers);
  const ipLimit = consumeRateLimit({
    namespace: "track-lookup-ip",
    identifier: requestIdentifier,
    limit: 5,
    windowMs: 15 * 60 * 1_000,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
      },
    );
  }
  const body = await readBoundedJsonBody(request, 8 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { ok: false, error: "이름과 이메일을 정확히 입력해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = lookupSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "이름과 이메일을 정확히 입력해주세요." },
      { status: 400 },
    );
  }

  const name = normalizeName(parsed.data.name);
  const email = normalizeEmail(parsed.data.email);
  const emailLimit = consumeRateLimit({
    namespace: "track-lookup-email",
    identifier: email,
    limit: 3,
    windowMs: 60 * 60 * 1_000,
  });
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retryAfterSeconds = Math.max(
      ipLimit.retryAfterSeconds,
      emailLimit.retryAfterSeconds,
    );
    return NextResponse.json(
      { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }
  const admin = createAdminClient();
  const selectFields =
    "id, guest_token, title, type, created_at, guest_name, guest_email, applicant_name, applicant_email";

  const [byGuestInfo, byApplicantInfo] = await Promise.all([
    admin
      .from("submissions")
      .select(selectFields)
      .is("user_id", null)
      .not("guest_token", "is", null)
      .ilike("guest_email", email)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("submissions")
      .select(selectFields)
      .is("user_id", null)
      .not("guest_token", "is", null)
      .ilike("applicant_email", email)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (byGuestInfo.error && byApplicantInfo.error) {
    console.error("[TrackLookup][lookup-code] query failed", {
      byGuestInfo: byGuestInfo.error,
      byApplicantInfo: byApplicantInfo.error,
    });
    return NextResponse.json(
      { ok: false, error: "조회 코드를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }

  const candidates = mergeRows([
    ...(((byGuestInfo.data ?? []) as GuestLookupRow[]) ?? []),
    ...(((byApplicantInfo.data ?? []) as GuestLookupRow[]) ?? []),
  ]);

  const matchedItems = candidates
    .filter((row) => {
      if (!row.guest_token || row.guest_token.length < 8) return false;
      return matchesGuestLookupIdentity(row, name, email);
    })
    .sort((a, b) => {
      const left = new Date(b.created_at ?? 0).getTime();
      const right = new Date(a.created_at ?? 0).getTime();
      return left - right;
    })
    .slice(0, 10)
    .map((row) => ({
      token: row.guest_token as string,
      title: row.title,
      type: row.type,
      createdAt: row.created_at,
    }));

  if (matchedItems.length > 0) {
    const baseUrl = getBaseUrl(request);
    const emailResult = await sendGuestSubmissionLookupEmail({
      email,
      name: parsed.data.name,
      items: matchedItems.map((item) => ({
        ...item,
        link: buildUrl(
          `/track/${encodeURIComponent(item.token)}`,
          baseUrl,
        ),
      })),
    });
    if (!emailResult.ok) {
      console.warn("[TrackLookup][lookup-code] recovery mail not sent", {
        skipped: emailResult.skipped ?? false,
        itemCount: matchedItems.length,
        message: emailResult.message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    message: genericLookupMessage,
  }, { status: 202 });
}
