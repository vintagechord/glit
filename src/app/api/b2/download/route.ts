import { NextRequest, NextResponse } from "next/server";

import { headObject, presignGetUrl, getB2Config, B2ConfigError } from "@/lib/b2";
import { getStorageLogId } from "@/lib/guest-storage-owner";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { certificateSubmissionId, currentSubmissionCertificateKey, hasPublishedSubmissionResult, type SubmissionCertificateState } from "@/lib/submission-certificate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeFilePath = (raw: string) => raw.trim();

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawFilePath = url.searchParams.get("filePath") ?? "";
  const filePath = normalizeFilePath(rawFilePath);
  const guestToken = req.headers.get("x-submission-guest-token") || undefined;

  if (!filePath) {
    return NextResponse.json({ error: "filePath를 전달해주세요." }, { status: 400 });
  }
  if (/^https?:\/\//i.test(filePath)) {
    return NextResponse.json({ error: "filePath는 B2 객체 키만 허용합니다. URL은 사용할 수 없습니다." }, { status: 400 });
  }

  // decode once to handle encodeURIComponent from client (supports 한글/공백)
  let objectKey = filePath;
  try {
    objectKey = decodeURIComponent(filePath);
  } catch {
    objectKey = filePath;
  }

  let prefix: string;
  try {
    prefix = getB2Config().prefix;
  } catch {
    return NextResponse.json({ error: "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요." }, { status: 503 });
  }
  const isAdminFree = [`${prefix}admin-free/free-upload/`, "submissions/admin-free/free-upload/"]
    .some(value => objectKey.startsWith(value));
  const submissionId = certificateSubmissionId(objectKey, prefix);
  let allowed = false;

  if (isAdminFree) {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: isAdmin } = user
      ? await supabase.rpc("is_admin")
      : { data: false };
    allowed = Boolean(user && isAdmin === true);
  } else if (submissionId) {
    const { submission, error } = await ensureSubmissionOwner(submissionId, guestToken);
    let certificate: SubmissionCertificateState | null = submission;
    if (error === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인 또는 조회코드가 필요합니다." }, { status: 401 });
    }
    if (error === "NOT_FOUND") {
      return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    }
    if (error === "FORBIDDEN") {
      // Administrator access still requires the current, published certificate.
      const supabase = await createServerSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      const { data: isAdmin } = user ? await supabase.rpc("is_admin") : { data: false };
      if (!user || isAdmin !== true) {
        return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
      }
      const admin = createAdminClient();
      const { data: adminSubmission, error: loadError } = await admin
        .from("submissions")
        .select("id,type,certificate_b2_path,status,result_status,result_notified_at")
        .eq("id", submissionId)
        .maybeSingle();
      if (loadError) return NextResponse.json({ error: "필증 정보를 불러오지 못했습니다." }, { status: 503 });
      certificate = adminSubmission;
    }
    if (!certificate) return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    if (certificate.type !== "MV_DISTRIBUTION") {
      return NextResponse.json(
        { error: "온라인 업로드용 뮤직비디오 심의 필증만 다운로드할 수 있습니다." },
        { status: 403 },
      );
    }
    if (currentSubmissionCertificateKey(certificate) !== objectKey) {
      return NextResponse.json({ error: "현재 등록된 필증이 아닙니다." }, { status: 404 });
    }
    if (!hasPublishedSubmissionResult(certificate)) {
      return NextResponse.json({ error: "아직 결과가 준비되지 않았습니다." }, { status: 403 });
    }
    allowed = true;
  }

  if (!allowed) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  if (!isAdminFree) {
    try {
      const { bucket } = getB2Config();
      // 존재 여부 확인으로 NoSuchKey를 사전에 포착
      await headObject(objectKey);
      console.info("[b2][download] presign", {
        bucket,
        objectKeyId: getStorageLogId(objectKey),
      });
    } catch (error) {
      const code =
        (error as { $metadata?: { httpStatusCode?: number }; name?: string })?.name ||
        (error as { Code?: string })?.Code ||
        "";
      if (error instanceof B2ConfigError) {
        return NextResponse.json(
          { error: "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요." },
          { status: 503 },
        );
      }
      if (code === "NotFound" || code === "NoSuchKey") {
        console.warn("[b2][download] missing key", {
          objectKeyId: getStorageLogId(objectKey),
        });
        return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
      }
      console.error("[b2][download] headObject error", {
        objectKeyId: getStorageLogId(objectKey),
        errorName: error instanceof Error ? error.name : code || "UnknownError",
      });
      return NextResponse.json({ error: "파일 확인 중 오류가 발생했습니다." }, { status: 500 });
    }
  }

  try {
    const signed = await presignGetUrl(objectKey, 60 * 10);
    const response = NextResponse.redirect(signed, 302);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof B2ConfigError) {
      return NextResponse.json(
        { error: "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요." },
        { status: 503 },
      );
    }
    console.error("[b2][download] presign error", {
      objectKeyId: getStorageLogId(objectKey),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "다운로드 링크를 생성하지 못했습니다." },
      { status: 500 },
    );
  }
}
