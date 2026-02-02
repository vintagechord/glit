"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  paymentStatusEnum,
  resultStatusEnum,
  resultStatusLabelMap,
  reviewStatusEnum,
  stationReviewStatusEnum,
  stationReviewStatusValues,
} from "@/constants/review-status";
import { summarizeTrackResults } from "@/lib/track-results";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRatingCode } from "@/lib/mv-assets";

export type AdminActionState = {
  error?: string;
  message?: string;
  row?: {
    id?: string | null;
    submission_id?: string | null;
    station_id?: string | null;
    status?: string | null;
    result_note?: string | null;
    track_results?: unknown;
    updated_at?: string | null;
  };
};

const submissionStatusSchema = z.object({
  submissionId: z.string().uuid(),
  status: reviewStatusEnum,
  adminMemo: z.string().optional(),
});

const submissionBasicInfoSchema = z.object({
  submissionId: z.string().uuid(),
  title: z.string().optional(),
  artistName: z.string().optional(),
});

const paymentStatusSchema = z.object({
  submissionId: z.string().uuid(),
  paymentStatus: paymentStatusEnum,
  adminMemo: z.string().optional(),
});

const submissionResultSchema = z.object({
  submissionId: z.string().uuid(),
  resultStatus: resultStatusEnum,
  resultMemo: z.string().optional(),
});

const trackResultStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);
const trackResultSchema = z.object({
  trackId: z.string().uuid().optional(),
  trackNo: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
  status: trackResultStatusEnum,
});

const stationReviewPayloadSchema = z.object({
  reviewId: z.string().uuid().optional(),
  submissionId: z.string().uuid(),
  stationId: z.string().uuid().optional(),
  status: stationReviewStatusEnum,
  resultNote: z.string().optional(),
  trackResults: z.array(trackResultSchema).optional(),
});

const isMissingTrackResultsColumn = (error?: { code?: string; message?: string | null }) => {
  if (!error) return false;
  const msg = error.message?.toLowerCase() ?? "";
  return error.code === "42703" || msg.includes("track_results");
};

const packageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  stationCount: z.number().int().positive(),
  priceKrw: z.number().int().nonnegative(),
  description: z.string().optional(),
  isActive: z.boolean(),
});

const stationSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  code: z.string().min(1),
  isActive: z.boolean(),
});

const packageStationsSchema = z.object({
  packageId: z.string().uuid(),
  stationCodes: z.string().min(1),
});

const adBannerSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  imageUrl: z.string().optional(),
  linkUrl: z.string().optional(),
  isActive: z.boolean(),
});

const profanityTermSchema = z.object({
  id: z.string().uuid().optional(),
  term: z.string().min(1),
  language: z.enum(["KO", "EN"]),
  isActive: z.boolean(),
});

const spellcheckTermSchema = z.object({
  id: z.string().uuid().optional(),
  fromText: z.string().min(1),
  toText: z.string().min(1),
  language: z.enum(["KO", "EN"]),
  isActive: z.boolean(),
});

const deleteSubmissionsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

const deleteArtistSchema = z.object({
  id: z.string().uuid(),
});

const bannerBucket = "banners";
const bannerFolder = "strip";

const sanitizeFileName = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);

const guessImageContentType = (file: File) => {
  if (file.type) {
    return file.type;
  }
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
};

const isLikelyImageFile = (file: File) => {
  if (file.type) {
    return file.type.startsWith("image/");
  }
  const lowerName = file.name.toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(lowerName);
};

