import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  method: z.enum(["BANK", "CARD"]),
  guestToken: z.string().trim().min(8).optional(),
});

const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const terminalStatuses = new Set(["IN_PROGRESS", "RESULT_READY", "COMPLETED"]);

const getOwnershipResponse = (error: string | null | undefined) => {
  if (error === "UNAUTHORIZED") {
    return NextResponse.json(
      { error: "로그인 또는 조회코드가 필요합니다." },
      { status: 401 },
    );
  }
  if (error === "NOT_FOUND") {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (error === "FORBIDDEN") {
    return NextResponse.json({ error: "접수 소유자가 아닙니다." }, { status: 403 });
  }
  return null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const submissionId = id?.trim();
  if (!submissionId || !uuidPattern.test(submissionId)) {
    return NextResponse.json(
      { error: "유효하지 않은 접수 ID입니다." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "결제 방식을 확인해주세요." },
      { status: 400 },
    );
  }

  const ownership = await ensureSubmissionOwner(
    submissionId,
    parsed.data.guestToken,
  );
  const ownershipResponse = getOwnershipResponse(ownership.error);
  if (ownershipResponse) return ownershipResponse;

  const submission = ownership.submission;
  if (!submission) {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (submission.payment_status === "PAID") {
    return NextResponse.json(
      { error: "이미 결제가 완료된 접수입니다." },
      { status: 409 },
    );
  }
  if (submission.status === "DRAFT") {
    return NextResponse.json(
      { error: "임시저장 상태에서는 결제 방식을 선택할 수 없습니다." },
      { status: 409 },
    );
  }

  const amountKrw = Math.round(Number(submission.amount_krw ?? 0));
  if (!Number.isFinite(amountKrw) || amountKrw <= 0) {
    return NextResponse.json(
      { error: "결제 금액이 유효하지 않습니다." },
      { status: 400 },
    );
  }

  const nextStatus = terminalStatuses.has(String(submission.status ?? ""))
    ? submission.status
    : "WAITING_PAYMENT";
  const admin = createAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("submissions")
    .update({
      payment_method: parsed.data.method,
      payment_status: "PAYMENT_PENDING",
      status: nextStatus,
    })
    .eq("id", submission.id)
    .neq("payment_status", "PAID")
    .select("id, payment_method, payment_status, status")
    .maybeSingle();

  if (updateError || !updated) {
    console.error("[submissions/payment-method] update failed", {
      submissionId,
      error: updateError,
    });
    return NextResponse.json(
      { error: "결제 방식을 저장하지 못했습니다." },
      { status: 500 },
    );
  }

  const methodLabel =
    parsed.data.method === "BANK" ? "무통장 입금" : "카드 결제";
  const { error: eventError } = await admin.from("submission_events").insert({
    submission_id: submission.id,
    actor_user_id: ownership.user?.id ?? null,
    event_type: "PAYMENT_UPDATE",
    message: `결제 방식이 ${methodLabel}으로 선택되었습니다.`,
  });
  if (eventError) {
    console.warn("[submissions/payment-method] event insert failed", {
      submissionId,
      error: eventError,
    });
  }

  revalidatePath(`/dashboard/pay/${submission.id}`);
  revalidatePath(`/dashboard/submissions/${submission.id}`);
  revalidatePath(`/mypage/submissions/${submission.id}`);
  revalidatePath("/dashboard/drafts");
  revalidatePath("/mypage/drafts");

  return NextResponse.json({
    ok: true,
    paymentMethod: updated.payment_method,
    paymentStatus: updated.payment_status,
    status: updated.status,
  });
}

export const POST = PATCH;
