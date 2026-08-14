import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildUrl, getBaseUrl } from "@/lib/url";

type PayPalMode = "sandbox" | "production";

type PayPalSubmission = {
  id: string;
  user_id: string | null;
  guest_token: string | null;
  title: string | null;
  artist_name: string | null;
  status: string | null;
  payment_status: string | null;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_amount?: number | null;
  payment_currency?: string | null;
  paypal_order_id?: string | null;
};

type PayPalOrderResponse = {
  id?: string;
  status?: string;
  links?: Array<{
    href?: string;
    rel?: string;
    method?: string;
  }>;
};

type PayPalCaptureResponse = {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: {
          currency_code?: string;
          value?: string;
        };
      }>;
    };
  }>;
};

type PayPalCaptureClaim = {
  expected_amount: number | string | null;
  expected_currency: string | null;
  already_approved: boolean | null;
  already_processing: boolean | null;
  capture_id: string | null;
};

const clean = (value?: string | null) => value?.trim() ?? "";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const boundedString = (value: unknown, maxLength = 100) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) || null : null;

const summarizePayPalIssues = (record: Record<string, unknown> | null) => {
  const details = Array.isArray(record?.details) ? record.details : [];
  return Array.from(
    new Set(
      details
        .map((detail) => boundedString(asRecord(detail)?.issue))
        .filter((issue): issue is string => Boolean(issue)),
    ),
  ).slice(0, 10);
};

export const summarizePayPalGatewayError = ({
  httpStatus,
  payload,
  orderId,
}: {
  httpStatus: number;
  payload: unknown;
  orderId: string;
}) => {
  const record = asRecord(payload);
  return {
    httpStatus,
    name: boundedString(record?.name),
    status: boundedString(record?.status),
    debugId: boundedString(record?.debug_id),
    issues: summarizePayPalIssues(record),
    orderFingerprint: createHash("sha256")
      .update(orderId)
      .digest("hex")
      .slice(0, 12),
  };
};

export const summarizeUnexpectedPayPalError = (error: unknown) => {
  const record = asRecord(error);
  return {
    name:
      boundedString(record?.name, 80) ??
      (error instanceof Error ? boundedString(error.name, 80) : null),
    code: boundedString(record?.code, 80),
  };
};

export const summarizePayPalOrderAudit = (response: unknown) => {
  const record = asRecord(response);
  const links = Array.isArray(record?.links) ? record.links : [];
  return {
    provider: "paypal",
    kind: "order",
    id: boundedString(record?.id, 128),
    status: boundedString(record?.status, 40),
    name: boundedString(record?.name, 100),
    debugId: boundedString(record?.debug_id, 100),
    issues: summarizePayPalIssues(record),
    linkRelations: Array.from(
      new Set(
        links
          .map((link) => boundedString(asRecord(link)?.rel, 40))
          .filter((relation): relation is string => Boolean(relation)),
      ),
    ).slice(0, 10),
  };
};

export const summarizePayPalCaptureAudit = (response: unknown) => {
  const record = asRecord(response);
  const purchaseUnits = Array.isArray(record?.purchase_units)
    ? record.purchase_units
    : [];
  const captures = purchaseUnits.flatMap((unit) => {
    const payments = asRecord(asRecord(unit)?.payments);
    return Array.isArray(payments?.captures) ? payments.captures : [];
  });
  return {
    provider: "paypal",
    kind: "capture",
    id: boundedString(record?.id, 128),
    status: boundedString(record?.status, 40),
    name: boundedString(record?.name, 100),
    debugId: boundedString(record?.debug_id, 100),
    issues: summarizePayPalIssues(record),
    captures: captures.slice(0, 5).map((capture) => {
      const captureRecord = asRecord(capture);
      const amount = asRecord(captureRecord?.amount);
      return {
        id: boundedString(captureRecord?.id, 128),
        status: boundedString(captureRecord?.status, 40),
        amount: {
          currencyCode: boundedString(amount?.currency_code, 3),
          value: boundedString(amount?.value, 40),
        },
      };
    }),
  };
};

const safeEqual = (left: string, right: string) => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};

export const hasPayPalSubmissionAccess = ({
  submissionUserId,
  submissionGuestToken,
  actorUserId,
  guestToken,
}: {
  submissionUserId?: string | null;
  submissionGuestToken?: string | null;
  actorUserId?: string | null;
  guestToken?: string | null;
}) => {
  if (submissionUserId) {
    return Boolean(actorUserId && actorUserId === submissionUserId);
  }
  return Boolean(
    submissionGuestToken &&
      guestToken &&
      submissionGuestToken === guestToken,
  );
};

