import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin/api-auth";
import { readBoundedJsonBody } from "@/lib/request-body";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 16 * 1024;

const schema = z
  .object({
    submissionId: z.string().uuid(),
    kind: z.enum(["MV_RESULT_FILE"]),
    objectKey: z.string().trim().min(1).max(1024),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(127),
    sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  })
  .strict();

export async function POST(request: Request) {
  // Authenticate before reading the body so unauthenticated callers cannot
  // force this privileged route to parse attacker-controlled large JSON.
  const auth = await requireAdminForApi();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await readBoundedJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      {
        error:
          body.reason === "too_large"
            ? "업로드 정보 요청이 너무 큽니다."
            : "업로드 정보를 확인해주세요.",
      },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }

  const parsed = schema.safeParse(body.value);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "업로드 정보를 확인해주세요." },
      { status: 400 },
    );
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
