import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

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

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = lookupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "이름과 이메일을 정확히 입력해주세요." },
      { status: 400 },
    );
  }

  const name = normalizeName(parsed.data.name);
  const email = normalizeEmail(parsed.data.email);
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

  const items = candidates
    .filter((row) => {
      if (!row.guest_token || row.guest_token.length < 8) return false;
      const rowName = normalizeName(row.guest_name ?? row.applicant_name ?? "");
      if (rowName !== name) return false;

      const rowEmail = normalizeEmail(
        row.guest_email ?? row.applicant_email ?? "",
      );
      return rowEmail === email;
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

  return NextResponse.json({
    ok: true,
    items,
  });
}
