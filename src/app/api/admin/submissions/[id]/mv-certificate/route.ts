import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { presignGetUrl } from "@/lib/b2";
import { createAttachmentResponseFromUrl } from "@/lib/download-response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

import { POST as handler } from "../certificate/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = handler;

type CertificateRow = {
  id: string;
  type: string | null;
  certificate_b2_path: string | null;
  certificate_original_name: string | null;
  certificate_mime: string | null;
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");

  if (!user || isAdmin !== true) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const { id: submissionId } = await context.params;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select("id, type, certificate_b2_path, certificate_original_name, certificate_mime")
    .eq("id", submissionId)
    .maybeSingle();

  if (error) {
    console.error("[admin][mv-certificate] load failed", { submissionId, error });
    return NextResponse.json({ error: "필증 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const submission = data as unknown as CertificateRow | null;
  if (!submission) {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (submission.type !== "MV_DISTRIBUTION") {
    return NextResponse.json(
      { error: "온라인 업로드용 뮤직비디오 심의만 필증을 다운로드할 수 있습니다." },
      { status: 400 },
    );
  }

  const objectKey = submission.certificate_b2_path?.trim();
  if (!objectKey) {
    return NextResponse.json({ error: "등록된 필증이 없습니다." }, { status: 404 });
  }

  try {
    const signedUrl = await presignGetUrl(objectKey, 60 * 10);
    return await createAttachmentResponseFromUrl({
      url: signedUrl,
      filename:
        submission.certificate_original_name?.trim() ||
        `onside-mv-certificate-${submissionId}.pdf`,
      fallbackContentType: submission.certificate_mime ?? "application/pdf",
    });
  } catch (downloadError) {
    console.error("[admin][mv-certificate] download failed", {
      submissionId,
      downloadError,
    });
    return NextResponse.json({ error: "필증 다운로드를 준비하지 못했습니다." }, { status: 500 });
  }
}
