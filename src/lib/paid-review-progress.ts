export type PaidReviewProgress = "WAITING_SUBMISSION" | "IN_PROGRESS" | "COMPLETED";

// Payment confirmation starts the preparation stage. A paid submission is not
// evidence that a broadcaster or the rating board has received the materials.
export function getPaidReviewProgress({
  status,
  stationTotal = 0,
  stationSubmitted = 0,
  stationCompleted = 0,
  resultDelivered = false,
}: {
  status: string;
  stationTotal?: number;
  stationSubmitted?: number;
  stationCompleted?: number;
  resultDelivered?: boolean;
}): PaidReviewProgress {
  if (resultDelivered || (stationTotal > 0 && stationCompleted >= stationTotal)) {
    return "COMPLETED";
  }
  if (stationSubmitted > 0 || stationCompleted > 0 ||
      ["IN_PROGRESS", "RESULT_READY", "COMPLETED"].includes(status)) {
    return "IN_PROGRESS";
  }
  return "WAITING_SUBMISSION";
}
