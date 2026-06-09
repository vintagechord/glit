import { NextResponse } from "next/server";

import { createGlobalSubmission } from "@/lib/global/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await createGlobalSubmission(body);
  if (result.error || !result.submission) {
    return NextResponse.json(
      {
        error: result.error,
        issues: result.issues,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    submission: result.submission,
  });
}
