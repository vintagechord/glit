"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

const rewardSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  creditsRequired: z.coerce.number().int().positive(),
  serviceLocation: z.string().trim().optional(),
  validityDays: z.preprocess((value) => {
    const text = String(value ?? "").trim();
    return text ? Number(text) : undefined;
  }, z.number().int().positive().optional()),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(false),
});

const redemptionStatusSchema = z.enum(["ISSUED", "USED", "CANCELED"]);
const studioReservationStatusSchema = z.enum([
  "REQUESTED",
  "APPROVED",
  "USED",
  "CANCELED",
]);

const redemptionStatusUpdateSchema = z.object({
  redemptionId: z.string().uuid(),
  status: redemptionStatusSchema,
  adminMemo: z.string().trim().optional(),
  redirectTo: z.string().trim().optional(),
});

const optionalText = z.preprocess((value) => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}, z.string().optional());

const optionalEmail = z.preprocess((value) => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}, z.string().email().optional());

const studioReservationSchema = z.object({
  rewardId: z.string().uuid(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferredTime: z.string().regex(/^\d{2}:\d{2}$/),
  contactName: z.string().trim().min(1),
  contactPhone: z.string().trim().min(1),
  contactEmail: optionalEmail,
  notes: optionalText,
  redirectTo: optionalText,
});

const studioReservationStatusUpdateSchema = z.object({
  reservationId: z.string().uuid(),
  status: studioReservationStatusSchema,
  approvedMessage: optionalText,
  adminMemo: optionalText,
  redirectTo: optionalText,
});

const withQuery = (
  path: string,
  entries: Record<string, string | undefined>,
) => {
  const [baseWithQuery, hash] = path.split("#");
  const [pathname, query] = baseWithQuery.split("?");
  const params = new URLSearchParams(query ?? "");
  Object.entries(entries).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const nextPath = `${pathname}?${params.toString()}`;
  return hash ? `${nextPath}#${hash}` : nextPath;
};

const safeAdminCreditsPath = (redirectTo?: string) => {
  const raw = redirectTo?.trim();
  if (!raw || !raw.startsWith("/admin/credits")) return "/admin/credits";
  return raw;
};

const safeUserCreditsPath = (redirectTo?: string) => {
  const raw = redirectTo?.trim();
  if (!raw) return "/mypage/credits";

  try {
    const base = "https://onside.local";
    const url = new URL(raw, base);
    if (url.origin !== base) return "/mypage/credits";

    const allowedPaths = [
      "/mypage/credits",
      "/dashboard/credits",
      "/magazine",
      "/en/mypage/credits",
      "/en/dashboard/credits",
      "/en/magazine",
    ];
    if (!allowedPaths.includes(url.pathname)) return "/mypage/credits";

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/mypage/credits";
  }
};

async function requireAdminUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (data?.role !== "admin") {
    redirect("/");
  }

  return user;
}

const normalizeStudioRpcError = (message?: string | null) => {
  const raw = message ?? "";
  if (raw.includes("LOGIN_REQUIRED")) {
    return "로그인 후 서비스 이용 요청을 접수할 수 있습니다.";
  }
  if (raw.includes("REWARD_NOT_FOUND")) {
    return "신청 가능한 서비스를 찾을 수 없습니다.";
  }
  if (raw.includes("INSUFFICIENT_CREDITS")) {
    return "보유 크레딧이 부족합니다.";
  }
  if (raw.includes("INVALID_RESERVATION_DATE")) {
    return "이용 희망일은 오늘 이후 날짜로 선택해주세요.";
  }
  if (raw.includes("INVALID_RESERVATION_TIME")) {
    return "이용 희망 시간을 다시 선택해주세요.";
  }
  return "서비스 이용 요청 접수에 실패했습니다.";
};

const buildServiceUseMessage = ({
  serviceName,
}: {
  serviceName?: string | null;
}) =>
  `${serviceName ?? "서비스"} 이용 안내를 적어주신 연락처로 드립니다.`;

