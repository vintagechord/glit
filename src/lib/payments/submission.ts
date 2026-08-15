import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildStdPayRequest } from "@/lib/inicis/stdpay";
import { getInicisMode, getStdPayConfig } from "@/lib/inicis/config";
import { sendSubmissionUpdateEmail } from "@/lib/email";
import { sendKakaoOfficialNotification } from "@/lib/kakao";
import { buildUrl, getBaseUrl } from "@/lib/url";

export type StdPayInitResult = {
  orderId: string;
  stdParams: Record<string, string>;
  stdJsUrl: string;
};

type SubmissionRecord = {
  id: string;
  user_id: string | null;
  guest_token: string | null;
  title: string | null;
  artist_name: string | null;
  status: string | null;
  type: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  amount_krw: number | null;
  payment_method: string | null;
  payment_status: string | null;
  album_draft_group_id?: string | null;
  mv_desired_rating: string | null;
  certificate_b2_path?: string | null;
  certificate_original_name?: string | null;
  certificate_mime?: string | null;
  certificate_size?: number | null;
  certificate_uploaded_at?: string | null;
  result_status?: string | null;
  result_memo?: string | null;
  result_notified_at?: string | null;
  package?: Array<{ name?: string | null }> | { name?: string | null } | null;
};

type PaymentCancelResult = {
  ok: boolean;
  error: unknown;
  submissionId?: string | null;
  guestToken?: string | null;
};

type ClosePaymentRpcRow = {
  primary_submission_id: string | null;
  submission_ids: string[] | null;
  final_status: string | null;
  transitioned: boolean | null;
};

type ApprovePaymentRpcRow = {
  primary_submission_id: string | null;
  submission_ids: string[] | null;
  already_approved: boolean | null;
};

const submissionSelectWithResult =
  "id, user_id, guest_token, title, artist_name, status, type, applicant_name, applicant_email, applicant_phone, guest_email, guest_phone, amount_krw, payment_method, payment_status, album_draft_group_id, mv_desired_rating, certificate_b2_path, certificate_original_name, certificate_mime, certificate_size, certificate_uploaded_at, result_status, result_memo, result_notified_at, package:packages ( name )";
const submissionSelectFallback =
  "id, user_id, guest_token, title, artist_name, status, type, applicant_name, applicant_email, applicant_phone, guest_email, guest_phone, amount_krw, payment_method, payment_status, mv_desired_rating, package:packages ( name )";

const normalizeEmailValue = (value?: string | null) =>
  value?.trim().toLowerCase() ?? "";

const collectNotificationEmails = (
  ...values: Array<string | null | undefined>
) => {
  const recipients = new Set<string>();
  for (const value of values) {
    const normalized = normalizeEmailValue(value);
    if (normalized) {
      recipients.add(normalized);
    }
  }
  return Array.from(recipients);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeSubmissionIds = (...values: unknown[]) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => {
          if (Array.isArray(value)) return value;
          return [value];
        })
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const mergePaymentRawResponse = (
  previousRaw: unknown,
  nextRaw?: Record<string, unknown> | null,
) => {
  const next = nextRaw ? { ...nextRaw } : {};
  if (isRecord(previousRaw) && "paymentGroup" in previousRaw) {
    next.paymentGroup = previousRaw.paymentGroup;
  }
  if (isRecord(previousRaw) && "closeState" in previousRaw) {
    next.closeState = previousRaw.closeState;
  }
  return Object.keys(next).length > 0 ? next : null;
};

const getPaymentMetadataByOrderId = async (
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
) => {
  const { data } = await admin
    .from("submission_payments")
    .select("submission_id, status, raw_response")
    .eq("order_id", orderId)
    .maybeSingle();
  return data as {
    submission_id: string | null;
    status: string | null;
    raw_response: unknown;
  } | null;
};

export const findSubmissionById = async (submissionId: string) => {
  const admin = createAdminClient();

  const primary = await admin
    .from("submissions")
    .select(submissionSelectWithResult)
    .eq("id", submissionId)
    .maybeSingle();
  let data = primary.data as SubmissionRecord | null;
  let error = primary.error;

  if (error?.code === "42703") {
    const fallback = await admin
      .from("submissions")
      .select(submissionSelectFallback)
      .eq("id", submissionId)
      .maybeSingle();
    data = fallback.data as SubmissionRecord | null;
    error = fallback.error;
  }

  return { submission: data, error };
};

type SubmissionOwner =
  | { kind: "member"; userId: string }
  | { kind: "guest"; guestToken: string };

