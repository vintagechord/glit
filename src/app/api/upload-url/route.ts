import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createAdminClient } from "@/lib/supabase/admin";

const uploadSchema = z.object({
  submissionId: z.string().uuid(),
  guestToken: z.string().min(8).optional(),
  kind: z.enum([
    "audio",
    "video",
    "karaoke",
    "karaoke_vote",
    "karaoke_recommendation",
    "lyrics",
    "etc",
  ]),
  fileName: z.string().min(1),
});

const sanitizeFileName = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = uploadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid upload payload." },
      { status: 400 },
    );
  }

  const safeName = sanitizeFileName(parsed.data.fileName);
  const { user, submission, error: ownershipError } = await ensureSubmissionOwner(
    parsed.data.submissionId,
    parsed.data.guestToken,
  );
  if (ownershipError === "NOT_FOUND") {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (ownershipError === "UNAUTHORIZED") {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (ownershipError === "FORBIDDEN") {
    return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
  }

  const ownerSegment =
    submission?.user_id ??
    user?.id ??
    `guest-${parsed.data.guestToken ?? submission?.guest_token ?? "unknown"}`;
  const path = `${ownerSegment}/${parsed.data.submissionId}/${parsed.data.kind}/${Date.now()}-${safeName}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("submissions")
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create signed upload url." },
      { status: 500 },
    );
  }

  return NextResponse.json({ signedUrl: data.signedUrl, path: data.path });
}