const uploadBannerImage = async (file: File) => {
  if (!isLikelyImageFile(file)) {
    return { error: "이미지 파일만 업로드 가능합니다." };
  }

  const admin = await createServerSupabase();
  const safeName = sanitizeFileName(file.name || "banner.jpg");
  const path = `${bannerFolder}/${Date.now()}-${safeName}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error } = await admin.storage
    .from(bannerBucket)
    .upload(path, arrayBuffer, {
      contentType: guessImageContentType(file),
      upsert: true,
    });

  if (error) {
    return { error: "배너 이미지 업로드에 실패했습니다." };
  }

  const { data } = admin.storage.from(bannerBucket).getPublicUrl(path);
  return { publicUrl: data.publicUrl };
};

async function insertEvent(
  submissionId: string,
  message: string,
  eventType: string,
) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.from("submission_events").insert({
    submission_id: submissionId,
    actor_user_id: user?.id ?? null,
    event_type: eventType,
    message,
  });
}

export async function updateSubmissionStatusAction(
  payload: z.infer<typeof submissionStatusSchema>,
): Promise<AdminActionState> {
  const parsed = submissionStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = createAdminClient();
  const updatePayload: {
    status: z.infer<typeof reviewStatusEnum>;
    admin_memo: string | null;
  } = {
    status: parsed.data.status,
    admin_memo: parsed.data.adminMemo || null,
  };

  const { error } = await supabase
    .from("submissions")
    .update(updatePayload)
    .eq("id", parsed.data.submissionId);

  if (error) {
    return { error: "상태 업데이트에 실패했습니다." };
  }

  await insertEvent(
    parsed.data.submissionId,
    `관리자 상태 변경: ${parsed.data.status}`,
    "ADMIN_STATUS",
  );

  return { message: "상태가 업데이트되었습니다." };
}

export async function updateSubmissionStatusFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const result = await updateSubmissionStatusAction({
    submissionId,
    status: String(formData.get("status") ?? "") as z.infer<typeof reviewStatusEnum>,
    adminMemo: String(formData.get("adminMemo") ?? "") || undefined,
  });
  if (result.error) {
    console.error(result.error);
  }
  revalidatePath("/admin/submissions");
  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
    redirect(`/admin/submissions/${submissionId}?saved=status`);
  }
}

// ----- MV Rating -----

const mvRatingSchema = z.object({
  submissionId: z.string().uuid(),
  rating: z.string().refine(isRatingCode, "유효하지 않은 등급입니다."),
});

export async function updateSubmissionMvRatingAction(
  payload: z.infer<typeof mvRatingSchema>,
): Promise<AdminActionState> {
  const parsed = mvRatingSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "등급 값을 확인해주세요." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("submissions")
    .update({ mv_desired_rating: parsed.data.rating })
    .eq("id", parsed.data.submissionId);

  if (error) {
    return { error: "등급을 저장하지 못했습니다." };
  }

  await insertEvent(parsed.data.submissionId, `MV 등급 설정: ${parsed.data.rating}`, "ADMIN_STATUS");

  return { message: "등급이 저장되었습니다." };
}

export async function updateSubmissionMvRatingFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const rating = String(formData.get("rating") ?? "");
  const result = await updateSubmissionMvRatingAction({ submissionId, rating });
  if (result.error) {
    console.error(result.error);
  }
  revalidatePath("/admin/submissions");
  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
    redirect(`/admin/submissions/${submissionId}?saved=rating`);
  }
}

export async function updateSubmissionBasicInfoAction(
  payload: z.infer<typeof submissionBasicInfoSchema>,
): Promise<AdminActionState> {
  const parsed = submissionBasicInfoSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const title = parsed.data.title?.trim() ?? "";
  const artistName = parsed.data.artistName?.trim() ?? "";
  if (!title && !artistName) {
    return { error: "아티스트명 또는 제목을 입력해주세요." };
  }

  const updatePayload: {
    title?: string;
    artist_name?: string;
  } = {};
  if (title) {
    updatePayload.title = title;
  }
  if (artistName) {
    updatePayload.artist_name = artistName;
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("submissions")
    .update(updatePayload)
    .eq("id", parsed.data.submissionId);

  if (error) {
    return { error: "아티스트/앨범 정보 업데이트에 실패했습니다." };
  }

  await insertEvent(
    parsed.data.submissionId,
    "관리자 정보 수정: 아티스트/앨범",
    "ADMIN_BASIC_INFO",
  );

  return { message: "아티스트/앨범 정보가 업데이트되었습니다." };
}

export async function updateSubmissionBasicInfoFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const result = await updateSubmissionBasicInfoAction({
    submissionId,
    title: String(formData.get("title") ?? ""),
    artistName: String(formData.get("artistName") ?? ""),
  });

  if (result.error) {
    console.error(result.error);
    return;
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${submissionId}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/history");
  redirect(`/admin/submissions/${submissionId}?saved=basic`);
}

export async function updatePaymentStatusAction(
  payload: z.infer<typeof paymentStatusSchema>,
): Promise<AdminActionState> {
  const parsed = paymentStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = createAdminClient();
  const { data: submission } = await supabase
    .from("submissions")
    .select("status")
    .eq("id", parsed.data.submissionId)
    .maybeSingle();

  const nextStatus =
    parsed.data.paymentStatus === "PAID" &&
    (submission?.status === "WAITING_PAYMENT" ||
      submission?.status === "SUBMITTED")
      ? "IN_PROGRESS"
      : submission?.status;

  const { error } = await supabase
    .from("submissions")
    .update({
      payment_status: parsed.data.paymentStatus,
      status: nextStatus,
      admin_memo: parsed.data.adminMemo || null,
    })
    .eq("id", parsed.data.submissionId);

  if (error) {
    return { error: "결제 상태 업데이트에 실패했습니다." };
  }

  await insertEvent(
    parsed.data.submissionId,
    `결제 상태 변경: ${parsed.data.paymentStatus}`,
    "PAYMENT_UPDATE",
  );

  return { message: "결제 상태가 업데이트되었습니다." };
}

export async function updatePaymentStatusFormAction(
  formData: FormData,
): Promise<void> {
  const result = await updatePaymentStatusAction({
    submissionId: String(formData.get("submissionId") ?? ""),
    paymentStatus: String(formData.get("paymentStatus") ?? "") as z.infer<
      typeof paymentStatusEnum
    >,
    adminMemo: String(formData.get("adminMemo") ?? "") || undefined,
  });
  if (result.error) {
    console.error(result.error);
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${String(formData.get("submissionId") ?? "")}`);
  const submissionId = String(formData.get("submissionId") ?? "");
  if (submissionId) {
    redirect(`/admin/submissions/${submissionId}?saved=payment`);
  }
}

