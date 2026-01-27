import { NextRequest, NextResponse } from "next/server";

import { headObject, presignGetUrl, getB2Config } from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CERT_PATH_PATTERN = /^submissions\/([0-9a-fA-F-]{36})\/certificate\//i;
const PUBLIC_PREFIX = "submissions/admin-free/free-upload/";

const normalizeFilePath = (raw: string) => raw.trim();

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawFilePath = url.searchParams.get("filePath") ?? "";
  const filePath = normalizeFilePath(rawFilePath);
  const guestToken = url.searchParams.get("guestToken") || undefined;

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

  const isPublic = filePath.startsWith(PUBLIC_PREFIX);
  const certMatch = filePath.match(CERT_PATH_PATTERN);
  let allowed = false;

  if (isPublic) {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    allowed = Boolean(user);
  } else if (certMatch) {
    const submissionId = certMatch[1];
    const { submission, error } = await ensureSubmissionOwner(submissionId, guestToken);
    if (error === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인 또는 조회코드가 필요합니다." }, { status: 401 });
    }
    if (error === "NOT_FOUND") {
      return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    }
    if (error === "FORBIDDEN") {
      // 관리자이면 통과
      const supabase = await createServerSupabase();
      const { data: isAdmin } = await supabase.rpc("is_admin");
      if (isAdmin !== true) {
        return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
      }
    }
    if (submission || certMatch) {
      allowed = true;
    }
  }

  if (!allowed) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  if (!isPublic) {
    try {
      const { bucket } = getB2Config();
      // 존재 여부 확인으로 NoSuchKey를 사전에 포착
      await headObject(objectKey);
      console.info("[b2][download] presign", { bucket, key: objectKey });
    } catch (error) {
      const code =
        (error as { $metadata?: { httpStatusCode?: number }; name?: string })?.name ||
        (error as { Code?: string })?.Code ||
        "";
      if (code === "NotFound" || code === "NoSuchKey") {
        console.warn("[b2][download] missing key", { filePath: objectKey });
        return NextResponse.json({ error: "파일을 찾을 수 없습니다.", filePath: objectKey }, { status: 404 });
      }
      console.error("[b2][download] headObject error", { filePath: objectKey, error });
      return NextResponse.json({ error: "파일 확인 중 오류가 발생했습니다." }, { status: 500 });
    }
  }

  try {
    const signed = await presignGetUrl(objectKey, 60 * 10);
    return NextResponse.redirect(signed, 302);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "다운로드 링크를 생성하지 못했습니다.";
    console.error("[b2][download] presign error", { filePath: objectKey, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
