import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const uploadSchema = z.object({
  submissionId: z.string().uuid(),
  guestToken: z.string().min(8),
  kind: z.enum(["audio", "video", "karaoke", "lyrics", "etc"]),
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
  const path = `guest/${parsed.data.guestToken}/${parsed.data.submissionId}/${parsed.data.kind}/${Date.now()}-${safeName}`;

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