export const validatePayPalCapture = ({
  response,
  orderId,
  submissionId,
  expectedAmount,
  expectedCurrency,
}: {
  response: PayPalCaptureResponse;
  orderId: string;
  submissionId: string;
  expectedAmount: number;
  expectedCurrency: string;
}) => {
  if (!response.id || response.id !== orderId) {
    return "PayPal order response does not match the requested order.";
  }

  if (response.purchase_units?.length !== 1) {
    return "PayPal order does not contain the expected purchase unit.";
  }
  const purchaseUnit = response.purchase_units[0];
  const referenceIds = [purchaseUnit?.reference_id, purchaseUnit?.custom_id]
    .map(clean)
    .filter(Boolean);
  if (
    referenceIds.length === 0 ||
    referenceIds.some((referenceId) => referenceId !== submissionId)
  ) {
    return "PayPal order does not match this submission.";
  }

  const capture = purchaseUnit?.payments?.captures?.[0];
  if (!capture?.id || capture.status !== "COMPLETED") {
    return "PayPal capture is not complete.";
  }
  const actualAmount = Number(capture?.amount?.value ?? Number.NaN);
  const actualCurrency = clean(capture?.amount?.currency_code).toUpperCase();
  const normalizedExpectedCurrency = clean(expectedCurrency).toUpperCase();
  if (
    !Number.isFinite(actualAmount) ||
    Math.abs(actualAmount - expectedAmount) > 0.005 ||
    !actualCurrency ||
    actualCurrency !== normalizedExpectedCurrency
  ) {
    return "PayPal captured amount or currency does not match the submission.";
  }

  return null;
};

export const getPayPalMode = (): PayPalMode =>
  clean(process.env.PAYPAL_MODE).toLowerCase() === "production"
    ? "production"
    : "sandbox";

const getPayPalBaseUrl = () =>
  getPayPalMode() === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

const getPayPalCredentials = () => {
  const clientId = clean(process.env.PAYPAL_CLIENT_ID);
  const clientSecret = clean(process.env.PAYPAL_CLIENT_SECRET);
  return { clientId, clientSecret };
};

export const isPayPalConfigured = () => {
  const { clientId, clientSecret } = getPayPalCredentials();
  return Boolean(clientId && clientSecret);
};

const getAccessToken = async () => {
  const { clientId, clientSecret } = getPayPalCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("PayPal is not configured.");
  }

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const json = (await response.json().catch(() => null)) as
    | { access_token?: string; error?: string; error_description?: string }
    | null;

  if (!response.ok || !json?.access_token) {
    console.error("[PayPal] authentication failed", {
      httpStatus: response.status,
      issue: boundedString(json?.error, 80),
    });
    throw new Error("PayPal authentication failed.");
  }

  return json.access_token;
};

type PayPalSubmissionOwner =
  | { kind: "member"; userId: string }
  | { kind: "guest"; guestToken: string };

const selectGlobalSubmission = async (
  submissionId: string,
  owner?: PayPalSubmissionOwner,
) => {
  const admin = createAdminClient();
  const withGlobal =
    "id, user_id, guest_token, title, artist_name, status, payment_status, payment_method, payment_provider, payment_amount, payment_currency, paypal_order_id";
  const fallback =
    "id, user_id, guest_token, title, artist_name, status, payment_status, payment_method";

  let primaryQuery = admin
    .from("submissions")
    .select(withGlobal)
    .eq("id", submissionId);
  if (owner?.kind === "member") {
    primaryQuery = primaryQuery.eq("user_id", owner.userId);
  } else if (owner?.kind === "guest") {
    primaryQuery = primaryQuery
      .is("user_id", null)
      .eq("guest_token", owner.guestToken);
  }
  const primary = await primaryQuery.maybeSingle();

  if (!primary.error) {
    return primary.data as PayPalSubmission | null;
  }

  if (primary.error.code === "PGRST204" || primary.error.code === "42703") {
    let legacyQuery = admin
      .from("submissions")
      .select(fallback)
      .eq("id", submissionId);
    if (owner?.kind === "member") {
      legacyQuery = legacyQuery.eq("user_id", owner.userId);
    } else if (owner?.kind === "guest") {
      legacyQuery = legacyQuery
        .is("user_id", null)
        .eq("guest_token", owner.guestToken);
    }
    const legacy = await legacyQuery.maybeSingle();
    if (legacy.error) return null;
    return legacy.data as PayPalSubmission | null;
  }

  return null;
};

/**
 * Validates the short-lived PayPal return nonce against its exact persisted
 * order/submission binding and returns the DB-owned guest token only to the
 * server callback. The token is subsequently encrypted into an HttpOnly
 * payment-result grant and is never placed in a URL.
 */
