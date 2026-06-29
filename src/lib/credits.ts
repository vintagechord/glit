import type { SupabaseClient } from "@supabase/supabase-js";

export type CreditSummary = {
  earned: number;
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

  if (earnedResult.error) {
    throw new Error(`Failed to load earned credits: ${earnedResult.error.message}`);
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
  const magazineUsed = countOrZero(magazineResult.count);
  const used = magazineUsed + rewardUsed;

  return {
    earned,
    magazineUsed,
    rewardUsed,
    used,
    available: Math.max(earned - used, 0),
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