export async function updateStationReviewAction(
  payload: z.infer<typeof stationReviewPayloadSchema>,
): Promise<AdminActionState> {
  const parsed = stationReviewPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = createAdminClient();

  const logContext = {
    reviewId: parsed.data.reviewId ?? "new",
    submissionId: parsed.data.submissionId,
    stationId: parsed.data.stationId ?? "unknown",
    status: parsed.data.status,
    trackResultsCount: parsed.data.trackResults?.length ?? 0,
  };

  const { data: existing } = parsed.data.reviewId
    ? await supabase
        .from("station_reviews")
        .select("id, submission_id, station_id, status, track_results")
        .eq("id", parsed.data.reviewId)
        .maybeSingle()
    : { data: null };

  const submissionId = existing?.submission_id ?? parsed.data.submissionId;
  const stationId = existing?.station_id ?? parsed.data.stationId;

  if (!stationId) {
    console.error("[station_review][save][error][missing_station]", logContext);
    return { error: "방송국 ID를 확인할 수 없습니다." };
  }

  const trackSummary = parsed.data.trackResults
    ? summarizeTrackResults(parsed.data.trackResults)
    : null;
  const normalizedTrackResults = trackSummary?.results;
  const derivedStatus =
    trackSummary?.outcome === "APPROVED"
      ? "APPROVED"
      : trackSummary?.outcome === "REJECTED"
        ? "REJECTED"
        : trackSummary?.outcome === "PARTIAL"
          ? "NEEDS_FIX"
          : null;
  const resolvedStatus = derivedStatus ?? parsed.data.status;

  const upsertPayload: Record<string, unknown> = {
    id: parsed.data.reviewId,
    submission_id: submissionId,
    station_id: stationId,
    status: resolvedStatus,
    result_note: parsed.data.resultNote || null,
    updated_at: new Date().toISOString(),
  };
  if (normalizedTrackResults !== undefined) {
    upsertPayload.track_results = normalizedTrackResults;
  }

  console.info("[station_review][save][upsert][start]", {
    ...logContext,
    derivedStatus,
    resolvedStatus,
    trackResultsSample: normalizedTrackResults?.slice?.(0, 3),
  });

  const { data: upserted, error } = await supabase
    .from("station_reviews")
    .upsert(upsertPayload, { onConflict: "submission_id,station_id" })
    .select("id, submission_id, station_id, status, result_note, track_results");

  if (error) {
    if (isMissingTrackResultsColumn(error)) {
      return {
        error:
          "TRACK_RESULTS_COLUMN_MISSING: station_reviews.track_results 컬럼이 없습니다. 최신 DB 마이그레이션을 적용해주세요.",
      };
    }
    console.error("[station_review][save][upsert][error]", { ...logContext, error });
    return { error: "방송국 상태 업데이트에 실패했습니다." };
  }

  const savedRow = upserted?.[0];
  const { data: fetchedRow, error: refetchError } = await supabase
    .from("station_reviews")
    .select("id, submission_id, station_id, status, result_note, track_results, updated_at")
    .eq("submission_id", submissionId)
    .eq("station_id", stationId)
    .maybeSingle();

  const effectiveRow = fetchedRow ?? savedRow;
  const statusMatches = effectiveRow?.status === resolvedStatus;
  const tracksMatch =
    normalizedTrackResults === undefined ||
    JSON.stringify(effectiveRow?.track_results ?? []) ===
      JSON.stringify(normalizedTrackResults ?? []);

  if (!statusMatches || !tracksMatch) {
    console.error("[station_review][save][mismatch]", {
      ...logContext,
      savedRow: effectiveRow,
      expectedStatus: resolvedStatus,
      expectedTracksLen: normalizedTrackResults?.length ?? 0,
      refetchError,
    });
    return { error: "방송국 상태 저장 결과가 반영되지 않았습니다." };
  }

  await insertEvent(
    submissionId,
    `방송국 상태 변경: ${resolvedStatus}`,
    "STATION_UPDATE",
  );

  console.info("[station_review][save][upsert][success]", {
    ...logContext,
    savedId: effectiveRow?.id,
    refetched: Boolean(fetchedRow),
  });

  return { message: "방송국 상태가 업데이트되었습니다.", row: effectiveRow ?? undefined };
}

export async function updateStationReviewFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submission_id") ?? "").trim();
  const stationId = String(formData.get("station_id") ?? "").trim();
  const reviewId = String(formData.get("review_id") ?? "").trim();
  const statusRaw = String(formData.get("station_status") ?? "").trim().toUpperCase();
  const resultNote = String(formData.get("station_memo") ?? "").trim();
  const trackResultsJson = String(formData.get("track_results_json") ?? "").trim();

  console.info("[station_review][form][parse][start]", {
    submissionId,
    stationId,
    reviewId,
    statusRaw,
    trackResultsJsonLength: trackResultsJson.length,
  });

  if (!submissionId || !stationId || !statusRaw || !trackResultsJson) {
    console.error("[station_review][form][parse][missing_fields]", {
      submissionId,
      stationId,
      statusRaw,
      hasTrackJson: Boolean(trackResultsJson),
    });
    redirect(
      `/admin/submissions/${submissionId || ""}?saved=station_error&savedError=${encodeURIComponent(
        "필수 값이 누락되었습니다.",
      )}`,
    );
  }

  const status = stationReviewStatusValues.includes(statusRaw as typeof stationReviewStatusValues[number])
    ? (statusRaw as typeof stationReviewStatusValues[number])
    : "NOT_SENT";

  let trackResults: Array<z.infer<typeof trackResultSchema>> = [];
  try {
    const parsed = JSON.parse(trackResultsJson);
    if (Array.isArray(parsed)) {
      trackResults = parsed.map((item) => ({
        trackId: typeof item?.track_id === "string" ? item.track_id : undefined,
        trackNo:
          typeof item?.track_no === "number" && Number.isFinite(item.track_no)
            ? item.track_no
            : undefined,
        title: typeof item?.title === "string" ? item.title : undefined,
        status: trackResultStatusEnum.parse(
          typeof item?.status === "string" ? item.status.toUpperCase() : "PENDING",
        ),
      }));
    }
  } catch (error) {
    console.error("[station_review][form][parse][track_results_json_error]", {
      error,
      trackResultsJson,
    });
    redirect(
      `/admin/submissions/${submissionId}?saved=station_error&savedError=${encodeURIComponent(
        "트랙 결과 파싱 실패",
      )}`,
    );
  }

  console.info("[station_review][form][parse][done]", {
    submissionId,
    stationId,
    reviewId,
    status,
    trackResultsCount: trackResults.length,
    trackResultsSample: trackResults.slice(0, 2),
  });

  const result = await updateStationReviewAction({
    reviewId: reviewId || undefined,
    submissionId,
    stationId,
    status,
    resultNote: resultNote || undefined,
    trackResults,
  });
  if (result.error) {
    console.error(result.error);
    if (submissionId) {
      redirect(
        `/admin/submissions/${submissionId}?saved=station_error&savedError=${encodeURIComponent(
          result.error,
        )}`,
      );
    }
    return;
  }

  revalidatePath("/admin/submissions");
  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    redirect(`/admin/submissions/${submissionId}?saved=station`);
  }
}

