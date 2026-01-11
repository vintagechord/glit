import { NextRequest } from "next/server";

import { handleCancelRequest } from "@/app/api/service/subscription/inicis_cancel/route";

export async function POST(req: NextRequest) {
  return handleCancelRequest(req, true);
}

export async function GET(req: NextRequest) {
  return handleCancelRequest(req, true);
}

export const runtime = "nodejs";
