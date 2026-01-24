"use server";

import { z } from "zod";

import { APP_CONFIG } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

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
  title: z.string().min(1),
  artist: z.string().optional(),
  contact: z.string().min(3),
  notes: z.string().optional(),
  filePath: z.string().optional(),
  paymentMethod: z.enum(["CARD", "BANK"]),
  bankDepositorName: z.string().optional(),
  tjRequested: z.boolean().optional(),
  kyRequested: z.boolean().optional(),
  guestName: z.string().min(1).optional(),
  guestEmail: z.string().email().optional(),
  guestPhone: z.string().min(3).optional(),
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
    credits: z.number().int().positive(),
    tjEnabled: z.boolean().optional(),
    kyEnabled: z.boolean().optional(),
    referenceUrl: z.string().optional(),
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
  if (
    parsed.data.paymentMethod === "BANK" &&
    !parsed.data.bankDepositorName?.trim()
  ) {
    return { error: "입금자명을 입력해주세요." };
  }

  const db = isGuest ? createAdminClient() : supabase;

  const { data, error } = await db
    .from("karaoke_requests")
    .insert({
      user_id: user?.id ?? null,
      guest_name: isGuest ? parsed.data.guestName : null,
      guest_email: isGuest ? parsed.data.guestEmail : null,
      guest_phone: isGuest
        ? parsed.data.guestPhone ?? parsed.data.contact
        : null,
      title: parsed.data.title,
      artist: parsed.data.artist || null,
      contact: parsed.data.contact,
      notes: parsed.data.notes || null,
      file_path: parsed.data.filePath || null,
      payment_method: parsed.data.paymentMethod,
      payment_status: "PAYMENT_PENDING",
      amount_krw: APP_CONFIG.karaokeFeeKrw,
      bank_depositor_name:
        parsed.data.paymentMethod === "BANK"
          ? parsed.data.bankDepositorName?.trim() ?? null
          : null,
      tj_requested: parsed.data.tjRequested ?? true,
      ky_requested: parsed.data.kyRequested ?? true,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: "요청 접수에 실패했습니다." };
  }

  return { message: "노래방 등록 요청이 접수되었습니다.", requestId: data?.id ?? undefined };
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

  try {
    const url = await import("@/lib/b2")
      .then(({ presignGetUrl }) => presignGetUrl(request.file_path, 300))
      .catch(() => null);
    if (url) return { url };
  } catch {
    // fall through to supabase
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

  try {
    const url = await import("@/lib/b2")
      .then(({ presignGetUrl }) => presignGetUrl(recommendation.proof_path, 300))
      .catch(() => null);
    if (url) return { url };
  } catch {
    // fall back
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

  const { error } = await supabase.from("karaoke_votes").insert({
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

  const creditsToUse = parsed.data.credits;
  if (creditsToUse <= 0) {
    return { error: "사용할 크레딧을 입력해주세요." };
  }

  const admin = createAdminClient();

  let promotion = null;
  const referenceUrl = parsed.data.referenceUrl?.trim() || null;
  if (parsed.data.promotionId) {
    const { data } = await admin
      .from("karaoke_promotions")
      .select(
        "id, submission_id, owner_user_id, credits_balance, credits_required, status, tj_enabled, ky_enabled, reference_url",
      )
      .eq("id", parsed.data.promotionId)
      .maybeSingle();
    promotion = data ?? null;
  }

  if (!promotion && parsed.data.submissionId) {
    const { data: submission } = await admin
      .from("submissions")
      .select("id, user_id")
      .eq("id", parsed.data.submissionId)
      .maybeSingle();
    if (!submission) {
      return { error: "심의 정보를 찾을 수 없습니다." };
    }
    if (submission.user_id !== user.id) {
      return { error: "본인 심의에만 크레딧을 사용할 수 있습니다." };
    }

    const { data: existingPromotion } = await admin
      .from("karaoke_promotions")
      .select(
        "id, submission_id, owner_user_id, credits_balance, credits_required, status, tj_enabled, ky_enabled, reference_url",
      )
      .eq("submission_id", submission.id)
      .maybeSingle();

    if (existingPromotion) {
      promotion = existingPromotion;
    } else {
      const { data: createdPromotion, error: promotionError } = await admin
        .from("karaoke_promotions")
        .insert({
          submission_id: submission.id,
          owner_user_id: user.id,
          status: "PENDING",
          credits_balance: 0,
          credits_required: 10,
          tj_enabled: parsed.data.tjEnabled ?? true,
          ky_enabled: parsed.data.kyEnabled ?? true,
          reference_url: referenceUrl,
        })
        .select(
          "id, submission_id, owner_user_id, credits_balance, credits_required, status, tj_enabled, ky_enabled, reference_url",
        )
        .maybeSingle();

      if (promotionError || !createdPromotion) {
        return { error: "추천 노출 정보를 생성할 수 없습니다." };
      }
      promotion = createdPromotion;
    }
  }

  if (!promotion) {
    return { error: "추천 노출 정보를 찾을 수 없습니다." };
  }

  const { data: creditRow } = await admin
    .from("karaoke_credits")
    .select("balance")
    .eq("user_id", user.id)
    .maybeSingle();

  const currentBalance = creditRow?.balance ?? 0;
  if (currentBalance < creditsToUse) {
    return { error: "보유한 크레딧이 부족합니다." };
  }

  const nextBalance = currentBalance - creditsToUse;
  const nextPromotionBalance = (promotion.credits_balance ?? 0) + creditsToUse;
  const shouldActivate =
    promotion.status === "ACTIVE" ||
    nextPromotionBalance >= promotion.credits_required;

  const { error: promotionUpdateError } = await admin
    .from("karaoke_promotions")
    .update({
      credits_balance: nextPromotionBalance,
      status: shouldActivate ? "ACTIVE" : "PENDING",
      tj_enabled: parsed.data.tjEnabled ?? promotion.tj_enabled,
      ky_enabled: parsed.data.kyEnabled ?? promotion.ky_enabled,
      reference_url: referenceUrl ?? promotion.reference_url ?? null,
    })
    .eq("id", promotion.id);

  if (promotionUpdateError) {
    return { error: "크레딧 반영에 실패했습니다." };
  }

  const { error: contributionError } = await admin
    .from("karaoke_promotion_contributions")
    .insert({
      promotion_id: promotion.id,
      contributor_user_id: user.id,
      credits: creditsToUse,
    });

  if (contributionError) {
    return { error: "크레딧 사용 기록에 실패했습니다." };
  }

  await admin.from("karaoke_credits").upsert({
    user_id: user.id,
    balance: nextBalance,
  });

  await admin.from("karaoke_credit_events").insert({
    user_id: user.id,
    delta: -creditsToUse,
    reason: "노래방 추천 노출 크레딧 사용",
  });

  return {
    message:
      nextPromotionBalance >= promotion.credits_required
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

  const { error } = await supabase
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
  const parsed = promotionRecommendationStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "추천 상태를 확인해주세요." };
  }

  const admin = createAdminClient();
  const { data: recommendation } = await admin
    .from("karaoke_promotion_recommendations")
    .select("id, recommender_user_id, status, promotion_id")
    .eq("id", parsed.data.recommendationId)
    .maybeSingle();

  if (!recommendation) {
    return { error: "추천 정보를 찾을 수 없습니다." };
  }

  const { error: updateError } = await admin
    .from("karaoke_promotion_recommendations")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.recommendationId);

  if (updateError) {
    return { error: "추천 상태 변경에 실패했습니다." };
  }

  if (
    parsed.data.status === "APPROVED" &&
    recommendation.status !== "APPROVED"
  ) {
    const { data: promotion } = await admin
      .from("karaoke_promotions")
      .select("id, credits_balance, credits_required, status")
      .eq("id", recommendation.promotion_id)
      .maybeSingle();

    if (!promotion) {
      return { error: "추천 대상 정보를 찾을 수 없습니다." };
    }

    if (promotion.credits_balance <= 0) {
      return { error: "추천 노출 크레딧이 부족합니다." };
    }

    const nextPromotionBalance = Math.max(promotion.credits_balance - 1, 0);
    const nextStatus =
      nextPromotionBalance <= 0
        ? "EXHAUSTED"
        : promotion.status === "ACTIVE"
          ? "ACTIVE"
          : nextPromotionBalance >= promotion.credits_required
            ? "ACTIVE"
            : "PENDING";

    await admin
      .from("karaoke_promotions")
      .update({
        credits_balance: nextPromotionBalance,
        status: nextStatus,
      })
      .eq("id", promotion.id);

    if (recommendation.recommender_user_id) {
      const { data: creditRow } = await admin
        .from("karaoke_credits")
        .select("balance")
        .eq("user_id", recommendation.recommender_user_id)
        .maybeSingle();

      const nextBalance = (creditRow?.balance ?? 0) + 1;
      await admin.from("karaoke_credits").upsert({
        user_id: recommendation.recommender_user_id,
        balance: nextBalance,
      });

      await admin.from("karaoke_credit_events").insert({
        user_id: recommendation.recommender_user_id,
        delta: 1,
        reason: "추천 인증 승인",
      });
    }
  }

  return { message: "추천 상태가 업데이트되었습니다." };
}

export async function updateKaraokeVoteStatusAction(
  payload: z.infer<typeof karaokeVoteStatusSchema>,
): Promise<KaraokeActionState> {
  const parsed = karaokeVoteStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "추천 상태를 확인해주세요." };
  }

  const admin = createAdminClient();
  const { data: vote, error: voteError } = await admin
    .from("karaoke_votes")
    .select("id, voter_user_id, status")
    .eq("id", parsed.data.voteId)
    .maybeSingle();

  if (voteError || !vote) {
    return { error: "추천 정보를 찾을 수 없습니다." };
  }

  const { error } = await admin
    .from("karaoke_votes")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.voteId);

  if (error) {
    return { error: "추천 상태 변경에 실패했습니다." };
  }

  if (
    parsed.data.status === "APPROVED" &&
    vote.voter_user_id &&
    vote.status !== "APPROVED"
  ) {
    const { data: creditRow } = await admin
      .from("karaoke_credits")
      .select("balance")
      .eq("user_id", vote.voter_user_id)
      .maybeSingle();

    const nextBalance = (creditRow?.balance ?? 0) + 1;
    await admin.from("karaoke_credits").upsert({
      user_id: vote.voter_user_id,
      balance: nextBalance,
    });

    await admin.from("karaoke_credit_events").insert({
      user_id: vote.voter_user_id,
      delta: 1,
      reason: "추천 승인",
    });
  }

  return { message: "추천 상태가 업데이트되었습니다." };
}

export async function updateKaraokeStatusAction(
  payload: z.infer<typeof karaokeStatusSchema>,
): Promise<KaraokeActionState> {
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
  }
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
  }
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
  }
}