const createTrackSchema = z.object({
  submissionId: z.string().uuid(),
  trackTitle: z.string().min(1, "트랙명을 입력하세요."),
  trackNo: z.coerce.number().int().positive().optional(),
  composer: z.string().optional(),
  lyricist: z.string().optional(),
  arranger: z.string().optional(),
});

const deleteTrackSchema = z.object({
  submissionId: z.string().uuid(),
  trackId: z.string().uuid(),
});

export async function createTrackForSubmissionAction(
  formData: FormData,
): Promise<void> {
  const parsed = createTrackSchema.safeParse({
    submissionId: formData.get("submissionId"),
    trackTitle: formData.get("trackTitle"),
    trackNo: formData.get("trackNo"),
    composer: formData.get("composer"),
    lyricist: formData.get("lyricist"),
    arranger: formData.get("arranger"),
  });

  if (!parsed.success) {
    console.error("createTrack validation failed", parsed.error.flatten().fieldErrors);
    return;
  }

  const supabase = createAdminClient();
  let trackNo = parsed.data.trackNo;
  if (!trackNo) {
    const { data: existing } = await supabase
      .from("album_tracks")
      .select("track_no")
      .eq("submission_id", parsed.data.submissionId)
      .order("track_no", { ascending: false })
      .limit(1);
    const maxNo = existing?.[0]?.track_no;
    trackNo = typeof maxNo === "number" && Number.isFinite(maxNo) ? maxNo + 1 : 1;
  }

  const { error } = await supabase.from("album_tracks").insert({
    submission_id: parsed.data.submissionId,
    track_no: trackNo,
    track_title: parsed.data.trackTitle,
    composer: parsed.data.composer || null,
    lyricist: parsed.data.lyricist || null,
    arranger: parsed.data.arranger || null,
  });

  if (error) {
    console.error("createTrack insert error", error);
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${parsed.data.submissionId}`);
  redirect(`/admin/submissions/${parsed.data.submissionId}?saved=track`);
}

export async function deleteTrackForSubmissionAction(
  formData: FormData,
): Promise<void> {
  const parsed = deleteTrackSchema.safeParse({
    submissionId: formData.get("submissionId"),
    trackId: formData.get("trackId"),
  });

  if (!parsed.success) {
    console.error("deleteTrack validation failed", parsed.error.flatten().fieldErrors);
    return;
  }

  const admin = createAdminClient();
  const { data: trackRow } = await admin
    .from("album_tracks")
    .select("track_no")
    .eq("id", parsed.data.trackId)
    .eq("submission_id", parsed.data.submissionId)
    .maybeSingle();

  const trackNo = trackRow?.track_no ?? null;

  const { error: deleteError } = await admin
    .from("album_tracks")
    .delete()
    .eq("id", parsed.data.trackId)
    .eq("submission_id", parsed.data.submissionId);

  if (deleteError) {
    console.error("deleteTrack delete error", deleteError);
  }

  const { data: stationReviews } = await admin
    .from("station_reviews")
    .select("id, track_results")
    .eq("submission_id", parsed.data.submissionId);

  if (stationReviews && stationReviews.length > 0) {
    type TrackResultEntry = {
      track_id?: unknown;
      trackId?: unknown;
      track_no?: unknown;
      trackNo?: unknown;
      [key: string]: unknown;
    };
    for (const review of stationReviews) {
      const rawResults = Array.isArray(review.track_results)
        ? (review.track_results as TrackResultEntry[])
        : [];
      const filtered = rawResults.filter((entry) => {
        const idMatch =
          (typeof entry.track_id === "string" && entry.track_id === parsed.data.trackId) ||
          (typeof entry.trackId === "string" && entry.trackId === parsed.data.trackId);
        const noMatch =
          trackNo !== null &&
          ((typeof entry.track_no === "number" && entry.track_no === trackNo) ||
            (typeof entry.trackNo === "number" && entry.trackNo === trackNo));
        return !idMatch && !noMatch;
      });

      if (filtered.length !== rawResults.length) {
        const { error: updateError } = await admin
          .from("station_reviews")
          .update({ track_results: filtered.length > 0 ? filtered : null })
          .eq("id", review.id);
        if (updateError) {
          console.error("deleteTrack track_results update error", updateError);
        }
      }
    }
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${parsed.data.submissionId}`);
  revalidatePath(`/admin/submissions/detail?id=${parsed.data.submissionId}`);
  revalidatePath("/dashboard/status");
  revalidatePath("/dashboard/history");
  revalidatePath("/");
  redirect(`/admin/submissions/${parsed.data.submissionId}?saved=track_deleted`);
}

