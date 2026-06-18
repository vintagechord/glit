import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const ids = Array.from(
    new Set(
      Array.isArray(payload?.ids)
        ? (payload.ids as unknown[])
            .filter((id): id is string => typeof id === "string")
            .map((id: string) => id.trim())
            .filter(Boolean)
        : [],
    ),
  );

  if (ids.length === 0) {
    return NextResponse.json({ error: "삭제할 내역이 없습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .delete()
    .in("id", ids)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: "선택한 내역 삭제에 실패했습니다." },
      { status: 500 },
    );
  }

  const deletedIds = (data ?? []).map((item) => item.id);

  if (deletedIds.length === 0) {
    return NextResponse.json(
      { error: "삭제할 수 있는 내역이 없습니다." },
      { status: 404 },
    );
  }

  revalidatePath("/dashboard/history");
  revalidatePath("/mypage/history");
  revalidatePath("/en/dashboard/history");
  revalidatePath("/en/mypage/history");
  for (const id of deletedIds) {
    revalidatePath(`/dashboard/submissions/${id}`);
    revalidatePath(`/mypage/submissions/${id}`);
    revalidatePath(`/en/dashboard/submissions/${id}`);
    revalidatePath(`/en/mypage/submissions/${id}`);
  }

  return NextResponse.json({ ok: true, deletedIds });
}
