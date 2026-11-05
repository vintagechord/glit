import { brandStatusTones } from "@/lib/brand-status-tones";

/**
 * Where an application stands for the operator. Status and payment columns
 * alone mislead: PRE_REVIEW means both "paid, waiting for review" and "the
 * customer reached the upload step and left", and a bank request moves the
 * row to WAITING_PAYMENT without being paid. The dashboard counts, the list
 * filter and the row badges all use these definitions so they agree.
 */
export const adminSubmissionStageKeys = [
  "drafting",
  "unpaid",
  "bank_pending",
  "paid",
  "in_review",
  "result_pending",
  "notified",
  "refunded",
] as const;

export type AdminSubmissionStage = (typeof adminSubmissionStageKeys)[number];

export type AdminSubmissionStageInfo = {
  key: AdminSubmissionStage;
  label: string;
  description: string;
  tone: string;
};

export const adminSubmissionStages: Record<AdminSubmissionStage, AdminSubmissionStageInfo> = {
  drafting: {
    key: "drafting",
    label: "신청서 작성 중",
    description: "업로드·결제 전에 멈춘 신청서. 안내 메일 없음",
    tone: brandStatusTones.neutral,
  },
  unpaid: {
    key: "unpaid",
    label: "결제 전 신청",
    description: "제출됐고 결제 대기 (장바구니·결과 페이지)",
    tone: brandStatusTones.warning,
  },
  bank_pending: {
    key: "bank_pending",
    label: "입금 확인 대기",
    description: "무통장 입금 요청. 입금 확인 후 결제 완료 처리",
    tone: brandStatusTones.warning,
  },
  paid: {
    key: "paid",
    label: "결제 완료 · 심의 접수 전",
    description: "방송사·영등위 접수 전",
    tone: brandStatusTones.progress,
  },
  in_review: {
    key: "in_review",
    label: "심의 진행 중",
    description: "방송사·영등위 결과 대기",
    tone: brandStatusTones.progress,
  },
  result_pending: {
    key: "result_pending",
    label: "결과 안내 대기",
    description: "결과 등록 후 안내 메일 미발송",
    tone: brandStatusTones.danger,
  },
  notified: {
    key: "notified",
    label: "결과 통보 완료",
    description: "결과 안내 메일 발송됨",
    tone: brandStatusTones.success,
  },
  refunded: {
    key: "refunded",
    label: "환불",
    description: "환불 처리됨",
    tone: brandStatusTones.neutral,
  },
};

export const isAdminSubmissionStage = (value: string): value is AdminSubmissionStage =>
  (adminSubmissionStageKeys as readonly string[]).includes(value);

export type AdminStageRow = {
  status?: string | null;
  payment_status?: string | null;
  current_order_id?: string | null;
  result_notified_at?: string | null;
};

const resultStatuses = new Set(["RESULT_READY", "COMPLETED"]);

/** DRAFT rows are background autosaves and have no stage. */
export function adminSubmissionStageOf(row: AdminStageRow): AdminSubmissionStage | null {
  const status = row.status ?? "";
  const payment = row.payment_status ?? "UNPAID";
  if (status === "DRAFT") return null;
  if (payment === "REFUNDED") return "refunded";
  if (resultStatuses.has(status)) return row.result_notified_at ? "notified" : "result_pending";
  if (payment === "PAID") return status === "IN_PROGRESS" ? "in_review" : "paid";
  if (payment === "PAYMENT_PENDING" || status === "WAITING_PAYMENT") return "bank_pending";
  if (status === "PRE_REVIEW" && !row.current_order_id) return "drafting";
  return "unpaid";
}

/** The subset of the PostgREST filter builder the stage filters use. */
export type StageFilterable<T> = {
  eq(column: string, value: string): T;
  in(column: string, values: readonly string[]): T;
  not(column: string, operator: string, value: string | null): T;
  or(filters: string): T;
  is(column: string, value: null): T;
};

const notRefunded = "payment_status.is.null,payment_status.neq.REFUNDED";
const unpaid = "payment_status.is.null,payment_status.eq.UNPAID";

/** Narrows a submissions query to one stage; mirrors adminSubmissionStageOf. */
export function applyAdminSubmissionStageFilter<T extends StageFilterable<T>>(
  query: T,
  stage: AdminSubmissionStage,
): T {
  switch (stage) {
    case "refunded":
      return query.eq("payment_status", "REFUNDED").not("status", "in", "(DRAFT)");
    case "notified":
      return query.in("status", ["RESULT_READY", "COMPLETED"]).not("result_notified_at", "is", null).or(notRefunded);
    case "result_pending":
      return query.in("status", ["RESULT_READY", "COMPLETED"]).is("result_notified_at", null).or(notRefunded);
    case "in_review":
      return query.eq("payment_status", "PAID").eq("status", "IN_PROGRESS");
    case "paid":
      return query.eq("payment_status", "PAID").not("status", "in", "(DRAFT,IN_PROGRESS,RESULT_READY,COMPLETED)");
    case "bank_pending":
      return query
        .not("status", "in", "(DRAFT,RESULT_READY,COMPLETED)")
        .or("payment_status.is.null,payment_status.eq.UNPAID,payment_status.eq.PAYMENT_PENDING")
        .or("payment_status.eq.PAYMENT_PENDING,status.eq.WAITING_PAYMENT");
    case "drafting":
      return query.eq("status", "PRE_REVIEW").or(unpaid).is("current_order_id", null);
    case "unpaid":
      return query
        .not("status", "in", "(DRAFT,RESULT_READY,COMPLETED,WAITING_PAYMENT)")
        .or(unpaid)
        .or("status.neq.PRE_REVIEW,current_order_id.not.is.null");
  }
}
