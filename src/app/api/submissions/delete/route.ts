import { after, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { clearDashboardStatusCache } from "@/lib/dashboard-status";
import { isPaymentInProgressDatabaseError } from "@/lib/payment-group";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  classifySubmissionDelete,
  parseSubmissionDeletePayload,
  type SubmissionDeleteCandidate,
} from "@/lib/submission-delete-request";
import {
  cleanupDeletedSubmissionB2Objects,
  loadSubmissionB2ObjectRefs,
} from "@/lib/submission-file-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

const MAX_DELETE_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await readBoundedJsonBody(request, MAX_DELETE_BODY_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      {
        error:
          body.reason === "too_large"
            ? "삭제 요청 크기가 너무 큽니다."
            : "삭제할 내역을 확인해주세요.",
      },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }

  const payload = parseSubmissionDeletePayload(body.value);
  if (!payload) {
    return NextResponse.json(
      { error: "삭제할 내역은 UUID 형식으로 1~100건까지 선택해주세요." },
      { status: 400 },
    );
  }
  const ids = payload.ids;

  const admin = createAdminClient();
  const { data: ownedRows, error: loadError } = await admin
    .from("submissions")
    .select("id, status, payment_status, current_order_id")
    .in("id", ids)
    .eq("user_id", user.id);

  if (loadError) {
    return NextResponse.json(
      { error: "삭제할 내역을 확인하지 못했습니다." },
      { status: 500 },
    );
  }

  const ownedSubmissions = (ownedRows ?? []) as SubmissionDeleteCandidate[];
  if (ownedSubmissions.length === 0) {
    return NextResponse.json(
      { error: "삭제할 수 있는 내역이 없습니다." },
      { status: 404 },
    );
  }

  // Legacy REFUNDED or PAYMENT_PENDING rows may have no order, so the order
  // trigger cannot protect them; a hard delete would cascade to their payment
  // records. Refuse the whole request rather than delete part of it.
  if (
    ownedSubmissions.some((item) => classifySubmissionDelete(item) === "refuse")
  ) {
    return NextResponse.json(
      {
        error:
          "입금 확인 중이거나 장바구니·주문에 담긴 신청서는 여기서 삭제할 수 없습니다. 장바구니 또는 주문 내역에서 확인해주세요.",
      },
      { status: 409 },
    );
  }

  const paidIds = ownedSubmissions
    .filter((item) => classifySubmissionDelete(item) === "hide")
    .map((item) => item.id);
  const unpaidIds = ownedSubmissions
    .filter((item) => classifySubmissionDelete(item) === "delete")
    .map((item) => item.id);
  const deletedIds: string[] = [];

  if (unpaidIds.length > 0) {
    const { data: hasRequestedPayment, error: paymentCheckError } =
      await admin.rpc("has_requested_submission_payments", {
        p_submission_ids: unpaidIds,
      });
    if (paymentCheckError) {
      console.error(
        "[submissions/delete] requested payment check failed",
        paymentCheckError,
      );
      return NextResponse.json(
        { error: "진행 중인 결제 정보를 확인하지 못했습니다." },
        { status: 500 },
      );
    }
    if (hasRequestedPayment) {
      return NextResponse.json(
        {
          error:
            "카드 결제가 진행 중인 신청서는 삭제할 수 없습니다. 결제를 취소한 뒤 다시 시도해주세요.",
        },
        { status: 409 },
      );
    }

    const b2ObjectRefs = await loadSubmissionB2ObjectRefs(admin, unpaidIds);

    const { data: removedRows, error: removeError } = await admin
      .from("submissions")
      .delete()
      .in("id", unpaidIds)
      .eq("user_id", user.id)
      .in("status", ["DRAFT", "PRE_REVIEW"])
      .eq("payment_status", "UNPAID")
      .is("current_order_id", null)
      .select("id");

    if (removeError) {
      console.error("[submissions/delete] hard delete failed", removeError);
      if (isPaymentInProgressDatabaseError(removeError)) {
        return NextResponse.json(
          {
            error:
              "카드 결제가 진행 중인 신청서는 삭제할 수 없습니다. 결제를 취소한 뒤 다시 시도해주세요.",
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "작성중 신청서 삭제에 실패했습니다." },
        { status: 500 },
      );
    }

    const removedIds = (removedRows ?? []).map((item) => item.id);
    if (removedIds.length > 0 && b2ObjectRefs.length > 0) {
      after(() =>
        cleanupDeletedSubmissionB2Objects(admin, b2ObjectRefs, removedIds),
      );
    }
    if (removedIds.length !== unpaidIds.length) {
      return NextResponse.json(
        { error: "일부 신청서 상태가 변경되어 삭제하지 못했습니다." },
        { status: 409 },
      );
    }
    deletedIds.push(...removedIds);
  }

  if (paidIds.length > 0) {
    const { data: hiddenRows, error: hideError } = await admin
      .from("submissions")
      .update({ user_deleted_at: new Date().toISOString() })
      .in("id", paidIds)
      .eq("user_id", user.id)
      .in("payment_status", ["PAID", "REFUNDED"])
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

  if (deletedIds.length === 0) {
    return NextResponse.json(
      { error: "삭제할 수 있는 내역이 없습니다." },
      { status: 404 },
    );
  }

  clearDashboardStatusCache(user.id);
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