const findSubmissionForOwner = async (
  submissionId: string,
  owner: SubmissionOwner,
) => {
  const admin = createAdminClient();
  const runQuery = (select: string) => {
    const query = admin
      .from("submissions")
      .select(select)
      .eq("id", submissionId);

    if (owner.kind === "member") {
      return query.eq("user_id", owner.userId).maybeSingle();
    }

    return query
      .is("user_id", null)
      .eq("guest_token", owner.guestToken)
      .maybeSingle();
  };

  const primary = await runQuery(submissionSelectWithResult);
  let data = primary.data as SubmissionRecord | null;
  let error = primary.error;

  if (error?.code === "42703") {
    const fallback = await runQuery(submissionSelectFallback);
    data = fallback.data as SubmissionRecord | null;
    error = fallback.error;
  }

  return { submission: data, error };
};

export const ensureSubmissionOwner = async (
  submissionId: string,
  guestToken?: string | null,
) => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && !guestToken) {
    return { user: null, submission: null, error: "UNAUTHORIZED" };
  }

  if (user) {
    const owned = await findSubmissionForOwner(submissionId, {
      kind: "member",
      userId: user.id,
    });
    if (owned.error) {
      return { user, submission: null, error: "NOT_FOUND" };
    }
    if (owned.submission) {
      return { user, submission: owned.submission, error: null };
    }
  }

  if (guestToken) {
    const owned = await findSubmissionForOwner(submissionId, {
      kind: "guest",
      guestToken,
    });
    if (owned.error) {
      return { user, submission: null, error: "NOT_FOUND" };
    }
    if (owned.submission) {
      return { user, submission: owned.submission, error: null };
    }
  }

  return { user, submission: null, error: "FORBIDDEN" };
};

