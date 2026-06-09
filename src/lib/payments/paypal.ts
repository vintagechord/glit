import { createAdminClient } from "@/lib/supabase/admin";
import { buildUrl, getBaseUrl } from "@/lib/url";

type PayPalMode = "sandbox" | "production";

type PayPalSubmission = {
  id: string;
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

const clean = (value?: string | null) => value?.trim() ?? "";

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
    throw new Error(json?.error_description ?? json?.error ?? "PayPal auth failed.");
  }

  return json.access_token;
};

const selectGlobalSubmission = async (submissionId: string) => {
  const admin = createAdminClient();
  const withGlobal =
    "id, guest_token, title, artist_name, status, payment_status, payment_method, payment_provider, payment_amount, payment_currency, paypal_order_id";
  const fallback =
    "id, guest_token, title, artist_name, status, payment_status, payment_method";

  const primary = await admin
    .from("submissions")
    .select(withGlobal)
    .eq("id", submissionId)
    .maybeSingle();

  if (!primary.error) {
    return primary.data as PayPalSubmission | null;
  }

  if (primary.error.code === "PGRST204" || primary.error.code === "42703") {
    const legacy = await admin
      .from("submissions")
      .select(fallback)
      .eq("id", submissionId)
      .maybeSingle();
    if (legacy.error) return null;
    return legacy.data as PayPalSubmission | null;
  }

  return null;
};

const extractMissingColumn = (error: { message?: string | null }) => {
  const message = error.message ?? "";
  const match =
    message.match(/'([^']+)' column/) ??
    message.match(/column "([^"]+)"/i) ??
    message.match(/Could not find the '([^']+)'/i);
  return match?.[1] ?? null;
};

