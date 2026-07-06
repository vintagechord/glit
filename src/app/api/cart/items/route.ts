import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteSubmissionRelations } from "@/lib/submission-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const deleteSchema = z.object({
  submissionIds: z.array(z.string().uuid()).min(1).max(100),
});

type CartDeleteSubmission = {
  id: string;
  status: string | null;
  payment_status: string | null;
};

const cartStatuses = new Set(["SUBMITTED", "WAITING_PAYMENT"]);
const cartPaymentFilter =
  "payment_status.is.null,payment_status.in.(UNPAID,PAYMENT_PENDING)";

export async function DELETE(request: Request) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "삭제할 장바구니 항목을 선택해주세요." },
      { status: 400 },
    );
  }

  const submissionIds = Array.from(new Set(parsed.data.submissionIds));
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select("id, status, payment_status")
    .in("id", submissionIds)
    .eq("user_id", user.id)
    .or(cartPaymentFilter);

  if (error) {
    console.error("[CartItems] load failed", error);
    return NextResponse.json(
      { error: "삭제할 장바구니 항목을 확인하지 못했습니다." },
      { status: 500 },
    );
  }

  const rows = ((data ?? []) as unknown[]).map(
    (row) => row as CartDeleteSubmission,
  );
  const invalid =
    rows.length !== submissionIds.length ||
    rows.some(
      (row) =>
        row.payment_status === "PAID" ||
        !cartStatuses.has(String(row.status ?? "")),
    );

  if (invalid) {
    return NextResponse.json(
      { error: "삭제할 수 없는 장바구니 항목이 포함되어 있습니다." },
      { status: 409 },
    );
  }

  const cleanupError = await deleteSubmissionRelations(admin, submissionIds);
  if (cleanupError) {
    console.error("[CartItems] cleanup failed", cleanupError);
    return NextResponse.json(
      { error: "연결된 접수 정보를 정리하지 못했습니다." },
      { status: 500 },
    );
  }

  const { data: deletedRows, error: deleteError } = await admin
    .from("submissions")
    .delete()
    .in("id", submissionIds)
    .eq("user_id", user.id)
    .in("status", ["SUBMITTED", "WAITING_PAYMENT"])
    .or(cartPaymentFilter)
    .select("id");

  if (deleteError) {
    console.error("[CartItems] delete failed", deleteError);
    return NextResponse.json(
      { error: "장바구니 항목 삭제에 실패했습니다." },
      { status: 500 },
    );
  }

  const deletedIds = (deletedRows ?? []).map((row) => row.id as string);
  if (deletedIds.length === 0) {
    return NextResponse.json(
      { error: "삭제된 장바구니 항목이 없습니다." },
      { status: 404 },
    );
  }

  revalidatePath("/dashboard/cart");
  revalidatePath("/mypage/cart");
  revalidatePath("/en/dashboard/cart");
  revalidatePath("/en/mypage/cart");
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  revalidatePath("/en/dashboard");
  revalidatePath("/en/mypage");
  revalidatePath("/dashboard/drafts");
  revalidatePath("/mypage/drafts");
  revalidatePath("/en/dashboard/drafts");
  revalidatePath("/en/mypage/drafts");
  for (const id of deletedIds) {
    revalidatePath(`/dashboard/submissions/${id}`);
    revalidatePath(`/mypage/submissions/${id}`);
    revalidatePath(`/en/dashboard/submissions/${id}`);
    revalidatePath(`/en/mypage/submissions/${id}`);
  }

  return NextResponse.json({ ok: true, deletedIds });
}

export const POST = DELETE;