export const resolvePayPalReturnGuestAccess = async ({
  orderId,
  submissionId,
  returnState,
  nowMs = Date.now(),
}: {
  orderId: string;
  submissionId: string;
  returnState: string;
  nowMs?: number;
}) => {
  const normalizedOrderId = clean(orderId);
  const normalizedSubmissionId = clean(submissionId);
  const normalizedReturnState = clean(returnState);
  if (
    !normalizedOrderId ||
    normalizedOrderId.length > 200 ||
    !normalizedSubmissionId ||
    normalizedReturnState.length < 32 ||
    normalizedReturnState.length > 200 ||
    !Number.isSafeInteger(nowMs)
  ) {
    return { authorized: false as const, guestToken: null };
  }

  const admin = createAdminClient();
  const { data: payment, error: paymentError } = await admin
    .from("submission_payments")
    .select("submission_id, provider, raw_response, created_at, paid_at")
    .eq("order_id", normalizedOrderId)
    .maybeSingle();
  if (
    paymentError ||
    !payment ||
    payment.submission_id !== normalizedSubmissionId ||
    clean(payment.provider).toLowerCase() !== "paypal"
  ) {
    return { authorized: false as const, guestToken: null };
  }

  const rawResponse = payment.raw_response;
  const expectedReturnState =
    rawResponse &&
    typeof rawResponse === "object" &&
    !Array.isArray(rawResponse) &&
    "paypalReturnState" in rawResponse &&
    typeof rawResponse.paypalReturnState === "string"
      ? rawResponse.paypalReturnState
      : "";
  if (
    !expectedReturnState ||
    !safeEqual(expectedReturnState, normalizedReturnState)
  ) {
    return { authorized: false as const, guestToken: null };
  }

  // The nonce is a callback capability, not a permanent alternate guest
  // credential. Stop issuing fresh result grants after the checkout window.
  const paymentTimestamp = Date.parse(payment.paid_at ?? payment.created_at ?? "");
  if (
    !Number.isFinite(paymentTimestamp) ||
    paymentTimestamp > nowMs + 30_000 ||
    nowMs - paymentTimestamp > 30 * 60 * 1_000
  ) {
    return { authorized: false as const, guestToken: null };
  }

  const submission = await selectGlobalSubmission(normalizedSubmissionId);
  if (
    !submission ||
    submission.paypal_order_id !== normalizedOrderId ||
    clean(submission.payment_provider).toLowerCase() !== "paypal"
  ) {
    return { authorized: false as const, guestToken: null };
  }

  return {
    authorized: true as const,
    guestToken:
      submission.user_id === null && submission.guest_token
        ? submission.guest_token
        : null,
  };
};

const selectAccessibleGlobalSubmission = async (
  submissionId: string,
  guestToken?: string | null,
) => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const actorUserId = user?.id ?? null;
  if (actorUserId) {
    const memberSubmission = await selectGlobalSubmission(submissionId, {
      kind: "member",
      userId: actorUserId,
    });
    if (memberSubmission) {
      return { submission: memberSubmission, actorUserId, error: null };
    }
  }

  const normalizedGuestToken = clean(guestToken);
  if (normalizedGuestToken) {
    const guestSubmission = await selectGlobalSubmission(submissionId, {
      kind: "guest",
      guestToken: normalizedGuestToken,
    });
    if (guestSubmission) {
      return { submission: guestSubmission, actorUserId, error: null };
    }
  }

  return {
    submission: null,
    actorUserId,
    error: "Submission not found or access token is invalid.",
  };
};

const getCurrentActorUserId = async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
};

