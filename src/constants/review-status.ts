import { z } from "zod";

// 접수 상태
export const reviewStatusValues = [
  "DRAFT",
  "SUBMITTED",
  "PRE_REVIEW",
  "WAITING_PAYMENT",
  "IN_PROGRESS",
  "RESULT_READY",
  "COMPLETED",
] as const;

export type ReviewStatus = (typeof reviewStatusValues)[number];

export const reviewStatusEnum = z.enum(reviewStatusValues);

export const reviewStatusOptions: Array<{ value: ReviewStatus; label: string }> =
  [
    { value: "DRAFT", label: "임시 저장" },
    { value: "SUBMITTED", label: "접수 완료" },
    { value: "PRE_REVIEW", label: "사전 검토" },
    { value: "WAITING_PAYMENT", label: "결제 대기" },
    { value: "IN_PROGRESS", label: "심의 진행" },
    { value: "RESULT_READY", label: "결과 준비" },
    { value: "COMPLETED", label: "완료" },
  ];

export const reviewStatusLabelMap: Record<ReviewStatus, string> =
  Object.fromEntries(
    reviewStatusOptions.map((option) => [option.value, option.label]),
  ) as Record<ReviewStatus, string>;

// 결제 상태
export const paymentStatusValues = [
  "UNPAID",
  "PAYMENT_PENDING",
  "PAID",
  "REFUNDED",
] as const;

export type PaymentStatus = (typeof paymentStatusValues)[number];

export const paymentStatusEnum = z.enum(paymentStatusValues);

export const paymentStatusOptions: Array<{
  value: PaymentStatus;
  label: string;
}> = [
  { value: "UNPAID", label: "미결제" },
  { value: "PAYMENT_PENDING", label: "결제 확인 중" },
  { value: "PAID", label: "결제 완료" },
  { value: "REFUNDED", label: "환불" },
];

export const paymentStatusLabelMap: Record<PaymentStatus, string> =
  Object.fromEntries(
    paymentStatusOptions.map((option) => [option.value, option.label]),
  ) as Record<PaymentStatus, string>;

// 방송국별 심의 상태
export const stationReviewStatusValues = [
  "NOT_SENT",
  "SENT",
  "RECEIVED",
  "APPROVED",
  "REJECTED",
  "NEEDS_FIX",
] as const;

export type StationReviewStatus = (typeof stationReviewStatusValues)[number];

export const stationReviewStatusEnum = z.enum(stationReviewStatusValues);

export const stationReviewStatusOptions: Array<{
  value: StationReviewStatus;
  label: string;
}> = [
  { value: "NOT_SENT", label: "접수대기" },
  { value: "SENT", label: "접수완료" },
  { value: "RECEIVED", label: "심의진행중" },
  { value: "APPROVED", label: "결과통보" },
  { value: "NEEDS_FIX", label: "수정요청" },
];

export const stationReviewStatusLabelMap: Record<StationReviewStatus, string> = {
  NOT_SENT: "접수대기",
  SENT: "접수완료",
  RECEIVED: "심의진행중",
  APPROVED: "결과통보",
  REJECTED: "결과통보",
  NEEDS_FIX: "수정요청",
};

export const normalizeStationReviewStatus = (
  status?: string | null,
): StationReviewStatus => {
  switch (status) {
    case "REJECTED":
      return "APPROVED";
    default:
      return (status as StationReviewStatus) ?? "NOT_SENT";
  }
};

// 결과 상태 (전체 접수 요약)
export const resultStatusValues = ["APPROVED", "REJECTED", "NEEDS_FIX"] as const;
export type ResultStatus = (typeof resultStatusValues)[number];
export const resultStatusEnum = z.enum(resultStatusValues);
export const resultStatusOptions: Array<{ value: ResultStatus; label: string }> =
  [
    { value: "APPROVED", label: "적격" },
    { value: "REJECTED", label: "불통과" },
    { value: "NEEDS_FIX", label: "수정 요청" },
  ];
export const resultStatusLabelMap: Record<ResultStatus, string> =
  Object.fromEntries(
    resultStatusOptions.map((option) => [option.value, option.label]),
  ) as Record<ResultStatus, string>;
