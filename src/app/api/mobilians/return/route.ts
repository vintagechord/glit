import { NextRequest } from "next/server";

import { handleMobiliansReturn } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleMobiliansReturn(req);
}

export async function POST(req: NextRequest) {
  return handleMobiliansReturn(req);
}