export async function redeemCreditRewardFormAction(
  formData: FormData,
): Promise<void> {
  const redirectPath = safeUserCreditsPath(
    String(formData.get("redirectTo") ?? ""),
  );

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(redirectPath)}`);
  }

  redirect(
    withQuery(redirectPath, {
      error: "서비스 이용 요청은 이용 희망일과 연락처를 입력해 접수해주세요.",
    }),
  );
}

export async function createStudioReservationFormAction(
  formData: FormData,
): Promise<void> {
  const rawRedirectTo = String(formData.get("redirectTo") ?? "");
  const parsed = studioReservationSchema.safeParse({
    rewardId: formData.get("rewardId"),
    preferredDate: formData.get("preferredDate"),
    preferredTime: formData.get("preferredTime"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    contactEmail: formData.get("contactEmail"),
    notes: formData.get("notes"),
    redirectTo: rawRedirectTo,
  });
  const redirectPath = safeUserCreditsPath(
    parsed.success ? parsed.data.redirectTo : rawRedirectTo,
  );

  if (!parsed.success) {
    redirect(
      withQuery(redirectPath, {
        error: "이용 희망일, 시간, 신청자명, 연락처를 확인해주세요.",
      }),
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(redirectPath)}`);
  }

  const { error } = await supabase.rpc("redeem_studio_reward", {
    p_reward_id: parsed.data.rewardId,
    p_preferred_date: parsed.data.preferredDate,
    p_preferred_time: parsed.data.preferredTime,
    p_contact_name: parsed.data.contactName,
    p_contact_phone: parsed.data.contactPhone,
    p_contact_email: parsed.data.contactEmail ?? null,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    redirect(
      withQuery(redirectPath, {
        error: normalizeStudioRpcError(error.message),
      }),
    );
  }

  revalidatePath("/mypage/credits");
  revalidatePath("/dashboard/credits");
  revalidatePath("/magazine");
  revalidatePath("/en/magazine");
  revalidatePath("/admin/credits");
  revalidatePath("/admin/credits/requests");

  redirect(withQuery(redirectPath, { studioRequested: "1" }));
}

export async function upsertCreditRewardFormAction(
  formData: FormData,
): Promise<void> {
  await requireAdminUser();

  const parsed = rewardSchema.safeParse({
    id: formData.get("id") || undefined,
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    creditsRequired: formData.get("creditsRequired"),
    serviceLocation: formData.get("serviceLocation") || undefined,
    validityDays: formData.get("validityDays") || undefined,
    sortOrder: formData.get("sortOrder") || 0,
    isActive: formData.get("isActive") === "on",
  });

  if (!parsed.success) {
    redirect(withQuery("/admin/credits", { error: "invalid_reward" }));
  }

  const admin = createAdminClient();
  const payload = {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    credits_required: parsed.data.creditsRequired,
    service_location: parsed.data.serviceLocation ?? null,
    validity_days: parsed.data.validityDays ?? null,
    sort_order: parsed.data.sortOrder,
    is_active: parsed.data.isActive,
  };

  const result = parsed.data.id
    ? await admin
        .from("credit_rewards")
        .update(payload)
        .eq("id", parsed.data.id)
    : await admin.from("credit_rewards").insert(payload);

  if (result.error) {
    console.error("[credits] reward upsert failed", result.error);
    redirect(withQuery("/admin/credits", { error: "save_failed" }));
  }

  revalidatePath("/admin/credits");
  revalidatePath("/mypage/credits");
  redirect(withQuery("/admin/credits", { saved: "1" }));
}

export async function updateCreditRedemptionStatusFormAction(
  formData: FormData,
): Promise<void> {
  await requireAdminUser();

  const parsed = redemptionStatusUpdateSchema.safeParse({
    redemptionId: formData.get("redemptionId"),
    status: formData.get("status"),
    adminMemo: formData.get("adminMemo") || undefined,
    redirectTo: formData.get("redirectTo") || undefined,
  });
  const redirectPath = safeAdminCreditsPath(
    parsed.success ? parsed.data.redirectTo : undefined,
  );

  if (!parsed.success) {
    redirect(withQuery(redirectPath, { error: "invalid_status" }));
  }

  const now = new Date().toISOString();
  const statusTimestamps =
    parsed.data.status === "USED"
      ? { used_at: now, canceled_at: null }
      : parsed.data.status === "CANCELED"
        ? { used_at: null, canceled_at: now }
        : { used_at: null, canceled_at: null };

  const admin = createAdminClient();
  const { error } = await admin
    .from("credit_reward_redemptions")
    .update({
      status: parsed.data.status,
      admin_memo: parsed.data.adminMemo ?? null,
      ...statusTimestamps,
    })
    .eq("id", parsed.data.redemptionId);

  if (error) {
    console.error("[credits] redemption status update failed", error);
    redirect(withQuery(redirectPath, { error: "status_failed" }));
  }

  revalidatePath("/admin/credits");
  revalidatePath("/mypage/credits");
  redirect(withQuery(redirectPath, { saved: "1" }));
}