export async function updateSubmissionResultAction(
  payload: z.infer<typeof submissionResultSchema>,
): Promise<AdminActionState> {
  const parsed = submissionResultSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("submissions")
    .update({
      result_memo: parsed.data.resultMemo || null,
    })
    .eq("id", parsed.data.submissionId);

  if (error) {
    return { error: "결과 정보를 저장하지 못했습니다." };
  }

  await insertEvent(
    parsed.data.submissionId,
    `결과 저장: ${resultStatusLabelMap[parsed.data.resultStatus]}`,
    "RESULT_UPDATE",
  );

  revalidatePath(`/admin/submissions/${parsed.data.submissionId}`);
  return { message: "결과 정보가 저장되었습니다." };
}

export async function updateSubmissionResultFormAction(
  formData: FormData,
): Promise<void> {
  const result = await updateSubmissionResultAction({
    submissionId: String(formData.get("submissionId") ?? ""),
    resultStatus: String(
      formData.get("resultStatus") ?? "",
    ) as z.infer<typeof resultStatusEnum>,
    resultMemo: String(formData.get("resultMemo") ?? "") || undefined,
  });
  if (result.error) {
    console.error(result.error);
  }

  const submissionId = String(formData.get("submissionId") ?? "");
  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    redirect(`/admin/submissions/${submissionId}`);
  }
}

export async function notifySubmissionResultAction(): Promise<AdminActionState> {
  return {
    error: "현재 환경에 result_status 컬럼이 없어 결과 통보 기능을 사용할 수 없습니다.",
  };
}

export async function updateArtistAction(formData: FormData): Promise<void> {
  const artistId = String(formData.get("artistId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const thumbnailUrl = String(formData.get("thumbnailUrl") ?? "").trim();
  if (!artistId || !name) {
    return;
  }
  const admin = createAdminClient();
  await admin
    .from("artists")
    .update({ name, thumbnail_url: thumbnailUrl || null })
    .eq("id", artistId);
  revalidatePath("/admin/artists");
  revalidatePath(`/admin/artists/${artistId}`);
}

export async function upsertPackageAction(
  payload: z.infer<typeof packageSchema>,
): Promise<AdminActionState> {
  const parsed = packageSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "패키지 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("packages").upsert({
    id: parsed.data.id,
    name: parsed.data.name,
    station_count: parsed.data.stationCount,
    price_krw: parsed.data.priceKrw,
    description: parsed.data.description || null,
    is_active: parsed.data.isActive,
  });

  if (error) {
    return { error: "패키지 저장에 실패했습니다." };
  }

  return { message: "패키지가 저장되었습니다." };
}

export async function upsertPackageFormAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const result = await upsertPackageAction({
    id: id ? id : undefined,
    name: String(formData.get("name") ?? ""),
    stationCount: Number(formData.get("stationCount") ?? 0),
    priceKrw: Number(formData.get("priceKrw") ?? 0),
    description: String(formData.get("description") ?? "") || undefined,
    isActive: formData.get("isActive") === "on",
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/config");
}

export async function upsertStationAction(
  payload: z.infer<typeof stationSchema>,
): Promise<AdminActionState> {
  const parsed = stationSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "방송국 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("stations").upsert({
    id: parsed.data.id,
    name: parsed.data.name,
    code: parsed.data.code,
    is_active: parsed.data.isActive,
  });

  if (error) {
    return { error: "방송국 저장에 실패했습니다." };
  }

  return { message: "방송국 정보가 저장되었습니다." };
}

