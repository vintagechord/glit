import { NextRequest, NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";
import { getDashboardStatusData } from "@/lib/dashboard-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);
  const authenticatedAt = performance.now();
  const responseHeaders = () => ({
    "Cache-Control": "private, no-store",
    "Server-Timing": `auth;dur=${(authenticatedAt - startedAt).toFixed(1)}, status;dur=${(performance.now() - authenticatedAt).toFixed(1)}`,
  });

  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: responseHeaders() });
  }

  const bypassCache =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("bypassCache") === "1";
  const result = await getDashboardStatusData(user.id, { bypassCache });
  if (result.error || !result.data) {
    return NextResponse.json(
      { error: result.error ?? "STATUS_QUERY_FAILED" },
      { status: 500, headers: responseHeaders() },
    );
  }

  return NextResponse.json({ ...result.data, viewerId: user.id }, {
    headers: responseHeaders(),
  });
}
