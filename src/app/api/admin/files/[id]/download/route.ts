import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { B2ConfigError, presignGetUrl } from "@/lib/b2";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: fileRow } = await admin
    .from("submission_files")
    .select("object_key, file_path, storage_provider")
    .eq("id", id)
    .maybeSingle();

  if (!fileRow) {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }

  try {
    if (fileRow.storage_provider === "b2" && fileRow.object_key) {
      const url = await presignGetUrl(fileRow.object_key, 300);
      return NextResponse.json({ url });
    }

    const { data, error } = await admin.storage
      .from("submissions")
      .createSignedUrl(fileRow.file_path, 60 * 5);

    if (error || !data?.signedUrl) {
      throw error ?? new Error("signed url missing");
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch (error) {
    console.error("Admin download error", error);
    if (error instanceof B2ConfigError) {
      return NextResponse.json(
        { error: "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요." },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "다운로드 링크를 생성할 수 없습니다." },
      { status: 500 },
    );
  }
}