export const createPayPalOrderForSubmission = async ({
  submissionId,
  guestToken,
  request,
}: {
  submissionId: string;
  guestToken?: string | null;
  request: Request;
}) => {
  if (!isPayPalConfigured()) {
    return { error: "PayPal is not configured for this environment." };
  }

  const access = await selectAccessibleGlobalSubmission(submissionId, guestToken);
  const submission = access.submission;
  if (!submission) return { error: access.error ?? "Submission not found." };
  if (submission.payment_status === "PAID") {
    return { error: "Payment is already confirmed." };
  }
  if (!["SUBMITTED", "WAITING_PAYMENT"].includes(submission.status ?? "")) {
    return { error: "This submission is not ready for payment." };
  }
  if (
    submission.payment_status === "PAYMENT_PENDING" &&
    submission.paypal_order_id
  ) {
    return { error: "A PayPal checkout is already in progress for this submission." };
  }
  if (submission.payment_provider && submission.payment_provider !== "paypal") {
    return { error: "This submission is not configured for PayPal." };
  }

  const amount = Number(submission.payment_amount ?? 0);
  const currency = (clean(submission.payment_currency) || "USD").toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      error:
        "PayPal amount is not available. Apply the English submission database migration first.",
    };
  }

  // The return URL is shared with PayPal and may be retained in third-party
  // logs. Use an order-bound, single-purpose nonce instead of the guest's
  // long-lived submission access token.
  const returnState = randomUUID();
  const baseUrl = getBaseUrl(request as Parameters<typeof getBaseUrl>[0]);
  const returnUrl = buildUrl(
    `/api/paypal/capture?submissionId=${encodeURIComponent(submission.id)}&state=${encodeURIComponent(returnState)}`,
    baseUrl,
  );
  const cancelUrl = buildUrl(
    `/api/paypal/capture?cancel=1&submissionId=${encodeURIComponent(submission.id)}&state=${encodeURIComponent(returnState)}`,
    baseUrl,
  );
  const productName =
    submission.title && submission.artist_name
      ? `${submission.artist_name} - ${submission.title}`
      : submission.title ?? "Korean Broadcast Review Submission";

  const accessToken = await getAccessToken();
  const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: submission.id,
          custom_id: submission.id,
          description: productName,
          amount: {
            currency_code: currency,
            value: amount.toFixed(2),
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Onside",
            landing_page: "LOGIN",
            user_action: "PAY_NOW",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    }),
  });

  const json = (await response.json().catch(() => null)) as PayPalOrderResponse | null;
  if (!response.ok || !json?.id) {
    console.error(
      "[PayPal] create order failed",
      summarizePayPalGatewayError({
        httpStatus: response.status,
        payload: json,
        orderId: json?.id ?? submission.id,
      }),
    );
    return { error: "PayPal order could not be created." };
  }

  const approveUrl = json.links?.find((link) => link.rel === "approve")?.href;
  if (!approveUrl) {
    return { error: "PayPal approval URL was not returned." };
  }

  const admin = createAdminClient();
  const { data: startedRows, error: startError } = await admin.rpc(
    "begin_paypal_submission_payment",
    {
      p_submission_id: submission.id,
      p_actor_user_id: access.actorUserId,
      p_guest_token: guestToken?.trim() || null,
      p_order_id: json.id,
      p_amount: amount,
      p_currency: currency,
      p_raw_response: {
        paypalOrder: summarizePayPalOrderAudit(json),
        paypalReturnState: returnState,
      },
    },
  );
  const started = ((startedRows ?? []) as Array<{ payment_id?: string | null }>)[0];
  if (startError || !started?.payment_id) {
    console.error("[PayPal] failed to persist payment transaction", {
      submissionId: submission.id,
      orderId: json.id,
      code: startError?.code ?? null,
      message: startError?.message ?? null,
    });
    return { error: "PayPal payment request could not be saved." };
  }

  return {
    orderId: json.id,
    approveUrl,
  };
};

