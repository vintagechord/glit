import { NextRequest } from "next/server";

import { handleMobiliansReturn } from "../return/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleMobiliansReturn(req, { notificationOnly: true });
}

export async function POST(req: NextRequest) {
  return handleMobiliansReturn(req, { notificationOnly: true });
}

