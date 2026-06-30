import type { SupabaseClient } from "@supabase/supabase-js";

export type CreditSummary = {
  earned: number;
  adminGranted: number;
  magazineUsed: number;
  rewardUsed: number;
  used: number;
  available: number;
};

export type CreditReward = {
  id: string;
  title: string;
  description: string | null;
  credits_required: number;
  service_location: string | null;
  validity_days: number | null;
  sort_order: number | null;
  is_active: boolean;
  created_at?: string | null;
};

export type CreditRewardRedemption = {
  id: string;
  user_id: string;
  reward_id: string | null;
  reward_title: string;
  reward_description: string | null;
  credits_spent: number;
  coupon_code: string;
  status: "ISSUED" | "USED" | "CANCELED" | string;
  expires_at: string | null;
  admin_memo: string | null;
  issued_at: string | null;
  used_at: string | null;
  canceled_at: string | null;
  created_at: string | null;
};

export type StudioReservationStatus = "REQUESTED" | "APPROVED" | "CANCELED";

export type StudioReservationRequest = {
  id: string;
  user_id: string;
  redemption_id: string;
  reward_id: string | null;
  reward_title: string;
  service_location: string | null;
  status: StudioReservationStatus | string;
  preferred_date: string;
  preferred_time: string;
  duration_hours: number;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  notes: string | null;
  approved_message: string | null;
  admin_memo: string | null;
  approved_at: string | null;
  canceled_at: string | null;
  created_at: string | null;
  updated_at?: string | null;
};

export const VINTAGE_HOUSE_STUDIO_URL = "https://naver.me/GjyIilET";

const vintageHouseStudioRewardTitles = new Set([
  "빈티지하우스 메인 녹음실 1시간 권",
  "빈티지하우스 셀프 녹음실 1시간 권",
]);

export function isStudioCreditRewardTitle(
  rewardTitle: string | null | undefined,
) {
  return Boolean(rewardTitle && vintageHouseStudioRewardTitles.has(rewardTitle));
}

export function getCreditRewardStudioUrl(rewardTitle: string | null | undefined) {
  if (!isStudioCreditRewardTitle(rewardTitle)) {
    return null;
  }

  return VINTAGE_HOUSE_STUDIO_URL;
}

const countOrZero = (count?: number | null) => count ?? 0;

export async function getUserCreditSummary(
  client: SupabaseClient,
  userId: string,
): Promise<CreditSummary> {
  const [earnedResult, magazineResult, redemptionResult] = await Promise.all([
    client
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("type", "ALBUM")
      .eq("payment_status", "PAID"),
    client
      .from("magazine_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("status", "CANCELED"),
    client
      .from("credit_reward_redemptions")
      .select("credits_spent")
      .eq("user_id", userId)
      .neq("status", "CANCELED"),
  ]);
  const [profileResult, grantResult] = await Promise.all([
    client.from("profiles").select("role").eq("user_id", userId).maybeSingle(),
    client.from("credit_grants").select("amount").eq("user_id", userId),
  ]);
  if (earnedResult.error) {
    throw new Error(`Failed to load earned credits: ${earnedResult.error.message}`);
  }
  if (profileResult.error) {
    throw new Error(`Failed to load credit profile: ${profileResult.error.message}`);
  }
  if (grantResult.error) {
    throw new Error(`Failed to load admin credits: ${grantResult.error.message}`);
  }
  if (magazineResult.error) {
    throw new Error(
      `Failed to load magazine credit usage: ${magazineResult.error.message}`,
    );
  }
  if (redemptionResult.error) {
    throw new Error(
      `Failed to load reward credit usage: ${redemptionResult.error.message}`,
    );
  }

  const rewardUsed = (
    (redemptionResult.data ?? []) as Array<{ credits_spent?: number | null }>
  ).reduce((total, row) => total + (row.credits_spent ?? 0), 0);
  const earned = countOrZero(earnedResult.count);
  const adminGranted =
    profileResult.data?.role === "admin"
      ? ((grantResult.data ?? []) as Array<{ amount?: number | null }>).reduce(
          (total, row) => total + (row.amount ?? 0),
          0,
        )
      : 0;
  const magazineUsed = countOrZero(magazineResult.count);
  const used = magazineUsed + rewardUsed;
  const totalEarned = earned + adminGranted;

  return {
    earned: totalEarned,
    adminGranted,
    magazineUsed,
    rewardUsed,
    used,
    available: Math.max(totalEarned - used, 0),
  };
}

export async function listActiveCreditRewards(client: SupabaseClient) {
  const { data, error } = await client
    .from("credit_rewards")
    .select(
      "id, title, description, credits_required, service_location, validity_days, sort_order, is_active, created_at",
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("credits_required", { ascending: true });

  if (error) {
    throw new Error(`Failed to load credit rewards: ${error.message}`);
  }

  return (data ?? []) as CreditReward[];
}
