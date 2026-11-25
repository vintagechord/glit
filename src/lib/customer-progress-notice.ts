/**
 * What a customer is told about the review's timing and each progress stage.
 *
 * 2026-11-25 (owner): members kept reopening their status page and mails
 * because nothing said how long a review takes. The schedule is shown on the
 * status card once the payment is confirmed, and the progress mail is titled
 * by its stage instead of the generic "접수 정보 업데이트 안내", whose body
 * read "운영 단계: 심의진행" (admin wording).
 */

type SubmissionKind = string | null | undefined;

/** Stations receive the application within this many business days. */
export const REVIEW_RECEIPT_SCHEDULE = "영업일 기준 2~3일 이내";
/** Results by station group (album and broadcast MV). */
export const REVIEW_RESULT_SCHEDULE = "공중파(KBS·MBC·SBS) 약 1주 · 그 밖의 방송국 1~3주";

/** Online MV goes to one review body, not to stations; the station result
 * times do not apply to it. */
export const hasStationResultSchedule = (type: SubmissionKind) => type !== "MV_DISTRIBUTION";

/** One or two sentences for mail bodies. */
export function reviewScheduleSentences(type: SubmissionKind) {
  return [
    `접수는 결제 확인 후 ${REVIEW_RECEIPT_SCHEDULE} 진행됩니다.`,
    hasStationResultSchedule(type)
      ? "결과는 공중파(KBS·MBC·SBS)는 약 1주, 그 밖의 방송국은 1~3주 걸립니다."
      : null,
  ].filter((line): line is string => Boolean(line));
}

export type CustomerProgressNotice = { subject: string; headline: string; summary: string };

const subjectTitle = (title: string | null | undefined) => {
  const clean = title?.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim().slice(0, 160);
  return clean ? ` — ${clean}` : "";
};

const isStationReview = (type: SubmissionKind) => type !== "MV_DISTRIBUTION";

/** The progress mail for the stage an application stands on. */
export function customerProgressNotice(input: {
  type: SubmissionKind;
  status: string | null | undefined;
  paymentStatus: string | null | undefined;
  title?: string | null;
}): CustomerProgressNotice | null {
  const suffix = subjectTitle(input.title);
  if (input.status === "DRAFT" || input.paymentStatus === "REFUNDED") return null;
  if (input.paymentStatus !== "PAID") {
    return {
      subject: `[onside] 결제 대기 안내${suffix}`,
      headline: "결제가 확인되면 심의 접수를 시작합니다.",
      summary: "진행상황 바로 보기에서 결제를 이어서 진행해주세요.",
    };
  }
  if (input.status === "RESULT_READY" || input.status === "COMPLETED") {
    return {
      subject: `[onside] 심의 결과 안내${suffix}`,
      headline: "심의 결과를 확인할 수 있습니다.",
      summary: isStationReview(input.type)
        ? "진행상황 바로 보기에서 방송국별 결과를 확인해주세요."
        : "진행상황 바로 보기에서 심의 결과를 확인해주세요.",
    };
  }
  if (input.status === "IN_PROGRESS") {
    return isStationReview(input.type)
      ? {
        subject: `[onside] 방송국 접수 시작 안내${suffix}`,
        headline: "방송국 심의 접수를 시작했습니다.",
        summary: [
          "결과는 공중파(KBS·MBC·SBS)는 약 1주, 그 밖의 방송국은 1~3주 걸립니다.",
          "방송국별 진행 상황은 진행상황 바로 보기에서 확인할 수 있습니다.",
        ].join("\n"),
      }
      : {
        subject: `[onside] 심의 접수 시작 안내${suffix}`,
        headline: "심의 접수를 시작했습니다.",
        summary: "결과가 나오면 이메일로 안내드립니다. 진행 상황은 진행상황 바로 보기에서 확인할 수 있습니다.",
      };
  }
  return {
    subject: `[onside] 심의 접수 준비 안내${suffix}`,
    headline: "결제가 확인되어 심의 접수를 준비하고 있습니다.",
    summary: reviewScheduleSentences(input.type).join("\n"),
  };
}

/**
 * The mail a stage save sends, if any. Only the move into 심의진행 is news to
 * the customer: payment confirmations and refunds have their own mails, results
 * go out from the review summary, and a step back or a tidied title/artist is
 * recorded without a mail (one customer got five in 70 minutes).
 */
export function stageChangeNotice(input: {
  type: SubmissionKind;
  currentStatus: string;
  nextStatus: string;
  currentPaymentStatus: string;
  nextPaymentStatus: string;
  title?: string | null;
}): CustomerProgressNotice | null {
  if (input.currentPaymentStatus !== "PAID" || input.nextPaymentStatus !== "PAID") return null;
  if (input.nextStatus !== "IN_PROGRESS" || input.currentStatus === "IN_PROGRESS") return null;
  return customerProgressNotice({ type: input.type, status: "IN_PROGRESS", paymentStatus: "PAID", title: input.title });
}
