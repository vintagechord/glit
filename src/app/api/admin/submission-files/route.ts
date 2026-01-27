import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  submissionId: z.string().uuid(),
  kind: z.enum(["MV_RATING_FILE", "MV_RESULT_FILE", "MV_LABEL_GUIDE_FILE"]),
  objectKey: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

const isAdminUser = async () => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc("is_admin");
  return Boolean(data);
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "업로드 정보를 확인해주세요." },
      { status: 400 },
    );
  }

  const isAdmin = await isAdminUser();
  if (!isAdmin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const admin = createAdminClient();
  const payload = {
    submission_id: parsed.data.submissionId,
    kind: parsed.data.kind,
    file_path: parsed.data.objectKey,
    object_key: parsed.data.objectKey,
    storage_provider: "b2",
    status: "UPLOADED",
    uploaded_at: new Date().toISOString(),
    original_name: parsed.data.filename,
    mime: parsed.data.mimeType,
    size: parsed.data.sizeBytes,
  };

  const { data: inserted, error } = await admin
    .from("submission_files")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "파일 정보를 저장할 수 없습니다." },
      { status: 500 },
    );
  }

  if (parsed.data.kind === "MV_RATING_FILE") {
    await admin
      .from("submissions")
      .update({ mv_rating_file_path: parsed.data.objectKey })
      .eq("id", parsed.data.submissionId);
  }

  return NextResponse.json({ ok: true, attachmentId: inserted?.id ?? null });
}
