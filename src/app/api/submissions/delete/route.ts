import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { deleteSubmissionRelations } from "@/lib/submission-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

type DeletableSubmissionRow = {
  id: string;
  payment_status: string | null;
};

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
  const { data: ownedRows, error: loadError } = await admin
    .from("submissions")
    .select("id, payment_status")
    .in("id", ids)
    .eq("user_id", user.id);

  if (loadError) {
    return NextResponse.json(
      { error: "삭제할 내역을 확인하지 못했습니다." },
      { status: 500 },
    );
  }

  const ownedSubmissions = (ownedRows ?? []) as DeletableSubmissionRow[];
  if (ownedSubmissions.length === 0) {
    return NextResponse.json(
      { error: "삭제할 수 있는 내역이 없습니다." },
      { status: 404 },
    );
  }

  const paidIds = ownedSubmissions
    .filter((item) => item.payment_status === "PAID")
    .map((item) => item.id);
  const unpaidIds = ownedSubmissions
    .filter((item) => item.payment_status !== "PAID")
    .map((item) => item.id);
  const deletedIds: string[] = [];

  if (paidIds.length > 0) {
    const { data: hiddenRows, error: hideError } = await admin
      .from("submissions")
      .update({ user_deleted_at: new Date().toISOString() })
      .in("id", paidIds)
      .eq("user_id", user.id)
      .select("id");

    if (hideError) {
      console.error("[submissions/delete] soft delete failed", hideError);
      return NextResponse.json(
        { error: "심의 내역 숨김 처리에 실패했습니다." },
        { status: 500 },
      );
    }

    deletedIds.push(...(hiddenRows ?? []).map((item) => item.id));
  }

  if (unpaidIds.length > 0) {
    const cleanupError = await deleteSubmissionRelations(admin, unpaidIds);
    if (cleanupError) {
      console.error("[submissions/delete] relation cleanup failed", cleanupError);
      return NextResponse.json(
        { error: "연결된 신청 정보를 정리하지 못했습니다." },
        { status: 500 },
      );
    }

    const { data: removedRows, error: removeError } = await admin
      .from("submissions")
      .delete()
      .in("id", unpaidIds)
      .eq("user_id", user.id)
      .select("id");

    if (removeError) {
      console.error("[submissions/delete] hard delete failed", removeError);
      return NextResponse.json(
        { error: "작성중 신청서 삭제에 실패했습니다." },
        { status: 500 },
      );
    }

    deletedIds.push(...(removedRows ?? []).map((item) => item.id));
  }

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