export const capturePayPalOrder = async ({
  orderId,
  submissionId,
  guestToken,
  returnState,
}: {
  orderId: string;
  submissionId: string;
  guestToken?: string | null;
  returnState?: string | null;
}) => {
  if (!isPayPalConfigured()) {
    return { error: "PayPal is not configured for this environment." };
  }

  const actorUserId = await getCurrentActorUserId();
  const admin = createAdminClient();
  const { data: claimRows, error: claimError } = await admin.rpc(
    "claim_paypal_submission_capture",
    {
      p_submission_id: submissionId,
      p_actor_user_id: actorUserId,
      p_guest_token: guestToken?.trim() || null,
      p_return_state: returnState?.trim() || null,
      p_order_id: orderId,
    },
  );
  const claim = ((claimRows ?? []) as PayPalCaptureClaim[])[0] ?? null;
  if (claimError || !claim) {
    console.error("[PayPal] capture claim rejected", {
      submissionId,
      orderId,
      code: claimError?.code ?? null,
      message: claimError?.message ?? null,
    });
    return { error: "This PayPal payment request is no longer active." };
  }

  if (claim.already_approved) {
    return { ok: true, captureId: claim.capture_id };
  }
  if (claim.already_processing) {
    return { error: "This PayPal capture is already being processed." };
  }

  const expectedAmount = Number(claim.expected_amount ?? Number.NaN);
  const expectedCurrency = clean(claim.expected_currency).toUpperCase();
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return { error: "PayPal amount is not available for this submission." };
  }
  if (!expectedCurrency) {
    return { error: "PayPal currency is not available for this submission." };
  }

  const accessToken = await getAccessToken();
  const response = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `onside-capture-${orderId}`,
      },
    },
  );
  const json = (await response.json().catch(() => null)) as PayPalCaptureResponse | null;

  if (!response.ok || !json) {
    console.error(
      "[PayPal] capture failed",
      summarizePayPalGatewayError({
        httpStatus: response.status,
        payload: json,
        orderId,
      }),
    );
    return { error: "PayPal payment could not be captured." };
  }

  const capture = json.purchase_units?.[0]?.payments?.captures?.[0];
  const captureId = capture?.id ?? json.id ?? null;
  const completed = json.status === "COMPLETED" || capture?.status === "COMPLETED";

  if (completed) {
    const validationError = validatePayPalCapture({
      response: json,
      orderId,
      submissionId,
      expectedAmount,
      expectedCurrency,
    });
    if (validationError) {
      console.error("[PayPal] capture validation failed", {
        orderId,
        submissionId,
        validationError,
      });
      // Do not close the local request after a completed but mismatched
      // capture. Keeping the capture claim prevents cancellation from hiding
      // a possibly settled charge and lets support reconcile it safely.
      return { error: validationError };
    }
  }

  if (!completed) {
    const { error: closeError } = await admin.rpc(
      "close_paypal_submission_payment",
      {
        p_submission_id: submissionId,
        p_actor_user_id: actorUserId,
        p_guest_token: guestToken?.trim() || null,
        p_return_state: returnState?.trim() || null,
        p_order_id: orderId,
        p_status: "FAILED",
        p_result_code: json.status ?? capture?.status ?? "CAPTURE_NOT_COMPLETED",
        p_result_message: "PayPal capture not completed",
        p_raw_response: summarizePayPalCaptureAudit(json),
      },
    );
    if (closeError) {
      console.error("[PayPal] failed capture could not be persisted", {
        orderId,
        submissionId,
        code: closeError.code,
        message: closeError.message,
      });
    }
    return { error: "PayPal capture did not complete." };
  }

  if (!captureId) {
    return { error: "PayPal capture identifier was not returned." };
  }

  const { data: approvedRows, error: approveError } = await admin.rpc(
    "approve_paypal_submission_payment",
    {
      p_submission_id: submissionId,
      p_actor_user_id: actorUserId,
      p_guest_token: guestToken?.trim() || null,
      p_return_state: returnState?.trim() || null,
      p_order_id: orderId,
      p_capture_id: captureId,
      p_amount: expectedAmount,
      p_currency: expectedCurrency,
      p_result_code: json.status ?? capture?.status ?? "COMPLETED",
      p_raw_response: summarizePayPalCaptureAudit(json),
      p_paid_at: new Date().toISOString(),
    },
  );
  const approved = ((approvedRows ?? []) as Array<{ capture_id?: string | null }>)[0];
  if (approveError || !approved?.capture_id) {
    console.error("[PayPal] captured payment transaction could not be persisted", {
      orderId,
      submissionId,
      code: approveError?.code ?? null,
      message: approveError?.message ?? null,
    });
    return { error: "PayPal captured the payment, but the submission could not be updated." };
  }

  return {
    ok: true,
    captureId: approved.capture_id,
  };
};

export const markPayPalOrderCanceled = async ({
  orderId,
  submissionId,
  guestToken,
  returnState,
}: {
  orderId?: string | null;
  submissionId: string;
  guestToken?: string | null;
  returnState?: string | null;
}) => {
  if (!orderId) {
    return { error: "PayPal order does not match this submission." };
  }

  const actorUserId = await getCurrentActorUserId();
  const admin = createAdminClient();
  const { data: closedRows, error: closeError } = await admin.rpc(
    "close_paypal_submission_payment",
    {
      p_submission_id: submissionId,
      p_actor_user_id: actorUserId,
      p_guest_token: guestToken?.trim() || null,
      p_return_state: returnState?.trim() || null,
      p_order_id: orderId,
      p_status: "CANCELED",
      p_result_code: "CANCELED",
      p_result_message: "PayPal checkout cancelled by payer.",
      p_raw_response: { paypalCancelReturn: true },
    },
  );
  const closed = ((closedRows ?? []) as Array<{ final_status?: string | null }>)[0];
  if (closeError || closed?.final_status !== "CANCELED") {
    console.error("[PayPal] cancellation transaction rejected", {
      orderId,
      submissionId,
      code: closeError?.code ?? null,
      message: closeError?.message ?? null,
    });
    return { error: "PayPal cancellation could not be saved." };
  }

  return { ok: true };
};
