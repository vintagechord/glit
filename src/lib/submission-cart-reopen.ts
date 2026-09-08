import type { createAdminClient } from "@/lib/supabase/admin";

type ReopenInput = {
  submissionIds: string[];
  userId: string | null;
  guestTokensBySubmissionId: Record<string, string>;
};
type ReopenResult =
  | { ok: true; reopenedIds: string[] }
  | { ok: false; status: number; error: string };

/** Ownership is checked here and again under the RPC's row locks. */
export async function reopenSubmissionCart(
  admin: Pick<ReturnType<typeof createAdminClient>, "from" | "rpc">,
  input: ReopenInput,
): Promise<ReopenResult> {
  const submissionIds = [...new Set(input.submissionIds)];
  let query = admin.from("submissions")
    .select("id, user_id, guest_token")
    .in("id", submissionIds);
  query = input.userId
    ? query.eq("user_id", input.userId)
    : query.is("user_id", null);
  const { data, error } = await query;
  if (error) return { ok: false, status: 500, error: "신청서 정보를 확인하지 못했습니다." };
  if (
    data?.length !== submissionIds.length ||
    data.some(row => input.userId
      ? row.user_id !== input.userId
      : row.user_id !== null || !row.guest_token ||
        input.guestTokensBySubmissionId[row.id] !== row.guest_token)
  ) {
    return { ok: false, status: 403, error: "신청서의 소유권을 확인할 수 없습니다." };
  }

  const { data: reopened, error: reopenError } = await admin.rpc(
    "reopen_submission_bank_payment",
    {
      p_submission_ids: submissionIds,
      p_user_id: input.userId,
      p_guest_tokens_by_submission_id: input.guestTokensBySubmissionId,
    },
  );
  if (reopenError) {
    if (reopenError.code === "42501" || reopenError.code === "P0002") {
      return { ok: false, status: 403, error: "신청서의 소유권을 확인할 수 없습니다." };
    }
    if (reopenError.message?.includes("ALBUM_GROUP_INCOMPLETE")) {
      return { ok: false, status: 409, error: "함께 작성한 앨범 묶음 전체의 결제 수단을 다시 선택해주세요." };
    }
    if (reopenError.code === "55000") {
      return { ok: false, status: 409, error: "결제 또는 심의 상태가 변경되었습니다. 입금 전인 무통장 신청만 취소할 수 있습니다." };
    }
    console.error("[CartReopen] transaction failed", { code: reopenError.code });
    return { ok: false, status: 500, error: "무통장 입금 신청을 취소하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }
  const reopenedIds = Array.from(new Set(
    ((reopened ?? []) as Array<{ submission_id: string }>).map(row => row.submission_id),
  ));
  if (
    reopenedIds.length !== submissionIds.length ||
    submissionIds.some(id => !reopenedIds.includes(id))
  ) {
    return { ok: false, status: 500, error: "변경된 결제 상태를 확인하지 못했습니다. 장바구니를 새로고침해주세요." };
  }
  return { ok: true, reopenedIds };
}
