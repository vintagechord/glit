import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  submissionId: z.string().min(3),
  kind: z.enum(["MV_RESULT_FILE"]),
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

  const { data: submission, error: submissionError } = await admin
    .from("submissions")
    .select("id, type")
    .eq("id", parsed.data.submissionId)
    .maybeSingle();

  if (submissionError || !submission) {
    return NextResponse.json(
      { error: "접수를 찾을 수 없습니다. 올바른 Submission ID(UUID)를 입력해주세요." },
      { status: 404 },
    );
  }
  if (!["MV_DISTRIBUTION", "MV_BROADCAST"].includes(submission.type ?? "")) {
    return NextResponse.json(
      { error: "뮤직비디오 접수에서만 결과 파일을 연결할 수 있습니다." },
      { status: 400 },
    );
  }
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

  return NextResponse.json({ ok: true, attachmentId: inserted?.id ?? null });
}
