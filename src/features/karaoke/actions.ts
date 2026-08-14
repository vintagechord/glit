"use server";

import { z } from "zod";

import { APP_CONFIG } from "@/lib/config";
import { requireAdminAction } from "@/lib/admin/action-auth";
import { getB2Config } from "@/lib/b2";
import { getGuestStorageOwnerId } from "@/lib/guest-storage-owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type KaraokeActionState = {
  error?: string;
  message?: string;
  requestId?: string;
};

export type KaraokeFileUrlActionState = {
  error?: string;
  url?: string;
};

const karaokeRequestSchema = z.object({
  title: z.string().min(1).max(500),
  artist: z.string().max(500).optional(),
  contact: z.string().min(3).max(500),
  notes: z.string().max(20_000).optional(),
  filePath: z.string().max(1_024).optional(),
  paymentMethod: z.enum(["CARD", "BANK"]),
  bankDepositorName: z.string().max(500).optional(),
  tjRequested: z.boolean().optional(),
  kyRequested: z.boolean().optional(),
  recommendationPublic: z.boolean().optional(),
  promotionCredits: z.number().int().min(0).max(1_000_000).optional(),
  guestName: z.string().min(1).max(500).optional(),
  guestEmail: z.string().email().max(320).optional(),
  guestPhone: z.string().min(3).max(100).optional(),
  guestToken: z.string().min(8).max(120).optional(),
});

const karaokeStatusSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["REQUESTED", "IN_REVIEW", "COMPLETED"]),
  paymentStatus: z
    .enum(["UNPAID", "PAYMENT_PENDING", "PAID", "REFUNDED"])
    .optional(),
});

const karaokeVoteSchema = z.object({
  requestId: z.string().uuid(),
  proofPath: z.string().optional(),
});

