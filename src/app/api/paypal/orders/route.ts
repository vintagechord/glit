import { NextResponse } from "next/server";

import { createPayPalOrderForSubmission } from "@/lib/payments/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { submissionId?: string; guestToken?: string }
    | null;
  const submissionId = body?.submissionId?.trim();
  const guestToken = body?.guestToken?.trim();

  if (!submissionId) {
    return NextResponse.json(
      { error: "submissionId is required." },
      { status: 400 },
    );
  }

  try {
    const result = await createPayPalOrderForSubmission({
      submissionId,
      guestToken,
      request: req,
    });

    if (result.error || !result.approveUrl) {
      return NextResponse.json(
        { error: result.error ?? "PayPal order could not be created." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      orderId: result.orderId,
      approveUrl: result.approveUrl,
    });
  } catch (error) {
    console.error("[PayPal] order route failed", error);
    return NextResponse.json(
      { error: "PayPal order could not be created." },
      { status: 500 },
    );
  }
}
