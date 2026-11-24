import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sendGuestSubmissionLookupEmail } from "@/lib/email";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import { getEmailDeliveryConfiguration } from "@/lib/email-config";
import { matchesGuestLookupIdentity } from "@/lib/guest-lookup-match";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumePersistentRateLimit,
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

// The customer is told what actually happened (owner decision 2026-11-24): a
// silent "if it matches" reply left people waiting for mail that was never
// sent. The code itself still only travels by mail, and both limits below
// bound how often a name and email pair can be tried.
const lookupReplies = {
  sent: "입력한 이메일로 조회 코드를 발송했습니다. 메일이 보이지 않으면 스팸함을 확인해주세요.",
  no_match: "입력한 정보와 일치하는 비회원 접수가 없습니다. 접수할 때 입력한 이름과 이메일을 확인해주세요.",
  member_account: "회원 계정으로 접수된 신청입니다. 로그인한 뒤 신청 내역에서 확인해주세요.",
  send_failed: "조회 코드 메일을 보내지 못했습니다. 잠시 후 다시 시도하거나 고객센터에 문의해주세요.",
} as const;

const lookupReply = (result: keyof typeof lookupReplies) =>
  result === "sent"
    ? NextResponse.json(
        { ok: true, result, message: lookupReplies[result] },
        { headers: { "cache-control": "no-store" } },
      )
    : NextResponse.json(
        { ok: false, result, error: lookupReplies[result] },
        { status: result === "send_failed" ? 502 : 404, headers: { "cache-control": "no-store" } },
      );

export async function POST(request: NextRequest) {
  const emailMode = getEmailDeliveryMode();
  if (emailMode !== "transactional") {
    return NextResponse.json({
      ok: false,
      error: emailMode === "manual"
        ? "현재 조회 코드 이메일 발송을 제공하지 않습니다. 조회 코드 확인은 고객센터에 문의해주세요."
        : "조회 코드 이메일 발송 설정을 확인할 수 없습니다. 고객센터에 문의해주세요.",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  // Check once before looking up a person so missing provider credentials have
  // the same response for existing and nonexistent submissions.
  if (!getEmailDeliveryConfiguration().ok) {
    return NextResponse.json({
      ok: false,
      error: "조회 코드 이메일 발송을 준비 중입니다. 잠시 후 다시 시도하거나 고객센터에 문의해주세요.",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const requestIdentifier = getRequestIdentifier(request.headers);
  const ipLimit = await consumePersistentRateLimit({
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
  const emailPattern = email.replace(/[\\%_]/g, "\\$&");
  const emailLimit = await consumePersistentRateLimit({
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

  const signal = AbortSignal.timeout(10_000);
  // "guest" rows carry a code to mail. "member" rows are applications owned by
  // an account (a guest application paid from a logged-in cart becomes one and
  // loses its code); one such match is enough to point the customer at login.
  const readMatchingRows = async (
    column: "guest_email" | "applicant_email",
    owner: "guest" | "member" = "guest",
  ) => {
    const matched: GuestLookupRow[] = [];
    const matchedIds = new Set<string>();
    const wanted = owner === "guest" ? 10 : 1;
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      signal.throwIfAborted();
      let rowsOfOwner = admin.from("submissions").select(selectFields).ilike(column, emailPattern);
      if (owner === "guest") rowsOfOwner = rowsOfOwner.is("user_id", null).not("guest_token", "is", null);
      else rowsOfOwner = rowsOfOwner.not("user_id", "is", null);
      const { data, error } = await rowsOfOwner
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + pageSize - 1)
        .abortSignal(signal);
      if (error) throw new Error("Guest lookup query unavailable");
      const rows = (data ?? []) as GuestLookupRow[];
      for (const row of rows) {
        const usable = owner === "member" || Boolean(row.guest_token && row.guest_token.length >= 8);
        if (!matchedIds.has(row.id) && usable && matchesGuestLookupIdentity(row, name, email)) {
          matched.push(row);
          matchedIds.add(row.id);
        }
        // Each branch is ordered newest first, so later rows cannot displace
        // its ten newest matches in the final merged result.
        if (matched.length === wanted) return matched;
      }
      if (rows.length < pageSize) return matched;
    }
  };
  let candidates: GuestLookupRow[];
  let ownedByAccount = false;
  try {
    const matches = await Promise.all([readMatchingRows("guest_email"), readMatchingRows("applicant_email")]);
    candidates = mergeRows(matches.flat());
    if (candidates.length === 0) {
      const owned = await Promise.all([readMatchingRows("guest_email", "member"), readMatchingRows("applicant_email", "member")]);
      ownedByAccount = owned.flat().length > 0;
    }
  } catch {
    // A timeout or failure is never treated as a complete no-match search.
    console.error("[TrackLookup][lookup-code] query failed");
    return NextResponse.json(
      { ok: false, error: "조회 코드를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

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

  if (matchedItems.length === 0) return lookupReply(ownedByAccount ? "member_account" : "no_match");

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
      reason: emailResult.reason,
    });
    return lookupReply("send_failed");
  }

  return lookupReply("sent");
}
