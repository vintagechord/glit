import type { SupabaseClient } from "@supabase/supabase-js";

import { isRatingCode } from "@/lib/mv-assets";

type ResultStatusValue = "APPROVED" | "REJECTED" | "NEEDS_FIX";

type SubmissionRow = {
  id: string;
  type?: string | null;
  mv_desired_rating?: string | null;
  result_status?: string | null;
  result_memo?: string | null;
};

type SupabaseLikeError = {
  code?: string;
  message?: string | null;
};

const mvFallbackStationByType: Record<string, { code: string; name: string }> = {
  MV_DISTRIBUTION: { code: "MV_ONLINE", name: "영상물등급위원회" },
  MV_BROADCAST: { code: "MV_BROADCAST", name: "신청 방송국" },
};

const resultStatusValues = new Set(["APPROVED", "REJECTED", "NEEDS_FIX"]);

const formatSupabaseError = (error?: SupabaseLikeError | null) => {
  if (!error) return "unknown error";
  const code = error.code ? `(${error.code})` : "";
  return `${code} ${error.message ?? "unknown error"}`.trim();
};

const normalizeResultStatus = (status?: string | null): ResultStatusValue | null => {
  if (!status) return null;
  return resultStatusValues.has(status) ? (status as ResultStatusValue) : null;
};

const deriveResultStatusFromRating = (rating?: string | null): ResultStatusValue | null => {
  if (!rating || !isRatingCode(rating)) return null;
  return rating === "REJECT" ? "REJECTED" : "APPROVED";
};

export async function resolveMvFallbackStationId(
  client: SupabaseClient,
  submissionId: string,
) {
  const { data: submission, error: submissionError } = await client
    .from("submissions")
    .select("type")
    .eq("id", submissionId)
    .maybeSingle();

  if (submissionError) {
    return {
      stationId: "",
      error: `접수 정보를 확인할 수 없습니다. ${formatSupabaseError(submissionError)}`,
    };
  }

  const type = typeof submission?.type === "string" ? submission.type : "";
  const fallbackStation = mvFallbackStationByType[type];
  if (!fallbackStation) {
    return { stationId: "", error: "방송국 ID를 확인할 수 없습니다." };
  }

  const { data: station, error: stationError } = await client
    .from("stations")
    .upsert(
      { code: fallbackStation.code, name: fallbackStation.name, is_active: true },
      { onConflict: "code" },
    )
    .select("id")
    .maybeSingle();

  if (stationError || !station?.id) {
    return {
      stationId: "",
      error: `MV 진행 기준 방송국을 저장할 수 없습니다. ${formatSupabaseError(stationError)}`,
    };
  }

  return { stationId: station.id as string, error: null };
}

export async function completeMvReviewFlow(
  client: SupabaseClient,
  submissionId: string,
  options: {
    rating?: string | null;
    resultStatus?: string | null;
    resultMemo?: string | null;
  } = {},
) {
  const { data: submission, error: submissionError } = await client
    .from("submissions")
    .select("id, type, mv_desired_rating, result_status, result_memo")
    .eq("id", submissionId)
    .maybeSingle();

  if (submissionError) {
    return {
      completed: false,
      error: `접수 정보를 확인할 수 없습니다. ${formatSupabaseError(submissionError)}`,
    };
  }

  const row = submission as SubmissionRow | null;
  if (!row?.type?.startsWith("MV_")) {
    return { completed: false };
  }

  const isMvDistribution = row.type === "MV_DISTRIBUTION";
  const now = new Date().toISOString();
  const rating = isMvDistribution
    ? options.rating ?? row.mv_desired_rating ?? null
    : null;
  const resultStatus =
    normalizeResultStatus(options.resultStatus) ??
    normalizeResultStatus(row.result_status) ??
    (isMvDistribution ? deriveResultStatusFromRating(rating) : null);
  const resultMemo =
    options.resultMemo !== undefined ? options.resultMemo : row.result_memo ?? null;
  const resultNote = resultMemo?.trim() || null;

  const submissionUpdate: Record<string, unknown> = {
    status: "RESULT_READY",
    updated_at: now,
  };
  if (isMvDistribution && rating && isRatingCode(rating)) {
    submissionUpdate.mv_desired_rating = rating;
  } else if (!isMvDistribution && row.mv_desired_rating) {
    submissionUpdate.mv_desired_rating = null;
  }
  if (resultStatus) {
    submissionUpdate.result_status = resultStatus;
  }
  if (options.resultMemo !== undefined) {
    submissionUpdate.result_memo = resultNote;
  }

  let { error: updateError } = await client
    .from("submissions")
    .update(submissionUpdate)
    .eq("id", submissionId);

  if (updateError?.code === "42703") {
    const retryPayload = { ...submissionUpdate };
    const message = updateError.message?.toLowerCase() ?? "";
    if (message.includes("result_status")) delete retryPayload.result_status;
    if (message.includes("result_memo")) delete retryPayload.result_memo;
    if (message.includes("mv_desired_rating")) delete retryPayload.mv_desired_rating;

    const retry = await client
      .from("submissions")
      .update(retryPayload)
      .eq("id", submissionId);
    updateError = retry.error;
  }

  if (updateError) {
    return {
      completed: false,
      error: `MV 결과 상태를 저장하지 못했습니다. ${formatSupabaseError(updateError)}`,
    };
  }

  const { data: existingReviews, error: reviewLoadError } = await client
    .from("station_reviews")
    .select("id, station_id")
    .eq("submission_id", submissionId);

  if (reviewLoadError) {
    return {
      completed: false,
      error: `방송국 진행 정보를 확인하지 못했습니다. ${formatSupabaseError(reviewLoadError)}`,
    };
  }

  const stationReviewStatus =
    resultStatus === "REJECTED"
      ? "REJECTED"
      : resultStatus === "NEEDS_FIX"
        ? "NEEDS_FIX"
        : "APPROVED";

  const reviewPayload = {
    status: stationReviewStatus,
    result_note: resultNote,
    updated_at: now,
  };

  if (existingReviews && existingReviews.length > 0) {
    const { error: reviewUpdateError } = await client
      .from("station_reviews")
      .update(reviewPayload)
      .eq("submission_id", submissionId);

    if (reviewUpdateError) {
      return {
        completed: false,
        error: `방송국 진행 결과를 반영하지 못했습니다. ${formatSupabaseError(
          reviewUpdateError,
        )}`,
      };
    }

    return { completed: true, stationCount: existingReviews.length, resultStatus };
  }

  const fallback = await resolveMvFallbackStationId(client, submissionId);
  if (fallback.error || !fallback.stationId) {
    return {
      completed: false,
      error: fallback.error ?? "MV 진행 기준 방송국을 확인하지 못했습니다.",
    };
  }

  const { error: insertError } = await client
    .from("station_reviews")
    .upsert(
      {
        submission_id: submissionId,
        station_id: fallback.stationId,
        ...reviewPayload,
      },
      { onConflict: "submission_id,station_id" },
    );

  if (insertError) {
    return {
      completed: false,
      error: `방송국 진행 결과를 생성하지 못했습니다. ${formatSupabaseError(insertError)}`,
    };
  }

  return { completed: true, stationCount: 1, resultStatus };
}