export const createSubmissionPaymentOrder = async (
  submissionId: string,
  baseUrl: string,
  options?: { submissionIds?: string[] },
): Promise<{ error?: string; result?: StdPayInitResult }> => {
  const submissionIds = normalizeSubmissionIds(
    submissionId,
    options?.submissionIds,
  );
  const submissions: SubmissionRecord[] = [];

  for (const id of submissionIds) {
    const { submission, error } = await findSubmissionById(id);
    if (error || !submission) {
      return { error: "접수를 찾을 수 없습니다." };
    }
    if (submission.payment_status === "PAID") {
      return { error: "이미 결제가 완료된 접수가 포함되어 있습니다." };
    }
    if (
      submission.payment_status === "PAYMENT_PENDING" &&
      submission.payment_method !== "CARD"
    ) {
      return { error: "이미 결제가 진행 중인 접수가 포함되어 있습니다." };
    }
    if (submission.status === "DRAFT") {
      return { error: "임시저장 상태에서는 결제를 시작할 수 없습니다." };
    }
    if (submission.status === "PRE_REVIEW") {
      return { error: "파일 업로드 단계가 완료된 신청서만 결제할 수 있습니다." };
    }
    const submissionAmount = Math.round(Number(submission.amount_krw ?? 0));
    if (!Number.isFinite(submissionAmount) || submissionAmount <= 0) {
      return { error: "결제 금액이 유효하지 않습니다." };
    }
    submissions.push(submission);
  }

  const submission = submissions[0];
  if (!submission) {
    return { error: "접수를 찾을 수 없습니다." };
  }

  const hasMismatchedMemberOwner = submissions.some(
    (item) => item.user_id !== submission.user_id && (item.user_id || submission.user_id),
  );
  if (hasMismatchedMemberOwner) {
    return { error: "같은 신청자의 접수만 함께 결제할 수 있습니다." };
  }

  const albumDraftGroupIds = Array.from(
    new Set(
      submissions
        .filter(
          (item) => item.type === "ALBUM" && item.album_draft_group_id,
        )
        .map((item) => item.album_draft_group_id as string),
    ),
  );
  const admin = createAdminClient();
  if (albumDraftGroupIds.length > 0) {
    const { data: activeGroupRows, error: groupError } = await admin
      .from("submissions")
      .select("id, album_draft_group_id")
      .in("album_draft_group_id", albumDraftGroupIds)
      .in("status", ["DRAFT", "PRE_REVIEW", "SUBMITTED", "WAITING_PAYMENT"])
      .or("payment_status.is.null,payment_status.neq.PAID");
    if (groupError) {
      return { error: "앨범 장바구니 묶음을 확인하지 못했습니다." };
    }

    const requestedIdSet = new Set(submissionIds);
    const missingGroupMember = (activeGroupRows ?? []).find(
      (row) => !requestedIdSet.has(String(row.id)),
    );
    if (missingGroupMember) {
      return {
        error:
          "함께 작성한 앨범은 묶음 전체의 접수를 완료한 뒤 함께 결제해주세요.",
      };
    }
  }

  const amountKrw = submissions.reduce(
    (sum, item) => sum + Math.round(Number(item.amount_krw ?? 0)),
    0,
  );
  const orderTimestamp = Date.now().toString();
  const orderId = `SUBP-${orderTimestamp}-${submission.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const closeState = randomUUID();
  const config = getStdPayConfig();
  const packageName = Array.isArray(submission.package)
    ? (submission.package as Array<{ name?: string }>)[0]?.name
    : (submission.package as { name?: string } | null | undefined)?.name;

  const productName =
    submissions.length > 1
      ? `${packageName ?? "음반 심의"} ${submissions.length}건`
      : packageName ?? submission.title ?? submission.artist_name ?? "심의 접수";
  const buyerName =
    submission.applicant_name ??
    submission.artist_name ??
    packageName ??
    "회원";
  const buyerEmail = submission.applicant_email ?? "";
  const buyerTel = submission.applicant_phone ?? "";

  const maskMid = (mid: string) =>
    mid.length <= 4 ? `${mid.slice(0, 2)}**` : `${mid.slice(0, 2)}***${mid.slice(-2)}`;

  const returnUrl = new URL("/api/inicis/return", baseUrl).toString();
  const closeUrl = new URL(
    `/api/inicis/close?oid=${encodeURIComponent(orderId)}&state=${encodeURIComponent(closeState)}&cancel=1`,
    baseUrl,
  ).toString();
  const stdParams = buildStdPayRequest({
    orderId,
    amountKrw,
    productName,
    buyerName,
    buyerEmail,
    buyerTel,
    returnUrl,
    closeUrl,
    merchantData: closeState,
  }, orderTimestamp);

  console.info("[Inicis][STDPay][init]", {
    mode: getInicisMode(),
    mid: maskMid(config.mid),
    orderId,
    amountKrw,
    returnUrl,
    closeUrlConfigured: Boolean(stdParams.closeUrl),
    stdJsUrl: config.stdJsUrl,
    timestamp: stdParams.timestamp,
    baseUrl,
    guest: Boolean(submission.guest_token),
    submissionCount: submissions.length,
    note: baseUrl.includes("localhost")
      ? "Local baseUrl detected; use a public URL (e.g. ngrok) if the window is blocked."
      : undefined,
  });

  const paymentGroup = {
    primarySubmissionId: submission.id,
    submissionIds: submissions.map((item) => item.id),
    submissionAmounts: submissions.map((item) => ({
      submissionId: item.id,
      amountKrw: Math.round(Number(item.amount_krw ?? 0)),
    })),
  };

  const { data: startedRows, error: startError } = await admin.rpc(
    "begin_submission_payment_order",
    {
      p_primary_submission_id: submission.id,
      p_submission_ids: submissions.map((item) => item.id),
      p_order_id: orderId,
      p_amount_krw: amountKrw,
      p_user_id: submission.user_id ?? null,
      p_raw_response: { paymentGroup, closeState },
    },
  );

  if (startError) {
    if (
      startError.code === "23505" ||
      startError.message?.includes("PAYMENT_ALREADY_IN_PROGRESS")
    ) {
      return { error: "이미 생성된 결제 요청이 있습니다. 잠시 후 다시 시도해주세요." };
    }
    if (startError.message?.includes("SUBMISSION_NOT_FOUND")) {
      return { error: "접수를 찾을 수 없습니다." };
    }
    if (startError.message?.includes("SUBMISSION_NOT_PAYABLE")) {
      return { error: "결제할 수 없는 상태의 신청서가 포함되어 있습니다." };
    }
    if (startError.message?.includes("PAYMENT_AMOUNT_MISMATCH")) {
      return { error: "신청서 금액이 변경되었습니다. 다시 확인해주세요." };
    }
    if (startError.message?.includes("ALBUM_PRICE_SNAPSHOT_INVALID")) {
      return { error: "앨범 신청서의 결제 금액이 변경되었습니다. 신청서를 다시 저장해주세요." };
    }
    if (startError.message?.includes("ALBUM_DISCOUNT_NOT_ELIGIBLE")) {
      return {
        error:
          "추가 앨범 할인 결제에는 같은 패키지의 정가 앨범을 함께 선택하거나 먼저 결제해야 합니다.",
      };
    }
    if (startError.message?.includes("ALBUM_GROUP_INCOMPLETE")) {
      return { error: "함께 작성한 앨범은 묶음 전체를 선택해 결제해주세요." };
    }
    console.error("[Inicis][STDPay][init][transaction-error]", {
      orderId,
      code: startError.code,
      message: startError.message,
    });
    return { error: "결제 요청을 저장하지 못했습니다." };
  }

  const startedIds = new Set(
    ((startedRows ?? []) as Array<{ submission_id?: string | null }>)
      .map((row) => row.submission_id)
      .filter((id): id is string => Boolean(id)),
  );
  if (
    startedIds.size !== submissions.length ||
    submissions.some((item) => !startedIds.has(item.id))
  ) {
    console.error("[Inicis][STDPay][init][transaction-result-mismatch]", {
      orderId,
      expectedSubmissionIds: submissions.map((item) => item.id),
      startedSubmissionIds: Array.from(startedIds),
    });
    return { error: "결제 대기 상태를 저장하지 못했습니다." };
  }

  return {
    result: { orderId, stdParams, stdJsUrl: config.stdJsUrl },
  };
};

export const getPaymentByOrderId = async (orderId: string) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submission_payments")
    .select(
      "*, submission:submissions ( id, user_id, guest_token, payment_status, payment_method, title, artist_name, amount_krw )",
    )
    .eq("order_id", orderId)
    .maybeSingle();
  return { payment: data, error };
};

export const markPaymentFailure = async (
  orderId: string,
  payload: {
    result_code?: string | null;
    result_message?: string | null;
    raw_response?: Record<string, unknown> | null;
  },
) => {
  const admin = createAdminClient();
  const existingPayment = await getPaymentMetadataByOrderId(admin, orderId);
  if (!existingPayment) {
    return {
      ok: false,
      error: new Error("결제 요청 정보를 찾을 수 없습니다."),
    };
  }
  const nextRawResponse = mergePaymentRawResponse(
    existingPayment?.raw_response,
    payload.raw_response,
  );
  const { data, error } = await admin.rpc("close_submission_payment_order", {
    p_order_id: orderId,
    p_status: "FAILED",
    p_result_code: payload.result_code ?? null,
    p_result_message: payload.result_message ?? null,
    p_raw_response: nextRawResponse,
  });

  if (error) {
    return { ok: false, error };
  }
  const closed = ((data ?? []) as ClosePaymentRpcRow[])[0] ?? null;
  const ok =
    closed?.final_status === "FAILED" ||
    closed?.final_status === "CANCELED";
  return {
    ok,
    error: ok ? null : new Error("이미 승인되거나 종료된 결제 요청입니다."),
  };
};

export const markPaymentCanceled = async (
  orderId: string,
  payload?: {
    result_code?: string | null;
    result_message?: string | null;
    raw_response?: Record<string, unknown> | null;
    close_state?: string | null;
  },
) => {
  const admin = createAdminClient();
  const existingPayment = await getPaymentMetadataByOrderId(admin, orderId);
  if (!existingPayment) {
    return {
      ok: false,
      error: new Error("결제 요청 정보를 찾을 수 없습니다."),
      submissionId: null,
      guestToken: null,
    } satisfies PaymentCancelResult;
  }
  const expectedCloseState = isRecord(existingPayment.raw_response)
    ? existingPayment.raw_response.closeState
    : null;
  const receivedCloseState = payload?.close_state ?? "";
  if (
    typeof expectedCloseState !== "string" ||
    expectedCloseState.length < 32 ||
    receivedCloseState !== expectedCloseState
  ) {
    return {
      ok: false,
      error: new Error("결제창 종료 요청 인증값이 올바르지 않습니다."),
      submissionId: null,
      guestToken: null,
    } satisfies PaymentCancelResult;
  }
  const nextRawResponse = mergePaymentRawResponse(
    existingPayment?.raw_response,
    payload?.raw_response,
  );
  const { data, error } = await admin.rpc("close_submission_payment_order", {
    p_order_id: orderId,
    p_status: "CANCELED",
    p_result_code: payload?.result_code ?? "CANCELED",
    p_result_message: payload?.result_message ?? "사용자 취소",
    p_raw_response: nextRawResponse,
  });

  if (error) {
    return {
      ok: false,
      error,
      submissionId: null,
      guestToken: null,
    } satisfies PaymentCancelResult;
  }

  const closed = ((data ?? []) as ClosePaymentRpcRow[])[0] ?? null;
  const primarySubmissionId = closed?.primary_submission_id ?? null;
  let guestToken: string | null = null;
  if (primarySubmissionId) {
    const { data: submission } = await admin
      .from("submissions")
      .select("guest_token")
      .eq("id", primarySubmissionId)
      .maybeSingle();
    guestToken = submission?.guest_token ?? null;
  }

  const ok = closed?.final_status === "CANCELED";
  return {
    ok,
    error: ok ? null : new Error("이미 승인되거나 종료된 결제 요청입니다."),
    submissionId: primarySubmissionId,
    guestToken,
  } satisfies PaymentCancelResult;
};

export const markPaymentSuccess = async (
  orderId: string,
  payload: {
    tid?: string | null;
    result_code?: string | null;
    result_message?: string | null;
    raw_response?: Record<string, unknown> | null;
  },
) => {
  const admin = createAdminClient();
  const existingPayment = await getPaymentMetadataByOrderId(admin, orderId);
  if (!existingPayment) {
    return {
      ok: false,
      error: new Error("결제 요청 정보를 찾을 수 없습니다."),
      submissionId: null,
    };
  }
  if (
    existingPayment.status !== "REQUESTED" &&
    existingPayment.status !== "APPROVED"
  ) {
    return {
      ok: false,
      error: new Error("취소되거나 종료된 결제 요청입니다."),
      submissionId: existingPayment.submission_id,
    };
  }
  const nextRawResponse = mergePaymentRawResponse(
    existingPayment?.raw_response,
    payload.raw_response,
  );
  const { data, error } = await admin.rpc("approve_submission_payment_order", {
    p_order_id: orderId,
    p_pg_tid: payload.tid ?? null,
    p_result_code: payload.result_code ?? null,
    p_result_message: payload.result_message ?? null,
    p_raw_response: nextRawResponse,
    p_paid_at: new Date().toISOString(),
  });

  if (error) {
    return {
      ok: false,
      error,
      submissionId: existingPayment.submission_id,
    };
  }
  const approved = ((data ?? []) as ApprovePaymentRpcRow[])[0] ?? null;
  if (!approved?.primary_submission_id) {
    return {
      ok: false,
      error: new Error("결제 승인 상태를 저장하지 못했습니다."),
      submissionId: null,
    };
  }

  const submissionIds = normalizeSubmissionIds(
    approved.primary_submission_id,
    approved.submission_ids,
  );
  if (approved.already_approved) {
    return {
      ok: true,
      error: null,
      submissionId: approved.primary_submission_id,
    };
  }

  for (const targetSubmissionId of submissionIds) {
    const { submission: notificationSubmission } = await findSubmissionById(
      targetSubmissionId,
    );
    if (notificationSubmission) {
      let memberEmail: string | null = null;
      let memberPhone: string | null = null;
      if (notificationSubmission.user_id) {
        const { data: userData, error: userError } =
          await admin.auth.admin.getUserById(notificationSubmission.user_id);
        if (userError) {
          console.warn("[Email][payment] member lookup failed", {
            submissionId: notificationSubmission.id,
            userId: notificationSubmission.user_id,
            error: userError,
          });
        } else {
          memberEmail = userData?.user?.email ?? null;
        }

        const { data: profile, error: profileError } = await admin
          .from("profiles")
          .select("phone")
          .eq("user_id", notificationSubmission.user_id)
          .maybeSingle();
        if (!profileError) {
          memberPhone = profile?.phone ?? null;
        }
      }

      const kind = notificationSubmission.type?.startsWith("MV") ? "MV" : "ALBUM";
      const baseUrl = getBaseUrl();
      const link =
        notificationSubmission.guest_token &&
        notificationSubmission.guest_token.length >= 8
          ? buildUrl(
              `/track/${encodeURIComponent(notificationSubmission.guest_token)}`,
              baseUrl,
            )
          : buildUrl(
              `/dashboard/submissions/${notificationSubmission.id}`,
              baseUrl,
            );
      const recipientEmails = collectNotificationEmails(
        notificationSubmission.applicant_email,
        notificationSubmission.guest_email,
        memberEmail,
      );

      for (const recipientEmail of recipientEmails) {
        await sendSubmissionUpdateEmail({
          email: recipientEmail,
          title: notificationSubmission.title ?? "제목 미입력",
          artist: notificationSubmission.artist_name ?? null,
          kind,
          headline: "결제가 완료되었습니다.",
          summary: "결제 확인이 완료되어 심의가 시작됩니다.",
          link,
          subject: "[onside] 결제 완료 안내",
        });
      }

      await sendKakaoOfficialNotification({
        phone:
          notificationSubmission.applicant_phone ??
          notificationSubmission.guest_phone ??
          memberPhone,
        title: "결제가 완료되었습니다.",
        message: `${notificationSubmission.title ?? "제목 미입력"} 결제가 완료되어 심의가 시작됩니다.`,
        link,
      });
    }
  }

  return {
    ok: true,
    error: null,
    submissionId: approved.primary_submission_id,
  };
};
