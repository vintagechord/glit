import { NextRequest, NextResponse } from "next/server";

import { handleCancelRequest } from "@/app/api/service/subscription/inicis_cancel/route";

export async function POST(req: NextRequest) {
  return handleCancelRequest(req, true);
}

export function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export const runtime = "nodejs";
