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

const rewardIdSchema = z.string().uuid();
const redemptionStatusSchema = z.enum(["ISSUED", "USED", "CANCELED"]);

const redemptionStatusUpdateSchema = z.object({
  redemptionId: z.string().uuid(),
  status: redemptionStatusSchema,
  adminMemo: z.string().trim().optional(),
  redirectTo: z.string().trim().optional(),
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

const normalizeRpcError = (message?: string | null) => {
  const raw = message ?? "";
  if (raw.includes("LOGIN_REQUIRED")) {
    return "로그인 후 크레딧 이용권을 교환할 수 있습니다.";
  }
  if (raw.includes("REWARD_NOT_FOUND")) {
    return "교환 가능한 이용권을 찾을 수 없습니다.";
  }
  if (raw.includes("INSUFFICIENT_CREDITS")) {
    return "보유 크레딧이 부족합니다.";
  }
  return "크레딧 이용권 교환에 실패했습니다.";
};

export async function redeemCreditRewardFormAction(
  formData: FormData,
): Promise<void> {
  const parsed = rewardIdSchema.safeParse(formData.get("rewardId"));
  if (!parsed.success) {
    redirect(withQuery("/mypage/credits", { error: "invalid_reward" }));
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/mypage/credits");
  }

  const { error } = await supabase.rpc("redeem_credit_reward", {
    p_reward_id: parsed.data,
  });

  if (error) {
    redirect(
      withQuery("/mypage/credits", {
        error: encodeURIComponent(normalizeRpcError(error.message)),
      }),
    );
  }

  revalidatePath("/mypage/credits");
  revalidatePath("/dashboard/credits");
  revalidatePath("/magazine");
  revalidatePath("/admin/credits");

  redirect(withQuery("/mypage/credits", { redeemed: "1" }));
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