const karaokeVoteStatusSchema = z.object({
  voteId: z.string().uuid(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
});

const promotionContributionSchema = z
  .object({
    submissionId: z.string().uuid().optional(),
    promotionId: z.string().uuid().optional(),
    credits: z.number().int().positive().max(1_000_000),
    tjEnabled: z.boolean().optional(),
    kyEnabled: z.boolean().optional(),
    referenceUrl: z.string().max(2_048).optional(),
  })
  .refine((data) => data.submissionId || data.promotionId, {
    message: "대상 정보가 필요합니다.",
  });

const karaokeRequestFileSchema = z.object({
  requestId: z.string().uuid(),
});

const karaokeRecommendationFileSchema = z.object({
  recommendationId: z.string().uuid(),
});

const promotionRecommendationSchema = z.object({
  promotionId: z.string().uuid(),
  proofPath: z.string().optional(),
});

const promotionRecommendationStatusSchema = z.object({
  recommendationId: z.string().uuid(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
});

const buildAdminKaraokeSavedPath = (redirectTo?: string | null) => {
  const fallbackParams = new URLSearchParams();
  fallbackParams.set("saved", "1");
  const fallbackPath = `/admin/karaoke?${fallbackParams.toString()}`;

  const raw = redirectTo?.trim();
  if (!raw || !raw.startsWith("/admin/karaoke")) {
    return fallbackPath;
  }

  const [baseWithQuery, hash] = raw.split("#");
  const [pathname, query] = baseWithQuery.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("saved", "1");
  const nextPath = `${pathname}?${params.toString()}`;
  return hash ? `${nextPath}#${hash}` : nextPath;
};

const classifyB2ObjectKey = (
  objectKey: string,
  ownerId: string,
): "owned" | "foreign" | "other" => {
  try {
    const { prefix } = getB2Config();
    if (!objectKey.startsWith(prefix)) return "other";
    return objectKey.startsWith(`${prefix}${ownerId}/`) ? "owned" : "foreign";
  } catch {
    return "other";
  }
};

const formatKaraokeCreditRpcError = (
  message: string | null | undefined,
  fallback: string,
) => {
  const value = message ?? "";
  if (value.includes("KARAOKE_CREDITS_INSUFFICIENT")) {
    return "보유한 크레딧이 부족합니다.";
  }
  if (value.includes("KARAOKE_PROMOTION_CREDITS_EXHAUSTED")) {
    return "추천 노출 크레딧이 부족합니다.";
  }
  if (value.includes("KARAOKE_SUBMISSION_OWNER_MISMATCH")) {
    return "본인 심의에만 크레딧을 사용할 수 있습니다.";
  }
  if (
    value.includes("KARAOKE_PROMOTION_NOT_FOUND") ||
    value.includes("KARAOKE_SUBMISSION_NOT_FOUND") ||
    value.includes("KARAOKE_RECOMMENDATION_NOT_FOUND") ||
    value.includes("KARAOKE_VOTE_NOT_FOUND")
  ) {
    return "추천 정보를 찾을 수 없습니다.";
  }
  if (
    value.includes("APPROVAL_TERMINAL") ||
    value.includes("STATE_CHANGED")
  ) {
    return "이미 처리된 요청입니다. 최신 상태를 확인해주세요.";
  }
  return fallback;
};

export async function createKaraokeRequestAction(
  payload: z.infer<typeof karaokeRequestSchema>,
): Promise<KaraokeActionState> {
  const parsed = karaokeRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  const isGuest = !user;
  if (parsed.data.paymentMethod === "CARD" && isGuest) {
    return { error: "로그인 후 카드 결제를 이용해주세요." };
  }
  if (isGuest && (!parsed.data.guestName || !parsed.data.guestEmail)) {
    return { error: "비회원 정보를 입력해주세요." };
  }
  const uploadOwnerIds = user?.id
    ? [user.id]
    : parsed.data.guestToken
      ? [
          getGuestStorageOwnerId(parsed.data.guestToken),
          `guest-${parsed.data.guestToken}`,
        ]
      : [];
  if (
    parsed.data.filePath &&
    !uploadOwnerIds.some(
      (ownerId) => classifyB2ObjectKey(parsed.data.filePath as string, ownerId) === "owned",
    )
  ) {
    return { error: "첨부 파일의 업로드 경로를 확인해주세요." };
  }
  if (
    parsed.data.paymentMethod === "BANK" &&
    !parsed.data.bankDepositorName?.trim()
  ) {
    return { error: "입금자명을 입력해주세요." };
  }
  const recommendationPublic = parsed.data.recommendationPublic ?? false;
  const promotionCredits = parsed.data.promotionCredits ?? 0;
  if (recommendationPublic && isGuest) {
    return { error: "추천 공개는 로그인 후 이용할 수 있습니다." };
  }
  if (recommendationPublic && promotionCredits < 1) {
    return { error: "추천 공개에는 최소 1크레딧이 필요합니다." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "create_karaoke_request_with_promotion",
    {
      p_user_id: user?.id ?? null,
      p_title: parsed.data.title,
      p_artist: parsed.data.artist ?? null,
      p_contact: parsed.data.contact,
      p_notes: parsed.data.notes ?? null,
      p_file_path: parsed.data.filePath ?? null,
      p_payment_method: parsed.data.paymentMethod,
      p_amount_krw: APP_CONFIG.karaokeFeeKrw,
      p_bank_depositor_name:
        parsed.data.paymentMethod === "BANK"
          ? parsed.data.bankDepositorName?.trim() ?? null
          : null,
      p_tj_requested: parsed.data.tjRequested ?? true,
      p_ky_requested: parsed.data.kyRequested ?? true,
      p_guest_name: isGuest ? parsed.data.guestName ?? null : null,
      p_guest_email: isGuest ? parsed.data.guestEmail ?? null : null,
      p_guest_phone: isGuest
        ? parsed.data.guestPhone ?? parsed.data.contact
        : null,
      p_recommendation_public: recommendationPublic,
      p_promotion_credits: promotionCredits,
    },
  );

  if (error) {
    console.error("[karaoke][request][atomic-create-error]", {
      code: error.code,
    });
    return {
      error: formatKaraokeCreditRpcError(
        error.message,
        "요청 접수에 실패했습니다.",
      ),
    };
  }

  const result = (Array.isArray(data) ? data[0] : data) as
    | { result_request_id?: string }
    | null;
  return {
    message: "노래방 등록 요청이 접수되었습니다.",
    requestId: result?.result_request_id,
  };
}

export async function getKaraokeRequestFileUrlAction(
  payload: z.infer<typeof karaokeRequestFileSchema>,
): Promise<KaraokeFileUrlActionState> {
  const parsed = karaokeRequestFileSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "파일 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  if (!user) {
    return { error: "로그인 후 확인할 수 있습니다." };
  }

  const { data: request } = await supabase
    .from("karaoke_requests")
    .select("file_path")
    .eq("id", parsed.data.requestId)
    .maybeSingle();

  if (!request?.file_path) {
    return { error: "첨부된 파일이 없습니다." };
  }

  const objectKeyKind = classifyB2ObjectKey(request.file_path, user.id);
  const { data: isAdmin, error: adminCheckError } =
    objectKeyKind === "foreign"
      ? await supabase.rpc("is_admin")
      : { data: false, error: null };
  if (adminCheckError) {
    console.warn("[karaoke][request-file][admin-check-error]", {
      code: adminCheckError.code,
    });
  }
  if (objectKeyKind === "foreign" && isAdmin !== true) {
    return { error: "첨부 파일에 접근할 권한이 없습니다." };
  }

  // The RLS-scoped row read above proves the exact stored reference. Admins may
  // presign that foreign B2 key; regular users remain restricted to their prefix.
  if (objectKeyKind === "owned" || (objectKeyKind === "foreign" && isAdmin === true)) {
    try {
      const url = await import("@/lib/b2")
        .then(({ presignGetUrl }) => presignGetUrl(request.file_path, 300))
        .catch(() => null);
      if (url) return { url };
    } catch {
      // fall through to supabase
    }
  }

  const { data, error } = await supabase.storage
    .from("submissions")
    .createSignedUrl(request.file_path, 60 * 10);

  if (error || !data?.signedUrl) {
    return { error: "다운로드 링크를 생성할 수 없습니다." };
  }

  return { url: data.signedUrl };
}

export async function getKaraokeRecommendationFileUrlAction(
  payload: z.infer<typeof karaokeRecommendationFileSchema>,
): Promise<KaraokeFileUrlActionState> {
  const parsed = karaokeRecommendationFileSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "파일 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  if (!user) {
    return { error: "로그인 후 확인할 수 있습니다." };
  }

  const { data: recommendation } = await supabase
    .from("karaoke_promotion_recommendations")
    .select("proof_path")
    .eq("id", parsed.data.recommendationId)
    .maybeSingle();

  if (!recommendation?.proof_path) {
    return { error: "첨부된 파일이 없습니다." };
  }

  const objectKeyKind = classifyB2ObjectKey(recommendation.proof_path, user.id);
  const { data: isAdmin, error: adminCheckError } =
    objectKeyKind === "foreign"
      ? await supabase.rpc("is_admin")
      : { data: false, error: null };
  if (adminCheckError) {
    console.warn("[karaoke][recommendation-file][admin-check-error]", {
      code: adminCheckError.code,
    });
  }
  if (objectKeyKind === "foreign" && isAdmin !== true) {
    return { error: "첨부 파일에 접근할 권한이 없습니다." };
  }

  if (objectKeyKind === "owned" || (objectKeyKind === "foreign" && isAdmin === true)) {
    try {
      const url = await import("@/lib/b2")
        .then(({ presignGetUrl }) => presignGetUrl(recommendation.proof_path, 300))
        .catch(() => null);
      if (url) return { url };
    } catch {
      // fall back
    }
  }

  const { data, error } = await supabase.storage
    .from("submissions")
    .createSignedUrl(recommendation.proof_path, 60 * 10);

  if (error || !data?.signedUrl) {
    return { error: "다운로드 링크를 생성할 수 없습니다." };
  }

  return { url: data.signedUrl };
}

export async function createKaraokeVoteAction(
  payload: z.infer<typeof karaokeVoteSchema>,
): Promise<KaraokeActionState> {
  const parsed = karaokeVoteSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "추천 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  if (!user) {
    return { error: "로그인 후 추천에 참여할 수 있습니다." };
  }
  if (
    parsed.data.proofPath &&
    classifyB2ObjectKey(parsed.data.proofPath, user.id) !== "owned"
  ) {
    return { error: "인증 파일의 업로드 경로를 확인해주세요." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("karaoke_votes").insert({
    request_id: parsed.data.requestId,
    voter_user_id: user.id,
    proof_path: parsed.data.proofPath ?? null,
  });

  if (error) {
    return { error: "추천 접수에 실패했습니다." };
  }

  return { message: "추천 요청이 접수되었습니다. 인증 확인 후 크레딧이 지급됩니다." };
}

export async function contributeKaraokePromotionAction(
  payload: z.infer<typeof promotionContributionSchema>,
): Promise<KaraokeActionState> {
  const parsed = promotionContributionSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "크레딧 사용 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  if (!user) {
    return { error: "로그인 후 크레딧을 사용할 수 있습니다." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "contribute_karaoke_promotion_credits",
    {
      p_user_id: user.id,
      p_submission_id: parsed.data.submissionId ?? null,
      p_promotion_id: parsed.data.promotionId ?? null,
      p_credits: parsed.data.credits,
      p_tj_enabled: parsed.data.tjEnabled ?? null,
      p_ky_enabled: parsed.data.kyEnabled ?? null,
      p_reference_url: parsed.data.referenceUrl?.trim() || null,
    },
  );
  if (error) {
    console.error("[karaoke][promotion][atomic-contribution-error]", {
      code: error.code,
    });
    return {
      error: formatKaraokeCreditRpcError(
        error.message,
        "크레딧 반영에 실패했습니다.",
      ),
    };
  }
  const result = (Array.isArray(data) ? data[0] : data) as
    | { result_status?: string }
    | null;

  return {
    message:
      result?.result_status === "ACTIVE"
        ? "추천 노출이 활성화되었습니다."
        : "크레딧이 반영되었습니다.",
  };
}

export async function createKaraokePromotionRecommendationAction(
  payload: z.infer<typeof promotionRecommendationSchema>,
): Promise<KaraokeActionState> {
  const parsed = promotionRecommendationSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "추천 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  if (!user) {
    return { error: "로그인 후 추천에 참여할 수 있습니다." };
  }
  if (
    parsed.data.proofPath &&
    classifyB2ObjectKey(parsed.data.proofPath, user.id) !== "owned"
  ) {
    return { error: "인증 파일의 업로드 경로를 확인해주세요." };
  }

  const { data: promotion } = await supabase
    .from("karaoke_promotions")
    .select("id, owner_user_id, credits_balance, status")
    .eq("id", parsed.data.promotionId)
    .maybeSingle();

  if (!promotion || promotion.status !== "ACTIVE") {
    return { error: "추천 가능한 대상이 없습니다." };
  }

  if (promotion.credits_balance <= 0) {
    return { error: "추천 노출 크레딧이 부족합니다." };
  }

  if (promotion.owner_user_id === user.id) {
    return { error: "본인의 곡에는 추천을 등록할 수 없습니다." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("karaoke_promotion_recommendations")
    .insert({
      promotion_id: promotion.id,
      recommender_user_id: user.id,
      proof_path: parsed.data.proofPath ?? null,
    });

  if (error) {
    return { error: "추천 접수에 실패했습니다." };
  }

  return { message: "추천 요청이 접수되었습니다. 인증 확인 후 크레딧이 지급됩니다." };
}

export async function updateKaraokePromotionRecommendationStatusAction(
  payload: z.infer<typeof promotionRecommendationStatusSchema>,
): Promise<KaraokeActionState> {
  await requireAdminAction();
  const parsed = promotionRecommendationStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "추천 상태를 확인해주세요." };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc(
    "set_karaoke_promotion_recommendation_status",
    {
      p_recommendation_id: parsed.data.recommendationId,
      p_status: parsed.data.status,
    },
  );
  if (error) {
    return {
      error: formatKaraokeCreditRpcError(
        error.message,
        "추천 상태 변경에 실패했습니다.",
      ),
    };
  }

  return { message: "추천 상태가 업데이트되었습니다." };
}

export async function updateKaraokeVoteStatusAction(
  payload: z.infer<typeof karaokeVoteStatusSchema>,
): Promise<KaraokeActionState> {
  await requireAdminAction();
  const parsed = karaokeVoteStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "추천 상태를 확인해주세요." };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_karaoke_vote_status", {
    p_vote_id: parsed.data.voteId,
    p_status: parsed.data.status,
  });
  if (error) {
    return {
      error: formatKaraokeCreditRpcError(
        error.message,
        "추천 상태 변경에 실패했습니다.",
      ),
    };
  }

  return { message: "추천 상태가 업데이트되었습니다." };
}

