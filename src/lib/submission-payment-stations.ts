import type { createAdminClient } from "@/lib/supabase/admin";

export const RETIRED_ONLINE_MBC_PAYMENT_MESSAGE =
  "온라인 MBC 심의가 종료되어 옵션을 수정한 뒤 다시 결제해주세요.";

type StationRelation = { code?: string | null };
type OnlineSubmission = {
  payment_status?: string | null;
  mv_selected_station_codes?: string[] | null;
  reviews?: Array<{
    station?: StationRelation | StationRelation[] | null;
  }> | null;
};

const isMbcCode = (code?: string | null) =>
  code?.trim().toUpperCase() === "MBC";

/** Read-only guard for previously saved carts, after ownership checks. */
export async function validateMvPaymentStations(
  db: Pick<ReturnType<typeof createAdminClient>, "from">,
  submissionIds: string[],
): Promise<string | null> {
  if (!submissionIds.length) return null;
  const { data, error } = await db
    .from("submissions")
    .select(
      "payment_status, mv_selected_station_codes, reviews:station_reviews(station:stations(code))",
    )
    .in("id", [...new Set(submissionIds)])
    .eq("type", "MV_DISTRIBUTION");
  if (error) {
    return "선택한 방송국 정보를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }

  const hasRetiredSelection = (data as OnlineSubmission[] | null)?.some(
    (submission) => {
      if (submission.payment_status === "PAID") return false;
      if (submission.mv_selected_station_codes?.some(isMbcCode)) return true;
      // Older submissions may only retain station IDs in their review rows.
      return submission.reviews?.some((review) => {
        const stations = Array.isArray(review.station)
          ? review.station
          : [review.station];
        return stations.some((station) => isMbcCode(station?.code));
      });
    },
  );
  return hasRetiredSelection ? RETIRED_ONLINE_MBC_PAYMENT_MESSAGE : null;
}