const writeWithColumnFallback = async (
  table: "submissions" | "submission_payments",
  mode: "insert" | "update",
  payload: Record<string, unknown>,
  match?: { column: string; value: string },
) => {
  const admin = createAdminClient();
  let currentPayload = { ...payload };
  const removed = new Set<string>();
  let usedLegacyPaymentMethodFallback = false;
  const maxAttempts = Math.max(Object.keys(currentPayload).length + 4, 16);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const query =
      mode === "insert"
        ? admin.from(table).insert(currentPayload)
        : admin.from(table).update(currentPayload).eq(match!.column, match!.value);
    const { error } = await query;
    if (!error) return { error: null };

    if (error.code === "PGRST204" || error.code === "42703") {
      const missing = extractMissingColumn(error);
      if (missing && missing in currentPayload && !removed.has(missing)) {
        removed.add(missing);
        delete currentPayload[missing];
        continue;
      }
    }

    if (
      table === "submissions" &&
      error.code === "22P02" &&
      currentPayload.payment_method === "PAYPAL" &&
      !usedLegacyPaymentMethodFallback
    ) {
      usedLegacyPaymentMethodFallback = true;
      currentPayload = { ...currentPayload, payment_method: "CARD" };
      continue;
    }

    return { error };
  }

  return { error: { message: "PayPal database write failed." } };
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

  const submission = await selectGlobalSubmission(submissionId);
  if (!submission) return { error: "Submission not found." };
  if (submission.guest_token && submission.guest_token !== guestToken) {
    return { error: "Submission access token is invalid." };
  }
  if (submission.payment_status === "PAID") {
    return { error: "Payment is already confirmed." };
  }
  if (submission.payment_provider && submission.payment_provider !== "paypal") {
    return { error: "This submission is not configured for PayPal." };
  }

  const amount = Number(submission.payment_amount ?? 0);
  const currency = clean(submission.payment_currency) || "USD";
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      error:
        "PayPal amount is not available. Apply the English submission database migration first.",
    };
  }

  const baseUrl = getBaseUrl(request as Parameters<typeof getBaseUrl>[0]);
  const returnUrl = buildUrl(
    `/api/paypal/capture?submissionId=${encodeURIComponent(submission.id)}&guestToken=${encodeURIComponent(guestToken ?? "")}`,
    baseUrl,
  );
  const cancelUrl = buildUrl(
    `/api/paypal/capture?cancel=1&submissionId=${encodeURIComponent(submission.id)}&guestToken=${encodeURIComponent(guestToken ?? "")}`,
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
    console.error("[PayPal] create order failed", json);
    return { error: "PayPal order could not be created." };
  }

  await writeWithColumnFallback(
    "submissions",
    "update",
    {
      paypal_order_id: json.id,
      payment_provider: "paypal",
      payment_status: "PAYMENT_PENDING",
      status: "WAITING_PAYMENT",
      payment_method: "PAYPAL",
    },
    { column: "id", value: submission.id },
  );

  await writeWithColumnFallback("submission_payments", "insert", {
    submission_id: submission.id,
    user_id: null,
    order_id: json.id,
    amount_krw: 0,
    amount: amount,
    currency,
    provider: "paypal",
    status: "REQUESTED",
    raw_response: json,
  });

  const approveUrl = json.links?.find((link) => link.rel === "approve")?.href;
  if (!approveUrl) {
    return { error: "PayPal approval URL was not returned." };
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
}: {
  orderId: string;
  submissionId: string;
  guestToken?: string | null;
}) => {
  if (!isPayPalConfigured()) {
    return { error: "PayPal is not configured for this environment." };
  }

  const submission = await selectGlobalSubmission(submissionId);
  if (!submission) return { error: "Submission not found." };
  if (submission.guest_token && submission.guest_token !== guestToken) {
    return { error: "Submission access token is invalid." };
  }
  if (submission.paypal_order_id && submission.paypal_order_id !== orderId) {
    return { error: "PayPal order does not match this submission." };
  }

  const accessToken = await getAccessToken();
  const response = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );
  const json = (await response.json().catch(() => null)) as PayPalCaptureResponse | null;

  if (!response.ok || !json) {
    console.error("[PayPal] capture failed", json);
    return { error: "PayPal payment could not be captured." };
  }

  const capture = json.purchase_units?.[0]?.payments?.captures?.[0];
  const captureId = capture?.id ?? json.id ?? null;
  const completed = json.status === "COMPLETED" || capture?.status === "COMPLETED";

  await writeWithColumnFallback(
    "submission_payments",
    "update",
    {
      status: completed ? "APPROVED" : "FAILED",
      pg_tid: captureId,
      paypal_capture_id: captureId,
      result_code: json.status ?? capture?.status ?? null,
      result_message: completed ? "PayPal payment captured" : "PayPal capture not completed",
      raw_response: json,
      paid_at: completed ? new Date().toISOString() : null,
    },
    { column: "order_id", value: orderId },
  );

  if (!completed) {
    return { error: "PayPal capture did not complete." };
  }

  await writeWithColumnFallback(
    "submissions",
    "update",
    {
      payment_status: "PAID",
      payment_method: "PAYPAL",
      payment_provider: "paypal",
      paypal_order_id: orderId,
      paypal_capture_id: captureId,
      status: "IN_PROGRESS",
    },
    { column: "id", value: submission.id },
  );

  const admin = createAdminClient();
  await admin.from("submission_events").insert({
    submission_id: submission.id,
    event_type: "PAYMENT",
    message: "PayPal payment captured for English submission.",
  });

  return {
    ok: true,
    captureId,
  };
};

export const markPayPalOrderCanceled = async ({
  orderId,
  submissionId,
  guestToken,
}: {
  orderId?: string | null;
  submissionId: string;
  guestToken?: string | null;
}) => {
  const submission = await selectGlobalSubmission(submissionId);
  if (!submission) return { error: "Submission not found." };
  if (submission.guest_token && submission.guest_token !== guestToken) {
    return { error: "Submission access token is invalid." };
  }

  if (orderId) {
    await writeWithColumnFallback(
      "submission_payments",
      "update",
      {
        status: "CANCELED",
        result_code: "CANCELED",
        result_message: "PayPal checkout cancelled by payer.",
      },
      { column: "order_id", value: orderId },
    );
  }

  await writeWithColumnFallback(
    "submissions",
    "update",
    {
      payment_status: "UNPAID",
      status: "WAITING_PAYMENT",
    },
    { column: "id", value: submission.id },
  );

  return { ok: true };
};
