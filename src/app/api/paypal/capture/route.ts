import { NextResponse } from "next/server";

import {
  capturePayPalOrder,
  markPayPalOrderCanceled,
} from "@/lib/payments/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const redirectToStatus = (
  req: Request,
  submissionId: string,
  guestToken: string,
  payment: "paid" | "cancelled" | "failed",
) => {
  const url = new URL(
    `/en/submissions/${encodeURIComponent(submissionId)}`,
    req.url,
  );
  if (guestToken) url.searchParams.set("guestToken", guestToken);
  url.searchParams.set("payment", payment);
  return NextResponse.redirect(url);
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const submissionId = url.searchParams.get("submissionId")?.trim() ?? "";
  const guestToken = url.searchParams.get("guestToken")?.trim() ?? "";
  const orderId =
    url.searchParams.get("token")?.trim() ??
    url.searchParams.get("orderId")?.trim() ??
    "";
  const cancelled = url.searchParams.get("cancel") === "1";

  if (!submissionId) {
    return NextResponse.json(
      { error: "submissionId is required." },
      { status: 400 },
    );
  }

  if (cancelled) {
    await markPayPalOrderCanceled({
      orderId: orderId || null,
      submissionId,
      guestToken,
    });
    return redirectToStatus(req, submissionId, guestToken, "cancelled");
  }

  if (!orderId) {
    return redirectToStatus(req, submissionId, guestToken, "failed");
  }

  try {
    const result = await capturePayPalOrder({
      orderId,
      submissionId,
      guestToken,
    });

    if (result.error) {
      return redirectToStatus(req, submissionId, guestToken, "failed");
    }

    return redirectToStatus(req, submissionId, guestToken, "paid");
  } catch (error) {
    console.error("[PayPal] capture route failed", error);
    return redirectToStatus(req, submissionId, guestToken, "failed");
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { orderId?: string; submissionId?: string; guestToken?: string }
    | null;
  const orderId = body?.orderId?.trim() ?? "";
  const submissionId = body?.submissionId?.trim() ?? "";
  const guestToken = body?.guestToken?.trim() ?? "";

  if (!orderId || !submissionId) {
    return NextResponse.json(
      { error: "orderId and submissionId are required." },
      { status: 400 },
    );
  }

  const result = await capturePayPalOrder({ orderId, submissionId, guestToken });
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, captureId: result.captureId });
}