export async function updateStudioReservationStatusFormAction(
  formData: FormData,
): Promise<void> {
  await requireAdminUser();

  const parsed = studioReservationStatusUpdateSchema.safeParse({
    reservationId: formData.get("reservationId"),
    status: formData.get("status"),
    approvedMessage: formData.get("approvedMessage"),
    adminMemo: formData.get("adminMemo"),
    redirectTo: formData.get("redirectTo"),
  });
  const redirectPath = safeAdminCreditsPath(
    parsed.success ? parsed.data.redirectTo : undefined,
  );

  if (!parsed.success) {
    redirect(withQuery(redirectPath, { error: "invalid_studio_status" }));
  }

  const admin = createAdminClient();
  const { data: reservation, error: loadError } = await admin
    .from("studio_reservation_requests")
    .select("id, redemption_id, reward_title, service_location, preferred_date, preferred_time, approved_at")
    .eq("id", parsed.data.reservationId)
    .maybeSingle();

  if (loadError || !reservation) {
    console.error("[credits] studio reservation load failed", loadError);
    redirect(withQuery(redirectPath, { error: "studio_request_not_found" }));
  }

  const { data: redemption, error: redemptionLoadError } = await admin
    .from("credit_reward_redemptions")
    .select("status")
    .eq("id", reservation.redemption_id)
    .maybeSingle();

  if (redemptionLoadError || !redemption) {
    console.error("[credits] studio redemption load failed", redemptionLoadError);
    redirect(withQuery(redirectPath, { error: "studio_redemption_not_found" }));
  }

  const now = new Date().toISOString();
  const shouldApprove = parsed.data.status === "APPROVED" || parsed.data.status === "USED";
  const nextReservationStatus =
    parsed.data.status === "USED" ? "APPROVED" : parsed.data.status;
  const updatePayload = {
    status: nextReservationStatus,
    approved_message:
      shouldApprove
        ? (parsed.data.approvedMessage ??
          buildServiceUseMessage({
            serviceName: reservation.service_location ?? reservation.reward_title,
          }))
        : (parsed.data.approvedMessage ?? null),
    admin_memo: parsed.data.adminMemo ?? null,
    approved_at: shouldApprove ? (reservation.approved_at ?? now) : null,
    canceled_at: parsed.data.status === "CANCELED" ? now : null,
  };

  const { error: updateError } = await admin
    .from("studio_reservation_requests")
    .update(updatePayload)
    .eq("id", parsed.data.reservationId);

  if (updateError) {
    console.error("[credits] studio reservation update failed", updateError);
    redirect(withQuery(redirectPath, { error: "studio_status_failed" }));
  }

  const redemptionStatus =
    parsed.data.status === "CANCELED"
      ? "CANCELED"
      : parsed.data.status === "USED"
        ? "USED"
        : "ISSUED";
  const redemptionUpdate: {
    status: string;
    canceled_at: string | null;
    used_at: string | null;
  } = {
    status: redemptionStatus,
    canceled_at: parsed.data.status === "CANCELED" ? now : null,
    used_at: redemptionStatus === "USED" ? now : null,
  };
  const { error: redemptionError } = await admin
    .from("credit_reward_redemptions")
    .update(redemptionUpdate)
    .eq("id", reservation.redemption_id);

  if (redemptionError) {
    console.error("[credits] studio redemption sync failed", redemptionError);
    redirect(withQuery(redirectPath, { error: "studio_redemption_failed" }));
  }

  revalidatePath("/admin/credits");
  revalidatePath("/admin/credits/requests");
  revalidatePath("/mypage/credits");
  revalidatePath("/magazine");

  redirect(withQuery(redirectPath, { saved: "1" }));
}
