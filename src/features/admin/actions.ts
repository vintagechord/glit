"use server";

import { z } from "zod";

import { createServerSupabase } from "@/lib/supabase/server";

export type AdminActionState = {
  error?: string;
  message?: string;
};

const submissionStatusEnum = z.enum([
  "DRAFT",
  "SUBMITTED",
  "PRE_REVIEW",
  "WAITING_PAYMENT",
  "IN_PROGRESS",
  "RESULT_READY",
  "COMPLETED",
]);

const paymentStatusEnum = z.enum([
  "UNPAID",
  "PAYMENT_PENDING",
  "PAID",
  "REFUNDED",
]);

const stationStatusEnum = z.enum([
  "NOT_SENT",
  "SENT",
  "RECEIVED",
  "APPROVED",
  "REJECTED",
  "NEEDS_FIX",
]);

const submissionStatusSchema = z.object({
  submissionId: z.string().uuid(),
  status: submissionStatusEnum,
  adminMemo: z.string().optional(),
});

const paymentStatusSchema = z.object({
  submissionId: z.string().uuid(),
  paymentStatus: paymentStatusEnum,
  adminMemo: z.string().optional(),
});

const stationReviewSchema = z.object({
  reviewId: z.string().uuid(),
  status: stationStatusEnum,
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

async function insertEvent(
  submissionId: string,
  message: string,
  eventType: string,
) {
  const supabase = createServerSupabase();
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

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("submissions")
    .update({
      status: parsed.data.status,
      admin_memo: parsed.data.adminMemo || null,
    })
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
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return updateSubmissionStatusAction({
    submissionId: String(formData.get("submissionId") ?? ""),
    status: String(formData.get("status") ?? "") as z.infer<
      typeof submissionStatusEnum
    >,
    adminMemo: String(formData.get("adminMemo") ?? "") || undefined,
  });
}

export async function updatePaymentStatusAction(
  payload: z.infer<typeof paymentStatusSchema>,
): Promise<AdminActionState> {
  const parsed = paymentStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = createServerSupabase();
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
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return updatePaymentStatusAction({
    submissionId: String(formData.get("submissionId") ?? ""),
    paymentStatus: String(formData.get("paymentStatus") ?? "") as z.infer<
      typeof paymentStatusEnum
    >,
    adminMemo: String(formData.get("adminMemo") ?? "") || undefined,
  });
}

export async function updateStationReviewAction(
  payload: z.infer<typeof stationReviewSchema>,
): Promise<AdminActionState> {
  const parsed = stationReviewSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = createServerSupabase();
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
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return updateStationReviewAction({
    reviewId: String(formData.get("reviewId") ?? ""),
    status: String(formData.get("status") ?? "") as z.infer<
      typeof stationStatusEnum
    >,
    resultNote: String(formData.get("resultNote") ?? "") || undefined,
  });
}

export async function upsertPackageAction(
  payload: z.infer<typeof packageSchema>,
): Promise<AdminActionState> {
  const parsed = packageSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "패키지 정보를 확인해주세요." };
  }

  const supabase = createServerSupabase();
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
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const id = String(formData.get("id") ?? "");
  return upsertPackageAction({
    id: id ? id : undefined,
    name: String(formData.get("name") ?? ""),
    stationCount: Number(formData.get("stationCount") ?? 0),
    priceKrw: Number(formData.get("priceKrw") ?? 0),
    description: String(formData.get("description") ?? "") || undefined,
    isActive: formData.get("isActive") === "on",
  });
}

export async function upsertStationAction(
  payload: z.infer<typeof stationSchema>,
): Promise<AdminActionState> {
  const parsed = stationSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "방송국 정보를 확인해주세요." };
  }

  const supabase = createServerSupabase();
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
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const id = String(formData.get("id") ?? "");
  return upsertStationAction({
    id: id ? id : undefined,
    name: String(formData.get("name") ?? ""),
    code: String(formData.get("code") ?? ""),
    isActive: formData.get("isActive") === "on",
  });
}

export async function updatePackageStationsAction(
  payload: z.infer<typeof packageStationsSchema>,
): Promise<AdminActionState> {
  const parsed = packageStationsSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "방송국 코드를 확인해주세요." };
  }

  const supabase = createServerSupabase();
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
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return updatePackageStationsAction({
    packageId: String(formData.get("packageId") ?? ""),
    stationCodes: String(formData.get("stationCodes") ?? ""),
  });
}
