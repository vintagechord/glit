import { NextRequest, NextResponse } from "next/server";

import { presignGetUrl } from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CERT_PATH_PATTERN = /^submissions\/([0-9a-fA-F-]{36})\/certificate\//i;
const PUBLIC_PREFIX = "submissions/admin-free/free-upload/";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("filePath")?.trim();
  const guestToken = url.searchParams.get("guestToken") || undefined;

  if (!filePath) {
    return NextResponse.json({ error: "filePath를 전달해주세요." }, { status: 400 });
  }

  const isPublic = filePath.startsWith(PUBLIC_PREFIX);
  const certMatch = filePath.match(CERT_PATH_PATTERN);
  let allowed = isPublic;

  if (certMatch) {
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

  try {
    const signed = await presignGetUrl(filePath, 60 * 10);
    return NextResponse.redirect(signed, 302);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "다운로드 링크를 생성하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