export async function updateKaraokeStatusAction(
  payload: z.infer<typeof karaokeStatusSchema>,
): Promise<KaraokeActionState> {
  await requireAdminAction();
  const parsed = karaokeStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "상태를 확인해주세요." };
  }

  const updatePayload: Record<string, string> = {
    status: parsed.data.status,
  };
  if (parsed.data.paymentStatus) {
    updatePayload.payment_status = parsed.data.paymentStatus;
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("karaoke_requests")
    .update(updatePayload)
    .eq("id", parsed.data.requestId);

  if (error) {
    return { error: "상태 변경에 실패했습니다." };
  }

  return { message: "상태가 업데이트되었습니다." };
}

export async function updateKaraokeStatusFormAction(
  formData: FormData,
): Promise<void> {
  const paymentStatus = String(formData.get("paymentStatus") ?? "");
  const result = await updateKaraokeStatusAction({
    requestId: String(formData.get("requestId") ?? ""),
    status: String(formData.get("status") ?? "") as
      | "REQUESTED"
      | "IN_REVIEW"
      | "COMPLETED",
    paymentStatus: paymentStatus
      ? (paymentStatus as
          | "UNPAID"
          | "PAYMENT_PENDING"
          | "PAID"
          | "REFUNDED")
      : undefined,
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  redirect(buildAdminKaraokeSavedPath(String(formData.get("redirectTo") ?? "")));
}

export async function updateKaraokeVoteStatusFormAction(
  formData: FormData,
): Promise<void> {
  const result = await updateKaraokeVoteStatusAction({
    voteId: String(formData.get("voteId") ?? ""),
    status: String(formData.get("status") ?? "") as
      | "PENDING"
      | "APPROVED"
      | "REJECTED",
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  redirect(buildAdminKaraokeSavedPath(String(formData.get("redirectTo") ?? "")));
}

export async function updateKaraokePromotionRecommendationStatusFormAction(
  formData: FormData,
): Promise<void> {
  const result = await updateKaraokePromotionRecommendationStatusAction({
    recommendationId: String(formData.get("recommendationId") ?? ""),
    status: String(formData.get("status") ?? "") as
      | "PENDING"
      | "APPROVED"
      | "REJECTED",
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  redirect(buildAdminKaraokeSavedPath(String(formData.get("redirectTo") ?? "")));
}
