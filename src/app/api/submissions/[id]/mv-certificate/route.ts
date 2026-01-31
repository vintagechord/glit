import { NextRequest, NextResponse } from "next/server";

import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { presignGetUrl } from "@/lib/b2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CertificateFields = {
  certificate_b2_path?: string | null;
  certificate_original_name?: string | null;
  certificate_mime?: string | null;
  certificate_size?: number | null;
  status?: string | null;
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: submissionId } = await context.params;
  const url = new URL(req.url);
  const guestToken = url.searchParams.get("guestToken") || undefined;

  const { submission, error } = await ensureSubmissionOwner(submissionId, guestToken);
  if (error === "UNAUTHORIZED") {
    return NextResponse.json({ error: "로그인 또는 조회코드가 필요합니다." }, { status: 401 });
  }
  if (error === "NOT_FOUND") {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (error === "FORBIDDEN") {
    return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
  }
  if (!submission) {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }

  if (submission.status && !["RESULT_READY", "COMPLETED"].includes(submission.status)) {
    return NextResponse.json({ error: "아직 결과가 준비되지 않았습니다." }, { status: 403 });
  }

  const cert = submission as CertificateFields;
  const key = cert.certificate_b2_path?.trim();
  if (!key) {
    return NextResponse.json({ error: "필증이 등록되지 않았습니다." }, { status: 404 });
  }

  try {
    const urlSigned = await presignGetUrl(key, 60 * 10);
    return NextResponse.json({
      url: urlSigned,
      filename: cert.certificate_original_name ?? null,
      mimeType: cert.certificate_mime ?? null,
      sizeBytes: cert.certificate_size ?? null,
    });
  } catch (error) {
    console.error("[mv-certificate] failed to presign certificate", {
      submissionId,
      error,
    });
    return NextResponse.json({ error: "필증 링크를 생성하지 못했습니다." }, { status: 500 });
  }
}
