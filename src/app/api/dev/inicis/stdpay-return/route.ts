import { NextRequest, NextResponse } from "next/server";

import { getStdPayConfig } from "@/lib/inicis/config";
import { requestStdPayApproval } from "@/lib/inicis/api";
import { getBaseUrl } from "../../../../../lib/url";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Disabled in production" }, { status: 404 });
  }

  const form = await req.formData();
  const baseUrl = getBaseUrl(req);
  const authToken = (form.get("authToken") as string | null) ?? "";
  const authUrl = (form.get("authUrl") as string | null) ?? "";
  const netCancelUrl = (form.get("netCancelUrl") as string | null) ?? "";
  const orderId = (form.get("oid") as string | null) ?? (form.get("orderNumber") as string | null) ?? "";
  const mid = (form.get("mid") as string | null) ?? "";
  const timestamp =
    (form.get("timestamp") as string | null) ??
    (form.get("tstamp") as string | null) ??
    Date.now().toString();

  const maskedMid = mid ? `${mid.slice(0, 2)}***${mid.slice(-2)}` : "";

  const config = getStdPayConfig();
  if (mid && mid !== config.mid) {
    return NextResponse.json(
      { ok: false, error: "MID mismatch", orderId, mid: maskedMid },
      { status: 400 },
    );
  }

  const approval = await requestStdPayApproval({
    authUrl,
    netCancelUrl,
    authToken,
    timestamp: String(timestamp),
  });

  console.info("[Inicis][STDPay][dev-return]", {
    orderId,
    mid: maskedMid || `${config.mid.slice(0, 2)}***${config.mid.slice(-2)}`,
    resultCode: approval.data?.resultCode ?? approval.data?.resultcode ?? null,
    resultMsg: approval.data?.resultMsg ?? approval.data?.resultmsg ?? null,
    secureSignatureMatches: approval.secureSignatureMatches ?? null,
    ok: approval.ok,
  });

  return NextResponse.json({
    ok: approval.ok,
    orderId,
    baseUrl,
    mid: maskedMid || `${config.mid.slice(0, 2)}***${config.mid.slice(-2)}`,
    approval: approval.data ?? null,
    secureSignatureMatches: approval.secureSignatureMatches ?? null,
  });
}

export const GET = POST;

export const runtime = "nodejs";
