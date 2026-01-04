"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  paymentStatusEnum,
  resultStatusEnum,
  resultStatusLabelMap,
  reviewStatusEnum,
  stationReviewStatusEnum,
} from "@/constants/review-status";
import { sendResultEmail } from "@/lib/email";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminActionState = {
  error?: string;
  message?: string;
};

const submissionStatusSchema = z.object({
  submissionId: z.string().uuid(),
  status: reviewStatusEnum,
  adminMemo: z.string().optional(),
  mvRatingFilePath: z.string().optional(),
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

const stationReviewSchema = z.object({
  reviewId: z.string().uuid(),
  status: stationReviewStatusEnum,
  resultNote: z.string().optional(),
});

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
    mv_rating_file_path?: string | null;
  } = {
    status: parsed.data.status,
    admin_memo: parsed.data.adminMemo || null,
  };

  if (parsed.data.mvRatingFilePath !== undefined) {
    const trimmed = parsed.data.mvRatingFilePath.trim();
    updatePayload.mv_rating_file_path = trimmed ? trimmed : null;
  }

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
  const rawRatingFilePath = formData.get("mvRatingFilePath");
  const submissionId = String(formData.get("submissionId") ?? "");
  const result = await updateSubmissionStatusAction({
    submissionId,
    status: String(formData.get("status") ?? "") as z.infer<typeof reviewStatusEnum>,
    adminMemo: String(formData.get("adminMemo") ?? "") || undefined,
    mvRatingFilePath:
      rawRatingFilePath !== null ? String(rawRatingFilePath ?? "") : undefined,
  });
  if (result.error) {
    console.error(result.error);
  }
  revalidatePath("/admin/submissions");
  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
    redirect(`/admin/submissions/${submissionId}`);
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
  redirect(`/admin/submissions/${submissionId}`);
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
    redirect(`/admin/submissions/${submissionId}`);
  }
}

export async function updateStationReviewAction(
  payload: z.infer<typeof stationReviewSchema>,
): Promise<AdminActionState> {
  const parsed = stationReviewSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = createAdminClient();
  const { data: review } = await supabase
    .from("station_reviews")
    .select("submission_id")
    .eq("id", parsed.data.reviewId)
    .maybeSingle();

  const { error } = await supabase
    .from("station_reviews")
    .update({
      status: parsed.data.status,
      result_note: parsed.data.resultNote || null,
    })
    .eq("id", parsed.data.reviewId);

  if (error) {
    return { error: "방송국 상태 업데이트에 실패했습니다." };
  }

  if (review?.submission_id) {
    await insertEvent(
      review.submission_id,
      `방송국 상태 변경: ${parsed.data.status}`,
      "STATION_UPDATE",
    );
  }

  return { message: "방송국 상태가 업데이트되었습니다." };
}

export async function updateStationReviewFormAction(
  formData: FormData,
): Promise<void> {
  const result = await updateStationReviewAction({
    reviewId: String(formData.get("reviewId") ?? ""),
    status: String(formData.get("status") ?? "") as z.infer<
      typeof stationReviewStatusEnum
    >,
    resultNote: String(formData.get("resultNote") ?? "") || undefined,
  });
  if (result.error) {
    console.error(result.error);
  }

  revalidatePath("/admin/submissions");
  const submissionId =
    String(formData.get("submissionId") ?? "") ||
    String(formData.get("reviewId") ?? "");
  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    redirect(`/admin/submissions/${submissionId}`);
  }
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
      result_status: parsed.data.resultStatus,
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

export async function notifySubmissionResultAction(
  submissionId: string,
): Promise<AdminActionState> {
  if (!submissionId) return { error: "접수 ID가 없습니다." };

  const supabase = await createServerSupabase();
  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select(
      "id, title, artist_name, applicant_email, guest_email, result_status, result_memo, user_id",
    )
    .eq("id", submissionId)
    .maybeSingle();

  if (submissionError || !submission) {
    return { error: "접수 정보를 찾을 수 없습니다." };
  }
  if (!submission.result_status) {
    return { error: "먼저 결과 상태를 저장해주세요." };
  }

  let recipient = submission.applicant_email || submission.guest_email || "";
  if (!recipient && submission.user_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("user_id", submission.user_id)
      .maybeSingle();
    if (profile?.email) {
      recipient = profile.email;
    }
  }

  if (!recipient) {
    return { error: "보낼 이메일 주소를 찾을 수 없습니다." };
  }

  const emailResult = await sendResultEmail({
    email: recipient,
    title: submission.title || "제목 미입력",
    artist: submission.artist_name,
    resultStatus: submission.result_status as z.infer<typeof resultStatusEnum>,
    resultMemo: submission.result_memo,
  });

  if (!emailResult.ok) {
    return { error: emailResult.message ?? "결과 메일 발송에 실패했습니다." };
  }

  await supabase
    .from("submissions")
    .update({ result_notified_at: new Date().toISOString() })
    .eq("id", submissionId);

  await insertEvent(
    submissionId,
    "심의 결과 메일 발송",
    "RESULT_NOTIFY",
  );

  revalidatePath(`/admin/submissions/${submissionId}`);
  return { message: "심의 결과가 발송되었습니다." };
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