export async function upsertStationFormAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const result = await upsertStationAction({
    id: id ? id : undefined,
    name: String(formData.get("name") ?? ""),
    code: String(formData.get("code") ?? ""),
    isActive: formData.get("isActive") === "on",
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/config");
}

export async function updatePackageStationsAction(
  payload: z.infer<typeof packageStationsSchema>,
): Promise<AdminActionState> {
  const parsed = packageStationsSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "방송국 코드를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const codes = parsed.data.stationCodes
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  const { data: stations, error: stationError } = await supabase
    .from("stations")
    .select("id, code")
    .in("code", codes);

  if (stationError) {
    return { error: "방송국 정보를 찾을 수 없습니다." };
  }

  if (codes.length > 0 && (stations?.length ?? 0) !== codes.length) {
    return { error: "일부 방송국 코드를 찾을 수 없습니다." };
  }

  await supabase
    .from("package_stations")
    .delete()
    .eq("package_id", parsed.data.packageId);

  if (stations && stations.length > 0) {
    const rows = stations.map((station) => ({
      package_id: parsed.data.packageId,
      station_id: station.id,
    }));
    const { error } = await supabase.from("package_stations").insert(rows);
    if (error) {
      return { error: "패키지 방송국 매핑 저장 실패" };
    }
  }

  return { message: "패키지 방송국이 업데이트되었습니다." };
}

export async function updatePackageStationsFormAction(
  formData: FormData,
): Promise<void> {
  const result = await updatePackageStationsAction({
    packageId: String(formData.get("packageId") ?? ""),
    stationCodes: String(formData.get("stationCodes") ?? ""),
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/config");
}

export async function deletePackageAction(
  payload: { id: string },
): Promise<AdminActionState> {
  if (!payload.id) {
    return { error: "패키지 ID를 확인해주세요." };
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("packages").delete().eq("id", payload.id);
  if (error) {
    return { error: "패키지 삭제에 실패했습니다." };
  }
  return { message: "패키지가 삭제되었습니다." };
}

export async function deletePackageFormAction(
  formData: FormData,
): Promise<void> {
  const result = await deletePackageAction({
    id: String(formData.get("id") ?? ""),
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/config");
}

export async function deleteStationAction(
  payload: { id: string },
): Promise<AdminActionState> {
  if (!payload.id) {
    return { error: "방송국 ID를 확인해주세요." };
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("stations").delete().eq("id", payload.id);
  if (error) {
    return { error: "방송국 삭제에 실패했습니다." };
  }
  return { message: "방송국이 삭제되었습니다." };
}

export async function deleteStationFormAction(
  formData: FormData,
): Promise<void> {
  const result = await deleteStationAction({
    id: String(formData.get("id") ?? ""),
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/config");
}

export async function upsertAdBannerAction(
  payload: z.infer<typeof adBannerSchema>,
): Promise<AdminActionState> {
  const parsed = adBannerSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "배너 정보를 확인해주세요." };
  }

  if (!parsed.data.imageUrl) {
    return { error: "배너 이미지를 입력하거나 업로드해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("ad_banners").upsert({
    id: parsed.data.id,
    title: parsed.data.title,
    image_url: parsed.data.imageUrl,
    link_url: parsed.data.linkUrl || null,
    is_active: parsed.data.isActive,
  });

  if (error) {
    const message = error.message?.toLowerCase() ?? "";
    if (message.includes("ad_banners") && message.includes("schema cache")) {
      return {
        error:
          "배너 테이블이 아직 생성되지 않았습니다. Supabase 마이그레이션을 실행해주세요.",
      };
    }
    return { error: "배너 저장에 실패했습니다." };
  }

  return { message: "배너가 저장되었습니다." };
}

export async function upsertAdBannerFormAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const imageFile = formData.get("imageFile");
  let imageUrl = String(formData.get("imageUrl") ?? "");

  if (imageFile instanceof File && imageFile.size > 0) {
    const uploadResult = await uploadBannerImage(imageFile);
    if (uploadResult.error) {
      console.error(uploadResult.error);
      return;
    }
    imageUrl = uploadResult.publicUrl ?? imageUrl;
  }

  const result = await upsertAdBannerAction({
    id: id ? id : undefined,
    title: String(formData.get("title") ?? ""),
    imageUrl: imageUrl || undefined,
    linkUrl: String(formData.get("linkUrl") ?? "") || undefined,
    isActive: formData.get("isActive") === "on",
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/banners");
  revalidatePath("/");
}

export async function deleteAdBannerAction(
  payload: { id: string },
): Promise<AdminActionState> {
  if (!payload.id) {
    return { error: "배너 ID를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("ad_banners").delete().eq("id", payload.id);

  if (error) {
    const message = error.message?.toLowerCase() ?? "";
    if (message.includes("ad_banners") && message.includes("schema cache")) {
      return {
        error:
          "배너 테이블이 아직 생성되지 않았습니다. Supabase 마이그레이션을 실행해주세요.",
      };
    }
    return { error: "배너 삭제에 실패했습니다." };
  }

  return { message: "배너가 삭제되었습니다." };
}

export async function deleteAdBannerFormAction(
  formData: FormData,
): Promise<void> {
  const result = await deleteAdBannerAction({
    id: String(formData.get("id") ?? ""),
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/banners");
  revalidatePath("/");
}

export async function upsertProfanityTermAction(
  payload: z.infer<typeof profanityTermSchema>,
): Promise<AdminActionState> {
  const parsed = profanityTermSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "욕설/비속어 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("profanity_terms").upsert({
    id: parsed.data.id,
    term: parsed.data.term.trim(),
    language: parsed.data.language,
    is_active: parsed.data.isActive,
  });

  if (error) {
    return { error: "욕설/비속어 저장에 실패했습니다." };
  }

  return { message: "욕설/비속어가 저장되었습니다." };
}

export async function upsertProfanityTermFormAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const result = await upsertProfanityTermAction({
    id: id ? id : undefined,
    term: String(formData.get("term") ?? ""),
    language: (String(formData.get("language") ?? "KO") || "KO") as
      | "KO"
      | "EN",
    isActive: formData.get("isActive") === "on",
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/config");
  revalidatePath("/dashboard/new/album");
}

export async function deleteProfanityTermAction(
  payload: { id: string },
): Promise<AdminActionState> {
  if (!payload.id) {
    return { error: "욕설/비속어 ID를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("profanity_terms")
    .delete()
    .eq("id", payload.id);

  if (error) {
    return { error: "욕설/비속어 삭제에 실패했습니다." };
  }

  return { message: "욕설/비속어가 삭제되었습니다." };
}

export async function deleteProfanityTermFormAction(
  formData: FormData,
): Promise<void> {
  const result = await deleteProfanityTermAction({
    id: String(formData.get("id") ?? ""),
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/config");
  revalidatePath("/dashboard/new/album");
}

export async function upsertSpellcheckTermAction(
  payload: z.infer<typeof spellcheckTermSchema>,
): Promise<AdminActionState> {
  const parsed = spellcheckTermSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "맞춤법 사전 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("spellcheck_terms").upsert({
    id: parsed.data.id,
    from_text: parsed.data.fromText.trim(),
    to_text: parsed.data.toText.trim(),
    language: parsed.data.language,
    is_active: parsed.data.isActive,
  });

  if (error) {
    return { error: "맞춤법 사전 저장에 실패했습니다." };
  }

  return { message: "맞춤법 사전이 저장되었습니다." };
}

export async function upsertSpellcheckTermFormAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const result = await upsertSpellcheckTermAction({
    id: id ? id : undefined,
    fromText: String(formData.get("fromText") ?? ""),
    toText: String(formData.get("toText") ?? ""),
    language: (String(formData.get("language") ?? "KO") || "KO") as
      | "KO"
      | "EN",
    isActive: formData.get("isActive") === "on",
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/config");
  revalidatePath("/dashboard/new/album");
}

export async function deleteSpellcheckTermAction(
  payload: { id: string },
): Promise<AdminActionState> {
  if (!payload.id) {
    return { error: "맞춤법 사전 ID를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("spellcheck_terms")
    .delete()
    .eq("id", payload.id);

  if (error) {
    return { error: "맞춤법 사전 삭제에 실패했습니다." };
  }

  return { message: "맞춤법 사전이 삭제되었습니다." };
}

export async function deleteSpellcheckTermFormAction(
  formData: FormData,
): Promise<void> {
  const result = await deleteSpellcheckTermAction({
    id: String(formData.get("id") ?? ""),
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/config");
  revalidatePath("/dashboard/new/album");
}

export async function deleteSubmissionsAction(
  payload: z.infer<typeof deleteSubmissionsSchema>,
): Promise<AdminActionState> {
  const parsed = deleteSubmissionsSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "삭제할 접수 ID를 확인해주세요." };
  }

  const supabase = await createAdminClient();
  const { error } = await supabase
    .from("submissions")
    .delete()
    .in("id", parsed.data.ids);

  if (error) {
    console.error("admin delete submissions error", error);
    return { error: "접수 삭제에 실패했습니다." };
  }

  revalidatePath("/admin/submissions");
  revalidatePath("/dashboard/status");
  revalidatePath("/dashboard/history");
  revalidatePath("/mypage");
  revalidatePath("/");
  parsed.data.ids.forEach((id) => {
    revalidatePath(`/admin/submissions/${id}`);
    revalidatePath(`/admin/submissions/detail?id=${id}`);
  });

  return { message: "접수가 삭제되었습니다." };
}

export async function deleteSubmissionsFormAction(
  formData: FormData,
): Promise<void> {
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const redirectTo = String(formData.get("redirectTo") ?? "");

  const result = await deleteSubmissionsAction({ ids });
  if (result.error) {
    console.error(result.error);
    return;
  }

  if (redirectTo) {
    redirect(redirectTo);
  }
}

export async function deleteArtistAction(
  payload: z.infer<typeof deleteArtistSchema>,
): Promise<AdminActionState> {
  const parsed = deleteArtistSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "삭제할 아티스트 ID를 확인해주세요." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("artists").delete().eq("id", parsed.data.id);
  if (error) {
    console.error("admin delete artist error", error);
    return { error: "아티스트 삭제에 실패했습니다." };
  }

  revalidatePath("/admin/artists");
  revalidatePath(`/admin/artists/${parsed.data.id}`);
  revalidatePath("/admin/submissions");
  revalidatePath("/dashboard/status");
  revalidatePath("/dashboard/history");
  return { message: "아티스트를 삭제했습니다." };
}

export async function deleteArtistFormAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/admin/artists");
  const result = await deleteArtistAction({ id });
  if (result.error) {
    console.error(result.error);
    return;
  }
  redirect(redirectTo);
}

export async function saveSubmissionAdminFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  if (!submissionId) {
    return;
  }

  const supabase = await createAdminClient();
  const { data: existingReviews } = await supabase
    .from("station_reviews")
    .select("id, status, track_results, station_id, station:stations ( code )")
    .eq("submission_id", submissionId);
  const reviewMap = new Map(
    (existingReviews ?? []).map((review) => [review.id, review]),
  );

  console.info("[admin save] start", {
    submissionId,
    reviewCount: reviewMap.size,
  });

  const status = String(formData.get("status") ?? "").trim();
  const adminMemo = String(formData.get("adminMemo") ?? "").trim();
  const paymentStatus = String(formData.get("paymentStatus") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const artistName = String(formData.get("artistName") ?? "").trim();

  const submissionUpdate: Record<string, unknown> = {};
  if (status) submissionUpdate.status = status;
  submissionUpdate.admin_memo = adminMemo || null;
  if (paymentStatus) submissionUpdate.payment_status = paymentStatus;
  if (title) submissionUpdate.title = title;
  if (artistName) submissionUpdate.artist_name = artistName;

  if (Object.keys(submissionUpdate).length > 0) {
    const { error: submissionError } = await supabase
      .from("submissions")
      .update(submissionUpdate)
      .eq("id", submissionId);
    if (submissionError) {
      console.error("admin save submission status error", submissionError, {
        submissionId,
        update: submissionUpdate,
      });
      redirect(
        `/admin/submissions/${submissionId}?saved=error&savedError=${encodeURIComponent(
          submissionError.message ?? "submission update error",
        )}`,
      );
    }
  }

  const entries = Array.from(formData.entries());
  let reviewIds = Array.from(reviewMap.keys());
  if (!reviewIds.length) {
    reviewIds = formData
      .getAll("reviewIds")
      .map((value) => String(value))
      .filter((id) => id.length > 0 && z.string().uuid().safeParse(id).success);
  }

  let lastError: { message: string; code?: string } | null = null;

  const updateStationReview = async (
    reviewId: string,
    stationCode: string | null,
    payload: {
      status: z.infer<typeof stationReviewStatusEnum>;
      result_note: string | null;
      track_results: unknown;
      station_id?: string | null;
    },
  ) => {
    const logPrefix = `[admin save] review ${reviewId} (${stationCode ?? "unknown"})`;
    const attempt = async (includeTracks: boolean) => {
      const upsertPayload = includeTracks
        ? payload
        : {
            status: payload.status,
            result_note: payload.result_note,
            station_id: payload.station_id,
          };
      const base = {
        id: reviewId,
        submission_id: submissionId,
      };
      const { data, error } = await supabase
        .from("station_reviews")
        .upsert({ ...base, ...upsertPayload }, { onConflict: "submission_id,station_id" })
        .select("id, status, result_note, track_results, station_id");
      return { data, error };
    };

    let columnMissing = false;
    let { data, error } = await attempt(true);
    if (error && isMissingTrackResultsColumn(error)) {
      console.warn(`${logPrefix} track_results column missing, retrying without track_results`, {
        error,
      });
      columnMissing = true;
      ({ data, error } = await attempt(false));
    }

    console.info(`${logPrefix} update result`, {
      payload,
      dataLength: data?.length ?? 0,
      error,
    });

    if (!error && data && data.length > 0) {
      const refreshed = await supabase
        .from("station_reviews")
        .select("id, status, result_note, track_results, station_id")
        .eq("id", reviewId)
        .maybeSingle();
      console.info(`${logPrefix} refreshed`, { refreshed: refreshed.data, error: refreshed.error });
    }

    if (columnMissing && !error) {
      error = {
        code: "42703",
        message:
          "TRACK_RESULTS_COLUMN_MISSING: station_reviews.track_results 컬럼이 없어 트랙 결과를 저장하지 못했습니다. 최신 DB 마이그레이션을 적용하세요.",
        details: "",
        hint: "",
        name: "PostgrestError",
      } as PostgrestError;
    }

    return { data, error };
  };

  type StationValue = { code?: unknown } | Array<{ code?: unknown }> | null | undefined;
  const getStationCode = (value: StationValue): string | null => {
    if (Array.isArray(value)) {
      const first = value[0];
      return typeof first?.code === "string" ? first.code : null;
    }
    if (value && typeof value === "object" && "code" in value) {
      const code = (value as { code?: unknown }).code;
      return typeof code === "string" ? code : null;
    }
    return null;
  };

  for (const reviewId of reviewIds) {
    const current = reviewMap.get(reviewId);
    const stationCode = getStationCode((current as { station?: StationValue })?.station);
    const stationIdFromForm = String(formData.get(`stationId-${reviewId}`) ?? "") || null;
    const stationId =
      stationIdFromForm ||
      (current && typeof current.station_id === "string" ? current.station_id : null);
    const stationStatusRaw = String(formData.get(`stationStatus-${reviewId}`) ?? "").trim();
    const stationStatus = stationReviewStatusEnum.safeParse(stationStatusRaw).success
      ? (stationStatusRaw as z.infer<typeof stationReviewStatusEnum>)
      : (current?.status as z.infer<typeof stationReviewStatusEnum>) ?? "NOT_SENT";
    const resultNote = String(formData.get(`stationResultNote-${reviewId}`) ?? "").trim();

    const trackResults: Array<{
      track_id?: string | null;
      track_no?: number | null;
      title?: string | null;
      status: z.infer<typeof trackResultStatusEnum>;
    }> = [];

    const trackStatusEntries = entries.filter(([key]) =>
      key.startsWith(`trackStatus-${reviewId}-`),
    );

    for (const [key, value] of trackStatusEntries) {
      const index = key.split("-").pop() ?? "";
      const statusValue = String(value || "PENDING") as z.infer<typeof trackResultStatusEnum>;
      const trackId = String(formData.get(`trackId-${reviewId}-${index}`) ?? "") || null;
      const trackNoRaw = String(formData.get(`trackNo-${reviewId}-${index}`) ?? "");
      const trackNo = trackNoRaw ? Number(trackNoRaw) : null;
      const trackTitle =
        String(formData.get(`trackTitle-${reviewId}-${index}`) ?? "").trim() || null;

      if (!trackResultStatusEnum.safeParse(statusValue).success) continue;
      trackResults.push({
        track_id: trackId || null,
        track_no: Number.isFinite(trackNo) ? (trackNo as number) : null,
        title: trackTitle,
        status: statusValue,
      });
    }

    const nextTrackResults =
      trackResults.length > 0
        ? trackResults
        : current?.track_results && Array.isArray(current.track_results)
          ? current.track_results
          : null;

    const payload = {
      status: stationStatus || "NOT_SENT",
      result_note: resultNote || null,
      track_results: nextTrackResults,
    };

    const { error: stationError } = await updateStationReview(reviewId, stationCode, {
      ...payload,
      station_id: stationId,
    });

    if (stationError) {
      console.error("admin save station review error", stationError, {
        reviewId,
        payload,
      });
      lastError = { message: stationError.message ?? "error", code: stationError.code };
    }
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${submissionId}`);
  revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
  revalidatePath("/dashboard/status");
  revalidatePath("/dashboard/history");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/submissions/${submissionId}`);
  revalidatePath("/dashboard/submissions");
  revalidatePath(`/mypage/submissions/${submissionId}`);
  revalidatePath("/mypage/history");
  revalidatePath("/mypage");
  revalidatePath("/");

  if (lastError) {
    redirect(
      `/admin/submissions/${submissionId}?saved=error&savedError=${encodeURIComponent(
        `${lastError.code ?? ""} ${lastError.message}`,
      )}`,
    );
  } else {
    redirect(`/admin/submissions/${submissionId}?saved=station`);
  }
}
